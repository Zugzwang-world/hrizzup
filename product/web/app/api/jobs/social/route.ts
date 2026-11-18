import { createHash, timingSafeEqual } from 'node:crypto';
import { isUuid } from '@hrizzup/social/uuid';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import { socialEnabled } from '@/lib/env.ts';
import { DEADLINE_MS, framed } from '@/lib/social/jobs/budget.ts';
import { runCounts } from '@/lib/social/jobs/counts.ts';
import { runMinute } from '@/lib/social/jobs/minute.ts';
import { runSkills } from '@/lib/social/jobs/skills.ts';
import { jobDeps } from '@/lib/social/jobs/types.ts';

/**
 * Social's scheduled jobs (docs/social/build.md, D7 and 7.2), as Supabase Cron calls them: the
 * database's own schedule (`social._call_job`, a migration) posts here through pg_net every minute
 * (`?job=minute`), and R13's marketplace sync (`?job=skills`) and a check run's own counting
 * (`?job=counts`, R11) come to the same door. It copies the perps door (`../perps/route.ts`): the
 * call carries this environment's `SOCIAL_JOBS_SECRET` as a bearer token (Supabase Vault holds the
 * database's copy), and anything else, by any method, and every call where no secret is set or social
 * is off (production, until launch), gets one plain "no such call" (404), never kept, so the address
 * says nothing about itself.
 *
 * pg_net gives up on a call after 25 seconds with no status at all, so the door always answers
 * within `DEADLINE_MS` (18 seconds, `budget.ts`), whatever a job is doing; the run itself carries on
 * under `waitUntil` to the end, so it still closes its lease. The answers:
 *
 * - **200:** the run went through, or another run held the lease (`{ran: false, busy: true}`);
 * - **500:** a step failed (the answer names it), the run was still going at the deadline
 *   (`late: true`), or the lease itself couldn't be taken or closed. pg_net keeps the status, so
 *   `social_setup.py check --jobs` fails on it.
 *
 * What is answered holds IDs and counts only, never an error's text: that goes to the log, by name and
 * code. The job `counts` and `skills` answer 404 until R11 and R13 build them.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The lease is 55 seconds (`minute.ts`): a run still going after the deadline ends inside this. */
export const maxDuration = 60;

const JOBS = ['minute', 'counts', 'skills'] as const;
type Job = (typeof JOBS)[number];

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };

function noSuchAddress(): Response {
  return Response.json(
    { defined: false, code: 'NOT_FOUND', status: 404, message: 'No such call' },
    { status: 404, headers: NO_STORE },
  );
}

const digest = (text: string) => createHash('sha256').update(text).digest();

/**
 * Whether the call carries this environment's jobs secret, compared in constant time, as the perps
 * door does it: the secret is read trimmed, as `social_setup.py` writes Vault's copy, so a stray line
 * break can't make the two differ unseen; one too short to be ours counts as none.
 */
function carriesTheSecret(authorization: string | null, secret: string | undefined): boolean {
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

/** What a check run sends to `counts`: the IDs it made, each list at most 100, every ID in lower case. */
const ids = z
  .array(z.string().refine((id) => isUuid(id)))
  .max(100)
  .default(() => []);
const countsBody = z.strictObject({ posts: ids, stories: ids, files: ids });

/** The request's JSON, `{}` for none, or undefined when it isn't JSON. */
async function bodyOf(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Logs what a run threw, by its name and code alone (its text may quote data). */
function reportThrown(error: unknown): void {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  console.error('social jobs door: a run threw', { name, code });
}

type Raced<T> = { done: T } | { threw: true } | { late: true };

/**
 * A run, answered by the deadline at the latest: the run is given to `waitUntil`, so it finishes (and
 * closes its lease) whatever the door answers, and what it throws is logged, whether or not the
 * deadline passed first.
 */
async function within<T>(run: Promise<T>): Promise<Raced<T>> {
  const settled = run.then(
    (done): Raced<T> => ({ done }),
    (error): Raced<T> => {
      reportThrown(error);
      return { threw: true };
    },
  );
  waitUntil(settled);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Raced<T>>((resolve) => {
    timer = setTimeout(() => resolve({ late: true }), DEADLINE_MS);
  });
  try {
    return await Promise.race([settled, late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (
    !socialEnabled() ||
    !carriesTheSecret(request.headers.get('authorization'), process.env.SOCIAL_JOBS_SECRET)
  ) {
    return noSuchAddress();
  }
  const job = new URL(request.url).searchParams.get('job');
  if (!JOBS.includes(job as Job)) {
    return Response.json(
      { code: 'BAD_REQUEST', message: 'The job is minute, counts or skills' },
      { status: 400, headers: NO_STORE },
    );
  }
  const found = jobDeps();
  if (!found) {
    return Response.json(
      { code: 'SERVICE_UNAVAILABLE', message: 'The database is not set up here' },
      { status: 503, headers: NO_STORE },
    );
  }
  // Every database call of a job is limited by the database itself (`budget.ts`): the lease's two
  // calls get the frame's limits here, and each step passes its own.
  const deps = { ...found, run: framed(found.run) };

  let run: Promise<{ ran: boolean; ok?: boolean } | null>;
  if (job === 'counts') {
    const body = countsBody.safeParse(await bodyOf(request));
    if (!body.success) {
      return Response.json(
        {
          code: 'BAD_REQUEST',
          message:
            'The body is {posts, stories, files}: each a list of at most 100 IDs in lower case',
        },
        { status: 400, headers: NO_STORE },
      );
    }
    run = runCounts(body.data, deps);
  } else if (job === 'skills') {
    run = runSkills(deps);
  } else {
    run = runMinute(deps);
  }

  const raced = await within(run);
  if ('late' in raced) {
    return Response.json({ ran: true, ok: false, late: true }, { status: 500, headers: NO_STORE });
  }
  if ('threw' in raced) {
    return Response.json(
      { code: 'INTERNAL_SERVER_ERROR', message: 'The run could not take or close its lease' },
      { status: 500, headers: NO_STORE },
    );
  }
  const answer = raced.done;
  // A job not built yet answers null: as an address the site doesn't have.
  if (answer === null) return noSuchAddress();
  // Another run held the lease, or the run went through: 200. A failed step, 500, named in the answer.
  const healthy = !answer.ran || answer.ok === true;
  return Response.json(answer, { status: healthy ? 200 : 500, headers: NO_STORE });
}
