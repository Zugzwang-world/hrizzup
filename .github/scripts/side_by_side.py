#!/usr/bin/env python3
"""The side-by-side trial's small helper: a part's record, the plan, the record's verdict, the tally.

    python3 .github/scripts/side_by_side.py untouched <folder> <part>/<of>
    python3 .github/scripts/side_by_side.py speed-plan <one-machine folder> <parts folder> <of> <out folder> >> "$GITHUB_OUTPUT"
    python3 .github/scripts/side_by_side.py finalize <out folder> >> "$GITHUB_OUTPUT"
    python3 .github/scripts/side_by_side.py tally speed --limits <speed-allowances.json> [--current <comparison.json>] >> "$GITHUB_STEP_SUMMARY"

A faster version of a required check runs beside today's one (.github/workflows/checks.yml: "Speed
check on three machines" beside "Speed check"). Today's check stays the required one and stays as it
is; every pull request that measures the website compares the two, and a later change switches only
when five pull requests in a row compared clean and their average difference is within its limits.

Each comparison leaves one record, comparison.json, kept 30 days as an artifact whose NAME carries
the verdict (`speed-comparison-clean` or `speed-comparison-not-clean`), so the tally can count from
names alone and read a file only when it needs the numbers.

  - `untouched` writes a part's record when the change doesn't touch the website:
    {"part", "of", "website": false}. The part passes at once; nothing was measured.
  - `speed-plan` decides what the comparison job does. It is "measured" when the one-machine Speed
    check left its numbers (speed-one-machine); without them (the website wasn't touched, or the
    check never got to measure) there is no comparison and no record. When measured, it prints
    `measure=true` if all three parts left results to join and compare. Otherwise it writes a
    not-clean record into <out folder> (a part left no results, or the parts disagree with the
    one-machine check about whether the website was touched): a failing trial counts against the
    trial, so it can never hide a push.
  - `finalize` says which record there is: `verdict=clean` or `verdict=not-clean`. If the comparison
    step errored and left no record, it writes a not-clean one, "the comparison failed".
  - `tally` counts, from the artifacts' names, how many pull requests in a row compared clean:
    it lists the repository's artifacts of both names through GitHub's API (GITHUB_TOKEN with
    `actions: read`, GITHUB_REPOSITORY), reading each list to its end, sorts them by time itself and
    groups them by branch (a pull request). Starting with the newest pull request, one with ANY
    not-clean record ends the row (a retry never makes a pull request clean); the rest count, until
    five. At five it downloads every record of those five pull requests, averages each one's
    average difference (three machines minus one), averages the five (each weighted equally) and
    says whether busy time and load are within the limits in the allowances file. `--current` is
    this run's own record (BRANCH is its branch), counted before the list shows it.
    It makes at most 40 requests and never retries: the job token's hourly allowance is shared
    with the checks that wait for the preview. If GitHub doesn't answer, it says so and exits 0.

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
import zipfile

NEEDED = 5  # pull requests in a row that compared clean before a later change switches
MAX_REQUESTS = 40  # one tally's requests to GitHub: the job token allows ~1,000 an hour, shared
MAX_PAGES = 15  # pages of artifacts read for each name
PER_PAGE = 100
RECORD = "comparison.json"
RECORD_LIMIT = 1024 * 1024  # a record is a few kilobytes; nothing bigger is read
NAMES = {"speed": ("speed-comparison-clean", "speed-comparison-not-clean")}
API = "https://api.github.com"


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


# --- the records ---------------------------------------------------------------------------------

def failed_record(commit, pr, reason):
    """A measured comparison that didn't happen: not clean, with the reason."""
    return {"kind": "speed", "commit": commit, "pr": pr, "measured": True, "clean": False, "reasons": [reason],
            "pages": [], "averages": {"busyMs": 0, "loadMs": 0}, "flip": False}


