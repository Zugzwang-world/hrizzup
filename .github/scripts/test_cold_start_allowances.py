"""Tests for cold_start_allowances.py, which works out product/app/journeys/cold-start-allowances.json: offline.

    python3 -m unittest discover -s .github/scripts

The allowance is worked out from App journeys' real runs, so the tests use fixture log lines, a stubbed
`git` and runs made up to have known differences:

  - reading a log: the seven cold starts, the 4th of seven as the median, colour codes and timestamps,
    a log that stops early, an expired log, the cold-start verdict and the failures it shows;
  - the jobs: oldest first, a job GitHub lists again under a later attempt counted once;
  - the groups: the files App journeys' built-app key is made from, so a change to the journeys or the
    app's scripts leaves a run in its group and a change to the app moves it out;
  - the statistic: the floor, the margin, leaving both runs out, leaving the group out, the five-comparison
    average (seeded, so the same runs give the same number) and the refusal under 95%;
  - the committed file's method says what the script does.

Python's standard library only.
"""
import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest

import cold_start_allowances as csa

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COMMITTED = os.path.join(ROOT, "product", "app", "journeys", "cold-start-allowances.json")
STAMP = "2026-11-17T10:00:00.1234567Z "
GREEN, RED = "✅", "❌"


def log(times, verdict=GREEN, extra=()):
    """A job's log: timestamps and colour codes as GitHub gives them, the cold start's lines and its row."""
    lines = [f"{STAMP}\x1b[36;1mbash product/app/journeys/emulator.sh run\x1b[0m"]
    lines += [f"{STAMP}Cold start {n} of 7: first content after {ms} ms" for n, ms in enumerate(times, 1)]
    if verdict:
        lines.append(f"{STAMP}| App, cold start to first content (CI emulator; the 2.00 s budget is a phone's) | "
                     f"{verdict} 1.65 s; main: 1.20 s, +37% |")
    return "\n".join(lines + list(extra)) + "\n"


def seven(median):
    """Seven cold starts, in no particular order, whose 4th smallest is `median`."""
    return [median + 300, median - 100, median, median + 150, median - 200, median + 50, median - 50][::-1]


