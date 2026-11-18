#!/usr/bin/env python3
"""Works out product/app/journeys/cold-start-allowances.json: how far the cold start measured on two
machines may differ from the one-machine App journeys' on the same app and still count as clean.

    python3 .github/scripts/cold_start_allowances.py <logs folder> <jobs.json> <repository> [<output file>]

  <logs folder>   one file per App journeys job, named <job id>.log: the job's log as GitHub gives it
                  (`gh api repos/<owner>/<repo>/actions/jobs/<id>/logs`), timestamps and colour codes
                  as they come; a file under 1,000 bytes (GitHub's answer for a log that has expired)
                  counts as no log
  <jobs.json>     a JSON list of {"job": <id>, "sha": <commit>, "started": <time>}, one per job; the
                  job's "event" ("pull_request" or "push") fills the counts of pull request and main
                  runs, its "journeys" ("success" or "failure": how the journeys step ended) the
                  failures, and "cause" (what a person found when a flow failed) is told as it is
  <repository>    a clone holding every one of those commits (for `git ls-tree`)
  <output file>   default product/app/journeys/cold-start-allowances.json in <repository>, written as
                  Biome formats it

The method is written into the output's `method` and is the whole of it:

  - a run is one App journeys job (a pull request's or main's) whose log holds all seven of the cold
    start's "Cold start N of 7" lines; its median is the 4th of its seven, as startup.sh takes it;
  - a job GitHub lists again under a later attempt (a new job ID, the same start and the same seven) is
    one run: the repeats are dropped, because a pair of one run with itself is clean by construction;
  - runs are grouped by the inputs of App journeys' own built-app key (the tracked files of product/app,
    product/packages, pnpm-lock.yaml and .node-version, without product/app/journeys/, product/app/scripts/,
    product/app/bundle-limit.json and product/app/vitest.config.ts): two runs of a group built the same
    app, so any difference between their medians is noise; a pair of runs of one group is a noise pair.
    A pull request's job builds the merge of its head into its base (its log says "Merge <head> into
    <base>"), so a pull request run's key is the pair of the inputs at its head and at its base, and a
    main run's the inputs at its own commit twice (the same key as a pull request that changes none of
    them); a pull request run whose log has no such line is left out of every group;
  - the allowance is max(100 ms, 1.0 x the largest difference of two runs' medians over the noise pairs);
  - the proof: each noise pair judged with the allowance from the pairs that share neither of its runs.
    The file is written only when at least 95% of the noise pairs are clean that way, and its limit for
    the five-comparison average is the 99.9th percentile of that average over 20,000 random sets of five
    noise pairs, one pair from each of five different groups, with random signs (a seeded draw, so the
    same logs give the same file), rounded up to a whole millisecond.

Recompute when the emulator, its system image or Maestro's pin changes, in a pull request that says so;
never by hand, and a value is never widened by hand. Python's standard library only.
"""
import datetime
import hashlib
import json
import math
import os
import random
import re
import statistics
import subprocess
import sys
from collections import Counter, defaultdict

from speed_allowances import format_json  # the same Biome-shaped writer

MARGIN = 1.0
FLOOR_MS = 100
NEEDED = 0.95  # the share of noise pairs that must be clean (leaving both runs out) to write the file
SAMPLES = 20000
SEED = 7
RUNS = 7
MIN_LOG_BYTES = 1000  # a job's real log is far longer; GitHub's answer for a log that has expired is not
INPUTS = ("product/app", "product/packages", "pnpm-lock.yaml", ".node-version")
EXCLUDED = ("product/app/journeys/", "product/app/scripts/", "product/app/bundle-limit.json",
            "product/app/vitest.config.ts")
COLOURS = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
COLD = re.compile(r"Cold start (\d) of 7: first content after (\d+) ms")
MERGE = re.compile(r"\bMerge ([0-9a-f]{40}) into ([0-9a-f]{40})\b")
COLD_FAILED = re.compile(r"Run \d: couldn't read the start or the first content from Android's log")
VERDICT = re.compile(r"\| App, cold start to first content .*\| (✅|❌) ")
FLOW_FAILED = re.compile(r"\[Failed\] ")


def say(text=""):
    print(text, file=sys.stderr)


# --- reading the logs ------------------------------------------------------------------------