def write_failed(out, environ, reason):
    write_json(os.path.join(out, RECORD), failed_record(environ.get("COMMIT", ""),
                                                        pr_number(environ.get("PR_NUMBER", "")), reason))
    with open(os.path.join(out, "comparison.md"), "w", encoding="utf-8") as f:
        f.write(f"**Not clean:** {reason}\n")


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
    missing = sorted(part for part, state in states.items() if state == "none")
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
        say(f"Not clean: {reason}")
        write_failed(out, environ, reason)
    else:
        say(reason)
    return 0


def finalize(out, environ=os.environ):
    """Says `verdict=clean` or `verdict=not-clean` for the record in <out>, writing a not-clean one
    first if the comparison errored and left none."""
    record = read_json(os.path.join(out, RECORD))
    if not isinstance(record, dict) or not isinstance(record.get("clean"), bool):
        write_failed(out, environ, "the comparison failed")
        record = read_json(os.path.join(out, RECORD))
        say("The comparison step left no record: a not-clean one is kept, so a failing comparison can't hide.")
    print(f"verdict={'clean' if record['clean'] else 'not-clean'}")
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
    """(entries, capped): every unexpired artifact of those two names that came from this repository's
    own branches (not main), each as {id, created_at, branch, run, clean}, newest first. Each name's
    list is read to its end, a page shorter than a full one, because GitHub doesn't say what order it
    lists in. `capped` is True when the budget ran out before the lists were read."""
    entries, capped = [], False
    try:
        for clean, name in zip((True, False), names):
            for number in range(1, MAX_PAGES + 1):
                budget.take()
                found = github.page(name, number)
                for artifact in found:
                    run = artifact.get("workflow_run")
                    run = run if isinstance(run, dict) else {}
                    branch, created = run.get("head_branch"), artifact.get("created_at")
                    if (artifact.get("name") == name and not artifact.get("expired")
                            and from_this_repository(artifact) and isinstance(branch, str) and branch
                            and branch != "main" and isinstance(artifact.get("id"), int)):
                        entries.append({"id": artifact["id"], "created_at": created if isinstance(created, str) else "",
                                        "branch": branch, "run": run.get("id"), "clean": clean})
                if len(found) < github.per_page:
                    break
    except OverBudget:
        capped = True
    entries.sort(key=lambda e: (e["created_at"], e["id"]), reverse=True)
    return entries, capped


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


def averaged(github, groups, branches, budget, limits):
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
            usable = (isinstance(record, dict) and record.get("kind") == "speed"
                      and isinstance(record.get("averages"), dict)
                      and number(record["averages"].get("busyMs")) and number(record["averages"].get("loadMs"))
                      and isinstance(record.get("pr"), int) and not isinstance(record.get("pr"), bool)
                      and record["pr"] > 0)
            if not usable:
                problems.append("a record of one of the five pull requests can't be read")
                continue
            records.append(record)
            numbers.add(record["pr"])
        if len(numbers) > 1:
            problems.append("one branch's records carry two pull request numbers: "
                            + " and ".join(f"#{n}" for n in sorted(numbers)))
        if records:
            per_pr.append({key: mean([r["averages"][key] for r in records]) for key in ("busyMs", "loadMs")})
    if problems or len(per_pr) < len(branches):
        return None, problems or ["a pull request's records are missing"]
    return {key: mean([p[key] for p in per_pr]) for key in ("busyMs", "loadMs")}, []


def clean_name(text):
    return re.sub(r"[^\w./-]", "?", text)


