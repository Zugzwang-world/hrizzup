/**
 * What a request's `Authorization` header carries (PLAN.md step 3.5a): nothing; the app's session
 * token (`Bearer <token>`); or a bot's API key, sent as `Bearer <key>` or, as Manifold's bots send
 * theirs, `Key <key>`. A key's prefix tells it apart from a session token: `hz_demo_` on staging,
 * previews and this Mac (`hz_live_` is kept for production's, once its API opens at launch). A
 * request that carries a key acts only as that key: never as the session cookie beside it.
 */

/** A key's text: its environment's prefix and 43 letters and digits (about 256 random bits). */
export const KEY_TEXT = /^hz_(?:demo|live)_[A-Za-z0-9]{43}$/;

export type Credential =
  | { kind: 'none' }
  | { kind: 'token'; token: string }
  | { kind: 'key'; text: string }
  /** Something sent as a key that can't be one: refused as a key that isn't valid. */
  | { kind: 'bad-key' };

export function credentialOf(headers: Headers): Credential {
  const header = headers.get('authorization');
  if (header === null) return { kind: 'none' };
  const sent = /^(Bearer|Key)\s+(\S+)\s*$/i.exec(header);
  if (!sent) return { kind: 'none' };
  const [, scheme, value] = sent as unknown as [string, string, string];
  if (value.toLowerCase().startsWith('hz_') || scheme.toLowerCase() === 'key') {
    return KEY_TEXT.test(value) ? { kind: 'key', text: value } : { kind: 'bad-key' };
  }
  return { kind: 'token', token: value };
}

/** Whether the request carries an API key, valid or not. */
export function carriesKey(headers: Headers): boolean {
  const kind = credentialOf(headers).kind;
  return kind === 'key' || kind === 'bad-key';
}