class TheLogs(unittest.TestCase):
    def test_the_median_is_the_4th_of_the_seven(self):
        found = csa.parse(log([1964, 1823, 1571, 1645, 1233, 1188, 1648]))
        self.assertEqual(found["cold"], [1964, 1823, 1571, 1645, 1233, 1188, 1648])
        self.assertEqual(found["median"], 1645)  # sorted: 1188 1233 1571 [1645] 1648 1823 1964
        self.assertEqual(found["verdict"], GREEN)
        self.assertFalse(found["cold_failed"])

    def test_a_pull_requests_checkout_line_gives_the_head_and_base_it_merged(self):
        head, base = "a" * 40, "b" * 40
        text = (f"{STAMP}HEAD is now at cd3f37c Merge {head} into {base}\n" + log(seven(1000)))
        self.assertEqual(csa.parse(text)["merge"], (head, base))
        self.assertIsNone(csa.parse(log(seven(1000)))["merge"])
        self.assertIsNone(csa.parse(f"{STAMP}HEAD is now at cd3f37c Merge {head[:39]} into {base}\n")["merge"])  # not a commit
        first = csa.parse(f"{STAMP}Merge {head} into {base}\n{STAMP}Merge {base} into {head}\n")["merge"]
        self.assertEqual(first, (head, base))  # the checkout's line is the first

    def test_the_seven_are_taken_by_their_number_not_their_order_in_the_log(self):
        lines = [f"{STAMP}Cold start {n} of 7: first content after {ms} ms"
                 for n, ms in ((3, 30), (1, 10), (2, 20), (7, 70), (4, 40), (6, 60), (5, 50))]
        self.assertEqual(csa.parse("\n".join(lines))["cold"], [10, 20, 30, 40, 50, 60, 70])

    def test_a_log_that_stops_before_the_seventh_has_no_cold_start(self):
        for count in (0, 1, 6):
            with self.subTest(count=count):
                found = csa.parse(log(seven(1000)[:count]))
                self.assertEqual((found["cold"], found["median"]), ([], None))

    def test_the_verdict_marks_and_the_failures_a_log_shows(self):
        self.assertEqual(csa.parse(log(seven(1000), verdict=RED))["verdict"], RED)
        self.assertIsNone(csa.parse(log(seven(1000), verdict=None))["verdict"])
        failed = csa.parse(f"{STAMP}Run 3: couldn't read the start or the first content from Android's log\n")
        self.assertTrue(failed["cold_failed"])
        flows = csa.parse(f"{STAMP}[Passed] A flow (4s)\n{STAMP}[Failed] B flow (39s) (No visible element)\n"
                          f"{STAMP}[Failed] C flow (3s)\n")
        self.assertEqual(flows["flows_failed"], 2)

    def test_a_log_gives_no_run_unless_it_is_a_real_log(self):
        with tempfile.TemporaryDirectory() as folder:
            for name, text in (("1", log(seven(1000))), ("2", '{"message":"Not Found","status":"404"}')):
                with open(os.path.join(folder, f"{name}.log"), "w") as f:
                    f.write(text + " " * (1000 if name == "1" else 0))
            jobs = [{"job": 1, "sha": "a", "started": "2026-11-10T10:00:00Z"},
                    {"job": 2, "sha": "b", "started": "2026-11-10T11:00:00Z"},
                    {"job": 3, "sha": "c", "started": "2026-11-10T12:00:00Z"}]  # no file at all
            runs, dropped, parsed = csa.read_logs(folder, jobs)
        self.assertEqual([r["job"] for r in runs], [1])
        self.assertEqual(dropped, 0)
        self.assertIsNone(parsed[2])
        self.assertIsNone(parsed[3])

    def test_the_runs_come_oldest_first_and_a_job_listed_again_under_a_later_attempt_counts_once(self):
        with tempfile.TemporaryDirectory() as folder:
            same, other = log(seven(1000)), log(seven(1400))
            for job, text in ((10, same), (11, same), (12, other), (13, same)):
                with open(os.path.join(folder, f"{job}.log"), "w") as f:
                    f.write(text * 20)  # long enough to be a log
            jobs = [{"job": 12, "sha": "c", "started": "2026-11-12T00:00:00Z"},
                    {"job": 10, "sha": "a", "started": "2026-11-10T00:00:00Z"},
                    {"job": 11, "sha": "a", "started": "2026-11-10T00:00:00Z"},   # the same start and seven: a repeat
                    {"job": 13, "sha": "a", "started": "2026-11-11T00:00:00Z"}]  # the same seven, another start: a run
            runs, dropped, _ = csa.read_logs(folder, jobs)
        self.assertEqual([r["job"] for r in runs], [10, 13, 12])
        self.assertEqual(dropped, 1)


def tree(*files):
    """`git ls-tree -r` output: a mode, a type, the file's hash, a tab and its path."""
    return "".join(f"100644 blob {digest}\t{path}\n" for path, digest in files)


APP = [("product/app/src/home.ts", "aaa"), ("product/packages/core/index.ts", "bbb"), ("pnpm-lock.yaml", "ccc"),
       (".node-version", "ddd")]
EXCLUDED = [("product/app/journeys/run.sh", "e1"), ("product/app/scripts/check.ts", "e2"),
            ("product/app/bundle-limit.json", "e3"), ("product/app/vitest.config.ts", "e4")]


def stub_git(trees):
    """A `run` that answers `git ls-tree` from {sha: output}, and records what it was asked."""
    asked = []

    def run(command, **kw):
        asked.append(command)
        sha = command[command.index("-r") + 1]
        out = trees.get(sha)
        return subprocess.CompletedProcess(command, 0 if out is not None else 128, out or "", "")

    run.asked = asked
    return run


