import projects from '../../../../infra/supabase/project/settings.json' with { type: 'json' };
import { type StagingKeys, stagingKeys } from '../../e2e/support/test-accounts.ts';
import { STAGING_ORIGIN } from '../../lib/auth-relay.ts';
import { refuse } from './errors.ts';

/**
 * Staging only (rule 3). The API is always `${STAGING_ORIGIN}/api/v1` and nothing changes it: every
 * address is built here, from a path that passes `cleanPath`, and asserted again before it is sent.
 * Upload PUTs go only to Cloudflare's R2 for staging's uploads bucket.
 */

export const API_BASE = `${STAGING_ORIGIN}/api/v1`;

/** The one address outside `/api/v1` the cast reads: the live skill file. */
export const SKILL_PATH = '/skill.md';

/** Staging's uploads bucket and the host an upload link must end in (`infra/cloudflare/r2/`, `lib/social/media/storage.ts`: path-style links). */
export const UPLOAD_HOST_SUFFIX = '.r2.cloudflarestorage.com';
export const UPLOAD_BUCKET = 'hrizzup-staging-uploads';

const PATH_CHARS = /^\/[A-Za-z0-9._\-/]*$/;

/** A path under the API: plain characters only, no `//`, no `.` or `..`, nothing encoded, no query. */
export function cleanPath(path: string): string {
  if (typeof path !== 'string' || !PATH_CHARS.test(path)) {
    throw refuse('That path has characters the cast never sends');
  }
  if (path.includes('//')) throw refuse('That path has an empty part (//)');
  if (path.split('/').some((part) => part === '.' || part === '..')) {
    throw refuse('That path goes up a folder (..)');
  }
  return path;
}

/**
 * Checks an address is staging's, over https, with no user, no port, no encoded slash and no `..`,
 * and (for the API) under `/api/v1/` or exactly the skill file. Returns it parsed.
 */
export function assertStagingUrl(text: string): URL {
  // The path is what is checked for a hidden slash or a step up a folder: a cursor in the query may hold anything its encoding does.
  const beforeQuery = text.split(/[?#]/, 1)[0] ?? '';
  if (/%2f|%5c|\\|\.\./i.test(beforeQuery)) {
    throw refuse('That address is refused: it hides a slash or goes up a folder');
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw refuse('That address is refused: it is not an address');
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== STAGING_ORIGIN ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    throw refuse(`The cast only talks to ${STAGING_ORIGIN}`);
  }
  if (!url.pathname.startsWith('/api/v1/') && url.pathname !== SKILL_PATH) {
    throw refuse('That address is outside the API');
  }
  return url;
}

/** The address of an API call: `path` under `/api/v1`, with an optional query. */
export function apiUrl(path: string, query?: Record<string, string>): string {
  cleanPath(path);
  const url = new URL(`${API_BASE}${path}`);
  for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
  return assertStagingUrl(url.toString()).toString();
}

/** The live skill file's address. */
export function skillUrl(): string {
  return assertStagingUrl(`${STAGING_ORIGIN}${SKILL_PATH}`).toString();
}

/**
 * An upload link, before any byte goes to it: https, a host ending `.r2.cloudflarestorage.com`, no
 * user or port, the path under staging's uploads bucket, and headers that never carry credentials.
 */
export function assertUploadLink(address: string, headers: Record<string, string>): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw refuse('The upload link is not an address: refused');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith(UPLOAD_HOST_SUFFIX) ||
    url.hostname.length <= UPLOAD_HOST_SUFFIX.length ||
    url.username !== '' ||
    url.password !== '' ||
    (url.port !== '' && url.port !== '443') ||
    !url.pathname.startsWith(`/${UPLOAD_BUCKET}/`) ||
    /%2f|\.\./i.test(url.pathname)
  ) {
    throw refuse("The upload link is not for staging's uploads bucket: refused");
  }
  for (const name of Object.keys(headers)) {
    if (/^(authorization|cookie|proxy-authorization|x-api-key)$/i.test(name)) {
      throw refuse('The upload link came with a credential header: refused');
    }
  }
  return url;
}

/** The origin, code and email a ready message names (`readyMessage()` in `lib/api/social/admin.ts`), or null when it isn't in that form. */
export function readyMessageParts(
  message: string,
): { origin: string; code: string; email: string } | null {
  const found =
    /^You're invited to Hrizzup's agent beta\. Give your agent this one line: Read (\S+?)\/skill\.md and join Hrizzup with invite code (\S+?)\. It will give you a claim link: open it and sign in with (\S+?)\.$/.exec(
      message,
    );
  if (!found) return null;
  return { origin: found[1] ?? '', code: found[2] ?? '', email: found[3] ?? '' };
}

/**
 * Staging's keys when this run has them, and a refusal for a production Doppler config (rule 3):
 * whenever `SUPABASE_URL` is set, `stagingKeys()` runs, which refuses any project but staging's.
 */
export function checkEnvironment(env: Record<string, string | undefined>): StagingKeys | null {
  if (/^prd/i.test(env.DOPPLER_CONFIG ?? '')) {
    throw refuse('The cast never runs with a production Doppler config');
  }
  if (!env.SUPABASE_URL) return null;
  // `stagingKeys()` looks at the address only when all three keys are set; a lone wrong address is refused here.
  if (
    env.SUPABASE_URL.replace(/\/$/, '') !==
    `https://${projects.environments.staging.project_ref}.supabase.co`
  ) {
    throw refuse("SUPABASE_URL is not staging's Supabase project: refused");
  }
  try {
    return stagingKeys(env as NodeJS.ProcessEnv);
  } catch {
    throw refuse("SUPABASE_URL is not staging's Supabase project: refused");
  }
}
