"""Tests for the Screen check's parts and the joining job (screen_parts.py, checks.yml): offline.

    python3 -m unittest discover -s .github/scripts

The Screen check runs on four machines, "Screen check, part N of 4", and a joining job named
exactly "Screen check" (the name the ruleset requires) that must never pass by being skipped, nor
unless every part passed and the parts' own lists of tests add up: each test run exactly once. So
Quick checks prove, on every pull request:

  - what the joining job decides on made-up records, every way they can go wrong;
  - the joining job's own first step, the real script from checks.yml, run with every result a
    job can have, passes only for exactly `success`;
  - the workflow's shape: one job with the required name, needing the parts, running whatever they
    did, deciding through `env:`; the parts a matrix of four that never fail fast, never skip at
    the job level, and pass `--shard=N/4`; no other job with a required name.

Python's standard library only.
"""
import contextlib
import io
import json
import os
import re
import subprocess
import tempfile
import unittest

import screen_parts

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
WORKFLOWS = os.path.join(os.path.dirname(SCRIPTS), "workflows")
REQUIRED = ["Secret check", "Quick checks", "Database check", "Screen check", "Speed check", "App journeys"]
TESTS = [f"{engine} › journeys/{file}.spec.ts › test {n}"
         for engine in ("chromium", "webkit") for file in ("a", "b") for n in (1, 2, 3)]


def record(part, mine, of=4, website=True, everything=TESTS, times=None):
    return {"part": part, "of": of, "website": website, "all": list(everything), "mine": list(mine),
            "times": times if times is not None else {t: 2.0 for t in mine}}


def four_parts(**kw):
    """A good set of records: the 12 tests dealt out three to each part."""
    return [record(n, TESTS[n - 1::4], **kw) for n in (1, 2, 3, 4)]


def written(records, folder):
    """Records in files as the joining job finds them: each part's artifact in its own sub-folder."""
    for r in records:
        sub = os.path.join(folder, f"screen-part-{r['part']}")
        os.makedirs(sub, exist_ok=True)
        with open(os.path.join(sub, f"part-{r['part']}.json"), "w") as f:
            json.dump(r, f)