class TheGroups(unittest.TestCase):
    def test_what_the_built_app_key_leaves_out_does_not_move_a_run_to_another_group(self):
        base = tree(*APP)
        run = stub_git({"a": base, "b": base + tree(*EXCLUDED), "c": base + tree(("product/app/journeys/new.yaml", "e9")),
                        "d": tree(*APP[:1], ("product/packages/core/index.ts", "CHANGED"), *APP[2:])})
        same = csa.fingerprint("repo", "a", run)
        self.assertEqual(csa.fingerprint("repo", "b", run), same)
        self.assertEqual(csa.fingerprint("repo", "c", run), same)
        self.assertNotEqual(csa.fingerprint("repo", "d", run), same)
        self.assertEqual(run.asked[0], ["git", "-C", "repo", "ls-tree", "-r", "a", "--", "product/app",
                                        "product/packages", "pnpm-lock.yaml", ".node-version"])

    def test_a_change_in_each_excluded_path_is_ignored_and_in_the_apps_own_files_is_not(self):
        base = tree(*APP)
        for path, _ in EXCLUDED:
            with self.subTest(path=path):
                run = stub_git({"a": base + tree((path, "1")), "b": base + tree((path, "2"))})
                self.assertEqual(csa.fingerprint("repo", "a", run), csa.fingerprint("repo", "b", run))
        for index in range(len(APP)):
            with self.subTest(file=APP[index][0]):
                changed = [(p, "x" if n == index else h) for n, (p, h) in enumerate(APP)]
                run = stub_git({"a": base, "b": tree(*changed)})
                self.assertNotEqual(csa.fingerprint("repo", "a", run), csa.fingerprint("repo", "b", run))

    def test_a_commit_that_isnt_there_or_has_no_app_has_no_fingerprint(self):
        run = stub_git({"empty": "", "has": tree(*APP)})
        self.assertIsNone(csa.fingerprint("repo", "missing", run))
        self.assertIsNone(csa.fingerprint("repo", "empty", run))
        self.assertIsNotNone(csa.fingerprint("repo", "has", run))

    def test_groups_are_two_or_more_runs_of_the_same_app_and_pairs_are_every_two_of_a_group(self):
        one, two = tree(*APP), tree(*APP[:3], (".node-version", "other"))
        run = stub_git({"a": one, "b": one, "c": one, "d": two, "e": two, "f": tree(*APP[:2])})
        runs = [{"sha": sha} for sha in ("a", "d", "b", "f", "e", "c", "gone")]
        groups, unkeyed = csa.groups_of(runs, "repo", run)
        self.assertEqual(sorted(sorted(found) for found in groups.values()), [[0, 2, 5], [1, 4]])
        self.assertEqual(sorted(csa.noise_pairs(groups)), [(0, 2), (0, 5), (1, 4), (2, 5)])
        self.assertEqual(unkeyed, 1)  # the commit that isn't in the clone

    def test_a_pull_requests_run_is_keyed_by_the_app_at_its_head_and_at_its_base_a_main_run_by_its_own_commit(self):
        # Heads h1 and h2 change the app the same way from the same base b1: the same merge. Head h3 is the same
        # change from another base b2 (main moved): another merge, so another group. A main run at b1 and a pull
        # request that changed none of the app's files (head and base the same inputs) built the same app.
        base1 = tree(*APP)
        base2 = tree(*APP[:1], ("product/packages/core/index.ts", "MOVED"), *APP[2:])
        changed1 = tree(("product/app/src/home.ts", "NEW"), *APP[1:])
        run = stub_git({"h1": changed1, "h2": changed1 + tree(*EXCLUDED), "h3": changed1, "b1": base1, "b2": base2,
                        "m1": base1, "h4": base1 + tree(("product/app/journeys/new.yaml", "e9"))})
        pr = lambda head, base: {"event": "pull_request", "sha": head, "merge": (head, base)}
        runs = [pr("h1", "b1"), pr("h2", "b1"), pr("h3", "b2"), {"event": "push", "sha": "m1"}, pr("h4", "b1"),
                {"event": "push", "sha": "b2"}]
        groups, unkeyed = csa.groups_of(runs, "repo", run)
        self.assertEqual(sorted(sorted(found) for found in groups.values()), [[0, 1], [3, 4]])
        self.assertEqual(unkeyed, 0)
        self.assertEqual(csa.group_key(runs[2], "repo", run)[0], csa.group_key(runs[0], "repo", run)[0])  # same head
        self.assertNotEqual(csa.group_key(runs[2], "repo", run), csa.group_key(runs[0], "repo", run))      # not same base
        pair = csa.group_key(runs[3], "repo", run)
        self.assertEqual(pair[0], pair[1])  # a main run's key is its own inputs twice

    def test_a_pull_request_run_with_no_merge_line_or_a_base_that_isnt_there_is_left_out_of_every_group(self):
        base = tree(*APP)
        run = stub_git({"h": base, "b": base, "m": base})
        runs = [{"event": "pull_request", "sha": "h"},                              # no merge line in its log
                {"event": "pull_request", "sha": "h", "merge": ("h", "gone")},      # a base the clone doesn't have
                {"event": "pull_request", "sha": "h", "merge": ("h", "b")},
                {"event": "push", "sha": "m"}]
        groups, unkeyed = csa.groups_of(runs, "repo", run)
        self.assertEqual(unkeyed, 2)
        self.assertEqual(sorted(sorted(found) for found in groups.values()), [[2, 3]])
        # A job file with no events keys a run by its log: a merge line means a pull request, none a main run.
        groups, unkeyed = csa.groups_of([{"sha": "h", "merge": ("h", "b")}, {"sha": "m"}], "repo", run)
        self.assertEqual((sorted(sorted(found) for found in groups.values()), unkeyed), ([[0, 1]], 0))


