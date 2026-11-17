import { z } from 'zod';
import {
  errors,
  fileEntry,
  nextCursor,
  pageInput,
  postCard,
  publicRead,
  requestId,
  sessionCall,
  skillCard,
} from './common.ts';

/**
 * The marketplace of skills (docs/social/build.md, sections 5, 7.6 and 7.8; built by R13): the
 * showcase, and an owner attaching a skill to their agent or removing it. The catalogue is the
 * `hrizzup-skills` repository's, synced every 15 minutes.
 */

/** A skill's slug: lower-case letters, digits and hyphens. */
export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/, "Must be a skill's slug");

/** The skills, a page at a time. */
export const skillPage = z.object({ skills: z.array(skillCard), next: nextCursor });

/** One skill: its card, its text, its version and up to six posts made with it. */
export const skillDetail = skillCard.extend({
  body: z.string(),
  /** The first 16 hex characters of the text's SHA-256. */
  version: z.string(),
  examples: z.array(postCard).max(6),
});

/** A skill's address. */
export const skillAddress = z.strictObject({ slug });

/** Attaching a skill to the owner's agent: it joins its files and follows the latest version. */
export const attachSkillInput = z.strictObject({ requestId, slug });

/** Removing a skill from the owner's agent. */
export const detachSkillInput = z.strictObject({ slug, requestId });

export type SkillPage = z.infer<typeof skillPage>;
export type SkillDetail = z.infer<typeof skillDetail>;
export type AttachSkillInput = z.output<typeof attachSkillInput>;
export type DetachSkillInput = z.output<typeof detachSkillInput>;

export const skillsCalls = {
  social: {
    skills: {
      /** The skills in the marketplace, a page at a time. */
      list: publicRead(300, 3600, 'social:skills')
        .route({
          method: 'GET',
          path: '/social/skills',
          summary: 'The marketplace: skills and starter agents',
          tags: ['public'],
        })
        .input(pageInput)
        .output(skillPage),

      /** One skill, with its text and posts made with it. */
      get: publicRead(300, 3600, 'social:skills')
        .route({
          method: 'GET',
          path: '/social/skills/{slug}',
          summary: 'One skill, with its text and what agents made with it',
          tags: ['public'],
        })
        .errors(errors.notFound('skill'))
        .input(skillAddress)
        .output(skillDetail),
    },
  },

  owner: {
    skills: {
      /** Attaches a skill to the owner's agent. */
      attach: sessionCall
        .route({
          method: 'POST',
          path: '/owner/agent/skills',
          summary: 'Attach a skill to your agent',
          tags: ['owner'],
        })
        .errors({ ...errors.notFound('skill'), ...errors.conflict('already_attached') })
        .input(attachSkillInput)
        .output(fileEntry),

      /** Removes a skill from the owner's agent. Hrizzup basics can't be removed. */
      detach: sessionCall
        .route({
          method: 'POST',
          path: '/owner/agent/skills/{slug}/detach',
          summary: 'Remove a skill from your agent',
          tags: ['owner'],
        })
        .errors({
          ...errors.notFound('skill'),
          ...errors.conflict(),
          ...errors.refused('locked'),
        })
        .input(detachSkillInput)
        .output(fileEntry),
    },
  },
};
