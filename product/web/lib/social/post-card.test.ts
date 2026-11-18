import { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentCardOf, imageOf, mediaOf, type PostRow, postCardOf } from './post-card.ts';

/** The media host of these tests; the example answers name the same one. */
const MEDIA_HOST = 'https://media-staging.hrizzup.com';
beforeEach(() => vi.stubEnv('MEDIA_BASE_URL', MEDIA_HOST));
afterEach(() => vi.unstubAllEnvs());

/** The example post as the database answers it (`social._post_card`): snake_case, no picture and no media unless the row has them. */
function row(changes: Partial<PostRow> = {}): PostRow {
  const post = examples.board.deskPage.posts[0];
  if (!post) throw new Error('The example desk has a post');
  return {
    id: post.id,
    story_id: post.storyId,
    agent: {
      id: post.agent.id,
      handle: post.agent.handle,
      name: post.agent.name,
      picture: null,
      house: post.agent.house,
      owner_name: post.agent.ownerName,
    },
    kind: 'text',
    body: post.body,
    sources: post.sources,
    format: post.format,
    after_update_id: post.afterUpdateId,
    media: null,
    created_at: post.createdAt,
    counts: {
      replies: post.counts.replies,
      upvotes: post.counts.upvotes,
      views: post.counts.views,
      unique_views: post.counts.uniqueViews,
    },
    ...changes,
  };
}

describe('a post card', () => {
  it('is the contract’s card, field for field, with the counts in camelCase', () => {
    const card = postCardOf(row());
    expect(social.postCard.parse(card)).toEqual(card);
    expect(card.storyId).toBe(row().story_id);
    expect(card.afterUpdateId).toBe(row().after_update_id);
    expect(card.createdAt).toBe(row().created_at);
    expect(card.counts).toEqual({ replies: 5, upvotes: 3, views: 412, uniqueViews: 301 });
    expect(card.agent).toEqual({
      id: row().agent.id,
      handle: 'delhi_explainer',
      name: 'Delhi Explainer',
      picture: null,
      house: false,
      ownerName: 'Example Owner',
    });
  });

  it('carries no field the contract does not have, whatever the row held', () => {
    const noisy = {
      ...row(),
      removed_at: '2026-11-17T09:41:00Z',
      agent: { ...row().agent, email: 'someone@example.test' },
    };
    const card = postCardOf(noisy);
    expect(Object.keys(card).sort()).toEqual(Object.keys(social.postCard.shape).sort());
    expect(Object.keys(card.agent).sort()).toEqual(Object.keys(social.agentCard.shape).sort());
    expect(JSON.stringify(card)).not.toContain('someone@example.test');
  });

  it('answers no picture and no media for a row that isn’t a whole, ready media row', () => {
    const someImage = { media_key: 'social/x.webp', width: 1, height: 1 };
    const card = postCardOf(
      row({ media: { id: 'x', kind: 'image' }, agent: { ...row().agent, picture: someImage } }),
    );
    expect(card.media).toBeNull();
    expect(card.agent.picture).toBeNull();
    expect(imageOf(someImage)).toBeNull();
    expect(mediaOf({ id: 'x' })).toBeNull();
    expect(agentCardOf(row().agent)).toEqual(card.agent);
  });

  it('carries a ready media and an agent’s picture, as the contract’s shapes', () => {
    const card = postCardOf(
      row({ kind: 'video', media: videoRow(), agent: { ...row().agent, picture: pictureRow() } }),
    );
    expect(social.postCard.parse(card)).toEqual(card);
    expect(card.media).toEqual(video);
    expect(card.agent.picture).toEqual({
      url: `${MEDIA_HOST}/${AGENT_FOLDER}/${STILL_ID}.webp`,
      width: 640,
      height: 360,
      placeholder: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
      description: 'A smoggy street',
    });
  });

  it('keeps a null owner and a null format', () => {
    const card = postCardOf(
      row({ format: null, after_update_id: null, agent: { ...row().agent, owner_name: null } }),
    );
    expect(social.postCard.parse(card)).toEqual(card);
    expect(card.format).toBeNull();
    expect(card.afterUpdateId).toBeNull();
    expect(card.agent.ownerName).toBeNull();
  });
});

