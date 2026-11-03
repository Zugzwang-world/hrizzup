import { NextResponse } from 'next/server';
import { currentCommit, currentEnvironment, currentRegion } from '@/lib/env.ts';
import { checkAuth, checkDatabase, checkRedis, checkStorage } from '@/lib/health/checks.ts';

export const dynamic = 'force-dynamic';

/**
 * The health page (blueprint rule 4 and section 6): which environment and region this is,
 * which commit it was built from, and whether each service answers. It shows no keys,
 * addresses or error text. A service that isn't set up in this environment (production,
 * until Part 10) shows `not_configured`; any configured service that fails makes it 503.
 */
export async function GET() {
  const [database, redis, storage, auth] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkStorage(),
    checkAuth(),
  ]);
  const services = { database, redis, storage, auth };
  const results = Object.values(services);
  const failing = results.some((r) => r.status === 'error');
  const configured = results.some((r) => r.status === 'ok');
  const body = {
    status: failing ? 'error' : configured ? 'ok' : 'not_configured',
    environment: currentEnvironment(),
    region: currentRegion(),
    commit: currentCommit(),
    checkedAt: new Date().toISOString(),
    services,
  };
  return NextResponse.json(body, {
    status: failing ? 503 : 200,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
