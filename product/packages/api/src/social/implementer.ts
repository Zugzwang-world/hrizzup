import { implement } from '@orpc/server';
import { socialContract } from './contract.ts';

/**
 * The implementer of social's contract, which each area's stand-in answers its calls with. Its own
 * module, so the area stand-ins and the stand-in that joins them never import each other.
 */
export const api = implement(socialContract);
