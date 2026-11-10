import { createHash, timingSafeEqual } from 'node:crypto';
import { type JobName, runJob } from '@hrizzup/perps';
import { perpSource } from '@/lib/api/perps.ts';
import { database } from '@/lib/db.ts';

/**
 * The perp's scheduled jobs (PLAN.md step 3.4a), as Supabase Cron calls them: the database's own
 * schedule (a migration, like every database change) posts here through pg_net, `?job=tick` every
 * 5 seconds (the next stand-in price, with its liquidations) and `?job=funding` for the hourly
 * funding, but only while a perp is switched on and someone holds a position on it: the database
 * asks `perps.due` first, so a perp that's off costs nothing. Each run is the same steps as a trade,
 * with the same engine code (`@hrizzup/perps`, `runJob`); each price and each funding happens once,
 * however the runs overlap.
 *
 * The call carries this environment's `PERP_JOBS_SECRET` as a bearer token (Supabase Vault holds
 * the database's copy). Anything else, by any method, and every call where no secret is set (this
 * Mac, production while its perp is off), gets one plain "no such call" (404), never kept, so the
 * address says nothing about itself. A job run's answer (what it did, perp IDs only) goes back to
 * pg_net, which keeps it a few hours (net._http_response; infra/supabase/perps_jobs.py check reads
 * the latest).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A run on every due perp: well inside this, or the next run carries on where it left off. */
export const maxDuration = 30;

const JOBS: readonly JobName[] = ['tick', 'funding'];

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };

function noSuchAddress(): Response {
  return Response.json(
    { defined: false, code: 'NOT_FOUND', status: 404, message: 'No such call' },
    { status: 404, headers: NO_STORE },
  );
}

const digest = (text: string) => createHash('sha256').update(text).digest();

/**
 * Whether the call carries this environment's jobs secret, compared in constant time. The secret is
 * read trimmed, as infra/supabase/perps_jobs.py writes Vault's copy, so a stray line break in it
 * can't make the two differ unseen; one too short to be ours counts as none.
 */
export function carriesTheSecret(
  authorization: string | null,
  secret: string | undefined = process.env.PERP_JOBS_SECRET,
): boolean {
  const ours = secret?.trim();
  if (!ours || ours.length < 32 || !authorization) return false;
  return timingSafeEqual(digest(authorization.trim()), digest(`Bearer ${ours}`));
}

/** Every other method: the same answer as a call without the secret. */
export async function GET(): Promise<Response> {
  return noSuchAddress();
}
export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;

export async function POST(request: Request): Promise<Response> {
  if (!carriesTheSecret(request.headers.get('authorization'))) return noSuchAddress();
  const job = new URL(request.url).searchParams.get('job');
  if (!JOBS.includes(job as JobName)) {
    return Response.json(
      { code: 'BAD_REQUEST', message: 'The job is tick or funding' },
      { status: 400, headers: NO_STORE },
    );
  }
  const pool = database();
  if (!pool) {
    return Response.json(
      { code: 'SERVICE_UNAVAILABLE', message: 'The database is not set up here' },
      { status: 503, headers: NO_STORE },
    );
  }
  const run = await runJob(pool, job as JobName, perpSource());
  // A perp whose step failed is tried again on the next run; the answer says which, by ID only.
  return Response.json(run, { status: run.failed.length > 0 ? 500 : 200, headers: NO_STORE });
}
