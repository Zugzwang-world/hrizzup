/**
 * A new ID for a row or a record: a version 7 UUID (RFC 9562), in lower case. Its first 48 bits are
 * the time in milliseconds, then the version (7), then random bits, the RFC's variant (10) and more
 * random bits, so IDs sort by when they were made and a list in ID order keeps its time order.
 * Social's rows get theirs from the database (`social._uuid7()`, the column default); this is the
 * same ID made in code, for the records a page or a script makes itself, such as a market or a story
 * (docs/social/build.md, D12 and section 7.13).
 *
 * `options` are there for tests, and a caller never needs them: `now` is the clock in milliseconds
 * and `random` fills the 16 bytes in place, as `crypto.getRandomValues` does (the 74 random bits come
 * from them). They are one object, not two arguments, so passing the function to `map` can't hand
 * it an index as a clock.
 */
export function uuidv7(
  options: { now?: () => number; random?: (bytes: Uint8Array<ArrayBuffer>) => void } = {},
): string {
  const milliseconds = (options.now ?? Date.now)();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds >= 2 ** 48) {
    throw new RangeError('The time must fit in 48 bits of milliseconds');
  }
  const bytes = new Uint8Array(16);
  (options.random ?? ((b) => void crypto.getRandomValues(b)))(bytes);
  // The time, most significant byte first. Dividing and taking the remainder, because a bit shift
  // would cut a JavaScript number to 32 bits.
  let rest = milliseconds;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
