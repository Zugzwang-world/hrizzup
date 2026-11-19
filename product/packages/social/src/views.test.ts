import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { socialRedis } from './redis.ts';
import {
  agentUniqueKey,
  fieldOf,
  fingerprintOf,
  itemOf,
  NOTE_ITEMS_MAX,
  NOTE_SCRIPT,
  NOTE_SECONDS,
  noteCall,
  noteOutcome,
  PENDING_SECONDS,
  readerToken,
  SEEN_MARGIN_SECONDS,
  seenUntil,
  TAKE_SCRIPT,
  takeCall,
  takenOf,
  UNIQUE_SECONDS,
  utcDay,
  VISITOR_DAILY_CAP,
  viewTokens,
} from './views.ts';

/**
 * Counting views in Redis (docs/social/r11-design.md, section 3.2): the names, the order of a script's keys and
 * arguments, the day's boundary, the tokens (and that the device itself is in none of them), the fingerprint, the
 * checks on what the scripts answer, and that the scripts read every key from `KEYS`. Expected hashes are worked
 * out here with node:crypto, never written down. The scripts themselves run on a real Redis in
 * `views.redis.test.ts` (this Mac only).
 */

const POST = '01a1e7fc-c300-7a1b-9c2d-3e4f5a6b7c8d';
const STORY = '01a1e7f8-1a00-7c3d-8e4f-5a6b7c8d9e0f';
const FILE = '01a1e7fd-0000-7a1b-9c2d-3e4f5a6b7c8d';
const AGENT = '01a1e3a0-ab00-7ef9-810c-37c5772f543f';
const REQUEST = '01a1e7ff-0000-7a1b-9c2d-3e4f5a6b7c8d';
// Made-up values, plainly not secrets: the secret check scans every branch for anything key-like.
const SECRET = 'test-secret-for-the-views-tests-aaaa';
const DEVICE = 'aaaaaaaaaaaaaaaaaaaaaa';
const NOON = new Date('2026-11-19T12:00:00.000Z');

const hmac = (text: string, secret: string = SECRET) =>
  createHmac('sha256', secret).update(text).digest('hex').slice(0, 32);
const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32);

describe('the names', () => {
  it('are socialRedis’s, under the environment’s prefix', () => {
    const call = noteCall(
      'dev:slot1',
      {
        requestId: REQUEST.toUpperCase(),
        items: [
          { kind: 'post', id: POST },
          { kind: 'file', id: FILE },
        ],
      },
      viewTokens(SECRET, DEVICE, NOON),
      NOON,
      'f'.repeat(32),
    );
    expect(call.keys).toEqual([
      socialRedis.note.key('dev:slot1', REQUEST),
      socialRedis.counts.key('dev:slot1'),
      socialRedis.seen.key('dev:slot1', '20261119', 'post', POST),
      socialRedis.unique.key('dev:slot1', 'post', POST),
      socialRedis.seen.key('dev:slot1', '20261119', 'file', FILE),
      socialRedis.unique.key('dev:slot1', 'file', FILE),
    ]);
    for (const key of call.keys) expect(key.startsWith('dev:slot1:')).toBe(true);
  });

  it('give an agent’s two HyperLogLogs their own names, and refuse what is not an ID', () => {
    expect(agentUniqueKey('stg', 'views', AGENT)).toBe(`stg:uniq:v1:agent-views:${AGENT}`);
    expect(agentUniqueKey('pre', 'reads', AGENT)).toBe(`pre:uniq:v1:agent-reads:${AGENT}`);
    expect(() => agentUniqueKey('stg', 'views', 'not-an-id')).toThrow(TypeError);
    expect(() => agentUniqueKey('prod', 'views', AGENT)).toThrow(/prefix/);
  });

  it('take their lifetimes from socialRedis', () => {
    expect([
      NOTE_SECONDS,
      PENDING_SECONDS,
      UNIQUE_SECONDS,
      SEEN_MARGIN_SECONDS,
      NOTE_ITEMS_MAX,
    ]).toEqual([3_600, 86_400, 7_776_000, 600, 50]);
    expect(NOTE_SECONDS).toBe(socialRedis.note.seconds);
    expect(PENDING_SECONDS).toBe(socialRedis.counts.seconds);
    expect(UNIQUE_SECONDS).toBe(socialRedis.unique.seconds);
  });
});

