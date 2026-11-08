#!/usr/bin/env python3
"""Shows the App journeys check's results on the pull request, in one comment kept up to date.

    python3 .github/scripts/app_comment.py <results folder>

Reads the results folder written by product/app/journeys/run.sh: phone.xml and tablet.xml
(Maestro's JUnit reports) and startup.md (the cold start against the app's budget). Missing
files mean that part didn't run. Adds the table to the job's summary and to the pull request's
one "App journeys" comment (edited if it exists). Needs GITHUB_TOKEN (pull-requests: write),
GITHUB_REPOSITORY, PR_NUMBER and COMMIT. Prints no secrets.
"""
import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET

MARKER = "<!-- hrizzup-app-journeys -->"
API = "https://api.github.com/repos/" + os.environ.get("GITHUB_REPOSITORY", "")


def request(method, path, body=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "hrizzup-app-journeys",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def journeys(folder, size):
    path = os.path.join(folder, f"{size}.xml")
    if not os.path.exists(path):
        return f"| Journeys at a {size} size | not run |"
    cases = ET.parse(path).getroot().iter("testcase")
    results = [(c.get("name"), c.find("failure") is None and c.find("error") is None) for c in cases]
    failed = [name for name, passed in results if not passed]
    mark = "✅" if results and not failed else "❌"
    detail = f"{len(results) - len(failed)} of {len(results)} passed"
    if failed:
        detail += f" (failed: {', '.join(failed)})"
    return f"| Journeys at a {size} size | {mark} {detail} |"


def main():
    folder = sys.argv[1]
    startup = os.path.join(folder, "startup.md")
    rows = [journeys(folder, "phone"), journeys(folder, "tablet")]
    if os.path.exists(startup):
        with open(startup) as f:
            rows.append(f.read().strip())
    else:
        rows.append("| App, cold start to first content (Android emulator) | not measured |")
    body = "\n".join([
        MARKER,
        f"## App journeys for {os.environ.get('COMMIT', '')[:7]}",
        "",
        "| | Result |",
        "|---|---|",
        *rows,
        "",
        "Maestro on an Android emulator (API 34, Pixel 7), phone size and then tablet size; the cold "
        "start is the median of 5, from Android starting the app to its first content, against the "
        "app's budget (blueprint section 14). Screenshots: the run's `app-journeys` artifact.",
    ])
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(body.replace(MARKER, "") + "\n")
    number = os.environ.get("PR_NUMBER")
    if not number:
        print("Not a pull request: the results are in the job's summary only.")
        return
    mine, page = None, 1
    while mine is None:
        comments = request("GET", f"/issues/{number}/comments?per_page=100&page={page}")
        mine = next((c for c in comments if MARKER in (c.get("body") or "")), None)
        if len(comments) < 100:
            break
        page += 1
    if mine:
        request("PATCH", f"/issues/comments/{mine['id']}", {"body": body})
    else:
        request("POST", f"/issues/{number}/comments", {"body": body})
    print("The App journeys results are on the pull request.")


if __name__ == "__main__":
    main()
