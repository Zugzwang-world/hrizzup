import { type Problem, validate } from '@hrizzup/agreement';

/**
 * The checked save of the content store's records (docs/social/build.md, D4 and section 7.9).
 *
 * A story or an update is saved in two steps, in this order:
 * 1. **The agreement's own check** (`validate()` from `@hrizzup/agreement`), in this process. A record
 *    with any problem never reaches the database, and each problem comes back with its path.
 * 2. **One database function in one transaction.** The function writes the record into the content
 *    store's tables as it is, and the tables' own rules check it again. The console calls
 *    `social.admin_save_story` and `social.admin_save_update` (test stories, staging only; they check
 *    the admin, and the story's `listed` choice); the news pipeline will call `intake.save_story` and
 *    `intake.save_update` itself. Only these four names are accepted, since the name becomes SQL text.
 *
 * **The transaction is the caller's:** `run(work)` starts one, runs `work` with its `query`, commits
 * when `work` returns, and rolls back when it throws (`transaction()` of `@hrizzup/db` is that, as the
 * app's own role with the signed-in admin). It is called once. **Errors that come out of `run` are
 * mapped the same, wherever they were raised:** the content store's rules that span records (a story an
 * update names, a merge into a merged story) are deferred, so the database raises them when the
 * transaction **commits**, after `work` has returned, and the caller's `run` throws them from its
 * commit; that is mapped exactly as an error raised by the statement. That is why `run` is wrapped
 * whole and not just the query.
 *
 * What comes back, rather than thrown, is what a caller tells the person about (a console form, a
 * pipeline's log): an answer, a record with problems, an older record, a story whose `listed` can't
 * change, a rule of the content store. Anything else (the caller isn't an admin, test stories are off
 * here, the database is busy, no connection) is thrown as it came, for the caller's own error map.
 */

