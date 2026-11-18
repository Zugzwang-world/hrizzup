import { PRINTED_TIME } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Social's calls are left as they are by the printer of times (`lib/api/base.ts`'s `everyCall`,
 * product/packages/api/src/times.ts): they are beta, and social adopts it in its own milestone
 * (docs/research/api-times.md, "what's left open"). A live social console call, here making an
 * invite, answers a time as its function wrote it, `….3Z`; this test changes the day social adopts
 * the printer. The database is stood in for, as in lib/api/social/admin.test.ts.
 */

const signedIn = vi.fn();
const isAdmin = vi.fn();
let answer: (values: unknown[] | undefined) => unknown = () => ({});

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  isAdmin: (...args: unknown[]) => isAdmin(...args),
}));
const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text === 'begin' || text === 'rollback' || text === 'commit') return { rows: [] };
    if (text.startsWith('select set_config')) return { rows: [] };
    return { rows: [{ answer: answer(values) }] };
  }),
  release: vi.fn(),
};
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: async () => client }) }));

const { router } = await import('@/lib/api/router.ts');

const ADMIN = { id: '00000000-0000-4000-8000-0000000000c1', email: 'ada@console.test' };

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
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('a live social console call, until social adopts the printer', () => {
  it('answers the times as its function wrote them, `….3Z` and all', async () => {
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
    expect(created.invite.createdAt).toBe('2026-11-17T09:00:00.3Z');
    expect(created.invite.expiresAt).toBe('2026-12-17T09:00:00Z');
    expect(created.invite.createdAt).not.toMatch(PRINTED_TIME);
  });
});
