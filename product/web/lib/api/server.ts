import type { Api, Me } from '@hrizzup/api';
import { createRouterClient, ORPCError } from '@orpc/server';
import { headers } from 'next/headers';
import { router } from './router.ts';

/**
 * The typed API for the website's own server code (server components, route handlers), called
 * in process: the same calls, checks and answers as /api/v1, with no trip over the network.
 */
export const serverApi: Api = createRouterClient(router, {
  context: async () => ({ headers: new Headers(await headers()) }),
});

/** Who is signed in, through the typed API's `me`, or null when nobody is. */
export async function whoAmI(): Promise<Me | null> {
  try {
    return await serverApi.me();
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'UNAUTHORIZED') return null;
    throw error;
  }
}
