#!/usr/bin/env python3
"""Waits for Vercel's preview of one commit and prints its address.

    python3 .github/scripts/wait_for_preview.py <commit sha>

Vercel reports each preview to GitHub as a deployment (environment "Preview..."). This
polls GitHub's API until that deployment succeeds, then writes `url=<address>` to
$GITHUB_OUTPUT. It fails if the preview fails, or if none appears within 20 minutes.
Needs GITHUB_TOKEN (with deployments: read) and GITHUB_REPOSITORY. Prints no secrets.
"""
import json
import os
import sys
import time
import urllib.request

API = "https://api.github.com/repos/" + os.environ["GITHUB_REPOSITORY"]
TIMEOUT_S = 20 * 60


def get(path):
    req = urllib.request.Request(API + path, headers={
        "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
        "Accept": "application/vnd.github+json",
        "User-Agent": "hrizzup-wait-for-preview",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    sha = sys.argv[1]
    deadline = time.time() + TIMEOUT_S
    while time.time() < deadline:
        for d in get(f"/deployments?sha={sha}&per_page=20"):
            if not str(d.get("environment", "")).lower().startswith("preview"):
                continue
            statuses = get(f"/deployments/{d['id']}/statuses?per_page=1")
            state = statuses[0]["state"] if statuses else "pending"
            if state == "success":
                url = statuses[0].get("environment_url") or statuses[0].get("target_url")
                print(f"Preview ready: {url}")
                with open(os.environ["GITHUB_OUTPUT"], "a") as out:
                    out.write(f"url={url}\n")
                return 0
            if state in ("failure", "error"):
                sys.exit(f"Vercel's preview of {sha[:7]} failed ({state}); see the Vercel check on the pull request")
            print(f"Preview of {sha[:7]}: {state}")
        time.sleep(15)
    sys.exit(f"No Vercel preview of {sha[:7]} appeared within {TIMEOUT_S // 60} minutes")


if __name__ == "__main__":
    sys.exit(main())
