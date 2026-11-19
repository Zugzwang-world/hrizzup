import type { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PostStats } from './post-stats.tsx';
import { StoryTile } from './story-tile.tsx';

/**
 * What a post's counts and a story's tile say of views (R11; docs/social/r11-design.md, section 4, rules 4 and 5):
 * the words of `viewsText`, in the spans and the line the journeys read, and R7's words kept as words of their own.
 */

const card = examples.board.deskPage.posts[0] as social.PostCard;
const withCounts = (counts: Partial<social.PostCard['counts']>): social.PostCard => ({
  ...card,
  counts: { ...card.counts, ...counts },
});
const html = (post: social.PostCard) => renderToStaticMarkup(createElement(PostStats, { post }));
/** The markup's text, as `textContent` reads it. */
const textOf = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, '')
    .replaceAll('&#x27;', "'")
    .replace(/\s+/g, ' ')
    .trim();

describe('a post’s counts', () => {
  it('end with its views, in a span of their own, after the upvotes', () => {
    const markup = html(withCounts({ replies: 2, upvotes: 1, views: 2, uniqueViews: 2 }));
    expect(markup).toContain('<span data-testid="post-views">2 views (2 readers)</span>');
    expect(textOf(markup)).toBe('2 replies 1 upvote 2 views (2 readers)');
    expect(markup.indexOf('1 upvote')).toBeLessThan(markup.indexOf('data-testid="post-views"'));
  });

  it('say "0 views" when there are none, and "1 view (1 reader)" for one', () => {
    expect(textOf(html(withCounts({ views: 0, uniqueViews: 0 })))).toMatch(/ 0 views$/);
    expect(textOf(html(withCounts({ views: 1, uniqueViews: 1 })))).toMatch(/ 1 view \(1 reader\)$/);
  });

  it('keep R7’s words as words of their own, so its regexes still find them with views after', () => {
    const text = textOf(html(withCounts({ replies: 2, upvotes: 1, views: 12, uniqueViews: 7 })));
    expect(text).toMatch(/(^|\s)2 replies(\s|$)/);
    expect(text).toMatch(/(^|\s)1 upvote(\s|$)/);
    expect(text).toMatch(/(^|\s)12 views \(7 readers\)$/);
  });
});

describe('a story’s tile', () => {
  const tile: social.StoryTile = {
    ...(examples.board.storyPage.stories[0] as social.StoryTile),
    counts: { posts: 3, replies: 2, upvotes: 1, views: 2, uniqueViews: 2, pins: 0 },
  };
  const line = (current: boolean) =>
    textOf(renderToStaticMarkup(createElement(StoryTile, { story: tile, current })));

  it('ends its counts line with its views and its readers, on the board and on its own page', () => {
    for (const current of [false, true]) {
      expect(line(current)).toContain('3 posts, 2 replies, 1 upvotes, 2 views (2 readers)');
    }
  });
});
