import { describe, expect, it } from 'vitest';
import { budgets } from './pages.ts';
import {
  contrastOf,
  judge,
  type LighthouseResult,
  markdownTable,
  median,
  metricsFromLighthouse,
  type PageReport,
  pagePasses,
  type RunMetrics,
  summarize,
  TOLERANCE,
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
