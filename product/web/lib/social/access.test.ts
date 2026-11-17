import { ORPCError } from '@orpc/server';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * How social's code reaches the database (access.ts): each caller's transaction is set up as that
 * caller, and a refusal comes out as the API's answer. The pool is stood in for.
 */

const queries: { text: string; values: unknown[] | undefined }[] = [];
let raise: unknown = null;
const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    queries.push({ text, values });
    if (raise && !text.startsWith('select set_config') && text !== 'begin' && text !== 'rollback')
      throw raise;
    return { rows: [{ answer: { ok: true } }] };
  }),
  release: vi.fn(),
};
const pool = { connect: async () => client } as unknown as Pick<Pool, 'connect'>;
let available: typeof pool | null = pool;
vi.mock('@/lib/db.ts', () => ({ database: () => available }));

const { asAdmin, asAgent, asApp, asJob, asSession, mapped, runner } = await import('./access.ts');

/** The settings the transaction began with: role, claims, account, lock and statement limits, acting key. */
const settings = () =>
  queries.find((query) => query.text.startsWith('select set_config'))?.values as string[];

const ADMIN = '00000000-0000-4000-8000-0000000000c1';
const KEY = '00000000-0000-4000-8000-0000000000e1';

beforeEach(() => {
  available = pool;
  raise = null;
});
afterEach(() => {
  queries.length = 0;
  vi.clearAllMocks();
});

describe('the callers', () => {
  it('asApp: the app’s role, nobody signed in, no key', async () => {
    await expect(asApp(async (tx) => (await tx.query('select 1')).rows[0])).resolves.toEqual({
      answer: { ok: true },
    });
    expect(settings()[0]).toBe('hrizzup_app');
    expect(settings()[2]).toBe('');
    expect(settings()[5]).toBe('');
  });

  it('asSession: the signed-in account', async () => {
    await asSession(ADMIN, async (tx) => tx.query('select 1'));
    expect(settings()[2]).toBe(ADMIN);
    expect(settings()[5]).toBe('');
  });

  it('asAgent: the acting key, which the database stamps and takes the agent from', async () => {
    await asAgent(KEY, async (tx) => tx.query('select 1'));
    expect(settings()[2]).toBe('');
    expect(settings()[5]).toBe(KEY);
  });

  it('asAdmin: the account and the pool the route already checked', async () => {
    const own = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, 'connect'>;
    await asAdmin({ account: ADMIN, pool: own }, async (tx) => tx.query('select 1'));
    expect(own.connect).toHaveBeenCalled();
    expect(settings()[2]).toBe(ADMIN);
  });

  it('asJob: nobody signed in, 30 seconds a statement unless the step says otherwise', async () => {
    await asJob(async (tx) => tx.query('select 1'));
    expect(settings()[4]).toBe('30000ms');
    queries.length = 0;
    await asJob(async (tx) => tx.query('select 1'), { statementTimeoutMs: 5_000 });
    expect(settings()[4]).toBe('5000ms');
  });

  it('a transaction is only ever one, and it is committed', async () => {
    await runner(null)(async (tx) => tx.query('select 1'));
    expect(queries.map((query) => query.text)).toEqual([
      'begin',
      expect.stringContaining('set_config'),
      'select 1',
      'commit',
    ]);
  });
});

describe('what goes wrong', () => {
  it('answers a 503 where the database isn’t set up', async () => {
    available = null;
    await expect(asApp(async () => 1)).rejects.toMatchObject({ status: 503 });
  });

  it('answers a refusal of the database as the API does for that caller', async () => {
    raise = Object.assign(new Error('No such call'), { code: 'HZS18' });
    await expect(
      asAdmin({ account: ADMIN, pool }, async (tx) => tx.query('select 1')),
    ).rejects.toMatchObject({
      status: 404,
      message: 'No such call',
    });
    raise = Object.assign(new Error('x'), { code: '42501' });
    await expect(asAgent(KEY, async (tx) => tx.query('select 1'))).rejects.toMatchObject({
      status: 403,
      data: { reason: 'posting_key_needed' },
    });
    await expect(asSession(ADMIN, async (tx) => tx.query('select 1'))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('asks an area’s own map first', async () => {
    raise = Object.assign(new Error('x'), { code: 'HZS30' });
    const own = () => new ORPCError('REFUSED', { status: 422, message: 'Its own' });
    await expect(asApp(async (tx) => tx.query('select 1'), own)).rejects.toMatchObject({
      message: 'Its own',
    });
  });

  it('leaves a failure it does not know as it came', async () => {
    const odd = new TypeError('a bug');
    await expect(mapped('none', async () => Promise.reject(odd))).rejects.toBe(odd);
  });
});
