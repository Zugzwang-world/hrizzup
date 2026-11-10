import { createTestPerpInput, setPerpSettingsInput } from '@hrizzup/api';
import { consolePerpWithLog } from '@hrizzup/api/examples';
import { assertPerpSettings, PERP_SETTINGS, type PerpSettings } from '@hrizzup/market-engine';
import { ConsoleError } from '@hrizzup/markets';
import { describe, expect, it } from 'vitest';
import {
  createTestPerp,
  getPerp,
  listPerps,
  retireTestPerp,
  setPerpMode,
  setPerpSettings,
} from './console.ts';

/**
 * Quick checks, with no database: each of the console's calls sends the database's own function
 * what it was asked, in order, and reads its answer back; a retire asked again once its perp is
 * retired answers with the retired perp; and every setting the contract takes is one the engine
 * takes, so no setting an admin can make stops the perp. The calls against a real database are in
 * console.db.test.ts (the Database check).
 */

const ADMIN = '00000000-0000-4000-8000-0000000000c1';
const ID = consolePerpWithLog.id;

/** A pool whose one connection records what it's sent, and answers each console call in turn. */
function fakePool(...answers: (unknown | Error)[]) {
  const sent: { text: string; values?: unknown[] }[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      sent.push({ text, ...(values ? { values } : {}) });
      if (!text.includes(' as answer')) return { rows: [] };
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { rows: [{ answer: next }] };
    },
    release() {},
  };
  return { sent, pool: { connect: async () => client } as never };
}

/** The console call the pool was sent (the transaction's own statements left out). */
const called = (sent: { text: string; values?: unknown[] }[]) =>
  sent.filter((statement) => statement.text.includes(' as answer'));

/** A database refusal as pg gives one. */
const refusal = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("the perp console's calls", () => {
  it("each send the database's function what they were asked, in order", async () => {
    const page = { perps: [consolePerpWithLog], next: null };
    const { sent, pool } = fakePool(
      page,
      consolePerpWithLog,
      consolePerpWithLog,
      consolePerpWithLog,
      consolePerpWithLog,
      consolePerpWithLog,
    );
    await listPerps(pool, ADMIN, { after: ID, max: 20 });
    await getPerp(pool, ADMIN, ID);
    await setPerpMode(pool, ADMIN, { id: ID, mode: 'enabled', reason: 'On' });
    await setPerpSettings(pool, ADMIN, {
      id: ID,
      settings: { maxLeverage: '5', takerFeeBps: undefined },
      reason: 'Gentler',
    });
    const input = {
      id: ID,
      name: 'A test perp',
      seed: '0123456789abcdef',
      standIn: { origin: '2026-11-10T09:00:00.000Z', startPrice: '100', volatility: '40' },
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
      reason: 'A run',
    };
    await createTestPerp(pool, ADMIN, input);
    await retireTestPerp(pool, ADMIN, { id: ID, reason: 'Done' });
    expect(called(sent)).toEqual([
      { text: 'select admin.perps($1, $2) as answer', values: [ID, 20] },
      { text: 'select admin.perp($1) as answer', values: [ID] },
      { text: 'select admin.set_perp_mode($1, $2, $3) as answer', values: [ID, 'enabled', 'On'] },
      // Only the settings given: one not given is never sent as a change.
      {
        text: 'select admin.set_perp_settings($1, $2, $3) as answer',
        values: [ID, { maxLeverage: '5' }, 'Gentler'],
      },
      {
        text: 'select admin.create_test_perp($1, $2, $3, $4, $5, $6, $7) as answer',
        values: [
          ID,
          'A test perp',
          '0123456789abcdef',
          input.standIn,
          input.settings,
          null,
          'A run',
        ],
      },
      { text: 'select admin.retire_test_perp($1, $2) as answer', values: [ID, 'Done'] },
    ]);
  });

  it('read back a perp with no log lines as one with an empty log', async () => {
    const { log: _log, ...bare } = consolePerpWithLog;
    const { pool } = fakePool(bare);
    expect((await getPerp(pool, ADMIN, ID)).log).toEqual([]);
  });

  it("answer a retire asked again once it's retired with the retired perp, and keep other refusals", async () => {
    const retired = { ...consolePerpWithLog, state: 'retired' as const };
    const again = fakePool(refusal('55000', 'Perp is already retired'), retired);
    expect(await retireTestPerp(again.pool, ADMIN, { id: ID, reason: 'Again' })).toEqual(retired);
    expect(called(again.sent).map((statement) => statement.text)).toEqual([
      'select admin.retire_test_perp($1, $2) as answer',
      'select admin.perp($1) as answer',
    ]);
    // Still live (an open position, or the listed perp): the refusal stands.
    const open = fakePool(refusal('55000', 'still has an open position'), consolePerpWithLog);
    const error = await retireTestPerp(open.pool, ADMIN, { id: ID, reason: 'Try' }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ConsoleError);
    expect((error as ConsoleError).kind).toBe('conflict');
    // Refused for anything else: not asked again.
    const stranger = fakePool(refusal('42501', 'permission denied'));
    await expect(
      retireTestPerp(stranger.pool, ADMIN, { id: ID, reason: 'x' }),
    ).rejects.toMatchObject({ kind: 'not_admin' });
    expect(called(stranger.sent)).toHaveLength(1);
  });
});

