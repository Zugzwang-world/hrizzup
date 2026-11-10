import { randomUUID } from 'node:crypto';
import type { CreateTestPerpInput } from '@hrizzup/api';
import { ConsoleError } from '@hrizzup/markets';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestPerp,
  getPerp,
  listPerps,
  retireTestPerp,
  setPerpMode,
  setPerpSettings,
} from './console.ts';

/**
 * The perp's console against a real database built from the migrations (the Database check),
 * through the server's one database helper, as the app's own role: the Bitcoin perp as the migration
 * made it; the off switch and the settings, every change in the rule-change log with its reason and
 * every bound held; a check run's test perp made, made again by a retry, and retired with its pools
 * back to the house; everyone but an admin refused; and the books with no problem.
 */

const url = process.env.PERPS_DATABASE_URL;
if (!url) throw new Error('PERPS_DATABASE_URL is not set: run `pnpm test:db`');

const BITCOIN = '01a1c501-ec40-78f6-87b6-3fb041143421';

let owner: pg.Pool;
let app: pg.Pool;
const ADMIN = randomUUID();
const SOMEONE = randomUUID();

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: url, max: 4 });
  app = new pg.Pool({ connectionString: url, max: 8 });
  owner.on('error', () => {});
  app.on('error', () => {});
  await owner.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
    ADMIN,
    `${ADMIN}@perps-console.test`,
    SOMEONE,
    `${SOMEONE}@perps-console.test`,
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

function testPerp(changes: Partial<CreateTestPerpInput> = {}): CreateTestPerpInput {
  return {
    id: newId(),
    name: 'A check run’s own test perp',
    seed: '0123456789abcdef',
    standIn: {
      origin: new Date(Date.now() - 60_000).toISOString(),
      startPrice: '100',
      volatility: '40',
    },
    settings: {
      maxLeverage: '10',
      takerFeeBps: '10',
      takerFeeImpact: '0',
      fundingPeriodMs: '3600000',
      fundingSensitivity: '1',
      maxFundingRate: '0.0001',
      maxPriceAgeMs: '120000',
      subsidyLong: '1000',
      subsidyShort: '1000',
    },
    reason: 'A check run’s own test perp',
    ...changes,
  };
}

async function problems(): Promise<string[]> {
  const { rows } = await owner.query<{ problem: string }>('select problem from ledger.problems()');
  return rows.map((row) => row.problem);
}

async function refusal(work: Promise<unknown>): Promise<ConsoleError> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ConsoleError);
  return error as ConsoleError;
}

