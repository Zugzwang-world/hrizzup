import { noSuchCall } from '../console.ts';

/**
 * The handler of a social call whose back end isn't built yet. It is never reached: a call not live
 * answers "No such call" before any handler runs (base.ts, and the route's own router), so this is
 * only the same answer, for a call that is somehow reached, never an empty one. A relay replaces it
 * with its own handler in its area's file, and takes `live: false` off the call in the contract.
 */
export function notBuilt(): never {
  throw noSuchCall();
}
