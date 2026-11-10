import type { Environment } from '@hrizzup/core';

/** Environment variables, as a plain map (so tests can pass their own). */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * Which of the four environments this code is running in (blueprint section 3).
 *
 * On Vercel, `VERCEL_TARGET_ENV` names the environment: `production`, `preview`, or a custom
 * environment's name (`staging`). Anything unexpected on Vercel counts as production, the
 * safest reading: production never shows the test pages or the environment badge. Off
 * Vercel (this Mac), it is development.
 */
export function currentEnvironment(env: Env = process.env): Environment {
  if (!env.VERCEL) return 'development';
  switch (env.VERCEL_TARGET_ENV ?? env.VERCEL_ENV) {
    case 'staging':
      return 'staging';
    case 'preview':
      return 'preview';
    default:
      return 'production';
  }
}

/**
 * Bots' API keys (PLAN.md step 3.5a) work on staging, its previews and this Mac, the demo, and not on
 * production until its API opens at launch (step 5.2): there, making a key answers "not set up
 * here" and a request with a key is refused.
 */
export function apiKeysEnabled(env: Env = process.env): boolean {
  return currentEnvironment(env) !== 'production';
}

/**
 * The public API's docs page, its OpenAPI file and llms.txt (PLAN.md step 3.5a) describe staging,
 * the demo: they're on staging, its previews and this Mac, and not on production until its API
 * opens at launch.
 */
export function apiDocsEnabled(env: Env = process.env): boolean {
  return currentEnvironment(env) !== 'production';
}

/** The sign-in test page and Google sign-in run everywhere except production, until launch. */
export function signInTestEnabled(env: Env = process.env): boolean {
  return currentEnvironment(env) !== 'production';
}

/**
 * The market console (its pages and its calls in the typed API) follows the same production rule
 * as the sign-in routes: it exists everywhere except production until launch, and on production
 * it answers "not found" to everyone, admins included (PLAN.md step 1.7c).
 */
export function consoleEnabled(env: Env = process.env): boolean {
  return signInTestEnabled(env);
}

/** The region the function runs in (`bom1` on Vercel), or `local` on this Mac. */
export function currentRegion(env: Env = process.env): string {
  return env.VERCEL_REGION ?? (env.VERCEL ? 'unknown' : 'local');
}

/** The commit this deployment was built from, or `local`. */
export function currentCommit(env: Env = process.env): string {
  return env.VERCEL_GIT_COMMIT_SHA ?? 'local';
}
