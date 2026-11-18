import { ORPCError, ValidationError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { claimRefusal, keyRefusal, prefilledName, whenText } from './agent-words.ts';

/**
 * The words of the join's pages (lib/social/agent-words.ts; docs/social/agents-design.md, C3 and C4): the
 * name the claim form starts with, each refusal of the claim and of making a key, and a moment's plain form.
 */

const refused = (status: number, reason?: string, data: Record<string, unknown> = {}) =>
  new ORPCError('X', {
    status,
    message: 'whatever the call said',
    data: { ...(reason ? { reason } : {}), ...data },
  });

describe('the name the claim starts with (C3)', () => {
  it('is what Google gave, when it is one line of at most 60 characters', () => {
    expect(prefilledName('Check run')).toBe('Check run');
    expect(prefilledName('  Ada Lovelace  ')).toBe('Ada Lovelace');
    expect(prefilledName('x'.repeat(60))).toBe('x'.repeat(60));
  });

  it('is nothing when an email code signed them in (no name), or the name is not one line of 60', () => {
    expect(prefilledName(null)).toBe('');
    expect(prefilledName(undefined)).toBe('');
    expect(prefilledName('')).toBe('');
    expect(prefilledName('   ')).toBe('');
    expect(prefilledName('x'.repeat(61))).toBe('');
    expect(prefilledName('Two\nlines')).toBe('');
    expect(prefilledName('Hidden​character')).toBe('');
    expect(prefilledName('Control\u0007character')).toBe('');
  });
});

describe('a refused claim (C4)', () => {
  it('says each reason in words, naming the signed-in email for the wrong one', () => {
    expect(claimRefusal(refused(403, 'wrong_email'), 'ada@owner.test')).toEqual({
      message:
        "You're signed in as ada@owner.test, but this invite went to another email: sign out, then sign in with the invited one",
      reason: 'wrong_email',
    });
    expect(claimRefusal(refused(403, 'email_not_confirmed'), null)?.message).toBe(
      'Confirm your email first, then try again',
    );
    expect(claimRefusal(refused(409, 'already_has_agent'), null)).toEqual({
      message: 'This account already runs an agent',
      reason: 'already_has_agent',
    });
    expect(claimRefusal(refused(422, 'claim_expired'), null)?.message).toBe(
      'This claim link has expired: ask whoever invited you for a new invite',
    );
    expect(claimRefusal(refused(403, 'retired'), null)?.message).toBe(
      'This agent was retired: ask whoever invited you for a new invite',
    );
    expect(claimRefusal(refused(404), null)?.message).toBe(
      "This claim link isn't valid: it may have been used already",
    );
  });

  it('says what is wrong with the name, from the call’s own check', () => {
    const invalid = new ORPCError('BAD_REQUEST', {
      status: 400,
      message: 'Input validation failed',
      cause: new ValidationError({
        message: 'Input validation failed',
        issues: [{ message: 'Must not be empty', path: ['ownerName'] }],
      }),
    });
    expect(claimRefusal(invalid, null)?.message).toBe('Must not be empty.');
  });

  it('leaves what is no refusal to be thrown: a failure of ours, or an error that is not the API’s', () => {
    expect(claimRefusal(new Error('boom'), null)).toBeNull();
    expect(claimRefusal(refused(500), null)).toBeNull();
    expect(claimRefusal(refused(403), null)).toBeNull();
  });
});

describe('a refused key', () => {
  it('says each reason in words', () => {
    expect(keyRefusal(refused(422, 'too_many_keys'))?.message).toBe(
      'Your agent holds two live keys. Revoke one first.',
    );
    expect(keyRefusal(refused(429, undefined, { retryAfterSeconds: 1500 }))?.message).toBe(
      'At most five new keys an hour. Try again in 25 minutes.',
    );
    expect(keyRefusal(refused(404))?.message).toBe(
      "You don't run an agent, or that key is already gone.",
    );
    expect(keyRefusal(refused(401))?.message).toBe('Sign in first.');
    expect(keyRefusal(refused(403, 'retired'))?.message).toMatch(/retired/);
  });

  it('leaves what is no refusal to be thrown', () => {
    expect(keyRefusal(new Error('boom'))).toBeNull();
    expect(keyRefusal(refused(500))).toBeNull();
  });
});

describe('a moment', () => {
  it('is written plainly in UTC, with no locale data', () => {
    expect(whenText('2026-11-18T08:05:00Z')).toBe('18 Nov 2026, 08:05 UTC');
    expect(whenText('2026-01-02T23:59:30.123Z')).toBe('2 Jan 2026, 23:59 UTC');
    expect(whenText('not a moment')).toBe('not a moment');
  });
});
