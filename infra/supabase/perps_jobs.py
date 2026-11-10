#!/usr/bin/env python3
"""Where each environment's database calls for the perp's scheduled jobs, and the secret it carries
(PLAN.md step 3.4a; migrations/*_perp_jobs.sql).

    infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- \\
        python3 infra/supabase/perps_jobs.py apply staging
    infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- \\
        python3 infra/supabase/perps_jobs.py check staging

Supabase Cron runs the jobs inside the database, which calls the website's jobs address through
pg_net with a bearer secret. Both are the environment's own, so they live in Supabase Vault
(`perps_jobs_url`, `perps_jobs_secret`), never in a migration: the address below, the secret from
Doppler's PERP_JOBS_SECRET (the website checks the same one, read trimmed as it's written here).

`apply` puts them in Vault, replacing what's there, the secret sent only as a bound parameter
(psql's `\\bind`), so it is never part of any statement's text, which the database would log if
the statement failed. `check` compares the address, and the secret by its SHA-256 worked out here
(the secret itself never sent), and reports how pg_net's calls of the last 10 minutes were answered
(only the perp's jobs use pg_net): any answer but 200 fails it, so a schedule that runs but whose
calls fail can't go unseen. Nothing here prints a value: only facts.

Production's are set by the release pipeline once its perp is switched on (runbook, pre-launch
checklist); until then its database calls nothing, and its perp can't be switched on. This Mac and
the checks' fresh databases have none, so their schedules call nothing either.
"""
import hashlib
import os
import re
import subprocess
import sys
import urllib.parse

ADDRESSES = {"staging": "https://staging.hrizzup.com/api/jobs/perps"}
SECRET = re.compile(r"^[A-Za-z0-9_-]{32,}$")  # what the website accepts: at least 32 characters
ROOT_CERT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "supabase-root-2021-ca.crt")
RECENT = "10 minutes"


def fail(message):
    sys.exit(f"FAILED: {message}")


def connection(address):
    """The address (from database_url.py) as libpq's own variables, so neither it nor its password
    is ever on a command line."""
    parts = urllib.parse.urlsplit(address)
    if parts.scheme not in ("postgres", "postgresql") or not parts.hostname:
        fail("DATABASE_ADDRESS is not a Postgres address")
    env = {
        "PGHOST": parts.hostname,
        "PGPORT": str(parts.port or 5432),
        "PGUSER": urllib.parse.unquote(parts.username or ""),
        "PGPASSWORD": urllib.parse.unquote(parts.password or ""),
        "PGDATABASE": urllib.parse.unquote(parts.path.lstrip("/")) or "postgres",
    }
    mode = urllib.parse.parse_qs(parts.query).get("sslmode")
    if mode:
        env["PGSSLMODE"] = mode[-1]
    return env


def psql_major(run=subprocess.run):
    """psql's major version: `\\bind` needs 16 or later."""
    found = re.search(r"(\d+)(?:\.\d+)?", run(["psql", "--version"], capture_output=True, text=True).stdout)
    return int(found.group(1)) if found else 0