def parse(text):
    """{"cold": the seven cold starts in ms (empty unless all seven are there), "median": the 4th of the
    seven or None, "verdict": the cold-start row's mark or None, "cold_failed": whether the cold start step
    couldn't read Android's log, "flows_failed": how many flows the log marks failed, "merge": the (head, base)
    commits of the merge a pull request's job built, from its checkout's "Merge <head> into <base>" line, or None}."""
    seen, verdict, cold_failed, flows_failed, merge = {}, None, False, 0, None
    for line in COLOURS.sub("", text).splitlines():
        found = COLD.search(line)
        if found:
            seen[int(found.group(1))] = int(found.group(2))
            continue
        found = merge is None and MERGE.search(line)
        if found:
            merge = (found.group(1), found.group(2))
        found = VERDICT.search(line)
        if found:
            verdict = found.group(1)
        cold_failed = cold_failed or bool(COLD_FAILED.search(line))
        flows_failed += bool(FLOW_FAILED.search(line))
    cold = [seen[n] for n in range(1, RUNS + 1)] if sorted(seen) == list(range(1, RUNS + 1)) else []
    return {"cold": cold, "median": sorted(cold)[3] if cold else None, "verdict": verdict,
            "cold_failed": cold_failed, "flows_failed": flows_failed, "merge": merge}


def read_logs(logs, jobs):
    """(runs, dropped, parsed): the runs, oldest first (every job whose log holds seven cold starts), how
    many repeats were dropped (a job GitHub lists again under a later attempt has a new job ID but the
    same start and the same seven), and {job id: parse of its log, or None when it has no log}."""
    runs, seen, dropped, parsed = [], set(), 0, {}
    for job in sorted(jobs, key=lambda j: j["started"]):
        path = os.path.join(logs, f"{job['job']}.log")
        if not os.path.isfile(path) or os.path.getsize(path) < MIN_LOG_BYTES:
            parsed[job["job"]] = None  # no file, or an error answer (GitHub's "Not Found" is 148 bytes), not a log
            continue
        with open(path, encoding="utf-8", errors="replace") as f:
            found = parse(f.read())
        parsed[job["job"]] = found
        if not found["cold"]:
            continue
        signature = (job["started"], tuple(found["cold"]))
        if signature in seen:
            dropped += 1
            continue
        seen.add(signature)
        runs.append({**job, **found})
    return runs, dropped, parsed


# --- the groups and the noise pairs ------------------------------------------------------------

def fingerprint(repository, sha, run=subprocess.run):
    """A hash of the app's inputs at a commit (the files App journeys' built-app key is made from), or
    None when the commit isn't there."""
    done = run(["git", "-C", repository, "ls-tree", "-r", sha, "--", *INPUTS], capture_output=True, text=True)
    if done.returncode != 0 or not done.stdout.strip():
        return None
    kept = [line for line in done.stdout.splitlines()
            if "\t" in line and not line.split("\t", 1)[1].startswith(EXCLUDED)]
    return hashlib.sha256("\n".join(kept).encode()).hexdigest()[:16]


def group_key(one, repository, run=subprocess.run):
    """What two runs must share to have built the same app: the inputs at the commits a pull request's job merged
    (its head and its base, from its log), or at a main run's own commit (twice). None when it can't be told: a
    pull request run whose log has no merge line, or a commit that isn't in the clone."""
    pair = one.get("merge")
    if one.get("event") == "pull_request" and pair is None:
        return None
    head, base = pair if pair else (one["sha"], one["sha"])
    heads = fingerprint(repository, head, run)
    bases = heads if base == head else fingerprint(repository, base, run)
    return (heads, bases) if heads is not None and bases is not None else None


def groups_of(runs, repository, run=subprocess.run):
    """({key: [index of each run]} for the groups of two or more runs that built the same app, in the order their
    first run started, how many runs have no key)."""
    groups, unkeyed = defaultdict(list), 0
    for index, one in enumerate(runs):
        key = group_key(one, repository, run)
        if key is None:
            unkeyed += 1
        else:
            groups[key].append(index)
    return {key: found for key, found in groups.items() if len(found) >= 2}, unkeyed


def noise_pairs(groups):
    return [(a, b) for found in groups.values() for n, a in enumerate(found) for b in found[n + 1:]]


