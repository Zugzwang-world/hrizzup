#!/usr/bin/env python3
"""Waits until hrizzup.com serves one commit, with every service answering.

    python3 .github/scripts/wait_for_production.py <commit sha>

Polls the public https://hrizzup.com/api/health (no keys needed: it is the one public
page the firewall lets checks reach) until it reports this commit, environment
`production`, region `bom1`, status `ok` and every service answering. Fails if it serves
the commit with a service down, or doesn't serve it within 10 minutes. Prints no secrets.
"""
import json
import sys
import time
import urllib.error
import urllib.request

HEALTH = "https://hrizzup.com/api/health"
SERVICES = ("database", "redis", "storage", "auth")
TIMEOUT_S = 10 * 60
INTERVAL_S = 10  # well inside the firewall's 60 a minute on /api/health


def health():
    req = urllib.request.Request(HEALTH, headers={"User-Agent": "hrizzup-wait-for-production",
                                                  "Cache-Control": "no-store"})
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
            services = {k: (body.get("services") or {}).get(k, {}).get("status") for k in SERVICES}
            if (code == 200 and body.get("status") == "ok" and body.get("environment") == "production"
                    and body.get("region") == "bom1" and all(v == "ok" for v in services.values())):
                print(f"hrizzup.com serves {sha[:7]} from bom1; every service answers: {services}")
                return 0
            sys.exit(f"hrizzup.com serves {sha[:7]} but isn't healthy (HTTP {code}, "
                     f"{body.get('environment')}/{body.get('region')}): {services}")
        print(f"hrizzup.com serves {commit[:7] or '?'} (HTTP {code}); waiting for {sha[:7]}")
        time.sleep(INTERVAL_S)
    sys.exit(f"hrizzup.com didn't serve {sha[:7]} within {TIMEOUT_S // 60} minutes")


if __name__ == "__main__":
    sys.exit(main())
