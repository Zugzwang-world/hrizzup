#!/usr/bin/env python3
"""Works out product/web/e2e/speed-allowances.json: how far the Speed check on three machines may
differ from the one-machine Speed check on the same preview and still count as clean.

    python3 .github/scripts/speed_allowances.py <logs folder> <jobs.json> <repository> [<output file>]

  <logs folder>   one file per one-machine Speed check job, named <job id>.log: the job's log as
                  GitHub gives it (`gh api repos/<owner>/<repo>/actions/jobs/<id>/logs`), timestamps
                  and colour codes as they come
  <jobs.json>     a JSON list of {"job": <id>, "sha": <commit>, "started": <time>}, one per job
  <repository>    a clone holding every one of those commits (for `git rev-parse <sha>:<path>`)
  <output file>   default product/web/e2e/speed-allowances.json in <repository>

The method is written into the output's `method` and is the whole of it:

  - a check is one one-machine Speed check job on a pull request whose pages step ran; for each page
    it has the median of its 5 runs (busy time, load as logged to 10 ms, layout shift) from the
    log's run lines, and the budget verdicts, the contrast verdict, the code and the total download
    (to 0.1 KB) from the check's own table;
  - checks are grouped by their website inputs, the git trees of product/web, product/packages,
    agreement and pnpm-lock.yaml: two checks of one group measured the same code, so any difference
    between them is noise; a pair of checks of one group is a noise pair;
  - a page's allowance for a number is max(floor, 2 x the largest difference of the two checks'
    medians over the noise pairs); a page with fewer than 10 noise pairs takes the pooled value (the
    same statistic over every page), as does a page the file doesn't list;
  - the proof: each noise pair judged with allowances from the pairs that share neither of its
    checks, every number, every verdict and contrast. The file is written only when at least 95% of
    the noise pairs are clean that way, and its limits for the five-comparison average are the 99.9th
    percentile of that average over 20,000 random sets of five noise pairs, one pair from each of
    five different groups, with random signs (a seeded draw, so the same logs give the same file).

Recompute only when pages are added or the Speed check's measuring changes, in a pull request that
says so; a value is never widened by hand. Python's standard library only.
"""
import datetime
import json
import os
import random
import re
import statistics
import subprocess
import sys
from collections import defaultdict

MARGIN = 2.0
MIN_PAIRS = 10  # noise pairs a page needs before its own largest difference is used
MIN_PAGES = 8  # pages a check must have measured to count as a check
NEEDED = 0.95  # the share of noise pairs that must be clean (leaving both checks out) to write the file
SAMPLES = 20000
SEED = 7
INPUTS = ("product/web", "product/packages", "agreement", "pnpm-lock.yaml")
NUMS = ("busy", "load", "shift")
SIZES = (("code", "code_kb"), ("total", "total_kb"))
KEYS = NUMS + ("code", "total")
FLOORS = {"busy": 20.0, "load": 50.0, "shift": 0.005, "code": 0.5, "total": 1.0}  # code and total in KB
FLOORS_IN_FILE = {"busyMs": 20, "loadMs": 50, "shift": 0.005, "codeBytes": 512, "totalBytes": 1024}

COLOURS = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
RUN = re.compile(r"  (/\S*): run (\d) of 5 \([\d.]+ s\): busy (\d+) ms, load ([\d.]+) s, shift ([\d.]+)")
ROW = re.compile(
    r"\| `(/[^`]*)` \| (.)\S* ([\d.]+) s / [\d.]+ s \| (.)\S* (\d+) ms / \d+ ms \| (.)\S* ([\d.]+) / [\d.]+ \| "
    r"(.)\S* ([\d.]+) KB / \d+ KB \| (.)\S* ([\d.]+) KB / \d+ KB \| (.+?) \|")


def say(text=""):
    print(text, file=sys.stderr)


# --- reading the logs ------------------------------------------------------------------------

