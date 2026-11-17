import {
  cancelOrder,
  closeMarket,
  createMarket,
  getMarket,
  listMarkets,
  marketBook,
  marketHistory,
  marketList,
  marketQuote,
  marketTrades,
  myTrades,
  oneMarket,
  openMarket,
  openOrders,
  placeTrade,
  positions,
  settleMarket,
} from '@hrizzup/markets';
import {
  closePerp,
  createTestPerp,
  getPerp,
  latestPrice,
  listedPerps,
  listPerps,
  openPerp,
  perpDetails,
  perpPositions,
  perpQuote,
  priceHistory,
  retireTestPerp,
  setPerpMode,
  setPerpSettings,
} from '@hrizzup/perps';
import { currentCommit, currentEnvironment, currentRegion } from '@/lib/env.ts';
import {
  checkAuth,
  checkDatabase,
  checkRedis,
  checkStorage,
  type ServiceResult,
} from '@/lib/health/checks.ts';
import { appAuthSettings, appEmailCode } from './auth.ts';
import { admin, api } from './base.ts';
import { consoleCall } from './console.ts';
import { MARKET_ACTIVITY_TAG, MARKETS_TAG, refreshEdge } from './edge-cache.ts';
import { pageOf } from './ground-rules.ts';
import { createKey, keysSetUp, listKeys, revokeKey } from './keys.ts';
import { PERPS_TAG, perpCall, perpSource } from './perps.ts';
import { socialRoutes } from './social/index.ts';
import {
  asPerson,
  person,
  tradingCall,
  tradingPool,
  withinReadLimit,
  withinTradeLimit,
} from './trading.ts';

const state = (result: ServiceResult) => result.status;

/** A console list's page, as the console's reads take it (they call the page size `max`). */
function consolePage(input: Parameters<typeof pageOf>[0]) {
  const { after, limit } = pageOf(input);
  return { after, ...(limit === undefined ? {} : { max: limit }) };
}

/**
 * A console call that changes what the public market list shows (opening, closing or settling a
 * market): its edge copies are cleared once the change is made. Creating a draft changes nothing
 * public.
 */
async function changesTheList<T>(work: () => Promise<T>): Promise<T> {
  const answer = await consoleCall(work);
  await refreshEdge([MARKETS_TAG, MARKET_ACTIVITY_TAG]);
  return answer;
}

/**
 * A console call that changes what the perps' public reads show (the off switch, the settings,
 * retiring a test perp): their edge copies are cleared once the change is made. Making a test perp
 * changes nothing anyone has read.
 */
async function changesThePerps<T>(work: () => Promise<T>): Promise<T> {
  const answer = await consoleCall(work);
  await refreshEdge([PERPS_TAG]);
  return answer;
}

/**
 * Every call's handler. The market API's are here; social's come one file to an area
 * (`social/<area>.ts`), joined in `social/index.ts`: each is a stub until its relay builds it, and
 * a call not live yet is never reached (base.ts).
 */
