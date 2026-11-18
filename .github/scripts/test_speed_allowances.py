"""Tests for the Speed check's allowances (speed_allowances.py): offline, on made-up logs and a stubbed git.

    python3 -m unittest discover -s .github/scripts

The allowances in product/web/e2e/speed-allowances.json say how far the Speed check on three machines
may differ from the one-machine Speed check and still count as clean. They are worked out from real
checks of the same code, never typed in; these tests prove the working-out on small corpora whose
answers can be checked by hand: reading the logs, grouping the checks by their website inputs, the
floors, the largest difference doubled, the pooled fallback, the margin, the leave-out proof and the
refusal to write a file the proof doesn't support.

Python's standard library only.
"""
import contextlib
import io
import json
import os
import tempfile
import types
import unittest

import speed_allowances as sa

OK = "✅"
NOT_OK = "❌"
PAGES = [f"/p{n}" for n in range(8)]


def log_text(pages, stamp="2026-11-12T10:00:00.1234567Z ", colour=""):
    """A one-machine Speed check's log lines, as GitHub gives them: each page's five runs, then the table.
    `pages` is {path: {"busy": [5], "load": [5 in ms], "shift": [5], "code": KB, "total": KB, "verdicts": "...",
    "contrast": "..."}}; a missing "table" key leaves the page out of the table."""
    lines = [f"{stamp}Speed check on https://preview.example (preview): 5 runs a page, mobile preset"]
    for path, page in pages.items():
        for n in range(5):
            lines.append(f"{stamp}  {path}: run {n + 1} of 5 (5.5 s): busy {page['busy'][n]} ms, "
                         f"load {page['load'][n] / 1000:.2f} s, shift {page['shift'][n]:.3f}; machine 4500; "
                         f"main thread: script evaluation 165")
    lines.append(f"{stamp}| Page | Load (largest content) | Busy time (blocking) | Layout shift | Code | Total download | Text contrast |")
    lines.append(f"{stamp}|---|---|---|---|---|---|---|")
    for path, page in pages.items():
        if page.get("table", True):
            v = page.get("verdicts", OK * 5)
            lines.append(f"{stamp}| `{path}` | {v[0]} 0.78 s / 2.50 s | {v[1]} 29 ms / 200 ms | {v[2]} 0.000 / 0.10 | "
                         f"{v[3]} {page['code']:.1f} KB / 200 KB | {v[4]} {page['total']:.1f} KB / 500 KB | "
                         f"{page.get('contrast', OK + ' light and dark')} |")
    return "\n".join(colour + line for line in lines) + "\n"


def page(busy=40, load=800, shift=0.0, code=140.0, total=170.0, **more):
    return {"busy": [busy] * 5, "load": [load] * 5, "shift": [shift] * 5, "code": code, "total": total, **more}


class Corpus(unittest.TestCase):
    """Checks in groups: a group's checks share a made-up git tree, so they are noise for one another."""

    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(self.folder, ignore_errors=True))
        self.jobs, self.trees = [], {}

    def add(self, group, pages, minutes=None):
        number = len(self.jobs) + 1
        sha = f"{number:040x}"
        self.jobs.append({"job": 1000 + number, "sha": sha, "started": f"2026-11-1{group % 9}T10:{number % 60:02d}:00Z"})
        self.trees[sha] = f"{group:040x}"  # the same tree for the whole group
        with open(os.path.join(self.folder, f"{1000 + number}.log"), "w") as f:
            f.write(log_text(pages))
        return number - 1

    def git(self, command, **kw):
        """A stand-in for `git rev-parse <sha>:<path> ...`: one tree per input, the website's by group."""
        shas = {arg.split(":")[0] for arg in command[4:]}
        sha = shas.pop()
        if sha not in self.trees:
            return types.SimpleNamespace(returncode=128, stdout="")
        paths = [arg.split(":", 1)[1] for arg in command[4:]]
        trees = [self.trees[sha] if path == "product/web" else "f" * 40 for path in paths]
        return types.SimpleNamespace(returncode=0, stdout="\n".join(trees) + "\n")

    def checks(self):
        return sa.read_checks(self.folder, self.jobs)

    def groups(self):
        return sa.groups_of(self.checks(), "repo", self.git)

    def quiet_corpus(self, groups=6, size=5):
        """`groups` groups of `size` checks whose medians wobble a little: busy within 5 ms, load within 10 ms."""
        wobble = [0, 3, -2, 5, 1]
        for group in range(1, groups + 1):
            for n in range(size):
                self.add(group, {p: page(busy=40 + wobble[n], load=800 + 2 * wobble[n]) for p in PAGES})


