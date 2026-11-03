import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullConfig } from '@playwright/test';
import {
  type Engine,
  stagingKeys,
  TEST_ACCOUNTS,
  testSessionCookies,
} from './support/test-accounts.ts';

/**
 * Before the screen check: find out which environment the address under test is (from its
 * /api/health), and, outside production, sign each browser engine's test account in, so
 * the signed-in pages are checked too. The sessions are saved in a temporary folder
 * outside the repository and never uploaded.
 */
export default async function globalSetup(config: FullConfig) {
  const use = config.projects[0]?.use;
  const baseURL = use?.baseURL ?? 'http://localhost:3000';
  // Only the bypass itself: the "set a cookie" header makes Vercel answer with a redirect
  // that sets a cookie, which browsers keep but this plain request can't.
  const { 'x-vercel-set-bypass-cookie': _cookie, ...headers } = (use?.extraHTTPHeaders ??
    {}) as Record<string, string>;

  const response = await fetch(new URL('/api/health', baseURL), { headers, redirect: 'manual' });
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`${baseURL}/api/health answered ${response.status}; is the address right?`);
  }
  const { environment } = (await response.json()) as { environment: string };
  process.env.SCREEN_CHECK_ENVIRONMENT = environment;

  const keys = environment === 'production' ? null : stagingKeys();
  if (!keys) return;
  const folder = await mkdtemp(join(tmpdir(), 'hrizzup-screen-check-'));
  const { hostname, protocol } = new URL(baseURL);
  for (const engine of Object.keys(TEST_ACCOUNTS) as Engine[]) {
    const cookies = await testSessionCookies(keys, TEST_ACCOUNTS[engine]);
    const state = {
      cookies: cookies.map(({ name, value }) => ({
        name,
        value,
        domain: hostname,
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: protocol === 'https:',
        sameSite: 'Lax' as const,
      })),
      origins: [],
    };
    const file = join(folder, `${engine}.json`);
    await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    process.env[`SIGNED_IN_STATE_${engine.toUpperCase()}`] = file;
  }
}