describe('the fields', () => {
  it('make an item into a field and back, and refuse anything else', () => {
    expect(fieldOf('post', POST)).toBe(`post:${POST}`);
    expect(itemOf(`story:${STORY}`)).toEqual({ kind: 'story', id: STORY });
    expect(itemOf(`file:${FILE}`)).toEqual({ kind: 'file', id: FILE });
    for (const bad of [
      `agent:${AGENT}`,
      `post:${POST.toUpperCase()}`,
      `post:${POST} `,
      'post:',
      'post:123',
      POST,
      '',
    ]) {
      expect(itemOf(bad), bad).toBeNull();
    }
    expect(() => fieldOf('agent' as never, POST)).toThrow(TypeError);
    expect(() => fieldOf('post', POST.toUpperCase())).toThrow(TypeError);
  });
});

describe('the day', () => {
  it('ends at midnight UTC: 23:59:59.999Z is that day, 00:00Z the next', () => {
    expect(utcDay(new Date('2026-11-19T23:59:59.999Z'))).toBe('20261119');
    expect(utcDay(new Date('2026-11-20T00:00:00.000Z'))).toBe('20261120');
    expect(utcDay(new Date('2026-12-31T23:59:59.999Z'))).toBe('20261231');
    expect(utcDay(new Date('2027-01-01T00:00:00.000Z'))).toBe('20270101');
  });

  it('gives a day’s set the next midnight plus 600 seconds, always after now', () => {
    const midnight = Date.parse('2026-11-20T00:00:00.000Z') / 1000;
    expect(seenUntil(NOON)).toBe(midnight + 600);
    expect(seenUntil(new Date('2026-11-19T23:59:59.999Z'))).toBe(midnight + 600);
    // At 00:00:00.000 the day is the new one, and its set ends a day later.
    expect(seenUntil(new Date('2026-11-20T00:00:00.000Z'))).toBe(midnight + 86_400 + 600);
    // The end of a month and of a year.
    expect(seenUntil(new Date('2026-12-31T12:00:00.000Z'))).toBe(
      Date.parse('2027-01-01T00:00:00.000Z') / 1000 + 600,
    );
    for (const at of [
      NOON,
      new Date('2026-11-19T23:59:59.999Z'),
      new Date('2026-11-20T00:00:00.000Z'),
    ]) {
      expect(seenUntil(at)).toBeGreaterThan(at.getTime() / 1000);
    }
  });
});

describe('the tokens', () => {
  it('are the HMACs the design gives, keyed with the secret', () => {
    const tokens = viewTokens(SECRET, DEVICE, NOON);
    expect(tokens.member).toBe(hmac(`social-view-day\n20261119\n${DEVICE}`));
    expect(tokens.element).toBe(`d:${hmac(`social-view-device\n${DEVICE}`)}`);
    expect(tokens.member).toMatch(/^[0-9a-f]{32}$/);
    expect(tokens.element).toMatch(/^d:[0-9a-f]{32}$/);
  });

  it('give one device and day one member, another day another, and the same element across days', () => {
    const today = viewTokens(SECRET, DEVICE, NOON);
    expect(viewTokens(SECRET, DEVICE, new Date('2026-11-19T01:00:00.000Z')).member).toBe(
      today.member,
    );
    const tomorrow = viewTokens(SECRET, DEVICE, new Date('2026-11-20T12:00:00.000Z'));
    expect(tomorrow.member).not.toBe(today.member);
    expect(tomorrow.element).toBe(today.element);
    expect(viewTokens(SECRET, 'bbbbbbbbbbbbbbbbbbbbbb', NOON).member).not.toBe(today.member);
    expect(viewTokens('another-secret-for-the-tests-aaaa', DEVICE, NOON).member).not.toBe(
      today.member,
    );
  });

  it('are plain SHA-256 of the same text with no secret, so a raw device is still never kept', () => {
    for (const none of [undefined, '']) {
      const tokens = viewTokens(none, DEVICE, NOON);
      expect(tokens.member).toBe(sha(`social-view-day\n20261119\n${DEVICE}`));
      expect(tokens.element).toBe(`d:${sha(`social-view-device\n${DEVICE}`)}`);
      expect(JSON.stringify(tokens)).not.toContain(DEVICE);
    }
  });

  it('name a file’s reader: an agent, a hash of an address, or none', () => {
    expect(readerToken(SECRET, { agentId: AGENT, address: '198.51.100.7' })).toBe(`a:${AGENT}`);
    const keyless = readerToken(SECRET, { agentId: null, address: '198.51.100.7' });
    expect(keyless).toBe(`i:${hmac('social-file-reader\n198.51.100.7')}`);
    expect(keyless).not.toContain('198.51.100.7');
    expect(readerToken(undefined, { agentId: null, address: '198.51.100.7' })).toBe(
      `i:${sha('social-file-reader\n198.51.100.7')}`,
    );
    expect(readerToken(SECRET, { agentId: null, address: null })).toBeNull();
  });
});