class TheLogs(unittest.TestCase):
    def test_runs_become_medians_and_the_table_gives_verdicts_sizes_and_contrast(self):
        text = log_text({"/a": {"busy": [10, 50, 30, 20, 40], "load": [700, 900, 800, 750, 850],
                                "shift": [0.0, 0.01, 0.02, 0.03, 0.04], "code": 140.7, "total": 178.5,
                                "verdicts": OK + OK + OK + OK + NOT_OK, "contrast": NOT_OK + " dark"}})
        found = sa.parse(text)["/a"]
        self.assertEqual(found["med"], {"busy": 30, "load": 800, "shift": 0.02})
        self.assertEqual((found["code_kb"], found["total_kb"]), (140.7, 178.5))
        self.assertEqual(found["verdicts"], OK * 4 + NOT_OK)
        self.assertEqual(found["contrast"], NOT_OK + " dark")
        self.assertEqual(len(found["runs"]), 5)

    def test_timestamps_and_colour_codes_are_ignored(self):
        plain = sa.parse(log_text({"/a": page(busy=33)}, stamp=""))
        stamped = sa.parse(log_text({"/a": page(busy=33)}, stamp="2026-11-12T10:00:00.1234567Z ", colour="\x1b[36;1m"))
        self.assertEqual(plain, stamped)
        self.assertEqual(plain["/a"]["med"]["busy"], 33)

    def test_a_page_without_all_five_runs_is_left_out_and_a_page_without_a_table_row_has_no_sizes(self):
        text = log_text({"/a": page(), "/b": page(table=False)})
        text = text.replace("  /a: run 5 of 5", "  /a: run 9 of 5")  # /a's fifth run is missing
        found = sa.parse(text)
        self.assertNotIn("/a", found)
        self.assertEqual(sorted(found["/b"]), ["med", "runs"])  # measured, but the check's table didn't have it

    def test_load_is_taken_as_logged_to_ten_milliseconds(self):
        self.assertEqual(sa.parse(log_text({"/a": page(load=781)}))["/a"]["med"]["load"], 780)

    def test_only_jobs_with_a_log_and_at_least_eight_pages_are_checks(self):
        corpus = Corpus()
        corpus.setUp()
        corpus.add(1, {p: page() for p in PAGES})
        corpus.add(1, {p: page() for p in PAGES[:7]})  # seven pages: not a check
        corpus.jobs.append({"job": 9999, "sha": "0" * 40, "started": "2026-11-12T10:00:00Z"})  # no log
        self.assertEqual(len(corpus.checks()), 1)


