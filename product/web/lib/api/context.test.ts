import { createChunks, createServerClient, stringToBase64URL } from '@supabase/ssr';
import { describe, expect, it } from 'vitest';
import { accessTokenFromCookies, sessionCookieName } from './context.ts';

const URL_OF_PROJECT = 'https://abcdefghijklmnop.supabase.co';
const header = (cookies: { name: string; value: string }[]) =>
  cookies.map(({ name, value }) => `${name}=${value}`).join('; ');

describe("reading the website's session cookie", () => {
  it('names the cookie as Supabase does', () => {
    const client = createServerClient(URL_OF_PROJECT, 'sb_publishable_test', {
      cookies: { getAll: () => [], setAll: () => {} },
    });
    // Supabase's own client keeps its storage key private; the test reads it to stay in step.
    expect((client.auth as unknown as { storageKey: string }).storageKey).toBe(
      sessionCookieName(URL_OF_PROJECT),
    );
  });

  it('finds the access token in a session stored as Supabase stores it, chunks and all', async () => {
    const session = {
      access_token: 'the-access-token',
      refresh_token: 'r',
      padding: 'x'.repeat(6000),
    };
    const value = `base64-${stringToBase64URL(JSON.stringify(session))}`;
    const chunks = createChunks(sessionCookieName(URL_OF_PROJECT), value);
    expect(chunks.length).toBeGreaterThan(1);
    await expect(accessTokenFromCookies(header(chunks), URL_OF_PROJECT)).resolves.toBe(
      'the-access-token',
    );
  });

  it('reads a cookie written without the base64 prefix too', async () => {
    const cookie = [
      {
        name: sessionCookieName(URL_OF_PROJECT),
        value: encodeURIComponent(JSON.stringify({ access_token: 'plain' })),
      },
    ];
    await expect(accessTokenFromCookies(header(cookie), URL_OF_PROJECT)).resolves.toBe('plain');
  });

  it('finds nothing without a session cookie, or in a broken one', async () => {
    await expect(accessTokenFromCookies(null, URL_OF_PROJECT)).resolves.toBeNull();
    await expect(accessTokenFromCookies('other=1', URL_OF_PROJECT)).resolves.toBeNull();
    const broken = [{ name: sessionCookieName(URL_OF_PROJECT), value: 'base64-%%%' }];
    await expect(accessTokenFromCookies(header(broken), URL_OF_PROJECT)).resolves.toBeNull();
  });

  it("ignores another project's session cookie", async () => {
    const other = [
      { name: sessionCookieName('https://someoneelse.supabase.co'), value: 'base64-e30' },
    ];
    await expect(accessTokenFromCookies(header(other), URL_OF_PROJECT)).resolves.toBeNull();
  });
});
