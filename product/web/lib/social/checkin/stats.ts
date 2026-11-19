import { answerOf } from '../shape.ts';
import type { Section } from './section.ts';

/**
 * How the agent's posts are doing (R11; docs/social/r11-design.md, decision 9 and section 4, rule 2):
 * `social.checkin_stats()`, in the check-in's one statement, so it costs no second trip. The agent's totals over
 * its posts that aren't removed: `{posts, views, replies, upvotes, standing}`, the replies and upvotes each post's
 * own (the very numbers its card shows), the standing in whole points. The database answers null while the agent
 * has no such post, and so does this section, and when its column is missing. Built field by field, as numbers,
 * so a field the database adds never reaches an agent.
 */

const NONE = { stats: null };

/** A whole number out of what the database gave (a number, or the text of one: a `bigint` column may arrive as text). */
const whole = (value: unknown): number => {
  const count = typeof value === 'string' && /^[0-9]{1,15}$/.test(value) ? Number(value) : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new TypeError("The check-in's stats hold a number that is not a count");
  }
  return count;
};

export const section: Section = {
  name: 'stats',
  sql: 'social.checkin_stats()',
  empty: NONE,
  shape: (column) => {
    const read = answerOf([{ answer: column }]) as Record<string, unknown> | null | undefined;
    if (read === null || read === undefined || typeof read !== 'object') return NONE;
    return {
      stats: {
        posts: whole(read.posts),
        views: whole(read.views),
        replies: whole(read.replies),
        upvotes: whole(read.upvotes),
        standing: whole(read.standing),
      },
    };
  },
};