class TheGroups(Corpus):
    def test_checks_of_the_same_website_inputs_form_a_group_and_a_pair_for_each_two(self):
        for group in (1, 1, 1, 2, 2, 3):
            self.add(group, {p: page() for p in PAGES})
        groups = self.groups()
        self.assertEqual(sorted(len(found) for found in groups.values()), [2, 3])  # group 3 has one check
        self.assertEqual(len(sa.noise_pairs(groups)), 3 + 1)

    def test_a_commit_git_doesnt_have_never_joins_a_group(self):
        self.add(1, {p: page() for p in PAGES})
        self.add(1, {p: page() for p in PAGES})
        self.trees.pop(self.jobs[1]["sha"])
        self.assertEqual(self.groups(), {})

    def test_the_trees_asked_for_are_the_websites_inputs(self):
        asked = []

        def run(command, **kw):
            asked.append(command)
            return types.SimpleNamespace(returncode=0, stdout="a\nb\nc\nd\n")

        self.assertEqual(sa.fingerprint("repo", "abc", run), ("a", "b", "c", "d"))
        self.assertEqual(asked[0][:4], ["git", "-C", "repo", "rev-parse"])
        self.assertEqual([a.split(":", 1)[1] for a in asked[0][4:]],
                         ["product/web", "product/packages", "agreement", "pnpm-lock.yaml"])


class TheStatistic(Corpus):
    def allowances(self, **kw):
        checks = self.checks()
        return checks, sa.allowances(checks, sa.noise_pairs(self.groups()), **kw)

    def test_identical_checks_give_the_floors_and_nothing_less(self):
        for group in (1, 1, 2, 2):
            self.add(group, {p: page() for p in PAGES})
        _, allow = self.allowances()
        self.assertEqual(allow["/p0"], {"busy": 20.0, "load": 50.0, "shift": 0.005, "code": 0.5, "total": 1.0})
        self.assertEqual(allow["*"], allow["/p0"])

    def test_the_allowance_is_twice_the_largest_difference_when_that_is_above_the_floor(self):
        for n, busy in enumerate((40, 140, 70, 40, 60, 45, 50, 41)):  # one group of 8: 28 pairs, every page
            self.add(1, {p: page(busy=busy) for p in PAGES})
        _, allow = self.allowances()
        self.assertEqual(allow["/p0"]["busy"], 200.0)  # |140 - 40| = 100, doubled
        _, wider = self.allowances(margin=3.0)
        self.assertEqual(wider["/p0"]["busy"], 300.0)

    def test_a_page_with_fewer_than_ten_pairs_takes_the_pooled_value(self):
        # Eight pages in four groups of four, 24 pairs; a ninth page only in one group of four: six pairs.
        for group in (1, 2, 3, 4):
            for n in range(4):
                pages = {p: page(busy=40 + (80 * n if group == 1 else 0)) for p in PAGES}
                if group == 4:
                    pages["/rare"] = page(busy=40 + 5 * n)
                self.add(group, pages)
        _, allow = self.allowances()
        # /p0 has 24 pairs (its own largest difference, 3 x 80 = 240, doubled); /rare has six, so the pooled 480.
        self.assertEqual(allow["/p0"]["busy"], 480.0)
        self.assertEqual(allow["/rare"]["busy"], allow["*"]["busy"])
        self.assertEqual(allow["*"]["busy"], 480.0)

    def test_sizes_are_kept_in_kilobytes_and_written_in_bytes_with_a_floor_of_512_and_1024(self):
        for n in range(4):
            self.add(1, {p: page(code=140.0 + 0.2 * n, total=170.0) for p in PAGES})
        checks, allow = self.allowances()
        self.assertAlmostEqual(allow["/p0"]["code"], 1.2)  # 3 x 0.2 KB apart, doubled: past the 0.5 KB floor
        row = sa.row(allow, "/p0", {"/p0": 6})
        self.assertEqual((row["codeBytes"], row["totalBytes"], row["noisePairs"]), (1229, 1024, 6))

    def test_a_check_is_clean_against_another_only_within_the_allowances_and_with_equal_verdicts(self):
        self.add(1, {p: page() for p in PAGES})
        self.add(1, {p: page(busy=55) for p in PAGES})
        self.add(1, {p: page(verdicts=OK * 4 + NOT_OK) for p in PAGES})
        self.add(1, {p: page(contrast=NOT_OK + " light") for p in PAGES})
        checks = self.checks()
        floors = sa.allowances(checks, [], 2.0)
        self.assertEqual(floors["*"]["busy"], 20.0)
        self.assertTrue(sa.clean(checks, 0, 1, floors))  # 15 ms apart, inside 20
        self.assertFalse(sa.clean(checks, 0, 2, floors))  # a verdict differs
        self.assertFalse(sa.clean(checks, 0, 3, floors))  # the contrast differs
        wide = {"*": {**floors["*"], "busy": 10.0}}
        self.assertFalse(sa.clean(checks, 0, 1, wide))  # 15 ms is outside 10


