import { type Story, type Update, validate } from '@hrizzup/agreement';
import type { social } from '@hrizzup/api';
import { ORPCError, ValidationError } from '@orpc/server';

/**
 * What the social console's forms (`app/console/social/actions.ts`) are made of, as plain functions with no
 * page, no session and no clock of their own, so each rule is tested alone (`console-forms.test.ts`): reading
 * a form's fields, building the agreement's records from them, choosing the changes a settings or agent form
 * really makes, telling an invite's state, and saying a refusal in words.
 *
 * The rules the forms keep (docs/social/build.md, D4 and section 7.10):
 * - **Whether a story or an invite is listed is an explicit choice with no default.** It is fixed for good
 *   when the story or invite is made, so a form that left it out must never quietly choose.
 * - **A record's times are in the past.** The content store refuses a time ahead of the database's clock, so
 *   a story's and an update's times are the moment of the save less `PAST_MS`.
 * - **Every problem the agreement finds is shown beside its own field,** in plain words, and what was typed
 *   is kept.
 * - **Nothing echoes a secret.** A refusal shows only the API's own words and the reasons mapped below.
 */

/** How far in the past a saved record's times are: the content store refuses a time ahead of the database's clock. */
export const PAST_MS = 5_000;

/**
 * A page of invites or agents that holds nothing, by construction: the lists page by the last ID shown
 * (`social.admin_invites(cursor)` and `social.admin_agents(cursor)` take the rows before it), and no row
 * has this one (a version 7 ID of the time zero), so a list that starts after it is empty. The Screen
 * check opens these two lists there, so the screenshots it keeps never show an invite's email or an
 * agent's: the artifacts of a check on a public repository are public.
 */
export const EMPTY_PAGE_CURSOR = '00000000-0000-7000-8000-000000000000';

/** Any UUID in lower case: the cursor of the invites and agents lists is the ID of the last one shown. */
export const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A record's ID as the agreement writes it: a version 7 UUID in lower case. */
export const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What a form shows after it is sent. */
export type SocialFormState = {
  /** A line on the last attempt as a whole: why it was refused, or null. */
  error: string | null;
  /** A problem with one field, by the form's own name for it: the line shows under the field. */
  problems: Record<string, string>;
  /** Everything typed, to show it again so it can be fixed. */
  values: Record<string, string>;
  /** A made invite, shown once: its code, the ready message and whose it is. */
  made?: { code: string; message: string; email: string };
  /** The open invite that stands in the way of a new one for the same email. */
  clash?: { id: string; email: string };
  /** A line for a save that worked and stays on the page. */
  saved?: string;
  /** A new ID for the next send: after a save that stays on the page, the old one has done its work. */
  nextId?: string;
};

export const START: SocialFormState = { error: null, problems: {}, values: {} };

/** A field as typed: new lines as the agreement writes them, and no spaces at either end. */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

/** Every field the form sent as text, to show again as it was typed. */
export function typed(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of form) if (typeof value === 'string') values[name] = value;
  return values;
}

/** The codes chosen in the form's selects of one kind (`category1`, `category2`, `category3`), blanks and repeats left to the agreement. */
export function chosen(form: FormData, prefix: string): string[] {
  return [1, 2, 3].map((n) => field(form, `${prefix}${n}`)).filter((code) => code !== '');
}

/**
 * Whether a story or invite is listed, from the form's two radio buttons: `listed` or `unlisted`. Null
 * for anything else, which is refused: there is no default, because it is fixed for good.
 */
export function listedChoice(form: FormData): boolean | null {
  const choice = field(form, 'listed');
  return choice === 'listed' ? true : choice === 'unlisted' ? false : null;
}

/** The refusal for a form that left `listed` out. */
export const LISTED_MISSING =
  'Choose listed or unlisted: it is fixed for good when it is made, so there is no default.';

/** A message as a sentence: its first letter in capitals and a full stop at the end. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const first = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

// ---------------------------------------------------------------------------------------------
// The agreement's records, from a form
// ---------------------------------------------------------------------------------------------

/** The form's name for a record field the agreement names differently. */
const FIELD_OF_RECORD: Record<string, string> = {
  locations: 'places',
  story_id: 'storyId',
  reported_at: 'headline',
  created_at: 'title',
  updated_at: 'title',
};

/** The form's field for a path in a record (`/categories/0`, `record.title`, `changes.postsPerDay`): its first name. */
export function fieldOfPath(path: string): string {
  const parts = path.split(/[./]/).filter(Boolean);
  const first = parts[0] === 'record' || parts[0] === 'changes' ? parts[1] : parts[0];
  if (!first) return '';
  return FIELD_OF_RECORD[first] ?? first;
}

