import type { Ctx } from './context.ts';
import { apiRefused, limited, noAnswer, refuse } from './errors.ts';
import { apiUrl, skillUrl } from './guard.ts';
import { requestIdFor } from './ids.ts';
import { pace } from './pace.ts';
import { DROPPED, learn } from './redact.ts';

/**
 * Every request to staging (rules 3 to 7): the address built and asserted here, `redirect: 'error'`,
 * paced across processes, the same request (the same ID) sent again when there was no answer, and a
 * failure told as `METHOD /path template got no answer`, never with an address or a header.
 */

export type Call = {
  method: 'GET' | 'POST';
  /** Under `/api/v1`; with `root`, the skill file's own path. */
  path: string;
  query?: Record<string, string>;
  /** A posting key, sent as `Authorization: Bearer`. Public reads send none. */
  key?: string;
  /** A session's access token, sent the same way. */
  bearer?: string;
  body?: Record<string, unknown>;
  /** What the request ID is made from. None: the call takes no request ID (a preview, a revocation, a story's save). */
  id?: { subject: string; run: number; fileSha256?: string; attempt: number };
  root?: boolean;
};

export type Answer = {
  status: number;
  ok: boolean;
  body: Record<string, unknown>;
  text: string;
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** A path as a name for messages: ids become `{uuid}`, a handle `{handle}`; never a query. */
export function templateOf(path: string): string {
  return path.replace(UUID, '{uuid}').replace(/(\/agents\/)[a-z][a-z0-9_]*/, '$1{handle}');
}

const TRANSIENT = new Set([502, 503, 504]);
const WAITS_MS = [2_000, 8_000, 30_000];
/** Limits that need hours, not seconds: the day's posts and uploads, the hour's replies. */
const SLOW_REASONS = new Set(['posts_per_day', 'replies_per_hour', 'uploads_per_day']);
const LONG_WAIT_S = 120;
const OTHER_429_WAITS = 3;
const MEDIA_CHECKING_WAITS = 3;

/** Remembers every secret an answer carries, so it is removed from anything printed later. */
function learnSecrets(value: unknown, depth = 0): void {
  if (depth > 6 || typeof value !== 'object' || value === null) return;
  for (const [name, item] of Object.entries(value)) {
    if (typeof item === 'string' && DROPPED.has(name)) {
      learn(item);
      if (name === 'claimUrl') learn(item.split('/').at(-1));
    } else {
      learnSecrets(item, depth + 1);
    }
  }
}

function jsonOf(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function retryAfterOf(response: Response, body: Record<string, unknown>): number | null {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  const data = body.data as { retryAfterSeconds?: unknown } | undefined;
  const given = Number(data?.retryAfterSeconds);
  return Number.isFinite(given) && given > 0 ? Math.ceil(given) : null;
}

export const reasonOf = (body: Record<string, unknown>): string | undefined => {
  const data = body.data as { reason?: unknown } | undefined;
  return typeof data?.reason === 'string' ? data.reason : undefined;
};

/** Sends one request (resending it as rule 6 says) and answers whatever staging answered once the retries are done. */
export async function sendRaw(ctx: Ctx, call: Call): Promise<Answer> {
  const url = call.root ? skillUrl() : apiUrl(call.path, call.query);
  const label = `${call.method} ${call.root ? call.path : templateOf(call.path)}`;
  const headers: Record<string, string> = {
    accept: call.root ? 'text/markdown, */*' : 'application/json',
  };
  const secretToken = call.key ?? call.bearer;
  if (call.key !== undefined && call.bearer !== undefined) {
    throw refuse('A request carries one credential, never two');
  }
  if (secretToken !== undefined) {
    headers.authorization = `Bearer ${secretToken}`;
    learn(secretToken);
  }
  let payload: string | undefined;
  if (call.body !== undefined || call.id !== undefined) {
    const body: Record<string, unknown> = { ...(call.body ?? {}) };
    if ('requestId' in body) throw refuse('A body holding requestId is refused: the cast makes it');
    if (call.id) {
      body.requestId = requestIdFor({
        subject: call.id.subject,
        run: call.id.run,
        method: call.method,
        path: call.path,
        body,
        attempt: call.id.attempt,
        ...(call.id.fileSha256 === undefined ? {} : { fileSha256: call.id.fileSha256 }),
      });
    }
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }

  let silent = 0;
  let rateWaits = 0;
  let checkingWaits = 0;
  for (;;) {
    await pace(ctx.store, ctx.clock);
    let response: Response;
    let text: string;
    try {
      response = await ctx.fetch(url, {
        method: call.method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        ...(payload === undefined ? {} : { body: payload }),
      });
      text = await response.text();
    } catch (error) {
      const cause = String(
        (error as { cause?: { message?: unknown } } | null)?.cause?.message ?? '',
      );
      if (/redirect/i.test(cause)) throw refuse(`${label} was redirected: refused`);
      const waited = WAITS_MS[silent];
      if (waited === undefined) throw noAnswer(`${label} got no answer`);
      silent++;
      await ctx.clock.sleep(waited);
      continue;
    }
    if (response.status >= 300 && response.status < 400) {
      throw refuse(`${label} was redirected: refused`);
    }
    if (TRANSIENT.has(response.status)) {
      const waited = WAITS_MS[silent];
      if (waited === undefined) throw noAnswer(`${label} got no answer`);
      silent++;
      await ctx.clock.sleep(waited);
      continue;
    }
    const body = jsonOf(text);
    learnSecrets(body);
    if (response.status === 429) {
      const seconds = retryAfterOf(response, body);
      const reason = reasonOf(body);
      if ((reason !== undefined && SLOW_REASONS.has(reason)) || (seconds ?? 0) > LONG_WAIT_S) {
        throw limited(
          `${label} hit a limit${reason ? ` (${reason})` : ''}: wait ${seconds ?? 3600} seconds`,
        );
      }
      if (rateWaits >= OTHER_429_WAITS) {
        throw limited(`${label} keeps hitting a limit: wait ${seconds ?? 60} seconds`);
      }
      rateWaits++;
      await ctx.clock.sleep((seconds ?? 60) * 1000);
      continue;
    }
    if (
      response.status === 409 &&
      reasonOf(body) === 'media_checking' &&
      checkingWaits < MEDIA_CHECKING_WAITS
    ) {
      checkingWaits++;
      await ctx.clock.sleep(60_000);
      continue;
    }
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      body,
      text,
    };
  }
}

/** The same, refusing (exit 1, with the API's JSON for stderr) on any answer that isn't a success. */
export async function send(ctx: Ctx, call: Call): Promise<Answer> {
  const answer = await sendRaw(ctx, call);
  if (!answer.ok) throw refusedBy(call, answer);
  return answer;
}

export function refusedBy(call: Call, answer: Answer) {
  const reason = reasonOf(answer.body);
  const label = call.root ? call.path : templateOf(call.path);
  return apiRefused(
    `${call.method} ${label} was refused (${answer.status}${reason ? ` ${reason}` : ''})`,
    Object.keys(answer.body).length > 0 ? answer.body : { status: answer.status },
  );
}