def runs_of(*medians):
    return [{"median": m, "cold": seven(m), "started": f"2026-11-{n + 1:02d}T00:00:00Z", "job": n}
            for n, m in enumerate(medians)]


class TheStatistic(unittest.TestCase):
    def test_the_allowance_is_the_floor_or_the_largest_difference_times_the_margin(self):
        runs = runs_of(1000, 1100, 1500, 1520)
        self.assertEqual(csa.allowance(runs, [(0, 1)]), 100)           # exactly the floor
        self.assertEqual(csa.allowance(runs, [(2, 3)]), 100)           # 20 ms apart: the floor
        self.assertEqual(csa.allowance(runs, [(0, 1), (0, 2), (2, 3)]), 500)
        self.assertEqual(csa.allowance(runs, [(0, 2)], margin=1.5), 750)
        self.assertEqual(csa.allowance(runs, []), 100)

    def test_leaving_both_runs_out_judges_each_pair_by_the_pairs_that_share_neither(self):
        # One group of three and one of two. The pair (0, 2) is 400 apart; the pairs sharing neither 0 nor 2 are
        # (3, 4), 300 apart: the allowance is 300, so (0, 2) is not clean. (3, 4) is judged by the largest of the
        # group of three's pairs, 400: clean. (0, 1) is 100 apart and (1, 2) 300: both clean.
        runs = runs_of(1000, 1100, 1400, 2000, 2300)
        pairs = [(0, 1), (0, 2), (1, 2), (3, 4)]
        self.assertEqual(csa.leave_both_runs_out(runs, pairs), 3)
        self.assertEqual(csa.leave_both_runs_out(runs, pairs, margin=2.0), 4)  # twice 300 covers 400
        groups = {"x": [0, 1, 2], "y": [3, 4]}
        self.assertEqual(csa.leave_the_group_out(runs, groups, pairs), 3)  # the group of three, by (3, 4) alone: 300
        self.assertEqual(csa.leave_the_group_out(runs, groups, pairs, margin=2.0), 4)

    def test_the_old_rule_counts_a_median_inside_the_other_runs_seven(self):
        runs = [{"median": 1000, "cold": [900, 1000, 1100, 1000, 950, 1050, 1000]},
                {"median": 1090, "cold": [900, 1000, 1100, 1000, 950, 1050, 1000]},
                {"median": 1500, "cold": [1400, 1500, 1600, 1500, 1450, 1550, 1500]}]
        self.assertEqual(csa.old_rule(runs, [(0, 1), (0, 2)]), 1)

    def test_a_shift_added_to_every_pair_is_flagged_once_it_passes_the_allowance(self):
        runs = runs_of(1000, 1200, 2000, 2200, 3000, 3200)
        pairs = [(0, 1), (2, 3), (4, 5)]  # every pair 200 apart: every allowance is 200
        self.assertEqual(csa.injected(runs, pairs, 0), 0.0)
        self.assertEqual(csa.injected(runs, pairs, 100), 1.0)   # +100 makes 300 against 200
        self.assertEqual(csa.injected(runs, pairs, -500), 1.0)  # -300 against 200: flagged
        self.assertEqual(csa.injected(runs, pairs, -400), 0.0)  # -200 against 200: at the allowance, inside

    def test_the_five_comparison_limit_is_the_99_9th_percentile_of_five_pairs_with_random_signs(self):
        # Six groups of two runs, every pair 300 apart: the mean of five signed differences is 300 only when all
        # five signs agree (1 in 16), so the 99.9th percentile of its size is 300, and a shift of +100 on top of
        # all-negative signs shows (-300 + 100 is inside), and +100 on all-positive passes the limit.
        medians = []
        for n in range(6):
            medians += [1000 + 100 * n, 1300 + 100 * n]
        runs = runs_of(*medians)
        groups = {n: [2 * n, 2 * n + 1] for n in range(6)}
        pairs = csa.noise_pairs(groups)
        limit, means = csa.five_comparison_average(runs, groups, pairs)
        self.assertEqual(limit, 300)
        self.assertEqual(len(means), csa.SAMPLES)
        self.assertEqual(sorted({round(abs(m)) for m in means}), [60, 180, 300])
        again, same = csa.five_comparison_average(runs, groups, pairs)
        self.assertEqual((again, means == same), (limit, True))  # seeded: the same runs give the same number
        other, _ = csa.five_comparison_average(runs, groups, pairs, seed=1)
        self.assertEqual(other, 300)

    def test_fewer_than_five_groups_cant_set_the_five_comparison_limit(self):
        runs = runs_of(1000, 1100, 2000, 2100, 3000, 3100)
        groups = {n: [2 * n, 2 * n + 1] for n in range(3)}
        self.assertEqual(csa.five_comparison_average(runs, groups, csa.noise_pairs(groups)), (None, None))


