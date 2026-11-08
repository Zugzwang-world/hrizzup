import type { DesignValues } from '@hrizzup/design';
import type { BoardStory } from './examples.ts';

/**
 * The board is a masonry of story cards (PLAN.md: "a Pinterest-style discovery page"). Until
 * every browser lays out masonry natively (CSS grid lanes: only Safari so far), the board is a
 * CSS grid of thin rows, and each card spans as many rows as it's expected to be tall. Grid
 * rows grow to fit their content, so a card that turns out taller than expected pushes its
 * rows open: the layout can leave a gap, but never overlap or cut anything off. Cards stay in
 * order for screen readers, and nothing runs in the browser.
 *
 * The estimate is for a phone 390 pixels wide, the board's two lanes (the phone-first rule).
 */
export const ROW = 4;

/** Wide pictures are shown as they are; tall ones are capped at 4 by 5 on the board. */
export function pictureRatio(story: BoardStory): number | undefined {
  if (!story.picture) return undefined;
  return Math.min(story.picture.height / story.picture.width, 1.25);
}

/** The height of a picture-less card's category look, as a share of its width. */
export const artRatio = { ink: 0.62, poster: 0.5, field: 0.56 } as const;

function lines(text: string, size: number, width: number, available: number): number {
  const perLine = Math.max(8, Math.floor(available / (size * 0.48 * (width / 100))));
  // Words don't break mid-line, so a line holds a little less than its full measure.
  return Math.ceil(text.length / (perLine * 0.95));
}

/** The details row (time, updates, takes) wraps when its pieces don't fit on one line. */
function metaLines(story: BoardStory, size: number, available: number): number {
  const pieces = [10, story.updateTimes.length > 0 ? 11 : 0, story.takes > 0 ? 8 : 0]
    .filter((chars) => chars > 0)
    .map((chars) => chars * size * 0.55 + size + 4);
  let rows = 1;
  let used = 0;
  for (const piece of pieces) {
    if (used > 0 && used + 12 + piece > available) {
      rows += 1;
      used = piece;
    } else used += (used > 0 ? 12 : 0) + piece;
  }
  return rows;
}

export function rowSpan(story: BoardStory, values: DesignValues, viewport = 390): number {
  const lane = (viewport - 2 * values.space.gutter - values.space.laneGap) / 2;
  const inner = lane - 2 * values.space.cardPad - 2 * values.card.border;
  const t = values.type;
  const ratio = pictureRatio(story) ?? artRatio[values.card.art];
  const media = lane * ratio;
  const headline =
    lines(story.title, t.headline.size, t.headline.width ?? 100, inner) * t.headline.line;
  const latest = story.latest
    ? lines(story.latest, t.callout.size, t.callout.width ?? 100, inner) * t.callout.line
    : 0;
  const kicker = t.caption.line;
  const meta = t.caption.line * metaLines(story, t.caption.size, inner);
  const pulse = values.card.pulse ? 14 : 0;
  const parts = [kicker, headline, latest, pulse, meta].filter((h) => h > 0);
  const body = parts.reduce((a, b) => a + b, 0) + values.space.stack * (parts.length - 1);
  const height = media + body + 2 * values.space.cardPad + 2 * values.card.border;
  return Math.ceil((height + values.space.laneGap) / ROW);
}
