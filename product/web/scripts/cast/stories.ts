import { validate } from '@hrizzup/agreement';
import { uuidv7 } from '@hrizzup/core';
import { adminCall } from './admin.ts';
import type { Ctx } from './context.ts';
import { refuse } from './errors.ts';
import { inFolder } from './files.ts';
import { type Call, refusedBy, send, sendRaw } from './http.ts';
import { list, object, text } from './lenient.ts';
import { keyFile, MEMBERS, readCast } from './members.ts';
import { openRun, readState, type State, withdrawnNames, writeState } from './state.ts';

/**
 * The story sets (rules 13 and 14): a set file in `<store>/stories/`, written by the session, is
 * checked offline (`check`), saved to staging as listed test stories with their updates (`load`),
 * and taken down again (`withdraw`). Every record without an id gets a fresh UUIDv7 once, written
 * back to the file before anything is sent, so loading the file again sends the same records.
 */

export const SET_FORMAT = 'hrizzup-cast-stories/1';
export const WITHDRAWN_REASON = 'A Hrizzup test story, replaced by a fresh set';
const MINUTE_MS = 60_000;

type SetUpdate = {
  id?: string;
  headline: string;
  body?: string;
  reported_at: string;
  sources: string[];
  added?: string;
};

type SetStory = {
  story: { id?: string; title: string; summary: string; locations: string[]; categories: string[] };
  updates: SetUpdate[];
};

export type SetFile = { format: typeof SET_FORMAT; written: string; stories: SetStory[] };

const TOP_KEYS = new Set(['format', 'written', 'stories']);
const ENTRY_KEYS = new Set(['story', 'updates']);
const STORY_KEYS = new Set(['id', 'title', 'summary', 'locations', 'categories']);
const UPDATE_KEYS = new Set(['id', 'headline', 'body', 'reported_at', 'sources', 'added']);
const TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$/;

type Records = {
  story: Record<string, unknown>;
  updates: Record<string, unknown>[];
};

export type Prepared = {
  file: SetFile;
  /** True when an id was filled in, so the file must be written back. */
  changed: boolean;
  records: Records[];
  problems: string[];
  warnings: string[];
};

function unknownKeys(value: Record<string, unknown>, known: Set<string>, where: string): string[] {
  return Object.keys(value)
    .filter((key) => !known.has(key))
    .map(
      (key) =>
        `${where}: ${key} is not a field of a set file${key === 'based_on' ? ' (based_on is refused)' : ''}`,
    );
}

/** Reads a set file's text: a JSON object of the set's shape, else a refusal that says where. */
export function parseSet(raw: string): SetFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw refuse('The set file is not valid JSON');
  }
  const top = object(parsed);
  const problems = unknownKeys(top, TOP_KEYS, 'the file');
  if (top.format !== SET_FORMAT) problems.push(`the file: format must be "${SET_FORMAT}"`);
  if (typeof top.written !== 'string' || !TIME.test(top.written)) {
    problems.push('the file: written must be a time like 2026-11-19T09:00:00Z');
  }
  if (!Array.isArray(top.stories)) problems.push('the file: stories must be a list');
  if (problems.length > 0) throw refuse(problems.join('\n'));
  return parsed as SetFile;
}

/**
 * Fills in the ids, builds each story's and update's record (rule 13's times), and lists what is
 * wrong (`problems`, refused) and what is only unusual (`warnings`). Nothing is sent.
 */
