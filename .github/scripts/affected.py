#!/usr/bin/env python3
"""Which parts of the product a pull request touches: what a part ships, and its own tests and tools.

    python3 .github/scripts/affected.py

Writes `website=true|false` and `app=true|false` to $GITHUB_OUTPUT. The checks that test a part
skip their work when it isn't touched. Prints no secrets.

A part (the website, the app) counts as touched when a package it reaches changed. It reaches:
itself, everything it ships (its `dependencies`, and theirs, all the way down), and its own
`devDependencies` (its own tests and tools) with what they ship. Another package's
`devDependencies` are never followed: markets, perps and ledger list the database package there
for their own database tests, which says nothing about what the website shows, and a preview can't
see a database change that hasn't merged. A package that uses database code at run time lists it
under `dependencies`, and a test pins that.

The packages that changed come from Turborepo's own filter (`turbo ls --filter=[base...head]`: the
packages with a changed file, no dependents added); the links between packages are read from each
package's own `package.json` (any dependency named like a workspace package is a link, whatever
version it asks for). Four things come first, after or instead:

  - A change to the checks themselves (.github/workflows or .github/scripts) counts as touching
    every part, so a pull request that changes how a check runs is checked by it.
  - A change to a file every package depends on (the lockfile, the workspace list, the root
    `package.json`, `turbo.json`, `.node-version`) counts as touching every part. Asked of git
    directly, never of Turborepo.
  - A change to a file outside a part's folder that one of these `turbo.json` files names as an
    input (`$TURBO_ROOT$/...`: the website's tests read three files of the database package's
    folder, and its screen checks' test accounts read one of them) touches that part: the part's
    own, the root one's for the tasks the part has scripts for, and the own `turbo.json` of every
    package in the part's reach. A package declares what it reads from outside its folder so that
    Turborepo's cache is never stale; the same list says what can change it. This is read after
    every answer below too, and a `turbo.json` or package list that can't be read counts the part
    as touched. A pattern with a wildcard counts every file under its literal beginning, and one that
    begins with a wildcard (`**/package.json`: the website's retry test reads every `package.json`
    in the repository) every file named like its last part.
  - If Turborepo's answer can't be used (it fails, prints something else, names the repository's
    root, or comes back empty while `turbo ls --affected` doesn't), the answer is `turbo ls
    --affected`, which counts every kind of link: the wider answer this script used before. If that
    fails too, the changed files are mapped to package folders and the same wide answer is drawn
    from them. If even that can't be done, every part counts as touched.
"""
import fnmatch
import json
import os
import re
import subprocess

