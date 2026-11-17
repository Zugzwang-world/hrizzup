"""Tests for which parts a change touches (affected.py): offline, with made-up changes.

    python3 -m unittest discover -s .github/scripts

A change to the checks themselves (.github/workflows or .github/scripts) runs every part's
checks, so a pull request that changes how a check runs is checked by it. A part counts as
touched through what it ships (`dependencies`) and its own tests and tools (its own
`devDependencies`), so a change that only the database package holds, which markets, perps and
ledger list in `devDependencies` for their own database tests, doesn't touch the website.
"""
import contextlib
import io
import json
import os
import re
import subprocess
import tempfile
import unittest
from unittest import mock

import affected

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Diff:
    def __init__(self, names):
        self.names, self.calls = names, []

    def __call__(self, command, **kwargs):
        self.calls.append(command)
        return subprocess.CompletedProcess(command, 0, stdout="\n".join(self.names) + "\n")


class WhatAChangeTouches(unittest.TestCase):
    def test_turborepos_answer_stands_when_the_checks_dont_change(self):
        self.assertEqual(affected.parts({"@hrizzup/web"}, []), {"website": True, "app": False})
        self.assertEqual(affected.parts(set(), []), {"website": False, "app": False})

    def test_a_change_to_the_checks_touches_every_part(self):
        self.assertEqual(affected.parts(set(), [".github/workflows/checks.yml"]), {"website": True, "app": True})

    def test_only_the_checks_own_folders_are_asked_about(self):
        diff = Diff([".github/scripts/tools.py"])
        self.assertEqual(affected.checks_changed("base", "head", run=diff), [".github/scripts/tools.py"])
        self.assertEqual(diff.calls, [["git", "diff", "--name-only", "base...head", "--",
                                       ".github/workflows/", ".github/scripts/"]])

    def test_without_a_base_nothing_is_asked(self):
        diff = Diff([".github/workflows/checks.yml"])
        self.assertEqual(affected.checks_changed("", "head", run=diff), [])
        self.assertEqual(diff.calls, [])


def real_workspaces():
    """{name: folder} of the repository's workspace packages, from pnpm-workspace.yaml's own list."""
    with open(os.path.join(REPO, "pnpm-workspace.yaml")) as workspace:
        listed = re.search(r"^packages:\n((?:(?:  .*)?\n)+)", workspace.read(), re.M).group(1)  # that list only
    folders = re.findall(r"^  - (\S+)", listed, re.M)
    found = {}
    for folder in folders:
        parent = folder[:-2] if folder.endswith("/*") else None
        for path in sorted(os.listdir(os.path.join(REPO, parent))) if parent else [None]:
            path = f"{parent}/{path}" if parent else folder
            if os.path.exists(os.path.join(REPO, path, "package.json")):
                found[affected.read_package(path, REPO)["name"]] = path
    return found


def real_read(path):
    return affected.read_package(path, REPO)


def real_read_tasks(path):
    return affected.read_tasks(path, REPO)


def no_tasks(path):
    return {}


class Fails(Exception):
    """Stands for a command that fails."""


class Repo:
    """Stands in for subprocess.run: git's answer for the files a change touches, and Turborepo's for
    the packages it filters out and counts as affected, each canned (a list of package names, a
    `Fails`, or text that isn't JSON)."""

    def __init__(self, files=(), changed=(), wide=(), workspaces=None, pnpm=Fails):
        self.files, self.changed, self.wide, self.pnpm = list(files), changed, wide, pnpm
        self.workspaces = real_workspaces() if workspaces is None else workspaces
        self.paths = {} if self.workspaces is Fails else self.workspaces
        self.calls = []

    def packages(self, names):
        if names is Fails:
            raise subprocess.CalledProcessError(1, "turbo")
        if isinstance(names, str):
            return names
        return json.dumps({"packages": {"count": len(names), "items": [{"name": n, "path": self.paths.get(n, "x")} for n in names]}})

    def __call__(self, command, **kwargs):
        self.calls.append(command)
        if command[0] == "git" and "--" in command:  # the checks' own folders
            folders = tuple(command[command.index("--") + 1:])
            out = "\n".join(f for f in self.files if f.startswith(folders))
        elif command[0] == "git":
            out = "".join(f + "\0" for f in self.files)
        elif command[:2] == ["pnpm", "ls"]:
            if self.pnpm is Fails:
                raise subprocess.CalledProcessError(1, "pnpm")
            out = json.dumps(self.pnpm)
        elif any(a.startswith("--filter=") for a in command):
            out = self.packages(self.changed)
        elif "--affected" in command:
            out = self.packages(self.wide)
        else:
            out = self.packages(Fails if self.workspaces is Fails else list(self.workspaces))
        return subprocess.CompletedProcess(command, 0, stdout=out)

    def asked_turbo(self):
        return [c for c in self.calls if "turbo" in c]


WEBSITE, APP = "@hrizzup/web", "@hrizzup/app"

# Turborepo's own answers, as measured locally on 18 November 2026 for #124, #134 and #126: its filter
# (`turbo ls --filter=[base...head]`) lists only what changed; its `--affected` adds every user.
FILES_124 = [
    "TRACKER.md", "docs/brief/product.md", "docs/status/product.md",
    "infra/supabase/migrations/20261110191500_bitcoin_price.sql", "infra/supabase/newest-migration.txt",
    "infra/supabase/tests/bitcoin_price.test.sql",
]
FILES_134 = [
    "TRACKER.md", "docs/brief/product.md", "docs/setup/RUNBOOK.md", "docs/status/product.md",
    "infra/supabase/migrations/20261111090000_market_data.sql", "infra/supabase/newest-migration.txt",
    "infra/supabase/tests/market_data.test.sql", "infra/supabase/tests/trading_reads.test.sql",
]
FILES_126 = [
    "TRACKER.md", "docs/brief/product.md", "docs/status/product.md",
    "product/packages/perps/src/index.ts", "product/packages/perps/src/own-price.test.ts",
    "product/packages/perps/src/plan.ts", "product/packages/perps/src/step.ts",
    "product/packages/perps/src/trading.ts", "product/web/app/console/perps/[id]/page.tsx",
    "product/web/app/sandbox/perps/page.tsx", "product/web/e2e/journeys/perp-api.spec.ts",
]
EVERY_USER_OF_DATABASE = ["@hrizzup/database", "@hrizzup/ledger", "@hrizzup/markets", "@hrizzup/perps", WEBSITE]


def decide(repo, base="base", head="head"):
    return affected.decide(base, head, run=repo, read=real_read, read_turbo=real_read_tasks)


