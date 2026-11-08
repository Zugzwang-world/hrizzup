import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Where each browser engine's saved sign-in states live for one run of the checks: a fresh
 * folder outside the repository, named when the config first loads and shared with every test
 * process through the environment; global-setup.ts makes it. The states hold the deployment's
 * bypass cookie and the test accounts' sessions, so they are never uploaded, and
 * global-teardown.ts deletes them when the run ends.
 */
export function statesFolder(): string {
  process.env.HRIZZUP_E2E_STATES ??= join(tmpdir(), `hrizzup-e2e-${randomUUID()}`);
  return process.env.HRIZZUP_E2E_STATES;
}

/** Signed out: only the bypass cookie, when the address is a protected deployment. */
export const signedOutState = (engine: string) => join(statesFolder(), `${engine}-signed-out.json`);

/** Signed in as the engine's test account (support/test-accounts.ts), outside production. */
export const signedInState = (engine: string) => join(statesFolder(), `${engine}-signed-in.json`);
