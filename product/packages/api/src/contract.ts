import { type ContractRouterClient, oc } from '@orpc/contract';
import { z } from 'zod';

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

export type Meta = { caching: Caching };

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
};

export type Contract = typeof contract;

/** A typed client for the whole API, the same shape on the website and in the app. */
export type Api = ContractRouterClient<Contract>;

export type Health = z.infer<typeof health>;
export type Me = z.infer<typeof me>;
