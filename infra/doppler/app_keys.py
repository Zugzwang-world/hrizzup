#!/usr/bin/env python3
"""Only the app's keys in Doppler `hrizzup`: the check that keeps tool tokens out.

    python3 infra/doppler/app_keys.py check stg           # a GitHub job, before it loads stg
    python3 infra/doppler/app_keys.py check stg_preview   # or before it loads stg_preview
    python3 infra/doppler/app_keys.py check prd_release   # the release pipeline, before it loads prd_release
    python3 infra/doppler/app_keys.py vercel production   # the release pipeline, before it changes production
    python3 infra/doppler/app_keys.py vercel staging      # the same check on staging's settings

`app-keys.txt`, next to this file, lists the app's keys by name: whatever the website, its
server code or the database needs to run. Every name in hrizzup's `stg`, `stg_preview` and
`dev` must be one of them, besides Doppler's own three labels. `stg` and `stg_preview` are
synced into Vercel's staging and previews, and GitHub jobs read them, so anything else
there, such as a tool token, reaches every staging and preview build and those jobs (runbook
Part 4, "Where each kind of key lives"). It happened twice: `VERCEL_TOKEN` on 3 November 2026
and `EXPO_TOKEN` on 8 November 2026.

`check` reads the config's names with the read-only service token in $DOPPLER_TOKEN, from
Doppler's names endpoint, which sends no values, and exits 1 on any name not listed. A job
runs it before loading the config, so a stray key stops the job before the job holds it. On
this Mac, `dev_follows_staging.py check` applies the same rule to all three configs and also
refuses any name `hrizzup-tools` holds.

Production has the same rule with two differences. `prd_release`, the release pipeline's own
branch of `prd`, may also hold the pipeline's credentials (`release-keys.txt`), and never an
app key that only staging and the previews use (`STAGING_ONLY`). And since a name in
prd_release can't say whether it came from `prd` (synced to Vercel's production settings, so
into every production build) or from prd_release itself, `vercel production` reads the names
in Vercel's production settings with the pipeline's own Vercel token ($VERCEL_TOKEN, for the
project in $VERCEL_PROJECT_ID and $VERCEL_ORG_ID) and refuses any that isn't one of the app's
keys production holds: one of the pipeline's credentials in `prd` stops the release too. So
that an empty or partial answer can't pass, every production key the pipeline loaded (which
prd holds) must be among Vercel's production names, a setting whose environments can't be
read fails the check, and so does an answer saying Vercel hid some of production's settings
from the token. It runs only with prd_release loaded (DOPPLER_CONFIG), refusing before it
contacts Vercel otherwise, so Claude Code never reads production's names. Vercel's settings are read without their values (never decrypted).
`vercel staging` asks Vercel for staging's settings alone and fails if the answer holds any of
production's, so Claude Code can run it without reading production's; there, every app key
must be present. The release pipeline runs both checks from its own commit (main's newest),
never from the commit it releases or rolls back to.

Prints names only, never a value or a token. Python's standard library only.
"""
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP_KEYS = os.path.join(HERE, "app-keys.txt")
RELEASE_KEYS = os.path.join(HERE, "release-keys.txt")
LABELS = frozenset({"DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT", "DOPPLER_PROJECT"})  # Doppler's own
# App keys production never holds: the previews' sign-in relay is staging's and the previews'
# alone (app-keys.txt says so on its line; product/web/app/auth/relay/route.ts).
STAGING_ONLY = frozenset({"AUTH_RELAY_SECRET"})
PRODUCTION = "prd_release"  # the one production config a job reads: the release pipeline's own
NAME = re.compile(r"[A-Z][A-Z0-9_]*")
NAMES_ENDPOINT = "https://api.doppler.com/v3/configs/config/secrets/names"  # names only, no values
VERCEL_ENV = "https://api.vercel.com/v10/projects/{project}/env"  # never with decrypt=true
VERCEL_ENVIRONMENTS = ("production", "staging")
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


def release_keys(path=RELEASE_KEYS, app=None):
    """The release pipeline's own credentials, from release-keys.txt: never an app key."""
    file, names = os.path.basename(path), frozenset(read_names(path))
    if not names:
        raise ValueError(f"{file} lists no names")
    both = sorted(names & (app_keys() if app is None else app))
    if both:
        raise ValueError(f"{file}: {', '.join(both)} is listed in app-keys.txt too; a credential is never an app key")
    labels = sorted(LABELS & names)
    if labels:
        raise ValueError(f"{file}: {', '.join(labels)} is Doppler's own label, never listed")
    return names


