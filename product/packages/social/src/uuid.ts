/** A UUID in lower case, as every ID social hands out is written. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** The ID itself, or a TypeError saying what was meant: nothing but an ID goes into a tag or a key. */
export function idOrThrow(value: unknown, what: string): string {
  if (!isUuid(value)) throw new TypeError(`${what} must be a UUID in lower case`);
  return value;
}