def parse(text):
    """{page: {"med": {busy, load, shift}, "runs": [...], and from the table when it has the page:
    "verdicts", "code_kb", "total_kb", "contrast"}} for every page whose five runs are all there."""
    runs, table = defaultdict(dict), {}
    for line in COLOURS.sub("", text).splitlines():
        found = RUN.search(line)
        if found:
            page, run, busy, load, shift = found.groups()
            runs[page][int(run)] = (int(busy), round(float(load) * 1000), float(shift))
            continue
        found = ROW.search(line)
        if found:
            g = found.groups()
            table[g[0]] = {"verdicts": "".join(g[i] for i in (1, 3, 5, 7, 9)), "code_kb": float(g[8]),
                           "total_kb": float(g[10]), "contrast": g[11].strip()}
    pages = {}
    for page, seen in runs.items():
        if sorted(seen) != [1, 2, 3, 4, 5]:
            continue
        med = {key: statistics.median(seen[n][i] for n in seen) for i, key in enumerate(NUMS)}
        pages[page] = {"med": med, "runs": [seen[n] for n in range(1, 6)], **table.get(page, {})}
    return pages


def read_checks(logs, jobs):
    """The checks, oldest first: every job whose log is there and measured at least MIN_PAGES pages."""
    checks = []
    for job in sorted(jobs, key=lambda j: j["started"]):
        path = os.path.join(logs, f"{job['job']}.log")
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as f:
            pages = parse(f.read())
        if len(pages) >= MIN_PAGES:
            checks.append({**job, "pages": pages})
    return checks


# --- the groups and the noise pairs ------------------------------------------------------------

def fingerprint(repository, sha, run=subprocess.run):
    """The git trees of the website's inputs at a commit, or None when the commit isn't there."""
    done = run(["git", "-C", repository, "rev-parse", *(f"{sha}:{path}" for path in INPUTS)],
               capture_output=True, text=True)
    found = done.stdout.split() if done.returncode == 0 else []
    return tuple(found) if len(found) == len(INPUTS) else None


def groups_of(checks, repository, run=subprocess.run):
    """{fingerprint: [index of each check]} for the groups of two or more checks of the same inputs."""
    groups = defaultdict(list)
    for index, check in enumerate(checks):
        key = fingerprint(repository, check["sha"], run)
        if key is not None:
            groups[key].append(index)
    return {key: found for key, found in groups.items() if len(found) >= 2}


def noise_pairs(groups):
    return [(a, b) for found in groups.values() for n, a in enumerate(found) for b in found[n + 1:]]


# --- the statistic -----------------------------------------------------------------------------

def difference(checks, a, b, page, key):
    """|median of check a - median of check b| for one number of one page; None when a side has none."""
    pa, pb = checks[a]["pages"][page], checks[b]["pages"][page]
    if key in NUMS:
        return abs(pa["med"][key] - pb["med"][key])
    field = dict(SIZES)[key]
    return abs(pa[field] - pb[field]) if field in pa and field in pb else None


def allowances(checks, pairs, margin=MARGIN):
    """{page: {number: allowance}} and "*" for the pooled one: max(floor, margin x the largest
    difference), a page with fewer than MIN_PAIRS pairs taking the pooled largest. Sizes in KB."""
    found = defaultdict(lambda: defaultdict(list))
    for a, b in pairs:
        for page in set(checks[a]["pages"]) & set(checks[b]["pages"]):
            for key in KEYS:
                value = difference(checks, a, b, page, key)
                if value is not None:
                    found[page][key].append(value)
    pooled = {key: [v for page in found for v in found[page][key]] for key in KEYS}
    out = {"*": {key: max(FLOORS[key], margin * max(pooled[key])) if pooled[key] else FLOORS[key] for key in KEYS}}
    for page in found:
        out[page] = {}
        for key in KEYS:
            values = found[page][key] if len(found[page][key]) >= MIN_PAIRS else pooled[key]
            out[page][key] = max(FLOORS[key], margin * max(values)) if values else FLOORS[key]
    return out


