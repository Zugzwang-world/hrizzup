import { validate } from '@hrizzup/agreement';
import { ORPCError, ValidationError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import {
  agentChanges,
  canRevoke,
  changeRefusal,
  chosen,
  EMPTY_PAGE_CURSOR,
  FIELDS,
  field,
  fieldOfPath,
  fieldsWith,
  idField,
  inviteState,
  KEPT_LINE,
  keptRefusal,
  keptUpdateRefusal,
  LISTED_MISSING,
  linesOf,
  listedChoice,
  openInviteFor,
  PAST_MS,
  plainProblem,
  problemLines,
  RECORD_ID,
  refusalOf,
  sentence,
  settingChanges,
  storyFrom,
  typed,
  updateFrom,
} from './console-forms.ts';
import { rangeOf, SETTING_ROWS } from './console-settings.ts';
import { START, sendId } from './console-state.ts';
import {
  BOARD_FIXTURE_FIRST_UPDATE,
  BOARD_FIXTURE_SECOND_UPDATE,
  BOARD_FIXTURE_STORY,
  BOARD_FIXTURE_THIRD_UPDATE,
  BOARD_MERGED_STORY,
  BOARD_WITHDRAWN_STORY,
  KEPT_STORY_IDS,
  KEPT_UPDATE_IDS,
  MEDIA_FIXTURE_STORY,
  MEDIA_FIXTURE_UPDATE,
  REPLIES_FIXTURE_STORY,
  REPLIES_FIXTURE_UPDATE,
} from './fixture-ids.ts';

/**
 * The social console's form rules (`console-forms.ts`): reading a form, building the agreement's records from it with
 * their times in the past, `listed` a choice that has no default, each problem in plain words under its own field,
 * only the changes a settings or agent form really makes, an invite's state, and refusals said in words.
 */

const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const STORY_ID = '019a6b3c-0001-7000-8000-000000000001';
const UPDATE_ID = '019a6b3c-0002-7000-8000-000000000002';

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of Array.isArray(value) ? value : [value]) data.append(name, each);
  }
  return data;
}

const goodStory = {
  id: STORY_ID,
  title: 'A test story about a test event',
  summary: 'Something happened in a test, in one sentence.',
  category1: 'general',
  place1: 'mumbai',
  listed: 'unlisted',
};

const goodUpdate = {
  id: UPDATE_ID,
  storyId: STORY_ID,
  headline: 'The first development',
  sources: 'https://example.com/a\r\n\r\n  https://example.org/b  \r\n',
};

describe('reading a form', () => {
  it('trims fields, writes new lines as the agreement does, and treats a missing or file field as empty', () => {
    const data = form({ a: '  hello\r\nthere  ' });
    data.set('file', new Blob(['x']), 'x.txt');
    expect(field(data, 'a')).toBe('hello\nthere');
    expect(field(data, 'missing')).toBe('');
    expect(field(data, 'file')).toBe('');
    expect(typed(form({ a: ' x ', b: 'y' }))).toEqual({ a: ' x ', b: 'y' });
  });

  it('collects the codes of numbered selects, leaving blanks out', () => {
    expect(
      chosen(form({ category1: 'ai', category2: '', category3: 'sports' }), 'category'),
    ).toEqual(['ai', 'sports']);
    expect(chosen(form({}), 'place')).toEqual([]);
  });

  it('makes a sentence of a message, and one line of each source', () => {
    expect(sentence(' must not be empty ')).toBe('Must not be empty.');
    expect(sentence('Already a sentence!')).toBe('Already a sentence!');
    expect(sentence('  ')).toBe('');
    expect(linesOf('a\n\n b \n')).toEqual(['a', 'b']);
  });
});

describe('listed is a choice with no default', () => {
  it('is true or false only for the two radio values, and null for anything else', () => {
    expect(listedChoice(form({ listed: 'listed' }))).toBe(true);
    expect(listedChoice(form({ listed: 'unlisted' }))).toBe(false);
    const odd: Record<string, string>[] = [
      {},
      { listed: '' },
      { listed: 'on' },
      { listed: 'true' },
      { listed: 'LISTED' },
    ];
    for (const sent of odd) {
      expect(listedChoice(form(sent))).toBeNull();
    }
  });
});

