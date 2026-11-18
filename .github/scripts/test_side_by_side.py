"""Tests for the side-by-side trial's helper (side_by_side.py) and the trial jobs in checks.yml: offline.

    python3 -m unittest discover -s .github/scripts

A faster version of a required check runs beside today's one, which stays the required one and stays
exactly as it is. Quick checks prove, on every pull request:

  - what the comparison job does with every combination of what the jobs before it left (compare,
    nothing to compare, a not-clean record kept because a part or the comparison failed);
  - the tally, on canned answers from GitHub's API: lists read to their end and sorted, a pull request
    with any not-clean record ending the row, stopping at five, the average of the five, the
    40-request budget, no retries, what a fork or main or an expired artifact does, and that the job's
    token never goes to the address a download redirects to;
  - the workflow's shape: the Speed check on three machines runs after the required Speed check
    whatever its result, with names that are none of the required ones, the required job unchanged
    but for its one last step, the parts never failing on a budget, the joining step reporting only,
    the comparison never failing on "not clean" yet never hiding a failing comparison, and no key in it.

Python's standard library only.
"""
import contextlib
import http.client
import http.server
import io
import json
import os
import re
import tempfile
import threading
import unittest
import zipfile

import side_by_side as sbs
from test_screen_parts import REQUIRED, job_name, jobs, read, steps

CLEAN, NOT_CLEAN = sbs.NAMES["speed"]
LIMITS = {"busyMs": 33, "loadMs": 22}


def zipped(record, name="comparison.json"):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr(name, json.dumps(record))
    return buffer.getvalue()


def rec(pr, clean=True, busy=0.0, load=0.0, flip=False, reasons=(), commit="abc1234"):
    return {"kind": "speed", "commit": commit, "pr": pr, "measured": True, "clean": clean, "reasons": list(reasons),
            "pages": [], "averages": {"busyMs": busy, "loadMs": load}, "flip": flip}


def at(n):
    return f"2026-11-{n:02d}T00:00:00Z"


class FakeGitHub:
    """What GitHub lists and serves, from a list of items: {branch, record, created_at, run, ...}. An item
    is in the clean list when its record is clean, unless it says `named` (a name that disagrees)."""

    def __init__(self, items, per_page=100):
        self.items, self.per_page = items, per_page
        self.pages, self.downloads = [], []

    def artifact(self, number, item):
        record = item["record"]
        named = item.get("named") or (CLEAN if isinstance(record, dict) and record.get("clean") is True else NOT_CLEAN)
        return {"id": number, "name": named, "created_at": item["created_at"], "expired": item.get("expired", False),
                "workflow_run": {"id": item.get("run", number), "head_branch": item["branch"],
                                 "repository_id": 1, "head_repository_id": item.get("head", 1)}}

    def page(self, name, number):
        self.pages.append((name, number))
        found = [self.artifact(n, item) for n, item in enumerate(self.items, 1)
                 if self.artifact(n, item)["name"] == name]
        return found[(number - 1) * self.per_page:number * self.per_page]

    def download(self, artifact_id):
        self.downloads.append(artifact_id)
        record = self.items[artifact_id - 1]["record"]
        return record if isinstance(record, bytes) else zipped(record)


def item(branch, record, day, **more):
    return {"branch": branch, "record": record, "created_at": at(day), **more}


class TheRecords(unittest.TestCase):
    def test_a_part_with_nothing_to_measure_leaves_its_record(self):
        with tempfile.TemporaryDirectory() as folder:
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(sbs.main(["untouched", folder, "2/3"]), 0)
            with open(os.path.join(folder, "untouched.json")) as f:
                self.assertEqual(json.load(f), {"part": 2, "of": 3, "website": False})

    def test_the_command_line_is_checked(self):
        for argv in ([], ["nothing"], ["untouched", "x"], ["untouched", "x", "4/3"], ["untouched", "x", "0/3"],
                     ["untouched", "x", "a/b"], ["speed-plan", "a", "b", "0", "c"], ["speed-plan", "a"],
                     ["finalize"], ["finalize", "a", "b"], ["tally"], ["tally", "speed"],
                     ["tally", "other", "--limits", "x"], ["tally", "speed", "--other", "y"],
                     ["tally", "speed", "--limits", "x", "--other", "y"]):
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    sbs.main(argv)

    def test_the_pull_requests_number_comes_from_the_environment_or_is_none(self):
        self.assertEqual(sbs.pr_number("160"), 160)
        for text in ("", None, "0", "-1", "abc", "1.5"):
            self.assertIsNone(sbs.pr_number(text))


