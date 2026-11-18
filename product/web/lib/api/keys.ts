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
import { socialRedis } from '@hrizzup/social';
import { isUuid } from '@hrizzup/social/uuid';
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
 * - **A key is an account's** (`read` or `trade`, made on the keys page) **or an agent's** (`post`,
 *   social's posting key, docs/social/build.md section 7.14): one text, one hash, one lookup
 *   (`keys.find`), told apart by its kind.
 * - **Who a key is** is kept in Upstash Redis for a minute (`stg:key:v2:<hash>`, with its kind, never
 *   anything personal in the name), so a busy bot costs the database one lookup a minute. Revoking
 *   writes "none" over it at once, and the database stamps every trade with its key and refuses a
 *   revoked one, so a revoked key never trades again. If Redis is slow or down, the database is
 *   asked: Redis is never the only copy. `key:v1` is what a deployment from before posting keys
 *   kept: it is read beside v2 (only to honour a revocation it wrote) and never written by a lookup.
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

/**
 * A live key, as the database found it by its hash: an account's (`read` or `trade`, whose account is
 * `userId`) or an agent's posting key (`post`, whose agent is `agentId`).
 */
export type FoundKey =
  | { id: string; kind: 'read' | 'trade'; userId: string }
  | { id: string; kind: 'post'; agentId: string };

// Who a key is ------------------------------------------------------------------------------------

/** How long Redis keeps who a key is (or that it isn't one). */
export const KEY_CACHE_SECONDS = socialRedis.keyCopy.seconds;
/** How long a lookup waits for Redis before asking the database. */
const REDIS_TIMEOUT_MS = 500;
const REVOKED = 'none';
const HASH_HEX = /^[0-9a-f]{64}$/;

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

/** What a deployment from before posting keys kept: who a read or trading key is, or "none". */
const oldCopyName = (hashHex: string) => redisKey(cachePrefix ?? '', 'key', 'v1', hashHex);
/** What this code keeps, with the key's kind (`socialRedis.keyCopy`). */
const copyName = (hashHex: string) => socialRedis.keyCopy.key(cachePrefix ?? '', hashHex);

function withTimeout<T>(work: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), REDIS_TIMEOUT_MS);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * A key as a copy or the database's answer holds it, or null when it isn't a whole one: an ID, a kind,
 * and the account (read, trade) or agent (post) it belongs to, each a UUID. Anything else, whatever
 * else it carries, is rebuilt from these fields alone.
 */
function foundOf(value: unknown): FoundKey | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, kind, userId, agentId } = value as Record<string, unknown>;
  if (!isUuid(id)) return null;
  if ((kind === 'read' || kind === 'trade') && isUuid(userId)) return { id, kind, userId };
  if (kind === 'post' && isUuid(agentId)) return { id, kind, agentId };
  return null;
}

/**
 * What Redis holds for a hash: a key, "not a key", or nothing (also when Redis fails, or what it holds
 * isn't a whole copy). One `MGET` reads v2 and v1 together:
 *
 * - v2 "none": a revoked key.
 * - v2 a posting key's copy: that, whatever v1 says (a deployment from before posting keys cached
 *   every key it didn't know as a v1 miss, a posting key included).
 * - v2 a read or trading key's copy: that, unless v1 says "none" (a revocation from before posting
 *   keys wrote only v1).
 * - Otherwise nothing: v1 alone never answers, so the database does.
 */
async function fromCache(hashHex: string): Promise<FoundKey | null | undefined> {
  const redis = keyCache();
  if (!redis) return undefined;
  try {
    const held = await withTimeout(redis.mget<unknown[]>(oldCopyName(hashHex), copyName(hashHex)));
    if (!Array.isArray(held)) return undefined;
    const [old, current] = held;
    if (current === REVOKED) return null;
    const copy = foundOf(current);
    if (copy === null) return undefined;
    if (copy.kind !== 'post' && old === REVOKED) return null;
    return copy;
  } catch {
    return undefined;
  }
}

/**
 * Keeps what the database said for a minute, unless something is already kept (`NX`): a revoke that
 * landed in between has written "none", and a lookup must never write over it. Never writes v1.
 */
async function toCache(hashHex: string, found: FoundKey | null): Promise<void> {
  const redis = keyCache();
  if (!redis) return;
  try {
    await withTimeout(
      redis.set(copyName(hashHex), found ?? REVOKED, { ex: KEY_CACHE_SECONDS, nx: true }),
    );
  } catch {
    // Redis failed: the next request asks the database again.
  }
}

/**
 * Marks revoked keys' hashes "none" in Redis, in v1 and v2, over whatever was kept (not `NX`), in one
 * pipeline, trying twice. A revocation (an account's key, an agent's) runs in this order: the database,
 * then this, then any purge. Never throws for Redis, which is never the only copy (the database
 * refuses a revoked key's trades anyway, and its reads once the copy expires, within a minute); it
 * throws a `TypeError` for a hash that isn't 64 lower-case hex characters, Redis set up or not.
 */
export async function revokeAgentKeys(hashes: string[]): Promise<void> {
  for (const hash of hashes) {
    if (typeof hash !== 'string' || !HASH_HEX.test(hash)) {
      throw new TypeError('A key is named by its hash: 64 hex characters');
    }
  }
  if (hashes.length === 0) return;
  const redis = keyCache();
  if (!redis) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const pipeline = redis.pipeline();
      for (const hash of hashes) {
        pipeline.set(oldCopyName(hash), REVOKED, { ex: KEY_CACHE_SECONDS });
        pipeline.set(copyName(hash), REVOKED, { ex: KEY_CACHE_SECONDS });
      }
      const done = await withTimeout(pipeline.exec());
      if (done !== undefined) return;
    } catch {
      // Tried again once; if Redis still fails, the copy expires within a minute.
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

/** The live key with this text, whatever its kind, or null for none (never made, or revoked). */
export async function findKey(pool: Database, text: string): Promise<FoundKey | null> {
  const hash = hashKey(text);
  const hashHex = hash.toString('hex');
  const held = await fromCache(hashHex);
  if (held !== undefined) return held;
  const row = await one<{
    id: string;
    kind: string;
    user_id?: string;
    agent_id?: string;
  } | null>(pool, null, 'select keys.find($1) as answer', [hash]);
  const found = row
    ? foundOf({ id: row.id, kind: row.kind, userId: row.user_id, agentId: row.agent_id })
    : null;
  await toCache(hashHex, found);
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
    await revokeAgentKeys([answer.secret_hash]);
    return { key: asKey(answer.key), revokedAt: answer.key.revoked_at ?? new Date().toISOString() };
  });
}
