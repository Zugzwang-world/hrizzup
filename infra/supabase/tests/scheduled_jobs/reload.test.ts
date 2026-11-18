import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The reload after a push (infra/supabase/scheduled_jobs.py; docs/research/cron-missed-jobs.md), on
 * the real database and its real Supabase Cron: a job scheduled while a commit of about 10,000
 * cache messages goes through is never run, the check names it, and `reload` makes the scheduler
 * run it, as the Staging workflow's step 2c and the release pipeline's 4d do after a push.
 *
 * How the miss is made on purpose: the scheduler is parked on a lock (`cron.job_run_details`,
 * which it writes whenever a job starts), and a parked scheduler can't read PostgreSQL's
 * invalidation queue (4,096 messages). While it's parked, the test schedules two jobs and then
 * commits far more messages than the queue holds, so the scheduler is reset and, once it's
 * released, never learns of the jobs (pg_cron 1.6.4).
 *
 * That setup needs a fresh database, and the test refuses any other. Auto-analyze of `cron.job`
 * (at about 50 changes to it, the nearer trigger) and autovacuum (at about 51 dead rows) send the
 * scheduler an ordinary message about `cron.job`, which it reads and answers by loading every job,
 * the lost ones too: then the jobs run without any reload, and nothing is proved. A fresh database
 * stays well under: a whole run makes 37 changes and 27 dead rows, and neither runs. A database
 * reused across runs reaches them (3 spoiled runs in 79, all on one). So the test fails at once if
 * `cron.job` already has 25 changes or dead rows, and makes exactly one attempt: if the jobs have a
 * run before any reload, it fails with whether `cron.job`'s autovacuum or auto-analyze moved.
 *
 * It runs inside `@hrizzup/database#test:db`, which the markets', perps' and ledger's database
 * tests wait for (`dependsOn: ["^test:db"]`), and files run one after another (vitest.config.ts),
 * so nothing else uses this database meanwhile. It leaves every job as it found it, whatever
 * fails: `afterAll` releases the lock, drops what the test made and switches the jobs it paused
 * back on, each step on its own, from a connection of its own.
 */

const address = process.env.TEST_DATABASE_URL;
if (!address) {
  throw new Error('Run these through `infra/slots/slot db test` (or `pnpm test:db`)');
}
// The local database has no TLS; the script reads this the way the Staging workflow's address says verify-full.
const scriptAddress = (() => {
  const url = new URL(address);
  url.searchParams.set('sslmode', 'disable');
  return url.toString();
})();
const script = fileURLToPath(new URL('../../scheduled_jobs.py', import.meta.url));

/** `cron.job` changes or dead rows a fresh database stays under (autovacuum acts at about 50). */
const FRESH_LIMIT = 25;

const TICK = 'scheduled-jobs-test-tick';
const NEW = 'scheduled-jobs-test-new';
const FAILS = 'scheduled-jobs-test-fails';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function client(name: string) {
  return new pg.Client({
    connectionString: address,
    application_name: `scheduled-jobs-test-${name}`,
  });
}

/** Runs scheduled_jobs.py with the test database as its only address; what it printed, and how it ended. */
function runScript(...args: string[]) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    execFile(
      'python3',
      [script, ...args],
      { env: { ...process.env, DATABASE_ADDRESS: scriptAddress } },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : null) : 0;
        resolve({ code, out: `${stdout}${stderr}` });
      },
    );
  });
}

let admin: pg.Client;
let locker: pg.Client;
let overflower: pg.Client;
let lockHeld = false;
/** The jobs this test paused (the ones the connecting role owns that were active), to switch back on. */
const paused: number[] = [];

async function until(what: string, seconds: number, probe: () => Promise<boolean>) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error(`gave up waiting ${seconds} s: ${what}`);
    await sleep(250);
  }
}

async function runsOf(job: string) {
  const { rows } = await admin.query(
    `select count(*)::int as n, count(*) filter (where d.status = 'failed')::int as failed,
            count(*) filter (where d.command = j.command)::int as current
       from cron.job j join cron.job_run_details d using (jobid) where j.jobname = $1`,
    [job],
  );
  return rows[0] as { n: number; failed: number; current: number };
}