type Problem = { path: string; message: string };

/**
 * One of the agreement's problems in plain words, for the person at the console: its checker's own phrases
 * ("must be equal to constant", eight times over for a category not on the list) said as what to do. A
 * problem with the record as a whole that names its sources (an update needs at least one of them or of the
 * posts it is based on) is one under `sources`, the field the console has. Null for a problem not worth a
 * line of its own (the checker says the same thing twice).
 */
export function plainProblem(problem: Problem): Problem | null {
  let { path, message } = problem;
  if ((path === '/' || path === '') && /sources|based_on|anyOf/.test(message)) {
    return { path: '/sources', message: 'Add at least one source address, starting https://' };
  }
  const listed = /^\/(categories|locations)(\/|$)/.test(path);
  if (listed && /equal to constant|oneOf/.test(message)) {
    return { path: `/${path.split('/')[1]}`, message: 'Choose each one from the list' };
  }
  if (/^must match format/.test(message)) return null;
  const line = /^\/sources\/(\d+)$/.exec(path);
  if (line) path = '/sources';
  const empty = /^must NOT have fewer than 1 characters$/.exec(message);
  const few = /^must NOT have fewer than (\d+) items$/.exec(message);
  const long = /^must NOT have more than (\d+) characters$/.exec(message);
  const many = /^must NOT have more than (\d+) items$/.exec(message);
  if (empty) message = 'Must not be empty';
  else if (few) message = `Choose at least ${few[1]}`;
  else if (long) message = `At most ${long[1]} characters`;
  else if (many) message = `At most ${many[1]}`;
  else if (/^must NOT have duplicate items/.test(message)) message = 'No repeats';
  else if (/^must be one line of plain text/.test(message)) {
    message = 'One line of plain text, with no hidden characters';
  } else if (/^must be record ID/.test(message)) message = 'The ID is not valid: reload the page';
  else if (/^must be time in UTC/.test(message)) message = 'The time is not valid: reload the page';
  return {
    path,
    message: line
      ? `Line ${Number(line[1]) + 1}: ${message.charAt(0).toUpperCase()}${message.slice(1)}`
      : message,
  };
}

/** Problems with a record as lines under the form's fields, each field's joined; what belongs to no field of the form is a line of its own. */
export function problemLines(
  problems: readonly Problem[],
  forms: ReadonlySet<string>,
): { problems: Record<string, string>; loose: string[] } {
  const byField: Record<string, string[]> = {};
  const loose: string[] = [];
  for (const raw of problems) {
    const problem = plainProblem(raw);
    if (!problem) continue;
    const name = fieldOfPath(problem.path);
    const own = forms.has(name);
    const line = own || !name ? sentence(problem.message) : `${name}: ${sentence(problem.message)}`;
    const into = own ? (byField[name] ?? []) : loose;
    if (own) byField[name] = into;
    if (!into.includes(line)) into.push(line);
  }
  return {
    // An empty line of text also breaks the checker's "one line" pattern: the first line says it all.
    problems: Object.fromEntries(
      Object.entries(byField).map(([name, lines]) => [
        name,
        (lines.includes('Must not be empty.')
          ? lines.filter((line) => !line.startsWith('One line of plain text'))
          : lines
        ).join(' '),
      ]),
    ),
    loose,
  };
}

/** What the form shows when problems were found: each beside its field, and one line saying so. */
function refused(
  values: Record<string, string>,
  found: { problems: Record<string, string>; loose: string[] },
): SocialFormState {
  const note =
    Object.keys(found.problems).length > 0
      ? ['Not saved: see the lines under the fields.', ...found.loose]
      : found.loose;
  return { error: note.join(' '), problems: found.problems, values };
}

const STORY_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'summary',
  'categories',
  'places',
  'listed',
]);
const UPDATE_FIELDS: ReadonlySet<string> = new Set([
  'headline',
  'body',
  'sources',
  'corrects',
  'storyId',
]);

/** The time a record is saved with: now, less `PAST_MS`. */
export function pastTime(now: number): string {
  return new Date(now - PAST_MS).toISOString();
}

export type Built<Record> = { ok: true; record: Record } | { ok: false; state: SocialFormState };

/**
 * The `story/1` a new-story form makes: its own ID, the typed title and summary, one to three categories
 * and places (the first of each the main one), live, its times `PAST_MS` before `now`. The agreement's own
 * check (`validate`) says what is wrong, and each problem is shown under its field.
 */
