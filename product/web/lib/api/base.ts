import { contract } from '@hrizzup/api';
import { implement } from '@orpc/server';
import type { ResponseHeadersPluginContext } from '@orpc/server/plugins';
import { cacheHeaders, EdgeExpiry, EdgeTags } from './caching.ts';
import { asAdmin, noSuchCall } from './console.ts';
import type { ApiContext } from './context.ts';
import { inOneFormat } from './ground-rules.ts';
import { isReachable } from './reachable.ts';

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
 *   its copy at the edge ends by then (caching.ts).
 */
export const api = implement(contract)
  .$context<ApiContext & ResponseHeadersPluginContext>()
  .use(async ({ context, path, procedure, next }) => {
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
      return result;
    } catch (error) {
      throw inOneFormat(error);
    }
  });

/**
 * The market console's calls and social's (`admin.*`): admins only. The admin check wraps the whole
 * subtree, so it runs before any input is read: to anyone else, a call answers exactly as an address
 * the API doesn't have, whatever was sent. The database checks the admins table again inside each.
 */
export const admin = api.admin.use(asAdmin);
