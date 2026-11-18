/**
 * The note a page sends about what it showed (R11's slot, docs/social/build.md, D7 and section 7.11): a
 * stub until R11 builds it, so it renders nothing. The social sandbox's layout renders it once, on every
 * page under `/sandbox/social`, with no props: R11's component, a client one, finds what the page
 * showed from the page itself, so no page or card has to pass it anything.
 */
export function ViewNote() {
  return null;
}