export function storyFrom(form: FormData, now: number): Built<{ record: Story; listed: boolean }> {
  const values = typed(form);
  const listed = listedChoice(form);
  const at = pastTime(now);
  const record = {
    format: 'story/1',
    id: field(form, 'id'),
    title: field(form, 'title'),
    summary: field(form, 'summary'),
    locations: chosen(form, 'place'),
    categories: chosen(form, 'category'),
    state: 'live',
    created_at: at,
    updated_at: at,
  } as Story;
  const found = problemLines(validate(record), STORY_FIELDS);
  if (listed === null) found.problems.listed = LISTED_MISSING;
  if (Object.keys(found.problems).length > 0 || found.loose.length > 0) {
    return { ok: false, state: refused(values, found) };
  }
  return { ok: true, record: { record, listed: listed === true } };
}

/** A lines-of-links field as a list: one address a line, blank lines left out. */
export function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * The `update/1` an add-an-update form makes: its own ID, the story's, the typed headline, optional body,
 * the sources one to a line, optionally the earlier update it corrects, live, its times `PAST_MS` before `now`.
 */
export function updateFrom(form: FormData, now: number): Built<Update> {
  const values = typed(form);
  const at = pastTime(now);
  const body = field(form, 'body');
  const sources = linesOf(field(form, 'sources'));
  const corrects = field(form, 'corrects');
  const record = {
    format: 'update/1',
    id: field(form, 'id'),
    story_id: field(form, 'storyId'),
    headline: field(form, 'headline'),
    ...(body ? { body } : {}),
    reported_at: at,
    ...(sources.length > 0 ? { sources } : {}),
    ...(corrects ? { corrects } : {}),
    state: 'live',
    created_at: at,
    updated_at: at,
  } as Update;
  const found = problemLines(validate(record), UPDATE_FIELDS);
  if (Object.keys(found.problems).length > 0 || found.loose.length > 0) {
    return { ok: false, state: refused(values, found) };
  }
  return { ok: true, record };
}

// ---------------------------------------------------------------------------------------------
// The changes a settings or agent form really makes
// ---------------------------------------------------------------------------------------------

/** A setting as a form shows it: its name, and whether it is a number or text. */
export type SettingKind = 'number' | 'text';

/**
 * The settings typed differently from what the page showed, as the call takes them: a number as a number,
 * text as text. One left as it was is never sent, so a page loaded before another admin's change can't
 * quietly undo it. A number that isn't one is a problem under its field.
 */
export function settingChanges(
  form: FormData,
  settings: readonly { name: string; kind: SettingKind }[],
): { changes: Record<string, number | string>; problems: Record<string, string> } {
  const changes: Record<string, number | string> = {};
  const problems: Record<string, string> = {};
  for (const setting of settings) {
    const value = field(form, setting.name);
    if (value === '' || value === field(form, `shown-${setting.name}`)) continue;
    if (setting.kind === 'text') {
      changes[setting.name] = value;
    } else if (/^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value))) {
      changes[setting.name] = Number(value);
    } else {
      problems[setting.name] = 'Type a number.';
    }
  }
  return { changes, problems };
}

/**
 * An agent's changes from the form: Hrizzup's own mark and the two limits, each only if it differs from what
 * the page showed. A limit left blank is `null`, the settings' own.
 */
export function agentChanges(form: FormData): {
  changes: { house?: boolean; postsPerDay?: number | null; repliesPerHour?: number | null };
  problems: Record<string, string>;
} {
  const changes: { house?: boolean; postsPerDay?: number | null; repliesPerHour?: number | null } =
    {};
  const problems: Record<string, string> = {};
  if ((field(form, 'house') === 'on') !== (field(form, 'shown-house') === 'true')) {
    changes.house = field(form, 'house') === 'on';
  }
  for (const name of ['postsPerDay', 'repliesPerHour'] as const) {
    const value = field(form, name);
    if (value === field(form, `shown-${name}`)) continue;
    if (value === '') changes[name] = null;
    else if (/^\d+$/.test(value)) changes[name] = Number(value);
    else problems[name] = 'Type a whole number, or leave it blank for the settings’ own.';
  }
  return { changes, problems };
}

// ---------------------------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------------------------

export type InviteState = 'open' | 'used' | 'revoked' | 'expired';

/** Where an invite stands: used once its agent registered, revoked, expired (revoked as such, or past its date unused), or open. */
export function inviteState(
  invite: Pick<social.Invite, 'usedAt' | 'revokedAt' | 'revokedReason' | 'expiresAt'>,
  now: number,
): InviteState {
  if (invite.usedAt) return 'used';
  if (invite.revokedAt) return invite.revokedReason === 'expired' ? 'expired' : 'revoked';
  return Date.parse(invite.expiresAt) <= now ? 'expired' : 'open';
}

