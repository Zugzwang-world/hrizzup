import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CLAIM_TOKEN_LENGTH,
  hashClaimToken,
  hashInviteCode,
  INVITE_ALPHABET,
  inviteCodeShown,
  makeClaimToken,
  makeInvite,
  makeInviteCode,
  normaliseClaimToken,
  normaliseInviteCode,
} from './codes.ts';

/** The database's rules for an invite's first group (social.invites.code_shown). */
const SHOWN = /^hz-[0-9a-hjkmnp-tv-z]{4}$/;
const CODE = /^hz-[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

/** Independent of the code under test: the 80 bits as one big number, written in base 32. */
function base32(bytes: Uint8Array): string {
  let number = 0n;
  for (const byte of bytes) number = (number << 8n) | BigInt(byte);
  let text = '';
  for (let i = 0; i < 16; i++) {
    text = INVITE_ALPHABET[Number(number & 31n)] + text;
    number >>= 5n;
  }
  return text;
}

const bytesOf =
  (...values: number[]) =>
  () =>
    Uint8Array.from(values);
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest();

describe('the invite code alphabet', () => {
  it('is Crockford base32 without i, l, o and u: 32 different characters', () => {
    expect(INVITE_ALPHABET).toHaveLength(32);
    expect(new Set(INVITE_ALPHABET).size).toBe(32);
    for (const left of 'ilou') expect(INVITE_ALPHABET).not.toContain(left);
    expect([...INVITE_ALPHABET].every((c) => /[0-9a-hjkmnp-tv-z]/.test(c))).toBe(true);
    expect(INVITE_ALPHABET).toBe([...INVITE_ALPHABET].sort().join(''));
  });
});

describe('a new invite code', () => {
  it('is hz- and four groups of four, from the alphabet', () => {
    for (let i = 0; i < 200; i++) expect(makeInviteCode()).toMatch(CODE);
  });

  it('holds all 80 bits of its random bytes, most significant first', () => {
    const vectors = [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [0xde, 0xad, 0xbe, 0xef, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc],
      [128, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    ];
    for (const vector of vectors) {
      const code = makeInviteCode(bytesOf(...vector));
      expect(code.replaceAll('-', '').slice(2)).toBe(base32(Uint8Array.from(vector)));
    }
    expect(makeInviteCode(bytesOf(0, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('hz-0000-0000-0000-0000');
    expect(makeInviteCode(bytesOf(255, 255, 255, 255, 255, 255, 255, 255, 255, 255))).toBe(
      'hz-zzzz-zzzz-zzzz-zzzz',
    );
  });

  it('asks for 10 bytes, and refuses a source that gives fewer', () => {
    let asked = 0;
    makeInviteCode((size) => {
      asked = size;
      return new Uint8Array(size);
    });
    expect(asked).toBe(10);
    expect(() => makeInviteCode(() => new Uint8Array(9))).toThrow(/too few/);
  });

  it('never repeats in 20,000', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(makeInviteCode());
    expect(seen.size).toBe(20_000);
  });

  it('comes with its hash and the first group the console shows', () => {
    const { code, hash, shown } = makeInvite();
    expect(code).toMatch(CODE);
    expect(shown).toMatch(SHOWN);
    expect(code.startsWith(shown)).toBe(true);
    expect(hash).toHaveLength(32);
    expect(hash.equals(sha256(code))).toBe(true);
    expect(hashInviteCode(code)?.equals(hash)).toBe(true);
    expect(inviteCodeShown(code)).toBe(shown);
  });
});

describe('an invite code as typed', () => {
  const CANON = 'hz-0123-4567-89ab-cdef';

  it('reads the same however its letters, spaces and dashes are written', () => {
    for (const text of [
      CANON,
      'HZ-0123-4567-89AB-CDEF',
      'hz 0123 4567 89ab cdef',
      '  hz-0123-4567-89ab-cdef  ',
      'hz_0123_4567_89ab_cdef',
      'hz0123456789abcdef',
      'Hz-0123-4567-89aB-CdEf',
      '`hz-0123-4567-89ab-cdef`',
      '"hz-0123-4567-89ab-cdef".',
      'hz\u2010' + '0123\u20134567\u201389ab\u2013cdef',
      'hz-0123-4567-89ab-cdef\n',
      'hz\u00a00123\u00a04567\u00a089ab\u00a0cdef',
      '\uff48\uff5a-0123-4567-89ab-cdef',
    ]) {
      expect(normaliseInviteCode(text), JSON.stringify(text)).toBe(CANON);
    }
  });

  it('reads the letters the alphabet leaves out as the digits they look like', () => {
    expect(normaliseInviteCode('hz-OIL0-1111-0000-abcd')).toBe('hz-0110-1111-0000-abcd');
    expect(normaliseInviteCode('hz-oilo-iloi-loil-oilo')).toBe('hz-0110-1101-1011-0110');
  });

  it('is nothing at all when it is not a code', () => {
    for (const text of [
      '',
      'hz-0123-4567-89ab-cde', // too short
      'hz-0123-4567-89ab-cdefg', // too long
      'xx-0123-4567-89ab-cdef', // not hz
      '0123-4567-89ab-cdef', // no hz
      'hz-0123-4567-89ab-cdeu', // u isn't in the alphabet
      'hz-0123-4567-89ab-cde!!', // one character short, whatever is between
      'hz-',
      'x'.repeat(101),
      `hz-0123-4567-89ab-cdef${'-'.repeat(200)}`,
      42,
      null,
      undefined,
      { toString: () => 'hz-0123-4567-89ab-cdef' },
    ]) {
      expect(normaliseInviteCode(text), JSON.stringify(text)).toBeNull();
      expect(hashInviteCode(text)).toBeNull();
      expect(inviteCodeShown(text)).toBeNull();
    }
  });

  it('is hashed, as its canonical text, to 32 bytes: one hash for every spelling', () => {
    const hash = hashInviteCode(CANON);
    expect(hash).toHaveLength(32);
    expect(hash?.equals(sha256(CANON))).toBe(true);
    expect(hashInviteCode('HZ 0123 4567 89AB CDEF')?.equals(hash as Buffer)).toBe(true);
    expect(hashInviteCode('hz-0123-4567-89ab-cdee')?.equals(hash as Buffer)).toBe(false);
  });

  it('shows its first group', () => {
    expect(inviteCodeShown('HZ 0123 4567 89AB CDEF')).toBe('hz-0123');
    expect(inviteCodeShown(CANON)).toMatch(SHOWN);
  });
});

describe('a claim token', () => {
  it('is 43 letters and digits', () => {
    for (let i = 0; i < 200; i++) {
      const token = makeClaimToken();
      expect(token).toHaveLength(CLAIM_TOKEN_LENGTH);
      expect(token).toMatch(/^[A-Za-z0-9]{43}$/);
    }
  });

  it('takes each character from a random byte below 248, so none is likelier than another', () => {
    // 248 and up are skipped; the rest are taken modulo 62.
    const bytes = [248, 255, 250, ...Array.from({ length: 61 }, (_, i) => i)];
    let calls = 0;
    const token = makeClaimToken(() => {
      calls++;
      return Uint8Array.from(bytes);
    });
    expect(token).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq');
    expect(calls).toBe(1);
    // A source of nothing but skipped bytes never ends; one that gives no bytes is refused.
    expect(() => makeClaimToken(() => new Uint8Array(0))).toThrow(/no bytes/);
  });

  it('takes every byte of 0 to 247 modulo 62: 0 is A, 61 is 9, 62 is A again, 247 is 9', () => {
    const fill = (value: number) => () => Uint8Array.from({ length: 64 }, () => value);
    expect(makeClaimToken(fill(0))).toBe('A'.repeat(43));
    expect(makeClaimToken(fill(61))).toBe('9'.repeat(43));
    expect(makeClaimToken(fill(62))).toBe('A'.repeat(43));
    expect(makeClaimToken(fill(247))).toBe('9'.repeat(43));
  });

  it('never repeats in 20,000', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(makeClaimToken());
    expect(seen.size).toBe(20_000);
  });

  it('is trimmed and never changed in case', () => {
    const token = `Ab1${'xYz'.repeat(13)}z`;
    expect(token).toHaveLength(43);
    expect(normaliseClaimToken(token)).toBe(token);
    expect(normaliseClaimToken(`  ${token}\n`)).toBe(token);
    expect(normaliseClaimToken(token.toLowerCase())).toBe(token.toLowerCase());
    expect(hashClaimToken(token)?.equals(hashClaimToken(token.toLowerCase()) as Buffer)).toBe(
      false,
    );
  });

  it('is nothing at all when it is not one', () => {
    const token = 'a'.repeat(43);
    for (const text of [
      '',
      'a'.repeat(42),
      'a'.repeat(44),
      `${'a'.repeat(42)}-`,
      `${'a'.repeat(42)}_`,
      `${'a'.repeat(21)} ${'a'.repeat(21)}`,
      `${'a'.repeat(42)}\u00e9`,
      42,
      null,
      undefined,
    ]) {
      expect(normaliseClaimToken(text), JSON.stringify(text)).toBeNull();
      expect(hashClaimToken(text)).toBeNull();
    }
    expect(normaliseClaimToken(token)).toBe(token);
  });

  it('is hashed as its own text, to 32 bytes', () => {
    const token = `${'Qq'.repeat(21)}Q`;
    const hash = hashClaimToken(token);
    expect(hash).toHaveLength(32);
    expect(hash?.equals(sha256(token))).toBe(true);
    expect(hashClaimToken(` ${token} `)?.equals(hash as Buffer)).toBe(true);
  });
});
