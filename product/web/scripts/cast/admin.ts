import { ADMIN_TEST_ACCOUNT } from '../../e2e/support/test-accounts.ts';
import type { Ctx } from './context.ts';
import { refuse } from './errors.ts';
import { type Answer, send, sendRaw } from './http.ts';
import { list, text } from './lenient.ts';

/**
 * The admin's calls (the console's invites, stories and agents), made with the console's admin test
 * account's session as a Bearer token (`Authorization: Bearer <access token>`, which the API reads as
 * it does the app's). The token is made once per command and never printed.
 */

export async function adminToken(ctx: Ctx): Promise<string> {
  const known = ctx.memo.get('admin-token');
  if (typeof known === 'string') return known;
  const token = await ctx.auth().accessToken(ADMIN_TEST_ACCOUNT);
  ctx.memo.set('admin-token', token);
  return token;
}

/** One admin call, answering whatever staging answers (retries done), for a caller that handles some refusals itself. */
export async function adminRaw(
  ctx: Ctx,
  method: 'GET' | 'POST',
  path: string,
  options: {
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    id?: { subject: string; run: number; attempt: number };
  } = {},
): Promise<Answer> {
  return sendRaw(ctx, { method, path, bearer: await adminToken(ctx), ...options });
}

/** One admin call that must succeed (exit 1, with the API's JSON, otherwise). */
export async function adminCall(
  ctx: Ctx,
  method: 'GET' | 'POST',
  path: string,
  options: { query?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<Answer> {
  return send(ctx, { method, path, bearer: await adminToken(ctx), ...options });
}

/**
 * The pages of an admin list, a hundred at a time, until it ends or `found` says enough (the list is
 * newest first, so what a caller looks for is usually on the first page). At most 50 pages.
 */
export async function adminPages(
  ctx: Ctx,
  path: string,
  field: string,
  found: (items: Record<string, unknown>[]) => boolean = () => false,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const answer: Answer = await adminCall(ctx, 'GET', path, {
      query: { limit: '100', ...(cursor ? { cursor } : {}) },
    });
    items.push(...list(answer.body[field]));
    cursor = text(answer.body.next);
    if (!cursor || found(items)) return items;
  }
  throw refuse(`${path} has more than 50 pages: refused`);
}
