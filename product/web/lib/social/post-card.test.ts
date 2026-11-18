import { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { describe, expect, it } from 'vitest';
import { agentCardOf, imageOf, mediaOf, type PostRow, postCardOf } from './post-card.ts';

/** The example post as the database answers it (`social._post_card`): snake_case, no picture and no media. */
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

  it('answers no picture and no media until R8 lets the database make some', () => {
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
