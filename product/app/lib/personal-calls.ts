import { clientContract } from '@hrizzup/api/client';

/**
 * Whether a call of the typed API is personal (PLAN.md step 1.6b; the contract's `caching`):
 * the app sends its session's token with personal calls only, so a public read never carries one
 * and Vercel's edge keeps serving it to everyone (it never keeps an answer to a request with a
 * token). As in the contract, a call is personal unless it says it's public, so a call this copy
 * of the contract doesn't know counts as personal: never kept anywhere.
 */
export function isPersonalCall(path: readonly string[]): boolean {
  let node: unknown = clientContract;
  for (const name of path) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[name]
        : undefined;
  }
  const procedure = node as { '~orpc'?: { meta?: { caching?: { kind?: unknown } } } } | undefined;
  return procedure?.['~orpc']?.meta?.caching?.kind !== 'public';
}
