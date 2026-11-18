"""A package's tests re-run whenever a package it uses changes: offline, run by Quick checks.

    python3 -m unittest discover -s .github/scripts

Turborepo skips a `test` task whose hash hasn't moved, and the hash holds only the package's own
files (plus the inputs its `turbo.json` lists by hand) unless the task waits for another task.
`test` waits for `transit`, which waits for every used package's `transit` (the way `bundle-size`
does), so a change to a shared package moves the `test` hash of every package that uses it, the
website's and the app's included (R16, M4; the founder, 18 November 2026). Without that line a
change to `core` re-ran only `core`'s own tests, and the Remote Cache served the app's and the
website's old results.

This runs Turborepo itself, never a stand-in: it makes a temporary `git worktree` of HEAD outside
the repository (with this checkout's uncommitted `turbo.json` changes carried over, so a change
to the config is tried before it's committed), asks `turbo run test --dry=json` for every
`test` task's hash, changes one source file of a shared package there, and asks again. The real
checkout's files are never touched, nothing is run (a dry run), and no cache is read or written,
local or remote. It proves:

  - every package's `test` task, the ones whose `turbo.json` sets their own `inputs` included,
    waits for its own package's `transit`;
  - a change to `@hrizzup/core` moves the app's and the website's `test` hash, a change to
    `@hrizzup/api` moves the app's, and a change to `@hrizzup/db` moves the markets package's, each
    package's own too, while a package that doesn't use the changed one keeps its hash;
  - it can fail: with `test`'s `dependsOn` removed from every `turbo.json` of that worktree, the
    same change to `core` moves only `core`'s own hash, so it is the `transit` line that carries
    the change;
  - every package's `transit` waits for the `transit` of each package its package.json lists
    (`dependencies`, `devDependencies`, `optionalDependencies`), so no package's own `transit`
    setting can cut the chain unseen;
  - the root `turbo.json`'s `test` keeps `transit` and its `transit` keeps `^transit`, and a
    package's own setting of either keeps it (or `$TURBO_EXTENDS$`, which adds to the root's).

If Turborepo isn't installed here, the test fails and says so (`pnpm install` first); it never
skips. Python's standard library only.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TURBO = os.path.join(ROOT, "node_modules", ".bin", "turbo")

# What each proof changes: (the shared package, a source file of it, the packages that use it and
# must follow, a package that doesn't use it and must not). None of the three is a hand-listed
# input of the followers (the website's `turbo.json` lists `api/src/**`, so `api` -> the website
# proves nothing and isn't here), and the file is a source file, never a package.json or a vitest
# config, which the website lists by hand.
PROOFS = {
    "core": ("@hrizzup/core", "product/packages/core/src/index.ts",
             ["@hrizzup/app", "@hrizzup/web"], "@hrizzup/market-engine"),
    "api": ("@hrizzup/api", "product/packages/api/src/index.ts",
            ["@hrizzup/app"], "@hrizzup/core"),
    "db": ("@hrizzup/db", "product/packages/db/src/index.ts",
           ["@hrizzup/markets"], "@hrizzup/app"),
}
USES = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
# What Turborepo's `^transit` follows: a package's `transit` waits for the `transit` of each of these.
LINKS = ("dependencies", "devDependencies", "optionalDependencies")


def run(command, cwd, env=None, stdin=None):
    """The finished command, or a failure that says what ran and what it printed."""
    done = subprocess.run(command, cwd=cwd, env=env, input=stdin, capture_output=True, text=True, timeout=120)
    if done.returncode:
        raise AssertionError(f"`{' '.join(command)}` failed ({done.returncode}) in {cwd}:\n"
                             f"{(done.stderr or done.stdout)[-1500:]}")
    return done


def turbo_files(top):
    """Every turbo.json of the repository whose root is `top`: the files git knows (tracked, or
    new and not ignored), never a walk, which from this checkout would also read the other
    sessions' worktrees under `.claude/worktrees`."""
    names = run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*turbo.json"],
                cwd=top).stdout.split("\0")
    return sorted(os.path.join(top, name) for name in names if name and os.path.basename(name) == "turbo.json")