describe('the fingerprint', () => {
  const items = [
    { kind: 'post' as const, id: POST },
    { kind: 'story' as const, id: STORY },
  ];

  it('is the first 32 hex characters of the SHA-256 of the device token and the items, in the note’s order', () => {
    const element = viewTokens(SECRET, DEVICE, NOON).element;
    expect(fingerprintOf(element, items)).toBe(sha(`${element}\npost:${POST},story:${STORY}`));
    expect(fingerprintOf(element, items)).toBe(fingerprintOf(element, [...items]));
  });

  it('changes with the order, the items and the device', () => {
    const element = viewTokens(SECRET, DEVICE, NOON).element;
    const reversed = [...items].reverse();
    expect(fingerprintOf(element, reversed)).not.toBe(fingerprintOf(element, items));
    expect(fingerprintOf(element, items.slice(0, 1))).not.toBe(fingerprintOf(element, items));
    expect(
      fingerprintOf(viewTokens(SECRET, 'bbbbbbbbbbbbbbbbbbbbbb', NOON).element, items),
    ).not.toBe(fingerprintOf(element, items));
  });
});

describe('a note’s call', () => {
  const tokens = viewTokens(SECRET, DEVICE, NOON);
  const items = [
    { kind: 'post' as const, id: POST },
    { kind: 'story' as const, id: STORY },
    { kind: 'file' as const, id: FILE },
  ];
  const call = noteCall('stg', { requestId: REQUEST, items }, tokens, NOON, 'c'.repeat(32));

  it('has its keys and arguments in the order the script reads them', () => {
    expect(call.keys).toHaveLength(2 + 2 * items.length);
    expect(call.keys[0]).toBe(`stg:note:v1:${REQUEST}`);
    expect(call.keys[1]).toBe('stg:count:social:v1');
    expect(call.keys.slice(2)).toEqual([
      `stg:seen:v1:20261119:post:${POST}`,
      `stg:uniq:v1:post:${POST}`,
      `stg:seen:v1:20261119:story:${STORY}`,
      `stg:uniq:v1:story:${STORY}`,
      `stg:seen:v1:20261119:file:${FILE}`,
      `stg:uniq:v1:file:${FILE}`,
    ]);
    expect(call.args).toEqual([
      'c'.repeat(32),
      '3600',
      '86400',
      String(seenUntil(NOON)),
      '7776000',
      tokens.member,
      tokens.element,
      '0',
      `post:${POST}`,
      'once',
      `story:${STORY}`,
      'once',
      `file:${FILE}`,
      'every',
    ]);
  });

  it('matches the script’s own index arithmetic, item by item', () => {
    // With no visitor, item i's day set is KEYS[1 + 2i], its HyperLogLog KEYS[2 + 2i], its field ARGV[7 + 2i] and
    // its mode ARGV[8 + 2i] (the script's indexes start at 1).
    items.forEach((item, n) => {
      const i = n + 1;
      expect(call.keys[1 + 2 * i - 1]).toContain(`:seen:v1:20261119:${item.kind}:${item.id}`);
      expect(call.keys[2 + 2 * i - 1]).toContain(`:uniq:v1:${item.kind}:${item.id}`);
      expect(call.args[7 + 2 * i - 1]).toBe(fieldOf(item.kind, item.id));
      expect(call.args[8 + 2 * i - 1]).toBe(item.kind === 'file' ? 'every' : 'once');
    });
    expect((call.keys.length - 2) / 2).toBe(items.length);
  });

  it('holds no raw device ID in any key or argument', () => {
    expect(JSON.stringify(call)).not.toContain(DEVICE);
  });

  it('refuses an ID that is not a UUID in lower case, and an environment that is not one', () => {
    expect(() =>
      noteCall(
        'stg',
        { requestId: REQUEST, items: [{ kind: 'post', id: 'x' }] },
        tokens,
        NOON,
        'c',
      ),
    ).toThrow(TypeError);
    expect(() => noteCall('prod', { requestId: REQUEST, items }, tokens, NOON, 'c')).toThrow(
      /prefix/,
    );
    expect(() => noteCall('stg', { requestId: 'nope', items }, tokens, NOON, 'c')).toThrow(
      TypeError,
    );
  });
});