def clean(checks, a, b, allowance):
    """Whether two checks of the same code agree on every page both measured: every number within the
    page's allowance, every budget verdict and the contrast verdict equal."""
    for page in set(checks[a]["pages"]) & set(checks[b]["pages"]):
        limit = allowance.get(page) or allowance["*"]
        for key in KEYS:
            value = difference(checks, a, b, page, key)
            if value is not None and value > limit[key] + 1e-9:
                return False
        pa, pb = checks[a]["pages"][page], checks[b]["pages"][page]
        for field in ("verdicts", "contrast"):
            if pa.get(field) and pb.get(field) and pa[field] != pb[field]:
                return False
    return True


def leave_both_checks_out(checks, pairs, margin=MARGIN):
    """How many noise pairs are clean, each judged with allowances from the pairs sharing neither check."""
    return sum(clean(checks, a, b, allowances(checks, [p for p in pairs if a not in p and b not in p], margin))
               for a, b in pairs)


def leave_the_group_out(checks, groups, pairs, margin=MARGIN):
    total = 0
    for found in groups.values():
        rest = [p for p in pairs if p[0] not in found]
        al = allowances(checks, rest, margin)
        total += sum(clean(checks, a, b, al) for a, b in pairs if a in found)
    return total


def time_split(checks, groups, pairs, margin=MARGIN):
    """(clean, of): allowances from the earlier half of the groups (by their first check's time),
    judged on the pairs of the later half."""
    ordered = sorted(groups.values(), key=lambda found: checks[found[0]]["started"])
    half = len(ordered) // 2
    early = [p for found in ordered[:half] for p in pairs if p[0] in found]
    late = [p for found in ordered[half:] for p in pairs if p[0] in found]
    al = allowances(checks, early, margin)
    return sum(clean(checks, a, b, al) for a, b in late), len(late)


def verdict_flips(checks):
    """(flips, page comparisons, highest busy median): verdicts that differ between consecutive checks."""
    flips = compared = 0
    highest = 0
    for check in checks:
        for page in check["pages"].values():
            if "verdicts" in page:
                highest = max(highest, page["med"]["busy"])
    for a, b in zip(range(len(checks)), range(1, len(checks))):
        for page in set(checks[a]["pages"]) & set(checks[b]["pages"]):
            pa, pb = checks[a]["pages"][page], checks[b]["pages"][page]
            if pa.get("verdicts") and pb.get("verdicts"):
                compared += 1
                flips += pa["verdicts"] != pb["verdicts"]
    return flips, compared, highest


def injected(checks, pairs, key, deltas, margin=MARGIN):
    """{delta: share flagged}: a shift added to one side of every noise pair, one page at a time,
    judged with allowances from the pairs sharing neither check. Sizes in KB."""
    shares = {}
    for delta in deltas:
        hit = total = 0
        for a, b in pairs:
            al = allowances(checks, [p for p in pairs if a not in p and b not in p], margin)
            for page in set(checks[a]["pages"]) & set(checks[b]["pages"]):
                pa, pb = checks[a]["pages"][page], checks[b]["pages"][page]
                if key in NUMS:
                    d0 = pb["med"][key] - pa["med"][key]
                else:
                    field = dict(SIZES)[key]
                    if field not in pa or field not in pb:
                        continue
                    d0 = pb[field] - pa[field]
                total += 1
                hit += abs(d0 + delta) > (al.get(page) or al["*"])[key] + 1e-9
        shares[delta] = hit / total if total else float("nan")
    return shares