describe('a new story', () => {
  it('is a story/1 the agreement accepts, with its times five seconds in the past, and listed as chosen', () => {
    const built = storyFrom(form({ ...goodStory, listed: 'listed' }), NOW);
    if (!built.ok) throw new Error(JSON.stringify(built.state));
    expect(built.record.listed).toBe(true);
    const story = built.record.record;
    expect(story).toEqual({
      format: 'story/1',
      id: STORY_ID,
      title: 'A test story about a test event',
      summary: 'Something happened in a test, in one sentence.',
      locations: ['mumbai'],
      categories: ['general'],
      state: 'live',
      created_at: '2026-11-18T11:59:55.000Z',
      updated_at: '2026-11-18T11:59:55.000Z',
    });
    expect(Date.parse(story.created_at)).toBe(NOW - PAST_MS);
    expect(validate(story)).toEqual([]);
    expect(RECORD_ID.test(story.id)).toBe(true);
  });

  it('keeps the main category and place first, and takes up to three of each', () => {
    const built = storyFrom(
      form({
        ...goodStory,
        category1: 'sports',
        category2: 'general',
        place1: 'mumbai',
        place2: 'india',
        place3: 'global',
      }),
      NOW,
    );
    if (!built.ok) throw new Error(JSON.stringify(built.state));
    expect(built.record.record.categories).toEqual(['sports', 'general']);
    expect(built.record.record.locations).toEqual(['mumbai', 'india', 'global']);
  });

  it('is refused without a choice of listed, however good the rest, and keeps what was typed', () => {
    const { listed: _chosen, ...rest } = goodStory;
    const built = storyFrom(form(rest), NOW);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.state.problems).toEqual({ listed: LISTED_MISSING });
    expect(built.state.values.title).toBe(goodStory.title);
    expect(built.state.error).toBe('Not saved: see the lines under the fields.');
  });

  it('shows each of the agreement’s problems in plain words under its own field, once', () => {
    const built = storyFrom(
      form({
        ...goodStory,
        title: '',
        summary: 'x'.repeat(301),
        category1: 'not-a-category',
        place1: '',
      }),
      NOW,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.state.problems).toEqual({
      title: 'Must not be empty.',
      summary: 'At most 300 characters.',
      categories: 'Choose each one from the list.',
      places: 'Choose at least 1.',
    });
    expect(built.state.error).toBe('Not saved: see the lines under the fields.');
  });

  it('refuses a repeated category as one line', () => {
    const built = storyFrom(
      form({ ...goodStory, category1: 'general', category2: 'general' }),
      NOW,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.state.problems).toEqual({ categories: 'No repeats.' });
  });

  it('refuses an ID that is not one, without saying the checker’s own words', () => {
    const built = storyFrom(form({ ...goodStory, id: 'not-an-id' }), NOW);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.state.error).toBe('id: The ID is not valid: reload the page.');
  });
});

describe('a new update', () => {
  it('is an update/1 the agreement accepts, with its times five seconds in the past and one source a line', () => {
    const built = updateFrom(form(goodUpdate), NOW);
    if (!built.ok) throw new Error(JSON.stringify(built.state));
    expect(built.record).toEqual({
      format: 'update/1',
      id: UPDATE_ID,
      story_id: STORY_ID,
      headline: 'The first development',
      reported_at: '2026-11-18T11:59:55.000Z',
      sources: ['https://example.com/a', 'https://example.org/b'],
      state: 'live',
      created_at: '2026-11-18T11:59:55.000Z',
      updated_at: '2026-11-18T11:59:55.000Z',
    });
    expect(validate(built.record)).toEqual([]);
  });

  it('carries a body and the update it corrects only when they are typed', () => {
    const built = updateFrom(
      form({ ...goodUpdate, body: ' More detail.\r\nSecond line. ', corrects: STORY_ID }),
      NOW,
    );
    if (!built.ok) throw new Error(JSON.stringify(built.state));
    expect(built.record.body).toBe('More detail.\nSecond line.');
    expect(built.record.corrects).toBe(STORY_ID);
    const plain = updateFrom(form({ ...goodUpdate, body: '', corrects: '' }), NOW);
    if (!plain.ok) throw new Error(JSON.stringify(plain.state));
    expect('body' in plain.record).toBe(false);
    expect('corrects' in plain.record).toBe(false);
  });

  it('asks for at least one source in one line under its field', () => {
    const built = updateFrom(form({ ...goodUpdate, sources: '' }), NOW);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.state.problems).toEqual({
      sources: 'Add at least one source address, starting https://.',
    });
  });

  it('names the line of a source that is not one, and refuses a post on X', () => {
    const built = updateFrom(
      form({
        ...goodUpdate,
        sources: 'https://example.com/ok\nhttp://example.com/no\nhttps://x.com/a/status/1',
      }),
      NOW,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.state.problems.sources).toBe(
      'Line 2: Must be web address starting https://. Line 3: Must be web address starting https://, not on X.',
    );
  });

  it('refuses an over-long headline under the headline', () => {
    const built = updateFrom(form({ ...goodUpdate, headline: 'h'.repeat(121) }), NOW);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.state.problems).toEqual({ headline: 'At most 120 characters.' });
  });
});

