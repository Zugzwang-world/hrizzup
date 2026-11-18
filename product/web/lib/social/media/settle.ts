import { checkUpload, type Outcome, type UploadToCheck, wireOutcome } from './check.ts';
import type { Storage } from './storage.ts';

/**
 * "Say it's done", from the first transaction to the answer (docs/social/media-design.md, 7.4), shared by the
 * agent's call and the console's: **begin** (a short transaction that takes the check's lease), **the check**
 * (with no transaction open: storage and `sharp` take seconds, and a pooled connection must never wait on
 * them), **finish** (a second short transaction that writes the outcome under the lease's token), and, once
 * that has committed, the upload's deletion in the background. The caller gives the two transactions as
 * functions; this file never opens one.
 *
 * - **A request the media's kind refuses** (`vet`) releases the lease at once, before anything is read.
 * - **A fault of ours in the check** (anything the check doesn't turn into an outcome) releases the lease at
 *   once, so the upload can be checked again, and is then thrown for the caller to answer 500. A release that
 *   itself fails never hides it: the lease ends by itself after two minutes.
 * - **The upload is deleted only when the row is settled** (ready or refused, whichever check settled it), after
 *   `finish` returned, and never by a call that can reject: the bucket's one-day rule clears what a failure leaves.
 */

/** What `begin` answers: the row as it is (ready or refused), or what to check and the lease's token. */
export type BeginAnswer =
  | { step: 'answer'; media: unknown }
  | { step: 'refused'; reason: string }
  | { step: 'check'; token: string; upload: UploadToCheck };

/** What `finish` answers: the media, a refusal, a release, or `waiting` (another check holds the lease). */
export type FinishAnswer =
  | { step: 'answer'; media: unknown }
  | { step: 'refused'; reason: string }
  | { step: 'released' }
  | { step: 'waiting' };

/** What a say-it's-done comes to, for the caller to answer: `notArrived` says why a release happened. */
export type Settled =
  | { step: 'answer'; media: unknown }
  | { step: 'refused'; reason: string }
  | { step: 'released'; notArrived: boolean }
  | { step: 'waiting' };

export type SettleInput = {
  /** The first transaction. */
  begin: () => Promise<BeginAnswer>;
  /** The second transaction, with the lease's token and the check's outcome as the database takes it. */
  finish: (token: string, outcome: Record<string, unknown>) => Promise<FinishAnswer>;
  storage: Storage;
  /** Runs a promise after the answer is sent (Vercel's `waitUntil`). */
  cleanUp: (promise: Promise<unknown>) => void;
  /** The check, for a test to watch or replace. */
  check?: (storage: Storage, upload: UploadToCheck) => Promise<Outcome>;
  /**
   * A last look at what `begin` says to check, before anything is read: an error here (a rule of the request
   * that only the media's kind can decide) releases the lease at once, so the upload can be said done again,
   * and is thrown for the caller to answer.
   */
  vet?: (upload: UploadToCheck) => Error | null;
};

export async function settle(input: SettleInput): Promise<Settled> {
  const begun = await input.begin();
  if (begun.step !== 'check') return begun;

  const refusal = input.vet?.(begun.upload) ?? null;
  if (refusal !== null) {
    await input.finish(begun.token, { outcome: 'release' }).catch(() => undefined);
    throw refusal;
  }

  let outcome: Outcome;
  try {
    outcome = await (input.check ?? checkUpload)(input.storage, begun.upload);
  } catch (error) {
    // Our bug: let the upload be checked again at once rather than after two minutes.
    await input.finish(begun.token, { outcome: 'release' }).catch(() => undefined);
    throw error;
  }

  const finished = await input.finish(begun.token, wireOutcome(outcome));
  if (finished.step === 'answer' || finished.step === 'refused') {
    input.cleanUp(input.storage.removeUpload(begun.upload.upload_key));
  }
  return finished.step === 'released'
    ? {
        step: 'released',
        notArrived: outcome.outcome === 'release' && outcome.why === 'not_arrived',
      }
    : finished;
}
