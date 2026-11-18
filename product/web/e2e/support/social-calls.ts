import type { APIRequestContext, APIResponse } from '@playwright/test';
import { quietly } from './quiet-request.ts';

/**
 * The requests of R5's journeys, made so that one that throws never prints a secret (Round 6; `quiet-request.ts` says
 * why): Playwright's request context puts every header it sent (the admin's session cookies, a posting key) in the
 * message of a request that throws, and the reporters print that message into a check's public log. Every
 * request here that throws is thrown again as `METHOD /path got no answer`, and nothing else. The body of an
 * answer is read inside the same guard, since reading it can throw the same way.
 */

/** Headers that differ from one answer to the next by their nature (the time, the request's ID). */
export const PER_ANSWER = new Set([
  'date',
  'age',
  'x-vercel-id',
  'x-vercel-cache',
  'connection',
  'keep-alive',
]);

/** One request's answer: its status, its text and its headers, read as one step that fails as `METHOD /path got no answer`. */
export async function answerOf(
  method: string,
  address: string,
  run: () => Promise<APIResponse>,
): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  return quietly(method, address, async () => {
    const response = await run();
    return { status: response.status(), text: await response.text(), headers: response.headers() };
  });
}

/** A body as an object when it is JSON, else empty: the text is what is compared then. */
export function jsonOf(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export type ConsoleAnswer = {
  status: number;
  text: string;
  body: Record<string, unknown>;
  caching: string | undefined;
  headers: Record<string, string>;
};

/** One call of the typed API as the context's own session (the admin's, or a stranger's), with the answer's cache header and the headers that don't change from one answer to the next. */
export async function consoleCall(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
): Promise<ConsoleAnswer> {
  const { status, text, headers } = await answerOf(method, path, () =>
    request.fetch(path, { method, ...(data === undefined ? {} : { data }) }),
  );
  return {
    status,
    text,
    body: jsonOf(text),
    caching: headers['cache-control'],
    headers: Object.fromEntries(Object.entries(headers).filter(([name]) => !PER_ANSWER.has(name))),
  };
}