class TheProof(Corpus):
    def test_checks_that_wobble_a_little_are_all_clean_leaving_both_checks_out(self):
        self.quiet_corpus()
        checks, groups = self.checks(), self.groups()
        pairs = sa.noise_pairs(groups)
        self.assertEqual(len(pairs), 60)
        self.assertEqual(sa.leave_both_checks_out(checks, pairs), 60)
        self.assertEqual(sa.leave_the_group_out(checks, groups, pairs), 60)
        self.assertEqual(sa.time_split(checks, groups, pairs), (30, 30))

    def test_an_outlier_check_is_not_clean_when_it_is_left_out_of_its_own_allowances(self):
        self.quiet_corpus(groups=4, size=3)
        self.add(9, {p: page(busy=40) for p in PAGES})
        self.add(9, {p: page(busy=900) for p in PAGES})  # a pair that differs by 860 ms
        checks, groups = self.checks(), self.groups()
        pairs = sa.noise_pairs(groups)
        clean = sa.leave_both_checks_out(checks, pairs)
        self.assertEqual((clean, len(pairs)), (len(pairs) - 1, len(pairs)))

    def test_consecutive_checks_with_equal_verdicts_flip_nothing_and_a_different_one_flips(self):
        self.add(1, {p: page() for p in PAGES})
        self.add(2, {p: page(busy=159) for p in PAGES})
        self.assertEqual(sa.verdict_flips(self.checks()), (0, 8, 159))
        self.add(3, {p: page(verdicts=OK * 4 + NOT_OK) for p in PAGES})
        self.assertEqual(sa.verdict_flips(self.checks())[:2], (8, 16))

    def test_the_limits_for_the_average_come_from_a_seeded_draw_and_need_five_groups(self):
        self.quiet_corpus()
        checks, groups = self.checks(), self.groups()
        pairs = sa.noise_pairs(groups)
        first, _ = sa.five_comparison_average(checks, groups, pairs, samples=500)
        again, _ = sa.five_comparison_average(checks, groups, pairs, samples=500)
        self.assertEqual(first, again)
        self.assertTrue(0 < first["busy"] < 10 and 0 < first["load"] < 20, first)
        few = {key: found for key, found in list(groups.items())[:4]}
        self.assertEqual(sa.five_comparison_average(checks, few, sa.noise_pairs(few)), (None, None))

    def test_a_shift_added_to_one_page_is_flagged_by_the_allowances(self):
        self.quiet_corpus()
        checks = self.checks()
        pairs = sa.noise_pairs(self.groups())
        shares = sa.injected(checks, pairs, "busy", (10, 200))
        self.assertLess(shares[10], 0.2)  # inside the 20 ms floor, mostly
        self.assertEqual(shares[200], 1.0)