describe("the perp's console", () => {
  it('shows an admin the Bitcoin perp as the migration made it: switched off, with its first rules', async () => {
    const page = await listPerps(app, ADMIN, { max: 100 });
    const bitcoin = page.perps.find((perp) => perp.id === BITCOIN);
    expect(bitcoin).toMatchObject({
      name: 'Bitcoin price (US dollars)',
      listed: true,
      state: 'live',
      tradingMode: 'halted',
      feed: 'stand-in-btc-usd',
      createdBy: null,
      standIn: {
        origin: '2026-01-01T00:00:00Z',
        startPrice: '100000',
        volatility: '0.55',
        ownSeed: false,
      },
    });
    expect(bitcoin?.settings).toEqual({
      maxLeverage: '10',
      takerFeeBps: '10',
      takerFeeImpact: '0',
      fundingPeriodMs: '3600000',
      fundingSensitivity: '1',
      maxFundingRate: '0.00011415525114155251',
      maxPriceAgeMs: '120000',
      subsidyLong: '25000.000000',
      subsidyShort: '25000.000000',
    });
    const withLog = await getPerp(app, ADMIN, BITCOIN);
    expect(withLog.log.map((line) => line.rule).slice(0, 4)).toEqual([
      'created',
      'stand_in',
      'trading_mode',
      'funding_from',
    ]);
    expect(withLog.log.every((line) => line.by === null)).toBe(true);
  });

  it('refuses everyone but an admin every call, as the database itself decides', async () => {
    const calls = [
      () => listPerps(app, SOMEONE),
      () => getPerp(app, SOMEONE, BITCOIN),
      () => setPerpMode(app, SOMEONE, { id: BITCOIN, mode: 'enabled', reason: 'Mine now' }),
      () =>
        setPerpSettings(app, SOMEONE, { id: BITCOIN, settings: { maxLeverage: '5' }, reason: 'x' }),
      () => createTestPerp(app, SOMEONE, testPerp()),
      () => retireTestPerp(app, SOMEONE, { id: BITCOIN, reason: 'x' }),
    ];
    for (const work of calls) expect((await refusal(work())).kind).toBe('not_admin');
    // Signed out altogether: the same.
    const nobody = null as unknown as string;
    for (const work of [
      () => listPerps(app, nobody),
      () => getPerp(app, nobody, BITCOIN),
      () => setPerpMode(app, nobody, { id: BITCOIN, mode: 'enabled', reason: 'Mine now' }),
    ]) {
      expect((await refusal(work())).kind).toBe('not_admin');
    }
    const { rows } = await owner.query(
      "select count(*)::int as n from perps.rule_changes where reason in ('Mine now', 'x')",
    );
    expect(rows[0].n).toBe(0);
  });

  it('makes a check run’s test perp, once however often it is asked, and retires it', async () => {
    const input = testPerp();
    const made = await createTestPerp(app, ADMIN, input);
    expect(made).toMatchObject({
      id: input.id,
      listed: false,
      tradingMode: 'halted',
      pools: { long: '1000.000000', short: '1000.000000' },
      standIn: { startPrice: '100', volatility: '40', ownSeed: true },
      createdBy: { id: ADMIN },
    });
    expect(made.log).toHaveLength(13);
    expect(new Set(made.log.map((line) => line.reason))).toEqual(new Set([input.reason]));
    // A retry gets back the perp its first try made, and never makes a second.
    const again = await createTestPerp(app, ADMIN, input);
    expect(again.id).toBe(input.id);
    const { rows } = await owner.query('select count(*)::int as n from perps.perps where id = $1', [
      input.id,
    ]);
    expect(rows[0].n).toBe(1);
    // The same ID for another perp is refused.
    expect((await refusal(createTestPerp(app, ADMIN, { ...input, name: 'Another' }))).kind).toBe(
      'invalid',
    );
    // Asked twice at once: one perp, and both get it back.
    const twice = testPerp();
    const both = await Promise.all([
      createTestPerp(app, ADMIN, twice),
      createTestPerp(app, ADMIN, twice),
    ]);
    expect(both.map((perp) => perp.id)).toEqual([twice.id, twice.id]);
    const { rows: once } = await owner.query(
      'select count(*)::int as n from perps.perps where id = $1',
      [twice.id],
    );
    expect(once[0].n).toBe(1);
    await retireTestPerp(app, ADMIN, { id: twice.id, reason: 'Made twice at once' });

    const retired = await retireTestPerp(app, ADMIN, { id: input.id, reason: 'The run is done' });
    expect(retired).toMatchObject({
      state: 'retired',
      tradingMode: 'halted',
      pools: { long: '0.000000', short: '0.000000' },
    });
    expect(retired.log.at(-1)).toMatchObject({ rule: 'retired', reason: 'The run is done' });
    // Retired again (a retry, a run's cleanup): the retired perp, and nothing more in its log.
    const retiredAgain = await retireTestPerp(app, ADMIN, { id: input.id, reason: 'Again' });
    expect(retiredAgain).toMatchObject({ state: 'retired' });
    expect(retiredAgain.log).toHaveLength(retired.log.length);
    expect(
      (await refusal(setPerpMode(app, ADMIN, { id: input.id, mode: 'enabled', reason: 'x' }))).kind,
    ).toBe('conflict');
    expect(await problems()).toEqual([]);
  });

  it('switches a perp on, to closing only and off, each change logged with its reason', async () => {
    const input = testPerp();
    await createTestPerp(app, ADMIN, input);
    const on = await setPerpMode(app, ADMIN, {
      id: input.id,
      mode: 'enabled',
      reason: 'The run trades it',
    });
    expect(on.tradingMode).toBe('enabled');
    expect(on.log.at(-1)).toMatchObject({
      rule: 'trading_mode',
      oldValue: 'halted',
      newValue: 'enabled',
      reason: 'The run trades it',
      by: { id: ADMIN },
    });
    const same = await setPerpMode(app, ADMIN, { id: input.id, mode: 'enabled', reason: 'Again' });
    expect(same.log).toHaveLength(on.log.length);
    const closing = await setPerpMode(app, ADMIN, {
      id: input.id,
      mode: 'reduce-only',
      reason: 'Winding down',
    });
    expect(closing.tradingMode).toBe('reduce-only');
    const off = await setPerpMode(app, ADMIN, { id: input.id, mode: 'halted', reason: 'Done' });
    expect(off.tradingMode).toBe('halted');
    expect(off.log.slice(-3).map((line) => line.newValue)).toEqual([
      'enabled',
      'reduce-only',
      'halted',
    ]);
  });

  it('changes settings within their bounds, a log line for each that changed', async () => {
    const input = testPerp();
    await createTestPerp(app, ADMIN, input);
    const changed = await setPerpSettings(app, ADMIN, {
      id: input.id,
      settings: { maxLeverage: '5', takerFeeBps: '20', maxPriceAgeMs: '120000' },
      reason: 'Gentler for this run',
    });
    expect(changed.settings).toMatchObject({ maxLeverage: '5', takerFeeBps: '20' });
    const lines = changed.log.filter((line) => line.reason === 'Gentler for this run');
    expect(lines.map((line) => [line.rule, line.oldValue, line.newValue])).toEqual([
      ['max_leverage', '10', '5'],
      ['taker_fee_bps', '10', '20'],
    ]);
    for (const settings of [
      { maxLeverage: '11' },
      { takerFeeBps: '101' },
      { fundingPeriodMs: '60000' },
      { maxFundingRate: '1' },
    ]) {
      expect(
        (await refusal(setPerpSettings(app, ADMIN, { id: input.id, settings, reason: 'Too far' })))
          .kind,
      ).toBe('invalid');
    }
    const after = await getPerp(app, ADMIN, input.id);
    expect(after.settings.maxLeverage).toBe('5');
  });

  it('never retires the Bitcoin perp, nor a perp that does not exist', async () => {
    expect(
      (await refusal(retireTestPerp(app, ADMIN, { id: BITCOIN, reason: 'Tidying up' }))).kind,
    ).toBe('conflict');
    expect((await refusal(getPerp(app, ADMIN, newId()))).kind).toBe('not_found');
  });
});
