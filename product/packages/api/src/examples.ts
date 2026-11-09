import type { Creation, Format, Market, Shapes, Sourced, Story, Update } from '@hrizzup/agreement';
import creations from '@hrizzup/agreement/examples/creations.json' with { type: 'json' };
import markets from '@hrizzup/agreement/examples/markets.json' with { type: 'json' };
import sourced from '@hrizzup/agreement/examples/sourced.json' with { type: 'json' };
import stories from '@hrizzup/agreement/examples/stories.json' with { type: 'json' };
import updates from '@hrizzup/agreement/examples/updates.json' with { type: 'json' };
import type { ConsoleMarket, ConsoleMarketWithLog } from './console.ts';
import type { Health, Me } from './contract.ts';

/**
 * Example answers, for building screens before their back end exists (TRACKER.md, stages 4a and
 * 4b) and for the stand-in implementation (stand-in.ts). Content always comes from the
 * hand-over agreement's own examples (agreement/examples), typed by the agreement's generated
 * types; the tests check every one of them against the agreement's validators.
 */

export const health: Health = {
  status: 'ok',
  environment: 'staging',
  region: 'bom1',
  commit: '0000000000000000000000000000000000000000',
  checkedAt: '2026-11-08T09:30:00Z',
  services: { database: 'ok', redis: 'ok', storage: 'ok', auth: 'ok' },
};

export const me: Me = {
  id: '0196f1c8-7a2b-7c3d-8e4f-5a6b7c8d9e0f',
  email: 'delivered+screen-check-chromium@resend.dev',
  name: 'Screen check',
  signedInWith: 'test_account',
};

/**
 * The agreement's example records, by format. JSON files can't carry literal types, so they
 * are typed here; `examples.test.ts` proves each one passes its format's validator.
 */
export const content: { [F in Format]: readonly Shapes[F][] } = {
  'story/1': stories as unknown as Story[],
  'update/1': updates as unknown as Update[],
  'sourced/1': sourced as unknown as Sourced[],
  'creation/1': creations as unknown as Creation[],
  'market/1': markets as unknown as Market[],
};

const [market] = markets as unknown as Market[];
if (!market) throw new Error("The agreement's examples hold no market");

/**
 * A market as the market console shows it: the agreement's first example market (a test market
 * with a placeholder question, open, settled by hand), with the trading state and the log the
 * console adds, as an admin (the example account) made and opened it.
 */
export const consoleMarketWithLog: ConsoleMarketWithLog = {
  id: market.id,
  question: market.question,
  categories: market.categories,
  kind: market.kind,
  rules: market.rules,
  source: market.source,
  settlement: market.settlement,
  opensAt: market.opens_at,
  closesAt: market.closes_at,
  state: market.state,
  result: null,
  createdAt: market.created_at,
  updatedAt: market.updated_at,
  createdBy: { id: me.id, email: me.email },
  startingProbability: '0.50000000',
  seed: '1000.000000',
  pool: { yes: '1000.000000', no: '1000.000000' },
  probability: '0.50000000',
  held: '1000.000000',
  trades: 0,
  log: [
    {
      id: 1,
      action: 'create',
      at: market.created_at,
      by: { id: me.id, email: me.email },
      settlement: null,
    },
    {
      id: 2,
      action: 'open',
      at: market.opens_at,
      by: { id: me.id, email: me.email },
      settlement: null,
    },
  ],
};

/** The same market as a list shows it, without its log. */
export const consoleMarket: ConsoleMarket = (({ log: _log, ...rest }) => rest)(
  consoleMarketWithLog,
);
