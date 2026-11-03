import { Redis } from '@upstash/redis';
import { AwsClient } from 'aws4fetch';
import { database } from '../db.ts';

export type ServiceResult =
  | { status: 'ok'; ms: number; [detail: string]: unknown }
  | { status: 'error'; ms: number; error: 'timeout' | 'refused' | 'unreachable' }
  | { status: 'not_configured' };

const TIMEOUT_MS = 4000;

class Refused extends Error {}

/** Runs one check with a time limit. Errors become a short code; their text is never shown. */
async function timed(
  run: (signal: AbortSignal) => Promise<Record<string, unknown> | undefined>,
): Promise<ServiceResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const details = await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('timeout')));
      }),
    ]);
    return { status: 'ok', ms: Math.round(performance.now() - started), ...details };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    if (controller.signal.aborted) return { status: 'error', ms, error: 'timeout' };
    return { status: 'error', ms, error: error instanceof Refused ? 'refused' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export function checkDatabase(): Promise<ServiceResult> {
  const pool = database();
  if (!pool) return Promise.resolve({ status: 'not_configured' });
  return timed(async () => {
    const { rows } = await pool.query<{ ok: number }>('select 1 as ok');
    if (rows[0]?.ok !== 1) throw new Refused();
    return undefined;
  });
}

let redis: Redis | undefined;

/**
 * Redis answers a PING. Also reports the first command's time (it may open a connection)
 * and the median of five more on the open connection: the number blueprint section 14
 * expects to be about 1 to 3 ms from Vercel's Mumbai functions.
 */
export function checkRedis(): Promise<ServiceResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return Promise.resolve({ status: 'not_configured' });
  redis ??= new Redis({ url, token, enableAutoPipelining: true, retry: false });
  const client = redis;
  return timed(async () => {
    const t0 = performance.now();
    if ((await client.ping()) !== 'PONG') throw new Refused();
    const firstMs = performance.now() - t0;
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await client.ping();
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    const round = (n: number) => Math.round(n * 10) / 10;
    return { firstCommandMs: round(firstMs), medianCommandMs: round(samples[2] ?? firstMs) };
  });
}

/** Both of this environment's R2 buckets answer a one-item listing with the app's key. */
export function checkStorage(): Promise<ServiceResult> {
  const env = process.env;
  const buckets = [env.R2_BUCKET_UPLOADS, env.R2_BUCKET_MEDIA];
  if (
    !env.R2_ENDPOINT ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    buckets.some((b) => !b)
  ) {
    return Promise.resolve({ status: 'not_configured' });
  }
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  return timed(async (signal) => {
    const answers = await Promise.all(
      buckets.map((bucket) =>
        aws.fetch(`${env.R2_ENDPOINT}/${bucket}?list-type=2&max-keys=1`, { signal }),
      ),
    );
    if (answers.some((r) => r.status !== 200)) throw new Refused();
    return undefined;
  });
}

/** Supabase's sign-in service answers its health address with the publishable key. */
export function checkAuth(): Promise<ServiceResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Promise.resolve({ status: 'not_configured' });
  return timed(async (signal) => {
    const response = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, signal });
    if (!response.ok) throw new Refused();
    return undefined;
  });
}
