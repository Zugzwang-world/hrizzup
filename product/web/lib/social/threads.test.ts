import { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { describe, expect, it } from 'vitest';
import { emptyPreview, type PostPreview } from './reply-view.ts';
import {
  makePreviewBatcher,
  type PreviewLoader,
  previewReplyOf,
  type ReplyRow,
  replyOf,
  type ThreadReplyRow,
} from './threads.ts';

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

/** A post's preview with one reply of the given ID, which is how a test tells previews apart. */
function previewOf(postId: string): PostPreview {
  const reply = examples.replies.replyPage.replies[0];
  if (!reply) throw new Error('The example thread has a reply');
  return {
    postId,
    replies: [{ reply: { ...reply, postId }, replies: [], moreReplies: false }],
    moreReplies: false,
  };
}

/** A loader that answers every post it is asked for, and records each call's IDs. */
function recordingLoader(calls: string[][]): PreviewLoader {
  return async (ids) => {
    calls.push([...ids]);
    return ids.map(previewOf);
  };
}

const ids = (count: number, prefix = 'post') =>
  Array.from({ length: count }, (_, at) => `${prefix}-${at}`);

describe('the preview batcher (r7-design.md, section 4, rule 2)', () => {
  it('sends ten asks of one tick as one load with ten IDs, each answered with its own post', async () => {
    const calls: string[][] = [];
    const ask = makePreviewBatcher(recordingLoader(calls));
    const asked = ids(10);
    const answers = await Promise.all(asked.map((id) => ask(id)));
    expect(calls).toEqual([asked]);
    expect(answers.map((answer) => answer.postId)).toEqual(asked);
    expect(answers[3]).toEqual(previewOf('post-3'));
  });

  it('sends sixty asks as two loads of fifty and ten', async () => {
    const calls: string[][] = [];
    const ask = makePreviewBatcher(recordingLoader(calls));
    const asked = ids(60);
    const answers = await Promise.all(asked.map((id) => ask(id)));
    expect(calls.map((call) => call.length).sort((a, b) => a - b)).toEqual([10, 50]);
    expect(calls.flat().sort()).toEqual([...asked].sort());
    expect(answers.map((answer) => answer.postId)).toEqual(asked);
  });

  it('opens a batch of its own for a later tick, and never reuses a closed one', async () => {
    const calls: string[][] = [];
    const ask = makePreviewBatcher(recordingLoader(calls));
    await Promise.all([ask('a'), ask('b')]);
    await Promise.all([ask('c')]);
    await Promise.all([ask('a')]);
    expect(calls).toEqual([['a', 'b'], ['c'], ['a']]);
  });

  it('asks for a post once however often it is asked', async () => {
    const calls: string[][] = [];
    const ask = makePreviewBatcher(recordingLoader(calls));
    const [first, second] = await Promise.all([ask('same'), ask('same')]);
    expect(calls).toEqual([['same']]);
    expect(first).toEqual(second);
  });

  it('rejects only its own batch when a load fails', async () => {
    let call = 0;
    const ask = makePreviewBatcher(async (postIds) => {
      call += 1;
      if (call === 1) throw new Error('the database is down');
      return postIds.map(previewOf);
    });
    const failed = await Promise.allSettled([ask('a'), ask('b')]);
    expect(failed.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    expect(failed[0]).toMatchObject({ reason: { message: 'the database is down' } });
    // The next tick is a new batch, which the failure never touched.
    expect(await ask('c')).toEqual(previewOf('c'));
  });

  it('rejects only the asks of the call that failed, when a flush takes more than one call', async () => {
    const asked = ids(60);
    const ask = makePreviewBatcher(async (postIds) => {
      if (postIds.includes('post-55')) throw new Error('one call failed');
      return postIds.map(previewOf);
    });
    const outcomes = await Promise.allSettled(asked.map((id) => ask(id)));
    expect(outcomes.slice(0, 50).every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    expect(outcomes.slice(50).every((outcome) => outcome.status === 'rejected')).toBe(true);
  });

  it('answers an empty preview for a post that is not in the answer', async () => {
    const ask = makePreviewBatcher(async (postIds) =>
      postIds.filter((id) => id !== 'gone').map(previewOf),
    );
    const [here, gone] = await Promise.all([ask('here'), ask('gone')]);
    expect(here).toEqual(previewOf('here'));
    expect(gone).toEqual(emptyPreview('gone'));
    expect(gone.replies).toEqual([]);
    expect(gone.moreReplies).toBe(false);
  });
});

describe('a reply of a level read with its first replies', () => {
  it('is the reply, its replies and whether there are more, each built field by field', () => {
    const top: ThreadReplyRow = {
      ...row({ children: 2 }),
      replies: [row({ id: 'child-1', depth: 1, children: 1 }), row({ id: 'child-2', depth: 1 })],
      more_replies: true,
    };
    const made = previewReplyOf(top);
    expect(made.reply).toEqual(replyOf(row({ children: 2 })));
    expect(made.replies.map((child) => child.id)).toEqual(['child-1', 'child-2']);
    expect(made.replies[0]?.children).toBe(1);
    expect(made.moreReplies).toBe(true);
    expect(Object.keys(made.reply).sort()).toEqual(Object.keys(examples.replies.reply).sort());
  });

  it('has no replies and no more, when the database sent none (a level read with nothing nested)', () => {
    expect(previewReplyOf(row())).toEqual({
      reply: replyOf(row()),
      replies: [],
      moreReplies: false,
    });
  });
});
