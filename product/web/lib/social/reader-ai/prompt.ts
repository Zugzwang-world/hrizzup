import type { ReadingProfile } from '@hrizzup/social/reading-profile';
import { characterCount, cutText, WORD_WINDOW } from './text.ts';

/**
 * What goes to the model (docs/social/r12-design.md, section 3.3): the system prompt exactly as the note
 * writes it, and the reader's turn as one transcript message, trimmed to the call's input allowance.
 *
 * - **A transcript, not chat turns,** so a past reply can't pull the model out of JSON.
 * - **The estimate is a bound, not a count:** `ceil(utf8 bytes / 3)` a text, plus 8 a message and 16 a call.
 *   That runs about 40% over Llama 3's English rate and about one token a character for Devanagari. The target is
 *   90% of the allowance the database gave (1,800 of 2,000), so a real count stays under the reservation.
 * - **What is always sent in full:** the system prompt and the profile. The new message goes in full when it fits,
 *   else cut at a word boundary, never below 400 characters; the history fills what is left, newest first, each
 *   message cut to 400 characters, stopping at the first that doesn't fit. When the rule can't hold (a full profile
 *   in a script that costs a token a character), the call still goes out and settle records the true count.
 */

/** The system prompt. Never edited without the design note: the stub, the answer's reader and the live call all rest on its words. */
export const SYSTEM_PROMPT = `You are the reader agent in Hrizzup, a news app. You help one reader choose what they see in their For You feed. You never post anything and you never write news.

The reader's reading profile has three lists:
- "more": topics, places, people or things they want more of
- "less": topics they want less of
- "formats": the kinds of post they like: breakdowns, timelines, explainers, memes, audio briefs, infographics, translations, source checks

From the reader's new message, make small edits to the lists:
- Add or remove one item at a time. Never rewrite or empty the lists unless the reader asks.
- Keep each item short: a few words, at most 60 characters, in the reader's own words (for example "AI", "the Philippines", "cricket").
- To move an item from one list to the other, remove it from one list and add it to the other.
- Formats go only in "formats", and only the kinds named above.
- If the message asks for no change, make no edits.

Then reply to the reader in one or two short sentences, in their language, saying what you changed. Do not use markdown.

Answer with JSON only, in exactly this shape:
{"reply": "...", "edits": [{"op": "add", "list": "more", "item": "..."}]}
"op" is "add" or "remove"; "list" is "more", "less" or "formats". Use an empty "edits" list when nothing changes.

Example. Profile: {"more": [], "less": [], "formats": []}. Message: "AI news from the Philippines, mostly timelines and memes, no crypto". Answer:
{"reply": "Done: more AI and the Philippines, timelines and memes, and no crypto.", "edits": [{"op": "add", "list": "more", "item": "AI"}, {"op": "add", "list": "more", "item": "the Philippines"}, {"op": "add", "list": "formats", "item": "timelines"}, {"op": "add", "list": "formats", "item": "memes"}, {"op": "add", "list": "less", "item": "crypto"}]}`;

/** What goes to the model: chat messages in the form Workers AI's chat models take. */
export type PromptMessage = { role: 'system' | 'user'; content: string };

/** An earlier message of the chat, as `reader_chat_begin` gives it. */
export type HistoryMessage = { author: 'reader' | 'agent'; body: string };

/** The longest an earlier message may be in the prompt, and the shortest the new one is cut to. */
const HISTORY_CHARACTERS = 400;
const MESSAGE_FLOOR_CHARACTERS = 400;
/** What the prompt aims at, of the call's input allowance. */
const TARGET_SHARE = 0.9;
const PER_MESSAGE = 8;
const PER_CALL = 16;

const encoder = new TextEncoder();

/** The most tokens a text can be, whatever the script: `ceil(utf8 bytes / 3)`. */
export const estimateTokens = (text: string): number => Math.ceil(encoder.encode(text).length / 3);

/** The prompt's estimate: each message's text plus 8, plus 16 for the call. */
const estimateMessages = (messages: readonly PromptMessage[]): number =>
  messages.reduce((sum, message) => sum + estimateTokens(message.content) + PER_MESSAGE, PER_CALL);

/** The user turn: the profile, the earlier messages (when there are any) and the new one. */
function turnOf(
  profile: ReadingProfile,
  history: readonly HistoryMessage[],
  message: string,
): string {
  const parts = [
    `Profile: ${JSON.stringify({ more: profile.more, less: profile.less, formats: profile.formats })}`,
  ];
  if (history.length > 0) {
    parts.push(
      `Earlier messages, oldest first:\n${history
        .map((turn) => `${turn.author === 'reader' ? 'Reader' : 'Agent'}: ${turn.body}`)
        .join('\n')}`,
    );
  }
  parts.push(`New message:\n${message}`);
  return parts.join('\n\n');
}

/** What `buildPrompt` takes: the profile as it stands, the earlier messages (oldest first), the new message and the input allowance. */
export type PromptInput = {
  profile: ReadingProfile;
  history: readonly HistoryMessage[];
  message: string;
  maxInputTokens: number;
};

/**
 * The two messages for one call, trimmed to fit the target, and their estimate.
 * @returns the messages and `estimatedTokens`, the estimate of what they hold.
 */
export function buildPrompt(input: PromptInput): {
  messages: PromptMessage[];
  estimatedTokens: number;
} {
  const target = Math.floor(TARGET_SHARE * input.maxInputTokens);
  const system: PromptMessage = { role: 'system', content: SYSTEM_PROMPT };
  const estimate = (history: readonly HistoryMessage[], message: string) =>
    estimateMessages([system, { role: 'user', content: turnOf(input.profile, history, message) }]);

  // The new message: in full when it fits with nothing else, else the longest cut that does, never under 400 characters.
  let message = input.message;
  if (estimate([], message) > target && characterCount(message) > MESSAGE_FLOOR_CHARACTERS) {
    // A cut keeps at least max - 31 characters, so this floor keeps the message at 400 characters or more.
    let low = Math.min(characterCount(message), MESSAGE_FLOOR_CHARACTERS + WORD_WINDOW + 1);
    let high = characterCount(message);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (estimate([], cutText(message, middle)) <= target) low = middle;
      else high = middle - 1;
    }
    message = cutText(message, low);
  }

  // The history, newest first, each message cut to 400 characters; the first that doesn't fit ends it.
  const kept: HistoryMessage[] = [];
  for (const turn of [...input.history].reverse()) {
    const candidate: HistoryMessage = {
      author: turn.author,
      body: cutText(turn.body, HISTORY_CHARACTERS),
    };
    if (estimate([candidate, ...kept], message) > target) break;
    kept.unshift(candidate);
  }

  const messages: PromptMessage[] = [
    system,
    { role: 'user', content: turnOf(input.profile, kept, message) },
  ];
  return { messages, estimatedTokens: estimateMessages(messages) };
}
