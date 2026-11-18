import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEADLINE_MS, FRAME, STORIES } from '@/lib/social/jobs/budget.ts';

/**
 * Social's jobs address (route.ts), as Supabase Cron calls it (docs/social/build.md, 7.2; R5's design
 * note, M2 rules 2 to 5, 10): only with this environment's secret, and to anyone else exactly as an
 * address the site doesn't have; the job names; the counts body; and what each outcome of a run answers
 * (busy, ran, a failed step, a run past the deadline, a lease that can't be taken), never kept and never
 * with an error's text. The jobs' own work is stood in for (`minute.test.ts`, `steps.test.ts`).
 */

const runMinute = vi.fn();
const runCounts = vi.fn();
const runSkills = vi.fn();
const waitUntil = vi.fn();
let databaseHere = true;

/** What the transaction under the door's own `run` sets up: its limits, from `set_config`'s values. */
const setUp: unknown[][] = [];
const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text.startsWith('select set_config')) setUp.push(values ?? []);
    return { rows: [{ answer: 'in the database' }] };
  }),
  release: vi.fn(),
};
const pool = { connect: vi.fn(async () => client) };

vi.mock('@/lib/db.ts', () => ({ database: () => (databaseHere ? pool : null) }));
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  waitUntil: (promise: Promise<unknown>) => waitUntil(promise),
}));
vi.mock('@/lib/social/jobs/minute.ts', () => ({
  runMinute: (...args: unknown[]) => runMinute(...args),
}));
vi.mock('@/lib/social/jobs/counts.ts', () => ({
  runCounts: (...args: unknown[]) => runCounts(...args),
}));
vi.mock('@/lib/social/jobs/skills.ts', () => ({
  runSkills: (...args: unknown[]) => runSkills(...args),
}));

const route = await import('./route.ts');
const { POST } = route;

/** Plainly not a key: the Secret check (gitleaks) scans every branch for anything key-like. */
const SECRET = 'test-secret-only-for-the-jobs-tests-x';
const AUTH = { authorization: `Bearer ${SECRET}` };
const RUN_ID = '01a1e7ff-0000-7a1b-9c2d-3e4f5a6b7c8d';
const RAN = { ran: true, ok: true, runId: RUN_ID, steps: { stories: { counts: { stories: 1 } } } };
const NOT_FOUND = { defined: false, code: 'NOT_FOUND', status: 404, message: 'No such call' };
const ID = '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e0f';

async function post(query: string, headers: Record<string, string> = AUTH, body?: string) {
  const response = await POST(
    new Request(`https://staging.hrizzup.com/api/jobs/social${query}`, {
      method: 'POST',
      headers,
      ...(body === undefined ? {} : { body }),
    }),
  );
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: (await response.json()) as Record<string, unknown>,
  };
}

beforeEach(() => {
  vi.stubEnv('SOCIAL_JOBS_SECRET', SECRET);
  databaseHere = true;
  runMinute.mockResolvedValue(RAN);
  runCounts.mockResolvedValue(null);
  runSkills.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  setUp.length = 0;
});

