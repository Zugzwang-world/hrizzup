import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import projects from '../../../../infra/supabase/project/settings.json' with { type: 'json' };

/**
 * Test accounts for the automatic checks (runbook step 9.6). They exist only in staging's
 * Supabase project, which previews share. They have no password and no Google identity,
 * so nobody can sign in to them; a check gets a session for one only by asking staging's
 * own server key for a one-time sign-in token, which no email ever carries. Production is
 * a separate Supabase project, so these accounts don't exist there, and this file refuses
 * to run against any project but staging's.
 */
export const TEST_ACCOUNTS = {
  chromium: 'delivered+screen-check-chromium@resend.dev',
  webkit: 'delivered+screen-check-webkit@resend.dev',
} as const;
// resend.dev addresses are Resend's own test inboxes: an email sent to one is accepted and
// dropped without affecting our sending reputation, so nothing sent by mistake bounces.

export type Engine = keyof typeof TEST_ACCOUNTS;

const STAGING_REF = projects.environments.staging.project_ref;

type Keys = { url: string; publishableKey: string; secretKey: string };

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

/** Creates the test account if it is missing, and keeps it marked as a test account. */
export async function ensureTestAccount(keys: Keys, email: string): Promise<string> {
  const client = admin(keys);
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Couldn't list staging's users (${error.status})`);
  const existing = data.users.find((u) => u.email === email);
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

export type SessionCookie = { name: string; value: string };

/**
 * A fresh session for a test account, as the cookies the website itself would set, so a
 * browser carrying them is signed in exactly as after a real sign-in. Nothing is emailed.
 *
 * Each account has one one-time token at a time: asking for a new one cancels the last. Checks
 * of several pull requests, and runs on this Mac, share the two accounts, so one may cancel
 * another's token between asking and using it. Staging then refuses it (403), and this asks
 * again, a few times, after a short random wait.
 */
export async function testSessionCookies(keys: Keys, email: string): Promise<SessionCookie[]> {
  await ensureTestAccount(keys, email);
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
    const { error: verifyError } = await site.auth.verifyOtp({
      token_hash: data.properties.hashed_token,
      type: 'magiclink',
    });
    if (verifyError?.status === 403 && attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 2000));
      continue;
    }
    if (verifyError) throw new Error(`Staging refused the one-time token (${verifyError.status})`);
    if (jar.size === 0) throw new Error('No session cookie came back');
    return [...jar].map(([name, value]) => ({ name, value }));
  }
}
