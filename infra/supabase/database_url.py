#!/usr/bin/env python3
"""The database's addresses, from the values Supabase's dashboard shows (runbook Part 10).

    python3 infra/supabase/database_url.py check                      # check both, print facts only
    python3 infra/supabase/database_url.py run session -- <command>   # run with DATABASE_ADDRESS set
    python3 infra/supabase/database_url.py run transaction -- <command>

DATABASE_URL and DATABASE_URL_SESSION are copied as they are from Supabase's Connect
dialog ("Transaction pooler" and "Session pooler"), with Supabase's [YOUR-PASSWORD]
placeholder still in them, and SUPABASE_DB_PASSWORD is the database password. Nobody
builds a connection string by hand: this fills the password in, percent-encoded, in memory.
(A complete address with no placeholder is used as it is.) The website does the same in
product/web/lib/db.ts.

`check` confirms each address is Supabase's shared pooler for the project in SUPABASE_URL,
in the right mode (transaction on 6543, session on 5432), and prints only the host, port,
user and database, never the password or a whole address. `run` checks the same, then
starts the command with the full address in DATABASE_ADDRESS (in GitHub Actions the
address and the encoded password are masked first). A command that needs it on its
command line reads it through `sh -c '... "$DATABASE_ADDRESS"'`.
"""
import os
import re
import sys
import urllib.parse

PLACEHOLDER = "[YOUR-PASSWORD]"
MODES = {  # mode: (variable, port)
    "transaction": ("DATABASE_URL", 6543),
    "session": ("DATABASE_URL_SESSION", 5432),
}
SHAPE = re.compile(r"^(postgres(?:ql)?)://([^:@/\s]+):(.+)@([^:@/\s]+):(\d+)/([^?#/\s]+)(\?[^#\s]*)?$")
REF_FROM_URL = re.compile(r"^https://([a-z0-9]{20})\.supabase\.co/?$")


def fail(message):
    sys.exit(f"FAILED: {message}")


def project_ref():
    match = REF_FROM_URL.match(os.environ.get("SUPABASE_URL", "").strip())
    if not match:
        fail("SUPABASE_URL is not a Supabase project address (https://<project id>.supabase.co)")
    return match.group(1)


def parts(mode):
    """Checks the variable for `mode` and returns its parts; never prints a value."""
    var, port = MODES[mode]
    raw = os.environ.get(var, "").strip()
    if not raw:
        fail(f"{var} is not set")
    match = SHAPE.match(raw)
    if not match:
        fail(f"{var} isn't a Postgres connection string like the ones Supabase's Connect dialog shows")
    scheme, user, secret, host, got_port, database, _query = match.groups()
    ref = project_ref()
    problems = []
    if not host.endswith(".pooler.supabase.com"):
        problems.append(f"its host is {host}, not Supabase's shared pooler (*.pooler.supabase.com): "
                        "copy the pooler string, not the direct connection")
    if int(got_port) != port:
        problems.append(f"its port is {got_port}; the {mode} pooler uses {port}")
    if user != f"postgres.{ref}":
        problems.append(f"its user is {user}, not postgres.{ref} (the project in SUPABASE_URL)")
    if database != "postgres":
        problems.append(f"its database is {database}, not postgres")
    if problems:
        fail(f"{var}: " + "; ".join(problems))
    return {"var": var, "scheme": scheme, "user": user, "secret": secret, "host": host,
            "port": int(got_port), "database": database}


def address(mode):
    p = parts(mode)
    if p["secret"] == PLACEHOLDER:
        password = os.environ.get("SUPABASE_DB_PASSWORD", "")
        if not password:
            fail(f"{p['var']} has the password placeholder, but SUPABASE_DB_PASSWORD is not set")
        encoded = urllib.parse.quote(password, safe="")
    elif PLACEHOLDER in p["secret"]:
        fail(f"{p['var']}: the password placeholder is mixed with other text")
    else:
        encoded = p["secret"]  # a complete address: its password is already in it
    full = f"{p['scheme']}://{p['user']}:{encoded}@{p['host']}:{p['port']}/{p['database']}"
    return full, encoded, p


def main():
    args = sys.argv[1:]
    if args == ["check"]:
        for mode in MODES:
            _, _, p = address(mode)
            form = "dashboard form, password filled in from SUPABASE_DB_PASSWORD" \
                if p["secret"] == PLACEHOLDER else "complete address"
            print(f"{p['var']}: {mode} pooler {p['host']}:{p['port']}, user {p['user']}, "
                  f"database {p['database']} ({form})")
        return 0
    if len(args) >= 4 and args[0] == "run" and args[1] in MODES and args[2] == "--":
        full, encoded, _ = address(args[1])
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::add-mask::{encoded}", flush=True)
            print(f"::add-mask::{full}", flush=True)
        env = dict(os.environ, DATABASE_ADDRESS=full)
        os.execvpe(args[3], args[3:], env)
    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main())
