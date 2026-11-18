"""Tests for App journeys' side-by-side trial (side_by_side.py's App part, app-journeys.yml): offline.

    python3 -m unittest discover -s .github/scripts

App journeys' two sizes run on two machines beside the required "App journeys", which stays as it is
(.github/workflows/app-journeys.yml: "App journeys on two machines, phone" and ", tablet", and a job that
compares the two ways). Quick checks prove, on every pull request:

  - the comparison, on made-up Maestro reports and cold-start files: clean only when every flow passed
    on both sides at both sizes with the same names, the cold-start verdicts are equal and the two
    medians are within the allowance; every way to be not clean; `flip` only for "two machines pass,
    one fails"; a side that left nothing is not clean;
  - the plan: no record without the one-machine cold start or without main's two-machine baseline;
  - the tally's App journeys records, on canned answers from GitHub's API (the shared rules are tested
    with the Speed check's records in test_side_by_side.py): five in a row, the five-comparison average
    against its limit, a not-clean record ending the row, a comparison that errored passed over;
  - the committed allowances file, and the workflow's shape: the required job untouched, the two
    machines side by side with no `needs`, the baseline under a prefix today's job never picks up and
    under the same cache path everywhere, the comparison after both and never failing on "not clean".

Python's standard library only.
"""
import contextlib
import io
import json
import os
import re
import tempfile
import unittest
from unittest import mock

import side_by_side as sbs
from test_screen_parts import REQUIRED, job_name, jobs, read, steps
from test_side_by_side import FakeGitHub, at, item

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ALLOWANCES = os.path.join(ROOT, "product", "app", "journeys", "cold-start-allowances.json")
CLEAN, NOT_CLEAN, NOT_RUN = (sbs.NAMES["app"][v] for v in ("clean", "not-clean", "not-run"))
NAME_OF = {"clean": CLEAN, "not-clean": NOT_CLEAN, "not-run": NOT_RUN}
LIMITS = {"differenceMs": 454}
FLOWS = {"The app opens": True, "The app answers": True, "The sign-in test": True}
BOTH = {"phone": FLOWS, "tablet": FLOWS}


def junit(flows):
    """A Maestro JUnit report: {name: True | False | a status word}."""
    cases = []
    for name, state in flows.items():
        status = state if isinstance(state, str) else ("SUCCESS" if state else "ERROR")
        failure = "" if status in ("SUCCESS", "WARNING") else "<failure>it failed</failure>"
        cases.append(f'<testcase id="{name}" name="{name}" classname="{name}" time="2.0" status="{status}">'
                     f"{failure}</testcase>")
    return ("<?xml version='1.0' encoding='UTF-8'?><testsuites>"
            f'<testsuite name="Test Suite" tests="{len(flows)}" failures="0" time="9.0">' + "".join(cases)
            + "</testsuite></testsuites>")


def side(folder, phone=None, tablet=None, startup=None):
    """One machine's results: each size's report when given, and the cold start (median, passes) or (median,
    passes, the median of the main baseline it compared with: None when it had none)."""
    os.makedirs(folder, exist_ok=True)
    for size, flows in (("phone", phone), ("tablet", tablet)):
        if flows is not None:
            with open(os.path.join(folder, f"{size}.xml"), "w", encoding="utf-8") as f:
                f.write(junit(flows))
    if startup is not None:
        median, passes, main = (*startup, 1000)[:3] if len(startup) == 2 else startup
        with open(os.path.join(folder, "startup.json"), "w", encoding="utf-8") as f:
            json.dump({"runs": [median] * 7, "medianMs": median, "budgetMs": 2000, "mainMedianMs": main,
                       "passes": passes}, f)


def compared(one=None, phone=None, tablet=None, allowance=761):
    """The record and its text for made-up results. `one`: {phone, tablet, startup}; `phone`: {phone};
    `tablet`: {tablet, startup}. Defaults: everything passed everywhere, 1,200 ms and 1,300 ms."""
    one = {**BOTH, "startup": (1200, True)} if one is None else one
    phone = {"phone": FLOWS} if phone is None else phone
    tablet = {"tablet": FLOWS, "startup": (1300, True)} if tablet is None else tablet
    with tempfile.TemporaryDirectory() as root:
        for name, found in (("one", one), ("phone", phone), ("tablet", tablet)):
            side(os.path.join(root, name), **found)
        return sbs.compare_app(*(os.path.join(root, n) for n in ("one", "phone", "tablet")), allowance,
                               commit="abc1234", pr=42)


def app_rec(pr, clean=True, difference=0.0, flip=False, reasons=(), commit="abc1234"):
    """A record of a comparison that ran, as compare_app writes it."""
    return {"kind": "app", "commit": commit, "pr": pr, "measured": True, "ran": True, "clean": clean,
            "reasons": list(reasons), "flip": flip, "differenceMs": difference, "allowanceMs": 761}


def app_not_run(pr, reason="the comparison failed", commit="abc1234"):
    return sbs.failed_record(commit, pr, reason, "app")


def tally(github, **kw):
    return sbs.tally(github, "app", LIMITS, **kw)