class TheFile(Corpus):
    def run_main(self, out, git=None):
        jobs_file = os.path.join(self.folder, "jobs.json")
        with open(jobs_file, "w") as f:
            json.dump(self.jobs, f)
        with contextlib.redirect_stderr(io.StringIO()) as said:
            code = sa.main([self.folder, jobs_file, "repo", out], run=git or self.git)
        return code, said.getvalue()

    def test_the_file_has_the_sections_the_comparison_reads(self):
        self.quiet_corpus()
        out = os.path.join(self.folder, "allowances.json")
        code, said = self.run_main(out)
        self.assertEqual(code, 0, said)
        with open(out) as f:
            written = json.load(f)
        self.assertEqual(sorted(written), ["about", "computed", "fiveComparisonAverage", "method", "pages", "pooled",
                                           "proof", "source"])
        self.assertEqual(written["method"]["margin"], 2.0)
        self.assertEqual(written["method"]["floors"], {"busyMs": 20, "loadMs": 50, "shift": 0.005,
                                                       "codeBytes": 512, "totalBytes": 1024})
        self.assertEqual((written["source"]["checks"], written["source"]["noisePairs"], written["source"]["groups"]),
                         (30, 60, 6))
        self.assertEqual(len(written["source"]["jobs"]), 30)
        self.assertEqual(sorted(written["pages"]), sorted(PAGES))
        self.assertEqual(written["pages"]["/p0"], {"busyMs": 20, "loadMs": 50, "shift": 0.005, "codeBytes": 512,
                                                   "totalBytes": 1024, "noisePairs": 60})
        self.assertEqual(sorted(written["pooled"]), ["busyMs", "codeBytes", "loadMs", "shift", "totalBytes"])
        self.assertIn("60 of 60 noise pairs clean (100.0%)", written["proof"]["leaveBothChecksOut"])
        self.assertTrue(set(written["fiveComparisonAverage"]) == {"busyMs", "loadMs"})
        self.assertIn("never edit a value by hand", written["about"])

    def test_the_file_is_refused_when_the_proof_is_under_95_percent(self):
        self.quiet_corpus(groups=4, size=3)
        self.add(9, {p: page(busy=40) for p in PAGES})
        self.add(9, {p: page(busy=900) for p in PAGES})
        checks, groups = self.checks(), self.groups()
        content, lines = sa.build(checks, groups, needed=0.99)
        self.assertIsNone(content)
        self.assertTrue(any("under 99%" in line for line in lines), lines)
        content, _ = sa.build(checks, groups)  # 12 of 13 is 92%: under the real 95% too
        self.assertIsNone(content)
        out = os.path.join(self.folder, "allowances.json")
        code, said = self.run_main(out)
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(out))
        self.assertIn("no file is written", said)

    def test_no_noise_to_measure_writes_nothing(self):
        for group in (1, 2, 3):
            self.add(group, {p: page() for p in PAGES})  # every check alone in its group
        out = os.path.join(self.folder, "allowances.json")
        code, said = self.run_main(out)
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(out))
        self.assertIn("no noise to measure", said)

    def test_a_folder_with_no_logs_is_an_error(self):
        out = os.path.join(self.folder, "allowances.json")
        self.assertEqual(self.run_main(out)[0], 1)

    def test_the_command_line_is_checked(self):
        for argv in ([], ["a"], ["a", "b"], ["a", "b", "c", "d", "e"]):
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    sa.main(argv)


class TheCommittedFile(unittest.TestCase):
    """product/web/e2e/speed-allowances.json is what this script writes: its shape, never its numbers."""

    def test_it_has_every_section_and_every_page_lists_every_number(self):
        here = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(os.path.dirname(os.path.dirname(here)), "product", "web", "e2e", "speed-allowances.json")
        with open(path, encoding="utf-8") as f:
            written = json.load(f)
        self.assertEqual(sorted(written), ["about", "computed", "fiveComparisonAverage", "method", "pages", "pooled",
                                           "proof", "source"])
        self.assertEqual(written["source"]["checks"], len(written["source"]["jobs"]))
        for name, entry in {**written["pages"], "pooled": written["pooled"]}.items():
            for key in ("busyMs", "loadMs", "shift", "codeBytes", "totalBytes"):
                self.assertGreater(entry[key], 0, f"{name}: {key}")
        self.assertEqual(written["method"]["margin"], 2.0)


if __name__ == "__main__":
    unittest.main()