export function prepareSet(input: SetFile, nowMs: number, newId: () => string): Prepared {
  const file = structuredClone(input);
  const problems: string[] = [];
  const warnings: string[] = [];
  let changed = false;
  const latest = nowMs - MINUTE_MS;
  const past = (time: string, where: string) => {
    if (!TIME.test(time) || Number.isNaN(Date.parse(time))) {
      problems.push(`${where}: ${time} is not a time like 2026-11-19T09:00:00Z`);
    } else if (Date.parse(time) > latest) {
      problems.push(`${where}: ${time} is less than 60 seconds in the past`);
    }
  };
  past(file.written, 'written');

  if (file.stories.length < 8 || file.stories.length > 10) {
    warnings.push(`${file.stories.length} stories: a set is 8 to 10`);
  }
  const seen = new Set<string>();
  const unique = (id: string, where: string) => {
    if (seen.has(id)) problems.push(`${where}: the id ${id} is used twice`);
    seen.add(id);
  };

  const records: Records[] = [];
  file.stories.forEach((entry, index) => {
    const where = `story ${index + 1}`;
    problems.push(...unknownKeys(object(entry), ENTRY_KEYS, where));
    problems.push(...unknownKeys(object(entry.story), STORY_KEYS, `${where}`));
    if (!entry.story || !Array.isArray(entry.updates)) {
      problems.push(`${where}: it needs a story and a list of updates`);
      return;
    }
    const storyId = entry.story.id || newId();
    if (!entry.story.id) {
      // The id goes after the spread: an `"id": ""` or `null` in the file cannot overwrite the one filled in.
      entry.story = { ...entry.story, id: storyId };
      changed = true;
    }
    unique(storyId, where);
    if (entry.updates.length < 2) problems.push(`${where}: it needs at least two updates`);
    if (entry.updates.length > 4)
      warnings.push(`${where}: ${entry.updates.length} updates: a story has two to four`);

    const updates: Record<string, unknown>[] = [];
    let newest = file.written;
    entry.updates.forEach((given, at) => {
      const place = `${where}, update ${at + 1}`;
      problems.push(...unknownKeys(object(given), UPDATE_KEYS, place));
      const update = { ...given, id: given.id || newId() };
      if (!given.id) {
        entry.updates[at] = { ...given, id: update.id };
        changed = true;
      }
      unique(update.id, place);
      if (!Array.isArray(update.sources) || update.sources.length === 0) {
        problems.push(`${place}: it needs at least one source`);
      }
      const added = update.added ?? file.written;
      past(added, `${place}: added`);
      past(update.reported_at, `${place}: reported_at`);
      if (Date.parse(added) > Date.parse(newest)) newest = added;
      updates.push({
        format: 'update/1',
        id: update.id,
        story_id: storyId,
        headline: update.headline,
        ...(update.body === undefined ? {} : { body: update.body }),
        reported_at: update.reported_at,
        sources: update.sources,
        state: 'live',
        created_at: added,
        updated_at: added,
      });
    });
    const record = {
      format: 'story/1',
      id: storyId,
      title: entry.story.title,
      summary: entry.story.summary,
      locations: entry.story.locations,
      categories: entry.story.categories,
      state: 'live',
      created_at: file.written,
      updated_at: newest,
    };
    for (const issue of validate(record))
      problems.push(`${where}: ${issue.path || '/'} ${issue.message}`);
    updates.forEach((update, at) => {
      for (const issue of validate(update)) {
        problems.push(`${where}, update ${at + 1}: ${issue.path || '/'} ${issue.message}`);
      }
    });
    records.push({ story: record, updates });
  });
  return { file, changed, records, problems, warnings };
}

/** The set file's name, and its text. Refuses a file that isn't there. */
function setText(ctx: Ctx, name: string): { rel: string; raw: string } {
  const rel = inFolder(ctx, 'stories', name);
  const raw = ctx.store.readText(rel);
  if (raw === null) throw refuse(`${rel} is not in the store`);
  return { rel, raw };
}

const newIdMaker = (ctx: Ctx) => () => uuidv7({ now: () => ctx.clock.now() });

/** Reads, fills in the ids (writing the file back first, so a retry sends the same records) and refuses on any problem. */
function readyToSend(ctx: Ctx, name: string): { rel: string; prepared: Prepared } {
  const { rel, raw } = setText(ctx, name);
  const prepared = prepareSet(parseSet(raw), ctx.clock.now(), newIdMaker(ctx));
  if (prepared.changed) ctx.store.writeText(rel, `${JSON.stringify(prepared.file, null, 2)}\n`);
  if (prepared.problems.length > 0) throw refuse(prepared.problems.join('\n'));
  return { rel, prepared };
}

/** `stories check <file>`: fills in ids and validates, offline. */
export function checkCommand(ctx: Ctx, name: string): void {
  const { prepared } = readyToSend(ctx, name);
  const updates = prepared.records.reduce((sum, one) => sum + one.updates.length, 0);
  for (const warning of prepared.warnings) ctx.io.out(`warning: ${warning}`);
  ctx.io.out(`ok: ${prepared.records.length} stories, ${updates} updates`);
}

const savedOf = (body: Record<string, unknown>): string => text(body.saved) ?? 'saved';

