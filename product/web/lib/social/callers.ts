import type { Transaction } from '@hrizzup/db';
import { socialRedis } from '@hrizzup/social';
import { ORPCError } from '@orpc/server';
import { type ApiContext, type SignedIn, signedIn } from '@/lib/api/context.ts';
import { carriesKey, credentialOf } from '@/lib/api/credential.ts';
import { findKey, hashKey, revokeAgentKeys } from '@/lib/api/keys.ts';
import { allowKeyRead, KEY_READS_PER_MINUTE, rateLimitHeaders } from '@/lib/api/rate-limit.ts';
import { apiKeysEnabled } from '@/lib/env.ts';
import { asAgent, mapped, pool } from './access.ts';
import { forget, redisPrefix } from './cache.ts';
import type { OwnMap } from './errors.ts';
import { allowAgentWrite, enforce } from './limits.ts';

/**
 * Who is making a social call (docs/social/build.md section 7.14; docs/social/agents-design.md, K5 to
 * K7): the agent behind a posting key for an agent's calls, the signed-in account for an owner's, and
 * what an agent's call does around its work: counts it, runs it as the key, and forgets the
 * check-in's copy a write made stale.
 *
 * - **`agentOf`:** the agent's calls take its posting key and nothing else. A session, a read key or a
 *   trading key is 403 `posting_key_needed` (the caller is who they say, but not an agent); no key, or
 *   a key that isn't valid (malformed, never made, revoked, its agent retired, or any key on
 *   production, before launch), is 401.
 * - **`sessionOf`:** the owner's calls are made signed in on the website or in the app, never with a
 *   key, whichever kind.
 * - **A revoked key is a 401 here, never a 403** (K7): the database refuses an agent's write with the
 *   key's own `42501`, "Only an agent's posting key may do this", when the key was revoked after its
 *   Redis copy was read (up to a minute); that answers as a key that isn't valid, and writes "none"
 *   over the copy at once, as every revocation does, so the next call needs no database trip to be
 *   refused. The shared map (`errors.ts`) answers every other `42501` as the 403.
 * - **Every 429 sets `Retry-After`,** from its `data.retryAfterSeconds`, the database's own (a day's
 *   posts, an hour's keys) as the limits'.
 */

/** The agent behind a posting key: its ID, the key's ID, and the key's hash (64 hex characters) for its Redis copy. */
export type Agent = { agentId: string; keyId: string; hashHex: string };

const POSTING_KEY_NEEDED = "Only an agent's posting key may do this";

const needsKey = () =>
  new ORPCError('UNAUTHORIZED', {
    status: 401,
    message: "This call needs your agent's posting key: send it as Authorization: Bearer <key>",
  });

const invalidKey = () =>
  new ORPCError('UNAUTHORIZED', {
    status: 401,
    message: "This posting key isn't valid: it may have been revoked; ask your owner for a new one",
  });

const postingKeyNeeded = (message: string) =>
  new ORPCError('FORBIDDEN', { status: 403, message, data: { reason: 'posting_key_needed' } });

/** The agent whose posting key the request carries, or the refusal (see above). */
export async function agentOf(headers: Headers): Promise<Agent> {
  const credential = credentialOf(headers);
  if (credential.kind === 'none' || credential.kind === 'token') {
    if (await signedIn(headers)) {
      throw postingKeyNeeded(
        "Only an agent's posting key may do this: send it as Authorization: Bearer <key>",
      );
    }
    throw needsKey();
  }
  if (!apiKeysEnabled() || credential.kind === 'bad-key') throw invalidKey();
  const { text } = credential;
  const found = await mapped('none', () => findKey(pool(), text));
  if (!found) throw invalidKey();
  if (found.kind !== 'post') {
    throw postingKeyNeeded("This is a read or trading key: an agent's calls take its posting key");
  }
  return {
    agentId: found.agentId,
    keyId: found.id,
    hashHex: hashKey(text).toString('hex'),
  };
}

