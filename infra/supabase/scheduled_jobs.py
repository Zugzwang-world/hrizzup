#!/usr/bin/env python3
"""Makes Supabase Cron reload its scheduled jobs after a push, and checks that it did (R16, M1;
docs/research/cron-missed-jobs.md).

    infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- \\
        python3 infra/supabase/scheduled_jobs.py reload staging
    infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- \\
        python3 infra/supabase/scheduled_jobs.py check staging [--wait SECONDS]

The scheduler keeps every job in memory. A push whose commit sends over 4,096 cache messages (social's sent
5,615) can make it skip them all, and pg_cron 1.6.4 then misses any job change among them: a job that exists
but never runs, or runs its old command. One change to a `cron.job` row afterwards makes it reload every job,
of every owner and database. So the Staging workflow (step 2c) and the release pipeline (step 4d, from the
workflow's own commit) run `reload` right after the migrations.

`reload` waits 5 s, saves every job the connecting role owns again with its own state (`cron.alter_job`, a
change of nothing), then polls `cron.job_run_details` until every active job that runs every minute or
faster has run since the re-save with the command `cron.job` has now (a run of any status counts: the
question is whether the scheduler loaded the job, so a job whose runs fail is only reported), and nothing
has started soon after the re-save from a job that was deleted or switched off. Otherwise it fails, naming
the job. `check` does the same without the re-save, from now on. A job that runs less often can't be waited
for, so it isn't.

staging, production or local only; it connects only through DATABASE_ADDRESS (set by database_url.py run
session; a test sets it itself) and prints no value, only facts. Exit 0 passes, 1 fails, 2 is a usage error.
"""
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import perps_jobs  # noqa: E402  (the psql call, the failure and the variables: the same for every job's setup)

ENVIRONMENTS = ("staging", "production", "local")
DEFAULT_WAIT = 180
WAIT_LIMITS = (5, 600)
SETTLE = 5    # seconds `reload` waits for the push's last messages before it saves the jobs
POLL = 5      # seconds between looks at the runs
MINIMUM = 20  # seconds after the re-save before a check may pass: stale runs need time to show
NOTE = "docs/research/cron-missed-jobs.md"

# Every job the connecting role owns, saved again as it is (the shape social_setup.py ran on staging). It
# answers how many rows it saved, not how many reloads happened: only the check proves the reload.
RESAVE = """
select count(*) from cron.job j, lateral (select cron.alter_job(j.jobid, active := j.active)) s
where j.username = current_user;
"""

# Who we are, and the jobs of other roles, which can't be saved from here (they reload with the rest).
ROLES = """
select json_build_object('role', current_user, 'others', coalesce((select json_agg(coalesce(o.jobname,
  'job ' || o.jobid) order by o.jobid) from cron.job o where o.username <> current_user), '[]'::json))::text;
"""

# The database's own clock, committed on its own after the re-save: runs are counted from it.
SINCE = """
select clock_timestamp()::text;
"""

# Every job with its runs since the re-save, and the runs of jobs the scheduler should have forgotten.
# `current` counts the runs made with the command, database and role `cron.job` holds now, since
# job_run_details.command is the scheduler's own copy. `stale` lists a job that is no longer in cron.job or is
# switched off, but started a run more than 10 s after the re-save.
POLL_SQL = """
with recent as materialized (
  select jobid, command, database, username, status, start_time
  from cron.job_run_details where start_time > :'since'::timestamptz)
select json_build_object(
  'jobs', coalesce((select json_agg(json_build_object(
      'id', j.jobid, 'name', coalesce(j.jobname, 'job ' || j.jobid), 'schedule', j.schedule, 'active', j.active,
      'runs', (select count(*) from recent r where r.jobid = j.jobid),
      'current', (select count(*) from recent r where r.jobid = j.jobid and r.command = j.command
                  and r.database = j.database and r.username = j.username),
      'failed', (select count(*) from recent r where r.jobid = j.jobid and r.status = 'failed'))
    order by j.jobid) from cron.job j), '[]'::json),
  'stale', coalesce((select json_agg(json_build_object('id', s.jobid, 'name', j.jobname,
      'gone', j.jobid is null, 'runs', s.n) order by s.jobid)
    from (select jobid, count(*) n from recent
          where start_time > :'since'::timestamptz + interval '10 seconds' group by jobid) s
    left join cron.job j on j.jobid = s.jobid where j.jobid is null or not j.active), '[]'::json))::text;
"""