def psql(sql, run=subprocess.run):
    """Runs SQL on the database in DATABASE_ADDRESS (from database_url.py), given on psql's input.
    Returns the output."""
    address = os.environ.get("DATABASE_ADDRESS", "")
    if not address:
        fail("DATABASE_ADDRESS is not set: run this through infra/supabase/database_url.py run session")
    if psql_major(run) < 16:
        fail("psql 16 or later is needed (for \\bind)")
    env = {k: v for k, v in os.environ.items() if k != "DATABASE_ADDRESS"}
    env.update(connection(address))
    env.setdefault("PGSSLMODE", "verify-full")
    env.setdefault("PGSSLROOTCERT", ROOT_CERT)
    result = run(["psql", "--no-psqlrc", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
                 input=sql, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        # The server's message names the statement, whose text holds no value: they're bound.
        fail(f"psql failed (exit {result.returncode}): {result.stderr.strip().splitlines()[-1:]}")
    return result.stdout


def values(environment):
    if environment not in ADDRESSES:
        fail(f"the jobs are set here only for {', '.join(ADDRESSES)}; production's by the release pipeline")
    secret = os.environ.get("PERP_JOBS_SECRET", "").strip()
    if not SECRET.match(secret):
        fail("PERP_JOBS_SECRET is missing, or not at least 32 letters, digits, - or _ (Doppler stg)")
    return ADDRESSES[environment], secret


def variables(**named):
    """psql variables, on psql's input only (never a command line), each used through `\\bind`,
    unquoted: each is a plain word (the address, the secret's letters and digits, a hex digest)."""
    return "".join(f"\\set {name} '{value}'\n" for name, value in named.items())


APPLY = """
select vault.update_secret(s.id, $1) from vault.secrets s where s.name = 'perps_jobs_url' \\bind :url \\g
select vault.create_secret($1, 'perps_jobs_url', 'Where the perp''s scheduled jobs call (infra/supabase/perps_jobs.py)') where not exists (select 1 from vault.secrets where name = 'perps_jobs_url') \\bind :url \\g
select vault.update_secret(s.id, $1) from vault.secrets s where s.name = 'perps_jobs_secret' \\bind :secret \\g
select vault.create_secret($1, 'perps_jobs_secret', 'The secret the perp''s scheduled jobs carry (infra/supabase/perps_jobs.py)') where not exists (select 1 from vault.secrets where name = 'perps_jobs_secret') \\bind :secret \\g
"""

CHECK = f"""
select coalesce((select decrypted_secret = $1 from vault.decrypted_secrets where name = 'perps_jobs_url'), false)::text
       || ' ' ||
       coalesce((select encode(sha256(convert_to(btrim(decrypted_secret), 'UTF8')), 'hex') = $2
                 from vault.decrypted_secrets where name = 'perps_jobs_secret'), false)::text \\bind :url :secret_sha256 \\g
select count(*) filter (where status_code = 200) || ' ' || count(*) filter (where status_code is distinct from 200)
       || ' ' || coalesce(string_agg(distinct coalesce(status_code::text, 'none'), ',') filter (where status_code is distinct from 200), '-')
from net._http_response where created > now() - interval '{RECENT}';
"""


def report(environment, answer):
    lines = [line for line in answer.strip().splitlines() if line.strip()]
    url_ok, secret_ok = ((lines[0].split() if lines else []) + ["false", "false"])[:2]
    ok, bad, statuses = ((lines[1].split() if len(lines) > 1 else []) + ["0", "0", "-"])[:3]
    code = 0
    if url_ok == "true" and secret_ok == "true":
        print(f"{environment}: Vault holds the jobs' address and secret, and both match")
    else:
        print(f"FAILED: {environment}: the jobs' address {'matches' if url_ok == 'true' else 'is missing or differs'}, "
              f"the secret {'matches' if secret_ok == 'true' else 'is missing or differs'}")
        code = 1
    if bad != "0":
        print(f"FAILED: {environment}: in the last {RECENT}, pg_net's calls were answered 200 {ok} times "
              f"and otherwise {bad} times (answered {statuses})")
        code = 1
    else:
        print(f"{environment}: in the last {RECENT}, pg_net's calls were answered 200 {ok} times, and never otherwise")
    return code


def main(argv, run=subprocess.run):
    if len(argv) != 2 or argv[0] not in ("apply", "check"):
        print(__doc__.strip().splitlines()[0])
        print("usage: perps_jobs.py apply|check staging")
        return 2
    command, environment = argv
    url, secret = values(environment)
    if command == "apply":
        psql(variables(url=url, secret=secret) + APPLY, run)
    digest = hashlib.sha256(secret.encode()).hexdigest()
    return report(environment, psql(variables(url=url, secret_sha256=digest) + CHECK, run))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