def production_problems(names, app, release, where=PRODUCTION, credentials_allowed=True):
    """Every way production's names break the rule, one line each, names only.

    names:   the names in prd_release (prd's keys and the pipeline's own), or in Vercel's
             production settings (prd's keys alone: credentials_allowed=False);
    app:     the app's keys (app-keys.txt), of which production holds all but STAGING_ONLY;
    release: the release pipeline's credentials (release-keys.txt), allowed in prd_release only."""
    found = []
    for name in sorted(set(names) - LABELS):
        if name in STAGING_ONLY:
            found.append(
                f"{name}, in {where}: one of the app's keys, but staging's and the previews' alone; "
                f"production never holds it (infra/doppler/app-keys.txt)")
        elif name in release and not credentials_allowed:
            found.append(
                f"{name}, in {where}: one of the release pipeline's own credentials "
                f"(infra/doppler/release-keys.txt), which belong in prd_release alone; in prd, "
                f"Doppler syncs them into every production build")
        elif name not in app and name not in release:
            allowed = ("one of the app's keys (infra/doppler/app-keys.txt) nor one of the release "
                       "pipeline's own credentials (infra/doppler/release-keys.txt)")
            found.append(
                f"{name}, in {where}: neither {allowed}. A tool token belongs only in "
                f"hrizzup-tools/claude ({RULE}); a new production key is listed before it's added "
                f"to Doppler")
    return found


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
        except (OSError, ValueError, http.client.HTTPException) as e:  # no connection, a timeout, a broken-off or non-JSON answer
            if attempt == attempts:
                raise RuntimeError(f"Doppler's names request failed ({type(e).__name__})") from None
        time.sleep(pause * attempt)
    names = body.get("names") if isinstance(body, dict) else None
    if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        raise RuntimeError("Doppler's answer holds no list of names")
    if not LABELS <= set(names):
        raise RuntimeError("Doppler's answer lacks its own labels, so it isn't a whole config's names")
    return names


def vercel_page(url, token, attempts=ATTEMPTS, pause=2):
    """One page of Vercel's answer, tried again when Vercel is busy or the answer breaks off."""
    request = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "hrizzup-app-keys-check",
    })
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as answer:
                return json.load(answer)
        except urllib.error.HTTPError as e:
            if (e.code < 500 and e.code != 429) or attempt == attempts:
                raise RuntimeError(f"Vercel refused the settings request (HTTP {e.code})") from None
        except (OSError, ValueError, http.client.HTTPException) as e:
            if attempt == attempts:
                raise RuntimeError(f"Vercel's settings request failed ({type(e).__name__})") from None
        time.sleep(pause * attempt)


def targets(entry):
    """The environments one Vercel setting is for: its targets and custom environments. A
    setting whose targets can't be read fails the check rather than being skipped."""
    target = entry.get("target")
    if isinstance(target, str):
        target = [target]
    custom = entry.get("customEnvironmentIds") or []
    if not isinstance(target, list) or not all(isinstance(t, str) for t in target) \
            or not isinstance(custom, list) or not (target or custom):
        raise RuntimeError("Vercel's answer has a setting whose environments can't be read")
    return set(target), custom


def vercel_names(token, project, team, environment, attempts=ATTEMPTS, pause=2, pages=50):
    """The names in one environment's Vercel settings, never a value (nothing is decrypted).
    Staging's are asked for alone (Vercel's customEnvironmentSlug); an answer for staging that
    holds any of production's fails, so production's are never read here. Production's are
    picked from the project's list by their target. Anything unexpected fails the check: a
    setting whose environments can't be read, a page that says there's more but doesn't move
    on (Vercel sends no pages today; `until` follows its other lists' paging)."""
    query = {"teamId": team}
    if environment == "staging":
        query["customEnvironmentSlug"] = "staging"
    base = VERCEL_ENV.format(project=urllib.parse.quote(project, safe=""))
    names, seen = set(), set()
    for _ in range(pages):
        body = vercel_page(base + "?" + urllib.parse.urlencode(query), token, attempts, pause)
        entries = body.get("envs") if isinstance(body, dict) else None
        if not isinstance(entries, list) or not all(isinstance(e, dict) and isinstance(e.get("key"), str)
                                                    for e in entries):
            raise RuntimeError("Vercel's answer holds no list of settings")
        if environment == "production" and body.get("hiddenProductionEnvCount") not in (None, 0):
            # Settings Vercel won't show this token can't be checked, so the check can't pass.
            raise RuntimeError("Vercel hides some of production's settings from this token, so their names "
                               "can't be checked")
        for entry in entries:
            target, custom = targets(entry)
            if environment == "staging":
                if "production" in target:
                    raise RuntimeError("Vercel's answer for staging holds production's settings; nothing more is read")
                if custom:
                    names.add(entry["key"])  # the name alone; its value is never read
            elif "production" in target:
                names.add(entry["key"])
        paging = body.get("pagination")
        if paging is None:
            return sorted(names)
        if not isinstance(paging, dict):
            raise RuntimeError("Vercel's answer has paging that can't be read")
        following = paging.get("next")
        if following is None:
            return sorted(names)
        if not isinstance(following, (int, str)) or isinstance(following, bool) or following in seen:
            raise RuntimeError("Vercel's answer says there's another page but doesn't move on")
        seen.add(following)
        query["until"] = following
    raise RuntimeError(f"Vercel's answer runs past {pages} pages")


