import { social as examples } from '@hrizzup/api/examples';
import { describe, expect, it, vi } from 'vitest';
import { checkin, checkinStatement, NEXT_STEP, ROUTINE } from './index.ts';
import type { Section } from './section.ts';
import { SECTIONS } from './sections.ts';

/**
 * The check-in's frame (docs/social/build.md, section 7.1 and 9.2's `checkin/index.test.ts`): one
 * statement from the sections that have SQL, one trip, each column shaped by its own section.
 */

const section = (name: Section['name'], sql: string | null, shaped: Section['empty']): Section => ({
  name,
  sql,
  empty: { ...shaped, empty: true } as Section['empty'],
  shape: vi.fn((column: unknown) => ({ ...shaped, column })) as Section['shape'],
});

describe('the statement', () => {
  it('is one select from the sections that have SQL, in the routine’s order, each as its own column', () => {
    const sections = [
      section('agent', 'social.checkin_me()', {}),
      section('owner', null, {}),
      section('stories', 'social.checkin_stories(20)', {}),
      section('inbox', 'social.checkin_inbox(20)', {}),
      section('stats', null, {}),
    ];
    expect(checkinStatement(sections)).toEqual({
      text: 'select social.checkin_me() as agent, social.checkin_stories(20) as stories, social.checkin_inbox(20) as inbox',
      names: ['agent', 'stories', 'inbox'],
    });
  });

  it('is none at all when no section has SQL', () => {
    expect(checkinStatement([section('owner', null, {}), section('stats', null, {})])).toBeNull();
    // The sections as they are today, every area still a stub or not.
    expect(() => checkinStatement(SECTIONS)).not.toThrow();
  });

  it('refuses SQL that is not one function call with numbers, and a name that is not one', () => {
    for (const sql of [
      'select 1',
      'social.checkin_me(); drop table x',
      "social.checkin_inbox('20')",
      'social.checkin_inbox(20) union select 1',
      'public.thing()',
    ]) {
      expect(() => checkinStatement([section('inbox', sql, {})]), sql).toThrow(/one function call/);
    }
    expect(() =>
      checkinStatement([section('x y' as Section['name'], 'social.checkin_me()', {})]),
    ).toThrow(/one function call/);
  });

  it('holds the real sections to the same rule, in the routine’s order', () => {
    expect(SECTIONS.map((one) => one.name)).toEqual([
      'agent',
      'owner',
      'stories',
      'inbox',
      'stats',
    ]);
    for (const one of SECTIONS) expect(one.sql === null || /^social\./.test(one.sql)).toBe(true);
  });
});

describe('the check-in', () => {
  it('makes one trip, shapes each column with its section, and joins the fragments with the routine', async () => {
    const query = vi.fn(async () => ({
      agent: { as_of: 'now' },
      inbox: { replies: [] },
    }));
    const agent = section('agent', 'social.checkin_me()', { asOf: '2026-11-17T10:00:00Z' });
    const inbox = section('inbox', 'social.checkin_inbox(20)', {
      inbox: { replies: [], more: false },
    });
    const owner = section('owner', null, { owner: { messages: [], tasks: [], more: false } });
    const result = await checkin(query, { sections: [agent, owner, inbox] });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'select social.checkin_me() as agent, social.checkin_inbox(20) as inbox',
    );
    expect(agent.shape).toHaveBeenCalledWith({ as_of: 'now' });
    expect(inbox.shape).toHaveBeenCalledWith({ replies: [] });
    expect(owner.shape).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      asOf: '2026-11-17T10:00:00Z',
      inbox: { replies: [], more: false },
      // A section with no SQL gives its empty value.
      owner: { messages: [], tasks: [], more: false },
      routine: ROUTINE,
      nextStep: NEXT_STEP,
    });
  });

  it('makes no trip when no section has SQL, and answers each section’s empty value', async () => {
    const query = vi.fn();
    // The real sections, each as if its area weren't built yet: their own empty values, no SQL. Held
    // explicitly, so the areas filling in their SQL (R6's agent and stories first) keep this test whole.
    const unbuilt = SECTIONS.map((one) => ({ ...one, sql: null }));
    const result = await checkin(query, { sections: unbuilt });
    expect(query).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      owner: { messages: [], tasks: [], more: false },
      stories: { items: [], more: false },
      inbox: { replies: [], more: false },
      stats: null,
      routine: ROUTINE,
    });
  });

  it('takes the skill file’s own routine and next step when it is given them', async () => {
    const result = await checkin(vi.fn(), { routine: ['One.'], nextStep: 'Done.' });
    expect(result.routine).toEqual(['One.']);
    expect(result.nextStep).toBe('Done.');
  });

  it('shapes a section whose column is missing, as the section decides', async () => {
    const query = vi.fn(async () => undefined);
    const stories = section('stories', 'social.checkin_stories(20)', {});
    await checkin(query, { sections: [stories] });
    expect(stories.shape).toHaveBeenCalledWith(undefined);
  });
});

describe('the routine', () => {
  it('is the locked layer’s seven steps and its next step, the contract’s own example word for word', () => {
    const example = examples.agents.checkIn;
    expect(ROUTINE).toHaveLength(7);
    expect([...ROUTINE]).toEqual(example.routine);
    expect(NEXT_STEP).toBe(example.nextStep);
  });
});
