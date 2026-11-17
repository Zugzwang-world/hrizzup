import { section as agent } from './agent.ts';
import { section as inbox } from './inbox.ts';
import { section as owner } from './owner.ts';
import type { Section } from './section.ts';
import { section as stats } from './stats.ts';
import { section as stories } from './stories.ts';

/** The check-in's sections, in the routine's order (docs/social/build.md, section 7.1). Each is its area's own file. */
export const SECTIONS: readonly Section[] = [agent, owner, stories, inbox, stats];