def run_log(median, verdict=GREEN):
    return log(seven(median), verdict=verdict)


def hexed(n, k):
    return f"{n:02x}{k:x}".ljust(40, "0")


def write_run(folder, job, median, merge=None, **kw):
    prefix = f"{STAMP}HEAD is now at cd3f37c Merge {merge[0]} into {merge[1]}\n" if merge else ""
    with open(os.path.join(folder, f"{job}.log"), "w", encoding="utf-8") as f:
        f.write(prefix + run_log(median, **kw) * 10)


def six_groups(spreads):
    """(jobs, trees): six groups of two runs each, the pair's medians `spread` apart: a main run (job 100+2n) and a
    pull request's (101+2n) that changed none of the app's files, so they built the same app. The pull request's
    merge is its head and base, which have the same inputs as the main run's commit."""
    jobs, trees = [], {}
    for n, spread in enumerate(spreads):
        inputs = tree(*APP[:1], (f"product/app/src/group{n}.ts", "x"), *APP[1:])
        main, head, base = hexed(n, 0), hexed(n, 1), hexed(n, 2)
        trees.update({main: inputs, head: inputs, base: inputs})
        for k, (sha, event) in enumerate(((main, "push"), (head, "pull_request"))):
            jobs.append({"job": 100 + 2 * n + k, "sha": sha, "event": event, "started": f"2026-11-{n + 1:02d}T0{k}:00:00Z",
                         "median": 1000 + 50 * n + (spread if k else 0), "merge": (head, base) if k else None})
    return jobs, trees


