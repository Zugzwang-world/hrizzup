import { describe, expect, it } from 'vitest';
import { carriesKey, credentialOf } from './credential.ts';

// Made-up keys, never real ones: the prefix and 43 letters and digits.
const KEY = `hz_demo_${'a'.repeat(43)}`;
const LIVE = `hz_live_${'B1'.repeat(21)}C`;

const headers = (authorization?: string) =>
  new Headers(authorization === undefined ? {} : { authorization });

describe("what a request's Authorization header carries", () => {
  it('nothing, or a scheme that is neither Bearer nor Key', () => {
    expect(credentialOf(headers())).toEqual({ kind: 'none' });
    expect(credentialOf(headers('Basic dXNlcjpwYXNz'))).toEqual({ kind: 'none' });
    expect(credentialOf(headers('Bearer'))).toEqual({ kind: 'none' });
  });

  it("the app's session token, sent as Bearer", () => {
    expect(credentialOf(headers('Bearer eyJhbGciOi.payload.sig'))).toEqual({
      kind: 'token',
      token: 'eyJhbGciOi.payload.sig',
    });
  });

  it("a bot's key, sent as Bearer or as Manifold's Key, either scheme in any case", () => {
    for (const sent of [`Bearer ${KEY}`, `Key ${KEY}`, `bearer ${KEY}`, `KEY ${KEY}  `]) {
      expect(credentialOf(headers(sent)), sent).toEqual({ kind: 'key', text: KEY });
    }
    expect(credentialOf(headers(`Bearer ${LIVE}`))).toEqual({ kind: 'key', text: LIVE });
  });

  it('something sent as a key that cannot be one: too short, too long, other characters, or a token after Key', () => {
    for (const sent of [
      `Bearer ${KEY.slice(0, -1)}`,
      `Bearer ${KEY}a`,
      `Bearer ${KEY.slice(0, -1)}-`,
      `Bearer hz_prod_${'a'.repeat(43)}`,
      `Bearer HZ_DEMO_${'a'.repeat(43)}`,
      'Key eyJhbGciOi.payload.sig',
    ]) {
      expect(credentialOf(headers(sent)), sent).toEqual({ kind: 'bad-key' });
      expect(carriesKey(headers(sent))).toBe(true);
    }
    expect(carriesKey(headers('Bearer eyJhbGciOi.payload.sig'))).toBe(false);
  });
});
