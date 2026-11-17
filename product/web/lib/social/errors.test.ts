import { DatabaseBusyError } from '@hrizzup/db';
import { ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { faultOf, recordProblems, recordRefusal, refusalOf, socialError } from './errors.ts';

/** A database error as `pg` raises it. */
const fault = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`raised ${code}`), { code, ...extra });

const answerTo = (code: string, extra: Record<string, unknown> = {}) =>
  socialError(fault(code, extra), 'agent') as ORPCError<
    string,
    { reason?: string; retryAfterSeconds?: number }
  >;

describe("section 4's error codes", () => {
  const cases: [string, number, string, string | undefined][] = [
    ['HZS01', 403, 'FORBIDDEN', 'not_claimed'],
    ['HZS02', 403, 'FORBIDDEN', 'retired'],
    ['HZS03', 401, 'UNAUTHORIZED', undefined],
    ['HZS04', 409, 'CONFLICT', 'invite_used'],
    ['HZS05', 422, 'REFUSED', 'invite_expired'],
    ['HZS06', 422, 'REFUSED', 'invite_revoked'],
    ['HZS07', 409, 'CONFLICT', 'handle_taken'],
    ['HZS08', 404, 'NOT_FOUND', undefined],
    ['HZS09', 422, 'REFUSED', 'claim_expired'],
    ['HZS10', 403, 'FORBIDDEN', 'wrong_email'],
    ['HZS11', 403, 'FORBIDDEN', 'email_not_confirmed'],
    ['HZS12', 409, 'CONFLICT', 'already_has_agent'],
    ['HZS13', 404, 'NOT_FOUND', undefined],
    ['HZS17', 422, 'REFUSED', 'pins_full'],
    ['HZS18', 404, 'NOT_FOUND', undefined],
    ['HZS19', 409, 'CONFLICT', 'stale_record'],
    ['HZS20', 422, 'REFUSED', 'own_post'],
    ['HZS21', 422, 'REFUSED', 'too_deep'],
    ['HZS22', 422, 'REFUSED', 'story_not_live'],
    ['HZS23', 409, 'CONFLICT', 'invite_open'],
    ['HZS24', 409, 'CONFLICT', 'invite_claimed'],
    ['HZS25', 409, 'CONFLICT', 'listing_fixed'],
    ['HZS26', 409, 'CONFLICT', 'already_claimed'],
    ['HZS27', 409, 'CONFLICT', 'request_reused'],
    ['HZS28', 409, 'CONFLICT', 'clash'],
    ['HZK03', 422, 'REFUSED', 'too_many_keys'],
    ['P0002', 404, 'NOT_FOUND', undefined],
    ['22023', 400, 'BAD_REQUEST', undefined],
    ['22P02', 400, 'BAD_REQUEST', undefined],
    ['23514', 400, 'BAD_REQUEST', undefined],
  ];

  it.each(cases)('%s is a %i %s, with the reason %s', (code, status, name, reason) => {
    const answer = answerTo(code);
    expect(answer).toBeInstanceOf(ORPCError);
    expect(answer.status).toBe(status);
    expect(answer.code).toBe(name);
    if (reason) expect(answer.data?.reason).toBe(reason);
    // Every refusal says something, and what to do next is in it where there is a next thing to do.
    expect(answer.message.length).toBeGreaterThan(5);
  });

  it('gives the waits of the three limits, from the function’s detail', () => {
    expect(answerTo('HZS14', { detail: '3600' }).data).toEqual({
      reason: 'posts_per_day',
      retryAfterSeconds: 3600,
    });
    expect(answerTo('HZS15', { detail: '90' }).data).toEqual({
      reason: 'replies_per_hour',
      retryAfterSeconds: 90,
    });
    expect(answerTo('HZK04', { detail: '1200' })).toMatchObject({
      status: 429,
      data: { retryAfterSeconds: 1200 },
    });
    // No usable detail: the limit's own length.
    expect(answerTo('HZS14', { detail: 'soon' }).data?.retryAfterSeconds).toBe(86_400);
    expect(answerTo('HZS15').data?.retryAfterSeconds).toBe(3_600);
  });

  it('gives a media its reason from the detail, and a plain one when it gives none', () => {
    for (const reason of ['media_not_ready', 'media_kind', 'media_in_use', 'media_not_yours']) {
      expect(answerTo('HZS16', { detail: reason })).toMatchObject({
        status: 422,
        data: { reason },
      });
    }
    expect(answerTo('HZS16').data?.reason).toBe('media_not_ready');
  });

  it("says who is refused by what 42501 means: nobody's call for an admin, a key for an agent, the keys' own for a session", () => {
    const refused = fault('42501');
    expect(socialError(refused, 'admin')).toMatchObject({
      code: 'NOT_FOUND',
      message: 'No such call',
    });
    expect(socialError(refused, 'agent')).toMatchObject({
      status: 403,
      data: { reason: 'posting_key_needed' },
    });
    expect(socialError(refused, 'session')).toMatchObject({ status: 403 });
    // A call that has nobody to refuse: left as it came, which is a failure.
    expect(socialError(refused, 'none')).toBe(refused);
  });

  it('keeps the database’s words for a "No such…" and a function’s own check', () => {
    expect(
      socialError(Object.assign(fault('P0002'), { message: 'No such invite' }), 'admin'),
    ).toMatchObject({ message: 'No such invite' });
    expect(socialError(fault('P0002'), 'admin')).toMatchObject({ message: 'Not found' });
    expect(
      socialError(Object.assign(fault('22023'), { message: 'Say what to change' }), 'admin'),
    ).toMatchObject({
      status: 400,
      data: { issues: [{ path: '', message: 'Say what to change' }] },
    });
  });
});

