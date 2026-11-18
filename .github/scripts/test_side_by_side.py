"""Tests for the side-by-side trials' helper (side_by_side.py) and the trial jobs in checks.yml: offline.

    python3 -m unittest discover -s .github/scripts

A faster version of a required check runs beside today's one, which stays the required one and stays
exactly as it is. Quick checks prove, on every pull request:

  - what the comparison job does with every combination of results (measure, not measured, broken);
  - the tally, on canned answers from GitHub's API: the newest record of each pull request, the ones
    that aren't counted, what ends the row, a fork's artifact never counted, pages, retries, and
    that the job's token never goes to the address a download redirects to;
  - the workflow's shape: the Speed check on three machines runs after the required Speed check,
    with names that are none of the required ones, the required job unchanged but for its one last
    step, the parts never failing on a budget, the joining step reporting only, the comparison
    never failing on "not clean", and no key anywhere in it.

Python's standard library only.
"""
import contextlib
import http.server
import io
import json
import os
import re
import tempfile
import threading
import unittest
import urllib.error
import zipfile

import side_by_side
from test_screen_parts import REQUIRED, job_name, jobs, read, steps


def zipped(record, name="comparison.json"):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr(name, json.dumps(record))
    return buffer.getvalue()


def record(pr, clean=True, measured=True, baseline=True, commit="abc1234", details=()):
    return {"kind": "speed", "commit": commit, "pr": pr, "measured": measured, "baseline": baseline,
            "clean": clean, "details": list(details)}


class FakeGitHub:
    """What GitHub lists and serves, from a list of (id, created_at, record, extras) and a call count."""

    def __init__(self, entries):
        self.entries = entries
        self.downloads = []

    def artifacts(self, name):
        for number, (created, rec, extra) in enumerate(self.entries, 1):
            yield {"id": number, "created_at": created, "expired": False, **extra,
                   "name": extra.get("name", name)}

    def download(self, artifact_id):
        self.downloads.append(artifact_id)
        rec = self.entries[artifact_id - 1][1]
        return rec if isinstance(rec, bytes) else zipped(rec)


def hub(*pairs, **common):
    """Entries newest-last by time, however listed: (record, extra fields of the artifact)."""
    return FakeGitHub([(f"2026-11-{10 + n:02d}T00:00:00Z", rec, dict(extra, **common))
                       for n, (rec, extra) in enumerate(pairs)])


class TheRecords(unittest.TestCase):
    def test_a_part_with_nothing_to_measure_leaves_its_record(self):
        with tempfile.TemporaryDirectory() as folder:
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(side_by_side.main(["untouched", folder, "2/3"]), 0)
            with open(os.path.join(folder, "untouched.json")) as f:
                self.assertEqual(json.load(f), {"part": 2, "of": 3, "website": False})

    def test_the_command_line_is_checked(self):
        for argv in ([], ["nothing"], ["untouched", "x"], ["untouched", "x", "4/3"], ["untouched", "x", "0/3"],
                     ["untouched", "x", "a/b"], ["speed-plan", "a", "b", "0", "c"], ["speed-plan", "a"],
                     ["tally"], ["tally", "x", "--other", "y"]):
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    side_by_side.main(argv)

    def test_the_pull_requests_number_comes_from_the_environment_or_is_none(self):
        self.assertEqual(side_by_side.pr_number("160"), 160)
        for text in ("", None, "0", "-1", "abc", "1.5"):
            self.assertIsNone(side_by_side.pr_number(text))