def tally(github, kind, limits, current=None, branch=None, run_id=None, budget=None):
    """(summary text, pull requests counted, reached the budget). See the module's description."""
    names = NAMES[kind]
    budget = budget or Requests()
    heading = ["### The tally: the Speed check on three machines, beside the Speed check", ""]
    entries, capped = listing(github, names, budget)
    if current is not None and branch:
        # This run's own record is counted from the file. The list may already show it (same run, same
        # verdict) and must not count it twice; an earlier attempt of the same run that was NOT clean is
        # another record and stays, so a re-run can't make a pull request look clean.
        verdict = current.get("clean") is True
        entries = [e for e in entries if not (e["run"] == run_id and e["clean"] == verdict)]
        entries.insert(0, {"id": None, "created_at": "9999", "branch": branch, "run": run_id,
                           "clean": verdict, "record": current})
    groups = by_branch(entries)

    counted, ended = [], None
    for name, found in groups.items():
        if all(e["clean"] for e in found):
            counted.append(name)
            if len(counted) == NEEDED:
                break
        else:
            ended = (name, found)
            break

    lines = list(heading)
    if capped:
        lines += [f"**At least {line_for(len(counted))}**: the {MAX_REQUESTS} requests this tally may make ran out "
                  "while listing, so the list may be incomplete.", ""]
    else:
        lines += [f"**{line_for(len(counted))}**", ""]
    if counted:
        lines.append("Counted: " + ", ".join(f"`{clean_name(b)}`" for b in counted) + ".")
    if ended:
        lines += ["", f"The row ended at `{clean_name(ended[0])}`, which has a record that is not clean."]
        record = next((e.get("record") for e in ended[1] if not e["clean"] and e.get("record")), None)
        newest_bad = next(e for e in ended[1] if not e["clean"])
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
                         + (", and **a budget passes on three machines that fails on one**:" if record.get("flip") is True
                            else ":"))
            lines += [f"- {clean_name_text(r)}" for r in (record.get("reasons") or [])[:8] if isinstance(r, str)]
    if len(counted) == NEEDED and not capped:
        try:
            averages, problems = averaged(github, groups, counted, budget, limits)
        except OverBudget:
            averages, problems = None, [f"the {MAX_REQUESTS} requests this tally may make ran out before every "
                                        "record was read"]
        except Unavailable:
            averages, problems = None, ["GitHub didn't answer"]
        lines += [""]
        if averages is None:
            lines.append("**The five-comparison average can't be checked this run:** " + "; ".join(problems) + ".")
        else:
            busy, load = averages["busyMs"], averages["loadMs"]
            outside = [name for name, value, limit in (("busy time", busy, limits["busyMs"]),
                                                       ("load", load, limits["loadMs"])) if abs(value) > limit]
            verdict = ("**outside its limits:** " + " and ".join(outside)) if outside else "**within its limits**"
            lines.append(
                "The five pull requests' average difference (three machines - one machine, each pull request "
                f"weighted equally): busy {busy:+.1f} ms (limit +/-{limits['busyMs']} ms), load {load:+.1f} ms "
                f"(limit +/-{limits['loadMs']} ms): {verdict}.")
    return "\n".join(lines) + "\n", len(counted), capped


def clean_name_text(text):
    """A reason, one line, without anything that could break the summary's layout."""
    return re.sub(r"[`\r\n|]", "'", text)[:300]


def line_for(count):
    noun = "pull request" if count == 1 else "pull requests"
    return f"{count} {noun} in a row clean (the switch needs {NEEDED})"


def read_limits(path):
    allowances = read_json(path)
    average = allowances.get("fiveComparisonAverage") if isinstance(allowances, dict) else None
    if not (isinstance(average, dict) and number(average.get("busyMs")) and number(average.get("loadMs"))):
        sys.exit(f"{path} has no fiveComparisonAverage limits")
    return {"busyMs": average["busyMs"], "loadMs": average["loadMs"]}


def run_tally(argv, environ=os.environ):
    kind, rest = argv[0], argv[1:]
    options = dict(zip(rest[::2], rest[1::2]))
    limits = read_limits(options["--limits"])
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
    say(("at least " if capped else "") + line_for(count))
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    command, rest = (argv[0], argv[1:]) if argv else ("", [])
    if command == "untouched" and len(rest) == 2 and valid_share(rest[1]):
        untouched(*rest)
        say(f"Part {rest[1]}: this change doesn't touch the website, so there was nothing to measure.")
        return 0
    if command == "speed-plan" and len(rest) == 4 and rest[2].isdigit() and int(rest[2]) >= 1:
        return plan(rest)
    if command == "finalize" and len(rest) == 1:
        return finalize(rest[0])
    if (command == "tally" and len(rest) in (3, 5) and rest[0] in NAMES and rest[1] == "--limits"
            and (len(rest) == 3 or rest[3] == "--current")):
        return run_tally(rest)
    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main())