class ADatabaseOnlyChangeTouchesNeitherPart(unittest.TestCase):
    def test_124s_files_the_bitcoin_prices_migration(self):
        touched, notes = decide(Repo(FILES_124, changed=["@hrizzup/database"], wide=EVERY_USER_OF_DATABASE))
        self.assertEqual(touched, {"website": False, "app": False})
        self.assertEqual(notes, ["Changed packages: @hrizzup/database."])

    def test_134s_files_the_market_data_migration(self):
        touched, _ = decide(Repo(FILES_134, changed=["@hrizzup/database"], wide=EVERY_USER_OF_DATABASE))
        self.assertEqual(touched, {"website": False, "app": False})

    def test_126s_files_perps_and_the_website_touch_the_website_only(self):
        touched, _ = decide(Repo(FILES_126, changed=["@hrizzup/perps", WEBSITE], wide=["@hrizzup/perps", WEBSITE]))
        self.assertEqual(touched, {"website": True, "app": False})

    def test_the_narrow_answer_asks_turborepo_only_for_the_changed_packages_and_the_workspaces(self):
        repo = Repo(FILES_124, changed=["@hrizzup/database"], wide=EVERY_USER_OF_DATABASE)
        decide(repo, "aaa", "bbb")
        self.assertEqual(
            [c[4:] for c in repo.asked_turbo()],
            [["--filter=[aaa...bbb]", "--output=json"], ["--output=json"]],
        )

    def test_a_package_that_lists_the_database_in_dependencies_does_touch_the_website(self):
        # Made up: markets *ships* the database package, so a change to it reaches the website.
        found = {"@hrizzup/web": "web", "@hrizzup/app": "app", "@hrizzup/markets": "markets", "@hrizzup/database": "db"}
        manifests = {
            "web": {"dependencies": {"@hrizzup/markets": "workspace:*"}},
            "app": {"dependencies": {}},
            "markets": {"dependencies": {"@hrizzup/database": "workspace:*"}},
            "db": {},
        }
        repo = Repo(["db/x.sql"], changed=["@hrizzup/database"], wide=list(found), workspaces=found)
        touched, _ = affected.decide("base", "head", run=repo, read=manifests.__getitem__, read_turbo=no_tasks)
        self.assertEqual(touched, {"website": True, "app": False})

    def test_the_same_package_in_devdependencies_only_does_not(self):
        found = {"@hrizzup/web": "web", "@hrizzup/app": "app", "@hrizzup/markets": "markets", "@hrizzup/database": "db"}
        manifests = {
            "web": {"dependencies": {"@hrizzup/markets": "workspace:*"}},
            "app": {},
            "markets": {"devDependencies": {"@hrizzup/database": "workspace:*"}},
            "db": {},
        }
        repo = Repo(["db/x.sql"], changed=["@hrizzup/database"], wide=list(found), workspaces=found)
        touched, _ = affected.decide("base", "head", run=repo, read=manifests.__getitem__, read_turbo=no_tasks)
        self.assertEqual(touched, {"website": False, "app": False})

    def test_a_change_to_ledger_a_website_devdependency_touches_the_website(self):
        touched, _ = decide(Repo(["product/packages/ledger/src/x.ts"], changed=["@hrizzup/ledger"]))
        self.assertEqual(touched, {"website": True, "app": False})

    def test_the_website_s_own_tools_and_what_they_ship_count_but_not_other_packages_tools(self):
        # web has ledger in devDependencies; ledger ships market-engine; the database package is only
        # in ledger's devDependencies.
        links = affected.graph(real_workspaces(), real_read)
        website = affected.reach(WEBSITE, links)
        self.assertIn("@hrizzup/ledger", website)
        self.assertIn("@hrizzup/market-engine", website)
        self.assertNotIn("@hrizzup/database", website)
        self.assertIn("@hrizzup/example-bot", website)  # the website's journeys run it (e2e/journeys/example-bot.spec.ts)

    def test_a_change_only_under_the_example_bot_touches_the_website(self):
        # The website's journeys and unit tests import examples/bot/bot.ts, so the bot is one of its tools.
        touched, notes = decide(Repo(["examples/bot/bot.ts", "examples/bot/README.md"], changed=["@hrizzup/example-bot"]))
        self.assertEqual(touched, {"website": True, "app": False})
        self.assertEqual(notes, ["Changed packages: @hrizzup/example-bot."])

    def test_the_example_bot_is_one_of_the_websites_own_tools(self):
        links = affected.graph(real_workspaces(), real_read)
        self.assertIn("@hrizzup/example-bot", links[WEBSITE]["tools"])

    def test_a_change_to_one_part_s_package_touches_that_part_only(self):
        touched, _ = decide(Repo(["product/app/app/index.tsx"], changed=[APP]))
        self.assertEqual(touched, {"website": False, "app": True})
        touched, _ = decide(Repo(["product/packages/api/src/x.ts"], changed=["@hrizzup/api"]))
        self.assertEqual(touched, {"website": True, "app": True})

    def test_a_nested_package_json_is_not_the_root_one(self):
        # Not a global file, so Turborepo is asked. The website still counts for the database package's
        # own package.json, because the retry test in its folder reads every package.json in the repository
        # (product/web/turbo.json), but the app, which reads none, doesn't.
        for nested, package in (("product/web/package.json", WEBSITE), ("infra/supabase/package.json", "@hrizzup/database")):
            repo = Repo([nested], changed=[package], wide=[package])
            touched, _ = decide(repo)
            self.assertEqual(touched, {"website": True, "app": False}, nested)
            self.assertTrue(repo.asked_turbo(), nested)

    def test_no_changed_package_touches_nothing(self):
        touched, notes = decide(Repo(["TRACKER.md"], changed=[], wide=[]))
        self.assertEqual(touched, {"website": False, "app": False})
        self.assertEqual(notes, ["No package changed."])


