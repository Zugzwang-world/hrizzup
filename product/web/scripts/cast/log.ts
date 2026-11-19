import { redact } from './redact.ts';
import type { Store } from './store.ts';

/**
 * The run's log (rule 9): `log/run-<n>.jsonl`, ids only, never a body, a note's words, a key or a
 * link. A line is one thing the cast did or was told. Totals made from it count distinct things:
 * post ids, reply ids and (member, post) upvotes, so a replayed command logs again and adds nothing.
 */

export type InboxItem = {
  id: string;
  postId: string;
  parentId: string | null;
  intent: string;
  depth: number;
  from: string;
  createdAt: string;
};

type Base = { t: string; member: string };

export type LogEntry =
  | (Base & { type: 'checkin'; asOf: string; since: string; inbox: InboxItem[] })
  | (Base & { type: 'checkin_done'; seenUntil: string; at: string; noteLength: number })
  | (Base & { type: 'pin'; storyId: string })
  | (Base & { type: 'unpin'; storyId: string })
  | (Base & {
      type: 'post';
      id: string;
      storyId: string;
      kind: string;
      format: string | null;
      mediaId: string | null;
    })
  | (Base & {
      type: 'reply';
      id: string;
      postId: string;
      parentId: string | null;
      storyId: string;
      intent: string;
      depth: number;
    })
  | (Base & { type: 'upvote'; postId: string; storyId: string })
  | (Base & { type: 'upload'; mediaId: string; kind: string; fileSha256: string });

export const logFile = (run: number) => `log/run-${run}.jsonl`;

export function appendLog(store: Store, run: number, entry: LogEntry): void {
  store.append(logFile(run), `${redact(JSON.stringify(entry))}\n`);
}

export function readLog(store: Store, run: number): LogEntry[] {
  const text = store.readText(logFile(run));
  if (!text) return [];
  const entries: LogEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch {
      // A line cut short by a crash is skipped: the log only ever has to be right about what it holds whole.
    }
  }
  return entries;
}

export type Totals = {
  posts: Map<string, { member: string; storyId: string; kind: string }>;
  replies: Map<
    string,
    {
      member: string;
      postId: string;
      parentId: string | null;
      storyId: string;
      intent: string;
      depth: number;
    }
  >;
  /** `member|postId` */
  upvotes: Map<string, { member: string; postId: string; storyId: string }>;
};

/** What the log holds, counted as distinct things. */
export function totalsOf(entries: LogEntry[]): Totals {
  const totals: Totals = { posts: new Map(), replies: new Map(), upvotes: new Map() };
  for (const entry of entries) {
    if (entry.type === 'post') {
      totals.posts.set(entry.id, {
        member: entry.member,
        storyId: entry.storyId,
        kind: entry.kind,
      });
    } else if (entry.type === 'reply') {
      totals.replies.set(entry.id, {
        member: entry.member,
        postId: entry.postId,
        parentId: entry.parentId,
        storyId: entry.storyId,
        intent: entry.intent,
        depth: entry.depth,
      });
    } else if (entry.type === 'upvote') {
      totals.upvotes.set(`${entry.member}|${entry.postId}`, {
        member: entry.member,
        postId: entry.postId,
        storyId: entry.storyId,
      });
    }
  }
  return totals;
}

/** The story each post of the logs is on, for the scope of a reply or an upvote. */
export function storyOfPost(entries: LogEntry[], postId: string): string | null {
  for (const entry of entries) {
    if (entry.type === 'post' && entry.id === postId) return entry.storyId;
  }
  return null;
}
