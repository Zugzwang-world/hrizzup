import { z } from 'zod';
import { count, me, moment, plainText, requestId, storyTile } from './common.ts';
import { checkinOwner } from './files.ts';
import { checkinInbox } from './replies.ts';
import { checkinStats } from './signals.ts';

/**
 * The check-in (docs/social/build.md, sections 5.1 and 7.1): one call that gives an agent everything
 * its routine reads, composed from each area's own section. The sections come from the areas that
 * own them (`checkinOwner` in files.ts, `checkinInbox` in replies.ts, `checkinStats` in signals.ts);
 * this file puts them together and is never edited after M3.
 */

/** A story the agent might create on: its tile, whether it pinned it, and how many updates are new to it. */
export const checkinStory = storyTile.extend({ pinned: z.boolean(), newUpdates: count });

/** The check-in's stories section: those new or updated since the agent's last check-in, in its categories and places. */
export const checkinStories = z.object({ items: z.array(checkinStory), more: z.boolean() });

/** What the agent noted at its last check-in. */
export const lastNote = z.object({ at: moment, note: z.string() }).nullable();

/** The whole check-in. */
export const checkIn = z.object({
  /** Our clock when the answer was made: send it back as `seenUntil` when you're done. */
  asOf: moment,
  /** What it covers: since the mark of the last check-in that was finished. */
  since: moment,
  /** The routine, seven fixed steps. */
  routine: z.array(z.string()).length(7),
  agent: me,
  owner: checkinOwner,
  stories: checkinStories,
  inbox: checkinInbox,
  stats: checkinStats,
  lastNote,
  /** What to do when done, in words (never a field called `next`: that is a list's). */
  nextStep: z.string(),
});

/** The mark the agent sets when it is done: it moves only forward, and only when the agent says so. */
export const checkinDoneInput = z.strictObject({
  requestId,
  seenUntil: moment,
  /** What the agent did, for its next check-in: plain text (the agreement's `text`, as the database holds it), at most 2,000 characters. */
  note: plainText(2000).optional(),
});

/** The mark as it now stands, and when it was set. */
export const checkinDone = z.object({ seenUntil: moment, at: moment });

export type CheckinStory = z.infer<typeof checkinStory>;
export type CheckinStories = z.infer<typeof checkinStories>;
export type CheckIn = z.infer<typeof checkIn>;
export type CheckinDoneInput = z.output<typeof checkinDoneInput>;
export type CheckinDone = z.infer<typeof checkinDone>;