# --- the statistic -----------------------------------------------------------------------------

def spread(runs, a, b):
    return abs(runs[a]["median"] - runs[b]["median"])


def allowance(runs, pairs, margin=MARGIN):
    """max(floor, margin x the largest difference of two runs' medians over the pairs), in ms."""
    values = [spread(runs, a, b) for a, b in pairs]
    return max(FLOOR_MS, margin * max(values)) if values else FLOOR_MS


def leave_both_runs_out(runs, pairs, margin=MARGIN):
    """How many noise pairs are clean, each judged with the allowance from the pairs sharing neither run."""
    return sum(spread(runs, a, b) <= allowance(runs, [p for p in pairs if a not in p and b not in p], margin)
               for a, b in pairs)


def leave_the_group_out(runs, groups, pairs, margin=MARGIN):
    total = 0
    for found in groups.values():
        limit = allowance(runs, [p for p in pairs if p[0] not in found], margin)
        total += sum(spread(runs, a, b) <= limit for a, b in pairs if a in found)
    return total


def old_rule(runs, pairs):
    """How many noise pairs the old rule would pass: the median inside the other run's lowest to highest of seven."""
    return sum(min(runs[a]["cold"]) <= runs[b]["median"] <= max(runs[a]["cold"]) for a, b in pairs)


def injected(runs, pairs, delta, margin=MARGIN):
    """The share of noise pairs flagged when `delta` ms is added to the second run's median, each pair judged
    with the allowance from the pairs sharing neither run."""
    hit = sum(abs(runs[b]["median"] - runs[a]["median"] + delta)
              > allowance(runs, [p for p in pairs if a not in p and b not in p], margin) for a, b in pairs)
    return hit / len(pairs)


def five_comparison_average(runs, groups, pairs, seed=SEED, samples=SAMPLES):
    """(limit, sampled means): the 99.9th percentile of the absolute mean of (second run - first) over
    `samples` random sets of five noise pairs, one from each of five different groups, each with a random
    sign; (None, None) with fewer than five groups. The draws run in a fixed order (the groups, then each
    group's pair, then its sign), so the same runs give the same limit."""
    by_group = [[(a, b) for a, b in pairs if a in found] for found in groups.values()]
    by_group = [found for found in by_group if found]
    if len(by_group) < 5:
        return None, None
    rng = random.Random(seed)
    means = []
    for _ in range(samples):
        values = []
        for g in rng.sample(range(len(by_group)), 5):
            a, b = rng.choice(by_group[g])
            values.append((runs[b]["median"] - runs[a]["median"]) * rng.choice((1, -1)))
        means.append(statistics.mean(values))
    ordered = sorted(abs(m) for m in means)
    return ordered[int(0.999 * (len(ordered) - 1))], means


# --- the file ----------------------------------------------------------------------------------

def percent(share):
    return f"{share:.0%}"


def day_of(started):
    when = datetime.datetime.strptime(started[:10], "%Y-%m-%d")
    return f"{when.day} {when.strftime('%B')}"


def failures(jobs, parsed, runs):
    """The sentence about how the journeys steps failed, from the jobs' own conclusions, or None when the
    jobs file doesn't say how they ended. A failed job is told by what the log shows (no log; the cold start
    step couldn't read Android's log) or by the `cause` a person gave it; a flow failed by itself when a log
    marks one failed and no cause was given."""
    if not any("journeys" in job for job in jobs):
        return None
    failed = [job for job in jobs if job.get("journeys") == "failure"]
    told = []
    for job in failed:
        found = parsed.get(job["job"])
        if found is None:
            told.append("with no log")
        elif found["cold_failed"]:
            told.append(f"the cold-start step itself ({day_of(job['started'])}: couldn't read the start or the "
                        "first content from Android's log)")
        else:
            told.append(job.get("cause") or "a flow failed with no cause given")
    by_itself = sum(1 for job in jobs if (parsed.get(job["job"]) or {}).get("flows_failed") and not job.get("cause"))
    reached = [job for job in jobs if parsed.get(job["job"]) and (parsed[job["job"]]["cold"] or parsed[job["job"]]["cold_failed"])]
    cold_failed = sum(1 for job in reached if parsed[job["job"]]["cold_failed"])
    text = f"of all {len(jobs)} jobs whose journeys ran, {len(failed)} failed"
    if failed:
        text += ": " + ", ".join(f"{n} {what}" for what, n in Counter(told).items())
    text += (f"; in the {len(reached)} runs that reached the cold start it failed "
             f"{'once' if cold_failed == 1 else f'{cold_failed} times'}, and "
             f"{'no flow' if not by_itself else f'{by_itself} flow(s)'} failed by itself")
    return text