describe('every setting the contract takes', () => {
  /** Figures at and around each bound, and ones that round past a bound as a number. */
  const probes: Record<keyof Omit<PerpSettings, 'subsidyLong' | 'subsidyShort'>, string[]> = {
    maxLeverage: ['0.999999', '1', '1.5', '9.999999', '10', '10.000001', '10.00000000000000000001'],
    takerFeeBps: ['0', '0.5', '99.999999', '100', '100.000001', '100.00000000000000000001'],
    takerFeeImpact: ['0', '50', '100', '100.000001'],
    fundingPeriodMs: ['3599999', '3600000', '3600001', '86400000', '3600000.5'],
    fundingSensitivity: ['0', '0.00000000000000000001', '0.000001', '1', '1000'],
    maxFundingRate: [
      '0',
      '0.00000000000000000001',
      '0.00011415525114155251',
      '0.5',
      '0.999999',
      '0.99999999999999999999',
      '1',
    ],
    maxPriceAgeMs: ['0', '1', '120000', '1.5'],
  };

  it("is one the engine takes, so no setting an admin can make stops the perp's steps", () => {
    let taken = 0;
    for (const [name, values] of Object.entries(probes)) {
      for (const value of values) {
        const asked = setPerpSettingsInput.safeParse({
          id: ID,
          settings: { [name]: value },
          reason: 'Probe',
        }).success;
        const settings = { ...PERP_SETTINGS, [name]: Number(value) };
        let engine = true;
        try {
          assertPerpSettings(settings);
        } catch {
          engine = false;
        }
        if (asked) taken += 1;
        // Taken by the contract only if the engine takes it too.
        expect(asked && !engine, `${name} ${value}`).toBe(false);
      }
    }
    expect(taken).toBeGreaterThan(20);
  });

  it('is one the engine takes for a test perp too, its subsidies at most Ṁ1,000,000 a pool', () => {
    const base = {
      id: ID,
      name: 'A test perp',
      seed: '0123456789abcdef',
      standIn: { origin: '2026-11-10T09:00:00.000Z', startPrice: '100', volatility: '40' },
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
      reason: 'A run',
    };
    const takes = (changes: Record<string, string>, standIn: Record<string, string> = {}) =>
      createTestPerpInput.safeParse({
        ...base,
        settings: { ...base.settings, ...changes },
        standIn: { ...base.standIn, ...standIn },
      }).success;
    expect(takes({})).toBe(true);
    expect(takes({ subsidyLong: '1000000' })).toBe(true);
    expect(takes({ subsidyLong: '1000000.000001' })).toBe(false);
    expect(takes({ subsidyShort: '0' })).toBe(false);
    expect(takes({ maxFundingRate: '0.99999999999999999999' })).toBe(false);
    expect(takes({ maxLeverage: '11' })).toBe(false);
    // Its walk starts at a moment to the millisecond, as the engine counts its 5-second steps.
    expect(takes({}, { origin: '2026-11-10T09:00:00.123Z' })).toBe(true);
    expect(takes({}, { origin: '2026-11-10T09:00:00.1234Z' })).toBe(false);
  });
});
