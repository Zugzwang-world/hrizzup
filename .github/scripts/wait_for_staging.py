#!/usr/bin/env python3
"""Waits until staging serves one commit, with every service answering.

    python3 .github/scripts/wait_for_staging.py <commit sha>

Polls https://staging.hrizzup.com/api/health (through the protection bypass for
automation, VERCEL_AUTOMATION_BYPASS_SECRET) until it reports this commit, environment
`staging`, region `bom1` and status `ok`. Fails if staging reports this commit with a
service down, or if it doesn't serve the commit within 15 minutes. Prints no secrets.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

HEALTH = "https://staging.hrizzup.com/api/health"
TIMEOUT_S = 15 * 60
INTERVAL_S = 15  # well inside the firewall's 60 a minute on /api/health


def health():
    req = urllib.request.Request(HEALTH, headers={
        # Only the bypass header: asking for the bypass cookie as well answers with a
        # redirect to set it, which a script doesn't need.
        "x-vercel-protection-bypass": os.environ["VERCEL_AUTOMATION_BYPASS_SECRET"],
        "User-Agent": "hrizzup-wait-for-staging",
        "Cache-Control": "no-store",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:  # 503 still carries the health report
        try:
            return e.code, json.load(e)
        except ValueError:
            return e.code, {}
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        return None, {"error": type(e).__name__}


def main():
    sha = sys.argv[1]
    deadline = time.time() + TIMEOUT_S
    while time.time() < deadline:
        code, body = health()
        commit = str(body.get("commit", ""))
        if commit == sha:
            services = {k: v.get("status") for k, v in (body.get("services") or {}).items()}
            if (code == 200 and body.get("status") == "ok"
                    and body.get("environment") == "staging" and body.get("region") == "bom1"):
                print(f"Staging serves {sha[:7]} from bom1; every service answers: {services}")
                return 0
            sys.exit(f"Staging serves {sha[:7]} but isn't healthy (HTTP {code}, "
                     f"{body.get('environment')}/{body.get('region')}): {services}")
        print(f"Staging serves {commit[:7] or '?'} (HTTP {code}); waiting for {sha[:7]}")
        time.sleep(INTERVAL_S)
    sys.exit(f"Staging didn't serve {sha[:7]} within {TIMEOUT_S // 60} minutes; "
             "see the project's Deployments in Vercel (environment staging)")


if __name__ == "__main__":
    sys.exit(main())
