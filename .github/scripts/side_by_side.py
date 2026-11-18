#!/usr/bin/env python3
"""The side-by-side trial's small helper: a part's record, the plan, the record's verdict, the tally.

    python3 .github/scripts/side_by_side.py untouched <folder> <part>/<of>
    python3 .github/scripts/side_by_side.py not-measured <folder> <part>/<of>
    python3 .github/scripts/side_by_side.py speed-plan <one-machine folder> <parts folder> <of> <out folder> >> "$GITHUB_OUTPUT"
    python3 .github/scripts/side_by_side.py finalize <out folder> [app] >> "$GITHUB_OUTPUT"
    python3 .github/scripts/side_by_side.py tally speed --limits <speed-allowances.json> [--current <comparison.json>] >> "$GITHUB_STEP_SUMMARY"
    python3 .github/scripts/side_by_side.py app-plan <one-machine folder> <out folder> >> "$GITHUB_OUTPUT"
    python3 .github/scripts/side_by_side.py app-compare <one-machine folder> <phone folder> <tablet folder> <out folder> --allowances <cold-start-allowances.json>
    python3 .github/scripts/side_by_side.py tally app --limits <cold-start-allowances.json> [--current <comparison.json>] >> "$GITHUB_STEP_SUMMARY"

A faster version of a required check runs beside today's one (.github/workflows/checks.yml: "Speed
check on three machines" beside "Speed check"). Today's check stays the required one and stays as it
is; every pull request that measures the website compares the two, and a later change switches only
when five pull requests in a row compared clean and their average difference is within its limits.

Each comparison leaves one record, comparison.json, kept 30 days as an artifact whose NAME carries
the verdict, so the tally can count from names alone and read a file only when it needs the numbers:

  - `speed-comparison-clean` and `speed-comparison-not-clean`: the comparison RAN, and the three
    machines did or didn't measure what one did;
  - `speed-comparison-not-run`: the comparison didn't run (a part left no results, or the joining or
    comparing step errored: a record with no pages). That is machinery, not evidence about measuring
    (the parts start as the required check finishes, which is when auto-merge can merge and GitHub
    drops the pull request's merge commit under them), so the tally passes it over: it is neither
    clean nor not clean, doesn't end the row and doesn't count, and the summary lists it.

  - `untouched` writes a part's record when the change doesn't touch the website:
    {"part", "of", "website": false}. The part passes at once; nothing was measured.
  - `not-measured` writes a part's record when the website is touched but the Speed check left no
    numbers to compare with (it never got to measure, for instance because Vercel missed the
    preview): the part leaves at once instead of waiting for the preview.
  - `speed-plan` decides what the comparison job does. It is "measured" when the one-machine Speed
    check left its numbers (speed-one-machine); without them (the website wasn't touched, or the
    check never got to measure) there is no comparison and no record. When measured, it prints
    `measure=true` if all three parts left results to join and compare. Otherwise it writes a
    not-run record into <out folder> (a part left no results, or the parts disagree with the
    one-machine check about whether the website was touched).
  - `finalize` says which record there is: `verdict=clean`, `verdict=not-clean` or
    `verdict=not-run`. If the comparison step errored and left no record, it writes a not-run one,
    "the comparison failed" (of the Speed check's kind, or `app`'s).
  - `tally` counts, from the artifacts' names, how many pull requests in a row compared clean:
    it lists the repository's artifacts of the three names through GitHub's API (GITHUB_TOKEN with
    `actions: read`, GITHUB_REPOSITORY), the not-clean and not-run names before the clean one and
    each list to its end, sorts them by time itself and groups them by branch (a pull request).
    Records that didn't run are passed over. Starting with the newest pull request, one with ANY
    not-clean record ends the row (a retry never makes a pull request clean); the rest count, until
    five. At five it downloads every record of those five pull requests, averages each one's
    average difference (three machines minus one), averages the five (each weighted equally) and
    says whether busy time and load are within the limits in the allowances file. `--current` is
    this run's own record (BRANCH is its branch), counted before the list shows it.
    It makes at most 40 requests and never retries: the job token's hourly allowance is shared
    with the checks that wait for the preview. If the requests run out after every not-clean and
    not-run record was listed it says "at least N"; before that it gives no count at all. If GitHub
    doesn't answer, it says so and exits 0.

App journeys on two machines runs the same trial (.github/workflows/app-journeys.yml: "App journeys on
two machines" beside the required "App journeys"), with the artifacts `app-comparison-clean`,
`-not-clean` and `-not-run` (kept 90 days: app-touching pull requests are fewer, and five may span
weeks), the same tally and the same rules, and these of its own:

  - `app-plan` says whether there is a comparison at all: `measured=true` only when the one-machine
    App journeys ran its journeys (it left phone.xml) AND main holds a two-machine baseline
    (BASELINE=true, from a cache lookup). Otherwise there is no record, and comparison.md says why
    ("not counted: ..."). A one-machine run that stopped at a failed flow has phone.xml and no
    startup.json (run.sh stops there): it is compared too.
  - `app-compare` judges the two ways of running the same journeys. Clean only when ALL hold: every
    flow passed on both sides at both sizes with the same names (the Maestro JUnit files phone.xml
    and tablet.xml); both sides' cold start verdicts (startup.json's `passes`, each against its own
    main baseline) are equal; and the two-machine cold start's median is within `allowanceMs` of the
    one-machine median (product/app/journeys/cold-start-allowances.json). Any DISAGREEMENT is not
    clean: a flow that passed on one side and failed on the other, different flow names, a side that
    left nothing while the other measured ("measured nothing"), differing cold-start verdicts, medians
    too far apart. `flip` is true when two machines pass a flow, or the cold start's verdict, that one
    machine fails. A size the one-machine run never got to (it stops at its first failed flow) has
    nothing to compare. When nothing disagrees but a flow failed on BOTH ways (a broken pull request,
    not evidence about splitting), or the tablet machine's cold start had no baseline from main
    (`mainMedianMs` empty in its startup.json), the record is NOT RUN (`ran: false`): passed over by the
    tally, neither clean nor not clean. The record holds the signed `differenceMs` (two machines - one
    machine).
  - The five-comparison average is the average of the five pull requests' `differenceMs`, each pull
    request weighted equally, within `fiveComparisonAverageMs`.

Python's standard library only. Prints no secrets: counts, pull request numbers and page paths.
"""
import http.client
import io
import json
import os
import re
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

