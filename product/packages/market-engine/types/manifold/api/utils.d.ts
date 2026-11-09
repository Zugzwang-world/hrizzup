// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
/**
 * Hrizzup's own file, in place of Manifold's `common/src/api/utils.ts`.
 *
 * The maths needs only Manifold's error class, which its file keeps beside its API settings
 * and a 5,436-line schema. This is the same class on its own: the error carries an HTTP-style
 * code, so a caller can tell a refused trade (400) from a fault (500).
 */
export type ErrorCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;
export declare class APIError extends Error {
    code: ErrorCode;
    details?: unknown;
    constructor(code: ErrorCode, message: string, details?: unknown);
}
