#!/usr/bin/env python3
"""Proves what Claude Code's own Doppler tokens can and can't open.

    python3 infra/doppler/check_access.py

For each service token in this Mac's keychain (service "hrizzup-doppler", one item per
config; see README.md), it checks with Doppler's API that the token:
  - reads its own config (it asks for that config's DOPPLER_CONFIG label, which isn't secret);
  - can't write if it is meant to be read-only (an empty write, which changes nothing);
  - is refused for hrizzup/prd and for the release pipeline's branch hrizzup/prd_release,
    both for a single secret and for a full download.
It also reports whether a personal Doppler login is still saved on this Mac (by looking for a
saved token in Doppler's settings file, without reading it).

Prints only HTTP statuses, Doppler's short error messages and config labels, never a token
or a secret value. Exits 1 if any token can read production, or doesn't work for its own config.
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

SERVICE = "hrizzup-doppler"
TOKENS = {  # keychain account: (project, config, access)
    "hrizzup/dev": ("hrizzup", "dev", "read/write"),          # dev_follows_staging.py writes references
    "hrizzup/stg": ("hrizzup", "stg", "read/write"),          # staging keys Claude Code creates
    "hrizzup/stg_preview": ("hrizzup", "stg_preview", "read"),  # previews' overrides change rarely
    "hrizzup-tools/claude": ("hrizzup-tools", "claude", "read/write"),  # setup values it creates
}
PRODUCTION = [("hrizzup", "prd"), ("hrizzup", "prd_release")]
API = "https://api.doppler.com/v3/configs/config"


def keychain(account):
    r = subprocess.run(["security", "find-generic-password", "-s", SERVICE, "-a", account, "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def get(token, path, project, config, **params):
    """(HTTP status, parsed JSON or {}). The token never appears in what is returned."""
    query = urllib.parse.urlencode({"project": project, "config": config, **params})
    req = urllib.request.Request(f"{API}{path}?{query}", headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "hrizzup-doppler-check-access",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            body = json.load(e)
        except ValueError:
            body = {}
        return e.code, body


def short(body, token):
    messages = body.get("messages") if isinstance(body, dict) else None
    text = "; ".join(str(m) for m in messages) if isinstance(messages, list) else ""
    return text.replace(token, "(token)")[:120]


def label(token, project, config):
    """The DOPPLER_CONFIG label of the config this request was answered from, or an error."""
    status, body = get(token, "/secret", project, config, name="DOPPLER_CONFIG")
    if status == 200:
        value = ((body.get("value") or {}).get("computed")) if isinstance(body, dict) else None
        return status, value, ""
    return status, None, short(body, token)


def download_config(token, project, config):
    """A full download's DOPPLER_CONFIG label only; everything else is discarded unread."""
    status, body = get(token, "/secrets/download", project, config, format="json")
    if status == 200:
        return status, body.get("DOPPLER_CONFIG") if isinstance(body, dict) else None, ""
    return status, None, short(body, token)


def write_refused(token, project, config):
    """An empty write (it changes nothing). Returns (refused?, HTTP status, message)."""
    body = json.dumps({"project": project, "config": config, "change_requests": []}).encode()
    req = urllib.request.Request(f"{API}/secrets", data=body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "hrizzup-doppler-check-access",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()  # discarded unread: an answer to a write can hold values
            return False, r.status, ""
    except urllib.error.HTTPError as e:
        try:
            parsed = json.load(e)
        except ValueError:
            parsed = {}
        return True, e.code, short(parsed, token)


def personal_login_saved():
    """True if Doppler's own settings file still holds a saved login (token key present)."""
    path = os.path.expanduser("~/.doppler/.doppler.yaml")
    try:
        with open(path) as f:
            return any(re.match(r"^\s+token:\s*\S", line) for line in f)
    except FileNotFoundError:
        return False


def main():
    failures = 0
    for account, (project, config, access) in TOKENS.items():
        token = keychain(account)
        print(f"{account} ({access})")
        if not token:
            print("  FAIL no token in the keychain")
            failures += 1
            continue
        status, value, err = label(token, project, config)
        if status == 200 and value == config:
            print(f"  ok   reads its own config ({project}/{value})")
        else:
            print(f"  FAIL its own config: HTTP {status} {err or value}")
            failures += 1
        if access == "read":
            refused, status, err = write_refused(token, project, config)
            if refused and status == 403:
                print(f"  ok   writes refused (read-only): HTTP {status} {err}")
            else:
                print(f"  FAIL writes: HTTP {status}, but this token should be read-only")
                failures += 1
        for p, c in PRODUCTION:
            for what, probe in (("one secret", label), ("full download", download_config)):
                status, value, err = probe(token, p, c)
                if status == 200 and value in ("prd", "prd_release"):
                    print(f"  FAIL {p}/{c}, {what}: READ production ({value})")
                    failures += 1
                elif status == 200:
                    print(f"  ok   {p}/{c}, {what}: not production (Doppler answered from {value})")
                else:
                    print(f"  ok   {p}/{c}, {what}: refused, HTTP {status} {err}")
        token = None
    if personal_login_saved():
        print("Personal Doppler login: still saved on this Mac (not used by Claude Code's commands; "
              "the founder signs it out with `doppler logout --yes`)")
    else:
        print("Personal Doppler login: none saved on this Mac")
    if failures:
        print(f"FAILED: {failures} problem(s)")
        return 1
    print("OK: every token works for its own config only, and none can open production.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