NEEDED = 5  # pull requests in a row that compared clean before a later change switches
MAX_REQUESTS = 40  # one tally's requests to GitHub: the job token allows ~1,000 an hour, shared
MAX_PAGES = 15  # pages of artifacts read for each name
PER_PAGE = 100
RECORD = "comparison.json"
RECORD_LIMIT = 1024 * 1024  # a record is a few kilobytes; nothing bigger is read
# The artifacts' names by verdict, in the order they are listed: what could end the row or be passed
# over comes first, so a list cut short by the request budget can't overstate the count.
NAMES = {"speed": {"not-clean": "speed-comparison-not-clean", "not-run": "speed-comparison-not-run",
                   "clean": "speed-comparison-clean"},
         "app": {"not-clean": "app-comparison-not-clean", "not-run": "app-comparison-not-run",
                 "clean": "app-comparison-clean"}}
API = "https://api.github.com"
M75_BRANCH = "claude/r6-r4-m7-5-speed-split"  # its runs prove the plumbing, not the comparison: never counted
NOT_COUNTED = frozenset({"main", M75_BRANCH})


def say(text=""):
    print(text, file=sys.stderr)


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_json(path, content):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(content, f, indent=2, ensure_ascii=False)
        f.write("\n")


def pr_number(text):
    """The pull request's number from PR_NUMBER, or None when the run isn't a pull request's."""
    return int(text) if text and text.isdigit() and int(text) > 0 else None


def valid_share(text):
    """"2/3": a part number, a slash, and the number of parts, the part among them."""
    part, _, of = text.partition("/")
    return part.isdigit() and of.isdigit() and 1 <= int(part) <= int(of)


# --- a part with nothing to measure ----------------------------------------------------------

def untouched(folder, share):
    part, of = (int(n) for n in share.split("/"))
    write_json(os.path.join(folder, "untouched.json"), {"part": part, "of": of, "website": False})


def not_measured(folder, share):
    part, of = (int(n) for n in share.split("/"))
    write_json(os.path.join(folder, "not-measured.json"), {"part": part, "of": of, "website": True, "measured": False})


# --- the records ---------------------------------------------------------------------------------

def verdict_of(record):
    """`clean`, `not-clean` or `not-run` for a comparison record; None when it isn't a record at all. A
    record whose comparison didn't run says so (`ran: false`) or has no pages."""
    if not isinstance(record, dict) or not isinstance(record.get("clean"), bool):
        return None
    pages = record.get("pages")
    if record.get("ran") is False or (isinstance(pages, list) and not pages):
        return "not-run"
    return "clean" if record["clean"] else "not-clean"


def failed_record(commit, pr, reason, kind="speed"):
    """A comparison that was due and didn't run (`ran: false`), so the tally passes it over."""
    if kind == "app":
        return {"kind": "app", "commit": commit, "pr": pr, "measured": True, "ran": False, "clean": False,
                "reasons": [reason], "differenceMs": None, "flip": False}
    return {"kind": "speed", "commit": commit, "pr": pr, "measured": True, "ran": False, "clean": False,
            "reasons": [reason], "pages": [], "averages": {"busyMs": 0, "loadMs": 0}, "flip": False}


def write_failed(out, environ, reason, kind="speed"):
    write_json(os.path.join(out, RECORD), failed_record(environ.get("COMMIT", ""),
                                                        pr_number(environ.get("PR_NUMBER", "")), reason, kind))
    with open(os.path.join(out, "comparison.md"), "w", encoding="utf-8") as f:
        f.write(f"**Not run, so passed over and not counted:** {reason}\n")