describe('the door', () => {
  it('runs the minute job for the database, with its secret, never kept and never indexed', async () => {
    const ran = await post('?job=minute');
    expect(ran).toMatchObject({ status: 200, body: RAN });
    expect(ran.headers['cache-control']).toBe('private, no-store');
    expect(ran.headers['x-robots-tag']).toBe('noindex');
    expect(runMinute).toHaveBeenCalledOnce();
  });

  it('answers anyone without the secret exactly as an address the site does not have', async () => {
    const answers = [
      await post('?job=minute', {}),
      await post('?job=minute', { authorization: 'Bearer wrong' }),
      await post('?job=minute', { authorization: SECRET }),
      await post('?job=minute', { authorization: `Bearer ${SECRET}x` }),
      await post('?job=nothing', {}),
      await post('', {}),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(answer.body).toEqual(NOT_FOUND);
      expect(answer.headers['cache-control']).toBe('private, no-store');
      expect(answer.headers['x-robots-tag']).toBe('noindex');
    }
    expect(runMinute).not.toHaveBeenCalled();
  });

  it('runs nothing where no secret is set, or one too short to be ours', async () => {
    for (const secret of ['', 'short']) {
      vi.stubEnv('SOCIAL_JOBS_SECRET', secret);
      expect((await post('?job=minute', { authorization: `Bearer ${secret}` })).status).toBe(404);
    }
    vi.stubEnv('SOCIAL_JOBS_SECRET', undefined);
    expect((await post('?job=minute', { authorization: 'Bearer undefined' })).status).toBe(404);
    expect(runMinute).not.toHaveBeenCalled();
  });

  it('reads the secret trimmed, as the database’s copy is written', async () => {
    vi.stubEnv('SOCIAL_JOBS_SECRET', `${SECRET}\n`);
    expect((await post('?job=minute')).status).toBe(200);
  });

  it('answers every other method as a call without the secret', async () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const handler = route[method] as () => Promise<Response>;
      const answer = await handler();
      expect(answer.status, method).toBe(404);
      expect(answer.headers.get('cache-control'), method).toBe('private, no-store');
    }
    expect(runMinute).not.toHaveBeenCalled();
  });

  it('answers "No such call" where social is off (production), whatever the call carries', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    const answer = await post('?job=minute');
    expect(answer).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(runMinute).not.toHaveBeenCalled();
  });

  it('refuses a job it does not have, before it reads the database, and says when the database is not set up', async () => {
    for (const query of ['?job=settle', '?job=', '', '?job=Minute']) {
      const answer = await post(query);
      expect(answer.status, query).toBe(400);
      expect(answer.body.code).toBe('BAD_REQUEST');
    }
    databaseHere = false;
    expect((await post('?job=minute')).status).toBe(503);
    expect(runMinute).not.toHaveBeenCalled();
  });

  it('hands the job a database that limits every call: the lease’s the frame’s, a step’s own winning, and no 30 seconds', async () => {
    await post('?job=minute');
    const given = runMinute.mock.calls[0]?.[0] as {
      run: (work: (tx: unknown) => Promise<unknown>, limits?: object) => Promise<unknown>;
    };
    await expect(given.run(async () => 'begin')).resolves.toBe('begin');
    await given.run(async () => 'stories', STORIES);
    // `set_config`'s values: role, claims, sub, lock_timeout, statement_timeout, key.
    expect(setUp.map((values) => [values[3], values[4]])).toEqual([
      [`${FRAME.lockTimeoutMs}ms`, `${FRAME.statementTimeoutMs}ms`],
      [`${STORIES.lockTimeoutMs}ms`, `${STORIES.statementTimeoutMs}ms`],
    ]);
    expect(setUp.every((values) => values[4] !== '30000ms')).toBe(true);
  });
});

describe('the minute job’s outcomes', () => {
  it('answers 200 when another run holds the lease', async () => {
    runMinute.mockResolvedValue({ ran: false, busy: true });
    expect(await post('?job=minute')).toMatchObject({
      status: 200,
      body: { ran: false, busy: true },
    });
  });

  it('answers 500, naming the failed step, when one failed, so pg_net’s record of the call shows it', async () => {
    runMinute.mockResolvedValue({
      ran: true,
      ok: false,
      runId: RUN_ID,
      failed: 'recount',
      steps: { stories: {}, counts: {}, recount: { failed: true } },
    });
    const failed = await post('?job=minute');
    expect(failed.status).toBe(500);
    expect(failed.body).toMatchObject({ ran: true, ok: false, failed: 'recount' });
    expect(failed.headers['cache-control']).toBe('private, no-store');
  });

  it('answers 500 `late` at the deadline when the run has not finished, and leaves the run to finish under waitUntil', async () => {
    vi.useFakeTimers();
    let finish: (answer: unknown) => void = () => {};
    runMinute.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const pending = post('?job=minute');
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(waitUntil).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    const late = await pending;
    expect(late).toMatchObject({ status: 500, body: { ran: true, ok: false, late: true } });
    // The run was given to waitUntil, and finishes after the answer went (it still closes its lease).
    const kept = waitUntil.mock.calls[0]?.[0] as Promise<unknown>;
    finish(RAN);
    await expect(kept).resolves.toEqual({ done: RAN });
  });

  it('does not wait for the deadline when the run finishes first, and clears its timer', async () => {
    vi.useFakeTimers();
    await post('?job=minute');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers 500 with one plain message when the lease cannot be taken or closed, logging the error’s name and code only', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runMinute.mockRejectedValue(
      Object.assign(new TypeError('secret text of a database error'), { code: '57014' }),
    );
    const broken = await post('?job=minute');
    expect(broken.status).toBe(500);
    expect(broken.body).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The run could not take or close its lease',
    });
    expect(JSON.stringify(broken)).not.toContain('secret text');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret text');
    expect(JSON.stringify(log.mock.calls)).toContain('57014');
    expect(JSON.stringify(log.mock.calls)).toContain('TypeError');
  });

  it('logs a run that throws after the deadline passed, and has no unhandled rejection', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail: (error: unknown) => void = () => {};
    runMinute.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const pending = post('?job=minute');
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    expect((await pending).body).toMatchObject({ late: true });
    fail(Object.assign(new Error('text that must not be logged'), { code: '08006' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.stringify(log.mock.calls)).toContain('08006');
    expect(JSON.stringify(log.mock.calls)).not.toContain('text that must not be logged');
  });
});

