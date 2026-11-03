#!/usr/bin/env python3
"""Points hrizzup.com at one hidden production build: a promotion, or a rollback.

    python3 .github/scripts/promote.py promote <deployment id>
    python3 .github/scripts/promote.py rollback <deployment id>

The same requests Vercel's own `vercel promote` and `vercel rollback` make (read from its
command-line tool, version 65), sent straight to Vercel's API with the pipeline's token,
so no downloaded code ever runs next to production's keys:
  promote:  POST /v10/projects/<project>/promote/<deployment>
  rollback: POST /v9/projects/<project>/rollback/<deployment>
Both are instant: the build is already made; only the production addresses move to it.
The release pipeline then waits until hrizzup.com serves the commit (wait_for_production.py).

Needs VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID. Prints no secrets.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

PATHS = {"promote": "/v10/projects/{project}/promote/{deployment}",
         "rollback": "/v9/projects/{project}/rollback/{deployment}"}


def main():
    args = sys.argv[1:]
    if len(args) != 2 or args[0] not in PATHS or not re.fullmatch(r"dpl_[A-Za-z0-9]+", args[1]):
        sys.exit(__doc__)
    action, deployment = args
    project, team, token = (os.environ[k] for k in ("VERCEL_PROJECT_ID", "VERCEL_ORG_ID", "VERCEL_TOKEN"))
    path = PATHS[action].format(project=project, deployment=deployment)
    req = urllib.request.Request(f"https://api.vercel.com{path}?{urllib.parse.urlencode({'teamId': team})}",
                                 data=b"{}", method="POST", headers={
                                     "Authorization": "Bearer " + token,
                                     "Content-Type": "application/json",
                                     "User-Agent": "hrizzup-release",
                                 })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status = r.status
    except urllib.error.HTTPError as e:
        try:
            error = (json.load(e).get("error") or {})
        except ValueError:
            error = {}
        message = str(error.get("message", ""))[:300].replace(token, "(token)")
        sys.exit(f"Vercel refused the {action} (HTTP {e.code} {error.get('code', '')}): {message}")
    if status == 202:
        print(f"{action}: Vercel queued it (HTTP 202); it starts as soon as Vercel can")
    else:
        print(f"{action}: Vercel accepted it (HTTP {status}); hrizzup.com moves to {deployment}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