describe('the agreement’s problems in plain words', () => {
  it('finds the form’s field for a path in a record or in a call’s input', () => {
    expect(fieldOfPath('/categories/0')).toBe('categories');
    expect(fieldOfPath('/locations')).toBe('places');
    expect(fieldOfPath('record.sources.2')).toBe('sources');
    expect(fieldOfPath('changes.postsPerDay')).toBe('postsPerDay');
    expect(fieldOfPath('reason')).toBe('reason');
    expect(fieldOfPath('')).toBe('');
    expect(fieldOfPath('/')).toBe('');
  });

  it('drops a problem that only repeats another, and says a set of the checker’s phrases as one', () => {
    // A format problem alone is a line; `problemLines`, which sees every problem at its path, drops the repeat.
    expect(plainProblem({ path: '/created_at', message: 'must match format "date-time"' })).toEqual(
      { path: '/created_at', message: 'Is not in the right form' },
    );
    expect(
      plainProblem({ path: '/categories/0', message: 'must match exactly one schema in oneOf' }),
    ).toEqual({ path: '/categories', message: 'Choose each one from the list' });
  });
});

describe('the changes a settings form makes', () => {
  const rows = [
    { name: 'postsPerDay', kind: 'number' as const },
    { name: 'boardHalfLifeHours', kind: 'number' as const },
    { name: 'readerAiModel', kind: 'text' as const },
  ];

  it('are only the settings typed differently from what the page showed, a number as a number', () => {
    const answer = settingChanges(
      form({
        postsPerDay: '12',
        'shown-postsPerDay': '10',
        boardHalfLifeHours: '12.5',
        'shown-boardHalfLifeHours': '12.5',
        readerAiModel: '@cf/model',
        'shown-readerAiModel': '@cf/other',
      }),
      rows,
    );
    expect(answer).toEqual({
      changes: { postsPerDay: 12, readerAiModel: '@cf/model' },
      problems: {},
    });
  });

  it('say a number that is not one under its field, and leave a blank alone', () => {
    const answer = settingChanges(
      form({
        postsPerDay: '1e3',
        'shown-postsPerDay': '10',
        boardHalfLifeHours: '',
        'shown-boardHalfLifeHours': '12',
      }),
      rows,
    );
    expect(answer).toEqual({ changes: {}, problems: { postsPerDay: 'Type a number.' } });
  });
});

describe('the changes an agent form makes', () => {
  it('are the mark and each limit that differ, and a blank limit is the settings’ own (null)', () => {
    expect(
      agentChanges(
        form({
          house: 'on',
          'shown-house': 'false',
          postsPerDay: '',
          'shown-postsPerDay': '5',
          repliesPerHour: '7',
          'shown-repliesPerHour': '7',
        }),
      ),
    ).toEqual({ changes: { house: true, postsPerDay: null }, problems: {} });
    expect(agentChanges(form({ 'shown-house': 'true' })).changes).toEqual({ house: false });
    expect(agentChanges(form({ 'shown-house': 'false' })).changes).toEqual({});
  });

  it('say a limit that is not a whole number under its field', () => {
    expect(
      agentChanges(form({ 'shown-house': 'false', postsPerDay: '1.5', 'shown-postsPerDay': '' })),
    ).toEqual({
      changes: {},
      problems: { postsPerDay: 'Type a whole number, or leave it blank for the settings’ own.' },
    });
  });
});