class TheComparison(unittest.TestCase):
    def test_everything_passed_on_both_sides_with_the_same_flows_and_close_cold_starts_is_clean(self):
        record, text = compared()
        self.assertTrue(record["clean"], record["reasons"])
        self.assertEqual(record["reasons"], [])
        self.assertFalse(record["flip"])
        self.assertEqual((record["kind"], record["ran"], record["measured"], record["pr"], record["commit"]),
                         ("app", True, True, 42, "abc1234"))
        self.assertEqual((record["oneMedianMs"], record["twoMedianMs"], record["differenceMs"],
                          record["allowanceMs"]), (1200, 1300, 100, 761))
        self.assertEqual(sbs.verdict_of(record), "clean")
        self.assertTrue(text.startswith("**Clean:**"))
        self.assertIn("| Journeys, phone size | 3 of 3 passed | 3 of 3 passed |", text)
        self.assertIn("| Cold start, median of 7 | 1.20 s (passes against main) | 1.30 s (passes against main) |", text)
        self.assertIn("The difference (two machines - one machine): +100 ms, against an allowance of 761 ms.", text)

    def test_a_flow_that_failed_on_two_machines_only_is_not_clean_and_is_named_without_a_flip(self):
        record, text = compared(phone={"phone": {**FLOWS, "The app answers": False}})
        self.assertFalse(record["clean"])
        self.assertTrue(record["ran"])
        self.assertFalse(record["flip"])
        self.assertEqual(record["reasons"], ["at the phone size, `The app answers` failed on two machines and passed on one"])
        self.assertIn("**Not clean:**", text)
        self.assertEqual(sbs.verdict_of(record), "not-clean")

    def test_a_flow_that_passes_on_two_machines_and_failed_on_one_is_not_clean_with_a_flip(self):
        record, text = compared(one={**BOTH, "tablet": {**FLOWS, "The sign-in test": False}, "startup": (1200, True)})
        self.assertFalse(record["clean"])
        self.assertTrue(record["flip"])
        self.assertEqual(record["reasons"], ["at the tablet size, `The sign-in test` failed on one machine and passed on two"])
        self.assertIn("something passes on two machines that fails on one", text)

    def test_the_one_machine_run_that_stopped_at_a_failed_flow_is_compared_and_its_later_size_and_cold_start_are_not_missing(self):
        # run.sh stops at the failed phone flow: a phone report, no tablet report and no startup.json on one machine.
        # Two machines pass everything: a disagreement, and the one that makes the switch unsafe.
        record, text = compared(one={"phone": {**FLOWS, "The app opens": False}})
        self.assertFalse(record["clean"])
        self.assertTrue(record["ran"])
        self.assertTrue(record["flip"])
        self.assertEqual(record["reasons"], ["at the phone size, `The app opens` failed on one machine and passed on two"])
        self.assertEqual(sbs.verdict_of(record), "not-clean")
        self.assertEqual(record["flows"]["tablet"]["oneMachine"], None)
        self.assertIn("something passes on two machines that fails on one", text)
        # The same at the tablet size: the phone passed, the tablet failed, and there is no cold start.
        record, _ = compared(one={"phone": FLOWS, "tablet": {**FLOWS, "The sign-in test": False}})
        self.assertEqual(record["reasons"], ["at the tablet size, `The sign-in test` failed on one machine and passed on two"])
        self.assertTrue(record["flip"])

    def test_the_reverse_a_flow_that_failed_on_two_machines_and_passed_on_one_is_not_clean_and_no_flip(self):
        record, _ = compared(tablet={"tablet": {**FLOWS, "The sign-in test": False}})
        self.assertFalse(record["clean"])
        self.assertFalse(record["flip"])
        self.assertEqual(sbs.verdict_of(record), "not-clean")
        self.assertEqual(record["reasons"], ["at the tablet size, `The sign-in test` failed on two machines and passed on one"])

    def test_the_same_failure_on_both_ways_is_a_broken_pull_request_not_evidence_so_it_is_not_run(self):
        broken = {**FLOWS, "The app opens": False}
        # The one-machine run stopped at it (no tablet report, no cold start); the tablet's machine ran on.
        record, text = compared(one={"phone": broken}, phone={"phone": broken})
        self.assertEqual(sbs.verdict_of(record), "not-run")
        self.assertFalse(record["ran"])
        self.assertFalse(record["clean"])
        self.assertFalse(record["flip"])
        self.assertEqual(record["reasons"], ["at the phone size, `The app opens` failed on both ways (a broken pull "
                                             "request, not evidence about splitting)"])
        self.assertTrue(text.startswith("**Not run, so passed over and not counted:**"))
        # The same at the tablet size, with the one-machine run having got that far.
        record, _ = compared(one={"phone": FLOWS, "tablet": broken}, tablet={"tablet": broken})
        self.assertEqual(sbs.verdict_of(record), "not-run")
        # Both fail the same flow at both sizes (the one-machine run never reached the tablet's: one reason).
        record, _ = compared(one={"phone": broken}, phone={"phone": broken}, tablet={"tablet": broken})
        self.assertEqual(sbs.verdict_of(record), "not-run")
        self.assertEqual(len(record["reasons"]), 1)
        record, _ = compared(one={"phone": broken, "tablet": broken}, phone={"phone": broken}, tablet={"tablet": broken})
        self.assertEqual(len(record["reasons"]), 2)

    def test_the_same_failure_on_both_ways_with_any_disagreement_elsewhere_is_still_not_clean(self):
        broken = {**FLOWS, "The app opens": False}
        record, _ = compared(one={"phone": broken, "tablet": FLOWS, "startup": (1200, True)}, phone={"phone": broken},
                             tablet={"tablet": {**FLOWS, "The app answers": False}, "startup": (1300, True)})
        self.assertEqual(sbs.verdict_of(record), "not-clean")
        self.assertEqual(record["reasons"], ["at the tablet size, `The app answers` failed on two machines and passed on one"])
        # Different flows failing on each side is a disagreement on both of them.
        record, _ = compared(one={"phone": {**FLOWS, "The app opens": False}},
                             phone={"phone": {**FLOWS, "The app answers": False}})
        self.assertEqual(sbs.verdict_of(record), "not-clean")
        self.assertTrue(record["flip"])
        self.assertEqual(len(record["reasons"]), 2)
        # The two-machine side leaving nothing is a disagreement too.
        record, _ = compared(one={"phone": broken}, phone={})
        self.assertEqual(sbs.verdict_of(record), "not-clean")

    def test_a_size_the_one_machine_run_never_reached_has_nothing_to_compare_but_a_size_it_skipped_for_no_reason_does(self):
        record, _ = compared(one={"phone": FLOWS, "startup": (1200, True)})  # phone passed, tablet report missing
        self.assertEqual(record["reasons"], ["the one-machine run left no tablet.xml"])
        record, _ = compared(one={"tablet": FLOWS, "startup": (1200, True)})  # phone missing, tablet there
        self.assertEqual(record["reasons"], ["the one-machine run left no phone.xml"])

    def test_each_flows_pass_is_read_from_its_failure_its_error_and_its_status(self):
        for state, passes in ((True, True), ("SUCCESS", True), ("WARNING", True), (False, False), ("ERROR", False),
                              ("STOPPED", False), ("PENDING", False)):
            with self.subTest(state=state), tempfile.TemporaryDirectory() as root:
                path = os.path.join(root, "phone.xml")
                with open(path, "w", encoding="utf-8") as f:
                    f.write(junit({"A flow": state}))
                self.assertEqual(sbs.read_flows(path), {"A flow": passes})
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "phone.xml")
            with open(path, "w", encoding="utf-8") as f:  # no status, a bare <error>: Maestro's older shapes
                f.write('<testsuites><testsuite><testcase name="Fine"/><testcase name="Bad"><error/></testcase>'
                        "</testsuite></testsuites>")
            self.assertEqual(sbs.read_flows(path), {"Fine": True, "Bad": False})

    def test_a_flow_missing_on_one_side_is_not_clean_and_names_it(self):
        record, _ = compared(phone={"phone": {k: v for k, v in FLOWS.items() if k != "The sign-in test"}})
        self.assertFalse(record["clean"])
        self.assertEqual(record["reasons"], ["the flows at the phone size differ: only on one machine: "
                                             "`The sign-in test`; only on two machines: none"])
        self.assertFalse(record["flip"])

    def test_a_size_with_no_flows_at_all_is_not_clean(self):
        record, _ = compared(one={"phone": {}, "tablet": FLOWS, "startup": (1200, True)}, phone={"phone": {}})
        self.assertFalse(record["clean"])
        self.assertTrue(any("no flow ran at the phone size on one machine" in r for r in record["reasons"]))

    def test_a_report_that_is_not_xml_or_declares_entities_is_no_report(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "phone.xml")
            for content in ("not xml at all", "", "<testsuites>", '<!DOCTYPE x [<!ENTITY a "b">]><testsuites/>'):
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
                with self.subTest(content=content):
                    self.assertIsNone(sbs.read_flows(path))
            self.assertIsNone(sbs.read_flows(os.path.join(root, "missing.xml")))

    def test_cold_start_verdicts_that_differ_are_not_clean_and_a_flip_only_when_two_machines_pass(self):
        record, _ = compared(tablet={"tablet": FLOWS, "startup": (1300, False)})
        self.assertFalse(record["clean"])
        self.assertFalse(record["flip"])
        self.assertEqual(record["reasons"], ["the cold start's verdict differs: fails on two machines, passes on one"])
        record, text = compared(one={**BOTH, "startup": (1200, False)})
        self.assertFalse(record["clean"])
        self.assertTrue(record["flip"])
        self.assertEqual(record["reasons"], ["the cold start's verdict differs: passes on two machines, fails on one"])
        self.assertIn("something passes on two machines that fails on one", text)

    def test_cold_start_verdicts_that_are_both_failing_are_equal_and_everything_else_decides(self):
        record, _ = compared(one={**BOTH, "startup": (4000, False)}, tablet={"tablet": FLOWS, "startup": (4100, False)})
        self.assertTrue(record["clean"], record["reasons"])
        self.assertEqual(record["verdicts"], {"one": False, "two": False})

    def test_the_difference_of_the_medians_is_clean_at_the_allowance_and_inside_not_past_it_either_way(self):
        for one, two, clean in ((1000, 1761, True), (1761, 1000, True), (1000, 1000, True), (1000, 1762, False),
                                (1762, 1000, False), (1000, 1760, True)):
            with self.subTest(one=one, two=two):
                record, _ = compared(one={**BOTH, "startup": (one, True)},
                                     tablet={"tablet": FLOWS, "startup": (two, True)})
                self.assertEqual(record["clean"], clean, record["reasons"])
                self.assertEqual(record["differenceMs"], two - one)  # signed: two machines minus one
                if not clean:
                    self.assertEqual(len(record["reasons"]), 1)
                    self.assertIn("more than the allowance of 761 ms", record["reasons"][0])
                    self.assertFalse(record["flip"])

    def test_the_allowance_is_the_files_not_a_constant(self):
        record, _ = compared(allowance=100)
        self.assertTrue(record["clean"])  # 100 ms apart
        record, _ = compared(allowance=99)
        self.assertFalse(record["clean"])

    def test_a_side_that_left_nothing_is_not_clean_the_two_machine_side_measured_nothing(self):
        record, _ = compared(phone={})
        self.assertFalse(record["clean"])
        self.assertEqual(record["reasons"], ["the two-machine side measured nothing at the phone size (no phone.xml)"])
        self.assertEqual(record["flows"]["phone"]["twoMachines"], None)
        record, _ = compared(phone={}, tablet={})
        self.assertEqual(len(record["reasons"]), 2)  # both sizes; the cold start is explained by the missing report
        self.assertIsNone(record["twoMedianMs"])
        self.assertIsNone(record["differenceMs"])
        self.assertEqual(sbs.verdict_of(record), "not-clean")

    def test_a_tablet_machine_that_passed_its_flows_but_left_no_cold_start_is_not_clean(self):
        record, text = compared(tablet={"tablet": FLOWS})
        self.assertFalse(record["clean"])
        self.assertEqual(record["reasons"], ["the two-machine side measured no cold start (its tablet machine left "
                                             "no startup.json)"])
        self.assertIn("not measured", text)

    def test_a_cold_start_missing_because_a_flow_failed_adds_no_second_reason(self):
        record, _ = compared(tablet={"tablet": {**FLOWS, "The app opens": False}})
        self.assertEqual(record["reasons"], ["at the tablet size, `The app opens` failed on two machines and passed on one"])

    def test_only_the_tablets_machine_explains_a_missing_cold_start_on_two_machines(self):
        # The phone's machine failed a flow, which says nothing about the cold start: the tablet's machine runs it.
        record, _ = compared(phone={"phone": {**FLOWS, "The app opens": False}}, tablet={"tablet": FLOWS})
        self.assertEqual(record["reasons"], ["at the phone size, `The app opens` failed on two machines and passed on one",
                                             "the two-machine side measured no cold start (its tablet machine left "
                                             "no startup.json)"])
        # On one machine a failed flow at either size (or a size with no report) stops the run before its cold start.
        record, _ = compared(one={"phone": {**FLOWS, "The app opens": False}, "tablet": FLOWS})
        self.assertEqual(record["reasons"], ["at the phone size, `The app opens` failed on one machine and passed on two"])

    def test_a_one_machine_run_that_left_no_cold_start_is_not_clean(self):
        record, _ = compared(one=BOTH)
        self.assertFalse(record["clean"])
        self.assertEqual(record["reasons"], ["the one-machine run left no cold start"])

    def test_a_startup_file_that_is_not_one_counts_as_none(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "startup.json")
            for content in ("nope", "[]", '{"medianMs": "fast", "passes": true}', '{"medianMs": 5}',
                            '{"medianMs": 5, "passes": "yes"}', '{"medianMs": true, "passes": true}'):
                with open(path, "w") as f:
                    f.write(content)
                with self.subTest(content=content):
                    self.assertIsNone(sbs.read_startup(path))
            with open(path, "w") as f:
                f.write('{"medianMs": 1500, "passes": false}')
            self.assertEqual(sbs.read_startup(path), {"medianMs": 1500, "passes": False, "mainMedianMs": None})
            with open(path, "w") as f:
                f.write('{"medianMs": 1500, "passes": true, "mainMedianMs": 1100}')
            self.assertEqual(sbs.read_startup(path), {"medianMs": 1500, "passes": True, "mainMedianMs": 1100})
            with open(path, "w") as f:  # a baseline that isn't a number is none
                f.write('{"medianMs": 1500, "passes": true, "mainMedianMs": "soon"}')
            self.assertIsNone(sbs.read_startup(path)["mainMedianMs"])

    def test_a_tablet_cold_start_with_no_baseline_from_main_is_not_run_whatever_its_verdict(self):
        for passes in (True, False):
            with self.subTest(passes=passes):
                record, text = compared(tablet={"tablet": FLOWS, "startup": (1300, passes, None)})
                self.assertEqual(sbs.verdict_of(record), "not-run")
                self.assertFalse(record["ran"])
                self.assertEqual(record["reasons"], ["the tablet machine's cold start had no baseline from main (its "
                                                     "mainMedianMs is empty), so its verdict can't be compared"])
                self.assertEqual(record["differenceMs"], 100)
                self.assertTrue(text.startswith("**Not run, so passed over and not counted:**"))

    def test_a_missing_baseline_is_not_run_only_when_nothing_else_disagrees(self):
        # A flow that disagrees, or medians too far apart, is evidence whatever the baseline: not clean.
        record, _ = compared(tablet={"tablet": {**FLOWS, "The app opens": False}, "startup": (1300, True, None)})
        self.assertEqual(sbs.verdict_of(record), "not-clean")
        record, _ = compared(one={**BOTH, "startup": (1000, True)}, tablet={"tablet": FLOWS, "startup": (2000, True, None)})
        self.assertEqual(sbs.verdict_of(record), "not-clean")
        self.assertEqual(len(record["reasons"]), 1)
        # Its verdict isn't compared without a baseline: one machine failing against its own baseline, two with none.
        record, _ = compared(one={**BOTH, "startup": (1200, False)}, tablet={"tablet": FLOWS, "startup": (1300, True, None)})
        self.assertEqual(sbs.verdict_of(record), "not-run")
        self.assertFalse(record["flip"])
        # No startup.json on the tablet at all is the other reason, not this one.
        record, _ = compared(tablet={"tablet": FLOWS})
        self.assertEqual(sbs.verdict_of(record), "not-clean")

    def test_a_baseline_on_both_sides_changes_nothing_and_one_on_the_one_machine_run_is_not_asked_for(self):
        record, _ = compared(one={**BOTH, "startup": (1200, True, None)})
        self.assertEqual(sbs.verdict_of(record), "clean")
        record, _ = compared(one={**BOTH, "startup": (1200, True, 900)}, tablet={"tablet": FLOWS, "startup": (1300, True, 950)})
        self.assertEqual(sbs.verdict_of(record), "clean")

    def test_the_two_machine_cold_start_is_read_from_the_tablets_machine_and_the_phone_machine_has_none(self):
        with tempfile.TemporaryDirectory() as root:
            side(os.path.join(root, "one"), startup=(1200, True), **BOTH)
            side(os.path.join(root, "phone"), phone=FLOWS, startup=(9999, False))  # never read
            side(os.path.join(root, "tablet"), tablet=FLOWS, startup=(1300, True))
            record, _ = sbs.compare_app(*(os.path.join(root, n) for n in ("one", "phone", "tablet")), 761)
        self.assertEqual(record["twoMedianMs"], 1300)

    def test_a_reasons_text_cant_break_the_summarys_layout(self):
        record, text = compared(phone={"phone": {**FLOWS, "A|bad`name": False}})
        self.assertNotIn("A|bad`name", text)
        self.assertIn("A'bad'name", text)


