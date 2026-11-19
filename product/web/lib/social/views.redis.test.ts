import { randomUUID } from 'node:crypto';
import { visitorKeyOf } from '@hrizzup/social/address';
import { socialRedis } from '@hrizzup/social/redis';
import {
  agentUniqueKey,
  fieldOf,
  fingerprintOf,
  noteCall,
  noteOutcome,
  seenUntil,
  takeCall,
  takenOf,
  UNIQUE_SECONDS,
  VISITOR_DAILY_CAP,
  type ViewItem,
  viewTokens,
  visitorCapKey,
} from '@hrizzup/social/views';
import type { Redis } from '@upstash/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { socialCache } from './cache.ts';
import { scriptsOf } from './counting.ts';

/**
 * The view note's and the take's Lua scripts on a real Redis (docs/social/r11-design.md, section 3.13): what a stand-in
 * can't prove, that the scripts do what they say on Upstash itself. It is run on this Mac by hand, never in the
 * checks, so it is skipped unless `SOCIAL_REDIS_TEST=1` and the Upstash address and token are set, and it refuses
 * to run under any prefix but a slot's (`dev:slot<n>`): every key it makes is under that prefix, has an expiry,
 * and is deleted at the end. The client is the production one (`socialCache()`: auto-pipelining on, no retry),
 * and the scripts run through `scriptsOf`, so the EVALSHA, then EVAL on NOSCRIPT, that ships is what is proven.
 *
 *   infra/slots/slot run --doppler dev -- sh -c 'cd product/web && SOCIAL_REDIS_TEST=1 pnpm exec vitest run lib/social/views.redis.test.ts'
 *
 * It proves: once a day per device, and a second device counts; a file counts at every note; replay and reuse;
 * every key has an expiry (the day set's and the visitor counter's end by the next midnight plus 600 seconds);
 * take all leaves nothing and take some leaves the rest; an agent's merge counts the union; and the cap per
 * address: 21 fresh devices from one visitor on one post in a day count 20, a second visitor still counts, the
 * next UTC day counts again, a note with no visitor isn't capped, and a file read through a page's note is capped
 * the same way (21 notes from one address in a day count 20, another address still counts). Like the journey, it
 * waits out the three minutes before and the two after 00:00 UTC before its once-a-day cases, so a day can't
 * end in the middle of them.
 */

const enabled =
  process.env.SOCIAL_REDIS_TEST === '1' &&
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN) &&
  /^dev:slot\d+$/.test(process.env.REDIS_KEY_PREFIX ?? '');

// A made-up secret and visitors, plainly not secrets: the tokens are only ever hashes of them.
const SECRET = 'test-secret-for-the-redis-test-aaaa';
const VISITOR_A = 'visitor-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VISITOR_B = 'visitor-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

let redis: Redis;
let prefix: string;
let scripts: ReturnType<typeof scriptsOf>;
/** Every key a call named, to delete at the end. */
const made = new Set<string>();
let at: Date;

/** Waits out the minutes around 00:00 UTC, so no case straddles two days. */
async function awayFromMidnight(): Promise<void> {
  const now = new Date();
  const seconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const wait = seconds >= 86_400 - 180 ? 86_400 + 120 - seconds : seconds < 120 ? 120 - seconds : 0;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1_000));
}

type Options = { visitor?: string | null; at?: Date; requestId?: string };

/** One note through the real script. */
async function note(items: ViewItem[], device: string, options: Options = {}) {
  const when = options.at ?? at;
  const tokens = viewTokens(SECRET, device, when, options.visitor ?? null);
  const call = noteCall(
    prefix,
    { requestId: options.requestId ?? randomUUID(), items },
    tokens,
    when,
    fingerprintOf(tokens.element, items),
  );
  for (const key of call.keys) made.add(key);
  return noteOutcome(await scripts.note.exec(call.keys, call.args));
}

