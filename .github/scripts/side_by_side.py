#!/usr/bin/env python3
"""The side-by-side trials' small helper: records, the plan for a comparison, and the tally.

    python3 .github/scripts/side_by_side.py untouched <folder> <part>/<of>
    python3 .github/scripts/side_by_side.py speed-plan <one-machine folder> <parts folder> <of> <out folder> >> "$GITHUB_OUTPUT"
    python3 .github/scripts/side_by_side.py tally <artifact name> [--current <comparison.json>] >> "$GITHUB_STEP_SUMMARY"

A faster version of a required check runs beside today's one (.github/workflows/checks.yml: "Speed
check on three machines" beside "Speed check"). Today's check stays the required one and stays as
it is; every pull request compares the two, and a later change switches only when five pull
requests in a row compared clean. Each comparison leaves one record, comparison.json, kept as an
artifact for 30 days: {"kind", "commit", "pr", "measured", "baseline", "clean", "details"}.

  - `untouched` writes a part's record when the change doesn't touch the website:
    {"part", "of", "website": false}. The part passes at once; nothing was measured.
  - `speed-plan` decides what the comparison job does, from the parts' records and the results of
    the one-machine job and the parts (ONE_RESULT, PARTS_RESULT; COMMIT and PR_NUMBER go into the
    record). It prints `measure=true` when there are three-machine and one-machine results to
    compare. Otherwise it prints `measure=false` and writes an unmeasured record and note into
    <out folder>: the change doesn't touch the website, or the one-machine check or a part didn't
    finish. That isn't an error: the required check decides the pull request, and an unmeasured
    comparison is simply not counted. What is an error (exit 1) is results missing, or parts that
    disagree, although every part succeeded: that is broken machinery, and it shows as a red job.
  - `tally` counts how many pull requests in a row compared clean, from the stored records:
    it lists the repository's artifacts of that name through GitHub's API (GITHUB_TOKEN with
    `actions: read`, GITHUB_REPOSITORY), skips expired ones and any that didn't come from a pull
    request of this repository, reads them newest first, keeps the newest record of each pull
    request, ignores a pull request whose record isn't measured (or has no baseline to compare
    with), and counts clean ones until the first that isn't. `--current` is this run's own record,
    counted first so the count never waits for the artifact list to catch up.

Python's standard library only. Prints no secrets: pull request numbers, counts and page paths.
"""
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

NEEDED = 5  # pull requests in a row that compared clean before a later change switches
MAX_DOWNLOADS = 150  # records read in one tally: the job's token allows ~1,000 requests an hour
MAX_PAGES = 10
PAUSES = (5, 15, 45)  # seconds before each retry of a GitHub answer that was a server error
RECORD = "comparison.json"
RECORD_LIMIT = 1024 * 1024  # a record is a few kilobytes; nothing bigger is read
API = os.environ.get("GITHUB_API_URL", "https://api.github.com")


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


# --- the plan for one comparison ------------------------------------------------------------

def unmeasured(kind, commit, pr, reason):
    return {"kind": kind, "commit": commit, "pr": pr, "measured": False, "baseline": True,
            "clean": False, "details": [reason]}


def speed_plan(one_folder, parts_folder, of, one_result, parts_result):
    """(measure, reason, problems): whether there are results to compare; if not, why not (a
    reason that isn't an error); and the errors, for results that should be there and aren't."""
    if parts_result != "success":
        if one_result != "success":
            return False, (f"The one-machine Speed check's result was '{one_result}', so the three machines "
                           "didn't measure: the required check decides this pull request."), []
        return False, (f"The three machines' parts didn't all finish (result '{parts_result}'): the "
                       "required check decides this pull request."), []

    states = {}
    for part in range(1, of + 1):
        folder = os.path.join(parts_folder, f"speed-part-{part}")
        record = read_json(os.path.join(folder, "untouched.json"))
        if isinstance(record, dict) and record.get("website") is False:
            states[part] = "untouched"
        elif os.path.isfile(os.path.join(folder, "website.json")):
            states[part] = "measured"
        else:
            states[part] = "none"
    missing = [part for part, state in states.items() if state == "none"]
    if missing:
        return False, "", [f"Part {part} succeeded but left no results" for part in missing]
    if set(states.values()) == {"untouched"}:
        return False, "This change doesn't touch the website, so nothing was measured.", []
    if set(states.values()) != {"measured"}:
        yes = sorted(part for part, state in states.items() if state == "measured")
        no = sorted(part for part, state in states.items() if state == "untouched")
        return False, "", [f"The parts disagree about whether the website was touched: parts {yes} "
                           f"measured it, parts {no} say it wasn't"]
    if not os.path.isfile(os.path.join(one_folder, "website.json")):
        return False, "", ["Every part measured the website, but the one-machine check left no results "
                           "(speed-one-machine) to compare with"]
    return True, "", []


def plan(argv, environ=os.environ):
    one_folder, parts_folder, of, out = argv[0], argv[1], int(argv[2]), argv[3]
    measure, reason, problems = speed_plan(
        one_folder, parts_folder, of, environ.get("ONE_RESULT", ""), environ.get("PARTS_RESULT", ""))
    print(f"measure={'true' if measure and not problems else 'false'}")
    if problems:
        for problem in problems:
            say(f"- {problem}")
        say("::error title=The Speed check trial's results are missing::" + "; ".join(problems))
        return 1
    if not measure:
        say(reason)
        record = unmeasured("speed", environ.get("COMMIT", ""), pr_number(environ.get("PR_NUMBER", "")), reason)
        write_json(os.path.join(out, RECORD), record)
        with open(os.path.join(out, "comparison.md"), "w", encoding="utf-8") as f:
            f.write(f"**Not measured, so not counted:** {reason}\n")
        return 0
    say(f"All {of} parts and the one-machine check left results to compare.")
    return 0