class ThePlan(unittest.TestCase):
    def plan(self, phone, baseline, startup=None):
        with tempfile.TemporaryDirectory() as root:
            one, out = os.path.join(root, "one"), os.path.join(root, "out")
            if phone is not None or startup is not None:
                side(one, phone=phone, startup=startup)
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(sbs.app_plan(one, out, {"BASELINE": baseline}), 0)
            record = os.path.join(out, "comparison.json")
            note = os.path.join(out, "comparison.md")
            text = None
            if os.path.exists(note):
                with open(note, encoding="utf-8") as f:
                    text = f.read().strip()
            return printed.getvalue().strip(), os.path.exists(record), text

    def test_the_one_machine_journeys_having_run_and_a_baseline_on_main_make_a_comparison(self):
        self.assertEqual(self.plan(FLOWS, "true", startup=(1200, True)), ("measured=true", False, None))

    def test_a_one_machine_run_that_stopped_at_a_failed_flow_is_compared_too(self):
        # run.sh stops at the failed flow: its report is there, its cold start is not.
        self.assertEqual(self.plan({**FLOWS, "The app opens": False}, "true"), ("measured=true", False, None))

    def test_no_baseline_on_main_means_no_record_and_the_summary_says_why(self):
        found, record, note = self.plan(FLOWS, "false", startup=(1200, True))
        self.assertEqual((found, record), ("measured=false", False))
        self.assertEqual(note, "Not counted: no two-machine baseline on main yet (main's next App journeys run "
                               "saves it).")

    def test_no_phone_report_from_the_one_machine_run_means_no_record_and_the_summary_says_why(self):
        for baseline in ("true", "false", ""):
            for startup in (None, (1200, True)):  # a cold start without the journeys' report isn't a run either
                with self.subTest(baseline=baseline, startup=startup):
                    found, record, note = self.plan(None, baseline, startup=startup)
                    self.assertEqual((found, record), ("measured=false", False))
                    self.assertEqual(note, "Not counted: the app wasn't touched, or the one-machine App journeys left "
                                           "no results (no phone.xml), so there is nothing to compare.")

    def test_the_baseline_is_true_only_when_the_workflow_says_exactly_true(self):
        for baseline in ("", "True", "1", "yes", "false"):
            with self.subTest(baseline=baseline):
                self.assertEqual(self.plan(FLOWS, baseline, startup=(1200, True))[0], "measured=false")


