import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
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

/** Every account in staging's project, a page of 1,000 at a time. */
async function allUsers(client: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Couldn't list staging's users (${error.status})`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

/** Creates the test account if it is missing, and keeps it marked as a test account. */
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

/**
 * Accounts the sign-in journeys make for themselves (journeys/sign-in.spec.ts): a fresh address
 * at Resend's test inbox for every run, so runs of several pull requests never share one
 * (Supabase sends at most one email a minute to an address, and the test accounts above get
 * one-time tokens all the time, which count too). Each is deleted when its journey ends, and
 * any left behind by a broken run is swept at the start of the next (`sweepJourneyAccounts`).
 */
const JOURNEY = 'delivered+journey-';

/** What a journey's account is for: a reader who signs in with an email code. */
export type JourneyPurpose = 'code';

export function journeyAddress(purpose: JourneyPurpose, engine: Engine): string {
  return `${JOURNEY}${purpose}-${engine}-${randomUUID().slice(0, 8)}@resend.dev`;
}

function ownJourneyAddress(email: string) {
  if (!email.startsWith(JOURNEY) || !email.endsWith('@resend.dev')) {
    throw new Error("Not one of the journeys' own addresses");
  }
}

/** An account that already exists, for the journey of a returning reader. */
export async function createJourneyAccount(keys: Keys, email: string): Promise<void> {
  ownJourneyAddress(email);
  const { error } = await admin(keys).auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`Couldn't create ${email} (${error.status})`);
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

/** Deletes a journey's account: only ever one of the journeys' own addresses. */
export async function deleteJourneyAccount(keys: Keys, email: string): Promise<void> {
  ownJourneyAddress(email);
  const client = admin(keys);
  for (const user of (await allUsers(client)).filter((u) => u.email === email)) {
    await client.auth.admin.deleteUser(user.id);
  }
}

/** Deletes journeys' accounts more than an hour old, which a broken run left behind. */
export async function sweepJourneyAccounts(keys: Keys): Promise<void> {
  const client = admin(keys);
  const hourAgo = Date.now() - 3_600_000;
  for (const user of await allUsers(client)) {
    if (user.email?.startsWith(JOURNEY) && Date.parse(user.created_at) < hourAgo) {
      await client.auth.admin.deleteUser(user.id);
    }
  }
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