def load(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except ValueError as error:
        raise AssertionError(f"{path} isn't plain JSON ({error}); this test reads it as JSON.") from error


class TestsFollowPackages(unittest.TestCase):
    def setUp(self):
        self.assertTrue(
            os.access(TURBO, os.X_OK),
            f"Turborepo isn't installed at {TURBO}: run `pnpm install` first. This check never skips.")
        parent = os.path.realpath(tempfile.mkdtemp(prefix="tests-follow-packages-"))
        self.tree = os.path.join(parent, "tree")
        # Last in, first out: the worktree's entry goes first, then its folder. Registered before
        # the worktree exists, so a failure half-way through still cleans up. Only this entry is
        # removed: the repository's other worktrees (other sessions') are never touched.
        self.addCleanup(shutil.rmtree, parent, True)
        self.addCleanup(self.remove_worktree)
        run(["git", "worktree", "add", "--detach", "--quiet", self.tree, "HEAD"], cwd=ROOT)
        # The checkout's own uncommitted change to a turbo.json (none in CI, a clean checkout).
        # The flags keep a user's own git settings (diff.noprefix, diff.external, color.diff) from
        # changing what `git apply` reads.
        changes = run(["git", "diff", "HEAD", "--binary", "--no-ext-diff", "--no-color",
                       "--src-prefix=a/", "--dst-prefix=b/", "--", "*turbo.json"], cwd=ROOT).stdout
        if changes:
            run(["git", "apply", "-"], cwd=self.tree, stdin=changes)

    def remove_worktree(self):
        subprocess.run(["git", "worktree", "remove", "--force", self.tree], cwd=ROOT, capture_output=True)

    def hashes(self):
        """{task id: {"hash", "dependencies", "directory"}} of every `test` task, from a dry run
        that reads and writes no cache and sends nothing: telemetry off, no update check, the
        cache settings of the Remote Cache step (TURBO_TOKEN and the like) not passed on."""
        env = {key: value for key, value in os.environ.items() if not key.startswith("TURBO_")}
        env.update(TURBO_TELEMETRY_DISABLED="1", DO_NOT_TRACK="1")
        done = run([TURBO, "run", "test", "--dry=json", "--cache=local:,remote:", "--no-update-notifier"],
                   cwd=self.tree, env=env)
        try:
            tasks = json.loads(done.stdout)["tasks"]
        except (ValueError, KeyError) as error:
            raise AssertionError(f"turbo's dry run didn't print its tasks as JSON ({error}):\n"
                                 f"{done.stdout[:500]}") from error
        return {task["taskId"]: {"hash": task["hash"], "dependencies": task["dependencies"],
                                 "directory": task["directory"]} for task in tasks}

    def change(self, path):
        """Appends a comment to a source file of the worktree (never of the real checkout)."""
        with open(os.path.join(self.tree, path), "a", encoding="utf-8") as handle:
            handle.write("\n// tests-follow-packages: a change to this file\n")

    def drop_test_depends_on(self):
        """Removes `dependsOn` from `test` in every turbo.json of the worktree; returns how many
        had one (the root's at least, or the test proves nothing)."""
        dropped = 0
        for path in turbo_files(self.tree):
            config = load(path)
            test = (config.get("tasks") or {}).get("test")
            if isinstance(test, dict) and "dependsOn" in test:
                del test["dependsOn"]
                dropped += 1
                with open(path, "w", encoding="utf-8") as handle:
                    json.dump(config, handle, indent=2)
        return dropped

    def prove(self, name):
        shared, path, followers, unrelated = PROOFS[name]
        before = self.hashes()
        uses = [f"{package}#test" for package in [shared, *followers, unrelated]]
        self.assertEqual([task for task in uses if task not in before], [],
                         "a package this proof names has no `test` task (the packages changed: pick others)")
        for follower in followers:
            self.assertIn(shared, self.uses(before, follower),
                          f"{follower} no longer lists {shared} in its package.json, so it can't follow it: "
                          "pick another package for this proof")
        self.assertNotIn(shared, self.uses(before, unrelated),
                         f"{unrelated} now uses {shared}, so it can't stand for a package that doesn't: "
                         "pick another package for this proof")
        self.change(path)
        after = self.hashes()
        self.assertNotEqual(before[f"{shared}#test"]["hash"], after[f"{shared}#test"]["hash"],
                            f"the change to {path} didn't move {shared}'s own `test` hash")
        for follower in followers:
            self.assertNotEqual(
                before[f"{follower}#test"]["hash"], after[f"{follower}#test"]["hash"],
                f"a change to {shared} must re-run {follower}'s tests: its `test` hash didn't move "
                "(`test` must depend on `transit` in turbo.json)")
        self.assertEqual(
            before[f"{unrelated}#test"]["hash"], after[f"{unrelated}#test"]["hash"],
            f"{unrelated} doesn't use {shared}, so a change to {shared} must leave its `test` hash alone")

    def uses(self, tasks, package):
        """Every workspace package a package uses, all the way down, from the package.json files
        of the worktree (Turborepo's own answer is what the proofs test, so it isn't asked here)."""
        directories = {task[: -len("#test")]: info["directory"] for task, info in tasks.items() if task.endswith("#test")}
        seen, queue = set(), [package]
        while queue:
            with open(os.path.join(self.tree, directories[queue.pop()], "package.json"), encoding="utf-8") as handle:
                manifest = json.load(handle)
            for name in {name for kind in USES for name in manifest.get(kind, {})}:
                if name in directories and name not in seen:
                    seen.add(name)
                    queue.append(name)
        return seen

    def test_every_test_task_waits_for_its_own_transit(self):
        tasks = self.hashes()
        found = {task: info for task, info in tasks.items() if task.endswith("#test")}
        self.assertTrue(found, "turbo's dry run found no `test` task at all")
        for task, info in found.items():
            transit = task[: -len("#test")] + "#transit"
            self.assertIn(transit, info["dependencies"],
                          f"{task} doesn't wait for {transit}: a change to a package it uses wouldn't re-run it "
                          "(`test` in turbo.json, or this package's own `test` there, lost its `dependsOn`)")

    def test_every_transit_waits_for_the_transit_of_what_its_package_uses(self):
        tasks = self.hashes()
        transits = {task: info for task, info in tasks.items() if task.endswith("#transit")}
        self.assertTrue(transits, "turbo's dry run found no `transit` task at all")
        self.maxDiff = None  # every problem, not the first few
        missing = []
        for task, info in sorted(transits.items()):
            with open(os.path.join(self.tree, info["directory"], "package.json"), encoding="utf-8") as handle:
                manifest = json.load(handle)
            for name in sorted({name for kind in LINKS for name in manifest.get(kind, {})}):
                if f"{name}#transit" in transits and f"{name}#transit" not in info["dependencies"]:
                    missing.append(f"{task} doesn't wait for {name}#transit")
        self.assertEqual(missing, [], "a package's `transit` must wait for the `transit` of each package its package.json "
                         "lists, or a change to that package wouldn't reach its dependents' tests (a package's own "
                         "`transit` in turbo.json lost `^transit`)")

    def test_a_change_to_core_re_runs_the_apps_and_the_websites_tests(self):
        self.prove("core")

    def test_a_change_to_api_re_runs_the_apps_tests(self):
        self.prove("api")

    def test_a_change_to_db_re_runs_the_markets_tests(self):
        self.prove("db")

    def test_without_the_dependency_a_change_stays_in_its_own_package(self):
        shared, path, _, _ = PROOFS["core"]
        self.assertGreater(self.drop_test_depends_on(), 0, "no turbo.json sets `dependsOn` on `test` any more")
        before = self.hashes()  # a fresh baseline: dropping the line itself moves every hash
        self.assertEqual(before["@hrizzup/app#test"]["dependencies"], [])
        self.change(path)
        after = self.hashes()
        self.assertNotEqual(before[f"{shared}#test"]["hash"], after[f"{shared}#test"]["hash"],
                            "the change didn't even move core's own hash, so this proves nothing")
        self.assertEqual(before["@hrizzup/app#test"]["hash"], after["@hrizzup/app#test"]["hash"],
                         "the app's hash moved with no dependency, so something else carries a change to core "
                         "and the proofs above don't prove the `transit` line")

    def test_the_configs_keep_transit_on_test(self):
        root = load(os.path.join(ROOT, "turbo.json"))
        self.assertIn("transit", root["tasks"]["test"].get("dependsOn", []),
                      "the root turbo.json's `test` must depend on `transit`")
        for path in turbo_files(ROOT):
            test = (load(path).get("tasks") or {}).get("test")
            if path == os.path.join(ROOT, "turbo.json") or not isinstance(test, dict) or "dependsOn" not in test:
                continue
            kept = test["dependsOn"]
            self.assertTrue("transit" in kept or "$TURBO_EXTENDS$" in kept,
                            f"{os.path.relpath(path, ROOT)} sets `test`'s `dependsOn` without `transit` "
                            "(or `$TURBO_EXTENDS$`, which keeps the root's)")

    def test_the_configs_keep_up_transit_on_transit(self):
        root = load(os.path.join(ROOT, "turbo.json"))
        self.assertIn("^transit", root["tasks"]["transit"].get("dependsOn", []),
                      "the root turbo.json's `transit` must depend on `^transit`: it is what carries a change "
                      "from a package to every package that uses it")
        for path in turbo_files(ROOT):
            transit = (load(path).get("tasks") or {}).get("transit")
            if path == os.path.join(ROOT, "turbo.json") or not isinstance(transit, dict) or "dependsOn" not in transit:
                continue
            kept = transit["dependsOn"]
            self.assertTrue("^transit" in kept or "$TURBO_EXTENDS$" in kept,
                            f"{os.path.relpath(path, ROOT)} sets `transit`'s `dependsOn` without `^transit` "
                            "(or `$TURBO_EXTENDS$`, which keeps the root's)")


if __name__ == "__main__":
    unittest.main()
