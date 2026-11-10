import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import lighthouse, { type Flags } from 'lighthouse';
import puppeteer, { type Browser, type Page as Tab } from 'puppeteer-core';
import { budgets, type Page, pagesIn } from './pages.ts';
import {
  contrastOf,
  describeWarning,
  judge,
  type LighthouseResult,
  markdownTable,
  markdownWarnings,
  metricsFromLighthouse,
  overBudgetRuns,
  type PageReport,
  pagePasses,
  RUNS,
  type RunMetrics,
  runDetail,
  runNumbers,
  summarize,
} from './speed.ts';
import { BYPASS_COOKIE, bypassCookieValue } from './support/bypass.ts';

/**
 * The speed check (PLAN.md step 1.5, blueprint section 14): every page in `pages.ts`, measured
 * with Lighthouse's mobile preset (a mid-range Android phone on slow 4G) as the median of 5
 * runs, against its budget, plus Lighthouse's contrast audit in the light and the dark colour
 * scheme. It counts everything a page downloads, other sites' scripts and embeds included.
 *
 *   node e2e/speed-check.ts               # this Mac's website, http://localhost:3000
 *   node e2e/speed-check.ts --self-test   # proves it counts other sites' code and embeds
 *
 * Settings, all optional: BASE_URL (a preview, in CI), VERCEL_AUTOMATION_BYPASS_SECRET (for a
 * protected deployment), CHROME_PATH, SPEED_RUNS (default 5) and SPEED_OUT (where the results
 * and each page's Lighthouse report go; default `speed-results`).
 *
 * Protected deployments: the bypass secret goes to our own address once, for Vercel's bypass
 * cookie, and Lighthouse runs with only that cookie (support/bypass.ts), so the secret never
 * reaches the other sites a page loads (such as X's embeds).
 */

const out = process.env.SPEED_OUT ?? 'speed-results';

function chromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return '/usr/bin/google-chrome';
}

/** Which environment the address is (from its /api/health), so absent pages are skipped. */
async function environmentOf(base: string, headers: Record<string, string>): Promise<string> {
  const response = await fetch(new URL('/api/health', base), { headers, redirect: 'manual' });
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`${base}/api/health answered ${response.status}; is the address right?`);
  }
  return ((await response.json()) as { environment: string }).environment;
}

async function openBrowser(): Promise<{ browser: Browser; tab: Tab }> {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  return { browser, tab: await browser.newPage() };
}

/** One Lighthouse run in the given tab, with Lighthouse's default (mobile) settings. */
async function lighthouseRun(
  tab: Tab,
  url: string,
  flags: Flags,
): Promise<{ lhr: LighthouseResult; report: string }> {
  const result = await lighthouse(
    url,
    { logLevel: 'error', output: 'html', ...flags },
    undefined,
    tab,
  );
  if (!result) throw new Error(`Lighthouse returned nothing for ${url}`);
  return { lhr: result.lhr as unknown as LighthouseResult, report: String(result.report) };
}

async function colourScheme(tab: Tab, scheme: 'light' | 'dark') {
  await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
}

/** Serves `server` on a free port of this machine and returns the port. */
function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port)),
  );
}

/**
 * Chrome's own start-up isn't any page's busy time. The first Lighthouse run in a browser opened
 * just now also starts the browser itself (its first page, its fonts, Lighthouse's own first
 * trace), and it fell on whichever page went first: the home page, at 266 to 1176 ms against its
 * usual 70. So one run of a plain page served from this machine comes first, not counted. It
 * warms none of the site's own code: the first page is still measured as a first visit, in a
 * browser that's already running, like every page after it.
 */
async function warmUp(tab: Tab) {
  const page = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html lang="en"><head>
      <meta name="viewport" content="width=device-width"><title>Warm-up</title></head><body>
      <h1>Warm-up</h1><p>A plain page that starts the browser before any page is measured.</p>
      <script>document.body.dataset.ready = 'yes';</script></body></html>`);
  });
  const port = await listen(page, 'localhost');
  try {
    const started = Date.now();
    const { lhr } = await lighthouseRun(tab, `http://localhost:${port}/`, {
      onlyCategories: ['performance'],
    });
    const busy = lhr.audits['total-blocking-time']?.numericValue ?? 0;
    console.log(
      `  warm-up, a plain page on this machine, not counted (${((Date.now() - started) / 1000).toFixed(1)} s): ` +
        `busy ${Math.round(busy)} ms; ${runDetail(lhr)}`,
    );
  } finally {
    page.close();
  }
}

