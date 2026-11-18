import { ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import {
  agentChoices,
  keptPostRefusal,
  MAKE_FIELDS,
  POST_FIELDS,
  pageRefusal,
  storyChoices,
  storyLabel,
  waitWords,
} from './console-post.ts';
import { BOARD_FIXTURE_STORY, MEDIA_FIXTURE_STORY } from './fixture-ids.ts';

/**
 * The console's post page (docs/social/media-design.md, section 9 and 10): which agents and stories it offers and
 * which it selects, and every refusal of its calls said in words by its reason. The calls themselves are tested with
 * the API and the database; here the errors are made as the API makes them.
 */

const refusal = (code: string, status: number, message: string, data?: unknown) =>
  new ORPCError(code, { status, message, ...(data === undefined ? {} : { data }) });

describe('the agents the page offers', () => {
  const hrizzup = {
    id: 'a-hrizzup',
    handle: 'hrizzup',
    name: 'Hrizzup',
    listed: true,
    state: 'claimed' as const,
  };
  const run = {
    id: 'a-run',
    handle: 'hj_abc',
    name: 'House journey',
    listed: false,
    state: 'claimed' as const,
  };
  const old = {
    id: 'a-old',
    handle: 'oldone',
    name: 'Old',
    listed: true,
    state: 'retired' as const,
  };

  it('are the listed agents of the console that can post, and the lone one is selected', () => {
    const choice = agentChoices([hrizzup, run], null);
    expect(choice.options.map((one) => one.id)).toEqual(['a-hrizzup']);
    expect(choice.selected).toBe('a-hrizzup');
    expect(choice.makeHrizzup).toBe(false);
    expect(choice.note).toBeNull();
  });

  it('select none when several are offered and none is asked for', () => {
    const second = { ...hrizzup, id: 'a-second', handle: 'second' };
    expect(agentChoices([hrizzup, second], null).selected).toBeNull();
  });

  it('add an unlisted agent that ?as= names, and select it', () => {
    const choice = agentChoices([hrizzup, run], 'a-run');
    expect(choice.options.map((one) => one.id)).toEqual(['a-run', 'a-hrizzup']);
    expect(choice.selected).toBe('a-run');
  });

  it('offer the one-time form that makes Hrizzup when no listed agent can post, even with an unlisted one asked for', () => {
    expect(agentChoices([], null).makeHrizzup).toBe(true);
    expect(agentChoices([run], 'a-run')).toMatchObject({ makeHrizzup: true, selected: 'a-run' });
    expect(agentChoices([hrizzup], null).makeHrizzup).toBe(false);
  });

  it('never fall back to another agent when ?as= names none, and say so', () => {
    const choice = agentChoices([hrizzup], 'a-nobody');
    expect(choice.selected).toBeNull();
    expect(choice.options.map((one) => one.id)).toEqual(['a-hrizzup']);
    expect(choice.note).toBe('No agent that the console runs has that ID: choose one.');
  });

  it('do not offer a retired agent, and say it is retired and needs another handle', () => {
    const asked = agentChoices([hrizzup, old], 'a-old');
    expect(asked.options.map((one) => one.id)).toEqual(['a-hrizzup']);
    expect(asked.selected).toBeNull();
    expect(asked.note).toBe(
      "@oldone is retired, so it can't post: a new agent needs another handle.",
    );
    const alone = agentChoices([old], null);
    expect(alone.options).toEqual([]);
    expect(alone.makeHrizzup).toBe(true);
    expect(alone.note).toBe(
      "Hrizzup's agent @oldone is retired, so it can't post: make another with a different handle.",
    );
  });
});

describe('the stories the page offers', () => {
  const story = (id: string, title: string, over: Record<string, unknown> = {}) => ({
    id,
    title,
    listed: true,
    madeBy: 'pipeline' as const,
    state: 'live',
    ...over,
  });

  it('are the live ones, each with its title and "(test, unlisted)" where so, and never a kept fixture', () => {
    const choice = storyChoices(
      [
        story('s1', 'A listed story'),
        story('s2', 'A test story', { listed: false, madeBy: 'console' }),
        story('s3', 'A listed test', { madeBy: 'console' }),
        story('s4', 'An unlisted story', { listed: false }),
        story(BOARD_FIXTURE_STORY, 'The board fixture', { listed: false, madeBy: 'console' }),
        story(MEDIA_FIXTURE_STORY, 'The media fixture', { listed: false, madeBy: 'console' }),
        story('s5', 'A withdrawn one', { state: 'withdrawn' }),
      ],
      null,
      null,
    );
    expect(choice.options).toEqual([
      { id: 's1', label: 'A listed story' },
      { id: 's2', label: 'A test story (test, unlisted)' },
      { id: 's3', label: 'A listed test (test)' },
      { id: 's4', label: 'An unlisted story (unlisted)' },
    ]);
    expect(choice.selected).toBeNull();
    expect(choice.note).toBeNull();
  });

  it('say a title as it is, with no marks, for a listed pipeline story', () => {
    expect(storyLabel({ title: 'Plain', listed: true, madeBy: 'pipeline' })).toBe('Plain');
  });

  it('select the story ?story= names when it is among them', () => {
    const choice = storyChoices([story('s1', 'One'), story('s2', 'Two')], 's2', null);
    expect(choice.selected).toBe('s2');
    expect(choice.options).toHaveLength(2);
  });

  it('add a story ?story= names that is not among the newest, first, by the title read for it', () => {
    const choice = storyChoices([story('s1', 'One')], 's9', { id: 's9', title: 'An older story' });
    expect(choice.options.map((one) => one.id)).toEqual(['s9', 's1']);
    expect(choice.selected).toBe('s9');
  });

  it('select nothing for a kept story or for an ID that names no live story, and say so', () => {
    const kept = storyChoices([story('s1', 'One')], MEDIA_FIXTURE_STORY, null);
    expect(kept.selected).toBeNull();
    expect(kept.note).toBe('That story is kept for the checks: nothing is posted on it.');
    expect(kept.options.map((one) => one.id)).toEqual(['s1']);
    const none = storyChoices([story('s1', 'One')], 's9', null);
    expect(none.selected).toBeNull();
    expect(none.note).toBe('No live story has that ID: choose one.');
    // A story that answers for another (merged into it) is not the one asked for.
    const merged = storyChoices([], 's9', { id: 's10', title: 'The one it was merged into' });
    expect(merged.selected).toBeNull();
  });

  it('refuse a post on a kept story, whatever the capitals', () => {
    expect(keptPostRefusal(MEDIA_FIXTURE_STORY)).toBe(
      'That story is kept for the checks: nothing is posted on it.',
    );
    expect(keptPostRefusal(BOARD_FIXTURE_STORY.toUpperCase())).not.toBeNull();
    expect(keptPostRefusal('019a6b3c-0001-7000-8000-000000000001')).toBeNull();
  });
});

describe('a refusal said in words', () => {
  it('names a limit’s wait, in whole minutes or hours', () => {
    expect(waitWords(0)).toBe('a little later');
    expect(waitWords(30)).toBe('about a minute');
    expect(waitWords(600)).toBe('about 10 minutes');
    expect(waitWords(3 * 3600)).toBe('about 3 hours');
    expect(waitWords(86_400)).toBe('about 24 hours');
  });

  it('tells a post by its reason', () => {
    const say = (reason: string, code = 'REFUSED', status = 422) =>
      pageRefusal(refusal(code, status, 'API words', { reason }), 'post', POST_FIELDS)?.error;
    expect(say('story_not_live')).toBe(
      'That story was withdrawn, so nothing can be posted on it: choose another.',
    );
    expect(say('retired', 'FORBIDDEN', 403)).toBe(
      "This agent is retired, so it can't post or take uploads any more: a new one needs another handle.",
    );
    expect(say('media_in_use')).toBe(
      'That file is already in a post: press Preview again to send it anew.',
    );
    expect(say('media_not_yours')).toBe(
      'That file belongs to another agent: press Preview again to send it anew.',
    );
    expect(say('media_not_ready')).toBe("The file isn't ready: press Preview again.");
    expect(say('media_kind')).toBe(
      "That file isn't of this post's kind: choose the kind that matches it.",
    );
    expect(say('clash', 'CONFLICT', 409)).toBe(
      'This clashed with something saved at the same moment: press Preview again.',
    );
  });

  it('tells a posting limit and an upload limit with the wait', () => {
    const posts = pageRefusal(
      refusal('TOO_MANY_REQUESTS', 429, 'Too many', {
        reason: 'posts_per_day',
        retryAfterSeconds: 7200,
      }),
      'post',
      POST_FIELDS,
    );
    expect(posts?.error).toBe(
      'This agent has posted as much as it may today: it can post again in about 2 hours.',
    );
    const uploads = pageRefusal(
      refusal('TOO_MANY_REQUESTS', 429, 'Too many', {
        reason: 'uploads_per_day',
        retryAfterSeconds: 600,
      }),
      'link',
      POST_FIELDS,
    );
    expect(uploads?.error).toBe(
      'This agent has used its uploads for today: it can send more in about 10 minutes.',
    );
    expect(uploads?.retry).toBe(false);
  });

  it('tells a link by its reason, in the words of a browser’s file', () => {
    const link = (reason: string) =>
      pageRefusal(refusal('REFUSED', 422, 'API words', { reason }), 'link', POST_FIELDS)?.error;
    expect(link('media_kind')).toContain('pictures are JPEG, PNG or WebP');
    expect(link('media_too_big')).toBe(
      'Too big: pictures are at most 10 MB, video 100 MB and audio 20 MB.',
    );
  });

  it('puts a refused file in its own words for the file in question, and a check still running as one to try again', () => {
    const done = (reason: string, message: string, what?: string) =>
      pageRefusal(refusal('REFUSED', 422, message, { reason }), 'done', POST_FIELDS, what);
    expect(
      done(
        'media_refused',
        "Animated images aren't taken: upload a still image",
        'The still image',
      ),
    ).toEqual({
      error: "The still image was refused: Animated images aren't taken: upload a still image.",
      problems: {},
      retry: false,
    });
    expect(
      done('media_too_long', 'Video is at most 60 seconds and audio 5 minutes: cut it')?.error,
    ).toBe('The file was refused: Video is at most 60 seconds and audio 5 minutes: cut it.');
    expect(done('transcript_needed', 'API words')?.error).toBe(
      'A video or audio needs its transcript: type the words it says.',
    );
    expect(done('still_needed', 'API words')?.error).toBe(
      'A video or audio needs its still image: choose one, then press Preview.',
    );
    const checking = pageRefusal(
      refusal('CONFLICT', 409, 'Checking', { reason: 'media_checking' }),
      'done',
      POST_FIELDS,
    );
    expect(checking).toEqual({
      error: 'The file is still being checked: press Preview again in a minute.',
      problems: {},
      retry: true,
    });
  });

  it('tells a busy store as one to try again, for an upload only', () => {
    const busy = refusal('SERVICE_UNAVAILABLE', 503, 'Uploads are not set up here');
    expect(pageRefusal(busy, 'link', POST_FIELDS)).toEqual({
      error: "Uploads aren't ready or storage is busy: press Preview again in a moment.",
      problems: {},
      retry: true,
    });
    // A post's own 503 is the database's: the shared words.
    expect(pageRefusal(busy, 'post', POST_FIELDS)?.error).toBe(
      'The database is busy. Try again in a moment.',
    );
  });

  it('puts a taken handle under the handle’s own field', () => {
    const taken = pageRefusal(
      refusal('CONFLICT', 409, 'taken', { reason: 'handle_taken' }),
      'make',
      MAKE_FIELDS,
    );
    expect(taken).toEqual({
      error: 'Not made: see the line under the handle.',
      problems: { handle: 'That handle is taken: type another one.' },
      retry: false,
    });
  });

  it('puts a refused input’s problems under the fields they name, the same as the console’s other forms', () => {
    const bad = pageRefusal(
      refusal('BAD_REQUEST', 400, 'Bad', {
        issues: [
          { path: 'body', message: 'At most 1000 characters' },
          { path: 'sources.0', message: 'must match format "uri"' },
        ],
      }),
      'post',
      POST_FIELDS,
    );
    expect(bad?.error).toBe('Not saved: see the lines under the fields.');
    expect(bad?.problems.body).toBe('At most 1000 characters.');
    expect(bad?.problems.sources).toContain('Must be a web address starting https://');
  });

  it('is nothing for "No such call", which is "not found", and throws what is not a refusal', () => {
    expect(pageRefusal(refusal('NOT_FOUND', 404, 'No such call'), 'post', POST_FIELDS)).toBeNull();
    expect(() => pageRefusal(new TypeError('boom'), 'post', POST_FIELDS)).toThrow('boom');
    // Any other not-found is a line: the agent, the story or the upload is gone.
    expect(
      pageRefusal(refusal('NOT_FOUND', 404, 'No such agent'), 'post', POST_FIELDS)?.error,
    ).toBe('That one no longer exists: reload the page.');
  });
});
