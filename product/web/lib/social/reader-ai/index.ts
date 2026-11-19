import type { ReadingProfile } from '@hrizzup/social/reading-profile';
import type { AnswerForm, Usage } from './answer.ts';
import { classify, type Failure } from './failures.ts';
import type { PromptMessage } from './prompt.ts';
import { stubAnswer } from './stub.ts';
import { workersAi } from './workers-ai.ts';

/**
 * The reader agent's AI (docs/social/r12-design.md, section 3): one `Provider` for a call, chosen from the
 * environment and the settings the database gave at reserve time (`reader_chat_begin`'s `ai`).
 *
 * - **No token or no account ID** (`WORKERS_AI_TOKEN`, `WORKERS_AI_ACCOUNT_ID`, missing or empty, read from the
 *   `env` it is given): the stand-in (`stub.ts`), wherever that is. It uses no neurons.
 * - **Only `workers-ai` exists.** Another provider name, a model name the code won't send (a model is an
 *   admin's setting; it goes into the address, so it must look like `@cf/meta/llama-3.2-3b-instruct`) or a
 *   malformed account ID fails as `released` (503 `unavailable`) with no request made, and the log says why.
 * - **One call, no automatic retries,** a 20-second limit (`workers-ai.ts`).
 */

type Env = Readonly<Record<string, string | undefined>>;

/** What one call to the provider is given: the prompt, the output allowance, and what the stand-in reads. */
export type ProviderRequest = {
  prompt: { messages: PromptMessage[]; estimatedTokens: number };
  maxOutputTokens: number;
  /** The reader's new message and the profile it is about: only the stand-in reads them. */
  message: string;
  profile: ReadingProfile;
};

/** What the provider answered: its own reply and operations (to be checked), the form, and the usage when it gave any. */
export type ProviderAnswer = {
  provider: 'workers-ai' | 'stub';
  usage: Usage | null;
  form: AnswerForm | null;
  reply: string | null;
  edits: unknown[];
};

export type ProviderResult = { ok: true; answer: ProviderAnswer } | { ok: false; failure: Failure };

export type Provider = {
  /** What the log calls it. */
  name: string;
  run(request: ProviderRequest): Promise<ProviderResult>;
};

/** What the database's settings say (the `ai` of `reader_chat_begin`'s answer): the provider and the model. */
export type AiSettings = { provider: string; model: string };

/** How a test reaches the network and the log without either. */
export type ProviderOptions = {
  fetcher?: typeof fetch;
  log?: (line: string) => void;
  timeoutMs?: number;
};

/** A model name the code will send: an `@cf/…` or `@hf/…` name of two parts, with nothing that could change the address. */
const MODEL = /^@(cf|hf)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** An account ID as Cloudflare writes one (32 hex characters), loosely: it goes into the address. */
const ACCOUNT = /^[A-Za-z0-9_-]{1,64}$/;

/** The stand-in: deterministic, instant, with explicit zeros for usage so its neurons are 0. */
export const stubProvider: Provider = {
  name: 'stub',
  async run({ message, profile }) {
    const { reply, edits } = stubAnswer(message, profile);
    return {
      ok: true,
      answer: {
        provider: 'stub',
        usage: { promptTokens: 0, completionTokens: 0 },
        form: null,
        reply,
        edits,
      },
    };
  },
};

/** A provider that fails every call as `released` before any request, saying why in the log. */
function refused(why: string, log: (line: string) => void): Provider {
  return {
    name: 'refused',
    async run() {
      const failure = classify({ refused: true });
      log(JSON.stringify({ event: 'reader_ai', outcome: failure.kind, note: why }));
      return { ok: false, failure };
    },
  };
}

/** A name from a setting made safe to log: lower case letters, digits and hyphens, 40 at most. */
const loggable = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '?')
    .slice(0, 40);

/** The provider for one call. */
export function readerAi(env: Env, ai: AiSettings, options: ProviderOptions = {}): Provider {
  const token = env.WORKERS_AI_TOKEN?.trim();
  const accountId = env.WORKERS_AI_ACCOUNT_ID?.trim();
  if (!token || !accountId) return stubProvider;
  const log = options.log ?? ((line: string) => console.info(line));
  if (ai.provider !== 'workers-ai') {
    return refused(`unknown provider "${loggable(ai.provider)}"`, log);
  }
  if (!MODEL.test(ai.model)) return refused('a model name the code will not send', log);
  if (!ACCOUNT.test(accountId)) return refused('a malformed account ID', log);
  return workersAi({
    token,
    accountId,
    model: ai.model,
    log,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}
