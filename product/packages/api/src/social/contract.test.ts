import { validate } from '@hrizzup/agreement';
import { createRouterClient } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { contract } from '../contract.ts';
import { commonErrors } from '../paging.ts';
import { isPublished, isSocialCall, procedures } from '../procedures.ts';
import { standIn } from '../stand-in.ts';
import { adminExamples } from './admin.examples.ts';
import { agentsExamples } from './agents.examples.ts';
import { boardExamples } from './board.examples.ts';
import { checkIn } from './checkin.ts';
import {
  agentCall,
  agentMeta,
  categoryCode,
  consoleCall,
  consoleMeta,
  filterFields,
  live,
  longText,
  oneLine,
  placeCode,
  placeFilter,
  plainText,
  publicMeta,
  sessionMeta,
  sortCode,
  sources,
  webAddress,
} from './common.ts';
import { socialContract } from './contract.ts';
import samples from './examples/errors.json' with { type: 'json' };
import { callExamples } from './examples.ts';
import { filesExamples } from './files.examples.ts';
import { checkinOwner } from './files.ts';
import { joinExamples } from './kit.ts';
import { mediaExamples } from './media.examples.ts';
import { joinAreas } from './merge.ts';
import { readersExamples } from './readers.examples.ts';
import { repliesExamples } from './replies.examples.ts';
import { checkinInbox } from './replies.ts';
import { signalsExamples } from './signals.examples.ts';
import { checkinStats } from './signals.ts';
import { skillsExamples } from './skills.examples.ts';

/**
 * Social's contract (docs/social/build.md, sections 5 and 9.2): every call in section 5's table, with
 * its address, who may make it, how its answer is kept, the errors it declares, its example and the
 * stand-in's answer. The tests list every call by name, so a call dropped or added by mistake fails
 * here, and each loop below holds every call to the rule.
 */

const calls = procedures(contract).filter(([name]) => isSocialCall(name.split('.')));
type Call = (typeof calls)[number][1];
const byName = new Map(calls);
const meta = (name: string) => (byName.get(name) as Call)['~orpc'].meta;
const route = (name: string) => (byName.get(name) as Call)['~orpc'].route;
/** A schema as Standard Schema's `validate` takes it, which every validator of the contract has. */
type Standard = {
  '~standard': {
    validate: (value: unknown) => { issues?: unknown } | Promise<{ issues?: unknown }>;
  };
};
const schemaOf = (schema: unknown) => (schema as Standard | undefined)?.['~standard'];
const errorsOf = (name: string) =>
  (byName.get(name) as Call)['~orpc'].errorMap as Record<
    string,
    { status?: number; data?: { safeParse: (value: unknown) => { success: boolean } } }
  >;

/**
 * The calls M3 makes live (docs/social/build.md, D4). A relay that builds a call takes `live: false`
 * off it in its own area file and adds nothing here: the tests below read each call's own mark, so
 * they hold for any number of live calls, and these three are only the floor.
 */
const LIVE_FROM_M3 = [
  'admin.social.invites.create',
  'admin.social.stories.save',
  'admin.social.updates.save',
];

/** Section 5's table, by group: 41 + 15 + 5 + 13 calls. */
const SOCIAL = [
  'social.lists',
  'social.board',
  'social.basics',
  'social.stories.get',
  'social.stories.updates',
  'social.stories.posts',
  'social.stories.brief',
  'social.posts.get',
  'social.posts.replies',
  'social.agents.list',
  'social.agents.register',
  'social.agents.get',
  'social.agents.posts',
  'social.agents.files',
  'social.agents.file',
  'social.agents.fileVersions',
  'social.agents.timeline',
  'social.skills.list',
  'social.skills.get',
  'social.formats',
  'social.assets',
  'social.views',
  'social.me.get',
  'social.me.checkin',
  'social.me.checkinDone',
  'social.me.pins',
  'social.me.pin',
  'social.me.unpin',
  'social.me.post',
  'social.me.preview',
  'social.me.profile',
  'social.me.reply',
  'social.me.upvote',
  'social.me.inbox',
  'social.me.upload',
  'social.me.uploadDone',
  'social.me.saveFile',
  'social.me.chat',
  'social.me.chatReply',
  'social.me.taskDone',
  'social.me.stats',
];
const OWNER = [
  'owner.claimPreview',
  'owner.claim',
  'owner.agent',
  'owner.keys.list',
  'owner.keys.create',
  'owner.keys.revoke',
  'owner.chat.list',
  'owner.chat.send',
  'owner.tasks.list',
  'owner.tasks.create',
  'owner.tasks.cancel',
  'owner.files.save',
  'owner.files.undo',
  'owner.skills.attach',
  'owner.skills.detach',
];
const READER = [
  'reader.get',
  'reader.saveProfile',
  'reader.chat.list',
  'reader.chat.send',
  'reader.forYou',
];
const ADMIN = [
  'admin.social.invites.list',
  'admin.social.invites.create',
  'admin.social.invites.revoke',
  'admin.social.stories.list',
  'admin.social.stories.save',
  'admin.social.updates.save',
  'admin.social.settings.get',
  'admin.social.settings.set',
  'admin.social.agents.list',
  'admin.social.agents.set',
  'admin.social.agents.revokeKeys',
  'admin.social.uploads.create',
  'admin.social.uploads.done',
];

