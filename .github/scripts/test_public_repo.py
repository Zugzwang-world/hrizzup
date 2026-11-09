"""The workflows stay safe in a public repository: offline, reading the workflow files only.

    python3 -m unittest discover -s .github/scripts

The repository is public until launch (founder's decision, 10 November 2026), so anyone can
read its files, pull requests and check logs, and anyone can fork it, though only
collaborators can open pull requests or issues here. These rules keep the repository's keys
away from code and text that someone else wrote:

  - no workflow runs on `pull_request_target` or `workflow_run`: both run with the
    repository's keys on events an outsider's pull request can set off;
  - every action is pinned to a full commit, so a moved tag can't change what runs beside
    our keys;
  - every workflow writes down its token's rights (a top-level `permissions:`);
  - text someone else can choose (a branch name, a pull request's title, a run's inputs)
    never lands inside a script through `${{ }}`: it reaches the script through `env:`;
  - every job runs on GitHub's own machines, never on a machine of ours;
  - only the founder releases: every job of the release workflow needs the job that checks
    the run was started, and any re-run made, by the repository's owner.

Python's standard library only.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKFLOWS = os.path.join(ROOT, ".github", "workflows")

# Events that run with the repository's keys although an outsider's pull request sets them off.
WITH_OUR_KEYS_FOR_OUTSIDERS = {"pull_request_target", "workflow_run"}
PINNED = re.compile(r"^[\w.-]+/[\w.-]+(?:/[\w./-]+)?@[0-9a-f]{40}$")
# What a script may take through ${{ }}: values GitHub or the workflow itself sets, which nobody
# else can choose. Everything else goes through env:.
SAFE_IN_SCRIPTS = re.compile(
    r"^(?:github\.(?:sha|run_id|run_number|run_attempt|repository|repository_owner|workspace)"
    r"|runner\.(?:temp|os|arch)|matrix\.[\w-]+)$")
GITHUBS_MACHINES = re.compile(r"^(?:ubuntu|windows|macos)-[\w.-]+$")
FOUNDER_CHECK = ("github.actor", "github.triggering_actor", "github.repository_owner")


def workflows():
    """{file name: text} for every workflow file."""
    found = {}
    for name in sorted(os.listdir(WORKFLOWS)):
        if name.endswith((".yml", ".yaml")):
            with open(os.path.join(WORKFLOWS, name), encoding="utf-8") as f:
                found[name] = f.read()
    return found


def without_comments(text):
    """The text without comments: whole-line ones, and ` # ...` after a value."""
    kept = []
    for line in text.splitlines():
        if line.lstrip().startswith("#"):
            continue
        kept.append(re.sub(r"\s+#\s.*$", "", line))
    return "\n".join(kept) + "\n"


def triggers(text):
    """The events a workflow runs on: its `on:` block's keys, or its inline list."""
    text = without_comments(text)
    inline = re.search(r"^on:[ \t]*(\S.*)$", text, re.M)
    if inline:
        return set(re.findall(r"[a-z_]+", inline.group(1)))
    block = re.search(r"^on:[ \t]*\n((?:[ \t]+\S.*\n|[ \t]*\n)*)", text, re.M)
    if not block:
        return set()
    indents = [len(m.group(1)) for m in re.finditer(r"^([ \t]+)\S", block.group(1), re.M)]
    first = min(indents) if indents else 2
    return set(re.findall(rf"^[ \t]{{{first}}}([a-z_]+):", block.group(1), re.M))


def actions(text):
    """Every `uses:` value in a workflow."""
    return re.findall(r"^\s*(?:-\s+)?uses:\s*['\"]?([^\s'\"#]+)", without_comments(text), re.M)


