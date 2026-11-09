"""Every GitHub job that loads one of hrizzup's configs whole checks its names first: offline,
reading the workflow files only.

    python3 -m unittest discover -s infra/doppler

A job that loads a config with Doppler's action must run `infra/doppler/app_keys.py check
<config>` earlier in the same job, with the same token and under the same condition, so a
config holding a name that isn't one of the app's keys stops the job before the job holds the
key (runbook Part 4, "Where each kind of key lives"). The release pipeline is the one
exception: it loads production's `prd_release`, which also holds the pipeline's own
credentials and which Claude Code never reads; production's keys are checked by the pipeline
itself (`infra/keys/check.py`).
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKFLOWS = os.path.join(ROOT, ".github", "workflows")
LOADS = "dopplerhq/secrets-fetch-action"
CHECK = re.compile(r"python3 infra/doppler/app_keys\.py check (\w+)")
LOAD_TOKEN = re.compile(r"doppler-token:\s*\$\{\{\s*secrets\.(\w+)\s*\}\}")
CHECK_TOKEN = re.compile(r"DOPPLER_TOKEN:\s*\$\{\{\s*secrets\.(\w+)\s*\}\}")
CONDITION = re.compile(r"^\s+if:\s*(.+?)\s*$", re.M)
LEFT_TO_THE_RELEASE_PIPELINE = {"release.yml"}
KNOWN = {"staging.yml": {"stg"}, "checks.yml": {"stg_preview"}}  # jobs known to load hrizzup today


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
            if not file.endswith((".yml", ".yaml")) or file in LEFT_TO_THE_RELEASE_PIPELINE:
                continue
            with open(os.path.join(WORKFLOWS, file), encoding="utf-8") as f:
                text = f.read()
            for job, steps in jobs(text).items():
                for i, step in enumerate(steps):
                    if LOADS not in step:
                        continue
                    with self.subTest(workflow=file, job=job, step=i):
                        token = first(LOAD_TOKEN, step)
                        self.assertIsNotNone(token, "a load without a Doppler token from GitHub's secrets")
                        guards = [s for s in steps[:i] if CHECK.search(s) and first(CHECK_TOKEN, s) == token]
                        self.assertTrue(guards, f"{file}, job {job}: loads Doppler with {token} "
                                                f"without first running app_keys.py check with it")
                        self.assertIn(first(CONDITION, guards[-1]), (None, first(CONDITION, step)),
                                      f"{file}, job {job}: the names check runs under another condition")
                        checked.setdefault(file, set()).add(first(CHECK, guards[-1]))
        for file, configs in KNOWN.items():  # so the test can't pass by finding nothing
            self.assertLessEqual(configs, checked.get(file, set()), f"{file}: no checked load found")

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