/** Measures one page: `runs` full runs, then the contrast audit once more in the dark scheme. */
async function measurePage(tab: Tab, base: string, page: Page, runs: number): Promise<PageReport> {
  const url = new URL(page.path, base).href;
  // The 404 page answers 404 on purpose; Lighthouse refuses that unless told.
  const ignoreStatusCode = (page.status ?? 200) >= 400;
  const results: { metrics: RunMetrics; report: string }[] = [];
  await colourScheme(tab, 'light');
  for (let run = 1; run <= runs; run++) {
    const started = Date.now();
    const { lhr, report } = await lighthouseRun(tab, url, {
      onlyCategories: ['performance', 'accessibility'],
      ignoreStatusCode,
    });
    const metrics = metricsFromLighthouse(lhr, url);
    results.push({ metrics, report });
    // Each run's own numbers in the log, so any page's spread can be read back from a check.
    console.log(
      `  ${page.path}: run ${run} of ${runs} (${((Date.now() - started) / 1000).toFixed(1)} s): ` +
        `busy ${Math.round(metrics.blockingMs)} ms, load ${(metrics.loadMs / 1000).toFixed(2)} s, ` +
        `shift ${metrics.layoutShift.toFixed(3)}; ${runDetail(lhr)}`,
    );
  }
  const summary = summarize(results.map((r) => r.metrics));

  const darkStarted = Date.now();
  await colourScheme(tab, 'dark');
  const { lhr: darkRun } = await lighthouseRun(tab, url, {
    onlyAudits: ['color-contrast'],
    ignoreStatusCode,
  });
  const appliedDark = await tab.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  await colourScheme(tab, 'light');
  if (!appliedDark)
    throw new Error('The dark colour scheme was not applied, so dark text went unchecked');
  const dark = contrastOf(darkRun, url);
  console.log(
    `  ${page.path}: contrast in the dark scheme (${((Date.now() - darkStarted) / 1000).toFixed(1)} s)`,
  );

  // Keep the Lighthouse report of the run closest to the median load time.
  const closest = results.reduce((best, r) =>
    Math.abs(r.metrics.loadMs - summary.loadMs) < Math.abs(best.metrics.loadMs - summary.loadMs)
      ? r
      : best,
  );
  await mkdir(join(out, 'reports'), { recursive: true });
  await writeFile(join(out, 'reports', `${page.name}.html`), closest.report);

  const budget = budgets[page.budget];
  return {
    name: page.name,
    path: page.path,
    verdicts: judge(summary, budget),
    contrast: {
      light: summary.contrastPasses,
      dark: dark.passes,
      problems: [...summary.contrastProblems, ...dark.problems.map((p) => `dark scheme: ${p}`)],
    },
    otherSitesBytes: summary.otherSitesBytes,
    requests: summary.requests,
    warnings: overBudgetRuns(
      results.map((r) => r.metrics),
      budget,
    ),
    runs: results.map((r) => runNumbers(r.metrics)),
  };
}

