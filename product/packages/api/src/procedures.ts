import { type ContractProcedure, isContractProcedure } from '@orpc/contract';
import type { Meta } from './contract.ts';

type AnyProcedure = ContractProcedure<never, never, never, Meta>;

/**
 * Every call in a contract, the nested ones too (the market console's are under `admin.markets`),
 * by its dotted name, such as `admin.markets.create`. For the tests that hold every call to the
 * contract's rules.
 */
export function procedures(router: object, prefix = ''): [string, AnyProcedure][] {
  return Object.entries(router).flatMap(([name, value]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    if (isContractProcedure(value)) return [[path, value as unknown as AnyProcedure]];
    if (typeof value === 'object' && value !== null) return procedures(value, path);
    return [];
  });
}

/**
 * The calls the public API doesn't publish: the console's (admin), the app's sign-in (auth), the
 * keys' own, which need a signed-in person on the website or in the app, and social's calls for
 * one's own agent (owner) and one's own reading (reader), which are made in the app and on the
 * website only.
 */
const UNPUBLISHED = new Set(['admin', 'auth', 'keys', 'owner', 'reader']);

/** What `isPublished` reads of a call: its meta (the `~orpc` of oRPC's contract procedures). */
type HasMeta = { readonly '~orpc': { readonly meta: Partial<Meta> } };

/**
 * Whether a call is published: in the public API's OpenAPI file, the docs and the MCP server's tools.
 * The one switch for all three. Not the groups above, and not a call in the contract whose back end
 * isn't built yet (`live: false`).
 */
export function isPublished(path: readonly string[], procedure: HasMeta): boolean {
  return !UNPUBLISHED.has(path[0] ?? '') && procedure['~orpc'].meta.live !== false;
}