describe('an invite', () => {
  const day = 86_400_000;
  const base = {
    usedAt: null,
    revokedAt: null,
    revokedReason: null,
    expiresAt: new Date(NOW + day).toISOString(),
  };

  it('is open, used, revoked or expired', () => {
    expect(inviteState(base, NOW)).toBe('open');
    expect(inviteState({ ...base, expiresAt: new Date(NOW - 1).toISOString() }, NOW)).toBe(
      'expired',
    );
    expect(inviteState({ ...base, usedAt: '2026-11-18T10:00:00.000Z' }, NOW)).toBe('used');
    expect(
      inviteState(
        { ...base, revokedAt: '2026-11-18T10:00:00.000Z', revokedReason: 'duplicate' },
        NOW,
      ),
    ).toBe('revoked');
    expect(
      inviteState(
        { ...base, revokedAt: '2026-11-18T10:00:00.000Z', revokedReason: 'expired' },
        NOW,
      ),
    ).toBe('expired');
  });

  it('can be revoked unless it is revoked, or its agent was claimed or retired', () => {
    const agent = (state: 'waiting' | 'claimed' | 'retired') => ({
      id: STORY_ID,
      handle: 'a_b',
      state,
    });
    expect(canRevoke({ usedAt: null, revokedAt: null, agent: null })).toBe(true);
    expect(canRevoke({ usedAt: 'x', revokedAt: null, agent: agent('waiting') })).toBe(true);
    expect(canRevoke({ usedAt: 'x', revokedAt: null, agent: agent('claimed') })).toBe(false);
    expect(canRevoke({ usedAt: 'x', revokedAt: null, agent: agent('retired') })).toBe(false);
    expect(canRevoke({ usedAt: 'x', revokedAt: null, agent: null })).toBe(false);
    expect(canRevoke({ usedAt: null, revokedAt: 'x', agent: null })).toBe(false);
  });

  it('is found among the invites by its email, in either case, only while it is open', () => {
    const invite = (email: string, over: object = {}) =>
      ({ id: STORY_ID, email, ...base, ...over }) as Parameters<typeof openInviteFor>[0][number];
    const list = [
      invite('someone@journey.test', { revokedAt: 'x', revokedReason: 'no' }),
      invite('Other@journey.test'),
    ];
    expect(openInviteFor(list, ' OTHER@journey.test ', NOW)?.email).toBe('Other@journey.test');
    expect(openInviteFor(list, 'someone@journey.test', NOW)).toBeNull();
    expect(openInviteFor(list, 'nobody@journey.test', NOW)).toBeNull();
  });
});

describe('a refusal in words', () => {
  const values = { reason: 'typed' };
  const refused = (code: string, status: number, message: string, data?: unknown) =>
    new ORPCError(code, { status, message, ...(data === undefined ? {} : { data }) });

  it('is "No such call" for anyone for whom the call is no call, so the action answers not found', () => {
    expect(refusalOf(refused('NOT_FOUND', 404, 'No such call'), values, FIELDS.reason)).toBeNull();
  });

  it('says a coded conflict in its own words, keeping what was typed', () => {
    const answer = refusalOf(
      refused('CONFLICT', 409, 'clash', { reason: 'invite_open' }),
      values,
      FIELDS.invite,
    );
    expect(answer).toEqual({
      error: 'This email already has an open invite: revoke it first.',
      problems: {},
      values,
    });
  });

  it('puts a refused input’s issues under their fields, as the API words them', () => {
    const answer = refusalOf(
      refused('BAD_REQUEST', 400, 'refused', {
        issues: [
          { path: 'changes.postsPerDay', message: 'Too big' },
          { path: 'reason', message: 'Must not be empty' },
          { path: 'elsewhere', message: 'odd' },
        ],
      }),
      values,
      fieldsWith(['postsPerDay']),
    );
    expect(answer?.problems).toEqual({ postsPerDay: 'Too big.', reason: 'Must not be empty.' });
    expect(answer?.error).toBe('Not saved: see the lines under the fields. elsewhere: Odd.');
    expect(answer?.values).toBe(values);
  });

  it('reads the validator’s own issues when the API has not worded them yet', () => {
    const error = new ORPCError('BAD_REQUEST', {
      status: 400,
      message: 'refused',
      cause: new ValidationError({
        message: 'refused',
        issues: [{ message: 'Must be an email', path: ['email'] }],
      }),
    });
    expect(refusalOf(error, values, FIELDS.invite)?.problems).toEqual({
      email: 'Must be an email.',
    });
  });

  it('says a busy database, a missing record and anything else in one plain line each', () => {
    expect(refusalOf(refused('SERVICE_UNAVAILABLE', 503, 'x'), values, FIELDS.reason)?.error).toBe(
      'The database is busy. Try again in a moment.',
    );
    expect(
      refusalOf(refused('NOT_FOUND', 404, 'No such record'), values, FIELDS.reason)?.error,
    ).toBe('That one no longer exists: reload the page.');
    expect(refusalOf(refused('REFUSED', 422, 'Past the limit'), values, FIELDS.reason)?.error).toBe(
      'Past the limit.',
    );
  });

  it('throws again anything that is not the API’s own refusal', () => {
    expect(() => refusalOf(new Error('boom'), values, FIELDS.reason)).toThrow('boom');
  });
});

