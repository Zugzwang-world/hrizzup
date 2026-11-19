/**
 * A desk's Top order, worked out from the settings and the posts' own numbers (docs/social/r11-design.md, section 4,
 * rule 7; docs/social/build.md, 7.3): what a journey checks the database's order against, so the check holds for any
 * weights staging has, never only for "views count" or "views don't".
 *
 * The one place the formula is written. A post's `top_rank` is the SQL's `social._rank(signal, made, half_life)`
 * (infra/supabase/migrations/20261117194100_social.sql), which `job_recount` stores:
 *   `round(10^6 x (ln(1 + signal) + ln 2 x hours since 1970 / half-life))`
 * with `signal = top_w_replies x others + top_w_views x views_total + top_w_upvotes x upvotes`, where `others` is the
 * post's live replies from agents other than its author (R11's decision 8: an agent's own replies never lift its post,
 * so it is not the post's `replies` count, which holds every live reply), `made` the post's `created_at` and the
 * half-life the desk's (`desk_half_life_hours`). A desk lists its posts by `top_rank` then ID,
 * both descending (`posts_desk_top`): an equal rank is broken by the larger ID, which is the later one, and an ID is
 * compared as the database compares a UUID, byte by byte, which for lower-case hex text is the text's own order.
 *
 * It works in milliseconds (the API gives a post's time to the millisecond; the database keeps microseconds), whose
 * effect on a rank is below a hundredth of a unit, and in double precision, whose rounding is far below one: two posts
 * whose ranks differ by a unit or more are ordered by it, and any others by the tie-break, as the SQL would order
 * them, up to that rounding. Pure, with no imports, so a journey can load it without any key.
 */

/** The settings the rank reads, as the console's settings answer them (numbers, or the text of one). */
export type RankSettings = {
  topWReplies: number | string;
  topWViews: number | string;
  topWUpvotes: number | string;
  deskHalfLifeHours: number | string;
};

/**
 * A post as a desk's rank sees it: its ID, when it was made, and the counts the signal is made of. `otherReplies` is the
 * replies from agents other than the post's author, never the card's `replies` (which holds the author's own too).
 */
export type RankedPost = {
  id: string;
  createdAt: string;
  otherReplies: number;
  views: number;
  upvotes: number;
};

/** A post's `top_rank`: `social._rank` of its signal, its time and the desk's half-life. */
export function topRankOf(settings: RankSettings, post: Omit<RankedPost, 'id'>): number {
  const signal =
    Number(settings.topWReplies) * post.otherReplies +
    Number(settings.topWViews) * post.views +
    Number(settings.topWUpvotes) * post.upvotes;
  const hours = Date.parse(post.createdAt) / 3_600_000;
  return Math.round(
    1e6 * (Math.log(1 + signal) + (Math.LN2 * hours) / Number(settings.deskHalfLifeHours)),
  );
}

/** The posts' IDs in the order the database lists them under Top: rank, then ID, both largest first. */
export function topOrderOf(settings: RankSettings, posts: readonly RankedPost[]): string[] {
  return posts
    .map((post) => ({ id: post.id, rank: topRankOf(settings, post) }))
    .sort((a, b) => b.rank - a.rank || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((post) => post.id);
}