def scripts(text):
    """[(line number, script)] for every `run:` in a workflow, block scripts included."""
    lines, found = text.splitlines(), []
    for i, line in enumerate(lines):
        match = re.match(r"^(\s*)(-\s+)?run:\s*(.*)$", line)
        if not match:
            continue
        indent = len(match.group(1)) + len(match.group(2) or "")
        body = [match.group(3)]
        if re.fullmatch(r"[|>][+-]?", match.group(3).strip()):
            for following in lines[i + 1:]:
                if following.strip() and len(following) - len(following.lstrip()) <= indent:
                    break
                body.append(following)
        found.append((i + 1, "\n".join(body)))
    return found


def jobs(text):
    """{job id: the job's text} for one workflow, by indentation."""
    body = text.split("\njobs:\n", 1)[1] if "\njobs:\n" in text else ""
    found, job = {}, None
    for line in body.splitlines():
        start = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if start:
            job = start.group(1)
            found[job] = ""
        elif line and not line[0].isspace() and not line.startswith("#"):
            break  # the next top-level key: the jobs are over
        elif job is not None:
            found[job] += line + "\n"
    return found


def needs(job_text):
    """The jobs one job needs, from `needs: x`, `needs: [x, y]` or a list under `needs:`."""
    match = re.search(r"^    needs:[ \t]*(.*)$((?:\n      - .*)*)", job_text, re.M)
    if not match:
        return set()
    return set(re.findall(r"[A-Za-z_][A-Za-z0-9_-]*", match.group(1) + match.group(2)))


class Workflows(unittest.TestCase):
    def setUp(self):
        self.files = workflows()
        self.assertIn("release.yml", self.files)  # so no test can pass by finding nothing

    def test_no_workflow_runs_with_our_keys_on_an_outsiders_event(self):
        for name, text in self.files.items():
            with self.subTest(workflow=name):
                found = triggers(text)
                self.assertTrue(found, f"{name}: no trigger found; the reader misses its `on:`")
                self.assertFalse(found & WITH_OUR_KEYS_FOR_OUTSIDERS,
                                 f"{name} runs on {sorted(found & WITH_OUR_KEYS_FOR_OUTSIDERS)}, which "
                                 "runs with the repository's keys on an outsider's pull request")

    def test_every_action_is_pinned_to_a_full_commit(self):
        for name, text in self.files.items():
            for action in actions(text):
                with self.subTest(workflow=name, action=action):
                    if action.startswith("./"):
                        continue  # this repository's own, at the same commit
                    self.assertRegex(action, PINNED, f"{name}: pin {action} to a full commit SHA")

    def test_every_workflow_writes_down_its_tokens_rights(self):
        for name, text in self.files.items():
            with self.subTest(workflow=name):
                self.assertRegex(text, re.compile(r"^permissions:", re.M),
                                 f"{name}: no top-level `permissions:`")
                self.assertNotIn("write-all", without_comments(text), f"{name}: `write-all` rights")

    def test_no_script_takes_text_through_an_expression(self):
        for name, text in self.files.items():
            for line, script in scripts(text):
                for expression in re.findall(r"\$\{\{(.*?)\}\}", script, re.S):
                    with self.subTest(workflow=name, line=line, expression=expression.strip()):
                        self.assertRegex(expression.strip(), SAFE_IN_SCRIPTS,
                                         f"{name}, line {line}: give the script ${{{{{expression.strip()}}}}} "
                                         "through env: instead")

    def test_every_job_runs_on_githubs_own_machines(self):
        for name, text in self.files.items():
            for machine in re.findall(r"^\s+runs-on:\s*(.+?)\s*$", without_comments(text), re.M):
                with self.subTest(workflow=name, machine=machine):
                    self.assertRegex(machine.strip("'\""), GITHUBS_MACHINES,
                                     f"{name}: runs-on {machine} isn't one of GitHub's own machines")

    def test_only_the_founder_releases(self):
        text = self.files["release.yml"]
        self.assertEqual(triggers(text), {"workflow_dispatch"}, "the release starts only by hand")
        found = jobs(text)
        guards = [job for job, body in found.items()
                  if all(f"${{{{ {value} }}}}" in body for value in FOUNDER_CHECK) and "exit 1" in body]
        self.assertEqual(len(guards), 1, "release.yml: exactly one job checks the run is the founder's")
        guard = guards[0]
        self.assertNotIn("environment:", found[guard], "the founder check holds no environment")
        self.assertNotIn("secrets.", found[guard], "the founder check holds no keys")
        self.assertNotRegex(found[guard], re.compile(r"^    if:", re.M), "the founder check always runs")
        others = [job for job in found if job != guard]
        self.assertTrue(others, "release.yml: no release job found")
        for job in others:
            with self.subTest(job=job):
                self.assertIn(guard, needs(found[job]), f"release.yml: job {job} doesn't need {guard}")
                condition = re.search(r"^    if:(.*)$", found[job], re.M)
                self.assertFalse(condition and re.search(r"always\(\)|failure\(\)|cancelled\(\)", condition.group(1)),
                                 f"release.yml: job {job} could run although the founder check failed")


