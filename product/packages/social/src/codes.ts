import { createHash } from 'node:crypto';

/**
 * Invite codes and claim tokens (docs/social/build.md, D3 and section 3.3). Server only: both are
 * hashed with `node:crypto`.
 *
 * - **An invite code** is `hz-xxxx-xxxx-xxxx-xxxx`: 16 characters of Crockford's base32 without
 *   i, l, o and u (so it can't be misread or spell a word), which is 80 random bits, in groups of
 *   four. It is single use, bound to an email and kept only as its SHA-256 hash, with its first group
 *   (`hz-xxxx`) to tell invites apart in the console (`social.invites.code_hash` and `code_shown`).
 * - **A claim token** is 43 letters and digits: 256 random bits, the same text as a key's, kept only
 *   as its SHA-256 hash (`social.agents.claim_hash`). Case matters: its alphabet has both cases.
 * - **One way to spell a code before it is hashed.** A person types, pastes or reads out an invite
 *   code, so capitals, spaces, dashes, underscores, quotes and stray symbols between the characters
 *   don't matter, and the letters Crockford's alphabet leaves out are read as the digits they look like
 *   (o as 0, i and l as 1). `hashInviteCode` always hashes the code's canonical text, so the code
 *   the console makes and the code an agent registers with, however it was written, give one hash.
 *   A secret is never stored, and never written in a log.
 */

/** Crockford's base32 without i, l, o and u: the database's `[0-9a-hjkmnp-tv-z]`. */
export const INVITE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const INVITE_GROUPS = 4;
const INVITE_GROUP_LENGTH = 4;
/** 16 characters of 5 bits each. */
const INVITE_RANDOM_BYTES = 10;
/** Nothing longer than this is read as a code: a code has 18 letters and digits, with room for dashes. */
const MOST_CODE_TEXT = 100;

const CLAIM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const CLAIM_TOKEN_LENGTH = 43;
const CLAIM_TOKEN = /^[A-Za-z0-9]{43}$/;

/** Where the random bytes come from: `crypto.getRandomValues` unless a test gives its own. */
export type RandomBytes = (size: number) => Uint8Array;
const systemRandom: RandomBytes = (size) => crypto.getRandomValues(new Uint8Array(size));

/** A new invite code's text, `hz-xxxx-xxxx-xxxx-xxxx`: 80 random bits. */
export function makeInviteCode(random: RandomBytes = systemRandom): string {
  const bytes = random(INVITE_RANDOM_BYTES);
  if (bytes.length !== INVITE_RANDOM_BYTES) throw new Error('The random source gave too few bytes');
  let characters = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      characters += INVITE_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  const groups: string[] = [];
  for (let i = 0; i < INVITE_GROUPS; i++) {
    groups.push(characters.slice(i * INVITE_GROUP_LENGTH, (i + 1) * INVITE_GROUP_LENGTH));
  }
  return `hz-${groups.join('-')}`;
}

/**
 * An invite code as one canonical text, `hz-xxxx-xxxx-xxxx-xxxx`, or null when it isn't a code.
 * Capitals, separators and stray symbols are dropped, and o, i and l are read as 0, 1 and 1;
 * `u` and anything else outside the alphabet make it null.
 */
export function normaliseInviteCode(text: unknown): string | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MOST_CODE_TEXT) return null;
  const squeezed = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '');
  if (!squeezed.startsWith('hz')) return null;
  const body = squeezed.slice(2).replace(/o/g, '0').replace(/[il]/g, '1');
  if (body.length !== INVITE_GROUPS * INVITE_GROUP_LENGTH) return null;
  for (const character of body) if (!INVITE_ALPHABET.includes(character)) return null;
  const groups: string[] = [];
  for (let i = 0; i < INVITE_GROUPS; i++) {
    groups.push(body.slice(i * INVITE_GROUP_LENGTH, (i + 1) * INVITE_GROUP_LENGTH));
  }
  return `hz-${groups.join('-')}`;
}

const sha256 = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();

/**
 * The SHA-256 hash of an invite code's canonical text, which is all the database keeps of it
 * (`code_hash`); null when the text isn't a code, so a registration with nonsense never costs a trip.
 */
export function hashInviteCode(text: unknown): Buffer | null {
  const code = normaliseInviteCode(text);
  return code === null ? null : sha256(code);
}

/** The first group, `hz-xxxx`, which the console shows to tell invites apart (`code_shown`). */
export function inviteCodeShown(text: unknown): string | null {
  const code = normaliseInviteCode(text);
  return code === null ? null : code.slice(0, 7);
}

/** A new invite: the code (shown once, never stored), its hash and its first group (both stored). */
export function makeInvite(random: RandomBytes = systemRandom): {
  code: string;
  hash: Buffer;
  shown: string;
} {
  const code = makeInviteCode(random);
  return { code, hash: sha256(code), shown: code.slice(0, 7) };
}

/**
 * A new claim token: 43 letters and digits, each from a random byte below 248, so every character is
 * equally likely (248 is 4 times 62: bytes from 248 up are skipped, as a key's text is made).
 */
export function makeClaimToken(random: RandomBytes = systemRandom): string {
  let token = '';
  while (token.length < CLAIM_TOKEN_LENGTH) {
    const bytes = random(64);
    if (bytes.length === 0) throw new Error('The random source gave no bytes');
    for (const byte of bytes) {
      if (byte < 248 && token.length < CLAIM_TOKEN_LENGTH) token += CLAIM_ALPHABET[byte % 62];
    }
  }
  return token;
}

/** A claim token as it is stored: the text trimmed, never changed in case; null when it isn't one. */
export function normaliseClaimToken(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const token = text.trim();
  return CLAIM_TOKEN.test(token) ? token : null;
}

/** The SHA-256 hash of a claim token (`claim_hash`); null when the text isn't a token. */
export function hashClaimToken(text: unknown): Buffer | null {
  const token = normaliseClaimToken(text);
  return token === null ? null : sha256(token);
}