def build(runs, groups, jobs, parsed, needed=NEEDED, today=None, dropped=0, unkeyed=0):
    """(file content, report lines), or (None, report lines) when the proof is under `needed`."""
    pairs = noise_pairs(groups)
    lines = [f"{len(runs)} runs ({dropped} repeats dropped, {unkeyed} left out of every group); {len(pairs)} noise "
             f"pairs from {len({i for p in pairs for i in p})} runs in {len(groups)} groups"]
    if not pairs:
        return None, lines + ["No two runs built the same app, so there is no noise to measure."]
    lbo = leave_both_runs_out(runs, pairs)
    share = lbo / len(pairs)
    lines.append(f"Leave both runs out: {lbo} of {len(pairs)} noise pairs clean ({share:.1%})")
    if share < needed:
        return None, lines + [f"That is under {needed:.0%}, so no file is written."]
    limit, means = five_comparison_average(runs, groups, pairs)
    if limit is None:
        return None, lines + ["Fewer than five groups have noise pairs, so the five-comparison average can't be set."]
    lgo = leave_the_group_out(runs, groups, pairs)
    allowed = allowance(runs, pairs)
    stop = lambda p: 1 - (1 - p) ** 5 - 5 * p * (1 - p) ** 4
    old = old_rule(runs, pairs)
    others = (1.1, 1.25, 1.5, 2.0)
    other_clean = [leave_both_runs_out(runs, pairs, m) for m in others]
    all_clean = all(n == len(pairs) for n in other_clean)
    others_text = "1.1, 1.25, 1.5 and 2.0"  # the margins above, as they are written in the file
    flagged = [percent(injected(runs, pairs, 1000, m)) for m in others]
    spreads = [spread(runs, a, b) for a, b in pairs]
    medians = [r["median"] for r in runs]
    sentence = failures(jobs, parsed, runs)
    marks = [r["verdict"] for r in runs]
    passed = sum(mark == "✅" for mark in marks)
    with_event = all(r.get("event") for r in runs)
    source = {"from": runs[0]["started"], "to": runs[-1]["started"], "runs": len(runs)}
    if with_event:
        source["pullRequestRuns"] = sum(r["event"] == "pull_request" for r in runs)
        source["mainRuns"] = sum(r["event"] == "push" for r in runs)
    source.update({"ungroupedRuns": unkeyed, "noisePairs": len(pairs), "noiseRuns": len({i for p in pairs for i in p}),
                   "groups": len(groups), "jobs": [r["job"] for r in runs]})
    proof = {
        "leaveBothRunsOut": f"{lbo} of {len(pairs)} noise pairs clean ({share:.1%}), each judged with the allowance "
                            f"from pairs sharing neither run; five in a row {share ** 5:.0%}; two of the first five "
                            f"not clean by noise alone {stop(1 - share):.1%}",
        "leaveTheGroupOut": f"{lgo} of {len(pairs)} ({lgo / len(pairs):.1%})",
        "marginsCompared": (f"{others_text} were {'all ' if all_clean else ''}clean on "
                            + (f"{len(pairs)} of {len(pairs)}" if all_clean else
                               ", ".join(str(n) for n in other_clean) + f" of {len(pairs)}")
                            + " but blunter (a +1,000 ms shift flagged "
                            + ", ".join(flagged[:-1]) + f" and {flagged[-1]} of the time); 1.0 is the tightest "
                            "that passes nearly always"),
        "oldRule": f"the median inside the other run's lowest-to-highest of seven: {old} of {len(pairs)} "
                   f"({old / len(pairs):.0%}); five in a row {(old / len(pairs)) ** 5:.0%}",
    }
    if sentence:
        proof["failures"] = sentence
    proof.update({
        "coldStartVerdicts": (f"all {len(runs)} passed against main" if passed == len(runs)
                              else f"{passed} of {len(runs)} passed against main")
                             + ("; no data on how often noise flips one" if passed == len(runs)
                                else "; so noise (or a real change) can flip one"),
        "noiseSpread": f"|difference of two same-app medians|: median {statistics.median(spreads):g} ms, 90th "
                       f"percentile {sorted(spreads)[int(0.9 * (len(spreads) - 1))]:g} ms, largest {max(spreads):g} ms; "
                       f"medians across all runs from {min(medians)} to {max(medians)} ms",
        "injectedShiftOneComparison": "+500 ms flagged " + percent(injected(runs, pairs, 500)) + ", "
                                      + ", ".join(f"+{d} ms {percent(injected(runs, pairs, d))}" for d in (800, 1000)),
        "injectedShiftFiveComparisons": ", ".join(
            f"+{d} ms {percent(sum(abs(m + d) > limit for m in means) / len(means))}" for d in (400, 500, 600, 800)),
        "duplicates": ("none: no two runs share a start time or the same seven cold starts" if not dropped else
                       f"{dropped} {'job' if dropped == 1 else 'jobs'} GitHub listed again under a later attempt "
                       f"(new job ID, same start, same seven) {'was' if dropped == 1 else 'were'} dropped"),
    })
    content = {
        "about": "How far the cold start on two machines may differ from the one-machine App journeys on the same "
                 "pull request and still count as clean (docs/research/faster-checks.md, proposal 4; Round 6, R4, "
                 "M7.6). Recompute with .github/scripts/cold_start_allowances.py; never edit a value by hand.",
        "method": {
            "runs": "App journeys jobs (pull requests and main) whose journeys step ran and logged seven cold starts; "
                    "each run's median is the 4th of its 7, as startup.sh takes it",
            "noisePairs": "every pair of runs of the same app: the same inputs as app-journeys.yml's built-app key "
                          "(the tracked files of product/app, product/packages, pnpm-lock.yaml and .node-version, "
                          "without product/app/journeys/, product/app/scripts/, product/app/bundle-limit.json and "
                          "product/app/vitest.config.ts); a pull request's job builds the merge of its head into "
                          "its base (its log's \"Merge <head> into <base>\" line), so a pull request run's key is "
                          "the inputs at its head and at its base, and a main run's the inputs at its own commit "
                          "twice; a pull request run with no such line is left out",
            "allowance": "max(floor, margin x the largest |difference of the two runs' medians| over the noise pairs)",
            "margin": MARGIN,
            "floorMs": FLOOR_MS,
            "fiveComparisonAverage": "over the five pull requests counted for the switch, the average of (two-machine "
                                     "median - one-machine median) must stay within this: the 99.9th percentile of "
                                     "the same average over 20,000 random sets of five noise pairs, one pair from "
                                     "each of five different groups, with random signs",
        },
        "computed": today or datetime.date.today().isoformat(),
        "source": source,
        "proof": proof,
        "allowanceMs": math.ceil(allowed),
        "fiveComparisonAverageMs": math.ceil(limit),
    }
    lines += [f"Leave the group out: {lgo} of {len(pairs)}", f"Old rule: {old} of {len(pairs)}",
              f"Allowance: {allowed:.0f} ms; five-comparison average limit {limit:.1f} ms"]
    return content, lines


def main(argv=None, run=subprocess.run):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) not in (3, 4):
        sys.exit(__doc__)
    logs, jobs_file, repository = argv[:3]
    out = argv[3] if len(argv) == 4 else os.path.join(repository, "product", "app", "journeys",
                                                      "cold-start-allowances.json")
    with open(jobs_file, encoding="utf-8") as f:
        jobs = json.load(f)
    runs, dropped, parsed = read_logs(logs, jobs)
    if not runs:
        say("No job's log with seven cold starts was found in the logs folder.")
        return 1
    groups, unkeyed = groups_of(runs, repository, run)
    content, lines = build(runs, groups, jobs, parsed, dropped=dropped, unkeyed=unkeyed)
    for line in lines:
        say(line)
    if content is None:
        return 1
    with open(out, "w", encoding="utf-8") as f:
        f.write(format_json(content) + "\n")
    say(f"Written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