class TheFile(unittest.TestCase):
    def built(self, spreads, **kw):
        jobs, trees = six_groups(spreads)
        with tempfile.TemporaryDirectory() as folder:
            for job in jobs:
                write_run(folder, job["job"], job["median"], job["merge"])
            runs, dropped, parsed = csa.read_logs(folder, [{k: v for k, v in j.items() if k not in ("median", "merge")}
                                                           for j in jobs])
        groups, unkeyed = csa.groups_of(runs, "repo", stub_git(trees))
        return csa.build(runs, groups, jobs, parsed, today="2026-11-18", dropped=dropped, unkeyed=unkeyed, **kw)

    def test_runs_that_differ_by_the_same_amount_give_a_file_with_that_allowance_and_limit(self):
        content, lines = self.built([300] * 6)
        self.assertEqual(content["allowanceMs"], 300)
        self.assertEqual(content["fiveComparisonAverageMs"], 300)
        self.assertEqual(content["computed"], "2026-11-18")
        self.assertEqual(content["source"]["runs"], 12)
        self.assertEqual((content["source"]["noisePairs"], content["source"]["noiseRuns"], content["source"]["groups"]),
                         (6, 12, 6))
        self.assertEqual((content["source"]["pullRequestRuns"], content["source"]["mainRuns"]), (6, 6))
        self.assertEqual(content["source"]["ungroupedRuns"], 0)
        self.assertEqual(content["source"]["jobs"], sorted(content["source"]["jobs"]))
        self.assertIn("6 of 6 noise pairs clean (100.0%)", content["proof"]["leaveBothRunsOut"])
        self.assertEqual(content["proof"]["leaveTheGroupOut"], "6 of 6 (100.0%)")
        self.assertEqual(content["proof"]["coldStartVerdicts"], "all 12 passed against main; no data on how often noise flips one")
        self.assertEqual(content["proof"]["duplicates"], "none: no two runs share a start time or the same seven cold starts")
        self.assertTrue(any("Leave both runs out: 6 of 6" in line for line in lines))

    def test_a_pull_request_run_whose_log_has_no_merge_line_is_left_out_and_counted_as_left_out(self):
        jobs, trees = six_groups([300] * 6)
        jobs[1]["merge"] = None  # group 0's pull request run: no line, so no key
        with tempfile.TemporaryDirectory() as folder:
            for job in jobs:
                write_run(folder, job["job"], job["median"], job["merge"])
            runs, dropped, parsed = csa.read_logs(folder, [{k: v for k, v in j.items() if k not in ("median", "merge")}
                                                           for j in jobs])
        groups, unkeyed = csa.groups_of(runs, "repo", stub_git(trees))
        content, lines = csa.build(runs, groups, jobs, parsed, today="2026-11-18", unkeyed=unkeyed)
        self.assertEqual(content["source"]["ungroupedRuns"], 1)
        self.assertEqual((content["source"]["noisePairs"], content["source"]["groups"]), (5, 5))
        self.assertIn("1 left out of every group", lines[0])

    def test_the_file_is_not_written_when_fewer_than_95_percent_of_the_noise_pairs_are_clean(self):
        # Five groups 100 ms apart and one 1,000 ms apart: the wide one is not clean (the others allow 100) and the
        # others are clean (the wide one allows 1,000), 5 of 6: 83%.
        content, lines = self.built([100, 100, 100, 100, 100, 1000])
        self.assertIsNone(content)
        self.assertTrue(any("under 95%" in line for line in lines), lines)

    def test_no_noise_or_fewer_than_five_groups_writes_nothing_and_says_why(self):
        runs = runs_of(1000, 1100)
        content, lines = csa.build(runs, {}, [], {})
        self.assertIsNone(content)
        self.assertIn("no noise to measure", lines[-1])
        groups = {n: [2 * n, 2 * n + 1] for n in range(3)}
        content, lines = csa.build(runs_of(1000, 1100, 2000, 2100, 3000, 3100), groups, [], {})
        self.assertIsNone(content)
        self.assertIn("Fewer than five groups", lines[-1])

    def test_a_noise_pair_that_is_not_clean_by_a_hair_still_is_not(self):
        runs = runs_of(1000, 1100, 2000, 2101)
        groups = {"a": [0, 1], "b": [2, 3]}
        pairs = csa.noise_pairs(groups)
        self.assertEqual(csa.leave_both_runs_out(runs, pairs), 1)  # (2, 3) is 101 against the other's 100

    def test_the_committed_files_method_says_what_the_script_does(self):
        with open(COMMITTED, encoding="utf-8") as f:
            committed = json.load(f)
        content, _ = self.built([300] * 6)
        for key in ("about", "method"):
            self.assertEqual(committed[key], content[key], key)
        self.assertEqual(list(committed), list(content))
        self.assertEqual(list(committed["source"])[:3] + list(committed["source"])[-4:],
                         list(content["source"])[:3] + list(content["source"])[-4:])
        # The proof's entries are the script's, in its order, and `failures` (which needs the jobs' own conclusions)
        # after the old rule's.
        self.assertEqual([k for k in committed["proof"] if k != "failures"], list(content["proof"]))
        self.assertEqual(list(committed["proof"]).index("failures"), list(committed["proof"]).index("oldRule") + 1)
        self.assertEqual(committed["method"]["margin"], csa.MARGIN)
        self.assertEqual(committed["method"]["floorMs"], csa.FLOOR_MS)
        self.assertEqual(len(committed["source"]["jobs"]), committed["source"]["runs"])

    def test_the_failures_are_told_as_the_log_shows_them_and_as_a_person_found_them(self):
        parsed = {1: None, 2: csa.parse(f"{STAMP}Run 2: couldn't read the start or the first content from Android's log\n"),
                  3: csa.parse(f"{STAMP}[Failed] The sign-in test (39s)\n"), 4: csa.parse(log(seven(1000))),
                  5: csa.parse(f"{STAMP}[Failed] Another (3s)\n"), 6: csa.parse(log(seven(1100)))}
        jobs = [{"job": 1, "started": "2026-11-08T20:50:39Z", "journeys": "failure"},
                {"job": 2, "started": "2026-11-09T21:34:19Z", "journeys": "failure"},
                {"job": 3, "started": "2026-11-10T08:01:41Z", "journeys": "failure",
                 "cause": "a change in progress (the sign-in test screen being built)"},
                {"job": 4, "started": "2026-11-10T09:00:00Z", "journeys": "success"},
                {"job": 6, "started": "2026-11-10T10:00:00Z", "journeys": "success"}]
        self.assertEqual(csa.failures(jobs, parsed, []),
                         "of all 5 jobs whose journeys ran, 3 failed: 1 with no log, 1 the cold-start step itself "
                         "(9 November: couldn't read the start or the first content from Android's log), 1 a change in "
                         "progress (the sign-in test screen being built); in the 3 runs that reached the cold start it "
                         "failed once, and no flow failed by itself")
        jobs.append({"job": 5, "started": "2026-11-11T00:00:00Z", "journeys": "failure"})
        said = csa.failures(jobs, parsed, [])
        self.assertIn("1 a flow failed with no cause given", said)
        self.assertTrue(said.endswith("and 1 flow(s) failed by itself"), said)
        self.assertIsNone(csa.failures([{"job": 1, "started": "2026-11-08T00:00:00Z"}], {}, []))


