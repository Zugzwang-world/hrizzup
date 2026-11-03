#!/usr/bin/env bash
# Applies this folder's CORS and lifecycle rules to one environment's R2 buckets,
# then reads them back and fails if Cloudflare's copy differs from the repo's.
#
# Usage: apply.sh staging|production
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment (for staging,
# `doppler run --project hrizzup-tools --config claude`). Staging is applied by Claude Code; production only by the
# release pipeline, with its own credentials (runbook Part 10). Never prints the token.
set -euo pipefail
env="${1:?usage: apply.sh staging|production}"
case "$env" in staging|production) ;; *) echo "unknown environment: $env" >&2; exit 2 ;; esac
: "${CLOUDFLARE_API_TOKEN:?not set}" "${CLOUDFLARE_ACCOUNT_ID:?not set}"
here="$(cd "$(dirname "$0")" && pwd)"
api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets"

call() { # method url [file]
  local args=(-sS -X "$1" "$2" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")
  if [ -n "${3:-}" ]; then args+=(--data-binary "@$3"); fi
  curl "${args[@]}"
}

ok() { # label response-json
  python3 -c 'import json, sys
d = json.loads(sys.argv[2])
if not d.get("success"):
    sys.exit(sys.argv[1] + ": Cloudflare said " + str(d.get("errors")))' "$1" "$2"
}

check() { # label expected-file actual-json
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
label, expected_file, actual = sys.argv[1], sys.argv[2], sys.argv[3]
want = json.load(open(expected_file))["rules"]
got = json.loads(actual)
if not got.get("success"):
    sys.exit(f"{label}: Cloudflare said {got.get('errors')}")
have = (got.get("result") or {}).get("rules") or []
def norm(rules):
    out = []
    for r in rules:
        r = {k: v for k, v in r.items() if v not in (None, [], {})}
        if "allowed" in r:
            r["allowed"] = {k: sorted(v) for k, v in r["allowed"].items() if v}
        out.append(json.dumps(r, sort_keys=True))
    return sorted(out)
if norm(want) != norm(have):
    sys.exit(f"{label}: Cloudflare's rules differ from the repo's\n  repo: {norm(want)}\n  live: {norm(have)}")
print(f"{label}: applied and matches the repo")
PY
}

for kind in uploads media; do
  bucket="hrizzup-${env}-${kind}"
  cors="$here/${kind}.cors.${env}.json"
  life="$here/${kind}.lifecycle.json"
  ok "$bucket CORS" "$(call PUT "$api/$bucket/cors" "$cors")"
  check "$bucket CORS" "$cors" "$(call GET "$api/$bucket/cors")"
  ok "$bucket lifecycle" "$(call PUT "$api/$bucket/lifecycle" "$life")"
  check "$bucket lifecycle" "$life" "$(call GET "$api/$bucket/lifecycle")"
done
