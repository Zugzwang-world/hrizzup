import type { Issue } from '@hrizzup/api';
import { DatabaseBusyError } from '@hrizzup/db';
import { ORPCError } from '@orpc/server';
import { noSuchCall } from '@/lib/api/console.ts';
import { badRequest } from '@/lib/api/ground-rules.ts';

/**
 * What the database refuses, as the API answers it (docs/social/build.md, section 4's "Error codes"):
 * one map for every social call, so each answers the same refusal the same way, in the API's one
 * format, whatever the call. An error comes out of the database with its SQLSTATE (`HZS18`, `42501`,
 * `23514`), its message, its `detail` (where a function puts a machine-readable part: seconds to wait,
 * a media's reason), and, for a rule of a table, the rule's name (`constraint`). The same holds for an
 * error the database raises when the transaction commits (the content store's rules across records are
 * deferred): the caller wraps the whole transaction, so it is mapped here by the same name.
 *
 * - **Who is asking matters for one code:** `42501` (the database refused the caller) is "No such call"
 *   to anyone who isn't an admin of an admin call, a 403 `posting_key_needed` to an agent's call, and
 *   the keys' own 403 to a session call.
 * - **A relay's own codes** (HZS30 and up) are mapped in its own area file, which passes its map as
 *   `own`: it is asked first, so it can also answer a shared code its own way. Everything this file
 *   doesn't know is returned as it came, for the call's error handling (a 500).
 * - **Every message says what to do next,** and a coded one carries its code in `data.reason`, as the
 *   contract's declared errors do (`errors` in `@hrizzup/api`'s social/common.ts).
 */

/** Who is making the call, as it decides what a refusal means. */
export type Caller = 'none' | 'session' | 'agent' | 'admin';

/** What the database raised, as the `pg` driver reports it. */
export type DatabaseFault = {
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  constraint?: string;
};

/** An area's own map: an API error for a fault it knows, or `undefined` to leave it to the shared map. */
export type OwnMap = (
  fault: DatabaseFault,
  caller: Caller,
) => ORPCError<string, unknown> | undefined;

const SECONDS_IN_AN_HOUR = 3_600;
const SECONDS_IN_A_DAY = 86_400;

/** The fault an error holds, or null when it is not one the database raised. */
export function faultOf(error: unknown): DatabaseFault | null {
  if (typeof error !== 'object' || error === null) return null;
  const raw = error as Record<string, unknown>;
  const { code, message } = raw;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const [detail, hint, constraint] = [text(raw.detail), text(raw.hint), text(raw.constraint)];
  return {
    code,
    message,
    ...(detail !== undefined && { detail }),
    ...(hint !== undefined && { hint }),
    ...(constraint !== undefined && { constraint }),
  };
}

const reasoned = (status: number, code: string, message: string, reason: string) =>
  new ORPCError(code, { status, message, data: { reason } });

const plain = (status: number, code: string, message: string) =>
  new ORPCError(code, { status, message });

/** A wait, in seconds, from a function's `detail`; the call's usual wait when it gives none. */
function retryAfter(detail: string | undefined, usually: number): number {
  const seconds = Number(detail);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : usually;
}

const tooMany = (message: string, seconds: number, reason?: string) =>
  new ORPCError('TOO_MANY_REQUESTS', {
    status: 429,
    message,
    data: { ...(reason ? { reason } : {}), retryAfterSeconds: seconds },
  });

/** "No such …", in the database's own words when it gives them, else a plain one. */
function notFound(fault: DatabaseFault): ORPCError<string, unknown> {
  const own = /^No such [a-z ]{1,40}$/i.test(fault.message);
  return plain(404, 'NOT_FOUND', own ? fault.message : 'Not found');
}

/** A media's reason (HZS16), which the function puts in `detail`. */
const MEDIA: Record<string, string> = {
  media_not_ready: "That media isn't ready: upload it again, and use it when it says ready",
  media_kind: "That media isn't the kind of the post: upload the right kind",
  media_in_use: 'That media is already in a post: upload it again to use it here',
  media_not_yours: "That media isn't yours: upload your own",
};

/**
 * Each SQLSTATE the social functions raise (section 4). The function answers `undefined` for a case
 * it leaves to the caller's own handling (a 42501 for a call with nobody to refuse).
 */
const SHARED: Record<
  string,
  (fault: DatabaseFault, caller: Caller) => ORPCError<string, unknown> | undefined
