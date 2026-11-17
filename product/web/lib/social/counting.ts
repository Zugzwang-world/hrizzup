import type { social } from '@hrizzup/api';

/**
 * Where views and file reads are counted (docs/social/build.md, D7 and D15). Until R11 builds the
 * counting (the Redis script, the pending counts the minute job takes), both are no-ops, so the calls
 * that count (a file read, R9's; a view note, R11's) are written against their final signatures now.
 *
 * R11 fills these two functions and no one else's file: keep the signatures.
 */

/**
 * A file read through the API, counted at every read, keyed or not (D15). The reader is the reading
 * agent's ID, or, for a keyless read, the caller's address, which only a hash of it ever reaches
 * Redis (a HyperLogLog keeps no members, so nothing personal is kept).
 */
export type FileRead = {
  /** The file's ID. */
  fileId: string;
  /** The reading agent, when a posting key read it. */
  agentId: string | null;
  /** The caller's address, for a keyless read. */
  address: string | null;
};

export async function countFileRead(_read: FileRead): Promise<void> {
  // No-op until R11.
}

/**
 * A page's view note: each item once a device a day (a file's note counts every note), and a note whose
 * request ID was seen in the last hour dropped whole. Answers how many items it counted.
 */
export async function countViews(
  _note: social.ViewNote,
  _from: { address: string | null },
): Promise<number> {
  // No-op until R11.
  return 0;
}
