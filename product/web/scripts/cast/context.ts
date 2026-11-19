import type { Clock } from './clock.ts';
import type { Output } from './redact.ts';
import type { Store } from './store.ts';

/** Staging's admin access, for the accounts and the one-time sign-in: only the commands marked D use it. */
export type Auth = {
  /** Makes the member's account if it is missing (an existing one counts as done). */
  createAccount(email: string): Promise<void>;
  /** A session's access token for the account, sent as a Bearer token and never printed. */
  accessToken(email: string): Promise<string>;
};

/** Everything a command needs from outside, injected so a test has no network, no real store and no real clock. */
export type Ctx = {
  store: Store;
  clock: Clock;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  io: Output;
  /** Staging's admin access; refuses (exit 2) when this run has no staging keys. */
  auth: () => Auth;
  /** Standard input, read whole (a body given as `-`). */
  stdin: () => Promise<string>;
  /** Where relative file names are taken from (`INIT_CWD`: pnpm runs the script in the website's folder). */
  cwd: string;
  /** Per-command memory: the admin's session, made once. */
  memo: Map<string, unknown>;
};
