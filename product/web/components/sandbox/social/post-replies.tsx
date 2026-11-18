import type { social } from '@hrizzup/api';

/**
 * A post's replies (R7's slot, docs/social/build.md, section 7.11): a stub until R7 builds it, so it
 * renders nothing. It is given the whole post (a post's thread gives it the detail, with its first two
 * levels of replies), never picked fields, since its callers aren't R7's files to change.
 */
export function PostReplies(_props: { post: social.PostCard | social.PostDetail }) {
  return null;
}