const post = () => ({ kind: 'post' as const, id: randomUUID() });
const file = () => ({ kind: 'file' as const, id: randomUUID() });
const device = (n: number) => `device-${String(n).padStart(4, '0')}-aaaaaaaaaaaa`;
const pending = () => socialRedis.counts.key(prefix);
const pendingOf = async (item: ViewItem) =>
  Number((await redis.hget(pending(), fieldOf(item.kind, item.id))) ?? 0);
const seenKey = (item: ViewItem, when = at) =>
  socialRedis.seen.key(
    prefix,
    when.toISOString().slice(0, 10).replaceAll('-', ''),
    item.kind,
    item.id,
  );
/** An item's visitors' hash for the day of `when`: one field for each visitor's day token. */
const capKey = (item: ViewItem, when = at) =>
  visitorCapKey(prefix, when.toISOString().slice(0, 10).replaceAll('-', ''), item.kind, item.id);
/** The devices a visitor has added to an item that day: its field of the hash. */
const capOf = async (item: ViewItem, visitor: string, when = at) =>
  Number(
    (await redis.hget(
      capKey(item, when),
      viewTokens(SECRET, 'x', when, visitor).visitor as string,
    )) ?? 0,
  );
/** Seconds from now to the end of the UTC day of `when`, plus the margin: what the day set's and the visitors' hash's TTL is at most. */
const secondsToDayEnd = (when: Date) => seenUntil(when) - Date.now() / 1000;

beforeAll(async () => {
  if (!enabled) return;
  const cache = socialCache();
  if (!cache) throw new Error('Redis is not set up');
  redis = cache.redis;
  prefix = cache.prefix;
  scripts = scriptsOf(redis);
  await awayFromMidnight();
  at = new Date();
}, 400_000);

afterAll(async () => {
  if (!enabled || !redis) return;
  const keys = [...made];
  for (let from = 0; from < keys.length; from += 100) {
    await redis.del(...keys.slice(from, from + 100));
  }
});