class TheReaders(unittest.TestCase):
    """The small readers above, on made-up workflows, so the rules can't pass by misreading."""

    SAMPLE = (
        "name: x\n"
        "on:\n"
        "  pull_request:\n"
        "  workflow_dispatch:\n"
        "    inputs:\n"
        "      commit:\n"
        "        default: ''\n"
        "permissions:\n"
        "  contents: read\n"
        "jobs:\n"
        "  # a comment between jobs\n"
        "  first:\n"
        "    runs-on: ubuntu-24.04\n"
        "    steps:\n"
        "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n"
        "      - run: echo \"${{ github.sha }}\"\n"
        "      - name: block\n"
        "        run: |\n"
        "          echo one\n"
        "          echo \"${{ github.head_ref }}\"\n"
        "        env:\n"
        "          A: ${{ inputs.commit }}\n"
        "  second:\n"
        "    needs: [first, third]\n"
        "    runs-on: self-hosted\n"
        "    steps:\n"
        "      - uses: some/action@v1\n"
        "  third:\n"
        "    needs:\n"
        "      - first\n"
        "    runs-on: ubuntu-latest\n"
    )

    def test_triggers(self):
        self.assertEqual(triggers(self.SAMPLE), {"pull_request", "workflow_dispatch"})
        self.assertEqual(triggers("on: [push, pull_request_target]\njobs:\n"), {"push", "pull_request_target"})
        self.assertEqual(triggers("on:\n  workflow_run:\n    workflows: [x]\njobs:\n"), {"workflow_run"})

    def test_actions(self):
        self.assertEqual(actions(self.SAMPLE),
                         ["actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "some/action@v1"])
        self.assertRegex(actions(self.SAMPLE)[0], PINNED)
        self.assertNotRegex(actions(self.SAMPLE)[1], PINNED)

    def test_scripts_and_what_they_may_take(self):
        found = scripts(self.SAMPLE)
        self.assertEqual(len(found), 2)
        expressions = [e.strip() for _, s in found for e in re.findall(r"\$\{\{(.*?)\}\}", s)]
        self.assertEqual(expressions, ["github.sha", "github.head_ref"])  # env: isn't a script
        self.assertRegex("github.sha", SAFE_IN_SCRIPTS)
        for chosen_by_someone_else in ("github.head_ref", "github.event.pull_request.title", "inputs.commit",
                                       "github.ref_name", "steps.x.outputs.y"):
            self.assertNotRegex(chosen_by_someone_else, SAFE_IN_SCRIPTS)

    def test_jobs_and_needs(self):
        found = jobs(self.SAMPLE)
        self.assertEqual(list(found), ["first", "second", "third"])
        self.assertEqual(needs(found["second"]), {"first", "third"})
        self.assertEqual(needs(found["third"]), {"first"})
        self.assertEqual(needs(found["first"]), set())

    def test_machines(self):
        machines = re.findall(r"^\s+runs-on:\s*(.+?)\s*$", without_comments(self.SAMPLE), re.M)
        self.assertEqual([bool(GITHUBS_MACHINES.match(m)) for m in machines], [True, False, True])


if __name__ == "__main__":
    unittest.main()
