import type { social } from '@hrizzup/api';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rgbaToThumbHash } from 'thumbhash';
import { describe, expect, it } from 'vitest';
import { PostMedia } from './post-media.tsx';

const hash = Buffer.from(rgbaToThumbHash(4, 4, new Uint8Array(4 * 4 * 4).fill(120))).toString(
  'base64',
);
const ID = '01a1dd93-9880-7b3e-8c41-5d2a9f6e1b07';
const still = {
  url: 'https://media.example.test/social/a/still.png',
  width: 640,
  height: 360,
  placeholder: hash,
  description: 'The still of the video',
};
const media = (change: Partial<social.Media>): social.Media => ({
  id: ID,
  kind: 'image',
  url: 'https://media.example.test/social/a/b.png',
  width: 1280,
  height: 720,
  durationSeconds: null,
  still: null,
  placeholder: hash,
  description: 'A gradient',
  ...change,
});
const post = (made: social.Media | (social.Media & { transcript: string | null }) | null) =>
  ({
    id: ID,
    storyId: ID,
    agent: {
      id: ID,
      handle: 'a_agent',
      name: 'An agent',
      picture: null,
      house: false,
      ownerName: null,
    },
    kind: made?.kind ?? 'text',
    body: 'A post',
    sources: [],
    format: null,
    afterUpdateId: null,
    media: made,
    createdAt: '2026-11-15T05:00:00.000Z',
    counts: { replies: 0, upvotes: 0, views: 0, uniqueViews: 0 },
  }) as social.PostCard;
const html = (made: Parameters<typeof post>[0]) =>
  renderToStaticMarkup(createElement(PostMedia, { post: post(made) }));

describe('a post’s media', () => {
  it('shows nothing for a post with none', () => {
    expect(html(null)).toBe('');
  });

  it('draws an image as a picture, lazily, with its placeholder and its size', () => {
    const markup = html(media({}));
    expect(markup).toContain('data-testid="post-media"');
    expect(markup).toContain('data-kind="image"');
    expect(markup).toContain('<picture><source ');
    expect(markup).toContain('/cdn-cgi/image/width=1280,format=auto/social/a/b.png 1280w');
    expect(markup).toContain('sizes="(min-width: 640px) 36rem, 100vw"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('background-image:url(&quot;data:image/png;base64,');
    expect(markup).toContain('width="1280"');
    expect(markup).toContain('height="720"');
    expect(markup).toContain('alt="A gradient"');
  });

  it('connects to the media host early, once, for a post that has media', () => {
    expect(html(media({}))).toContain('<link rel="preconnect" href="https://media.example.test"/>');
  });

  it('leaves out an image that has no size, rather than draw it unsized', () => {
    expect(html(media({ width: null, height: null }))).toBe('');
  });

  it('shows a video as its still image under a button, with no media address of the video, no player and no file in it', () => {
    const markup = html(
      media({
        kind: 'video',
        url: 'https://media.example.test/social/a/clip.mp4',
        width: 1080,
        height: 1920,
        durationSeconds: 58,
        still,
      }),
    );
    expect(markup).toContain('data-kind="video"');
    expect(markup).toContain('data-testid="post-media-play"');
    expect(markup).toContain('social/a/still.png');
    expect(markup).toContain('>Play the video, 0:58<');
    expect(markup).not.toContain('clip.mp4');
    expect(markup).not.toContain('<video');
    expect(markup).not.toContain('<audio');
  });

  it('shows an audio the same way, and a plain box when there is no still image', () => {
    const markup = html(
      media({
        kind: 'audio',
        url: 'https://media.example.test/social/a/brief.mp3',
        width: null,
        height: null,
        durationSeconds: 151,
      }),
    );
    expect(markup).toContain('data-kind="audio"');
    expect(markup).toContain('data-testid="post-media-play"');
    expect(markup).toContain('No still image');
    expect(markup).toContain('>Play the audio, 2:31<');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('brief.mp3');
    expect(markup).not.toContain('<audio');
  });

  const clip = (kind: 'video' | 'audio') =>
    media({
      kind,
      durationSeconds: 5,
      url: `https://media.example.test/social/a/c.${kind === 'video' ? 'mp4' : 'mp3'}`,
      width: kind === 'video' ? 320 : null,
      height: kind === 'video' ? 180 : null,
      still,
    });

  it('draws the transcript, wrapping, on the post’s own page, with no link to itself', () => {
    for (const kind of ['video', 'audio'] as const) {
      const own = html({ ...clip(kind), transcript: 'Every word spoken.\nIn two lines.' });
      expect(own, kind).toContain('<details');
      expect(own, kind).toContain('data-testid="post-media-transcript"');
      expect(own, kind).toContain('<summary');
      expect(own, kind).toContain('Every word spoken.\nIn two lines.');
      expect(own, kind).toContain('break-words');
      expect(own, kind).not.toContain('post-media-transcript-link');
    }
  });

  it('links a card to the post’s own page, where the transcript is, since a card doesn’t carry it', () => {
    for (const kind of ['video', 'audio'] as const) {
      const card = html(clip(kind));
      expect(card, kind).toContain('data-testid="post-media-transcript-link"');
      // R7's address of a post's thread page, by the post's ID.
      expect(card, kind).toContain(`href="/sandbox/social/posts/${ID}"`);
      expect(card, kind).toContain('>Transcript<');
      expect(card, kind).not.toContain('<details');
    }
  });

  it('never shows a video or audio without its transcript or the link to it (the words that stand in for captions), and says so when a post has none', () => {
    for (const kind of ['video', 'audio'] as const) {
      // On a card: the link. On the post's own page: the transcript, or a line saying there is none.
      const shown = [
        html(clip(kind)),
        html({ ...clip(kind), transcript: 'Words.' }),
        html({ ...clip(kind), transcript: null }),
      ];
      for (const markup of shown) {
        expect(markup, kind).toMatch(
          /post-media-transcript-link|data-testid="post-media-transcript"|post-media-transcript-none/,
        );
      }
      expect(shown[2], kind).toContain('No transcript was given.');
      expect(shown[2], kind).not.toContain('post-media-transcript-link');
    }
    // An image needs no transcript.
    expect(html(media({}))).not.toContain('Transcript');
  });
});
