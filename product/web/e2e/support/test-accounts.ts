import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import projects from '../../../../infra/supabase/project/settings.json' with { type: 'json' };

/**
 * Test accounts for the automatic checks. They exist only in staging's Supabase project, which
 * previews share. They have no password anyone knows (Supabase gives an account made this way a
 * random one it never shows, and refuses any session made with a password) and no Google
 * identity, so nobody can sign in to them; a check gets a session for one only by asking staging's
 * own server key for a one-time sign-in token, which no email ever carries. Production is a
 * separate Supabase project, so these accounts don't exist there, and this file refuses to run
 * against any project but staging's.
 *
 * Every check run makes its own (support/run.ts): an account for each browser engine's signed-in
 * screens and journeys, and one for each journey that trades, each starting with exactly the
 * starting balance its signup gives it (Ṁ1,000, from the house). The only account runs share is
 * the console's admin test account, below, used only for the run's own markets.
 */
export const ENGINES = ['chromium', 'webkit'] as const;

export type Engine = (typeof ENGINES)[number];

/**
 * The market console's test account: an admin on staging (and so on previews), made one by the
 * reviewed migration that names its ID (infra/supabase/migrations/*_staging_admins.sql), for the
 * console's journeys. Like the accounts above it has no password and no Google identity, so only
 * a check holding staging's server key can sign in to it. The two accounts above aren't admins,
 * so the journeys also check what everyone else gets.
 */
export const ADMIN_TEST_ACCOUNT = 'delivered+market-admin@resend.dev';

const STAGING_REF = projects.environments.staging.project_ref;

export type StagingKeys = { url: string; publishableKey: string; secretKey: string };
type Keys = StagingKeys;

/** Staging's keys from the environment (Doppler `stg_preview` or `dev`), or null. */
export function stagingKeys(env = process.env): Keys | null {
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) return null;
  if (url !== `https://${STAGING_REF}.supabase.co`) {
    throw new Error("Test accounts exist only on staging's Supabase project; refusing another one");
  }
  return { url, publishableKey, secretKey };
}

function admin(keys: Keys) {
  return createClient(keys.url, keys.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Every account in staging's project, a page of 1,000 at a time (only for the script). */
async function allUsers(client: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Couldn't list staging's users (${error.status})`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

/**
 * Creates the account if it is missing, and keeps it marked as a test account. Only the script
 * that confirms the console's admin test account uses this (scripts/test-accounts.ts): it reads
 * every account, so no check run does.
 */
export async function ensureTestAccount(keys: Keys, email: string): Promise<string> {
  const client = admin(keys);
  const existing = (await allUsers(client)).find((u) => u.email === email);
  const attributes = {
    app_metadata: { test_account: true },
    user_metadata: { full_name: 'Screen check' },
  };
  if (existing) {
    if (existing.app_metadata?.test_account !== true) {
      const { error: updateError } = await client.auth.admin.updateUserById(
        existing.id,
        attributes,
      );
      if (updateError) throw new Error(`Couldn't mark ${email} as a test account`);
    }
    return existing.id;
  }
  const { data: created, error: createError } = await client.auth.admin.createUser({
    email,
    email_confirm: true,
    ...attributes,
  });
  if (createError || !created.user)
    throw new Error(`Couldn't create ${email} (${createError?.status})`);
  return created.user.id;
}

/** Only ever one of a run's own addresses (support/run.ts). */
function ownRunAddress(email: string) {
  if (!email.startsWith('delivered+run-') || !email.endsWith('@resend.dev')) {
    throw new Error("Not one of the runs' own addresses");
  }
}

/**
 * A new account of the run's, marked as a test account; its signup gives it its starting balance.
 * With `password`, the account gets that password, which nobody can do through the website: only
 * the trial of a password sign-in uses it, with staging's server key. Returns its ID. Runs never
 * delete their accounts: the books keep their history.
 */
export async function createRunAccount(
  keys: Keys,
  email: string,
  password?: string,
): Promise<string> {
  ownRunAddress(email);
  const { data, error } = await admin(keys).auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { test_account: true },
    user_metadata: { full_name: 'Check run' },
    ...(password ? { password } : {}),
  });
  if (error || !data.user) throw new Error(`Couldn't create ${email} (${error?.status})`);
  return data.user.id;
}

/**
 * A working sign-in code for `email`, through staging's admin access instead of an inbox. It
 * replaces the code in the email just sent (Resend's test inbox drops that email anyway).
 */
export async function readSignInCode(keys: Keys, email: string): Promise<string> {
  const { data, error } = await admin(keys).auth.admin.generateLink({ type: 'magiclink', email });
  const code = data.properties?.email_otp;
  if (error || !code) throw new Error(`Couldn't read a code for ${email} (${error?.status})`);
  return code;
}

export type SessionCookie = { name: string; value: string };

/** A session for a test account: the website's own cookies, and the app's tokens. */
export type TestSession = { cookies: SessionCookie[]; accessToken: string; refreshToken: string };

/**
 * A fresh session for a test account, as the cookies the website itself would set (so a browser
 * carrying them is signed in exactly as after a real sign-in) and as the tokens the app holds.
 * Nothing is emailed. With `create`, the account is one of the run's, made first.
 *
 * Each account has one one-time token at a time: asking for a new one cancels the last. Runs share
 * only the console's admin test account, so another run may cancel its token between asking and
 * using it. Staging then refuses it (403), and this asks again, a few times, after a short random
 * wait.
 */
export async function sessionFor(
  keys: Keys,
  email: string,
  options: { create?: boolean } = {},
): Promise<TestSession> {
  if (options.create) await createRunAccount(keys, email);
  const attempts = 5;
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await admin(keys).auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data.properties?.hashed_token) {
      throw new Error(`Couldn't get a one-time sign-in token for ${email} (${error?.status})`);
    }
    const jar = new Map<string, string>();
    const site = createServerClient(keys.url, keys.publishableKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => {
          for (const c of list) {
            if (c.value) jar.set(c.name, c.value);
            else jar.delete(c.name);
          }
        },
      },
    });
    const { data: verified, error: verifyError } = await site.auth.verifyOtp({
      token_hash: data.properties.hashed_token,
      type: 'magiclink',
    });
    if (verifyError?.status === 403 && attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 2000));
      continue;
    }
    if (verifyError) throw new Error(`Staging refused the one-time token (${verifyError.status})`);
    const session = verified.session;
    if (jar.size === 0 || !session) throw new Error('No session came back');
    return {
      cookies: [...jar].map(([name, value]) => ({ name, value })),
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  }
}

/** A fresh session for a test account, as the website's own cookies. */
export async function testSessionCookies(
  keys: Keys,
  email: string,
  options: { create?: boolean } = {},
): Promise<SessionCookie[]> {
  return (await sessionFor(keys, email, options)).cookies;
}
