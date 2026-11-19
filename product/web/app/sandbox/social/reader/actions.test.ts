import { ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reader's server actions (actions.ts; docs/social/r12-design.md, sections 4.3 and 4.4): the board's two tabs
 * (the session cookie, set and deleted on the same path, and a redirect after each, never inside a `try`), and the
 * chat's and the profile's buttons (the API's own calls, in process, answered in words; what is no refusal is
 * thrown on). Next's cookies, headers, redirect and cache, the sandbox's gate and the typed API are stood in for.
 */

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}

const events: string[] = [];
const jar = vi.hoisted(() => ({
  set: vi.fn<(name: string, value: string, options: Record<string, unknown>) => void>(),
  delete: vi.fn<(options: { name: string; path: string }) => void>(),
}));
const request = vi.hoisted(() => ({ forwardedProto: null as string | null }));
const api = vi.hoisted(() => ({
  send: vi.fn(),
  save: vi.fn(),
}));
const gate = vi.hoisted(() => ({ closed: false }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => {
      events.push('cookie set');
      jar.set(name, value, options);
    },
    delete: (options: { name: string; path: string }) => {
      events.push('cookie delete');
      jar.delete(options);
    },
  }),
  headers: async () =>
    new Headers(
      request.forwardedProto === null ? {} : { 'x-forwarded-proto': request.forwardedProto },
    ),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    events.push(`redirect ${to}`);
    throw new Redirected(to);
  },
}));
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    events.push(`revalidate ${path}`);
  },
}));
vi.mock('@/lib/sandbox/gate.ts', () => ({
  sandboxOnly: () => {
    events.push('gate');
    if (gate.closed) throw new Error('not found');
  },
}));
vi.mock('@/lib/api/server.ts', () => ({
  serverApi: { reader: { chat: { send: api.send }, saveProfile: api.save } },
}));

const { showBoard, showForYou, sendMessage, saveProfile } = await import('./actions.ts');

const REQUEST = '019a7b10-0000-7000-8000-0000000000e1';

beforeEach(() => {
  events.length = 0;
  jar.set.mockReset();
  jar.delete.mockReset();
  api.send.mockReset();
  api.save.mockReset();
  request.forwardedProto = null;
  gate.closed = false;
});

describe('the board’s tabs', () => {
  it('Board remembers the choice in a session cookie for the social sandbox, then shows the board', async () => {
    await expect(showBoard()).rejects.toMatchObject({ to: '/sandbox/social' });
    expect(jar.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = jar.set.mock.calls[0] ?? [];
    expect(name).toBe('hz-social-tab');
    expect(value).toBe('board');
    expect(options).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/sandbox/social',
    });
    // A session cookie: no `maxAge` and no `expires`.
    expect(options).not.toHaveProperty('maxAge');
    expect(options).not.toHaveProperty('expires');
    // The cookie is set before the redirect leaves.
    expect(events).toEqual(['gate', 'cookie set', 'redirect /sandbox/social']);
  });

  it('marks the cookie Secure when the request came over HTTPS, and not on plain http', async () => {
    for (const [proto, secure] of [
      ['https', true],
      ['https,http', true],
      ['HTTPS', true],
      ['http', false],
      [null, false],
    ] as const) {
      request.forwardedProto = proto;
      jar.set.mockReset();
      await expect(showBoard()).rejects.toBeInstanceOf(Redirected);
      expect(jar.set.mock.calls[0]?.[2], String(proto)).toMatchObject({ secure });
    }
  });

  it('For You deletes the cookie by naming the same path it was set on, then shows For You', async () => {
    await expect(showForYou()).rejects.toMatchObject({ to: '/sandbox/social/reader/for-you' });
    expect(jar.delete).toHaveBeenCalledWith({ name: 'hz-social-tab', path: '/sandbox/social' });
    expect(events).toEqual(['gate', 'cookie delete', 'redirect /sandbox/social/reader/for-you']);
  });

  it('is turned away outside the sandbox, before anything is set', async () => {
    gate.closed = true;
    await expect(showBoard()).rejects.toThrow('not found');
    await expect(showForYou()).rejects.toThrow('not found');
    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });
});

