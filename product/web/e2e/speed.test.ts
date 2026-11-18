import { describe, expect, it } from 'vitest';
import { budgets, pages, pagesIn } from './pages.ts';
import {
  comparePages,
  comparisonMarkdown,
  comparisonRecord,
  contrastOf,
  describeWarning,
  joinResults,
  judge,
  type LighthouseResult,
  longTasks,
  markdownTable,
  markdownWarnings,
  median,
  metricsFromLighthouse,
  overBudgetRuns,
  type PageReport,
  pagePasses,
  parsePart,
  partOf,
  type RunMetrics,
  runDetail,
  runNumbers,
  summarize,
  TOLERANCE,
  type WebsiteResult,
  websiteMarkdown,
} from './speed.ts';

const URL_UNDER_TEST = 'https://preview.example/privacy';

function lighthouseResult(overrides: Partial<LighthouseResult> = {}): LighthouseResult {
  return {
    finalDisplayedUrl: URL_UNDER_TEST,
    audits: {
      'largest-contentful-paint': { score: 1, numericValue: 1200 },
      'total-blocking-time': { score: 1, numericValue: 40 },
      'cumulative-layout-shift': { score: 1, numericValue: 0.02 },
      'color-contrast': { score: 1 },
      'resource-summary': {
        score: null,
        details: {
          items: [
            { resourceType: 'total', requestCount: 12, transferSize: 300 * 1024 },
            { resourceType: 'script', requestCount: 6, transferSize: 150 * 1024 },
            { resourceType: 'third-party', requestCount: 2, transferSize: 20 * 1024 },
          ],
        },
      },
    },
    ...overrides,
  };
}

const run = (overrides: Partial<RunMetrics> = {}): RunMetrics => ({
  loadMs: 1200,
  blockingMs: 40,
  layoutShift: 0.02,
  codeBytes: 150 * 1024,
  totalBytes: 300 * 1024,
  otherSitesBytes: 20 * 1024,
  requests: 12,
  contrastPasses: true,
  contrastProblems: [],
  ...overrides,
});

describe('reading a Lighthouse run', () => {
  it('takes the timings, the sizes from every site and the contrast audit', () => {
    expect(metricsFromLighthouse(lighthouseResult(), URL_UNDER_TEST)).toEqual(run());
  });

  it("refuses a run that ended somewhere else (Vercel's login page)", () => {
    const lhr = lighthouseResult({ finalDisplayedUrl: 'https://vercel.com/login?next=x' });
    expect(() => metricsFromLighthouse(lhr, URL_UNDER_TEST)).toThrow(/another address/);
  });

  it("refuses a run Lighthouse couldn't finish, or a number it couldn't measure", () => {
    const failed = lighthouseResult({ runtimeError: { code: 'NO_FCP', message: 'x' } });
    expect(() => metricsFromLighthouse(failed, URL_UNDER_TEST)).toThrow(/NO_FCP/);
    const noLcp = lighthouseResult();
    noLcp.audits['largest-contentful-paint'] = { score: null };
    expect(() => metricsFromLighthouse(noLcp, URL_UNDER_TEST)).toThrow(/largest-contentful-paint/);
  });

  it('reports what the contrast audit flagged', () => {
    const lhr = lighthouseResult();
    lhr.audits['color-contrast'] = {
      score: 0,
      details: { items: [{ node: { snippet: '<p class="faint">' } }] },
    };
    expect(contrastOf(lhr, URL_UNDER_TEST)).toEqual({
      passes: false,
      problems: ['<p class="faint">'],
    });
  });

  it('passes contrast on a page with no text to check', () => {
    const lhr = lighthouseResult();
    lhr.audits['color-contrast'] = { score: null, scoreDisplayMode: 'notApplicable' };
    expect(contrastOf(lhr, URL_UNDER_TEST).passes).toBe(true);
  });
});