# --- the plan for one comparison ------------------------------------------------------------

def part_states(parts_folder, of):
    states = {}
    for part in range(1, of + 1):
        folder = os.path.join(parts_folder, f"speed-part-{part}")
        record = read_json(os.path.join(folder, "untouched.json"))
        if os.path.isfile(os.path.join(folder, "website.json")):
            states[part] = "measured"
        elif isinstance(record, dict) and record.get("website") is False:
            states[part] = "untouched"
        elif os.path.isfile(os.path.join(folder, "not-measured.json")):
            states[part] = "not-measured"
        else:
            states[part] = "none"
    return states


def speed_plan(one_folder, parts_folder, of, parts_result):
    """(measured, measure, reason): whether there is a comparison at all (the one-machine check left
    its numbers), whether the parts left results to compare, and why not when they didn't."""
    if not os.path.isfile(os.path.join(one_folder, "website.json")):
        return False, False, ("The Speed check left no numbers (the website wasn't touched, or it never got "
                              "to measure), so there is nothing to compare.")
    states = part_states(parts_folder, of)
    if set(states.values()) == {"measured"}:
        return True, True, ""
    missing = sorted(part for part, state in states.items() if state in ("none", "not-measured"))
    if missing:
        names = ", ".join(str(part) for part in missing)
        return True, False, (f"Part {names} of the three machines left no results (the parts' result was "
                             f"'{parts_result}')")
    return True, False, ("The three machines' parts disagree with the Speed check about whether the website was "
                         "touched (it measured it)")


def plan(argv, environ=os.environ):
    one_folder, parts_folder, of, out = argv[0], argv[1], int(argv[2]), argv[3]
    measured, measure, reason = speed_plan(one_folder, parts_folder, of, environ.get("PARTS_RESULT", ""))
    print(f"measured={'true' if measured else 'false'}")
    print(f"measure={'true' if measure else 'false'}")
    if measure:
        say(f"All {of} parts and the one-machine check left results to compare.")
    elif measured:
        say(f"Not run: {reason}")
        write_failed(out, environ, reason)
    else:
        say(reason)
    return 0


def finalize(out, environ=os.environ, kind="speed"):
    """Says `verdict=clean`, `verdict=not-clean` or `verdict=not-run` for the record in <out>, writing
    a not-run one first if the comparison errored and left none."""
    record = read_json(os.path.join(out, RECORD))
    verdict = verdict_of(record)
    if verdict is None:
        write_failed(out, environ, "the comparison failed", kind)
        verdict = verdict_of(read_json(os.path.join(out, RECORD)))
        say("The comparison step left no record: a not-run one is kept, so a failing comparison leaves a trace.")
    print(f"verdict={verdict}")
    return 0


# --- App journeys on two machines: the plan and the comparison --------------------------------------

SIZES = ("phone", "tablet")
BASELINE_NONE = "Not counted: no two-machine baseline on main yet (main's next App journeys run saves it)."
UNTOUCHED = ("Not counted: the app wasn't touched, or the one-machine App journeys left no results (no phone.xml), so "
             "there is nothing to compare.")


def app_plan(one_folder, out, environ=os.environ):
    """Whether there is a comparison at all: the one-machine App journeys ran its journeys (it left the phone's
    report) and main holds a two-machine baseline. Otherwise no record: comparison.md says why. A run whose
    journeys failed has a report and no cold start (run.sh stops at the failed flow): it is compared too, so a
    flow that passes on two machines and fails on one is seen."""
    ran = os.path.isfile(os.path.join(one_folder, "phone.xml"))
    baseline = environ.get("BASELINE", "") == "true"
    measured = ran and baseline
    print(f"measured={'true' if measured else 'false'}")
    if measured:
        say("The one-machine App journeys ran and main holds a two-machine baseline: compared.")
        return 0
    reason = UNTOUCHED if not ran else BASELINE_NONE
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "comparison.md"), "w", encoding="utf-8") as f:
        f.write(reason + "\n")
    say(reason)
    return 0


def read_flows(path):
    """{flow name: passed} from a Maestro JUnit file, or None when there is no readable one. A flow passed
    when its testcase has no failure or error and its status (Maestro writes one) is SUCCESS or WARNING."""
    try:
        with open(path, "rb") as f:
            data = f.read(RECORD_LIMIT + 1)
        if len(data) > RECORD_LIMIT or b"<!DOCTYPE" in data or b"<!ENTITY" in data:
            return None  # a report is a few kilobytes and has no entities
        root = ET.fromstring(data)
    except (OSError, ET.ParseError):
        return None
    flows = {}
    for case in root.iter("testcase"):
        name = case.get("name") or case.get("id")
        if not name:
            continue
        status = case.get("status")
        flows[name] = (case.find("failure") is None and case.find("error") is None
                       and (status is None or status.upper() in ("SUCCESS", "WARNING")))
    return flows


