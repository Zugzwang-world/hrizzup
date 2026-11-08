#!/usr/bin/env python3
"""Keep Doppler `hrizzup/dev` following staging through secret references, and `hrizzup`'s
configs holding the app's keys only.

    python3 infra/doppler/dev_follows_staging.py check   # report only; exits 1 on any problem
    python3 infra/doppler/dev_follows_staging.py apply   # fix dev, then check

Every app key in `stg` gets a secret of the same name in `dev` whose value is the reference
`${stg.NAME}`, so local runs and browser tests on this Mac use staging's services and no value
is ever copied. Names listed in `dev-overrides.txt` are local-only values and are left alone.
`apply` adds missing references, turns any other value back into a reference, and deletes dev
secrets that no longer exist in staging or aren't the app's keys (a reference left pointing at
nothing could fill itself in later with the wrong value).

The app's keys are listed by name in `app-keys.txt` (app_keys.py). `check` fails on any other
name in `stg`, `stg_preview` or `dev`, such as a tool token, and on any name `hrizzup-tools`
holds; `apply` never gives `dev` a reference to a name that isn't listed.

Run it directly, not inside `doppler run`: it reads staging with Claude Code's read/write
token for `stg`, changes `dev` with its token for `dev`, and reads only the names in
`stg_preview` and `hrizzup-tools/claude` with their tokens, all from this Mac's keychain
(README.md). None of them can open `prd`. It prints secret names only, never a value, and
fails if any dev value points at production or at another project.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

import app_keys

PROJECT = "hrizzup"
TOOLS = "hrizzup-tools/claude"  # Claude Code's setup keys and tool tokens (README.md)
HERE = os.path.dirname(os.path.abspath(__file__))
RESERVED = app_keys.LABELS  # Doppler's own labels, in every config
REFERENCE = re.compile(r"\$\{([^}]*)\}")
SERVICE = "hrizzup-doppler"  # Claude Code's tokens in this Mac's keychain (README.md)
CLI_DIR = os.path.expanduser("~/.config/hrizzup/doppler-cli")  # never holds a login


def token(account):
    r = subprocess.run(["security", "find-generic-password", "-s", SERVICE, "-a", account, "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit(f"no Doppler token for {account} in this Mac's keychain (infra/doppler/README.md)")
    return r.stdout.strip()


def doppler(config, *args):
    """Run a Doppler CLI command on hrizzup/<config> with that config's own token. The token
    goes to the doppler process only, as an environment variable; output is returned, never
    printed."""
    env = {k: v for k, v in os.environ.items() if k not in RESERVED | {"DOPPLER_TOKEN"}}
    env["DOPPLER_TOKEN"] = token(f"{PROJECT}/{config}")
    os.makedirs(CLI_DIR, mode=0o700, exist_ok=True)
    result = subprocess.run(["doppler", *args, "--project", PROJECT, "--config", config,
                             "--config-dir", CLI_DIR, "--no-check-version"],
                            capture_output=True, text=True, env=env)
    if result.returncode != 0:
        sys.exit(f"doppler {' '.join(args[:2])} on {config} failed (exit {result.returncode})")
    return result.stdout


def secrets(config):
    return json.loads(doppler(config, "secrets", "--json", "--raw"))


def names(account):
    """The names alone in one config (project/config), through Doppler's names endpoint,
    which sends no values."""
    try:
        return app_keys.doppler_names(token(account))
    except RuntimeError as e:
        sys.exit(f"{account}: {e}")


def lists():
    """(the app's keys, dev's local overrides), from app-keys.txt and dev-overrides.txt."""
    try:
        overrides = os.path.join(HERE, "dev-overrides.txt")
        local = set(app_keys.read_names(overrides)) if os.path.exists(overrides) else set()
        return app_keys.app_keys(), local
    except (OSError, ValueError) as e:
        sys.exit(f"the names lists can't be read: {e}")


def reference(name):
    return "${stg.%s}" % name


def same(a, b):
    return hashlib.sha256(a.encode()).digest() == hashlib.sha256(b.encode()).digest()


def check():
    stg, dev = secrets("stg"), secrets("dev")
    app, local = lists()
    preview, tools = names(f"{PROJECT}/stg_preview"), names(TOOLS)

    # Only the app's keys in hrizzup (app-keys.txt), and none of hrizzup-tools' names.
    guard = app_keys.problems({"stg": stg, "stg_preview": preview, "dev": dev}, app, tools, local)
    guard += [f"{name}: listed in app-keys.txt, but stg doesn't hold it (a key deleted from stg "
              f"leaves the list)" for name in sorted(app - set(stg))]

    # dev follows staging's app keys, and nothing else.
    follows = (set(stg) - RESERVED) & app
    problems = []
    for name in sorted(set(dev) - RESERVED):
        for target in REFERENCE.findall(dev[name]["raw"]):
            parts = target.split(".")
            if "prd" in parts or len(parts) > 2:
                problems.append(f"{name}: points at production or at another project")
    for name in sorted(follows - local):
        if name not in dev:
            problems.append(f"{name}: missing from dev")
        elif dev[name]["raw"] != reference(name):
            problems.append(f"{name}: dev holds its own value instead of the staging reference")
        elif dev[name]["computed"].startswith("${"):
            problems.append(f"{name}: reference does not resolve")
        elif not same(dev[name]["computed"], stg[name]["computed"]):
            problems.append(f"{name}: dev's value differs from staging's")
    for name in sorted((set(dev) - RESERVED - follows - local) & app):
        problems.append(f"{name}: in dev but not in staging (stale)")
    for name in sorted(local - set(dev)):
        problems.append(f"{name}: listed in dev-overrides.txt but missing from dev")

    if guard:
        print("hrizzup holds names that aren't the app's keys (infra/doppler/app-keys.txt):")
        for p in guard:
            print(f"  - {p}")
    else:
        print(f"OK: stg, stg_preview and dev hold only the app's keys ({len(app)} listed in "
              f"app-keys.txt), and none of hrizzup-tools' names.")
    if problems:
        print("dev does NOT follow staging:")
        for p in problems:
            print(f"  - {p}")
    else:
        print(f"OK: dev follows staging: {len(follows - local)} references to stg, "
              f"{len(local & set(dev))} local overrides, nothing stale, nothing pointing at production.")
    return 1 if guard or problems else 0


def apply():
    stg, dev = secrets("stg"), secrets("dev")
    app, local = lists()
    follows = (set(stg) - RESERVED) & app  # never a reference to a name that isn't an app key
    to_set = sorted(n for n in follows - local if n not in dev or dev[n]["raw"] != reference(n))
    drop = set(dev) - RESERVED - follows - local
    stale, strays = sorted(drop & app), sorted(drop - app)
    if to_set:
        doppler("dev", "secrets", "set", *[f"{n}={reference(n)}" for n in to_set],
                "--no-interactive", "--silent")
        print(f"set to the staging reference in dev: {', '.join(to_set)}")
    if stale or strays:
        doppler("dev", "secrets", "delete", *stale, *strays, "--yes", "--silent")
        if stale:
            print(f"deleted from dev (no longer in staging): {', '.join(stale)}")
        if strays:
            print(f"deleted from dev (not the app's keys): {', '.join(strays)}")
    left_out = sorted(set(stg) - RESERVED - app)
    if left_out:
        print(f"left out of dev (in stg, but not the app's keys): {', '.join(left_out)}")
    if not to_set and not drop:
        print("nothing to change in dev")
    return check()


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "check"
    if action not in ("check", "apply"):
        sys.exit(__doc__)
    sys.exit(check() if action == "check" else apply())
