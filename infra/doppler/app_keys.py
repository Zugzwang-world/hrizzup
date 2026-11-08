#!/usr/bin/env python3
"""Only the app's keys in Doppler `hrizzup`: the check that keeps tool tokens out.

    python3 infra/doppler/app_keys.py check stg           # a GitHub job, before it loads stg
    python3 infra/doppler/app_keys.py check stg_preview   # or before it loads stg_preview

`app-keys.txt`, next to this file, lists the app's keys by name: whatever the website, its
server code or the database needs to run. Every name in hrizzup's `stg`, `stg_preview` and
`dev` must be one of them, besides Doppler's own three labels. `stg` and `stg_preview` are
synced into Vercel's staging and previews, and GitHub jobs load them whole, so anything else
there, such as a tool token, reaches every staging and preview build and those jobs (runbook
Part 4, "Where each kind of key lives"). It happened twice: `VERCEL_TOKEN` on 3 November 2026
and `EXPO_TOKEN` on 8 November 2026.

`check` reads the config's names with the read-only service token in $DOPPLER_TOKEN, from
Doppler's names endpoint, which sends no values, and exits 1 on any name not listed. A job
runs it before loading the config, so a stray key stops the job before the job holds it. On
this Mac, `dev_follows_staging.py check` applies the same rule to all three configs and also
refuses any name `hrizzup-tools` holds.

Prints names only, never a value or a token. Python's standard library only.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP_KEYS = os.path.join(HERE, "app-keys.txt")
LABELS = frozenset({"DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT", "DOPPLER_PROJECT"})  # Doppler's own
NAME = re.compile(r"[A-Z][A-Z0-9_]*")
NAMES_ENDPOINT = "https://api.doppler.com/v3/configs/config/secrets/names"  # names only, no values
RULE = 'runbook Part 4, "Where each kind of key lives"'
ATTEMPTS = 3


def read_names(path):
    """The names a list file holds, in order: one per line, with what it's for after a #.
    Refuses a line that isn't a plain name without repeating it, in case it holds a value."""
    file, names = os.path.basename(path), []
    with open(path, encoding="utf-8") as f:
        for number, line in enumerate(f, 1):
            name = line.split("#", 1)[0].strip()
            if not name:
                continue
            if not NAME.fullmatch(name):
                raise ValueError(f"{file}, line {number}: not a key name (names only, never a value)")
            if name in names:
                raise ValueError(f"{file}, line {number}: {name} is listed twice")
            names.append(name)
    return names


def app_keys(path=APP_KEYS):
    """The app's keys, from app-keys.txt."""
    file, names = os.path.basename(path), read_names(path)
    if not names:
        raise ValueError(f"{file} lists no names")
    labels = sorted(LABELS & set(names))
    if labels:
        raise ValueError(f"{file}: {', '.join(labels)} is Doppler's own label, never listed")
    return frozenset(names)


def problems(configs, app, tools=None, overrides=()):
    """Every way hrizzup's names break the rule, one line each, names only.

    configs:   {config: its names}, for hrizzup's configs (stg, stg_preview, dev);
    app:       the app's keys (app-keys.txt);
    tools:     the names hrizzup-tools holds, or None where they can't be read (a GitHub job);
    overrides: the names in dev-overrides.txt."""
    tools = set() if tools is None else set(tools) - LABELS
    held = {}
    for config, names in configs.items():
        for name in sorted(set(names) - LABELS):
            held.setdefault(name, []).append(config)
    found = []
    for name in sorted(n for n in held if n not in app):
        also = "; hrizzup-tools holds the same name" if name in tools else ""
        found.append(
            f"{name}, in {joined(held[name])}: not one of the app's keys (infra/doppler/app-keys.txt){also}. "
            f"A tool token belongs only in hrizzup-tools/claude ({RULE}); "
            f"a new app key is listed in app-keys.txt before it's added to Doppler")
    for name in sorted(app & tools):
        where = f", in {joined(held[name])}" if name in held else ""
        found.append(
            f"{name}{where}: listed in app-keys.txt, yet hrizzup-tools holds the same name. "
            f"A tool token is never one of the app's keys ({RULE})")
    for name in sorted(set(overrides) - app):
        found.append(f"{name}: dev-overrides.txt lists it, but it isn't one of the app's keys")
    return found


def joined(items):
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def doppler_names(token, attempts=ATTEMPTS, pause=2):
    """The names in the one config a service token can read, from Doppler's names endpoint,
    which never sends a value. A dropped connection or a busy Doppler is tried again."""
    request = urllib.request.Request(NAMES_ENDPOINT, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "hrizzup-app-keys-check",
    })
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as answer:
                body = json.load(answer)
            break
        except urllib.error.HTTPError as e:
            if (e.code < 500 and e.code != 429) or attempt == attempts:
                raise RuntimeError(f"Doppler refused the names request (HTTP {e.code})") from None
        except (OSError, ValueError) as e:  # no connection, a timeout, or an answer that isn't JSON
            if attempt == attempts:
                raise RuntimeError(f"Doppler's names request failed ({type(e).__name__})") from None
        time.sleep(pause * attempt)
    names = body.get("names") if isinstance(body, dict) else None
    if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        raise RuntimeError("Doppler's answer holds no list of names")
    if not LABELS <= set(names):
        raise RuntimeError("Doppler's answer lacks its own labels, so it isn't a whole config's names")
    return names


def main(argv=None, environ=None, fetch=doppler_names):
    argv = sys.argv[1:] if argv is None else argv
    environ = os.environ if environ is None else environ
    if len(argv) != 2 or argv[0] != "check":
        print(__doc__, file=sys.stderr)
        return 2
    config, token = argv[1], environ.get("DOPPLER_TOKEN", "")
    if not token:
        print(f"FAILED: no DOPPLER_TOKEN; the job gives this check its read-only token for {config}")
        return 1
    try:
        app = app_keys()
        names = fetch(token)
    except (OSError, ValueError, RuntimeError) as e:
        print(f"FAILED: {e}")
        return 1
    found = problems({config: names}, app)
    if found:
        print(f"FAILED: {config} holds names that aren't the app's keys, so this job stops before loading it:")
        for problem in found:
            print(f"  - {problem}")
        return 1
    print(f"OK: {config} holds only the app's keys ({len(set(names) - LABELS)} names, "
          f"besides Doppler's own labels).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