def read_startup(path):
    """startup.json's {medianMs, passes, mainMedianMs} (the median of main's baseline the run compared with, or
    None when it had none), or None when there is no startup.json or it isn't one."""
    found = read_json(path)
    if isinstance(found, dict) and number(found.get("medianMs")) and isinstance(found.get("passes"), bool):
        main = found.get("mainMedianMs")
        return {"medianMs": found["medianMs"], "passes": found["passes"], "mainMedianMs": main if number(main) else None}
    return None


def read_app_allowance(path):
    found = read_json(path)
    allowance = found.get("allowanceMs") if isinstance(found, dict) else None
    if not number(allowance) or allowance <= 0:
        sys.exit(f"{path} has no allowanceMs")
    return allowance


def names_of(flows):
    """Up to six flow names, each in backticks and kept to one plain line."""
    return (", ".join(f"`{clean_name_text(name)[:150]}`" for name in sorted(flows)[:6])
            + (" and more" if len(flows) > 6 else ""))


def compare_flows(size, one, two, stopped):
    """(reasons, flip, counts, shared) for one size's journeys. `one` and `two` are {name: passed} or None (no
    report). A reason is a disagreement: a side with no report (but the one-machine run stops at its first failed
    flow, so `stopped` sizes after it have none and nothing to compare), different flow names, or a flow that
    passed on one side and failed on the other. `flip` is a flow that passes on two machines and fails on one.
    `shared` are the flows that failed on both sides: no disagreement, so no reason of their own."""
    reasons, flip, shared = [], False, []
    counts = {side: ([sum(flows.values()), len(flows)] if flows is not None else None)
              for side, flows in (("one", one), ("two", two))}
    if two is None:
        reasons.append(f"the two-machine side measured nothing at the {size} size (no {size}.xml)")
    if one is None and not stopped:
        reasons.append(f"the one-machine run left no {size}.xml")
    for flows, label in ((one, "one machine"), (two, "two machines")):
        if flows is not None and not flows:
            reasons.append(f"no flow ran at the {size} size on {label}")
    if one is not None and two is not None:
        if set(one) != set(two):
            only_one, only_two = sorted(set(one) - set(two)), sorted(set(two) - set(one))
            reasons.append(f"the flows at the {size} size differ: only on one machine: "
                           f"{names_of(only_one) or 'none'}; only on two machines: {names_of(only_two) or 'none'}")
        both = set(one) & set(two)
        failed_on_one = sorted(name for name in both if not one[name] and two[name])
        failed_on_two = sorted(name for name in both if one[name] and not two[name])
        shared = sorted(name for name in both if not one[name] and not two[name])
        if failed_on_one:
            reasons.append(f"at the {size} size, {names_of(failed_on_one)} failed on one machine and passed on two")
        if failed_on_two:
            reasons.append(f"at the {size} size, {names_of(failed_on_two)} failed on two machines and passed on one")
        flip = bool(failed_on_one)
    return reasons, flip, counts, shared


def compare_app(one_folder, phone_folder, tablet_folder, allowance, commit="", pr=None):
    """(record, text) for the two ways of running App journeys: see the module's description. A record is not
    clean on any disagreement; with none, it is clean unless a flow failed on both ways (a broken pull request,
    not evidence about splitting) or the tablet's cold start had no baseline from main: then it did not run
    (`ran: false`), and the tally passes it over."""
    reasons, flip, flows, shared, notes = [], False, {}, [], []
    sides = {"phone": phone_folder, "tablet": tablet_folder}
    stopped = False  # the one-machine run stops at its first failed flow or missing report, and so has no later size
    tablet = None
    for size in SIZES:
        one = read_flows(os.path.join(one_folder, f"{size}.xml"))
        two = read_flows(os.path.join(sides[size], f"{size}.xml"))
        found, flipped, counts, both_failed = compare_flows(size, one, two, stopped)
        reasons += found
        flip = flip or flipped
        if both_failed:
            shared.append(f"at the {size} size, {names_of(both_failed)} failed on both ways")
        flows[size] = {"oneMachine": counts["one"], "twoMachines": counts["two"]}
        stopped = stopped or one is None or not all(one.values())
        if size == "tablet":
            tablet = two
    # On two machines only the tablet's machine runs the cold start, so only its report explains a missing one.
    two_stopped = tablet is None or not all(tablet.values())
    one_start = read_startup(os.path.join(one_folder, "startup.json"))
    two_start = read_startup(os.path.join(tablet_folder, "startup.json"))
    if two_start is None and not two_stopped:
        reasons.append("the two-machine side measured no cold start (its tablet machine left no startup.json)")
    if one_start is None and not stopped:
        reasons.append("the one-machine run left no cold start")
    no_baseline = two_start is not None and two_start["mainMedianMs"] is None
    difference = None
    if one_start and two_start:
        difference = two_start["medianMs"] - one_start["medianMs"]
        if not no_baseline and one_start["passes"] != two_start["passes"]:
            reasons.append("the cold start's verdict differs: "
                           f"{'passes' if two_start['passes'] else 'fails'} on two machines, "
                           f"{'passes' if one_start['passes'] else 'fails'} on one")
            flip = flip or (two_start["passes"] and not one_start["passes"])
        if abs(difference) > allowance:
            reasons.append(f"the two-machine cold start's median differs by {difference:+g} ms from the one-machine "
                           f"run's, more than the allowance of {allowance:g} ms")
    if no_baseline:
        notes.append("the tablet machine's cold start had no baseline from main (its mainMedianMs is empty), so its "
                     "verdict can't be compared")
    ran = bool(reasons) or not (shared or notes)
    if not ran:
        notes = [f"{text} (a broken pull request, not evidence about splitting)" for text in shared] + notes
    record = {"kind": "app", "commit": commit, "pr": pr, "measured": True, "ran": ran, "clean": not reasons and ran,
              "reasons": reasons if reasons or ran else notes, "flip": flip and bool(reasons), "flows": flows,
              "oneMedianMs": one_start["medianMs"] if one_start else None,
              "twoMedianMs": two_start["medianMs"] if two_start else None,
              "differenceMs": difference, "allowanceMs": allowance,
              "verdicts": {"one": one_start["passes"] if one_start else None,
                           "two": two_start["passes"] if two_start else None}}
    return record, app_text(record)