beforeAll(async () => {
  admin = client('admin');
  locker = client('lock');
  overflower = client('overflow');
  await Promise.all([admin.connect(), locker.connect(), overflower.connect()]);
});

afterAll(async () => {
  // Each step is tried whatever failed before it, from a connection of its own, and every
  // failure is reported at the end.
  const failures: string[] = [];
  const attempt = async (what: string, step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (error) {
      failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const cleaner = client('cleanup');
  await attempt('connect to clean up', () => cleaner.connect());
  // The lock first, so the scheduler can write again.
  if (lockHeld) await attempt('release the lock', () => locker.query('rollback'));
  await attempt("stop the overflower's transaction", () => overflower.query('rollback'));
  await attempt('unschedule the test jobs', () =>
    cleaner.query(
      `select cron.unschedule(jobid) from cron.job where jobname like 'scheduled-jobs-test-%'`,
    ),
  );
  await attempt('drop the test schema', () =>
    cleaner.query('drop schema if exists scheduled_jobs_test cascade'),
  );
  // Each paused job on its own, so one that's gone doesn't keep the others off.
  for (const id of paused) {
    await attempt(`switch job ${id} back on`, () =>
      cleaner.query(
        'select cron.alter_job(jobid, active := true) from cron.job where jobid = $1 and not active',
        [id],
      ),
    );
  }
  await attempt('close the connections', () =>
    Promise.all([admin?.end(), locker?.end(), overflower?.end(), cleaner.end()]),
  );
  if (failures.length > 0) {
    throw new Error(`the test couldn't put everything back:\n${failures.join('\n')}`);
  }
}, 60_000);

/** Pauses the jobs the role owns, so only this test's jobs run, and makes the first job. */
async function setUp() {
  const { rows } = await admin.query(
    'select jobid::int as id from cron.job where username = current_user and active order by jobid',
  );
  for (const { id } of rows as { id: number }[]) {
    paused.push(id);
    await admin.query('select cron.alter_job($1, active := false)', [id]);
  }
  await admin.query(`
    create schema scheduled_jobs_test;
    create function scheduled_jobs_test.f() returns void language sql as 'select 1';
    create function scheduled_jobs_test.fails() returns void language plpgsql
      as $$ begin raise exception 'scheduled jobs test: this job always fails'; end $$;
  `);
  await admin.query(
    `select cron.schedule('${TICK}', '1 seconds', 'select scheduled_jobs_test.f()')`,
  );
  await until('the first job to run once', 10, async () => (await runsOf(TICK)).n > 0);
}

/**
 * Parks the scheduler on a lock (it waits on it the next time it writes a run), schedules the two
 * jobs it must lose, commits about 10,000 invalidation messages (3,000 gave 6,000) while it's
 * parked, and lets it go. The queue holds 4,096, so the scheduler, which isn't reading it, is reset
 * and skips them all.
 */
async function loseTwoJobs() {
  await locker.query("set lock_timeout = '10s'");
  await locker.query('begin');
  await locker.query('lock table cron.job_run_details in share mode');
  lockHeld = true;
  await until('the scheduler to wait on the lock', 10, async () => {
    const { rowCount } = await admin.query(
      `select 1 from pg_locks where locktype = 'relation' and not granted
         and relation = 'cron.job_run_details'::regclass`,
    );
    return (rowCount ?? 0) > 0;
  });
  await overflower.query(
    `select cron.schedule('${NEW}', '1 seconds', $$select 'scheduled jobs test'$$)`,
  );
  await overflower.query(
    `select cron.schedule('${FAILS}', '1 seconds', $$select scheduled_jobs_test.fails()$$)`,
  );
  await overflower.query(`
    do $do$ begin
      for i in 1..5000 loop
        execute format('alter function scheduled_jobs_test.f() cost %s', i);
      end loop;
    end $do$;
  `);
  await locker.query('commit');
  lockHeld = false;
}

/** How many runs the two lost jobs have. */
async function lostRuns() {
  return (await runsOf(NEW)).n + (await runsOf(FAILS)).n;
}

/** What `cron.job` has had done to it, and what autovacuum and auto-analyze have done since. */
async function cronJobStats() {
  const { rows } = await admin.query(
    `select n_mod_since_analyze::int as changes, n_dead_tup::int as dead,
            autovacuum_count::int as vacuums, autoanalyze_count::int as analyzes
       from pg_stat_all_tables where schemaname = 'cron' and relname = 'job'`,
  );
  return rows[0] as { changes: number; dead: number; vacuums: number; analyzes: number };
}

/** Refuses a database that has been used: its `cron.job` would soon be vacuumed or analyzed. */
async function requireFreshDatabase() {
  const stats = await cronJobStats();
  if (stats.changes >= FRESH_LIMIT || stats.dead >= FRESH_LIMIT) {
    throw new Error(
      `cron.job already has ${stats.changes} changes and ${stats.dead} dead rows since it was last analyzed or vacuumed, and autovacuum or auto-analyze would soon reload the scheduler by itself and spoil this test: run it on a fresh database: infra/slots/slot db test`,
    );
  }
  return stats;
}

/** The two lost jobs must still have no run: the scheduler really lost them, and nothing reloaded it. */
async function requireStillLost(when: string, before: Awaited<ReturnType<typeof cronJobStats>>) {
  if ((await lostRuns()) === 0) return;
  await sleep(1500); // the statistics are flushed about once a second
  const now = await cronJobStats();
  const moved = now.vacuums !== before.vacuums || now.analyzes !== before.analyzes;
  throw new Error(
    `precondition: the scheduler loaded the jobs without a reload ${when}. cron.job's autovacuum_count went ${before.vacuums} to ${now.vacuums} and autoanalyze_count ${before.analyzes} to ${now.analyzes}: ${
      moved
        ? 'one of them moved during the test, so the database reloaded the scheduler itself: run it on a fresh database: infra/slots/slot db test'
        : "neither moved, so the overflow was too small or the scheduler wasn't parked: make the overflow bigger"
    }`,
  );
}

describe('the reload after a push', () => {
  it('makes the scheduler run a job it lost, and the check names the job until then', {
    timeout: 120_000,
    retry: 0,
  }, async () => {
    const before = await requireFreshDatabase();
    await setUp();

    // The scheduler loses the two jobs: they have no run four seconds on, and none when the check,
    // which takes another eight seconds, has finished.
    await loseTwoJobs();
    await sleep(4000);
    await requireStillLost('in the four seconds after it was released', before);

    // The check names what the scheduler hasn't loaded.
    const check = await runScript('check', 'local', '--wait', '8');
    await requireStillLost('during the check', before);
    expect(check.code, check.out).toBe(1);
    expect(check.out).toContain(`FAILED: local: ${NEW} (1 seconds) hasn't run`);
    expect(check.out).toContain(`FAILED: local: ${FAILS} (1 seconds) hasn't run`);
    expect(check.out).toContain('Run scheduled_jobs.py reload local.');
    expect(check.out).not.toContain(TICK);

    // The reload makes the scheduler load them: both run, as their jobs have them now. The one
    // that fails still counts as run: it's reported, not failed.
    const reload = await runScript('reload', 'local', '--wait', '40');
    expect(reload.code, reload.out).toBe(0);
    expect(reload.out).toContain('local: saved ');
    expect(reload.out).toContain(
      'local: every job that runs every minute or faster has run since the re-save',
    );
    expect(reload.out).toMatch(
      new RegExp(`local: ${FAILS}: [1-9]\\d* of its [1-9]\\d* runs since the re-save failed`),
    );
    const fresh = await runsOf(NEW);
    expect(fresh.n).toBeGreaterThan(0);
    expect(fresh.current).toBe(fresh.n);
    expect(fresh.failed).toBe(0);
    const failing = await runsOf(FAILS);
    expect(failing.failed).toBeGreaterThan(0);
    // A run still going when it's counted has no status yet: every other one failed.
    expect(failing.n - failing.failed).toBeLessThanOrEqual(1);
  });
});