# --- the tally ---------------------------------------------------------------------------------

class GitHub:
    """GitHub's API, for the artifacts only. The token goes to GitHub's API and never to the
    storage address a download redirects to (an unredirected header: urllib drops it on a redirect)."""

    def __init__(self, token, repository, api=API, opener=None):
        self.token, self.repository, self.api = token, repository, api.rstrip("/")
        self.opener = opener or urllib.request.build_opener().open

    def get(self, url, accept="application/vnd.github+json", sleep=time.sleep):
        """One answer's bytes. A busy or briefly unreachable GitHub is tried again after a pause;
        any other refusal (a missing artifact, a bad token) is an error at once."""
        request = urllib.request.Request(url, headers={
            "Accept": accept, "User-Agent": "hrizzup-side-by-side", "X-GitHub-Api-Version": "2022-11-28"})
        request.add_unredirected_header("Authorization", f"Bearer {self.token}")
        for pause in PAUSES + (None,):
            try:
                with self.opener(request, timeout=60) as answer:
                    return answer.read()
            except urllib.error.HTTPError as error:
                if error.code < 500 or pause is None:
                    raise
            except (urllib.error.URLError, OSError):
                if pause is None:
                    raise
            sleep(pause)

    def artifacts(self, name):
        """Every artifact of that name the API lists, a page at a time."""
        for page in range(1, MAX_PAGES + 1):
            url = (f"{self.api}/repos/{self.repository}/actions/artifacts?"
                   + urllib.parse.urlencode({"name": name, "per_page": 100, "page": page}))
            found = json.loads(self.get(url)).get("artifacts") or []
            yield from found
            if len(found) < 100:
                return

    def download(self, artifact_id):
        url = f"{self.api}/repos/{self.repository}/actions/artifacts/{int(artifact_id)}/zip"
        return self.get(url, accept="application/vnd.github+json")


def from_this_repository(artifact):
    """False for a run whose code came from another repository (a fork's pull request): its
    artifact could say anything, so it is never counted."""
    run = artifact.get("workflow_run") or {}
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


def records(github, name, current=None, limit=MAX_DOWNLOADS):
    """The stored records, newest first, each read only when asked for (a download apiece): this
    run's own first, then every artifact of that name that isn't expired and came from this
    repository's own pull requests, newest by creation time. Stops after `limit` downloads."""
    if current is not None:
        yield current
    listed = [a for a in github.artifacts(name)
              if a.get("name") == name and not a.get("expired") and from_this_repository(a)]
    listed.sort(key=lambda a: a.get("created_at") or "", reverse=True)
    for artifact in listed[:limit]:
        record = record_in(github.download(artifact["id"]))
        if record is not None:
            yield record


def tally_of(newest_first):
    """(clean pull requests in a row, the record that ended the row or None, pull requests not
    counted either way): the newest record of each pull request, from the newest; an unmeasured
    one, or one with no baseline to compare with, is passed over; the first one that isn't clean
    ends the row."""
    seen, counted, passed_over, ended_by = set(), [], [], None
    for record in newest_first:
        pr = record.get("pr")
        if not isinstance(pr, int) or isinstance(pr, bool) or pr in seen:
            continue  # not from a pull request, or an older record of one already read
        seen.add(pr)
        if record.get("measured") is not True or record.get("baseline") is not True:
            passed_over.append(pr)
        elif record.get("clean") is True:
            counted.append(pr)
        else:
            ended_by = record
            break
    return counted, ended_by, passed_over


def line_for(count):
    noun = "pull request" if count == 1 else "pull requests"
    return f"{count} {noun} in a row clean (the switch needs {NEEDED})"


def tally(github, name, current=None, limit=MAX_DOWNLOADS):
    counted, ended_by, passed_over = tally_of(records(github, name, current, limit))
    lines = [f"### The tally: {name}", "", f"**{line_for(len(counted))}**", ""]
    if counted:
        lines.append("Counted: " + ", ".join(f"#{pr}" for pr in counted) + ".")
    if ended_by:
        lines.append(f"The row ended at #{ended_by.get('pr')} (commit "
                     f"`{str(ended_by.get('commit') or '')[:7]}`), not clean:")
        lines += [f"- {detail}" for detail in (ended_by.get("details") or [])[:8]]
    if passed_over:
        lines.append("Not counted, nothing to compare: " + ", ".join(f"#{pr}" for pr in passed_over) + ".")
    return "\n".join(lines) + "\n", len(counted)


def run_tally(argv, environ=os.environ):
    name, current = argv[0], None
    if "--current" in argv:
        current = read_json(argv[argv.index("--current") + 1])
        if not isinstance(current, dict):
            current = None  # this run left none (the plan failed): the stored ones still count
    github = GitHub(environ["GITHUB_TOKEN"], environ["GITHUB_REPOSITORY"])
    text, count = tally(github, name, current)
    print(text)
    say(line_for(count))
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
    if command == "tally" and (len(rest) == 1 or (len(rest) == 3 and rest[1] == "--current")):
        return run_tally(rest)
    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main())