/** `stories load <file>`: saves the set, listed, each story then its updates oldest first. */
export async function loadCommand(ctx: Ctx, name: string): Promise<void> {
  ctx.auth();
  const state = readState(ctx.store);
  const rel = inFolder(ctx, 'stories', name);
  const file = rel.slice('stories/'.length);
  if (state.current && state.current.file !== file) {
    throw refuse(`${state.current.file} is the current set: \`stories withdraw\` it first`);
  }
  if (!state.current && withdrawnNames(state).has(file)) {
    throw refuse(
      `${file} was the name of a set that has been withdrawn: write the fresh set under a new file name`,
    );
  }
  const { prepared } = readyToSend(ctx, name);
  for (const warning of prepared.warnings) ctx.io.out(`warning: ${warning}`);

  const ids = prepared.records.map((one) => String(one.story.id));
  if (state.current) {
    const missing = state.current.storyIds.filter((id) => !ids.includes(id));
    if (missing.length > 0) {
      throw refuse(
        `${file} no longer has ${missing.length} story(ies) of the current set: add stories, never remove them`,
      );
    }
  }
  state.current = {
    file,
    storyIds: [...new Set([...(state.current?.storyIds ?? []), ...ids])],
    loadedAt: state.current?.loadedAt ?? new Date(ctx.clock.now()).toISOString(),
  };
  writeState(ctx.store, state);

  for (const one of prepared.records) {
    const saved = await adminCall(ctx, 'POST', '/admin/social/stories', {
      body: { record: one.story, listed: true },
    });
    ctx.io.out(`story ${savedOf(saved.body)}: ${String(one.story.title)}`);
    const ordered = [...one.updates].sort(
      (a, b) => Date.parse(String(a.reported_at)) - Date.parse(String(b.reported_at)),
    );
    for (const update of ordered) {
      const result = await adminCall(ctx, 'POST', '/admin/social/updates', {
        body: { record: update },
      });
      ctx.io.out(`  update ${savedOf(result.body)}: ${String(update.headline)}`);
    }
  }
}

/** Unpins every member from the set: each made member's live pins on the set's stories. */
async function unpinAll(ctx: Ctx, state: State, storyIds: string[]): Promise<void> {
  const cast = readCast(ctx.store);
  const run = state.runs.at(-1)?.n ?? 0;
  for (const member of MEMBERS) {
    const entry = cast.members[member.key];
    const key = entry ? ctx.store.readText(keyFile(entry.handle))?.trim() : null;
    if (!entry || !key) continue;
    let cursor: string | null = null;
    const pinned: string[] = [];
    for (let page = 0; page < 10; page++) {
      const answer = await send(ctx, {
        method: 'GET',
        path: '/social/me/pins',
        query: { limit: '100', ...(cursor ? { cursor } : {}) },
        key,
      });
      for (const pin of list(answer.body.pins)) {
        const story = text(pin.storyId);
        if (story && storyIds.includes(story)) pinned.push(story);
      }
      cursor = text(answer.body.next);
      if (!cursor) break;
    }
    for (const story of pinned) {
      const call: Call = {
        method: 'POST',
        path: `/social/me/pins/${story}/unpin`,
        key,
        body: {},
        id: { subject: entry.handle, run, attempt: 1 },
      };
      // A pin already released (404) is what was wanted.
      const answer = await sendRaw(ctx, call);
      if (!answer.ok && answer.status !== 404) throw refusedBy(call, answer);
    }
    if (pinned.length > 0) ctx.io.out(`${member.key}: unpinned ${pinned.length}`);
  }
}

/** `stories withdraw`: unpins every member from the set, then withdraws each story of the set's file. */
export async function withdrawCommand(ctx: Ctx): Promise<void> {
  ctx.auth();
  const state = readState(ctx.store);
  if (!state.current) throw refuse('No story set is loaded: nothing to withdraw');
  if (openRun(state)) throw refuse('A run is open: `run end` first');
  const { prepared } = readyToSend(ctx, state.current.file);
  const ids = prepared.records.map((one) => String(one.story.id));
  await unpinAll(ctx, state, ids);

  const updatedAt = new Date(ctx.clock.now() - 5_000).toISOString();
  for (const one of prepared.records) {
    const record = {
      ...one.story,
      state: 'withdrawn',
      withdrawn_reason: WITHDRAWN_REASON,
      updated_at: updatedAt,
    };
    const [issue] = validate(record);
    if (issue)
      throw refuse(`The withdrawn record is refused: ${issue.path || '/'} ${issue.message}`);
    const saved = await adminCall(ctx, 'POST', '/admin/social/stories', {
      body: { record, listed: true },
    });
    ctx.io.out(`story withdrawn (${savedOf(saved.body)}): ${String(one.story.title)}`);
  }
  state.withdrawn = [...new Set([...state.withdrawn, state.current.file])];
  state.current = null;
  writeState(ctx.store, state);
}
