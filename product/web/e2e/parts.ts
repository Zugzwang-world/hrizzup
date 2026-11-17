/**
 * The Screen check's split into parts (CLAUDE.md, "Checks sized to the change"; Round 6, R4, M7.2):
 * the check runs on four machines, each one a part, and every test runs in exactly one part. The
 * split is balanced by how long each test took last time (e2e/test-times.json), so the parts finish
 * together. It is pure: the same tests and times give the same split on every machine, whatever
 * order the tests come in, so each part, working alone, agrees with the other three about who runs
 * what (e2e/support/parts.ts applies it, and the check's joining job proves they agreed:
 * .github/scripts/screen_parts.py).
 */

/** A test's key: its title path (project, file, describes, title), empty entries dropped. */
export function testKey(titlePath: readonly string[]): string {
  return titlePath.filter((part) => part !== '').join(' › ');
}

/** Seconds a test took, by test key (e2e/test-times.json). */
export type Times = Record<string, number>;

/** What a test with no measured time counts as when no test has one. */
export const FALLBACK_SECONDS = 10;

/** The file's shape: `measured` says when and from which run, for people only. */
export type TimesFile = { version: 1; measured: string; times: Times };

/** Reads the times file's text; throws saying what is wrong with it. */
export function parseTimesFile(text: string): TimesFile {
  const file = JSON.parse(text) as Partial<TimesFile> | null;
  if (typeof file !== 'object' || file === null || Array.isArray(file)) {
    throw new Error('The times file is not an object');
  }
  if (file.version !== 1)
    throw new Error(`The times file's version is ${String(file.version)}, not 1`);
  if (typeof file.measured !== 'string') throw new Error("The times file's `measured` is not text");
  const times = file.times;
  if (typeof times !== 'object' || times === null || Array.isArray(times)) {
    throw new Error("The times file's `times` is not an object");
  }
  for (const [key, seconds] of Object.entries(times)) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new Error(`The time of "${key}" is not a number of seconds above zero`);
    }
  }
  return { version: 1, measured: file.measured, times };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Plain code-unit order, the same on every machine (never the locale's). */
function byKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Which part (1 to `total`) runs each test: the map from test key to part.
 *
 * Longest first, each to the part with the least time so far, ties to the lowest number. A test
 * with no measured time counts as the median of the measured ones among these tests (so a new
 * test lands about where a typical one would), or `FALLBACK_SECONDS` when none is measured.
 * Never silently loses or doubles a test: duplicate keys and a bad `total` throw.
 */
export function splitIntoParts(
  keys: readonly string[],
  times: Times,
  total: number,
): Map<string, number> {
  if (!Number.isInteger(total) || total < 1)
    throw new Error(`${total} parts is not a number of parts`);
  if (new Set(keys).size !== keys.length) {
    const seen = new Set<string>();
    const twice = keys.find((key) => seen.size === seen.add(key).size);
    throw new Error(`Two tests have the same key: ${twice}`);
  }
  const measured = (key: string): number | undefined => {
    const seconds = times[key];
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? seconds
      : undefined;
  };
  const known = keys.flatMap((key) => measured(key) ?? []);
  const guess = known.length > 0 ? median(known) : FALLBACK_SECONDS;
  const weighted = keys.map((key) => ({ key, seconds: measured(key) ?? guess }));
  weighted.sort((a, b) => b.seconds - a.seconds || byKey(a.key, b.key));

  const load = new Array<number>(total).fill(0);
  const part = new Map<string, number>();
  for (const { key, seconds } of weighted) {
    let lightest = 0;
    for (let i = 1; i < total; i++) {
      if ((load[i] as number) < (load[lightest] as number)) lightest = i;
    }
    load[lightest] = (load[lightest] as number) + seconds;
    part.set(key, lightest + 1);
  }
  return part;
}