describe('the cap per address', () => {
  const VISITOR = 'visitor-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const items = [
    { kind: 'post' as const, id: POST },
    { kind: 'story' as const, id: STORY },
    { kind: 'file' as const, id: FILE },
  ];

  it('is 20 views of one item, from one address, in one UTC day', () => {
    expect(VISITOR_DAILY_CAP).toBe(20);
  });

  it('names its counter by the HMAC of the visitor and the day, keyed like the day tokens', () => {
    const tokens = viewTokens(SECRET, DEVICE, NOON, VISITOR);
    expect(tokens.visitor).toBe(hmac(`social-view-visitor\n20261119\n${VISITOR}`));
    expect(tokens.visitor).toMatch(/^[0-9a-f]{32}$/);
    // The same visitor and day give the same token; another day, another visitor or another secret do not.
    expect(viewTokens(SECRET, 'bbbbbbbbbbbbbbbbbbbbbb', NOON, VISITOR).visitor).toBe(
      tokens.visitor,
    );
    expect(viewTokens(SECRET, DEVICE, new Date('2026-11-19T01:00:00.000Z'), VISITOR).visitor).toBe(
      tokens.visitor,
    );
    expect(
      viewTokens(SECRET, DEVICE, new Date('2026-11-20T12:00:00.000Z'), VISITOR).visitor,
    ).not.toBe(tokens.visitor);
    expect(
      viewTokens(SECRET, DEVICE, NOON, 'visitor-bbbbbbbbbbbbbbbbbbbbbbbbbbbb').visitor,
    ).not.toBe(tokens.visitor);
    expect(viewTokens('another-secret-for-the-tests-aaaa', DEVICE, NOON, VISITOR).visitor).not.toBe(
      tokens.visitor,
    );
    // It never equals the device's tokens.
    expect([tokens.member, tokens.element.slice(2)]).not.toContain(tokens.visitor);
  });

  it('is plain SHA-256 of the same text with no secret, and none at all with no visitor', () => {
    expect(viewTokens(undefined, DEVICE, NOON, VISITOR).visitor).toBe(
      sha(`social-view-visitor\n20261119\n${VISITOR}`),
    );
    for (const none of [null, '', undefined]) {
      expect(viewTokens(SECRET, DEVICE, NOON, none as never).visitor).toBeNull();
    }
    expect(viewTokens(SECRET, DEVICE, NOON).visitor).toBeNull();
  });

  it('gives each item a third key, the visitor’s counter for it, and the cap as an argument', () => {
    const tokens = viewTokens(SECRET, DEVICE, NOON, VISITOR);
    const call = noteCall('stg', { requestId: REQUEST, items }, tokens, NOON, 'c'.repeat(32));
    const token = tokens.visitor as string;
    expect(call.keys).toHaveLength(2 + 3 * items.length);
    expect(call.keys.slice(2)).toEqual([
      `stg:seen:v1:20261119:post:${POST}`,
      `stg:uniq:v1:post:${POST}`,
      `stg:vcap:v1:20261119:post-${POST}:${token}`,
      `stg:seen:v1:20261119:story:${STORY}`,
      `stg:uniq:v1:story:${STORY}`,
      `stg:vcap:v1:20261119:story-${STORY}:${token}`,
      `stg:seen:v1:20261119:file:${FILE}`,
      `stg:uniq:v1:file:${FILE}`,
      `stg:vcap:v1:20261119:file-${FILE}:${token}`,
    ]);
    expect(call.args.slice(0, 8)).toEqual([
      'c'.repeat(32),
      '3600',
      '86400',
      String(seenUntil(NOON)),
      '7776000',
      tokens.member,
      tokens.element,
      '20',
    ]);
    // With a visitor, item i's keys are KEYS[3i], KEYS[3i + 1] and KEYS[3i + 2]; its field and mode are as before.
    items.forEach((item, n) => {
      const i = n + 1;
      expect(call.keys[3 * i - 1]).toContain(`:seen:v1:20261119:${item.kind}:${item.id}`);
      expect(call.keys[3 * i]).toContain(`:uniq:v1:${item.kind}:${item.id}`);
      expect(call.keys[3 * i + 1]).toBe(
        socialRedis.visitorCap.key('stg', '20261119', item.kind, item.id, token),
      );
      expect(call.args[7 + 2 * i - 1]).toBe(fieldOf(item.kind, item.id));
      expect(call.args[8 + 2 * i - 1]).toBe(item.kind === 'file' ? 'every' : 'once');
    });
    expect((call.keys.length - 2) / 3).toBe(items.length);
  });

  it('gives a note with no visitor the keys it has always had, and no cap (0)', () => {
    const tokens = viewTokens(SECRET, DEVICE, NOON, null);
    const call = noteCall('stg', { requestId: REQUEST, items }, tokens, NOON, 'c'.repeat(32));
    expect(call.keys).toHaveLength(2 + 2 * items.length);
    expect(call.keys.some((key) => key.includes(':vcap:'))).toBe(false);
    expect(call.args[7]).toBe('0');
  });

  it('keeps neither the visitor nor the device in any key or argument', () => {
    const call = noteCall(
      'stg',
      { requestId: REQUEST, items },
      viewTokens(SECRET, DEVICE, NOON, VISITOR),
      NOON,
      'c'.repeat(32),
    );
    const everything = JSON.stringify(call);
    expect(everything).not.toContain(VISITOR);
    expect(everything).not.toContain(DEVICE);
  });

  it('is in the script: a counter below the cap is read before the device is added, and the counter ends with the day’s set', () => {
    // The script checks the counter first, then adds the device, bumps the counter and gives it the day set's expiry.
    const order = [
      "redis.call('SISMEMBER', seen, ARGV[6])",
      "redis.call('GET', KEYS[at + 3])",
      "redis.call('SADD', seen, ARGV[6])",
      "redis.call('EXPIREAT', seen, ARGV[4])",
      "redis.call('INCR', KEYS[at + 3])",
      "redis.call('EXPIREAT', KEYS[at + 3], ARGV[4])",
      "redis.call('HINCRBY', KEYS[2], field, 1)",
      "redis.call('PFADD', uniq, ARGV[7])",
    ].map((call) => NOTE_SCRIPT.indexOf(call));
    for (const found of order) expect(found).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // A file ('every') never reaches the cap: only 'once' items are checked.
    expect(NOTE_SCRIPT).toContain("if mode == 'once' then");
    expect(NOTE_SCRIPT).toContain('if cap > 0 then stride = 3 end');
  });
});

