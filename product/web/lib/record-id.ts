/**
 * A new record ID, as the hand-over agreement's records have: a version 7 UUID, in lower case,
 * whose first 48 bits are the time in milliseconds, so IDs sort by when they were made (RFC 9562).
 * The market console gives each new market one as its form opens, so sending the form twice (a
 * double click, a retry) still makes one market.
 */
export function newRecordId(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const time = Date.now().toString(16).padStart(12, '0');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