def app_text(record):
    def flows(counts):
        return f"{counts[0]} of {counts[1]} passed" if counts else "no results"

    def start(median, passes):
        return "not measured" if median is None else f"{median / 1000:.2f} s ({'passes' if passes else 'fails'} against main)"

    if record["clean"]:
        lines = ["**Clean:** every flow passed on both sides at both sizes, the cold starts agree, and their "
                 "medians are within the allowance."]
    elif record["ran"]:
        lines = ["**Not clean:**"] + [f"- {clean_name_text(r)}" for r in record["reasons"]]
        if record["flip"]:
            lines.append("- **something passes on two machines that fails on one**")
    else:
        lines = ["**Not run, so passed over and not counted:**"] + [f"- {clean_name_text(r)}" for r in record["reasons"]]
    verdicts = record["verdicts"]
    lines += ["", "| | One machine | Two machines |", "|---|---|---|"]
    for size in SIZES:
        counts = record["flows"][size]
        lines.append(f"| Journeys, {size} size | {flows(counts['oneMachine'])} | {flows(counts['twoMachines'])} |")
    lines.append(f"| Cold start, median of 7 | {start(record['oneMedianMs'], verdicts['one'])} | "
                 f"{start(record['twoMedianMs'], verdicts['two'])} |")
    if record["differenceMs"] is not None:
        lines += ["", f"The difference (two machines - one machine): {record['differenceMs']:+g} ms, "
                      f"against an allowance of {record['allowanceMs']:g} ms."]
    return "\n".join(lines) + "\n"


def app_compare(argv, environ=os.environ):
    one, phone, tablet, out = argv[:4]
    allowance = read_app_allowance(argv[5])
    record, text = compare_app(one, phone, tablet, allowance, environ.get("COMMIT", ""),
                               pr_number(environ.get("PR_NUMBER", "")))
    write_json(os.path.join(out, RECORD), record)
    with open(os.path.join(out, "comparison.md"), "w", encoding="utf-8") as f:
        f.write(text)
    say("Compared: " + ("clean." if record["clean"] else
                        ("not clean: " if record["ran"] else "not run, passed over: ") + "; ".join(record["reasons"]) + "."))
    return 0


# --- the tally ---------------------------------------------------------------------------------

class Unavailable(Exception):
    """GitHub didn't give an answer the tally could use."""


class OverBudget(Exception):
    """The tally's requests ran out."""


class Requests:
    def __init__(self, cap=MAX_REQUESTS):
        self.cap, self.used = cap, 0

    def take(self):
        if self.used >= self.cap:
            raise OverBudget()
        self.used += 1


