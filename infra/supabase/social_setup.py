#!/usr/bin/env python3
"""What staging's database holds for social that no migration can: whether test stories are allowed, and where its
scheduled minute job calls and with what secret (PLAN.md step 2.8; docs/social/build.md, D4 and section 7.2;
migrations/*_social.sql).

    infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- \\
        python3 infra/supabase/social_setup.py apply staging
    infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- \\
        python3 infra/supabase/social_setup.py apply staging --jobs
    infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- \\
        python3 infra/supabase/social_setup.py check staging [--jobs]

`apply staging` turns on `social.environment.test_stories`, so the console may save test stories there (false
everywhere else, forever on production: every migration also runs there, so the setting can't live in one). It
sends no secret. `apply staging --jobs` also puts the jobs' address and secret in Supabase Vault
(`social_jobs_url`, `social_jobs_secret`; the secret from Doppler's SOCIAL_JOBS_SECRET, read trimmed as it is
written here, the website checks the same one), where `social._call_job` reads them: until then the minute
schedule calls nothing, so no call can fail. The secret goes only as a bound parameter (psql's `\\bind`), so
it is never part of any statement's text, which the database would log if the statement failed.

`check staging` reads the flag back; with `--jobs` it also compares the address, and the secret by its SHA-256
worked out here (the secret itself never sent), and reports how pg_net's calls of the last 10 minutes were
answered (the perp's jobs share pg_net, so this counts theirs too): any answer but 200 fails it. Nothing here
prints a value: only facts.

Staging only: every other target is refused. Production's are set by the release pipeline at launch (runbook,
pre-launch checklist); this Mac's and the checks' databases keep the flag off (a test turns it on inside its
own transaction), so their schedules call nothing and the console refuses test stories there.
"""
import hashlib
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import perps_jobs  # noqa: E402  (the connection, the psql call and the variables: the same for every job's setup)

ADDRESSES = {"staging": "https://staging.hrizzup.com/api/jobs/social"}
SECRET = re.compile(r"^[A-Za-z0-9_-]{32,}$")  # what the website accepts: at least 32 characters
RECENT = perps_jobs.RECENT

FLAG_ON = "update social.environment set test_stories = true;\n"
FLAG = "select (select test_stories from social.environment)::text;\n"

APPLY_JOBS = """
select vault.update_secret(s.id, $1) from vault.secrets s where s.name = 'social_jobs_url' \\bind :url \\g
select vault.create_secret($1, 'social_jobs_url', 'Where the social minute job calls (infra/supabase/social_setup.py)') where not exists (select 1 from vault.secrets where name = 'social_jobs_url') \\bind :url \\g
select vault.update_secret(s.id, $1) from vault.secrets s where s.name = 'social_jobs_secret' \\bind :secret \\g
select vault.create_secret($1, 'social_jobs_secret', 'The secret the social minute job carries (infra/supabase/social_setup.py)') where not exists (select 1 from vault.secrets where name = 'social_jobs_secret') \\bind :secret \\g
"""

CHECK_JOBS = f"""
select coalesce((select decrypted_secret = $1 from vault.decrypted_secrets where name = 'social_jobs_url'), false)::text
       || ' ' ||
       coalesce((select encode(sha256(convert_to(btrim(decrypted_secret), 'UTF8')), 'hex') = $2
                 from vault.decrypted_secrets where name = 'social_jobs_secret'), false)::text \\bind :url :secret_sha256 \\g
select count(*) filter (where status_code = 200) || ' ' || count(*) filter (where status_code is distinct from 200)
       || ' ' || coalesce(string_agg(distinct coalesce(status_code::text, 'none'), ',') filter (where status_code is distinct from 200), '-')
from net._http_response where created > now() - interval '{RECENT}';
"""


def refuse_other_targets(environment):
    if environment not in ADDRESSES:
        perps_jobs.fail(
            f"social's setup is run here only for {', '.join(ADDRESSES)}; production's by the release pipeline, "
            "and this Mac's and the checks' databases keep test stories off")


def jobs_values(environment):
    """The jobs' address and secret for `environment`, which must be staging."""
    refuse_other_targets(environment)
    secret = os.environ.get("SOCIAL_JOBS_SECRET", "").strip()
    if not SECRET.match(secret):
        perps_jobs.fail("SOCIAL_JOBS_SECRET is missing, or not at least 32 letters, digits, - or _ (Doppler stg)")
    return ADDRESSES[environment], secret


def report_flag(environment, answer):
    on = answer.strip().splitlines()[-1:] == ["true"]
    if on:
        print(f"{environment}: test stories are on")
        return 0
    print(f"FAILED: {environment}: test stories are off (run social_setup.py apply {environment})")
    return 1


def report_jobs(environment, answer):
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
    jobs = "--jobs" in argv
    words = [a for a in argv if a != "--jobs"]
    if len(words) != 2 or words[0] not in ("apply", "check"):
        print(__doc__.strip().splitlines()[0])
        print("usage: social_setup.py apply|check staging [--jobs]")
        return 2
    command, environment = words
    refuse_other_targets(environment)
    code = 0
    if command == "apply":
        perps_jobs.psql(FLAG_ON, run)
        if jobs:
            url, secret = jobs_values(environment)
            perps_jobs.psql(perps_jobs.variables(url=url, secret=secret) + APPLY_JOBS, run)
    code |= report_flag(environment, perps_jobs.psql(FLAG, run))
    if jobs:
        url, secret = jobs_values(environment)
        digest = hashlib.sha256(secret.encode()).hexdigest()
        code |= report_jobs(environment, perps_jobs.psql(perps_jobs.variables(url=url, secret_sha256=digest) + CHECK_JOBS, run))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