describe("a run's detail, for the log", () => {
  it("gives the machine's speed and the main thread's three biggest kinds of work", () => {
    const lhr = lighthouseResult({ environment: { benchmarkIndex: 1234.6 } });
    lhr.audits['mainthread-work-breakdown'] = {
      score: 1,
      details: {
        items: [
          { group: 'styleLayout', groupLabel: 'Style & Layout', duration: 31.2 },
          { group: 'scriptEvaluation', groupLabel: 'Script Evaluation', duration: 410.6 },
          { group: 'other', groupLabel: 'Other', duration: 190.4 },
          { group: 'scriptParseCompile', groupLabel: 'Script Parsing & Compilation', duration: 60 },
        ],
      },
    };
    expect(runDetail(lhr)).toBe(
      'machine 1235; main thread: script evaluation 411, other 190, script parsing & compilation 60',
    );
  });

  it("lists a run's long tasks, each with whose code it ran", () => {
    const lhr = lighthouseResult();
    lhr.audits['long-tasks'] = {
      score: 1,
      details: {
        items: [
          { url: 'https://preview.example/_next/static/chunks/a.js', duration: 412.4 },
          { url: 'Unattributable', duration: 96.6 },
        ],
      },
    };
    expect(longTasks(lhr, 'https://preview.example')).toBe(
      'long tasks: 412 ms /_next/static/chunks/a.js, 97 ms Unattributable',
    );
    expect(longTasks(lighthouseResult(), 'https://preview.example')).toBe('no long tasks');
  });

  it('says so when Lighthouse gave neither', () => {
    expect(runDetail(lighthouseResult())).toBe('machine unknown; main thread: idle');
  });
});

