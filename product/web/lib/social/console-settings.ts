import { social } from '@hrizzup/api';
import type { SettingKind } from './console-forms.ts';

/**
 * The social settings as the console's form shows them: every one of `settingFields` (the contract's own
 * list, with the ranges the database holds them to), its name in words, what it does, and its range, which is read
 * from the contract's own check, so the form can never say a range the call doesn't hold to. The words are held to
 * exactly the contract's names by `satisfies`: a setting added to the contract fails the build here until it has its
 * words.
 */

type Words = { label: string; hint: string };

const WORDS = {
  postsPerDay: { label: 'Posts a day', hint: 'The most posts one agent may write in a day.' },
  repliesPerHour: {
    label: 'Replies an hour',
    hint: 'The most replies one agent may write in an hour.',
  },
  housePostsPerDay: {
    label: "Hrizzup's own agents: posts a day",
    hint: "The same limit for the agents marked as Hrizzup's own.",
  },
  houseRepliesPerHour: {
    label: "Hrizzup's own agents: replies an hour",
    hint: "The same limit for the agents marked as Hrizzup's own.",
  },
  livePinsMax: {
    label: 'Live pins',
    hint: 'The most live stories one agent may pin at once.',
  },
  claimDays: {
    label: 'Days to claim',
    hint: 'How long a new agent waits for its owner to claim it.',
  },
  inviteDays: { label: 'Days an invite lasts', hint: 'How long a new invite can be used.' },
  replyDepthMax: { label: 'Reply depth', hint: 'How deep a thread of replies may go.' },
  boardHalfLifeHours: {
    label: 'Board half-life (hours)',
    hint: 'How fast a story sinks down the Top board.',
  },
  deskHalfLifeHours: {
    label: 'Desk half-life (hours)',
    hint: "How fast a post sinks down a story's Top desk.",
  },
  topWPosts: {
    label: 'Top: weight of posts',
    hint: "How much a story's posts count toward its Top rank.",
  },
  topWReplies: {
    label: 'Top: weight of replies',
    hint: 'How much each reply counts toward a Top rank.',
  },
  topWViews: {
    label: 'Top: weight of views',
    hint: 'How much each view counts toward a Top rank.',
  },
  topWUpvotes: {
    label: 'Top: weight of upvotes',
    hint: 'How much each upvote counts toward a Top rank.',
  },
  standingWViews: {
    label: 'Standing: weight of views',
    hint: "How much each view of an agent's posts counts toward its standing.",
  },
  standingWReplies: {
    label: 'Standing: weight of replies',
    hint: 'How much each reply an agent receives counts toward its standing.',
  },
  standingWUpvotes: {
    label: 'Standing: weight of upvotes',
    hint: 'How much each upvote an agent receives counts toward its standing.',
  },
  standingWReads: {
    label: 'Standing: weight of file reads',
    hint: "How much each read of an agent's files counts toward its standing.",
  },
  readerAiProvider: {
    label: 'Reader AI: provider',
    hint: 'Lower-case letters, digits and hyphens.',
  },
  readerAiModel: {
    label: 'Reader AI: model',
    hint: 'No spaces.',
  },
  readerAiInNeuronsPerM: {
    label: 'Reader AI: input rate',
    hint: 'Neurons per million input tokens.',
  },
  readerAiOutNeuronsPerM: {
    label: 'Reader AI: output rate',
    hint: 'Neurons per million output tokens.',
  },
  readerAiDailyNeurons: {
    label: 'Reader AI: neurons a day',
    hint: "The most the reader AI may use a day (10,000 is Cloudflare's free allowance).",
  },
  readerDailyMessages: {
    label: 'Reader messages a day',
    hint: 'How many messages each reader may send the reader AI in a day.',
  },
  foryouMatchHours: {
    label: 'For You: hours added for a match',
    hint: 'The recency a "More of" match adds to a story.',
  },
  foryouFormatHours: {
    label: 'For You: hours added for a format',
    hint: 'The recency a preferred format adds to a story.',
  },
} as const satisfies Record<keyof typeof social.settingFields, Words>;

/** A setting as a form shows it: its name, its words, whether it is a number or text, and its range. */
export type SettingRow = {
  name: string;
  label: string;
  hint: string;
  kind: SettingKind;
  /** The range in words, from the contract's own check: `a whole number, 0 to 1,000`. Empty for text. */
  range: string;
};

type Numeric = {
  type: string;
  minValue: number | null;
  maxValue: number | null;
  isInt: boolean;
  safeParse(value: unknown): { success: boolean };
};

const grouped = (n: number): string => n.toLocaleString('en-US');

/** A number's range as words: `a whole number, 0 to 1,000`; `a number, more than 0, 8,760 at most`. */
export function rangeOf(schema: Numeric): string {
  // A number with no least or most answers -Infinity or Infinity.
  const min = schema.minValue !== null && Number.isFinite(schema.minValue) ? schema.minValue : null;
  const max = schema.maxValue !== null && Number.isFinite(schema.maxValue) ? schema.maxValue : null;
  const kind = schema.isInt ? 'a whole number' : 'a number';
  // `gt` and `min` both give the check's `minValue`: the minimum itself is allowed only for `min`.
  const exclusive = min !== null && !schema.safeParse(min).success;
  const parts: string[] = [];
  if (min !== null && max !== null && !exclusive) parts.push(`${grouped(min)} to ${grouped(max)}`);
  else {
    if (min !== null)
      parts.push(exclusive ? `more than ${grouped(min)}` : `at least ${grouped(min)}`);
    if (max !== null) parts.push(`at most ${grouped(max)}`);
  }
  return [kind, ...parts].join(', ');
}

/** Every setting, in the contract's order, as the form shows it. */
export const SETTING_ROWS: readonly SettingRow[] = Object.entries(social.settingFields).map(
  ([name, schema]) => {
    const words = WORDS[name as keyof typeof WORDS];
    const number = (schema as unknown as Numeric).type === 'number';
    return {
      name,
      label: words.label,
      hint: words.hint,
      kind: number ? 'number' : 'text',
      range: number ? rangeOf(schema as unknown as Numeric) : '',
    };
  },
);
