import type { social } from '@hrizzup/api';
import { socialRedis } from '@hrizzup/social/redis';
import {
  fingerprintOf,
  NOTE_SCRIPT,
  noteCall,
  TAKE_SCRIPT,
  viewTokens,
} from '@hrizzup/social/views';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSocialCache } from './cache.ts';
import { countFileRead, countViews, NoteReused, scriptsOf, within } from './counting.ts';

/**
 * Counting views and file reads (docs/social/r11-design.md, section 3.3): what a note sends to Redis, what it
 * answers for each of the script's answers, that Redis never fails a page (down, late or throwing answers 0),
 * and what a file read adds. Redis is stood in for by a client that records every script and command; the
 * scripts themselves run on a real Redis in `views.redis.test.ts` (this Mac only).
 */

const POST = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c8d';
const STORY = '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e0f';
const FILE = '01a1e7fd-0000-7a1b-9c2d-3e4f5a6b7c8d';
const AGENT = '01a1e3a0-ab00-7ef9-810c-37c5772f543f';
const REQUEST = '01a1e7ff-0000-7a1b-9c2d-3e4f5a6b7c8d';
// Made-up values, plainly not secrets: the secret check scans every branch for anything key-like.
const SECRET = 'test-secret-for-the-counting-tests';
const DEVICE = 'aaaaaaaaaaaaaaaaaaaaaa';
const NOW = new Date('2026-11-19T12:00:00.000Z');

type Command = [string, ...unknown[]];

/** A Redis client's stand-in: every script made and run, and every command of a transaction, in order. */
function standIn(answer: (keys: string[], args: string[]) => unknown = () => ['counted', 1]) {
  const made: string[] = [];
  const ran: { script: string; keys: string[]; args: string[] }[] = [];
  const transactions: Command[][] = [];
  const client = {
    createScript: vi.fn((script: string) => {
      made.push(script);
      return {
        exec: vi.fn(async (keys: string[], args: string[]) => {
          ran.push({ script, keys, args });
          return answer(keys, args);
        }),
      };
    }),
    multi: vi.fn(() => {
      const commands: Command[] = [];
      const record =
        (name: string) =>
        (...args: unknown[]) => {
          commands.push([name, ...args]);
          return pipeline;
        };
      const pipeline = {
        hincrby: record('hincrby'),
        expire: record('expire'),
        pfadd: record('pfadd'),
        exec: vi.fn(async () => {
          transactions.push(commands);
          return commands.map(() => 1);
        }),
      };
      return pipeline;
    }),
  };
  return { client, made, ran, transactions };
}

const note = (items: social.ViewNote['items'], requestId = REQUEST): social.ViewNote => ({
  requestId,
  device: DEVICE,
  items,
});

function use(redis: ReturnType<typeof standIn>['client'] | null, prefix = 'stg') {
  resetSocialCache(redis ? { redis: redis as never, prefix } : null);
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.stubEnv('SOCIAL_JOBS_SECRET', SECRET);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetSocialCache();
});

