import { implement, ORPCError } from '@orpc/server';
import type { ConsoleMarketWithLog } from './console.ts';
import { contract } from './contract.ts';
import * as examples from './examples.ts';
import type { ConsolePerpWithLog } from './perps.ts';

/**
 * A stand-in implementation of the whole contract that answers with the example answers
 * (examples.ts): for screens built before their back end (TRACKER.md, stages 4a and 4b), and
 * for tests. `signedIn: false` makes `me`, trading and the portfolio answer as when nobody is
 * signed in; `admin: false` makes the market console's calls answer as they do for anyone but an
 * admin ("No such call").
 */
export function standIn(options: { signedIn?: boolean; admin?: boolean } = {}) {
  const api = implement(contract);
  const signedIn = options.signedIn !== false;
  const admin = signedIn && options.admin !== false;

  /** The market console's calls answer anyone but an admin as an address the API doesn't have. */
  const asAdmin = () => {
    if (!admin) throw new ORPCError('NOT_FOUND', { message: 'No such call' });
  };
  const example = (id: string): ConsoleMarketWithLog => {
    if (id !== examples.consoleMarketWithLog.id) {
      throw new ORPCError('NOT_FOUND', { message: 'No such market' });
    }
    return examples.consoleMarketWithLog;
  };

  const perp = (id: string): ConsolePerpWithLog => {
    if (id !== examples.consolePerpWithLog.id) {
      throw new ORPCError('NOT_FOUND', { message: 'No such perp' });
    }
    return examples.consolePerpWithLog;
  };

  /** Trading and the portfolio need someone signed in. */
  const asPerson = () => {
    if (!signedIn) throw new ORPCError('UNAUTHORIZED', { message: 'Not signed in' });
  };
  /** Trading needs a market the list has: the stand-in trades only the example market. */
  const tradable = (marketId: string) => {
    if (marketId !== examples.tradeResult.marketId) {
      throw new ORPCError('NOT_FOUND', { message: 'No such market' });
    }
  };

  return api.router({
    health: api.health.handler(() => examples.health),
    auth: {
      settings: api.auth.settings.handler(() => examples.authSettings),
      emailCode: api.auth.emailCode.handler(({ input }) => {
        // As the real call: an answer the bot check refuses is refused; the stand-in takes any other.
        if (input.botCheck === 'refused') {
          throw new ORPCError('BOT_CHECK_FAILED', {
            status: 403,
            message: "The bot check didn't pass",
          });
        }
        const email = input.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new ORPCError('INVALID_EMAIL', {
            status: 400,
            message: 'Not a valid email address',
          });
        }
        return { ...examples.emailCodeSent, email };
      }),
    },
    me: api.me.handler(() => {
      if (!signedIn) throw new ORPCError('UNAUTHORIZED');
      return examples.me;
    }),
    markets: {
      list: api.markets.list.handler(() => examples.marketList),
      trade: api.markets.trade.handler(({ input }) => {
        asPerson();
        tradable(input.marketId);
        if (input.action === 'sell') {
          // Selling the example's Yes shares back: the pool returns to 50%.
          return {
            ...examples.tradeResult,
            requestId: input.requestId,
            outcome: input.outcome,
            amount: '-24.999999',
            shares: '-49.390243',
            orderAmount: null,
            probBefore: examples.tradeResult.probAfter,
            probAfter: '0.50000000',
            balance: '999.999999',
            position: { yes: '0.000000', no: '0.000000' },
          };
        }
        // As the real call: an expiry that isn't in the future is refused (here, with no answer to
        // replay, always).
        if (input.expiresAt !== undefined && Date.parse(input.expiresAt) <= Date.now()) {
          throw new ORPCError('BAD_REQUEST', { message: 'An expiry must be in the future' });
        }
        const example =
          input.limitProb === undefined ? examples.tradeResult : examples.restingOrder;
        return { ...example, requestId: input.requestId, outcome: input.outcome };
      }),
      cancelOrder: api.markets.cancelOrder.handler(({ input }) => {
        asPerson();
        tradable(input.marketId);
        if (input.orderId !== examples.restingOrder.tradeId) {
          throw new ORPCError('REFUSED', { data: { reason: 'no_open_order' } });
        }
        return { ...examples.cancelOrderResult, requestId: input.requestId };
      }),
    },
    perps: {
      list: api.perps.list.handler(() => ({ perps: [examples.perpDetails] })),
      get: api.perps.get.handler(({ input }) => {
        if (input.id !== examples.perpDetails.id) {
          throw new ORPCError('NOT_FOUND', { message: 'No such perp' });
        }
        return examples.perpDetails;
      }),
      open: api.perps.open.handler(({ input }) => {
        asPerson();
        if (input.perpId !== examples.perpDetails.id) {
          throw new ORPCError('NOT_FOUND', { message: 'No such perp' });
        }
        // As the real call: more than 10 times leverage is refused.
        if (Number(input.leverage) > 10) {
          throw new ORPCError('REFUSED', { data: { reason: 'leverage_too_high' } });
        }
        return { ...examples.perpOpened, requestId: input.requestId };
      }),
      close: api.perps.close.handler(({ input }) => {
        asPerson();
        if (input.perpId !== examples.perpDetails.id) {
          throw new ORPCError('NOT_FOUND', { message: 'No such perp' });
        }
        return { ...examples.perpClosed, requestId: input.requestId };
      }),
    },
    portfolio: {
      positions: api.portfolio.positions.handler(() => {
        asPerson();
        return examples.positionsPage;
      }),
      perps: api.portfolio.perps.handler(() => {
        asPerson();
        return examples.perpPositionsPage;
      }),
      orders: api.portfolio.orders.handler(() => {
        asPerson();
        return examples.ordersPage;
      }),
    },
    admin: {
      markets: {
        list: api.admin.markets.list.handler(() => {
          asAdmin();
          return { markets: [examples.consoleMarket], next: null };
        }),
        get: api.admin.markets.get.handler(({ input }) => {
          asAdmin();
          return example(input.id);
        }),
        create: api.admin.markets.create.handler(({ input }) => {
          asAdmin();
          const now = new Date().toISOString();
          return {
            ...examples.consoleMarketWithLog,
            id: input.id,
            question: input.question,
            categories: input.categories,
            rules: input.rules,
            source: input.source,
            opensAt: input.opensAt,
            closesAt: input.closesAt,
            state: 'draft',
            createdAt: now,
            updatedAt: now,
            startingProbability: input.probability,
            seed: input.seed,
            pool: { yes: '0.000000', no: '0.000000' },
            probability: null,
            held: '0.000000',
            listed: input.listed,
            log: examples.consoleMarketWithLog.log
              .filter((line) => line.action === 'create')
              .map((line) => ({ ...line, at: now })),
          };
        }),
        open: api.admin.markets.open.handler(({ input }) => {
          asAdmin();
          const market = example(input.id);
          if (market.state !== 'draft') {
            throw new ORPCError('CONFLICT', {
              message: `Only a draft opens: this market is ${market.state}`,
            });
          }
          return market;
        }),
        close: api.admin.markets.close.handler(({ input }) => {
          asAdmin();
          return { ...example(input.id), state: 'closed' };
        }),
        settle: api.admin.markets.settle.handler(({ input }) => {
          asAdmin();
          const market = example(input.id);
          throw new ORPCError('CONFLICT', {
            message: `Only a closed market is settled: this market is ${market.state}`,
          });
        }),
      },
      perps: {
        list: api.admin.perps.list.handler(() => {
          asAdmin();
          return { perps: [examples.consolePerp], next: null };
        }),
        get: api.admin.perps.get.handler(({ input }) => {
          asAdmin();
          return perp(input.id);
        }),
        setMode: api.admin.perps.setMode.handler(({ input }) => {
          asAdmin();
          const found = perp(input.id);
          if (input.mode === found.tradingMode) return found;
          const at = new Date().toISOString();
          return {
            ...found,
            tradingMode: input.mode,
            updatedAt: at,
            log: [
              ...found.log,
              {
                id: found.log.length + 1,
                at,
                by: { id: examples.me.id, email: examples.me.email },
                rule: 'trading_mode',
                oldValue: found.tradingMode,
                newValue: input.mode,
                reason: input.reason,
              },
            ],
          };
        }),
        setSettings: api.admin.perps.setSettings.handler(({ input }) => {
          asAdmin();
          const found = perp(input.id);
          if (input.settings.maxLeverage !== undefined && Number(input.settings.maxLeverage) > 10) {
            throw new ORPCError('BAD_REQUEST', { message: 'Leverage is capped at 10 times' });
          }
          return { ...found, settings: { ...found.settings, ...input.settings } };
        }),
        createTest: api.admin.perps.createTest.handler(({ input }) => {
          asAdmin();
          const at = new Date().toISOString();
          return {
            ...examples.consolePerpWithLog,
            id: input.id,
            name: input.name,
            listed: false,
            settings: input.settings,
            pools: { long: input.settings.subsidyLong, short: input.settings.subsidyShort },
            fundingFrom: input.fundingFrom ?? at,
            createdAt: at,
            updatedAt: at,
            createdBy: { id: examples.me.id, email: examples.me.email },
            standIn: { ...input.standIn, ownSeed: true },
            log: [],
          };
        }),
        retireTest: api.admin.perps.retireTest.handler(({ input }) => {
          asAdmin();
          perp(input.id);
          throw new ORPCError('CONFLICT', { message: 'The listed perp is never retired' });
        }),
      },
    },
  });
}