describe('the other two jobs', () => {
  it('answer "No such call" until they are built (the stubs answer null)', async () => {
    expect(await post('?job=skills')).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(await post('?job=counts', AUTH, '{}')).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(runSkills).toHaveBeenCalledOnce();
    expect(runCounts).toHaveBeenCalledOnce();
  });

  it('answer 200 when busy or ran, and 500 when a run did not go through', async () => {
    runSkills.mockResolvedValue({ ran: false, busy: true });
    expect((await post('?job=skills')).status).toBe(200);
    runSkills.mockResolvedValue({ ran: true, ok: true, summary: { added: 1 } });
    expect(await post('?job=skills')).toMatchObject({ status: 200, body: { ran: true, ok: true } });
    runSkills.mockResolvedValue({ ran: true, ok: false, summary: {} });
    expect((await post('?job=skills')).status).toBe(500);
    runCounts.mockResolvedValue({ ran: false, busy: true });
    expect((await post('?job=counts', AUTH, '{}')).status).toBe(200);
    runCounts.mockResolvedValue({
      ran: true,
      ok: true,
      ids: { stories: [ID], posts: [], agents: [] },
    });
    expect((await post('?job=counts', AUTH, '{}')).status).toBe(200);
    runCounts.mockResolvedValue({
      ran: true,
      ok: false,
      ids: { stories: [], posts: [], agents: [] },
    });
    expect((await post('?job=counts', AUTH, '{}')).status).toBe(500);
  });

  it('answer 500 with the same plain message when a run throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runSkills.mockRejectedValue(new Error('text'));
    const broken = await post('?job=skills');
    expect(broken.status).toBe(500);
    expect(broken.body.message).toBe('The run could not take or close its lease');
  });

  it('are given the same limited database as the minute job', async () => {
    await post('?job=skills');
    const given = runSkills.mock.calls[0]?.[0] as {
      run: (work: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    };
    await given.run(async () => 'x');
    expect(setUp[0]?.[4]).toBe(`${FRAME.statementTimeoutMs}ms`);
  });
});

describe('the counts body', () => {
  it('is the IDs a check run made, each list at most 100 lower-case UUIDs, and each list absent is empty', async () => {
    await post('?job=counts', AUTH, JSON.stringify({ posts: [ID], stories: [ID, ID], files: [] }));
    expect(runCounts.mock.calls[0]?.[0]).toEqual({ posts: [ID], stories: [ID, ID], files: [] });
    await post('?job=counts', AUTH, JSON.stringify({ stories: [ID] }));
    expect(runCounts.mock.calls[1]?.[0]).toEqual({ posts: [], stories: [ID], files: [] });
    await post('?job=counts', AUTH, '{}');
    expect(runCounts.mock.calls[2]?.[0]).toEqual({ posts: [], stories: [], files: [] });
    // No body at all is `{}`.
    await post('?job=counts', AUTH);
    expect(runCounts.mock.calls[3]?.[0]).toEqual({ posts: [], stories: [], files: [] });
    const hundred = Array.from(
      { length: 100 },
      (_, n) => `01a1e7f8-1a00-7c3d-8e4f-${String(n).padStart(12, '0')}`,
    );
    await post('?job=counts', AUTH, JSON.stringify({ posts: hundred }));
    expect(runCounts.mock.calls[4]?.[0].posts).toHaveLength(100);
  });

  it('refuses anything else with 400 (no run), without echoing what was sent', async () => {
    const hundredAndOne = Array.from(
      { length: 101 },
      (_, n) => `01a1e7f8-1a00-7c3d-8e4f-${String(n).padStart(12, '0')}`,
    );
    const bad = [
      'not json',
      '[]',
      'null',
      '"text"',
      JSON.stringify({ posts: ID }),
      JSON.stringify({ posts: [ID.toUpperCase()] }),
      JSON.stringify({ posts: ['not-a-uuid'] }),
      JSON.stringify({ posts: [5] }),
      JSON.stringify({ posts: hundredAndOne }),
      JSON.stringify({ posts: [], agents: [ID] }),
      JSON.stringify({ posts: [], extra: true }),
      JSON.stringify({ files: null }),
    ];
    for (const body of bad) {
      const refused = await post('?job=counts', AUTH, body);
      expect(refused.status, body).toBe(400);
      expect(refused.body.code, body).toBe('BAD_REQUEST');
      expect(JSON.stringify(refused.body)).not.toContain('not-a-uuid');
      expect(refused.headers['cache-control']).toBe('private, no-store');
    }
    expect(runCounts).not.toHaveBeenCalled();
  });

  it('is read only for counts: the minute job reads no body', async () => {
    await post('?job=minute', AUTH, 'not json');
    expect(runMinute).toHaveBeenCalledOnce();
  });
});
