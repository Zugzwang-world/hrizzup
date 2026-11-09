import { DatabaseBusyError } from '@hrizzup/db';
import { TradeInputError } from '@hrizzup/ledger';
import { describe, expect, it } from 'vitest';
import { asTradingError, refusalBefore, TradingError } from './trading.ts';

/**
 * The trade call's checks before the books (trading.ts), with the person's holdings stood in for:
 * what the database reads is tested with the database (trading.db.test.ts).
 */

const MARKET = '01a1ab94-8600-7b23-ba8b-9e3174889404';
const held = {
  market_id: MARKET,
  state: 'open',
  closes_at: '2026-11-13T12:30:00Z',
  has_account: true,
  balance: '100.000000',
  yes: '20.000000',
  no: '0.000000',
};
const NOW = Date.parse('2026-11-10T00:00:00Z');
const base = { marketId: MARKET, requestId: '01a1b0c4-5e00-7a10-9c3d-1f2e3d4c5b6a' };
const buy = (amount: string) => ({
  ...base,
  action: 'buy' as const,
  outcome: 'yes' as const,
  amount,
});
const sell = (outcome: 'yes' | 'no', shares: string) => ({
  ...base,
  action: 'sell' as const,
  outcome,
  shares,
});

describe('the checks before the books', () => {
  it('let through what the holdings cover', () => {
    expect(refusalBefore(buy('100'), held, NOW)).toBeUndefined();
    expect(refusalBefore(buy('0.000001'), held, NOW)).toBeUndefined();
    expect(refusalBefore({ ...buy('50'), limitProb: '0.4' }, held, NOW)).toBeUndefined();
    expect(refusalBefore(sell('yes', '20'), held, NOW)).toBeUndefined();
  });

  it('refuse an amount over the balance, to the millionth', () => {
    expect(refusalBefore(buy('100.000001'), held, NOW)).toBe('insufficient_balance');
    expect(refusalBefore({ ...buy('150'), limitProb: '0.4' }, held, NOW)).toBe(
      'insufficient_balance',
    );
    expect(refusalBefore(buy('1'), { ...held, has_account: false, balance: '0.000000' }, NOW)).toBe(
      'insufficient_balance',
    );
  });

  it('refuse shares over those held, on the side sold', () => {
    expect(refusalBefore(sell('yes', '20.000001'), held, NOW)).toBe('not_enough_shares');
    expect(refusalBefore(sell('no', '1'), held, NOW)).toBe('not_enough_shares');
  });

  it("refuse a market that isn't open, or whose closing time has passed, before anything else", () => {
    for (const state of ['closed', 'settled', 'cancelled']) {
      expect(refusalBefore(buy('100000'), { ...held, state }, NOW), state).toBe('market_not_open');
    }
    expect(refusalBefore(buy('1'), held, Date.parse(held.closes_at))).toBe('market_closed');
    expect(refusalBefore(buy('100000'), held, Date.parse(held.closes_at) + 1)).toBe(
      'market_closed',
    );
  });
});

describe('failures as trading errors', () => {
  const coded = (code: string, message = 'from the database') =>
    Object.assign(new Error(message), { code });

  it("become the call's own refusals", () => {
    expect(asTradingError(coded('23505'))).toMatchObject({ kind: 'conflict' });
    expect(asTradingError(coded('P0002'))).toMatchObject({ kind: 'not_found' });
    expect(asTradingError(coded('22023', 'No such order on this account'))).toMatchObject({
      kind: 'invalid',
      message: 'No such order on this account',
    });
    expect(asTradingError(new TradeInputError('An expiry must be in the future'))).toMatchObject({
      kind: 'invalid',
      message: 'An expiry must be in the future',
    });
    const already = new TradingError('refused', 'x', 'price_limit');
    expect(asTradingError(already)).toBe(already);
  });

  it('leave anything else as it was: a busy database, a fault', () => {
    const busy = new DatabaseBusyError();
    expect(asTradingError(busy)).toBe(busy);
    const fault = coded('XX000');
    expect(asTradingError(fault)).toBe(fault);
  });
});