describe('the median of the runs', () => {
  it('takes the middle value, or the mean of the two middle values', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it('ignores one slow run out of five', () => {
    const runs = [run(), run(), run({ loadMs: 9000, blockingMs: 900 }), run(), run()];
    expect(summarize(runs)).toMatchObject({ loadMs: 1200, blockingMs: 40 });
  });

  it('fails contrast only when most runs fail it', () => {
    const faint = run({ contrastPasses: false, contrastProblems: ['<p>'] });
    expect(summarize([faint, run(), run()]).contrastPasses).toBe(true);
    expect(summarize([faint, faint, run()])).toMatchObject({
      contrastPasses: false,
      contrastProblems: ['<p>'],
    });
  });
});

describe('judging against the budget', () => {
  const standard = budgets.standard;

  it('passes a page inside its budget', () => {
    expect(judge(run(), standard).every((v) => v.passes)).toBe(true);
  });

  it('lets timings go a little over, within the tolerance, and no further', () => {
    const near = run({
      loadMs: standard.loadMs + TOLERANCE.loadMs,
      blockingMs: standard.blockingMs + TOLERANCE.blockingMs,
      layoutShift: standard.layoutShift + TOLERANCE.layoutShift,
    });
    expect(judge(near, standard).every((v) => v.passes)).toBe(true);
    const over = run({ loadMs: standard.loadMs + TOLERANCE.loadMs + 1 });
    expect(judge(over, standard).find((v) => v.label.startsWith('Load'))?.passes).toBe(false);
  });

  it('treats the download sizes as hard limits', () => {
    const verdicts = judge(
      run({ codeBytes: standard.codeKB * 1024 + 1, totalBytes: standard.totalKB * 1024 + 1 }),
      standard,
    );
    expect(verdicts.filter((v) => !v.passes).map((v) => v.label)).toEqual([
      'Code',
      'Total download',
    ]);
  });
});

describe('the table on the pull request', () => {
  const report = (overrides: Partial<PageReport> = {}): PageReport => ({
    name: 'privacy',
    path: '/privacy',
    verdicts: judge(run(), budgets.standard),
    contrast: { light: true, dark: true, problems: [] },
    otherSitesBytes: 0,
    requests: 12,
    warnings: [],
    runs: [runNumbers(run())],
    ...overrides,
  });

  it('shows each number next to its budget, one row a page', () => {
    const table = markdownTable([report()]);
    expect(table).toContain('| `/privacy` | ✅ 1.20 s / 2.50 s | ✅ 40 ms / 200 ms |');
    expect(table).toContain('✅ 150.0 KB / 200 KB | ✅ 300.0 KB / 500 KB | ✅ light and dark |');
  });

  it('fails a page with faint text in either colour scheme', () => {
    const faint = report({ contrast: { light: true, dark: false, problems: ['dark: <p>'] } });
    expect(pagePasses(faint)).toBe(false);
    expect(markdownTable([faint])).toContain('❌ dark');
    expect(pagePasses(report())).toBe(true);
  });
});

describe('single runs over a budget', () => {
  const standard = budgets.standard;

  it('warns about every run past the budget itself, with no tolerance, and nothing else', () => {
    const runs = [
      run(),
      run({ blockingMs: standard.blockingMs + 1 }),
      run({ blockingMs: standard.blockingMs }),
      run({ loadMs: standard.loadMs + 1, blockingMs: 285 }),
      run({ layoutShift: standard.layoutShift + 0.001 }),
    ];
    expect(overBudgetRuns(runs, standard).map((w) => describeWarning('/page', w))).toEqual([
      '/page: Load (largest content) 2.51 s in run 4 of 5 (budget 2.50 s)',
      '/page: Busy time (blocking) 201 ms in run 2 of 5 (budget 200 ms)',
      '/page: Busy time (blocking) 285 ms in run 4 of 5 (budget 200 ms)',
      '/page: Layout shift 0.101 in run 5 of 5 (budget 0.10)',
    ]);
  });

  it('warns about a download over its limit in any run', () => {
    const runs = [run(), run({ codeBytes: standard.codeKB * 1024 + 1 })];
    expect(overBudgetRuns(runs, standard)).toEqual([
      { label: 'Code', run: 2, runs: 2, value: '200.1 KB', limit: '200 KB' },
    ]);
  });

  it('never fails a page: the median decides, as it did before the warnings', () => {
    const runs = [run(), run(), run({ blockingMs: 900 }), run(), run()];
    expect(overBudgetRuns(runs, standard)).toHaveLength(1);
    expect(judge(summarize(runs), standard).every((v) => v.passes)).toBe(true);
  });

  it('lists the warnings under the table, and nothing when no run crossed a budget', () => {
    const quiet: PageReport = {
      name: 'privacy',
      path: '/privacy',
      verdicts: judge(run(), standard),
      contrast: { light: true, dark: true, problems: [] },
      otherSitesBytes: 0,
      requests: 12,
      warnings: [],
      runs: [runNumbers(run())],
    };
    expect(markdownWarnings([quiet])).toBe('');
    const drifting = {
      ...quiet,
      path: '/console/markets/new',
      warnings: overBudgetRuns([run(), run({ blockingMs: 285 })], standard),
    };
    const markdown = markdownWarnings([quiet, drifting]);
    expect(markdown).toContain('**Single runs over a budget**');
    expect(markdown).toContain(
      '- `/console/markets/new: Busy time (blocking) 285 ms in run 2 of 2 (budget 200 ms)`',
    );
    expect(markdown).not.toContain('/privacy');
  });

  it("keeps each run's numbers, rounded", () => {
    expect(runNumbers(run({ blockingMs: 123.4, loadMs: 765.6, layoutShift: 0.012345 }))).toEqual({
      loadMs: 766,
      blockingMs: 123,
      layoutShift: 0.0123,
      codeBytes: 150 * 1024,
      totalBytes: 300 * 1024,
    });
  });
});

/** One page's report, as a machine would write it: five runs of the given numbers, judged. */
function pageReport(path: string, runs: RunMetrics[] = Array.from({ length: 5 }, () => run())) {
  const report: PageReport = {
    name: path.replaceAll('/', '') || 'home',
    path,
    verdicts: judge(summarize(runs), budgets.standard),
    contrast: { light: true, dark: true, problems: [] },
    otherSitesBytes: 0,
    requests: 12,
    warnings: overBudgetRuns(runs, budgets.standard),
    runs: runs.map(runNumbers),
  };
  return report;
}

const slowRuns = (loadMs: number) => [
  run({ loadMs: loadMs - 100 }),
  run({ loadMs: loadMs - 50 }),
  run({ loadMs }),
  run({ loadMs: loadMs + 50 }),
  run({ loadMs: loadMs + 100 }),
];

describe('the pages one machine of the trial measures', () => {
  const list = pagesIn('staging');

  it('gives every page to exactly one machine, for one to four machines', () => {
    for (let of = 1; of <= 4; of++) {
      const shares = Array.from({ length: of }, (_, i) => partOf(list, { index: i + 1, of }));
      expect(
        shares
          .flat()
          .map((page) => page.path)
          .sort(),
      ).toEqual(list.map((page) => page.path).sort());
      expect(new Set(shares.flat()).size).toBe(list.length);
    }
  });

  it('is the whole list for one machine, and every third page for three, in the list order', () => {
    expect(partOf(list, { index: 1, of: 1 })).toEqual(list);
    const sizes: number[] = [];
    for (const index of [1, 2, 3]) {
      const share = partOf(list, { index, of: 3 });
      expect(share).toEqual(list.filter((_, position) => position % 3 === index - 1));
      sizes.push(share.length);
    }
    // However many pages there are, no machine gets more than one page over another.
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((a, b) => a + b)).toBe(list.length);
  });

  it("leaves the list alone, so every machine's warm-up is still on the list's first page", () => {
    const before = [...list];
    const first = list[0];
    for (let index = 1; index <= 3; index++) partOf(list, { index, of: 3 });
    expect(list).toEqual(before);
    expect(first?.path).toBe('/');
    // The warm-up takes the first page of the whole list, before any share is taken (speed-check.ts),
    // so the first page is the first of machine 1's share only: no other machine measures it.
    expect(partOf(list, { index: 1, of: 3 })[0]).toBe(first);
    expect(partOf(list, { index: 2, of: 3 })).not.toContain(first);
    expect(partOf(list, { index: 3, of: 3 })).not.toContain(first);
  });

  it("measures production's shorter list the same way", () => {
    const production = pagesIn('production');
    expect(production.length).toBeLessThan(pages.length);
    const shares = [1, 2, 3].map((index) => partOf(production, { index, of: 3 }));
    expect(shares.flat()).toHaveLength(production.length);
  });

  it('reads SPEED_PART: nothing when unset, a share when it is one, an error for anything else', () => {
    expect(parsePart(undefined)).toBeUndefined();
    expect(parsePart('')).toBeUndefined();
    expect(parsePart('2/3')).toEqual({ index: 2, of: 3 });
    expect(parsePart('1/1')).toEqual({ index: 1, of: 1 });
    for (const bad of [
      '0/3',
      '4/3',
      '2',
      '/3',
      '2/',
      'a/b',
      '1/0',
      '2/3/4',
      ' 2/3',
      '-1/3',
      '1.5/3',
    ]) {
      expect(() => parsePart(bad), bad).toThrow(/SPEED_PART/);
    }
  });
});

