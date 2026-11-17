import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullConfig, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_SECONDS, parseTimesFile, splitIntoParts, type Times, testKey } from './parts.ts';
import PartsReporter from './support/parts.ts';

/**
 * The Screen check's split into parts: every test runs in exactly one part, the same on every
 * machine, balanced by the measured times. The reporter that applies it is tested with a made-up
 * suite (no browser, no website).
 */

const COMMITTED = new URL('./test-times.json', import.meta.url);

/** A made-up corpus: projects, files and titles, with times from a fixed pseudo-random walk. */
function corpus(count: number, seed = 1) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const keys: string[] = [];
  const times: Times = {};
  for (let i = 0; i < count; i++) {
    const key = testKey([
      '',
      i % 2 ? 'webkit' : 'chromium',
      `journeys/file-${i % 9}.spec.ts`,
      `test ${i}`,
    ]);
    keys.push(key);
    times[key] = Math.round((-Math.log(1 - next()) * 20 + 0.5) * 100) / 100; // a few long, many short
  }
  return { keys, times };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function loads(part: Map<string, number>, times: Times, total: number): number[] {
  const sums = new Array<number>(total).fill(0);
  for (const [key, number] of part)
    sums[number - 1] = (sums[number - 1] as number) + (times[key] ?? 0);
  return sums;
}

describe('a test key', () => {
  it('is the title path, project first, with empty entries dropped', () => {
    expect(testKey(['', 'chromium', 'journeys/api.spec.ts', 'a describe', 'a title'])).toBe(
      'chromium › journeys/api.spec.ts › a describe › a title',
    );
    expect(testKey(['', '', 'x'])).toBe('x');
  });
});