class ThePlan(unittest.TestCase):
    def folders(self, parts=("measured",) * 3, one=True):
        root = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(root, ignore_errors=True))
        for number, state in enumerate(parts, 1):
            folder = os.path.join(root, "parts", f"speed-part-{number}")
            os.makedirs(folder)
            if state == "measured":
                with open(os.path.join(folder, "website.json"), "w") as f:
                    f.write("{}")
            elif state == "untouched":
                with open(os.path.join(folder, "untouched.json"), "w") as f:
                    json.dump({"part": number, "of": 3, "website": False}, f)
        os.makedirs(os.path.join(root, "one"))
        if one:
            with open(os.path.join(root, "one", "website.json"), "w") as f:
                f.write("{}")
        return os.path.join(root, "one"), os.path.join(root, "parts"), os.path.join(root, "out")

    def decide(self, one_result="success", parts_result="success", **kw):
        one, parts, _ = self.folders(**kw)
        return side_by_side.speed_plan(one, parts, 3, one_result, parts_result)

    def test_three_parts_and_the_one_machine_results_are_measured(self):
        self.assertEqual(self.decide(), (True, "", []))

    def test_a_change_that_doesnt_touch_the_website_is_not_measured_and_not_an_error(self):
        measure, reason, problems = self.decide(parts=("untouched",) * 3, one=False)
        self.assertEqual((measure, problems), (False, []))
        self.assertIn("doesn't touch the website", reason)

    def test_a_required_check_that_failed_means_the_parts_never_ran_and_nothing_is_measured(self):
        for parts_result in ("skipped", "cancelled", "failure"):
            with self.subTest(parts=parts_result):
                measure, reason, problems = self.decide(one_result="failure", parts_result=parts_result, one=False)
                self.assertEqual((measure, problems), (False, []))
                self.assertIn("required check decides", reason)
                self.assertIn("'failure'", reason)

    def test_a_part_that_failed_means_nothing_is_measured_and_not_an_error(self):
        measure, reason, problems = self.decide(parts_result="failure", parts=("measured", "none", "measured"))
        self.assertEqual((measure, problems), (False, []))
        self.assertIn("parts didn't all finish", reason)

    def test_results_missing_although_every_part_succeeded_are_errors_naming_what(self):
        self.assertEqual(self.decide(parts=("measured", "none", "measured"))[2], ["Part 2 succeeded but left no results"])
        found = self.decide(one=False)[2]
        self.assertEqual(len(found), 1)
        self.assertIn("one-machine check left no results", found[0])

    def test_parts_that_disagree_about_the_website_are_an_error(self):
        found = self.decide(parts=("measured", "untouched", "untouched"))[2]
        self.assertEqual(len(found), 1)
        self.assertIn("disagree", found[0])

    def test_the_command_prints_only_the_flag_and_writes_an_unmeasured_record_when_it_doesnt_measure(self):
        one, parts, out = self.folders(parts=("untouched",) * 3, one=False)
        env = {"ONE_RESULT": "success", "PARTS_RESULT": "success", "COMMIT": "abc1234", "PR_NUMBER": "161"}
        with contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(side_by_side.plan([one, parts, "3", out], env), 0)
        self.assertEqual(printed.getvalue(), "measure=false\n")
        with open(os.path.join(out, "comparison.json")) as f:
            stored = json.load(f)
        self.assertEqual(stored, {"kind": "speed", "commit": "abc1234", "pr": 161, "measured": False,
                                  "baseline": True, "clean": False, "details": [stored["details"][0]]})
        with open(os.path.join(out, "comparison.md")) as f:
            self.assertIn("Not measured, so not counted", f.read())

    def test_the_command_prints_measure_true_and_writes_nothing_when_there_is_something_to_compare(self):
        one, parts, out = self.folders()
        with contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()):
            code = side_by_side.plan([one, parts, "3", out], {"ONE_RESULT": "success", "PARTS_RESULT": "success"})
        self.assertEqual((code, printed.getvalue()), (0, "measure=true\n"))
        self.assertFalse(os.path.exists(out))

    def test_an_error_fails_the_command_and_says_measure_false_with_one_error_line(self):
        one, parts, out = self.folders(parts=("measured", "none", "measured"))
        with contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()) as said:
            code = side_by_side.plan([one, parts, "3", out], {"ONE_RESULT": "success", "PARTS_RESULT": "success"})
        self.assertEqual((code, printed.getvalue()), (1, "measure=false\n"))
        self.assertIn("::error title=The Speed check trial's results are missing::Part 2", said.getvalue())


