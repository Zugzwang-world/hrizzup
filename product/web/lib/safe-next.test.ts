import { describe, expect, it } from 'vitest';
import { safeNext, sameSiteUrl } from './safe-next.ts';

const ORIGIN = 'https://staging.hrizzup.com';

describe('safeNext', () => {
  it('keeps a path on this site', () => {
    expect(safeNext('/sign-in-test')).toBe('/sign-in-test');
    expect(safeNext('/markets?tab=top#x')).toBe('/markets?tab=top#x');
    expect(safeNext('/a/../b')).toBe('/b');
  });

  it('refuses anything that leaves the site, as given or after clean-up', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/..//evil.example',
      '/.//evil.example',
      '/%2e%2e//evil.example',
      '/a/..//evil.example',
      '/x\\..\\evil.example',
      'javascript:alert(1)',
      'evil.example',
      '',
      undefined,
      null,
      42,
      `/${'a'.repeat(600)}`,
    ]) {
      expect(safeNext(bad), String(bad)).toBe('/sign-in-test');
      expect(sameSiteUrl(bad, ORIGIN).origin, String(bad)).toBe(ORIGIN);
    }
  });
});

describe('sameSiteUrl', () => {
  it('always builds an address on the same site', () => {
    expect(sameSiteUrl('/sign-in-test?x=1', ORIGIN).toString()).toBe(
      'https://staging.hrizzup.com/sign-in-test?x=1',
    );
  });
});
