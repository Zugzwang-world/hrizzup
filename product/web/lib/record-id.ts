/**
 * A new record ID, as the hand-over agreement's records have: a version 7 UUID, in lower case,
 * whose first 48 bits are the time in milliseconds, so IDs sort by when they were made (RFC 9562).
 * The market console gives each new market one as its form opens, so sending the form twice (a
 * double click, a retry) still makes one market. It is `uuidv7()` in `@hrizzup/core`, which social's
 * code makes its IDs with too (docs/social/build.md, D12).
 */
export { uuidv7 as newRecordId } from '@hrizzup/core';
