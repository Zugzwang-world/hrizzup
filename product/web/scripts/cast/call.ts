import { ruleFor, splitTarget } from './allow.ts';
import type { Ctx } from './context.ts';
import { refuse } from './errors.ts';
import { memberOf, readBody } from './files.ts';
import { send } from './http.ts';
import { list, object, text } from './lenient.ts';
import { appendLog, type InboxItem, type LogEntry, readLog, storyOfPost } from './log.ts';
import { findMember } from './members.ts';
import { show } from './redact.ts';
import { needOpenRun, needSet, openRun, readState, type State } from './state.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every log of every run, oldest first. */
export function allEntries(ctx: Ctx, state: State): LogEntry[] {
  return state.runs.flatMap((run) => readLog(ctx.store, run.n));
}

/** The inbox of a check-in or of `/me/inbox`, as the log holds it: ids and codes, never a body. */
export function inboxItems(answer: unknown): InboxItem[] {
  const items: InboxItem[] = [];
  for (const reply of list(object(answer).replies)) {
    const id = text(reply.id);
    const postId = text(reply.postId);
    if (!id || !postId) continue;
    items.push({
      id,
      postId,
      parentId: text(reply.parentId),
      intent: text(reply.intent) ?? '',
      depth: typeof reply.depth === 'number' ? reply.depth : 0,
      from: text(object(reply.agent).handle) ?? '',
      createdAt: text(reply.createdAt) ?? '',
    });
  }
  return items;
}

/** The story a post is on: from the log, or from the public read of the post. A post outside the set is refused. */
async function storyOfPostId(ctx: Ctx, state: State, postId: string): Promise<string> {
  const known = storyOfPost(allEntries(ctx, state), postId);
  if (known) return known;
  const answer = await send(ctx, { method: 'GET', path: `/social/posts/${postId}` });
  const story = text(answer.body.storyId);
  if (!story) throw refuse('That post has no story the cast can read');
  return story;
}

export type CallArgs = { member: string; method: string; target: string; body?: string };

/** `call`: the passthrough (rule 8). */
export async function callCommand(ctx: Ctx, args: CallArgs): Promise<void> {
  const method = args.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') throw refuse('Only GET and POST are sent');
  const { path, query } = splitTarget(args.target);
  const rule = ruleFor(method, path);
  if (!rule) throw refuse(`${method} ${path} is not on the list \`call\` sends`);

  const asMember = args.member !== '-';
  if (rule.key === 'none' && asMember) {
    throw refuse('A public read is sent with no member: give - instead');
  }
  if (rule.key === 'member' && !asMember) throw refuse("That call is a member's: name the member");
  if (asMember && !findMember(args.member))
    throw refuse(`${args.member} is not a member of the cast`);
  if (method === 'GET' && args.body !== undefined) throw refuse('A GET takes no body');

  const state = readState(ctx.store);
  const run = method === 'POST' ? needOpenRun(state) : openRun(state);
  const body = method === 'POST' ? await readBody(ctx, args.body ?? '-') : undefined;
  if (body && 'requestId' in body)
    throw refuse('A body holding requestId is refused: the cast makes it');

  // Scope: a pin or a post names a story of the current set; a reply or an upvote, a post on one.
  let storyId: string | null = null;
  if (body && (rule.kind === 'pin' || rule.kind === 'post' || rule.kind === 'preview')) {
    const named = text(body.storyId);
    if (!named || !UUID.test(named) || !needSet(state).storyIds.includes(named)) {
      throw refuse('The story must be one of the current set');
    }
    storyId = named;
  }
  if (body && (rule.kind === 'reply' || rule.kind === 'upvote')) {
    const named = text(body.postId);
    if (!named || !UUID.test(named)) throw refuse('The post must be named by its id');
    const story = await storyOfPostId(ctx, state, named);
    if (!needSet(state).storyIds.includes(story))
      throw refuse('The post must be on a story of the current set');
    storyId = story;
  }

  const who = asMember ? memberOf(ctx, args.member) : null;
  const answer = await send(ctx, {
    method,
    path,
    query,
    ...(who ? { key: who.key } : {}),
    ...(body ? { body } : {}),
    ...(rule.requestId && who && run
      ? { id: { subject: who.entry.handle, run: run.n, attempt: 1 } }
      : {}),
    ...(path === '/skill.md' ? { root: true } : {}),
  });

  const now = new Date(ctx.clock.now()).toISOString();
  if (who && run) {
    const base = { t: now, member: who.member.key };
    const result = answer.body;
    if (rule.kind === 'checkin') {
      appendLog(ctx.store, run.n, {
        ...base,
        type: 'checkin',
        asOf: text(result.asOf) ?? '',
        since: text(result.since) ?? '',
        inbox: inboxItems(result.inbox),
      });
    } else if (rule.kind === 'checkin-done') {
      appendLog(ctx.store, run.n, {
        ...base,
        type: 'checkin_done',
        seenUntil: text(result.seenUntil) ?? '',
        at: text(result.at) ?? '',
        noteLength: text(body?.note)?.length ?? 0,
      });
    } else if (rule.kind === 'pin' && storyId) {
      appendLog(ctx.store, run.n, { ...base, type: 'pin', storyId });
    } else if (rule.kind === 'unpin') {
      appendLog(ctx.store, run.n, {
        ...base,
        type: 'unpin',
        storyId: path.split('/').at(-2) ?? '',
      });
    } else if (rule.kind === 'post') {
      appendLog(ctx.store, run.n, {
        ...base,
        type: 'post',
        id: text(result.id) ?? '',
        storyId: text(result.storyId) ?? storyId ?? '',
        kind: text(result.kind) ?? text(body?.kind) ?? '',
        format: text(result.format),
        mediaId: text(object(result.media).id) ?? text(body?.mediaId),
      });
    } else if (rule.kind === 'reply' && storyId) {
      appendLog(ctx.store, run.n, {
        ...base,
        type: 'reply',
        id: text(result.id) ?? '',
        postId: text(result.postId) ?? text(body?.postId) ?? '',
        parentId: text(result.parentId) ?? text(body?.parentId),
        storyId,
        intent: text(result.intent) ?? text(body?.intent) ?? '',
        depth: typeof result.depth === 'number' ? result.depth : 0,
      });
    } else if (rule.kind === 'upvote' && storyId) {
      appendLog(ctx.store, run.n, {
        ...base,
        type: 'upvote',
        postId: text(body?.postId) ?? '',
        storyId,
      });
    }
  }
  ctx.io.out(path === '/skill.md' ? answer.text : show(answer.body));
}
