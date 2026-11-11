import { type ContractRouterClient, oc } from '@orpc/contract';
import { z } from 'zod';
import { authErrors, authSettings, emailCodeInput, emailCodeSent } from './auth.ts';
import {
  consoleMarketWithLog,
  createMarketInput,
  marketIdInput,
  marketPage,
  marketPageInput,
  settleMarketInput,
} from './console.ts';
import {
  createdKey,
  createKeyInput,
  keyErrors,
  keyList,
  revokedKey,
  revokeKeyInput,
} from './keys.ts';
import {
  marketAddress,
  marketBook,
  marketHistory,
  marketHistoryInput,
  marketQuote,
  marketQuoteInput,
  marketReadErrors,
  marketTrades,
  marketTradesInput,
  perpQuote,
  perpQuoteErrors,
  perpQuoteInput,
  price,
  priceAddress,
  priceHistory,
  priceHistoryInput,
  quoteErrors,
} from './market-data.ts';
import { commonErrors } from './paging.ts';
import {
  closePerpInput,
  consolePerpWithLog,
  createTestPerpInput,
  openPerpInput,
  perpAddress,
  perpDetails,
  perpIdInput,
  perpList,
  perpPage,
  perpPageInput,
  perpPositionsPage,
  perpPositionsPageInput,
  perpTradeResult,
  perpTradingErrors,
  retireTestPerpInput,
  setPerpModeInput,
  setPerpSettingsInput,
} from './perps.ts';
import {
  cancelOrderInput,
  cancelOrderResult,
  listedMarket,
  marketList,
  ordersPage,
  ordersPageInput,
  personalReadErrors,
  positionsPage,
  positionsPageInput,
  tradeInput,
  tradeResult,
  tradingErrors,
} from './trading.ts';

/**
 * The typed API's contract (PLAN.md step 1.5c; blueprint section 13): every call the website
 * and the app can make, with what it takes and what it answers. Contract first: a news
 * feature's calls are added here in its contract stage (TRACKER.md, stage 2), before its back
 * end, and both screens are built against them and their example answers (examples.ts). The
 * real implementation lives in the website's server code (product/web/lib/api); the app never
 * imports it.
 *
 * Served at /api/v1 (the website's route handler, on Node in Mumbai). Public reads are GET with
 * clean addresses; writes will be POST.
 */

/**
 * How a call's answer may be kept (blueprint section 14, "Caching in layers"). Every call says
 * which, here in the contract; the website's handler turns it into headers. Anything personal
 * is never kept by anyone but the person's own device, and only while it's open.
 */
export type Caching =
  | {
      kind: 'public';
      /** How long Vercel's edge serves its copy before asking again. */
      edgeSeconds: number;
      /** How long after that the edge may still serve its copy while it fetches a new one. */
      staleSeconds: number;
      /** Cache tags, so a change can clear every copy at once (Vercel-Cache-Tag). */
      tags: readonly string[];
    }
  | { kind: 'personal' };

export type Meta = {
  caching: Caching;
  /**
   * The call sends email. Such a call is a POST under `/auth/email/`, so the firewall's limit on
   * everything that sends email covers it (`/api/v1/auth/email/`: 5 requests a minute per visitor,
   * infra/vercel/firewall.json); the contract's tests hold every one to it.
   */
  sendsEmail?: true;
};

/**
 * Every call starts personal (never cached); a public read says so itself. Every call may answer the
 * common errors (paging.ts): a refused input (400, each problem in `data.issues`) and "try again in
 * a moment" (503); each adds its own below.
 */
const call = oc.$meta<Meta>({ caching: { kind: 'personal' } }).errors(commonErrors);

/**
 * What the console's calls may answer an admin: no such market or perp, a request that clashes with
 * the market's or perp's state, besides the common errors. To anyone else, each answers exactly as
 * an address the API doesn't have ("No such call", 404).
 */
const consoleErrors = {
  NOT_FOUND: { status: 404, message: 'No such market' },
  CONFLICT: { status: 409, message: "That doesn't fit the market's state" },
} as const;
const admin = call.errors(consoleErrors);

/**
 * A call that takes no input at all. Anything sent is refused (400), so a stray or random query
 * can't slip past the checks or split the edge's cache into copies nobody asked for.
 */
export const noInput = z.strictObject({}).optional();

const serviceState = z.enum(['ok', 'error', 'not_configured']);

