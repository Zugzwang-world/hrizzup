import { implement, ORPCError } from '@orpc/server';
import { contract } from './contract.ts';
import * as examples from './examples.ts';

/**
 * A stand-in implementation of the whole contract that answers with the example answers
 * (examples.ts): for screens built before their back end (TRACKER.md, stages 4a and 4b), and
 * for tests. `signedIn: false` makes `me` answer as when nobody is signed in.
 */
export function standIn(options: { signedIn?: boolean } = {}) {
  const api = implement(contract);
  return api.router({
    health: api.health.handler(() => examples.health),
    me: api.me.handler(() => {
      if (options.signedIn === false) throw new ORPCError('UNAUTHORIZED');
      return examples.me;
    }),
  });
}