def five_comparison_average(checks, groups, pairs, seed=SEED, samples=SAMPLES):
    """({busy: limit, load: limit}, {busy: sampled means, load: sampled means}): the 99.9th percentile
    of the absolute mean over pages of (second check - first) over `samples` random sets of five
    noise pairs, one from each of five different groups, each with a random sign."""
    by_group = [[(a, b) for a, b in pairs if a in found] for found in groups.values()]
    by_group = [found for found in by_group if found]
    if len(by_group) < 5:
        return None, None
    rng = random.Random(seed)
    cache = {}

    def mean_difference(a, b, key):
        if (a, b, key) not in cache:
            common = sorted(set(checks[a]["pages"]) & set(checks[b]["pages"]))
            cache[(a, b, key)] = statistics.mean(
                checks[b]["pages"][p]["med"][key] - checks[a]["pages"][p]["med"][key] for p in common)
        return cache[(a, b, key)]

    means = {"busy": [], "load": []}
    for key in means:
        for _ in range(samples):
            chosen = rng.sample(range(len(by_group)), 5)
            means[key].append(statistics.mean(
                mean_difference(*rng.choice(by_group[g]), key) * rng.choice((1, -1)) for g in chosen))
    limits = {}
    for key, found in means.items():
        ordered = sorted(abs(m) for m in found)
        limits[key] = ordered[int(0.999 * (len(ordered) - 1))]
    return limits, means


# --- the file ----------------------------------------------------------------------------------

def detected(means, limit, delta):
    """The share of sampled five-comparison averages that a shift of `delta` on every page pushes past the limit."""
    return f"{sum(abs(m + delta) > limit for m in means) / len(means):.0%}"


def row(allow, page, pairs_per_page):
    a = allow.get(page) or allow["*"]
    return {"busyMs": round(a["busy"]), "loadMs": round(a["load"]), "shift": round(a["shift"], 3),
            "codeBytes": int(round(a["code"] * 1024)), "totalBytes": int(round(a["total"] * 1024)),
            "noisePairs": pairs_per_page.get(page, 0)}


def percent(share):
    return f"{share:.1%}"


