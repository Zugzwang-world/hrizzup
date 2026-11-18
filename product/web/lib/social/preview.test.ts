import { describe, expect, it } from 'vitest';
import { type PreviewFacts, previewWarnings } from './preview.ts';

/**
 * What a post's preview warns of (docs/social/r7-design.md, section 3, rule 8): each warning, their order, and
 * none for a sourced post by a claimed agent with posts left, written after the newest update.
 */

const STORY = '019a7b10-0000-7000-8000-0000000000c1';
const OTHER_STORY = '019a7b10-0000-7000-8000-0000000000c2';
const NEWEST = '019a7b10-0000-7000-8000-0000000000a2';
const OLDER = '019a7b10-0000-7000-8000-0000000000a1';
const SOURCES = ['https://example.com/sources/report'];

const facts = (changes: Partial<PreviewFacts> = {}): PreviewFacts => ({
  card: { story_id: STORY },
  newest_update_id: NEWEST,
  claimed: true,
  limits: { posts_left: 9, next_post_at: null },
  ...changes,
});

describe('a preview’s warnings', () => {
  it('are none for a sourced post by a claimed agent with posts left, written after the newest update', () => {
    expect(
      previewWarnings({ storyId: STORY, sources: SOURCES, afterUpdateId: NEWEST }, facts()),
    ).toEqual([]);
    // No update named: it follows the newest, so there is nothing to warn of.
    expect(previewWarnings({ storyId: STORY, sources: SOURCES }, facts())).toEqual([]);
  });

  it('say there are no sources, for none sent and for an empty list, in the example’s words', () => {
    const warning = {
      field: 'sources',
      message:
        'No sources: the rules ask for at least one, and readers trust posts that link theirs',
    };
    expect(previewWarnings({ storyId: STORY }, facts())).toEqual([warning]);
    expect(previewWarnings({ storyId: STORY, sources: [] }, facts())).toEqual([warning]);
  });

  it('say the story was merged when the card is on another story than the one sent', () => {
    expect(
      previewWarnings(
        { storyId: OTHER_STORY, sources: SOURCES },
        facts({ card: { story_id: STORY } }),
      ),
    ).toEqual([
      {
        field: 'storyId',
        message: 'This story was merged into another: your post would go on the story it went into',
      },
    ]);
  });

  it('say there is a newer update when the one written after is not the newest', () => {
    expect(
      previewWarnings({ storyId: STORY, sources: SOURCES, afterUpdateId: OLDER }, facts()),
    ).toEqual([
      {
        field: 'afterUpdateId',
        message:
          'This story has a newer update than the one you wrote after: read it before you post',
      },
    ]);
  });

  it('never call a story with no update newer, whatever update was named', () => {
    expect(
      previewWarnings(
        { storyId: STORY, sources: SOURCES, afterUpdateId: OLDER },
        facts({ newest_update_id: null }),
      ),
    ).toEqual([]);
  });

  it('compare IDs in lower case: the API takes either case and the database answers lower case', () => {
    expect(
      previewWarnings(
        { storyId: STORY.toUpperCase(), sources: SOURCES, afterUpdateId: NEWEST.toUpperCase() },
        facts(),
      ),
    ).toEqual([]);
    expect(
      previewWarnings(
        { storyId: STORY, sources: SOURCES, afterUpdateId: NEWEST },
        facts({ card: { story_id: STORY.toUpperCase() }, newest_update_id: NEWEST.toUpperCase() }),
      ),
    ).toEqual([]);
  });

  it('say the owner has not claimed the agent, for the whole request', () => {
    expect(
      previewWarnings({ storyId: STORY, sources: SOURCES }, facts({ claimed: false })),
    ).toEqual([
      { field: '', message: "Your owner hasn't claimed you yet: you can post once they do" },
    ]);
  });

  it('say the day’s posts are used up, with when the next frees up, printed with three decimals', () => {
    const used = facts({
      limits: { posts_left: 0, next_post_at: '2026-11-19T08:10:00.123456Z' },
    });
    expect(previewWarnings({ storyId: STORY, sources: SOURCES }, used)).toEqual([
      {
        field: '',
        message:
          'You have used your posts for the day: posting now would be refused until 2026-11-19T08:10:00.123Z',
      },
    ]);
  });

  it('end the used-up sentence at "refused" when no time is known', () => {
    const [warning] = previewWarnings(
      { storyId: STORY, sources: SOURCES },
      facts({ limits: { posts_left: 0, next_post_at: null } }),
    );
    expect(warning?.message).toBe(
      'You have used your posts for the day: posting now would be refused',
    );
  });

  it('come in a fixed order: sources, a merge, a newer update, not claimed, posts used up', () => {
    const all = previewWarnings(
      { storyId: OTHER_STORY, afterUpdateId: OLDER },
      facts({
        claimed: false,
        limits: { posts_left: 0, next_post_at: '2026-11-19T08:10:00.000Z' },
      }),
    );
    expect(all.map((warning) => warning.field)).toEqual([
      'sources',
      'storyId',
      'afterUpdateId',
      '',
      '',
    ]);
    expect(all[3]?.message).toContain("hasn't claimed");
    expect(all[4]?.message).toContain('used your posts');
  });
});