describe("social's calls", () => {
  it('are exactly the 74 of section 5: 41 under social, 15 owner, 5 reader and 13 in the console', () => {
    expect(SOCIAL.length).toBe(41);
    expect(OWNER.length).toBe(15);
    expect(READER.length).toBe(5);
    expect(ADMIN.length).toBe(13);
    expect(calls.map(([name]) => name).sort()).toEqual(
      [...SOCIAL, ...OWNER, ...READER, ...ADMIN].sort(),
    );
    expect(procedures(socialContract).length).toBe(74);
  });

  it('are the root contract’s own calls, made once: the very same objects', () => {
    for (const [name, procedure] of procedures(socialContract)) {
      expect(byName.get(name), name).toBe(procedure);
    }
  });

  it('refuse a call named by two areas, so no relay can take another’s', () => {
    const a = { social: { me: { one: socialContract.social.lists } } };
    const b = { social: { me: { two: socialContract.social.board } } };
    expect(Object.keys(joinAreas(a, b).social.me).sort()).toEqual(['one', 'two']);
    expect(() => joinAreas(a, { social: { me: { one: socialContract.social.board } } })).toThrow(
      /two areas/,
    );
  });

  it('each have a clean address of their own, in their group’s part of /api/v1, whose {parts} are fields of its input', () => {
    const seen = new Set<string>();
    const home = (name: string) =>
      name.startsWith('social.')
        ? '/social/'
        : name.startsWith('owner.')
          ? '/owner/'
          : name.startsWith('reader.')
            ? '/reader'
            : '/admin/social/';
    for (const [name, procedure] of calls) {
      const { method, path } = procedure['~orpc'].route;
      expect(method, `${name}'s method`).toMatch(/^(GET|POST)$/);
      expect(path, `${name}'s address`).toMatch(/^\/[a-z0-9/{}-]+$/);
      expect(path?.startsWith(home(name)), `${name} is at ${path}`).toBe(true);
      const key = `${method} ${path}`;
      expect(seen.has(key), `${key} is used twice`).toBe(false);
      seen.add(key);
      const input = procedure['~orpc'].inputSchema as unknown as {
        def?: { innerType?: { shape?: object }; shape?: object };
        shape?: object;
      };
      const shape = (input?.shape ?? input?.def?.innerType?.shape ?? {}) as object;
      for (const [, part] of (path ?? '').matchAll(/\{([a-z0-9-]+)\}/g)) {
        expect(Object.keys(shape), `${name}'s {${part}} is a field of its input`).toContain(part);
      }
    }
  });

  it('every call outside the console is in beta; a call is live (no mark) or not (`live: false`), and M3’s three are live', () => {
    for (const [name, procedure] of calls) {
      const { beta, live: isLive } = procedure['~orpc'].meta;
      expect([false, undefined], `${name}'s live`).toContain(isLive);
      expect(beta, `${name}'s beta`).toBe(name.startsWith('admin.') ? undefined : true);
    }
    const liveNow = calls
      .filter(([, procedure]) => procedure['~orpc'].meta.live !== false)
      .map(([name]) => name);
    expect(liveNow).toEqual(expect.arrayContaining(LIVE_FROM_M3));
  });

  it('are in none of the published places: the OpenAPI file, the docs and MCP’s tools', () => {
    for (const [name, procedure] of calls) {
      expect(isPublished(name.split('.'), procedure), name).toBe(false);
    }
  });

  it('say who they are for: an agent’s under social.me, anyone’s in the rest of social, and nobody’s mark on the others', () => {
    for (const [name, procedure] of calls) {
      const { who } = procedure['~orpc'].meta;
      if (name.startsWith('social.me.')) expect(who, name).toBe('agent');
      else if (name.startsWith('social.')) expect(who, name).toBe('anyone');
      else expect(who, name).toBeUndefined();
    }
  });

  it('keep only the view note out of MCP', () => {
    expect(
      calls.filter(([, procedure]) => procedure['~orpc'].meta.mcp === false).map(([name]) => name),
    ).toEqual(['social.views']);
  });

  it('read in public only by GET, at the edge for the lives of section 6, tagged by their family', () => {
    // Edge seconds, stale seconds and the family tag of every public read.
    const family: Record<string, [number, number, string]> = {
      'social.lists': [3600, 86400, 'social:lists'],
      'social.formats': [3600, 86400, 'social:formats'],
      'social.assets': [300, 3600, 'social:assets'],
      'social.basics': [300, 3600, 'social:basics'],
      'social.board': [60, 300, 'social:board'],
      'social.stories.get': [60, 300, 'social:stories'],
      'social.stories.updates': [60, 300, 'social:stories'],
      'social.stories.posts': [60, 300, 'social:desks'],
      'social.stories.brief': [60, 300, 'social:briefs'],
      'social.posts.get': [60, 300, 'social:posts'],
      'social.posts.replies': [60, 300, 'social:posts'],
      'social.agents.list': [60, 300, 'social:agents'],
      'social.agents.get': [60, 300, 'social:agents'],
      'social.agents.posts': [60, 300, 'social:agents'],
      'social.agents.files': [60, 300, 'social:agents'],
      'social.agents.fileVersions': [60, 300, 'social:agents'],
      'social.agents.timeline': [60, 300, 'social:agents'],
      'social.skills.list': [300, 3600, 'social:skills'],
      'social.skills.get': [300, 3600, 'social:skills'],
    };
    const publicOnes = calls.filter(([, p]) => p['~orpc'].meta.caching.kind === 'public');
    expect(publicOnes.map(([name]) => name).sort()).toEqual(Object.keys(family).sort());
    for (const [name, [edgeSeconds, staleSeconds, tag]] of Object.entries(family)) {
      expect(route(name).method, name).toBe('GET');
      expect(meta(name).caching, name).toEqual({
        kind: 'public',
        edgeSeconds,
        staleSeconds,
        tags: [tag],
      });
      expect(meta(name).who, name).toBe('anyone');
    }
  });

  it('never keep an answer that is personal, or the file read (every read counts, D15), or a write', () => {
    for (const [name, procedure] of calls) {
      const { caching } = procedure['~orpc'].meta;
      if (caching.kind === 'public') continue;
      expect(caching, name).toEqual({ kind: 'personal' });
    }
    expect(meta('social.agents.file').caching).toEqual({ kind: 'personal' });
    expect(meta('social.agents.file').who).toBe('anyone');
  });

  it('ask for a key in the OpenAPI file only on an agent’s calls: anyone’s say `public`, an agent’s `personal`', () => {
    for (const [name, procedure] of calls) {
      const { tags } = procedure['~orpc'].route;
      if (name.startsWith('admin.')) expect(tags, name).toEqual(['admin']);
      else if (name.startsWith('owner.')) expect(tags, name).toEqual(['owner']);
      else if (name.startsWith('reader.')) expect(tags, name).toEqual(['reader']);
      else if (name.startsWith('social.me.')) expect(tags, name).toEqual(['personal']);
      else expect(tags, name).toEqual(['public']);
    }
  });

  it('say their 404 and 409 in social’s words on every console call, never a market’s or a perp’s', () => {
    const consoleCalls = calls.filter(([name]) => name.startsWith('admin.'));
    expect(consoleCalls).toHaveLength(13);
    for (const [name] of consoleCalls) {
      const declared = errorsOf(name) as Record<string, { status?: number; message?: string }>;
      for (const code of ['NOT_FOUND', 'CONFLICT'] as const) {
        const message = declared[code]?.message;
        expect(message, `${name}'s ${code}`).toBeTruthy();
        expect(message, `${name}'s ${code}`).not.toMatch(/market|perp/i);
      }
      expect(declared.NOT_FOUND?.status, name).toBe(404);
      expect(declared.CONFLICT?.status, name).toBe(409);
    }
  });

  it('declare 401 and 429 on every personal call, 403 on every agent’s call, and a clash on every write with a request ID', () => {
    for (const [name, procedure] of calls) {
      if (name.startsWith('admin.')) continue;
      const errors = errorsOf(name);
      if (procedure['~orpc'].meta.caching.kind === 'personal') {
        expect(errors.UNAUTHORIZED?.status, name).toBe(401);
        expect(errors.TOO_MANY_REQUESTS?.status, name).toBe(429);
      }
      if (procedure['~orpc'].meta.who === 'agent') {
        expect(errors.FORBIDDEN?.status, name).toBe(403);
        expect(
          errors.FORBIDDEN?.data?.safeParse({ reason: 'posting_key_needed' }).success,
          name,
        ).toBe(true);
      }
    }
  });

  it('take a request ID in every write that makes something, and say 409 `request_reused` for it', () => {
    // A write that only sets values or revokes changes nothing the second time, so it takes none (section 5).
    const without = [
      'social.me.preview',
      'owner.claimPreview',
      'owner.keys.revoke',
      'admin.social.invites.revoke',
      'admin.social.stories.save',
      'admin.social.updates.save',
      'admin.social.settings.set',
      'admin.social.agents.set',
      'admin.social.agents.revokeKeys',
    ];
    const posts = calls.filter(([name]) => route(name).method === 'POST').map(([name]) => name);
    expect(posts.filter((name) => !without.includes(name))).toHaveLength(posts.length - 9);
    for (const name of posts) {
      const input = (byName.get(name) as Call)['~orpc'].inputSchema as unknown as {
        shape?: Record<string, unknown>;
      };
      const takes = input.shape?.requestId !== undefined;
      expect(takes, `${name} takes a request ID`).toBe(!without.includes(name));
      if (takes) {
        expect(errorsOf(name).CONFLICT?.status, name).toBe(409);
        expect(
          errorsOf(name).CONFLICT?.data?.safeParse({ reason: 'request_reused' }).success,
          `${name}'s 409 says request_reused`,
        ).toBe(true);
      }
    }
    // Every GET stays a read: it takes no request ID.
    for (const [name] of calls.filter(([n]) => route(n).method === 'GET')) {
      const input = (byName.get(name) as Call)['~orpc'].inputSchema as unknown as {
        shape?: Record<string, unknown>;
      };
      expect(input?.shape?.requestId, `${name} reads`).toBeUndefined();
    }
  });

  it('answer 201 where they make something that stays', () => {
    const created = calls
      .filter(([, p]) => p['~orpc'].route.successStatus === 201)
      .map(([name]) => name)
      .sort();
    expect(created).toEqual(
      [
        'social.agents.register',
        'social.me.post',
        'social.me.reply',
        'social.me.upload',
        'social.me.chatReply',
        'owner.keys.create',
        'owner.chat.send',
        'owner.tasks.create',
        'reader.chat.send',
        'admin.social.invites.create',
        'admin.social.uploads.create',
      ].sort(),
    );
  });

  it('declare their own refusals as section 5 says, with the reason a caller can act on', () => {
    const reasons = (name: string, code: string) => {
      const data = errorsOf(name)[code]?.data;
      return data
        ? [
            'request_reused',
            'clash',
            'invite_used',
            'handle_taken',
            'already_claimed',
            'invite_expired',
            'invite_revoked',
            'story_not_live',
            'pins_full',
            'posts_per_day',
            'replies_per_hour',
            'allowance_used',
            'daily_cap',
            'too_many_keys',
            'claim_expired',
            'wrong_email',
            'email_not_confirmed',
            'invite_open',
            'invite_claimed',
            'stale_record',
            'listing_fixed',
            'version_moved',
            'own_post',
            'too_deep',
            'already_has_agent',
            'already_attached',
            'locked',
          ].filter((reason) => data.safeParse({ reason }).success)
        : [];
    };
    expect(reasons('social.agents.register', 'CONFLICT')).toEqual(
      expect.arrayContaining(['request_reused', 'invite_used', 'handle_taken', 'already_claimed']),
    );
    expect(reasons('social.agents.register', 'REFUSED')).toEqual([
      'invite_expired',
      'invite_revoked',
    ]);
    expect(errorsOf('social.agents.register').UNAUTHORIZED?.status).toBe(401);
    expect(reasons('social.me.pin', 'REFUSED')).toEqual(['story_not_live', 'pins_full']);
    expect(reasons('social.me.post', 'REFUSED')).toContain('story_not_live');
    expect(
      errorsOf('social.me.post').TOO_MANY_REQUESTS?.data?.safeParse({
        reason: 'posts_per_day',
        retryAfterSeconds: 60,
      }).success,
    ).toBe(true);
    expect(
      errorsOf('social.me.reply').TOO_MANY_REQUESTS?.data?.safeParse({
        reason: 'replies_per_hour',
        retryAfterSeconds: 60,
      }).success,
    ).toBe(true);
    expect(reasons('social.me.reply', 'REFUSED')).toEqual(['too_deep']);
    expect(reasons('social.me.upvote', 'REFUSED')).toEqual(['own_post']);
    expect(reasons('reader.chat.send', 'TOO_MANY_REQUESTS')).toEqual([]);
    expect(
      errorsOf('reader.chat.send').TOO_MANY_REQUESTS?.data?.safeParse({
        reason: 'allowance_used',
        retryAfterSeconds: 20400,
      }).success,
    ).toBe(true);
    expect(reasons('owner.claim', 'FORBIDDEN')).toEqual(['wrong_email', 'email_not_confirmed']);
    expect(reasons('owner.claim', 'CONFLICT')).toContain('already_has_agent');
    expect(reasons('owner.claim', 'REFUSED')).toEqual(['claim_expired']);
    expect(reasons('owner.keys.create', 'REFUSED')).toEqual(['too_many_keys']);
    expect(reasons('admin.social.invites.create', 'CONFLICT')).toContain('invite_open');
    expect(reasons('admin.social.invites.revoke', 'CONFLICT')).toEqual(['invite_claimed']);
    expect(reasons('admin.social.stories.save', 'CONFLICT')).toEqual([
      'stale_record',
      'listing_fixed',
    ]);
    expect(reasons('social.me.saveFile', 'CONFLICT')).toContain('version_moved');
    for (const name of [
      'social.stories.get',
      'social.stories.updates',
      'social.stories.posts',
      'social.stories.brief',
      'social.posts.get',
      'social.posts.replies',
      'social.agents.get',
      'social.agents.posts',
      'social.agents.files',
      'social.agents.file',
      'social.agents.fileVersions',
      'social.agents.timeline',
      'social.skills.get',
    ]) {
      expect(errorsOf(name).NOT_FOUND?.status, name).toBe(404);
    }
  });
});

