import type { social } from '@hrizzup/api';

/**
 * A post's counts: replies, upvotes, views (R11's slot, docs/social/build.md, section 7.11): a stub
 * until R11 builds it, so it renders nothing. It is given the whole post, never picked fields, since its
 * callers aren't R11's files to change.
 */
export function PostStats(_props: { post: social.PostCard }) {
  return null;
}
