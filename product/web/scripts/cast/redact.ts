/**
 * Everything printed or logged passes through `redact()` (rule 4). It removes, by shape, the posting
 * keys, invite codes, claim links' tokens, signed upload addresses, JWTs, service keys and auth
 * cookies, and, by value, every secret this process has learned (`learn()`), so a secret that has
 * appeared in an answer can never be printed later in any other form. `scrub()` is the second net:
 * the fields that carry a secret are dropped from anything shown as JSON.
 */

const SHAPES: Array<[RegExp, string]> = [
  [/https?:\/\/[^\s"'<>]*X-Amz-[^\s"'<>]*/gi, '[upload link]'],
  [/X-Amz-[A-Za-z-]+=[^&\s"'<>]*/gi, '[redacted]'],
  [/hz_(?:demo|live)_[A-Za-z0-9]{4,}/g, '[posting key]'],
  [/\bhz-[0-9a-z]{4}(?:-[0-9a-z]{4})+\b/gi, '[invite code]'],
  [/\/claim\/[A-Za-z0-9_-]{16,}/g, '/claim/[redacted]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[token]'],
  [/sb_secret_[A-Za-z0-9_-]+/g, '[service key]'],
  [/\bsb-[a-z0-9]+-auth-token(?:\.\d+)?=[^\s;,"']+/gi, '[auth cookie]'],
  [/\bbase64-[A-Za-z0-9_-]{20,}/g, '[auth cookie]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer [redacted]'],
];

/** Secrets this process has seen in an answer, by value. */
const known = new Set<string>();

/** Remembers a secret's value, so it is removed wherever it turns up. Short values are ignored: they'd cut ordinary words. */
export function learn(value: unknown): void {
  if (typeof value === 'string' && value.length >= 12) known.add(value);
}

/** Forgets what was learned (for tests). */
export function forget(): void {
  known.clear();
}

export function redact(text: string): string {
  let out = text;
  for (const value of [...known].sort((a, b) => b.length - a.length)) {
    out = out.split(value).join('[redacted]');
  }
  for (const [shape, replacement] of SHAPES) out = out.replace(shape, replacement);
  return out;
}

/** The fields that carry a secret: never shown, in anything. */
export const DROPPED = new Set([
  'secret',
  'claimUrl',
  'token',
  'uploadUrl',
  'inviteCode',
  'accessToken',
  'refreshToken',
]);

/** A copy of a value without the fields that carry a secret, at any depth. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 30) return '[too deep]';
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!DROPPED.has(key)) copy[key] = scrub(item, depth + 1);
    }
    return copy;
  }
  return value;
}

/** A value as JSON for the screen: scrubbed, then redacted. */
export function show(value: unknown): string {
  return redact(JSON.stringify(scrub(value), null, 2) ?? 'null');
}

/** Where the command's words go: every byte through `redact()`. */
export type Output = {
  out(text: string): void;
  err(text: string): void;
};

/** An output whose two streams go to `write`, each line redacted first. */
export function makeOutput(write: (stream: 'out' | 'err', text: string) => void): Output {
  return {
    out: (text) => write('out', `${redact(text)}\n`),
    err: (text) => write('err', `${redact(text)}\n`),
  };
}
