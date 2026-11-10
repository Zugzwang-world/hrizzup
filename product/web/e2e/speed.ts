import type { Budget } from './pages.ts';

/**
 * The speed check's arithmetic, kept apart from Lighthouse so it can be tested on its own
 * (`speed.test.ts`). `speed-check.ts` runs Lighthouse and hands each run's result here.
 */

/** What one Lighthouse run measured on one page. */
export type RunMetrics = {
  loadMs: number;
  blockingMs: number;
  layoutShift: number;
  /** Compressed JavaScript from every site, iframes (embeds) included. */
  codeBytes: number;
  /** Everything downloaded, compressed, from every site. */
  totalBytes: number;
  /** The part of `totalBytes` from other sites. */
  otherSitesBytes: number;
  requests: number;
  /** Lighthouse's contrast audit: no text too faint to read against its background. */
  contrastPasses: boolean;
  /** What the contrast audit flagged, for the report. */
  contrastProblems: string[];
};

/**
 * Lab timings wobble from run to run even as a median of 5, more on GitHub's shared machines,
 * so a timing fails only beyond its budget plus this much. Sizes don't wobble: no tolerance.
 */
export const TOLERANCE = { loadMs: 250, blockingMs: 50, layoutShift: 0.01 } as const;

export const RUNS = 5;
const KB = 1024;

/** The parts of a Lighthouse result this check reads (its `lhr`). */
export type LighthouseResult = {
  requestedUrl?: string;
  finalDisplayedUrl: string;
  runtimeError?: { code: string; message: string };
  runWarnings?: string[];
  audits: Record<
    string,
    {
      score: number | null;
      scoreDisplayMode?: string;
      numericValue?: number;
      details?: { items?: Record<string, unknown>[] };
    }
  >;
};

function numeric(lhr: LighthouseResult, id: string): number {
  const value = lhr.audits[id]?.numericValue;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Lighthouse couldn't measure ${id} on ${lhr.finalDisplayedUrl}`);
  }
  return value;
}

/** Refuses a run that didn't load the page it was sent to. */
function loaded(lhr: LighthouseResult, expectedUrl: string) {
  if (lhr.runtimeError) {
    throw new Error(`Lighthouse failed on ${expectedUrl}: ${lhr.runtimeError.code}`);
  }
  // Protection that isn't bypassed sends the browser to Vercel's login page instead.
  if (new URL(lhr.finalDisplayedUrl).href !== new URL(expectedUrl).href) {
    throw new Error(`${expectedUrl} ended up at another address, so it wasn't measured`);
  }
}

/** Lighthouse's contrast audit: passes, and what it flagged. A page with no text passes. */
export function contrastOf(
  lhr: LighthouseResult,
  expectedUrl: string,
): { passes: boolean; problems: string[] } {
  loaded(lhr, expectedUrl);
  const audit = lhr.audits['color-contrast'];
  if (!audit) throw new Error(`Lighthouse didn't run its contrast audit on ${expectedUrl}`);
  if (audit.score !== 0) return { passes: true, problems: [] };
  const problems = (audit.details?.items ?? []).map((item) => {
    const node = item.node as { snippet?: string } | undefined;
    return node?.snippet ?? 'an element';
  });
  return { passes: false, problems };
}

