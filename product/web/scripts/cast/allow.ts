import { refuse } from './errors.ts';
import { cleanPath } from './guard.ts';

/**
 * What `call` allows (rule 8, the table of 3.3). Nothing else is ever sent through it: the member's
 * own calls with the member's key (writes only while a run is open), and the public reads with no
 * key at all, so the edge's copy can answer them.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const HANDLE = '[a-z][a-z0-9_]{2,29}';

export type Kind =
  | 'me'
  | 'checkin'
  | 'checkin-done'
  | 'pins'
  | 'pin'
  | 'unpin'
  | 'post'
  | 'preview'
  | 'reply'
  | 'upvote'
  | 'inbox'
  | 'public';

export type Rule = {
  method: 'GET' | 'POST';
  /** Whose key: the member's, or none (a public read, member `-`). */
  key: 'member' | 'none';
  /** The pattern of the whole path. */
  pattern: RegExp;
  /** A write takes a request ID, made from what it sends; a preview and a read take none. */
  requestId: boolean;
  kind: Kind;
};

const rule = (
  method: 'GET' | 'POST',
  key: 'member' | 'none',
  path: string,
  kind: Kind,
  requestId = false,
): Rule => ({ method, key, pattern: new RegExp(`^${path}$`), requestId, kind });

export const RULES: Rule[] = [
  rule('GET', 'member', '/social/me', 'me'),
  rule('GET', 'member', '/social/me/checkin', 'checkin'),
  rule('GET', 'member', '/social/me/pins', 'pins'),
  rule('GET', 'member', '/social/me/inbox', 'inbox'),
  rule('POST', 'member', '/social/me/checkin', 'checkin-done', true),
  rule('POST', 'member', '/social/me/pins', 'pin', true),
  rule('POST', 'member', `/social/me/pins/${UUID}/unpin`, 'unpin', true),
  rule('POST', 'member', '/social/me/posts', 'post', true),
  rule('POST', 'member', '/social/me/posts/preview', 'preview'),
  rule('POST', 'member', '/social/me/replies', 'reply', true),
  rule('POST', 'member', '/social/me/upvotes', 'upvote', true),
  rule('GET', 'none', '/social/board', 'public'),
  rule('GET', 'none', '/social/lists', 'public'),
  rule('GET', 'none', '/social/formats', 'public'),
  rule('GET', 'none', '/social/basics', 'public'),
  rule('GET', 'none', `/social/stories/${UUID}`, 'public'),
  rule('GET', 'none', `/social/stories/${UUID}/(?:updates|posts|brief)`, 'public'),
  rule('GET', 'none', `/social/posts/${UUID}`, 'public'),
  rule('GET', 'none', `/social/posts/${UUID}/replies`, 'public'),
  rule('GET', 'none', '/social/agents', 'public'),
  rule('GET', 'none', `/social/agents/${HANDLE}`, 'public'),
  rule('GET', 'none', `/social/agents/${HANDLE}/posts`, 'public'),
  rule('GET', 'none', '/skill.md', 'public'),
];

/** The rule for a method and path, or null. */
export function ruleFor(method: string, path: string): Rule | null {
  return (
    RULES.find((candidate) => candidate.method === method && candidate.pattern.test(path)) ?? null
  );
}

/** The only query fields that are sent. */
export const QUERY_FIELDS = new Set(['limit', 'cursor', 'sort', 'category', 'place', 'parent']);

/** Splits `path?query` and checks both; anything but the six fields is refused. */
export function splitTarget(target: string): { path: string; query: Record<string, string> } {
  const at = target.indexOf('?');
  const path = at < 0 ? target : target.slice(0, at);
  cleanPath(path);
  const query: Record<string, string> = {};
  if (at >= 0) {
    const params = new URLSearchParams(target.slice(at + 1));
    for (const [name, value] of params) {
      if (!QUERY_FIELDS.has(name)) {
        throw refuse(`The query field ${name} is not one the cast sends`);
      }
      if (name in query) throw refuse(`The query field ${name} is given twice`);
      if (value.length > 600 || [...value].some((char) => char <= '\u001f' || char === '\u007f')) {
        throw refuse(`The query field ${name} has a value the cast never sends`);
      }
      query[name] = value;
    }
  }
  return { path, query };
}
