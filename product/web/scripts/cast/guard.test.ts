import { social } from '@hrizzup/api';
import { describe, expect, it } from 'vitest';
import settings from '../../../../infra/supabase/project/settings.json' with { type: 'json' };
import { readyMessage } from '../../lib/api/social/admin.ts';
import { STAGING_ORIGIN } from '../../lib/auth-relay.ts';
import { CastError } from './errors.ts';
import {
  API_BASE,
  apiUrl,
  assertStagingUrl,
  assertUploadLink,
  checkEnvironment,
  cleanPath,
  readyMessageParts,
  skillUrl,
} from './guard.ts';
import { fakeCode, fakeUploadUrl, harness, json } from './harness.ts';
import { sendRaw } from './http.ts';

/** Test group 1: the guard. Staging only, whatever is asked. */

const refused = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(CastError);
    expect((error as CastError).exit).toBe(2);
    return;
  }
  throw new Error('it was not refused');
};

describe('addresses', () => {
  it("builds only staging's API addresses", () => {
    expect(API_BASE).toBe(`${STAGING_ORIGIN}/api/v1`);
    expect(apiUrl('/social/me')).toBe(`${STAGING_ORIGIN}/api/v1/social/me`);
    expect(apiUrl('/social/board', { limit: '5', sort: 'latest' })).toBe(
      `${STAGING_ORIGIN}/api/v1/social/board?limit=5&sort=latest`,
    );
    expect(skillUrl()).toBe(`${STAGING_ORIGIN}/skill.md`);
  });

  it('sends a cursor as it came, whatever its encoding writes', () => {
    for (const cursor of ['eyJ0IjoiMjAyNiJ9', 'a/b+c==', 'a b', 'x..y', '%2F']) {
      const address = apiUrl('/social/board', { cursor });
      expect(new URL(address).searchParams.get('cursor')).toBe(cursor);
      expect(() => assertStagingUrl(address)).not.toThrow();
    }
  });

  it.each([
    'https://hrizzup.com/api/v1/social/me',
    'https://www.hrizzup.com/api/v1/social/me',
    'https://hrizzup-abc123-hrizzup.vercel.app/api/v1/social/me',
    'http://localhost:3000/api/v1/social/me',
    'https://localhost/api/v1/social/me',
    'https://staging.hrizzup.com.evil.com/api/v1/social/me',
    'https://evil.com/https://staging.hrizzup.com/api/v1/social/me',
    'https://staging.hrizzup.com:8443/api/v1/social/me',
    'http://staging.hrizzup.com/api/v1/social/me',
    '//staging.hrizzup.com/api/v1/social/me',
    'https://user:pass@staging.hrizzup.com/api/v1/social/me',
    'https://staging.hrizzup.com//api/v1/social/me',
    'https://staging.hrizzup.com/api/v1/../admin',
    'https://staging.hrizzup.com/api%2fv1/social/me',
    'https://staging.hrizzup.com/api/v1/social%2Fme',
    'https://staging.hrizzup.com/other',
    'not an address',
  ])('refuses the address %s', (address) => {
    refused(() => assertStagingUrl(address));
  });

  it.each([
    '//evil.com/x',
    '/social//me',
    '/social/../x',
    '/social/./me',
    '/social%2fme',
    '/social/me?x=1',
    '/social/me#x',
    'social/me',
    'https://evil.com/x',
    '/social/me\\x',
    '',
  ])('refuses the path %s', (path) => {
    refused(() => cleanPath(path));
    refused(() => apiUrl(path));
  });

  it('sends every request with redirects refused, only to staging, and refuses a redirect that comes back', async () => {
    const h = harness();
    try {
      h.server.on('GET', '/api/v1/social/board', () => json(200, { stories: [] }));
      await sendRaw(h.ctx, { method: 'GET', path: '/social/board' });
      expect(h.server.requests).toHaveLength(1);
      expect(h.server.requests[0]?.init.redirect).toBe('error');
      expect(h.server.requests[0]?.url.startsWith(`${STAGING_ORIGIN}/api/v1/`)).toBe(true);

      h.server.on('GET', '/api/v1/social/lists', () => ({
        status: 302,
        headers: { location: 'https://evil.example/' },
      }));
      await expect(sendRaw(h.ctx, { method: 'GET', path: '/social/lists' })).rejects.toMatchObject({
        exit: 2,
      });
      expect(h.server.strays).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it('refuses a redirect that fetch itself raises, without trying again', async () => {
    const h = harness();
    try {
      let calls = 0;
      h.ctx.fetch = async () => {
        calls++;
        throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
      };
      await expect(sendRaw(h.ctx, { method: 'GET', path: '/social/board' })).rejects.toMatchObject({
        exit: 2,
      });
      expect(calls).toBe(1);
    } finally {
      h.cleanup();
    }
  });
});

describe('the environment', () => {
  const staging = settings.environments.staging.project_ref;

  it('refuses any production Doppler config, and any Supabase project but staging', () => {
    refused(() => checkEnvironment({ DOPPLER_CONFIG: 'prd' }));
    refused(() => checkEnvironment({ DOPPLER_CONFIG: 'prd_release' }));
    refused(() => checkEnvironment({ SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }));
  });

  it("accepts staging's own, and nothing when no keys are set", () => {
    expect(checkEnvironment({ DOPPLER_CONFIG: 'stg' })).toBeNull();
    expect(checkEnvironment({})).toBeNull();
    const keys = checkEnvironment({
      DOPPLER_CONFIG: 'stg',
      SUPABASE_URL: `https://${staging}.supabase.co`,
      SUPABASE_PUBLISHABLE_KEY: 'publishable-stand-in',
      SUPABASE_SECRET_KEY: 'secret-stand-in',
    });
    expect(keys?.url).toBe(`https://${staging}.supabase.co`);
  });
});

describe('the ready message', () => {
  const email = 'delivered+run-cast-explainer@resend.dev';

  it("parses the real `readyMessage()`: staging's address, the code and the email", () => {
    const code = fakeCode(3);
    expect(readyMessageParts(readyMessage(STAGING_ORIGIN, code, email))).toEqual({
      origin: STAGING_ORIGIN,
      code,
      email,
    });
  });

  it('names another origin as it is, for the caller to refuse', () => {
    const other = 'https://hrizzup-abc123-hrizzup.vercel.app';
    expect(readyMessageParts(readyMessage(other, fakeCode(3), email))?.origin).toBe(other);
    expect(readyMessageParts('Something else entirely')).toBeNull();
  });

  it('is built from the contract: the invite input the cast sends passes it', () => {
    const body = { email, note: 'Test cast: Explainer', house: true, listed: true };
    expect(
      social.createInviteInput.safeParse({
        requestId: '01900000-0000-7000-8000-000000000001',
        ...body,
      }).success,
    ).toBe(true);
  });
});

describe('upload links', () => {
  const headers = { 'Content-Type': 'image/png', 'Content-Length': '12' };

  it("accepts staging's uploads bucket on R2", () => {
    expect(() => assertUploadLink(fakeUploadUrl(), headers)).not.toThrow();
  });

  it.each([
    ['the production bucket', fakeUploadUrl('hrizzup-uploads')],
    ['the media bucket', fakeUploadUrl('hrizzup-staging-media')],
    ['another host', fakeUploadUrl('hrizzup-staging-uploads', 'evil.example.com')],
    [
      'a host that only starts like R2',
      fakeUploadUrl('hrizzup-staging-uploads', 'r2.cloudflarestorage.com.evil.com'),
    ],
    ['the bare R2 domain', fakeUploadUrl('hrizzup-staging-uploads', 'r2.cloudflarestorage.com')],
    ['http', fakeUploadUrl().replace('https:', 'http:')],
    ['another port', fakeUploadUrl().replace('.com/', '.com:8443/')],
    ['a user', fakeUploadUrl().replace('https://', 'https://user:pw@')],
    ['an encoded slash', fakeUploadUrl().replace('/social/', '%2fsocial/')],
    ['a path up a folder', fakeUploadUrl().replace('/social/', '/../hrizzup-uploads/')],
  ])('refuses a link with %s', (_what, link) => {
    refused(() => assertUploadLink(link, headers));
  });

  it('refuses headers that carry a credential', () => {
    refused(() => assertUploadLink(fakeUploadUrl(), { ...headers, Authorization: 'Bearer x' }));
    refused(() => assertUploadLink(fakeUploadUrl(), { ...headers, cookie: 'a=b' }));
  });
});
