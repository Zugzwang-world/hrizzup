/**
 * What a failed call to the provider means for the books and for the reader (docs/social/r12-design.md,
 * decision 6 and section 3.6). One function, `classify`, reads what was seen (an HTTP status, Cloudflare's
 * error code, a network failure, our own abort) and answers the kind of failure and what the reader is told:
 *
 * | Seen | Kind | Reader is told |
 * |---|---|---|
 * | 3036: the daily free allocation is spent | `exhausted` (released, and the day is marked) | 429 `allowance_used` |
 * | 3040 (capacity), or a 429 with no known code | `released` | 503 `busy` |
 * | 5016 (model terms), 401, 403, any other 4xx but 408, a model or provider the code won't use | `released` | 503 `unavailable` |
 * | 408 (3007, 3008), our 20-second abort | `kept` (it may have run) | 503 `too_slow` |
 * | a 5xx, a network error, an envelope that can't be read | `kept` | 503 `unavailable` |
 *
 * `released` and `exhausted` give back the reservation and the message slot (Cloudflare refused before running);
 * `kept` keeps the slot and counts the reservation as used (the model may have run).
 */

/** What the books do with the call. */
export type FailureKind = 'released' | 'exhausted' | 'kept';

/** What the reader is told: the 429's reason, or the 503's. */
export type FailureReason = 'allowance_used' | 'busy' | 'unavailable' | 'too_slow';

/** What was seen of a failed call. Any part may be missing. */
export type Seen = {
  /** The HTTP status of Cloudflare's answer. */
  status?: number | null;
  /** The code in the envelope's first error (3036, 3040, 5016...). */
  code?: number | null;
  /** The request never got an answer (the network failed). */
  network?: boolean;
  /** Our own limit (or the caller's) ended the request. */
  aborted?: boolean;
  /** A 200 whose envelope couldn't be read. */
  unreadable?: boolean;
  /** The provider's name or the model's isn't one the code will send. */
  refused?: boolean;
};

export type Failure = {
  kind: FailureKind;
  reason: FailureReason;
  status: number | null;
  code: number | null;
  /** A line for the log, with no text of the reader's and nothing personal. */
  note: string;
};

const failure = (kind: FailureKind, reason: FailureReason, seen: Seen, note: string): Failure => ({
  kind,
  reason,
  status: seen.status ?? null,
  code: seen.code ?? null,
  note,
});

/** The kind of a failure and what the reader is told (the table above, row by row). */
export function classify(seen: Seen): Failure {
  const { status, code } = seen;
  if (code === 3036) {
    return failure('exhausted', 'allowance_used', seen, 'the daily free allocation is spent');
  }
  if (code === 3040) return failure('released', 'busy', seen, 'out of capacity');
  if (code === 5016) {
    return failure('released', 'unavailable', seen, 'Llama 3.2 terms not agreed');
  }
  if (code === 3007 || code === 3008) return failure('kept', 'too_slow', seen, 'timed out');
  if (seen.refused) return failure('released', 'unavailable', seen, 'provider or model refused');
  if (seen.aborted) return failure('kept', 'too_slow', seen, 'aborted by our time limit');
  if (seen.network) return failure('kept', 'unavailable', seen, 'network error');
  if (seen.unreadable) return failure('kept', 'unavailable', seen, 'envelope not readable');
  if (status === 408) return failure('kept', 'too_slow', seen, 'status 408');
  if (status === 429) return failure('released', 'busy', seen, 'status 429');
  if (status !== null && status !== undefined) {
    if (status >= 400 && status < 500) {
      return failure('released', 'unavailable', seen, `status ${status}`);
    }
    if (status >= 500) return failure('kept', 'unavailable', seen, `status ${status}`);
  }
  return failure('kept', 'unavailable', seen, 'unknown failure');
}

/** What the reader is told of each failure, and the seconds to wait (the 429's wait is the database's). */
export const READER_WORDS: Record<
  FailureReason,
  { message: string; retryAfterSeconds: number | null }
> = {
  allowance_used: {
    message:
      "The reader agent has used today's allowance: chat pauses until 05:30 IST, and your feed keeps working",
    retryAfterSeconds: null,
  },
  busy: {
    message: 'Your reader agent is busy right now: try again in a minute',
    retryAfterSeconds: 30,
  },
  unavailable: {
    message: "Your reader agent isn't available right now: try again later",
    retryAfterSeconds: 60,
  },
  too_slow: {
    message: 'Your reader agent took too long to answer: send your message again',
    retryAfterSeconds: 5,
  },
};
