import { createRunAccount, sessionFor } from '../../e2e/support/test-accounts.ts';
import { realClock } from './clock.ts';
import type { Auth, Ctx } from './context.ts';
import { CastError, refuse } from './errors.ts';
import { checkEnvironment } from './guard.ts';
import { makeOutput, redact } from './redact.ts';
import { DEFAULT_HOME, Store } from './store.ts';

/**
 * The real world for the command: this process's environment, standard streams, clock and
 * `fetch`, the store on this Mac, and staging's admin access (`stagingKeys()`, `createRunAccount`
 * and `sessionFor`, the helpers the checks use). Only built when a command runs, never for `--help`.
 */

/** Staging's admin access, or a refusal that says how to run with it. */
function stagingAuth(env: Record<string, string | undefined>): Auth {
  const keys = checkEnvironment(env);
  if (!keys) {
    throw refuse(
      "This command needs staging's keys: run it as `infra/doppler/run stg -- pnpm --silent --filter @hrizzup/web run cast …`",
    );
  }
  /** The helpers' own messages name only a status and an address of a run (never a key); they still go through `redact()`. */
  const quietly = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof CastError) throw error;
      throw refuse(redact(error instanceof Error ? error.message : 'staging refused'));
    }
  };
  return {
    createAccount: (email) =>
      quietly(async () => {
        await createRunAccount(keys, email, { existingOk: true });
      }),
    accessToken: (email) => quietly(async () => (await sessionFor(keys, email)).accessToken),
  };
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export function realContext(env: Record<string, string | undefined> = process.env): Ctx {
  return {
    store: Store.open(env.HRIZZUP_CAST_HOME || DEFAULT_HOME),
    clock: realClock,
    fetch: globalThis.fetch,
    env,
    io: realOutput,
    auth: () => stagingAuth(env),
    stdin: () => readAll(process.stdin),
    cwd: env.INIT_CWD || process.cwd(),
    memo: new Map(),
  };
}

export const realOutput = makeOutput((stream, text) => {
  (stream === 'out' ? process.stdout : process.stderr).write(text);
});
