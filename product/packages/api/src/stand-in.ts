import { implement, ORPCError } from '@orpc/server';
import type { ConsoleMarketWithLog } from './console.ts';
import { contract } from './contract.ts';
import * as examples from './examples.ts';

/**
 * A stand-in implementation of the whole contract that answers with the example answers
 * (examples.ts): for screens built before their back end (TRACKER.md, stages 4a and 4b), and
 * for tests. `signedIn: false` makes `me` answer as when nobody is signed in; `admin: false`
 * makes the market console's calls answer as they do for anyone but an admin ("No such call").
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

  return api.router({
    health: api.health.handler(() => examples.health),
    me: api.me.handler(() => {
      if (!signedIn) throw new ORPCError('UNAUTHORIZED');
      return examples.me;
    }),
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
    },
  });
}