describe.skipIf(!enabled)('the note script on a real Redis', () => {
  it('counts once a day per device, and a second device counts', async () => {
    const item = post();
    expect(await note([item], device(1))).toEqual({ status: 'counted', counted: 1 });
    expect(await note([item], device(1))).toEqual({ status: 'counted', counted: 0 });
    expect(await pendingOf(item)).toBe(1);
    expect(await note([item], device(2))).toEqual({ status: 'counted', counted: 1 });
    expect(await pendingOf(item)).toBe(2);
    expect(await redis.scard(seenKey(item))).toBe(2);
    // Unique devices: the HyperLogLog counts each device once.
    expect(await redis.pfcount(socialRedis.unique.key(prefix, 'post', item.id))).toBe(2);
    // The device itself is nowhere in what was kept.
    const members = await redis.smembers(seenKey(item));
    expect(members.join(' ')).not.toContain('device-');
  });

  it('counts a story the same way, and several items in one note, each once', async () => {
    const [a, b] = [post(), { kind: 'story' as const, id: randomUUID() }];
    expect(await note([a, b], device(1))).toEqual({ status: 'counted', counted: 2 });
    expect(await note([a, b], device(1))).toEqual({ status: 'counted', counted: 0 });
    expect(await note([a, b], device(2))).toEqual({ status: 'counted', counted: 2 });
    expect([await pendingOf(a), await pendingOf(b)]).toEqual([2, 2]);
  });

  it('counts a file at every note, from the same device, and keeps no day set for it', async () => {
    const item = file();
    for (const n of [1, 2, 3]) {
      expect(await note([item], device(1)), `note ${n}`).toEqual({ status: 'counted', counted: 1 });
    }
    expect(await pendingOf(item)).toBe(3);
    expect(await redis.exists(seenKey(item))).toBe(0);
    expect(await redis.pfcount(socialRedis.unique.key(prefix, 'file', item.id))).toBe(1);
  });

  it('drops a retry whole, and refuses the same request ID for another note', async () => {
    const [a, b] = [post(), post()];
    const requestId = randomUUID();
    expect(await note([a], device(1), { requestId })).toEqual({ status: 'counted', counted: 1 });
    // The same ID with the same note, from the same device: a retry, nothing added.
    expect(await note([a], device(1), { requestId })).toEqual({ status: 'replay', counted: 0 });
    // The same ID with another note: reused, and nothing of it counted.
    expect(await note([b], device(1), { requestId })).toEqual({ status: 'reused', counted: 0 });
    expect(await note([a], device(2), { requestId })).toEqual({ status: 'reused', counted: 0 });
    expect(await pendingOf(a)).toBe(1);
    expect(await pendingOf(b)).toBe(0);
    expect(await redis.exists(seenKey(b))).toBe(0);
  });

  it('gives every key an expiry: the day set’s and the counter’s end by the next midnight plus 600 seconds', async () => {
    const item = post();
    const requestId = randomUUID();
    await note([item], device(1), { requestId, visitor: VISITOR_A });
    const ttl = async (key: string) => redis.ttl(key);
    // Every key the call named exists and has a time left.
    const named = [...made].filter((key) => key.includes(item.id) || key.includes(requestId));
    expect(named.length).toBeGreaterThanOrEqual(4);
    for (const key of named) expect(await ttl(key), key).toBeGreaterThan(0);
    expect(await ttl(pending())).toBeGreaterThan(0);
    expect(await ttl(pending())).toBeLessThanOrEqual(86_400);
    expect(await ttl(socialRedis.note.key(prefix, requestId))).toBeLessThanOrEqual(3_600);
    expect(await ttl(socialRedis.unique.key(prefix, 'post', item.id))).toBeLessThanOrEqual(
      UNIQUE_SECONDS,
    );
    expect(await ttl(socialRedis.unique.key(prefix, 'post', item.id))).toBeGreaterThan(
      UNIQUE_SECONDS - 30,
    );
    // The day set and the visitor's counter end together: by the next midnight plus 600 seconds, and not early.
    const ends = secondsToDayEnd(at);
    for (const key of [seenKey(item), capKey(item)]) {
      const left = await ttl(key);
      expect(left, key).toBeLessThanOrEqual(Math.ceil(ends) + 1);
      expect(left, key).toBeGreaterThan(Math.floor(ends) - 30);
    }
  });
});

describe.skipIf(!enabled)('the take script on a real Redis', () => {
  const fill = async (items: ViewItem[]) => {
    for (const item of items) await note([item], device(1));
  };

  it('takes only the given fields with `some`, and leaves the rest', async () => {
    const [a, b, c] = [post(), post(), post()];
    await fill([a, b, c]);
    const call = takeCall(prefix, [
      fieldOf('post', a.id),
      fieldOf('post', c.id),
      fieldOf('post', randomUUID()),
    ]);
    if (!call) throw new Error('A take of some fields makes a call');
    const { taken, dropped } = takenOf(await scripts.take.exec(call.keys, call.args));
    expect(taken).toEqual(
      new Map([
        [fieldOf('post', a.id), 1],
        [fieldOf('post', c.id), 1],
      ]),
    );
    expect(dropped).toBe(0);
    // What was taken is gone from the hash, what was left is still there; a second take finds nothing.
    expect(await redis.hexists(pending(), fieldOf('post', a.id))).toBe(0);
    expect(await redis.hexists(pending(), fieldOf('post', c.id))).toBe(0);
    expect(await redis.hexists(pending(), fieldOf('post', b.id))).toBe(1);
    const again = await scripts.take.exec(call.keys, call.args);
    expect(takenOf(again).taken.size).toBe(0);
  });

  it('takes the whole hash with `all`, which leaves nothing', async () => {
    const [a, b] = [post(), post()];
    await fill([a, b]);
    const call = takeCall(prefix, 'all');
    if (!call) throw new Error('A take of all makes a call');
    const { taken } = takenOf(await scripts.take.exec(call.keys, call.args));
    expect(taken.get(fieldOf('post', a.id))).toBe(1);
    expect(taken.get(fieldOf('post', b.id))).toBe(1);
    expect(await redis.exists(pending())).toBe(0);
    // Taking again finds an empty hash and makes none.
    expect(takenOf(await scripts.take.exec(call.keys, call.args)).taken.size).toBe(0);
    expect(await redis.exists(pending())).toBe(0);
  });

  it('makes no call for no fields, so the whole hash is never taken by mistake', async () => {
    const a = post();
    await fill([a]);
    expect(takeCall(prefix, [])).toBeNull();
    // A script call with the mode `some` and no field takes nothing.
    const call = { keys: [pending()], args: ['some'] };
    expect(takenOf(await scripts.take.exec(call.keys, call.args)).taken.size).toBe(0);
    expect(await redis.hexists(pending(), fieldOf('post', a.id))).toBe(1);
  });
});

