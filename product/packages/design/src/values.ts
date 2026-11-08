import { bazaar } from './directions/bazaar.ts';
import { neel } from './directions/neel.ts';
import { pulse } from './directions/pulse.ts';
import type { DesignValues } from './types.ts';

/**
 * The directions on the table (step 1.4's first design pass). The design pages show each one;
 * once the founder chooses, the others are removed and the design log keeps what they were.
 */
export const directions = { neel, bazaar, pulse } as const satisfies Record<string, DesignValues>;

export type DirectionKey = keyof typeof directions;

export const directionKeys = Object.keys(directions) as DirectionKey[];

export function isDirectionKey(value: string): value is DirectionKey {
  return Object.hasOwn(directions, value);
}

/** The direction every screen uses. */
export const activeDirection: DirectionKey = 'bazaar';

/** The design values every screen on the website and in the app reads. */
export const values: DesignValues = directions[activeDirection];
