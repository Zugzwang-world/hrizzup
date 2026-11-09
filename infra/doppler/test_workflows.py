"""Every GitHub job that loads one of hrizzup's configs whole checks its names first: offline,
reading the workflow files only.

    python3 -m unittest discover -s infra/doppler

A job that loads a config with Doppler's action, or asks it for named keys
(`infra/doppler/named_keys.py`), must run `infra/doppler/app_keys.py check <config>` earlier
in the same job, with the same token and under the same condition, so a config holding a name
that isn't allowed there stops the job before the job holds the key (runbook Part 4, "Where
each kind of key lives"). That includes the release pipeline, which loads production's
`prd_release`: its names must be production's app keys or the pipeline's own credentials.
Before a release changes production, the pipeline also reads the names in Vercel's production
settings (`app_keys.py vercel production`); a rollback, which only returns production to an
earlier build that today's settings don't change, skips that one. The pipeline's key checks
come from the workflow's own commit, never from the commit being released or rolled back to.
No check may be let fail (`continue-on-error`). A job that asks for named keys asks only for
the app's keys, and the Screen check for exactly those its tests read.
"""
import os
import re
import unittest

import app_keys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKFLOWS = os.path.join(ROOT, ".github", "workflows")
LOADS = "dopplerhq/secrets-fetch-action"
NAMED = re.compile(r"infra/doppler/named_keys\.py\s+((?:[A-Z][A-Z0-9_]*\s+)+)--")
CHECK = re.compile(r"python3 \"?(?:\$RUNNER_TEMP/key-checks/)?infra/doppler/app_keys\.py\"? check (\w+)")
LOAD_TOKEN = re.compile(r"doppler-token:\s*\$\{\{\s*secrets\.(\w+)\s*\}\}")
CHECK_TOKEN = re.compile(r"DOPPLER_TOKEN:\s*\$\{\{\s*secrets\.(\w+)\s*\}\}")
CONDITION = re.compile(r"^\s+if:\s*(.+?)\s*$", re.M)
KNOWN = {"staging.yml": {"stg"}, "checks.yml": {"stg_preview"}, "release.yml": {"prd_release"}}  # loads today
WEBSITE_TESTS = [os.path.join(ROOT, "product", "web", "e2e"), os.path.join(ROOT, "product", "web", "playwright.config.ts")]
IMPORT = re.compile(r"""(?:from|import)\s*\(?\s*['"](\.{1,2}/[^'"]+)['"]""")
ENV_READ = re.compile(r"""\benv\.([A-Z][A-Z0-9_]*)|\benv\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]""")


def keys_read(starts):
    """The variable names the website's tests read, in their own files and in every module of
    ours they import (relative imports, followed through), such as lib/db.ts's database address."""
    todo, seen, read = list(starts), set(), set()
    while todo:
        file = todo.pop()
        if file in seen:
            continue
        seen.add(file)
        with open(file, encoding="utf-8") as f:
            text = f.read()
        read |= {a or b for a, b in ENV_READ.findall(text)}
        for spec in IMPORT.findall(text):
            path = os.path.normpath(os.path.join(os.path.dirname(file), spec))
            for candidate in (path, path + ".ts", path + ".tsx", path + ".js", os.path.join(path, "index.ts")):
                if os.path.isfile(candidate) and candidate.endswith((".ts", ".tsx", ".js", ".mjs")):
                    todo.append(candidate)
                    break
    return read
CHANGES_PRODUCTION = re.compile(r"name: [3-8][a-z]?\. ")  # the release pipeline's steps 3 to 8, 4a and 4b too
RELEASE_ONLY = "inputs.action == 'release'"


def jobs(text):
    """{job id: [step text, ...]} for one workflow file, by its indentation."""
    found, job, step = {}, None, None
    body = text.split("\njobs:\n", 1)[1] if "\njobs:\n" in text else ""
    for line in body.splitlines():
        start = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if start:
            job, step = start.group(1), None
            found[job] = []
        elif job and re.match(r"^      - ", line):
            found[job].append(line + "\n")
            step = len(found[job]) - 1
        elif job and step is not None and (line.startswith("        ") or not line.strip()):
            found[job][step] += line + "\n"
        elif job and line.strip() and not line.startswith("      "):
            step = None
    return found


def first(pattern, step):
    match = pattern.search(step)
    return match.group(1) if match else None


