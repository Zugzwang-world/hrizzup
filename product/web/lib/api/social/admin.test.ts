import { contract, procedures } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { socialRedis } from '@hrizzup/social/redis';
import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSocialCache } from '@/lib/social/cache.ts';
import { SETTING_COLUMNS } from '@/lib/social/console.ts';

/**
 * The console's nine live social calls (docs/social/build.md, D4, D13, sections 7.9, 7.10 and 9.2's
 * `admin.test.ts`; R5's design note, M3a): saving a test story, saving an update, making an invite (M3),
 * and the three lists, the settings' two calls and an agent's limits (M3a). Who is signed in, whether
 * they're an admin and the database are stood in for: the database by a recording stand-in that
 * answers like the functions of migrations/*_social.sql (their snake_case answers, their SQLSTATEs).
 * The database's own rules are proven by the pgTAP tests (`social_console`, `intake`).
 */

const signedIn = vi.fn();
const isAdmin = vi.fn();
const testStories = vi.fn(() => true);
/** Vercel's purge, stood in for: every tag the saves ask the edge to refresh, one call at a time. */
const invalidate = vi.fn(async (_tags: string[]) => {});

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  isAdmin: (...args: unknown[]) => isAdmin(...args),
}));
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  invalidateByTag: (tags: string[]) => invalidate(tags),
}));
vi.mock('@/lib/env.ts', async (original) => ({
  ...(await original<typeof import('@/lib/env.ts')>()),
  testStoriesEnabled: () => testStories(),
}));

/** What the stand-in database is asked, in order: each statement with its values, once the transaction's own setup is left out. */
type Statement = { text: string; values: unknown[] | undefined };
const asked: Statement[] = [];
/** What the transaction was set up as (role and account), for the first statement after `begin`. */
const setUp: unknown[][] = [];
/** How the stand-in answers each statement of the social functions, or what it raises (at the statement or at commit). */
let answer: (statement: Statement) => unknown = () => ({});
let atCommit: unknown = null;

const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text === 'begin' || text === 'rollback') return { rows: [] };
    if (text.startsWith('select set_config')) {
      setUp.push(values ?? []);
      return { rows: [] };
    }
    if (text === 'commit') {
      if (atCommit) throw atCommit;
      return { rows: [] };
    }
    asked.push({ text, values });
    const result = answer({ text, values });
    if (
      result instanceof Error ||
      (typeof result === 'object' && result && 'code' in result && !('answer' in result))
    ) {
      throw result;
    }
    return { rows: [{ answer: result }] };
  }),
  release: vi.fn(),
};
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: async () => client }) }));

const { router } = await import('../router.ts');

const api = (context: { url?: string; headers?: Headers } = {}) =>
  createRouterClient(router, {
    context: {
      headers: new Headers(),
      url: 'https://staging.hrizzup.com/api/v1/admin/social/stories',
      ...context,
    },
  });
const ADMIN = { id: '00000000-0000-4000-8000-0000000000c1', email: 'ada@console.test' };
const noSuchCall = { code: 'NOT_FOUND', status: 404, message: 'No such call' };

/** A database error as `pg` raises it. */
const fault = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...extra });

/** snake_case from camelCase, deeply: what the functions answer. */
function snake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snake);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        snake(item),
      ]),
    );
  }
  return value;
}

const story = examples.admin.saveStoryInput;
const update = examples.admin.saveUpdateInput;
const invite = examples.admin.createInviteInput;

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  testStories.mockReturnValue(true);
  invalidate.mockReset();
  invalidate.mockResolvedValue(undefined);
  // No Redis: a save's purge forgets the brief's copy there, and this test has none.
  resetSocialCache(null);
  answer = () => ({});
  atCommit = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  asked.length = 0;
  setUp.length = 0;
  resetSocialCache();
});

