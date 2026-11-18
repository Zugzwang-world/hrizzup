import { ORPCError } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEPT_LINE, RECORD_ID, START } from '@/lib/social/console-forms.ts';
import {
  BOARD_FIXTURE_STORY,
  BOARD_MERGED_STORY,
  BOARD_WITHDRAWN_STORY,
} from '@/lib/social/fixture-ids.ts';

/**
 * The social console's forms (actions.ts): to anyone but an admin, each answers "not found" before it reads
 * anything sent. An admin's: a record is built with its times five seconds in the past, `listed` must be chosen
 * (nothing is sent without it), every refusal comes back in words with what was typed kept, only the changes
 * really made are sent, and the code of an invite is in the answer of its own success and nowhere else. Who is
 * an admin, and the typed API's answers, are stood in for here; the calls themselves are tested with the API
 * and the database.
 */

const consoleAdmin = vi.fn();
const social = {
  invites: { create: vi.fn(), revoke: vi.fn(), list: vi.fn() },
  stories: { save: vi.fn(), list: vi.fn() },
  updates: { save: vi.fn() },
  settings: { set: vi.fn() },
  agents: { set: vi.fn(), revokeKeys: vi.fn() },
};

vi.mock('@/lib/console.ts', () => ({ consoleAdmin: () => consoleAdmin() }));
const storyGet = vi.fn();
vi.mock('@/lib/api/server.ts', () => ({
  serverApi: { admin: { social }, social: { stories: { get: storyGet } } },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const {
  makeInviteAction,
  revokeInviteAction,
  revokeAgentKeysAction,
  saveStoryAction,
  saveUpdateAction,
  setAgentAction,
  setSettingsAction,
  withdrawStoryAction,
} = await import('./actions.ts');

const NOW = new Date('2026-11-18T12:00:00.000Z');
const REQUEST = '019a6b3c-0001-7000-8000-0000000000aa';
const STORY = '019a6b3c-0001-7000-8000-000000000001';
const UPDATE = '019a6b3c-0002-7000-8000-000000000002';
const INVITE = '019a6b3c-0003-7000-8000-000000000003';
const CODE = 'hz-aaaa-bbbb-cccc-dddd';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const refusal = (code: string, status: number, message: string, data?: unknown) =>
  new ORPCError(code, { status, message, ...(data === undefined ? {} : { data }) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  consoleAdmin.mockResolvedValue({ account: 'admin', pool: {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the social console’s forms, to anyone but an admin', () => {
  it('answer "not found" before reading anything, whatever was sent', async () => {
    consoleAdmin.mockResolvedValue(null);
    const attempts: [(before: typeof START, sent: FormData) => Promise<unknown>, FormData][] = [
      [makeInviteAction, form({ requestId: REQUEST, email: 'a@b.test', listed: 'unlisted' })],
      [makeInviteAction, form({ email: 'not an email' })],
      [revokeInviteAction, form({ id: INVITE, reason: 'x' })],
      [saveStoryAction, form({ id: STORY, title: 'T', listed: 'unlisted' })],
      [saveStoryAction, form({})],
      [saveUpdateAction, form({ id: UPDATE, storyId: STORY, headline: 'H' })],
      [withdrawStoryAction, form({ id: STORY, reason: 'x' })],
      [setSettingsAction, form({ postsPerDay: '9', 'shown-postsPerDay': '5', reason: 'x' })],
      [setAgentAction, form({ id: INVITE, house: 'on', reason: 'x' })],
      [revokeAgentKeysAction, form({ id: INVITE, reason: 'x' })],
    ];
    for (const [action, sent] of attempts) {
      await expect(action(START, sent)).rejects.toThrow('NOT_FOUND');
    }
    expect(storyGet).not.toHaveBeenCalled();
    for (const group of Object.values(social)) {
      for (const call of Object.values(group)) expect(call).not.toHaveBeenCalled();
    }
  });
});

describe('making an invite', () => {
  const good = { requestId: REQUEST, email: ' Someone@Journey.test ', listed: 'unlisted' };

  it('sends what was typed with listed chosen, and answers the code once with a fresh ID for the next', async () => {
    social.invites.create.mockResolvedValue({
      invite: { email: 'someone@journey.test' },
      code: CODE,
      message: `Read /skill.md ... ${CODE} ...`,
    });
    const answer = await makeInviteAction(
      START,
      form({ ...good, note: ' for a test ', house: 'on' }),
    );
    expect(social.invites.create).toHaveBeenCalledWith({
      requestId: REQUEST,
      email: 'Someone@Journey.test',
      note: 'for a test',
      house: true,
      listed: false,
    });
    expect(answer.made).toEqual({
      code: CODE,
      message: `Read /skill.md ... ${CODE} ...`,
      email: 'someone@journey.test',
    });
    expect(answer.error).toBeNull();
    expect(answer.values).toEqual({});
    expect(RECORD_ID.test(answer.nextId ?? '')).toBe(true);
    expect(answer.nextId).not.toBe(REQUEST);
  });

  it('leaves out a blank note, and makes it an outside agent unless the box is ticked', async () => {
    social.invites.create.mockResolvedValue({
      invite: { email: 'a@b.test' },
      code: CODE,
      message: 'm',
    });
    await makeInviteAction(START, form({ ...good, listed: 'listed', note: '  ' }));
    expect(social.invites.create).toHaveBeenCalledWith({
      requestId: REQUEST,
      email: 'Someone@Journey.test',
      house: false,
      listed: true,
    });
  });

  it('is refused without a choice of listed, and calls nothing', async () => {
    const unchosen: Record<string, string>[] = [{}, { listed: '' }, { listed: 'on' }];
    for (const listed of unchosen) {
      const answer = await makeInviteAction(
        START,
        form({ requestId: REQUEST, email: 'a@b.test', ...listed }),
      );
      expect(answer.problems.listed).toMatch(/Choose listed or unlisted/);
      expect(answer.values.email).toBe('a@b.test');
      expect(answer.made).toBeUndefined();
    }
    expect(social.invites.create).not.toHaveBeenCalled();
  });

  it('finds the open invite in the way of a second for the same email, and shows its control', async () => {
    social.invites.create.mockRejectedValue(
      refusal('CONFLICT', 409, 'clash', { reason: 'invite_open' }),
    );
    social.invites.list.mockResolvedValue({
      invites: [
        {
          id: INVITE,
          email: 'someone@journey.test',
          usedAt: null,
          revokedAt: null,
          revokedReason: null,
          expiresAt: '2026-12-18T12:00:00.000Z',
        },
      ],
      next: null,
    });
    const answer = await makeInviteAction(START, form(good));
    expect(answer.error).toBe('This email already has an open invite: revoke it first.');
    expect(answer.clash).toEqual({ id: INVITE, email: 'someone@journey.test' });
    expect(answer.values.email).toBe(' Someone@Journey.test ');
    expect(answer.made).toBeUndefined();
  });

  it('still says the line when that invite is not among the newest, or the list cannot be read', async () => {
    social.invites.create.mockRejectedValue(
      refusal('CONFLICT', 409, 'clash', { reason: 'invite_open' }),
    );
    social.invites.list.mockResolvedValue({ invites: [], next: null });
    expect((await makeInviteAction(START, form(good))).clash).toBeUndefined();
    social.invites.list.mockRejectedValue(refusal('SERVICE_UNAVAILABLE', 503, 'busy'));
    const answer = await makeInviteAction(START, form(good));
    expect(answer.error).toBe('This email already has an open invite: revoke it first.');
    expect(answer.clash).toBeUndefined();
  });

  it('puts a bad email under its field and keeps what was typed; "No such call" is not found', async () => {
    social.invites.create.mockRejectedValue(
      refusal('BAD_REQUEST', 400, 'refused', {
        issues: [{ path: 'email', message: 'Invalid email address' }],
      }),
    );
    const answer = await makeInviteAction(START, form({ ...good, email: 'nope' }));
    expect(answer.problems).toEqual({ email: 'Invalid email address.' });
    expect(answer.values.email).toBe('nope');
    social.invites.create.mockRejectedValue(refusal('NOT_FOUND', 404, 'No such call'));
    await expect(makeInviteAction(START, form(good))).rejects.toThrow('NOT_FOUND');
  });

  it('never carries the code in a refusal', async () => {
    social.invites.create.mockRejectedValue(
      refusal('CONFLICT', 409, 'clash', { reason: 'invite_used' }),
    );
    const answer = await makeInviteAction(START, form(good));
    expect(JSON.stringify(answer)).not.toContain('hz-');
    expect(answer.made).toBeUndefined();
  });
});

describe('revoking an invite', () => {
  it('sends the ID and the reason, and says it is done', async () => {
    social.invites.revoke.mockResolvedValue({});
    const answer = await revokeInviteAction(START, form({ id: INVITE, reason: ' sent twice ' }));
    expect(social.invites.revoke).toHaveBeenCalledWith({ id: INVITE, reason: 'sent twice' });
    expect(answer.saved).toBe('Revoked.');
  });

  it('says a claimed agent’s invite cannot be revoked, and a missing reason under its field', async () => {
    social.invites.revoke.mockRejectedValue(
      refusal('CONFLICT', 409, 'x', { reason: 'invite_claimed' }),
    );
    expect((await revokeInviteAction(START, form({ id: INVITE, reason: 'x' }))).error).toMatch(
      /has been claimed/,
    );
    social.invites.revoke.mockRejectedValue(
      refusal('BAD_REQUEST', 400, 'x', {
        issues: [{ path: 'reason', message: 'Must not be empty' }],
      }),
    );
    const answer = await revokeInviteAction(START, form({ id: INVITE, reason: '' }));
    expect(answer.problems).toEqual({ reason: 'Must not be empty.' });
  });
});

describe('saving a test story', () => {
  const good = {
    id: STORY,
    title: 'A test story',
    summary: 'A summary of the test.',
    category1: 'general',
    place1: 'mumbai',
    listed: 'unlisted',
  };

  it('sends the story/1 with its times five seconds in the past and listed as chosen, then shows its page', async () => {
    social.stories.save.mockResolvedValue({ id: STORY });
    await expect(saveStoryAction(START, form(good))).rejects.toThrow(
      `REDIRECT /console/social/stories/${STORY}`,
    );
    expect(social.stories.save).toHaveBeenCalledTimes(1);
    const sent = social.stories.save.mock.calls[0]?.[0];
    expect(sent).toEqual({
      record: {
        format: 'story/1',
        id: STORY,
        title: 'A test story',
        summary: 'A summary of the test.',
        locations: ['mumbai'],
        categories: ['general'],
        state: 'live',
        created_at: '2026-11-18T11:59:55.000Z',
        updated_at: '2026-11-18T11:59:55.000Z',
      },
      listed: false,
    });
    expect(Date.parse(sent.record.created_at)).toBeLessThanOrEqual(NOW.getTime() - 5000);
  });

  it('sends listed true only for the choice "listed"', async () => {
    social.stories.save.mockResolvedValue({ id: STORY });
    await expect(saveStoryAction(START, form({ ...good, listed: 'listed' }))).rejects.toThrow(
      'REDIRECT',
    );
    expect(social.stories.save.mock.calls[0]?.[0].listed).toBe(true);
  });

  it('is refused without a choice of listed, however good the rest, and calls nothing', async () => {
    const { listed: _gone, ...rest } = good;
    for (const odd of [rest, { ...rest, listed: '' }, { ...rest, listed: 'true' }]) {
      const answer = await saveStoryAction(START, form(odd));
      expect(answer.problems.listed).toMatch(/Choose listed or unlisted/);
      expect(answer.values.title).toBe('A test story');
    }
    expect(social.stories.save).not.toHaveBeenCalled();
  });

  it('shows each problem under its field, keeping what was typed, and calls nothing', async () => {
    const answer = await saveStoryAction(
      START,
      form({ ...good, title: '', summary: 'x'.repeat(400), category1: '', place1: '' }),
    );
    expect(Object.keys(answer.problems).sort()).toEqual([
      'categories',
      'places',
      'summary',
      'title',
    ]);
    expect(answer.values.id).toBe(STORY);
    expect(social.stories.save).not.toHaveBeenCalled();
  });

  it('says the API’s refusals in words: a newer version, a listing that was fixed, a database that is busy', async () => {
    for (const [error, line] of [
      [refusal('CONFLICT', 409, 'x', { reason: 'stale_record' }), /newer version/],
      [refusal('CONFLICT', 409, 'x', { reason: 'listing_fixed' }), /fixed when it is made/],
      [refusal('SERVICE_UNAVAILABLE', 503, 'x'), /busy/],
    ] as const) {
      social.stories.save.mockRejectedValueOnce(error);
      const answer = await saveStoryAction(START, form(good));
      expect(answer.error).toMatch(line);
      expect(answer.values.title).toBe('A test story');
    }
  });

  it('is "not found" where the call is no call (anywhere but staging)', async () => {
    social.stories.save.mockRejectedValue(refusal('NOT_FOUND', 404, 'No such call'));
    await expect(saveStoryAction(START, form(good))).rejects.toThrow('NOT_FOUND');
  });

  it('throws again an error that is not a refusal, rather than showing it', async () => {
    social.stories.save.mockRejectedValue(new Error('boom'));
    await expect(saveStoryAction(START, form(good))).rejects.toThrow('boom');
  });
});

describe('saving an update', () => {
  const good = {
    id: UPDATE,
    storyId: STORY,
    headline: 'A development',
    sources: 'https://example.com/a\nhttps://example.org/b',
  };

  it('sends the update/1 with its time in the past, one source a line, then clears the form with a new ID', async () => {
    social.updates.save.mockResolvedValue({ id: UPDATE });
    const answer = await saveUpdateAction(START, form({ ...good, corrects: STORY }));
    expect(social.updates.save).toHaveBeenCalledWith({
      record: {
        format: 'update/1',
        id: UPDATE,
        story_id: STORY,
        headline: 'A development',
        reported_at: '2026-11-18T11:59:55.000Z',
        sources: ['https://example.com/a', 'https://example.org/b'],
        corrects: STORY,
        state: 'live',
        created_at: '2026-11-18T11:59:55.000Z',
        updated_at: '2026-11-18T11:59:55.000Z',
      },
    });
    expect(answer.saved).toMatch(/Update saved/);
    expect(answer.values).toEqual({});
    expect(RECORD_ID.test(answer.nextId ?? '')).toBe(true);
    expect(answer.nextId).not.toBe(UPDATE);
  });

  it('shows what is wrong under its field and calls nothing', async () => {
    const answer = await saveUpdateAction(START, form({ ...good, sources: '' }));
    expect(answer.problems.sources).toBe('Add at least one source address, starting https://.');
    expect(social.updates.save).not.toHaveBeenCalled();
  });

  it('says a newer version is already saved', async () => {
    social.updates.save.mockRejectedValue(
      refusal('CONFLICT', 409, 'x', { reason: 'stale_record' }),
    );
    expect((await saveUpdateAction(START, form(good))).error).toMatch(/newer version/);
  });
});

describe('changing the settings', () => {
  it('sends only the settings typed differently from what the page showed, with the reason', async () => {
    social.settings.set.mockResolvedValue({});
    const answer = await setSettingsAction(
      START,
      form({
        postsPerDay: '12',
        'shown-postsPerDay': '10',
        repliesPerHour: '20',
        'shown-repliesPerHour': '20',
        boardHalfLifeHours: '6.5',
        'shown-boardHalfLifeHours': '12',
        readerAiModel: 'same',
        'shown-readerAiModel': 'same',
        reason: ' tuning the test ',
      }),
    );
    expect(social.settings.set).toHaveBeenCalledWith({
      changes: { postsPerDay: 12, boardHalfLifeHours: 6.5 },
      reason: 'tuning the test',
    });
    expect(answer.saved).toBeDefined();
  });

  it('asks for a reason, and for something to change', async () => {
    const noReason = await setSettingsAction(
      START,
      form({ postsPerDay: '12', 'shown-postsPerDay': '10', reason: '' }),
    );
    expect(noReason.problems.reason).toMatch(/reason is required/);
    const nothing = await setSettingsAction(
      START,
      form({ postsPerDay: '10', 'shown-postsPerDay': '10', reason: 'why' }),
    );
    expect(nothing.error).toMatch(/Nothing to change/);
    expect(social.settings.set).not.toHaveBeenCalled();
  });

  it('shows a number out of its range under its own field', async () => {
    social.settings.set.mockRejectedValue(
      refusal('BAD_REQUEST', 400, 'x', {
        issues: [{ path: 'changes.postsPerDay', message: 'Too big: at most 1000' }],
      }),
    );
    const answer = await setSettingsAction(
      START,
      form({ postsPerDay: '5000', 'shown-postsPerDay': '10', reason: 'why' }),
    );
    expect(answer.problems).toEqual({ postsPerDay: 'Too big: at most 1000.' });
    expect(answer.values.postsPerDay).toBe('5000');
  });
});

describe('changing an agent', () => {
  it('sends only the mark and limits that changed, a blank limit as the settings’ own, with the reason', async () => {
    social.agents.set.mockResolvedValue({});
    await setAgentAction(
      START,
      form({
        id: INVITE,
        house: 'on',
        'shown-house': 'false',
        postsPerDay: '',
        'shown-postsPerDay': '5',
        repliesPerHour: '9',
        'shown-repliesPerHour': '9',
        reason: 'a test',
      }),
    );
    expect(social.agents.set).toHaveBeenCalledWith({
      id: INVITE,
      changes: { house: true, postsPerDay: null },
      reason: 'a test',
    });
  });

  it('asks for something to change and a reason before calling', async () => {
    const nothing = await setAgentAction(
      START,
      form({ id: INVITE, 'shown-house': 'false', reason: 'a test' }),
    );
    expect(nothing.error).toMatch(/Nothing to change/);
    const noReason = await setAgentAction(
      START,
      form({ id: INVITE, house: 'on', 'shown-house': 'false', reason: '' }),
    );
    expect(noReason.problems.reason).toMatch(/reason is required/);
    expect(social.agents.set).not.toHaveBeenCalled();
  });
});

describe('revoking an agent’s keys', () => {
  it('sends the reason, and retires the agent only when the box is ticked', async () => {
    social.agents.revokeKeys.mockResolvedValue({});
    const plain = await revokeAgentKeysAction(START, form({ id: INVITE, reason: 'lost' }));
    expect(social.agents.revokeKeys).toHaveBeenLastCalledWith({ id: INVITE, reason: 'lost' });
    expect(plain.saved).toBe('Its keys are revoked.');
    const retired = await revokeAgentKeysAction(
      START,
      form({ id: INVITE, reason: 'lost', retire: 'on' }),
    );
    expect(social.agents.revokeKeys).toHaveBeenLastCalledWith({
      id: INVITE,
      reason: 'lost',
      retire: true,
    });
    expect(retired.saved).toBe('Its keys are revoked and it is retired.');
  });

  it('shows a refusal under the reason', async () => {
    social.agents.revokeKeys.mockRejectedValue(
      refusal('BAD_REQUEST', 400, 'x', {
        issues: [{ path: 'reason', message: 'Must not be empty' }],
      }),
    );
    const answer = await revokeAgentKeysAction(START, form({ id: INVITE, reason: '' }));
    expect(answer.problems).toEqual({ reason: 'Must not be empty.' });
  });
});

describe('withdrawing a story', () => {
  const live = {
    id: STORY,
    state: 'live',
    requestedId: null,
    listed: true,
    title: 'A listed test story',
    summary: 'A summary of the test.',
    categories: ['general'],
    places: ['mumbai'],
    createdAt: '2026-11-18T10:00:00.123456Z',
  };
  /** The console's list of stories, with this one made by whom. */
  const madeBy = (who: 'console' | 'pipeline', next: string | null = null, id = STORY) =>
    social.stories.list.mockResolvedValue({ stories: [{ id, madeBy: who }], next });
  beforeEach(() => madeBy('console'));

  it('saves the same story again as withdrawn with the reason, carrying its own listing, then shows its page', async () => {
    storyGet.mockResolvedValue(live);
    social.stories.save.mockResolvedValue({ id: STORY });
    await expect(
      withdrawStoryAction(START, form({ id: STORY, reason: ' It was a test ' })),
    ).rejects.toThrow(`REDIRECT /console/social/stories/${STORY}`);
    expect(social.stories.save).toHaveBeenCalledWith({
      record: {
        format: 'story/1',
        id: STORY,
        title: 'A listed test story',
        summary: 'A summary of the test.',
        locations: ['mumbai'],
        categories: ['general'],
        state: 'withdrawn',
        withdrawn_reason: 'It was a test',
        created_at: '2026-11-18T10:00:00.123456Z',
        updated_at: '2026-11-18T11:59:55.000Z',
      },
      listed: true,
    });
  });

  it('asks for a reason under its field, and calls nothing to save', async () => {
    storyGet.mockResolvedValue(live);
    const answer = await withdrawStoryAction(START, form({ id: STORY, reason: '' }));
    expect(answer.problems.reason).toBe('Must not be empty.');
    expect(social.stories.save).not.toHaveBeenCalled();
  });

  it('refuses a story that is not live, or was merged into another', async () => {
    storyGet.mockResolvedValue({
      id: STORY,
      state: 'withdrawn',
      requestedId: null,
      withdrawnReason: 'x',
    });
    expect((await withdrawStoryAction(START, form({ id: STORY, reason: 'x' }))).error).toMatch(
      /not live/,
    );
    storyGet.mockResolvedValue({ ...live, requestedId: INVITE });
    expect((await withdrawStoryAction(START, form({ id: STORY, reason: 'x' }))).error).toMatch(
      /not live/,
    );
    expect(social.stories.save).not.toHaveBeenCalled();
  });

  it('says a story that is not there, and a newer version already saved, in words', async () => {
    storyGet.mockRejectedValue(refusal('NOT_FOUND', 404, 'No such story'));
    expect((await withdrawStoryAction(START, form({ id: STORY, reason: 'x' }))).error).toMatch(
      /no longer exists/,
    );
    storyGet.mockResolvedValue(live);
    social.stories.save.mockRejectedValue(
      refusal('CONFLICT', 409, 'x', { reason: 'stale_record' }),
    );
    expect((await withdrawStoryAction(START, form({ id: STORY, reason: 'x' }))).error).toMatch(
      /newer version/,
    );
  });

  it('is never offered for a story the pipeline made, and calls nothing to save', async () => {
    storyGet.mockResolvedValue(live);
    madeBy('pipeline');
    const answer = await withdrawStoryAction(START, form({ id: STORY, reason: 'x' }));
    expect(answer.error).toBe('Made by the pipeline: the console does not withdraw it.');
    expect(social.stories.save).not.toHaveBeenCalled();
  });

  it('is not offered for a story that is not among the console’s newest, however many pages are read, and finds one on a later page', async () => {
    storyGet.mockResolvedValue(live);
    social.stories.list.mockResolvedValue({
      stories: [{ id: INVITE, madeBy: 'console' }],
      next: 'more',
    });
    const answer = await withdrawStoryAction(START, form({ id: STORY, reason: 'x' }));
    expect(answer.error).toMatch(/not known here/);
    expect(social.stories.list).toHaveBeenCalledTimes(5);
    expect(social.stories.save).not.toHaveBeenCalled();
    social.stories.list.mockReset();
    social.stories.list
      .mockResolvedValueOnce({ stories: [{ id: INVITE, madeBy: 'console' }], next: 'more' })
      .mockResolvedValueOnce({ stories: [{ id: STORY, madeBy: 'console' }], next: null });
    social.stories.save.mockResolvedValue({ id: STORY });
    await expect(withdrawStoryAction(START, form({ id: STORY, reason: 'x' }))).rejects.toThrow(
      'REDIRECT',
    );
    expect(social.stories.list).toHaveBeenLastCalledWith({ limit: 100, cursor: 'more' });
  });

  it('is never offered for a story the checks keep, whoever made it: refused before anything is read', async () => {
    madeBy('console');
    for (const kept of [BOARD_FIXTURE_STORY, BOARD_WITHDRAWN_STORY, BOARD_MERGED_STORY]) {
      const answer = await withdrawStoryAction(START, form({ id: kept, reason: 'x' }));
      expect(answer.error, kept).toBe(KEPT_LINE);
      expect(answer.values.id).toBe(kept);
    }
    expect(KEPT_LINE).toBe('Kept for the checks: not to be changed.');
    expect(storyGet).not.toHaveBeenCalled();
    expect(social.stories.list).not.toHaveBeenCalled();
    expect(social.stories.save).not.toHaveBeenCalled();
  });
});

describe('adding an update to a story the checks keep', () => {
  it('is refused with the same line, and calls nothing to save', async () => {
    for (const kept of [BOARD_FIXTURE_STORY, BOARD_WITHDRAWN_STORY, BOARD_MERGED_STORY]) {
      const answer = await saveUpdateAction(
        START,
        form({
          id: UPDATE,
          storyId: kept,
          headline: 'A development',
          sources: 'https://example.com/a',
        }),
      );
      expect(answer.error, kept).toBe(KEPT_LINE);
    }
    expect(social.updates.save).not.toHaveBeenCalled();
  });
});
