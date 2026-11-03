#!/usr/bin/env python3
"""Finds one commit's hidden production build and checks it before it is promoted.

    python3 .github/scripts/production_build.py <commit sha> [--launch]
    python3 .github/scripts/production_build.py live    # prints the commit hrizzup.com serves now

Every merge to main makes a hidden production build (production keys, private address
only). This asks Vercel itself, with the pipeline's own token, for the newest ready
production build of the commit in our project (never a record anyone else could write),
requires its address to be one of our project's (`hrizzup-<id>-hrizzup.vercel.app`), and
reads it through that private address with the protection bypass for automation
(VERCEL_AUTOMATION_BYPASS_SECRET), following no redirects:

  - /api/health must show environment production, region bom1, this commit, status ok and
    every service answering. A service that is `not_configured` means the build was made
    before Doppler prd reached Vercel's production environment, so it has no production
    keys: merge any change (or redeploy that commit in Vercel) and release the new build.
  - Until launch (HOLDING_PAGE_UNTIL_LAUNCH=true in release.yml), the home page must be the
    holding page (`data-page="holding"`), so a release can't make anything public by
    accident. `--launch` drops that check for the one release that is the launch.

Writes id=<deployment id> and url=<private address> to $GITHUB_OUTPUT.

`live` asks Vercel which build the address hrizzup.com points at, and prints that build's
commit (falling back to the public health page, read whatever its status, if Vercel can't
say), so a rollback can be checked against what is really live, even while it is down.

Needs VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID. Prints no secrets.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

SERVICES = ("database", "redis", "storage", "auth")
HOLDING_MARKER = b'data-page="holding"'
OUR_BUILD = re.compile(r"^hrizzup-[a-z0-9]+-hrizzup\.vercel\.app$")
REPO = ("Zugzwang-world", "hrizzup")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # a redirect is answered as it is, so the bypass header never leaves our build


def vercel(path, query=None):
    query = {**(query or {}), "teamId": os.environ["VERCEL_ORG_ID"]}
    req = urllib.request.Request(f"https://api.vercel.com{path}?{urllib.parse.urlencode(query)}", headers={
        "Authorization": "Bearer " + os.environ["VERCEL_TOKEN"],
        "User-Agent": "hrizzup-production-build",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"Vercel's API answered HTTP {e.code} when listing production builds")


def private(url):
    """(status, body) from the hidden build, through the protection bypass, no redirects."""
    req = urllib.request.Request(url, headers={
        "x-vercel-protection-bypass": os.environ["VERCEL_AUTOMATION_BYPASS_SECRET"],
        "User-Agent": "hrizzup-production-build",
        "Cache-Control": "no-store",
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def production_build(sha):
    # Filtered by commit on Vercel's side, so an old commit's build is found however many
    # builds came after it; the same conditions are checked again here.
    answer = vercel("/v6/deployments", {"projectId": os.environ["VERCEL_PROJECT_ID"],
                                         "target": "production", "meta-githubCommitSha": sha,
                                         "limit": 100})
    builds = [d for d in answer.get("deployments", [])
              if (d.get("meta") or {}).get("githubCommitSha") == sha
              and ((d.get("meta") or {}).get("githubOrg"), (d.get("meta") or {}).get("githubRepo")) == REPO
              and d.get("target") == "production" and d.get("readyState") == "READY"
              and d.get("projectId") == os.environ["VERCEL_PROJECT_ID"]]
    return max(builds, key=lambda d: d.get("created") or 0) if builds else None


def live_commit():
    """The commit of the build hrizzup.com points at: Vercel's alias first, then the health page."""
    try:
        alias = vercel("/v4/aliases/hrizzup.com")
        build = vercel(f"/v13/deployments/{alias['deploymentId']}")
        sha = (build.get("meta") or {}).get("githubCommitSha", "")
        if re.fullmatch(r"[0-9a-f]{40}", sha):
            return sha
    except (SystemExit, KeyError, TypeError):
        pass
    req = urllib.request.Request("https://hrizzup.com/api/health",
                                 headers={"User-Agent": "hrizzup-release", "Cache-Control": "no-store"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
    except urllib.error.HTTPError as e:  # a 503 still carries the health report
        body = e.read()
    except (urllib.error.URLError, TimeoutError):
        body = b"{}"
    try:
        sha = str(json.loads(body).get("commit", ""))
    except (ValueError, AttributeError):
        sha = ""
    return sha if re.fullmatch(r"[0-9a-f]{40}", sha) else ""


def main():
    args = sys.argv[1:]
    if args == ["live"]:
        sha = live_commit()
        if not sha:
            sys.exit("Can't tell which commit hrizzup.com serves (neither Vercel nor its health page says)")
        print(sha)
        return 0
    if not args or args[1:] not in ([], ["--launch"]):
        sys.exit(__doc__)
    sha, launch = args[0], args[1:] == ["--launch"]
    build = production_build(sha)
    if not build:
        sys.exit(f"No ready hidden production build of {sha[:7]}: Vercel builds one for every merge to main; "
                 "see the project's Deployments in Vercel (environment Production)")
    host = str(build.get("url", ""))
    if not OUR_BUILD.match(host):
        sys.exit(f"The build's address {host!r} isn't one of our project's; refusing to send it anything")
    url = f"https://{host}"
    print(f"Hidden production build of {sha[:7]}: {build.get('uid')} at {url} "
          f"({build.get('readySubstate') or 'ready'})")

    status, body = private(url + "/api/health")
    try:
        health = json.loads(body)
    except ValueError:
        sys.exit(f"Its /api/health didn't answer with a health report (HTTP {status})")
    services = {k: ((health.get("services") or {}).get(k) or {}).get("status") for k in SERVICES}
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

    if os.environ.get("HOLDING_PAGE_UNTIL_LAUNCH") != "true":
        print("Launched: the holding-page check is off (HOLDING_PAGE_UNTIL_LAUNCH in release.yml).")
    elif launch:
        print("Launch: the holding-page check is skipped on purpose, for this release only.")
    else:
        status, body = private(url + "/")
        if status != 200 or HOLDING_MARKER not in body:
            problems.append(f"its home page isn't the holding page (HTTP {status}); until launch, only "
                            "builds that still show it are released (tick launch only for the launch)")
        else:
            print("Its home page is the holding page.")
    if problems:
        sys.exit("Not releasable: " + "; ".join(problems))
    with open(os.environ["GITHUB_OUTPUT"], "a") as out:
        out.write(f"id={build['uid']}\nurl={url}\n")
    print("Releasable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
