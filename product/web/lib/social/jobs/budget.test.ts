import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Run } from '../access.ts';
import {
  COUNTS_RESERVE_MS,
  DEADLINE_MS,
  FRAME,
  framed,
  PG_NET_TIMEOUT_MS,
  PLANNED_MS,
  PURGE_WAIT_MS,
  RECOUNT,
  REDIS_WAIT_MS,
  STORIES,
} from './budget.ts';

/**
 * The minute run's time (R5's design note, R5 and M2 rule 1): every part has its own limit, and the
 * parts add up to no more than the door's deadline, which is well inside pg_net's 25 seconds.
 */

describe('the minute run’s time', () => {
  it('has the numbers the design gives: the lease 2 s a call, the stories step 3 s, the recount 5 s, 3 s kept for counts, the purge 2 s and Redis 0.5 s, the door 18 s', () => {
    expect(FRAME).toEqual({ statementTimeoutMs: 2_000, lockTimeoutMs: 1_000 });
    expect(STORIES).toEqual({ statementTimeoutMs: 3_000, lockTimeoutMs: 1_000 });
    expect(RECOUNT).toEqual({ statementTimeoutMs: 5_000, lockTimeoutMs: 1_000 });
    expect(COUNTS_RESERVE_MS).toBe(3_000);
    expect(PURGE_WAIT_MS).toBe(2_000);
    expect(REDIS_WAIT_MS).toBe(500);
    expect(DEADLINE_MS).toBe(18_000);
  });

  it('adds up: begin + stories + the counts reserve + recount + purge + Redis + end fits the deadline, which is at most 20 s', () => {
    const sum =
      FRAME.statementTimeoutMs +
      STORIES.statementTimeoutMs +
      COUNTS_RESERVE_MS +
      RECOUNT.statementTimeoutMs +
      PURGE_WAIT_MS +
      REDIS_WAIT_MS +
      FRAME.statementTimeoutMs;
    expect(PLANNED_MS).toBe(sum);
    expect(sum).toBe(17_500);
    expect(sum).toBeLessThanOrEqual(DEADLINE_MS);
    expect(DEADLINE_MS).toBeLessThanOrEqual(20_000);
  });

  it('never asks for a lock wait longer than the statement it belongs to', () => {
    for (const limits of [FRAME, STORIES, RECOUNT]) {
      expect(limits.lockTimeoutMs).toBeLessThanOrEqual(limits.statementTimeoutMs);
    }
  });

  it('keeps the deadline under what pg_net waits, which is the number the database’s own call carries', () => {
    expect(DEADLINE_MS).toBeLessThan(PG_NET_TIMEOUT_MS);
    const migration = readFileSync(
      new URL(
        '../../../../../infra/supabase/migrations/20261117194100_social.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(migration).toContain(`timeout_milliseconds := ${PG_NET_TIMEOUT_MS}`);
  });
});

describe('the frame’s limits', () => {
  const seen: unknown[] = [];
  const run: Run = async (work, limits) => {
    seen.push(limits);
    return work({} as never);
  };

  it('go to a call that sends none (the lease’s two), and a step’s own limits win over them', async () => {
    seen.length = 0;
    const limited = framed(run);
    await limited(async () => 'begin');
    await limited(async () => 'stories', STORIES);
    await limited(async () => 'half', { statementTimeoutMs: 500 });
    expect(seen).toEqual([
      FRAME,
      STORIES,
      { statementTimeoutMs: 500, lockTimeoutMs: FRAME.lockTimeoutMs },
    ]);
  });

  it('hand the work on and answer what it answers', async () => {
    const work = vi.fn(async () => 42);
    await expect(framed(run)(work)).resolves.toBe(42);
    expect(work).toHaveBeenCalledOnce();
  });
});