class TheCommands(unittest.TestCase):
    def test_app_compare_writes_the_record_and_the_text_and_never_fails_on_not_clean(self):
        with tempfile.TemporaryDirectory() as root:
            for name, found in (("one", {**BOTH, "startup": (1200, True)}), ("phone", {"phone": FLOWS}),
                                ("tablet", {"tablet": {**FLOWS, "The app opens": False}})):
                side(os.path.join(root, name), **found)
            out = os.path.join(root, "out")
            argv = [os.path.join(root, "one"), os.path.join(root, "phone"), os.path.join(root, "tablet"), out,
                    "--allowances", ALLOWANCES]
            with contextlib.redirect_stderr(io.StringIO()):
                code = sbs.main(["app-compare", *argv])
            self.assertEqual(code, 0)
            with open(os.path.join(out, "comparison.json")) as f:
                record = json.load(f)
            self.assertFalse(record["clean"])
            self.assertEqual(record["allowanceMs"], sbs.read_app_allowance(ALLOWANCES))
            self.assertTrue(os.path.isfile(os.path.join(out, "comparison.md")))

    def test_the_environment_gives_the_commit_and_the_pull_request(self):
        with tempfile.TemporaryDirectory() as root:
            for name, found in (("one", {**BOTH, "startup": (1200, True)}), ("phone", {"phone": FLOWS}),
                                ("tablet", {"tablet": FLOWS, "startup": (1300, True)})):
                side(os.path.join(root, name), **found)
            argv = [os.path.join(root, n) for n in ("one", "phone", "tablet", "out")] + ["--allowances", ALLOWANCES]
            with contextlib.redirect_stderr(io.StringIO()):
                sbs.app_compare(argv, {"COMMIT": "deadbee", "PR_NUMBER": "17"})
            with open(os.path.join(root, "out", "comparison.json")) as f:
                record = json.load(f)
            self.assertEqual((record["commit"], record["pr"], record["clean"]), ("deadbee", 17, True))

    def test_the_command_line_is_checked(self):
        for argv in (["app-plan"], ["app-plan", "a"], ["app-plan", "a", "b", "c"], ["app-compare"],
                     ["app-compare", "a", "b", "c", "d"], ["app-compare", "a", "b", "c", "d", "--other", "e"],
                     ["app-compare", "a", "b", "c", "d", "--allowances"], ["finalize", "a", "speed"],
                     ["finalize", "a", "app", "b"], ["tally", "app"], ["tally", "app", "--limits"],
                     ["tally", "app", "--other", "x"]):
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    sbs.main(argv)

    def test_a_comparison_that_errored_leaves_a_not_run_record_of_the_apps_kind_and_one_that_ran_is_left_alone(self):
        env = {"COMMIT": "abc1234", "PR_NUMBER": "42"}
        with tempfile.TemporaryDirectory() as out:
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(sbs.finalize(out, env, "app"), 0)
            self.assertEqual(printed.getvalue().strip(), "verdict=not-run")
            with open(os.path.join(out, "comparison.json")) as f:
                record = json.load(f)
            self.assertEqual((record["kind"], record["ran"], record["clean"], record["reasons"], record["pr"]),
                             ("app", False, False, ["the comparison failed"], 42))
            with open(os.path.join(out, "comparison.md"), encoding="utf-8") as f:
                self.assertIn("Not run, so passed over and not counted", f.read())
        with tempfile.TemporaryDirectory() as out:
            sbs.write_json(os.path.join(out, "comparison.json"), app_rec(42, clean=False))
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(io.StringIO()):
                sbs.finalize(out, env, "app")
            self.assertEqual(printed.getvalue().strip(), "verdict=not-clean")

    def test_the_speed_checks_own_finalize_is_unchanged(self):
        with tempfile.TemporaryDirectory() as out:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                sbs.finalize(out, {"COMMIT": "abc1234", "PR_NUMBER": "42"})
            with open(os.path.join(out, "comparison.json")) as f:
                self.assertEqual(json.load(f)["kind"], "speed")