class AFileOutsideAPartThatItsTurboJsonNamesTouchesIt(unittest.TestCase):
    """The website's tests read three files of the database package's folder, and its screen checks'
    test accounts read one of them (e2e/support/test-accounts.ts), so a change to one of them isn't a
    database-only change, whatever the narrow rule says of the package."""

    READ_BY_THE_WEBSITE = [
        "infra/supabase/project/settings.json", "infra/supabase/auth/settings.json", "infra/supabase/supabase-root-2021-ca.crt",
    ]

    def test_each_of_the_three_touches_the_website_though_the_database_is_outside_its_reach(self):
        for file in self.READ_BY_THE_WEBSITE:
            repo = Repo(["TRACKER.md", file], changed=["@hrizzup/database"], wide=EVERY_USER_OF_DATABASE)
            touched, notes = decide(repo)
            self.assertEqual(touched, {"website": True, "app": False}, file)
            self.assertIn(file, notes[1])

    def test_the_rest_of_the_database_packages_folder_still_doesnt(self):
        files = ["infra/supabase/auth/apply.py", "infra/supabase/project/README.md", "infra/supabase/tests/x.test.sql", "infra/supabase/migrations/1_x.sql"]
        touched, notes = decide(Repo(files, changed=["@hrizzup/database"], wide=EVERY_USER_OF_DATABASE))
        self.assertEqual(touched, {"website": False, "app": False})
        self.assertEqual(len(notes), 1)

    def test_the_websites_declared_inputs_include_those_three_files(self):
        declared = affected.declared_inputs(real_read_tasks("product/web"))
        for file in self.READ_BY_THE_WEBSITE:
            self.assertIn(file, declared)

    def test_the_app_declares_none(self):
        self.assertEqual(affected.declared_inputs(real_read_tasks("product/app")), [])

    def test_a_pattern_names_a_file_a_folders_everything_or_a_glob(self):
        self.assertTrue(affected.matches("a/b.json", "a/b.json"))
        self.assertFalse(affected.matches("a/b.json", "a/b.json.bak"))
        self.assertFalse(affected.matches("a/b.json", "x/a/b.json"))
        self.assertTrue(affected.matches("agreement/src/**", "agreement/src/deep/x.ts"))
        self.assertFalse(affected.matches("agreement/src/**", "agreement/srcs/x.ts"))
        self.assertTrue(affected.matches("a/*.json", "a/x.json"))
        self.assertFalse(affected.matches("a/*.json", "b/x.json"))

    def test_a_wildcard_counts_every_file_under_the_patterns_literal_beginning(self):
        # `**` in the middle matches no folder in a glob, so a glob would miss `agreement/x.json`.
        self.assertTrue(affected.matches("agreement/**/*.json", "agreement/x.json"))
        self.assertTrue(affected.matches("agreement/**/*.json", "agreement/a/b/x.json"))
        self.assertTrue(affected.matches("agreement/**/*.json", "agreement/notes.md"))  # more, never fewer
        self.assertFalse(affected.matches("agreement/**/*.json", "agreements/x.json"))
        self.assertTrue(affected.matches("a/{b,c}.json", "a/c.json"))
        self.assertTrue(affected.matches("a/b?.json", "a/b1.json"))
        self.assertTrue(affected.matches("a/[bc].json", "a/b.json"))
        self.assertFalse(affected.matches("a/{b,c}.json", "z/c.json"))

    def test_a_pattern_that_begins_with_a_wildcard_counts_every_file_named_like_its_last_part(self):
        self.assertTrue(affected.matches("**/package.json", "infra/supabase/package.json"))
        self.assertTrue(affected.matches("**/package.json", "package.json"))
        self.assertFalse(affected.matches("**/package.json", "infra/supabase/migrations/1_x.sql"))
        self.assertFalse(affected.matches("**/package.json", "infra/supabase/package.json.bak"))
        self.assertTrue(affected.matches("**/vitest.config.{ts,mts,js,mjs}", "product/packages/ledger/vitest.config.ts"))
        self.assertTrue(affected.matches("**/vitest.config.{ts,mts,js,mjs}", "vitest.config.mjs"))
        self.assertFalse(affected.matches("**/vitest.config.{ts,mts,js,mjs}", "product/web/vitest.config.json"))
        self.assertTrue(affected.matches("**/vitest.*.config.{ts,mts,js,mjs}", "product/packages/perps/vitest.db.config.ts"))
        self.assertTrue(affected.matches("*.md", "docs/anything.md"))
        self.assertFalse(affected.matches("*.md", "docs/anything.txt"))
        self.assertTrue(affected.matches("**/dist/**", "any/thing/at/all.txt"))  # its last part is `**`: every file

    def test_braces_expand_one_level_at_a_time(self):
        self.assertEqual(affected.expand_braces("a.ts"), ["a.ts"])
        self.assertEqual(affected.expand_braces("a.{ts,js}"), ["a.ts", "a.js"])
        self.assertEqual(sorted(affected.expand_braces("{a,b}.{ts,js}")), ["a.js", "a.ts", "b.js", "b.ts"])

    def test_only_inputs_from_outside_the_folder_count_and_carve_outs_are_ignored(self):
        tasks = {"tasks": {
            "test": {"inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/x/y.json", "!$TURBO_ROOT$/x/z.json", "!e2e/**", "src/**"]},
            "build": {"outputs": [".next/**"]},
            "lint": {"inputs": ["$TURBO_ROOT$/w/**"]},
        }}
        self.assertEqual(sorted(affected.declared_inputs(tasks)), ["w/**", "x/y.json"])
        self.assertEqual(affected.declared_inputs({}), [])
        self.assertEqual(affected.declared_inputs({"tasks": {"test": {}}}), [])

    def test_a_made_up_part_that_declares_a_file_is_touched_by_it_and_a_part_that_does_not_isnt(self):
        found = {"@hrizzup/web": "web", "@hrizzup/app": "app", "@hrizzup/database": "db"}
        manifests = {"web": {}, "app": {}, "db": {}}
        declared = {"web": {"tasks": {"test": {"inputs": ["$TURBO_ROOT$/db/seed.json"]}}}, "app": {}}
        repo = Repo(["db/seed.json"], changed=["@hrizzup/database"], wide=list(found), workspaces=found)
        touched, _ = affected.decide("base", "head", run=repo, read=manifests.__getitem__, read_turbo=lambda path: declared.get(path, {}))
        self.assertEqual(touched, {"website": True, "app": False})

    def test_a_declared_file_in_no_package_at_all_touches_the_part_too(self):
        found = {"@hrizzup/web": "web", "@hrizzup/app": "app"}
        declared = {"web": {"tasks": {"test": {"inputs": ["$TURBO_ROOT$/docs/reads-this.md"]}}}, "app": {}}
        for files, website in ((["docs/reads-this.md"], True), (["docs/other.md"], False)):
            repo = Repo(files, changed=[], wide=[], workspaces=found)
            touched, notes = affected.decide("base", "head", run=repo, read=lambda path: {}, read_turbo=lambda path: declared.get(path, {}))
            self.assertEqual(touched, {"website": website, "app": False}, files)
            self.assertEqual(len(notes), 2 if website else 1)
            self.assertEqual(notes[0], "No package changed.")

    def test_a_turbo_json_that_cant_be_read_counts_the_part_as_touched(self):
        def broken(path):
            raise ValueError("not plain JSON")

        repo = Repo(FILES_124, changed=["@hrizzup/database"], wide=EVERY_USER_OF_DATABASE)
        touched, notes = affected.decide("base", "head", run=repo, read=real_read, read_turbo=broken)
        self.assertEqual(touched, {"website": True, "app": True})
        self.assertEqual(len([n for n in notes if "reads from outside its folder couldn't be read" in n]), 2)

    def test_a_part_without_a_turbo_json_reads_nothing(self):
        self.assertEqual(affected.read_tasks("product/app", REPO), {})

    def test_every_packages_turbo_json_is_plain_json(self):
        # affected.py reads them with a JSON parser, so a comment in one would count its part as touched.
        for folder in real_workspaces().values():
            affected.read_tasks(folder, REPO)


