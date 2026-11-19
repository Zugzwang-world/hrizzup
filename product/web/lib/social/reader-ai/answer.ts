import { social } from '@hrizzup/api';
import { passesCodeChecks } from '@hrizzup/social/reading-profile';
import { characterCount, cutText } from './text.ts';

/**
 * Reading what the model answered (docs/social/r12-design.md, decision 12 and section 3.5). JSON is asked
 * for in the prompt only, so the answer is read tolerantly: the model's own JSON in an object or a string, a
 * fenced one, JSON inside other text, or plain text. **An answered call is always settled:** text that isn't
 * our JSON is kept as the reply (broken JSON never shown), and the profile stays as it was.
 *
 * - `readAnswer` reads the `result` of Cloudflare's envelope: the reply the model gave, the operations it asked
 *   (each still to be checked by `applyEdits`), the form it came in, and the usage when it is usable.
 * - `cleanReply` makes a reply fit what the database keeps as plain text, and adds the note for operations
 *   that were dropped or a profile that moved.
 */

/** How the model's answer came: its own JSON (`json`), JSON found inside other text (`json_in_text`), or plain text (`text`). */
export type AnswerForm = 'json' | 'json_in_text' | 'text';

/** Token counts, when the answer gave both as whole numbers from 0 to 1,000,000. */
export type Usage = { promptTokens: number; completionTokens: number };

/** What the model answered. `reply` is as the model wrote it (null when it said nothing usable); `edits` are as it asked. */
export type ReadAnswer = {
  form: AnswerForm;
  reply: string | null;
  edits: unknown[];
  usage: Usage | null;
};

/** What the reader is told when the model's answer was broken JSON, or had no answer at all. */
export const UNREADABLE_REPLY =
  "I couldn't read my own answer this time: try saying it another way";

const MOST_TOKENS = 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MOST_TOKENS;

/** The usage, only when both counts are whole numbers from 0 to 1,000,000: otherwise neither counts, and the call settles at its reservation. */
function usageOf(value: unknown): Usage | null {
  if (!isRecord(value)) return null;
  const { prompt_tokens: prompt, completion_tokens: completion } = value;
  if (!isCount(prompt) || !isCount(completion)) return null;
  return { promptTokens: prompt, completionTokens: completion };
}

/** The reply and operations of an object that is meant to be the model's answer: a missing or mistyped part is nothing. */
function fromObject(object: Record<string, unknown>): { reply: string | null; edits: unknown[] } {
  return {
    reply: typeof object.reply === 'string' ? object.reply : null,
    edits: Array.isArray(object.edits) ? object.edits : [],
  };
}

/** The text with a Markdown code fence around it taken off. */
function unfenced(text: string): string {
  return text
    .replace(/^```[A-Za-z]*[ \t]*\n?/u, '')
    .replace(/\n?```$/u, '')
    .trim();
}

/** A plain object parsed from JSON text, or null when it isn't one (or isn't JSON). */
function parsedObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reads the `result` of a 200 from Workers AI (`{response, usage}`):
 * 1. `response` an object: checked as `{reply, edits}`, form `json`;
 * 2. `response` a string, trimmed and unfenced: the whole as JSON (`json`), else the slice from the first `{` to
 *    the last `}` (`json_in_text`), else `text`;
 * 3. form `text`: the reply is the text, with no edits, except that text starting with `{` (broken JSON) is never
 *    shown: the reply is `UNREADABLE_REPLY`;
 * 4. `response` missing or of another kind: an answered call, form `text`, with `UNREADABLE_REPLY`.
 */
export function readAnswer(result: unknown): ReadAnswer {
  const held = isRecord(result) ? result : {};
  const usage = usageOf(held.usage);
  const response = held.response;
  if (isRecord(response)) return { form: 'json', ...fromObject(response), usage };
  if (typeof response !== 'string') {
    return { form: 'text', reply: UNREADABLE_REPLY, edits: [], usage };
  }
  const text = unfenced(response.trim());
  const whole = parsedObject(text);
  if (whole) return { form: 'json', ...fromObject(whole), usage };
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const inside = parsedObject(text.slice(first, last + 1));
    if (inside) return { form: 'json_in_text', ...fromObject(inside), usage };
  }
  return {
    form: 'text',
    reply: text.startsWith('{') ? UNREADABLE_REPLY : text,
    edits: [],
    usage,
  };
}

/** The most characters a reply holds. */
export const MAX_REPLY_CHARACTERS = 2000;

const LINE_SEPARATORS = new RegExp(
  `[${String.fromCodePoint(0x2028)}${String.fromCodePoint(0x2029)}]`,
  'gu',
);
/** Characters the agreement's code checks refuse, but for the joiner and the two variation selectors that emoji use. */
const HIDDEN = /[\p{Cf}\p{Co}\p{Cs}\p{Default_Ignorable_Code_Point}]/gu;
const KEEP = new Set([0x200d, 0xfe0e, 0xfe0f]);
const STRAY_CONTROL = /(?!\n)\p{Cc}/gu;

const DROPPED_NOTE = "(Some changes didn't fit: items are at most 60 characters, 20 a heading.)";
const STALE_NOTE =
  'Your profile changed while I was answering, so I left it as it is: tell me again if something is missing.';
const DONE_FALLBACK = 'Done: I updated your reading profile.';
const NOTHING_FALLBACK = "I didn't change anything: tell me what you'd like more or less of.";

/** What was done with the model's operations, for the words around the reply. */
export type ReplyOutcome = {
  applied: number;
  dropped: number;
  /** The profile moved under the call three times, so it was settled without the change. */
  stale?: boolean;
};

const plain = social.plainText(MAX_REPLY_CHARACTERS);
/** What the contract's `plainText(2000)` and the database's `plain_text` both accept. */
const fits = (text: string): boolean => plain.safeParse(text).success && passesCodeChecks(text);

/** A reply made fit to keep: no control or hidden characters, three new lines made two, no space at either end, 2,000 characters at most. */
function tidy(text: string): string {
  const cleaned = text
    .normalize('NFC')
    .replace(LINE_SEPARATORS, '\n')
    .replaceAll('\t', ' ')
    .replace(STRAY_CONTROL, '')
    .replace(HIDDEN, (found) => (KEEP.has(found.codePointAt(0) ?? 0) ? found : ''))
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return cutText(cleaned, MAX_REPLY_CHARACTERS);
}

/**
 * The reply the reader sees: the model's words made fit (`tidy`), or a fallback when nothing is left or what is
 * left still isn't plain text the database takes ("Done: I updated your reading profile." when operations were
 * applied, else "I didn't change anything: …"), then one note: that some operations didn't fit, or that the
 * profile changed under the call. A note that would take it past 2,000 characters is left out.
 */
export function cleanReply(reply: string | null, outcome: ReplyOutcome): string {
  const tidied = reply === null ? '' : tidy(reply);
  const fallback = outcome.applied > 0 ? DONE_FALLBACK : NOTHING_FALLBACK;
  const text = tidied !== '' && fits(tidied) ? tidied : fallback;
  const note = outcome.stale ? STALE_NOTE : outcome.dropped > 0 ? DROPPED_NOTE : null;
  if (note === null) return text;
  const joined = `${text} ${note}`;
  return characterCount(joined) <= MAX_REPLY_CHARACTERS && fits(joined) ? joined : text;
}
