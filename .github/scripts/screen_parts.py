#!/usr/bin/env python3
"""The Screen check's joining job: proves the parts ran every test exactly once.

    python3 .github/scripts/screen_parts.py untouched <folder> <part> <of>
    python3 .github/scripts/screen_parts.py add-up <folder> <of> >> "$GITHUB_OUTPUT"
    python3 .github/scripts/screen_parts.py times <folder> <file>

The Screen check runs on four machines, "Screen check, part N of 4" (.github/workflows/checks.yml).
Each part leaves one small record, part-N.json, and the joining job, named "Screen check" (the
name the ruleset requires), downloads them all into <folder> and adds them up:

  - `untouched` writes a part's record when the change doesn't touch the website:
    {"part", "of", "website": false}. The part passes at once; nothing was tested.
  - the website's tests leave {"part", "of", "website": true, "all", "mine", "times"} instead
    (product/web/e2e/support/parts.ts): `all` is the whole list of tests the part saw, `mine` the
    part's own, `times` the seconds each of its passed tests took.
  - `add-up` passes only when exactly <of> records exist, numbered 1 to <of>, all saying `of: <of>`;
    and either all say `website: false`, or all say `website: true`, their `all` lists are
    identical, their `mine` lists share no test, and together make exactly `all`. Otherwise it
    fails, naming the missing, doubled or unexpected tests, or the mixed flags. Its standard output
    is only `website=true|false` (for $GITHUB_OUTPUT: true when any record says the website was
    tested, said before it judges, so the screenshots are kept even when it fails); everything
    people read goes to the error stream, so the log shows it.
  - `times` merges the parts' measured seconds (passed tests only) into <file>, in the shape of
    product/web/e2e/test-times.json, prints each part's summed time and warns when the slowest
    part took more than 25% longer than the quickest.

Python's standard library only. Prints no secrets: test names, counts and seconds only.
"""
import datetime
import json
import os
import sys

IMBALANCE = 0.25  # the slowest part may take this much longer than the quickest, before a warning
SHOWN = 8  # tests named in one message; the rest are counted


def say(text=""):
    print(text, file=sys.stderr)


def named(tests):
    """A few test names for a message, and how many more there were."""
    tests = sorted(tests)
    shown = "".join(f"\n    {t}" for t in tests[:SHOWN])
    return shown + (f"\n    ... and {len(tests) - SHOWN} more" if len(tests) > SHOWN else "")


def read_records(folder):
    """([record, ...], [problem, ...]): every JSON file under the folder, however deep (each part's
    artifact has its own sub-folder). A file that can't be read is a problem, never a crash."""
    records, problems = [], []
    for here, _, names in sorted(os.walk(folder)):
        for name in sorted(names):
            if not name.endswith(".json"):
                continue
            path = os.path.join(here, name)
            try:
                with open(path, encoding="utf-8") as f:
                    record = json.load(f)
            except (OSError, ValueError) as error:
                problems.append(f"{name} can't be read: {error}")
                continue
            if not isinstance(record, dict):
                problems.append(f"{name} isn't a record")
                continue
            records.append(record)
    return records, problems


def tested(records):
    """Whether any record says the website was tested."""
    return any(isinstance(r, dict) and r.get("website") is True for r in records)


def lists_of(record, field):
    value = record.get(field)
    if isinstance(value, list) and all(isinstance(t, str) for t in value):
        return value
    return None


def add_up(records, of, problems=()):
    """The problems with these records, as sentences; empty when the parts add up."""
    problems = list(problems)
    if of < 1:
        return problems + [f"{of} parts isn't a number of parts"]

    numbers = {}
    for record in records:
        part = record.get("part")
        if not isinstance(part, int) or isinstance(part, bool) or not 1 <= part <= of:
            problems.append(f"A record says it is part {part!r}, which isn't one of the {of} parts")
        elif part in numbers:
            problems.append(f"Part {part} left two records")
        else:
            numbers[part] = record
        if record.get("of") != of:
            problems.append(f"Part {part!r} says it is one of {record.get('of')!r} parts, not {of}")
    for part in range(1, of + 1):
        if part not in numbers:
            problems.append(f"Part {part} left no record: it didn't finish, or didn't run")
    if problems:
        return problems  # the rest only means something with every record there

    flags = {part: record.get("website") for part, record in numbers.items()}
    if any(flag not in (True, False) for flag in flags.values()):
        return [f"A part's record doesn't say whether the website was tested (part: website: {flags})"]
    if len(set(flags.values())) > 1:
        yes = sorted(part for part, flag in flags.items() if flag)
        no = sorted(part for part, flag in flags.items() if not flag)
        return [f"The parts disagree about whether the website was tested: parts {yes} say yes, parts {no} say no"]
    if not any(flags.values()):
        return []  # the change doesn't touch the website: nothing was tested, and every part says so

    everything, mine = {}, {}
    for part, record in numbers.items():
        everything[part], mine[part] = lists_of(record, "all"), lists_of(record, "mine")
        for field, found in (("all", everything[part]), ("mine", mine[part])):
            if found is None:
                problems.append(f"Part {part}'s `{field}` isn't a list of test names")
            elif len(set(found)) != len(found):
                problems.append(f"Part {part}'s `{field}` names a test twice")
    if problems:
        return problems

    whole = set(everything[1])
    if not whole:
        return ["The whole list of tests is empty: nothing was tested, so there is nothing to add up"]
    for part in range(2, of + 1):
        other = set(everything[part])
        if other != whole:
            problems.append(
                f"Part {part} saw a different list of tests than part 1 (the lists come from the same files):"
                f"\n  only in part 1:{named(whole - other)}\n  only in part {part}:{named(other - whole)}")
    ran = {}
    for part, found in mine.items():
        for test in found:
            ran.setdefault(test, []).append(part)
    doubled = {test for test, parts in ran.items() if len(parts) > 1}
    if doubled:
        problems.append(f"{len(doubled)} tests ran in more than one part:{named(doubled)}")
    left_out, extra = whole - set(ran), set(ran) - whole
    if left_out:
        problems.append(f"{len(left_out)} tests ran in no part:{named(left_out)}")
    if extra:
        problems.append(f"{len(extra)} tests ran that aren't in the whole list:{named(extra)}")
    return problems