SINCE_FORMAT = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?[+-][0-9]{2}(:[0-9]{2})?")
SECONDS = re.compile(r"\s*([0-9]+)\s*seconds?\s*", re.IGNORECASE)
EVERY_MINUTE = ("*", "*/1")


def fast_seconds(schedule):
    """How often a schedule fires, in seconds, if it's every minute or faster, else None: `1 second` to
    `59 seconds` (pg_cron's own form), or five fields that are each `*` or `*/1` (every minute). Anything
    else is never waited for."""
    found = SECONDS.fullmatch(schedule)
    if found:
        seconds = int(found.group(1))
        return seconds if 1 <= seconds <= 59 else None
    fields = schedule.split()
    if len(fields) == 5 and all(field in EVERY_MINUTE for field in fields):
        return 60
    return None


def usage():
    print(__doc__.strip().splitlines()[0])
    print(f"usage: scheduled_jobs.py reload|check {'|'.join(ENVIRONMENTS)} [--wait SECONDS]  "
          f"(SECONDS {WAIT_LIMITS[0]} to {WAIT_LIMITS[1]}, default {DEFAULT_WAIT})")
    return 2


def parse(argv):
    """(command, environment, wait), or None when the arguments aren't one of the usages above."""
    words = list(argv)
    wait = DEFAULT_WAIT
    if len(words) == 4 and words[2] == "--wait":
        if not re.fullmatch(r"[0-9]{1,4}", words[3]):
            return None
        wait = int(words[3])
        words = words[:2]
        if not WAIT_LIMITS[0] <= wait <= WAIT_LIMITS[1]:
            return None
    if len(words) != 2 or words[0] not in ("reload", "check") or words[1] not in ENVIRONMENTS:
        return None
    return words[0], words[1], wait


def lines_of(answer):
    return [line.strip() for line in answer.splitlines() if line.strip()]


def unreadable(environment, what):
    print(f"FAILED: {environment}: {what} gave no answer it could read")
    return 1


def read_opening(answer, count):
    """The opening call's answer as (saved or None, role, others, since), or None when it isn't what was
    asked for: `count` lines, ending with the role's line and the time."""
    lines = lines_of(answer)
    if len(lines) != count:
        return None
    saved = None
    if count == 3:
        if not re.fullmatch(r"[0-9]+", lines[0]):
            return None
        saved = int(lines[0])
    try:
        who = json.loads(lines[-2])
    except ValueError:
        return None
    if (not isinstance(who, dict) or not isinstance(who.get("role"), str) or not isinstance(who.get("others"), list)
            or not all(isinstance(name, str) for name in who["others"])):
        return None
    if not SINCE_FORMAT.fullmatch(lines[-1]):
        return None
    return saved, who["role"], who["others"], lines[-1]


JOB_FIELDS = {"id": int, "name": str, "schedule": str, "active": bool, "runs": int, "current": int, "failed": int}
STALE_FIELDS = {"id": int, "gone": bool, "runs": int}


def typed(item, fields):
    return isinstance(item, dict) and all(
        name in item and isinstance(item[name], kind) and (kind is bool or not isinstance(item[name], bool))
        for name, kind in fields.items())


def read_poll(answer):
    """The poll's answer as (jobs, stale), or None when it isn't the JSON it should be."""
    lines = lines_of(answer)
    if len(lines) != 1:
        return None
    try:
        found = json.loads(lines[0])
    except ValueError:
        return None
    if not isinstance(found, dict) or not isinstance(found.get("jobs"), list) or not isinstance(found.get("stale"), list):
        return None
    if not all(typed(job, JOB_FIELDS) for job in found["jobs"]):
        return None
    if not all(typed(item, STALE_FIELDS) and isinstance(item.get("name"), (str, type(None))) for item in found["stale"]):
        return None
    return found["jobs"], found["stale"]


def fast(job):
    return job["active"] and fast_seconds(job["schedule"]) is not None


