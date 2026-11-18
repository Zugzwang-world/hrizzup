import { PRINTED_TIME } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Social's calls are printed like every call's (`lib/api/base.ts`'s `everyCall`, which calls the
 * printer in product/packages/api/src/times.ts): every time has exactly three decimals, whichever
 * way the database wrote it (the founder's decision, 18 November 2026, R5's M7; docs/research/api-times.md).
 * Here a live social console call (making an invite) and the agent's check-in and its mark, with the
 * database stood in for as in lib/api/social/admin.test.ts and agents-posting.test.ts. The printer
 * itself, and every social call's example, are tested with no website in
 * product/packages/api/src/times.test.ts.
 *
 * The one time of social's that is sent back is the check-in's `asOf`, as `seenUntil` of its
 * `checkinDone`. The printer cuts and never rounds, so the printed value is never later than the
 * database's: its function (`social.checkin_done`) refuses a `seen_until` after its clock, which a cut
 * never is, and keeps the items saved after the mark (`saved_at > mark`), so the last millisecond's
 * items can be shown again, and none is ever skipped.
 */

const signedIn = vi.fn();
const isAdmin = vi.fn();
const findKey = vi.fn();
const allowKeyRead = vi.fn();
const allowAgentWrite = vi.fn();
let answer: (values: unknown[] | undefined) => unknown = () => ({});
/** What `social.checkin_me()` answers, as the database writes it. */
let checkinMe: () => Record<string, unknown> = () => ({});

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  isAdmin: (...args: unknown[]) => isAdmin(...args),
}));
vi.mock('@/lib/api/keys.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/keys.ts')>()),
  findKey: (_pool: unknown, text: string) => findKey(text),
}));
vi.mock('@/lib/api/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit.ts')>()),
  allowKeyRead: (key: string) => allowKeyRead(key),
}));
vi.mock('@/lib/social/limits.ts', async (original) => ({
  ...(await original<typeof import('@/lib/social/limits.ts')>()),
  allowAgentWrite: (key: string) => allowAgentWrite(key),
}));
const sent: { text: string; values: unknown[] | undefined }[] = [];
const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text === 'begin' || text === 'rollback' || text === 'commit') return { rows: [] };
    if (text.startsWith('select set_config')) return { rows: [] };
    sent.push({ text, values });
    if (text.startsWith('select social.checkin_me()')) return { rows: [checkinMe()] };
    return { rows: [{ answer: answer(values) }] };
  }),
  release: vi.fn(),
};
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: async () => client }) }));

const { router } = await import('@/lib/api/router.ts');
const { resetSocialCache } = await import('@/lib/social/cache.ts');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000c1', email: 'ada@console.test' };
const AGENT_ID = '019a7b10-0000-7000-8000-0000000000b1';
const KEY_ID = '019a7b10-0000-7000-8000-0000000000d1';
const REQUEST = '019a7b10-0000-7000-8000-0000000000e1';
// A made-up secret, never a real one.
const POST_KEY = `hz_demo_${'p'.repeat(43)}`;

/** snake_case from camelCase, deeply: what the database's functions answer. */
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

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
  findKey.mockImplementation(async (text: string) =>
    text === POST_KEY ? { id: KEY_ID, kind: 'post', agentId: AGENT_ID } : null,
  );
  allowKeyRead.mockResolvedValue({ allowed: true });
  allowAgentWrite.mockResolvedValue({ allowed: true });
  // No Redis: the check-in is asked of the database every time.
  resetSocialCache(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  sent.length = 0;
  resetSocialCache(undefined);
});

describe('a live social console call', () => {
  it('prints the times as three decimals, whatever form its function wrote them in', async () => {
    const made = examples.admin.createdInvite.invite;
    answer = (values) =>
      snake({
        invite: {
          ...made,
          email: examples.admin.createInviteInput.email,
          codeShown: String(values?.[6]),
          createdAt: '2026-11-17T09:00:00.3Z',
          expiresAt: '2026-12-17T09:00:00Z',
        },
        reissued: false,
      });
    const api = createRouterClient(router, {
      context: {
        headers: new Headers(),
        url: 'https://staging.hrizzup.com/api/v1/admin/social/invites',
      },
    });
    const created = await api.admin.social.invites.create(examples.admin.createInviteInput);
    expect(created.invite.createdAt).toBe('2026-11-17T09:00:00.300Z');
    expect(created.invite.expiresAt).toBe('2026-12-17T09:00:00.000Z');
    expect(created.invite.createdAt).toMatch(PRINTED_TIME);
    expect(created.invite.expiresAt).toMatch(PRINTED_TIME);
  });
});