/** What a save runs its one statement on: `@hrizzup/db`'s `Transaction` fits. */
export type SaveTransaction = {
  query(text: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

/** Starts a transaction, runs the work in it and commits: `transaction()` of `@hrizzup/db` with the caller's pool and account. */
export type RunTransaction = <T>(work: (tx: SaveTransaction) => Promise<T>) => Promise<T>;

/** The database function a story is saved with. The console's takes the story's `listed` choice too. */
export type StoryTarget =
  | { run: RunTransaction; fn: 'intake.save_story' }
  | { run: RunTransaction; fn: 'social.admin_save_story'; listed: boolean };

export type UpdateTarget = {
  run: RunTransaction;
  fn: 'intake.save_update' | 'social.admin_save_update';
};

/** What a save did: a record the store hadn't, one it had at an earlier `updated_at`, or the very same one. */
export type Saved = 'new' | 'changed' | 'same';

export type SaveResult =
  | {
      ok: true;
      /** The saved record's ID. */
      id: string;
      saved: Saved;
      /** The database function's whole answer: `{id, saved}`, and what the console's functions add (a story's tile and `listed`, an update's `story_id`). */
      answer: Record<string, unknown>;
    }
  /** The agreement's check refused the record: nothing was sent to the database. Each problem has its path and what's wrong. */
  | { ok: false; reason: 'invalid'; problems: Problem[] }
  /** A newer version of the record is already saved (the console answers 409 `stale_record`). Nothing changed. */
  | { ok: false; reason: 'older' }
  /** The story is already known and was listed (or not) otherwise: `listed` is chosen once, when the story is made (409 `listing_fixed`). */
  | { ok: false; reason: 'listing_fixed' }
  /**
   * The content store refused the record, naming its rule: a check, a missing reference, a clash, a
   * value it can't read. `constraint` is the rule's name (what an error at commit carries too),
   * `message` its plain sentence and `hint` the fix, when it gives one.
   */
  | {
      ok: false;
      reason: 'refused';
      code: string;
      constraint: string | null;
      message: string;
      hint: string | null;
    };

const SAVED: readonly string[] = ['new', 'changed', 'same'];
const STORY_FUNCTIONS: readonly string[] = ['intake.save_story', 'social.admin_save_story'];
const UPDATE_FUNCTIONS: readonly string[] = ['intake.save_update', 'social.admin_save_update'];

/** The agreement's check, after the record says it is the format this save takes. */
function check(record: unknown, format: 'story/1' | 'update/1'): Problem[] {
  const given =
    typeof record === 'object' && record !== null
      ? (record as { format?: unknown }).format
      : undefined;
  if (given !== format) return [{ path: '/format', message: `must be ${format}` }];
  return validate(record);
}

/** A database error as a refusal to report, or null when it is not the store's to report. */
function refusal(error: unknown): SaveResult | null {
  const failure = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
    hint?: unknown;
  } | null;
  const code = typeof failure?.code === 'string' ? failure.code : undefined;
  if (code === undefined) return null;
  if (code === 'HZS19') return { ok: false, reason: 'older' };
  if (code === 'HZS25') return { ok: false, reason: 'listing_fixed' };
  // 22: a value the database can't read or the function's own checks (22023); 23: a rule of the store.
  if (code.startsWith('22') || code.startsWith('23')) {
    return {
      ok: false,
      reason: 'refused',
      code,
      constraint: typeof failure?.constraint === 'string' ? failure.constraint : null,
      message: typeof failure?.message === 'string' ? failure.message : 'The record was refused',
      hint: typeof failure?.hint === 'string' ? failure.hint : null,
    };
  }
  return null;
}

async function save(
  run: RunTransaction,
  statement: string,
  values: unknown[],
): Promise<SaveResult> {
  try {
    const raw = await run(async (tx) => {
      const { rows } = await tx.query(statement, values);
      return rows[0]?.answer;
    });
    // The driver reads jsonb as an object; text is read too.
    let answer = raw;
    if (typeof raw === 'string') {
      try {
        answer = JSON.parse(raw);
      } catch {
        answer = undefined;
      }
    }
    const found = answer as { id?: unknown; saved?: unknown } | null;
    if (
      typeof found !== 'object' ||
      found === null ||
      typeof found.id !== 'string' ||
      typeof found.saved !== 'string' ||
      !SAVED.includes(found.saved)
    ) {
      throw new TypeError(
        "The database's answer to a save isn't {id, saved: new | changed | same}",
      );
    }
    return {
      ok: true,
      id: found.id,
      saved: found.saved as Saved,
      answer: found as Record<string, unknown>,
    };
  } catch (error) {
    const refused = refusal(error);
    if (refused !== null) return refused;
    throw error;
  }
}

/** Saves a story/1 record: checked, then written by one database function (see the file's note). */
export async function saveStory(record: unknown, target: StoryTarget): Promise<SaveResult> {
  if (!STORY_FUNCTIONS.includes(target.fn)) {
    throw new TypeError(`${String(target.fn)} is not a function that saves a story`);
  }
  if (target.fn === 'social.admin_save_story' && typeof target.listed !== 'boolean') {
    throw new TypeError(
      'A story saved by the console is listed or not: `listed` must be true or false',
    );
  }
  const problems = check(record, 'story/1');
  if (problems.length > 0) return { ok: false, reason: 'invalid', problems };
  const json = JSON.stringify(record);
  return target.fn === 'social.admin_save_story'
    ? save(target.run, 'select social.admin_save_story($1::jsonb, $2::boolean) as answer', [
        json,
        target.listed,
      ])
    : save(target.run, 'select intake.save_story($1::jsonb) as answer', [json]);
}

/** Saves an update/1 record, the same way. */
export async function saveUpdate(record: unknown, target: UpdateTarget): Promise<SaveResult> {
  if (!UPDATE_FUNCTIONS.includes(target.fn)) {
    throw new TypeError(`${String(target.fn)} is not a function that saves an update`);
  }
  const problems = check(record, 'update/1');
  if (problems.length > 0) return { ok: false, reason: 'invalid', problems };
  const statement =
    target.fn === 'social.admin_save_update'
      ? 'select social.admin_save_update($1::jsonb) as answer'
      : 'select intake.save_update($1::jsonb) as answer';
  return save(target.run, statement, [JSON.stringify(record)]);
}
