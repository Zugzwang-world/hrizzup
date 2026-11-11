import { type APIRequestContext, expect } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { call, decimal, micros } from './books.ts';
import { runKey } from './run.ts';

/**
 * A check run's own test perp (blueprint section 11: each run owns what it changes), for the
 * journeys that trade a perp: unlisted, its own seed and stand-in price walk, Ṁ1,000 of the house's
 * in each pool, switched on. Each journey halts and retires it when done.
 */

/** What the house puts in each of a test perp's pools. */
export const SUBSIDY = micros('1000');

/** The run's own test perp, made and switched on by the console's admin test account. */
export async function runPerp(
  admin: APIRequestContext,
  engine: string,
  journey = 'Perp journey',
): Promise<string> {
  const id = newRecordId();
  const made = await call(admin, 'POST', '/api/v1/admin/perps', {
    id,
    name: `${journey} (${engine}, run ${runKey()})`,
    seed: [...crypto.getRandomValues(new Uint8Array(8))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    // Bitcoin's own volatility: prices move a little between trades, never enough to liquidate.
    standIn: {
      origin: new Date(Date.now() - 60_000).toISOString(),
      startPrice: '100',
      volatility: '0.55',
    },
    settings: {
      maxLeverage: '10',
      takerFeeBps: '10',
      takerFeeImpact: '0',
      fundingPeriodMs: '3600000',
      fundingSensitivity: '1',
      maxFundingRate: '0.0001',
      maxPriceAgeMs: '120000',
      subsidyLong: decimal(SUBSIDY),
      subsidyShort: decimal(SUBSIDY),
    },
    reason: `${journey}: the run's own test perp (run ${runKey()})`,
  });
  expect(made.status, 'the console makes the test perp').toBe(201);
  const on = await call(admin, 'POST', `/api/v1/admin/perps/${id}/mode`, {
    mode: 'enabled',
    reason: `${journey} trades it (run ${runKey()})`,
  });
  expect(on.body).toMatchObject({ tradingMode: 'enabled' });
  return id;
}
