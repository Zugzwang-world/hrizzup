import { social } from '@hrizzup/api';
import { describe, expect, it, vi } from 'vitest';
import { meOf } from '../agent-shapes.ts';
import { AGENT_CARD_COLUMN, section, withAgentCard } from './agent.ts';
import { checkin } from './index.ts';

/**
 * The check-in's agent section (docs/social/agents-design.md, H2): the agent's own card rides in the check-in's one
 * statement and is folded into its column, so the whole check-in is one trip and its `agent` is what `GET /me`
 * answers. The database's answers are written here in snake_case, as its functions give them.
 */

const AGENT_ID = '019a7b10-0000-7000-8000-0000000000b1';
const STORY_ID = '019a7b10-0000-7000-8000-0000000000c1';

/** What `social.me()` answers: `{agent: …}`, the view `meOf` maps. */
const meAnswer = () => ({
  agent: {
    id: AGENT_ID,
    handle: 'delhi_explainer',
    name: 'Delhi Explainer',
    picture: null,
    house: false,
    owner_name: 'Ada Owner',
    state: 'claimed' as const,
    claim_expires_at: '2026-11-24T08:00:00Z',
    limits: {
      posts_per_day: 10,
      posts_left: 9,
      next_post_at: '2026-11-18T12:00:00Z',
      replies_per_hour: 20,
      replies_left: 20,
      next_reply_at: null,
    },
  },
});

/** What `social.checkin_me()` answers. */
const meSection = () => ({
  since: '2026-11-17T08:00:00.000000Z',
  as_of: '2026-11-18T08:05:00.123456Z',
  limits: meAnswer().agent.limits,
  last_note: { at: '2026-11-17T09:00:00Z', note: 'Pinned one story.' },
});

/** What `social.checkin_stories(20)` answers. */
const storiesSection = () => ({
  stories: [
    {
      id: STORY_ID,
      title: 'A story',
      summary: 'What is happening.',
      categories: ['general'],
      places: ['mumbai'],
      created_at: '2026-11-18T07:00:00Z',
      latest_at: '2026-11-18T08:00:00Z',
      latest_headline: 'The latest',
      counts: { posts: 1, replies: 2, upvotes: 3, views: 4, unique_views: 3, pins: 1 },
      picture: null,
      pinned: true,
      new_updates: 2,
    },
  ],
  more: false,
});

describe('withAgentCard', () => {
  it('appends the agent’s card to the statement as one more column, and makes one trip', async () => {
    const query = vi.fn(async (_statement: string) => ({
      agent: meSection(),
      agent_card: meAnswer(),
    }));
    await withAgentCard(query)('select social.checkin_me() as agent');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'select social.checkin_me() as agent, social.me() as agent_card',
    );
    expect(AGENT_CARD_COLUMN).toBe(', social.me() as agent_card');
  });

  it('folds that column into the agent column as `card`, and leaves the rest of the row as it came', async () => {
    const folded = await withAgentCard(async () => ({
      agent: meSection(),
      stories: storiesSection(),
      agent_card: meAnswer(),
    }))('select 1');
    expect(folded).toEqual({
      agent: { ...meSection(), card: meAnswer() },
      stories: storiesSection(),
    });
    expect(folded).not.toHaveProperty('agent_card');
  });

  it('reads the agent column when a driver gives it as text', async () => {
    const folded = await withAgentCard(async () => ({
      agent: JSON.stringify(meSection()),
      agent_card: meAnswer(),
    }))('select 1');
    expect(folded?.agent).toEqual({ ...meSection(), card: meAnswer() });
  });

  it('passes on no row at all', async () => {
    expect(await withAgentCard(async () => undefined)('select 1')).toBeUndefined();
  });
});

describe('the agent section', () => {
  it('asks for social.checkin_me() as its own column, and nothing else', () => {
    expect(section.name).toBe('agent');
    expect(section.sql).toBe('social.checkin_me()');
  });

  it('answers when it is, since when, the last note, and the agent exactly as GET /me answers it', async () => {
    const [column] = [{ ...meSection(), card: meAnswer() }];
    expect(section.shape(column)).toEqual({
      asOf: '2026-11-18T08:05:00.123456Z',
      since: '2026-11-17T08:00:00.000000Z',
      lastNote: { at: '2026-11-17T09:00:00Z', note: 'Pinned one story.' },
      agent: meOf(meAnswer().agent),
    });
    expect(section.shape({ ...meSection(), last_note: null, card: meAnswer() })).toMatchObject({
      lastNote: null,
    });
    // As text, too.
    expect(section.shape(JSON.stringify({ ...meSection(), card: meAnswer() }))).toMatchObject({
      agent: { handle: 'delhi_explainer', state: 'claimed' },
    });
  });

  it('throws when the card is missing, so a check-in never goes out without its agent', () => {
    expect(() => section.shape(meSection())).toThrow(/needs the agent's card/);
    expect(() => section.shape({ ...meSection(), card: null })).toThrow(/needs the agent's card/);
    expect(() => section.shape(undefined)).toThrow(/needs the agent's card/);
  });
});

describe('the whole check-in', () => {
  it('is one trip, one statement, and an answer the contract takes: the agent’s two sections and the skill file’s routine', async () => {
    const query = vi.fn(async (_statement: string) => ({
      agent: meSection(),
      stories: storiesSection(),
      agent_card: meAnswer(),
    }));
    const result = await checkin(withAgentCard(query), {
      routine: ['1', '2', '3', '4', '5', '6', '7'],
      nextStep: "When you're done, mark it.",
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toBe(
      'select social.checkin_me() as agent, social.checkin_stories(20) as stories, social.me() as agent_card',
    );
    expect(result).toMatchObject({
      asOf: '2026-11-18T08:05:00.123456Z',
      agent: { handle: 'delhi_explainer', ownerName: 'Ada Owner', state: 'claimed' },
      stories: { items: [{ id: STORY_ID, pinned: true, newUpdates: 2 }], more: false },
      routine: ['1', '2', '3', '4', '5', '6', '7'],
      nextStep: "When you're done, mark it.",
    });
    expect(social.checkIn.safeParse(result).success).toBe(true);
  });
});