describe('the lists that hold no row', () => {
  it('open at a cursor no row has: a version 7 ID of the time zero', () => {
    expect(EMPTY_PAGE_CURSOR).toBe('00000000-0000-7000-8000-000000000000');
    expect(RECORD_ID.test(EMPTY_PAGE_CURSOR)).toBe(true);
  });
});

describe('the settings as the form shows them', () => {
  it('has a row for every setting of the contract, text for the two that are text, and each range from the contract’s own check', () => {
    const byName = new Map(SETTING_ROWS.map((row) => [row.name, row]));
    expect(byName.get('postsPerDay')?.range).toBe('a whole number, 0 to 1,000');
    expect(byName.get('boardHalfLifeHours')?.range).toBe('a number, more than 0, at most 8,760');
    expect(byName.get('topWViews')?.range).toBe('a number, 0 to 1,000');
    expect(byName.get('readerAiInNeuronsPerM')?.range).toBe('a number, more than 0');
    expect(byName.get('readerAiProvider')).toMatchObject({ kind: 'text', range: '' });
    expect(byName.get('readerAiModel')).toMatchObject({ kind: 'text', range: '' });
    expect(SETTING_ROWS.filter((row) => row.kind === 'text')).toHaveLength(2);
    expect(
      rangeOf({
        type: 'number',
        minValue: null,
        maxValue: null,
        isInt: true,
        safeParse: () => ({ success: true }),
      }),
    ).toBe('a whole number');
  });
});

describe('which stories the console may change', () => {
  // The board fixture's three, R7's thread fixture's one and R8's media fixture's one.
  const kept = [
    BOARD_FIXTURE_STORY,
    BOARD_WITHDRAWN_STORY,
    BOARD_MERGED_STORY,
    REPLIES_FIXTURE_STORY,
    MEDIA_FIXTURE_STORY,
  ];

  it('never the ones the checks keep, whoever made them', () => {
    expect(KEPT_STORY_IDS.size).toBe(5);
    expect(KEPT_STORY_IDS).toEqual(new Set(kept));
    for (const id of kept) {
      expect(keptRefusal(id)).toBe(KEPT_LINE);
      for (const who of ['console', 'pipeline', null] as const) {
        expect(changeRefusal(id, who), `${id} by ${who}`).toBe(KEPT_LINE);
      }
    }
    expect(keptRefusal(STORY_ID)).toBeNull();
  });

  it('only a story the console made, and not one made by the pipeline or by someone not known', () => {
    expect(changeRefusal(STORY_ID, 'console')).toBeNull();
    expect(changeRefusal(STORY_ID, 'pipeline')).toBe(
      'Made by the pipeline: the console does not withdraw it.',
    );
    expect(changeRefusal(STORY_ID, null)).toMatch(/isn’t known here/);
  });
});