describe('a view note', () => {
  it('counts nothing where Redis is not set up', async () => {
    use(null);
    await expect(countViews(note([{ kind: 'post', id: POST }]), { address: null })).resolves.toBe(
      0,
    );
  });

  it('lower-cases every ID and keeps the first of each kind and ID', async () => {
    const redis = standIn();
    use(redis.client);
    const counted = await countViews(
      note([
        { kind: 'post', id: POST.toUpperCase() },
        { kind: 'story', id: STORY },
        { kind: 'post', id: POST },
        { kind: 'file', id: FILE },
        { kind: 'file', id: FILE.toUpperCase() },
        { kind: 'story', id: STORY.toUpperCase() },
      ]),
      { address: null },
    );
    expect(counted).toBe(1);
    const fields = redis.ran[0]?.args.slice(8).filter((_, n) => n % 2 === 0);
    expect(fields).toEqual([`post:${POST}`, `story:${STORY}`, `file:${FILE}`]);
  });

  it('runs one script with the keys, arguments and fingerprint the helpers build, the device in none of them', async () => {
    const redis = standIn();
    use(redis.client, 'dev:slot1');
    const items = [
      { kind: 'post' as const, id: POST },
      { kind: 'file' as const, id: FILE },
    ];
    await countViews(note(items, REQUEST.toUpperCase()), { address: '198.51.100.7' });
    expect(redis.made).toEqual([NOTE_SCRIPT, TAKE_SCRIPT]);
    expect(redis.ran).toHaveLength(1);
    // With an address the note is capped by it (the visitor key is the address itself, an IPv4 address whole).
    const tokens = viewTokens(SECRET, DEVICE, NOW, '198.51.100.7');
    const expected = noteCall(
      'dev:slot1',
      { requestId: REQUEST, items },
      tokens,
      NOW,
      fingerprintOf(tokens.element, items),
    );
    expect(redis.ran[0]).toEqual({ script: NOTE_SCRIPT, ...expected });
    expect(redis.ran[0]?.keys[0]).toBe(socialRedis.note.key('dev:slot1', REQUEST));
    // Neither the device nor the caller's address reaches Redis.
    const everything = JSON.stringify(redis.ran);
    expect(everything).not.toContain(DEVICE);
    expect(everything).not.toContain('198.51.100.7');
    expect(everything).not.toContain(SECRET);
  });

  it('keys its tokens with the trimmed secret, and with none on a Mac that has none', async () => {
    const withSecret = standIn();
    use(withSecret.client);
    vi.stubEnv('SOCIAL_JOBS_SECRET', `  ${SECRET}\n`);
    await countViews(note([{ kind: 'post', id: POST }]), { address: null });
    expect(withSecret.ran[0]?.args[5]).toBe(viewTokens(SECRET, DEVICE, NOW).member);

    const without = standIn();
    use(without.client);
    vi.stubEnv('SOCIAL_JOBS_SECRET', '');
    await countViews(note([{ kind: 'post', id: POST }]), { address: null });
    expect(without.ran[0]?.args[5]).toBe(viewTokens(undefined, DEVICE, NOW).member);
    expect(without.ran[0]?.args[5]).not.toBe(withSecret.ran[0]?.args[5]);
  });

  /** The capped note of an address, as the script would be called, for these items. */
  const capped = async (address: string | null, items: social.ViewNote['items']) => {
    const redis = standIn();
    use(redis.client);
    await countViews(note(items), { address });
    return redis;
  };

  it('names the counter that caps an address by the address’s day token, and keeps neither the address nor the device', async () => {
    const items = [
      { kind: 'post' as const, id: POST },
      { kind: 'file' as const, id: FILE },
    ];
    const redis = await capped('198.51.100.7', items);
    const tokens = viewTokens(SECRET, DEVICE, NOW, '198.51.100.7');
    expect(redis.ran[0]).toEqual({
      script: NOTE_SCRIPT,
      ...noteCall(
        'stg',
        { requestId: REQUEST, items },
        tokens,
        NOW,
        fingerprintOf(tokens.element, items),
      ),
    });
    // Three keys an item, and the cap as an argument.
    expect(redis.ran[0]?.keys).toHaveLength(2 + 3 * items.length);
    expect(redis.ran[0]?.keys[4]).toBe(
      socialRedis.visitorCap.key('stg', '20261119', 'post', POST, tokens.visitor as string),
    );
    expect(redis.ran[0]?.args[7]).toBe('20');
    const everything = JSON.stringify(redis.ran);
    expect(everything).not.toContain('198.51.100.7');
    expect(everything).not.toContain(DEVICE);
  });

  it('counts every address of an IPv6 /64 as one visitor, and the next /64 as another', async () => {
    const items = [{ kind: 'post' as const, id: POST }];
    const capKeyOf = async (address: string) => (await capped(address, items)).ran[0]?.keys[4];
    const home = await capKeyOf('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(home).toContain(':vcap:v1:20261119:post-');
    expect(await capKeyOf('2001:DB8:1:2::1')).toBe(home);
    expect(await capKeyOf('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(home);
    expect(await capKeyOf('2001:db8:1:3::1')).not.toBe(home);
    // An IPv4-mapped address is the IPv4 address itself.
    expect(await capKeyOf('::ffff:203.0.113.7')).toBe(await capKeyOf('203.0.113.7'));
    expect(await capKeyOf('203.0.113.8')).not.toBe(await capKeyOf('203.0.113.7'));
    // No address, and no part of the block's low half, is in any key or argument.
    const redis = await capped('2001:db8:1:2:aaaa:bbbb:cccc:dddd', items);
    const everything = JSON.stringify(redis.ran);
    for (const part of ['aaaa:bbbb', 'cccc:dddd', '2001:db8'])
      expect(everything).not.toContain(part);
  });

  it('caps a note with no address in one shared bucket where addresses are expected (staging and production)', async () => {
    const items = [{ kind: 'post' as const, id: POST }];
    for (const target of ['staging', 'production']) {
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('VERCEL_TARGET_ENV', target);
      const none = await capped(null, items);
      expect(none.ran[0]?.keys, target).toHaveLength(5);
      expect(none.ran[0]?.args[7]).toBe('20');
      const shared = viewTokens(SECRET, DEVICE, NOW, 'none').visitor as string;
      expect(none.ran[0]?.keys[4]).toBe(
        socialRedis.visitorCap.key('stg', '20261119', 'post', POST, shared),
      );
      // Two notes with no address, and a note whose address is not one, share it.
      expect((await capped(null, items)).ran[0]?.keys[4]).toBe(none.ran[0]?.keys[4]);
      expect((await capped('not an address', items)).ran[0]?.keys[4]).toBe(none.ran[0]?.keys[4]);
      // An address that can be told apart has a bucket of its own.
      expect((await capped('203.0.113.7', items)).ran[0]?.keys[4]).not.toBe(none.ran[0]?.keys[4]);
    }
    // The literal `none` is not in any key or argument: only its hash.
    expect(JSON.stringify((await capped(null, items)).ran)).not.toContain('none');
  });

  it('has no cap for a note with no address elsewhere (a preview, this Mac): the keys an item has always had, and a cap of 0', async () => {
    const items = [{ kind: 'post' as const, id: POST }];
    for (const where of [undefined, 'preview']) {
      if (where) {
        vi.stubEnv('VERCEL', '1');
        vi.stubEnv('VERCEL_TARGET_ENV', where);
      } else {
        vi.stubEnv('VERCEL', '');
      }
      const redis = await capped(null, items);
      expect(redis.ran[0]?.keys, String(where)).toHaveLength(4);
      expect(redis.ran[0]?.keys.some((key) => key.includes(':vcap:'))).toBe(false);
      expect(redis.ran[0]?.args[7]).toBe('0');
      const garbage = await capped('not an address', items);
      expect(garbage.ran[0]?.keys).toHaveLength(4);
      // An address that can be told apart is still capped, on a preview too.
      expect((await capped('203.0.113.7', items)).ran[0]?.keys).toHaveLength(5);
    }
  });

  it('answers what the script counted, 0 for a retry, and refuses a reused request ID', async () => {
    const answers: unknown[] = [
      ['counted', 2],
      ['replay', 0],
      ['reused', 0],
      ['counted', '1'],
    ];
    const redis = standIn(() => answers.shift());
    use(redis.client);
    const send = () => countViews(note([{ kind: 'post', id: POST }]), { address: null });
    await expect(send()).resolves.toBe(2);
    await expect(send()).resolves.toBe(0);
    await expect(send()).rejects.toBeInstanceOf(NoteReused);
    await expect(send()).resolves.toBe(1);
  });

  it('makes each script once for a client, so its SHA-1 is worked out once', async () => {
    const redis = standIn();
    use(redis.client);
    await countViews(note([{ kind: 'post', id: POST }]), { address: null });
    await countViews(note([{ kind: 'story', id: STORY }], '01a1e7ff-0000-7a1b-9c2d-3e4f5a6b7c8e'), {
      address: null,
    });
    expect(redis.client.createScript).toHaveBeenCalledTimes(2);
    expect(scriptsOf(redis.client as never)).toBe(scriptsOf(redis.client as never));
    expect(redis.client.createScript).toHaveBeenCalledTimes(2);
    expect(scriptsOf(standIn().client as never)).not.toBe(scriptsOf(redis.client as never));
  });

  it('answers 0 for a client that throws, and logs only the error’s name and code', async () => {
    const redis = standIn(() => {
      throw Object.assign(new Error('a message that quotes the command: aaaaaaaaaaaaaaaaaaaaaa'), {
        name: 'UpstashError',
        code: 'ECONNRESET',
      });
    });
    use(redis.client);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(countViews(note([{ kind: 'post', id: POST }]), { address: null })).resolves.toBe(
      0,
    );
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).toContain('UpstashError');
    expect(JSON.stringify(log.mock.calls)).toContain('ECONNRESET');
    expect(JSON.stringify(log.mock.calls)).not.toContain(DEVICE);
  });

  it('answers 0 for an answer that is not the script’s', async () => {
    const redis = standIn(() => 'OK');
    use(redis.client);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(countViews(note([{ kind: 'post', id: POST }]), { address: null })).resolves.toBe(
      0,
    );
  });

  it('answers 0 after 500 ms for a Redis that is slow, and never fails for what it answers later', async () => {
    let settle: (value: unknown) => void = () => undefined;
    const redis = standIn(() => new Promise((resolve) => (settle = resolve)));
    use(redis.client);
    const sent = countViews(note([{ kind: 'post', id: POST }]), { address: null });
    let done = false;
    void sent.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await expect(sent).resolves.toBe(0);
    settle(['counted', 1]);
    await vi.advanceTimersByTimeAsync(10);
  });
});

describe('waiting for Redis', () => {
  it('answers the work, or that the time ran out, and an error in time is thrown', async () => {
    await expect(within(Promise.resolve(5), 500)).resolves.toEqual({ value: 5 });
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 900));
    const waited = within(slow, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(waited).resolves.toEqual({ late: true });
    await vi.advanceTimersByTimeAsync(500);
    await expect(within(Promise.reject(new Error('down')), 500)).rejects.toThrow('down');
    // Work that fails after the wait is no unhandled rejection.
    const failing = new Promise<number>((_, reject) =>
      setTimeout(() => reject(new Error('late')), 900),
    );
    const gaveUp = within(failing, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(gaveUp).resolves.toEqual({ late: true });
    await vi.advanceTimersByTimeAsync(500);
  });
});

describe('a file read', () => {
  const pending = 'stg:count:social:v1';
  const unique = `stg:uniq:v1:file:${FILE}`;

  it('does nothing where Redis is not set up, or for an ID that is not a UUID', async () => {
    use(null);
    await expect(
      countFileRead({ fileId: FILE, agentId: AGENT, address: null }),
    ).resolves.toBeUndefined();
    const redis = standIn();
    use(redis.client);
    await countFileRead({ fileId: 'not-an-id', agentId: AGENT, address: null });
    await countFileRead({ fileId: FILE.toUpperCase(), agentId: AGENT, address: null });
    expect(redis.client.multi).not.toHaveBeenCalled();
  });

  it('adds one read and, for a posting key’s read, the agent to the file’s HyperLogLog, in one transaction', async () => {
    const redis = standIn();
    use(redis.client);
    await countFileRead({ fileId: FILE, agentId: AGENT, address: '198.51.100.7' });
    expect(redis.transactions).toEqual([
      [
        ['hincrby', pending, `file:${FILE}`, 1],
        ['expire', pending, 86_400],
        ['pfadd', unique, `a:${AGENT}`],
        ['expire', unique, 7_776_000],
      ],
    ]);
  });

  it('adds a hash of the address for a keyless read, never the address itself', async () => {
    const redis = standIn();
    use(redis.client);
    await countFileRead({ fileId: FILE, agentId: null, address: '198.51.100.7' });
    const commands = redis.transactions[0] ?? [];
    expect(commands).toHaveLength(4);
    const added = commands[2];
    expect(added?.[0]).toBe('pfadd');
    expect(String(added?.[2])).toMatch(/^i:[0-9a-f]{32}$/);
    expect(JSON.stringify(commands)).not.toContain('198.51.100.7');
  });

  it('counts the read and nothing else for a reader it cannot name', async () => {
    const redis = standIn();
    use(redis.client);
    await countFileRead({ fileId: FILE, agentId: null, address: null });
    expect(redis.transactions).toEqual([
      [
        ['hincrby', pending, `file:${FILE}`, 1],
        ['expire', pending, 86_400],
      ],
    ]);
  });

  it('never throws, and logs only the error’s name and code', async () => {
    const redis = standIn();
    redis.client.multi.mockImplementation(() => {
      throw Object.assign(new Error('quotes 198.51.100.7'), { name: 'UpstashError', code: 'X' });
    });
    use(redis.client);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      countFileRead({ fileId: FILE, agentId: null, address: '198.51.100.7' }),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).not.toContain('198.51.100.7');
  });

  it('gives up on a slow Redis after 500 ms', async () => {
    const redis = standIn();
    redis.client.multi.mockImplementation(() => {
      const pipeline = {
        hincrby: () => pipeline,
        expire: () => pipeline,
        pfadd: () => pipeline,
        exec: () => new Promise(() => undefined),
      };
      return pipeline as never;
    });
    use(redis.client);
    let done = false;
    const read = countFileRead({ fileId: FILE, agentId: AGENT, address: null }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await read;
    expect(done).toBe(true);
  });
});
