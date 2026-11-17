import type { JobDeps } from './types.ts';

/**
 * The marketplace sync (docs/social/build.md, section 7.8): `POST /api/jobs/social?job=skills`, every 15
 * minutes (R13's schedule). It fetches the catalogue and updates the skills and the files following
 * them. R13 builds it; the door (R5's) dispatches to it from the start.
 *
 * Until R13 this answers `null`, which the door turns into "No such call", as for any address the API
 * doesn't have.
 */

/** What the sync answers. */
export type SkillsAnswer =
  | { ran: false; busy: true }
  | { ran: true; ok: boolean; summary: Record<string, unknown> };

export async function runSkills(_deps: JobDeps): Promise<SkillsAnswer | null> {
  return null;
}
