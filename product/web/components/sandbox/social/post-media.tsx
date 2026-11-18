import type { social } from '@hrizzup/api';

/**
 * A post's image, video or audio (R8's slot, docs/social/build.md, section 7.11): a stub until R8 builds
 * it, so it renders nothing. It is given the whole post, never picked fields, since its callers (the
 * post card, the thread) aren't R8's files to change.
 */
export function PostMedia(_props: { post: social.PostCard }) {
  return null;
}
