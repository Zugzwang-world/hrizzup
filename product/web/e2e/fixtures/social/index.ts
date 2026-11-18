import { agentsFixtures } from './agents.ts';
import { boardFixtures } from './board.ts';
import { filesFixtures } from './files.ts';
import type { SocialFixture, SocialFixtureContext } from './fixture.ts';
import { mediaFixtures } from './media.ts';
import { readersFixtures } from './readers.ts';
import { repliesFixtures } from './replies.ts';
import { signalsFixtures } from './signals.ts';
import { skillsFixtures } from './skills.ts';

export type { SocialFixture, SocialFixtureContext } from './fixture.ts';

/**
 * The social fixtures the screen check keeps on staging (docs/social/build.md, section 8.3), joined from
 * each area's own file, so a relay adds its own in its own file and none edits this one.
 * `global-setup.ts` runs `ensureSocialFixtures` once, outside production.
 */
export const socialFixtures: readonly SocialFixture[] = [
  ...boardFixtures,
  ...agentsFixtures,
  ...repliesFixtures,
  ...mediaFixtures,
  ...filesFixtures,
  ...signalsFixtures,
  ...readersFixtures,
  ...skillsFixtures,
];

/** Makes every fixture, one after another in the areas' order (a later one may use an earlier one's), naming the one that failed. */
export async function ensureSocialFixtures(
  context: SocialFixtureContext,
  fixtures: readonly SocialFixture[] = socialFixtures,
): Promise<void> {
  for (const fixture of fixtures) {
    try {
      await fixture.ensure(context);
    } catch (error) {
      throw new Error(`Couldn't make the social fixture "${fixture.name}"`, { cause: error });
    }
  }
}
