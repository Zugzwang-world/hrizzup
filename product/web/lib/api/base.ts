import { contract, isSocialCall, printTimes } from '@hrizzup/api';
import { implement } from '@orpc/server';
import type { ResponseHeadersPluginContext } from '@orpc/server/plugins';
import { cacheHeaders, EdgeExpiry, EdgeTags } from './caching.ts';
import { asAdmin, noSuchCall } from './console.ts';
import type { ApiContext } from './context.ts';
import { inOneFormat } from './ground-rules.ts';
import { isReachable } from './reachable.ts';

/** The implementer's start: the contract, and the context every call is given. */
const implementer = implement(contract).$context<ApiContext & ResponseHeadersPluginContext>();

/** The middleware every call passes through: `everyCall`'s own type. */
type EveryCall = Parameters<typeof implementer.use<{ expiry: EdgeExpiry; tags: EdgeTags }>>[0];

/**
 * What every call does around its handler, in the order a call meets it (it is the first
 * middleware of every call, so a test can find it there).
 */
export const everyCall: EveryCall = async ({ context, path, procedure, next }) => {
  if (!isReachable(path, procedure)) throw noSuchCall();
  const expiry = new EdgeExpiry();
  const tags = new EdgeTags();
  try {
    const result = await next({ context: { expiry, tags } });
    for (const [name, value] of Object.entries(
      cacheHeaders(procedure['~orpc'].meta.caching, expiry.at, Date.now(), tags.list),
    )) {
      context.resHeaders?.set(name, value);
    }
    // The one place times are printed: three decimals, whichever way a package wrote them.
    return isSocialCall(path)
      ? result
      : { ...result, output: printTimes(procedure['~orpc'].outputSchema, result.output) };
  } catch (error) {
    throw inOneFormat(error);
  }
};

/**
 * The implementer every handler of the typed API is made from (the contract is in
 * product/packages/api): the market API's in router.ts, social's one file to an area
 * (`lib/api/social/<area>.ts`), so each is given the same context and the same checks.
 *
 * Every call:
 * - **is never reached when it isn't to be:** a call not live yet (`live: false`) and, where social
 *   is off (production, until launch), every social call answer exactly as an address the API
 *   doesn't have ("No such call"), before any input is read. Over HTTP the route has already turned
 *   the address away (the router it serves leaves these calls out, so its answer is the same one
 *   for them and for an address that was never there, `app/api/v1/[[...rest]]/route.ts`); this
 *   stops the website's own server code (`serverApi`), which calls in process;
 * - **gets the caching headers its contract entry asks for,** set in one place, and the tags of
 *   what it shows, told through `context.tags`;
 * - **answers a refused input in the one format** (ground-rules.ts), whoever refused it. A read
 *   that shows a market as open is told by the call, through `context.expiry`, when it closes, and
 *   its copy at the edge ends by then (caching.ts);
 * - **prints every time with three decimals** (`@hrizzup/api`'s `printTimes`), found by the call's
 *   own output schema, after the output has been checked: the website's route, the MCP server and
 *   `serverApi` all answer it. Social's calls are left as they are until social adopts it.
 */
export const api = implementer.use(everyCall);

/**
 * The market console's calls and social's (`admin.*`): admins only. The admin check wraps the whole
 * subtree, so it runs before any input is read: to anyone else, a call answers exactly as an address
 * the API doesn't have, whatever was sent. The database checks the admins table again inside each.
 */
export const admin = api.admin.use(asAdmin);