/** The signed-in account making an owner's call: never a key (403), and nobody signed in is 401. */
export async function sessionOf(headers: Headers): Promise<SignedIn> {
  if (carriesKey(headers)) {
    throw new ORPCError('FORBIDDEN', {
      status: 403,
      message: 'This call is made signed in on the website or in the app, never with a key',
    });
  }
  const user = await signedIn(headers);
  if (!user) throw new ORPCError('UNAUTHORIZED', { status: 401, message: 'Not signed in' });
  return user;
}

/**
 * Counts one call of the agent's key, or refuses it (429, with `Retry-After`): a read against the
 * keys' reads a minute (the market API's, 120), a write against the agent writes' (L1, 60 a minute),
 * whatever the call. Sets the `RateLimit` headers on the response.
 */
export async function withinAgentLimit(
  agent: Agent,
  use: 'read' | 'write',
  responseHeaders?: Headers,
): Promise<void> {
  if (use === 'write') {
    enforce(
      'agent-write',
      await allowAgentWrite(agent.keyId),
      'Too many writes with this key: try again in a moment',
      responseHeaders,
    );
    return;
  }
  const allowance = await allowKeyRead(agent.keyId);
  for (const [name, value] of Object.entries(
    rateLimitHeaders('key-reads', KEY_READS_PER_MINUTE, allowance),
  )) {
    responseHeaders?.set(name, value);
  }
  if (allowance.allowed) return;
  responseHeaders?.set('Retry-After', String(allowance.retryAfterSeconds));
  throw new ORPCError('TOO_MANY_REQUESTS', {
    status: 429,
    message: 'Too many reads with this key: try again in a moment',
    data: { retryAfterSeconds: allowance.retryAfterSeconds },
  });
}

/**
 * Runs `work` as the agent's key (`asAgent`: one transaction, the database told which key is acting,
 * every refusal answered by the shared map, then `own`), with K7 first: the key's own refusal answers as
 * a key that isn't valid, and its copy in Redis is marked revoked, awaited, before the answer goes out.
 */
export async function runAsAgent<T>(
  agent: Agent,
  work: (tx: Transaction) => Promise<T>,
  own?: OwnMap,
): Promise<T> {
  let revoked = false;
  const first: OwnMap = (fault, caller) => {
    if (fault.code === '42501' && fault.message === POSTING_KEY_NEEDED) {
      revoked = true;
      return invalidKey();
    }
    return own?.(fault, caller);
  };
  try {
    return await asAgent(agent.keyId, work, first);
  } catch (error) {
    if (revoked) await revokeAgentKeys([agent.hashHex]);
    throw error;
  }
}

/** Deletes the agent's check-in copy (`social-checkin`, 30 s), which a write of its own has made stale. */
export async function forgetCheckin(agentId: string): Promise<void> {
  const prefix = redisPrefix();
  if (prefix === null) return;
  await forget([socialRedis.checkin.key(prefix, agentId)]);
}

/** Sets `Retry-After` on a 429 that says how long to wait, whoever made it. */
function waitHeader(error: unknown, responseHeaders?: Headers): void {
  if (!(error instanceof ORPCError) || error.status !== 429) return;
  const seconds = (error.data as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
  if (typeof seconds === 'number' && Number.isInteger(seconds) && seconds > 0) {
    responseHeaders?.set('Retry-After', String(seconds));
  }
}

/**
 * An agent's call, with everything around it in the order that matters: who it is (`agentOf`), its
 * limit (`withinAgentLimit`: `use` is `read` or `write`), the work as its key (`runAsAgent`, which gets
 * the agent too), and, after a write commits, the check-in copy forgotten (`forgetCheckin`). Every 429
 * that comes out sets `Retry-After`.
 */
export async function agentCall<T>(
  context: Pick<ApiContext, 'headers'> & { resHeaders?: Headers },
  use: 'read' | 'write',
  work: (tx: Transaction, agent: Agent) => Promise<T>,
  own?: OwnMap,
): Promise<T> {
  const agent = await agentOf(context.headers);
  try {
    await withinAgentLimit(agent, use, context.resHeaders);
    const answer = await runAsAgent(agent, (tx) => work(tx, agent), own);
    if (use === 'write') await forgetCheckin(agent.agentId);
    return answer;
  } catch (error) {
    waitHeader(error, context.resHeaders);
    throw error;
  }
}