describe('the split', () => {
  it('gives every test to exactly one part, for one to six parts', () => {
    const { keys, times } = corpus(97);
    for (let total = 1; total <= 6; total++) {
      const part = splitIntoParts(keys, times, total);
      expect([...part.keys()].sort()).toEqual([...keys].sort());
      for (const number of part.values()) {
        expect(Number.isInteger(number) && number >= 1 && number <= total).toBe(true);
      }
    }
  });

  it('answers the same for any order of the tests and of the times', () => {
    const { keys, times } = corpus(60);
    const answer = (order: string[], known: Times) =>
      [...splitIntoParts(order, known, 4)].sort(([a], [b]) => (a < b ? -1 : 1));
    const first = answer(keys, times);
    for (const seed of [3, 4, 5]) {
      const timesInOtherOrder = Object.fromEntries(shuffled(Object.entries(times), seed));
      expect(answer(shuffled(keys, seed), timesInOtherOrder)).toEqual(first);
    }
  });

  it('counts a test with no measured time as the median of the measured ones', () => {
    // Measured 50, 50, 20 and 20: the median is 35, so the new test goes before the two 20s and
    // joins the first part (a tie goes to the lowest number). Counted as 10 it would go after them.
    const times = { x: 50, y: 50, z: 20, w: 20 };
    const part = splitIntoParts(['x', 'y', 'z', 'w', 'u'], times, 2);
    expect([part.get('x'), part.get('y'), part.get('u'), part.get('z'), part.get('w')]).toEqual([
      1, 2, 1, 2, 2,
    ]);
  });

  it(`counts every test as ${FALLBACK_SECONDS} seconds when none is measured, so the parts get equal numbers`, () => {
    const keys = Array.from({ length: 42 }, (_, i) => `t${i}`);
    const part = splitIntoParts(keys, {}, 4);
    const sizes = [1, 2, 3, 4].map((n) => [...part.values()].filter((p) => p === n).length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('takes a time of zero, below zero or not a number as not measured', () => {
    const odd: Times = { a: 0, b: -3, c: Number.NaN, d: 8 };
    const same = splitIntoParts(['a', 'b', 'c', 'd'], odd, 2);
    expect(same).toEqual(splitIntoParts(['a', 'b', 'c', 'd'], { d: 8 }, 2));
  });

  it('puts everything in part 1 when there is one part', () => {
    const { keys, times } = corpus(30);
    expect(new Set(splitIntoParts(keys, times, 1).values())).toEqual(new Set([1]));
  });

  it('refuses two tests with one key, and a number of parts that is not one', () => {
    expect(() => splitIntoParts(['a', 'a'], {}, 2)).toThrow('Two tests have the same key: a');
    for (const total of [0, -1, 2.5, Number.NaN]) {
      expect(() => splitIntoParts(['a'], {}, total)).toThrow('is not a number of parts');
    }
  });

  it('leaves the parts within 15% of the average on a made-up spread of long and short tests', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { keys, times } = corpus(168, seed);
      const sums = loads(splitIntoParts(keys, times, 4), times, 4);
      const average = sums.reduce((a, b) => a + b, 0) / 4;
      expect(Math.max(...sums), `seed ${seed}: ${sums}`).toBeLessThanOrEqual(average * 1.15);
    }
  });

  it('leaves the parts within 15% of the average on the committed times (once there are some)', () => {
    // The first pull request ships the file empty (every test then counts the same); the first
    // run's screen-test-times artifact fills it, and from then on this holds the balance to account.
    const { times } = parseTimesFile(readFileSync(COMMITTED, 'utf8'));
    const keys = Object.keys(times);
    if (keys.length === 0) return;
    const sums = loads(splitIntoParts(keys, times, 4), times, 4);
    const average = sums.reduce((a, b) => a + b, 0) / 4;
    expect(Math.max(...sums), `${sums}`).toBeLessThanOrEqual(average * 1.15);
  });
});

describe('the times file', () => {
  const file = (times: unknown, version: unknown = 1, measured: unknown = 'a day, a run') =>
    JSON.stringify({ version, measured, times });

  it('reads the shape the joining job writes', () => {
    expect(parseTimesFile(file({ a: 1.5 }))).toEqual({
      version: 1,
      measured: 'a day, a run',
      times: { a: 1.5 },
    });
  });

  it('refuses what it can not use, saying what is wrong', () => {
    expect(() => parseTimesFile('[]')).toThrow('not an object');
    expect(() => parseTimesFile('null')).toThrow('not an object');
    expect(() => parseTimesFile(file({}, 2))).toThrow('version is 2');
    expect(() => parseTimesFile(file({}, 1, 7))).toThrow('`measured` is not text');
    expect(() => parseTimesFile(file([1]))).toThrow('`times` is not an object');
    expect(() => parseTimesFile(file({ a: '3' }))).toThrow(
      '"a" is not a number of seconds above zero',
    );
    expect(() => parseTimesFile(file({ a: 0 }))).toThrow(
      '"a" is not a number of seconds above zero',
    );
    expect(() => parseTimesFile('{')).toThrow();
  });
});

describe('the reporter that gives each machine its tests', () => {
  let folder: string;
  let before: string | undefined;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'hrizzup-parts-'));
    before = process.env.PARTS_OUT;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (before === undefined) delete process.env.PARTS_OUT;
    else process.env.PARTS_OUT = before;
    rmSync(folder, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const { keys } = corpus(40);
  const cases = keys.map(
    (key) => ({ key, titlePath: () => ['', ...key.split(' › ')] }) as unknown as TestCase,
  );
  const suite = { allTests: () => cases } as unknown as Suite;

  /** One part's run, with a times file of its own when asked (the check uses the committed one). */
  async function run(
    shard: FullConfig['shard'],
    options: { passed?: string[]; timesFile?: string } = {},
  ) {
    const excluded: TestCase[] = [];
    let skipped = 0;
    const reporter = new PartsReporter(options.timesFile ? { timesFile: options.timesFile } : {});
    await reporter.preprocess({
      config: { shard } as FullConfig,
      suite,
      testRun: { exclude: (test) => void excluded.push(test), skipSharding: () => void skipped++ },
    });
    for (const key of options.passed ?? []) {
      const test = cases.find((c) => testKey(c.titlePath()) === key) as TestCase;
      reporter.onTestEnd(test, { status: 'passed', duration: 2500 } as TestResult);
    }
    reporter.onEnd();
    return { excluded, skipped };
  }

  const record = (part: number) =>
    JSON.parse(readFileSync(join(folder, `part-${part}.json`), 'utf8')) as {
      part: number;
      of: number;
      website: boolean;
      all: string[];
      mine: string[];
      times: Times;
    };

  it('takes Playwright’s own sharding over, and runs only its own tests', async () => {
    process.env.PARTS_OUT = folder;
    const { excluded, skipped } = await run({ current: 2, total: 4 });
    const part = record(2);
    expect(skipped).toBe(1);
    expect(part).toMatchObject({ part: 2, of: 4, website: true });
    expect(part.all).toHaveLength(40);
    expect(excluded.map((t) => testKey(t.titlePath())).sort()).toEqual(
      part.all.filter((key) => !part.mine.includes(key)),
    );
    expect(part.mine.length + excluded.length).toBe(40);
  });

  it('makes the four parts’ own lists add up to the whole list, each test once', async () => {
    process.env.PARTS_OUT = folder;
    for (const current of [1, 2, 3, 4]) await run({ current, total: 4 });
    const records = [1, 2, 3, 4].map(record);
    expect(records.flatMap((r) => r.mine).sort()).toEqual([...keys].sort());
    for (const part of records) expect(part.all).toEqual([...keys].sort());
  });

  it('splits by the times file it is given', async () => {
    process.env.PARTS_OUT = folder;
    const heavy = keys.slice(0, 2);
    const timesFile = join(folder, 'times.json');
    const times = Object.fromEntries(keys.map((key) => [key, heavy.includes(key) ? 900 : 1]));
    writeFileSync(timesFile, JSON.stringify({ version: 1, measured: 'a test', times }));
    for (const current of [1, 2, 3, 4]) await run({ current, total: 4 }, { timesFile });
    const [first, second] = [1, 2, 3, 4].map(record).filter((r) => r.mine.length < 3);
    // The two long tests are alone in their parts, and every other test shares the other two.
    expect([first?.mine, second?.mine].flat().sort()).toEqual([...heavy].sort());
  });

  it('records the seconds each passed test took, only its own', async () => {
    process.env.PARTS_OUT = folder;
    await run({ current: 3, total: 4 });
    const [one, two] = record(3).mine as [string, string];
    await run({ current: 3, total: 4 }, { passed: [one, two] });
    expect(record(3).times).toEqual({ [one]: 2.5, [two]: 2.5 });
  });

  it('does nothing without --shard: no tests taken out, Playwright’s sharding left alone, no record', async () => {
    process.env.PARTS_OUT = folder;
    const { excluded, skipped } = await run(null);
    expect(excluded).toEqual([]);
    expect(skipped).toBe(0);
    expect(() => readFileSync(join(folder, 'part-1.json'))).toThrow();
  });

  it('still takes its own tests where no record was asked for', async () => {
    delete process.env.PARTS_OUT;
    const { skipped } = await run({ current: 1, total: 4 });
    expect(skipped).toBe(1);
  });

  it('fails closed on a times file it can not use: it throws, and leaves no record that could pass for a part with no tests', async () => {
    process.env.PARTS_OUT = folder;
    for (const text of [
      '{ "version": 1, "measured": "x", "times": { "a": "slow" } }',
      'not json',
    ]) {
      const timesFile = join(folder, 'broken.json');
      writeFileSync(timesFile, text);
      await expect(run({ current: 1, total: 4 }, { timesFile })).rejects.toThrow();
    }
    await expect(
      run({ current: 1, total: 4 }, { timesFile: join(folder, 'missing.json') }),
    ).rejects.toThrow();
    expect(() => readFileSync(join(folder, 'part-1.json'))).toThrow();
  });
});