def build(checks, groups, needed=NEEDED, today=None):
    """(file content, report lines), or (None, report lines) when the proof is under `needed`."""
    pairs = noise_pairs(groups)
    lines = [f"{len(checks)} checks; {len(pairs)} noise pairs from {len({i for p in pairs for i in p})} "
             f"checks in {len(groups)} groups"]
    if not pairs:
        return None, lines + ["No two checks measured the same website code, so there is no noise to measure."]
    lco = leave_both_checks_out(checks, pairs)
    share = lco / len(pairs)
    lines.append(f"Leave both checks out: {lco} of {len(pairs)} noise pairs clean ({percent(share)})")
    if share < needed:
        return None, lines + [f"That is under {needed:.0%}, so no file is written."]
    stop = lambda p: 1 - (1 - p) ** 5 - 5 * p * (1 - p) ** 4
    lgo = leave_the_group_out(checks, groups, pairs)
    ts, late = time_split(checks, groups, pairs)
    flips, compared, highest = verdict_flips(checks)
    limits, means = five_comparison_average(checks, groups, pairs)
    if limits is None:
        return None, lines + ["Fewer than five groups have noise pairs, so the five-comparison average can't be set."]
    one_page = {
        "busy": injected(checks, pairs, "busy", (100, 150, 200)),
        "load": injected(checks, pairs, "load", (100, 200)),
        "code": injected(checks, pairs, "code", (1.0,)),
        "total": injected(checks, pairs, "total", (2.0,)),
    }
    at = lambda found, delta: f"{found[delta]:.0%}"
    pairs_per_page = defaultdict(int)
    for a, b in pairs:
        for page in set(checks[a]["pages"]) & set(checks[b]["pages"]):
            pairs_per_page[page] += 1
    allow = allowances(checks, pairs)
    newest = checks[-1]["pages"]
    content = {
        "about": "How far the Speed check on three machines may differ from the one-machine Speed check on the "
                 "same preview and still count as clean (docs/research/faster-checks.md, proposal 3; Round 6, "
                 "R4, M7.5). Recompute with .github/scripts/speed_allowances.py; never edit a value by hand.",
        "method": {
            "checks": "one-machine Speed check jobs on pull requests whose pages step ran, read from their logs: "
                      "each page's median of its 5 runs (busy = total blocking time in ms, load = largest "
                      "contentful paint in ms as logged to 10 ms, shift), and the code and total download from "
                      "the check's own table (0.1 KB; 1 KB = 1024 bytes)",
            "noisePairs": "every pair of checks within a group of the same website inputs: the same git trees "
                          "for product/web, product/packages, agreement and pnpm-lock.yaml",
            "allowance": "per page and number: max(floor, margin x the largest |difference of the two checks' "
                         "medians| over the noise pairs); a page with fewer than 10 noise pairs, or not listed, "
                         "uses the pooled value over all pages",
            "margin": MARGIN,
            "floors": FLOORS_IN_FILE,
            "fiveComparisonAverage": "over the pull requests counted for the switch, the average over pages and "
                                     "records of (three-machine median - one-machine median) must stay within "
                                     "these: the 99.9th percentile of the same average over 20,000 random sets of "
                                     "five noise pairs, one pair from each of five different groups, with random "
                                     "signs",
        },
        "computed": today or datetime.date.today().isoformat(),
        "source": {"from": checks[0]["started"], "to": checks[-1]["started"], "checks": len(checks),
                   "noisePairs": len(pairs), "noiseChecks": len({i for p in pairs for i in p}),
                   "groups": len(groups), "jobs": [c["job"] for c in checks]},
        "proof": {
            "leaveBothChecksOut": f"{lco} of {len(pairs)} noise pairs clean ({percent(share)}), each judged with "
                                  f"allowances from pairs sharing neither check; five in a row {share ** 5:.0%}; "
                                  f"two of the first five not clean by noise alone {stop(1 - share):.1%}",
            "leaveTheGroupOut": f"{lgo} of {len(pairs)} ({percent(lgo / len(pairs))})",
            "timeSplitByGroup": f"{ts} of {late} later-group pairs clean with allowances from the earlier "
                                f"groups only",
            "verdictOrContrastFlips": f"{flips} in {compared:,} consecutive page comparisons "
                                      f"({len(checks) - 1} pairs of checks); the highest busy median seen was "
                                      f"{highest:.0f} ms against 200 ms plus 50 ms tolerance",
            "injectedShiftOnePage": (
                f"flagged per page comparison: busy +100 ms {at(one_page['busy'], 100)}, +150 ms "
                f"{at(one_page['busy'], 150)}, +200 ms {at(one_page['busy'], 200)}; load +100 ms "
                f"{at(one_page['load'], 100)}, +200 ms {at(one_page['load'], 200)}; code +1 KB "
                f"{at(one_page['code'], 1.0)}; total +2 KB {at(one_page['total'], 2.0)}"),
            "injectedShiftEveryPageFiveComparisons": (
                "busy " + ", ".join(f"+{d} ms {detected(means['busy'], limits['busy'], d)}" for d in (30, 40, 60))
                + "; load " + ", ".join(f"+{d} ms {detected(means['load'], limits['load'], d)}" for d in (20, 30, 40))),
        },
        "fiveComparisonAverage": {"busyMs": round(limits["busy"]), "loadMs": round(limits["load"])},
        "pooled": {key: value for key, value in row(allow, "*", {}).items() if key != "noisePairs"},
        "pages": {page: row(allow, page, pairs_per_page) for page in newest},
    }
    lines += [f"Leave the group out: {lgo} of {len(pairs)}", f"Time split: {ts} of {late}",
              f"Verdict flips: {flips} of {compared}",
              f"Five-comparison average limits: busy {limits['busy']:.1f} ms, load {limits['load']:.1f} ms"]
    return content, lines


def main(argv=None, run=subprocess.run):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) not in (3, 4):
        sys.exit(__doc__)
    logs, jobs_file, repository = argv[:3]
    out = argv[3] if len(argv) == 4 else os.path.join(repository, "product", "web", "e2e", "speed-allowances.json")
    with open(jobs_file, encoding="utf-8") as f:
        jobs = json.load(f)
    checks = read_checks(logs, jobs)
    if not checks:
        say("No job's log was found in the logs folder.")
        return 1
    content, lines = build(checks, groups_of(checks, repository, run))
    for line in lines:
        say(line)
    if content is None:
        return 1
    with open(out, "w", encoding="utf-8") as f:
        json.dump(content, f, indent=1)  # as the committed file has always been written
    say(f"Written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