describe('what comes out of the map', () => {
  it('asks the area’s own map first, so a relay’s codes and its own words for a shared one are its own', () => {
    const own = (found: { code: string }) =>
      found.code === 'HZS30'
        ? new ORPCError('REFUSED', { status: 422, message: 'Its own', data: { reason: 'own' } })
        : found.code === 'HZS27'
          ? new ORPCError('CONFLICT', { status: 409, message: 'Its own words' })
          : undefined;
    expect(socialError(fault('HZS30'), 'agent', own)).toMatchObject({ message: 'Its own' });
    expect(socialError(fault('HZS27'), 'agent', own)).toMatchObject({ message: 'Its own words' });
    expect(socialError(fault('HZS28'), 'agent', own)).toMatchObject({ data: { reason: 'clash' } });
  });

  it('leaves alone an error that is already the API’s, and what it does not know', () => {
    const theirs = new ORPCError('NOT_FOUND', { message: 'No such call' });
    expect(socialError(theirs, 'admin')).toBe(theirs);
    const unknown = fault('XX000');
    expect(socialError(unknown, 'admin')).toBe(unknown);
    const network = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    expect(socialError(network, 'none')).toBe(network);
    expect(socialError('text', 'none')).toBe('text');
    expect(socialError(null, 'none')).toBeNull();
  });

  it('says "try again" when the database stayed busy', () => {
    expect(socialError(new DatabaseBusyError(), 'agent')).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
  });

  it('reads a fault only from what the driver gives', () => {
    expect(faultOf(fault('HZS01', { detail: 'd', hint: 'h', constraint: 'c' }))).toEqual({
      code: 'HZS01',
      message: 'raised HZS01',
      detail: 'd',
      hint: 'h',
      constraint: 'c',
    });
    expect(faultOf(new Error('plain'))).toBeNull();
    expect(faultOf({ code: 5, message: 'x' })).toBeNull();
    expect(faultOf(undefined)).toBeNull();
  });

  it('gives a shared code’s answer to code that learns of the refusal as a result', () => {
    expect(refusalOf('HZS19')).toMatchObject({ status: 409, data: { reason: 'stale_record' } });
    expect(refusalOf('HZS99')).toBeUndefined();
  });
});

describe('the content store’s rules', () => {
  it('say where in the record and what to do, by their constraint names', () => {
    expect(recordRefusal({ constraint: 'updates_story_id_story', message: 'raw' })).toMatchObject({
      status: 400,
      data: {
        issues: [
          { path: 'record.story_id', message: 'No story has this ID: save the story first' },
        ],
      },
    });
    expect(
      recordRefusal({ constraint: 'stories_merges_never_chain', message: 'raw' }).data.issues[0]
        ?.path,
    ).toBe('record.merged_into');
  });

  it('keep the database’s own words, with its hint, for a rule not mapped', () => {
    expect(
      recordRefusal({ constraint: 'other_rule', message: 'raw', hint: 'Do this' }),
    ).toMatchObject({
      data: { issues: [{ path: 'record', message: 'raw: Do this' }] },
    });
    expect(recordRefusal({ message: 'raw' }).data.issues).toEqual([
      { path: 'record', message: 'raw' },
    ]);
  });

  it('turn the agreement’s problems into the issues the contract’s own input check gives, under `record`', () => {
    expect(
      recordProblems([
        { path: '/title', message: 'must not start with a space' },
        { path: '/categories/1', message: 'must be unique' },
        { path: '', message: 'must be a story' },
      ]),
    ).toMatchObject({
      status: 400,
      message: 'record.title: must not start with a space',
      data: {
        issues: [
          { path: 'record.title', message: 'must not start with a space' },
          { path: 'record.categories.1', message: 'must be unique' },
          { path: 'record', message: 'must be a story' },
        ],
      },
    });
  });
});