class ThePlan(unittest.TestCase):
    ENV = {"PARTS_RESULT": "success", "COMMIT": "abc1234", "PR_NUMBER": "161"}

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

    def plan(self, env=None, **kw):
        one, parts, out = self.folders(**kw)
        with contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()) as said:
            code = sbs.plan([one, parts, "3", out], {**self.ENV, **(env or {})})
        record = None
        if os.path.exists(os.path.join(out, "comparison.json")):
            with open(os.path.join(out, "comparison.json")) as f:
                record = json.load(f)
        return code, printed.getvalue(), said.getvalue(), record, out

    def test_three_parts_and_the_one_machine_numbers_are_measured_and_nothing_is_written(self):
        code, printed, _, record, out = self.plan()
        self.assertEqual((code, printed, record), (0, "measured=true\nmeasure=true\n", None))
        self.assertFalse(os.path.exists(out))

    def test_without_the_speed_checks_numbers_there_is_no_comparison_and_no_record(self):
        for what, kw in (("the website wasn't touched", {"parts": ("untouched",) * 3, "one": False}),
                         ("the Speed check never got to measure", {"parts": ("measured",) * 3, "one": False}),
                         ("the parts failed too", {"parts": ("none",) * 3, "one": False})):
            with self.subTest(what):
                code, printed, said, record, out = self.plan(**kw)
                self.assertEqual((code, printed, record), (0, "measured=false\nmeasure=false\n", None))
                self.assertFalse(os.path.exists(out))
                self.assertIn("nothing to compare", said)

    def test_a_part_that_left_no_results_is_a_not_clean_record_naming_it_and_the_parts_result(self):
        code, printed, said, record, _ = self.plan(env={"PARTS_RESULT": "failure"}, parts=("measured", "none", "none"))
        self.assertEqual((code, printed), (0, "measured=true\nmeasure=false\n"))
        self.assertEqual(record["clean"], False)
        self.assertEqual((record["kind"], record["pr"], record["commit"], record["measured"]), ("speed", 161, "abc1234", True))
        self.assertEqual(record["reasons"], ["Part 2, 3 of the three machines left no results (the parts' result was 'failure')"])
        self.assertIn("Not clean", said)

    def test_parts_that_say_the_website_wasnt_touched_when_the_speed_check_measured_it_are_not_clean(self):
        for parts in (("untouched",) * 3, ("measured", "untouched", "untouched")):
            with self.subTest(parts=parts):
                _, printed, _, record, _ = self.plan(parts=parts)
                self.assertEqual(printed, "measured=true\nmeasure=false\n")
                self.assertFalse(record["clean"])
                self.assertIn("disagree with the Speed check", record["reasons"][0])

    def test_the_record_has_no_pull_request_number_when_the_run_isnt_one(self):
        record = self.plan(env={"PR_NUMBER": ""}, parts=("measured", "none", "measured"))[3]
        self.assertIsNone(record["pr"])


class TheVerdict(unittest.TestCase):
    ENV = {"COMMIT": "abc1234", "PR_NUMBER": "161"}

    def finalize(self, content=None):
        out = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(out, ignore_errors=True))
        if content is not None:
            with open(os.path.join(out, "comparison.json"), "w") as f:
                f.write(content if isinstance(content, str) else json.dumps(content))
        with contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()):
            code = sbs.finalize(out, self.ENV)
        with open(os.path.join(out, "comparison.json")) as f:
            return code, printed.getvalue(), json.load(f), out

    def test_a_record_says_its_verdict_and_is_left_alone(self):
        self.assertEqual(self.finalize(rec(161, clean=True))[:2], (0, "verdict=clean\n"))
        code, printed, record, _ = self.finalize(rec(161, clean=False, reasons=["/: Load: ..."]))
        self.assertEqual((code, printed, record["reasons"]), (0, "verdict=not-clean\n", ["/: Load: ..."]))

    def test_a_comparison_that_errored_and_left_no_record_becomes_a_not_clean_one_so_it_cant_hide_a_push(self):
        for broken in (None, "", "not json", "[1, 2]", {"clean": "yes"}, {"pr": 161}):
            with self.subTest(broken=broken):
                code, printed, record, out = self.finalize(broken)
                self.assertEqual((code, printed), (0, "verdict=not-clean\n"))
                self.assertEqual((record["clean"], record["pr"], record["commit"]), (False, 161, "abc1234"))
                self.assertEqual(record["reasons"], ["the comparison failed"])
                with open(os.path.join(out, "comparison.md")) as f:
                    self.assertIn("the comparison failed", f.read())