class TheCount(unittest.TestCase):
    """tally_of: which pull requests count, in what order, and what ends the row."""

    def test_clean_pull_requests_in_a_row_from_the_newest(self):
        found = [record(n) for n in (170, 169, 168, 167, 166, 165)]
        self.assertEqual(side_by_side.tally_of(found), ([170, 169, 168, 167, 166, 165], None, []))

    def test_the_first_that_isnt_clean_ends_the_row_and_nothing_after_it_counts(self):
        bad = record(168, clean=False, details=["/terms: Load: median outside"])
        counted, ended_by, passed_over = side_by_side.tally_of([record(170), record(169), bad, record(167), record(166)])
        self.assertEqual((counted, passed_over), ([170, 169], []))
        self.assertIs(ended_by, bad)

    def test_unmeasured_records_and_records_with_no_baseline_are_passed_over_not_counted_and_dont_end_the_row(self):
        found = [record(170), record(169, measured=False, clean=False), record(168, baseline=False),
                 record(167), record(166, clean=False)]
        counted, ended_by, passed_over = side_by_side.tally_of(found)
        self.assertEqual((counted, passed_over), ([170, 167], [169, 168]))
        self.assertEqual(ended_by["pr"], 166)

    def test_only_the_newest_record_of_a_pull_request_counts(self):
        # #168 failed once, then its next push was clean: clean. #169 was clean, then its next push wasn't.
        found = [record(168, commit="new"), record(168, clean=False, commit="old"),
                 record(169, clean=False, commit="new"), record(169, commit="old")]
        counted, ended_by, _ = side_by_side.tally_of(found)
        self.assertEqual(counted, [168])
        self.assertEqual((ended_by["pr"], ended_by["commit"]), (169, "new"))

    def test_a_pull_request_whose_newest_record_wasnt_measured_isnt_counted_by_an_older_one(self):
        counted, ended_by, passed_over = side_by_side.tally_of(
            [record(168, measured=False, clean=False), record(168, clean=False)])
        self.assertEqual((counted, ended_by, passed_over), ([], None, [168]))

    def test_records_not_from_a_pull_request_or_not_shaped_right_are_skipped(self):
        found = [record(None), record(True), record("168"), {"pr": 5}, {"pr": 6, "measured": True},
                 record(171, clean="yes")]
        counted, ended_by, passed_over = side_by_side.tally_of(found)
        self.assertEqual(counted, [])
        self.assertEqual(passed_over, [5, 6])
        self.assertEqual(ended_by["pr"], 171)  # "yes" is not True: not clean

    def test_nothing_at_all_counts_nothing(self):
        self.assertEqual(side_by_side.tally_of([]), ([], None, []))

    def test_the_line_says_how_many_and_what_the_switch_needs(self):
        self.assertEqual(side_by_side.line_for(0), "0 pull requests in a row clean (the switch needs 5)")
        self.assertEqual(side_by_side.line_for(1), "1 pull request in a row clean (the switch needs 5)")
        self.assertEqual(side_by_side.line_for(5), "5 pull requests in a row clean (the switch needs 5)")


