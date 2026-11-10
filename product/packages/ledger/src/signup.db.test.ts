import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, databaseUrl, expectBooksBalance } from './testing.ts';

/**
 * Play money on signup (infra/supabase/migrations/*_starting_balance.sql; PLAN.md section 2,
 * "Play money"): every sign-in account gets its starting balance, Ṁ1,000, from the house, in the
 * transaction that makes it, and never a second time. Against a real database: sign-ups made by
 * Supabase Auth's own database role, as a real sign-up is; twenty at the same moment; one rolled
 * back; and the starting balance asked for eight times at once. The rules one by one are in
 * infra/supabase/tests/starting_balance.test.sql.
 */

const STARTING = '1000.000000';
let owner: pg.Pool;
/** Supabase Auth's own role, which makes every sign-in account (its service connects as it). */
let authService: pg.Pool;

beforeAll(() => {
  owner = connect(10);
  const address = new URL(databaseUrl());
  // The local database gives every role the same password (the Supabase CLI's own setup).
  address.username = 'supabase_auth_admin';
  authService = new pg.Pool({ connectionString: address.href, max: 20 });
  authService.on('error', () => {});
});

afterAll(async () => {
  await owner.end();
  await authService.end();
});

/** A sign-up as Supabase Auth makes one: as its own role, with the columns it fills. */
async function signUp(as: pg.Pool | pg.PoolClient, id: string = randomUUID()): Promise<string> {
  await as.query(
    `insert into auth.users
       (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
             '{"provider": "email", "providers": ["email"]}', '{}', now(), now())`,
    [id, `${id}@signup.test`],
  );
  return id;
}

type PlayMoney = {
  account: string;
  balance: string;
  /** Every move into or out of the account: [kind, from the house?, amount]. */
  moves: [string, boolean, string][];
  /** The starting balances recorded for it, with whether each names its own move's entry. */
  starting: [string, boolean][];
};

/** A sign-in account's play money, as the books hold it; null when it has none. */
async function playMoney(userId: string): Promise<PlayMoney | null> {
  const { rows } = await owner.query<PlayMoney>(
    `select a.id as account, a.balance::text as balance,
            coalesce((select json_agg(json_build_array(e.kind, f.kind = 'house', m.amount::text)
                                      order by m.id)
                      from ledger.moves m
                      join ledger.entries e on e.id = m.entry_id
                      join ledger.accounts f on f.id = m.from_account
                      where a.id in (m.from_account, m.to_account)), '[]') as moves,
            coalesce((select json_agg(json_build_array(
                               s.amount::text,
                               exists (select 1 from ledger.moves m
                                       where m.entry_id = s.entry_id and m.to_account = a.id)))
                      from ledger.starting_balances s where s.account_id = a.id), '[]') as starting
     from ledger.accounts a
     where a.kind = 'person' and a.user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

const justTheStartingBalance = (account: string): PlayMoney => ({
  account,
  balance: STARTING,
  moves: [['grant', true, STARTING]],
  starting: [[STARTING, true]],
});

describe('play money on signup', () => {
  it('a sign-up made by Supabase Auth itself gets Ṁ1,000 from the house, recorded once', async () => {
    const id = await signUp(authService);
    const money = await playMoney(id);
    expect(money).toEqual(justTheStartingBalance(money?.account ?? ''));
    await expectBooksBalance(owner, 'after a sign-up');
  });

  it("a sign-up that's rolled back leaves no account and moves no money", async () => {
    const client = await authService.connect();
    const id = randomUUID();
    try {
      await client.query('begin');
      await signUp(client, id);
      await client.query('rollback');
    } finally {
      client.release();
    }
    expect(await playMoney(id)).toBeNull();
    const { rows } = await owner.query('select 1 from auth.users where id = $1', [id]);
    expect(rows).toHaveLength(0);
    await expectBooksBalance(owner, 'after a sign-up rolled back');
  });

  it('twenty sign-ups at the same moment each get exactly their own, and the books balance', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => signUp(authService)));
    for (const id of ids) {
      const money = await playMoney(id);
      expect(money, id).toEqual(justTheStartingBalance(money?.account ?? ''));
    }
    await expectBooksBalance(owner, 'after twenty sign-ups at once');
  });

  it('asked for eight times at once, the starting balance is given once', async () => {
    const id = await signUp(authService);
    const accounts = await Promise.all(
      Array.from({ length: 8 }, () =>
        owner.query<{ id: string }>('select ledger.give_starting_balance($1) as id', [id]),
      ),
    );
    const money = await playMoney(id);
    expect(new Set(accounts.map((r) => r.rows[0]?.id))).toEqual(new Set([money?.account]));
    expect(money).toEqual(justTheStartingBalance(money?.account ?? ''));
    const { rows } = await owner.query<{ given: number }>(
      'select ledger.give_missing_starting_balances() as given',
    );
    expect(rows[0]?.given).toBe(0);
    await expectBooksBalance(owner, 'after the starting balance was asked for eight times at once');
  });

  it("an account Supabase Auth deletes keeps its play money in the books, no longer anyone's", async () => {
    const id = await signUp(authService);
    const before = await playMoney(id);
    await authService.query('delete from auth.users where id = $1', [id]);
    expect(await playMoney(id)).toBeNull();
    const { rows } = await owner.query<{ user_id: string | null; balance: string }>(
      'select user_id, balance::text from ledger.accounts where id = $1',
      [before?.account],
    );
    expect(rows[0]).toEqual({ user_id: null, balance: STARTING });
    await expectBooksBalance(owner, 'after Supabase Auth deleted an account');
  });

  it('a person who has spent it all still never gets it again', async () => {
    const id = await signUp(authService);
    const before = await playMoney(id);
    await owner.query("select ledger.correct($1, ledger.house(), 1000, 'Spent it all (a test)')", [
      before?.account,
    ]);
    await owner.query('select ledger.give_starting_balance($1)', [id]);
    await owner.query('select ledger.give_missing_starting_balances()');
    expect(await playMoney(id)).toMatchObject({
      balance: '0.000000',
      starting: [[STARTING, true]],
    });
    await expectBooksBalance(owner, 'after asking again for a spent starting balance');
  });
});
