/**
 * The arithmetic of the app's code-size check, kept apart so it can be tested on its own
 * (`bundle.test.ts`). `bundle-size.ts` measures; this decides.
 */

export type Measurement = { androidBytes: number };
export type Limit = { androidKB: number; reason: string };

/** Growth of more than this, compared with main, in one pull request needs a raised limit. */
export const MAX_UNEXPLAINED_GROWTH_PERCENT = 5;

const KB = 1024;

export type Comparison = {
  passes: boolean;
  /** One row for the Speed check's table. */
  row: string;
  /** Why it failed, in plain words, or an empty list. */
  problems: string[];
};

/**
 * Compares this pull request's bundle with main's. It fails when the bundle is over its limit,
 * or when it grew more than 5% in this one pull request without the limit being raised here
 * (raising it, with its reason, is what explains the growth).
 */
export function compare(
  head: Measurement,
  base: Measurement | null,
  headLimit: Limit,
  baseLimit: Limit | null,
): Comparison {
  const problems: string[] = [];
  const limitBytes = headLimit.androidKB * KB;
  if (head.androidBytes > limitBytes) {
    problems.push(
      `the bundle (${kb(head.androidBytes)}) is over its limit of ${headLimit.androidKB} KB`,
    );
  }
  let change = 'main not measured';
  if (base) {
    const growth = ((head.androidBytes - base.androidBytes) / base.androidBytes) * 100;
    change = `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}% (main: ${kb(base.androidBytes)})`;
    const raised = baseLimit !== null && headLimit.androidKB > baseLimit.androidKB;
    if (growth > MAX_UNEXPLAINED_GROWTH_PERCENT && !raised) {
      problems.push(
        `it grew ${growth.toFixed(1)}% in this pull request, more than ` +
          `${MAX_UNEXPLAINED_GROWTH_PERCENT}%, without raising the limit in ` +
          'product/app/bundle-limit.json (with its reason)',
      );
    }
  }
  const passes = problems.length === 0;
  const row =
    `| App, Android code bundle | ${passes ? '✅' : '❌'} ${kb(head.androidBytes)} / ` +
    `${headLimit.androidKB} KB | ${change} |`;
  return { passes, row, problems };
}

export function kb(bytes: number): string {
  return `${(bytes / KB).toFixed(1)} KB`;
}

/** The app's part of the table on the pull request. */
export function markdown(comparison: Comparison): string {
  return [
    '| | Size / limit | Change since main |',
    '|---|---|---|',
    comparison.row,
    ...(comparison.problems.length
      ? ['', ...comparison.problems.map((problem) => `- ❌ ${problem}.`)]
      : []),
  ].join('\n');
}