async function main() {
  const base = process.env.BASE_URL ?? 'http://localhost:3000';
  const runs = Number(process.env.SPEED_RUNS ?? RUNS);
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const headers: Record<string, string> = secret ? { 'x-vercel-protection-bypass': secret } : {};
  const environment = await environmentOf(base, headers);
  console.log(`Speed check on ${base} (${environment}): ${runs} runs a page, mobile preset`);

  const { browser, tab } = await openBrowser();
  const reports: PageReport[] = [];
  try {
    if (secret) {
      await browser.setCookie({
        name: BYPASS_COOKIE,
        value: await bypassCookieValue(base, secret),
        domain: new URL(base).hostname,
        path: '/',
        secure: true,
        httpOnly: true,
      });
    }
    await warmUp(tab);
    for (const page of pagesIn(environment)) {
      reports.push(await measurePage(tab, base, page, runs));
    }
  } finally {
    await browser.close();
  }

  const failing = reports.filter((report) => !pagePasses(report));
  const faint = reports.flatMap((r) => r.contrast.problems.map((p) => `- \`${r.path}\`: ${p}`));
  const warnings = markdownWarnings(reports);
  const markdown = [
    markdownTable(reports),
    '',
    `Each number is the median of ${runs} run${runs === 1 ? '' : 's'} with Lighthouse's mobile preset (a mid-range ` +
      'Android phone on slow 4G), next to its budget. Sizes are hard limits; timings allow a ' +
      "small tolerance for GitHub's shared machines (`product/web/e2e/speed.ts`). Code and " +
      "total download include other sites' scripts and embeds.",
    ...(faint.length ? ['', '**Text too faint to read:**', ...faint] : []),
    ...(warnings ? ['', warnings] : []),
  ].join('\n');
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'website.md'), `${markdown}\n`);
  await writeFile(
    join(out, 'website.json'),
    `${JSON.stringify({ base, environment, runs, reports }, null, 2)}\n`,
  );
  console.log(`\n${markdown}\n`);
  // Each single run over a budget as a GitHub warning on the check: it shows on the pull request
  // and in the run's summary, and never fails the check (only the medians above can).
  for (const report of reports) {
    for (const warning of report.warnings) {
      console.log(
        `::warning title=Speed check: one run over a budget::${describeWarning(report.path, warning)}`,
      );
    }
  }
  if (failing.length > 0) {
    console.error(`Over budget: ${failing.map((r) => r.path).join(', ')}`);
    process.exit(1);
  }
}

/**
 * Proves the check counts what it must. A page on one local address loads a script from a
 * second address and an iframe from it (as an embedded post would), and the iframe loads its
 * own script; the page also has text too faint to read in each colour scheme. The check must
 * count both scripts as code and as other sites' downloads, and fail contrast in both schemes.
 */
async function selfTest() {
  const filler = (kb: number) => `/*${'x'.repeat(kb * 1024)}*/`;
  const embed = createServer((request, response) => {
    const scripts: Record<string, string> = {
      '/widget.js': `${filler(60)}document.title += '';`,
      '/frame.js': `${filler(50)}document.body.dataset.embed = 'ready';`,
    };
    const script = scripts[request.url ?? ''];
    response.writeHead(200, { 'content-type': script ? 'text/javascript' : 'text/html' });
    response.end(
      script ?? '<!doctype html><p>An embedded post</p><script src="/frame.js"></script>',
    );
  });
  const embedPort = await listen(embed, '127.0.0.1');
  const site = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html lang="en"><head>
      <meta name="viewport" content="width=device-width"><title>Self-test</title>
      <style>
        .faint-light { color: #c8c8c8; background: #fff; }
        .faint-dark { color: #222; background: #fff; }
        @media (prefers-color-scheme: dark) {
          body { background: #000; color: #fff; }
          .faint-light { color: #fff; background: #000; }
          .faint-dark { color: #222; background: #000; }
        }
      </style></head><body>
      <h1>A page with an embed</h1>
      <p class="faint-light">Too faint to read in the light scheme</p>
      <p class="faint-dark">Too faint to read in the dark scheme</p>
      <script src="http://127.0.0.1:${embedPort}/widget.js"></script>
      <iframe title="An embedded post" src="http://127.0.0.1:${embedPort}/post"></iframe>
      </body></html>`);
  });
  const sitePort = await listen(site, 'localhost');
  const { browser, tab } = await openBrowser();
  try {
    const report = await measurePage(
      tab,
      `http://localhost:${sitePort}`,
      { route: '/', name: 'self-test', path: '/', budget: 'standard' },
      1,
    );
    const codeKB = Number.parseFloat(report.verdicts.find((v) => v.label === 'Code')?.value ?? '');
    const problems = [
      !(codeKB >= 110) && `counted ${codeKB} KB of code instead of both scripts (110 KB or more)`,
      report.otherSitesBytes < 110 * 1024 && "didn't count the other address's downloads",
      report.contrast.light && "didn't flag the faint text in the light scheme",
      report.contrast.dark && "didn't flag the faint text in the dark scheme",
    ].filter(Boolean);
    if (problems.length > 0) {
      console.error(`Self-test failed: the check ${problems.join('; ')}.`);
      process.exit(1);
    }
    console.log(
      `Self-test passed: ${codeKB} KB of code counted (the page's and the embed's scripts), ` +
        "other sites' downloads counted, faint text flagged in both colour schemes.",
    );
  } finally {
    await browser.close();
    site.close();
    embed.close();
  }
}

await (process.argv.includes('--self-test') ? selfTest() : main());
