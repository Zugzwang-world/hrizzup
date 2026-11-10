import { createHash, randomBytes } from 'node:crypto';
import type {
  ApiKey,
  CreatedKey,
  CreateKeyInput,
  KeyList,
  KeyScope,
  RevokedKey,
} from '@hrizzup/api';
import { redisKey } from '@hrizzup/core';
import { DatabaseBusyError, errorCode, type Transaction, transaction } from '@hrizzup/db';
import { ORPCError } from '@orpc/server';
import { Redis } from '@upstash/redis';
import type { Pool } from 'pg';
import { apiKeysEnabled } from '@/lib/env.ts';

/**
 * Bots' API keys in the website's API (PLAN.md step 3.5a; the keys' database change,
 * infra/supabase/migrations/*_api_keys.sql): making a key's text, finding who a key is, and the
 * keys' calls (list, create, revoke).
 *
 * - **A key is 32 random bytes,** written as 43 letters and digits after its environment's prefix
 *   (`hz_demo_`), and shown once. The database keeps only its SHA-256 hash and its first characters.
 *   A fast hash is the standard for a secret this long (GitHub's and Stripe's tokens are stored the
 *   same way): no one can guess 256 random bits, so there's nothing for a slow hash to slow down.
 * - **Who a key is** is kept in Upstash Redis for a minute (`stg:key:v1:<hash>`, never anything
 *   personal in the name), so a busy bot costs the database one lookup a minute. Revoking writes
 *   "revoked" over it at once, and the database stamps every trade with its key and refuses a
 *   revoked one, so a revoked key never trades again. If Redis is slow or down, the database is
 *   asked: Redis is never the only copy.
 */

type Database = Pick<Pool, 'connect'>;
type Env = Readonly<Record<string, string | undefined>>;

/** Staging's, previews' and this Mac's prefix: production's API opens at launch (step 5.2). */
export const KEY_PREFIX = 'hz_demo_';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const KEY_LENGTH = 43;

/** A new key's text: the prefix and 43 letters and digits, each from a random byte below 248. */
export function makeKeyText(random: (size: number) => Uint8Array = randomBytes): string {
  let text = '';
  while (text.length < KEY_LENGTH) {
    for (const byte of random(64)) {
      // 248 is 4 × 62: bytes from 248 up are skipped, so every character is equally likely.
      if (byte < 248 && text.length < KEY_LENGTH) text += ALPHABET[byte % 62];
    }
  }
  return KEY_PREFIX + text;
}

/** The key's SHA-256 hash, all the database keeps of it. */
export function hashKey(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/** The first characters the keys page shows, to tell keys apart: the prefix and four more. */
export function shownPart(text: string): string {
  return text.slice(0, KEY_PREFIX.length + 4);
}

/** A live key, as the database found it by its hash. */
export type FoundKey = { id: string; userId: string; scope: KeyScope };

// Who a key is ------------------------------------------------------------------------------------

/** How long Redis keeps who a key is (or that it isn't one). */
export const KEY_CACHE_SECONDS = 60;
/** How long a lookup waits for Redis before asking the database. */
const REDIS_TIMEOUT_MS = 500;
const REVOKED = 'none';

let redisClient: Redis | null | undefined;
let cachePrefix: string | undefined;

/** The Redis client for the keys' copies, made once; null where Redis isn't set up. */
export function keyCache(env: Env = process.env): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  cachePrefix = env.REDIS_KEY_PREFIX;
  redisClient =
    url && token && cachePrefix
      ? new Redis({ url, token, enableAutoPipelining: true, retry: false })
      : null;
  return redisClient;
}

/** Forgets the client, so the next call makes it again from the environment (for tests). */
export function resetKeyCache(client?: Redis | null, prefix?: string): void {
  redisClient = client;
  cachePrefix = prefix;
}

const cacheName = (hash: Buffer) => redisKey(cachePrefix ?? '', 'key', 'v1', hash.toString('hex'));

function withTimeout<T>(work: Promise<T>): Promise<T | undefined> {
  return Promise.race([
    work,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), REDIS_TIMEOUT_MS)),
  ]);
}

/** What Redis holds for a hash: a key, "not a key", or nothing (also when Redis fails). */
async function fromCache(hash: Buffer): Promise<FoundKey | null | undefined> {
  const redis = keyCache();
  if (!redis) return undefined;
  try {
    const held = await withTimeout(redis.get<FoundKey | typeof REVOKED>(cacheName(hash)));
    if (held === undefined || held === null) return undefined;
    return held === REVOKED ? null : held;
  } catch {
    return undefined;
  }
}

/**
 * Keeps what the database said for a minute, unless something is already kept (`NX`): a revoke that
 * landed in between has written "revoked", and a lookup must never write over it.
 */
async function toCache(hash: Buffer, found: FoundKey | null): Promise<void> {
  const redis = keyCache();
  if (!redis) return;
  try {
    await withTimeout(
      redis.set(cacheName(hash), found ?? REVOKED, { ex: KEY_CACHE_SECONDS, nx: true }),
    );
  } catch {
    // Redis failed: the next request asks the database again.
  }
}

