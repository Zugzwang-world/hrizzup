#!/usr/bin/env python3
"""Shows the Speed check's numbers on the pull request, in one comment kept up to date.

    python3 .github/scripts/speed_comment.py <results folder>

Reads website.md and app.md from the results folder (written by product/web/e2e/speed-check.ts
and product/app/scripts/bundle-size.ts; either may be missing when that part wasn't touched or
didn't finish), adds them to the job's summary, and writes them into the pull request's one
"Speed check" comment: it edits the comment if it exists, and adds it otherwise. Needs
GITHUB_TOKEN (pull-requests: write), GITHUB_REPOSITORY, PR_NUMBER and COMMIT; the outcomes of
the two parts come in WEBSITE_OUTCOME and APP_OUTCOME ("success", "failure", "skipped" or
empty). Prints no secrets.
"""
import json
import os
import sys
import urllib.request

MARKER = "<!-- hrizzup-speed-check -->"
API = "https://api.github.com/repos/" + os.environ.get("GITHUB_REPOSITORY", "")


def request(method, path, body=None):
    req = urllib.request.Request(
        API + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "hrizzup-speed-check",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def part(folder, name, title, outcome):
    path = os.path.join(folder, name)
    if os.path.exists(path):
        with open(path) as f:
            return f"### {title}\n\n{f.read().strip()}\n"
    if outcome in ("", "skipped"):
        return f"### {title}\n\nNot touched by this change, so not measured.\n"
    return f"### {title}\n\n❌ The measurement didn't finish ({outcome}); see the Speed check's log.\n"


def main():
    folder = sys.argv[1]
    commit = os.environ.get("COMMIT", "")[:7]
    body = "\n".join([
        MARKER,
        f"## Speed check for {commit}",
        "",
        part(folder, "website.md", "Website (each page on this pull request's preview)",
             os.environ.get("WEBSITE_OUTCOME", "")),
        part(folder, "app.md", "App (its code, compared with main)",
             os.environ.get("APP_OUTCOME", "")),
        "Budgets: blueprint section 14. Website pages and their budgets: "
        "`product/web/e2e/pages.ts`; the app's limit: `product/app/bundle-limit.json`.",
    ])
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(body.replace(MARKER, "") + "\n")
    number = os.environ.get("PR_NUMBER")
    if not number:
        print("Not a pull request: the numbers are in the job's summary only.")
        return
    page = 1
    while True:
        comments = request("GET", f"/issues/{number}/comments?per_page=100&page={page}")
        mine = next((c for c in comments if MARKER in (c.get("body") or "")), None)
        if mine or len(comments) < 100:
            break
        page += 1
    if mine:
        request("PATCH", f"/issues/comments/{mine['id']}", {"body": body})
        print("Updated the Speed check comment on the pull request.")
    else:
        request("POST", f"/issues/{number}/comments", {"body": body})
        print("Added the Speed check comment to the pull request.")


if __name__ == "__main__":
    main()
