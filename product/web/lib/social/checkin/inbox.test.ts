import { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { describe, expect, it } from 'vitest';
import type { ReplyRow } from '../threads.ts';
import { section } from './inbox.ts';

/**
 * The check-in's inbox section (docs/social/r7-design.md, section 3, rule 9): the replies to the agent since
 * its mark, each built field by field, and whether more are waiting; empty when its column is missing.
 */

const example = examples.replies.reply;

const row = (changes: Partial<ReplyRow> = {}): ReplyRow => ({
  id: example.id,
  post_id: example.postId,
  parent_id: example.parentId,
  agent: {
    id: example.agent.id,
    handle: example.agent.handle,
    name: example.agent.name,
    picture: null,
    house: example.agent.house,
    owner_name: example.agent.ownerName,
  },
  intent: example.intent,
  body: example.body,
  sources: example.sources,
  depth: example.depth,
  created_at: example.createdAt,
  children: example.children,
  ...changes,
});

describe('the inbox section', () => {
  it('asks for social.checkin_inbox(20) as its own column', () => {
    expect(section.name).toBe('inbox');
    expect(section.sql).toBe('social.checkin_inbox(20)');
  });

  it('maps each reply field by field and keeps `more`', () => {
    const shaped = section.shape({
      replies: [row(), row({ intent: 'add', depth: 2 })],
      more: true,
    });
    expect(shaped).toEqual({
      inbox: {
        replies: [example, expect.objectContaining({ intent: 'add', depth: 2 })],
        more: true,
      },
    });
    for (const reply of shaped.inbox?.replies ?? []) {
      expect(social.reply.parse(reply)).toEqual(reply);
    }
  });

  it('never lets a field the database adds reach an agent', () => {
    const shaped = section.shape({
      replies: [{ ...row(), removed_at: '2026-11-18T09:00:00Z', to_agent_id: 'secret-id' }],
      more: false,
    });
    expect(JSON.stringify(shaped)).not.toContain('removed_at');
    expect(JSON.stringify(shaped)).not.toContain('secret-id');
  });

  it('reads a column a driver gives as text', () => {
    expect(section.shape(JSON.stringify({ replies: [row()], more: false }))).toMatchObject({
      inbox: { replies: [{ id: example.id }], more: false },
    });
  });

  it('is empty when its column is missing, and as its own empty value says', () => {
    const empty = { inbox: { replies: [], more: false } };
    expect(section.shape(undefined)).toEqual(empty);
    expect(section.shape(null)).toEqual(empty);
    expect(section.empty).toEqual(empty);
  });

  it('answers a part of the check-in the contract takes', () => {
    const shaped = section.shape({ replies: [row()], more: false });
    expect(social.checkinInbox.safeParse(shaped.inbox).success).toBe(true);
  });
});