def problems(environment, jobs, stale, wait, when, hint):
    """What is still wrong at this poll, each as the line to print: an active fast job that never ran, or
    ran only from an old copy of its command, and a job the scheduler should have forgotten that still ran."""
    found = []
    for job in jobs:
        if not fast(job) or job["current"] >= 1:
            continue
        who = f"{job['name']} ({job['schedule']})"
        if job["runs"] == 0:
            found.append(f"FAILED: {environment}: {who} hasn't run in the {wait} s since {when}: "
                         f"Supabase Cron hasn't loaded it ({NOTE}){hint}")
        else:
            found.append(f"FAILED: {environment}: {who} ran {job['runs']} times since {when}, never as cron.job has it "
                         f"now: Supabase Cron is still using an old copy ({NOTE}){hint}")
    for item in stale:
        if item["gone"]:
            who = "no longer scheduled"
        else:
            who = f"{item.get('name')}, switched off" if item.get("name") else "switched off"
        found.append(f"FAILED: {environment}: job {item['id']} ({who}) started {item['runs']} runs more than 10 s "
                     f"after {when}: Supabase Cron is still using an old copy ({NOTE}){hint}")
    return found


def poll_until_done(environment, command, since, wait, run, sleep, clock):
    """Looks at the runs every POLL seconds and once more at the deadline, `wait` seconds after `since`
    was read. Passes at the first look where nothing is wrong and MINIMUM seconds (or `wait`, if shorter)
    have passed; at the deadline it fails otherwise."""
    when = "the re-save" if command == "reload" else "this check began"
    hint = f" Run scheduled_jobs.py reload {environment}." if command == "check" else ""
    started = clock()
    looks = list(range(0, wait, POLL)) + [wait]
    for at in looks:
        waited = at - (clock() - started)
        if waited > 0:
            sleep(waited)
        elapsed = clock() - started
        read = read_poll(perps_jobs.psql(perps_jobs.variables(since=since) + POLL_SQL, run))
        if read is None:
            return unreadable(environment, "the look at cron.job_run_details")
        jobs, stale = read
        wrong = problems(environment, jobs, stale, wait, when, hint)
        done = at == wait
        if not (done or (not wrong and elapsed >= min(MINIMUM, wait))):
            continue
        # A run that failed still started: the scheduler loaded the job. Its failure is another job's own
        # trouble, so it's said here and never stops anyone's deploy.
        for job in jobs:
            if job["failed"] > 0:
                print(f"{environment}: {job['name']}: {job['failed']} of its {job['runs']} runs since {when} failed")
        if wrong:
            print("\n".join(wrong))
            return 1
        if not jobs:
            print(f"{environment}: no scheduled jobs")
        elif any(fast(job) for job in jobs):
            names = ", ".join(job["name"] for job in jobs if fast(job))
            print(f"{environment}: every job that runs every minute or faster has run since {when}, as cron.job "
                  f"has it: {names} ({round(elapsed)} s)")
        else:
            print(f"{environment}: no active job runs every minute or faster, so there was no run to wait for")
        return 0
    return 1  # not reached: the last look is the deadline


def main(argv, run=subprocess.run, sleep=time.sleep, clock=time.monotonic):
    parsed = parse(argv)
    if parsed is None:
        return usage()
    command, environment, wait = parsed
    if command == "reload":
        sleep(SETTLE)
        opened = read_opening(perps_jobs.psql(RESAVE + ROLES + SINCE, run), 3)
        if opened is None:
            return unreadable(environment, "the re-save")
        saved, role, others, since = opened
        if saved:
            print(f"{environment}: saved {saved} scheduled jobs of {role} again, so Supabase Cron reloads them all")
        if others:
            print(f"{environment}: {len(others)} jobs belong to other roles and weren't saved again "
                  f"(they reload with the rest): {', '.join(others)}")
        if not saved and others:
            print(f"FAILED: {environment}: no scheduled job belongs to {role}, so none could be saved again to make "
                  "Supabase Cron reload")
            return 1
        if not saved:
            print(f"{environment}: no scheduled jobs")
            return 0
    else:
        opened = read_opening(perps_jobs.psql(ROLES + SINCE, run), 2)
        if opened is None:
            return unreadable(environment, "the clock")
        since = opened[3]
    return poll_until_done(environment, command, since, wait, run, sleep, clock)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
