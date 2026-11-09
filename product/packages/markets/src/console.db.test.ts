import { randomUUID } from 'node:crypto';
import type { CreateMarketInput } from '@hrizzup/api';
import { type TradeRequest, type TradeResult, trade } from '@hrizzup/ledger';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConsoleError,
  closeMarket,
  createMarket,
  getMarket,
  isAdmin,
  listMarkets,
  openMarket,
  settleMarket,
} from './console.ts';

/**
 * The market console's calls against a real database built from the migrations (the Database
 * check), through the server's one database helper, as the app's own role: a market's whole life
 * with real trades (each through the ledger's own `trade()`), every way a market settles with the
 * payouts adding up to what it held, the log showing each step, and the books still balancing;
 * everyone but an admin refused; and calls at the same moment as trades and each other.
 */

const url = process.env.MARKETS_DATABASE_URL;
if (!url) throw new Error('MARKETS_DATABASE_URL is not set: run `pnpm test:db`');

let owner: pg.Pool;
let app: pg.Pool;
const ADMIN = randomUUID();
const SOMEONE = randomUUID();

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: url, max: 4 });
  app = new pg.Pool({ connectionString: url, max: 12 });
  owner.on('error', () => {});
  app.on('error', () => {});
  await owner.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
    ADMIN,
    `${ADMIN}@console.test`,
    SOMEONE,
    `${SOMEONE}@console.test`,
  ]);
  // Only the owner can make an admin (in the real databases, a reviewed migration).
  await owner.query(`insert into private.admins (user_id, note) values ($1, 'A test admin')`, [
    ADMIN,
  ]);
});

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
});

/** A new record ID: a version 7 UUID, as the agreement asks. */
function newId(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const time = Date.now().toString(16).padStart(12, '0');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function draft(changes: Partial<CreateMarketInput> = {}): CreateMarketInput {
  return {
    id: newId(),
    question: 'Will test event A happen before the end of the year?',
    categories: ['general'],
    rules: 'Yes wins if the test desk records event A.\nOtherwise No wins.',
    source: { name: "Hrizzup's test desk (a placeholder source)" },
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    probability: '0.5',
    seed: '1000',
    ...changes,
  };
}

/** A person with play money: a sign-in account and a starting balance from the house. */
async function person(starting: string) {
  const userId = randomUUID();
  await owner.query('insert into auth.users (id, email) values ($1, $2)', [
    userId,
    `${userId}@console.test`,
  ]);
  const { rows } = await owner.query<{ id: string }>('select ledger.open_account($1, $2) as id', [
    userId,
    starting,
  ]);
  return { userId, accountId: (rows[0] as { id: string }).id };
}

type Person = Awaited<ReturnType<typeof person>>;

function buy(who: Person, marketId: string, outcome: 'YES' | 'NO', amount: string) {
  const request: TradeRequest = {
    action: 'buy',
    requestId: randomUUID(),
    marketId,
    outcome,
    amount,
  };
  return trade(app, who.userId, request);
}

function sell(who: Person, marketId: string, outcome: 'YES' | 'NO', shares: string) {
  return trade(app, who.userId, {
    action: 'sell',
    requestId: randomUUID(),
    marketId,
    outcome,
    shares,
  });
}

function shares(result: TradeResult): string {
  if (result.status === 'refused' || result.status === 'cancelled') {
    throw new Error(`Expected a trade, got ${JSON.stringify(result)}`);
  }
  return result.shares;
}

async function balance(who: Person): Promise<string> {
  const { rows } = await owner.query<{ balance: string }>(
    'select balance::text from ledger.accounts where id = $1',
    [who.accountId],
  );
  return (rows[0] as { balance: string }).balance;
}

async function expectBooksBalance() {
  const { rows } = await owner.query<{ problem: string }>('select problem from ledger.problems()');
  expect(rows.map((r) => r.problem)).toEqual([]);
}

/** Exact decimal text as whole millionths, to add without floating point. */
const micros = (text: string) => {
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
  return text.startsWith('-') ? -value : value;
};

describe('everyone but an admin', () => {
  it('is refused every call, the reads included, before anything is read or written', async () => {
    for (const who of [SOMEONE, randomUUID()]) {
      expect(await isAdmin(app, who)).toBe(false);
      const id = newId();
      for (const attempt of [
        () => listMarkets(app, who),
        () => getMarket(app, who, id),
        () => createMarket(app, who, draft({ id })),
        () => openMarket(app, who, id),
        () => closeMarket(app, who, id),
        () => settleMarket(app, who, { id, outcome: 'yes', evidence: 'What the desk recorded.' }),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ kind: 'not_admin' });
      }
      const { rows } = await owner.query('select 1 from markets.details where market_id = $1', [
        id,
      ]);
      expect(rows).toEqual([]);
    }
    expect(await isAdmin(app, ADMIN)).toBe(true);
  });
});