def report(found, failed, ok):
    """Prints the verdict, names only, and returns the exit code."""
    if found:
        print(f"FAILED: {failed}:")
        for problem in found:
            print(f"  - {problem}")
        return 1
    print(f"OK: {ok}.")
    return 0


def check(config, environ, fetch):
    """`check <config>`: a Doppler config's names, before a job loads it."""
    token = environ.get("DOPPLER_TOKEN", "")
    if not token:
        print(f"FAILED: no DOPPLER_TOKEN; the job gives this check its read-only token for {config}")
        return 1
    try:
        app = app_keys()
        release = release_keys(app=app) if config == PRODUCTION else frozenset()
        names = fetch(token)
    except (OSError, ValueError, RuntimeError) as e:
        print(f"FAILED: {e}")
        return 1
    count = len(set(names) - LABELS)
    if config == PRODUCTION:
        return report(production_problems(names, app, release),
                      f"{config} holds names production mustn't hold, so this job stops before loading it",
                      f"{config} holds only production's app keys and the release pipeline's own "
                      f"credentials ({count} names, besides Doppler's own labels)")
    return report(problems({config: names}, app),
                  f"{config} holds names that aren't the app's keys, so this job stops before loading it",
                  f"{config} holds only the app's keys ({count} names, besides Doppler's own labels)")


def check_vercel(environment, environ, fetch):
    """`vercel <environment>`: the names in Vercel's settings for that environment."""
    where = f"Vercel's {environment} settings"
    needed = {name: environ.get(name, "") for name in ("VERCEL_TOKEN", "VERCEL_PROJECT_ID", "VERCEL_ORG_ID")}
    missing = sorted(name for name, value in needed.items() if not value)
    if missing:
        print(f"FAILED: no {', '.join(missing)}; this check reads {where} with them")
        return 1
    try:
        app = app_keys()
        release = release_keys(app=app)
    except (OSError, ValueError) as e:
        print(f"FAILED: {e}")
        return 1
    held = sorted(n for n in app - STAGING_ONLY if environ.get(n))
    if environment == "production" and (environ.get("DOPPLER_CONFIG") != PRODUCTION or not held):
        # Only the release pipeline, with prd_release loaded, reads production's settings: never
        # Claude Code, whose tokens could list them. Refused before Vercel is contacted.
        print(f"FAILED: {where} are read only by the release pipeline, with {PRODUCTION} loaded")
        return 1
    try:
        names = fetch(needed["VERCEL_TOKEN"], needed["VERCEL_PROJECT_ID"], needed["VERCEL_ORG_ID"], environment)
    except RuntimeError as e:
        print(f"FAILED: {e}")
        return 1
    count = len(set(names) - LABELS)
    if environment == "production":
        # Every production key the pipeline loaded from prd_release came from prd, which Doppler
        # syncs to Vercel's production settings: each must be there, or Vercel's answer (or the
        # sync) is incomplete, and a name it left out could be anything.
        found = [f"{name}, which prd holds, is missing from {where}: Vercel's answer is incomplete, "
                 f"or Doppler's sync of prd to Vercel is" for name in sorted(set(held) - set(names))]
        found += production_problems(names, app, release, where, credentials_allowed=False)
        return report(found,
                      f"{where} don't hold exactly production's app keys, so production isn't changed",
                      f"{where} hold only production's app keys, all {len(held)} that prd holds ({count} names)")
    found = [f"{name}, one of the app's keys, is missing from {where}: Vercel's answer is incomplete, "
             f"or Doppler's sync of stg to Vercel is" for name in sorted(app - set(names))]
    found += problems({where: names}, app)
    return report(found,
                  f"{where} don't hold exactly the app's keys",
                  f"{where} hold the app's keys and nothing else ({count} names)")


def main(argv=None, environ=None, fetch=doppler_names, vercel=vercel_names):
    argv = sys.argv[1:] if argv is None else argv
    environ = os.environ if environ is None else environ
    if len(argv) == 2 and argv[0] == "check":
        return check(argv[1], environ, fetch)
    if len(argv) == 2 and argv[0] == "vercel" and argv[1] in VERCEL_ENVIRONMENTS:
        return check_vercel(argv[1], environ, vercel)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
