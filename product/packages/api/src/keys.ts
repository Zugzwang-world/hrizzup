import { z } from 'zod';
import { moment } from './console.ts';

/**
 * API keys for bots (PLAN.md step 3.5a; docs/research/public-api.md, section 2.2): each person's own
 * keys, made, listed and revoked by the person signed in on the website (never with a key, so a
 * leaked key can't make another), each read-only or trading. A bot sends its key as
 * `Authorization: Bearer <key>` (Manifold's `Authorization: Key <key>` works too) to read its own
 * balance, positions and orders, and, with a trading key, to trade. Keys work on staging, the demo,
 * until production's API opens at launch.
 *
 * A key is shown once, when it's made; the books keep only its hash and its first characters.
 */

/** read: your own balance, positions and orders; trade: those, and trading and the perp. */
export const keyScope = z.enum(['read', 'trade']);

/** A key's ID. */
export const keyId = z.uuid("Must be the key's ID");

/** A key as the keys page shows it: never the key itself. */
export const apiKey = z.object({
  id: keyId,
  /** The name its owner gave it. */
  name: z.string().min(1).max(60),
  scope: keyScope,
  /** Its first characters, to tell it apart: `hz_demo_` and four more. */
  shown: z.string().regex(/^hz_(demo|live)_[A-Za-z0-9]{4}$/),
  createdAt: moment,
  /** When it last signed a request, to the minute; null if never. */
  lastUsedAt: moment.nullable(),
});

/** The person's live keys, newest first (five at most). */
export const keyList = z.object({ keys: z.array(apiKey) });

/** A new key: a name of 1 to 60 characters, and what it may do. */
export const createKeyInput = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Give the key a name')
    .max(60, 'A name of 60 characters at most')
    .refine((name) => !/\p{Cc}/u.test(name), { message: 'A name with no control characters' }),
  scope: keyScope,
});

/** The new key, and its text, shown this once and never again. */
export const createdKey = z.object({
  key: apiKey,
  /** The key itself: `hz_demo_` and 43 letters and digits. Shown only now; keep it secret. */
  secret: z.string().regex(/^hz_(demo|live)_[A-Za-z0-9]{43}$/),
});

/** Revoking one of the person's own live keys: it stops working at once, and never works again. */
export const revokeKeyInput = z.strictObject({ id: keyId });

/** The revoked key. */
export const revokedKey = z.object({ key: apiKey, revokedAt: moment });

/** Why a new key was refused. */
export const keyRefusal = z.enum([
  /** The person already holds five live keys: revoke one first. */
  'too_many_keys',
]);

/** The errors the keys' calls may answer, besides a refused input (400, BAD_REQUEST). */
export const keyErrors = {
  UNAUTHORIZED: { status: 401, message: 'Not signed in' },
  FORBIDDEN: {
    status: 403,
    message: 'Keys are made and revoked only when signed in on the website, never with a key',
  },
  NOT_FOUND: { status: 404, message: 'No such live key of yours' },
  REFUSED: {
    status: 422,
    message: 'You hold five live keys: revoke one first',
    data: z.object({ reason: keyRefusal }),
  },
  TOO_MANY_REQUESTS: {
    status: 429,
    message: 'At most ten new keys an hour: try again later',
    data: z.object({ retryAfterSeconds: z.number().int().positive() }),
  },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Keys are not set up here' },
} as const;

/** What a personal or trading call answers when a key can't be used for it. */
export const forbidden = {
  status: 403,
  message: 'This key may not make this call',
} as const;

export type KeyScope = z.infer<typeof keyScope>;
export type ApiKey = z.infer<typeof apiKey>;
export type KeyList = z.infer<typeof keyList>;
export type CreateKeyInput = z.output<typeof createKeyInput>;
export type CreatedKey = z.infer<typeof createdKey>;
export type RevokeKeyInput = z.output<typeof revokeKeyInput>;
export type RevokedKey = z.infer<typeof revokedKey>;
export type KeyRefusal = z.infer<typeof keyRefusal>;
