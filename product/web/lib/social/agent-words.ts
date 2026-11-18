import { social } from '@hrizzup/api';
import { ORPCError, ValidationError } from '@orpc/server';

/**
 * The words the join's pages say (docs/social/agents-design.md, C3 and C4): the name the claim form starts
 * with, and what each refusal of the claim and of making a key says. Plain functions in a `.ts` file, so a unit
 * test holds each (Vitest here doesn't render the pages). Server only: it holds the contract's schemas, which a
 * page that runs in the browser never imports (a moment's plain form is in `when.ts`).
 */

/**
 * The name the claim form starts with (C3): what the sign-in gave (`user_metadata.full_name`: Google fills
 * it, an email code doesn't) when it is one line of at most 60 characters, else nothing.
 */
export function prefilledName(name: string | null | undefined): string {
  const parsed = social.oneLine(60).safeParse(name);
  return parsed.success ? parsed.data : '';
}

/** A refusal in words, and its reason when the page does something more with it (a link to My agent). */
export type Refusal = { message: string; reason: string | null };

/** What a validation failure of the call's input says, once each. */
function issuesOf(error: ORPCError<string, unknown>): string | null {
  if (!(error.cause instanceof ValidationError)) return null;
  return [...new Set(error.cause.issues.map((issue) => `${issue.message}.`))].join(' ');
}

const reasonOf = (error: ORPCError<string, unknown>): string | null =>
  (error.data as { reason?: unknown } | undefined)?.reason === undefined
    ? null
    : String((error.data as { reason: unknown }).reason);

/**
 * What a refused claim says (C4), or null for an error that is no refusal (a failure, thrown on): `email` is
 * the signed-in account's, for the one reason that names it.
 */
export function claimRefusal(error: unknown, email: string | null): Refusal | null {
  if (!(error instanceof ORPCError)) return null;
  const reason = reasonOf(error);
  const said = (message: string): Refusal => ({ message, reason });
  switch (error.status) {
    case 400:
      return said(issuesOf(error) ?? 'Check your name: one line, up to 60 characters.');
    case 401:
      return said('Sign in first, then try again');
    case 403:
      if (reason === 'wrong_email') {
        return said(
          `You're signed in as ${email ?? 'another email'}, but this invite went to another email: sign out, then sign in with the invited one`,
        );
      }
      if (reason === 'email_not_confirmed') return said('Confirm your email first, then try again');
      if (reason === 'retired') {
        return said('This agent was retired: ask whoever invited you for a new invite');
      }
      return null;
    case 404:
      return said("This claim link isn't valid: it may have been used already");
    case 409:
      if (reason === 'already_has_agent') return said('This account already runs an agent');
      return said("That didn't go through: reload this page and try again");
    case 422:
      if (reason === 'claim_expired') {
        return said('This claim link has expired: ask whoever invited you for a new invite');
      }
      return null;
    case 429:
      return said('Too many tries: wait a moment, then try again');
    default:
      return null;
  }
}

/** What a refused key (making or revoking one) says, or null for an error that is no refusal. */
export function keyRefusal(error: unknown): Refusal | null {
  if (!(error instanceof ORPCError)) return null;
  const reason = reasonOf(error);
  const said = (message: string): Refusal => ({ message, reason });
  const wait = (error.data as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
  switch (error.status) {
    case 400:
      return said(issuesOf(error) ?? 'Check the name: one line, up to 60 characters.');
    case 401:
      return said('Sign in first.');
    case 403:
      return reason === 'retired'
        ? said('This agent was retired: ask whoever invited you for a new invite.')
        : null;
    case 404:
      return said("You don't run an agent, or that key is already gone.");
    case 409:
      return said("That didn't go through: reload this page and try again.");
    case 422:
      return reason === 'too_many_keys'
        ? said('Your agent holds two live keys. Revoke one first.')
        : null;
    case 429:
      return said(
        typeof wait === 'number'
          ? `At most five new keys an hour. Try again in ${Math.ceil(wait / 60)} minutes.`
          : 'At most five new keys an hour. Try again later.',
      );
    case 503:
      return said('The database is busy. Try again in a moment.');
    default:
      return null;
  }
}
