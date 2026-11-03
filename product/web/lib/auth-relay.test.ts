import { describe, expect, it } from 'vitest';
import { isPreviewOrigin, relayReturnAddress, relayTarget } from './auth-relay.ts';

const SECRET = 'test-secret-only-for-this-test';
const PREVIEW = 'https://hrizzup-k3j9x2abc-hrizzup.vercel.app';
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

/** What staging's relay receives: our signed note, plus the code Supabase appends. */
function arrival(address: string, extra: Record<string, string> = { code: 'one-time-code' }) {
  const url = new URL(address);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url.searchParams;
}

describe('the sign-in relay for previews', () => {
  it('returns to staging, then forwards the code to the preview that asked', () => {
    const address = relayReturnAddress(SECRET, PREVIEW, '/sign-in-test', NOW);
    expect(new URL(address).origin).toBe('https://staging.hrizzup.com');
    const target = relayTarget(SECRET, arrival(address), NOW + 60_000);
    expect(target?.toString()).toBe(
      `${PREVIEW}/auth/callback?next=%2Fsign-in-test&code=one-time-code`,
    );
  });

  it('refuses a note signed with another secret, or changed after signing', () => {
    const address = relayReturnAddress(SECRET, PREVIEW, '/sign-in-test', NOW);
    expect(relayTarget('another-secret', arrival(address), NOW)).toBeNull();
    const changed = arrival(address);
    changed.set('to', 'https://hrizzup-other1234-hrizzup.vercel.app');
    expect(relayTarget(SECRET, changed, NOW)).toBeNull();
    const nextChanged = arrival(address);
    nextChanged.set('next', '/elsewhere');
    expect(relayTarget(SECRET, nextChanged, NOW)).toBeNull();
  });

  it('refuses an expired note', () => {
    const address = relayReturnAddress(SECRET, PREVIEW, '/sign-in-test', NOW);
    expect(relayTarget(SECRET, arrival(address), NOW + 16 * 60_000)).toBeNull();
  });

  it('never forwards to anything but one of our previews, even if signed', () => {
    for (const to of [
      'https://evil-hrizzup.vercel.app',
      'https://hrizzup-x.evil.example-hrizzup.vercel.app',
      'https://hrizzup-k3j9x2abc-otherteam.vercel.app',
      'http://hrizzup-k3j9x2abc-hrizzup.vercel.app',
      'https://staging.hrizzup.com',
    ]) {
      const address = relayReturnAddress(SECRET, to, '/sign-in-test', NOW);
      expect(relayTarget(SECRET, arrival(address), NOW), to).toBeNull();
    }
  });

  it('keeps the return path on the preview itself', () => {
    const address = relayReturnAddress(SECRET, PREVIEW, '/..//evil.example', NOW);
    const target = relayTarget(SECRET, arrival(address), NOW);
    expect(target?.origin).toBe(PREVIEW);
    expect(target?.searchParams.get('next')).toBe('/sign-in-test');
  });

  it('recognises our previews only', () => {
    expect(isPreviewOrigin(PREVIEW)).toBe(true);
    expect(isPreviewOrigin('https://hrizzup-git-part-9-hosting-hrizzup.vercel.app')).toBe(true);
    expect(isPreviewOrigin('https://evil-hrizzup.vercel.app')).toBe(false);
    expect(isPreviewOrigin(`${PREVIEW}/path`)).toBe(false);
  });
});