class TheRecords(unittest.TestCase):
    def problems(self, records, of=4):
        return screen_parts.add_up(records, of)

    def test_four_parts_that_ran_every_test_once_add_up(self):
        self.assertEqual(self.problems(four_parts()), [])

    def test_a_part_with_no_record_fails_naming_it(self):
        found = self.problems(four_parts()[:3])
        self.assertEqual(len(found), 1)
        self.assertIn("Part 4 left no record", found[0])
        self.assertTrue(self.problems([]))

    def test_a_part_that_left_two_records_fails(self):
        records = four_parts()
        found = self.problems(records + [records[0]])
        self.assertTrue(any("Part 1 left two records" in p for p in found), found)

    def test_a_fifth_part_or_a_part_zero_fails(self):
        for number in (0, 5, "1", None, True):
            with self.subTest(part=number):
                self.assertTrue(self.problems(four_parts()[:3] + [record(number, TESTS[3::4])]))

    def test_records_must_say_how_many_parts_there_are(self):
        records = four_parts()
        records[1]["of"] = 3
        self.assertTrue(any("one of 3 parts, not 4" in p for p in self.problems(records)))
        del records[1]["of"]
        self.assertTrue(self.problems(records))

    def test_parts_that_disagree_about_the_website_fail(self):
        records = four_parts()
        records[2] = {"part": 3, "of": 4, "website": False}
        found = self.problems(records)
        self.assertEqual(len(found), 1)
        self.assertIn("disagree about whether the website was tested", found[0])

    def test_a_record_with_no_website_flag_fails(self):
        records = four_parts()
        del records[0]["website"]
        self.assertTrue(self.problems(records))

    def test_every_part_saying_the_website_wasnt_touched_adds_up(self):
        records = [{"part": n, "of": 4, "website": False} for n in (1, 2, 3, 4)]
        self.assertEqual(self.problems(records), [])
        self.assertFalse(screen_parts.tested(records))
        self.assertTrue(screen_parts.tested(four_parts()))

    def test_a_test_that_ran_in_two_parts_fails_naming_it(self):
        records = four_parts()
        records[1]["mine"].append(records[0]["mine"][0])
        found = self.problems(records)
        self.assertEqual(len(found), 1)
        self.assertIn("1 tests ran in more than one part", found[0])
        self.assertIn(records[0]["mine"][0], found[0])

    def test_a_test_that_ran_in_no_part_fails_naming_it(self):
        records = four_parts()
        left_out = records[3]["mine"].pop()
        found = self.problems(records)
        self.assertEqual(len(found), 1)
        self.assertIn("1 tests ran in no part", found[0])
        self.assertIn(left_out, found[0])

    def test_a_test_nobody_listed_fails_naming_it(self):
        records = four_parts()
        records[0]["mine"].append("chromium › journeys/new.spec.ts › nobody's")
        found = self.problems(records)
        self.assertTrue(any("aren't in the whole list" in p and "nobody's" in p for p in found), found)

    def test_parts_that_saw_different_lists_fail_naming_the_difference(self):
        records = four_parts()
        records[2]["all"] = TESTS[:-1]
        found = self.problems(records)
        self.assertTrue(any("Part 3 saw a different list" in p and TESTS[-1] in p for p in found), found)

    def test_four_records_with_no_tests_at_all_fail_and_never_add_up_to_nothing(self):
        # What a part whose setup broke could write: the check must never pass on zero tests.
        empty = [record(n, [], everything=[]) for n in (1, 2, 3, 4)]
        found = self.problems(empty)
        self.assertEqual(len(found), 1)
        self.assertIn("whole list of tests is empty", found[0])

    def test_a_part_that_names_a_test_twice_fails(self):
        records = four_parts()
        records[0]["mine"] = records[0]["mine"] + records[0]["mine"][:1]
        self.assertTrue(any("names a test twice" in p for p in self.problems(records)))

    def test_lists_that_are_not_lists_of_names_fail(self):
        for bad in (None, "x", [1, 2], {"a": 1}):
            with self.subTest(bad=bad):
                records = four_parts()
                records[0]["mine"] = bad
                self.assertTrue(self.problems(records))

    def test_long_lists_of_names_are_cut_short(self):
        many = [f"chromium › f › t{n}" for n in range(30)]
        found = screen_parts.add_up([record(n, [], everything=many) for n in (1, 2, 3, 4)], 4)
        self.assertEqual(len(found), 1)
        self.assertIn("22 more", found[0])

    def test_a_number_of_parts_below_one_is_no_number_of_parts(self):
        self.assertTrue(screen_parts.add_up([], 0))

    def test_unreadable_files_are_problems_and_never_a_crash(self):
        with tempfile.TemporaryDirectory() as folder:
            written(four_parts(), folder)
            with open(os.path.join(folder, "screen-part-2", "part-2.json"), "w") as f:
                f.write("{ not json")
            with open(os.path.join(folder, "screen-part-1", "other.json"), "w") as f:
                f.write("[1]")
            records, unreadable = screen_parts.read_records(folder)
            self.assertEqual(len(records), 3)
            self.assertEqual(len(unreadable), 2)
            self.assertTrue(screen_parts.add_up(records, 4, unreadable))

    def test_a_missing_folder_is_four_missing_records(self):
        records, unreadable = screen_parts.read_records("/no/such/folder")
        self.assertEqual((records, unreadable), ([], []))
        self.assertEqual(len(screen_parts.add_up(records, 4)), 4)