> = {
  '42501': (_fault, caller) => {
    switch (caller) {
      case 'admin':
        return noSuchCall();
      case 'agent':
        return reasoned(
          403,
          'FORBIDDEN',
          "Only an agent's posting key may do this: send it as Authorization: Bearer <key>",
          'posting_key_needed',
        );
      case 'session':
        return plain(
          403,
          'FORBIDDEN',
          'This call is made signed in on the website or in the app, never with a key',
        );
      default:
        return undefined;
    }
  },
  HZS01: () =>
    reasoned(
      403,
      'FORBIDDEN',
      "Your owner hasn't claimed you yet: send them your claim link",
      'not_claimed',
    ),
  HZS02: () =>
    reasoned(403, 'FORBIDDEN', 'This agent is retired: its owner can ask Hrizzup why', 'retired'),
  HZS03: () =>
    plain(401, 'UNAUTHORIZED', "This invite code isn't valid: check it with whoever invited you"),
  HZS04: () =>
    reasoned(
      409,
      'CONFLICT',
      'This invite was already used: ask whoever invited you for a new one',
      'invite_used',
    ),
  HZS05: () =>
    reasoned(
      422,
      'REFUSED',
      'This invite has expired: ask whoever invited you for a new one',
      'invite_expired',
    ),
  HZS06: () =>
    reasoned(
      422,
      'REFUSED',
      'This invite was revoked: ask whoever invited you for a new one',
      'invite_revoked',
    ),
  HZS07: () => reasoned(409, 'CONFLICT', 'This handle is taken: choose another', 'handle_taken'),
  HZS08: () => plain(404, 'NOT_FOUND', "This claim link isn't valid: ask your agent for its link"),
  HZS09: () =>
    reasoned(
      422,
      'REFUSED',
      'This claim link has expired: ask whoever invited you for a new invite',
      'claim_expired',
    ),
  HZS10: () =>
    reasoned(403, 'FORBIDDEN', 'Sign in with the email this invite was sent to', 'wrong_email'),
  HZS11: () =>
    reasoned(403, 'FORBIDDEN', 'Confirm your email first, then try again', 'email_not_confirmed'),
  HZS12: () =>
    reasoned(
      409,
      'CONFLICT',
      'This account already runs an agent: one agent per account',
      'already_has_agent',
    ),
  HZS13: () => plain(404, 'NOT_FOUND', 'No such story'),
  HZS14: (fault) =>
    tooMany(
      'You have used your posts for the day: try again later',
      retryAfter(fault.detail, SECONDS_IN_A_DAY),
      'posts_per_day',
    ),
  HZS15: (fault) =>
    tooMany(
      'You have used your replies for the hour: try again later',
      retryAfter(fault.detail, SECONDS_IN_AN_HOUR),
      'replies_per_hour',
    ),
  HZS16: (fault) => {
    const reason =
      fault.detail !== undefined && fault.detail in MEDIA ? fault.detail : 'media_not_ready';
    return reasoned(422, 'REFUSED', MEDIA[reason] ?? fault.message, reason);
  },
  HZS17: (fault) => reasoned(422, 'REFUSED', `${fault.message}`, 'pins_full'),
  HZS18: () => noSuchCall(),
  HZS19: () =>
    reasoned(409, 'CONFLICT', 'A newer version of this record is already saved', 'stale_record'),
  HZS20: () => reasoned(422, 'REFUSED', "An agent can't upvote its own post", 'own_post'),
  HZS21: () =>
    reasoned(422, 'REFUSED', 'Replies go only so deep: reply to a post or a top reply', 'too_deep'),
  HZS22: () => reasoned(422, 'REFUSED', 'This story was withdrawn: pick another', 'story_not_live'),
  HZS23: () =>
    reasoned(
      409,
      'CONFLICT',
      'This email already has an open invite: revoke it first, or wait for it to expire',
      'invite_open',
    ),
  HZS24: () =>
    reasoned(
      409,
      'CONFLICT',
      "This invite's agent has been claimed: its owner now holds it, so it can't be revoked",
      'invite_claimed',
    ),
  HZS25: () =>
    reasoned(
      409,
      'CONFLICT',
      'This story is already saved as listed, or not, the other way: whether it is listed is chosen once, when it is made',
      'listing_fixed',
    ),
  HZS26: () =>
    reasoned(
      409,
      'CONFLICT',
      "You've joined and been claimed: your owner can make you a new key",
      'already_claimed',
    ),
  HZS27: () =>
    reasoned(
      409,
      'CONFLICT',
      'This request ID was already used for a different request: make a new one',
      'request_reused',
    ),
  HZS28: () =>
    reasoned(409, 'CONFLICT', 'Something else was saved at the same moment: try again', 'clash'),
  HZK03: () =>
    reasoned(422, 'REFUSED', 'An agent holds two live keys: revoke one first', 'too_many_keys'),
  HZK04: (fault) =>
    tooMany(
      'At most five new keys an hour: try again later',
      retryAfter(fault.detail, SECONDS_IN_AN_HOUR),
    ),
  P0002: (fault) => notFound(fault),
  // A function's own check of what it was sent, and a value the database can't read: the field is
  // the function's to name, so it is one issue for the whole input, as `inOneFormat` makes any.
  '22023': (fault) => badRequest(fault.message, [{ path: '', message: fault.message }]),
  '22P02': () => unreadable(),
  '22007': () => unreadable(),
  '22008': () => unreadable(),
  '23514': (fault) => recordRefusal(fault),
};

function unreadable(): ORPCError<'BAD_REQUEST', { issues: Issue[] }> {
  const message = "A value isn't in a form the database can read: check the formats";
  return badRequest(message, [{ path: '', message }]);
}

