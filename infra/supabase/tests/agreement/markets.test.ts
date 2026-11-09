import { shapes, validate } from '@hrizzup/agreement';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, transactions } from './database.ts';
import { newId } from './records.ts';

/**
 * The markets hold the agreement's market shape (market/1; PLAN.md step 1.7c): every market the
 * console's calls can make, in every state it can reach, reads back through
 * `markets.market_record()` as a record that passes `validate()`, and the database's limits and
 * value lists for a market are the agreement's own (`agreement/definitions/market.v1.schema.json`).
 * The console's calls run as the app's own role with an admin signed in, the way the server's
 * database helper (@hrizzup/db) runs them.
 */

type Schema = { [key: string]: unknown };
type Market = { [key: string]: unknown };

const ADMIN = '00000000-0000-4000-8000-0000000000d1';
const definition = shapes['market/1'] as unknown as Schema;
const fields = definition.properties as Record<string, Schema>;
const source = ((definition.$defs as Record<string, Schema>).source as Schema).properties as Record<
  string,
  Schema
>;

let db: pg.Client;
const tx = transactions(() => db);
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await tx.begin();
  await db.query(
    `insert into auth.users (id, aud, role, email)
     values ($1, 'authenticated', 'authenticated', 'admin@markets.test') on conflict (id) do nothing`,
    [ADMIN],
  );
  await db.query(
    `insert into private.admins (user_id, note) values ($1, 'A test admin')
     on conflict (user_id) do nothing`,
    [ADMIN],
  );
});
afterEach(() => tx.rollback());

/** One of the console's calls, as the app's own role with the admin signed in. */
async function asAdmin(sql: string, values: unknown[]): Promise<Market> {
  await db.query(
    `select set_config('role', 'hrizzup_app', true),
            set_config('request.jwt.claims', $1, true),
            set_config('request.jwt.claim.sub', $2, true)`,
    [JSON.stringify({ sub: ADMIN, role: 'authenticated' }), ADMIN],
  );
  const { rows } = await db.query<{ answer: Market }>(sql, values);
  await db.query(`select set_config('role', 'none', true)`);
  return rows[0]?.answer as Market;
}

type Draft = {
  question: string;
  categories: string[];
  rules: string;
  sourceName: string;
  sourceUrl: string | null;
};

const draft: Draft = {
  question: 'Will test event A happen before the end of the year, as the test desk records it?',
  categories: ['general', 'ai'],
  rules: 'Yes wins if the test desk records event A.\nOtherwise No wins.',
  sourceName: "Hrizzup's test desk (a placeholder source)",
  sourceUrl: null,
};

async function create(changes: Partial<Draft> = {}): Promise<string> {
  const m = { ...draft, ...changes };
  const id = newId();
  await asAdmin('select admin.create_market($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as answer', [
    id,
    m.question,
    m.categories,
    m.rules,
    m.sourceName,
    m.sourceUrl,
    new Date(Date.now() + 3_600_000),
    new Date(Date.now() + 86_400_000),
    '0.5',
    '1000',
  ]);
  return id;
}

const open = (id: string) => asAdmin('select admin.open_market($1) as answer', [id]);
const close = (id: string) => asAdmin('select admin.close_market($1) as answer', [id]);
const settle = (
  id: string,
  outcome: 'yes' | 'no' | 'probability' | 'cancel',
  extra: { probability?: string; reason?: string } = {},
) =>
  asAdmin('select admin.settle_market($1, $2, $3, $4, $5) as answer', [
    id,
    outcome,
    extra.probability ?? null,
    'What the test desk recorded.',
    extra.reason ?? null,
  ]);

/** The market as its market/1 record, once the rules that wait for the commit have run. */
async function record(id: string): Promise<Market | null> {
  await tx.settle();
  const { rows } = await db.query<{ record: Market | null }>(
    'select markets.market_record($1) as record',
    [id],
  );
  return rows[0]?.record ?? null;
}

