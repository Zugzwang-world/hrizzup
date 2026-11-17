import { isSocialCall, type Meta } from '@hrizzup/api';
import { type AnyRouter, isProcedure } from '@orpc/server';
import { socialEnabled } from '@/lib/env.ts';

/** What the route reads of a call: its place in the router, and its meta. */
type Call = { readonly '~orpc': { readonly meta: Partial<Meta> } };

/**
 * A copy of the router with only the calls `keep` says yes to, each group a fresh object (so the
 * copy carries nothing of the original's: oRPC matches addresses from the copy alone). A call left
 * out has no address in the copy, so the route's handler answers a request for it exactly as it
 * answers any address the API doesn't have: it is unmatched, and no body is read, no input is
 * checked, no handler is reached.
 */
export function reachable(
  router: object,
  keep: (path: readonly string[], call: Call) => boolean,
  path: readonly string[] = [],
): AnyRouter {
  const copy: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(router)) {
    const here = [...path, name];
    if (isProcedure(value)) {
      if (keep(here, value as unknown as Call)) copy[name] = value;
    } else if (typeof value === 'object' && value !== null) {
      const group = reachable(value, keep, here);
      if (Object.keys(group).length > 0) copy[name] = group;
    }
  }
  return copy as AnyRouter;
}

/**
 * Whether a call may be reached: it is live (its back end is built, not `live: false`), and, where
 * social is off (production, until launch, D14), it isn't one of social's. One rule for the route's
 * router, which leaves the others out, and for the calls the website makes in process (base.ts).
 */
export function isReachable(
  path: readonly string[],
  call: Call,
  socialIsOn: boolean = socialEnabled(),
): boolean {
  return call['~orpc'].meta.live !== false && (socialIsOn || !isSocialCall(path));
}
