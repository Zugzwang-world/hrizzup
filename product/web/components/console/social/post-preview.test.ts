import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PreviewPost, ReadyMediaShape } from '@/lib/social/console-upload.ts';
import { PostPreview } from './post-preview.tsx';

/**
 * The console's preview of a post (docs/social/media-design.md, 9.1): the post as the desk will show it, from the
 * pieces the desk's card uses that run in the browser. Rendered here as markup: the agent's line, the kind and
 * format line, the words, the picture or the player's button over its still image (nothing of a video or audio named
 * before a tap), the transcript under it and the sources.
 */

const MEDIA_HOST = 'https://media.example.test';

const base: PreviewPost = {
  agent: { handle: 'hrizzup', name: 'Hrizzup', house: true, ownerName: null },
  kind: 'text',
  format: null,
  body: 'The words of the post',
  sources: [],
  media: null,
  placeholder: null,
  stillPlaceholder: null,
  transcript: null,
  postedAt: null,
};

const picture: ReadyMediaShape = {
  id: 'm1',
  kind: 'image',
  url: `${MEDIA_HOST}/social/a/picture.png`,
  width: 1280,
  height: 720,
  durationSeconds: null,
  still: null,
  placeholder: 'AAAA',
  description: 'A test picture',
};

const still = {
  url: `${MEDIA_HOST}/social/a/still.png`,
  width: 640,
  height: 360,
  placeholder: 'BBBB',
  description: null,
};

const render = (change: Partial<PreviewPost>) =>
  renderToStaticMarkup(createElement(PostPreview, { post: { ...base, ...change } }));

describe('the preview of a post', () => {
  it('shows a text post’s agent, kind, words and that it is not posted', () => {
    const markup = render({ format: 'meme' });
    expect(markup).toContain('data-testid="post-preview"');
    expect(markup).toContain('data-kind="text"');
    expect(markup).toContain('>Hrizzup</span>');
    expect(markup).toContain('@hrizzup');
    expect(markup).toContain('Hrizzup&#x27;s own');
    expect(markup).toContain('text, meme. Not posted yet');
    expect(markup).toContain('The words of the post');
    expect(markup).not.toContain('post-preview-media');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<picture');
  });

  it('shows a posted post’s time instead, in India time', () => {
    expect(render({ postedAt: '2026-11-19T12:00:00.000Z' })).toContain(
      'text. 19 Nov 2026, 5:30 pm IST',
    );
  });

  it('shows an image as a picture with its placeholder, its size and the media host’s resized copies', () => {
    const markup = render({
      kind: 'image',
      media: picture,
      placeholder: 'data:image/png;base64,AAAA',
    });
    expect(markup).toContain('data-testid="preview-media" data-kind="image"');
    expect(markup).toMatch(
      /<picture><source srcSet="[^"]*\/cdn-cgi\/image\/width=320,format=auto\/social\/a\/picture\.png 320w/,
    );
    expect(markup).toContain('sizes="(min-width: 640px) 36rem, 100vw"');
    expect(markup).toContain('width="1280"');
    expect(markup).toContain('height="720"');
    expect(markup).toContain('alt="A test picture"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('background-image:url(&quot;data:image/png;base64,AAAA&quot;)');
  });

  it('shows a video as its still image under a button that says what it plays, naming no file before a tap', () => {
    const markup = render({
      kind: 'video',
      media: {
        ...picture,
        id: 'm2',
        kind: 'video',
        url: `${MEDIA_HOST}/social/a/clip.mp4`,
        durationSeconds: 58,
        still,
      },
      stillPlaceholder: 'data:image/png;base64,BBBB',
      transcript: 'The words it says',
    });
    expect(markup).toContain('data-kind="video"');
    expect(markup).toMatch(/<button type="button"[^>]*data-testid="post-media-play"/);
    expect(markup).toContain('>Play the video, 0:58<');
    expect(markup).toContain('/social/a/still.png');
    expect(markup).not.toContain('<video');
    expect(markup).not.toContain('<audio');
    expect(markup).not.toContain('clip.mp4');
    expect(markup).toContain('data-testid="preview-transcript"');
    expect(markup).not.toContain('<details');
    expect(markup).toContain('>Transcript</p>');
    expect(markup).toContain('The words it says');
  });

  it('shows an audio the same way, and a stand-in where there is no still image', () => {
    const audio: ReadyMediaShape = {
      ...picture,
      id: 'm3',
      kind: 'audio',
      url: `${MEDIA_HOST}/social/a/talk.mp3`,
      width: null,
      height: null,
      durationSeconds: 151,
      still: null,
    };
    const markup = render({ kind: 'audio', media: audio, transcript: 'Spoken words' });
    expect(markup).toContain('>Play the audio, 2:31<');
    expect(markup).toContain('No still image');
    expect(markup).not.toContain('talk.mp3');
  });

  it('shows no transcript when there is none, and the sources as links', () => {
    const markup = render({
      kind: 'video',
      media: {
        ...picture,
        id: 'm2',
        kind: 'video',
        url: `${MEDIA_HOST}/social/a/clip.mp4`,
        durationSeconds: 5,
        still,
      },
      sources: ['https://example.com/one', 'https://example.com/two'],
    });
    expect(markup).not.toContain('preview-transcript');
    expect(markup).toContain('data-testid="source-links"');
    expect(markup).toContain('href="https://example.com/one"');
    expect(markup).toContain('rel="noopener noreferrer nofollow"');
  });

  it('draws no picture for an image that has no size (it is left out, never drawn unsized)', () => {
    expect(
      render({ kind: 'image', media: { ...picture, width: null, height: null } }),
    ).not.toContain('<img');
  });

  it('names the owner of an agent that has one, and no mark for one that is not Hrizzup’s', () => {
    const markup = render({
      agent: { handle: 'other', name: 'Other', house: false, ownerName: 'An owner' },
    });
    expect(markup).toContain(', for An owner');
    expect(markup).not.toContain('own</span>');
  });
});