class TheTally(unittest.TestCase):
    """tally(): GitHub's list of artifacts and their downloads, canned."""

    def run_tally(self, github, current=None, limit=side_by_side.MAX_DOWNLOADS):
        return side_by_side.tally(github, "speed-comparison", current, limit)

    def test_five_clean_pull_requests_are_five_whatever_order_github_lists_them_in(self):
        github = hub(*((record(160 + n), {}) for n in range(5)))
        github.entries.reverse()
        text, count = self.run_tally(github)
        self.assertEqual(count, 5)
        self.assertIn("**5 pull requests in a row clean (the switch needs 5)**", text)
        self.assertIn("Counted: #164, #163, #162, #161, #160.", text)

    def test_the_newest_is_read_first_so_a_not_clean_one_stops_the_downloads(self):
        github = hub((record(160), {}), (record(161), {}), (record(162, clean=False, details=["/terms: Load: x"]), {}),
                     (record(163), {}), (record(164), {}))
        text, count = self.run_tally(github)
        self.assertEqual(count, 2)
        self.assertEqual(github.downloads, [5, 4, 3])  # newest first, nothing older read after the break
        self.assertIn("The row ended at #162", text)
        self.assertIn("- /terms: Load: x", text)

    def test_expired_artifacts_artifacts_of_another_name_and_a_forks_are_never_read(self):
        github = hub((record(160), {}), (record(161), {"expired": True}),
                     (record(162), {"name": "something-else"}),
                     (record(163), {"workflow_run": {"repository_id": 1, "head_repository_id": 2}}),
                     (record(164), {"workflow_run": {"repository_id": 1, "head_repository_id": 1}}))
        text, count = self.run_tally(github)
        self.assertEqual(count, 2)
        self.assertIn("Counted: #164, #160.", text)
        self.assertEqual(sorted(github.downloads), [1, 5])

    def test_artifacts_that_are_not_a_readable_record_are_skipped(self):
        github = hub((record(160), {}), (b"not a zip", {}), (zipped({"unrelated": 1}, name="other.json"), {}),
                     (zipped([1, 2]), {}), (record(164), {}))
        self.assertEqual(self.run_tally(github)[1], 2)

    def test_this_runs_own_record_counts_first_even_before_github_lists_it(self):
        github = hub((record(160), {}), (record(161), {}))
        _, count = self.run_tally(github, current=record(162))
        self.assertEqual(count, 3)

    def test_this_runs_own_record_replaces_an_older_one_of_the_same_pull_request(self):
        github = hub((record(160), {}), (record(161, clean=False), {}))
        _, count = self.run_tally(github, current=record(161))
        self.assertEqual(count, 2)
        _, count = self.run_tally(github, current=record(161, clean=False))
        self.assertEqual(count, 0)

    def test_this_runs_own_unmeasured_record_isnt_counted_and_doesnt_end_the_row(self):
        github = hub((record(160), {}))
        text, count = self.run_tally(github, current=record(161, measured=False, clean=False))
        self.assertEqual(count, 1)
        self.assertIn("Not counted, nothing to compare: #161.", text)

    def test_no_records_says_zero(self):
        text, count = self.run_tally(hub())
        self.assertEqual(count, 0)
        self.assertIn("**0 pull requests in a row clean (the switch needs 5)**", text)

    def test_no_more_records_are_read_than_the_limit(self):
        github = hub(*((record(100 + n), {}) for n in range(12)))
        _, count = self.run_tally(github, limit=4)
        self.assertEqual((count, len(github.downloads)), (4, 4))