describe.skipIf(!enabled)('an agent’s unique readers on a real Redis', () => {
  it('counts the union of its posts’ HyperLogLogs: a device that saw two posts is one reader', async () => {
    const [a, b] = [post(), post()];
    await note([a], device(1));
    await note([a], device(2));
    await note([b], device(2));
    await note([b], device(3));
    const union = agentUniqueKey(prefix, 'views', randomUUID());
    made.add(union);
    const keys = [a, b].map((item) => socialRedis.unique.key(prefix, 'post', item.id));
    const answers = await redis
      .multi()
      .pfcount(keys[0] as string)
      .pfcount(keys[1] as string)
      .pfmerge(union, ...keys)
      .expire(union, UNIQUE_SECONDS)
      .pfcount(union)
      .exec();
    expect(answers[0]).toBe(2);
    expect(answers[1]).toBe(2);
    expect(answers[4]).toBe(3);
    expect(await redis.ttl(union)).toBeGreaterThan(0);
  });
});

describe.skipIf(!enabled)('the cap per address on a real Redis', () => {
  it('counts 20 of 21 fresh devices from one visitor on one post in one day', async () => {
    const item = post();
    const results: number[] = [];
    for (let n = 1; n <= VISITOR_DAILY_CAP + 1; n++) {
      const outcome = await note([item], device(n), { visitor: VISITOR_A });
      expect(outcome.status).toBe('counted');
      results.push(outcome.counted);
    }
    expect(VISITOR_DAILY_CAP).toBe(20);
    expect(results.filter((counted) => counted === 1)).toHaveLength(20);
    expect(results.slice(0, 20).every((counted) => counted === 1)).toBe(true);
    expect(results[20]).toBe(0);
    // The capped note left nothing behind: no day-set entry, no pending increment, no HyperLogLog element.
    expect(await pendingOf(item)).toBe(20);
    expect(await redis.scard(seenKey(item))).toBe(20);
    expect(await redis.pfcount(socialRedis.unique.key(prefix, 'post', item.id))).toBe(20);
    expect(await capOf(item, VISITOR_A)).toBe(20);
    // A device already seen is still just a repeat, and a capped device is still refused.
    expect((await note([item], device(1), { visitor: VISITOR_A })).counted).toBe(0);
    expect((await note([item], device(21), { visitor: VISITOR_A })).counted).toBe(0);
    expect(await pendingOf(item)).toBe(20);
  });

  it('still counts a second visitor on the same post, with its own counter', async () => {
    const item = post();
    for (let n = 1; n <= VISITOR_DAILY_CAP + 1; n++)
      await note([item], device(n), { visitor: VISITOR_A });
    expect((await note([item], device(100), { visitor: VISITOR_B })).counted).toBe(1);
    expect((await note([item], device(101), { visitor: VISITOR_B })).counted).toBe(1);
    expect(await pendingOf(item)).toBe(22);
    expect(await capOf(item, VISITOR_B)).toBe(2);
    expect(await capOf(item, VISITOR_A)).toBe(20);
    // Two visitors, two fields of one hash.
    expect(await redis.hlen(capKey(item))).toBe(2);
  });

  it('caps each item on its own: a capped post does not stop a new one in the same note', async () => {
    const [a, b] = [post(), post()];
    for (let n = 1; n <= VISITOR_DAILY_CAP; n++) await note([a], device(n), { visitor: VISITOR_A });
    const outcome = await note([a, b], device(99), { visitor: VISITOR_A });
    expect(outcome).toEqual({ status: 'counted', counted: 1 });
    expect(await pendingOf(a)).toBe(20);
    expect(await pendingOf(b)).toBe(1);
  });

  it('counts again on the next UTC day, from the same visitor and devices, under that day’s own counter', async () => {
    const item = post();
    for (let n = 1; n <= VISITOR_DAILY_CAP + 1; n++)
      await note([item], device(n), { visitor: VISITOR_A });
    const tomorrow = new Date(at.getTime() + 24 * 3_600_000);
    expect((await note([item], device(21), { visitor: VISITOR_A, at: tomorrow })).counted).toBe(1);
    expect((await note([item], device(1), { visitor: VISITOR_A, at: tomorrow })).counted).toBe(1);
    expect(await pendingOf(item)).toBe(22);
    expect(await capOf(item, VISITOR_A, tomorrow)).toBe(2);
    expect(await capOf(item, VISITOR_A)).toBe(20);
    // Two days' hashes are two keys, and no two names are alike.
    expect(capKey(item, tomorrow)).not.toBe(capKey(item));
    // Tomorrow's hash ends a day later, by that day's own midnight plus 600 seconds.
    expect(await redis.ttl(capKey(item, tomorrow))).toBeGreaterThan(86_400 - 60);
  });

  it('counts 20 of 21 notes from different addresses of one IPv6 /64 on one post: rotating through a block gets nowhere', async () => {
    const item = post();
    const results: number[] = [];
    for (let n = 1; n <= VISITOR_DAILY_CAP + 1; n++) {
      const address = `2001:db8:1:2:${n.toString(16)}:${(n * 7).toString(16)}::${n.toString(16)}`;
      results.push(
        (await note([item], device(n), { visitor: visitorKeyOf(address, false) })).counted,
      );
    }
    expect(results.filter((counted) => counted === 1)).toHaveLength(20);
    expect(results[20]).toBe(0);
    expect(await pendingOf(item)).toBe(20);
    // The next /64 is another visitor, and an IPv4 address another again.
    const next = visitorKeyOf('2001:db8:1:3::1', false);
    expect((await note([item], device(100), { visitor: next })).counted).toBe(1);
    expect(
      (await note([item], device(101), { visitor: visitorKeyOf('203.0.113.7', false) })).counted,
    ).toBe(1);
    // The same address written as IPv4-mapped is the same IPv4 visitor.
    expect(visitorKeyOf('::ffff:203.0.113.7', false)).toBe(visitorKeyOf('203.0.113.7', false));
  });

  it('caps notes with no address in one shared bucket where addresses are expected, and not elsewhere', async () => {
    const item = post();
    const shared = visitorKeyOf(null, true);
    expect(shared).toBe('none');
    const results: number[] = [];
    for (let n = 1; n <= VISITOR_DAILY_CAP + 1; n++) {
      results.push((await note([item], device(n), { visitor: shared })).counted);
    }
    expect(results.filter((counted) => counted === 1)).toHaveLength(20);
    expect(results[20]).toBe(0);
    // An address that can be told apart is not in that bucket.
    expect(
      (await note([item], device(200), { visitor: visitorKeyOf('203.0.113.9', true) })).counted,
    ).toBe(1);
    // Elsewhere (a preview, this Mac) a note with no address is not capped.
    expect(visitorKeyOf(null, false)).toBeNull();
    const open = post();
    for (let n = 1; n <= VISITOR_DAILY_CAP + 3; n++) {
      expect((await note([open], device(n), { visitor: visitorKeyOf(null, false) })).counted).toBe(
        1,
      );
    }
    // No key holds the literal bucket name.
    for (const key of made) expect(key).not.toContain(':none');
  });

  it('does not cap a note with no visitor, and writes no counter for it', async () => {
    const item = post();
    for (let n = 1; n <= VISITOR_DAILY_CAP + 5; n++) {
      expect((await note([item], device(n))).counted, `device ${n}`).toBe(1);
    }
    expect(await pendingOf(item)).toBe(VISITOR_DAILY_CAP + 5);
    expect(await redis.exists(capKey(item))).toBe(0);
  });

  it('caps a file read through a page’s note per address: 21 notes from one address in a day count 20, and another address still counts', async () => {
    const item = file();
    const results: number[] = [];
    // A file counts at every note (D15), from the same device too: only the address's own count stops it.
    for (let n = 1; n <= VISITOR_DAILY_CAP + 1; n++) {
      results.push((await note([item], device(1), { visitor: VISITOR_A })).counted);
    }
    expect(results.filter((counted) => counted === 1)).toHaveLength(20);
    expect(results.slice(0, 20).every((counted) => counted === 1)).toBe(true);
    expect(results[20]).toBe(0);
    expect(await pendingOf(item)).toBe(20);
    expect(await capOf(item, VISITOR_A)).toBe(20);
    // A capped note left nothing behind: no pending increment, no HyperLogLog element of its own.
    expect((await note([item], device(2), { visitor: VISITOR_A })).counted).toBe(0);
    expect(await pendingOf(item)).toBe(20);
    // Another address still counts, with its own counter, and the file still keeps no day set.
    expect((await note([item], device(3), { visitor: VISITOR_B })).counted).toBe(1);
    expect((await note([item], device(3), { visitor: VISITOR_B })).counted).toBe(1);
    expect(await pendingOf(item)).toBe(22);
    expect(await capOf(item, VISITOR_B)).toBe(2);
    expect(await redis.hlen(capKey(item))).toBe(2);
    expect(await redis.exists(seenKey(item))).toBe(0);
    // The counter ends with the day, like a post's.
    const left = await redis.ttl(capKey(item));
    const ends = secondsToDayEnd(at);
    expect(left).toBeLessThanOrEqual(Math.ceil(ends) + 1);
    expect(left).toBeGreaterThan(Math.floor(ends) - 30);
  });

  it('caps a file on its own: a capped file does not stop a post in the same note, and a post does not use the file’s count', async () => {
    const [f, p] = [file(), post()];
    for (let n = 1; n <= VISITOR_DAILY_CAP; n++) await note([f], device(n), { visitor: VISITOR_A });
    expect(await note([f, p], device(99), { visitor: VISITOR_A })).toEqual({
      status: 'counted',
      counted: 1,
    });
    expect(await pendingOf(f)).toBe(20);
    expect(await pendingOf(p)).toBe(1);
  });

  it('does not cap a file note with no visitor, and writes no counter for it', async () => {
    const item = file();
    for (let n = 1; n <= VISITOR_DAILY_CAP + 5; n++) {
      expect((await note([item], device(n))).counted, `read ${n}`).toBe(1);
    }
    expect(await pendingOf(item)).toBe(VISITOR_DAILY_CAP + 5);
    expect(await redis.exists(capKey(item))).toBe(0);
  });

  it('keeps no address, visitor or device in any key it made', async () => {
    const item = post();
    await note([item], device(1), { visitor: VISITOR_A });
    for (const key of made) {
      expect(key).not.toContain(VISITOR_A);
      expect(key).not.toContain('device-');
    }
    const members = await redis.smembers(seenKey(item));
    expect(members.join(' ')).not.toContain(VISITOR_A);
    // The visitor's token is a field of the item's hash, never part of a key's name, and the hash holds nothing else.
    const token = viewTokens(SECRET, 'x', at, VISITOR_A).visitor as string;
    for (const key of made) expect(key).not.toContain(token);
    expect(await redis.hkeys(capKey(item))).toEqual([token]);
  });
});