describe("joining the trial's parts", () => {
  const order = pagesIn('staging').map((page) => page.path);
  const whole = order.map((path) => pageReport(path));
  const firstVisit = { path: '/', busyMs: 410, loadMs: 1900 };
  const partResult = (index: number, extra: Partial<WebsiteResult> = {}): WebsiteResult => ({
    base: 'https://preview.example',
    environment: 'preview',
    runs: 5,
    reports: partOf(whole, { index, of: 3 }),
    part: `${index}/3`,
    firstVisit: index === 1 ? firstVisit : { path: '/', busyMs: 999, loadMs: 9999 },
    ...extra,
  });
  const parts = [1, 2, 3].map((index) => partResult(index));

  it("gives the reports in the page list's order whichever order the parts arrive in", () => {
    for (const arrival of [
      [0, 1, 2],
      [2, 0, 1],
      [1, 2, 0],
      [2, 1, 0],
    ]) {
      const joined = joinResults(
        arrival.map((i) => parts[i] as WebsiteResult),
        order,
      );
      expect(joined.reports.map((report) => report.path)).toEqual(order);
      expect(joined.reports).toEqual(whole);
    }
  });

  it("gives today's single-run output: the same markdown, the first part's cold first visit", () => {
    const joined = joinResults([parts[2], parts[0], parts[1]] as WebsiteResult[], order);
    expect(joined).toMatchObject({
      base: 'https://preview.example',
      environment: 'preview',
      runs: 5,
    });
    expect(websiteMarkdown(joined.reports, joined.runs, joined.firstVisit)).toBe(
      websiteMarkdown(whole, 5, firstVisit),
    );
  });

  it('refuses parts that measured different things, a page twice, or a page nobody lists', () => {
    expect(() => joinResults([], order)).toThrow(/no parts/);
    expect(() =>
      joinResults([parts[0] as WebsiteResult, partResult(2, { runs: 3 })], order),
    ).toThrow(/different things/);
    expect(() =>
      joinResults([parts[0] as WebsiteResult, partResult(2, { environment: 'staging' })], order),
    ).toThrow(/different things/);
    expect(() =>
      joinResults([parts[0] as WebsiteResult, parts[0] as WebsiteResult], order),
    ).toThrow(/measured by two parts/);
    const stray = partResult(2, { reports: [pageReport('/no-such-page')] });
    expect(() => joinResults([parts[0] as WebsiteResult, stray], order)).toThrow(/doesn't have/);
  });

  it('leaves a page no part measured out, for the comparison to name', () => {
    const joined = joinResults([parts[0], parts[1]] as WebsiteResult[], order);
    expect(joined.reports).toHaveLength(
      (parts[0] as WebsiteResult).reports.length + (parts[1] as WebsiteResult).reports.length,
    );
    expect(comparePages(whole, joined.reports).clean).toBe(false);
  });
});

describe("today's report, written the same way after the lift out of the check", () => {
  const first = { path: '/', busyMs: 412, loadMs: 1930 };
  const drifting = pageReport('/console', [run(), run({ blockingMs: 285 })]);

  it('is the table, the note, the faint text, the runs over a budget and the cold first visit, in that order', () => {
    const faint = pageReport('/privacy');
    faint.contrast = { light: true, dark: false, problems: ['dark scheme: <p class="faint">'] };
    const markdown = websiteMarkdown([drifting, faint], 5, first);
    expect(markdown).toBe(
      [
        markdownTable([drifting, faint]),
        '',
        "Each number is the median of 5 runs with Lighthouse's mobile preset (a mid-range Android phone " +
          'on slow 4G), next to its budget. Sizes are hard limits; timings allow a small tolerance for ' +
          "GitHub's shared machines (`product/web/e2e/speed.ts`). Code and total download include other " +
          "sites' scripts and embeds.",
        '',
        '**Text too faint to read:**',
        '- `/privacy`: dark scheme: <p class="faint">',
        '',
        markdownWarnings([drifting, faint]),
        '',
        '**A first visit, cold** (shown, never judged): `/` in a browser just opened, its React and ' +
          'Next.js code compiled for the first time: busy 412 ms, load 1.93 s. Every run judged above ' +
          'is a visit with that code already compiled, as a reader moving around the site makes; a ' +
          "reader's very first visit pays this once.",
      ].join('\n'),
    );
  });

  it('leaves out what there is none of, and says "1 run" for one', () => {
    const markdown = websiteMarkdown([pageReport('/privacy')], 1, undefined);
    expect(markdown).toBe(
      [
        markdownTable([pageReport('/privacy')]),
        '',
        "Each number is the median of 1 run with Lighthouse's mobile preset (a mid-range Android phone " +
          'on slow 4G), next to its budget. Sizes are hard limits; timings allow a small tolerance for ' +
          "GitHub's shared machines (`product/web/e2e/speed.ts`). Code and total download include other " +
          "sites' scripts and embeds.",
      ].join('\n'),
    );
  });
});

describe('comparing one machine with three', () => {
  const same = () => [pageReport('/'), pageReport('/privacy'), pageReport('/terms')];

  it('is clean when every page agrees, medians inside the one machine range', () => {
    const one = [pageReport('/privacy', slowRuns(1500))];
    // Three machines' runs sit inside the one machine's 1,400 to 1,600 ms, their median at 1,550.
    const three = [pageReport('/privacy', slowRuns(1550))];
    expect(comparePages(one, three)).toEqual({
      clean: true,
      pages: [{ path: '/privacy', clean: true, problems: [] }],
    });
    expect(comparePages(same(), same()).clean).toBe(true);
  });

  it('is not clean when a budget line passes one way and fails the other', () => {
    const one = [pageReport('/privacy', slowRuns(2400))];
    const three = [pageReport('/privacy', slowRuns(2800))]; // 2.8 s is over 2.5 s plus 0.25 s
    const result = comparePages(one, three);
    expect(result.clean).toBe(false);
    const problems = result.pages[0]?.problems ?? [];
    expect(
      problems.some((p) => p.startsWith('Load (largest content): passes on one machine')),
    ).toBe(true);
    expect(problems.some((p) => p.includes('fails on three'))).toBe(true);
  });

  it("is not clean when a median falls outside the one machine's runs, naming both sides", () => {
    const cases: [string, Partial<RunMetrics>, RegExp][] = [
      [
        'load',
        { loadMs: 1700 },
        /Load: the three machines' median 1700 ms is outside the one machine's runs \(1100 ms to 1300 ms\)/,
      ],
      [
        'busy time',
        { blockingMs: 90 },
        /Busy time: .* median 90 ms is outside .*\(30 ms to 50 ms\)/,
      ],
      [
        'layout shift',
        { layoutShift: 0.05 },
        /Layout shift: .* median 0\.0500 is outside .*\(0\.0100 to 0\.0300\)/,
      ],
      [
        'code',
        { codeBytes: 151 * 1024 },
        /Code: .* median 154624 bytes is outside .*\(153600 bytes to 153600 bytes\)/,
      ],
      ['total', { totalBytes: 299 * 1024 }, /Total download: .* median 306176 bytes is outside/],
    ];
    const spread = [
      run({ loadMs: 1100, blockingMs: 30, layoutShift: 0.01 }),
      run({ loadMs: 1200, blockingMs: 40, layoutShift: 0.02 }),
      run({ loadMs: 1200, blockingMs: 40, layoutShift: 0.02 }),
      run({ loadMs: 1200, blockingMs: 40, layoutShift: 0.02 }),
      run({ loadMs: 1300, blockingMs: 50, layoutShift: 0.03 }),
    ];
    for (const [what, change, message] of cases) {
      const three = spread.map((r) => ({ ...r, ...change }));
      const result = comparePages(
        [pageReport('/privacy', spread)],
        [pageReport('/privacy', three)],
      );
      expect(result.clean, what).toBe(false);
      expect(result.pages[0]?.problems.join('\n'), what).toMatch(message);
    }
  });

  it('says a miss of one byte or one millisecond in numbers that differ, never as equal ones', () => {
    const one = [pageReport('/', [run(), run(), run()])];
    const bytes = comparePages(one, [pageReport('/', [run({ codeBytes: 150 * 1024 + 1 })])]);
    expect(bytes.pages[0]?.problems).toEqual([
      "Code: the three machines' median 153601 bytes is outside the one machine's runs (153600 bytes to 153600 bytes)",
    ]);
    const time = comparePages(one, [pageReport('/', [run({ loadMs: 1201 })])]);
    expect(time.pages[0]?.problems).toEqual([
      "Load: the three machines' median 1201 ms is outside the one machine's runs (1200 ms to 1200 ms)",
    ]);
  });

  it("counts the edges of the one machine's runs as inside", () => {
    const spread = [run({ loadMs: 1100 }), run({ loadMs: 1200 }), run({ loadMs: 1300 })];
    const lowest = spread.map(() => run({ loadMs: 1100 }));
    const highest = spread.map(() => run({ loadMs: 1300 }));
    expect(comparePages([pageReport('/', spread)], [pageReport('/', lowest)]).clean).toBe(true);
    expect(comparePages([pageReport('/', spread)], [pageReport('/', highest)]).clean).toBe(true);
  });

  it('is not clean when the contrast verdicts differ, in either scheme', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const three = [pageReport('/privacy')];
      (three[0] as PageReport).contrast = { light: true, dark: true, problems: [] };
      (three[0] as PageReport).contrast[scheme] = false;
      const result = comparePages([pageReport('/privacy')], three);
      expect(result.clean).toBe(false);
      expect(result.pages[0]?.problems).toEqual([
        `Text contrast in the ${scheme} scheme: passes on one machine, fails on three`,
      ]);
    }
  });

  it('is not clean when a page is missing from either side, naming which', () => {
    const missingThree = comparePages(same(), same().slice(0, 2));
    expect(missingThree.clean).toBe(false);
    expect(missingThree.pages.find((p) => p.path === '/terms')?.problems).toEqual([
      "the three machines didn't measure this page",
    ]);
    const missingOne = comparePages(same().slice(1), same());
    expect(missingOne.clean).toBe(false);
    expect(missingOne.pages.find((p) => p.path === '/')?.problems).toEqual([
      "the one-machine check didn't measure this page",
    ]);
    expect(missingOne.pages.filter((p) => p.clean)).toHaveLength(2);
  });

  it('is not clean when there is nothing to compare', () => {
    expect(comparePages([], []).clean).toBe(false);
  });

  it('records the answer for the tally, and shows a verdict with a row a page', () => {
    const three = same();
    three[1] = pageReport('/privacy', slowRuns(2000));
    const result = comparePages(same(), three);
    const record = comparisonRecord(result, 'abc1234', 160);
    expect(record).toMatchObject({
      kind: 'speed',
      commit: 'abc1234',
      pr: 160,
      measured: true,
      baseline: true,
      clean: false,
    });
    expect(record.details.every((line) => line.startsWith('/privacy: '))).toBe(true);
    expect(record.details.length).toBeGreaterThan(0);
    expect(comparisonRecord(comparePages(same(), same()), 'abc1234', null)).toMatchObject({
      pr: null,
      clean: true,
      details: [],
    });
    const markdown = comparisonMarkdown(result);
    expect(markdown).toContain('**Not clean:** 1 of 3 pages differ.');
    expect(markdown).toContain('| `/` | ✅ clean | - |');
    expect(markdown).toContain('| `/privacy` | ❌ not clean | ');
    expect(comparisonMarkdown(comparePages(same(), same()))).toContain(
      '**Clean:** all 3 pages measured the same way on one machine and on three.',
    );
    expect(comparisonMarkdown(comparePages([], []))).toContain('no page was compared');
  });
});