export const health = z.object({
  /** ok: every service that's set up answers; error: one doesn't; not_configured: none is set up. */
  status: z.enum(['ok', 'error', 'not_configured']),
  environment: z.enum(['production', 'staging', 'preview', 'development']),
  /** Where the answer came from: `bom1` (Mumbai) on Vercel, `local` on a Mac. */
  region: z.string().max(40),
  /** The commit the deployment was built from, or `local`. */
  commit: z.string().max(40),
  checkedAt: z.iso.datetime(),
  services: z.object({
    database: serviceState,
    redis: serviceState,
    storage: serviceState,
    auth: serviceState,
  }),
});

export const me = z.object({
  /** The account's ID (the same on the website and in the app). */
  id: z.uuid(),
  email: z.email().nullable(),
  name: z.string().max(200).nullable(),
  /** How this session was signed in, or `api_key` for a request a bot's API key signed. */
  signedInWith: z.enum(['google', 'email', 'test_account', 'other', 'api_key']),
});

export const contract = {
  /** Whether the API and the services behind it answer. Public, kept at the edge briefly. */
  health: call
    .route({
      method: 'GET',
      path: '/health',
      summary: 'Whether the API and the services behind it answer',
      tags: ['public'],
    })
    .meta({ caching: { kind: 'public', edgeSeconds: 30, staleSeconds: 300, tags: ['health'] } })
    .input(noInput)
    .output(health),

  /**
   * Who is signed in: the website's session cookie, the app's token, or a bot's API key (whose
   * answer has no email or name). Personal.
   */
  me: call
    .route({
      method: 'GET',
      path: '/me',
      summary: 'Who is signed in',
      tags: ['personal'],
    })
    .errors(personalReadErrors)
    .input(noInput)
    .output(me),

  /**
   * The app's sign-in (PLAN.md step 1.6b; auth.ts): Supabase Auth's public settings, which the app
   * signs in with, and asking for an email code behind the bot check. Google goes through the
   * phone's browser, straight to Supabase. Both answer "not set up" (503) where sign-in isn't, as on
   * production until launch.
   */
  auth: {
    /** Supabase's address and publishable key (both public by design). Kept at the edge briefly. */
    settings: call
      .route({
        method: 'GET',
        path: '/auth/settings',
        summary: "Supabase Auth's public settings, which the app signs in with",
        tags: ['public'],
      })
      .meta({
        caching: { kind: 'public', edgeSeconds: 300, staleSeconds: 300, tags: ['auth-settings'] },
      })
      .errors({ NOT_SET_UP: authErrors.NOT_SET_UP })
      .input(noInput)
      .output(authSettings),

    /**
     * Emails a sign-in code, once our server has checked the bot check's answer with Cloudflare, as
     * the website does; the account is made if it's new. Supabase Auth sends at most one email a
     * minute to an address. Personal, never kept.
     */
    emailCode: call
      .route({
        method: 'POST',
        path: '/auth/email/code',
        summary: 'Email a sign-in code, behind the bot check',
        tags: ['auth'],
      })
      .meta({ caching: { kind: 'personal' }, sendsEmail: true })
      .errors(authErrors)
      .input(emailCodeInput)
      .output(emailCodeSent),
  },

  /**
   * The markets, for everyone (PLAN.md step 1.7d; trading.ts). The list is public, kept at Vercel's
   * edge and cleared by its tag the moment a market changes (a trade moves its price; an admin opens,
   * closes or settles it). Trading is personal, never kept: a signed-in person buys, sells and places
   * limit orders, each with a request ID of their own so a retry never trades twice, and cancels a
   * resting order; at most 30 trading calls a minute each.
   */
  markets: {
    /** The markets anyone may see, newest first, a page at a time, each with its probability now. */
    list: call
      .route({
        method: 'GET',
        path: '/markets',
        summary: 'The markets, newest first, with their probabilities',
        tags: ['public'],
      })
      .meta({
        caching: { kind: 'public', edgeSeconds: 60, staleSeconds: 300, tags: ['markets'] },
      })
      .input(marketPageInput)
      .output(marketList),

    /**
     * One market by its address, any that isn't a draft (listed or not), as the list gives it. Kept
     * at the edge and cleared, like the list, the moment the market changes.
     */
    get: call
      .route({
        method: 'GET',
        path: '/markets/{id}',
        summary: 'One market, with its probability',
        tags: ['public'],
      })
      .meta({
        caching: { kind: 'public', edgeSeconds: 60, staleSeconds: 300, tags: ['markets'] },
      })
      .errors(marketReadErrors)
      .input(marketAddress)
      .output(listedMarket),

    /**
     * A market's chance of Yes after each trade, over the last hour, day, week, 30 days or everything
     * (when not sent), at most 1,000 points. Cleared from the edge, like the list, when a trade moves
     * the market's price.
     */
    history: call
      .route({
        method: 'GET',
        path: '/markets/{id}/history',
        summary: "A market's probability after each trade",
        tags: ['public'],
      })
      .meta({
        caching: { kind: 'public', edgeSeconds: 60, staleSeconds: 300, tags: ['markets'] },
      })
      .errors(marketReadErrors)
      .input(marketHistoryInput)
      .output(marketHistory),

    /**
     * The resting limit orders by price, beside the pool's price, with no names. Cleared from the
     * edge whenever an order rests, fills or is cancelled.
     */
    book: call
      .route({
        method: 'GET',
        path: '/markets/{id}/book',
        summary: "A market's resting limit orders by price",
        tags: ['public'],
      })
      .meta({
        caching: { kind: 'public', edgeSeconds: 10, staleSeconds: 60, tags: ['market-activity'] },
      })
      .errors(marketReadErrors)
      .input(marketAddress)
      .output(marketBook),

    /** A market's latest trades, newest first, a page at a time, with no names. */
    trades: call
      .route({
        method: 'GET',
        path: '/markets/{id}/trades',
        summary: "A market's latest trades",
        tags: ['public'],
      })
      .meta({
        caching: { kind: 'public', edgeSeconds: 10, staleSeconds: 60, tags: ['market-activity'] },
      })
      .errors(marketReadErrors)
      .input(marketTradesInput)
      .output(marketTrades),

    /**
     * A quote for any size: what a buy (now or as a limit order) or a sale would do now, through the
     * same maths a trade runs, writing nothing. A trade sent next with the same figures fills exactly
     * so, unless another trade comes between (each one clears the edge's copies).
     */
    quote: call
      .route({
        method: 'GET',
        path: '/markets/{id}/quote',
        summary: 'A quote for a buy or a sale of any size',
        tags: ['public'],
      })
      .meta({
        caching: { kind: 'public', edgeSeconds: 10, staleSeconds: 60, tags: ['market-activity'] },
      })
      .errors(quoteErrors)
      .input(marketQuoteInput)
      .output(marketQuote),

    /** Buys or sells, now or as a limit order. Refused before touching the books when it can't trade. */
    trade: call
      .route({
        method: 'POST',
        path: '/trades',
        summary: 'Buy or sell in a market, now or as a limit order',
        tags: ['personal'],
      })
      .errors(tradingErrors)
      .input(tradeInput)
      .output(tradeResult),

    /** Cancels one of the person's own resting limit orders. */
    cancelOrder: call
      .route({
        method: 'POST',
        path: '/orders/cancel',
        summary: 'Cancel a resting limit order',
        tags: ['personal'],
      })
      .errors(tradingErrors)
      .input(cancelOrderInput)
      .output(cancelOrderResult),
  },

  /**
   * The Bitcoin perp, for everyone (PLAN.md step 3.4a; perps.ts): its price and details are public,
   * kept at Vercel's edge a few seconds (a new price comes every 5) and cleared by their tag when an
   * admin changes its off switch or settings. Trading is personal, never kept: a signed-in person
   * opens and closes, each with a request ID of their own so a retry never trades twice; every order
   * fills at the first price published after it was placed, so it answers within seconds. The
   * trades a minute are counted with the markets' (at most 30 a minute each).
   */
  perps: {
    /** The listed perps (the Bitcoin perp), each with its price now. */
    list: call
      .route({
        method: 'GET',
        path: '/perps',
        summary: 'The perps, with their prices now',
        tags: ['public'],
      })
      .meta({ caching: { kind: 'public', edgeSeconds: 5, staleSeconds: 10, tags: ['perps'] } })
      .input(noInput)
      .output(perpList),

    /** One perp by its address (a check run's unlisted test perp too), with its price now. */
    get: call
      .route({
        method: 'GET',
        path: '/perps/{id}',
        summary: 'One perp, with its price now',
        tags: ['public'],
      })
      .meta({ caching: { kind: 'public', edgeSeconds: 5, staleSeconds: 10, tags: ['perps'] } })
      .errors({ NOT_FOUND: perpTradingErrors.NOT_FOUND })
      .input(perpAddress)
      .output(perpDetails),

    /**
     * A quote for an open: its size, fee and liquidation price at the price now, through the same
     * maths, writing nothing. The order fills at the next price, so these move with it.
     */
    quote: call
      .route({
        method: 'GET',
        path: '/perps/{id}/quote',
        summary: 'A quote for opening a perp position',
        tags: ['public'],
      })
      .meta({ caching: { kind: 'public', edgeSeconds: 5, staleSeconds: 10, tags: ['perps'] } })
      .errors(perpQuoteErrors)
      .input(perpQuoteInput)
      .output(perpQuote),

    /** Opens a position, or adds to one, at the next new price (a flip closes the other side first). */
    open: call
      .route({
        method: 'POST',
        path: '/perps/open',
        summary: 'Open a perp position, or add to one, at the next price',
        tags: ['personal'],
      })
      .errors(perpTradingErrors)
      .input(openPerpInput)
      .output(perpTradeResult),

    /** Closes all of a position or a share of it, at the next new price. */
    close: call
      .route({
        method: 'POST',
        path: '/perps/close',
        summary: 'Close a perp position, all or part, at the next price',
        tags: ['personal'],
      })
      .errors(perpTradingErrors)
      .input(closePerpInput)
      .output(perpTradeResult),
  },

  /**
   * Our own prices (PLAN.md step 3.4b; market-data.ts): Bitcoin in US dollars, the median of three
   * big exchanges' free public prices, stored about every 5 seconds, which the perp, the website, the
   * app and every bot use. Public, kept at the edge a moment, so asking every few seconds stays cheap.
   */
  prices: {
    /** The newest price. Answers "try again in a moment" (503) before the first is stored. */
    get: call
      .route({
        method: 'GET',
        path: '/prices/{feed}',
        summary: 'Our own price now',
        tags: ['public'],
      })
      .meta({ caching: { kind: 'public', edgeSeconds: 2, staleSeconds: 5, tags: ['prices'] } })
      .input(priceAddress)
      .output(price),

    /** The price over the last hour, day (when not sent), week, 30 days or everything, at most 1,000 points. */
    history: call
      .route({
        method: 'GET',
        path: '/prices/{feed}/history',
        summary: 'Our own price over a range',
        tags: ['public'],
      })
      .meta({ caching: { kind: 'public', edgeSeconds: 5, staleSeconds: 30, tags: ['prices'] } })
      .input(priceHistoryInput)
      .output(priceHistory),
  },

  /** The signed-in person's own play money (PLAN.md step 1.7d; trading.ts). Personal, never kept. */
  portfolio: {
    /** Their balance, and their positions in markets still open or waiting to be settled. */
    positions: call
      .route({
        method: 'GET',
        path: '/me/positions',
        summary: 'Your balance and positions',
        tags: ['personal'],
      })
      .errors(personalReadErrors)
      .input(positionsPageInput)
      .output(positionsPage),

    /** Their open perp positions, newest first, each with what it's worth at the price now. */
    perps: call
      .route({
        method: 'GET',
        path: '/me/perps',
        summary: 'Your balance and perp positions',
        tags: ['personal'],
      })
      .errors(personalReadErrors)
      .input(perpPositionsPageInput)
      .output(perpPositionsPage),

    /** Their resting limit orders, newest first. */
    orders: call
      .route({
        method: 'GET',
        path: '/me/orders',
        summary: 'Your open limit orders',
        tags: ['personal'],
      })
      .errors(personalReadErrors)
      .input(ordersPageInput)
      .output(ordersPage),
  },

  /**
   * The person's API keys for bots (PLAN.md step 3.5a; keys.ts), made, listed and revoked only by
   * the person signed in on the website or in the app, never with a key: a request a key signed is
   * refused (403), so a leaked key can't make another or hide itself. A key is shown once, when it's
   * made. At most five live keys each and ten new ones an hour. Keys work on staging until launch;
   * on production these answer "not set up here" (503). Personal, never kept.
   */
  keys: {
    /** The person's live keys, newest first. */
    list: call
      .route({
        method: 'GET',
        path: '/me/keys',
        summary: 'Your API keys',
        tags: ['keys'],
      })
      .errors(keyErrors)
      .input(noInput)
      .output(keyList),

    /** A new key, read-only or trading, shown this once. */
    create: call
      .route({
        method: 'POST',
        path: '/me/keys',
        successStatus: 201,
        summary: 'Make an API key, shown once',
        tags: ['keys'],
      })
      .errors(keyErrors)
      .input(createKeyInput)
      .output(createdKey),

    /** Revokes one of the person's live keys: it stops working at once. */
    revoke: call
      .route({
        method: 'POST',
        path: '/me/keys/{id}/revoke',
        summary: 'Revoke an API key',
        tags: ['keys'],
      })
      .errors(keyErrors)
      .input(revokeKeyInput)
      .output(revokedKey),
  },

  /**
   * The market console's calls (PLAN.md step 1.7c; console.ts), and the perp's (step 3.4a;
   * perps.ts): admins only, so every market and perp write has one path, and the database checks
   * the admins table on each. Personal, never kept. To anyone but an admin, signed in or not, each
   * answers exactly as an address the API doesn't have: "No such call" (404). Only yes-or-no
   * markets are made for now.
   */
  admin: {
    markets: {
      /** Markets, newest first, a page at a time. */
      list: admin
        .route({
          method: 'GET',
          path: '/admin/markets',
          summary: 'Markets, newest first (admins only)',
          tags: ['admin'],
        })
        .input(marketPageInput)
        .output(marketPage),

      /** One market, with its log. */
      get: admin
        .route({
          method: 'GET',
          path: '/admin/markets/{id}',
          summary: 'One market, with its log (admins only)',
          tags: ['admin'],
        })
        .input(marketIdInput)
        .output(consoleMarketWithLog),

      /** A new market, as a draft: no money moves until it opens. */
      create: admin
        .route({
          method: 'POST',
          path: '/admin/markets',
          successStatus: 201,
          summary: 'Create a market, as a draft (admins only)',
          tags: ['admin'],
        })
        .input(createMarketInput)
        .output(consoleMarketWithLog),

      /** Opens a draft: betting starts at once, and the house seeds its pool. */
      open: admin
        .route({
          method: 'POST',
          path: '/admin/markets/{id}/open',
          summary: 'Open a draft market (admins only)',
          tags: ['admin'],
        })
        .input(marketIdInput)
        .output(consoleMarketWithLog),

      /** Closes an open market: betting stops at once. */
      close: admin
        .route({
          method: 'POST',
          path: '/admin/markets/{id}/close',
          summary: 'Close an open market (admins only)',
          tags: ['admin'],
        })
        .input(marketIdInput)
        .output(consoleMarketWithLog),

      /** Settles a closed market by hand, logged with its evidence: Yes, No, a set probability, or cancel. */
      settle: admin
        .route({
          method: 'POST',
          path: '/admin/markets/{id}/settle',
          summary: 'Settle a closed market by hand (admins only)',
          tags: ['admin'],
        })
        .input(settleMarketInput)
        .output(consoleMarketWithLog),
    },

    /**
     * The perp's console (PLAN.md step 3.4a; perps.ts): its off switch and settings, each change in
     * its rule-change log with its reason, and a check run's own unlisted test perps, made and
     * retired. The database checks the admins table on each, as for markets.
     */
    perps: {
      /** Perps, newest first, a page at a time: the Bitcoin perp and the check runs' test perps. */
      list: admin
        .route({
          method: 'GET',
          path: '/admin/perps',
          summary: 'Perps, newest first (admins only)',
          tags: ['admin'],
        })
        .input(perpPageInput)
        .output(perpPage),

      /** One perp, with its rule-change log. */
      get: admin
        .route({
          method: 'GET',
          path: '/admin/perps/{id}',
          summary: 'One perp, with its rule-change log (admins only)',
          tags: ['admin'],
        })
        .input(perpIdInput)
        .output(consolePerpWithLog),

      /** The off switch: on, closing only or halted, at once, with the reason in the log. */
      setMode: admin
        .route({
          method: 'POST',
          path: '/admin/perps/{id}/mode',
          summary: 'Switch a perp on, to closing only, or off (admins only)',
          tags: ['admin'],
        })
        .input(setPerpModeInput)
        .output(consolePerpWithLog),

      /** Changes some of a perp's settings, each change in the log with the reason. */
      setSettings: admin
        .route({
          method: 'POST',
          path: '/admin/perps/{id}/settings',
          summary: "Change a perp's settings (admins only)",
          tags: ['admin'],
        })
        .input(setPerpSettingsInput)
        .output(consolePerpWithLog),

      /** A check run's own unlisted test perp, switched off, its pools seeded by the house. */
      createTest: admin
        .route({
          method: 'POST',
          path: '/admin/perps',
          successStatus: 201,
          summary: "Make a check run's own test perp (admins only)",
          tags: ['admin'],
        })
        .input(createTestPerpInput)
        .output(consolePerpWithLog),

      /** Retires a test perp once every position on it is closed: its pools back to the house. */
      retireTest: admin
        .route({
          method: 'POST',
          path: '/admin/perps/{id}/retire',
          summary: 'Retire a test perp (admins only)',
          tags: ['admin'],
        })
        .input(retireTestPerpInput)
        .output(consolePerpWithLog),
    },
  },
};

export type Contract = typeof contract;

/** A typed client for the whole API, the same shape on the website and in the app. */
export type Api = ContractRouterClient<Contract>;

export type Health = z.infer<typeof health>;
export type Me = z.infer<typeof me>;
