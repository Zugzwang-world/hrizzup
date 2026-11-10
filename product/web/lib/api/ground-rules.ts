import type { Issue, PageInput } from '@hrizzup/api';
import { ORPCError, ValidationError } from '@orpc/server';

/**
 * The public API's ground rules on the server (PLAN.md step 3.5a; the contract's paging.ts):
 *
 * - **Paging:** a list's `cursor` is the `next` of the page before. Today every list's cursor is the
 *   ID of the last item on that page, but a bot must treat it as opaque, so it can change within v1.
 *   One that isn't a list's own is refused as a 400 on `cursor`.
 * - **One error format:** every refused input answers 400 `BAD_REQUEST` with each problem in
 *   `data.issues`, whether the contract's validators or the call itself refused it, so a bot reads
 *   one shape everywhere.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A refused input, as every call answers one: each problem's field and what's wrong. */
export function badRequest(
  message: string,
  issues: Issue[],
  cause?: unknown,
): ORPCError<'BAD_REQUEST', { issues: Issue[] }> {
  return new ORPCError('BAD_REQUEST', {
    status: 400,
    message,
    data: { issues },
    ...(cause === undefined ? {} : { cause }),
  });
}

/** Where a page starts, and how many to it, as the books' reads take them. */
export function pageOf(input: PageInput): { after: string | undefined; limit: number | undefined } {
  const cursor = input?.cursor;
  if (cursor !== undefined && !ID.test(cursor)) {
    throw badRequest('Not a cursor from this list', [
      { path: 'cursor', message: 'Not a cursor from this list: send back the `next` it gave' },
    ]);
  }
  return { after: cursor, limit: input?.limit };
}

/** A path as a bot writes it: `source.name`, `categories.0`; empty for the whole input. */
function pathOf(path: readonly (PropertyKey | { key: PropertyKey })[] | undefined): string {
  return (path ?? []).map((part) => String(typeof part === 'object' ? part.key : part)).join('.');
}

/**
 * Any refused input in the one format: the contract's validators' issues, each with its path, or a
 * call's own words as one issue for the whole input. The validator's error stays its cause, so the
 * website's own pages can still show each problem in words.
 */
export function inOneFormat(error: unknown): unknown {
  if (!(error instanceof ORPCError) || error.code !== 'BAD_REQUEST') return error;
  if (error.cause instanceof ValidationError) {
    const issues = error.cause.issues.map((issue) => ({
      path: pathOf(issue.path),
      message: issue.message,
    }));
    const first = issues[0];
    const message = first
      ? `${first.path ? `${first.path}: ` : ''}${first.message}`
      : 'The request was refused';
    return badRequest(message, issues, error.cause);
  }
  if (inTheFormat(error.data)) return error;
  return badRequest(error.message, [{ path: '', message: error.message }], error.cause);
}

/** Whether a refusal's data is already the one format: issues, each a path and a message. */
function inTheFormat(data: unknown): boolean {
  const issues = (data as { issues?: unknown } | undefined)?.issues;
  return (
    Array.isArray(issues) &&
    issues.every(
      (issue) =>
        typeof (issue as Issue | undefined)?.path === 'string' &&
        typeof (issue as Issue | undefined)?.message === 'string',
    )
  );
}
