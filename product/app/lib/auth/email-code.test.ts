import { describe, expect, it } from 'vitest';
import {
  CODE_LENGTH,
  CODE_MINUTES,
  cleanCode,
  cleanEmail,
  codeFormatMessage,
  SEND_MESSAGES,
  sendOutcome,
  VERIFY_MESSAGES,
  verifyOutcome,
} from './email-code.ts';

describe('what a person types', () => {
  it("tidies an address the way Supabase keeps it, or says it can't be one", () => {
    expect(cleanEmail('  Reader@Example.COM ')).toBe('reader@example.com');
    for (const bad of [
      '',
      'reader',
      'reader@',
      '@example.com',
      'a b@c.de',
      `${'x'.repeat(250)}@a.co`,
    ]) {
      expect(cleanEmail(bad), bad).toBeNull();
    }
  });

  it('takes a code with the spaces or dashes people copy with it, and nothing else', () => {
    expect(cleanCode('1234 5678')).toBe('12345678');
    expect(cleanCode('1234-5678')).toBe('12345678');
    expect(cleanCode(' 12345678 ')).toBe('12345678');
    for (const bad of [
      '',
      '1234567',
      '123456789',
      '1234abcd',
      '１２３４５６７８',
      'x'.repeat(65),
    ]) {
      expect(cleanCode(bad), bad).toBeNull();
    }
    expect(cleanCode('123456', 6)).toBe('123456');
  });

  it("matches Supabase Auth's settings: 8 digits, 10 minutes", () => {
    expect(CODE_LENGTH).toBe(8);
    expect(CODE_MINUTES).toBe(10);
    expect(codeFormatMessage()).toBe('Enter the 8-digit code from the email.');
  });
});

describe('how asking for a code ends', () => {
  it("reads the typed API's refusals, and no answer at all", () => {
    expect(sendOutcome('INVALID_EMAIL')).toBe('invalid-email');
    expect(sendOutcome('BOT_CHECK_FAILED')).toBe('bot-check');
    expect(sendOutcome('TOO_MANY_REQUESTS')).toBe('too-many');
    expect(sendOutcome('NOT_SET_UP')).toBe('not-set-up');
    expect(sendOutcome('SEND_FAILED')).toBe('failed');
    expect(sendOutcome('INTERNAL_SERVER_ERROR')).toBe('failed');
    expect(sendOutcome(undefined)).toBe('unreachable');
  });

  it("says each in the website's words", () => {
    expect(SEND_MESSAGES['bot-check']).toBe("The bot check didn't pass. Try again.");
    expect(SEND_MESSAGES['too-many']).toBe(
      'Too many codes were asked for. Wait a minute, then try again.',
    );
  });
});

describe('how checking a code ends', () => {
  it("reads Supabase's answer: signed in, a wrong or expired code, too many tries, or a fault", () => {
    expect(verifyOutcome(null)).toBe('signed-in');
    expect(verifyOutcome({ status: 403 })).toBe('wrong');
    expect(verifyOutcome({ status: 400 })).toBe('wrong');
    expect(verifyOutcome({ status: 429 })).toBe('too-many');
    expect(verifyOutcome({ status: 500 })).toBe('failed');
    expect(verifyOutcome({ status: 0 })).toBe('failed');
    expect(verifyOutcome({})).toBe('failed');
    expect(VERIFY_MESSAGES.wrong).toBe(
      "That code didn't work. Check it and try again, or get a new code.",
    );
  });
});