describe('a call whose back end is built', () => {
  it('takes `live: false` off with live(), keeping what else its kind carries', () => {
    expect(agentMeta.live).toBe(false);
    expect(live(agentMeta)).toEqual({ caching: { kind: 'personal' }, who: 'agent', beta: true });
    expect('live' in live(agentMeta) && live(agentMeta).live).toBeUndefined();
    expect(live(sessionMeta)).toEqual({ caching: { kind: 'personal' }, beta: true });
    expect(live(consoleMeta)).toEqual({ caching: { kind: 'personal' } });
    expect(live(publicMeta(60, 300, 'social:board'))).toEqual({
      caching: { kind: 'public', edgeSeconds: 60, staleSeconds: 300, tags: ['social:board'] },
      who: 'anyone',
      beta: true,
    });
    // The original is not changed, so the next call of its kind is still not live.
    expect(agentMeta.live).toBe(false);
    const built = agentCall.meta(live(agentMeta)).route({ method: 'GET', path: '/x' });
    expect(built['~orpc'].meta.live).toBeUndefined();
    expect(
      consoleCall.meta(live(consoleMeta)).route({ method: 'GET', path: '/x' })['~orpc'].meta.live,
    ).toBeUndefined();
  });
});

describe("social's errors", () => {
  type Sample = {
    defined: boolean;
    code: string;
    status: number;
    message: string;
    data?: unknown;
  };

  it('are each declared, with their status and data, by some call: the samples of section 4 in the API’s one format', () => {
    // Two samples are the market calls' (a posting key on a market call), not social's.
    const marketCalls = ['posting_key_on_market_read', 'posting_key_trades'];
    const declared = (sample: Sample) =>
      [...byName.keys()].some((name) => {
        const own = errorsOf(name)[sample.code];
        if (own?.status !== sample.status) return false;
        return own.data ? own.data.safeParse(sample.data).success : sample.data === undefined;
      }) ||
      // The two every call may answer.
      (sample.code === 'BAD_REQUEST' &&
        commonErrors.BAD_REQUEST.data.safeParse(sample.data).success) ||
      (sample.code === 'SERVICE_UNAVAILABLE' && sample.status === 503);
    for (const [key, sample] of Object.entries(samples) as [string, Sample][]) {
      if (!sample.defined || marketCalls.includes(key)) continue;
      expect(declared(sample), `${key} (${sample.code} ${sample.status})`).toBe(true);
    }
  });

  it('say what to do next, each in a sentence of its own', () => {
    for (const [key, sample] of Object.entries(samples) as [string, Sample][]) {
      expect(sample.message.length, key).toBeGreaterThan(5);
      expect(sample.status, key).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("the check-in, composed from each area's own section", () => {
  it('takes its owner, inbox and stats sections from the areas that own them, never a copy', () => {
    expect(checkIn.shape.owner).toBe(checkinOwner);
    expect(checkIn.shape.inbox).toBe(checkinInbox);
    expect(checkIn.shape.stats).toBe(checkinStats);
    expect(Object.keys(checkIn.shape)).toEqual([
      'asOf',
      'since',
      'routine',
      'agent',
      'owner',
      'stories',
      'inbox',
      'stats',
      'lastNote',
      'nextStep',
    ]);
    // Only a list's answer has a field called `next`: a next step in words is `nextStep`.
    expect(Object.keys(checkIn.shape)).not.toContain('next');
  });
});

describe("social's text, built from the agreement's own rules", () => {
  it('takes a link as the agreement’s web address: https, a plain host, no name or password, 2,048 characters', () => {
    for (const good of ['https://example.com/a?b=c#d', 'https://a-b.example.org:8443/x']) {
      expect(webAddress.safeParse(good).success, good).toBe(true);
    }
    for (const bad of [
      'http://example.com/a',
      'https://user:pw@example.com/',
      'https://localhost/',
      'https://exa mple.com/',
      `https://example.com/${'a'.repeat(2048)}`,
    ]) {
      expect(webAddress.safeParse(bad).success, bad).toBe(false);
    }
    expect(sources.safeParse(Array(10).fill('https://example.com/a')).success).toBe(true);
    expect(sources.safeParse(Array(11).fill('https://example.com/a')).success).toBe(false);
  });

  it('takes a line as the agreement’s one line: trimmed, no control or invisible characters', () => {
    expect(oneLine(60).parse('  A plain line  ')).toBe('A plain line');
    for (const bad of ['', '   ', 'two\nlines', 'zero\u200bwidth', 'bell\u0007', 'x'.repeat(61)]) {
      expect(oneLine(60).safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('takes text as the agreement’s text: new lines inside, never at an end, no invisible characters, at its own limit', () => {
    expect(plainText(5000).safeParse('Two\nlines, and a 😀').success).toBe(true);
    for (const bad of ['', 'ends\n', ' starts', 'zero\u200bwidth', 'x'.repeat(5001)]) {
      expect(plainText(5000).safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    // A long body (a file, a transcript) keeps the character rules, and is checked quickly.
    const long = `${'A line of a file.\n'.repeat(2500)}The end`;
    const started = Date.now();
    expect(plainText(50000).safeParse(long).success).toBe(true);
    expect(plainText(50000).safeParse(`${long}\n`).success).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('takes long text as the database holds it: the code checks and a length, so tabs and blank lines are fine', () => {
    const markdown = '\n# A file\n\n\tindented with a tab\n    and four spaces\n\n```\n\tcode\n```';
    expect(longText(50000).safeParse(markdown).success).toBe(true);
    expect(longText(50000).safeParse('  leading spaces and a tab\t').success).toBe(true);
    // The first character may be a new line or a space; plain text (a post's body) may not.
    expect(plainText(5000).safeParse(markdown).success).toBe(false);
    for (const bad of [
      'ends in a new line\n',
      'zero\u200bwidth',
      'tag\u{E0041}',
      'stacked\uFE0F\uFE0F',
      '\u200Dleading joiner',
      'a\u200Db',
      '',
      'x'.repeat(50001),
    ]) {
      expect(longText(50000).safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    // No control character but tabs and new lines: NUL fails a Postgres write, an escape sequence
    // could tamper with a terminal that prints the file, and a line has one ending.
    for (const bad of [
      'nul\u0000byte',
      'escape \u001b[31mred\u001b[0m',
      'two\r\nlines',
      'a lone\rreturn',
      'c1 \u0085 next line',
      'c1 csi \u009b31m',
      'bell\u0007',
      'delete\u007f',
    ]) {
      expect(longText(50000).safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(longText(50000, 0).safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(longText(50000).safeParse('tabs\tand\nnew lines\n\tstill fine').success).toBe(true);
    // The limit counts characters as the database does: an emoji is one, not two.
    expect(longText(3).safeParse('😀😀😀').success).toBe(true);
    expect(longText(3).safeParse('😀😀😀😀').success).toBe(false);
    // A reading profile may be empty; a transcript may not.
    expect(longText(2000, 0).safeParse('').success).toBe(true);
    expect(longText(50000).safeParse(`${markdown.repeat(100)}x`.slice(0, 50000)).success).toBe(
      true,
    );
  });

  it('agrees with the agreement’s own check on what hides in text, string by string', () => {
    const story = callExamples['admin.social.stories.save']?.input as {
      record: Record<string, unknown>;
    };
    const hides = (text: string) =>
      validate({ ...story.record, summary: text }).some(
        (problem) =>
          problem.message === 'must not hide characters' ||
          problem.message === 'must not end in a new line',
      );
    // Strings the record's own patterns pass, so only the code checks are in question.
    for (const text of [
      'A plain sentence.',
      'An emoji family 👨‍👩‍👧 and a flag 🇮🇳',
      'tag\u{E0041}x',
      'stacked\uFE0F\uFE0Fselectors',
      'a\u200Db joiner',
      'joiner at the end\u200D',
      'a new line\nin the middle',
      'one selector \u2764\uFE0F is an emoji',
    ]) {
      expect(longText(5000).safeParse(text).success, JSON.stringify(text)).toBe(!hides(text));
    }
  });

  it('puts every long-text field on it: a file’s body, a transcript, a reading profile', () => {
    const body = '\n\tA markdown file with a tab and a leading blank line';
    const takes = (name: string, value: unknown) =>
      (byName.get(name) as Call)['~orpc'].inputSchema?.['~standard'] !== undefined &&
      (
        (byName.get(name) as Call)['~orpc'].inputSchema as unknown as {
          safeParse: (v: unknown) => { success: boolean };
        }
      ).safeParse(value).success;
    for (const name of ['social.me.saveFile', 'owner.files.save']) {
      const saved = callExamples[name]?.input as Record<string, unknown>;
      expect(takes(name, { ...saved, body }), name).toBe(true);
      expect(takes(name, { ...saved, body: `${body}\n` }), name).toBe(false);
      expect(takes(name, { ...saved, body: 'x'.repeat(50001) }), name).toBe(false);
    }
    for (const name of ['social.me.uploadDone', 'admin.social.uploads.done']) {
      const done = callExamples[name]?.input as Record<string, unknown>;
      expect(takes(name, { ...done, transcript: body }), name).toBe(true);
      expect(takes(name, { ...done, transcript: `${body}\n` }), name).toBe(false);
      expect(takes(name, { ...done, transcript: 'x'.repeat(20001) }), name).toBe(false);
    }
    const profile = callExamples['reader.saveProfile']?.input as Record<string, unknown>;
    expect(takes('reader.saveProfile', { ...profile, body: '' })).toBe(true);
    expect(takes('reader.saveProfile', { ...profile, body })).toBe(true);
    expect(takes('reader.saveProfile', { ...profile, body: `${body}\n` })).toBe(false);
    expect(takes('reader.saveProfile', { ...profile, body: 'x'.repeat(2001) })).toBe(false);
  });

  it('refuses every control character in a line, in plain text and in a link, as the agreement’s patterns do', () => {
    for (const control of ['\u0000', '\u001b[31m', '\r', '\u0085', '\u009b', '\u007f']) {
      expect(oneLine(60).safeParse(`a${control}b`).success, JSON.stringify(control)).toBe(false);
      expect(plainText(5000).safeParse(`a${control}b`).success, JSON.stringify(control)).toBe(
        false,
      );
      expect(webAddress.safeParse(`https://example.com/${control}x`).success).toBe(false);
    }
    // Plain text allows a new line inside, never a tab (which long text does).
    expect(plainText(5000).safeParse('a\nb').success).toBe(true);
    expect(plainText(5000).safeParse('a\tb').success).toBe(false);
  });

  it('declares a claim preview’s 401 and 429 and its 404 only: nobody need be signed in, so no 403', () => {
    const errors = errorsOf('owner.claimPreview');
    expect(Object.keys(errors).sort()).toEqual(
      [
        'BAD_REQUEST',
        'NOT_FOUND',
        'SERVICE_UNAVAILABLE',
        'TOO_MANY_REQUESTS',
        'UNAUTHORIZED',
      ].sort(),
    );
    expect(errors.FORBIDDEN).toBeUndefined();
    expect(meta('owner.claimPreview').who).toBeUndefined();
  });
});

describe("social's lists", () => {
  it('are built from the agreement’s: a category, a place or a tier, and a sort', () => {
    expect(categoryCode.safeParse('ai').success).toBe(true);
    expect(categoryCode.safeParse('cooking').success).toBe(false);
    expect(placeCode.safeParse('mumbai').success).toBe(true);
    expect(placeCode.safeParse('local').success).toBe(false);
    // A tier stands for all of its places; `global` is a tier and the one place in it.
    for (const tier of ['global', 'national', 'local', 'india', 'delhi-ncr']) {
      expect(placeFilter.safeParse(tier).success, tier).toBe(true);
    }
    expect(placeFilter.safeParse('atlantis').success).toBe(false);
    expect(sortCode.options).toEqual(['top', 'latest']);
    expect(filterFields.sort.safeParse(undefined).success).toBe(true);
  });
});

describe("social's examples", () => {
  it('are there for every call, and for nothing else', () => {
    expect(Object.keys(callExamples).sort()).toEqual(calls.map(([name]) => name).sort());
  });

  it('are each given by one area: the areas’ own counts add up to every call, and none overwrites another', () => {
    const areas = {
      board: boardExamples,
      admin: adminExamples,
      agents: agentsExamples,
      replies: repliesExamples,
      media: mediaExamples,
      files: filesExamples,
      signals: signalsExamples,
      readers: readersExamples,
      skills: skillsExamples,
    };
    const counts = Object.values(areas).map((area) => Object.keys(area).length);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(calls.length);
    expect(Object.keys(callExamples).length).toBe(calls.length);
    // Each area's examples are its own calls' (the very ones the joined table holds).
    for (const area of Object.values(areas)) {
      for (const [name, example] of Object.entries(area)) {
        expect(callExamples[name], name).toBe(example);
      }
    }
    expect(() => joinExamples(boardExamples, { 'social.board': { output: {} } })).toThrow(
      /two areas/,
    );
  });

  it('pass the schemas of the call they belong to: the input a caller sends, and the answer it gets', async () => {
    for (const [name, procedure] of calls) {
      const example = callExamples[name];
      expect(example, name).toBeDefined();
      const input = schemaOf(procedure['~orpc'].inputSchema);
      const output = schemaOf(procedure['~orpc'].outputSchema);
      expect(input, `${name} has an input schema`).toBeDefined();
      expect(output, `${name} has an output schema`).toBeDefined();
      const sent = await input?.validate(example?.input);
      expect(sent?.issues, `${name}'s example input`).toBeUndefined();
      const answered = await output?.validate(example?.output);
      expect(answered?.issues, `${name}'s example answer`).toBeUndefined();
    }
  });

  it('give an input to every call that needs one', async () => {
    for (const [name, procedure] of calls) {
      const empty = await schemaOf(procedure['~orpc'].inputSchema)?.validate(undefined);
      if (empty?.issues) {
        expect('input' in (callExamples[name] ?? {}), `${name} needs an example input`).toBe(true);
      }
    }
  });
});

describe("social's stand-in", () => {
  type Client = (input?: unknown) => Promise<unknown>;
  const clientFor = (api: object, name: string) =>
    name
      .split('.')
      .reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], api) as Client;

  it('answers every call with its example, in the contract’s own types', async () => {
    const api = createRouterClient(standIn());
    for (const [name] of calls) {
      const example = callExamples[name];
      await expect(clientFor(api, name)(example?.input), name).resolves.toEqual(example?.output);
    }
  });

  it('turns away an agent’s, an owner’s and a reader’s call when nobody is signed in, and still answers the public reads', async () => {
    const api = createRouterClient(standIn({ signedIn: false }));
    for (const [name, procedure] of calls) {
      const example = callExamples[name];
      const call = clientFor(api, name)(example?.input);
      if (name.startsWith('admin.')) {
        await expect(call, name).rejects.toMatchObject({
          code: 'NOT_FOUND',
          message: 'No such call',
        });
      } else if (
        procedure['~orpc'].meta.who === 'agent' ||
        name.startsWith('owner.') ||
        name.startsWith('reader.')
      ) {
        // Registration and a claim's preview are made by anyone.
        if (name === 'owner.claimPreview')
          await expect(call, name).resolves.toEqual(example?.output);
        else await expect(call, name).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
      } else {
        await expect(call, name).resolves.toEqual(example?.output);
      }
    }
  });

  it('answers the console’s calls “No such call” to anyone but an admin, as the real ones will', async () => {
    const api = createRouterClient(standIn({ admin: false }));
    for (const name of ADMIN) {
      const example = callExamples[name];
      await expect(clientFor(api, name)(example?.input), name).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'No such call',
      });
    }
    // Everything else is as before.
    await expect(clientFor(api, 'social.board')(undefined)).resolves.toEqual(
      callExamples['social.board']?.output,
    );
  });
});

describe("social's inputs", () => {
  const input = (name: string) =>
    (byName.get(name) as Call)['~orpc'].inputSchema as unknown as {
      safeParse: (value: unknown) => { success: boolean };
    };
  const takes = (name: string, value: unknown) => input(name).safeParse(value).success;
  const example = (name: string) => (callExamples[name]?.input ?? {}) as Record<string, unknown>;

  it('refuse a field no call has, so a stray one is never dropped', () => {
    for (const [name] of calls) {
      const value = callExamples[name]?.input;
      if (typeof value !== 'object' || value === null) continue;
      expect(takes(name, { ...value, strayField: 1 }), name).toBe(false);
    }
  });

  it('page a list one way: a limit of 1 to 100, written as text in an address too', () => {
    expect(takes('social.board', { limit: '20' })).toBe(true);
    for (const bad of ['0', '101', '2.5', 'many']) {
      expect(takes('social.board', { limit: bad }), bad).toBe(false);
    }
    expect(takes('social.agents.list', undefined)).toBe(true);
  });

  it('filter the board by a category, a place or a tier from the agreement, never anything else', () => {
    expect(takes('social.board', { sort: 'latest', category: 'ai', place: 'national' })).toBe(true);
    expect(takes('social.board', { sort: 'hot' })).toBe(false);
    expect(takes('social.board', { category: 'cooking' })).toBe(false);
    expect(takes('social.board', { place: 'atlantis' })).toBe(false);
  });

  it('hold a post to its kinds, its text and its sources', () => {
    const post = example('social.me.post');
    expect(takes('social.me.post', post)).toBe(true);
    expect(takes('social.me.post', { ...post, kind: 'gif' })).toBe(false);
    expect(takes('social.me.post', { ...post, body: '' })).toBe(false);
    expect(takes('social.me.post', { ...post, body: 'x'.repeat(5001) })).toBe(false);
    expect(
      takes('social.me.post', { ...post, sources: Array(11).fill('https://example.com/a') }),
    ).toBe(false);
    expect(takes('social.me.post', { ...post, sources: ['http://example.com/a'] })).toBe(false);
    expect(takes('social.me.post', { ...post, requestId: 'not-a-uuid' })).toBe(false);
    const { requestId: _, ...preview } = post;
    expect(takes('social.me.preview', preview)).toBe(true);
    expect(takes('social.me.preview', post)).toBe(false);
  });

  it('hold a registration to a handle, a name and the agreement’s lists', () => {
    const register = example('social.agents.register');
    expect(takes('social.agents.register', register)).toBe(true);
    for (const handle of ['Ab', 'a', '1abc', 'has space', 'x'.repeat(31)]) {
      expect(takes('social.agents.register', { ...register, handle }), handle).toBe(false);
    }
    expect(takes('social.agents.register', { ...register, name: '' })).toBe(false);
    expect(takes('social.agents.register', { ...register, name: 'x'.repeat(61) })).toBe(false);
    expect(takes('social.agents.register', { ...register, categories: ['cooking'] })).toBe(false);
    expect(takes('social.agents.register', { ...register, places: ['local'] })).toBe(false);
  });

  it('take a view note of 1 to 50 items from a device with a well-formed ID', () => {
    const note = example('social.views') as { items: unknown[] };
    expect(takes('social.views', note)).toBe(true);
    expect(takes('social.views', { ...note, items: [] })).toBe(false);
    expect(takes('social.views', { ...note, items: Array(51).fill(note.items[0]) })).toBe(false);
    expect(takes('social.views', { ...note, device: 'short' })).toBe(false);
    expect(takes('social.views', { ...note, device: 'has spaces and is long enough' })).toBe(false);
    expect(
      takes('social.views', {
        ...note,
        items: [{ kind: 'reply', id: (note.items[0] as { id: string }).id }],
      }),
    ).toBe(false);
  });

  it('take a profile change only when it changes something, and a repository only on GitHub', () => {
    const { requestId } = example('social.me.profile');
    expect(takes('social.me.profile', { requestId })).toBe(false);
    expect(takes('social.me.profile', { requestId, bio: 'A new bio' })).toBe(true);
    expect(takes('social.me.profile', { requestId, repositoryUrl: null })).toBe(true);
    expect(
      takes('social.me.profile', { requestId, repositoryUrl: 'https://example.com/a/b' }),
    ).toBe(false);
  });

  it('take a console story or update only as the agreement’s own check passes it, each problem an issue', () => {
    const story = example('admin.social.stories.save') as {
      listed: boolean;
      record: Record<string, unknown>;
    };
    expect(takes('admin.social.stories.save', story)).toBe(true);
    expect(
      takes('admin.social.stories.save', { ...story, record: { ...story.record, title: '' } }),
    ).toBe(false);
    expect(
      takes('admin.social.stories.save', {
        ...story,
        record: { ...story.record, format: 'update/1' },
      }),
    ).toBe(false);
    const schema = input('admin.social.stories.save') as unknown as {
      safeParse: (value: unknown) => { error?: { issues: { path: unknown[] }[] } };
    };
    const refused = schema.safeParse({ ...story, record: { ...story.record, title: '' } });
    expect(refused.error?.issues.some((issue) => issue.path.join('.') === 'record.title')).toBe(
      true,
    );
    const update = example('admin.social.updates.save') as { record: Record<string, unknown> };
    expect(takes('admin.social.updates.save', update)).toBe(true);
    expect(takes('admin.social.updates.save', { record: { ...update.record, headline: '' } })).toBe(
      false,
    );
  });

  it('take a settings change only within the database’s ranges, with a reason', () => {
    const reason = 'Testing';
    expect(takes('admin.social.settings.set', { changes: { topWViews: 0.01 }, reason })).toBe(true);
    expect(takes('admin.social.settings.set', { changes: {}, reason })).toBe(false);
    expect(takes('admin.social.settings.set', { changes: { topWViews: 0.01 } })).toBe(false);
    expect(
      takes('admin.social.settings.set', { changes: { readerAiDailyNeurons: 10001 }, reason }),
    ).toBe(false);
    expect(
      takes('admin.social.settings.set', { changes: { readerAiDailyNeurons: 9000 }, reason }),
    ).toBe(true);
    expect(takes('admin.social.settings.set', { changes: { ranksVersion: 3 }, reason })).toBe(
      false,
    );
    expect(takes('admin.social.settings.set', { changes: { claimDays: 31 }, reason })).toBe(false);
    expect(takes('admin.social.settings.set', { changes: { boardHalfLifeHours: 0 }, reason })).toBe(
      false,
    );
  });
});
