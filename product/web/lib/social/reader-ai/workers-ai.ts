import { type AnswerForm, readAnswer } from './answer.ts';
import { classify, type Failure, type Seen } from './failures.ts';
import type { Provider } from './index.ts';

/**
 * The call to Workers AI (docs/social/r12-design.md, section 3.3): one POST to Cloudflare's REST API, with the
 * prompt from `prompt.ts`, read by `answer.ts` and classified by `failures.ts`.
 *
 * - **Sent with `fetch(url, init)`,** never a `Request` (Next's patched `fetch` clones a `Request`'s body into
 *   a stream), `cache: 'no-store'`, and `signal: AbortSignal.timeout(20_000)`.
 * - **The body is read inside the same `try` as the request,** so a body that fails to arrive after a 200 is a
 *   failure that may have run (`kept`), never an unhandled error.
 * - **No `response_format`:** JSON is asked for in the prompt only (decision 12).
 * - **No automatic retries:** a retry may cost neurons, and the reader can send again.
 * - **One line a call in the log,** with no text of the reader's and no user: the outcome, the HTTP status,
 *   Cloudflare's code, the token counts, the answer's form and the milliseconds taken. The token is never logged.
 */

export type WorkersAiConfig = {
  token: string;
  accountId: string;
  model: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  log?: (line: string) => void;
};

/** How long a call may take before it is ended (then `kept`: it may have run). */
export const TIMEOUT_MS = 20_000;
/** The temperature: low, since the model answers small edits to a list. */
const TEMPERATURE = 0.2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The code of an envelope's first error, when there is one. */
function codeOf(envelope: unknown): number | null {
  if (!isRecord(envelope) || !Array.isArray(envelope.errors)) return null;
  const first: unknown = envelope.errors[0];
  return isRecord(first) && typeof first.code === 'number' ? first.code : null;
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isAbort = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error.name === 'TimeoutError' || error.name === 'AbortError');

/** The provider that calls Workers AI. */
export function workersAi(config: WorkersAiConfig): Provider {
  const fetcher = config.fetcher ?? fetch;
  const log = config.log ?? ((line: string) => console.info(line));
  const timeoutMs = config.timeoutMs ?? TIMEOUT_MS;
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`;

  return {
    name: 'workers-ai',
    async run({ prompt, maxOutputTokens }) {
      const started = Date.now();
      const line = (outcome: string, facts: Record<string, unknown>) =>
        log(
          JSON.stringify({
            event: 'reader_ai',
            provider: 'workers-ai',
            outcome,
            ...facts,
            ms: Date.now() - started,
          }),
        );
      const failed = (seen: Seen): { ok: false; failure: Failure } => {
        const failure = classify(seen);
        line(failure.kind, { status: failure.status, code: failure.code, note: failure.note });
        return { ok: false, failure };
      };

      let status: number;
      let envelope: unknown;
      try {
        const response = await fetcher(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: prompt.messages,
            max_tokens: maxOutputTokens,
            temperature: TEMPERATURE,
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });
        status = response.status;
        envelope = parsedJson(await response.text());
      } catch (error) {
        return failed(isAbort(error) ? { aborted: true } : { network: true });
      }

      const code = codeOf(envelope);
      if (status !== 200) return failed({ status, code });
      if (!isRecord(envelope)) return failed({ status, unreadable: true });
      if (envelope.success === false) return failed({ status, code, unreadable: true });
      if (!isRecord(envelope.result)) return failed({ status, unreadable: true });

      const read = readAnswer(envelope.result);
      line('answered', {
        status,
        promptTokens: read.usage?.promptTokens ?? null,
        completionTokens: read.usage?.completionTokens ?? null,
        form: read.form satisfies AnswerForm,
      });
      return {
        ok: true,
        answer: {
          provider: 'workers-ai',
          usage: read.usage,
          form: read.form,
          reply: read.reply,
          edits: read.edits,
        },
      };
    },
  };
}