class WhatAPartReadsFromOutsideItsFolder(unittest.TestCase):
    """Its own turbo.json, the root one's for the tasks the part has scripts for, and the own turbo.json
    of every package in its reach (the part's inputs, `affected.part_inputs`)."""

    # Root tasks whose outside inputs a package in a part's reach runs, but not the part's own checks.
    NOT_THE_PARTS = {
        "test:db": "the database tests of markets, perps and ledger: the Database check runs them on every pull request, and the Screen and Speed checks run none",
    }

    def setUp(self):
        self.found = real_workspaces()
        self.links = affected.graph(self.found, real_read)

    def inputs(self, part):
        return affected.part_inputs(part, self.found, self.links, real_read, real_read_tasks)

    def test_the_websites_are_its_own_three_files_and_those_its_packages_name(self):
        patterns = self.inputs(WEBSITE)
        for file in AFileOutsideAPartThatItsTurboJsonNamesTouchesIt.READ_BY_THE_WEBSITE:
            self.assertIn(file, patterns)
        self.assertIn("agreement/definitions/**", patterns)  # product/packages/api/turbo.json

    def test_a_task_the_part_has_no_script_for_doesnt_count(self):
        # The root turbo.json's `test:db` names infra/slots/slots.py; neither part has that script.
        self.assertNotIn("infra/slots/slots.py", self.inputs(WEBSITE))
        self.assertNotIn("infra/slots/slots.py", self.inputs(APP))

    def test_the_root_turbo_jsons_inputs_count_for_the_tasks_the_part_has_scripts_for(self):
        found = {"@hrizzup/web": "web", "@hrizzup/app": "app", "@x/lib": "lib"}
        manifests = {
            "web": {"scripts": {"test": "x"}, "dependencies": {"@x/lib": "workspace:*"}},
            "app": {"scripts": {"typecheck": "y"}},
            "lib": {},
        }
        root = {"tasks": {
            "test": {"inputs": ["$TURBO_ROOT$/shared/web-reads.json"]},
            "typecheck": {"inputs": ["$TURBO_ROOT$/shared/app-reads.json"]},
            "test:db": {"inputs": ["$TURBO_ROOT$/shared/db-only.json"]},
        }}
        packages = {"lib": {"tasks": {"test": {"inputs": ["$TURBO_ROOT$/shared/lib-reads.json"]}}}}
        for files, expected in (
            (["shared/web-reads.json"], {"website": True, "app": False}),
            (["shared/app-reads.json"], {"website": False, "app": True}),
            (["shared/lib-reads.json"], {"website": True, "app": False}),  # named by a package the website ships
            (["shared/db-only.json"], {"website": False, "app": False}),
        ):
            repo = Repo(files, changed=[], wide=[], workspaces=found)
            touched, _ = affected.decide(
                "base", "head", run=repo, read=manifests.__getitem__,
                read_turbo=lambda path: root if path == "." else packages.get(path, {}),
            )
            self.assertEqual(touched, expected, files)

    def test_no_package_in_a_part_s_reach_names_an_outside_input_that_isnt_covered(self):
        root = real_read_tasks(".")
        for part in (WEBSITE, APP):
            patterns = self.inputs(part)
            for name in affected.reach(part, self.links):
                for pattern in affected.declared_inputs(real_read_tasks(self.found[name])):
                    self.assertIn(pattern, patterns, f"{name}'s turbo.json names {pattern}, which {part} doesn't count")
                scripts = set(real_read(self.found[name]).get("scripts") or {})
                for task in sorted(scripts):
                    for pattern in affected.declared_inputs(root, only={task}):
                        if task in self.NOT_THE_PARTS:
                            continue
                        self.assertIn(pattern, patterns, f"the root turbo.json's {task} names {pattern}, which {name} runs, but {part} doesn't count it")

    def test_the_tasks_set_aside_are_still_the_roots_and_still_run_only_by_the_packages_that_test_the_database(self):
        root = real_read_tasks(".")
        for task in self.NOT_THE_PARTS:
            self.assertTrue(affected.declared_inputs(root, only={task}), task)
            scripts = {part: set(real_read(self.found[part]).get("scripts") or {}) for part in (WEBSITE, APP)}
            for part, own in scripts.items():
                self.assertNotIn(task, own, part)

    def test_after_a_wide_answer_a_file_a_part_reads_still_counts(self):
        # Turborepo's filter fails and its wide answer leaves the website out; the file it reads is named in its turbo.json.
        file = "infra/supabase/project/settings.json"
        touched, notes = decide(Repo([file], changed=Fails, wide=["@hrizzup/database"]))
        self.assertEqual(touched, {"website": True, "app": False})
        self.assertIn("couldn't say which packages changed", notes[0])
        self.assertIn(file, notes[1])


SOURCE_FILES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts")
NOT_SOURCE_FOLDERS = {"node_modules", ".next", ".expo", "dist", "build", "coverage", "android", "ios", ".turbo", "playwright-report", "test-results"}
# A string that is a relative path: `./x`, `../x`, `..`, in quotes or backticks. That covers every
# relative import, `import(...)`, `require(...)`, `new URL('../x', import.meta.url)` and the path
# given to a `readFile`-style call; one that stays in the part's own folder is no concern.
RELATIVE_PATH = re.compile(r"""['"`](\.{1,2}(?:/[^'"`\s]*)?)['"`]""")


def source_files(folder, root=REPO):
    """Every TypeScript and JavaScript file under a folder, from the repository's root."""
    for here, folders, names in os.walk(os.path.join(root, folder)):
        folders[:] = [f for f in folders if f not in NOT_SOURCE_FOLDERS]
        for name in names:
            if name.endswith(SOURCE_FILES):
                yield os.path.relpath(os.path.join(here, name), root)