/**
 * Whether the console offers to revoke an invite: one not revoked whose agent, if it has one, still waits to
 * be claimed (revoking retires it and revokes its keys, build.md D3). A claimed agent's owner holds it, so
 * the database refuses.
 */
export function canRevoke(invite: Pick<social.Invite, 'usedAt' | 'revokedAt' | 'agent'>): boolean {
  if (invite.revokedAt !== null) return false;
  return invite.agent === null ? invite.usedAt === null : invite.agent.state === 'waiting';
}

/** The invite that stands in the way of a new one for this email: open, not revoked or used, its email the same. */
export function openInviteFor(
  invites: readonly social.Invite[],
  email: string,
  now: number,
): social.Invite | null {
  const wanted = email.trim().toLowerCase();
  return (
    invites.find(
      (invite) => invite.email.toLowerCase() === wanted && inviteState(invite, now) === 'open',
    ) ?? null
  );
}

// ---------------------------------------------------------------------------------------------
// Refusals, in words
// ---------------------------------------------------------------------------------------------

/** What each coded 409 or 422 means for the person at the console. */
const REASONS: Record<string, string> = {
  invite_open: 'This email already has an open invite: revoke it first.',
  invite_used:
    'That invite was already used, so its code cannot be shown again: reload the page and make a new one.',
  invite_revoked:
    'That invite was already revoked, so its code cannot be shown again: reload the page and make a new one.',
  invite_claimed:
    "This invite's agent has been claimed: its owner holds it now, so it cannot be revoked.",
  stale_record: 'A newer version of this is already saved: reload the page.',
  listing_fixed:
    'Whether a story is listed is fixed when it is made: this one was made the other way.',
  request_reused:
    'That form was already sent with different details: reload the page for a new one.',
};

/** The issues a refused input carries: the API's own (`data.issues`), or the validator's, as the page of the market console reads them. */
function issuesOf(error: ORPCError<string, unknown>): Problem[] {
  const data = error.data as { issues?: unknown } | undefined;
  if (Array.isArray(data?.issues)) {
    return (data.issues as unknown[]).flatMap((issue) => {
      const { path, message } = (issue ?? {}) as { path?: unknown; message?: unknown };
      return typeof message === 'string'
        ? [{ path: typeof path === 'string' ? path : '', message }]
        : [];
    });
  }
  if (error.cause instanceof ValidationError) {
    return error.cause.issues.map((issue) => ({
      path: (issue.path ?? [])
        .map((part) => String(typeof part === 'object' ? part.key : part))
        .join('.'),
      message: issue.message,
    }));
  }
  return [];
}

/** The code of a refusal's reason (`invite_open`, `stale_record`…), when the API gave one. */
export function reasonOf(error: unknown): string | undefined {
  if (!(error instanceof ORPCError)) return undefined;
  const reason = (error.data as { reason?: unknown } | undefined)?.reason;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * Why a call was refused, as the form shows it: a problem under each field it names (the forms' own names:
 * `fields`), a line for the rest, and what was typed kept. Null when the call is "No such call", which the
 * action answers as "not found" (anyone who could see that would learn the console exists). Anything that
 * isn't a refusal from the API is thrown again: it is ours to fix, not a line to show.
 */
export function refusalOf(
  error: unknown,
  values: Record<string, string>,
  fields: ReadonlySet<string>,
): SocialFormState | null {
  if (!(error instanceof ORPCError)) throw error;
  if (error.code === 'NOT_FOUND' && error.message === 'No such call') return null;
  const reason = reasonOf(error);
  if (reason && REASONS[reason]) return { error: REASONS[reason], problems: {}, values };
  if (error.code === 'BAD_REQUEST') {
    const found = problemLines(issuesOf(error), fields);
    if (Object.keys(found.problems).length > 0 || found.loose.length > 0) {
      return refused(values, found);
    }
  }
  if (error.code === 'NOT_FOUND') {
    return { error: 'That one no longer exists: reload the page.', problems: {}, values };
  }
  if (error.code === 'SERVICE_UNAVAILABLE') {
    return { error: 'The database is busy. Try again in a moment.', problems: {}, values };
  }
  return { error: sentence(error.message), problems: {}, values };
}

/** The names of the fields each form has, for `refusalOf`. */
export const FIELDS = {
  invite: new Set(['email', 'note', 'house', 'listed', 'requestId']),
  story: STORY_FIELDS,
  update: UPDATE_FIELDS,
  reason: new Set(['reason']),
} as const;

/** A set of the names a settings or agent form's fields have, with its reason. */
export function fieldsWith(names: readonly string[]): ReadonlySet<string> {
  return new Set([...names, 'reason']);
}
