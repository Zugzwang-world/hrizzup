import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { parseTimesFile, splitIntoParts, type Times, testKey } from '../parts.ts';

/**
 * The Screen check's part (CLAUDE.md, "Checks sized to the change"; Round 6, R4, M7.2): with
 * `--shard=N/M`, each machine runs only its own tests, chosen by the split balanced on last time's
 * measured times (e2e/parts.ts, e2e/test-times.json), instead of Playwright's own even split by
 * count. Every machine works out the same split from the same files, so each test runs in exactly
 * one part.
 *
 * It also leaves a record for the check's joining job (.github/scripts/screen_parts.py) in
 * $PARTS_OUT/part-N.json: the whole list of tests the part saw (`all`), the part's own (`mine`),
 * and the seconds each of its passed tests took (`times`). The joining job proves the parts' own
 * lists add up to the whole list, each test once, and keeps the times for the next refresh of the
 * file. It reads no keys and writes nothing else: no test output, no browser data.
 */
const TIMES_FILE = new URL('../test-times.json', import.meta.url);

export default class PartsReporter implements Reporter {
  // Set only once the split has worked out: a part whose split failed (a times file that can't be
  // read, say) leaves no record at all, never an empty one that looks like a part with no tests.
  private shard: FullConfig['shard'] = null;
  private all: string[] = [];
  private mine: string[] = [];
  private seconds: Times = {};
  private readonly timesFile: URL | string;

  /** `timesFile` is for the tests of this reporter only; the check uses the committed file. */
  constructor(options: { timesFile?: string } = {}) {
    this.timesFile = options.timesFile ?? TIMES_FILE;
  }

  printsToStdio(): boolean {
    return false;
  }

  /**
   * Runs before Playwright's own sharding, on the whole list of tests (the same one `--list` prints,
   * after `--project` and `--grep`), and takes the sharding over: every test that isn't this
   * part's is excluded, so its body never runs and it never shows in the report. If it throws,
   * Playwright fails the run (exit code 1) and no test runs.
   */
  async preprocess({
    config,
    suite,
    testRun,
  }: {
    config: FullConfig;
    suite: Suite;
    testRun: { exclude(test: TestCase): void; skipSharding(): void };
  }): Promise<void> {
    const shard = config.shard;
    if (!shard) return;
    const tests = suite.allTests();
    const keyOf = new Map(tests.map((test) => [test, testKey(test.titlePath())] as const));
    const { times } = parseTimesFile(readFileSync(this.timesFile, 'utf8'));
    const part = splitIntoParts([...keyOf.values()], times, shard.total);
    const mine: string[] = [];
    testRun.skipSharding();
    for (const [test, key] of keyOf) {
      if (part.get(key) === shard.current) mine.push(key);
      else testRun.exclude(test);
    }
    this.all = [...keyOf.values()].sort();
    this.mine = mine.sort();
    this.shard = shard;
    console.log(
      `Screen check, part ${shard.current} of ${shard.total}: ${mine.length} of the ${this.all.length} tests`,
    );
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.shard || result.status !== 'passed') return;
    this.seconds[testKey(test.titlePath())] = result.duration / 1000;
  }

  onEnd(): void {
    const folder = process.env.PARTS_OUT;
    if (!this.shard || !folder) return;
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `part-${this.shard.current}.json`);
    const record = {
      part: this.shard.current,
      of: this.shard.total,
      website: true,
      all: this.all,
      mine: this.mine,
      times: this.seconds,
    };
    // Whole or not at all: the joining job never reads half a record.
    writeFileSync(`${file}.tmp`, `${JSON.stringify(record)}\n`);
    renameSync(`${file}.tmp`, file);
  }
}
