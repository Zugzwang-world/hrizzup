import common from '../definitions/common.schema.json' with { type: 'json' };
import creation from '../definitions/creation.v1.schema.json' with { type: 'json' };
import lists from '../definitions/lists.schema.json' with { type: 'json' };
import market from '../definitions/market.v1.schema.json' with { type: 'json' };
import sourced from '../definitions/sourced.v1.schema.json' with { type: 'json' };
import story from '../definitions/story.v1.schema.json' with { type: 'json' };
import update from '../definitions/update.v1.schema.json' with { type: 'json' };

/** The building blocks and the shared lists, which every shape refers to. */
export const parts = [common, lists] as const;

/** One definition for each format the agreement defines, by the `format` its records carry. */
export const shapes = {
  'story/1': story,
  'update/1': update,
  'sourced/1': sourced,
  'creation/1': creation,
  'market/1': market,
} as const;

export type Format = keyof typeof shapes;

export function isFormat(value: unknown): value is Format {
  return typeof value === 'string' && Object.hasOwn(shapes, value);
}
