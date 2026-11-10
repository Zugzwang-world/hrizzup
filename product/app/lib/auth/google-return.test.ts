import { describe, expect, it } from 'vitest';
import { GOOGLE_RETURN, isGoogleReturn, readGoogleReturn } from './google-return.ts';

describe('the way back from Google', () => {
  it("is the app's own address, as staging's allow-list names it", () => {
    expect(GOOGLE_RETURN).toBe('hrizzup://auth/callback');
    expect(isGoogleReturn(GOOGLE_RETURN)).toBe(true);
  });

  it('is recognised as the system hands it over: the whole address, or its path', () => {
    for (const address of [
      'hrizzup://auth/callback?code=abc',
      '/auth/callback?code=abc',
      'auth/callback?code=abc',
      'hrizzup://auth/callback#error=access_denied',
      'hrizzup://auth/callback',
    ]) {
      expect(isGoogleReturn(address), address).toBe(true);
    }
    for (const address of [
      'hrizzup://auth/callbacks?code=abc',
      'hrizzup://elsewhere/auth/callback?code=abc',
      'https://evil.example/auth/callback?code=abc',
      'hrizzup://',
      '/',
    ]) {
      expect(isGoogleReturn(address), address).toBe(false);
    }
  });

  it('carries the one-time code', () => {
    expect(readGoogleReturn('hrizzup://auth/callback?code=4f2a-9c_e1')).toEqual({
      kind: 'code',
      code: '4f2a-9c_e1',
    });
    expect(readGoogleReturn('/auth/callback?state=x&code=abc#ignored=1')).toEqual({
      kind: 'code',
      code: 'abc',
    });
  });

  it('or the refusal, when someone cancels at Google', () => {
    expect(
      readGoogleReturn(
        'hrizzup://auth/callback?error=access_denied&error_code=bad_oauth_callback&error_description=x',
      ),
    ).toEqual({ kind: 'refused' });
    expect(readGoogleReturn('hrizzup://auth/callback#error=access_denied')).toEqual({
      kind: 'refused',
    });
  });

  it('or nothing usable', () => {
    for (const address of [
      'hrizzup://auth/callback',
      'hrizzup://auth/callback?code=',
      'hrizzup://auth/callback?code=has%20space',
      `hrizzup://auth/callback?code=${'x'.repeat(513)}`,
      'hrizzup://somewhere-else?code=abc',
    ]) {
      expect(readGoogleReturn(address), address).toEqual({ kind: 'nothing' });
    }
  });
});
