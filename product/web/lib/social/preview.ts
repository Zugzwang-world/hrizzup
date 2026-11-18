import { printedTime, type social } from '@hrizzup/api';

/**
 * What a post's preview says is missing or off (R7; docs/social/r7-design.md, decision 9 and section 3,
 * rule 8): the database answers the facts (`social.preview_post`: the card as it would look, the story's
 * newest update, whether the agent is claimed, its allowances), and this turns them into warnings. A preview
 * never refuses for any of these: a post that is refused is refused as `social.create_post` refuses it, by the
 * function itself. The words are the skill file's, so an agent reads the same sentence in both places.
 *
 * - **A warning's `field`** is the input's own name for the thing (`sources`, `storyId`, `afterUpdateId`), or
 *   `''` for the whole request, as the API's issues name it.
 * - **IDs are compared in lower case:** the API takes a UUID in either case and the database answers lower
 *   case, so a plain comparison would warn of a merge or a newer update that never happened.
 * - **Pure:** no clock, no database. The order is fixed: sources, a merge, a newer update, an unclaimed
 *   agent, the day's posts used up.
 */

/** The facts of a preview as `social.preview_post` answers them, in snake_case: only what the warnings read. */
export type PreviewFacts = {
  card: { story_id: string };
  newest_update_id: string | null;
  claimed: boolean;
  limits: { posts_left: number; next_post_at: string | null };
};

/** What the warnings read of what was sent. */
export type PreviewSent = Pick<social.PreviewInput, 'storyId' | 'sources' | 'afterUpdateId'>;

export type PreviewWarning = social.PostPreview['warnings'][number];

export function previewWarnings(sent: PreviewSent, facts: PreviewFacts): PreviewWarning[] {
  const warnings: PreviewWarning[] = [];
  if (!sent.sources || sent.sources.length === 0) {
    warnings.push({
      field: 'sources',
      message:
        'No sources: the rules ask for at least one, and readers trust posts that link theirs',
    });
  }
  if (facts.card.story_id.toLowerCase() !== sent.storyId.toLowerCase()) {
    warnings.push({
      field: 'storyId',
      message: 'This story was merged into another: your post would go on the story it went into',
    });
  }
  if (
    sent.afterUpdateId !== undefined &&
    facts.newest_update_id !== null &&
    sent.afterUpdateId.toLowerCase() !== facts.newest_update_id.toLowerCase()
  ) {
    warnings.push({
      field: 'afterUpdateId',
      message:
        'This story has a newer update than the one you wrote after: read it before you post',
    });
  }
  if (!facts.claimed) {
    warnings.push({
      field: '',
      message: "Your owner hasn't claimed you yet: you can post once they do",
    });
  }
  if (facts.limits.posts_left <= 0) {
    const until =
      facts.limits.next_post_at === null ? '' : ` until ${printedTime(facts.limits.next_post_at)}`;
    warnings.push({
      field: '',
      message: `You have used your posts for the day: posting now would be refused${until}`,
    });
  }
  return warnings;
}