describe('sendMessage', () => {
  it('sends the message through the typed API with its request ID, and says it went through, showing the page fresh', async () => {
    api.send.mockResolvedValue({});
    const answer = await sendMessage(REQUEST, 'More cricket, no crypto');
    expect(api.send).toHaveBeenCalledWith({ requestId: REQUEST, body: 'More cricket, no crypto' });
    expect(answer).toMatchObject({ ok: true, final: true, issues: [] });
    expect(events).toEqual(['gate', 'revalidate /sandbox/social/reader']);
  });

  it('answers a definitive refusal in words and shows the page fresh (the count and the pause changed)', async () => {
    api.send.mockRejectedValue(
      new ORPCError('TOO_MANY_REQUESTS', {
        status: 429,
        message: "You've used today's 20 messages",
        data: { reason: 'daily_cap', retryAfterSeconds: 600 },
      }),
    );
    const answer = await sendMessage(REQUEST, 'Hello');
    expect(answer).toMatchObject({
      ok: false,
      final: true,
      message: "You've used today's 20 messages",
    });
    expect(events).toContain('revalidate /sandbox/social/reader');
  });

  it('answers a message still being answered in words and keeps the request ID, with nothing refreshed', async () => {
    api.send.mockRejectedValue(
      new ORPCError('CONFLICT', {
        status: 409,
        message: 'still answering',
        data: { reason: 'clash' },
      }),
    );
    const answer = await sendMessage(REQUEST, 'Hello');
    expect(answer).toMatchObject({ ok: false, final: false });
    expect(events).not.toContain('revalidate /sandbox/social/reader');
  });

  it('throws on what is no refusal, so the form keeps its request ID', async () => {
    api.send.mockRejectedValue(new Error('the network went away'));
    await expect(sendMessage(REQUEST, 'Hello')).rejects.toThrow('the network went away');
  });

  it('is turned away outside the sandbox, before any call', async () => {
    gate.closed = true;
    await expect(sendMessage(REQUEST, 'Hello')).rejects.toThrow('not found');
    expect(api.send).not.toHaveBeenCalled();
  });
});

describe('saveProfile', () => {
  it('saves through the typed API and answers the profile as it is stored, for the form to show', async () => {
    api.save.mockResolvedValue({
      profile: '# Reading profile\n\n## More of\n- cricket\n\n## Less of\n\n## Formats',
    });
    const answer = await saveProfile(REQUEST, '* Cricket');
    expect(api.save).toHaveBeenCalledWith({ requestId: REQUEST, body: '* Cricket' });
    expect(answer).toEqual({
      ok: true,
      message: 'Saved',
      issues: [],
      final: true,
      profile: '# Reading profile\n\n## More of\n- cricket\n\n## Less of\n\n## Formats',
    });
    expect(events).toEqual(['gate', 'revalidate /sandbox/social/reader']);
  });

  it('answers a profile that does not read as a list of issues with their lines, and nothing is shown fresh', async () => {
    api.save.mockRejectedValue(
      new ORPCError('BAD_REQUEST', {
        status: 400,
        message: 'Line 1: each line is a heading or an item starting with "- "',
        data: {
          issues: [
            {
              path: 'body',
              message: 'Line 1: each line is a heading or an item starting with "- "',
            },
          ],
        },
      }),
    );
    const answer = await saveProfile(REQUEST, 'just text');
    expect(answer).toMatchObject({
      ok: false,
      final: true,
      profile: null,
      issues: ['Line 1: each line is a heading or an item starting with "- "'],
    });
    expect(events).not.toContain('revalidate /sandbox/social/reader');
  });

  it('throws on what is no refusal', async () => {
    api.save.mockRejectedValue(new Error('the network went away'));
    await expect(saveProfile(REQUEST, 'x')).rejects.toThrow('the network went away');
  });
});
