#!/usr/bin/env python3
"""Finds one commit's hidden production build and checks it before it is promoted.

    python3 .github/scripts/production_build.py <commit sha> [--launch]

Every merge to main makes a hidden production build (production keys, private address
only). Vercel reports each to GitHub as a deployment in the environment "Production". This
takes the newest successful one for the commit and reads it through its private address,
with the protection bypass for automation (VERCEL_AUTOMATION_BYPASS_SECRET):

  - /api/health must show environment production, region bom1, this commit, status ok and
    every service answering. A service that is `not_configured` means the build was made
    before Doppler prd reached Vercel's production environment, so it has no production
    keys: merge any change (or redeploy that commit in Vercel) and release the new build.
  - Until launch, the home page must be the holding page (`data-page="holding"`), so a
    release can't make anything public by accident. `--launch` drops that check: the first
    promotion of an app build is the launch.

Writes url=<private address> to $GITHUB_OUTPUT. Needs GITHUB_TOKEN (deployments: read)
and GITHUB_REPOSITORY. Prints no secrets.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.github.com/repos/" + os.environ.get("GITHUB_REPOSITORY", "")
SERVICES = ("database", "redis", "storage", "auth")
HOLDING_MARKER = 'data-page="holding"'


def github(path):
    req = urllib.request.Request(API + path, headers={
        "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
        "Accept": "application/vnd.github+json",
        "User-Agent": "hrizzup-production-build",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def private(url):
    """(status, body) from the hidden build, through the protection bypass."""
    req = urllib.request.Request(url, headers={
        "x-vercel-protection-bypass": os.environ["VERCEL_AUTOMATION_BYPASS_SECRET"],
        "User-Agent": "hrizzup-production-build",
        "Cache-Control": "no-store",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def build_address(sha):
    for d in github(f"/deployments?sha={sha}&environment=Production&per_page=20"):
        statuses = github(f"/deployments/{d['id']}/statuses?per_page=1")
        if statuses and statuses[0].get("state") == "success":
            return statuses[0].get("environment_url") or statuses[0].get("target_url")
    return None


def main():
    args = sys.argv[1:]
    if not args or args[1:] not in ([], ["--launch"]):
        sys.exit(__doc__)
    sha, launch = args[0], args[1:] == ["--launch"]
    url = build_address(sha)
    if not url:
        sys.exit(f"No hidden production build of {sha[:7]} is ready: Vercel builds one for every "
                 "merge to main; see the project's Deployments in Vercel (environment Production)")
    print(f"Hidden production build of {sha[:7]}: {url}")

    status, body = private(url.rstrip("/") + "/api/health")
    try:
        health = json.loads(body)
    except ValueError:
        sys.exit(f"Its /api/health didn't answer with a health report (HTTP {status})")
    services = {k: (health.get("services") or {}).get(k, {}).get("status") for k in SERVICES}
    print(f"Its /api/health: HTTP {status}, {health.get('environment')}, {health.get('region')}, "
          f"commit {str(health.get('commit'))[:7]}, services {services}")
    problems = []
    if health.get("environment") != "production":
        problems.append("it isn't a production build")
    if health.get("region") != "bom1":
        problems.append("it doesn't run in bom1 (Mumbai)")
    if health.get("commit") != sha:
        problems.append("it reports a different commit")
    missing = [k for k, v in services.items() if v == "not_configured"]
    if missing:
        problems.append(f"it has no production keys for {', '.join(missing)}: it was built before "
                        "Doppler prd reached Vercel; merge any change (or redeploy it) and release that build")
    failing = [k for k, v in services.items() if v not in ("ok", "not_configured")]
    if failing:
        problems.append(f"these services don't answer: {', '.join(failing)}")
    if status != 200 or health.get("status") != "ok":
        problems.append(f"its health is {health.get('status')} (HTTP {status})")

    if launch:
        print("Launch: the holding-page check is skipped on purpose.")
    else:
        status, body = private(url.rstrip("/") + "/")
        if status != 200 or HOLDING_MARKER.encode() not in body:
            problems.append(f"its home page isn't the holding page (HTTP {status}); until launch, only "
                            "builds that still show it are released (start with launch only at launch)")
        else:
            print("Its home page is the holding page.")
    if problems:
        sys.exit("Not releasable: " + "; ".join(problems))
    with open(os.environ["GITHUB_OUTPUT"], "a") as out:
        out.write(f"url={url}\n")
    print("Releasable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