/** Reads one run's numbers out of a Lighthouse result. */
export function metricsFromLighthouse(lhr: LighthouseResult, expectedUrl: string): RunMetrics {
  loaded(lhr, expectedUrl);
  const summary = lhr.audits['resource-summary']?.details?.items;
  if (!summary) throw new Error(`Lighthouse didn't sum up the downloads of ${expectedUrl}`);
  const row = (type: string) => summary.find((item) => item.resourceType === type);
  const bytes = (type: string) => Number(row(type)?.transferSize ?? 0);
  const contrast = contrastOf(lhr, expectedUrl);
  return {
    loadMs: numeric(lhr, 'largest-contentful-paint'),
    blockingMs: numeric(lhr, 'total-blocking-time'),
    layoutShift: numeric(lhr, 'cumulative-layout-shift'),
    codeBytes: bytes('script'),
    totalBytes: bytes('total'),
    otherSitesBytes: bytes('third-party'),
    requests: Number(row('total')?.requestCount ?? 0),
    contrastPasses: contrast.passes,
    contrastProblems: contrast.problems,
  };
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('No runs to take a median of');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** A page's result: the median of each number over its runs; contrast fails if most runs fail. */
export function summarize(runs: RunMetrics[]): RunMetrics {
  const of = (key: keyof Omit<RunMetrics, 'contrastPasses' | 'contrastProblems'>) =>
    median(runs.map((run) => run[key]));
  const failing = runs.filter((run) => !run.contrastPasses);
  return {
    loadMs: of('loadMs'),
    blockingMs: of('blockingMs'),
    layoutShift: of('layoutShift'),
    codeBytes: of('codeBytes'),
    totalBytes: of('totalBytes'),
    otherSitesBytes: of('otherSitesBytes'),
    requests: of('requests'),
    contrastPasses: failing.length * 2 < runs.length,
    contrastProblems: [...new Set(failing.flatMap((run) => run.contrastProblems))],
  };
}

export type Verdict = {
  label: string;
  value: string;
  limit: string;
  passes: boolean;
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const kilobytes = (bytes: number) => `${(bytes / KB).toFixed(1)} KB`;

/** Each number against its budget. Sizes are hard limits; timings get the tolerance above. */
export function judge(result: RunMetrics, budget: Budget): Verdict[] {
  return [
    {
      label: 'Load (largest content)',
      value: seconds(result.loadMs),
      limit: seconds(budget.loadMs),
      passes: result.loadMs <= budget.loadMs + TOLERANCE.loadMs,
    },
    {
      label: 'Busy time (blocking)',
      value: `${Math.round(result.blockingMs)} ms`,
      limit: `${budget.blockingMs} ms`,
      passes: result.blockingMs <= budget.blockingMs + TOLERANCE.blockingMs,
    },
    {
      label: 'Layout shift',
      value: result.layoutShift.toFixed(3),
      limit: budget.layoutShift.toFixed(2),
      passes: result.layoutShift <= budget.layoutShift + TOLERANCE.layoutShift,
    },
    {
      label: 'Code',
      value: kilobytes(result.codeBytes),
      limit: `${budget.codeKB} KB`,
      passes: result.codeBytes <= budget.codeKB * KB,
    },
    {
      label: 'Total download',
      value: kilobytes(result.totalBytes),
      limit: `${budget.totalKB} KB`,
      passes: result.totalBytes <= budget.totalKB * KB,
    },
  ];
}

/**
 * One run over one of the page's budgets: a warning, never a failure. A page passes or fails on
 * the median of its runs (`judge`), which a single slow run on a busy machine can't sway; but a
 * run past the budget itself, with no tolerance, is the first sign a page is drifting towards it.
 */
export type RunWarning = {
  label: string;
  /** Which run, counting from 1, of how many. */
  run: number;
  runs: number;
  value: string;
  limit: string;
};

/** Rounds up, so a number just over its budget never reads as equal to it. */
const up = (value: number, places: number) => {
  const scale = 10 ** places;
  return (Math.ceil(value * scale - 1e-9) / scale).toFixed(places);
};

/** Every run, of every number, over the page's budget itself (no tolerance). */
export function overBudgetRuns(runs: RunMetrics[], budget: Budget): RunWarning[] {
  const checks: {
    label: string;
    over: (r: RunMetrics) => boolean;
    value: (r: RunMetrics) => string;
    limit: string;
  }[] = [
    {
      label: 'Load (largest content)',
      over: (r) => r.loadMs > budget.loadMs,
      value: (r) => `${up(r.loadMs / 1000, 2)} s`,
      limit: seconds(budget.loadMs),
    },
    {
      label: 'Busy time (blocking)',
      over: (r) => r.blockingMs > budget.blockingMs,
      value: (r) => `${up(r.blockingMs, 0)} ms`,
      limit: `${budget.blockingMs} ms`,
    },
    {
      label: 'Layout shift',
      over: (r) => r.layoutShift > budget.layoutShift,
      value: (r) => up(r.layoutShift, 3),
      limit: budget.layoutShift.toFixed(2),
    },
    {
      label: 'Code',
      over: (r) => r.codeBytes > budget.codeKB * KB,
      value: (r) => `${up(r.codeBytes / KB, 1)} KB`,
      limit: `${budget.codeKB} KB`,
    },
    {
      label: 'Total download',
      over: (r) => r.totalBytes > budget.totalKB * KB,
      value: (r) => `${up(r.totalBytes / KB, 1)} KB`,
      limit: `${budget.totalKB} KB`,
    },
  ];
  return checks.flatMap((check) =>
    runs.flatMap((r, index) =>
      check.over(r)
        ? [
            {
              label: check.label,
              run: index + 1,
              runs: runs.length,
              value: check.value(r),
              limit: check.limit,
            },
          ]
        : [],
    ),
  );
}

/** One warning in words: `/console: Busy time (blocking) 285 ms in run 3 of 5 (budget 200 ms)`. */
export function describeWarning(path: string, warning: RunWarning): string {
  return (
    `${path}: ${warning.label} ${warning.value} in run ${warning.run} of ${warning.runs} ` +
    `(budget ${warning.limit})`
  );
}

/** The numbers each run measured, kept in the results so a page's spread can be read back. */
export type RunNumbers = Pick<
  RunMetrics,
  'loadMs' | 'blockingMs' | 'layoutShift' | 'codeBytes' | 'totalBytes'
>;

export function runNumbers(r: RunMetrics): RunNumbers {
  return {
    loadMs: Math.round(r.loadMs),
    blockingMs: Math.round(r.blockingMs),
    layoutShift: Number(r.layoutShift.toFixed(4)),
    codeBytes: r.codeBytes,
    totalBytes: r.totalBytes,
  };
}

export type PageReport = {
  name: string;
  path: string;
  verdicts: Verdict[];
  /** Text contrast in the light and the dark colour scheme. */
  contrast: { light: boolean; dark: boolean; problems: string[] };
  otherSitesBytes: number;
  requests: number;
  /** Single runs over a budget: warnings, which never fail the check. */
  warnings: RunWarning[];
  /** Each run's numbers, in the order they ran. */
  runs: RunNumbers[];
};

export function pagePasses(report: PageReport): boolean {
  return report.verdicts.every((v) => v.passes) && report.contrast.light && report.contrast.dark;
}

const mark = (passes: boolean) => (passes ? '✅' : '❌');

/** The short table each pull request shows: one row per page, each number with its budget. */
export function markdownTable(reports: PageReport[]): string {
  const first = reports[0];
  if (!first) return '_No pages measured._';
  const header = ['Page', ...first.verdicts.map((v) => v.label), 'Text contrast'];
  const lines = [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...reports.map((report) => {
      const cells = report.verdicts.map((v) => `${mark(v.passes)} ${v.value} / ${v.limit}`);
      const contrast = report.contrast.light && report.contrast.dark;
      const contrastCell = contrast
        ? '✅ light and dark'
        : `❌ ${[!report.contrast.light && 'light', !report.contrast.dark && 'dark'].filter(Boolean).join(' and ')}`;
      return `| \`${report.path}\` | ${cells.join(' | ')} | ${contrastCell} |`;
    }),
  ];
  return lines.join('\n');
}

/**
 * The single runs over a budget, for the pull request: warnings, listed under the table. Empty
 * when no run of any page crossed one.
 */
export function markdownWarnings(reports: PageReport[]): string {
  const lines = reports.flatMap((report) =>
    report.warnings.map((warning) => `- \`${describeWarning(report.path, warning)}\``),
  );
  if (lines.length === 0) return '';
  return [
    '**Single runs over a budget** (warnings, not failures: each page passes or fails on the ' +
      'median of its runs, in the table above). A page listed here is drifting towards its ' +
      "budget: it goes into Product's status file (`docs/status/product.md`).",
    ...lines,
  ].join('\n');
}
