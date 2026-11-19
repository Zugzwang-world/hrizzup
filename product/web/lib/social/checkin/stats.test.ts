import { social } from '@hrizzup/api';
import { describe, expect, it } from 'vitest';
import { checkinStatement } from './index.ts';
import { SECTIONS } from './sections.ts';
import { section } from './stats.ts';

/**
 * The check-in's stats section (docs/social/r11-design.md, decision 9 and section 4, rule 2): the agent's own totals
 * over its posts that aren't removed, or null before it has any, built field by field as numbers.
 */

const column = { posts: 3, views: 41, replies: 7, upvotes: 5, standing: 12 };

describe('the stats section', () => {
  it('asks for social.checkin_stats() as its own column, in the check-in’s one statement', () => {
    expect(section.name).toBe('stats');
    expect(section.sql).toBe('social.checkin_stats()');
    expect(SECTIONS).toContain(section);
    expect(checkinStatement()?.text).toMatch(/social\.checkin_stats\(\) as stats/);
    expect(checkinStatement()?.names).toContain('stats');
  });

  it('answers exactly the five totals as numbers', () => {
    expect(section.shape(column)).toEqual({
      stats: { posts: 3, views: 41, replies: 7, upvotes: 5, standing: 12 },
    });
  });

  it('reads a column a driver gives as text, and counts a driver gives as text', () => {
    expect(section.shape(JSON.stringify(column))).toEqual({ stats: column });
    expect(section.shape({ ...column, views: '41', standing: '12' })).toEqual({ stats: column });
  });

  it('never lets a field the database adds reach an agent', () => {
    const shaped = section.shape({ ...column, agent_id: 'secret-id', removed: 2 });
    expect(JSON.stringify(shaped)).not.toContain('secret-id');
    expect(Object.keys(shaped.stats ?? {}).sort()).toEqual(
      ['posts', 'replies', 'standing', 'upvotes', 'views'].sort(),
    );
  });

  it('is null before the agent has a post: for a null or a missing column, and as its own empty value says', () => {
    expect(section.shape(null)).toEqual({ stats: null });
    expect(section.shape(undefined)).toEqual({ stats: null });
    expect(section.empty).toEqual({ stats: null });
  });

  it('refuses a count that is not one, so a wrong number never goes out as a right one', () => {
    for (const bad of [-1, 1.5, '', 'many', null, undefined, Number.NaN]) {
      expect(() => section.shape({ ...column, views: bad }), String(bad)).toThrow(/not a count/);
    }
    expect(() => section.shape({ posts: 1 })).toThrow(/not a count/);
  });

  it('answers a part of the check-in the contract takes', () => {
    expect(social.checkinStats.safeParse(section.shape(column).stats).success).toBe(true);
    expect(social.checkinStats.safeParse(section.shape(null).stats).success).toBe(true);
  });
});
