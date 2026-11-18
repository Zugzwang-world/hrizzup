# Supabase Cron missing new jobs after a big migration

> Relay R16, M1, 18 November 2026. Research only. Reproduced on a slot's local database, on Supabase's Postgres 17.11 image with pg_cron 1.6.4, pg_net 0.20.4 and background workers off, as on staging.

**In short:** a known pg_cron bug. A commit sending over 4,096 cache messages (social's sent 5,615) can make the scheduler skip them all, and pg_cron 1.6.4 then misses any job change among them. One small `cron.job` change after every push heals it.

## Cause

1. The scheduler keeps every job in memory and reloads them all when a `cron.job` change's commit message reaches it.
2. PostgreSQL's invalidation queue holds 4,096 messages ([`sinvaladt.c:130`](https://github.com/postgres/postgres/blob/REL_17_11/src/backend/storage/ipc/sinvaladt.c#L130)). A larger commit resets any backend that hasn't kept up (`:617`). That backend's next read skips everything unread (`:515–526`) and tells its callbacks "everything changed" (`InvalidOid`, `inval.c:748–752`).
3. pg_cron 1.6.4 reloads only for `cron.job`'s own ID: `if (relationId == CachedCronJobRelationId || CachedCronJobRelationId == InvalidOid)` ([`job_metadata.c:823`](https://github.com/citusdata/pg_cron/blob/v1.6.4/src/job_metadata.c#L823)). So it ignores the reset and keeps its old list until another `cron.job` change arrives. Upstream fixed this in 1.6.8 ([pg_cron#406](https://github.com/citusdata/pg_cron/pull/406)), but Supabase's images still ship 1.6.4.

`db push` runs each file as one transaction. Locally, social's commit sent 5,615 messages; no earlier migration sent more than 1,534.

## Evidence

- **The real migration:** on three fresh databases, `social-minute` never ran, while `perps-funding` ran every minute. Re-saving a different job made `social-minute` run at the next minute.
- **Trials:** each used a new 3-second job, judged 12 s after commit, with one scheduler process throughout. Above 4,096 messages the outcome is a race, so a push that worked before proves nothing.

| Committed | Job ran |
|---|---|
| schedule, in a commit of up to 3,901 messages | 15 of 15 |
| schedule, in a commit of 4,201 to 9,001 messages | 7 of 21 |
| schedule, then a 6,000-message commit straight after | 0 of 5 |
| the same, 2 s apart | 3 of 3 |
| 6,000-message commit, then a schedule straight after | 5 of 5 |
| the same, 2 s apart | 5 of 5 |

- **The reverse:** a command change inside a big commit was lost, and the old command kept running. A job unscheduled inside one kept running in 3 of 5 trials.

## Prevention

- **Re-saving in the same migration:** no, because it's the same commit.
- **A separate migration for the schedule:** timing-dependent in either order, so no guarantee. It's lost whenever an overflowing commit lands before the scheduler's next read (at most a second away). Placed after, it probably survived here because PostgreSQL's catch-up signal, sent to one backend at a time, woke the scheduler; a server with many idle connections, like staging, wasn't tested.
- **Keeping every commit under about 4,000 messages:** fragile.
- **pg_cron 1.6.8 or later:** fixes the cause, but only Supabase can ship it.

## The heal

- **When:** in its own transaction, at least 2 s after `db push` ends, after every push, unconditionally (a daily job's miss can't be seen in time), on staging and in the release pipeline.
- **What:** one `cron.alter_job(jobid, active := active)` on a job of the caller's own (filter `username = current_user`: on another role's job it errors and saves nothing). It reloads every job, of every owner and database (`task_states.c:82–111`); all 35 small clean-up changes in the trials were received. Locally, `postgres` can't `UPDATE cron.job`, and re-running `cron.schedule` or `pg_reload_conf()` also healed; staging's grants weren't checked.
- **Check:** a minute job's run alone passes even on a stale scheduler. Since `job_run_details.command` is the scheduler's own copy (`pg_cron.c:1320`), check that every job running each minute or faster has a run whose `command` equals its `cron.job.command`, and that nothing starting soon after the heal belongs to a job no longer in `cron.job`. The exact limits are in Design, rules 5 to 7.

