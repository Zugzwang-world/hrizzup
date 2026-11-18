import type { social } from '@hrizzup/api';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rgbaToThumbHash } from 'thumbhash';
import { describe, expect, it } from 'vitest';
import { StoryPicture } from './story-picture.tsx';

/** A placeholder made as the database makes one: the ThumbHash of a small picture, in base64. */
const hash = Buffer.from(rgbaToThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(200))).toString(
  'base64',
);

const tile: social.StoryTile = {
  id: '01a1dd93-9880-7b3e-8c41-5d2a9f6e1b07',
  title: 'A test story',
  summary: 'A summary.',
  categories: ['sports', 'general'],
  places: ['mumbai'],
  createdAt: '2026-11-15T05:00:00.000Z',
  latestAt: '2026-11-15T05:00:00.000Z',
  latestHeadline: null,
  counts: { posts: 0, replies: 0, upvotes: 0, views: 0, uniqueViews: 0, pins: 0 },
  picture: null,
};
const picture = {
  url: 'https://media.example.test/social/a/b.png',
  width: 640,
  height: 360,
  placeholder: hash,
  description: 'The still of a video',
};

const html = (story: social.StoryTile, size: 'thumb' | 'hero') =>
  renderToStaticMarkup(createElement(StoryPicture, { story, size }));

describe('a story’s picture', () => {
  it('is its picture, drawn in a box of a fixed shape, with the placeholder behind it', () => {
    const markup = html({ ...tile, picture }, 'thumb');
    expect(markup).toContain('data-testid="story-picture"');
    expect(markup).toContain('data-kind="image"');
    expect(markup).toContain('aspect-video');
    expect(markup).toContain('<picture><source ');
    expect(markup).toContain('/cdn-cgi/image/width=320,format=auto/social/a/b.png 320w');
    expect(markup).toContain('background-image:url(&quot;data:image/png;base64,');
    expect(markup).toContain('width="640"');
    expect(markup).toContain('height="360"');
    expect(markup).toContain('alt="The still of a video"');
  });

  it('is a thumbnail on the board: small, lazy, and drawn at 10 text-sized units at most', () => {
    const markup = html({ ...tile, picture }, 'thumb');
    expect(markup).toContain('sizes="10rem"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('w-32');
    expect(markup).toContain('max-w-full');
    // Beside a tile's text it keeps its own shape, never stretched to the text's height.
    expect(markup).toContain('self-start');
    expect(markup).not.toContain('fetchPriority="high"');
  });

  it('is the hero of the story’s own page: the page’s first picture, loaded at once and first', () => {
    const markup = html({ ...tile, picture }, 'hero');
    expect(markup).toContain('loading="eager"');
    expect(markup).toContain('fetchPriority="high"');
    expect(markup).toContain('sizes="(min-width: 640px) 36rem, 100vw"');
    expect(markup).toContain('w-full max-w-xl aspect-video');
  });

  it('is a stand-in naming the main category in words when the story has no picture', () => {
    for (const size of ['thumb', 'hero'] as const) {
      const markup = html(tile, size);
      expect(markup).toContain('data-kind="stand-in"');
      expect(markup).toContain('data-testid="story-picture"');
      // The first category is the main one (agreement rule D3), in words and not as its code.
      expect(markup).toContain('>Sports<');
      expect(markup).not.toContain('General');
      expect(markup).not.toContain('<img');
      expect(markup).not.toContain('<picture');
      expect(markup).toContain('aspect-video');
      // A long word breaks inside the box, so the box never grows wider than its tile.
      expect(markup).toContain('wrap-anywhere');
    }
  });

  it('names a category it has no words for by its code, and a story with none as a story', () => {
    expect(html({ ...tile, categories: ['not-a-category'] }, 'thumb')).toContain(
      '>not-a-category<',
    );
    expect(html({ ...tile, categories: [] }, 'thumb')).toContain('>Story<');
  });
});