describe('a market the console makes', () => {
  it('reads back as a market/1 record, in every state it can reach, passing validate()', async () => {
    const made: Record<string, string> = {
      draft: await create(),
      open: await create({ categories: ['crypto'] }),
      closed: await create({ sourceUrl: 'https://example.com/hrizzup/test-desk' }),
      yes: await create({ categories: ['sports', 'politics', 'general'] }),
      no: await create(),
      cancelled: await create(),
    };
    for (const id of [made.open, made.closed, made.yes, made.no, made.cancelled] as string[]) {
      await open(id);
    }
    for (const id of [made.closed, made.yes, made.no, made.cancelled] as string[]) await close(id);
    await settle(made.yes as string, 'yes');
    await settle(made.no as string, 'no');
    await settle(made.cancelled as string, 'cancel', {
      reason: 'The test desk recorded nothing within a day of closing.',
    });

    const expected: Record<string, Market> = {
      draft: { state: 'draft' },
      open: { state: 'open', categories: ['crypto'] },
      closed: {
        state: 'closed',
        source: { name: draft.sourceName, url: 'https://example.com/hrizzup/test-desk' },
      },
      yes: { state: 'settled', result: 'yes', categories: ['sports', 'politics', 'general'] },
      no: { state: 'settled', result: 'no' },
      cancelled: {
        state: 'cancelled',
        cancel_reason: 'The test desk recorded nothing within a day of closing.',
      },
    };
    for (const [name, id] of Object.entries(made)) {
      const back = await record(id);
      expect(back, name).toMatchObject({
        format: 'market/1',
        id,
        question: draft.question,
        categories: draft.categories,
        kind: 'yes_no',
        rules: draft.rules,
        source: { name: draft.sourceName },
        settlement: 'by_hand',
        ...expected[name],
      });
      expect(validate(back), `${name}: validate()`).toEqual([]);
    }
  });

  it('settled at a set probability, has no market/1 record: the agreement can say only which outcome won', async () => {
    const id = await create();
    await open(id);
    await close(id);
    await settle(id, 'probability', { probability: '0.7' });
    expect(await record(id)).toBeNull();
  });
});

describe("the database's rules for a market are the agreement's", () => {
  it("takes each text at the agreement's longest, and refuses one character more", async () => {
    const question = fields.question?.maxLength as number;
    const rules = fields.rules?.maxLength as number;
    const sourceName = source.name?.maxLength as number;
    expect([question, rules, sourceName]).toEqual([120, 2000, 120]);

    for (const [field, longest] of [
      ['question', question],
      ['rules', rules],
      ['sourceName', sourceName],
    ] as const) {
      const fits = await tx.attempt(() => create({ [field]: 'x'.repeat(longest) }));
      expect(fits, `${field} at ${longest} characters`).toBeNull();
      const over = await tx.attempt(() => create({ [field]: 'x'.repeat(longest + 1) }));
      expect(over?.code, `${field} at ${longest + 1} characters`).toBe('23514');
    }

    const reason = fields.cancel_reason?.maxLength as number;
    expect(reason).toBe(200);
    for (const [length, refused] of [
      [reason + 1, true],
      [reason, false],
    ] as const) {
      const id = await create();
      await open(id);
      await close(id);
      const error = await tx.attempt(() => settle(id, 'cancel', { reason: 'x'.repeat(length) }));
      expect(error?.code ?? null, `a cancel reason of ${length} characters`).toBe(
        refused ? '23514' : null,
      );
    }
  });

  it('takes 1 to 3 categories, as the agreement does', async () => {
    const ref = String(fields.categories?.$ref);
    expect(ref).toBe('common.schema.json#/$defs/categories');
    for (const [categories, refused] of [
      [['general', 'ai', 'sports'], false],
      [['general', 'ai', 'sports', 'crypto'], true],
      [[], true],
    ] as const) {
      const error = await tx.attempt(() => create({ categories: [...categories] }));
      expect(error?.code ?? null, `${categories.length} categories`).toBe(refused ? '22023' : null);
    }
  });

  it('holds the same value lists for kind, settlement and state', async () => {
    const values = (field: string) => [...((fields[field]?.enum ?? []) as string[])].sort();
    const lists = async (table: string, constraint: string) => {
      const { rows } = await db.query<{ definition: string }>(
        `select pg_catalog.pg_get_constraintdef(c.oid) as definition
         from pg_catalog.pg_constraint c
         where c.conrelid = $1::regclass and c.conname = $2`,
        [table, constraint],
      );
      const definition = rows[0]?.definition ?? '';
      return [...definition.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    };
    expect(await lists('markets.details', 'details_kind_values')).toEqual(values('kind'));
    expect(await lists('markets.details', 'details_settlement_values')).toEqual(
      values('settlement'),
    );
    expect(await lists('markets.markets', 'markets_state')).toEqual(values('state'));
  });
});
