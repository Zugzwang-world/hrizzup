import { ORPCError, ValidationError } from '@orpc/server';

/**
 * What the reader agent's page says in answer to its two buttons (docs/social/r12-design.md, section 4.4): a message
 * to the agent, and a save of the reading profile. Plain functions in a `.ts` file, so a unit test holds each
 * (Vitest here doesn't render the pages; `actions.ts` is a `'use server'` file, which can export only actions).
 *
 * - **`final`** says whether the answer is definitive, so the form makes a new request ID: a 201, a 400, a 409
 *   `request_reused`, a 429 and a 503 of the agent's own are; a 409 `clash` (still being answered) and a 503 from
 *   anywhere else (a busy database) are not, so the next press is the same request again, and safe to retry. An
 *   error that is no refusal is thrown on, never turned into words: the form then keeps its request ID too.
 * - **Words are the API's own** where the API wrote them for a reader (the 429s, the agent's 503s, the profile's
 *   issues, each naming its line).
 */

/** An answer for the form: whether it went through, what to say, the issues one to a line, and whether the form takes a new request ID. */
export type Answer = { ok: boolean; message: string; issues: string[]; final: boolean };

const reasonOf = (error: ORPCError<string, unknown>): string | null => {
  const reason = (error.data as { reason?: unknown } | undefined)?.reason;
  return typeof reason === 'string' ? reason : null;
};

/** What a refused input says: each issue's words once, in the order given (the profile's issues name their lines). */
export function issueLines(error: ORPCError<string, unknown>): string[] {
  const given = (error.data as { issues?: unknown } | undefined)?.issues;
  const fromData = Array.isArray(given)
    ? given.flatMap((issue: unknown) => {
        const message = (issue as { message?: unknown } | null)?.message;
        return typeof message === 'string' ? [message] : [];
      })
    : [];
  const fromCause =
    error.cause instanceof ValidationError
      ? error.cause.issues.flatMap((issue) =>
          typeof issue.message === 'string' ? [issue.message] : [],
        )
      : [];
  return [...new Set([...fromData, ...fromCause])];
}

const said = (message: string, final: boolean, issues: string[] = []): Answer => ({
  ok: false,
  message,
  issues,
  final,
});

/** What a refused message to the agent says, or null for an error that is no refusal (thrown on). */
export function sendRefusal(error: unknown): Answer | null {
  if (!(error instanceof ORPCError)) return null;
  const reason = reasonOf(error);
  switch (error.status) {
    case 400:
      return said(
        'Your message was not sent: it must be 1 to 2,000 characters of plain text',
        true,
        issueLines(error),
      );
    case 401:
      return said('Sign in first, then try again', true);
    case 403:
      return said('This is for the account you are signed in with, not a key', true);
    case 409:
      return reason === 'clash'
        ? said(error.message, false)
        : said(
            'That message was already sent as another: reload this page, then send it again',
            true,
          );
    case 429:
      return said(error.message, true);
    case 503:
      return reason === 'busy' || reason === 'unavailable' || reason === 'too_slow'
        ? said(error.message, true)
        : said('The database is busy: press Send again in a moment', false);
    default:
      return null;
  }
}

/** What a refused save of the profile says, or null for an error that is no refusal (thrown on). */
export function saveRefusal(error: unknown): Answer | null {
  if (!(error instanceof ORPCError)) return null;
  const reason = reasonOf(error);
  switch (error.status) {
    case 400:
      return said(
        'Your profile was not saved: fix what is listed, then save again',
        true,
        issueLines(error),
      );
    case 401:
      return said('Sign in first, then try again', true);
    case 403:
      return said('This is for the account you are signed in with, not a key', true);
    case 409:
      return reason === 'request_reused'
        ? said(
            'That save was already used for another profile: reload this page, then save again',
            true,
          )
        : said("That didn't go through: reload this page and try again", true);
    case 429:
      return said('Too many tries: wait a moment, then try again', true);
    case 503:
      return said('The database is busy: press Save again in a moment', false);
    default:
      return null;
  }
}