// The shapes of the media rows ------------------------------------------------------------------------------

const AGENT_FOLDER = 'social/00000000-0000-7000-8000-000000000001';
const STILL_ID = '00000000-0000-7000-8000-000000000002';
const MEDIA_ID = '01a1e8e9-d140-77df-97c6-c25422098110';

/** What `social._image` answers. */
const pictureRow = (changes: Record<string, unknown> = {}) => ({
  media_key: `${AGENT_FOLDER}/${STILL_ID}.webp`,
  width: 640,
  height: 360,
  placeholder: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
  description: 'A smoggy street',
  ...changes,
});

/** What `social._media` answers for a ready video with its still. */
const videoRow = (changes: Record<string, unknown> = {}) => ({
  id: MEDIA_ID,
  kind: 'video',
  media_key: `${AGENT_FOLDER}/${MEDIA_ID}.mp4`,
  width: 1080,
  height: 1920,
  duration_ms: 58_000,
  still: pictureRow(),
  placeholder: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
  description: null,
  ...changes,
});

/** The example post's own video, built from the database-shaped row above (its still and placeholder are this file's). */
const video = {
  id: MEDIA_ID,
  kind: 'video',
  url: `${MEDIA_HOST}/${AGENT_FOLDER}/${MEDIA_ID}.mp4`,
  width: 1080,
  height: 1920,
  durationSeconds: 58,
  still: {
    url: `${MEDIA_HOST}/${AGENT_FOLDER}/${STILL_ID}.webp`,
    width: 640,
    height: 360,
    placeholder: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
    description: 'A smoggy street',
  },
  placeholder: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
  description: null,
};

describe('imageOf', () => {
  it('is the contract’s Image for a whole image row: the address is the media host and the key', () => {
    const image = imageOf(pictureRow());
    expect(image).toEqual(video.still);
    expect(social.image.parse(image)).toEqual(image);
    expect(imageOf(pictureRow({ placeholder: null, description: null }))).toMatchObject({
      placeholder: null,
      description: null,
    });
    for (const extension of ['jpg', 'png', 'webp']) {
      expect(
        imageOf(pictureRow({ media_key: `${AGENT_FOLDER}/${STILL_ID}.${extension}` })),
      ).not.toBeNull();
    }
  });

  it('is null for a row missing a field, wrong in one, or not an object at all', () => {
    for (const field of ['media_key', 'width', 'height', 'placeholder', 'description']) {
      expect(imageOf(pictureRow({ [field]: undefined })), field).toBeNull();
    }
    for (const changes of [
      { width: 0 },
      { height: 10_001 },
      { width: 1.5 },
      { width: '640' },
      { placeholder: 5 },
      { description: {} },
    ]) {
      expect(imageOf(pictureRow(changes)), JSON.stringify(changes)).toBeNull();
    }
    for (const nothing of [null, undefined, 'a picture', 7, [], true]) {
      expect(imageOf(nothing)).toBeNull();
    }
  });

  it('is null for a key that isn’t an image’s: another kind’s extension, a bad shape, a path out of its folder', () => {
    for (const media_key of [
      `${AGENT_FOLDER}/${STILL_ID}.mp4`,
      `${AGENT_FOLDER}/${STILL_ID}.mp3`,
      `${AGENT_FOLDER}/${STILL_ID}.gif`,
      `${AGENT_FOLDER}/${STILL_ID}`,
      `${AGENT_FOLDER}/${STILL_ID}.webp?x=1`,
      `${AGENT_FOLDER}/../${STILL_ID}.webp`,
      `/${AGENT_FOLDER}/${STILL_ID}.webp`,
      `assets/${STILL_ID}.webp`,
      `social/x/${STILL_ID}.webp`,
      `${AGENT_FOLDER}/${STILL_ID}.webp\n`,
    ]) {
      expect(imageOf(pictureRow({ media_key })), media_key).toBeNull();
    }
  });

  it('is null where there is no valid media host: no picture rather than a broken one', () => {
    for (const base of [
      '',
      '   ',
      'http://media.example.test',
      'https://media.example.test/path',
      'media.example.test',
      'https://Media.Example.test',
      'https://',
    ]) {
      vi.stubEnv('MEDIA_BASE_URL', base);
      expect(imageOf(pictureRow()), JSON.stringify(base)).toBeNull();
    }
    vi.stubEnv('MEDIA_BASE_URL', undefined);
    expect(imageOf(pictureRow())).toBeNull();
    // A final slash and a port are fine.
    vi.stubEnv('MEDIA_BASE_URL', 'https://localhost.test:8443/');
    expect(imageOf(pictureRow())?.url).toBe(
      `https://localhost.test:8443/${AGENT_FOLDER}/${STILL_ID}.webp`,
    );
  });
});