def relative_paths(folder, root=REPO):
    """[(file, where it points)]: every relative path in a folder's TypeScript and JavaScript (shipped
    code, tests and scripts alike) that leads out of the folder, from the repository's root."""
    found = []
    for path in source_files(folder, root):
        with open(os.path.join(root, path), encoding="utf-8") as source:
            for written in RELATIVE_PATH.findall(source.read()):
                target = os.path.normpath(os.path.join(os.path.dirname(path), written))
                if target != folder and not target.startswith(folder + "/"):
                    found.append((path, target))
    return found


class WhatTheWebsiteAndTheAppReachOutsideTheirFoldersIsCounted(unittest.TestCase):
    """The category behind the rule: every relative path in product/web and product/app that leads out
    of the folder has to land inside a package the part reaches, or be a file one of its inputs
    names (`affected.part_inputs`), or the part could change without being counted as touched."""

    # Reads of the whole repository, each with why it needn't be counted.
    WHOLE_REPOSITORY = {
        ("product/web/e2e/config.test.ts", "."): "forbids retries in every test runner's configuration, workflow and journey script; "
                                               "a Vitest test, which the Screen, Speed and App journeys checks never run; Quick checks do, "
                                               "and what it reads is named in the website's `test` inputs (see TheRetryTestsReadsAreInputsOfTheWebsitesTestTask)",
    }

    def reads(self, part, folder):
        found = real_workspaces()
        links = affected.graph(found, real_read)
        reached = affected.reach(part, links)
        patterns = affected.part_inputs(part, found, links, real_read, real_read_tasks)
        everything, uncovered = relative_paths(folder), []
        for path, target in everything:
            if (path, target) in self.WHOLE_REPOSITORY:
                continue
            if affected.packages_of([target], found) & reached or any(affected.matches(pattern, target) for pattern in patterns):
                continue
            uncovered.append(f"{path} reads {target}, which {part} neither reaches nor names in a turbo.json")
        return everything, uncovered

    def test_everything_the_website_reaches_for_outside_its_folder_is_counted(self):
        everything, uncovered = self.reads(WEBSITE, "product/web")
        self.assertEqual(uncovered, [])
        self.assertGreater(len(list(source_files("product/web"))), 100)  # the scan did read the website
        # The scan did read the website, and found what the rule was built for.
        for read in (
            ("product/web/e2e/support/test-accounts.ts", "infra/supabase/project/settings.json"),
            ("product/web/lib/email-code.test.ts", "infra/supabase/auth/settings.json"),
            ("product/web/lib/supabase-ca.test.ts", "infra/supabase/supabase-root-2021-ca.crt"),
            ("product/web/e2e/journeys/example-bot.spec.ts", "examples/bot/bot.ts"),
            ("product/web/e2e/example-bot.test.ts", "examples/bot/bot.ts"),
            ("product/web/e2e/done/api-3.5cdf.spec.ts", "examples/bot/bot.ts"),
        ):
            self.assertIn(read, everything)

    def test_everything_the_app_reaches_for_outside_its_folder_is_counted(self):
        everything, uncovered = self.reads(APP, "product/app")
        self.assertEqual(uncovered, [])
        self.assertGreater(len(list(source_files("product/app"))), 20)  # the scan did read the app

    def test_the_whole_repository_reads_set_aside_are_still_there(self):
        # A stale entry would hide a read that moved.
        found = relative_paths("product/web")
        for read in self.WHOLE_REPOSITORY:
            self.assertIn(read, found)
        self.assertEqual({path for path, target in found if target == "."}, {"product/web/e2e/config.test.ts"})

    def test_the_scan_sees_a_relative_path_of_every_kind(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "part", "sub"))
            with open(os.path.join(root, "part", "sub", "x.ts"), "w") as source:
                source.write(
                    "import a from '../../a.ts'; export { b } from '../../b'; import '../../c.css';\n"
                    "const d = await import('../../d.ts'); const e = require('../../e');\n"
                    "const f = new URL('../../f.crt', import.meta.url); readFileSync(`../../g.json`);\n"
                    "const h = new URL('../..', import.meta.url);\n"
                    "const inside = './ok.ts'; const sibling = '../sibling.ts'; const text = 'not/a/path';\n"
                )
            found = relative_paths("part", root)
        self.assertEqual({path for path, _ in found}, {"part/sub/x.ts"})
        self.assertEqual(sorted(target for _, target in found), [".", "a.ts", "b", "c.css", "d.ts", "e", "f.crt", "g.json"])


class AppJourneysRunsWhenWhatItUsesFromTheWebsiteChanges(unittest.TestCase):
    """The signed-in journey runs the website's account script (product/web/scripts/app-journey-account.ts)
    through run.sh. Turborepo doesn't count that as part of the app, so the workflow lists what the
    script uses, both for pull requests (a `git diff` of these paths) and for pushes to main (`paths`)."""

    SCRIPT = "product/web/scripts/app-journey-account.ts"

    def workflow(self):
        with open(os.path.join(REPO, ".github/workflows/app-journeys.yml")) as text:
            return text.read()

    def helpers(self):
        listed = re.search(r'git diff --quiet "\$BASE\.\.\.\$HEAD" -- (.+?); then', self.workflow())
        self.assertTrue(listed, "the helpers' git diff is gone")
        return listed.group(1).split()

    def pushed_paths(self):
        listed = re.search(r"^  push:\n    branches: \[main\]\n    paths:\n((?:      - .+\n)+)", self.workflow(), re.M)
        self.assertTrue(listed, "the push paths are gone")
        return [line[8:].strip() for line in listed.group(1).splitlines()]

    def covered(self, path, listed):
        return any(path == entry or (entry.endswith("/") and path.startswith(entry)) for entry in listed)

    def test_what_the_account_script_reads_is_listed_for_pull_requests(self):
        helpers = self.helpers()
        for path in (self.SCRIPT, "product/web/e2e/support/run.ts", "infra/doppler/named_keys.py", "infra/supabase/project/settings.json"):
            self.assertTrue(self.covered(path, helpers), path)

    def test_and_for_pushes_to_main(self):
        pushed = self.pushed_paths()
        for entry in ("product/web/scripts/app-journey-account.ts", "product/web/e2e/support/**", "infra/doppler/**", "infra/supabase/project/settings.json"):
            self.assertIn(entry, pushed)

    def test_both_lists_name_the_same_files(self):
        helpers = [h.rstrip("/") for h in self.helpers()]
        pushed = [p.rstrip("*").rstrip("/") for p in self.pushed_paths() if p.startswith(("product/web/", "infra/"))]
        self.assertEqual(sorted(helpers), sorted(pushed))

    def test_everything_the_account_script_imports_by_a_relative_path_is_listed(self):
        helpers, seen, queue, reads = self.helpers(), set(), [self.SCRIPT], set()
        while queue:
            path = queue.pop()
            if path in seen:
                continue
            seen.add(path)
            with open(os.path.join(REPO, path), encoding="utf-8") as source:
                for written in RELATIVE_PATH.findall(source.read()):
                    target = os.path.normpath(os.path.join(os.path.dirname(path), written))
                    reads.add(target)
                    if target.endswith(SOURCE_FILES):
                        queue.append(target)
        self.assertGreater(len(seen), 2)  # the script, the run's keys and the test accounts, at least
        self.assertIn("infra/supabase/project/settings.json", reads)
        unlisted = sorted(read for read in reads if not self.covered(read, helpers))
        self.assertEqual(unlisted, [])


