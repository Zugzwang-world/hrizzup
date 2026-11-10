import type { ListedMarket, OpenOrder, PerpDetails, Position, PositionsPage } from '@hrizzup/api';
import { ORPCError } from '@orpc/server';
import { cache } from 'react';
import { serverApi, whoAmI } from '@/lib/api/server.ts';
import { consoleAdmin } from '@/lib/console.ts';
import { justAbove } from './format.ts';

/**
 * What the sandbox's pages read, through the typed API's own calls, in process. Each is wrapped in
 * React's `cache`, so the header and the page that asks for the same thing in one request share one
 * trip to the database. A walk through a person's pages stops after a few: a sandbox account holds a
 * handful of positions and orders.
 */

const MOST_PAGES = 5;

/** Who is looking: nobody, or someone with their balance (null if the books can't be read) and whether they're an admin. */
export type Viewer =
  | { signedIn: false }
  | { signedIn: true; balance: string | null; admin: boolean };

const firstPositions = cache(async (): Promise<PositionsPage | null> => {
  try {
    return await serverApi.portfolio.positions();
  } catch (error) {
    if (error instanceof ORPCError) return null;
    throw error;
  }
});

export const viewer = cache(async (): Promise<Viewer> => {
  if (!(await whoAmI())) return { signedIn: false };
  const [positions, admin] = await Promise.all([firstPositions(), consoleAdmin()]);
  return { signedIn: true, balance: positions?.balance ?? null, admin: admin !== null };
});

/** The person's position in one market, as the books keep it: none if they hold nothing there. */
export async function positionIn(marketId: string): Promise<Position | null> {
  let page = await firstPositions();
  for (let pages = 1; page && pages <= MOST_PAGES; pages++) {
    const found = page.positions.find((position) => position.marketId === marketId);
    if (found) return found;
    if (!page.next) return null;
    page = await serverApi.portfolio.positions({ after: page.next });
  }
  return null;
}

/** The person's resting limit orders in one market, newest first. */
export async function ordersIn(marketId: string): Promise<OpenOrder[]> {
  const found: OpenOrder[] = [];
  let after: string | undefined;
  for (let pages = 0; pages < MOST_PAGES; pages++) {
    const page = await serverApi.portfolio.orders(after ? { after } : undefined);
    found.push(...page.orders.filter((order) => order.marketId === marketId));
    if (!page.next) break;
    after = page.next;
  }
  return found;
}

/**
 * One market, by its ID, with the calls the API has: the public list, asked for the page after the ID
 * just above this market's, which starts with it. Only a market the list shows can be found this way
 * (listed, not a draft), and the page says "not found" for any other.
 */
export const findMarket = cache(async (id: string): Promise<ListedMarket | null> => {
  const above = justAbove(id);
  if (!above) return null;
  const page = await serverApi.markets.list({ after: above });
  const first = page.markets[0];
  return first && first.market.id === id ? first : null;
});

/** One perp by its address, or null when there is none. */
export const findPerp = cache(async (id: string): Promise<PerpDetails | null> => {
  try {
    return await serverApi.perps.get({ id });
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
});