class TheCommand(unittest.TestCase):
    """The way the workflow runs it: the standard output is for $GITHUB_OUTPUT, so only the
    website's flag goes there; everything people read goes to the error stream."""

    def run_command(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = screen_parts.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_a_good_run_says_so_and_outputs_only_the_flag(self):
        with tempfile.TemporaryDirectory() as folder:
            written(four_parts(), folder)
            code, out, err = self.run_command("add-up", folder, "4")
        self.assertEqual((code, out), (0, "website=true\n"))
        self.assertIn("The 4 parts ran 12 of 12 tests, each exactly once", err)
        self.assertIn("part 1: 3 tests, 6.0 s", err)

    def test_a_bad_run_fails_after_saying_the_website_was_tested(self):
        records = four_parts()
        records[0]["mine"].pop()
        with tempfile.TemporaryDirectory() as folder:
            written(records, folder)
            code, out, err = self.run_command("add-up", folder, "4")
        self.assertEqual((code, out), (1, "website=true\n"))  # so the screenshots are still kept
        self.assertIn("::error title=The Screen check's parts don't add up::1 tests ran in no part", err)

    def test_the_annotation_is_one_line(self):
        records = four_parts()
        records[0]["mine"].pop()
        with tempfile.TemporaryDirectory() as folder:
            written(records, folder)
            _, _, err = self.run_command("add-up", folder, "4")
        annotation = [line for line in err.splitlines() if line.startswith("::error")]
        self.assertEqual(len(annotation), 1)

    def test_parts_that_never_started_fail_and_say_the_website_wasnt_tested(self):
        with tempfile.TemporaryDirectory() as folder:
            code, out, _ = self.run_command("add-up", os.path.join(folder, "nothing"), "4")
        self.assertEqual((code, out), (1, "website=false\n"))

    def test_an_untouched_website_writes_records_that_add_up_with_no_screenshots(self):
        with tempfile.TemporaryDirectory() as folder:
            for part in (1, 2, 3, 4):
                code, out, _ = self.run_command("untouched", os.path.join(folder, f"screen-part-{part}"), str(part), "4")
                self.assertEqual((code, out), (0, ""))
            with open(os.path.join(folder, "screen-part-3", "part-3.json")) as f:
                self.assertEqual(json.load(f), {"part": 3, "of": 4, "website": False})
            code, out, err = self.run_command("add-up", folder, "4")
        self.assertEqual((code, out), (0, "website=false\n"))
        self.assertIn("doesn't touch the website", err)

    def test_one_part_with_nothing_to_test_among_parts_that_tested_fails(self):
        records = four_parts()
        records[1] = {"part": 2, "of": 4, "website": False}
        with tempfile.TemporaryDirectory() as folder:
            written(records, folder)
            code, out, _ = self.run_command("add-up", folder, "4")
        self.assertEqual((code, out), (1, "website=true\n"))

    def test_the_command_line_is_checked(self):
        for args in ([], ["add-up"], ["add-up", "x"], ["add-up", "x", "four"], ["times", "x"], ["wat", "x", "y"],
                     ["untouched", "x", "1"]):
            with self.subTest(args=args), self.assertRaises(SystemExit) as stopped:
                with contextlib.redirect_stderr(io.StringIO()):
                    screen_parts.main(args)
            self.assertNotEqual(stopped.exception.code, 0)


class TheTimes(unittest.TestCase):
    def test_the_parts_seconds_merge_into_the_times_file_shape(self):
        records = four_parts(everything=TESTS)
        records[0]["times"][TESTS[0]] = 3.14159
        merged = screen_parts.merged_times(records, run="123456", today="2026-11-18")
        self.assertEqual(merged["version"], 1)
        self.assertEqual(merged["measured"], "2026-11-18, run 123456")
        self.assertEqual(sorted(merged["times"]), sorted(TESTS))
        self.assertEqual(merged["times"][TESTS[0]], 3.14)
        self.assertEqual(list(merged["times"]), sorted(TESTS))  # in order, so a refresh's diff is small

    def test_only_measured_seconds_above_zero_of_parts_that_tested_are_kept(self):
        records = [record(1, TESTS[:1], times={TESTS[0]: 0.001, TESTS[1]: 0, TESTS[2]: -1, TESTS[3]: "4", TESTS[4]: True}),
                   {"part": 2, "of": 4, "website": False, "times": {TESTS[5]: 9}}]
        self.assertEqual(screen_parts.merged_times(records, today="x")["times"], {TESTS[0]: 0.01})

    def test_each_parts_summed_time_is_printed(self):
        lines, warning = screen_parts.balance(four_parts())
        self.assertEqual(lines, [f"Part {n}: 6.0 s of tests" for n in (1, 2, 3, 4)])
        self.assertIsNone(warning)

    def test_parts_more_than_25_percent_apart_warn_and_say_what_to_do(self):
        records = four_parts()
        records[3]["times"] = {t: 2.5 for t in records[3]["mine"]}  # 7.5 s against 6 s: exactly 25% more
        self.assertIsNone(screen_parts.balance(records)[1])
        records[3]["times"] = {t: 2.6 for t in records[3]["mine"]}  # 7.8 s: more than 25% more
        warning = screen_parts.balance(records)[1]
        self.assertIn("out of balance", warning)
        self.assertIn("product/web/e2e/test-times.json", warning)
        self.assertIn("screen-test-times", warning)

    def test_the_command_writes_the_file_and_prints_the_balance_and_the_warning(self):
        records = four_parts()
        records[0]["times"] = {t: 10.0 for t in records[0]["mine"]}
        with tempfile.TemporaryDirectory() as folder:
            written(records, folder)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(screen_parts.main(["times", folder, os.path.join(folder, "new", "times.json")]), 0)
            with open(os.path.join(folder, "new", "times.json")) as f:
                content = json.load(f)
        self.assertEqual(len(content["times"]), 12)
        self.assertIn("Part 1: 30.0 s of tests", out.getvalue())
        self.assertIn("::warning title=Screen check parts out of balance::", out.getvalue())


def read(file):
    with open(os.path.join(WORKFLOWS, file), encoding="utf-8") as f:
        return f.read()


def jobs(text):
    """{job id: the job's text}, by indentation."""
    body = text.split("\njobs:\n", 1)[1]
    found, job = {}, None
    for line in body.splitlines():
        start = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if start:
            job = start.group(1)
            found[job] = ""
        elif job is not None:
            found[job] += line + "\n"
    return found


def steps(job):
    """[step text, ...] of one job."""
    body = job.split("\n    steps:\n", 1)[1]
    found = []
    for line in body.splitlines():
        if line.startswith("      - "):
            found.append("")
        if found:
            found[-1] += line + "\n"
    return found


def job_name(job):
    match = re.search(r"^    name:\s*(.+?)\s*$", job, re.M)
    return match.group(1) if match else None


def script_of(step):
    """The step's `run:` block, as the shell gets it."""
    lines = step.splitlines()
    start = next(i for i, line in enumerate(lines) if re.match(r"^\s+run:\s*\|\s*$", line))
    indent = len(lines[start]) - len(lines[start].lstrip())
    body = []
    for line in lines[start + 1:]:
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
            break
        body.append(line[indent + 2:] if line.strip() else "")
    return "\n".join(body) + "\n"


class TheJoiningJob(unittest.TestCase):
    def setUp(self):
        self.text = read("checks.yml")
        self.jobs = jobs(self.text)
        self.assertIn("screens", self.jobs)  # so no test can pass by finding nothing
        self.join = self.jobs["screens"]
        self.parts = self.jobs["screen-part"]

    def test_exactly_one_job_is_named_screen_check_and_the_parts_names_differ(self):
        named = [job for job, body in self.jobs.items() if job_name(body) == "Screen check"]
        self.assertEqual(named, ["screens"])
        self.assertEqual(job_name(self.parts), "Screen check, part ${{ matrix.part }} of 4")

    def test_every_required_check_keeps_its_name_once_across_the_workflows(self):
        names = []
        for file in sorted(os.listdir(WORKFLOWS)):
            if file.endswith((".yml", ".yaml")):
                names += [job_name(body) for body in jobs(read(file)).values()]
        for required in REQUIRED:
            with self.subTest(check=required):
                self.assertEqual(names.count(required), 1, f"{required}: exactly one job carries this name")

    def test_the_joining_job_needs_the_parts_and_runs_whatever_they_did(self):
        self.assertRegex(self.join, re.compile(r"^    needs: screen-part\s*$", re.M))
        self.assertRegex(self.join, re.compile(r"^    if: \$\{\{ always\(\) \}\}\s*$", re.M))
        # Never `!cancelled()`: a run cancelled by hand would leave it skipped, which counts as passed.
        self.assertNotIn("cancelled()", self.join.split("\n    steps:\n", 1)[0])

    def test_its_first_step_fails_unless_the_parts_result_is_exactly_success_read_through_env(self):
        first = steps(self.join)[0]
        self.assertIn("if: ${{ always() }}", first)
        self.assertRegex(first, r"env:\n\s+PARTS: \$\{\{ needs\.screen-part\.result \}\}")
        self.assertNotIn("${{", script_of(first), "an expression in a script is text anyone could choose")
        self.assertNotIn("continue-on-error", first)

    def test_that_script_passes_only_for_success(self):
        script = script_of(steps(self.join)[0])
        for result, passes in (("success", True), ("failure", False), ("cancelled", False), ("skipped", False),
                               ("", False), ("Success", False), ("success ", False), ("successful", False)):
            with self.subTest(result=result):
                done = subprocess.run(["bash", "-e", "-c", script], env={**os.environ, "PARTS": result},
                                      capture_output=True, text=True)
                self.assertEqual(done.returncode == 0, passes, done.stdout + done.stderr)
                if not passes:
                    self.assertIn("::error", done.stdout)
        unset = {k: v for k, v in os.environ.items() if k != "PARTS"}
        self.assertNotEqual(subprocess.run(["bash", "-e", "-c", script], env=unset, capture_output=True).returncode, 0)

    def test_the_steps_after_it_run_even_when_it_failed_so_the_records_are_added_up(self):
        for step in steps(self.join)[1:4]:  # the scripts, the records, the add-up
            with self.subTest(step=step.splitlines()[0]):
                self.assertRegex(step, r"if: \$\{\{ always\(\) \}\}\n")

    def test_the_screenshots_are_gathered_and_the_times_kept_only_from_a_good_run(self):
        # The merge deletes the parts' own copies, so a failed attempt must leave them all in place
        # (for the founder, and for a re-run of the failed parts).
        for step in steps(self.join)[4:]:
            with self.subTest(step=step.splitlines()[0]):
                self.assertRegex(step, r"if: \$\{\{ success\(\) && steps\.parts\.outputs\.website == 'true' \}\}\n")
        self.assertEqual(len(steps(self.join)), 7)  # so no step can slip in unchecked

    def test_nothing_in_the_joining_job_or_the_parts_can_be_let_fail(self):
        for name, job in (("the joining job", self.join), ("a part", self.parts)):
            with self.subTest(job=name):
                self.assertNotIn("continue-on-error", job, f"{name}: a check that can't fail isn't one")
        self.assertNotRegex(self.join, r"\|\|", "no `|| true` (or any `||`) after a command of the joining job")

    def test_it_adds_the_records_up_and_keeps_the_one_screenshots_download(self):
        text = "".join(steps(self.join))
        self.assertIn("pattern: screen-part-*", text)
        add_up = next(step for step in steps(self.join) if "screen_parts.py add-up" in step)
        # The exact line, to its end: nothing may follow the command, `|| true` least of all.
        self.assertRegex(add_up, re.compile(
            r'^        run: python3 \.github/scripts/screen_parts\.py add-up "\$RUNNER_TEMP/parts" 4 >> "\$GITHUB_OUTPUT"$', re.M))
        self.assertIn("id: parts", add_up)
        times = next(step for step in steps(self.join) if "screen_parts.py times" in step)
        self.assertRegex(times, re.compile(
            r'^        run: python3 \.github/scripts/screen_parts\.py times "\$RUNNER_TEMP/parts" "\$RUNNER_TEMP/test-times\.json"$', re.M))
        self.assertIn("actions/upload-artifact/merge@", text)
        merge = next(step for step in steps(self.join) if "upload-artifact/merge" in step)
        self.assertRegex(merge, r"name: screenshots\n")
        self.assertIn("pattern: screenshots-part-*", merge)
        self.assertIn("name: screen-test-times", text)

    def test_its_actions_are_the_repositorys_own_pins(self):
        upload = re.search(r"actions/upload-artifact@([0-9a-f]{40})", self.text).group(1)
        self.assertIn(f"actions/upload-artifact/merge@{upload}", self.join)
        self.assertRegex(self.join, r"actions/download-artifact@[0-9a-f]{40}")

    def test_it_asks_for_no_more_rights_than_reading_the_repository(self):
        self.assertRegex(self.join, re.compile(r"^    permissions:\n      contents: read\n    steps:", re.M))
        self.assertNotIn("secrets.", self.join)


class TheScreenParts(unittest.TestCase):
    def setUp(self):
        self.jobs = jobs(read("checks.yml"))
        self.part = self.jobs["screen-part"]

    def test_four_parts_that_never_cancel_one_another(self):
        self.assertRegex(self.part, re.compile(
            r"^    strategy:\n      fail-fast: false\n      matrix:\n        part: \[1, 2, 3, 4\]\n", re.M))

    def test_no_part_is_ever_skipped_at_the_job_level(self):
        self.assertNotRegex(self.part, re.compile(r"^    if:", re.M))
        self.assertNotRegex(self.part, re.compile(r"^    needs:", re.M))

    def test_each_part_runs_its_own_quarter_through_the_one_named_keys_request(self):
        found = re.findall(r"playwright test( [^\n]*)?\n", self.part)
        self.assertEqual(found, [" --shard=${{ matrix.part }}/4"])
        self.assertEqual(self.part.count("python3 ../../infra/doppler/named_keys.py"), 1)
        self.assertNotIn("--pass-with-no-tests", read("checks.yml"))

    def test_each_part_leaves_its_record_and_its_screenshots_under_its_own_names(self):
        self.assertIn("PARTS_OUT: ${{ runner.temp }}/screen-part", self.part)
        self.assertIn('screen_parts.py untouched "$PARTS_OUT" ${{ matrix.part }} 4', self.part)
        self.assertIn("name: screen-part-${{ matrix.part }}", self.part)
        self.assertIn("name: screenshots-part-${{ matrix.part }}", self.part)
        self.assertNotRegex(self.part, r"name: screenshots\n")  # artifacts can't be overwritten: only the join makes it
        record = next(step for step in steps(self.part) if "name: screen-part-${{ matrix.part }}" in step)
        self.assertIn("if: ${{ !cancelled() }}", record)
        self.assertIn("if-no-files-found: ignore", record)
        untouched = next(step for step in steps(self.part) if "screen_parts.py untouched" in step)
        self.assertIn("if: steps.affected.outputs.website != 'true'", untouched)

    def test_a_change_to_the_checks_themselves_still_runs_every_part_everything(self):
        # affected.py (whose checks_changed keeps precedence) decides for each part, as it did for
        # the one machine: unconditionally, and every later step reads its answer.
        decide = next(step for step in steps(self.part) if "scripts/affected.py" in step)
        self.assertNotIn("if:", decide)
        self.assertIn("TURBO_SCM_BASE", decide)
        for step in steps(self.part):
            if "playwright test" in step or "wait_for_preview.py" in step:
                self.assertIn("if: steps.affected.outputs.website == 'true'", step)

    def test_the_number_of_parts_is_four_wherever_it_is_written(self):
        text = read("checks.yml")
        written_as = re.findall(
            r"(?:--shard=\$\{\{ matrix\.part \}\}/|matrix\.part \}\} |add-up \"\$RUNNER_TEMP/parts\" )(\d+)", text)
        self.assertEqual(written_as, ["4", "4", "4"])  # the shard, the untouched record, the add-up


class TheWaitForThePreview(unittest.TestCase):
    def test_it_polls_every_30_seconds_for_the_same_20_minutes(self):
        with open(os.path.join(SCRIPTS, "wait_for_preview.py"), encoding="utf-8") as f:
            text = f.read()
        self.assertIn("POLL_S = 30", text)
        self.assertIn("TIMEOUT_S = 20 * 60", text)
        self.assertIn("time.sleep(POLL_S)", text)


if __name__ == "__main__":
    unittest.main()
