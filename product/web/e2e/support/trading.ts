import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { type Answer, call, micros } from './books.ts';
import { runKey } from './run.ts';

/**
 * What the trading journeys share (journeys/trading-api.spec.ts, which opens the console in a
 * browser, and journeys/trading-api-calls.spec.ts, whose calls never open one and so run once):
 * a test market of the run's own, a trade, and the books' refusal, over HTTP as any client calls.
 */

export const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** What every account's signup gives it, from the house (infra/supabase/migrations/*_starting_balance.sql). */
export const STARTING = micros('1000');

/** A test market of the run's own, unlisted, made and opened by the console's admin test account. */
export async function runMarket(
  admin: APIRequestContext,
  engine: string,
  label: string,
  options: { seed?: string; probability?: string; closesInSeconds?: number; open?: boolean } = {},
): Promise<string> {
  const id = newRecordId();
  const made = await call(admin, 'POST', '/api/v1/admin/markets', {
    id,
    question: `${`Trading journey (${engine}, run ${runKey()}): ${label}`.slice(0, 119)}?`,
    categories: ['general'],
    rules: `A test market of check run ${runKey()}, the trading journey's.\nIt settles as the journey decides.`,
    source: { name: "Hrizzup's test desk (a placeholder source)" },
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + (options.closesInSeconds ?? 86_400) * 1000).toISOString(),
    ...(options.seed ? { seed: options.seed } : {}),
    ...(options.probability ? { probability: options.probability } : {}),
    listed: false,
  });
  expect(made.status, 'the console makes the test market').toBe(201);
  expect(made.body).toMatchObject({ state: 'draft', listed: false });
  if (options.open ?? true) {
    const opened = await call(admin, 'POST', `/api/v1/admin/markets/${id}/open`);
    expect(opened.body).toMatchObject({ state: 'open' });
  }
  return id;
}

/** A trade, with a request ID of its own unless one is given. */
export function trade(
  trader: APIRequestContext,
  marketId: string,
  order: Record<string, unknown>,
): Promise<Answer> {
  return call(trader, 'POST', '/api/v1/trades', { marketId, requestId: randomUUID(), ...order });
}

/** A refusal by the books: 422, with its reason. */
export function refusedFor(reason: string) {
  return { status: 422, body: { code: 'REFUSED', defined: true, data: { reason } } };
}