class TheAllowancesFile(unittest.TestCase):
    def test_the_committed_file_has_a_positive_allowance_and_five_comparison_limit(self):
        with open(ALLOWANCES, encoding="utf-8") as f:
            found = json.load(f)
        for key in ("allowanceMs", "fiveComparisonAverageMs"):
            self.assertIsInstance(found[key], (int, float), key)
            self.assertGreater(found[key], 0, key)
        self.assertGreaterEqual(found["allowanceMs"], found["method"]["floorMs"])
        self.assertEqual(sbs.read_app_allowance(ALLOWANCES), found["allowanceMs"])
        self.assertEqual(sbs.read_limits(ALLOWANCES, "app"), {"differenceMs": found["fiveComparisonAverageMs"]})
        for key in ("about", "method", "computed", "source", "proof"):
            self.assertIn(key, found)

    def test_a_file_without_them_stops_the_command(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "allowances.json")
            for content in (None, "[]", {}, {"allowanceMs": 0, "fiveComparisonAverageMs": 0},
                            {"allowanceMs": "761", "fiveComparisonAverageMs": "454"},
                            {"allowanceMs": True, "fiveComparisonAverageMs": True},
                            {"allowanceMs": -1, "fiveComparisonAverageMs": -1}):
                if content is not None:
                    with open(path, "w") as f:
                        json.dump(content, f)
                with self.subTest(content=content):
                    with self.assertRaises(SystemExit):
                        sbs.read_app_allowance(path)
                    with self.assertRaises(SystemExit):
                        sbs.read_limits(path, "app")
            with open(path, "w") as f:
                json.dump({"allowanceMs": 500, "fiveComparisonAverageMs": 300}, f)
            self.assertEqual((sbs.read_app_allowance(path), sbs.read_limits(path, "app")), (500, {"differenceMs": 300}))


