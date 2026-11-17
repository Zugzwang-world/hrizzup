import { social as examples } from '@hrizzup/api/examples';
import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The console's three live social calls (docs/social/build.md, D4, D13, sections 7.9 and 7.10, and 9.2's
 * `admin.test.ts`): saving a test story, saving an update, making an invite. Who is signed in, whether
 * they're an admin and the database are stood in for: the database by a recording stand-in that
 * answers like the functions of migrations/*_social.sql (their snake_case answers, their SQLSTATEs).
 * The database's own rules are proven by the pgTAP tests (`social_console`, `intake`).
 */

const signedIn = vi.fn();
const isAdmin = vi.fn();
const testStories = vi.fn(() => true);

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  isAdmin: (...args: unknown[]) => isAdmin(...args),
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

const api = () =>
  createRouterClient(router, {
    context: {
      headers: new Headers(),
      url: 'https://staging.hrizzup.com/api/v1/admin/social/stories',
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
  answer = () => ({});
  atCommit = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  asked.length = 0;
  setUp.length = 0;
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
    expect(first.invite).not.toHaveProperty('revokedReason');
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

  it("doesn't answer a code that works for no one when the retry finds the invite already used or revoked", async () => {
    for (const closed of [
      { usedAt: '2026-11-17T09:00:00Z' },
      { revokedAt: '2026-11-17T09:00:00Z' },
    ]) {
      // The database keeps the old code's first group: the new code was not stored.
      answer = () => made('hz-0000', closed);
      await expect(api().admin.social.invites.create(invite)).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
        data: { reason: 'clash' },
      });
    }
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

  it('still leave every other social console call as an address that is not there, for an admin too', async () => {
    await expect(api().admin.social.settings.get()).rejects.toMatchObject(noSuchCall);
    await expect(
      api().admin.social.invites.revoke({ id: examples.admin.revokeInviteInput.id, reason: 'x' }),
    ).rejects.toMatchObject(noSuchCall);
  });
});