def seconds_of(record):
    times = record.get("times")
    if not isinstance(times, dict):
        return 0.0
    return sum(v for v in times.values() if isinstance(v, (int, float)) and not isinstance(v, bool))


def untouched(folder, part, of):
    """Writes the record of a part that had nothing to test."""
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, f"part-{part}.json"), "w", encoding="utf-8") as f:
        json.dump({"part": part, "of": of, "website": False}, f)
        f.write("\n")


def merged_times(records, run="local", today=None):
    """The times file's content: every part's measured seconds in one, to the hundredth."""
    times = {}
    for record in records:
        if record.get("website") is not True or not isinstance(record.get("times"), dict):
            continue
        for test, seconds in record["times"].items():
            if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and seconds > 0:
                times[test] = max(round(seconds, 2), 0.01)
    today = today or datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    return {"version": 1, "measured": f"{today}, run {run}", "times": dict(sorted(times.items()))}


def balance(records):
    """(lines to print, warning or None): each part's summed seconds, and whether they're far apart."""
    sums = {r["part"]: seconds_of(r) for r in records if r.get("website") is True and "part" in r}
    lines = [f"Part {part}: {sums[part]:.1f} s of tests" for part in sorted(sums)]
    if len(sums) > 1 and min(sums.values()) > 0:
        slowest, quickest = max(sums.values()), min(sums.values())
        if slowest > quickest * (1 + IMBALANCE):
            return lines, (
                f"The parts are out of balance: the slowest took {slowest:.1f} s of tests, the quickest "
                f"{quickest:.1f} s (more than {IMBALANCE:.0%} apart). Refresh product/web/e2e/test-times.json "
                "from this run's screen-test-times artifact.")
    return lines, None


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        command, rest = argv[0], argv[1:]
        if command == "untouched" and len(rest) == 3:
            untouched(rest[0], int(rest[1]), int(rest[2]))
            say(f"Part {rest[1]} of {rest[2]}: this change doesn't touch the website, so there was nothing to test.")
            return 0
        if command == "add-up" and len(rest) == 2:
            folder, of = rest[0], int(rest[1])
        elif command == "times" and len(rest) == 2:
            folder, out = rest
        else:
            raise IndexError
    except (IndexError, ValueError):
        sys.exit(__doc__)

    records, unreadable = read_records(folder)
    if command == "times":
        content = merged_times(records, run=os.environ.get("GITHUB_RUN_ID", "local"))
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(content, f, indent=2, ensure_ascii=False)  # keeps the › in a key as it is
            f.write("\n")
        lines, warning = balance(records)
        print("\n".join(lines))
        print(f"{len(content['times'])} tests' times written to {out}")
        if warning:
            print(f"::warning title=Screen check parts out of balance::{warning}")
        return 0

    print(f"website={'true' if tested(records) else 'false'}")  # first: the screenshots follow it
    problems = add_up(records, of, unreadable)
    if problems:
        for problem in problems:
            say(f"- {problem}")
        # One line for the annotation (a line break would cut it short); the full text is above.
        summary = "; ".join(problem.split("\n")[0].rstrip(":") for problem in problems)
        say(f"::error title=The Screen check's parts don't add up::{summary}")
        return 1
    if not tested(records):
        say(f"All {of} parts say this change doesn't touch the website: nothing to test, nothing missing.")
        return 0
    total = len(records[0]["all"])
    say(f"The {of} parts ran {total} of {total} tests, each exactly once.")
    for record in sorted(records, key=lambda r: r["part"]):
        say(f"  part {record['part']}: {len(record['mine'])} tests, {seconds_of(record):.1f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