class TheTally(unittest.TestCase):
    """tally() on App journeys' records: the shared rules (test_side_by_side.TheRow) with App's names and limit."""

    def github(self, items, **kw):
        return FakeGitHub(items, names=NAME_OF, **kw)

    def clean_prs(self, count, difference=0.0):
        return [item(f"pr-{n}", app_rec(100 + n, difference=difference), 10 + n) for n in range(count)]

    def test_the_names_are_the_apps_and_are_read_not_clean_and_not_run_first(self):
        self.assertEqual(sbs.NAMES["app"], {"not-clean": "app-comparison-not-clean",
                                            "not-run": "app-comparison-not-run", "clean": "app-comparison-clean"})
        self.assertEqual(list(sbs.NAMES["app"]), ["not-clean", "not-run", "clean"])
        github = self.github(self.clean_prs(2))
        tally(github)
        self.assertEqual([name for name, _ in github.pages], [NOT_CLEAN, NOT_RUN, CLEAN])

    def test_five_clean_pull_requests_with_an_average_inside_the_limit_say_so(self):
        github = self.github(self.clean_prs(5, difference=100.0))
        text, count, capped = tally(github)
        self.assertEqual((count, capped), (5, False))
        self.assertIn("### The tally: App journeys on two machines, beside App journeys", text)
        self.assertIn("**5 pull requests in a row clean (the switch needs 5)**", text)
        self.assertIn("The five pull requests' average difference in the cold start's median (two machines - one "
                      "machine, each pull request weighted equally): +100.0 ms (limit +/-454 ms): "
                      "**within its limits**.", text)
        self.assertEqual(sorted(github.downloads), [1, 2, 3, 4, 5])  # every record of the five, no other

    def test_an_average_outside_the_limit_says_so_whatever_the_sign(self):
        for difference, outside in ((455.0, True), (-455.0, True), (454.0, False), (-454.0, False)):
            with self.subTest(difference=difference):
                text, count, _ = tally(self.github(self.clean_prs(5, difference=difference)))
                self.assertEqual(count, 5)
                self.assertEqual("**outside its limit:** the cold start's median" in text, outside, text)
                self.assertEqual("**within its limits**" in text, not outside, text)

    def test_the_average_is_each_pull_requests_own_mean_then_the_mean_of_the_five(self):
        # One pull request with two records (+600 and +0 = +300) and four with +440: the mean of the five is
        # 412 (inside 454); weighting each record equally instead would give 466.7 (outside).
        items = [item("pr-0", app_rec(100, difference=600.0), 10), item("pr-0", app_rec(100, difference=0.0), 11)]
        items += [item(f"pr-{n}", app_rec(100 + n, difference=440.0), 11 + n) for n in range(1, 5)]
        text, count, _ = tally(self.github(items))
        self.assertEqual(count, 5)
        self.assertIn("+412.0 ms", text)
        self.assertIn("**within its limits**", text)

    def test_a_pull_request_with_a_not_clean_record_ends_the_row_and_its_reasons_and_flip_are_named(self):
        items = self.clean_prs(3)
        items.append(item("pr-bad", app_rec(200, clean=False, flip=True, commit="feedbee1234",
                                            reasons=["at the tablet size, `The sign-in test` failed on one machine"]), 9))
        items.append(item("pr-old", app_rec(300), 5))  # older than the bad one: never reached
        text, count, _ = tally(self.github(items))
        self.assertEqual(count, 3)
        self.assertIn("The row ended at `pr-bad`", text)
        self.assertIn("Its newest not-clean record is for #200 (commit `feedbee`), and **a flow or the cold start's "
                      "verdict passes on two machines that fails on one**:", text)
        self.assertIn("- at the tablet size, 'The sign-in test' failed on one machine", text)  # a reason has no backticks
        self.assertNotIn("average difference", text)

    def test_a_comparison_that_errored_is_passed_over_it_neither_counts_nor_ends_the_row(self):
        items = self.clean_prs(5)
        items.append(item("pr-errored", app_not_run(400), 30))
        text, count, _ = tally(self.github(items))
        self.assertEqual(count, 5)
        self.assertIn("Passed over, because the comparison didn't run (the comparison failed, or both ways failed the "
                      "same flows, or the tablet's cold start had no baseline; not counted either way): `pr-errored`.", text)
        self.assertNotIn("The row ended", text)

    def test_a_record_of_the_other_kind_or_without_a_difference_cant_make_an_average(self):
        for record in ({**app_rec(100), "kind": "speed"}, {**app_rec(100), "differenceMs": None},
                       {**app_rec(100), "differenceMs": "fast"}, {k: v for k, v in app_rec(100).items() if k != "pr"}):
            with self.subTest(record=record):
                items = self.clean_prs(5)
                items[0]["record"] = record
                text, count, _ = tally(self.github(items))
                self.assertEqual(count, 5)
                self.assertIn("**The five-comparison average can't be checked this run:**", text)

    def test_this_runs_own_record_counts_before_the_list_shows_it(self):
        text, count, _ = tally(self.github(self.clean_prs(3)), current=app_rec(900, difference=50.0), branch="pr-now",
                               run_id=777)
        self.assertEqual(count, 4)
        self.assertIn("Counted: `pr-now`", text)
        text, count, _ = tally(self.github(self.clean_prs(3)), current=app_rec(900, clean=False, difference=50.0),
                               branch="pr-now", run_id=777)
        self.assertEqual(count, 0)  # a not-clean record of this very run ends the row at once

    def test_main_and_the_m75_branch_are_never_counted(self):
        items = self.clean_prs(2) + [item("main", app_rec(1, clean=False), 40), item(sbs.M75_BRANCH, app_rec(2), 41)]
        text, count, _ = tally(self.github(items))
        self.assertEqual(count, 2)
        self.assertNotIn("main", text.replace("main's", ""))

    def test_the_command_counts_with_the_apps_limit_and_names(self):
        github = self.github(self.clean_prs(5, difference=10.0))
        with tempfile.TemporaryDirectory() as folder:
            current = os.path.join(folder, "comparison.json")
            sbs.write_json(current, app_rec(900))
            env = {"GITHUB_TOKEN": "t", "GITHUB_REPOSITORY": "owner/repo", "BRANCH": "pr-now", "GITHUB_RUN_ID": "5"}
            with mock.patch.object(sbs, "GitHub", return_value=github):
                with contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(sbs.run_tally(["app", "--limits", ALLOWANCES, "--current", current], env), 0)
        self.assertIn("**5 pull requests in a row clean (the switch needs 5)**", printed.getvalue())
        self.assertIn("(limit +/-" + str(sbs.read_limits(ALLOWANCES, "app")["differenceMs"]) + " ms)", printed.getvalue())

    def test_the_speed_checks_summary_is_unchanged(self):
        github = FakeGitHub([item(f"pr-{n}", {"kind": "speed", "commit": "abc", "pr": 100 + n, "measured": True,
                                              "clean": True, "reasons": [], "pages": [{"path": "/", "clean": True}],
                                              "averages": {"busyMs": 0.0, "loadMs": 0.0}, "flip": False}, 10 + n)
                             for n in range(5)])
        text, _, _ = sbs.tally(github, "speed", {"busyMs": 36, "loadMs": 24})
        self.assertIn("### The tally: the Speed check on three machines, beside the Speed check", text)
        self.assertIn("The five pull requests' average difference (three machines - one machine, each pull request "
                      "weighted equally): busy +0.0 ms (limit +/-36 ms), load +0.0 ms (limit +/-24 ms): "
                      "**within its limits**.", text)