class GitHub:
    """GitHub's API, for the artifacts only, one request per call and never a retry. The token goes to
    GitHub's API and never to the storage address a download redirects to (an unredirected header:
    urllib drops it on a redirect)."""

    per_page = PER_PAGE

    def __init__(self, token, repository, api=API, opener=None):
        self.token, self.repository, self.api = token, repository, api.rstrip("/")
        self.opener = opener or urllib.request.build_opener().open

    def get(self, url):
        request = urllib.request.Request(url, headers={
            "Accept": "application/vnd.github+json", "User-Agent": "hrizzup-side-by-side",
            "X-GitHub-Api-Version": "2022-11-28"})
        request.add_unredirected_header("Authorization", f"Bearer {self.token}")
        try:
            with self.opener(request, timeout=60) as answer:
                return answer.read()
        except (urllib.error.URLError, http.client.HTTPException, OSError) as error:  # HTTPError is a URLError
            raise Unavailable(type(error).__name__ + (f" {error.code}" if hasattr(error, "code") else "")) from None

    def page(self, name, number):
        """One page of the repository's artifacts of that name: a list of objects, or Unavailable."""
        url = (f"{self.api}/repos/{self.repository}/actions/artifacts?"
               + urllib.parse.urlencode({"name": name, "per_page": self.per_page, "page": number}))
        try:
            answer = json.loads(self.get(url))
        except ValueError:
            raise Unavailable("an answer that isn't JSON") from None
        found = answer.get("artifacts") if isinstance(answer, dict) else None
        if not isinstance(found, list) or not all(isinstance(a, dict) for a in found):
            raise Unavailable("an answer that isn't a list of artifacts")
        return found

    def download(self, artifact_id):
        return self.get(f"{self.api}/repos/{self.repository}/actions/artifacts/{int(artifact_id)}/zip")


def from_this_repository(artifact):
    """False for a run whose code came from another repository (a fork's pull request): its
    artifact could say anything, so it is never counted."""
    run = artifact.get("workflow_run")
    run = run if isinstance(run, dict) else {}
    head, home = run.get("head_repository_id"), run.get("repository_id")
    return head is None or home is None or head == home


def record_in(zipped):
    """The comparison record inside an artifact's zip, or None when it isn't a readable one."""
    try:
        with zipfile.ZipFile(io.BytesIO(zipped)) as z:
            info = next((i for i in z.infolist() if os.path.basename(i.filename) == RECORD), None)
            if info is None or info.file_size > RECORD_LIMIT:
                return None
            record = json.loads(z.read(info))
    except (zipfile.BadZipFile, ValueError, OSError):
        return None
    return record if isinstance(record, dict) else None


def listing(github, names, budget):
    """(entries, complete): every unexpired artifact of those names that came from this repository's
    own branches (not main, and not the branch of the trial's own pull request), each as {id,
    created_at, branch, run, verdict}, newest first, and {verdict: whether its list was read to its
    end}. The names are read in the order given (not-clean and not-run before clean), each list to
    its end, a page shorter than a full one, because GitHub doesn't say what order it lists in. A list
    is left unfinished when the budget runs out or MAX_PAGES full pages were read."""
    entries, complete = [], {verdict: False for verdict in names}
    try:
        for verdict, name in names.items():
            for number in range(1, MAX_PAGES + 1):
                budget.take()
                found = github.page(name, number)
                for artifact in found:
                    run = artifact.get("workflow_run")
                    run = run if isinstance(run, dict) else {}
                    branch, created = run.get("head_branch"), artifact.get("created_at")
                    if (artifact.get("name") == name and not artifact.get("expired")
                            and from_this_repository(artifact) and isinstance(branch, str) and branch
                            and branch not in NOT_COUNTED and isinstance(artifact.get("id"), int)):
                        entries.append({"id": artifact["id"], "created_at": created if isinstance(created, str) else "",
                                        "branch": branch, "run": run.get("id"), "verdict": verdict})
                if len(found) < github.per_page:
                    complete[verdict] = True
                    break
    except OverBudget:
        pass
    entries.sort(key=lambda e: (e["created_at"], e["id"]), reverse=True)
    return entries, complete


def by_branch(entries):
    """{branch: [entries, newest first]}, the branches in the order of their newest entry."""
    groups = {}
    for entry in entries:
        groups.setdefault(entry["branch"], []).append(entry)
    return groups


def mean(values):
    return statistics.fmean(values)


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def figures(kind, record, keys):
    """{key: number} for the difference(s) a comparison record carries (the Speed check's `averages`; App
    journeys' `differenceMs`), or None when it isn't a usable record of that kind."""
    if not isinstance(record, dict) or record.get("kind") != kind:
        return None
    source = record.get("averages") if kind == "speed" else record
    if not isinstance(source, dict) or not all(number(source.get(key)) for key in keys):
        return None
    if not isinstance(record.get("pr"), int) or isinstance(record.get("pr"), bool) or record["pr"] <= 0:
        return None
    return {key: source[key] for key in keys}


def averaged(github, groups, branches, budget, limits, kind="speed"):
    """(averages, problems): each pull request's records' average difference, then the five averaged
    with equal weight. Every record of the pull requests is read; a record that is missing, isn't a
    comparison, or carries another pull request's number is a problem, and so is a branch whose
    records carry two pull request numbers."""
    problems, per_pr = [], []
    for branch in branches:
        records, numbers = [], set()
        for entry in groups[branch]:
            record = entry.get("record")
            if record is None:
                budget.take()
                record = record_in(github.download(entry["id"]))
            found = figures(kind, record, tuple(limits))
            if found is None:
                problems.append("a record of one of the five pull requests can't be read")
                continue
            records.append(found)
            numbers.add(record["pr"])
        if len(numbers) > 1:
            problems.append("one branch's records carry two pull request numbers: "
                            + " and ".join(f"#{n}" for n in sorted(numbers)))
        if records:
            per_pr.append({key: mean([r[key] for r in records]) for key in limits})
    if problems or len(per_pr) < len(branches):
        return None, problems or ["a pull request's records are missing"]
    return {key: mean([p[key] for p in per_pr]) for key in limits}, []