describe('what a note answers', () => {
  it('reads all three statuses, whatever the client parsed them as', () => {
    expect(noteOutcome(['counted', 2])).toEqual({ status: 'counted', counted: 2 });
    expect(noteOutcome(['counted', '3'])).toEqual({ status: 'counted', counted: 3 });
    expect(noteOutcome(['replay', 0])).toEqual({ status: 'replay', counted: 0 });
    expect(noteOutcome(['reused', 0])).toEqual({ status: 'reused', counted: 0 });
  });

  it('throws a TypeError for anything else, never quoting it', () => {
    for (const bad of [
      null,
      undefined,
      'counted',
      ['counted'],
      ['other', 1],
      ['counted', -1],
      ['counted', 1.5],
      ['counted', 'x'],
      ['counted', 1, 2],
      {},
    ]) {
      expect(() => noteOutcome(bad), JSON.stringify(bad)).toThrow(TypeError);
    }
    try {
      noteOutcome(['secret-looking-text', 1]);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('secret-looking-text');
    }
  });
});

describe('a take', () => {
  it('takes the whole hash with `all`', () => {
    expect(takeCall('stg', 'all')).toEqual({ keys: ['stg:count:social:v1'], args: ['all'] });
  });

  it('takes only the given fields with `some`', () => {
    const fields = [`post:${POST}`, `story:${STORY}`];
    expect(takeCall('stg', fields)).toEqual({
      keys: ['stg:count:social:v1'],
      args: ['some', ...fields],
    });
  });

  it('makes no call for no fields, so an empty request never takes the whole hash', () => {
    expect(takeCall('stg', [])).toBeNull();
  });

  it('reads the taken fields and counts, in either of the client’s forms', () => {
    const answer = takenOf([`post:${POST}`, '3', `story:${STORY}`, 5, `file:${FILE}`, '1']);
    expect(answer.taken).toEqual(
      new Map([
        [`post:${POST}`, 3],
        [`story:${STORY}`, 5],
        [`file:${FILE}`, 1],
      ]),
    );
    expect(answer.dropped).toBe(0);
    expect(takenOf([])).toEqual({ taken: new Map(), dropped: 0 });
  });

  it('drops a malformed field or count, and counts what it dropped', () => {
    const answer = takenOf([
      `post:${POST}`,
      '2',
      'agent:nope',
      '4',
      `story:${STORY}`,
      '0',
      `file:${FILE}`,
      '1.5',
      `post:${POST.replace('01a1', '01a2')}`,
      '-3',
      `post:${STORY}`,
      'x',
      'dangling-field',
    ]);
    expect(answer.taken).toEqual(new Map([[`post:${POST}`, 2]]));
    expect(answer.dropped).toBe(6);
  });

  it('throws a TypeError for an answer that is not a list', () => {
    for (const bad of [null, undefined, 'OK', 5, {}]) {
      expect(() => takenOf(bad)).toThrow(TypeError);
    }
  });
});

