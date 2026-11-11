import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decimal } from './decimal.ts';
import { probabilityOf } from './quote.ts';
import { connect } from './testing.ts';

/**
 * A quote's probability against the real database (PLAN.md step 3.5c, the Database check): a pool's
 * probability is worked out exactly as `markets.probability` rounds it. That each quote matches the
 * trade that follows it, over hundreds of random trades, is the markets package's (data.db.test.ts),
 * where markets are made through the console as the public reads need.
 */

let owner: pg.Pool;

beforeAll(() => {
  owner = connect(2);
});

afterAll(async () => {
  await owner.end();
});

// A small seeded random generator (mulberry32), so every run makes the same choices.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("a pool's probability", () => {
  it('is rounded exactly as markets.probability rounds it, over 3,000 random pools', async () => {
    const rng = random(7);
    const pools = Array.from({ length: 3000 }, () => ({
      p: (0.01 + rng() * 0.98).toFixed(8),
      yes: BigInt(1 + Math.floor(rng() ** 3 * 5_000_000_000_000)),
      no: BigInt(1 + Math.floor(rng() ** 3 * 5_000_000_000_000)),
    }));
    const { rows } = await owner.query<{ probability: string }>(
      `select markets.probability(p, y, n)::text as probability
       from unnest($1::numeric[], $2::numeric[], $3::numeric[]) with ordinality as x (p, y, n, i)
       order by i`,
      [pools.map((x) => x.p), pools.map((x) => decimal(x.yes)), pools.map((x) => decimal(x.no))],
    );
    expect(rows.map((row) => row.probability)).toEqual(
      pools.map((x) => probabilityOf(x.p, x.yes, x.no)),
    );
  });
});