def clean_name(text):
    return re.sub(r"[^\w./-]", "?", text)


# What the tally says for each trial, besides the numbers.
WORDS = {"speed": {"title": "the Speed check on three machines, beside the Speed check",
                   "flip": "a budget passes on three machines that fails on one",
                   "passed_over": "(a part left no results, or the comparison failed; not counted either way)"},
         "app": {"title": "App journeys on two machines, beside App journeys",
                 "flip": "a flow or the cold start's verdict passes on two machines that fails on one",
                 "passed_over": "(the comparison failed, or both ways failed the same flows, or the tablet's cold "
                                "start had no baseline; not counted either way)"}}


def average_line(kind, averages, limits):
    """The line about the five pull requests' average difference, and whether it is within its limits."""
    if kind == "app":
        diff, limit = averages["differenceMs"], limits["differenceMs"]
        standing = ("**outside its limit:** the cold start's median" if abs(diff) > limit
                    else "**within its limits**")
        return ("The five pull requests' average difference in the cold start's median (two machines - one "
                f"machine, each pull request weighted equally): {diff:+.1f} ms (limit +/-{limit} ms): {standing}.")
    busy, load = averages["busyMs"], averages["loadMs"]
    outside = [name for name, value, limit in (("busy time", busy, limits["busyMs"]),
                                               ("load", load, limits["loadMs"])) if abs(value) > limit]
    standing = ("**outside its limits:** " + " and ".join(outside)) if outside else "**within its limits**"
    return ("The five pull requests' average difference (three machines - one machine, each pull request "
            f"weighted equally): busy {busy:+.1f} ms (limit +/-{limits['busyMs']} ms), load {load:+.1f} ms "
            f"(limit +/-{limits['loadMs']} ms): {standing}.")


def tally(github, kind, limits, current=None, branch=None, run_id=None, budget=None):
    """(summary text, pull requests counted or None, reached the budget). See the module's description."""
    names = NAMES[kind]
    words = WORDS[kind]
    budget = budget or Requests()
    heading = [f"### The tally: {words['title']}", ""]
    entries, complete = listing(github, names, budget)
    capped = not all(complete.values())
    # The count is only an "at least" if every list that could end the row or be passed over was read.
    trusted = all(done for verdict, done in complete.items() if verdict != "clean")
    if current is not None and branch and branch not in NOT_COUNTED and verdict_of(current):
        # This run's own record is counted from the file. The list may already show it (same run, same
        # verdict) and must not count it twice; an earlier attempt of the same run with another verdict is
        # another record and stays, so a re-run can't make a pull request look clean.
        verdict = verdict_of(current)
        entries = [e for e in entries if not (e["run"] == run_id and e["verdict"] == verdict)]
        entries.insert(0, {"id": None, "created_at": "9999", "branch": branch, "run": run_id,
                           "verdict": verdict, "record": current})

    lines = list(heading)
    if capped and not trusted:
        lines += [f"**No count this run:** the {MAX_REQUESTS} requests this tally may make ran out before every "
                  "not-clean record was listed, so any count could be too high.", ""]
        return "\n".join(lines) + "\n", None, True

    # A comparison that didn't run is passed over: neither clean nor not clean.
    passed = [e for e in entries if e["verdict"] == "not-run"]
    groups = by_branch([e for e in entries if e["verdict"] != "not-run"])
    counted, ended = [], None
    for name, found in groups.items():
        if all(e["verdict"] == "clean" for e in found):
            counted.append(name)
            if len(counted) == NEEDED:
                break
        else:
            ended = (name, found)
            break

    if capped:
        lines += [f"**At least {line_for(len(counted))}**: the {MAX_REQUESTS} requests this tally may make ran out "
                  "while listing the clean records, so the list may be incomplete.", ""]
    else:
        lines += [f"**{line_for(len(counted))}**", ""]
    if counted:
        lines.append("Counted: " + ", ".join(f"`{clean_name(b)}`" for b in counted) + ".")
    if ended:
        lines += ["", f"The row ended at `{clean_name(ended[0])}`, which has a record that is not clean."]
        newest_bad = next(e for e in ended[1] if e["verdict"] == "not-clean")
        record = newest_bad.get("record")
        try:
            if record is None:
                budget.take()
                record = record_in(github.download(newest_bad["id"]))
        except (OverBudget, Unavailable):
            record = None
        if record:
            pr = record.get("pr")
            lines.append(f"Its newest not-clean record is for #{pr if isinstance(pr, int) else '?'} (commit "
                         f"`{clean_name(str(record.get('commit') or '')[:7])}`)"
                         + (f", and **{words['flip']}**:" if record.get("flip") is True else ":"))
            lines += [f"- {clean_name_text(r)}" for r in (record.get("reasons") or [])[:8] if isinstance(r, str)]
    if passed:
        shown = {}
        for entry in passed:
            shown[entry["branch"]] = shown.get(entry["branch"], 0) + 1
        names_shown = [f"`{clean_name(b)}`" + (f" ({n} records)" if n > 1 else "") for b, n in list(shown.items())[:10]]
        lines += ["", "Passed over, because the comparison didn't run " + words["passed_over"] + ": "
                  + ", ".join(names_shown)
                  + (f" and {len(shown) - 10} more" if len(shown) > 10 else "") + "."]
    if len(counted) == NEEDED and not capped:
        try:
            averages, problems = averaged(github, groups, counted, budget, limits, kind)
        except OverBudget:
            averages, problems = None, [f"the {MAX_REQUESTS} requests this tally may make ran out before every "
                                        "record was read"]
        except Unavailable:
            averages, problems = None, ["GitHub didn't answer"]
        lines += [""]
        if averages is None:
            lines.append("**The five-comparison average can't be checked this run:** " + "; ".join(problems) + ".")
        else:
            lines.append(average_line(kind, averages, limits))
    return "\n".join(lines) + "\n", len(counted), capped