class EveryJobChecksNamesBeforeLoading(unittest.TestCase):
    def test_each_load_is_preceded_by_the_names_check(self):
        checked = {}
        for file in sorted(os.listdir(WORKFLOWS)):
            if not file.endswith((".yml", ".yaml")):
                continue
            with open(os.path.join(WORKFLOWS, file), encoding="utf-8") as f:
                text = f.read()
            for job, steps in jobs(text).items():
                for i, step in enumerate(steps):
                    if LOADS not in step and not NAMED.search(step):
                        continue
                    with self.subTest(workflow=file, job=job, step=i):
                        token = first(LOAD_TOKEN, step) if LOADS in step else first(CHECK_TOKEN, step)
                        self.assertIsNotNone(token, "a load without a Doppler token from GitHub's secrets")
                        self.assertNotRegex(first(CONDITION, step) or "", r"always\(\)|failure\(\)|cancelled\(\)",
                                            f"{file}, job {job}: a load that could run after its names check failed")
                        self.assertNotIn("continue-on-error", step)
                        guards = [s for s in steps[:i] if CHECK.search(s) and first(CHECK_TOKEN, s) == token]
                        for guard in guards:
                            self.assertNotIn("continue-on-error", guard,
                                             f"{file}, job {job}: a names check may never be let fail")
                        self.assertTrue(guards, f"{file}, job {job}: loads Doppler with {token} "
                                                f"without first running app_keys.py check with it")
                        self.assertIn(first(CONDITION, guards[-1]), (None, first(CONDITION, step)),
                                      f"{file}, job {job}: the names check runs under another condition")
                        checked.setdefault(file, set()).add(first(CHECK, guards[-1]))
        for file, configs in KNOWN.items():  # so the test can't pass by finding nothing
            self.assertLessEqual(configs, checked.get(file, set()), f"{file}: no checked load found")

    def test_named_keys_are_the_app_keys_the_tests_read_and_no_job_loads_stg_preview_whole(self):
        with open(os.path.join(WORKFLOWS, "checks.yml"), encoding="utf-8") as f:
            text = f.read()
        self.assertNotIn(LOADS, text, "the Screen check asks for its keys by name, never the whole config")
        asked = [set(m.group(1).split()) for m in NAMED.finditer(text)]
        self.assertEqual(len(asked), 1, "one named request, the Screen check's")
        app = app_keys.app_keys()
        self.assertLessEqual(asked[0], app)
        starts = []
        for place in WEBSITE_TESTS:
            starts += [place] if os.path.isfile(place) else [
                os.path.join(folder, name) for folder, _, names in os.walk(place) for name in names
                if name.endswith((".ts", ".tsx", ".js", ".mjs"))]
        read = keys_read(starts)
        self.assertEqual(asked[0], read & app, "the Screen check asks for exactly the app keys its tests read")

    def test_the_reader_follows_imports(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            os.makedirs(os.path.join(folder, "e2e"))
            os.makedirs(os.path.join(folder, "lib"))
            with open(os.path.join(folder, "e2e", "a.spec.ts"), "w") as f:
                f.write("import { db } from '../lib/db.ts';\nconst u = process.env.SUPABASE_URL;\n")
            with open(os.path.join(folder, "lib", "db.ts"), "w") as f:
                f.write("export const db = (env = process.env) => env.DATABASE_URL + env['SUPABASE_DB_PASSWORD'];\n")
            self.assertEqual(keys_read([os.path.join(folder, "e2e", "a.spec.ts")]),
                             {"SUPABASE_URL", "DATABASE_URL", "SUPABASE_DB_PASSWORD"})

    def test_the_release_pipeline_reads_vercels_production_names_before_a_release_changes_production(self):
        with open(os.path.join(WORKFLOWS, "release.yml"), encoding="utf-8") as f:
            steps = jobs(f.read())["release"]
        reads = [i for i, step in enumerate(steps) if re.search(r"app_keys\.py\"? vercel production", step)]
        self.assertEqual(len(reads), 1, "release.yml must run `app_keys.py vercel production` once")
        read = steps[reads[0]]
        self.assertNotIn("continue-on-error", read)
        changes = [i for i, step in enumerate(steps) if CHANGES_PRODUCTION.search(step)]
        self.assertGreaterEqual(len(changes), 7, "steps 3, 4a, 4b, 5, 6, 7 and 8")
        self.assertLess(reads[0], min(changes))
        loads = [i for i, step in enumerate(steps) if LOADS in step]
        self.assertGreater(reads[0], loads[0], "it needs the pipeline's Vercel token, loaded with the keys")
        # A release always reads it; a rollback, which only returns production to an earlier build
        # that today's settings don't change, is the one exemption.
        self.assertEqual(first(CONDITION, read), RELEASE_ONLY)
        for i in changes:
            condition = first(CONDITION, steps[i])
            self.assertIn(condition, (RELEASE_ONLY, None), f"step {i} changes production under {condition}")

    def test_the_release_pipelines_key_checks_come_from_its_own_commit(self):
        with open(os.path.join(WORKFLOWS, "release.yml"), encoding="utf-8") as f:
            steps = jobs(f.read())["release"]
        extract = [i for i, step in enumerate(steps)
                   if 'git archive "$WORKFLOW_COMMIT" infra/doppler' in step and "${{ github.sha }}" in step]
        self.assertEqual(len(extract), 1, "the key checks are taken from the workflow's own commit")
        self.assertIsNone(first(CONDITION, steps[extract[0]]), "releases and rollbacks both need them")
        uses = [i for i, step in enumerate(steps) if "app_keys.py" in step and "git archive" not in step]
        self.assertGreaterEqual(len(uses), 2)
        for i in uses:
            self.assertIn('"$RUNNER_TEMP/key-checks/infra/doppler/app_keys.py"', steps[i],
                          "never the checked-out commit's copy, which a rollback makes an older one")
            self.assertGreater(i, extract[0])

    def test_the_reader_finds_jobs_and_steps(self):
        text = ("name: x\njobs:\n  first:\n    steps:\n      - name: a\n        run: one\n"
                "      - uses: b\n        with:\n          c: d\n  second:\n    steps:\n      - run: two\n")
        found = jobs(text)
        self.assertEqual(list(found), ["first", "second"])
        self.assertEqual(len(found["first"]), 2)
        self.assertIn("c: d", found["first"][1])
        self.assertEqual(found["second"], ["      - run: two\n"])


if __name__ == "__main__":
    unittest.main()
