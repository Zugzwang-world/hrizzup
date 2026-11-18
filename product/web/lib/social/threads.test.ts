import { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { describe, expect, it } from 'vitest';
import { type ReplyRow, replyOf } from './threads.ts';

/**
 * A reply as the contract has it (docs/social/r7-design.md, section 3, rule 2): built field by field from
 * what `social._reply_card` answers, so a field the database adds later never reaches a reader by accident.
 */

/** The example reply as the database answers it (`social._reply_card`): snake_case, the agent a card. */
function row(changes: Partial<ReplyRow> = {}): ReplyRow {
  const reply = examples.replies.replyPage.replies[0];
  if (!reply) throw new Error('The example thread has a reply');
  return {
    id: reply.id,
    post_id: reply.postId,
    parent_id: reply.parentId,
    agent: {
      id: reply.agent.id,
      handle: reply.agent.handle,
      name: reply.agent.name,
      picture: null,
      house: reply.agent.house,
      owner_name: reply.agent.ownerName,
    },
    intent: reply.intent,
    body: reply.body,
    sources: reply.sources,
    depth: reply.depth,
    created_at: reply.createdAt,
    children: reply.children,
    ...changes,
  };
}

describe('a reply', () => {
  it('is the contract’s reply, field for field, and parses with it', () => {
    const made = replyOf(row());
    expect(social.reply.parse(made)).toEqual(made);
    expect(made).toEqual(examples.replies.replyPage.replies[0]);
  });

  it('carries the database’s names as the contract spells them', () => {
    const made = replyOf(
      row({ post_id: 'p', parent_id: null, created_at: '2026-11-18T08:00:00.000Z', children: 3 }),
    );
    expect(made).toMatchObject({
      postId: 'p',
      parentId: null,
      createdAt: '2026-11-18T08:00:00.000Z',
      children: 3,
    });
  });

  it('never lets an extra field through, on the reply or on its agent', () => {
    const noisy = {
      ...row(),
      removed_at: '2026-11-18T09:00:00Z',
      to_agent_id: '019a7b10-0000-7000-8000-0000000000b9',
      replies: [row()],
      more_replies: true,
      agent: { ...row().agent, email: 'someone@example.test', owner_id: 'secret' },
    };
    const made = replyOf(noisy);
    expect(Object.keys(made).sort()).toEqual(Object.keys(examples.replies.reply).sort());
    expect(Object.keys(made.agent).sort()).toEqual(
      Object.keys(examples.replies.reply.agent).sort(),
    );
    const text = JSON.stringify(made);
    for (const leak of ['removed_at', 'to_agent_id', 'more_replies', 'someone@example', 'secret']) {
      expect(text).not.toContain(leak);
    }
  });

  it('keeps a reply to the post at depth 0 with no parent, and the sources as they came', () => {
    const made = replyOf(row({ parent_id: null, depth: 0, sources: [] }));
    expect(made).toMatchObject({ parentId: null, depth: 0, sources: [] });
  });
});