describe("a market's whole life, by hand in the console", () => {
  it('is made a draft, opened, traded, closed and settled Yes: the payouts add up, and the log shows it', async () => {
    const ann = await person('500');
    const bob = await person('500');

    const made = await createMarket(app, ADMIN, draft());
    expect(made).toMatchObject({ state: 'draft', held: '0.000000', result: null });
    expect(made.log.map((line) => line.action)).toEqual(['create']);
    // A draft takes no bets: the trade is refused before any of the maths.
    expect(await buy(ann, made.id, 'YES', '10')).toMatchObject({
      status: 'refused',
      reason: 'market_not_open',
    });

    const opened = await openMarket(app, ADMIN, made.id);
    expect(opened).toMatchObject({ state: 'open', held: '1000.000000', probability: '0.50000000' });
    const annShares = shares(await buy(ann, made.id, 'YES', '100'));
    shares(await buy(bob, made.id, 'NO', '50'));

    const closed = await closeMarket(app, ADMIN, made.id);
    expect(closed.state).toBe('closed');
    expect(Date.parse(closed.closesAt)).toBeLessThanOrEqual(Date.now());
    // Betting stopped as it closed.
    expect(await buy(bob, made.id, 'NO', '10')).toMatchObject({
      status: 'refused',
      reason: 'market_not_open',
    });
    const held = closed.held;
    expect(held).toBe('1150.000000');

    const settled = await settleMarket(app, ADMIN, {
      id: made.id,
      outcome: 'yes',
      evidence: 'The test desk recorded event A at 17:05, India time.',
    });
    expect(settled).toMatchObject({
      state: 'settled',
      held: '0.000000',
      result: { outcome: 'yes' },
    });
    const line = settled.log.at(-1);
    expect(settled.log.map((l) => l.action)).toEqual(['create', 'open', 'close', 'settle']);
    expect(line?.by.id).toBe(ADMIN);
    expect(line?.settlement).toMatchObject({
      outcome: 'yes',
      evidence: 'The test desk recorded event A at 17:05, India time.',
      paidToPeople: annShares,
      people: 1,
    });
    // What it paid, to people and to the house, comes to exactly what it held.
    const paid = micros(line?.settlement?.paidToPeople ?? '0');
    const house = micros(line?.settlement?.toHouse ?? '0');
    expect(paid + house).toBe(micros(held));
    // Ann's Yes shares paid Ṁ1 each; Bob's No shares nothing.
    expect(micros(await balance(ann))).toBe(micros('400') + micros(annShares));
    expect(await balance(bob)).toBe('450.000000');
    await expectBooksBalance();
  });

  it('settles No, at a set probability, or by cancel, each adding up to what the market held', async () => {
    for (const outcome of ['no', 'probability', 'cancel'] as const) {
      const ann = await person('500');
      const bob = await person('500');
      const { id } = await createMarket(app, ADMIN, draft());
      await openMarket(app, ADMIN, id);
      const annYes = shares(await buy(ann, id, 'YES', '100'));
      const bobNo = shares(await buy(bob, id, 'NO', '60'));
      const { held } = await closeMarket(app, ADMIN, id);

      const settled = await settleMarket(app, ADMIN, {
        id,
        outcome,
        evidence: `Settled ${outcome} on the test desk's record.`,
        ...(outcome === 'probability' ? { probability: '0.7' } : {}),
        ...(outcome === 'cancel' ? { reason: 'The test desk recorded nothing within a day.' } : {}),
      });
      expect(settled.state, outcome).toBe(outcome === 'cancel' ? 'cancelled' : 'settled');
      expect(settled.held, outcome).toBe('0.000000');
      const sums = settled.log.at(-1)?.settlement;
      expect(micros(sums?.paidToPeople ?? '0') + micros(sums?.toHouse ?? '0'), outcome).toBe(
        micros(held),
      );

      const annNow = micros(await balance(ann));
      const bobNow = micros(await balance(bob));
      if (outcome === 'no') {
        expect(annNow).toBe(micros('400'));
        expect(bobNow).toBe(micros('440') + micros(bobNo));
      } else if (outcome === 'probability') {
        // Each Yes share pays 0.7 and each No share 0.3, rounded down to a millionth.
        expect(annNow).toBe(micros('400') + (micros(annYes) * 7n) / 10n);
        expect(bobNow).toBe(micros('440') + (micros(bobNo) * 3n) / 10n);
        expect(settled.result).toMatchObject({ outcome: 'probability', probability: '0.70000000' });
      } else {
        // A cancel gives each person back what they put in.
        expect([annNow, bobNow]).toEqual([micros('500'), micros('500')]);
        expect(settled.result).toMatchObject({
          outcome: 'cancel',
          cancelReason: 'The test desk recorded nothing within a day.',
        });
      }
      await expectBooksBalance();
    }
  });

  it('cancelled, takes back a sale profit: the balance shows what is owed', async () => {
    const ann = await person('100');
    const bob = await person('500');
    const { id } = await createMarket(app, ADMIN, draft());
    await openMarket(app, ADMIN, id);
    const annYes = shares(await buy(ann, id, 'YES', '100'));
    shares(await buy(bob, id, 'YES', '400'));
    await sell(ann, id, 'YES', annYes);
    const afterSale = micros(await balance(ann));
    expect(afterSale).toBeGreaterThan(micros('100')); // Ann sold at a profit...
    // ...and spends it elsewhere, in another market.
    const { id: other } = await createMarket(app, ADMIN, draft());
    await openMarket(app, ADMIN, other);
    shares(await buy(ann, other, 'NO', (Number(afterSale) / 1_000_000).toFixed(6)));
    expect(await balance(ann)).toBe('0.000000');

    await closeMarket(app, ADMIN, id);
    const cancelled = await settleMarket(app, ADMIN, {
      id,
      outcome: 'cancel',
      evidence: 'The question turned out to be unclear.',
      reason: "The question can't be settled fairly.",
    });
    expect(cancelled.state).toBe('cancelled');
    // Ann gets back what she put in less what she took out: below zero, what she owes.
    expect(micros(await balance(ann))).toBe(micros('100') - afterSale);
    expect(await balance(bob)).toBe('500.000000');
    await expectBooksBalance();
  });
});

