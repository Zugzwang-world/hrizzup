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
  consolePerpWithLog,
  createTestPerpInput,
  perpIdInput,
  perpPage,
  perpPageInput,
  retireTestPerpInput,
  setPerpModeInput,
  setPerpSettingsInput,
} from './perps.ts';
import {
  cancelOrderInput,
  cancelOrderResult,
  marketList,
  ordersPage,
  ordersPageInput,
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

/** Every call starts personal (never cached); a public read says so itself. */
const call = oc.$meta<Meta>({ caching: { kind: 'personal' } });

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
  /** How this session was signed in. */
  signedInWith: z.enum(['google', 'email', 'test_account', 'other']),
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

  /** Who is signed in: the website's session cookie, or the app's token. Personal. */
  me: call
    .route({
      method: 'GET',
      path: '/me',
      summary: 'Who is signed in',
      tags: ['personal'],
    })
    .errors({ UNAUTHORIZED: { status: 401, message: 'Not signed in' } })
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
      .errors({ UNAUTHORIZED: tradingErrors.UNAUTHORIZED })
      .input(positionsPageInput)
      .output(positionsPage),

    /** Their resting limit orders, newest first. */
    orders: call
      .route({
        method: 'GET',
        path: '/me/orders',
        summary: 'Your open limit orders',
        tags: ['personal'],
      })
      .errors({ UNAUTHORIZED: tradingErrors.UNAUTHORIZED })
      .input(ordersPageInput)
      .output(ordersPage),
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
      list: call
        .route({
          method: 'GET',
          path: '/admin/markets',
          summary: 'Markets, newest first (admins only)',
          tags: ['admin'],
        })
        .input(marketPageInput)
        .output(marketPage),

      /** One market, with its log. */
      get: call
        .route({
          method: 'GET',
          path: '/admin/markets/{id}',
          summary: 'One market, with its log (admins only)',
          tags: ['admin'],
        })
        .input(marketIdInput)
        .output(consoleMarketWithLog),

      /** A new market, as a draft: no money moves until it opens. */
      create: call
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
      open: call
        .route({
          method: 'POST',
          path: '/admin/markets/{id}/open',
          summary: 'Open a draft market (admins only)',
          tags: ['admin'],
        })
        .input(marketIdInput)
        .output(consoleMarketWithLog),

      /** Closes an open market: betting stops at once. */
      close: call
        .route({
          method: 'POST',
          path: '/admin/markets/{id}/close',
          summary: 'Close an open market (admins only)',
          tags: ['admin'],
        })
        .input(marketIdInput)
        .output(consoleMarketWithLog),

      /** Settles a closed market by hand, logged with its evidence: Yes, No, a set probability, or cancel. */
      settle: call
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
      list: call
        .route({
          method: 'GET',
          path: '/admin/perps',
          summary: 'Perps, newest first (admins only)',
          tags: ['admin'],
        })
        .input(perpPageInput)
        .output(perpPage),

      /** One perp, with its rule-change log. */
      get: call
        .route({
          method: 'GET',
          path: '/admin/perps/{id}',
          summary: 'One perp, with its rule-change log (admins only)',
          tags: ['admin'],
        })
        .input(perpIdInput)
        .output(consolePerpWithLog),

      /** The off switch: on, closing only or halted, at once, with the reason in the log. */
      setMode: call
        .route({
          method: 'POST',
          path: '/admin/perps/{id}/mode',
          summary: 'Switch a perp on, to closing only, or off (admins only)',
          tags: ['admin'],
        })
        .input(setPerpModeInput)
        .output(consolePerpWithLog),

      /** Changes some of a perp's settings, each change in the log with the reason. */
      setSettings: call
        .route({
          method: 'POST',
          path: '/admin/perps/{id}/settings',
          summary: "Change a perp's settings (admins only)",
          tags: ['admin'],
        })
        .input(setPerpSettingsInput)
        .output(consolePerpWithLog),

      /** A check run's own unlisted test perp, switched off, its pools seeded by the house. */
      createTest: call
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
      retireTest: call
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
