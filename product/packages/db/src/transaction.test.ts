import { describe, expect, it } from 'vitest';
import {
  APP_ROLE,
  asKey,
  backoffMs,
  claimsFor,
  DatabaseBusyError,
  errorCode,
  type Transaction,
  transaction,
} from './transaction.ts';

const ANN = '11111111-2222-4333-8444-555555555555';

/** A pool whose one client records every statement, and fails the ones `fail` picks. */
function fakePool(fail: (text: string, call: number) => unknown = () => undefined) {
  const statements: { text: string; values?: unknown[] }[] = [];
  const releases: (boolean | undefined)[] = [];
  let calls = 0;
  const client = {
    async query(text: string, values?: unknown[]) {
      calls += 1;
      statements.push({ text: text.replace(/\s+/g, ' ').trim(), values });
      const error = fail(text, calls);
      if (error) throw error;
      return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
    },
    release(broken?: boolean) {
      releases.push(broken);
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: a stand-in for pg's PoolClient
  const pool = { connect: async () => client as any };
  return { pool, statements, releases };
}

const dbError = (code: string) => Object.assign(new Error(`database error ${code}`), { code });

describe('transaction', () => {
  it('runs the work in one transaction, as the app role, with the account signed in', async () => {
    const { pool, statements, releases } = fakePool();
    const result = await transaction(
      pool,
      async (tx: Transaction) => {
        await tx.query('select 1');
        return 'done';
      },
      { account: ANN },
    );
    expect(result).toBe('done');
    expect(statements.map((s) => s.text.split(' ')[0])).toEqual([
      'begin',
      'select',
      'select',
      'commit',
    ]);
    expect(statements[1]?.text).toContain("set_config('role', $1, true)");
    expect(statements[1]?.values).toEqual([
      APP_ROLE,
      JSON.stringify({ sub: ANN, role: 'authenticated' }),
      ANN,
      '2000ms',
      '10000ms',
      '',
    ]);
    expect(statements[1]?.text).toContain("set_config('hrizzup.api_key', $6, true)");
    expect(releases).toEqual([false]);
  });

  it('signs nobody in when there is no account', async () => {
    const { pool, statements } = fakePool();
    await transaction(pool, async () => null, { account: null, lockTimeoutMs: 500 });
    expect(statements[1]?.values).toEqual([
      APP_ROLE,
      JSON.stringify({ role: 'anon' }),
      '',
      '500ms',
      '10000ms',
      '',
    ]);
  });

  it('tells the database which API key signed the request, given or from asKey', async () => {
    const KEY = '00000000-0000-4000-8000-0000000000ab';
    const OTHER = '00000000-0000-4000-8000-0000000000cd';
    const given = fakePool();
    await transaction(given.pool, async () => null, { account: ANN, apiKey: KEY.toUpperCase() });
    expect(given.statements[1]?.values?.[5]).toBe(KEY);

    const inside = fakePool();
    const outside = fakePool();
    await asKey(KEY, async () => {
      await transaction(inside.pool, async () => null, { account: ANN });
      // A transaction may still say no key, or another, itself.
      await transaction(outside.pool, async () => null, { account: ANN, apiKey: null });
    });
    expect(inside.statements[1]?.values?.[5]).toBe(KEY);
    expect(outside.statements[1]?.values?.[5]).toBe('');

    const after = fakePool();
    await asKey(null, () => transaction(after.pool, async () => null, { account: ANN }));
    await transaction(after.pool, async () => null, { account: ANN, apiKey: OTHER });
    expect(after.statements[1]?.values?.[5]).toBe('');
    expect(after.statements[4]?.values?.[5]).toBe(OTHER);
  });

  it('refuses an API key that is not an ID, before reaching the database', async () => {
    const { pool, statements } = fakePool();
    await expect(
      transaction(pool, async () => null, { account: ANN, apiKey: "x', true); --" }),
    ).rejects.toThrow(TypeError);
    expect(() => asKey("x', true); --", async () => null)).toThrow(TypeError);
    expect(statements).toEqual([]);
  });

  it('refuses an account that is not a user ID, before reaching the database', async () => {
    const { pool, statements } = fakePool();
    await expect(
      transaction(pool, async () => null, { account: "x', true); drop table y; --" }),
    ).rejects.toThrow(TypeError);
    expect(statements).toEqual([]);
  });

  it('rolls back and passes on an error the database does not ask to retry', async () => {
    const { pool, statements, releases } = fakePool((text) =>
      text === 'select boom' ? dbError('23514') : undefined,
    );
    await expect(
      transaction(pool, (tx) => tx.query('select boom'), { account: ANN }),
    ).rejects.toMatchObject({ code: '23514' });
    expect(statements.map((s) => s.text)).toContain('rollback');
    expect(statements.filter((s) => s.text === 'begin')).toHaveLength(1);
    expect(releases).toEqual([false]);
  });

  it('tries again after a deadlock, a lock wait that ran out, or a serialization failure', async () => {
    for (const code of ['40P01', '55P03', '40001']) {
      let failures = 0;
      const { pool, statements } = fakePool((text) => {
        if (text === 'select work' && failures < 2) {
          failures += 1;
          return dbError(code);
        }
        return undefined;
      });
      const result = await transaction(pool, (tx) => tx.query('select work').then(() => 'ok'), {
        account: ANN,
      });
      expect(result).toBe('ok');
      expect(statements.filter((s) => s.text === 'begin')).toHaveLength(3);
      expect(statements.filter((s) => s.text === 'commit')).toHaveLength(1);
    }
  });

  it('gives up after its attempts, saying the database is busy', async () => {
    const { pool, statements } = fakePool((text) =>
      text === 'select work' ? dbError('55P03') : undefined,
    );
    const attempt = transaction(pool, (tx) => tx.query('select work'), {
      account: ANN,
      attempts: 2,
    });
    await expect(attempt).rejects.toBeInstanceOf(DatabaseBusyError);
    await expect(attempt).rejects.toMatchObject({ cause: { code: '55P03' } });
    expect(statements.filter((s) => s.text === 'begin')).toHaveLength(2);
  });

  it('discards a connection that broke', async () => {
    const { pool, releases } = fakePool((text) =>
      text === 'select work' || text === 'rollback' ? dbError('08006') : undefined,
    );
    await expect(
      transaction(pool, (tx) => tx.query('select work'), { account: ANN }),
    ).rejects.toMatchObject({ code: '08006' });
    expect(releases).toEqual([true]);
  });
});

describe('helpers', () => {
  it('reads the database error code', () => {
    expect(errorCode(dbError('40P01'))).toBe('40P01');
    expect(errorCode(new Error('plain'))).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });

  it('waits a little longer before each attempt', () => {
    expect(backoffMs(2, () => 0)).toBe(13);
    expect(backoffMs(2, () => 1)).toBe(38);
    expect(backoffMs(3, () => 0.5)).toBe(50);
  });

  it('writes the claims auth.uid() reads, in lower case', () => {
    expect(JSON.parse(claimsFor(ANN.toUpperCase()))).toEqual({ sub: ANN, role: 'authenticated' });
  });
});
