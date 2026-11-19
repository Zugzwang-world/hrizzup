import { ORPCError, ValidationError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { issueLines, saveRefusal, sendRefusal } from './answers.ts';

/** What the reader agent's page says to its two buttons (answers.ts): each refusal in words, and whether the answer is definitive. */

const refused = (code: string, status: number, message: string, data?: unknown) =>
  new ORPCError(code, { status, message, ...(data === undefined ? {} : { data }) });

describe('a message that was refused', () => {
  it('says the API’s own words for the allowance and the cap, and the form takes a new request ID', () => {
    const paused = refused(
      'TOO_MANY_REQUESTS',
      429,
      "The reader agent has used today's allowance: chat pauses until 05:30 IST, and your feed keeps working",
      {
        reason: 'allowance_used',
        retryAfterSeconds: 3600,
      },
    );
    expect(sendRefusal(paused)).toEqual({
      ok: false,
      message: paused.message,
      issues: [],
      final: true,
    });
  });

  it('says the agent’s own 503 in the API’s words, definitive for each of its reasons', () => {
    for (const reason of ['busy', 'unavailable', 'too_slow']) {
      const answer = sendRefusal(
        refused('SERVICE_UNAVAILABLE', 503, `The words for ${reason}`, {
          reason,
          retryAfterSeconds: 30,
        }),
      );
      expect(answer, reason).toMatchObject({
        ok: false,
        message: `The words for ${reason}`,
        final: true,
      });
    }
  });

  it('keeps the request ID for a message still being answered, and for a 503 that is not the agent’s (a busy database)', () => {
    const clash = sendRefusal(
      refused(
        'CONFLICT',
        409,
        'Your reader agent is still answering this message: try again in a few seconds',
        { reason: 'clash' },
      ),
    );
    expect(clash).toMatchObject({ ok: false, final: false });
    expect(clash?.message).toContain('still answering');
    expect(
      sendRefusal(refused('SERVICE_UNAVAILABLE', 503, 'The database is not set up here')),
    ).toMatchObject({
      ok: false,
      final: false,
    });
  });

  it('takes a new request ID for a request ID used with another message', () => {
    const answer = sendRefusal(refused('CONFLICT', 409, 'x', { reason: 'request_reused' }));
    expect(answer).toMatchObject({ ok: false, final: true });
    expect(answer?.message).toContain('reload this page');
  });

  it('lists a refused message’s issues, each once', () => {
    const answer = sendRefusal(
      refused('BAD_REQUEST', 400, 'Input validation failed', {
        issues: [
          { path: 'body', message: 'Must not be empty' },
          { path: 'body', message: 'Must not be empty' },
          { path: 'body', message: 'No control characters' },
        ],
      }),
    );
    expect(answer).toMatchObject({ ok: false, final: true });
    expect(answer?.issues).toEqual(['Must not be empty', 'No control characters']);
  });

  it('asks for a sign-in on a 401, and says a key has no place here on a 403', () => {
    expect(sendRefusal(refused('UNAUTHORIZED', 401, 'x'))?.message).toContain('Sign in');
    expect(sendRefusal(refused('FORBIDDEN', 403, 'x'))?.message).toContain('not a key');
  });

  it('is nothing for an error that is no refusal, so the action throws it on and the form keeps its request ID', () => {
    expect(sendRefusal(new Error('boom'))).toBeNull();
    expect(sendRefusal(refused('INTERNAL_SERVER_ERROR', 500, 'x'))).toBeNull();
    expect(sendRefusal('a string')).toBeNull();
    expect(sendRefusal(undefined)).toBeNull();
  });
});

describe('a profile that was refused', () => {
  it('lists each issue with its line, and is definitive', () => {
    const answer = saveRefusal(
      refused('BAD_REQUEST', 400, 'Line 2: each line is a heading or an item starting with "- "', {
        issues: [
          { path: 'body', message: 'Line 2: each line is a heading or an item starting with "- "' },
          { path: 'body', message: 'Line 5: put each item under a heading' },
        ],
      }),
    );
    expect(answer).toMatchObject({ ok: false, final: true });
    expect(answer?.issues).toEqual([
      'Line 2: each line is a heading or an item starting with "- "',
      'Line 5: put each item under a heading',
    ]);
  });

  it('reads the issues of a failed validation of the contract’s own input, from its cause', () => {
    const error = new ORPCError('BAD_REQUEST', {
      status: 400,
      message: 'Input validation failed',
      cause: new ValidationError({
        message: 'Input validation failed',
        issues: [{ message: 'At most 2000 characters' }],
        data: {},
      }),
    });
    expect(issueLines(error)).toEqual(['At most 2000 characters']);
    expect(saveRefusal(error)?.issues).toEqual(['At most 2000 characters']);
  });

  it('keeps the request ID for a busy database, and takes a new one for the rest', () => {
    expect(saveRefusal(refused('SERVICE_UNAVAILABLE', 503, 'x'))).toMatchObject({ final: false });
    expect(saveRefusal(refused('CONFLICT', 409, 'x', { reason: 'request_reused' }))).toMatchObject({
      final: true,
    });
    expect(saveRefusal(refused('TOO_MANY_REQUESTS', 429, 'x'))).toMatchObject({ final: true });
    expect(saveRefusal(refused('UNAUTHORIZED', 401, 'x'))?.message).toContain('Sign in');
    expect(saveRefusal(refused('FORBIDDEN', 403, 'x'))?.message).toContain('not a key');
  });

  it('is nothing for an error that is no refusal', () => {
    expect(saveRefusal(new Error('boom'))).toBeNull();
    expect(saveRefusal(refused('INTERNAL_SERVER_ERROR', 500, 'x'))).toBeNull();
  });
});

describe('issue lines', () => {
  it('are empty for an error with no issues, and ignore an issue with no words', () => {
    expect(issueLines(refused('BAD_REQUEST', 400, 'x'))).toEqual([]);
    expect(
      issueLines(refused('BAD_REQUEST', 400, 'x', { issues: [{ path: 'body' }, null, 7] })),
    ).toEqual([]);
  });
});