describe('the agent’s check-in and its mark', () => {
  const asKey = { authorization: `Bearer ${POST_KEY}` };
  const agent = () =>
    createRouterClient(router, {
      context: {
        headers: new Headers(asKey),
        url: 'https://staging.hrizzup.com/api/v1/social/me/checkin',
        resHeaders: new Headers(),
      },
    });
  const checkinRow = (asOf: string) => ({
    agent: {
      since: '2026-11-17T08:00:00.000000Z',
      as_of: asOf,
      limits: {
        posts_per_day: 10,
        posts_left: 9,
        next_post_at: null,
        replies_per_hour: 20,
        replies_left: 20,
        next_reply_at: null,
      },
      last_note: null,
    },
    stories: { stories: [], more: false },
    agent_card: {
      agent: {
        id: AGENT_ID,
        handle: 'delhi_explainer',
        name: 'Delhi Explainer',
        picture: null,
        house: false,
        owner_name: 'Ada Owner',
        state: 'claimed',
        claim_expires_at: null,
        limits: {
          posts_per_day: 10,
          posts_left: 9,
          next_post_at: null,
          replies_per_hour: 20,
          replies_left: 20,
          next_reply_at: null,
        },
      },
    },
  });

  /** `time` to the nanosecond, so a text's order is the time's. */
  const exactly = (time: string) => {
    const [head = '', fraction = ''] = time.slice(0, -1).split('.');
    return `${head}.${fraction.padEnd(9, '0')}`;
  };

  it('prints `asOf` and `since` with three decimals, and what is sent back as `seenUntil` is exactly that', async () => {
    checkinMe = () => checkinRow('2026-11-18T08:05:00.123456Z');
    const checkin = await agent().social.me.checkin();
    expect(checkin.asOf).toBe('2026-11-18T08:05:00.123Z');
    expect(checkin.since).toBe('2026-11-17T08:00:00.000Z');

    // The agent sends `asOf` back as `seenUntil`, as the check-in tells it to: the database is given
    // exactly what was printed, and answers the mark, which is printed again the same way.
    answer = () => ({ seen_until: '2026-11-18T08:05:00.123456Z', at: '2026-11-18T08:06:00.5Z' });
    const done = await agent().social.me.checkinDone({
      requestId: REQUEST,
      seenUntil: checkin.asOf,
    });
    const doneStatement = sent.find((statement) => statement.text.includes('checkin_done'));
    expect(doneStatement?.values).toEqual([REQUEST, '2026-11-18T08:05:00.123Z', null]);
    expect(done).toEqual({ seenUntil: '2026-11-18T08:05:00.123Z', at: '2026-11-18T08:06:00.500Z' });
  });

  it.each([
    '2026-11-18T08:05:00Z',
    '2026-11-18T08:05:00.5Z',
    '2026-11-18T08:05:00.000001Z',
    '2026-11-18T08:05:00.123456Z',
    '2026-11-18T08:05:00.999999Z',
    '2026-12-31T23:59:59.999999Z',
  ])(
    'answers `asOf` %s cut, never rounded, so never later than the database’s own clock',
    async (stored) => {
      checkinMe = () => checkinRow(stored);
      const { asOf } = await agent().social.me.checkin();
      expect(asOf).toMatch(PRINTED_TIME);
      // Its first digits are the stored time's own (a carry into the next second or year would change
      // them), so it is never later, and earlier by less than a millisecond.
      const cut = asOf.slice(0, -1);
      expect(exactly(stored).startsWith(cut), `${stored} -> ${asOf}`).toBe(true);
      expect(`${cut}000000` <= exactly(stored)).toBe(true);
    },
  );
});
