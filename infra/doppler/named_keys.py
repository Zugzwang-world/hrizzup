#!/usr/bin/env python3
"""Runs one command with a few of the app's keys, by name, from one Doppler config: never the
whole config.

    python3 infra/doppler/named_keys.py <NAME>... -- <command>

A GitHub job that needs only some of a config's keys asks for them here, instead of loading the
whole config with Doppler's action, so the job never holds a key its command doesn't use, and
no later step holds any. It reads them with the job's read-only service token in $DOPPLER_TOKEN,
from Doppler's download endpoint limited to those names, then runs the command with them in its
environment, without $DOPPLER_TOKEN, and exits with the command's own exit code.

Only the app's keys (app-keys.txt) can be asked for, so a tool token never can, even if it sits
in the config. In GitHub's runners each value is masked in the job's log before the command
starts. Prints names only, never a value or a token. Python's standard library only.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import app_keys

DOWNLOAD = "https://api.doppler.com/v3/configs/config/secrets/download"  # with ?secrets=: those alone
ATTEMPTS = 3


def fetch(token, names, attempts=ATTEMPTS, pause=2):
    """{name: value} for exactly `names`, from the one config the token can read."""
    url = DOWNLOAD + "?" + urllib.parse.urlencode({"format": "json", "secrets": ",".join(names)})
    request = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "hrizzup-named-keys",
    })
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as answer:
                body = json.load(answer)
            break
        except urllib.error.HTTPError as e:
            if (e.code < 500 and e.code != 429) or attempt == attempts:
                raise RuntimeError(f"Doppler refused the request for the keys (HTTP {e.code})") from None
        except (OSError, ValueError) as e:
            if attempt == attempts:
                raise RuntimeError(f"Doppler's answer for the keys failed ({type(e).__name__})") from None
        time.sleep(pause * attempt)
    found = body.get("secrets", body) if isinstance(body, dict) else None
    if not isinstance(found, dict):
        raise RuntimeError("Doppler's answer holds no keys")
    missing = [name for name in names if not isinstance(found.get(name), str) or not found.get(name)]
    if missing:
        raise RuntimeError(f"the config has no value for {', '.join(missing)}")
    return {name: found[name] for name in names}  # those names alone, whatever else came back


def mask(values, out=None):
    """Tells GitHub's runner to hide each value, line by line, wherever it would show in the log."""
    out = sys.stdout if out is None else out
    for value in values:
        for line in value.splitlines():
            if line.strip():
                out.write(f"::add-mask::{line}\n")
    out.flush()


def main(argv=None, environ=None, get=fetch, run=os.execvpe):
    argv = sys.argv[1:] if argv is None else argv
    environ = dict(os.environ if environ is None else environ)
    if "--" not in argv or argv.index("--") == 0 or argv.index("--") == len(argv) - 1:
        print(__doc__, file=sys.stderr)
        return 2
    split = argv.index("--")
    names, command = argv[:split], argv[split + 1:]
    try:
        allowed = app_keys.app_keys()
    except (OSError, ValueError) as e:
        print(f"FAILED: {e}", file=sys.stderr)
        return 1
    refused = sorted({n for n in names if n not in allowed})
    if refused or len(set(names)) != len(names):
        print(f"FAILED: only the app's keys (infra/doppler/app-keys.txt) can be asked for, each once; "
              f"refused: {', '.join(refused) or 'a name given twice'}", file=sys.stderr)
        return 2
    token = environ.pop("DOPPLER_TOKEN", "")
    if not token:
        print("FAILED: no DOPPLER_TOKEN; the job gives this its read-only token for the config", file=sys.stderr)
        return 1
    try:
        keys = get(token, names)
    except RuntimeError as e:
        print(f"FAILED: {e}", file=sys.stderr)
        return 1
    if environ.get("GITHUB_ACTIONS") == "true":
        mask(keys.values())
    print(f"Running with {len(keys)} of the config's keys, by name: {', '.join(names)}.", file=sys.stderr, flush=True)
    environ.update(keys)
    try:
        return run(command[0], command, environ)  # replaces this process; returns only in tests
    except OSError as e:
        print(f"FAILED: couldn't run {command[0]} ({type(e).__name__})", file=sys.stderr)
        return 127


if __name__ == "__main__":
    sys.exit(main())