describe('a "must match format" problem', () => {
  const only = (path: string, message: string) =>
    problemLines([{ path, message }], new Set(['sources', 'title']));

  it('gets a line of its own when it is the only problem at its path: a source an address checker refuses', () => {
    for (const odd of ['a"b', 'a{b', 'a|b', 'a<b', '%zz']) {
      const built = updateFrom(
        form({ ...goodUpdate, sources: `https://example.com/ok\nhttps://example.com/${odd}` }),
        NOW,
      );
      expect(built.ok, odd).toBe(false);
      if (built.ok) continue;
      expect(built.state.problems, odd).toEqual({
        sources:
          'Line 2: Must be a web address starting https://, with no spaces or odd characters.',
      });
    }
    expect(only('/title', 'must match format "date-time"').problems).toEqual({
      title: 'Is not in the right form.',
    });
  });

  it('is dropped only when another problem is at the same path, so a wrong time is one line', () => {
    expect(
      problemLines(
        [
          { path: '/title', message: 'must be time in UTC, like 2026-11-05T09:30:00Z' },
          { path: '/title', message: 'must match format "date-time"' },
        ],
        new Set(['title']),
      ).problems,
    ).toEqual({ title: 'The time is not valid: reload the page.' });
    // Another path's problem doesn't hide it.
    expect(
      problemLines(
        [
          { path: '/summary', message: 'must NOT have more than 300 characters' },
          { path: '/title', message: 'must match format "date-time"' },
        ],
        new Set(['title', 'summary']),
      ).problems,
    ).toEqual({ summary: 'At most 300 characters.', title: 'Is not in the right form.' });
  });
});

describe('the updates the checks keep', () => {
  it('are the live fixture story’s three, the thread fixture’s one and the media fixture’s one, refused by their own IDs', () => {
    expect(KEPT_UPDATE_IDS.size).toBe(5);
    for (const id of [
      BOARD_FIXTURE_FIRST_UPDATE,
      BOARD_FIXTURE_SECOND_UPDATE,
      BOARD_FIXTURE_THIRD_UPDATE,
      REPLIES_FIXTURE_UPDATE,
      MEDIA_FIXTURE_UPDATE,
    ]) {
      expect(keptUpdateRefusal(id)).toBe(KEPT_LINE);
    }
    expect(keptUpdateRefusal(UPDATE_ID)).toBeNull();
    expect(keptUpdateRefusal(STORY_ID)).toBeNull();
  });
});

describe('the ID a form sends next', () => {
  const FIRST = '019a6b3c-00aa-7000-8000-0000000000aa';
  const SAVED = '019a6b3c-00bb-7000-8000-0000000000bb';
  const sent = (id: string) => ({ ...START, error: 'Refused.', values: { id, requestId: id } });

  it('is the one the page rendered until a save, and a refused first send carries its own again', () => {
    expect(sendId(START, 'id', FIRST)).toBe(FIRST);
    expect(sendId(sent(FIRST), 'id', FIRST)).toBe(FIRST);
  });

  it('is the new one after a save, and stays the one a refusal after it was sent with, never the first again', () => {
    const saved = { ...START, saved: 'Saved.', nextId: SAVED };
    expect(sendId(saved, 'id', FIRST)).toBe(SAVED);
    // save, then refused (carrying the new ID it was sent with): the next send is the refused one's, not the page's first.
    const refusedAfter = sent(SAVED);
    expect(sendId(refusedAfter, 'id', FIRST)).toBe(SAVED);
    expect(sendId(refusedAfter, 'requestId', FIRST)).toBe(SAVED);
    expect(sendId(refusedAfter, 'id', FIRST)).not.toBe(FIRST);
  });
});

describe('an ID taken from a form', () => {
  it('is in lower case, trimmed, whatever case it was sent in, and so are the records built from a form', () => {
    expect(idField(form({ id: ` ${STORY_ID.toUpperCase()}\r\n` }), 'id')).toBe(STORY_ID);
    expect(idField(form({}), 'id')).toBe('');
    const story = storyFrom(form({ ...goodStory, id: STORY_ID.toUpperCase() }), NOW);
    if (!story.ok) throw new Error(JSON.stringify(story.state));
    expect(story.record.record.id).toBe(STORY_ID);
    const update = updateFrom(
      form({
        ...goodUpdate,
        id: UPDATE_ID.toUpperCase(),
        storyId: STORY_ID.toUpperCase(),
        corrects: STORY_ID.toUpperCase(),
      }),
      NOW,
    );
    if (!update.ok) throw new Error(JSON.stringify(update.state));
    expect(update.record).toMatchObject({ id: UPDATE_ID, story_id: STORY_ID, corrects: STORY_ID });
  });
});