class TheGitHubClient(unittest.TestCase):
    def test_it_lists_every_page_asking_for_the_name_and_stops_at_a_short_one(self):
        asked = []
        pages = {1: [{"id": n} for n in range(100)], 2: [{"id": n} for n in range(100, 130)]}

        def opener(request, timeout):
            asked.append(request.full_url)
            page = int(re.search(r"[?&]page=(\d+)", request.full_url).group(1))
            return io.BytesIO(json.dumps({"artifacts": pages.get(page, [])}).encode())

        client = side_by_side.GitHub("token", "owner/repo", api="https://example.test", opener=opener)
        self.assertEqual(len(list(client.artifacts("speed-comparison"))), 130)
        self.assertEqual(len(asked), 2)
        self.assertIn("https://example.test/repos/owner/repo/actions/artifacts?name=speed-comparison&per_page=100&page=1", asked[0])

    def test_a_busy_github_is_tried_again_after_a_pause_and_a_refusal_is_not(self):
        pauses, answers = [], [urllib.error.HTTPError("u", 502, "bad gateway", {}, None), OSError("reset"), b"ok"]

        def opener(request, timeout):
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return io.BytesIO(answer)

        client = side_by_side.GitHub("token", "owner/repo", opener=opener)
        self.assertEqual(client.get("https://example.test/x", sleep=pauses.append), b"ok")
        self.assertEqual(pauses, [5, 15])

        def refused(request, timeout):
            raise urllib.error.HTTPError("u", 404, "not found", {}, None)

        with self.assertRaises(urllib.error.HTTPError):
            side_by_side.GitHub("token", "owner/repo", opener=refused).get("https://example.test/x", sleep=pauses.append)
        self.assertEqual(pauses, [5, 15])  # no pause for a 404

        def always_busy(request, timeout):
            raise urllib.error.HTTPError("u", 503, "busy", {}, None)

        with self.assertRaises(urllib.error.HTTPError):
            side_by_side.GitHub("token", "owner/repo", opener=always_busy).get("https://example.test/x", sleep=lambda s: None)

    def test_the_token_goes_to_githubs_api_and_never_to_the_address_a_download_redirects_to(self):
        seen = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                seen[self.path] = self.headers.get("Authorization")
                if self.path.endswith("/zip"):
                    self.send_response(302)
                    self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/storage/blob")
                    self.end_headers()
                else:
                    body = zipped(record(160))
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        client = side_by_side.GitHub("sekrit", "owner/repo", api=f"http://127.0.0.1:{server.server_port}")
        self.assertEqual(side_by_side.record_in(client.download(7)), record(160))
        self.assertEqual(seen["/repos/owner/repo/actions/artifacts/7/zip"], "Bearer sekrit")
        self.assertIsNone(seen["/storage/blob"])


