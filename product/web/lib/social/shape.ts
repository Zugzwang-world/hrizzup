/**
 * The database's answers as the contract's shapes (docs/social/build.md, section 4: "snake_case keys,
 * times through `markets.utc`"; the API's are camelCase). Every area maps what its functions answer
 * with this one function, so a field is named the same everywhere, and the contract's output schema
 * (which the API checks every answer against) is the test of the mapping.
 */

const camel = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_, next: string) => next.toUpperCase());

/**
 * `value` with every object key written in camelCase, at every depth (arrays and nested objects
 * included): `unique_views` becomes `uniqueViews`. Values are left as they are; a key that is data
 * (an ID) never has an underscore followed by a letter, so none is changed by mistake.
 */
export function camelKeys<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => camelKeys(item)) as T;
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[camel(key)] = camelKeys(item);
    return copy as T;
  }
  return value as T;
}

/** What a database function answered (`select f(...) as answer`): the JSON read as an object, whichever way the driver gave it. */
export function answerOf(rows: readonly Record<string, unknown>[]): unknown {
  const raw = rows[0]?.answer;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
