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
  /** Lighthouse's own measure of the machine's speed, which varies several-fold on GitHub. */
  environment?: { benchmarkIndex?: number };
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

/**
 * What one run's busy time was made of, for the log, so a slow run can be read back from a check:
 * the machine's speed (Lighthouse's benchmark; GitHub's runners vary several-fold) and the main
 * thread's three biggest kinds of work, in milliseconds as the machine took them.
 */
export function runDetail(lhr: LighthouseResult): string {
  const machine = lhr.environment?.benchmarkIndex;
  const work = (lhr.audits['mainthread-work-breakdown']?.details?.items ?? [])
    .map((item) => ({
      kind: String(item.groupLabel ?? item.group ?? 'other').toLowerCase(),
      ms: Number(item.duration ?? 0),
    }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3)
    .map(({ kind, ms }) => `${kind} ${Math.round(ms)}`)
    .join(', ');
  return `machine ${machine ? Math.round(machine) : 'unknown'}; main thread: ${work || 'idle'}`;
}

/** A run's long tasks, for the log: how long each was, and whose code it ran (`base`'s left off). */
export function longTasks(lhr: LighthouseResult, base: string): string {
  const tasks = (lhr.audits['long-tasks']?.details?.items ?? []).slice(0, 4).map((item) => {
    const url = String(item.url ?? 'unattributable').replace(base, '');
    return `${Math.round(Number(item.duration ?? 0))} ms ${url}`;
  });
  return tasks.length > 0 ? `long tasks: ${tasks.join(', ')}` : 'no long tasks';
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

/** The warm-up's own numbers: a reader's very first visit, cold, shown but never judged. */
export type FirstVisit = { path: string; busyMs: number; loadMs: number };

/**
 * What `speed-check.ts` writes as `website.json`. The extra two fields appear only in a part's
 * output (`SPEED_PART`), so a one-machine run's file is what it always was.
 */
export type WebsiteResult = {
  base: string;
  environment: string;
  runs: number;
  reports: PageReport[];
  /** A part's own: "2/3", which share of the pages it measured. */
  part?: string;
  /** A part's own: the cold first visit its browser made before measuring. */
  firstVisit?: FirstVisit;
};

/**
 * The whole report, as markdown: the table, the note under it, the faint text, the runs over a
 * budget and the cold first visit. Written by the one-machine check and by the joined parts alike.
 */
export function websiteMarkdown(
  reports: PageReport[],
  runs: number,
  firstVisit: FirstVisit | undefined,
): string {
  const faint = reports.flatMap((r) => r.contrast.problems.map((p) => `- \`${r.path}\`: ${p}`));
  const warnings = markdownWarnings(reports);
  return [
    markdownTable(reports),
    '',
    `Each number is the median of ${runs} run${runs === 1 ? '' : 's'} with Lighthouse's mobile preset (a mid-range ` +
      'Android phone on slow 4G), next to its budget. Sizes are hard limits; timings allow a ' +
      "small tolerance for GitHub's shared machines (`product/web/e2e/speed.ts`). Code and " +
      "total download include other sites' scripts and embeds.",
    ...(faint.length ? ['', '**Text too faint to read:**', ...faint] : []),
    ...(warnings ? ['', warnings] : []),
    ...(firstVisit
      ? [
          '',
          `**A first visit, cold** (shown, never judged): \`${firstVisit.path}\` in a browser just ` +
            `opened, its React and Next.js code compiled for the first time: busy ` +
            `${firstVisit.busyMs} ms, load ${(firstVisit.loadMs / 1000).toFixed(2)} s. Every run ` +
            'judged above is a visit with that code already compiled, as a reader moving around ' +
            "the site makes; a reader's very first visit pays this once.",
        ]
      : []),
  ].join('\n');
}

/**
 * The speed check on several machines (the trial that runs beside the one-machine check): machine
 * `index` of `of` measures every `of`-th page of the list, starting with the `index`-th.
 */
export type Part = { index: number; of: number };

/** Reads `SPEED_PART` ("2/3"): nothing when it isn't set; an error for anything that isn't a share. */
export function parsePart(text: string | undefined): Part | undefined {
  if (text === undefined || text === '') return undefined;
  const found = /^(\d+)\/(\d+)$/.exec(text);
  const index = Number(found?.[1]);
  const of = Number(found?.[2]);
  if (!found || index < 1 || of < 1 || index > of) {
    throw new Error(`SPEED_PART is "${text}", which isn't a share such as 2/3 (1 up to the total)`);
  }
  return { index, of };
}

/**
 * The pages one part measures: pages i-1, i-1+n, i-1+2n and so on of the full list, in the list's
 * order. Every page lands in exactly one part. The warm-up isn't part of this: every part warms up
 * on the full list's first page, as the one-machine check does.
 */
export function partOf<T>(pages: readonly T[], part: Part): T[] {
  return pages.filter((_, position) => position % part.of === part.index - 1);
}

const partNumber = (result: WebsiteResult) => parsePart(result.part)?.index ?? 0;

/**
 * Puts the parts' results back together as one machine's would be: the reports in the order of
 * `order` (the pages' paths as `pages.ts` lists them), the same base address, environment and
 * number of runs, the cold first visit of the part that measures the first page. Throws on what no
 * honest set of parts can produce: another environment or number of runs, a page measured twice,
 * or a page nobody lists. A page no part measured isn't an error here: the comparison says so.
 */
export function joinResults(results: WebsiteResult[], order: readonly string[]): WebsiteResult {
  const first = results[0];
  if (!first) throw new Error('There are no parts to join');
  for (const result of results) {
    if (result.environment !== first.environment || result.runs !== first.runs) {
      throw new Error(
        `The parts measured different things: ${first.environment} with ${first.runs} runs, ` +
          `${result.environment} with ${result.runs} runs`,
      );
    }
  }
  const byPath = new Map<string, PageReport>();
  for (const report of results.flatMap((result) => result.reports)) {
    if (!order.includes(report.path)) {
      throw new Error(`A part measured ${report.path}, which the page list doesn't have`);
    }
    if (byPath.has(report.path)) throw new Error(`${report.path} was measured by two parts`);
    byPath.set(report.path, report);
  }
  const ordered = [...results].sort((a, b) => partNumber(a) - partNumber(b));
  const reports = order.flatMap((path) => byPath.get(path) ?? []);
  return {
    base: first.base,
    environment: first.environment,
    runs: first.runs,
    reports,
    ...(ordered[0]?.firstVisit ? { firstVisit: ordered[0].firstVisit } : {}),
  };
}

/** How the one-machine run and the joined parts compared on one page. */
export type PageComparison = {
  path: string;
  clean: boolean;
  /** What differed, each line naming the number and both sides' values; empty when clean. */
  problems: string[];
};

export type Comparison = { clean: boolean; pages: PageComparison[] };

const RANGED = [
  { key: 'loadMs', label: 'Load', show: (v: number) => `${(v / 1000).toFixed(2)} s` },
  { key: 'blockingMs', label: 'Busy time', show: (v: number) => `${Math.round(v)} ms` },
  { key: 'layoutShift', label: 'Layout shift', show: (v: number) => v.toFixed(3) },
  { key: 'codeBytes', label: 'Code', show: (v: number) => `${(v / KB).toFixed(1)} KB` },
  { key: 'totalBytes', label: 'Total download', show: (v: number) => `${(v / KB).toFixed(1)} KB` },
] as const;

const passFail = (passes: boolean) => (passes ? 'passes' : 'fails');

function comparePage(one: PageReport, three: PageReport): string[] {
  const problems: string[] = [];
  for (const verdict of one.verdicts) {
    const other = three.verdicts.find((v) => v.label === verdict.label);
    if (!other) {
      problems.push(`${verdict.label}: the three machines gave no verdict`);
    } else if (other.passes !== verdict.passes) {
      problems.push(
        `${verdict.label}: ${passFail(verdict.passes)} on one machine (${verdict.value}), ` +
          `${passFail(other.passes)} on three (${other.value})`,
      );
    }
  }
  for (const { key, label, show } of RANGED) {
    const ones = one.runs.map((r) => r[key]);
    const threes = three.runs.map((r) => r[key]);
    if (ones.length === 0 || threes.length === 0) {
      problems.push(`${label}: a side has no runs to compare`);
      continue;
    }
    const middle = median(threes);
    const low = Math.min(...ones);
    const high = Math.max(...ones);
    if (middle < low || middle > high) {
      problems.push(
        `${label}: the three machines' median ${show(middle)} is outside the one machine's ` +
          `runs (${show(low)} to ${show(high)})`,
      );
    }
  }
  for (const scheme of ['light', 'dark'] as const) {
    if (one.contrast[scheme] !== three.contrast[scheme]) {
      problems.push(
        `Text contrast in the ${scheme} scheme: ${passFail(one.contrast[scheme])} on one machine, ` +
          `${passFail(three.contrast[scheme])} on three`,
      );
    }
  }
  return problems;
}

/**
 * The trial's question, page by page. A page is clean when every budget line passes or fails the
 * same on both, each of the three machines' medians (load, busy time, layout shift, code, total
 * download) lies between the lowest and the highest of the one machine's runs, and the contrast
 * verdicts are equal in both schemes. A page only one side measured is not clean, and no page at
 * all is not clean either.
 */
export function comparePages(one: PageReport[], three: PageReport[]): Comparison {
  const paths = [...new Set([...one, ...three].map((report) => report.path))];
  const pages = paths.map((path) => {
    const a = one.find((report) => report.path === path);
    const b = three.find((report) => report.path === path);
    const problems = !a
      ? ["the one-machine check didn't measure this page"]
      : !b
        ? ["the three machines didn't measure this page"]
        : comparePage(a, b);
    return { path, clean: problems.length === 0, problems };
  });
  return { clean: pages.length > 0 && pages.every((page) => page.clean), pages };
}

/**
 * The record each side-by-side comparison keeps for 30 days, which the tally
 * (`.github/scripts/side_by_side.py`) counts: `clean` only means something when `measured`.
 */
export type ComparisonRecord = {
  kind: 'speed';
  commit: string;
  pr: number | null;
  measured: boolean;
  baseline: boolean;
  clean: boolean;
  details: string[];
};

export function comparisonRecord(
  comparison: Comparison,
  commit: string,
  pr: number | null,
): ComparisonRecord {
  return {
    kind: 'speed',
    commit,
    pr,
    measured: true,
    baseline: true,
    clean: comparison.clean,
    details: comparison.pages.flatMap((page) =>
      page.problems.map((problem) => `${page.path}: ${problem}`),
    ),
  };
}

/** The comparison as the job's summary shows it: a verdict, then one row a page. */
export function comparisonMarkdown(comparison: Comparison): string {
  const unclean = comparison.pages.filter((page) => !page.clean);
  return [
    comparison.clean
      ? `**Clean:** all ${comparison.pages.length} pages measured the same way on one machine and on three.`
      : comparison.pages.length === 0
        ? '**Not clean:** no page was compared.'
        : `**Not clean:** ${unclean.length} of ${comparison.pages.length} pages differ.`,
    '',
    '| Page | Verdict | What differs |',
    '|---|---|---|',
    ...comparison.pages.map(
      (page) =>
        `| \`${page.path}\` | ${page.clean ? '✅ clean' : '❌ not clean'} | ` +
        `${page.problems.join('<br>') || '-'} |`,
    ),
  ].join('\n');
}
