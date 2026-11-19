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

const html = (story: social.StoryTile) =>
  renderToStaticMarkup(createElement(StoryPicture, { story }));

describe('a story’s picture', () => {
  it('is its picture, drawn in a box of a fixed shape, with the placeholder behind it', () => {
    const markup = html({ ...tile, picture });
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
    const markup = html({ ...tile, picture });
    expect(markup).toContain('sizes="10rem"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('w-32');
    expect(markup).toContain('max-w-full');
    // Beside a tile's text it keeps its own shape, never stretched to the text's height.
    expect(markup).toContain('self-start');
    expect(markup).not.toContain('fetchPriority="high"');
  });

  it('is never the page’s first picture: lazy and of normal priority, so it never competes with the page’s scripts', () => {
    const markup = html({ ...tile, picture });
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('fetchPriority="auto"');
    expect(markup).not.toContain('loading="eager"');
    // And never a hero: no box as wide as the page's text, so the title stays the largest content.
    expect(markup).not.toContain('max-w-xl');
    expect(markup).not.toContain('w-full max-w');
    expect(markup).not.toContain('36rem');
  });

  it('is a stand-in naming the main category in words when the story has no picture', () => {
    const markup = html(tile);
    expect(markup).toContain('data-kind="stand-in"');
    expect(markup).toContain('data-testid="story-picture"');
    // The first category is the main one (agreement rule D3), in words and not as its code.
    expect(markup).toContain('>Sports<');
    expect(markup).not.toContain('General');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<picture');
    expect(markup).toContain('aspect-video');
    // The same small box as the picture's, and a long word breaks inside it, so it never grows wider than its tile.
    expect(markup).toContain('w-32');
    expect(markup).toContain('wrap-anywhere');
  });

  it('names a category it has no words for by its code, and a story with none as a story', () => {
    expect(html({ ...tile, categories: ['not-a-category'] })).toContain('>not-a-category<');
    expect(html({ ...tile, categories: [] })).toContain('>Story<');
  });
});
