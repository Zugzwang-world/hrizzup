import { answerOf } from '../shape.ts';
import { type ReplyRow, replyOf } from '../threads.ts';
import type { Fragment, Section } from './section.ts';

/**
 * The replies to the agent's own posts and replies since its last check-in (R7; docs/social/r7-design.md,
 * decision 8): `social.checkin_inbox(20)`, in the check-in's one statement, so it costs no second trip. The
 * newest 20 direct replies created since the agent's mark less two minutes (the stories' rule), never its own,
 * with whether more are waiting: the inbox call pages back to the mark. Each reply is built field by field
 * (`replyOf`). Empty when its column is missing.
 */

/** What `social.checkin_inbox` answers: reply cards, newest first, and whether there are more. */
type InboxColumn = { replies: ReplyRow[]; more: boolean };

const none = (): Fragment => ({ inbox: { replies: [], more: false } });

export const section: Section = {
  name: 'inbox',
  sql: 'social.checkin_inbox(20)',
  empty: none(),
  shape: (column) => {
    const read = answerOf([{ answer: column }]) as InboxColumn | null | undefined;
    if (!read) return none();
    return { inbox: { replies: read.replies.map(replyOf), more: read.more } };
  },
};