PARTS = {"website": "@hrizzup/web", "app": "@hrizzup/app"}
CHECKS = (".github/workflows/", ".github/scripts/")  # the checks themselves
GLOBAL_FILES = ("pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "turbo.json", ".node-version")
ROOT = "//"  # how Turborepo names the repository's own root package
ROOT_INPUT = "$TURBO_ROOT$/"  # how a package's turbo.json names a file outside its folder
SHIPPED = ("dependencies", "optionalDependencies", "peerDependencies")  # what a package brings along
TOOLS = ("devDependencies",)  # what only its own tests and tools use


def checks_changed(base, head, run=subprocess.run):
    """The files of the checks themselves that this change touches (empty without a base)."""
    if not base or not head:
        return []
    return run(
        ["git", "diff", "--name-only", f"{base}...{head}", "--", *CHECKS],
        check=True, capture_output=True, text=True,
    ).stdout.split()


def changed_files(base, head, run=subprocess.run):
    """Every file this change touches, a rename counting as both its old and its new place."""
    names = run(
        ["git", "diff", "--name-only", "--no-renames", "-z", f"{base}...{head}"],
        check=True, capture_output=True, text=True,
    ).stdout
    return [name for name in names.split("\0") if name]


def parts(touched, checks):
    """{part: affected?} from the packages counted as touched and the checks' files."""
    return {part: bool(checks) or package in touched for part, package in PARTS.items()}


def everything(touched):
    return {part: touched for part in PARTS}


def ask(command, run):
    """What a command prints, read as JSON; None when it fails or prints anything else."""
    try:
        return json.loads(run(command, check=True, capture_output=True, text=True).stdout)
    except (subprocess.CalledProcessError, OSError, ValueError):
        return None


def listing(answer):
    """{name: path} from `turbo ls --output=json`; None when it isn't that shape."""
    try:
        return {item["name"]: item["path"] for item in answer["packages"]["items"]}
    except (TypeError, KeyError):
        return None


def turbo_ls(run, *arguments):
    return listing(ask(["pnpm", "exec", "turbo", "ls", *arguments, "--output=json"], run))


def workspaces(run=subprocess.run):
    """{name: folder} of every workspace package, from Turborepo or else from pnpm; None if neither."""
    found = turbo_ls(run)
    if found is not None:
        return found
    answer = ask(["pnpm", "ls", "-r", "--depth", "-1", "--json"], run)
    try:
        found = {item["name"]: os.path.relpath(item["path"]) for item in answer}
    except (TypeError, KeyError):
        return None
    return {name: path for name, path in found.items() if path != "."}  # not the root itself


def read_package(path, root="."):
    with open(os.path.join(root, path, "package.json")) as manifest:
        return json.load(manifest)


def read_tasks(path, root="."):
    """A package's own turbo.json ({} when it has none); a ValueError when it isn't plain JSON."""
    try:
        with open(os.path.join(root, path, "turbo.json")) as tasks:
            return json.load(tasks)
    except FileNotFoundError:
        return {}


def declared_inputs(tasks, only=None):
    """The files outside its folder that a turbo.json names as inputs of its tasks (only the tasks
    called one of `only`, when given), as patterns from the repository's root. Patterns that carve
    files out (`!...`) are ignored, which can only count more files, never fewer."""
    return [
        entry[len(ROOT_INPUT):]
        for name, task in (tasks.get("tasks") or {}).items()
        if only is None or name.rsplit("#", 1)[-1] in only
        for entry in task.get("inputs") or []
        if entry.startswith(ROOT_INPUT)
    ]


def expand_braces(text):
    """`a.{ts,js}` as ['a.ts', 'a.js'] (one level of braces at a time, as many as there are)."""
    found = re.search(r"\{([^{}]*)\}", text)
    if not found:
        return [text]
    return [
        expanded
        for option in found.group(1).split(",")
        for expanded in expand_braces(text[:found.start()] + option + text[found.end():])
    ]


def matches(pattern, file):
    """Whether a file is one a turbo.json pattern names, counting more than the pattern does, never
    fewer: the file itself when the pattern has no wildcard (`*`, `?`, `[`, `{`); every file under
    the pattern's literal beginning when it has one (`agreement/**/*.json` also counts
    `agreement/x.json`); and, when the pattern begins with a wildcard (`**/package.json`: anywhere
    in the repository), every file with a name like the pattern's last part (any `package.json`)."""
    wildcards = [pattern.index(mark) for mark in "*?[{" if mark in pattern]
    if not wildcards:
        return file == pattern
    if min(wildcards):
        return file.startswith(pattern[:min(wildcards)])
    name = file.rsplit("/", 1)[-1]
    return any(fnmatch.fnmatchcase(name, option) for option in expand_braces(pattern.rsplit("/", 1)[-1]))


def graph(found, read=read_package):
    """{package: {"ships": names, "tools": names}}: the links between workspace packages, from each
    `package.json`: a dependency named like a workspace package is a link, whatever version it asks
    for (and a name that isn't a workspace package's never is)."""
    links = {}
    for name, path in found.items():
        manifest = read(path)

        def linked(kinds):
            return {dep for kind in kinds for dep in (manifest.get(kind) or {}) if dep in found}

        links[name] = {"ships": linked(SHIPPED), "tools": linked(TOOLS)}
    return links


def reach(package, links):
    """What a change would have to be in to touch this package: itself, what it ships (and what
    that ships), and its own tools (and what they ship). Others' tools are never followed."""
    seen, queue = set(), [package, *links[package]["tools"]]
    while queue:
        name = queue.pop()
        if name not in seen:
            seen.add(name)
            queue.extend(links[name]["ships"])
    return seen


def users_of(changed, links):
    """Everything that uses a changed package through any kind of link, and the changed ones
    themselves: the wide answer Turborepo's `--affected` gives."""
    seen, queue = set(), list(changed)
    while queue:
        name = queue.pop()
        if name in links and name not in seen:
            seen.add(name)
            queue.extend(user for user, kinds in links.items() if name in kinds["ships"] | kinds["tools"])
    return seen | set(changed)


def packages_of(files, found):
    """The packages whose folder holds one of the files (the innermost folder wins)."""
    folders = sorted(((path.rstrip("/"), name) for name, path in found.items()), key=lambda folder: -len(folder[0]))
    owners = set()
    for file in files:
        for path, name in folders:
            if file == path or file.startswith(path + "/"):
                owners.add(name)
                break
    return owners


def read_graph(run, read):
    """(workspaces, links) of the repository, or None when they can't be read."""
    found = workspaces(run)
    if found is None:
        return None
    try:
        return found, graph(found, read)
    except (OSError, ValueError, AttributeError):  # a package.json that's missing, broken or not an object
        return None


def touched_parts(changed, links):
    """{part: touched?}: a part is touched when one of the changed packages is in its reach."""
    return {
        part: package not in links or bool(changed & reach(package, links))
        for part, package in PARTS.items()
    }


def part_inputs(package, found, links, read, read_turbo):
    """The patterns of the files a part reads from outside its folder: those its own `turbo.json`
    names, those the root `turbo.json` names for the tasks the part has scripts for, and those
    the own `turbo.json` of every package in its reach names."""
    scripts = set(read(found[package]).get("scripts") or {})
    patterns = declared_inputs(read_turbo("."), only=scripts)
    for name in sorted(reach(package, links)):
        patterns += declared_inputs(read_turbo(found[name]))
    return patterns


def read_inputs(touched, notes, found, links, files, read, read_turbo):
    """Touches each part not yet touched that reads a changed file (see `part_inputs`); a part whose
    inputs can't be read counts as touched."""
    for part, package in PARTS.items():
        if touched[part]:
            continue
        try:
            patterns = part_inputs(package, found, links, read, read_turbo) if package in found else None
        except (OSError, ValueError, AttributeError, TypeError, KeyError):
            patterns = None
        if patterns is None:
            touched[part] = True
            notes.append(f"What the {part} reads from outside its folder couldn't be read, so it counts as affected.")
            continue
        read_files = [file for file in files if any(matches(pattern, file) for pattern in patterns)]
        if read_files:
            touched[part] = True
            notes.append(f"The {part} reads {', '.join(read_files)} (named in a turbo.json), so it counts as affected.")


def wide_answer(why, today, files, run, read):
    """({part: touched?}, [what to print], the graph if it was read) from the wide answer, for when
    the narrow one can't be used: `turbo ls --affected`'s, else one drawn from the changed files,
    else every part."""
    if today is not None:
        return parts(today, []), [f"{why}, so every package Turborepo counts as affected is counted."], None
    read_all = read_graph(run, read) if files is not None else None
    if read_all is not None:
        found, links = read_all
        changed = users_of(packages_of(files, found), links)
        return parts(changed, []), [f"{why}, and `turbo ls --affected` didn't answer, so the changed files' packages and everything using them are counted."], read_all
    return everything(True), [f"{why}, and nothing could say what changed, so every part counts as affected."], None


def which_parts(base, head, files, run, read):
    """({part: touched?}, [what to print], the graph if it was read): the narrow rule, or a wide answer."""
    changed = turbo_ls(run, f"--filter=[{base}...{head}]") if base and head else None
    if changed is None:
        why = "Turborepo couldn't say which packages changed" if base and head else "There is no base to compare with"
        return wide_answer(why, turbo_ls(run, "--affected"), files, run, read)
    changed = set(changed)
    if ROOT in changed:
        return wide_answer("Turborepo counts the repository's root as changed", turbo_ls(run, "--affected"), files, run, read)
    if not changed:
        today = turbo_ls(run, "--affected")
        if today is None or today:  # empty while the wide answer isn't: not to be trusted
            return wide_answer("Turborepo found no changed package, and its wide answer doesn't agree", today, files, run, read)

    read_all = read_graph(run, read)
    if read_all is None:
        return wide_answer("The packages' links couldn't be read", turbo_ls(run, "--affected"), files, run, read)
    notes = [f"Changed packages: {', '.join(sorted(changed))}." if changed else "No package changed."]
    return touched_parts(changed, read_all[1]), notes, read_all


def decide(base, head, run=subprocess.run, read=read_package, read_turbo=read_tasks):
    """({part: touched?}, [what to print]) for the change between base and head."""
    checks = checks_changed(base, head, run)
    if checks:
        return everything(True), [f"This change touches the checks themselves ({', '.join(checks)}), so every part counts as affected."]
    files = changed_files(base, head, run) if base and head else None
    shared = [file for file in files or [] if file in GLOBAL_FILES]
    if shared:
        return everything(True), [f"This change touches files every package depends on ({', '.join(shared)}), so every part counts as affected."]

    touched, notes, read_all = which_parts(base, head, files, run, read)
    if files is not None and not all(touched.values()):
        # Whatever answered above, a file in no package, or in one the part doesn't reach, can still be one it reads.
        read_all = read_all or read_graph(run, read)
        if read_all is None:
            for part in [part for part, is_touched in touched.items() if not is_touched]:
                touched[part] = True
                notes.append(f"The packages' links couldn't be read, so the {part} counts as affected.")
        else:
            read_inputs(touched, notes, *read_all, files, read, read_turbo)
    return touched, notes


def main():
    touched, notes = decide(os.environ.get("TURBO_SCM_BASE"), os.environ.get("TURBO_SCM_HEAD"))
    for note in notes:
        print(note)
    with open(os.environ["GITHUB_OUTPUT"], "a") as out:
        for part, affected in touched.items():
            out.write(f"{part}={'true' if affected else 'false'}\n")
            print(f"The {part} is {'' if affected else 'not '}affected by this change.")


if __name__ == "__main__":
    main()