class TheRow(unittest.TestCase):
    """tally(): GitHub's lists and downloads, canned."""

    def tally(self, github, **kw):
        return sbs.tally(github, "speed", LIMITS, **kw)

    def clean_prs(self, count, **more):
        return [item(f"pr-{n}", rec(100 + n), 10 + n, **more) for n in range(count)]

    def test_five_clean_pull_requests_count_whatever_order_github_lists_them_in(self):
        items = self.clean_prs(5)
        items.reverse()
        text, count, capped = self.tally(FakeGitHub(items))
        self.assertEqual((count, capped), (5, False))
        self.assertIn("**5 pull requests in a row clean (the switch needs 5)**", text)
        self.assertIn("Counted: `pr-4`, `pr-3`, `pr-2`, `pr-1`, `pr-0`.", text)  # newest first

    def test_a_list_is_read_to_its_end_a_page_at_a_time_and_sorted_by_time_here(self):
        # Seven clean and three not clean, listed out of order, three to a page: pages 1 to 3 and 1 to 2.
        items = [item(f"b{n}", rec(n), (n * 7) % 11 + 1) for n in range(7)]
        items += [item(f"c{n}", rec(50 + n, clean=False), 20 + n) for n in range(3)]
        github = FakeGitHub(items, per_page=3)
        text, count, _ = self.tally(github)
        self.assertEqual(github.pages, [(CLEAN, 1), (CLEAN, 2), (CLEAN, 3), (NOT_CLEAN, 1), (NOT_CLEAN, 2)])
        self.assertEqual(count, 0)  # the newest, c2, isn't clean
        self.assertIn("The row ended at `c2`", text)

    def test_a_list_that_ends_on_a_full_page_asks_for_the_next_page_too(self):
        github = FakeGitHub(self.clean_prs(3), per_page=3)
        self.tally(github)
        self.assertEqual(github.pages, [(CLEAN, 1), (CLEAN, 2), (NOT_CLEAN, 1)])

    def test_a_pull_request_with_any_not_clean_record_ends_the_row_even_if_a_later_push_was_clean(self):
        items = [item("pr-new", rec(170), 15), item("pr-mid", rec(169), 14), item("pr-mid", rec(169, clean=False), 13),
                 item("pr-old", rec(168), 12)]
        text, count, _ = self.tally(FakeGitHub(items))
        self.assertEqual(count, 1)  # pr-new counts; pr-mid has an older not-clean record: it ends the row
        self.assertIn("The row ended at `pr-mid`", text)
        self.assertIn("Counted: `pr-new`.", text)
        self.assertNotIn("pr-old", text)

    def test_the_not_clean_record_that_ended_the_row_is_read_and_named_with_its_reasons_and_a_flip(self):
        bad = rec(169, clean=False, flip=True, reasons=["/: Busy time (blocking): fails on one machine (255 ms)"])
        github = FakeGitHub([item("pr-new", rec(170), 15), item("pr-bad", bad, 14)])
        text, count, _ = self.tally(github)
        self.assertEqual(count, 1)
        self.assertIn("for #169", text)
        self.assertIn("a budget passes on three machines that fails on one", text)
        self.assertIn("- /: Busy time (blocking): fails on one machine (255 ms)", text)
        self.assertEqual(github.downloads, [2])  # only that one record was read

    def test_it_stops_at_five_and_reads_every_record_of_those_five_and_no_other(self):
        items = self.clean_prs(7)
        items.insert(0, item("pr-3", rec(103), 30))  # a second record of one of the counted pull requests
        github = FakeGitHub(items)
        text, count, _ = self.tally(github)
        self.assertEqual(count, 5)
        counted = {f"pr-{n}" for n in (6, 5, 4, 3, 2)}
        self.assertEqual({github.items[i - 1]["branch"] for i in github.downloads}, counted)
        self.assertEqual(len(github.downloads), 6)
        self.assertNotIn("pr-1", text)

    def test_the_five_comparison_average_is_each_pull_requests_own_mean_then_the_mean_of_the_five(self):
        # One pull request has three records (busy +45, +45, +45), the other four have one each (busy 0):
        # weighted by pull request the mean is 9 ms; by record it would be 19.3 ms (outside 33? no: inside).
        items = [item("pr-a", rec(1, busy=45.0, load=10.0), 20), item("pr-a", rec(1, busy=45.0, load=10.0), 19),
                 item("pr-a", rec(1, busy=45.0, load=10.0), 18)]
        items += [item(f"pr-{n}", rec(10 + n, busy=0.0, load=0.0), 10 + n) for n in range(4)]
        text, count, _ = self.tally(FakeGitHub(items))
        self.assertEqual(count, 5)
        self.assertIn("busy +9.0 ms (limit +/-33 ms), load +2.0 ms (limit +/-22 ms): **within its limits**", text)

    def test_an_average_outside_the_limits_says_so_and_names_the_numbers(self):
        for field, value in (("busy", 40.0), ("load", -25.0)):
            items = [item(f"pr-{n}", rec(10 + n, **{field: value}), 10 + n) for n in range(5)]
            text, count, _ = self.tally(FakeGitHub(items))
            self.assertEqual(count, 5)
            self.assertIn("**outside its limits:** " + ("busy time" if field == "busy" else "load") + ".", text, field)
            self.assertNotIn("within its limits", text)
        both = [item(f"pr-{n}", rec(10 + n, busy=40.0, load=-25.0), 10 + n) for n in range(5)]
        self.assertIn("**outside its limits:** busy time and load.", self.tally(FakeGitHub(both))[0])

    def test_a_limit_is_inside_at_exactly_the_limit_and_the_sign_doesnt_matter(self):
        items = [item(f"pr-{n}", rec(10 + n, busy=-33.0, load=22.0), 10 + n) for n in range(5)]
        self.assertIn("**within its limits**", self.tally(FakeGitHub(items))[0])

    def test_a_branch_whose_records_carry_two_pull_request_numbers_is_reported_and_the_average_isnt_checked(self):
        items = self.clean_prs(5)
        items.append(item("pr-2", rec(999), 5))  # an old record under the same branch name: another pull request
        text, count, _ = self.tally(FakeGitHub(items))
        self.assertEqual(count, 5)
        self.assertIn("carry two pull request numbers: #102 and #999", text)
        self.assertIn("can't be checked this run", text)

    def test_a_record_that_cant_be_read_is_reported_and_the_average_isnt_checked(self):
        for bad in (b"not a zip", zipped({"unrelated": 1}, name="other.json"), zipped([1]), zipped(rec(0)),
                    zipped({**rec(104), "averages": {"busyMs": "1", "loadMs": 2}}), zipped({**rec(104), "kind": "app"})):
            with self.subTest(bad=bad[:12]):
                items = self.clean_prs(4) + [item("pr-bad", {**rec(104), "clean": True}, 5)]
                items[-1]["record"] = bad
                items[-1]["named"] = CLEAN
                text, count, _ = self.tally(FakeGitHub(items))
                self.assertEqual(count, 5)
                self.assertIn("can't be read", text)

    def test_fewer_than_five_counts_what_there_is_and_never_looks_at_the_averages(self):
        github = FakeGitHub(self.clean_prs(3))
        text, count, _ = self.tally(github)
        self.assertEqual(count, 3)
        self.assertIn("**3 pull requests in a row clean (the switch needs 5)**", text)
        self.assertEqual(github.downloads, [])
        self.assertNotIn("average", text)
        self.assertIn("**0 pull requests in a row clean", self.tally(FakeGitHub([]))[0])
        self.assertIn("**1 pull request in a row clean", self.tally(FakeGitHub(self.clean_prs(1)))[0])

    def test_expired_artifacts_main_a_forks_and_another_name_are_never_counted(self):
        items = [item("pr-a", rec(1), 20), item("pr-exp", rec(2, clean=False), 19, expired=True),
                 item("main", rec(3, clean=False), 18), item("pr-fork", rec(4, clean=False), 17, head=2),
                 item("pr-other", rec(5, clean=False), 16, named="something-else")]
        text, count, _ = self.tally(FakeGitHub(items))
        self.assertEqual(count, 1)
        self.assertNotIn("The row ended", text)

    def test_the_trials_own_pull_requests_runs_are_never_counted_nor_do_they_end_the_row(self):
        own = sbs.M75_BRANCH
        self.assertEqual(own, "claude/r6-r4-m7-5-speed-split")
        items = [item(own, rec(159, clean=False), 30), item(own, rec(159), 29)] + self.clean_prs(2)
        github = FakeGitHub(items)
        text, count, _ = self.tally(github)
        self.assertEqual(count, 2)  # its not-clean record neither ended the row nor was counted
        self.assertNotIn(own, text)
        self.assertNotIn("The row ended", text)
        # Its own run's record is left out too, clean or not, and the other pull requests still count.
        for record in (rec(159), rec(159, clean=False)):
            text, count, _ = self.tally(FakeGitHub(self.clean_prs(2)), current=record, branch=own, run_id=777)
            self.assertEqual(count, 2)
            self.assertNotIn(own, text)
        # It is only that branch: another branch with the same kind of record counts as usual.
        other = self.tally(FakeGitHub([item("claude/r6-r4-m7-6-app", rec(160, clean=False), 30)]))
        self.assertEqual(other[1], 0)
        self.assertIn("The row ended at `claude/r6-r4-m7-6-app`", other[0])

    def test_this_runs_own_record_counts_before_the_list_shows_it(self):
        github = FakeGitHub(self.clean_prs(2))
        text, count, _ = self.tally(github, current=rec(200), branch="pr-now", run_id=777)
        self.assertEqual(count, 3)
        self.assertIn("Counted: `pr-now`, `pr-1`, `pr-0`.", text)

    def test_this_runs_own_not_clean_record_ends_the_row_at_once_without_a_download(self):
        github = FakeGitHub(self.clean_prs(4))
        text, count, _ = self.tally(github, current=rec(200, clean=False, reasons=["/: Load: ..."]),
                                    branch="pr-now", run_id=777)
        self.assertEqual(count, 0)
        self.assertIn("The row ended at `pr-now`", text)
        self.assertIn("- /: Load: ...", text)
        self.assertEqual(github.downloads, [])

    def test_when_the_list_already_shows_this_runs_record_it_is_not_counted_twice(self):
        same = item("pr-now", rec(200, busy=30.0), 25, run=777)
        github = FakeGitHub([same] + self.clean_prs(4))
        text, count, _ = self.tally(github, current=rec(200, busy=30.0), branch="pr-now", run_id=777)
        self.assertEqual(count, 5)
        self.assertEqual(len(github.downloads), 4)  # the current one is read from this run, not downloaded
        self.assertIn("busy +6.0 ms", text)  # (30 + 0 + 0 + 0 + 0) / 5

    def test_a_rerun_cant_make_a_pull_request_look_clean_an_earlier_attempts_not_clean_record_stays(self):
        # The same run (777) left a not-clean record on the list; its re-run is clean. The list keeps the
        # earlier record, so the pull request is not clean here, as it will be in every later tally.
        earlier = item("pr-now", rec(200, clean=False, reasons=["/: Load: ..."]), 20, run=777)
        github = FakeGitHub([earlier] + self.clean_prs(4))
        text, count, _ = self.tally(github, current=rec(200), branch="pr-now", run_id=777)
        self.assertEqual(count, 0)
        self.assertIn("The row ended at `pr-now`", text)
        self.assertIn("- /: Load: ...", text)

    def test_a_clean_pull_requests_record_from_an_earlier_push_still_counts_with_the_current_one(self):
        github = FakeGitHub([item("pr-now", rec(200), 20, run=5)] + self.clean_prs(3))
        _, count, _ = self.tally(github, current=rec(200), branch="pr-now", run_id=777)
        self.assertEqual(count, 4)

    def test_a_run_that_left_no_record_is_just_the_stored_ones(self):
        self.assertEqual(self.tally(FakeGitHub(self.clean_prs(2)), current=None, branch="pr-now", run_id=1)[1], 2)

    def test_the_budget_is_40_requests_and_a_list_that_runs_it_out_says_at_least(self):
        self.assertEqual(sbs.MAX_REQUESTS, 40)
        # Fifteen pages a name and ten records is the most a real tally reads before the average; a smaller
        # budget shows what a list that runs out does.
        github = FakeGitHub([item(f"pr-{n}", rec(n), (n % 28) + 1) for n in range(100)], per_page=1)
        text, count, capped = self.tally(github, budget=sbs.Requests(6))
        self.assertTrue(capped)
        self.assertEqual(len(github.pages) + len(github.downloads), 6)
        self.assertIn("**At least ", text)
        self.assertIn("40 requests", text)

    def test_the_budget_also_bounds_the_records_read_for_the_average(self):
        items = []
        for n in range(5):  # five pull requests of ten records each: 50 downloads wanted
            items += [item(f"pr-{n}", rec(10 + n), 10 + n) for _ in range(10)]
        github = FakeGitHub(items)
        text, count, capped = self.tally(github)
        self.assertEqual((count, capped), (5, False))
        self.assertLessEqual(len(github.pages) + len(github.downloads), 40)
        self.assertIn("can't be checked this run", text)
        self.assertIn("ran out before every record was read", text)

    def test_the_request_budget_counts_every_request(self):
        budget = sbs.Requests(2)
        budget.take()
        budget.take()
        with self.assertRaises(sbs.OverBudget):
            budget.take()

    def test_a_branch_name_cant_break_the_summarys_layout(self):
        text, _, _ = self.tally(FakeGitHub([item("a`b|c d\n# x", rec(1), 10)]))
        self.assertNotIn("a`b", text)
        self.assertNotIn("\n# x", text)


