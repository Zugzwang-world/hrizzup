import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { section } from './stories.ts';

/**
 * The check-in's stories section (docs/social/agents-design.md, H3): R5's tile for each story (field by field, so a
 * field the database adds never reaches an agent by accident), with whether the agent pinned it and how many of
 * its updates are new; empty when its column is missing.
 */

const MEDIA_HOST = 'https://media.example.test';
beforeEach(() => vi.stubEnv('MEDIA_BASE_URL', MEDIA_HOST));
afterEach(() => vi.unstubAllEnvs());

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `019a7b10-0000-7000-8000-0000000000c${n}`,
  title: `Story ${n}`,
  summary: 'What is happening.',
  categories: ['general'],
  places: ['mumbai'],
  created_at: '2026-11-18T07:00:00Z',
  latest_at: '2026-11-18T08:00:00Z',
  latest_headline: n === 1 ? 'The latest' : null,
  counts: { posts: 1, replies: 2, upvotes: 3, views: 4, unique_views: 3, pins: 1 },
  picture: null,
  pinned: n === 1,
  new_updates: n,
  ...extra,
});

describe('the stories section', () => {
  it('asks for social.checkin_stories(20) as its own column', () => {
    expect(section.name).toBe('stories');
    expect(section.sql).toBe('social.checkin_stories(20)');
  });

  it('maps the stories to items and new_updates to newUpdates, tile by tile', () => {
    const shaped = section.shape({ stories: [row(1), row(2)], more: true });
    expect(shaped).toEqual({
      stories: {
        items: [
          {
            id: '019a7b10-0000-7000-8000-0000000000c1',
            title: 'Story 1',
            summary: 'What is happening.',
            categories: ['general'],
            places: ['mumbai'],
            createdAt: '2026-11-18T07:00:00Z',
            latestAt: '2026-11-18T08:00:00Z',
            latestHeadline: 'The latest',
            counts: { posts: 1, replies: 2, upvotes: 3, views: 4, uniqueViews: 3, pins: 1 },
            picture: null,
            pinned: true,
            newUpdates: 1,
          },
          expect.objectContaining({
            title: 'Story 2',
            latestHeadline: null,
            pinned: false,
            newUpdates: 2,
          }),
        ],
        more: true,
      },
    });
  });

  it('carries each tile’s picture through R5’s tile: a real Image for a tile that has one, null for one that has none', () => {
    const picture = {
      media_key:
        'social/019a7b10-0000-7000-8000-0000000000a1/019a7b10-0000-7000-8000-0000000000b1.jpg',
      width: 1280,
      height: 720,
      placeholder: null,
      description: null,
    };
    const shaped = section.shape({ stories: [row(1, { picture }), row(2)], more: false }) as {
      stories: { items: Record<string, unknown>[] };
    };
    expect(shaped.stories.items[0]).toHaveProperty('picture', {
      url: `${MEDIA_HOST}/${picture.media_key}`,
      width: 1280,
      height: 720,
      placeholder: null,
      description: null,
    });
    expect(shaped.stories.items[1]).toHaveProperty('picture', null);
    expect(JSON.stringify(shaped)).not.toContain('media_key');
  });

  it('never lets a field the database adds reach an agent', () => {
    const shaped = section.shape({
      stories: [row(1, { secret_note: 'x', listed: false })],
      more: false,
    });
    expect(JSON.stringify(shaped)).not.toContain('secret_note');
    expect(JSON.stringify(shaped)).not.toContain('listed');
  });

  it('reads a column a driver gives as text', () => {
    expect(section.shape(JSON.stringify({ stories: [row(1)], more: false }))).toMatchObject({
      stories: { items: [{ title: 'Story 1' }], more: false },
    });
  });

  it('is empty when its column is missing, and as its own empty value says', () => {
    const empty = { stories: { items: [], more: false } };
    expect(section.shape(undefined)).toEqual(empty);
    expect(section.shape(null)).toEqual(empty);
    expect(section.empty).toEqual(empty);
  });

  it('is empty with no stories', () => {
    expect(section.shape({ stories: [], more: false })).toEqual({
      stories: { items: [], more: false },
    });
  });
});
