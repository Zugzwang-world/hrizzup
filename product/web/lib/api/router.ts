import { contract } from '@hrizzup/api';
import {
  cancelOrder,
  closeMarket,
  createMarket,
  getMarket,
  listMarkets,
  marketList,
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
  listedPerps,
  listPerps,
  openPerp,
  perpDetails,
  perpPositions,
  retireTestPerp,
  setPerpMode,
  setPerpSettings,
} from '@hrizzup/perps';
import { implement } from '@orpc/server';
import type { ResponseHeadersPluginContext } from '@orpc/server/plugins';
import { currentCommit, currentEnvironment, currentRegion } from '@/lib/env.ts';
import {
  checkAuth,
  checkDatabase,
  checkRedis,
  checkStorage,
  type ServiceResult,
} from '@/lib/health/checks.ts';
import { appAuthSettings, appEmailCode } from './auth.ts';
import { cacheHeaders } from './caching.ts';
import { asAdmin, consoleCall } from './console.ts';
import type { ApiContext } from './context.ts';
import { MARKETS_TAG, refreshEdge } from './edge-cache.ts';
import { createKey, keysSetUp, listKeys, revokeKey } from './keys.ts';
import { PERPS_TAG, perpCall, perpSource } from './perps.ts';
import {
  asPerson,
  person,
  tradingCall,
  tradingPool,
  withinReadLimit,
  withinTradeLimit,
} from './trading.ts';

/**
 * The typed API's real implementation (the contract is in product/packages/api). Every call
 * gets the caching headers its contract entry asks for, set in one place below.
 */
const api = implement(contract)
  .$context<ApiContext & ResponseHeadersPluginContext>()
  .use(async ({ context, procedure, next }) => {
    const result = await next();
    for (const [name, value] of Object.entries(cacheHeaders(procedure['~orpc'].meta.caching))) {
      context.resHeaders?.set(name, value);
    }
    return result;
  });

const state = (result: ServiceResult) => result.status;

/**
 * The market console's calls (console.ts): admins only. The admin check wraps the whole subtree,
 * so it runs before any input is read: to anyone else, a call answers exactly as an address the
 * API doesn't have, whatever was sent. The database checks the admins table again inside each.
 */
const admin = api.admin.use(asAdmin);

/**
 * A console call that changes what the public market list shows (opening, closing or settling a
 * market): its edge copies are cleared once the change is made. Creating a draft changes nothing
 * public.
 */
async function changesTheList<T>(work: () => Promise<T>): Promise<T> {
  const answer = await consoleCall(work);
  await refreshEdge([MARKETS_TAG]);
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
    list: api.markets.list.handler(({ input }) =>
      tradingCall(() => marketList(tradingPool(), { after: input?.after })),
    ),
    trade: api.markets.trade.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'trade');
      await withinTradeLimit(user.id, context.resHeaders);
      const result = await asPerson(user, () =>
        tradingCall(() => placeTrade(tradingPool(), user.id, input)),
      );
      // A trade that moved the price changes the public list: its edge copies are cleared.
      if (result.probAfter !== result.probBefore) await refreshEdge([MARKETS_TAG]);
      return result;
    }),
    cancelOrder: api.markets.cancelOrder.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'trade');
      await withinTradeLimit(user.id, context.resHeaders);
      return asPerson(user, () => tradingCall(() => cancelOrder(tradingPool(), user.id, input)));
    }),
  },

  perps: {
    list: api.perps.list.handler(() => perpCall(() => listedPerps(tradingPool(), perpSource()))),
    get: api.perps.get.handler(({ input }) =>
      perpCall(() => perpDetails(tradingPool(), input.id, perpSource())),
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

  portfolio: {
    positions: api.portfolio.positions.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'read');
      await withinReadLimit(user, context.resHeaders);
      return tradingCall(() => positions(tradingPool(), user.id, { after: input?.after }));
    }),
    orders: api.portfolio.orders.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'read');
      await withinReadLimit(user, context.resHeaders);
      return tradingCall(() => openOrders(tradingPool(), user.id, { after: input?.after }));
    }),
    perps: api.portfolio.perps.handler(async ({ context, input }) => {
      const user = await person(context.headers, 'read');
      await withinReadLimit(user, context.resHeaders);
      return perpCall(() =>
        perpPositions(tradingPool(), user.id, { after: input?.after }, perpSource()),
      );
    }),
  },

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
        consoleCall(() => listMarkets(context.pool, context.account, { after: input?.after })),
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
        consoleCall(() => listPerps(context.pool, context.account, { after: input?.after })),
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
  },
});