/** Marks a revoked key's hash revoked in Redis, over whatever was kept, trying twice. */
async function revokedInCache(hash: Buffer): Promise<void> {
  const redis = keyCache();
  if (!redis) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const done = await withTimeout(
        redis.set(cacheName(hash), REVOKED, { ex: KEY_CACHE_SECONDS }),
      );
      if (done !== undefined) return;
    } catch {
      // Tried again once; if Redis still fails, the database refuses the key's trades anyway, and
      // its reads once the copy expires, within a minute.
    }
  }
}

/** Runs one statement for `account` (null: nobody), answering its one value. */
async function one<R>(
  pool: Database,
  account: string | null,
  sql: string,
  values: unknown[],
): Promise<R> {
  return transaction(
    pool,
    async (tx: Transaction) => {
      const { rows } = await tx.query<{ answer: R }>(sql, values);
      const row = rows[0];
      if (!row) throw new Error('The database answered nothing');
      return row.answer;
    },
    { account, apiKey: null },
  );
}

/** The live key with this text, or null for none (never made, or revoked). */
export async function findKey(pool: Database, text: string): Promise<FoundKey | null> {
  const hash = hashKey(text);
  const held = await fromCache(hash);
  if (held !== undefined) return held;
  const row = await one<{ id: string; user_id: string; scope: KeyScope } | null>(
    pool,
    null,
    'select keys.verify($1) as answer',
    [hash],
  );
  const found = row ? { id: row.id, userId: row.user_id, scope: row.scope } : null;
  await toCache(hash, found);
  return found;
}

// The keys' calls -----------------------------------------------------------------------------------

type KeyRow = {
  id: string;
  name: string;
  scope: KeyScope;
  shown: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const asKey = (row: KeyRow): ApiKey => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  shown: row.shown,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

/** "Not set up here" (503) on production, where keys don't work until its API opens. */
export function keysSetUp(env: Env = process.env): void {
  if (!apiKeysEnabled(env)) {
    throw new ORPCError('SERVICE_UNAVAILABLE', {
      status: 503,
      message: 'API keys work only on staging until launch',
    });
  }
}

/** A keys call's failure in the database as the API's answer. */
function keyError(error: unknown): unknown {
  if (error instanceof DatabaseBusyError) {
    return new ORPCError('SERVICE_UNAVAILABLE', {
      status: 503,
      message: 'The database is busy: try again',
    });
  }
  switch (errorCode(error)) {
    case 'HZK01':
      return new ORPCError('REFUSED', {
        status: 422,
        message: 'You hold five live keys: revoke one first',
        data: { reason: 'too_many_keys' },
      });
    case 'HZK02': {
      const seconds = Number((error as { detail?: unknown }).detail);
      return new ORPCError('TOO_MANY_REQUESTS', {
        status: 429,
        message: 'At most ten new keys an hour: try again later',
        data: {
          retryAfterSeconds: Number.isInteger(seconds) && seconds > 0 ? seconds : 3600,
        },
      });
    }
    case 'P0002':
      return new ORPCError('NOT_FOUND', { status: 404, message: 'No such live key of yours' });
    case '22023':
      return new ORPCError('BAD_REQUEST', {
        status: 400,
        message: error instanceof Error ? error.message : 'Refused',
      });
    case '42501':
      return new ORPCError('FORBIDDEN', {
        status: 403,
        message: 'Keys are made and revoked only when signed in on the website, never with a key',
      });
    default:
      return error;
  }
}

async function keyCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw keyError(error);
  }
}

/** The signed-in account's live keys, newest first. */
export function listKeys(pool: Database, account: string): Promise<KeyList> {
  return keyCall(async () => {
    const rows = await one<KeyRow[]>(pool, account, 'select keys.list() as answer', []);
    return { keys: rows.map(asKey) };
  });
}

/** A new key for the signed-in account: its text, shown this once, and the key as listed. */
export function createKey(
  pool: Database,
  account: string,
  input: CreateKeyInput,
  random?: (size: number) => Uint8Array,
): Promise<CreatedKey> {
  return keyCall(async () => {
    const text = makeKeyText(random);
    const row = await one<KeyRow>(pool, account, 'select keys.create($1, $2, $3, $4) as answer', [
      input.name,
      input.scope,
      hashKey(text),
      shownPart(text),
    ]);
    return { key: asKey(row), secret: text };
  });
}

/** Revokes one of the signed-in account's live keys: it stops working at once. */
export function revokeKey(pool: Database, account: string, id: string): Promise<RevokedKey> {
  return keyCall(async () => {
    const answer = await one<{ key: KeyRow; secret_hash: string }>(
      pool,
      account,
      'select keys.revoke($1) as answer',
      [id],
    );
    await revokedInCache(Buffer.from(answer.secret_hash, 'hex'));
    return { key: asKey(answer.key), revokedAt: answer.key.revoked_at ?? new Date().toISOString() };
  });
}
