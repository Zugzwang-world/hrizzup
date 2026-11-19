import { createHash } from 'node:crypto';

/**
 * Request IDs (rule 7): a UUIDv8 (version 8, variant 10) from the first 16 bytes of SHA-256 over what
 * a write sends, so any command can be run again and a retry never writes twice. `subject` is the
 * member's handle (the member's email, in `make`); `run` is the run's number (the member's *n*, in
 * `make`); the body is taken with sorted keys and without its `requestId`; `attempt` rises (3 at
 * most) only when a replay is dead.
 */

export type IdParts = {
  subject: string;
  run: number;
  method: string;
  path: string;
  body: Record<string, unknown>;
  fileSha256?: string;
  attempt: number;
};

/** JSON with every object's keys sorted, at any depth. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function requestIdFor(parts: IdParts): string {
  const { requestId: _dropped, ...body } = parts.body as Record<string, unknown>;
  const text = JSON.stringify([
    'hrizzup-cast/1',
    parts.subject,
    parts.run,
    parts.method,
    parts.path,
    canonicalJson(body),
    parts.fileSha256 ?? '',
    parts.attempt,
  ]);
  const bytes = createHash('sha256').update(text, 'utf8').digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80; // version 8
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The most attempts a request may have (the first, and two more for a dead replay). */
export const MAX_ATTEMPT = 3;