def glob_regex(pattern):
    """A Turborepo input glob as a regular expression: `**/` any folders (or none), `/**` at the end
    anything beneath, `*` within a name, `?` one character, `{a,b}` alternatives."""
    out, i, braces = "", 0, False
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif pattern.startswith("/**", i) and i + 3 == len(pattern):
            out, i = out + "/.*", i + 3
        elif pattern.startswith("**", i):
            out, i = out + ".*", i + 2
        elif pattern[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif pattern[i] == "?":
            out, i = out + "[^/]", i + 1
        elif pattern[i] == "{":
            out, i, braces = out + "(?:", i + 1, True
        elif pattern[i] == "}" and braces:
            out, i, braces = out + ")", i + 1, False
        elif pattern[i] == "," and braces:
            out, i = out + "|", i + 1
        else:
            out, i = out + re.escape(pattern[i]), i + 1
    return re.compile(out + r"\Z")


def what_the_retry_test_reads():
    """The files product/web/e2e/config.test.ts reads outside the website, from its own source: every
    file `files(...)` finds (walked as it does, skipping the folders it skips) and every file it reads
    by `join(ROOT, '...')`. Fails if the test reads in a way this can't follow."""
    with open(os.path.join(REPO, "product/web/e2e/config.test.ts"), encoding="utf-8") as source:
        text = source.read()
    skipped = re.search(r"\[((?:'[^']*',?\s*)+)\]\.includes\(entry\)", text)
    assert skipped, "the folders config.test.ts skips can't be found"
    skipped = set(re.findall(r"'([^']*)'", skipped.group(1)))
    walks = [
        (folder, re.compile(regex))
        for _, folder, regex in re.findall(r"files\((ROOT|join\(ROOT, '([^']*)'\)), /((?:[^/\\\n]|\\.)+)/\)", text)
    ]
    folders = {folder for folder, _ in walks}
    singles = {path for path in re.findall(r"join\(ROOT, '([^']*)'\)", text) if path not in folders}
    leftover = re.sub(r"const ROOT = [^\n]*", "", text)
    leftover = re.sub(r"files\((?:ROOT|join\(ROOT, '[^']*'\)), /(?:[^/\\\n]|\\.)+/\)", "", leftover)
    leftover = re.sub(r"join\(ROOT, '[^']*'\)", "", leftover)
    leftover = re.sub(r"relative\(ROOT, path\)", "", leftover)
    assert "ROOT" not in leftover, "config.test.ts reads the repository in a way this test can't follow"
    reads = set(singles)
    for folder, name in walks:
        for here, subfolders, names in os.walk(os.path.join(REPO, folder)):
            subfolders[:] = [f for f in subfolders if f not in skipped]
            reads.update(os.path.relpath(os.path.join(here, n), REPO) for n in names if name.search(n))
    return sorted(reads), len(walks)


class TheRetryTestsReadsAreInputsOfTheWebsitesTestTask(unittest.TestCase):
    """product/web/e2e/config.test.ts forbids retries in every test runner's configuration, in the
    workflows and in the app's journey script, so it reads files all over the repository. Turborepo
    replays a test whose inputs haven't changed, so each file it reads outside the website has to be an
    input of the website's `test` task (product/web/turbo.json), or a workflow that added retries
    could pass Quick checks from the cache."""

    def inputs(self):
        listed = real_read_tasks("product/web")["tasks"]["test"]["inputs"]
        self.assertIn("$TURBO_DEFAULT$", listed)  # the website's own files stay inputs
        outside = [i[len(affected.ROOT_INPUT):] for i in listed if i.startswith(affected.ROOT_INPUT)]
        carved = [i[len("!" + affected.ROOT_INPUT):] for i in listed if i.startswith("!" + affected.ROOT_INPUT)]
        return [glob_regex(i) for i in outside], [glob_regex(i) for i in carved]

    def test_every_file_it_reads_outside_the_website_is_an_input(self):
        reads, walks = what_the_retry_test_reads()
        self.assertGreaterEqual(walks, 3)
        for expected in (
            ".github/workflows/checks.yml", "product/app/journeys/run.sh", "package.json", "infra/supabase/package.json",
            "product/app/scripts/package.json", "infra/supabase/vitest.config.ts", "product/packages/ledger/vitest.db.config.ts",
        ):
            self.assertIn(expected, reads)
        named, carved = self.inputs()
        uncovered = [
            read for read in reads
            if not read.startswith("product/web/")
            and not (any(g.match(read) for g in named) and not any(g.match(read) for g in carved))
        ]
        self.assertEqual(uncovered, [], "config.test.ts reads these, but the website's test inputs don't name them")

    def test_what_isnt_read_stays_out_and_installed_packages_are_carved_out(self):
        named, carved = self.inputs()
        self.assertFalse(any(g.match("docs/setup.md") for g in named))
        self.assertTrue(any(g.match("node_modules/.pnpm/x@1/node_modules/x/package.json") for g in carved))
        self.assertTrue(any(g.match("product/web/.next/server/package.json") for g in carved))

    def test_the_glob_reading_here_is_turborepos(self):
        # The forms the website's inputs use; the dry run (`turbo run test --filter=@hrizzup/web --dry=json`)
        # lists the same files, which is how this was checked.
        for pattern, yes, no in (
            (".github/workflows/**", ".github/workflows/checks.yml", ".github/workflows"),
            ("**/package.json", "package.json", "infra/package.json.bak"),
            ("**/package.json", "infra/supabase/package.json", "infra/supabase/x.json"),
            ("**/vitest.config.{ts,mts,js,mjs}", "a/b/vitest.config.mts", "a/b/vitest.config.json"),
            ("**/vitest.*.config.{ts,mts,js,mjs}", "a/vitest.db.config.ts", "a/vitest.config.ts"),
            ("**/{node_modules,.next}/**", "a/node_modules/b/package.json", "a/b/package.json"),
            ("a/b.sh", "a/b.sh", "a/b.shx"),
        ):
            self.assertTrue(glob_regex(pattern).match(yes), (pattern, yes))
            self.assertFalse(glob_regex(pattern).match(no), (pattern, no))


class SomeChangesTouchEveryPartWithoutAskingTurborepo(unittest.TestCase):
    def test_the_checks_themselves(self):
        for file in (".github/workflows/checks.yml", ".github/scripts/affected.py"):
            repo = Repo(FILES_124 + [file], changed=["@hrizzup/database"])
            touched, notes = decide(repo)
            self.assertEqual(touched, {"website": True, "app": True}, file)
            self.assertIn(file, notes[0])
            self.assertEqual(repo.asked_turbo(), [], file)

    def test_each_file_every_package_depends_on(self):
        for file in affected.GLOBAL_FILES:
            repo = Repo(FILES_124 + [file], changed=["@hrizzup/database"])
            touched, notes = decide(repo)
            self.assertEqual(touched, {"website": True, "app": True}, file)
            self.assertIn(file, notes[0])
            self.assertEqual(repo.asked_turbo(), [], file)

    def test_those_files_are_the_five_the_design_names(self):
        self.assertEqual(
            set(affected.GLOBAL_FILES),
            {"pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "turbo.json", ".node-version"},
        )

    def test_a_renamed_file_counts_at_both_its_places(self):
        repo = Repo()
        affected.changed_files("a", "b", run=repo)
        self.assertEqual(repo.calls, [["git", "diff", "--name-only", "--no-renames", "-z", "a...b"]])

    def test_file_names_are_read_whole_whatever_they_hold(self):
        repo = Repo(["a b/c.ts", 'quote".ts', "Ṁ/ü.ts"])
        self.assertEqual(affected.changed_files("a", "b", run=repo), ["a b/c.ts", 'quote".ts', "Ṁ/ü.ts"])


class WhenTurborepoCantBeTrusted(unittest.TestCase):
    """Each gives today's answer: `turbo ls --affected`, every kind of link."""

    def check(self, repo, message):
        touched, notes = decide(repo)
        self.assertEqual(touched, {"website": True, "app": False})
        self.assertIn(message, notes[0])

    def test_the_filter_fails(self):
        self.check(Repo(FILES_124, changed=Fails, wide=EVERY_USER_OF_DATABASE), "couldn't say which packages changed")

    def test_the_filter_prints_something_else(self):
        for text in ("", "not json", "{}", '{"packages": []}', '{"packages": {"items": [1]}}', "null"):
            self.check(Repo(FILES_124, changed=text, wide=EVERY_USER_OF_DATABASE), "couldn't say which packages changed")

    def test_the_filter_names_the_root(self):
        self.check(Repo(FILES_124, changed=["//", "@hrizzup/database"], wide=EVERY_USER_OF_DATABASE), "root")

    def test_the_filter_is_empty_while_the_wide_answer_is_not(self):
        self.check(Repo(FILES_124, changed=[], wide=EVERY_USER_OF_DATABASE), "found no changed package")

    def test_the_workspace_list_cant_be_read(self):
        # Today's answer stands, and the app, which it leaves untouched, counts too: what it reads
        # from outside its folder can't be checked either.
        found = Repo(FILES_124, changed=["@hrizzup/database"], wide=EVERY_USER_OF_DATABASE)
        found.workspaces = Fails
        touched, notes = decide(found)
        self.assertEqual(touched, {"website": True, "app": True})
        self.assertIn("links couldn't be read", notes[0])
        self.assertIn("so the app counts as affected", notes[1])

    def test_a_package_json_that_cant_be_read(self):
        repo = Repo(FILES_124, changed=["@hrizzup/database"], wide=EVERY_USER_OF_DATABASE)

        def broken(path):
            raise FileNotFoundError(path)

        touched, notes = affected.decide("base", "head", run=repo, read=broken, read_turbo=real_read_tasks)
        self.assertEqual(touched, {"website": True, "app": True})
        self.assertIn("links couldn't be read", notes[0])

    def test_without_a_base_there_is_nothing_to_filter_by(self):
        for base, head in ((None, None), ("", ""), ("base", None)):
            repo = Repo(FILES_124, changed=["@hrizzup/database"], wide=EVERY_USER_OF_DATABASE)
            touched, notes = affected.decide(base, head, run=repo, read=real_read, read_turbo=real_read_tasks)
            self.assertEqual(touched, {"website": True, "app": False})
            self.assertIn("no base", notes[0])
            self.assertFalse([c for c in repo.calls if any(a.startswith("--filter") for a in c)])

    def test_the_wide_answer_is_empty_too_then_nothing_is_touched(self):
        touched, notes = decide(Repo(["TRACKER.md"], changed=Fails, wide=[]))
        self.assertEqual(touched, {"website": False, "app": False})

    def test_if_the_wide_answer_fails_too_the_changed_files_are_mapped_to_packages(self):
        # Last resort: the files' packages and every user of them, so the database package's
        # files touch the website here (the wide answer), where the narrow rule wouldn't.
        touched, notes = decide(Repo(FILES_124, changed=Fails, wide=Fails))
        self.assertEqual(touched, {"website": True, "app": False})
        self.assertIn("changed files' packages", notes[0])
        touched, _ = decide(Repo(["TRACKER.md", "docs/brief/product.md", "infra/vercel/firewall.json"], changed=Fails, wide=Fails))
        self.assertEqual(touched, {"website": False, "app": False})
        touched, _ = decide(Repo(["product/app/lib/x.ts"], changed=Fails, wide=Fails))
        self.assertEqual(touched, {"website": False, "app": True})

    def test_the_last_resorts_workspace_list_can_come_from_pnpm(self):
        here = os.getcwd()
        pnpm = [{"name": "hrizzup", "path": here}, {"name": WEBSITE, "path": os.path.join(here, "product/web")}]
        repo = Repo(["product/web/x.ts"], changed=Fails, wide=Fails, workspaces=Fails, pnpm=pnpm)
        self.assertEqual(affected.workspaces(repo), {WEBSITE: "product/web"})

    def test_if_nothing_can_say_what_changed_every_part_counts(self):
        touched, notes = decide(Repo(FILES_124, changed=Fails, wide=Fails, workspaces=Fails))
        self.assertEqual(touched, {"website": True, "app": True})
        self.assertIn("every part counts as affected", notes[0])


class TheRealRepositorysGraph(unittest.TestCase):
    def setUp(self):
        self.found = real_workspaces()
        self.links = affected.graph(self.found, real_read)

    def test_every_workspace_package_is_listed(self):
        for name in (WEBSITE, APP, "@hrizzup/database", "@hrizzup/ledger", "@hrizzup/example-bot", "@hrizzup/agreement"):
            self.assertIn(name, self.found)

    def test_the_database_package_is_outside_both_parts_reach(self):
        for part in (WEBSITE, APP):
            self.assertNotIn("@hrizzup/database", affected.reach(part, self.links), part)

    def test_the_wide_answer_does_count_the_database_package_s_users(self):
        # Why the website counted as touched: markets, perps and ledger list it in devDependencies.
        users = affected.users_of({"@hrizzup/database"}, self.links)
        self.assertEqual(users, set(EVERY_USER_OF_DATABASE))

    def test_the_apps_reach_is_what_it_ships_and_its_tools(self):
        self.assertEqual(
            affected.reach(APP, self.links),
            {APP, "@hrizzup/api", "@hrizzup/core", "@hrizzup/agreement", "@hrizzup/tsconfig"},
        )

    def test_files_map_to_their_innermost_package(self):
        files = ["infra/supabase/migrations/x.sql", "product/packages/perps/src/a.ts", "TRACKER.md", "infra/vercel/firewall.json", "product/web/a/b.ts"]
        self.assertEqual(affected.packages_of(files, self.found), {"@hrizzup/database", "@hrizzup/perps", WEBSITE})
        self.assertEqual(affected.packages_of(["product/webby/x.ts"], self.found), set())

    def test_a_dependency_named_like_a_workspace_package_is_a_link_whatever_version_it_asks_for(self):
        found = {"@a/x": "x", "@a/y": "y", "@a/z": "z"}
        manifests = {
            "x": {"dependencies": {"@a/y": "^1.0.0", "left-pad": "workspace:*"}, "devDependencies": {"@a/z": "latest"}},
            "y": {},
            "z": {},
        }
        # `left-pad` isn't a workspace package, so asking for it with `workspace:` links nothing.
        self.assertEqual(affected.graph(found, manifests.__getitem__)["@a/x"], {"ships": {"@a/y"}, "tools": {"@a/z"}})

    def test_a_part_reaches_its_own_tools_and_what_they_ship_but_not_what_those_use_as_tools(self):
        # web's own devDependency `tool` ships `lib` and has `other` as a devDependency of its own.
        found = {"@hrizzup/web": "web", "@hrizzup/app": "app", "@x/tool": "tool", "@x/lib": "lib", "@x/other": "other"}
        manifests = {
            "web": {"devDependencies": {"@x/tool": "workspace:*"}},
            "app": {},
            "tool": {"dependencies": {"@x/lib": "workspace:*"}, "devDependencies": {"@x/other": "workspace:*"}},
            "lib": {},
            "other": {},
        }
        links = affected.graph(found, manifests.__getitem__)
        self.assertEqual(affected.reach(WEBSITE, links), {WEBSITE, "@x/tool", "@x/lib"})
        for changed, website in (("@x/tool", True), ("@x/lib", True), ("@x/other", False)):
            repo = Repo(["x"], changed=[changed], wide=list(found), workspaces=found)
            touched, _ = affected.decide("base", "head", run=repo, read=manifests.__getitem__, read_turbo=no_tasks)
            self.assertEqual(touched, {"website": website, "app": False}, changed)

    def test_optional_and_peer_links_ship_like_dependencies(self):
        found = {"@a/x": "x", "@a/y": "y", "@a/z": "z"}
        manifests = {"x": {"optionalDependencies": {"@a/y": "workspace:*"}, "peerDependencies": {"@a/z": "workspace:*"}}, "y": {}, "z": {}}
        self.assertEqual(affected.graph(found, manifests.__getitem__)["@a/x"], {"ships": {"@a/y", "@a/z"}, "tools": set()})


class WhatAPackageShipsIsListedUnderItsDependencies(unittest.TestCase):
    """Pins the rule above: a package that uses another workspace package's code at run time must
    list it under `dependencies`, or a change to that package would stop touching it. Everything
    but tests (and the database package's tests folder), scripts, end-to-end tests, test configs
    and type files counts as run time."""

    SKIPPED_FOLDERS = {"node_modules", ".next", ".expo", "dist", "build", "coverage", "android", "ios", "scripts", "e2e", "journeys", "tests"}
    IMPORT = re.compile(r"""\b(?:from|import|require)\s*\(?\s*['"](@hrizzup/[a-z0-9-]+)""")

    def shipped_files(self, folder):
        for root, folders, names in os.walk(os.path.join(REPO, folder)):
            folders[:] = [f for f in folders if f not in self.SKIPPED_FOLDERS]
            for name in names:
                if name.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")) and not re.search(
                    r"\.(test|spec)\.[jt]sx?$|\.d\.ts$|^(vitest|playwright)\.config\.", name
                ):
                    yield os.path.join(root, name)

    def test_every_workspace_import_is_listed_under_dependencies(self):
        found = real_workspaces()
        links = affected.graph(found, real_read)
        problems, scanned = [], 0
        for package, folder in found.items():
            for path in self.shipped_files(folder):
                scanned += 1
                with open(path, encoding="utf-8") as source:
                    for used in set(self.IMPORT.findall(source.read())):
                        if used not in (package, "@hrizzup/tsconfig") and used not in links[package]["ships"]:
                            problems.append(f"{os.path.relpath(path, REPO)} imports {used}, which {package} doesn't list under dependencies")
        self.assertGreater(scanned, 100)  # the scan really read the packages' source
        self.assertEqual(problems, [])


class WhatThePrintsAndWrites(unittest.TestCase):
    def test_main_writes_both_parts_and_says_what_it_did(self):
        with tempfile.TemporaryDirectory() as folder:
            output = os.path.join(folder, "output")
            env = {"GITHUB_OUTPUT": output, "TURBO_SCM_BASE": "base", "TURBO_SCM_HEAD": "head"}
            answer = ({"website": False, "app": True}, ["Changed packages: @hrizzup/app."])
            printed = io.StringIO()
            with mock.patch.dict(os.environ, env), mock.patch.object(affected, "decide", return_value=answer) as decided, contextlib.redirect_stdout(printed):
                affected.main()
            decided.assert_called_once_with("base", "head")
            with open(output) as written:
                self.assertEqual(written.read(), "website=false\napp=true\n")
            self.assertEqual(
                printed.getvalue().splitlines(),
                ["Changed packages: @hrizzup/app.", "The website is not affected by this change.", "The app is affected by this change."],
            )


if __name__ == "__main__":
    unittest.main()
