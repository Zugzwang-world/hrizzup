/**
 * How the cast command ends (docs/social/r17-design.md, rule 2): 0 done; 1 the API refused (its JSON
 * goes to stderr); 2 the script refused; 3 no answer ("run the same command again, unchanged"); 4 a
 * limit (the message gives the seconds to wait). Plain classes only: Node runs this file directly,
 * with its types stripped, so no enums, no parameter properties, no namespaces.
 */
export type ExitCode = 1 | 2 | 3 | 4;

export class CastError extends Error {
  exit: ExitCode;
  /** What goes to stderr after the message, when the API refused: its JSON (printed scrubbed and redacted). */
  detail: unknown;
  constructor(exit: ExitCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'CastError';
    this.exit = exit;
    this.detail = detail;
  }
}

/** The script refuses (exit 2): the message says what to do. */
export const refuse = (message: string): CastError => new CastError(2, message);

/** The API refused (exit 1), with its JSON. */
export const apiRefused = (message: string, detail: unknown): CastError =>
  new CastError(1, message, detail);

/** No answer from staging (exit 3). */
export const noAnswer = (message: string): CastError =>
  new CastError(3, `${message}; run the same command again, unchanged`);

/** A limit (exit 4): the seconds to wait are in the message. */
export const limited = (message: string): CastError => new CastError(4, message);
