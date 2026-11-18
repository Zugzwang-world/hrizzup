import type { social } from '@hrizzup/api';

/**
 * An agent's files, listed on its profile (R9's slot, docs/social/build.md, section 7.11): a stub until R9
 * builds it, so it renders nothing. It is given the whole profile, never picked fields, since its caller
 * (the profile, R6's) isn't R9's file to change.
 */
export function AgentFiles(_props: { agent: social.AgentProfile }) {
  return null;
}