describe('the state a market is in', () => {
  it("decides what an admin can do next, and says so when it can't", async () => {
    const { id } = await createMarket(app, ADMIN, draft());
    await expect(closeMarket(app, ADMIN, id)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(
      settleMarket(app, ADMIN, { id, outcome: 'yes', evidence: 'Evidence.' }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await openMarket(app, ADMIN, id);
    await expect(openMarket(app, ADMIN, id)).rejects.toMatchObject({
      kind: 'conflict',
      message: 'Only a draft opens: this market is open',
    });
    await expect(
      settleMarket(app, ADMIN, { id, outcome: 'yes', evidence: 'Evidence.' }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await expect(getMarket(app, ADMIN, newId())).rejects.toMatchObject({ kind: 'not_found' });
  });

  it("refuses what breaks the agreement's rules, in plain words", async () => {
    const tag = String.fromCodePoint(0xe0041); // An invisible tag character.
    await expect(
      createMarket(app, ADMIN, draft({ question: `Will test event A happen?${tag}` })),
    ).rejects.toMatchObject({
      kind: 'invalid',
      message: 'Must be plain text, with no hidden characters',
    });
    await expect(
      createMarket(app, ADMIN, draft({ closesAt: new Date(Date.now() - 1000).toISOString() })),
    ).rejects.toMatchObject({ kind: 'invalid', message: 'A market closes in the future' });
  });
});

describe('calls at the same moment', () => {
  it('a retried create, even at the same instant, makes one market', async () => {
    const market = draft();
    const [first, second] = await Promise.all([
      createMarket(app, ADMIN, market),
      createMarket(app, ADMIN, market),
    ]);
    expect(first.id).toBe(market.id);
    expect(second.id).toBe(market.id);
    const { rows } = await owner.query<{ lines: number }>(
      `select count(*)::int as lines from markets.log where market_id = $1 and action = 'create'`,
      [market.id],
    );
    expect(rows[0]?.lines).toBe(1);
    await expect(
      createMarket(app, ADMIN, { ...market, question: 'A different question?' }),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('closing waits for the trades in flight, and no trade lands after the market closes', async () => {
    const { id } = await createMarket(app, ADMIN, draft({ seed: '5000' }));
    await openMarket(app, ADMIN, id);
    const traders = await Promise.all(Array.from({ length: 12 }, () => person('200')));
    const trades = traders.map((who, i) => buy(who, id, i % 2 ? 'YES' : 'NO', `${5 + i}`));
    const closing = closeMarket(app, ADMIN, id);
    const results = await Promise.all(trades);
    const closed = await closing;
    for (const result of results) {
      if (result.status === 'refused') {
        expect(['market_not_open', 'market_closed']).toContain(result.reason);
      } else if (result.status !== 'cancelled') {
        expect(Date.parse(result.at)).toBeLessThan(Date.parse(closed.closesAt));
      }
    }
    const { rows } = await owner.query<{ late: number }>(
      `select count(*)::int as late from markets.trades t join markets.markets m on m.id = t.market_id
       where m.id = $1 and t.created_at >= m.closes_at`,
      [id],
    );
    expect(rows[0]?.late).toBe(0);
    await expectBooksBalance();
  });

  it('two admins settling at once settle it once', async () => {
    const ann = await person('300');
    const { id } = await createMarket(app, ADMIN, draft());
    await openMarket(app, ADMIN, id);
    shares(await buy(ann, id, 'YES', '100'));
    await closeMarket(app, ADMIN, id);
    const outcomes = await Promise.allSettled([
      settleMarket(app, ADMIN, { id, outcome: 'yes', evidence: 'First.' }),
      settleMarket(app, ADMIN, { id, outcome: 'no', evidence: 'Second.' }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(ConsoleError);
    expect(refused.reason).toMatchObject({ kind: 'conflict' });
    const market = await getMarket(app, ADMIN, id);
    expect(market.log.filter((line) => line.action === 'settle')).toHaveLength(1);
    await expectBooksBalance();
  });
});

describe('the list of markets', () => {
  it('comes newest first, a page at a time, without the log', async () => {
    const made: string[] = [];
    for (let i = 0; i < 3; i++) made.push((await createMarket(app, ADMIN, draft())).id);
    const seen: string[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await listMarkets(app, ADMIN, { max: 2, ...(after ? { after } : {}) });
      expect(page.markets.length).toBeLessThanOrEqual(2);
      for (const market of page.markets) expect(market).not.toHaveProperty('log');
      seen.push(...page.markets.map((m) => m.id));
      if (!page.next) break;
      after = page.next;
    }
    const mine = seen.filter((id) => made.includes(id));
    expect(mine).toEqual([...made].reverse());
    expect(new Set(seen).size).toBe(seen.length);
  });
});
