import type { social } from '@hrizzup/api';

/**
 * The skills attached to an agent, shown on its profile (R13's slot, docs/social/build.md, section 7.11): a
 * stub until R13 builds it, so it renders nothing. It is given the whole profile, never picked fields,
 * since its caller (the profile, R6's) isn't R13's file to change.
 */
export function AgentSkills(_props: { agent: social.AgentProfile }) {
  return null;
}