def clean_name_text(text):
    """A reason, one line, without anything that could break the summary's layout."""
    return re.sub(r"[`\r\n|]", "'", text)[:300]


def line_for(count):
    noun = "pull request" if count == 1 else "pull requests"
    return f"{count} {noun} in a row clean (the switch needs {NEEDED})"


def read_limits(path, kind="speed"):
    """The five-comparison average's limits from an allowances file: the Speed check's busy and load times,
    or App journeys' one number (`fiveComparisonAverageMs`)."""
    allowances = read_json(path)
    if kind == "app":
        limit = allowances.get("fiveComparisonAverageMs") if isinstance(allowances, dict) else None
        if not number(limit) or limit <= 0:
            sys.exit(f"{path} has no fiveComparisonAverageMs limit")
        return {"differenceMs": limit}
    average = allowances.get("fiveComparisonAverage") if isinstance(allowances, dict) else None
    if not (isinstance(average, dict) and number(average.get("busyMs")) and number(average.get("loadMs"))):
        sys.exit(f"{path} has no fiveComparisonAverage limits")
    return {"busyMs": average["busyMs"], "loadMs": average["loadMs"]}


def run_tally(argv, environ=os.environ):
    kind, rest = argv[0], argv[1:]
    options = dict(zip(rest[::2], rest[1::2]))
    limits = read_limits(options["--limits"], kind)
    current = read_json(options["--current"]) if "--current" in options else None
    if not isinstance(current, dict):
        current = None  # this run left none: the stored ones still count
    github = GitHub(environ["GITHUB_TOKEN"], environ["GITHUB_REPOSITORY"], api=environ.get("GITHUB_API_URL") or API)
    run_id = environ.get("GITHUB_RUN_ID", "")
    try:
        text, count, capped = tally(github, kind, limits, current, environ.get("BRANCH") or None,
                                    int(run_id) if run_id.isdigit() else None)
    except Unavailable as error:
        print("### The tally\n\nTally unavailable this run (GitHub didn't answer).\n")
        say(f"tally unavailable this run: {error}")
        return 0
    print(text)
    say("no count this run (the request budget ran out)" if count is None
        else ("at least " if capped else "") + line_for(count))
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    command, rest = (argv[0], argv[1:]) if argv else ("", [])
    if command == "untouched" and len(rest) == 2 and valid_share(rest[1]):
        untouched(*rest)
        say(f"Part {rest[1]}: this change doesn't touch the website, so there was nothing to measure.")
        return 0
    if command == "not-measured" and len(rest) == 2 and valid_share(rest[1]):
        not_measured(*rest)
        say(f"Part {rest[1]}: the Speed check left no numbers to compare with, so this part leaves at once.")
        return 0
    if command == "speed-plan" and len(rest) == 4 and rest[2].isdigit() and int(rest[2]) >= 1:
        return plan(rest)
    if command == "finalize" and len(rest) in (1, 2) and (len(rest) == 1 or rest[1] == "app"):
        return finalize(rest[0], kind=rest[1] if len(rest) == 2 else "speed")
    if command == "app-plan" and len(rest) == 2:
        return app_plan(*rest)
    if command == "app-compare" and len(rest) == 6 and rest[4] == "--allowances":
        return app_compare(rest)
    if (command == "tally" and len(rest) in (3, 5) and rest[0] in NAMES and rest[1] == "--limits"
            and (len(rest) == 3 or rest[3] == "--current")):
        return run_tally(rest)
    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main())