## Design: the reload after every push (R16, M1)

**Decision.** A new script, `infra/supabase/scheduled_jobs.py`, runs right after the migrations in two places: the Staging workflow (step 2c) and the release pipeline (step 4d, releases only, using the copy from the workflow's own commit). It:
1. waits 5 s;
2. saves every job the connecting role owns again, unchanged, in one statement;
3. polls until every active job that runs every minute or faster has run as `cron.job` now has it, and no deleted or switched-off job still runs;
4. otherwise fails, naming the job.

**Rejected:**
- **Saving one job:** it heals just as well, but the founder asked for every job, and saving all of them costs nothing.
- **`UPDATE cron.job`:** locally, `postgres` has no grant for it, and it skips pg_cron's own checks.
- **`pg_reload_conf()`:** it reloads every backend's settings.
- **A re-save inside a migration, or a separate cron migration:** see above.
- **"Ran in the last 3 minutes"** (`social_setup.py check`): it passes even on a stale scheduler.
- **The released commit's copy of the script:** a commit from before M1 has none.
- **Retrying inside the step:** it would hide a scheduler that keeps losing changes.

### Rules for the builder

1. **Imports:** Python's standard library only. It imports `perps_jobs` (for `psql`, `fail` and `variables`), putting its own folder on `sys.path` the way `social_setup.py` does. `perps_jobs.py` and `social_setup.py` stay unchanged.
2. **Command line:** `scheduled_jobs.py reload|check staging|production|local [--wait SECONDS]`, where `--wait` defaults to 180 and must be 5 to 600.
   - Any other environment is refused before connecting.
   - A usage error exits 2, a failure 1 and a pass 0.
   - It connects only through `DATABASE_ADDRESS`. On staging and production that's set by `database_url.py run session --`; the local test sets it with `?sslmode=disable`.
3. **`reload`:**
   - Sleep 5 s.
   - Then one psql call holding three statements, each committed on its own:
     1. The re-save, in the shape `social_setup.py` already ran on staging. It answers `saved`, which counts rows, not calls; only the check proves the reload happened.
     2. A read-only line.
     3. `since`.
   - `check` sends only the last two, at its start.

   The three statements:
   ```sql
   select count(*) from cron.job j, lateral (select cron.alter_job(j.jobid, active := j.active)) s
   where j.username = current_user;
   select json_build_object('role', current_user, 'others', coalesce((select json_agg(coalesce(o.jobname,
     'job ' || o.jobid) order by o.jobid) from cron.job o where o.username <> current_user), '[]'::json))::text;
   select clock_timestamp()::text;
   ```
4. **`since`:** it must match `^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?[+-]\d\d(:\d\d)?$`. Pass it only as a psql variable (`perps_jobs.variables(since=...)`, read as `:'since'`).
5. **Polling:** every 5 s, and once more at the deadline (`--wait` seconds after `since`), run this query. It hasn't run yet; the real-database test below is its first run, so build and run that test first.
   ```sql
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
   ```
6. **What counts as "every minute or faster"** (`fast_seconds(schedule)`):
   - `^\s*(\d+)\s*seconds?\s*$`, in any case, with 1 to 59: that many seconds.
   - Exactly five whitespace-separated fields, each `*` or `*/1`: 60.
   - Anything else is never waited for.
7. **Pass or fail:** it passes at the first poll where every active fast job has `current ≥ 1`, `stale` is empty, and at least 20 s (or `--wait`, if shorter) have passed since `since`. At the deadline it fails otherwise. An answer that isn't this JSON fails ("gave no answer it could read"); it never passes.
8. **Output lines**, exactly. `{when}` is "the re-save" or "this check began". `{name}` is the job's name, or `job <id>`.
   - `{env}: saved {saved} scheduled jobs of {role} again, so Supabase Cron reloads them all`.
   - If other roles own jobs: `{env}: {k} jobs belong to other roles and weren't saved again (they reload with the rest): {names}`.
   - If the role owns none but other roles do: `FAILED: {env}: no scheduled job belongs to {role}, so none could be saved again to make Supabase Cron reload`.
   - If there are no jobs at all: `{env}: no scheduled jobs`, and it passes.
   - Pass: `{env}: every job that runs every minute or faster has run since {when}, as cron.job has it: {names} ({s} s)`, or `{env}: no active job runs every minute or faster, so there was no run to wait for`.
   - For information only: `{env}: {name}: {f} of its {n} runs since {when} failed`.
   - Never ran: `FAILED: {env}: {name} ({schedule}) hasn't run in the {wait} s since {when}: Supabase Cron hasn't loaded it (docs/research/cron-missed-jobs.md)`.
   - Ran only from an old copy: `FAILED: {env}: {name} ({schedule}) ran {n} times since {when}, never as cron.job has it now: Supabase Cron is still using an old copy (docs/research/cron-missed-jobs.md)`.
   - Stale: `FAILED: {env}: job {id} ({name}, or "no longer scheduled"; plus ", switched off" when inactive) started {n} runs more than 10 s after {when}: Supabase Cron is still using an old copy (docs/research/cron-missed-jobs.md)`.
   - In `check`, every failure line adds ` Run scheduled_jobs.py reload {env}.`
9. **`.github/workflows/staging.yml`**, after `2b.` and before `3.`; also add 2c to the header comment:
   ```yaml
         - name: 2c. Reload the scheduled jobs and check that they run
           env:
             PGSSLMODE: verify-full
             PGSSLROOTCERT: infra/supabase/supabase-root-2021-ca.crt
           run: python3 infra/supabase/database_url.py run session -- python3 infra/supabase/scheduled_jobs.py reload staging
   ```
10. **`.github/workflows/release.yml`:** two steps, and the header's step 4 gains 4d.
    - Right after "The key checks, from this workflow's own commit", this step. It's unnumbered, so the pinned test doesn't count it as changing production. The step's `PGSSLROOTCERT` overrides `perps_jobs`' default, so the two `.py` files are enough:
      ```yaml
            - name: The scheduled jobs' reload, from this workflow's own commit
              if: inputs.action == 'release'
              env:
                WORKFLOW_COMMIT: ${{ github.sha }}
              run: |
                set -euo pipefail
                mkdir -p "$RUNNER_TEMP/job-checks"
                git archive "$WORKFLOW_COMMIT" infra/supabase/scheduled_jobs.py infra/supabase/perps_jobs.py | tar -x -C "$RUNNER_TEMP/job-checks"
      ```
    - After `4c.` and before `5.`:
      ```yaml
            - name: 4d. Reload the scheduled jobs and check that they run
              if: inputs.action == 'release'
              env:
                PGSSLMODE: verify-full
                PGSSLROOTCERT: infra/supabase/supabase-root-2021-ca.crt
              run: python3 infra/supabase/database_url.py run session -- python3 "$RUNNER_TEMP/job-checks/infra/supabase/scheduled_jobs.py" reload production
      ```
11. **`turbo.json`:** add `"scheduled_jobs.py"` and `"perps_jobs.py"` to `test:db`'s inputs. Without them, the Database check's dry run reports a cache hit and skips the real-database test. Also mention the new test folder in `infra/supabase/vitest.config.ts`'s comment.
12. **Prove it on staging before the merge.** The first automatic 2c is the merge itself, and its failure would hold staging's site and block releases. So run this once by hand and put its output, which holds no secret, in the pull request:

    ```
    infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- python3 infra/supabase/scheduled_jobs.py reload staging
    ```

    `social_setup.py` has already used `cron.alter_job` and read `cron.job_run_details` there as `postgres`.
13. **Cost:**
    - On staging, 2c waits for the next minute boundary, so it adds about 25 s to 2 minutes to each run. Today's runs take about 1.5 minutes, against the job's 30-minute limit.
    - A failure adds a little over 3 minutes.
    - 4d costs each release the same.

### Edge cases

- **No fast job:** it passes after 20 s with its line.
- **No job at all:** it passes.
- **Only other roles' jobs:** it fails, because nothing could trigger the reload.
- **No `cron.job` table:** psql's error fails the step. Migrations always create it.
- **A fast job whose earlier run is still going at the deadline:** it fails, which is correct.
- **Row security hiding other roles' jobs:** they're neither saved nor checked, but the reload still covers them. Locally `postgres` bypasses row security; staging's grants weren't checked.
- **Another big commit within about a second of the re-save:** the check fails; re-run the workflow.
- **What the check can't see:** if a push changed only slower jobs and the re-save's own message were lost too, every fast job would still pass. That meets the founder's test, and nothing runs a big commit next to the re-save.
- **`cron.log_run` off:** every fast job "hasn't run", a loud failure.
- **psql older than 16:** `perps_jobs` refuses it; ubuntu-24.04 ships 16.
- **A rollback:** it skips 4d, since the database is unchanged.

### Tests

**Unit tests:** `infra/supabase/test_scheduled_jobs.py`, run by Quick checks, with fake `run`, `sleep` and `clock`:
1. **`fast_seconds`:**
   - Fast: `* * * * *`, `*/1 * * * *`, `5 seconds`, `1 second`, ` 59 SECONDS `.
   - Not fast: `0 * * * *`, `*/2 * * * *`, `* * * * 1-5`, `@hourly`, `60 seconds`, `0 seconds`, `23 3 * * *`.
2. **Targets and usage:**
   - Other environments are refused before any `run` call.
   - Bad arguments, and `--wait` outside 5 to 600, exit 2.
3. **Order:** `reload` sleeps 5 s before its first psql call, and that call holds exactly the three statements, in order. `check` never sends `alter_job`.
4. **Every decision, with its exact line:**
   - It passes on the poll where `current` reaches 1, and never before 20 s.
   - Never ran.
   - Ran only from an old copy.
   - Gone, and switched off, with stale runs.
   - No fast job, and no job at all.
   - Only other roles' jobs.
   - Failed runs are reported, but it still passes.
   - An unreadable answer fails, and so does a bad `since`.
5. **The workflows:**
   - `2c.` sits between `2b.` and `3.` and runs `reload staging`.
   - `4d.` is release-only, sits between `4c.` and `5.`, and runs the `$RUNNER_TEMP/job-checks` copy.
   - The extraction step uses `${{ github.sha }}`, names both files and comes before 4d.

**Real database:** `infra/supabase/tests/scheduled_jobs/reload.test.ts`, run by Vitest in `slot db test`. One test with a 120 s timeout, never retried. It's deterministic, confirmed 3 of 3 by hand, because a scheduler waiting on a lock can't read the queue.
1. Switch off the active jobs `postgres` owns, remembering which. Create `scheduled_jobs_test.f()` and schedule `scheduled-jobs-test-tick` (`1 seconds`). Wait up to 10 s for its first run.
2. Client A runs `begin; lock table cron.job_run_details in share mode`. Wait up to 10 s until `pg_locks` holds an ungranted `relation` lock on `cron.job_run_details`; that's the scheduler, parked. Use `pg_locks` because every role can read it in full, while `pg_stat_activity` may hide the scheduler's wait from `postgres`.
3. Client B schedules `scheduled-jobs-test-new` (`1 seconds`, `select 'scheduled jobs test'`). Then B runs one DO block that executes `alter function scheduled_jobs_test.f() cost <i>` 5,000 times, about 10,000 messages (3,000 gave 6,000). Then A commits.
4. Four seconds later, the new job must have no run. Otherwise the test fails with "precondition: the scheduler loaded the job without a reload: make the overflow bigger".
5. `check local --wait 8` exits 1 and prints `FAILED: local: scheduled-jobs-test-new (1 seconds) hasn't run`.
6. `reload local --wait 40` exits 0, and the new job has a run with its own command.
7. In `afterAll`: roll back A if it's still open, drop the schema, then unschedule the test jobs and switch the remembered jobs back on.

The test takes about 45 s. It runs inside `@hrizzup/database#test:db`. Markets', perps' and ledger's database tests use the same database, but run only after it (`dependsOn: ["^test:db"]`), so `afterAll` must leave everything as it found it.

### Docs, and the size label

- **Docs to update:**
  - The headers of `staging.yml` and `release.yml`.
  - `docs/setup/BLUEPRINT.md`: line 232 (staging) and line 259 (release step 4).
  - `docs/setup/RUNBOOK.md`: line 461 (R.3, part 4).
  - `docs/social/build.md`: line 584. The workflows now do this for every job; `social_setup.py`'s own re-save stays, and is harmless.
- **Size `[risky]`:** it changes the release pipeline and writes to production's `cron.job` at every release.
