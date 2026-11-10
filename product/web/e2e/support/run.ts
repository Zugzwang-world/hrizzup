import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { asBrowserCookie } from './bypass.ts';
import { signedOutState } from './states.ts';
import { type Engine, type SessionCookie, type StagingKeys, sessionFor } from './test-accounts.ts';

/**
 * Each check run on its own (CLAUDE.md, "How checks behave"; Round 4, R2): every run makes its own
 * fresh staging accounts, its own test markets (unlisted, so they stay off staging's public list)
 * and anything else it stores, each carrying the run's key, so two runs at the same moment (checks
 * of two pull requests, or this Mac) never share a balance, a market or a file. Shared things, the
 * console's admin test account and the house account, are used only for the run's own markets. A
 * run's accounts are never deleted: the books keep their history.
 */

/**
 * The run's key, made once when the config loads and shared with every test process through the
 * environment: GitHub's run, its attempt and a random part (or "mac" and a random part here), in
 * lower-case letters, digits and dashes, so it fits an email address and a storage key.
 */
export function runKey(): string {
  process.env.HRIZZUP_E2E_RUN ??= [
    process.env.GITHUB_RUN_ID
      ? `gh${process.env.GITHUB_RUN_ID}a${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
      : 'mac',
    randomUUID().slice(0, 8),
  ].join('-');
  return process.env.HRIZZUP_E2E_RUN;
}

/**
 * Every run account's address starts with this, at Resend's test inbox (nothing is ever kept).
 * (This twin pull request only proves two Screen checks at once both pass; it's never merged.)
 */
export const RUN_PREFIX = 'delivered+run-';

/**
 * A run account's address: what it's for and the browser engine using it, under this run's key.
 * resend.dev addresses are Resend's own test inboxes: an email sent to one is accepted and dropped.
 */
export function runAddress(purpose: string, engine: Engine): string {
  if (!/^[a-z][a-z0-9-]{0,15}$/.test(purpose)) throw new Error(`Not a purpose: ${purpose}`);
  return `${RUN_PREFIX}${runKey()}-${purpose}-${engine}@resend.dev`;
}

/** Whether an address is one of a run's own (this run's or another's). */
export function isRunAddress(email: string): boolean {
  return email.startsWith(RUN_PREFIX) && email.endsWith('@resend.dev');
}

/**
 * The account each engine's signed-in screens and journeys share for the whole run (made by
 * global-setup.ts): it never trades, so nothing it does depends on another test.
 */
export const engineAccount = (engine: Engine) => runAddress('screens', engine);

/**
 * A request context signed in as one of the run's accounts, with the website's own session
 * cookies (and Vercel's bypass cookie on a protected preview), as a browser on the site sends them.
 */
export async function signedInContext(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  engine: Engine,
  cookies: SessionCookie[],
): Promise<APIRequestContext> {
  const signedOut = JSON.parse(await readFile(signedOutState(engine), 'utf8')) as {
    cookies: ReturnType<typeof asBrowserCookie>[];
  };
  return playwright.request.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: {
      cookies: [
        ...signedOut.cookies,
        ...cookies.map(({ name, value }) => asBrowserCookie(baseURL ?? '', name, value)),
      ],
      origins: [],
    },
  });
}

/** A new account of the run's, signed in: its address, and a request context carrying its session. */
export async function newRunTrader(
  keys: StagingKeys,
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  engine: Engine,
  purpose: string,
): Promise<{ email: string; as: APIRequestContext }> {
  // A random part too, so a retried test gets a new account, starting again at the starting balance.
  const email = runAddress(`${purpose}-${randomUUID().slice(0, 4)}`, engine);
  const session = await sessionFor(keys, email, { create: true });
  return { email, as: await signedInContext(playwright, baseURL, engine, session.cookies) };
}