class TheCommand(unittest.TestCase):
    def run_command(self, spreads, output=True):
        jobs, trees = six_groups(spreads)
        with tempfile.TemporaryDirectory() as folder:
            logs = os.path.join(folder, "logs")
            os.makedirs(logs)
            for job in jobs:
                write_run(logs, job["job"], job["median"], job["merge"])
            jobs_file = os.path.join(folder, "jobs.json")
            with open(jobs_file, "w") as f:
                json.dump([{k: v for k, v in j.items() if k not in ("median", "merge")} for j in jobs], f)
            out = os.path.join(folder, "allowances.json")
            with contextlib.redirect_stderr(io.StringIO()) as said:
                code = csa.main([logs, jobs_file, "repo", out], run=stub_git(trees))
            written = None
            if os.path.exists(out):
                with open(out, encoding="utf-8") as f:
                    written = f.read()
            return code, written, said.getvalue()

    def test_it_writes_the_file_as_biome_formats_it_and_says_so(self):
        code, written, said = self.run_command([300] * 6)
        self.assertEqual(code, 0, said)
        self.assertTrue(written.startswith('{\n  "about": '))
        self.assertTrue(written.endswith("}\n"))
        found = json.loads(written)
        self.assertEqual((found["allowanceMs"], found["fiveComparisonAverageMs"]), (300, 300))
        self.assertIn("jobs", found["source"])
        self.assertIn("Written to", said)

    def test_it_writes_nothing_and_exits_1_when_the_proof_is_under_95_percent(self):
        code, written, said = self.run_command([100, 100, 100, 100, 100, 1000])
        self.assertEqual(code, 1)
        self.assertIsNone(written)
        self.assertIn("under 95%", said)

    def test_no_logs_means_nothing_to_work_from(self):
        with tempfile.TemporaryDirectory() as folder:
            jobs_file = os.path.join(folder, "jobs.json")
            with open(jobs_file, "w") as f:
                json.dump([{"job": 1, "sha": "a", "started": "2026-11-10T00:00:00Z"}], f)
            with contextlib.redirect_stderr(io.StringIO()) as said:
                self.assertEqual(csa.main([folder, jobs_file, "repo"]), 1)
            self.assertIn("No job's log", said.getvalue())

    def test_the_command_line_is_checked(self):
        for argv in ([], ["a"], ["a", "b"], ["a", "b", "c", "d", "e"]):
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    csa.main(argv)


if __name__ == "__main__":
    unittest.main()
