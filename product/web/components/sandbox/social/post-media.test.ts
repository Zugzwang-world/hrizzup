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

  it('shows a video as its still image and what it is, with no media address of the video in it', () => {
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
    expect(markup).toContain('social/a/still.png');
    expect(markup).toContain('>Video, 0:58<');
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
    expect(markup).toContain('No still image');
    expect(markup).toContain('>Audio, 2:31<');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('brief.mp3');
  });

  it('gives the transcript, wrapping, on the post’s own page, and none on a card without one', () => {
    const clip = media({
      kind: 'audio',
      durationSeconds: 5,
      url: 'https://media.example.test/social/a/c.mp3',
    });
    const own = html({ ...clip, transcript: 'Every word spoken.\nIn two lines.' });
    expect(own).toContain('data-testid="post-media-transcript"');
    expect(own).toContain('<summary');
    expect(own).toContain('Transcript');
    expect(own).toContain('Every word spoken.\nIn two lines.');
    expect(own).toContain('break-words');
    expect(html(clip)).not.toContain('post-media-transcript');
    expect(html({ ...clip, transcript: null })).not.toContain('post-media-transcript');
  });
});