describe('the scripts', () => {
  /** Every quoted word of a script: a command, a mode, an answer. None may be a key's name. */
  const quoted = (script: string) =>
    [...script.matchAll(/'([^']*)'/g)].map((found) => found[1] as string);
  const WORDS = new Set([
    'GET',
    'SET',
    'EX',
    'SADD',
    'SISMEMBER',
    'INCR',
    'EXPIREAT',
    'HINCRBY',
    'PFADD',
    'EXPIRE',
    'HGETALL',
    'DEL',
    'HMGET',
    'HDEL',
    'replay',
    'reused',
    'counted',
    'once',
    'all',
  ]);

  it('read every key from KEYS: no quoted key name, and no `..` building one', () => {
    for (const script of [NOTE_SCRIPT, TAKE_SCRIPT]) {
      for (const word of quoted(script)) expect(WORDS.has(word), word).toBe(true);
      expect(script).not.toContain('..');
      // A key given to redis.call is KEYS[…] itself or a local made from it, never anything built.
      for (const call of script.matchAll(/redis\.call\('([A-Z]+)',\s*([^,)]+)/g)) {
        expect(call[2], `${call[1]} ${call[2]}`).toMatch(/^(KEYS\[[^\]]+\]|seen|uniq)$/);
      }
    }
    expect(NOTE_SCRIPT).toContain('local seen, uniq = KEYS[at + 1], KEYS[at + 2]');
  });

  it('do not name a prefix, a purpose or a version', () => {
    for (const script of [NOTE_SCRIPT, TAKE_SCRIPT]) {
      expect(script).not.toMatch(/stg|prd|pre:|dev:|note:|count:|seen:|uniq:|v1/);
    }
  });
});