class TheWorkflow(unittest.TestCase):
    """The trial's jobs in checks.yml, read as text."""

    def setUp(self):
        self.text = read("checks.yml")
        self.jobs = jobs(self.text)
        for job in ("speed", "speed-part", "speed-three"):
            self.assertIn(job, self.jobs)  # so no test can pass by finding nothing
        self.speed, self.part, self.three = (self.jobs[j] for j in ("speed", "speed-part", "speed-three"))

    def test_no_trial_job_carries_a_required_name_and_the_required_speed_check_is_still_one_job(self):
        names = {job: job_name(body) for job, body in self.jobs.items()}
        self.assertEqual(names["speed"], "Speed check")
        self.assertEqual(names["speed-part"], "Speed check on three machines, part ${{ matrix.part }} of 3")
        self.assertEqual(names["speed-three"], "Speed check on three machines")
        for job in ("speed-part", "speed-three"):
            self.assertNotIn(names[job], REQUIRED)
        self.assertEqual([job for job, name in names.items() if name == "Speed check"], ["speed"])

    def test_the_required_job_is_what_it_was_but_for_one_new_last_step(self):
        names = [step.splitlines()[0].strip() for step in steps(self.speed)]
        self.assertEqual(names[-1], "- name: The one-machine results, for the trial's comparison")
        before = [name for name in names[:-1]]
        self.assertEqual(before[:4], ["- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
                                      "- uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0",
                                      "- uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0",
                                      "- name: Where pnpm keeps its packages, and main's key for them"])
        self.assertIn("- name: \"Website: prove the check counts other sites' code and embeds\"", before)
        self.assertEqual(before[-2:], ["- name: The numbers on the pull request",
                                       "- name: Lighthouse's reports (the run nearest each page's median)"])
        self.assertEqual(len(names), 18)  # today's 17 steps and the new last one: a step added or taken out shows here
        # The measuring step: today's command, with no share of the pages and no report-only.
        measure = next(step for step in steps(self.speed) if "id: website" in step)
        self.assertRegex(measure, r"\n        run: node e2e/speed-check\.ts\n")
        self.assertNotIn("SPEED_PART", self.speed)
        self.assertNotIn("--report-only", self.speed)
        self.assertNotRegex(self.speed, re.compile(r"^    needs:|^    if:", re.M))

    def test_the_new_last_step_keeps_the_one_machine_results_without_ever_failing_the_required_check(self):
        last = steps(self.speed)[-1]
        self.assertIn("if: ${{ !cancelled() && steps.website.outcome == 'success' }}", last)
        self.assertIn("name: speed-one-machine", last)
        self.assertIn("path: speed-results/website.json", last)
        self.assertIn("retention-days: 7", last)
        self.assertRegex(last, r"actions/upload-artifact@[0-9a-f]{40}")
        self.assertIn("continue-on-error: true", last)  # an upload that fails must never fail "Speed check"

    def test_the_parts_run_after_the_required_check_so_they_add_no_load_while_it_measures(self):
        self.assertRegex(self.part, re.compile(r"^    needs: speed\s*$", re.M))
        self.assertNotRegex(self.part, re.compile(r"^    if:", re.M))

    def test_three_parts_that_never_cancel_one_another(self):
        self.assertRegex(self.part, re.compile(
            r"^    strategy:\n      fail-fast: false\n      matrix:\n        part: \[1, 2, 3\]\n", re.M))
        self.assertEqual(self.part.count("SPEED_PART: ${{ matrix.part }}/3"), 2)  # the measuring, the untouched

    def test_a_part_measures_like_the_required_job_with_its_own_share_and_leaves_its_results_and_nothing_else(self):
        found = re.findall(r"node e2e/speed-check\.ts([^\n]*)\n", self.part)
        self.assertEqual(found, [""])
        measure = next(step for step in steps(self.part) if "node e2e/speed-check.ts" in step)
        self.assertIn("SPEED_PART: ${{ matrix.part }}/3", measure)
        self.assertIn("SPEED_OUT: ${{ runner.temp }}/speed-part", measure)
        self.assertIn("if: ${{ !cancelled() && steps.preview.outcome == 'success' }}", measure)
        for needle in ("affected.py", "wait_for_preview.py", "apparmor_restrict_unprivileged_userns"):
            self.assertIn(needle, self.part)
        for left_out in ("--self-test", "bundle-size", "speed_comment.py", "named_keys.py", "DOPPLER", "id: app"):
            self.assertNotIn(left_out, self.part)
        untouched = next(step for step in steps(self.part) if "side_by_side.py untouched" in step)
        self.assertIn("if: steps.affected.outputs.website != 'true'", untouched)
        self.assertIn('side_by_side.py untouched "$SPEED_OUT" "$SPEED_PART"', untouched)
        upload = next(step for step in steps(self.part) if "name: speed-part-${{ matrix.part }}" in step)
        self.assertIn("if: ${{ !cancelled() }}", upload)
        self.assertIn("if-no-files-found: ignore", upload)
        self.assertIn("retention-days: 7", upload)
        self.assertIn("speed-part/*.json", upload)

    def test_a_part_asks_for_no_more_than_to_read_the_repository_and_find_the_preview(self):
        self.assertRegex(self.part, re.compile(
            r"^    permissions:\n      contents: read\n      deployments: read[^\n]*\n    steps:", re.M))
        self.assertNotIn("pull-requests: write", self.part)
        # The one secret a part holds is the one the required job holds: the previews' bypass.
        self.assertEqual(sorted(set(re.findall(r"secrets\.(\w+)", self.part))), ["VERCEL_AUTOMATION_BYPASS_SECRET"])

    def test_the_comparison_runs_after_everything_whatever_happened_and_never_when_cancelled(self):
        self.assertRegex(self.three, re.compile(r"^    needs: \[speed, speed-part\]\s*$", re.M))
        self.assertRegex(self.three, re.compile(r"^    if: \$\{\{ !cancelled\(\) \}\}\s*$", re.M))
        self.assertRegex(self.three, re.compile(
            r"^    permissions:\n      contents: read\n      actions: read[^\n]*\n    steps:", re.M))
        self.assertNotIn("secrets.", self.three)
        self.assertNotIn("DOPPLER", self.three)

    def test_the_comparison_decides_through_env_what_to_measure_and_joins_and_compares_only_then(self):
        plan = next(step for step in steps(self.three) if "side_by_side.py speed-plan" in step)
        self.assertIn("id: plan", plan)
        self.assertIn("ONE_RESULT: ${{ needs.speed.result }}", plan)
        self.assertIn("PARTS_RESULT: ${{ needs.speed-part.result }}", plan)
        self.assertIn("if: ${{ !cancelled() }}", plan)
        self.assertIn('>> "$GITHUB_OUTPUT"', plan)
        for step in steps(self.three):
            if "node e2e/speed-check.ts" in step:
                self.assertIn("if: ${{ !cancelled() && steps.plan.outputs.measure == 'true' }}", step)
        join = next(step for step in steps(self.three) if "--join" in step)
        # Reporting only: while the trial runs beside the required check, a budget is never a failure.
        self.assertIn("--report-only", join)
        self.assertEqual(len(re.findall(r"speed-part-[123]", join)), 3)
        compare = next(step for step in steps(self.three) if "--compare" in step)
        self.assertNotIn("--report-only", compare)
        self.assertNotIn("continue-on-error", self.three)

    def test_the_comparison_keeps_its_record_for_30_days_and_counts_it_with_the_stored_ones(self):
        upload = next(step for step in steps(self.three) if "name: speed-comparison" in step)
        self.assertIn("if: ${{ !cancelled() }}", upload)
        self.assertIn("retention-days: 30", upload)
        self.assertIn("comparison.json", upload)
        tally = next(step for step in steps(self.three) if "side_by_side.py tally" in step)
        self.assertIn("if: ${{ !cancelled() }}", tally)
        self.assertIn('side_by_side.py tally speed-comparison --current "$OUT/comparison.json" >> "$GITHUB_STEP_SUMMARY"', tally)
        self.assertIn("GITHUB_TOKEN: ${{ github.token }}", tally)
        self.assertLess(steps(self.three).index(upload), steps(self.three).index(tally))

    def test_the_comparison_shows_the_verdicts_and_the_three_machines_table_in_the_summary(self):
        summary = next(step for step in steps(self.three) if "comparison.md" in step)
        self.assertIn("$GITHUB_STEP_SUMMARY", summary)
        self.assertIn("if: ${{ !cancelled() }}", summary)

    def test_only_the_required_job_comments_on_the_pull_request(self):
        self.assertEqual(self.text.count("speed_comment.py"), 1)
        self.assertIn("speed_comment.py", self.speed)
        self.assertNotIn("pull-requests", self.three)

    def test_the_number_of_parts_is_three_wherever_it_is_written_for_the_trial(self):
        written_as = re.findall(r"SPEED_PART: \$\{\{ matrix\.part \}\}/(\d+)", self.text)
        self.assertEqual(written_as, ["3", "3"])
        plan = next(step for step in steps(self.three) if "side_by_side.py speed-plan" in step)
        self.assertRegex(plan, r'speed-plan "\$RUNNER_TEMP/one" "\$RUNNER_TEMP/parts" 3 ')

    def test_the_workflows_other_jobs_are_not_given_the_trial(self):
        for job in ("quick", "database", "screen-part", "screens"):
            self.assertNotIn("speed-one-machine", self.jobs[job])
            self.assertNotIn("SPEED_PART", self.jobs[job])


if __name__ == "__main__":
    unittest.main()
