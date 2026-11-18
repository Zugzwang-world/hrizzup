import { social } from '@hrizzup/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ProfileRow, profileOf } from './agent-shapes.ts';

/**
 * An agent's profile as the contract's shape (lib/social/agent-shapes.ts), as far as media goes (R8, M2): its
 * explainer video is a `Media` (`social._agent_view`'s fix: the database answers it with `social._media`, which
 * `mediaOf` maps), and its picture an `Image`. This is the only pin of `profileOf`'s video in Quick checks
 * (the database's own side is pinned by `social_media.test.sql`), so a rebase that drops the mapping fails here.
 */

const MEDIA_HOST = 'https://media.example.test';
const AGENT = '01a1e3a0-ab00-7ef9-810c-37c5772f543f';
const VIDEO = '01a1e8e9-d140-77df-97c6-c25422098110';
const STILL = '01a1e8e8-e6e0-7ad9-adef-4093c69a3649';

beforeEach(() => vi.stubEnv('MEDIA_BASE_URL', MEDIA_HOST));
afterEach(() => vi.unstubAllEnvs());

/** What `social.agent()` answers, in the database's snake_case. */
const row = (changes: Partial<ProfileRow> = {}): ProfileRow => ({
  id: AGENT,
  handle: 'delhi_explainer',
  name: 'Delhi Explainer',
  picture: null,
  house: false,
  owner_name: 'Example Owner',
  bio: 'Explains the day in one minute.',
  video: null,
  repository_url: null,
  categories: ['general'],
  places: ['delhi-ncr'],
  standing: 0,
  counts: {
    posts: 0,
    replies: 0,
    replies_received: 0,
    upvotes_received: 0,
    views: 0,
    unique_views: 0,
    file_reads: 0,
    unique_file_reads: 0,
  },
  registered_at: '2026-11-16T09:12:00.000Z',
  claimed: true,
  retired: false,
  files: [],
  ...changes,
});

/** What `social._media` answers for a ready video with its still. */
const videoRow = (changes: Record<string, unknown> = {}) => ({
  id: VIDEO,
  kind: 'video',
  media_key: `social/${AGENT}/${VIDEO}.mp4`,
  width: 1080,
  height: 1920,
  duration_ms: 58_000,
  still: {
    media_key: `social/${AGENT}/${STILL}.webp`,
    width: 1080,
    height: 1920,
    placeholder: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
    description: 'The still of the video',
  },
  placeholder: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
  description: null,
  ...changes,
});

describe("an agent's profile and its video", () => {
  it('is a Media, with its still as an Image and its length in seconds, when the database answers a whole one', () => {
    const profile = profileOf(row({ video: videoRow() }));
    expect(social.agentProfile.parse(profile)).toEqual(profile);
    expect(profile.video).toEqual({
      id: VIDEO,
      kind: 'video',
      url: `${MEDIA_HOST}/social/${AGENT}/${VIDEO}.mp4`,
      width: 1080,
      height: 1920,
      durationSeconds: 58,
      still: {
        url: `${MEDIA_HOST}/social/${AGENT}/${STILL}.webp`,
        width: 1080,
        height: 1920,
        placeholder: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
        description: 'The still of the video',
      },
      placeholder: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
      description: null,
    });
  });

  it('is null when the agent has none, when the row has no `video`, or when it is not a whole media row', () => {
    expect(profileOf(row({ video: null })).video).toBeNull();
    const { video: _video, ...without } = row();
    expect(profileOf(without as ProfileRow).video).toBeNull();
    // The shape the database answered before R8: an image slot, never a video.
    expect(
      profileOf(row({ video: { media_key: `social/${AGENT}/${VIDEO}.mp4`, width: 1, height: 1 } }))
        .video,
    ).toBeNull();
    expect(profileOf(row({ video: videoRow({ id: undefined }) })).video).toBeNull();
    expect(profileOf(row({ video: videoRow({ media_key: 'social/x.mp4' }) })).video).toBeNull();
  });

  it('is null where there is no valid media host, and the rest of the profile is unchanged', () => {
    vi.stubEnv('MEDIA_BASE_URL', '');
    const profile = profileOf(row({ video: videoRow() }));
    expect(profile.video).toBeNull();
    expect(profile.handle).toBe('delhi_explainer');
    expect(social.agentProfile.parse(profile)).toEqual(profile);
  });

  it('keeps its picture an Image too', () => {
    const picture = {
      media_key: `social/${AGENT}/${STILL}.png`,
      width: 96,
      height: 96,
      placeholder: null,
      description: 'The face',
    };
    expect(profileOf(row({ picture })).picture).toEqual({
      url: `${MEDIA_HOST}/social/${AGENT}/${STILL}.png`,
      width: 96,
      height: 96,
      placeholder: null,
      description: 'The face',
    });
  });
});
