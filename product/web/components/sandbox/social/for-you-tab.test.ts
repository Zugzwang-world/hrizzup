import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The board's For You tab (docs/social/r12-design.md, section 4.3), its four cases: signed out (the link, and no
 * call), signed in with a profile that holds something and no remembered choice (a redirect to For You), the same
 * with the choice remembered (the tabs), and `reader.get` failing (the tabs, never a redirect). Everything the tab
 * reads (who is signed in, the reader's state, the cookies) is stood in for, and `redirect` throws as Next's does,
 * so a test can tell whether the tab's code sits inside the `try`: a redirect caught by it would never leave.
 */

const viewerState = vi.hoisted(() => ({ signedIn: true }));
const reader = vi.hoisted(() => ({ get: vi.fn() }));
const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));
const cookiesRead = vi.hoisted(() => ({ times: 0 }));

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}

vi.mock('@/lib/sandbox/data.ts', () => ({ viewer: async () => ({ ...viewerState }) }));
vi.mock('@/lib/api/server.ts', () => ({ serverApi: { reader } }));
vi.mock('next/headers', () => ({
  cookies: async () => {
    cookiesRead.times++;
    return {
      get: (name: string) =>
        name === 'hz-social-tab' && cookieValue.value !== undefined
          ? { name, value: cookieValue.value }
          : undefined,
    };
  },
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw new Redirected(to);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { ForYouTab, BoardTabs } = await import('./for-you-tab.tsx');

beforeEach(() => {
  viewerState.signedIn = true;
  reader.get.mockReset();
  cookieValue.value = undefined;
  cookiesRead.times = 0;
});

const html = async () => renderToStaticMarkup(await ForYouTab());

describe('the board’s For You tab', () => {
  it('signed out: one line with a plain link to sign in and come back, and no call is made', async () => {
    viewerState.signedIn = false;
    const markup = await html();
    expect(markup).toContain('Sign in to get your own For You');
    expect(markup).toContain('href="/sign-in-test?next=/sandbox/social/reader"');
    expect(markup).not.toContain('data-testid="board-tabs"');
    expect(reader.get).not.toHaveBeenCalled();
    // Not even the cookies are read: the board's signed-out load does no extra work.
    expect(cookiesRead.times).toBe(0);
  });

  it('signed in, a profile that holds something and no remembered choice: redirects to For You', async () => {
    reader.get.mockResolvedValue({ holdsSomething: true });
    await expect(ForYouTab()).rejects.toMatchObject({ to: '/sandbox/social/reader/for-you' });
    expect(reader.get).toHaveBeenCalledTimes(1);
  });

  it('signed in, a profile that holds something and the board chosen: the tabs, with Board current', async () => {
    reader.get.mockResolvedValue({ holdsSomething: true });
    cookieValue.value = 'board';
    const markup = await html();
    expect(markup).toContain('data-testid="board-tabs"');
    expect(markup).toMatch(/<span aria-current="true"[^>]*>Board<\/span>/);
    expect(markup).toMatch(/<button type="submit"[^>]*>For You<\/button>/);
  });

  it('signed in, nothing in the profile: the tabs, never a redirect', async () => {
    reader.get.mockResolvedValue({ holdsSomething: false });
    expect(await html()).toContain('data-testid="board-tabs"');
  });

  it('signed in, a cookie that is not the board’s value: still opens on For You', async () => {
    reader.get.mockResolvedValue({ holdsSomething: true });
    cookieValue.value = 'something-else';
    await expect(ForYouTab()).rejects.toBeInstanceOf(Redirected);
  });

  it('signed in, the reader’s state failing: the tabs and no redirect, so the board still renders', async () => {
    reader.get.mockRejectedValue(new Error('the database is down'));
    const markup = await html();
    expect(markup).toContain('data-testid="board-tabs"');
    expect(markup).toMatch(/<span aria-current="true"[^>]*>Board<\/span>/);
  });
});

describe('the tab strip', () => {
  it('shows the current tab as plain text and the other as a form button, on either page', () => {
    const board = renderToStaticMarkup(createElement(BoardTabs, { current: 'board' }));
    expect(board.match(/<span aria-current="true"/g)).toHaveLength(1);
    expect(board.match(/<button type="submit"/g)).toHaveLength(1);
    expect(board).toMatch(/<button type="submit"[^>]*>For You<\/button>/);
    const forYou = renderToStaticMarkup(createElement(BoardTabs, { current: 'for-you' }));
    expect(forYou).toMatch(/<span aria-current="true"[^>]*>For You<\/span>/);
    expect(forYou).toMatch(/<button type="submit"[^>]*>Board<\/button>/);
    // A POST form each: no link sets a cookie (it would be fetched ahead).
    expect(board).not.toContain('<a ');
    expect(forYou).not.toContain('<a ');
  });
});
