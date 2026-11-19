import type { Ctx } from './context.ts';
import { CastError, refuse } from './errors.ts';
import { send } from './http.ts';
import { list, text } from './lenient.ts';
import { type LogEntry, readLog, totalsOf } from './log.ts';
import { MEMBERS } from './members.ts';
import { lastRun, needSet, openRun, type RunRecord, readState, writeState } from './state.ts';

/**
 * Runs (rule 15): one open at a time, on the current set; a member's writes need one. `run show`
 * says who is next and gives the run's tally, counted from the log as distinct things.
 */

export function startCommand(ctx: Ctx): void {
  const state = readState(ctx.store);
  const open = openRun(state);
  if (open) throw refuse(`Run ${open.n} is open: \`run end\` first`);
  const current = needSet(state);
  const n = Math.max(0, ...state.runs.map((run) => run.n)) + 1;
  state.runs.push({
    n,
    set: current.file,
    open: true,
    startedAt: new Date(ctx.clock.now()).toISOString(),
    endedAt: null,
  });
  writeState(ctx.store, state);
  ctx.io.out(`run ${n} started on ${current.file}`);
  ctx.io.out(`next: ${MEMBERS[0]?.key}`);
}

export function endCommand(ctx: Ctx): void {
  const state = readState(ctx.store);
  const open = openRun(state);
  if (!open) throw refuse('No run is open');
  open.open = false;
  open.endedAt = new Date(ctx.clock.now()).toISOString();
  writeState(ctx.store, state);
  ctx.io.out(`run ${open.n} ended`);
}

/** Where each member stands in a run, from its log. */
function standing(entries: LogEntry[], member: string): 'finished' | 'checked in' | 'not started' {
  if (entries.some((entry) => entry.member === member && entry.type === 'checkin_done')) {
    return 'finished';
  }
  if (entries.some((entry) => entry.member === member && entry.type === 'checkin')) {
    return 'checked in';
  }
  return 'not started';
}

/** How many of the set's stories show a picture on the board (null when the board couldn't be read). */
async function picturesOnBoard(ctx: Ctx, storyIds: string[]): Promise<number | null> {
  try {
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 5; page++) {
      const answer = await send(ctx, {
        method: 'GET',
        path: '/social/board',
        query: { limit: '100', ...(cursor ? { cursor } : {}) },
      });
      for (const tile of list(answer.body.stories)) {
        const id = text(tile.id);
        if (id && storyIds.includes(id) && tile.picture !== null && tile.picture !== undefined) {
          seen.add(id);
        }
      }
      cursor = text(answer.body.next);
      if (!cursor) break;
    }
    return seen.size;
  } catch (error) {
    if (error instanceof CastError && (error.exit === 3 || error.exit === 4)) return null;
    throw error;
  }
}

export async function showCommand(ctx: Ctx): Promise<void> {
  const state = readState(ctx.store);
  const run: RunRecord | null = openRun(state) ?? lastRun(state);
  if (!run) throw refuse('No run has been started: `run start` first');
  const entries = readLog(ctx.store, run.n);
  ctx.io.out(`run ${run.n} (${run.open ? 'open' : 'closed'}) on ${run.set}`);

  let next: string | null = null;
  for (const member of MEMBERS) {
    const where = standing(entries, member.key);
    ctx.io.out(`  ${member.key}: ${where}`);
    if (next === null && where !== 'finished') next = `${member.key} (${where})`;
  }
  if (!run.open) ctx.io.out('next: none, the run is closed');
  else ctx.io.out(next ? `next: ${next}` : 'next: all six members finished; `run end` when ready');

  const totals = totalsOf(entries);
  const kinds: Record<string, number> = { text: 0, image: 0, video: 0, audio: 0 };
  for (const post of totals.posts.values()) kinds[post.kind] = (kinds[post.kind] ?? 0) + 1;
  ctx.io.out('tally:');
  ctx.io.out(
    `  posts: ${totals.posts.size} (${Object.entries(kinds)
      .map(([kind, count]) => `${kind} ${count}`)
      .join(', ')})`,
  );
  const grid = new Map<string, number>();
  for (const reply of totals.replies.values()) {
    const key = `${reply.intent}|${reply.depth}`;
    grid.set(key, (grid.get(key) ?? 0) + 1);
  }
  ctx.io.out(`  replies: ${totals.replies.size}`);
  for (const intent of ['ask', 'answer', 'add', 'push-back']) {
    const cells = [0, 1, 2, 3]
      .map((depth) => `d${depth} ${grid.get(`${intent}|${depth}`) ?? 0}`)
      .join(', ');
    ctx.io.out(`    ${intent}: ${cells}`);
  }
  ctx.io.out(`  upvotes: ${totals.upvotes.size}`);
  const current = state.current;
  if (current) {
    const pictures = await picturesOnBoard(ctx, current.storyIds);
    ctx.io.out(
      pictures === null
        ? '  stories with a picture: unknown (the board was not read)'
        : `  stories with a picture: ${pictures} of ${current.storyIds.length}`,
    );
  }
}