describe('saving a test story', () => {
  it('runs social.admin_save_story in one transaction as the admin, and answers the story', async () => {
    answer = () => snake(examples.admin.savedStory);
    await expect(api().admin.social.stories.save(story)).resolves.toEqual(
      examples.admin.savedStory,
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe('select social.admin_save_story($1::jsonb, $2::boolean) as answer');
    expect(JSON.parse(String(asked[0]?.values?.[0]))).toEqual(story.record);
    expect(asked[0]?.values?.[1]).toBe(story.listed);
    // As the app's own role, with the admin's account signed in.
    expect(setUp[0]?.[0]).toBe('hrizzup_app');
    expect(setUp[0]?.[2]).toBe(ADMIN.id);
    expect(isAdmin).toHaveBeenCalled();
  });

  it('answers `same` when the very same story is saved again, and nothing else changes', async () => {
    answer = () => snake({ ...examples.admin.savedStory, saved: 'same' });
    const again = await api().admin.social.stories.save(story);
    expect(again).toMatchObject({ id: story.record.id, saved: 'same', listed: true });
  });

  it("refuses before the database where test stories are never allowed, as an address that isn't there", async () => {
    testStories.mockReturnValue(false);
    await expect(api().admin.social.stories.save(story)).rejects.toMatchObject(noSuchCall);
    await expect(api().admin.social.updates.save(update)).rejects.toMatchObject(noSuchCall);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('answers each problem the agreement finds in the record as a 400 issue, and never reaches the database', async () => {
    const bad = {
      ...story,
      record: {
        ...story.record,
        title: ' padded',
        categories: ['general', 'general'],
        created_at: 'yesterday',
      },
    };
    const error = await api()
      .admin.social.stories.save(bad as never)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'BAD_REQUEST', status: 400 });
    const issues = (error as { data: { issues: { path: string; message: string }[] } }).data.issues;
    const paths = issues.map((issue) => issue.path);
    expect(paths).toEqual(
      expect.arrayContaining(['record.title', 'record.categories', 'record.created_at']),
    );
    expect(issues.every((issue) => issue.message.length > 0)).toBe(true);
    expect(client.query).not.toHaveBeenCalled();
    // Not a story at all, and no choice of `listed`.
    await expect(
      api().admin.social.stories.save({ ...story, record: { format: 'update/1' } } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      api().admin.social.stories.save({ record: story.record } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('maps what the database refuses: the flag off, a newer version, a changed listing', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ['HZS18', noSuchCall],
      ['42501', noSuchCall],
      ['HZS19', { code: 'CONFLICT', status: 409, data: { reason: 'stale_record' } }],
      ['HZS25', { code: 'CONFLICT', status: 409, data: { reason: 'listing_fixed' } }],
    ];
    for (const [code, expected] of cases) {
      answer = () => fault(code, 'raised by the database');
      await expect(api().admin.social.stories.save(story), code).rejects.toMatchObject(expected);
    }
  });

  it('maps a rule the database raises when the transaction commits, by its constraint name', async () => {
    answer = () => snake(examples.admin.savedUpdate);
    atCommit = fault('23503', 'insert or update violates a foreign key', {
      constraint: 'updates_story_id_story',
    });
    const error = await api()
      .admin.social.updates.save(update)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'BAD_REQUEST', status: 400 });
    expect((error as { data: { issues: unknown[] } }).data.issues).toEqual([
      { path: 'record.story_id', message: 'No story has this ID: save the story first' },
    ]);
    // A rule the map doesn't know yet is still one issue, in the database's own words.
    atCommit = fault('23514', 'a rule of the store', {
      constraint: 'some_future_rule',
      hint: 'Fix it',
    });
    await expect(api().admin.social.updates.save(update)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      data: { issues: [{ path: 'record', message: 'a rule of the store: Fix it' }] },
    });
  });

  it('says "try again" when the database stays busy', async () => {
    answer = () => fault('55P03', 'lock timeout');
    await expect(api().admin.social.stories.save(story)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
  });
});

describe('saving an update', () => {
  it('runs social.admin_save_update and answers the update', async () => {
    answer = () => snake(examples.admin.savedUpdate);
    await expect(api().admin.social.updates.save(update)).resolves.toEqual(
      examples.admin.savedUpdate,
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe('select social.admin_save_update($1::jsonb) as answer');
    expect(JSON.parse(String(asked[0]?.values?.[0]))).toEqual(update.record);
  });

  it('answers a problem in the record as a 400 issue and an older version as a 409', async () => {
    await expect(
      api().admin.social.updates.save({ record: { ...update.record, headline: '' } } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(client.query).not.toHaveBeenCalled();
    answer = () => fault('HZS19', 'stale');
    await expect(api().admin.social.updates.save(update)).rejects.toMatchObject({
      code: 'CONFLICT',
      data: { reason: 'stale_record' },
    });
  });
});

describe("the saves' purges", () => {
  const storyId = examples.admin.savedStory.id;
  const updateStoryId = examples.admin.savedUpdate.storyId;

  /** The tags purged, in order, over every call. */
  const purged = () => invalidate.mock.calls.flatMap(([tags]) => tags);

  it('clear a story saved as new or changed: its story and desk tags, and the board when it is listed', async () => {
    for (const saved of ['new', 'changed'] as const) {
      invalidate.mockClear();
      answer = () => snake({ ...examples.admin.savedStory, saved, listed: true });
      await api().admin.social.stories.save(story);
      expect(purged(), saved).toEqual([
        `social:story:${storyId}`,
        `social:desk:${storyId}`,
        'social:board',
      ]);
    }
  });

  it('leave the board alone for an unlisted story, which is never on it', async () => {
    answer = () => snake({ ...examples.admin.savedStory, saved: 'new', listed: false });
    await api().admin.social.stories.save(story);
    expect(purged()).toEqual([`social:story:${storyId}`, `social:desk:${storyId}`]);
  });

  it('clear nothing for a story saved as same', async () => {
    answer = () => snake({ ...examples.admin.savedStory, saved: 'same' });
    await api().admin.social.stories.save(story);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("clear an update's story and the board, for new or changed, and nothing for same", async () => {
    for (const saved of ['new', 'changed'] as const) {
      invalidate.mockClear();
      answer = () => snake({ ...examples.admin.savedUpdate, saved });
      await api().admin.social.updates.save(update);
      expect(purged(), saved).toEqual([
        `social:story:${updateStoryId}`,
        `social:desk:${updateStoryId}`,
        'social:board',
      ]);
    }
    invalidate.mockClear();
    answer = () => snake({ ...examples.admin.savedUpdate, saved: 'same' });
    await api().admin.social.updates.save(update);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('come after the save, and a save that fails purges nothing', async () => {
    answer = () => fault('HZS19', 'stale');
    await expect(api().admin.social.stories.save(story)).rejects.toMatchObject({ status: 409 });
    answer = () => fault('42501', 'not an admin');
    await expect(api().admin.social.updates.save(update)).rejects.toMatchObject(noSuchCall);
    atCommit = fault('23503', 'a foreign key', { constraint: 'updates_story_id_story' });
    answer = () => snake(examples.admin.savedUpdate);
    await expect(api().admin.social.updates.save(update)).rejects.toMatchObject({ status: 400 });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('never fail the save, whether the edge refuses the purge or throws before it starts', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer = () => snake({ ...examples.admin.savedStory, saved: 'new' });
    invalidate.mockRejectedValue(new Error('the edge refused'));
    await expect(api().admin.social.stories.save(story)).resolves.toMatchObject({ saved: 'new' });
    invalidate.mockImplementation(() => {
      throw new Error('no purge here');
    });
    await expect(api().admin.social.stories.save(story)).resolves.toMatchObject({ saved: 'new' });
    answer = () => snake({ ...examples.admin.savedUpdate, saved: 'new' });
    await expect(api().admin.social.updates.save(update)).resolves.toMatchObject({ saved: 'new' });
    // Only the counts of what failed are logged.
    expect(log).toHaveBeenCalledWith(expect.any(String), { failed: 1, late: 0 });
    log.mockRestore();
  });
});

describe('making an invite', () => {
  /** The function's answer for an invite whose code ends in `shown`. */
  const made = (shown: string, extra: Record<string, unknown> = {}) =>
    snake({
      invite: {
        ...examples.admin.createdInvite.invite,
        email: invite.email,
        codeShown: shown,
        ...extra,
      },
      reissued: false,
    });

  it('makes the code here, sends the database only its hash and first group, and shows the code once', async () => {
    answer = ({ values }) => made(String(values?.[6]));
    const first = await api().admin.social.invites.create(invite);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe(
      'select social.admin_create_invite($1, $2, $3, $4, $5, $6, $7) as answer',
    );
    const [requestId, email, note, house, listed, hash, shown] = asked[0]?.values ?? [];
    expect([requestId, email, note, house, listed]).toEqual([
      invite.requestId,
      invite.email,
      invite.note,
      invite.house,
      invite.listed,
    ]);
    expect(Buffer.isBuffer(hash) && hash.length).toBe(32);
    expect(first.code).toMatch(/^hz-[0-9a-hjkmnp-tv-z]{4}(-[0-9a-hjkmnp-tv-z]{4}){3}$/);
    expect(shown).toBe(first.code.slice(0, 7));
    expect(first.invite.codeShown).toBe(shown);
    // The code is in the message, with the site's own address, and in no statement the database saw.
    expect(first.message).toBe(
      `You're invited to Hrizzup's agent beta. Give your agent this one line: Read https://staging.hrizzup.com/skill.md and join Hrizzup with invite code ${first.code}. It will give you a claim link: open it and sign in with ${invite.email}.`,
    );
    expect(JSON.stringify(asked)).not.toContain(first.code);
    // The invite as it is made: not revoked, so with no reason.
    expect(first.invite).toMatchObject({ revokedAt: null, revokedReason: null });
  });

  it('answers a fresh code to a retry of the same request, which replaces the first (D13)', async () => {
    answer = ({ values }) => made(String(values?.[6]));
    const first = await api().admin.social.invites.create(invite);
    const retry = await api().admin.social.invites.create(invite);
    expect(retry.invite.id).toBe(first.invite.id);
    expect(retry.code).not.toBe(first.code);
    expect(asked[1]?.values?.[0]).toBe(asked[0]?.values?.[0]);
    expect(asked[1]?.values?.[5]).not.toEqual(asked[0]?.values?.[5]);
  });

  it("doesn't answer a code that works for no one when the retry finds the invite already used or revoked, and says which, since a retry never changes it", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ usedAt: '2026-11-17T09:00:00Z' }, 'invite_used'],
      [{ revokedAt: '2026-11-17T09:00:00Z' }, 'invite_revoked'],
    ];
    for (const [closed, reason] of cases) {
      // The invite is under the code made now (its first group is the one sent), so only being used or
      // revoked can make the answer a 409: delete either check in the handler and this fails.
      answer = ({ values }) => made(String(values?.[6]), closed);
      const error = await api()
        .admin.social.invites.create(invite)
        .catch((caught: unknown) => caught);
      expect(error, reason).toMatchObject({ code: 'CONFLICT', status: 409, data: { reason } });
      expect((error as { message: string }).message).not.toMatch(/try again/i);
    }
  });

  it('says "try again" (a clash) only when an open invite is under another code than the one made now', async () => {
    answer = () => made('hz-0000');
    await expect(api().admin.social.invites.create(invite)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      data: { reason: 'clash' },
    });
  });

  it('maps what the database refuses: an open invite, a reused request ID, a bad email', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ['HZS23', { code: 'CONFLICT', status: 409, data: { reason: 'invite_open' } }],
      ['HZS27', { code: 'CONFLICT', status: 409, data: { reason: 'request_reused' } }],
      ['HZS28', { code: 'CONFLICT', status: 409, data: { reason: 'clash' } }],
      ['42501', noSuchCall],
      ['22023', { code: 'BAD_REQUEST', status: 400 }],
    ];
    for (const [code, expected] of cases) {
      answer = () => fault(code, "That isn't an email address");
      await expect(api().admin.social.invites.create(invite), code).rejects.toMatchObject(expected);
    }
  });

  it('refuses an input that is not an invite as a 400 issue, before the database', async () => {
    await expect(
      api().admin.social.invites.create({ ...invite, email: 'not an email' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', data: { issues: [{ path: 'email' }] } });
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('what the live calls say when they refuse', () => {
  it('uses social’s words for every 404 and 409 of the three calls, never a market’s or a perp’s', async () => {
    const calls = [
      () => api().admin.social.stories.save(story),
      () => api().admin.social.updates.save(update),
      () => api().admin.social.invites.create(invite),
    ];
    // Every refusal the database can make of them that answers a 404 or a 409.
    for (const code of ['HZS18', '42501', 'P0002', 'HZS19', 'HZS23', 'HZS25', 'HZS27', 'HZS28']) {
      answer = () => fault(code, 'raised by the database');
      for (const call of calls) {
        const error = (await call().catch((caught: unknown) => caught)) as {
          status?: number;
          message: string;
        };
        if (error.status !== 404 && error.status !== 409) continue;
        expect(error.message, `${code}: ${error.message}`).not.toMatch(/market|perp/i);
      }
    }
    // And for anyone who isn't an admin.
    signedIn.mockResolvedValue(null);
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ message: 'No such call' });
    }
  });
});

describe('who may make these calls', () => {
  const calls = [
    () => api().admin.social.stories.save(story),
    () => api().admin.social.updates.save(update),
    () => api().admin.social.invites.create(invite),
  ];

  it('is an admin only: anyone else, signed in or not, gets "No such call", whatever they send', async () => {
    for (const call of calls) {
      signedIn.mockResolvedValue(null);
      await expect(call()).rejects.toMatchObject(noSuchCall);
      signedIn.mockResolvedValue({ ...ADMIN, id: '00000000-0000-4000-8000-0000000000c2' });
      isAdmin.mockResolvedValue(false);
      await expect(call()).rejects.toMatchObject(noSuchCall);
    }
    // The admin check comes before the input is read, so a bad input gives nothing away.
    await expect(api().admin.social.stories.save({} as never)).rejects.toMatchObject(noSuchCall);
    await expect(api().admin.social.invites.create({} as never)).rejects.toMatchObject(noSuchCall);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("don't exist on production, until launch, for anyone: admins included", async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    for (const call of calls) await expect(call()).rejects.toMatchObject(noSuchCall);
    expect(isAdmin).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('leaves every console call that is not live yet, and only those, as an address that is not there, for an admin too', async () => {
    const consoleCalls = procedures(contract).filter(([name]) => name.startsWith('admin.social.'));
    const notLive = consoleCalls
      .filter(([, procedure]) => procedure['~orpc'].meta.live === false)
      .map(([name]) => name);
    const live = consoleCalls
      .filter(([, procedure]) => procedure['~orpc'].meta.live !== false)
      .map(([name]) => name);
    // M3b's two revocations are among those not yet live (with R8's two uploads); M3 and M3a's nine are live.
    expect(notLive).toEqual(
      expect.arrayContaining(['admin.social.invites.revoke', 'admin.social.agents.revokeKeys']),
    );
    expect(live.sort()).toEqual(
      expect.arrayContaining([
        'admin.social.agents.list',
        'admin.social.agents.set',
        'admin.social.invites.create',
        'admin.social.invites.list',
        'admin.social.settings.get',
        'admin.social.settings.set',
        'admin.social.stories.list',
        'admin.social.stories.save',
        'admin.social.updates.save',
      ]),
    );
    const input: Record<string, unknown> = {
      'admin.social.invites.revoke': { id: examples.admin.revokeInviteInput.id, reason: 'x' },
      'admin.social.agents.revokeKeys': { id: examples.admin.revokeKeysInput.id, reason: 'x' },
    };
    for (const name of notLive) {
      const call = name
        .split('.')
        .reduce<unknown>((tree, part) => (tree as Record<string, unknown>)[part], api()) as (
        input: unknown,
      ) => Promise<unknown>;
      await expect(call(input[name] ?? {}), name).rejects.toMatchObject(noSuchCall);
    }
    expect(client.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// M3a: the three lists, the settings and an agent's limits (R5's design note, section 4)
// ---------------------------------------------------------------------------------------------

/** The database's row for an agent (`social._admin_agent`): the example in snake_case, with the times the console never shows. */
function agentRow(agent: typeof examples.admin.adminAgent, extra: Record<string, unknown> = {}) {
  const { claimed, retired, keys, ...rest } = snake(agent) as Record<string, unknown> & {
    keys: Record<string, unknown>[];
  };
  return {
    ...rest,
    claimed_at: claimed ? '2026-11-16T11:30:00Z' : null,
    claim_expires_at: '2026-11-23T11:30:00Z',
    retired_at: retired ? '2026-11-17T09:00:00Z' : null,
    keys: keys.map((key) => ({ ...key, revoked_at: null })),
    ...extra,
  };
}

const AGENT = examples.admin.adminAgent.id;

describe('the three lists', () => {
  it("lists the invites, newest first: one call of social.admin_invites, 50 to a page when no limit is sent, answering the contract's own shape", async () => {
    answer = () => ({ invites: snake(examples.admin.invitePage.invites), next: null });
    await expect(api().admin.social.invites.list()).resolves.toEqual(examples.admin.invitePage);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe('select social.admin_invites($1, $2) as answer');
    expect(asked[0]?.values).toEqual([null, 50]);
    expect(setUp[0]?.[0]).toBe('hrizzup_app');
    expect(setUp[0]?.[2]).toBe(ADMIN.id);
    await api().admin.social.invites.list({ limit: 2 });
    expect(asked[1]?.values).toEqual([null, 2]);
  });

  it("answers an invite's reason for being revoked, and never its code", async () => {
    answer = () => ({ invites: snake(examples.admin.invitePage.invites), next: null });
    const page = await api().admin.social.invites.list();
    const revoked = page.invites.find((one) => one.revokedAt !== null);
    expect(revoked).toMatchObject({ revokedReason: 'expired' });
    expect(JSON.stringify(page)).not.toMatch(/"code"/);
  });

  it("hands out the last invite's ID as the cursor and takes it back as the database's key", async () => {
    const last = examples.admin.invitePage.invites[1]?.id ?? '';
    answer = () => ({ invites: snake(examples.admin.invitePage.invites.slice(0, 2)), next: last });
    const first = await api().admin.social.invites.list({ limit: 2 });
    expect(first.next).toEqual(expect.any(String));
    answer = () => ({ invites: [], next: null });
    await api().admin.social.invites.list({ limit: 2, cursor: first.next ?? '' });
    expect(asked[1]?.values).toEqual([last, 2]);
  });

  it('lists the stories, newest listed first: social.admin_stories with the cursor as JSON, and each story with its listing and its saved null', async () => {
    const next = { t: '2026-11-17T04:10:00Z', i: '01a1e7c2-4b00-7d2e-9f3a-4b5c6d7e8f90' };
    answer = () => ({ stories: snake(examples.admin.consoleStoryPage.stories), next });
    const page = await api().admin.social.stories.list({ limit: 2 });
    expect(page).toEqual(examples.admin.consoleStoryPage);
    expect(asked[0]?.text).toBe('select social.admin_stories($1::jsonb, $2) as answer');
    expect(asked[0]?.values).toEqual([null, 2]);
    expect(page.stories.every((one) => one.saved === null)).toBe(true);
    answer = () => ({ stories: [], next: null });
    await api().admin.social.stories.list({ cursor: page.next ?? '' });
    expect(JSON.parse(String(asked[1]?.values?.[0]))).toEqual(next);
    expect(asked[1]?.values?.[1]).toBe(50);
  });

  it('lists the agents, newest first: social.admin_agents, each as the console shows it', async () => {
    answer = () => ({
      agents: [agentRow(examples.admin.adminAgent), agentRow(examples.admin.retiredAgent)],
      next: examples.admin.retiredAgent.id,
    });
    const page = await api().admin.social.agents.list({ limit: 2 });
    expect(asked[0]?.text).toBe('select social.admin_agents($1, $2) as answer');
    expect(asked[0]?.values).toEqual([null, 2]);
    expect(page.agents).toEqual([examples.admin.adminAgent, examples.admin.retiredAgent]);
    expect(page.agents[1]).toMatchObject({
      retired: true,
      claimed: true,
      retiredReason: expect.any(String),
    });
    expect(page.next).toEqual(expect.any(String));
  });

  it("answers a cursor that isn't this list's as a 400 on `cursor`, before the database", async () => {
    const stories = { t: '2026-11-17T04:10:00Z', i: '01a1e7c2-4b00-7d2e-9f3a-4b5c6d7e8f90' };
    answer = () => ({ stories: [], next: stories });
    const theirs = (await api().admin.social.stories.list()).next ?? '';
    asked.length = 0;
    for (const bad of ['not-a-cursor', theirs, `${'a'.repeat(40)}`]) {
      for (const call of [
        () => api().admin.social.invites.list({ cursor: bad }),
        () => api().admin.social.agents.list({ cursor: bad }),
      ]) {
        await expect(call(), bad).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          status: 400,
          data: { issues: [{ path: 'cursor' }] },
        });
      }
    }
    await expect(api().admin.social.stories.list({ cursor: 'not-a-cursor' })).rejects.toMatchObject(
      {
        code: 'BAD_REQUEST',
        data: { issues: [{ path: 'cursor' }] },
      },
    );
    expect(asked).toHaveLength(0);
  });
});

describe('the settings', () => {
  it('reads every setting by its name, when they changed and the log, from social.admin_settings', async () => {
    answer = () => snake(examples.admin.settings);
    await expect(api().admin.social.settings.get()).resolves.toEqual(examples.admin.settings);
    expect(asked[0]?.text).toBe('select social.admin_settings() as answer');
    expect(asked[0]?.values).toEqual([]);
    // The log's changes are named as the settings are: in camelCase.
    expect(examples.admin.settings.log[0]?.changes).toHaveProperty('topWViews');
  });

  it("changes the settings through the one table of columns: only what was sent, under the database's names, with the reason", async () => {
    answer = () => snake(examples.admin.settings);
    await expect(api().admin.social.settings.set(examples.admin.setSettingsInput)).resolves.toEqual(
      examples.admin.settings,
    );
    expect(asked[0]?.text).toBe('select social.admin_set_settings($1::jsonb, $2) as answer');
    expect(JSON.parse(String(asked[0]?.values?.[0]))).toEqual({
      top_w_views: 0.01,
      top_w_upvotes: 0.5,
    });
    expect(asked[0]?.values?.[1]).toBe(examples.admin.setSettingsInput.reason);
    // A number, a count and a text, together: each under its own column.
    await api().admin.social.settings.set({
      changes: {
        readerAiModel: '@cf/meta/llama-3.2-3b-instruct',
        claimDays: 7,
        boardHalfLifeHours: 0.5,
      },
      reason: 'Back to the defaults',
    });
    expect(JSON.parse(String(asked[1]?.values?.[0]))).toEqual({
      reader_ai_model: '@cf/meta/llama-3.2-3b-instruct',
      claim_days: 7,
      board_half_life_hours: 0.5,
    });
    // A weight or a half-life re-ranks through the minute job, and every limit is the database's own to
    // enforce: nothing here is purged.
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refuses what is no setting, an empty change, a value out of range or a missing reason, as a 400 issue, before the database', async () => {
    const reason = 'A reason';
    const bad: Record<string, unknown>[] = [
      { changes: { notASetting: 1 }, reason },
      { changes: { ranks_version: 3 }, reason },
      { changes: { posts_per_day: 3 }, reason },
      { changes: {}, reason },
      { changes: { postsPerDay: 1001 }, reason },
      { changes: { claimDays: 0 }, reason },
      { changes: { boardHalfLifeHours: 0 }, reason },
      { changes: { readerAiDailyNeurons: 10_001 }, reason },
      { changes: { readerAiModel: 'has a space' }, reason },
      { changes: { postsPerDay: 1.5 }, reason },
      { changes: { postsPerDay: 5 } },
    ];
    for (const input of bad) {
      await expect(
        api().admin.social.settings.set(input as never),
        JSON.stringify(input),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
    }
    expect(client.query).not.toHaveBeenCalled();
  });

  it('answers a value the database refuses as a 400 on that setting: each setting by its own constraint, settings_<column>', async () => {
    for (const [field, column] of Object.entries(SETTING_COLUMNS)) {
      answer = () =>
        fault('23514', 'new row for relation "settings" violates check constraint', {
          constraint: `settings_${column}`,
        });
      const error = await api()
        .admin.social.settings.set({ changes: { postsPerDay: 5 }, reason: 'x' })
        .catch((caught: unknown) => caught);
      expect(error, field).toMatchObject({
        code: 'BAD_REQUEST',
        status: 400,
        data: { issues: [{ path: `changes.${field}`, message: expect.stringContaining(field) }] },
      });
    }
  });

  it('leaves any other rule of the table, and an unknown name, to the shared map: one issue for the whole input, and 22023 a 400', async () => {
    for (const constraint of [
      'settings_one_row',
      'settings_ranks_version',
      'settings_made_up',
      undefined,
    ]) {
      answer = () =>
        fault('23514', 'a rule of the table', constraint === undefined ? {} : { constraint });
      await expect(
        api().admin.social.settings.set({ changes: { postsPerDay: 5 }, reason: 'x' }),
        String(constraint),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        data: { issues: [{ path: '', message: expect.stringContaining('a rule of the table') }] },
      });
    }
    answer = () => fault('22023', 'There is no setting called x');
    await expect(
      api().admin.social.settings.set({ changes: { postsPerDay: 5 }, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400, data: { issues: [{ path: '' }] } });
    // The database's refusal of anyone but an admin is "No such call", from this call too.
    answer = () => fault('42501', 'not an admin');
    await expect(
      api().admin.social.settings.set({ changes: { postsPerDay: 5 }, reason: 'x' }),
    ).rejects.toMatchObject(noSuchCall);
  });
});

describe("an agent's mark, limits and video", () => {
  const sent = (changes: Record<string, unknown>) => ({ id: AGENT, changes, reason: 'Because' });
  /** The check-in's Redis copy and the edge's purge, stood in for. */
  const del = vi.fn(async (..._keys: string[]) => 1);
  const checkin = socialRedis.checkin.key('stg', AGENT);

  beforeEach(() => {
    del.mockReset();
    del.mockResolvedValue(1);
    resetSocialCache({ redis: { del } as never, prefix: 'stg' });
    answer = () => agentRow(examples.admin.adminAgent);
  });

  it("sends the agent's ID in lower case and only the changes that were sent, under the database's names, null as a present null", async () => {
    await expect(
      api().admin.social.agents.set({
        id: AGENT.toUpperCase(),
        changes: { house: true, postsPerDay: null, repliesPerHour: 200 },
        reason: 'Because',
      }),
    ).resolves.toEqual(examples.admin.adminAgent);
    expect(asked[0]?.text).toBe('select social.admin_set_agent($1, $2::jsonb, $3) as answer');
    expect(asked[0]?.values?.[0]).toBe(AGENT);
    expect(JSON.parse(String(asked[0]?.values?.[1]))).toEqual({
      house: true,
      posts_per_day: null,
      replies_per_hour: 200,
    });
    expect(asked[0]?.values?.[2]).toBe('Because');
    await api().admin.social.agents.set(sent({ videoMediaId: AGENT }));
    expect(JSON.parse(String(asked[1]?.values?.[1]))).toEqual({ video_media_id: AGENT });
  });

  it("refuses a limit past the settings' maximums, a made-up change or no change, before the database", async () => {
    for (const changes of [
      { postsPerDay: 1001 },
      { repliesPerHour: 10_001 },
      { postsPerDay: -1 },
      { postsPerDay: 1.5 },
      { notAThing: 1 },
      { posts_per_day: 5 },
      {},
    ]) {
      await expect(
        api().admin.social.agents.set(sent(changes) as never),
        JSON.stringify(changes),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
    }
    // The settings' own maximums are accepted.
    await api().admin.social.agents.set(sent({ postsPerDay: 1000, repliesPerHour: 10_000 }));
    expect(asked).toHaveLength(1);
  });

  it("forgets the agent's check-in copy when a limit was sent (a limit set to null too), and clears no edge copy for it", async () => {
    for (const changes of [{ postsPerDay: 5 }, { repliesPerHour: 9 }, { postsPerDay: null }]) {
      del.mockClear();
      await api().admin.social.agents.set(sent(changes));
      expect(del, JSON.stringify(changes)).toHaveBeenCalledTimes(1);
      expect(del).toHaveBeenCalledWith(checkin);
    }
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("clears the agent's edge copies and the directory's when the mark or the video was sent, and leaves the check-in alone", async () => {
    for (const changes of [{ house: false }, { videoMediaId: null }, { videoMediaId: AGENT }]) {
      invalidate.mockClear();
      await api().admin.social.agents.set(sent(changes));
      expect(invalidate, JSON.stringify(changes)).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledWith([`social:agent:${AGENT}`, 'social:agents']);
    }
    expect(del).not.toHaveBeenCalled();
    // Both, when both were sent.
    await api().admin.social.agents.set(sent({ house: true, repliesPerHour: 5 }));
    expect(del).toHaveBeenCalledWith(checkin);
    expect(invalidate).toHaveBeenLastCalledWith([`social:agent:${AGENT}`, 'social:agents']);
  });

  it('never fails once the change has committed, whether Redis or the edge fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    del.mockRejectedValue(new Error('Redis is down'));
    invalidate.mockRejectedValue(new Error('the edge refused'));
    await expect(
      api().admin.social.agents.set(sent({ house: true, postsPerDay: 7 })),
    ).resolves.toEqual(examples.admin.adminAgent);
    del.mockImplementation(() => {
      throw new Error('no Redis here');
    });
    invalidate.mockImplementation(() => {
      throw new Error('no purge here');
    });
    await expect(
      api().admin.social.agents.set(sent({ house: true, postsPerDay: 7 })),
    ).resolves.toEqual(examples.admin.adminAgent);
    log.mockRestore();
  });

  it('with no Redis at all, still answers and clears the edge', async () => {
    resetSocialCache(null);
    await expect(
      api().admin.social.agents.set(sent({ house: true, postsPerDay: 7 })),
    ).resolves.toEqual(examples.admin.adminAgent);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("answers a video that is not the agent's ready one as a 400 on changes.videoMediaId, and any other 22023 as the whole input", async () => {
    answer = () => fault('22023', "That isn't a ready video of this agent's");
    await expect(
      api().admin.social.agents.set(sent({ videoMediaId: AGENT })),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      data: { issues: [{ path: 'changes.videoMediaId' }] },
    });
    await expect(api().admin.social.agents.set(sent({ house: true }))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      data: { issues: [{ path: '' }] },
    });
  });

  it('answers an agent that is not there as 404 "No such agent", and a refusal changes and clears nothing', async () => {
    answer = () => fault('P0002', 'No such agent');
    await expect(
      api().admin.social.agents.set(sent({ house: true, postsPerDay: 3 })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'No such agent' });
    answer = () => fault('42501', 'not an admin');
    await expect(
      api().admin.social.agents.set(sent({ house: true, postsPerDay: 3 })),
    ).rejects.toMatchObject(noSuchCall);
    expect(del).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("the ready message's address", () => {
  const made = (shown: string) =>
    snake({
      invite: { ...examples.admin.createdInvite.invite, email: invite.email, codeShown: shown },
      reissued: false,
    });
  const addressOf = async (context: { url?: string; headers?: Headers }) => {
    answer = ({ values }) => made(String(values?.[6]));
    const created = await api(context).admin.social.invites.create(invite);
    return /Read (\S+)\/skill\.md/.exec(created.message)?.[1];
  };

  it("names staging's address on staging and on a preview, whatever address the request came to", async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
    expect(await addressOf({ url: 'https://other.example.com/api/v1/admin/social/invites' })).toBe(
      'https://staging.hrizzup.com',
    );
    vi.stubEnv('VERCEL_TARGET_ENV', 'preview');
    expect(
      await addressOf({
        url: 'https://hrizzup-git-branch-team.vercel.app/api/v1/admin/social/invites',
      }),
    ).toBe('https://staging.hrizzup.com');
  });

  it("names this Mac's own address, the one the request came to, on development", async () => {
    vi.stubEnv('VERCEL', '');
    expect(await addressOf({ url: 'http://localhost:3103/api/v1/admin/social/invites' })).toBe(
      'http://localhost:3103',
    );
  });
});

describe('who may make the six calls of M3a', () => {
  const calls = [
    () => api().admin.social.invites.list(),
    () => api().admin.social.stories.list(),
    () => api().admin.social.settings.get(),
    () => api().admin.social.settings.set({ changes: { postsPerDay: 5 }, reason: 'x' }),
    () => api().admin.social.agents.list(),
    () => api().admin.social.agents.set({ id: AGENT, changes: { house: true }, reason: 'x' }),
  ];

  it('is an admin only: anyone else, signed in or not, gets "No such call", whatever they send, and nothing is asked of the database', async () => {
    for (const call of calls) {
      signedIn.mockResolvedValue(null);
      await expect(call()).rejects.toMatchObject(noSuchCall);
      signedIn.mockResolvedValue({ ...ADMIN, id: '00000000-0000-4000-8000-0000000000c2' });
      isAdmin.mockResolvedValue(false);
      await expect(call()).rejects.toMatchObject(noSuchCall);
    }
    // The admin check comes before the input is read, so a bad input gives nothing away.
    await expect(api().admin.social.settings.set({} as never)).rejects.toMatchObject(noSuchCall);
    await expect(api().admin.social.agents.set({} as never)).rejects.toMatchObject(noSuchCall);
    await expect(api().admin.social.invites.list({ cursor: 'not-a-cursor' })).rejects.toMatchObject(
      noSuchCall,
    );
    expect(client.query).not.toHaveBeenCalled();
  });

  it("don't exist on production, until launch, for anyone: admins included", async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    for (const call of calls) await expect(call()).rejects.toMatchObject(noSuchCall);
    expect(isAdmin).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('turn away what the database refuses as not an admin as "No such call" too (the database checks again inside)', async () => {
    answer = () => fault('42501', 'not an admin');
    for (const call of calls) await expect(call()).rejects.toMatchObject(noSuchCall);
  });
});
