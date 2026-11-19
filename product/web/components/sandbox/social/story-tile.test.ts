import type { social } from '@hrizzup/api';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoryTile } from './story-tile.tsx';

const tile: social.StoryTile = {
  id: '01a1dd93-9880-7b3e-8c41-5d2a9f6e1b07',
  title: 'A test story',
  summary: 'A summary of the test story.',
  categories: ['sports'],
  places: ['mumbai'],
  createdAt: '2026-11-15T05:00:00.000Z',
  latestAt: '2026-11-15T06:00:00.000Z',
  latestHeadline: 'The newest headline',
  counts: { posts: 3, replies: 2, upvotes: 1, views: 9, uniqueViews: 4, pins: 0 },
  picture: {
    url: 'https://media.example.test/social/a/b.png',
    width: 640,
    height: 360,
    placeholder: null,
    description: 'A still',
  },
};
const html = (story: social.StoryTile, current = false) =>
  renderToStaticMarkup(createElement(StoryTile, { story, current }));

describe('a story’s tile', () => {
  it('on the board, holds its thumbnail beside its text, and keeps what it always held', () => {
    const markup = html(tile);
    expect(markup).toContain('data-testid="story-tile"');
    expect(markup.indexOf('data-testid="story-picture"')).toBeLessThan(markup.indexOf('<h2'));
    expect(markup).toContain('sizes="10rem"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('href="/sandbox/social/stories/01a1dd93-9880-7b3e-8c41-5d2a9f6e1b07"');
    expect(markup).toContain('A summary of the test story.');
    expect(markup).toContain('Latest: The newest headline');
    expect(markup).toContain('3 posts, 2 replies, 1 upvotes, 9 views');
    // Side by side only while the tile is wide enough for both (20 text-sized units), so large text stacks them.
    expect(markup).toContain('@container');
    expect(markup).toContain('flex flex-col gap-3 @xs:flex-row');
    expect(markup).toContain('min-w-0 flex-1');
    // Never loaded ahead of its text.
    expect(markup).not.toContain('fetchPriority="high"');
  });

  it('on its own page, holds the same thumbnail beside its heading, so the page’s text is its largest content', () => {
    const markup = html(tile, true);
    expect(markup.indexOf('data-testid="story-picture"')).toBeLessThan(markup.indexOf('<h1'));
    // The very layout of the board's tile: side by side while it fits, stacked at large text.
    expect(markup).toContain('flex flex-col gap-3 @xs:flex-row');
    expect(markup).toContain('w-32');
    expect(markup).toContain('sizes="10rem"');
    expect(markup).toContain('loading="lazy"');
    // No hero: nothing is eager, nothing is as wide as the page's text.
    expect(markup).not.toContain('loading="eager"');
    expect(markup).not.toContain('fetchPriority="high"');
    expect(markup).not.toContain('max-w-xl');
    expect(markup).not.toContain('36rem');
    expect(markup).toContain('A summary of the test story.');
    expect(markup).not.toContain('<h2');
    expect(markup).not.toContain('<a ');
  });

  it('shows the stand-in for the story’s main category when it has no picture', () => {
    const markup = html({ ...tile, picture: null });
    expect(markup).toContain('data-kind="stand-in"');
    expect(markup).toContain('>Sports<');
    expect(markup).not.toContain('<img');
  });
});
