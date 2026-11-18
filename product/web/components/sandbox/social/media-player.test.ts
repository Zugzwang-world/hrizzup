import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MediaPlayer, PlayingMedia } from './media-player.tsx';

/**
 * The player (docs/social/media-design.md, 8.1 and 11.4): before the tap it is a button holding the still image
 * and what it plays, with no `<video>`, no `<audio>` and no address of the file in its markup, so nothing is asked
 * for; after the tap it is the element, with the file as its `src`.
 */

const SRC = 'https://media.example.test/social/a/clip.mp4';
const still = createElement('span', { 'data-testid': 'a-still' }, 'The still image');
const player = (change: Partial<Parameters<typeof MediaPlayer>[0]> = {}) => ({
  kind: 'video' as const,
  src: SRC,
  label: 'Play the video, 0:58',
  poster: 'https://media.example.test/cdn-cgi/image/width=640,format=auto/social/a/still.png',
  width: 1080,
  height: 1920,
  children: still,
  ...change,
});

describe('a player before the tap', () => {
  it('is a button holding the still image and the label, and nothing else', () => {
    for (const kind of ['video', 'audio'] as const) {
      const markup = renderToStaticMarkup(createElement(MediaPlayer, player({ kind })));
      expect(markup, kind).toMatch(/^<button type="button" [^>]*data-testid="post-media-play"/);
      expect(markup, kind).toContain('The still image');
      expect(markup, kind).toContain('>Play the video, 0:58<');
      expect(markup, kind).toMatch(/<\/button>$/);
    }
  });

  it('holds no video, no audio and no address of the file, so nothing is asked for before the tap', () => {
    for (const kind of ['video', 'audio'] as const) {
      const markup = renderToStaticMarkup(createElement(MediaPlayer, player({ kind })));
      expect(markup, kind).not.toContain('<video');
      expect(markup, kind).not.toContain('<audio');
      expect(markup, kind).not.toContain(SRC);
      expect(markup, kind).not.toContain('clip.mp4');
      expect(markup, kind).not.toContain('src=');
      // Its poster is drawn by the player after the tap, never before.
      expect(markup, kind).not.toContain('poster');
    }
  });
});

describe('a player after the tap', () => {
  it('is a video with the file as its source, its still as its poster and its size, and its controls', () => {
    const markup = renderToStaticMarkup(createElement(PlayingMedia, player()));
    expect(markup).toContain('<video');
    expect(markup).toContain(`src="${SRC}"`);
    expect(markup).toContain('poster="https://media.example.test/cdn-cgi/image/width=640');
    expect(markup).toContain('width="1080"');
    expect(markup).toContain('height="1920"');
    expect(markup).toContain('controls');
    expect(markup).toContain('autoPlay');
    expect(markup).toContain('playsInline');
    expect(markup).toContain('preload="auto"');
    expect(markup).toContain('data-testid="post-media-video"');
    // It fits its box at every size, at its own proportions.
    expect(markup).toContain('class="block h-auto w-full max-w-full"');
    expect(markup).not.toContain('<audio');
    // The still is the poster, not drawn twice.
    expect(markup).not.toContain('The still image');
  });

  it('leaves out the size and the poster it hasn’t got', () => {
    const markup = renderToStaticMarkup(
      createElement(PlayingMedia, player({ poster: null, width: null, height: null })),
    );
    expect(markup).not.toContain('poster=');
    expect(markup).not.toContain('width=');
    expect(markup).not.toContain('height=');
  });

  it('is the still image and an audio under it, with the file as its source and its controls', () => {
    const markup = renderToStaticMarkup(
      createElement(
        PlayingMedia,
        player({
          kind: 'audio',
          src: 'https://media.example.test/social/a/brief.mp3',
          poster: null,
          width: null,
          height: null,
        }),
      ),
    );
    expect(markup.indexOf('The still image')).toBeLessThan(markup.indexOf('<audio'));
    expect(markup).toContain('src="https://media.example.test/social/a/brief.mp3"');
    expect(markup).toContain('controls');
    expect(markup).toContain('autoPlay');
    expect(markup).toContain('preload="auto"');
    expect(markup).toContain('data-testid="post-media-audio"');
    expect(markup).toContain('w-full max-w-full');
    expect(markup).not.toContain('<video');
  });
});
