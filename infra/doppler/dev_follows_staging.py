#!/usr/bin/env python3
"""Keep Doppler `hrizzup/dev` following staging through secret references.

    python3 infra/doppler/dev_follows_staging.py check   # report only; exits 1 on any problem
    python3 infra/doppler/dev_follows_staging.py apply   # fix dev, then check

Every app secret in `stg` gets a secret of the same name in `dev` whose value is the
reference `${stg.NAME}`, so local runs and browser tests on this Mac use staging's services
and no value is ever copied. Names listed in `dev-overrides.txt` are local-only values and
are left alone. `apply` adds missing references, turns any other value back into a
reference, and deletes dev secrets that no longer exist in staging (a reference left
pointing at nothing could fill itself in later with the wrong value).

Run it directly, not inside `doppler run`: it reads staging with Claude Code's read/write
token for `stg` and changes `dev` with its token for `dev`, both from this Mac's keychain
(README.md). Neither token can open `prd`. It prints secret names only, never a value, and
fails if any dev value points at production or at another project.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

PROJECT = "hrizzup"
HERE = os.path.dirname(os.path.abspath(__file__))
RESERVED = {"DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT", "DOPPLER_PROJECT"}
REFERENCE = re.compile(r"\$\{([^}]*)\}")
SERVICE = "hrizzup-doppler"  # Claude Code's tokens in this Mac's keychain (README.md)
CLI_DIR = os.path.expanduser("~/.config/hrizzup/doppler-cli")  # never holds a login


def token(config):
    r = subprocess.run(["security", "find-generic-password", "-s", SERVICE, "-a", f"{PROJECT}/{config}", "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit(f"no Doppler token for {PROJECT}/{config} in this Mac's keychain (infra/doppler/README.md)")
    return r.stdout.strip()


def doppler(config, *args):
    """Run a Doppler CLI command on hrizzup/<config> with that config's own token. The token
    goes to the doppler process only, as an environment variable; output is returned, never
    printed."""
    env = {k: v for k, v in os.environ.items() if k not in RESERVED | {"DOPPLER_TOKEN"}}
    env["DOPPLER_TOKEN"] = token(config)
    os.makedirs(CLI_DIR, mode=0o700, exist_ok=True)
    result = subprocess.run(["doppler", *args, "--project", PROJECT, "--config", config,
                             "--config-dir", CLI_DIR, "--no-check-version"],
                            capture_output=True, text=True, env=env)
    if result.returncode != 0:
        sys.exit(f"doppler {' '.join(args[:2])} on {config} failed (exit {result.returncode})")
    return result.stdout


def secrets(config):
    return json.loads(doppler(config, "secrets", "--json", "--raw"))


def local_overrides():
    names = set()
    path = os.path.join(HERE, "dev-overrides.txt")
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                name = line.split("#", 1)[0].strip()
                if name:
                    names.add(name)
    return names


def reference(name):
    return "${stg.%s}" % name


def same(a, b):
    return hashlib.sha256(a.encode()).digest() == hashlib.sha256(b.encode()).digest()


def check():
    stg, dev, local = secrets("stg"), secrets("dev"), local_overrides()
    app = set(stg) - RESERVED
    problems = []
    for name in sorted(set(dev) - RESERVED):
        for target in REFERENCE.findall(dev[name]["raw"]):
            parts = target.split(".")
            if "prd" in parts or len(parts) > 2:
                problems.append(f"{name}: points at production or at another project")
    for name in sorted(app - local):
        if name not in dev:
            problems.append(f"{name}: missing from dev")
        elif dev[name]["raw"] != reference(name):
            problems.append(f"{name}: dev holds its own value instead of the staging reference")
        elif dev[name]["computed"].startswith("${"):
            problems.append(f"{name}: reference does not resolve")
        elif not same(dev[name]["computed"], stg[name]["computed"]):
            problems.append(f"{name}: dev's value differs from staging's")
    for name in sorted(set(dev) - RESERVED - app - local):
        problems.append(f"{name}: in dev but not in staging (stale)")
    for name in sorted(local - set(dev)):
        problems.append(f"{name}: listed in dev-overrides.txt but missing from dev")
    if problems:
        print("dev does NOT follow staging:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"OK: dev follows staging: {len(app - local)} references to stg, "
          f"{len(local & set(dev))} local overrides, nothing stale, nothing pointing at production.")
    return 0


def apply():
    stg, dev, local = secrets("stg"), secrets("dev"), local_overrides()
    app = set(stg) - RESERVED
    to_set = sorted(n for n in app - local if n not in dev or dev[n]["raw"] != reference(n))
    stale = sorted(set(dev) - RESERVED - app - local)
    if to_set:
        doppler("dev", "secrets", "set", *[f"{n}={reference(n)}" for n in to_set],
                "--no-interactive", "--silent")
        print(f"set to the staging reference in dev: {', '.join(to_set)}")
    if stale:
        doppler("dev", "secrets", "delete", *stale, "--yes", "--silent")
        print(f"deleted from dev (no longer in staging): {', '.join(stale)}")
    if not to_set and not stale:
        print("nothing to change")
    return check()


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "check"
    if action not in ("check", "apply"):
        sys.exit(__doc__)
    sys.exit(check() if action == "check" else apply())
