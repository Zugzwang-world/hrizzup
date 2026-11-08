/**
 * Hrizzup's own file, in place of Manifold's `common/src/api/utils.ts`.
 *
 * The maths needs only Manifold's error class, which its file keeps beside its API settings
 * and a 5,436-line schema. This is the same class on its own: the error carries an HTTP-style
 * code, so a caller can tell a refused trade (400) from a fault (500).
 */
export type ErrorCode =
  | 400 // The request is wrong (a bad amount, a market that can't be traded)
  | 401 // Not signed in
  | 403 // Not allowed
  | 404 // Not found
  | 409 // Conflicts with the current state
  | 429 // Too many requests
  | 500 // A fault on our side
  | 503; // Too busy to handle the request

export class APIError extends Error {
  code: ErrorCode;
  details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.name = 'APIError';
    this.details = details;
  }
}
