import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next.ts';

describe('safeNext', () => {
  it('keeps a path on this site', () => {
    expect(safeNext('/sign-in-test')).toBe('/sign-in-test');
    expect(safeNext('/markets?tab=top#x')).toBe('/markets?tab=top#x');
  });

  it('refuses anything that leaves the site', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'evil.example',
      '',
      undefined,
      null,
      42,
      `/${'a'.repeat(600)}`,
    ]) {
      expect(safeNext(bad)).toBe('/sign-in-test');
    }
  });
});
