import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The perp's jobs address (route.ts), as Supabase Cron calls it: only with this environment's
 * secret, and to anyone else exactly as an address the site doesn't have. The jobs' own work
 * (`runJob`) is stood in for; it is tested with the database (product/packages/perps).
 */

const runJob = vi.fn();
const pool = { connect: vi.fn() };
let databaseHere = true;

vi.mock('@/lib/db.ts', () => ({ database: () => (databaseHere ? pool : null) }));
vi.mock('@hrizzup/perps', async (original) => ({
  ...(await original<typeof import('@hrizzup/perps')>()),
  runJob: (...args: unknown[]) => runJob(...args),
}));

const route = await import('./route.ts');
const { POST, carriesTheSecret } = route;

/** Plainly not a key: the Secret check (gitleaks) scans every branch for anything key-like. */
const SECRET = 'test-secret-only-for-the-jobs-tests-x';
const SEED = '0123456789abcdef';
const RUN = {
  job: 'tick',
  perps: 1,
  applied: 1,
  busy: 0,
  nothing: 0,
  notSetUp: 0,
  failed: [],
  liquidations: 0,
};

async function post(query: string, headers: Record<string, string> = {}) {
  const response = await POST(
    new Request(`https://staging.hrizzup.com/api/jobs/perps${query}`, { method: 'POST', headers }),
  );
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: (await response.json()) as Record<string, unknown>,
  };
}

beforeEach(() => {
  vi.stubEnv('PERP_JOBS_SECRET', SECRET);
  vi.stubEnv('PERP_STAND_IN_SEED', SEED);
  databaseHere = true;
  runJob.mockResolvedValue(RUN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("the perp's jobs address", () => {
  it('runs a job for the database, with its secret, never kept', async () => {
    const ran = await post('?job=tick', { authorization: `Bearer ${SECRET}` });
    expect(ran).toMatchObject({ status: 200, body: RUN });
    expect(ran.headers['cache-control']).toBe('private, no-store');
    expect(runJob).toHaveBeenCalledWith(pool, 'tick', { seed: SEED });
    runJob.mockResolvedValueOnce({ ...RUN, job: 'funding' });
    expect((await post('?job=funding', { authorization: `Bearer ${SECRET}` })).status).toBe(200);
    expect(runJob).toHaveBeenLastCalledWith(pool, 'funding', { seed: SEED });
  });

  it('answers anyone without the secret exactly as an address the site does not have', async () => {
    const answers = [
      await post('?job=tick'),
      await post('?job=tick', { authorization: 'Bearer wrong' }),
      await post('?job=tick', { authorization: SECRET }),
      await post('?job=tick', { authorization: `Bearer ${SECRET}x` }),
      await post('?job=nothing'),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(answer.body).toEqual({
        defined: false,
        code: 'NOT_FOUND',
        status: 404,
        message: 'No such call',
      });
      expect(answer.headers['cache-control']).toBe('private, no-store');
    }
    expect(runJob).not.toHaveBeenCalled();
  });

  it('runs nothing where no secret is set, or one too short to be ours', async () => {
    for (const secret of ['', 'short']) {
      vi.stubEnv('PERP_JOBS_SECRET', secret);
      expect((await post('?job=tick', { authorization: `Bearer ${secret}` })).status).toBe(404);
    }
    expect(carriesTheSecret(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('refuses a job it does not have, and says when the database is not set up', async () => {
    expect((await post('?job=settle', { authorization: `Bearer ${SECRET}` })).status).toBe(400);
    expect((await post('', { authorization: `Bearer ${SECRET}` })).status).toBe(400);
    databaseHere = false;
    expect((await post('?job=tick', { authorization: `Bearer ${SECRET}` })).status).toBe(503);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('answers every other method as a call without the secret', async () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const handler = route[method] as () => Promise<Response>;
      const answer = await handler();
      expect(answer.status, method).toBe(404);
      expect(answer.headers.get('cache-control'), method).toBe('private, no-store');
    }
    expect(runJob).not.toHaveBeenCalled();
  });

  it('reads the secret trimmed, as the database’s copy is written', async () => {
    vi.stubEnv('PERP_JOBS_SECRET', `${SECRET}\n`);
    expect((await post('?job=tick', { authorization: `Bearer ${SECRET}` })).status).toBe(200);
  });

  it('answers 500 when a perp’s step failed, naming it, so pg_net’s record of the call shows it', async () => {
    runJob.mockResolvedValueOnce({
      ...RUN,
      applied: 0,
      failed: [{ perpId: '01a1c501-ec40-78f6-87b6-3fb041143421', error: 'boom' }],
    });
    const failed = await post('?job=tick', { authorization: `Bearer ${SECRET}` });
    expect(failed.status).toBe(500);
    expect(failed.body.failed).toHaveLength(1);
  });
});