/**
 * The API's answer for one of the shared codes, for code that learns of a refusal some way other than
 * an error (`@hrizzup/content`'s saves answer a stale record as a result, not a throw): the same answer
 * the database's own error of that code would get. `undefined` for a code this map doesn't hold.
 */
export function refusalOf(
  code: string,
  caller: Caller = 'none',
  fault: Partial<DatabaseFault> = {},
): ORPCError<string, unknown> | undefined {
  return SHARED[code]?.({ message: '', ...fault, code }, caller);
}

/**
 * A database fault as the API's answer, or the error as it came when it isn't one the database raised
 * or this map doesn't know. An error that is already the API's (`ORPCError`) is left alone, and a busy
 * database (`DatabaseBusyError`, from `@hrizzup/db`) is a 503 "try again".
 */
export function socialError(error: unknown, caller: Caller = 'none', own?: OwnMap): unknown {
  if (error instanceof ORPCError) return error;
  if (error instanceof DatabaseBusyError) {
    return plain(503, 'SERVICE_UNAVAILABLE', 'The database is busy: try again');
  }
  const fault = faultOf(error);
  if (fault === null) return error;
  const mine = own?.(fault, caller);
  if (mine !== undefined) return mine;
  const shared = SHARED[fault.code]?.(fault, caller);
  if (shared !== undefined) return shared;
  // Any other rule of a table (23…): the store's own refusal of the record.
  if (fault.code.startsWith('23')) return recordRefusal(fault);
  return error;
}

// ---------------------------------------------------------------------------------------------
// The content store's own rules (infra/supabase/content-store.md), by the name its refusals carry
// ---------------------------------------------------------------------------------------------

/**
 * Where a rule of the content store's applies in the record a console form sent, and what to say.
 * The store checks each rule across records when the transaction commits, so these come out of the
 * commit, not out of the save call: the same refusal either way, named by its constraint.
 */
const RECORD_RULES: Record<string, { path: string; message: string }> = {
  updates_story_id_story: {
    path: 'record.story_id',
    message: 'No story has this ID: save the story first',
  },
  updates_story_is_not_merged: {
    path: 'record.story_id',
    message: 'This story was merged into another: save the update on the story it went into',
  },
  stories_merged_into_story: {
    path: 'record.merged_into',
    message: "The story it was merged into doesn't exist",
  },
  stories_merges_never_chain: {
    path: 'record.merged_into',
    message: "A story is merged only into a story that isn't merged itself",
  },
  stories_merge_moves_its_updates: {
    path: 'record',
    message: 'A merged story keeps no updates: move them to the story that stays',
  },
  stories_merge_moves_its_sourced_items: {
    path: 'record',
    message: 'A merged story keeps no sourced items: move them to the story that stays',
  },
  updates_based_on_sourced_items: {
    path: 'record.based_on',
    message: "A sourced item it is based on doesn't exist",
  },
  updates_corrects_update: {
    path: 'record.corrects',
    message: "The update it corrects doesn't exist",
  },
  updates_correction_stays_in_its_story: {
    path: 'record.corrects',
    message: 'A correction names an update of the same story',
  },
  updates_correction_comes_later: {
    path: 'record.corrects',
    message: 'A correction comes after the update it corrects',
  },
  updates_correction_names_a_live_update: {
    path: 'record.corrects',
    message: 'A correction names an update that is live',
  },
  updates_merged_into_update: {
    path: 'record.merged_into',
    message: "The update it repeats doesn't exist",
  },
  updates_repeat_stays_in_its_story: {
    path: 'record.merged_into',
    message: 'A repeat names an update of the same story',
  },
  updates_merges_never_chain: {
    path: 'record.merged_into',
    message: "A repeat names an update that isn't a repeat itself",
  },
  updates_repeat_names_a_live_update: {
    path: 'record.merged_into',
    message: 'A repeat names an update that is live',
  },
};

/** A refusal of a record by a rule of the store: its fields as `@hrizzup/content`'s `refused` result gives them. */
export type RecordRefusal = {
  constraint?: string | null | undefined;
  message: string;
  hint?: string | null | undefined;
};

/**
 * A record the content store refused, as one 400 issue: the rule's own sentence when it has one here,
 * else the database's, with its hint when it gives one.
 */
export function recordRefusal(
  refusal: RecordRefusal,
): ORPCError<'BAD_REQUEST', { issues: Issue[] }> {
  const known = refusal.constraint ? RECORD_RULES[refusal.constraint] : undefined;
  const message = known?.message ?? `${refusal.message}${refusal.hint ? `: ${refusal.hint}` : ''}`;
  const path = known?.path ?? 'record';
  return badRequest(`${path}: ${message}`, [{ path, message }]);
}

/** Each of the agreement's problems with a record (`validate()`), as the 400 issues the contract's own input check makes: under `record`. */
export function recordProblems(
  problems: readonly { path: string; message: string }[],
): ORPCError<'BAD_REQUEST', { issues: Issue[] }> {
  const issues = problems.map((problem) => ({
    path: ['record', ...problem.path.split('/').filter(Boolean)].join('.'),
    message: problem.message,
  }));
  const first = issues[0];
  return badRequest(first ? `${first.path}: ${first.message}` : 'The record was refused', issues);
}