class TheGitHubClient(unittest.TestCase):
    def serve(self, artifacts=(), zips=None, status=200):
        """A local stand-in for GitHub's API: lists `artifacts`, serves `zips` by id behind a redirect to a
        storage address of its own, answers `status` to the list when it isn't 200, and remembers the
        Authorization header of every request."""
        seen, zips = [], zips or {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                seen.append((self.path.split("?")[0], self.headers.get("Authorization")))
                found = re.search(r"/artifacts/(\d+)/zip$", self.path)
                if found:
                    self.send_response(302)
                    self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/storage/{found.group(1)}")
                    self.end_headers()
                    return
                stored = re.search(r"/storage/(\d+)$", self.path)
                if status != 200 and not stored:
                    self.send_response(status)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                body = zips[int(stored.group(1))] if stored else json.dumps({"artifacts": list(artifacts)}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        return f"http://127.0.0.1:{server.server_port}", seen

    def test_a_page_asks_for_the_name_and_the_page_and_is_one_request(self):
        asked = []

        def opener(request, timeout):
            asked.append(request.full_url)
            return io.BytesIO(json.dumps({"artifacts": [{"id": 1}]}).encode())

        client = sbs.GitHub("token", "owner/repo", api="https://example.test", opener=opener)
        self.assertEqual(client.page(CLEAN, 3), [{"id": 1}])
        self.assertEqual(asked, [f"https://example.test/repos/owner/repo/actions/artifacts?name={CLEAN}&per_page=100&page=3"])

    def test_the_token_goes_to_githubs_api_and_never_to_the_address_a_download_redirects_to(self):
        api, seen = self.serve(zips={7: zipped(rec(160))})
        client = sbs.GitHub("sekrit", "owner/repo", api=api)
        self.assertEqual(sbs.record_in(client.download(7)), rec(160))
        self.assertEqual(seen, [("/repos/owner/repo/actions/artifacts/7/zip", "Bearer sekrit"), ("/storage/7", None)])

    def test_a_refusal_or_a_server_error_is_never_retried_and_the_tally_says_so_and_exits_zero(self):
        listed = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(listed, ignore_errors=True))
        limits = os.path.join(listed, "allowances.json")
        with open(limits, "w") as f:
            json.dump({"fiveComparisonAverage": LIMITS}, f)
        for status in (403, 429, 500, 502, 404):
            with self.subTest(status=status):
                api, seen = self.serve(status=status)
                env = {"GITHUB_TOKEN": "sekrit", "GITHUB_REPOSITORY": "owner/repo", "GITHUB_API_URL": api}
                with contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()) as said:
                    code = sbs.run_tally(["speed", "--limits", limits], env)
                self.assertEqual(code, 0)
                self.assertEqual(len(seen), 1, "one request, no retry")
                self.assertIn("Tally unavailable this run", printed.getvalue())
                self.assertIn(f"{status}", said.getvalue())
                self.assertNotIn("sekrit", printed.getvalue() + said.getvalue())

    def test_an_answer_that_isnt_a_list_of_artifacts_is_unavailable_not_a_crash(self):
        listed = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(listed, ignore_errors=True))
        limits = os.path.join(listed, "allowances.json")
        with open(limits, "w") as f:
            json.dump({"fiveComparisonAverage": LIMITS}, f)
        for body in ("[]", '"text"', "null", '{"artifacts": "no"}', '{"artifacts": [1, 2]}', "not json", ""):
            with self.subTest(body=body):
                def opener(request, timeout, body=body):
                    return io.BytesIO(body.encode())

                client = sbs.GitHub("token", "owner/repo", opener=opener)
                with self.assertRaises(sbs.Unavailable):
                    client.page(CLEAN, 1)
        # And through the command: a 200 that isn't an object ends as "unavailable", with exit 0.
        for body in (b"[]", b'{"artifacts": [null]}'):
            with self.subTest(command=body):
                api, seen = self.serve_body(body)
                env = {"GITHUB_TOKEN": "sekrit", "GITHUB_REPOSITORY": "owner/repo", "GITHUB_API_URL": api}
                with contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(sbs.run_tally(["speed", "--limits", limits], env), 0)
                self.assertIn("Tally unavailable this run", printed.getvalue())

    def test_a_download_that_breaks_off_mid_read_is_unavailable_too(self):
        class Broken:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                raise http.client.IncompleteRead(b"par", 100)

        client = sbs.GitHub("token", "owner/repo", opener=lambda request, timeout: Broken())
        with self.assertRaises(sbs.Unavailable):
            client.download(5)

        def reset(request, timeout):
            raise ConnectionResetError("reset")

        with self.assertRaises(sbs.Unavailable):
            sbs.GitHub("token", "owner/repo", opener=reset).page(CLEAN, 1)

    def test_a_download_that_fails_after_five_are_counted_leaves_the_count_and_says_the_average_cant_be_checked(self):
        class Failing(FakeGitHub):
            def download(self, artifact_id):
                raise sbs.Unavailable("URLError")

        text, count, _ = sbs.tally(Failing([item(f"pr-{n}", rec(10 + n), 10 + n) for n in range(5)]), "speed", LIMITS)
        self.assertEqual(count, 5)
        self.assertIn("**The five-comparison average can't be checked this run:** GitHub didn't answer.", text)

    def serve_body(self, body):
        """A local server that answers every request 200 with these bytes."""
        seen = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                seen.append(self.path)
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        return f"http://127.0.0.1:{server.server_port}", seen

    def test_a_server_that_isnt_there_is_unavailable_too(self):
        client = sbs.GitHub("token", "owner/repo", api="http://127.0.0.1:1")
        with self.assertRaises(sbs.Unavailable):
            client.page(CLEAN, 1)

    def test_the_command_counts_from_githubs_list_the_limits_file_and_this_runs_own_record(self):
        def artifact(n, name, day):
            return {"id": n, "name": name, "created_at": at(day), "expired": False,
                    "workflow_run": {"id": n, "head_branch": f"pr-{n}", "repository_id": 1, "head_repository_id": 1}}

        listed = [artifact(n, CLEAN, 10 + n) for n in (1, 2, 3)]
        api, seen = self.serve(listed, {n: zipped(rec(100 + n)) for n in (1, 2, 3)})
        with tempfile.TemporaryDirectory() as folder:
            limits = os.path.join(folder, "allowances.json")
            with open(limits, "w") as f:
                json.dump({"fiveComparisonAverage": LIMITS}, f)
            current = os.path.join(folder, "comparison.json")
            with open(current, "w") as f:
                json.dump(rec(200), f)
            env = {"GITHUB_TOKEN": "sekrit", "GITHUB_REPOSITORY": "owner/repo", "GITHUB_API_URL": api,
                   "BRANCH": "pr-now", "GITHUB_RUN_ID": "777"}
            with contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()) as said:
                self.assertEqual(sbs.run_tally(["speed", "--limits", limits, "--current", current], env), 0)
            self.assertIn("**4 pull requests in a row clean (the switch needs 5)**", printed.getvalue())
            self.assertEqual(said.getvalue().strip(), "4 pull requests in a row clean (the switch needs 5)")
            # No record of this run (its plan found nothing to compare): the stored ones still count.
            env.pop("BRANCH")
            with contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()):
                sbs.run_tally(["speed", "--limits", limits, "--current", os.path.join(folder, "missing.json")], env)
            self.assertIn("**3 pull requests in a row clean", printed.getvalue())
        self.assertTrue(all(auth == "Bearer sekrit" for path, auth in seen if path.startswith("/repos")))

    def test_the_limits_file_must_have_the_five_comparison_limits(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "allowances.json")
            for content in (None, "[]", {"fiveComparisonAverage": {"busyMs": 33}}, {"fiveComparisonAverage": []}):
                if content is not None:
                    with open(path, "w") as f:
                        json.dump(content, f)
                with self.subTest(content=content), self.assertRaises(SystemExit):
                    sbs.read_limits(path)
            with open(path, "w") as f:
                json.dump({"fiveComparisonAverage": LIMITS}, f)
            self.assertEqual(sbs.read_limits(path), LIMITS)


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

    def test_the_required_job_is_what_it_was_but_for_one_new_last_step_and_has_no_needs(self):
        names = [step.splitlines()[0].strip() for step in steps(self.speed)]
        self.assertEqual(names[-1], "- name: The one-machine numbers, for the three-machine comparison")
        before = names[:-1]
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

    def test_the_new_last_step_keeps_the_one_machine_numbers_whenever_the_check_measured_and_never_fails_it(self):
        last = steps(self.speed)[-1]
        self.assertIn("if: ${{ !cancelled() && (steps.website.outcome == 'success' || steps.website.outcome == 'failure') }}", last)
        self.assertIn("timeout-minutes: 2", last)
        self.assertIn("continue-on-error: true", last)  # an upload that fails must never fail "Speed check"
        self.assertRegex(last, r"actions/upload-artifact@[0-9a-f]{40}")
        self.assertIn("name: speed-one-machine", last)
        self.assertIn("path: speed-results/website.json", last)
        self.assertIn("if-no-files-found: ignore", last)
        self.assertIn("retention-days: 7", last)

    def test_the_parts_run_after_the_required_check_whatever_its_result_but_never_when_cancelled(self):
        self.assertRegex(self.part, re.compile(r"^    needs: speed\s*$", re.M))
        self.assertRegex(self.part, re.compile(r"^    if: \$\{\{ !cancelled\(\) \}\}\s*$", re.M))

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
        self.assertIn("PARTS_RESULT: ${{ needs.speed-part.result }}", plan)
        self.assertNotIn("${{", re.search(r"\n        run: (.*)\n", plan).group(1))
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

    def test_the_comparison_keeps_a_record_even_when_it_failed_and_names_the_verdict_in_the_artifact(self):
        record = next(step for step in steps(self.three) if "side_by_side.py finalize" in step)
        self.assertIn("id: record", record)
        self.assertIn("if: ${{ always() && steps.plan.outputs.measured == 'true' }}", record)
        self.assertIn('finalize "$RUNNER_TEMP/speed-comparison" >> "$GITHUB_OUTPUT"', record)
        upload = next(step for step in steps(self.three) if "name: speed-comparison-" in step)
        self.assertIn("name: speed-comparison-${{ steps.record.outputs.verdict }}", upload)
        self.assertIn("if: ${{ always() && steps.record.outputs.verdict != '' }}", upload)
        self.assertIn("retention-days: 30", upload)
        self.assertIn("comparison.json", upload)
        order = steps(self.three)
        compare = next(step for step in order if "--compare" in step)
        self.assertLess(order.index(compare), order.index(record))
        self.assertLess(order.index(record), order.index(upload))

    def test_the_artifact_names_are_the_ones_the_tally_reads(self):
        # The upload's name is `speed-comparison-` and the verdict the finalize step prints (TheVerdict),
        # and the tally reads exactly those two names.
        self.assertEqual((CLEAN, NOT_CLEAN), ("speed-comparison-clean", "speed-comparison-not-clean"))
        self.assertEqual(sbs.NAMES["speed"], tuple(f"speed-comparison-{verdict}" for verdict in ("clean", "not-clean")))

    def test_the_tally_reads_the_limits_from_the_allowances_file_and_counts_this_runs_record(self):
        tally = next(step for step in steps(self.three) if "side_by_side.py tally" in step)
        self.assertIn("if: ${{ !cancelled() }}", tally)
        self.assertIn('side_by_side.py tally speed --limits product/web/e2e/speed-allowances.json '
                      '--current "$OUT/comparison.json" >> "$GITHUB_STEP_SUMMARY"', tally)
        self.assertIn("GITHUB_TOKEN: ${{ github.token }}", tally)
        self.assertIn("BRANCH: ${{ github.head_ref }}", tally)
        self.assertNotIn("${{", re.search(r"\n        run: (.*)\n", tally).group(1))
        self.assertLess(steps(self.three).index(next(s for s in steps(self.three) if "name: speed-comparison-" in s)),
                        steps(self.three).index(tally))

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
