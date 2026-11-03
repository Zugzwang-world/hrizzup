#!/usr/bin/env python3
"""Apply this folder's Supabase Auth settings to one environment, then read them back.

    python3 infra/supabase/auth/apply.py staging            # apply, then check
    python3 infra/supabase/auth/apply.py staging --check    # check only, change nothing

Settings come from settings.json and templates/. Secrets come only from environment
variables, filled in by Doppler at run time (names in settings.json, "secrets"):
SUPABASE_ACCESS_TOKEN for Supabase's Management API, plus the environment's own
GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, RESEND_API_KEY, TURNSTILE_SECRET_KEY
and SUPABASE_URL. Staging, by Claude Code:

    infra/doppler/run tools stg -- python3 infra/supabase/auth/apply.py staging

Production is applied only by the release pipeline, with its own credentials (runbook
Part 10). Claude Code's Supabase token reaches only hrizzup-staging, so Supabase itself
refuses it for any other project. The script refuses to run if SUPABASE_URL belongs to a different project than
the chosen environment (so one environment's keys can't land in the other), or if the
Turnstile secret is one of Cloudflare's published test keys.

It prints setting names and non-secret values only. Supabase returns secrets as a keyed
fingerprint (HMAC-SHA256 with the project ref as the key); they are compared that way in
memory and never printed, and Supabase's answers are never printed whole.
"""
import hashlib
import hmac
import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://api.supabase.com/v1/projects/{ref}/config/auth"
# Switches that turn on a way to sign in. Besides these, every external_*_enabled is one.
SIGN_IN_SWITCHES = {"saml_enabled", "passkey_enabled", "custom_oauth_enabled", "oauth_server_enabled"}
TURNSTILE_TEST_SECRETS = {
    "1x0000000000000000000000000000000AA",
    "2x0000000000000000000000000000000AA",
    "3x0000000000000000000000000000000AA",
}


def fail(message):
    sys.exit(f"FAILED: {message}")


def load():
    with open(os.path.join(HERE, "settings.json")) as f:
        return json.load(f)


def wanted(cfg, env):
    """The settings Supabase should hold for env, plus the secrets, from the environment."""
    e = cfg["environments"][env]
    plain = dict(cfg["shared"])
    plain.update(e["settings"])
    for field, path in cfg["templates"].items():
        with open(os.path.join(HERE, path)) as f:
            plain[field] = f.read()
    secrets = {}
    for field, var in cfg["secrets"].items():
        value = os.environ.get(var, "")
        if not value:
            fail(f"{var} is not set (it fills {field})")
        secrets[field] = value
    return e["project_ref"], plain, secrets


def guard(ref, env, plain, secrets):
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if url != f"https://{ref}.supabase.co":
        fail(f"SUPABASE_URL does not belong to {env}'s project {ref}; "
             "run this with that environment's own Doppler config")
    if secrets["security_captcha_secret"] in TURNSTILE_TEST_SECRETS:
        fail("TURNSTILE_SECRET_KEY is one of Cloudflare's test keys (the previews' override), "
             "not the environment's real widget")
    seconds = plain["mailer_otp_exp"]
    if seconds % 60:
        fail("mailer_otp_exp must be whole minutes, so the emails can say how long a code lasts")
    stated = re.compile(r"\bexpires in %d minutes\b" % (seconds // 60))
    for field in plain:
        if field.startswith("mailer_templates_") and not stated.search(plain[field]):
            fail(f"{field}: the template doesn't say the code expires in {seconds // 60} minutes, "
                 "which is what mailer_otp_exp sets")


def call(method, ref, body=None, secrets=()):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API.format(ref=ref), data=data, method=method, headers={
        "Authorization": "Bearer " + os.environ.get("SUPABASE_ACCESS_TOKEN", ""),
        "Content-Type": "application/json",
        "User-Agent": "hrizzup-infra-auth-apply",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as err:
        text = err.read().decode(errors="replace")
        try:
            message = str(json.loads(text).get("message", ""))
        except (ValueError, AttributeError):
            message = ""
        if any(s and (s in text or s in message) for s in secrets):
            message = "(Supabase's message quoted a secret, so it isn't shown)"
        fail(f"{method} auth config: HTTP {err.code} {message[:200]}")


def secret_matches(ref, live, value):
    """Supabase returns most secrets as HMAC-SHA256(key=project ref, value) in hex, and some
    (the Google client ID) as stored. A match in either form proves the value is the same.
    Compared in memory as bytes, never printed."""
    live = (live or "").encode()
    keyed = hmac.new(ref.encode(), value.encode(), hashlib.sha256).hexdigest().encode()
    return hmac.compare_digest(live, keyed) or hmac.compare_digest(live, value.encode())


def sign_in_switch(field):
    return field in SIGN_IN_SWITCHES or (field.startswith("external_") and field.endswith("_enabled"))


def compare(ref, live, plain, secrets):
    problems = []
    for field, value in sorted(plain.items()):
        if live.get(field) != value:
            if field.startswith("mailer_templates_"):
                problems.append(f"{field}: differs from the repo's template")
            else:
                problems.append(f"{field}: Supabase has {live.get(field)!r}, the repo says {value!r}")
    for field, value in sorted(secrets.items()):
        if not secret_matches(ref, live.get(field), value):
            problems.append(f"{field}: differs from Doppler's value (not shown)")
    for field in sorted(k for k, v in live.items() if sign_in_switch(k) and v is True):
        if plain.get(field) is not True:
            problems.append(f"{field}: a sign-in method that is on in Supabase but not in the repo")
    return problems


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ("staging", "production") or args[1:] not in ([], ["--check"]):
        sys.exit(__doc__)
    env, check_only = args[0], args[1:] == ["--check"]
    cfg = load()
    if not cfg["environments"][env]["project_ref"]:
        fail(f"{env} has no project_ref in settings.json yet")
    ref, plain, secrets = wanted(cfg, env)
    if not os.environ.get("SUPABASE_ACCESS_TOKEN"):
        fail("SUPABASE_ACCESS_TOKEN is not set")
    guard(ref, env, plain, secrets)
    hidden = list(secrets.values()) + [os.environ["SUPABASE_ACCESS_TOKEN"]]
    if not check_only:
        call("PATCH", ref, {**plain, **secrets}, hidden)
        print(f"{env}: sent {len(plain)} settings and {len(secrets)} secrets to project {ref}")
    problems = compare(ref, call("GET", ref, secrets=hidden), plain, secrets)
    if problems:
        print(f"{env}: Supabase Auth does NOT match the repo:")
        for p in problems:
            print(f"  - {p}")
        return 1
    on = sorted(k for k, v in plain.items() if sign_in_switch(k) and v is True)
    print(f"{env}: Supabase Auth matches the repo ({len(plain)} settings, {len(secrets)} secrets "
          f"by fingerprint; sign-in methods on: {', '.join(on)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
