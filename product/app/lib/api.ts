import { type Api, clientContract } from '@hrizzup/api/client';
import { createORPCClient } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { QueryClient } from '@tanstack/react-query';
import { isPersonalCall } from './personal-calls.ts';

/**
 * The app's side of the typed API (PLAN.md step 1.5c): the same contract as the website
 * (product/packages/api), called over HTTP at /api/v1, through TanStack Query, which keeps
 * answers on the phone and refreshes them in the background (blueprint section 14).
 *
 * The address is built into each build (EXPO_PUBLIC_API_URL, set per build in eas.json);
 * staging's when unset. No secret is ever built into the app: anything in it can be read.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://staging.hrizzup.com/api/v1';

/** Where the signed-in session's token comes from (lib/auth/client.ts), once sign-in is set up. */
type TokenSource = () => Promise<string | null>;
let tokenSource: TokenSource | null = null;

/** Personal calls carry the session's token from now on (PLAN.md step 1.6b). */
export function sendTokensFrom(source: TokenSource): void {
  tokenSource = source;
}

// The contract's addresses only (@hrizzup/api/client): the server checks every input and answer,
// so the validators' code stays out of the app. The session's token goes with personal calls
// alone (personal-calls.ts), so public reads stay the same for everyone and Vercel's edge keeps
// serving them; it never keeps an answer to a request that carries a token.
export const api: Api = createORPCClient(
  new OpenAPILink(clientContract, {
    url: API_URL,
    headers: async (_options, path) => {
      if (!tokenSource || !isPersonalCall(path)) return {};
      const token = await tokenSource();
      return token ? { authorization: `Bearer ${token}` } : {};
    },
  }),
);

/** Query keys and options for every call, typed from the contract. */
export const orpc = createTanstackQueryUtils(api);

export const queryClient = new QueryClient({
  defaultOptions: {
    // Answers stay fresh for half a minute (the edge keeps public reads as long), then
    // refresh in the background; a failed call is tried twice more.
    queries: { staleTime: 30_000, retry: 2 },
  },
});

/**
 * Forgets every personal answer kept in memory (who's signed in, their play money…), when the
 * person signs out or someone else signs in: they're never shown to anyone else. Public answers
 * stay. oRPC's keys start with the call's path.
 */
export function forgetPersonalAnswers(): void {
  queryClient.removeQueries({
    predicate: (query) => {
      const [path] = query.queryKey;
      return !Array.isArray(path) || isPersonalCall(path as string[]);
    },
  });
}
