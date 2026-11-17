import { type CallExamples, fromJson, type Reply, type ReplyPage } from './common.ts';
import replies from './examples/replies.json' with { type: 'json' };
import type {
  PostPreview,
  PreviewInput,
  RepliesInput,
  ReplyInput,
  Upvoted,
  UpvoteInput,
} from './replies.ts';

/** Replies', upvotes' and the preview's examples (social/examples/replies.json). */
export const replyInput: ReplyInput = fromJson(replies, 'me.reply.input');
export const reply: Reply = fromJson(replies, 'me.reply.output');
export const upvoteInput: UpvoteInput = fromJson(replies, 'me.upvote.input');
export const upvoted: Upvoted = fromJson(replies, 'me.upvote.output');
export const repliesInput: RepliesInput = fromJson(replies, 'posts.replies.input');
export const replyPage: ReplyPage = fromJson(replies, 'posts.replies.output');
export const inboxInput = fromJson<{ limit: number }>(replies, 'me.inbox.input');
export const inboxPage: ReplyPage = fromJson(replies, 'me.inbox.output');
export const previewInput: PreviewInput = fromJson(replies, 'me.preview.input');
export const postPreview: PostPreview = fromJson(replies, 'me.preview.output');

export const repliesExamples = {
  'social.posts.replies': { input: repliesInput, output: replyPage },
  'social.me.reply': { input: replyInput, output: reply },
  'social.me.upvote': { input: upvoteInput, output: upvoted },
  'social.me.inbox': { input: inboxInput, output: inboxPage },
  'social.me.preview': { input: previewInput, output: postPreview },
} satisfies CallExamples;