describe('mediaOf', () => {
  it('is the contract’s Media for a ready video: its still as an Image, its length in whole seconds', () => {
    const media = mediaOf(videoRow());
    expect(media).toEqual(video);
    expect(social.media.parse(media)).toEqual(media);
  });

  it('is an image with its size and no length, and audio with a length and no size', () => {
    const image = mediaOf(
      videoRow({
        kind: 'image',
        media_key: `${AGENT_FOLDER}/${MEDIA_ID}.png`,
        duration_ms: null,
        still: null,
      }),
    );
    expect(image).toMatchObject({
      kind: 'image',
      width: 1080,
      height: 1920,
      durationSeconds: null,
      still: null,
    });
    const audio = mediaOf(
      videoRow({
        kind: 'audio',
        media_key: `${AGENT_FOLDER}/${MEDIA_ID}.m4a`,
        width: null,
        height: null,
        duration_ms: 151_000,
      }),
    );
    expect(audio).toMatchObject({ kind: 'audio', width: null, height: null, durationSeconds: 151 });
    expect(
      mediaOf(
        videoRow({
          kind: 'audio',
          media_key: `${AGENT_FOLDER}/${MEDIA_ID}.mp3`,
          width: null,
          height: null,
        }),
      ),
    ).not.toBeNull();
  });

  it('rounds a length up, so a clip never shows 0', () => {
    for (const [ms, seconds] of [
      [1, 1],
      [999, 1],
      [1000, 1],
      [1001, 2],
      [58_000, 58],
      [58_001, 59],
    ] as const) {
      expect(mediaOf(videoRow({ duration_ms: ms }))?.durationSeconds, `${ms}`).toBe(seconds);
    }
  });

  it('keeps the media when its still isn’t a whole image (a video with no picture still plays), with the still null', () => {
    expect(mediaOf(videoRow({ still: null }))).toMatchObject({ still: null });
    expect(mediaOf(videoRow({ still: { media_key: 'nope' } }))).toMatchObject({ still: null });
  });

  it('is null for a row missing its id, kind or key, or wrong in one', () => {
    for (const field of [
      'id',
      'kind',
      'media_key',
      'width',
      'height',
      'duration_ms',
      'placeholder',
      'description',
    ]) {
      expect(mediaOf(videoRow({ [field]: undefined })), field).toBeNull();
    }
    for (const changes of [
      { id: 'x' },
      { kind: 'document' },
      { media_key: `${AGENT_FOLDER}/${MEDIA_ID}.png` },
      { media_key: `${AGENT_FOLDER}/${MEDIA_ID}.m4a` },
      { width: null },
      { height: null },
      { width: 20_000 },
      { duration_ms: 0 },
      { duration_ms: 1.5 },
      { duration_ms: '58000' },
      { placeholder: 3 },
    ]) {
      expect(mediaOf(videoRow(changes)), JSON.stringify(changes)).toBeNull();
    }
    expect(mediaOf(null)).toBeNull();
    expect(mediaOf('video')).toBeNull();
  });

  it('is null where there is no valid media host', () => {
    vi.stubEnv('MEDIA_BASE_URL', '');
    expect(mediaOf(videoRow())).toBeNull();
  });
});
