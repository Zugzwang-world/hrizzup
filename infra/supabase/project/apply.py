#!/usr/bin/env python3
"""Apply and check one environment's Supabase project settings (settings.json, README.md).

    python3 infra/supabase/project/apply.py staging            # apply, then check
    python3 infra/supabase/project/apply.py staging --check    # check only, change nothing

Applied (the same on staging and production): encrypted database connections only; the
legacy API keys (`anon`, `service_role`) off; the legacy JWT secret revoked, so only the
project's own signing key pair is trusted. Checked: the project's name, region, health,
Postgres engine and release channel, compute size, point-in-time recovery, the Data API off
(no schemas exposed), network access open (Vercel has no fixed addresses), and no branches.
It also reports the full Postgres version, for the side-by-side comparison with staging.

Needs SUPABASE_ACCESS_TOKEN for Supabase's Management API. Staging, by Claude Code:

    infra/doppler/run tools -- python3 infra/supabase/project/apply.py staging

Production is applied only by the release pipeline, with its own token (runbook Part 10);
Claude Code's token reaches only hrizzup-staging, so Supabase refuses it for production.
Prints chosen fields only: some of Supabase's answers hold secrets (the Data API's answer
carries the legacy JWT secret), so no answer is ever printed whole.
"""
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://api.supabase.com/v1"
ASYMMETRIC = {"ES256", "RS256", "EdDSA"}


def fail(message):
    sys.exit(f"FAILED: {message}")


def load():
    with open(os.path.join(HERE, "settings.json")) as f:
        return json.load(f)


class Supabase:
    def __init__(self, ref):
        self.token = os.environ.get("SUPABASE_ACCESS_TOKEN") or fail("SUPABASE_ACCESS_TOKEN is not set")
        self.ref = ref

    def call(self, method, path, body=None, query="", ok=(200, 201, 204)):
        url = f"{API}/projects/{self.ref}{path}{query}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
            "User-Agent": "hrizzup-infra-supabase-project",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode()
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as err:
            text = err.read().decode(errors="replace")
            try:
                message = str(json.loads(text).get("message", ""))[:200]
            except (ValueError, AttributeError):
                message = ""
            if err.code in ok:
                return {}
            fail(f"{method} {path or '/'}: HTTP {err.code} {message.replace(self.token, '(token)')}")


def apply(api, applied):
    """Changes only what differs; each change is read back by the check that follows."""
    if applied["ssl_enforcement"] is True:
        ssl = api.call("GET", "/ssl-enforcement")
        if (ssl.get("currentConfig") or {}).get("database") is not True:
            api.call("PUT", "/ssl-enforcement", {"requestedConfig": {"database": True}})
            print("  changed: encrypted database connections enforced")
    if applied["legacy_api_keys"] is False:
        if api.call("GET", "/api-keys/legacy").get("enabled") is not False:
            api.call("PUT", "/api-keys/legacy", query="?enabled=false")
            print("  changed: legacy API keys (anon, service_role) switched off")
    if applied["legacy_jwt_secret"] == "revoked":
        keys = signing_keys(api)
        if not any(k["algorithm"] in ASYMMETRIC and k["status"] == "in_use" for k in keys):
            fail("the project doesn't sign with its own key pair yet, so the legacy JWT secret "
                 "can't be revoked; rotate to the new signing keys in Supabase first")
        for k in keys:
            if k["algorithm"] == "HS256" and k["status"] != "revoked":
                api.call("PATCH", f"/config/auth/signing-keys/{k['id']}", {"status": "revoked"})
                print(f"  changed: legacy JWT secret revoked (it was {k['status']})")


def signing_keys(api):
    answer = api.call("GET", "/config/auth/signing-keys")
    keys = answer.get("keys") if isinstance(answer, dict) else answer
    return [{"id": k.get("id"), "algorithm": k.get("algorithm"), "status": k.get("status")}
            for k in (keys or [])]


def check(api, want_name, checked, applied):
    problems, report = [], {}

    def expect(label, got, want):
        report[label] = got
        if got != want:
            problems.append(f"{label}: Supabase has {got!r}, the repo says {want!r}")

    project = api.call("GET", "")
    db = project.get("database") or {}
    expect("name", project.get("name"), want_name)
    expect("region", project.get("region"), checked["region"])
    expect("status", project.get("status"), "ACTIVE_HEALTHY")
    expect("postgres engine", str(db.get("postgres_engine")), checked["postgres_engine"])
    expect("release channel", db.get("release_channel"), checked["release_channel"])
    report["postgres version"] = db.get("version")

    addons = api.call("GET", "/billing/addons").get("selected_addons") or []
    compute = [(a.get("variant") or {}).get("id") for a in addons if a.get("type") == "compute_instance"]
    expect("compute", compute[0] if compute else None, checked["compute"])
    pitr = api.call("GET", "/database/backups").get("pitr_enabled")
    expect("point-in-time recovery", pitr, checked["point_in_time_recovery"])
    expect("data API schemas", api.call("GET", "/postgrest").get("db_schema"), checked["data_api_schemas"])

    net = api.call("GET", "/network-restrictions").get("config") or {}
    is_open = net.get("dbAllowedCidrs") == ["0.0.0.0/0"] and net.get("dbAllowedCidrsV6") == ["::/0"]
    expect("network", "open" if is_open else "restricted", checked["network"])
    branches = api.call("GET", "/branches")
    expect("branches", len(branches) if isinstance(branches, list) else None, checked["branches"])

    ssl = (api.call("GET", "/ssl-enforcement").get("currentConfig") or {}).get("database")
    expect("encrypted connections only", ssl, applied["ssl_enforcement"])
    expect("legacy API keys", api.call("GET", "/api-keys/legacy").get("enabled"), applied["legacy_api_keys"])
    keys = signing_keys(api)
    legacy = sorted({k["status"] for k in keys if k["algorithm"] == "HS256"}) or ["none"]
    expect("legacy JWT secret", ",".join(legacy) if legacy != ["none"] else "revoked", applied["legacy_jwt_secret"])
    in_use = sorted(k["algorithm"] for k in keys if k["status"] == "in_use")
    report["signing key in use"] = ",".join(in_use)
    if not in_use or not set(in_use) <= ASYMMETRIC:
        problems.append(f"signing key in use: {in_use}, expected the project's own key pair (ES256)")
    return report, problems


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ("staging", "production") or args[1:] not in ([], ["--check"]):
        sys.exit(__doc__)
    env, check_only = args[0], args[1:] == ["--check"]
    cfg = load()
    e = cfg["environments"][env]
    ref = e.get("project_ref") or fail(f"{env} has no project_ref in settings.json yet")
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if url and url != f"https://{ref}.supabase.co":
        fail(f"SUPABASE_URL does not belong to {env}'s project {ref}; run this with that environment's own keys")
    checked = {**cfg["checked"], **e.get("checked", {})}
    api = Supabase(ref)
    print(f"{env}: Supabase project {e['name']} ({ref})")
    if not check_only:
        apply(api, cfg["applied"])
    report, problems = check(api, e["name"], checked, cfg["applied"])
    for label, value in report.items():
        print(f"  {label}: {value}")
    if problems:
        print(f"{env}: the project does NOT match the repo:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"{env}: the project matches the repo ({len(report)} settings)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