class TheWorkflow(unittest.TestCase):
    """The trial's jobs in app-journeys.yml, read as text."""

    def setUp(self):
        self.text = read("app-journeys.yml")
        self.jobs = jobs(self.text)
        self.assertEqual(sorted(self.jobs), ["app", "app-compare", "app-size"])  # so no test can pass by finding nothing
        self.app, self.size, self.compare = (self.jobs[j] for j in ("app", "app-size", "app-compare"))
        self.app_steps, self.size_steps, self.compare_steps = steps(self.app), steps(self.size), steps(self.compare)

    def step(self, found, needle):
        return next(s for s in found if needle in s)

    @staticmethod
    def bare(step):
        """A step without its comment lines (a comment above a step is read as the end of the step before it)."""
        return "".join(line + "\n" for line in step.splitlines() if not line.lstrip().startswith("#"))

    def test_the_names_are_none_of_the_required_ones_and_the_required_job_is_still_one_job(self):
        names = {job: job_name(body) for job, body in self.jobs.items()}
        self.assertEqual(names["app"], "App journeys")
        self.assertEqual(names["app-size"], "App journeys on two machines, ${{ matrix.size }}")
        self.assertEqual(names["app-compare"], "App journeys on two machines")
        for job in ("app-size", "app-compare"):
            self.assertNotIn(names[job], REQUIRED)
        self.assertEqual([job for job, name in names.items() if name == "App journeys"], ["app"])

    def test_the_required_job_is_exactly_what_it_was(self):
        # Nothing about it changes while the trial runs beside it: the same steps, in the same order, with the
        # same one-machine baseline, comment and upload. (A step added or taken out shows in the count.)
        names = [s.splitlines()[0].strip() for s in self.app_steps]
        self.assertEqual(len(names), 33)
        self.assertEqual(names[:4], ["- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
                                    "- uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0",
                                    "- uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0",
                                    "- name: Where pnpm keeps its packages, and main's key for them"])
        self.assertEqual(names[-7:], ["- name: Main's cold start, to compare with (pull requests)",
                                      "- name: The previews' keys are the app's own (names only)",
                                      "- name: The app's journeys, at a phone size and a tablet size, then its cold start",
                                      "- name: Keep main's cold start for the next pull requests (main only)",
                                      "- name: Save main's cold start",
                                      "- name: The results on the pull request",
                                      "- name: Screenshots and results (phone and tablet)"])
        self.assertNotRegex(self.app, re.compile(r"^    (needs|if|strategy):", re.M))
        journeys = self.step(self.app_steps, "emulator.sh run bash product/app/journeys/run.sh")
        self.assertIn('journeys-build/app.apk "$RUNNER_TEMP/journeys"\n', journeys)  # no size: both, as today
        self.assertIn("STARTUP_BASELINE: ${{ runner.temp }}/startup-main/startup.json", journeys)
        restore = self.step(self.app_steps, "name: Main's cold start, to compare with")
        self.assertIn("restore-keys: app-startup-main-\n", restore)
        self.assertIn("key: app-startup-main-${{ github.sha }}", self.step(self.app_steps, "name: Save main's cold start"))
        self.assertIn("name: app-journeys\n", self.step(self.app_steps, "name: Screenshots and results (phone and tablet)"))
        self.assertIn("retention-days: 30", self.step(self.app_steps, "name: Screenshots and results (phone and tablet)"))
        self.assertEqual(self.text.count("app_comment.py"), 1)
        self.assertIn("app_comment.py", self.app)

    def test_the_two_machines_run_beside_the_required_job_a_phone_and_a_tablet_that_never_cancel_one_another(self):
        self.assertNotRegex(self.size, re.compile(r"^    needs:", re.M))
        self.assertNotRegex(self.size, re.compile(r"^    if:", re.M))
        self.assertRegex(self.size, re.compile(
            r"^    strategy:\n      fail-fast: false\n      matrix:\n        size: \[phone, tablet\]\n", re.M))
        self.assertRegex(self.size, re.compile(
            r"^    permissions:\n      contents: read\n      id-token: write[^\n]*\n    steps:", re.M))
        self.assertNotIn("pull-requests", self.size)
        self.assertEqual(self.size.count("${{ matrix.size }}"), 3)  # its name, the journeys' size and the upload

    def test_the_two_machines_take_the_required_jobs_steps_as_they_are_up_to_the_cold_start_baseline(self):
        index = next(i for i, s in enumerate(self.app_steps) if "Main's cold start, to compare with" in s)
        self.assertGreater(index, 20)
        # One step differs, and only in one line: Gradle's cache is read only here (the required job saves it from
        # main; a copy of its own would be a second cache entry on main).
        read_only = "          cache-read-only: ${{ github.ref != 'refs/heads/main' }}\n"
        gradle = next(i for i, s in enumerate(self.app_steps[:index]) if "gradle/actions/setup-gradle@" in s)
        for number in range(index):
            mine, required = self.bare(self.size_steps[number]), self.bare(self.app_steps[number])
            if number == gradle:
                self.assertIn(read_only, required)
                self.assertEqual(mine.replace("cache-read-only: true\n", "cache-read-only: ${{ github.ref != 'refs/heads/main' }}\n")
                                 .replace("Gradle, with the required job's cache (read only)", "Gradle, with its cache (saved from main only)"),
                                 required)
                self.assertNotIn("github.ref", mine)
                self.assertEqual(mine.count("cache-read-only: true"), 1)
            else:
                self.assertEqual(mine, required, f"step {number}")
        # ...and the names check and the step that is given the token follow it, as before.
        names_check = next(i for i, s in enumerate(self.size_steps) if "app_keys.py check stg_preview" in s)
        journeys = next(i for i, s in enumerate(self.size_steps) if "emulator.sh run bash" in s)
        self.assertGreater(journeys, names_check)
        self.assertEqual(self.bare(self.size_steps[names_check]), self.bare(self.app_steps[next(
            i for i, s in enumerate(self.app_steps) if "app_keys.py check stg_preview" in s)]))
        self.assertEqual(len(self.size_steps), index + 6)

    def test_each_machine_runs_run_sh_at_its_own_size_and_only_the_tablets_times_the_cold_start_against_main(self):
        journeys = self.step(self.size_steps, "emulator.sh run bash product/app/journeys/run.sh")
        self.assertIn('journeys-build/app.apk "$RUNNER_TEMP/journeys" ${{ matrix.size }}\n', journeys)
        self.assertIn("if: steps.run.outputs.app == 'true'\n", journeys)
        self.assertIn("DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN_PREVIEW }}", journeys)
        self.assertIn("STARTUP_BASELINE: ${{ runner.temp }}/startup-two-machines-main/startup.json", journeys)
        restore = self.step(self.size_steps, "uses: actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0\n"
                                             "        with:\n          path: ${{ runner.temp }}/startup-two-machines-main")
        self.assertIn("if: steps.run.outputs.app == 'true' && github.event_name == 'pull_request' && matrix.size == 'tablet'", restore)
        self.assertIn("key: app-startup-two-machines-main-${{ github.sha }}", restore)
        self.assertIn("restore-keys: app-startup-two-machines-main-\n", restore)
        for needle in ("Keep main's two-machine cold start", "Save main's two-machine cold start"):
            step = self.step(self.size_steps, needle)
            self.assertIn("if: steps.run.outputs.app == 'true' && github.ref == 'refs/heads/main' && matrix.size == 'tablet'", step)
        self.assertIn("key: app-startup-two-machines-main-${{ github.sha }}", self.step(self.size_steps, "Save main's two-machine cold start"))
        self.assertIn('cp "$RUNNER_TEMP/journeys/startup.json" "$RUNNER_TEMP/startup-two-machines-main/startup.json"',
                      self.step(self.size_steps, "Keep main's two-machine cold start"))

    def test_the_baseline_prefix_is_one_todays_job_never_picks_up_and_never_picks_up_todays(self):
        two = "app-startup-two-machines-main-"
        one = "app-startup-main-"
        self.assertFalse(two.startswith(one), "today's restore-keys would pick up the two-machine baseline")
        self.assertFalse(one.startswith(two))
        # Every key in the workflow that is a baseline's: the two-machine ones all under `two`, today's under `one`.
        keys = re.findall(r"(?:key|restore-keys): (app-startup-[\w-]*)", self.text)
        self.assertTrue(keys)
        for key in keys:
            self.assertTrue(key.startswith(two) or key.startswith(one), key)
        todays = [key for key in re.findall(r"(?:key|restore-keys): (app-startup-[\w-]*)", self.app)]
        self.assertTrue(todays and all(key.startswith(one) and not key.startswith(two) for key in todays))
        mine = re.findall(r"(?:key|restore-keys): (app-startup-[\w-]*)", self.size + self.compare)
        self.assertTrue(mine and all(key.startswith(two) for key in mine))

    def test_the_baseline_is_saved_restored_and_looked_up_under_the_same_cache_path(self):
        # A cache entry matches on its key AND the path it was saved with: one text, everywhere, or the
        # baseline is silently never found.
        path = "path: ${{ runner.temp }}/startup-two-machines-main\n"
        for job, needles in ((self.size_steps, ("Main's two-machine cold start, to compare with", "Save main's two-machine cold start")),
                             (self.compare_steps, ("Does main hold a two-machine cold start yet?",))):
            for needle in needles:
                self.assertIn(path, self.step(job, needle))
        self.assertEqual(self.text.count("startup-two-machines-main\n"), 3)  # the restore, the save and the look-up
        # The files the cold start reads and writes are in that same folder.
        self.assertIn("STARTUP_BASELINE: ${{ runner.temp }}/startup-two-machines-main/startup.json",
                      self.step(self.size_steps, "emulator.sh run bash"))
        keep = self.step(self.size_steps, "Keep main's two-machine cold start")
        self.assertIn('mkdir -p "$RUNNER_TEMP/startup-two-machines-main"', keep)

    def test_no_comment_goes_to_the_pull_request_and_the_machine_uploads_its_own_results(self):
        self.assertNotIn("app_comment.py", self.size)
        self.assertNotIn("pull-requests", self.size)
        upload = self.step(self.size_steps, "name: app-journeys-${{ matrix.size }}")
        self.assertIn("if: ${{ !cancelled() && steps.run.outputs.app == 'true' }}", upload)
        self.assertIn("path: ${{ runner.temp }}/journeys/", upload)
        self.assertIn("if-no-files-found: ignore", upload)
        self.assertEqual(self.size_steps[-1], upload)

    def test_the_comparison_runs_after_both_on_pull_requests_whatever_happened_and_never_when_cancelled(self):
        self.assertRegex(self.compare, re.compile(r"^    needs: \[app, app-size\]\s*$", re.M))
        self.assertRegex(self.compare, re.compile(
            r"^    if: \$\{\{ !cancelled\(\) && github\.event_name == 'pull_request' \}\}\s*$", re.M))
        self.assertRegex(self.compare, re.compile(
            r"^    permissions:\n      contents: read\n      actions: read[^\n]*\n    steps:", re.M))
        self.assertNotIn("secrets.", self.compare)
        self.assertNotIn("DOPPLER", self.compare)
        self.assertNotIn("pnpm install", self.compare)  # it installs nothing (and the install count stays what it is)
        self.assertNotIn("continue-on-error", self.compare)
        self.assertNotIn("always()", self.compare)

    def test_the_results_are_downloaded_by_pattern_into_a_folder_each_never_by_name(self):
        downloads = [s for s in self.compare_steps if "actions/download-artifact@" in s]
        self.assertEqual(len(downloads), 3)
        found = {}
        for step in downloads:
            self.assertIn("actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333", step)
            self.assertIn("merge-multiple: true", step)
            self.assertNotRegex(step, re.compile(r"^          name:", re.M))
            found[re.search(r"pattern: (\S+)", step).group(1)] = re.search(r"path: \$\{\{ runner\.temp \}\}/(\w+)", step).group(1)
        self.assertEqual(found, {"app-journeys": "one", "app-journeys-phone": "phone", "app-journeys-tablet": "tablet"})

    def test_the_baseline_lookup_downloads_nothing_and_never_hits_its_own_first_key(self):
        look = self.step(self.compare_steps, "id: baseline")
        self.assertIn("actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9", look)
        self.assertIn("key: app-startup-two-machines-main-none", look)  # never saved
        self.assertIn("restore-keys: app-startup-two-machines-main-\n", look)
        self.assertIn("lookup-only: true", look)
        self.assertNotIn("app-startup-two-machines-main-${{", self.compare)
        self.assertNotIn("cache/save", self.compare)

    def test_the_plan_reads_the_baseline_through_env_and_the_comparison_runs_only_when_it_is_due(self):
        plan = self.step(self.compare_steps, "side_by_side.py app-plan")
        self.assertIn("id: plan", plan)
        self.assertIn("BASELINE: ${{ steps.baseline.outputs.cache-matched-key != '' }}", plan)
        self.assertIn('app-plan "$RUNNER_TEMP/one" "$RUNNER_TEMP/app-comparison" >> "$GITHUB_OUTPUT"', plan)
        for step in self.compare_steps:
            for line in re.findall(r"\n        run: (.*)\n", step):
                self.assertNotIn("${{", line)
        compare = self.step(self.compare_steps, "side_by_side.py app-compare")
        self.assertIn("if: ${{ !cancelled() && steps.plan.outputs.measured == 'true' }}", compare)
        self.assertIn('app-compare "$RUNNER_TEMP/one" "$RUNNER_TEMP/phone" "$RUNNER_TEMP/tablet" '
                      '"$RUNNER_TEMP/app-comparison" --allowances product/app/journeys/cold-start-allowances.json', compare)
        self.assertIn("COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}", compare)
        self.assertIn("PR_NUMBER: ${{ github.event.pull_request.number }}", compare)

    def test_the_record_is_named_by_its_verdict_kept_90_days_and_never_left_by_a_failing_comparison(self):
        record = self.step(self.compare_steps, "side_by_side.py finalize")
        self.assertIn("id: record", record)
        self.assertIn("if: ${{ !cancelled() && steps.plan.outputs.measured == 'true' }}", record)
        self.assertIn('finalize "$RUNNER_TEMP/app-comparison" app >> "$GITHUB_OUTPUT"', record)
        upload = self.step(self.compare_steps, "name: app-comparison-")
        self.assertIn("name: app-comparison-${{ steps.record.outputs.verdict }}", upload)
        self.assertIn("if: ${{ !cancelled() && steps.record.outputs.verdict != '' }}", upload)
        self.assertIn("path: ${{ runner.temp }}/app-comparison/comparison.json", upload)
        self.assertIn("retention-days: 90", upload)
        order = self.compare_steps
        compare = self.step(order, "side_by_side.py app-compare")
        self.assertLess(order.index(compare), order.index(record))
        self.assertLess(order.index(record), order.index(upload))
        # The upload's names are the ones the tally reads.
        self.assertEqual((CLEAN, NOT_CLEAN, NOT_RUN), ("app-comparison-clean", "app-comparison-not-clean",
                                                       "app-comparison-not-run"))

    def test_the_tally_reads_the_apps_limits_and_counts_this_runs_record_after_it_was_kept(self):
        tally_step = self.step(self.compare_steps, "side_by_side.py tally")
        self.assertIn("if: ${{ !cancelled() }}", tally_step)
        self.assertIn('side_by_side.py tally app --limits product/app/journeys/cold-start-allowances.json '
                      '--current "$OUT/comparison.json" >> "$GITHUB_STEP_SUMMARY"', tally_step)
        self.assertIn("GITHUB_TOKEN: ${{ github.token }}", tally_step)
        self.assertIn("BRANCH: ${{ github.head_ref }}", tally_step)
        upload = self.step(self.compare_steps, "name: app-comparison-")
        self.assertLess(self.compare_steps.index(upload), self.compare_steps.index(tally_step))

    def test_the_summary_shows_the_verdict_or_why_nothing_was_compared(self):
        summary = self.step(self.compare_steps, "comparison.md")
        self.assertIn("$GITHUB_STEP_SUMMARY", summary)
        self.assertIn("if: ${{ !cancelled() }}", summary)

    def test_every_check_the_workflow_asks_for_is_still_asked_for_by_the_required_job(self):
        # The required job's trigger, paths and concurrency are untouched by the trial.
        self.assertIn("on:\n  pull_request:\n  push:\n    branches: [main]\n    paths:\n      - product/app/**", self.text)
        self.assertIn("cancel-in-progress: true", self.text)
        for job in ("app-size", "app-compare"):
            self.assertNotIn("workflow_run", self.jobs[job])


if __name__ == "__main__":
    unittest.main()