export const router = api.router({
  health: api.health.handler(async () => {
    const [database, redis, storage, auth] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkStorage(),
      checkAuth(),
    ]);
    const services = {
      database: state(database),
      redis: state(redis),
      storage: state(storage),
      auth: state(auth),
    };
    const states = Object.values(services);
    return {
      status: states.includes('error') ? 'error' : states.includes('ok') ? 'ok' : 'not_configured',
      environment: currentEnvironment(),
      region: currentRegion(),
      commit: currentCommit(),
      checkedAt: new Date().toISOString(),
      services,
    };
  }),

  me: api.me.handler(async ({ context }) => {
    const user = await person(context.headers, 'read');
    await withinReadLimit(user, context.resHeaders);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      signedInWith: user.key
        ? 'api_key'
        : user.testAccount
          ? 'test_account'
          : user.provider === 'google'
            ? 'google'
            : user.provider === 'email'
              ? 'email'
              : 'other',
    };
  }),

  auth: {
    settings: api.auth.settings.handler(() => appAuthSettings()),
    emailCode: api.auth.emailCode.handler(({ context, input }) => appEmailCode(context, input)),
  },

  markets: {
    list: api.markets.list.handler(({ context, input }) =>
      tradingCall(() => marketList(tradingPool(), pageOf(input), context.expiry.endsAt)),
    ),
    // The market data (3.5c): public, the same for everyone, each read with nobody signed in.
    get: api.markets.get.handler(({ context, input }) =>
      tradingCall(() => oneMarket(tradingPool(), input.id, context.expiry.endsAt)),
    ),
    history: api.markets.history.handler(({ input }) =>
      tradingCall(() => marketHistory(tradingPool(), input.id, input.range)),
    ),
    book: api.markets.book.handler(({ input }) =>
      tradingCall(() => marketBook(tradingPool(), input.id)),
    ),
    trades: api.markets.trades.handler(({ input }) =>
      tradingCall(() =>
        marketTrades(tradingPool(), input.id, { cursor: input.cursor, limit: input.limit }),
      ),
    ),
    quote: api.markets.quote.handler(({ context, input }) =>
      tradingCall(() => marketQuote(tradingPool(), input, context.expiry.endsAt)),
    ),
    trade: api.markets.trade.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'trade');
      await withinTradeLimit(user.id, context.resHeaders);
      const result = await asPerson(user, () =>
        tradingCall(() => placeTrade(tradingPool(), user.id, input)),
      );
      // A dry run changes nothing anyone reads.
      if (result.dryRun) return result;
      // Every trade changes the market's record and its history (an order that rests too: a point at
      // the same price), its book, its latest trades and its quotes: their edge copies are cleared.
      await refreshEdge([MARKETS_TAG, MARKET_ACTIVITY_TAG]);
      return result;
    }),
    cancelOrder: api.markets.cancelOrder.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'trade');
      await withinTradeLimit(user.id, context.resHeaders);
      const cancelled = await asPerson(user, () =>
        tradingCall(() => cancelOrder(tradingPool(), user.id, input)),
      );
      // A cancelled order leaves the market's book.
      await refreshEdge([MARKET_ACTIVITY_TAG]);
      return cancelled;
    }),
  },

  perps: {
    list: api.perps.list.handler(() => perpCall(() => listedPerps(tradingPool(), perpSource()))),
    get: api.perps.get.handler(({ input }) =>
      perpCall(() => perpDetails(tradingPool(), input.id, perpSource())),
    ),
    quote: api.perps.quote.handler(({ input }) =>
      perpCall(() => perpQuote(tradingPool(), input, perpSource())),
    ),
    // A perp trade counts against the same trades a minute as the markets'.
    open: api.perps.open.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'trade');
      await withinTradeLimit(user.id, context.resHeaders);
      return asPerson(user, () =>
        perpCall(() => openPerp(tradingPool(), user.id, input, perpSource())),
      );
    }),
    close: api.perps.close.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'trade');
      await withinTradeLimit(user.id, context.resHeaders);
      return asPerson(user, () =>
        perpCall(() => closePerp(tradingPool(), user.id, input, perpSource())),
      );
    }),
  },

  // Our own price (3.4b): public, the same for everyone.
  prices: {
    get: api.prices.get.handler(({ input }) =>
      perpCall(() => latestPrice(tradingPool(), input.feed)),
    ),
    history: api.prices.history.handler(({ input }) =>
      perpCall(() => priceHistory(tradingPool(), input.feed, input.range)),
    ),
  },

  portfolio: {
    positions: api.portfolio.positions.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'read');
      await withinReadLimit(user, context.resHeaders);
      return tradingCall(() => positions(tradingPool(), user.id, pageOf(input)));
    }),
    trades: api.portfolio.trades.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'read');
      await withinReadLimit(user, context.resHeaders);
      return tradingCall(() => myTrades(tradingPool(), user.id, pageOf(input)));
    }),
    orders: api.portfolio.orders.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'read');
      await withinReadLimit(user, context.resHeaders);
      return tradingCall(() => openOrders(tradingPool(), user.id, pageOf(input)));
    }),
    perps: api.portfolio.perps.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'read');
      await withinReadLimit(user, context.resHeaders);
      return perpCall(() => perpPositions(tradingPool(), user.id, pageOf(input), perpSource()));
    }),
  },

  // Social's V1 beta: one file to an area, each a stub until built (social/index.ts).
  social: socialRoutes.social,
  owner: socialRoutes.owner,
  reader: socialRoutes.reader,

  // The keys' calls need a signed-in session, never a key (person(…, 'session')).
  keys: {
    list: api.keys.list.handler(async ({ context }) => {
      keysSetUp();
      const user = await person(context.headers, 'session');
      return listKeys(tradingPool(), user.id);
    }),
    create: api.keys.create.handler(async ({ context, input }) => {
      keysSetUp();
      const user = await person(context.headers, 'session');
      return createKey(tradingPool(), user.id, input);
    }),
    revoke: api.keys.revoke.handler(async ({ context, input }) => {
      keysSetUp();
      const user = await person(context.headers, 'session');
      return revokeKey(tradingPool(), user.id, input.id);
    }),
  },

  admin: {
    markets: {
      list: admin.markets.list.handler(({ context, input }) =>
        consoleCall(() => listMarkets(context.pool, context.account, consolePage(input))),
      ),
      get: admin.markets.get.handler(({ context, input }) =>
        consoleCall(() => getMarket(context.pool, context.account, input.id)),
      ),
      create: admin.markets.create.handler(({ context, input }) =>
        consoleCall(() => createMarket(context.pool, context.account, input)),
      ),
      open: admin.markets.open.handler(({ context, input }) =>
        changesTheList(() => openMarket(context.pool, context.account, input.id)),
      ),
      close: admin.markets.close.handler(({ context, input }) =>
        changesTheList(() => closeMarket(context.pool, context.account, input.id)),
      ),
      settle: admin.markets.settle.handler(({ context, input }) =>
        changesTheList(() => settleMarket(context.pool, context.account, input)),
      ),
    },
    perps: {
      list: admin.perps.list.handler(({ context, input }) =>
        consoleCall(() => listPerps(context.pool, context.account, consolePage(input))),
      ),
      get: admin.perps.get.handler(({ context, input }) =>
        consoleCall(() => getPerp(context.pool, context.account, input.id)),
      ),
      setMode: admin.perps.setMode.handler(({ context, input }) =>
        changesThePerps(() => setPerpMode(context.pool, context.account, input)),
      ),
      setSettings: admin.perps.setSettings.handler(({ context, input }) =>
        changesThePerps(() => setPerpSettings(context.pool, context.account, input)),
      ),
      createTest: admin.perps.createTest.handler(({ context, input }) =>
        consoleCall(() => createTestPerp(context.pool, context.account, input)),
      ),
      retireTest: admin.perps.retireTest.handler(({ context, input }) =>
        changesThePerps(() => retireTestPerp(context.pool, context.account, input)),
      ),
    },
    social: socialRoutes.admin.social,
  },
});
