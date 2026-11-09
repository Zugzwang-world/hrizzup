import { describe, expect, it } from 'vitest';
import auth from '../../../infra/supabase/auth/settings.json' with { type: 'json' };
import {
  CODE_LENGTH,
  CODE_MINUTES,
  cleanCode,
  cleanEmail,
  pendingCookieOptions,
  pendingCookieValue,
  readPendingCookie,
} from './email-code.ts';

describe('the code the page asks for', () => {
  it("matches Supabase Auth's settings: its length and how long it works", () => {
    expect(CODE_LENGTH).toBe(auth.shared.mailer_otp_length);
    expect(CODE_MINUTES * 60).toBe(auth.shared.mailer_otp_exp);
  });

  it('takes the digits as typed or pasted, with spaces or dashes', () => {
    expect(cleanCode('12345678')).toBe('12345678');
    expect(cleanCode(' 1234 5678 ')).toBe('12345678');
    expect(cleanCode('1234-5678')).toBe('12345678');
  });

  it('refuses anything that is not exactly the code', () => {
    for (const bad of ['1234567', '123456789', '1234567a', '', 'abcdefgh', null, 12345678]) {
      expect(cleanCode(bad), String(bad)).toBeNull();
    }
    expect(cleanCode('1'.repeat(65))).toBeNull();
  });
});

describe('the email address', () => {
  it('is tidied the way Supabase Auth stores it', () => {
    expect(cleanEmail('  Reader@Example.COM ')).toBe('reader@example.com');
    expect(cleanEmail('delivered+code@resend.dev')).toBe('delivered+code@resend.dev');
  });

  it('is refused when it cannot be an address', () => {
    for (const bad of ['', 'reader', 'reader@', '@example.com', 'a b@example.com', 'x@y', null]) {
      expect(cleanEmail(bad), String(bad)).toBeNull();
    }
    expect(cleanEmail(`${'a'.repeat(250)}@example.com`)).toBeNull();
  });
});

describe('the cookie naming the address a code went to', () => {
  it('round-trips the address and where to go next', () => {
    const value = pendingCookieValue({ email: 'reader@example.com', next: '/sign-in-test' });
    expect(readPendingCookie(value)).toEqual({
      email: 'reader@example.com',
      next: '/sign-in-test',
    });
  });

  it('never carries a way off the site', () => {
    const value = pendingCookieValue({ email: 'reader@example.com', next: '//evil.example' });
    expect(readPendingCookie(value)?.next).toBe('/sign-in-test');
    const forged = JSON.stringify({ email: 'reader@example.com', next: 'https://evil.example' });
    expect(readPendingCookie(forged)?.next).toBe('/sign-in-test');
  });

  it('is ignored when missing or not ours', () => {
    for (const bad of [undefined, '', 'not json', '{"email":"nope"}', '[]', 'null']) {
      expect(readPendingCookie(bad), String(bad)).toBeNull();
    }
  });

  it('is for our server only, and ends when the code does', () => {
    expect(pendingCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: auth.shared.mailer_otp_exp,
    });
  });
});
