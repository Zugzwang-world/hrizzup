import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseTimesFile } from './parts.ts';

/**
 * A check that retries a test must fail when a test passes only on its retry (CLAUDE.md, "How
 * checks behave"; the founder's decision of 10 November 2026). The Screen check (Playwright) is
 * the one check that retries tests: once, in GitHub. This keeps it failing on a test that passes
 * only on its retry, and keeps every other test runner in the repository from retrying at all,
 * so a new retry can't arrive without the same rule.
 */

const ROOT = new URL('../../../', import.meta.url).pathname;

async function playwrightConfig(ci: boolean) {
  const before = process.env.CI;
  if (ci) process.env.CI = 'true';
  else delete process.env.CI;
  try {
    // A fresh copy each time: the config reads CI when it loads.
    vi.resetModules();
    return (await import('../playwright.config.ts')).default;
  } finally {
    if (before === undefined) delete process.env.CI;
    else process.env.CI = before;
  }
}

/** Every file under `folder` whose name matches, skipping installed packages and builds. */
function files(folder: string, name: RegExp): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder)) {
    if (['node_modules', '.next', '.git', '.turbo', 'dist'].includes(entry)) continue;
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) found.push(...files(path, name));
    else if (name.test(entry)) found.push(path);
  }
  return found;
}

describe('retries', () => {
  it('the Screen check retries once in GitHub, and fails on a test that passes only on its retry', async () => {
    const config = await playwrightConfig(true);
    expect(config.retries).toBe(1);
    expect(config.failOnFlakyTests).toBe(true);
  });

  it("the steps' done-tests retry nothing, and the Screen check never runs them", async () => {
    vi.resetModules();
    const done = (await import('../playwright.done.config.ts')).default;
    expect(done.retries).toBe(0);
    expect(done.testDir).toBe('./e2e/done');
    const config = await playwrightConfig(true);
    expect(config.testIgnore).toBe('**/done/**');
  });

  it('on this Mac nothing is retried', async () => {
    const config = await playwrightConfig(false);
    expect(config.retries).toBe(0);
  });

  it('no other test runner in the repository retries a test', () => {
    const configs = files(ROOT, /^vitest(\.[a-z]+)?\.config\.(ts|mts|js|mjs)$/);
    expect(configs.length, 'the Vitest configs were found').toBeGreaterThan(3);
    for (const path of configs) {
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toMatch(/\bretry\s*:/);
    }
    // The app's journeys (Maestro) run each flow once.
    const journeys = readFileSync(join(ROOT, 'product/app/journeys/run.sh'), 'utf8');
    expect(journeys).not.toMatch(/--retr|retry/i);
  });

  it('no test command asks for a retry either', () => {
    // A retry flag on the command line would override every config above.
    for (const path of files(ROOT, /^package\.json$/)) {
      const { scripts = {} } = JSON.parse(readFileSync(path, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      for (const [name, command] of Object.entries(scripts)) {
        expect(command, `${relative(ROOT, path)}: ${name}`).not.toMatch(/--retr(y|ies)\b/);
      }
    }
    for (const path of files(join(ROOT, '.github/workflows'), /\.ya?ml$/)) {
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toMatch(/--retr(y|ies)\b/);
    }
  });
});

/**
 * The Screen check runs on four machines in GitHub (Round 6, R4, M7.2): each runs `--shard=N/4`,
 * and the parts reporter gives it its tests, balanced by measured times. None of that may loosen
 * the check, so what the parts share is pinned here (the retry rules above stay as they were).
 */
describe('the Screen check on four machines', () => {
  it('uses the parts reporter in GitHub, after the two it always had', async () => {
    const config = await playwrightConfig(true);
    expect(config.reporter).toEqual([['github'], ['list'], ['./e2e/support/parts.ts']]);
    expect(readFileSync(join(ROOT, 'product/web/e2e/support/parts.ts'), 'utf8')).toContain(
      'preprocess',
    );
  });

  it('on this Mac keeps its one list reporter', async () => {
    expect((await playwrightConfig(false)).reporter).toEqual([['list']]);
  });

  it('keeps every test, project, retry and time limit the one machine had', async () => {
    const config = await playwrightConfig(true);
    expect(config.fullyParallel).toBe(true);
    expect(config.timeout).toBe(120_000);
    expect((config.projects ?? []).map((project) => project.name)).toEqual(['chromium', 'webkit']);
    expect(config.testMatch).toBe('**/*.spec.ts');
  });

  it('has a times file that parses: text keys with seconds above zero', () => {
    const file = parseTimesFile(
      readFileSync(join(ROOT, 'product/web/e2e/test-times.json'), 'utf8'),
    );
    for (const [key, seconds] of Object.entries(file.times)) {
      expect(typeof key).toBe('string');
      expect(typeof seconds).toBe('number');
      expect(seconds).toBeGreaterThan(0);
    }
  });

  it('has no test that needs another before it: a serial group could not be split across machines', () => {
    const specs = files(join(ROOT, 'product/web/e2e'), /\.spec\.ts$/);
    expect(specs.length, 'the specs were found').toBeGreaterThan(10);
    for (const path of specs) {
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toMatch(
        /describe\.serial|mode:\s*['"]serial['"]/,
      );
    }
  });
});

/**
 * The journeys that only call the API and never open a page run once, in Chromium (Round 6, R4,
 * M7.4; the founder's decision of 18 November 2026): they carry the tag `@api-only`, and the
 * WebKit project leaves the tag out. A test that opens a page still runs in both browsers at every
 * width, so the guard (e2e/support/api-only.ts) makes a tagged test that opens one fail, and what
 * is pinned here keeps every tagged file on the guard and the guard on every tagged file.
 */
describe('the journeys that never open a browser run once', () => {
  const TAG = '@api-only';
  const GUARD = "from '../support/api-only.ts'";

  async function projects() {
    const list = (await playwrightConfig(true)).projects ?? [];
    const chromium = list.find((project) => project.name === 'chromium');
    const webkit = list.find((project) => project.name === 'webkit');
    if (!chromium || !webkit) throw new Error('A project is missing');
    return { chromium, webkit };
  }

  it('WebKit leaves out the tag, and nothing else, and Chromium runs everything', async () => {
    const { chromium, webkit } = await projects();
    const inverted = [webkit.grepInvert ?? []].flat();
    expect(
      inverted.some((pattern) => pattern instanceof RegExp && pattern.test(TAG)),
      'WebKit leaves out a test tagged @api-only',
    ).toBe(true);
    for (const pattern of inverted) {
      expect(String(pattern), 'it leaves out nothing but the tag').toBe(String(/@api-only/));
    }
    expect(chromium.grepInvert).toBeUndefined();
    expect(chromium.grep).toBeUndefined();
    expect(webkit.grep).toBeUndefined();
  });

  it("keeps the same tests to choose from in both projects, and the retries and the check's own failing rules", async () => {
    const { chromium, webkit } = await projects();
    expect(webkit.testMatch).toEqual(chromium.testMatch);
    expect(webkit.testIgnore).toEqual(chromium.testIgnore);
    expect(webkit.retries).toEqual(chromium.retries);
    const config = await playwrightConfig(true);
    expect(config.testMatch).toBe('**/*.spec.ts');
    expect(config.retries).toBe(1);
    expect(config.failOnFlakyTests).toBe(true);
    // A filter on the whole config would drop tests from both browsers, unseen.
    expect(config.grep).toBeUndefined();
    expect(config.grepInvert).toBeUndefined();
  });

  const specs = () => files(join(ROOT, 'product/web/e2e'), /\.spec\.ts$/);

  it('every spec that is tagged takes its test from the guard, and every spec on the guard is tagged', () => {
    expect(specs().length, 'the specs were found').toBeGreaterThan(10);
    let guarded = 0;
    for (const path of specs()) {
      const text = readFileSync(path, 'utf8');
      const name = relative(ROOT, path);
      const tagged = text.includes(TAG) || /\bdescribeApiOnly\(/.test(text);
      const onGuard = text.includes(GUARD);
      if (tagged) expect(onGuard, `${name} is tagged, so it must use the guard`).toBe(true);
      if (onGuard) {
        guarded++;
        if (name.endsWith('/journeys/api-only-guard.spec.ts')) {
          // The proof alone tags a test by hand, since it is one test and expected to fail.
          expect(text, `${name} carries the tag`).toMatch(/tag:\s*'@api-only'/);
        } else {
          // Every other journey groups its tests under describeApiOnly, whose hook makes a test that
          // wasn't made with the guard's `test` fail to load, and never tags by hand.
          expect(text, `${name} uses the guard, so it must group under describeApiOnly`).toMatch(
            /\bdescribeApiOnly\(/,
          );
          expect(text, `${name} tags by hand`).not.toMatch(/\btag\s*:/);
        }
      }
    }
    expect(guarded, 'the API-only journeys use the guard').toBeGreaterThanOrEqual(10);
  });

  /** Every import statement of a file that brings in values: its clause and where it comes from. */
  function valueImports(text: string): { clause: string; source: string }[] {
    const found: { clause: string; source: string }[] = [];
    for (const [, typeOnly, clause = '', source = ''] of text.matchAll(
      /import\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)'/gs,
    )) {
      if (!typeOnly) found.push({ clause, source });
    }
    return found;
  }

  it("a spec on the guard takes `test` from nowhere else, so a page can't be opened under the tag", () => {
    // Playwright puts a group's tag on every test inside it, whichever `test` declared the test, so
    // a second `test` (from Playwright itself, or one made with `.extend()`) would get around it.
    for (const path of specs()) {
      const text = readFileSync(path, 'utf8');
      if (!text.includes(GUARD)) continue;
      const name = relative(ROOT, path);
      for (const { clause, source } of valueImports(text)) {
        if (source === '../support/api-only.ts') continue;
        // Types only from Playwright: a value from it would be a second `test` beside the guarded one.
        if (source === '@playwright/test') {
          expect(clause.startsWith('{'), `${name}: ${clause}`).toBe(true);
          for (const specifier of clause.replace(/[{}]/g, '').split(',')) {
            const word = specifier.trim();
            if (word) expect(word, name).toMatch(/^type\s/);
          }
          continue;
        }
        // From anywhere else, nothing may be, or be called, `test`.
        const names = clause.startsWith('{')
          ? clause
              .replace(/[{}]/g, '')
              .split(',')
              .map((specifier) => specifier.trim())
              .filter((specifier) => specifier && !specifier.startsWith('type '))
              .flatMap((specifier) => specifier.split(/\s+as\s+/))
          : [clause.replace(/^\*\s+as\s+/, '')];
        expect(names, `${name} takes a value called test from ${source}`).not.toContain('test');
      }
      // (`expect.extend(` adds a check, never a test.)
      expect(text, `${name} makes a test of its own`).not.toMatch(/(?<!\bexpect)\.extend\(/);
      expect(text, `${name} declares its own test`).not.toMatch(
        /\b(?:const|let|var|function|class)\s+test\b/,
      );
    }
  });

  /** A spec on the guard and every helper in e2e/support it imports, however far down. */
  function guardedCode(): { name: string; text: string }[] {
    const support = join(ROOT, 'product/web/e2e/support');
    const seen = new Map<string, string>();
    const visit = (path: string) => {
      if (seen.has(path)) return;
      const text = readFileSync(path, 'utf8');
      seen.set(path, text);
      for (const { source } of valueImports(text)) {
        if (!source.startsWith('.')) continue;
        const next = join(path, '..', source);
        if (next.startsWith(`${support}/`) && !next.endsWith('/api-only.ts')) visit(next);
      }
    };
    for (const path of specs()) {
      if (readFileSync(path, 'utf8').includes(GUARD)) visit(path);
    }
    return [...seen].map(([path, text]) => ({ name: relative(ROOT, path), text }));
  }

  it('no spec on the guard, and no helper it uses, starts a browser of its own', () => {
    const code = guardedCode();
    expect(
      code.filter(({ name }) => name.includes('/support/')).length,
      'the helpers were found',
    ).toBeGreaterThan(3);
    // `newPage(` is looked for in the guarded specs only: the helpers the page journeys share with
    // them may open pages, and the guard's refusal at run time covers what a helper can reach.
    const starts: [string, RegExp, boolean?][] = [
      ['launch', /\.launch\(/],
      ['launchPersistentContext', /\.launchPersistentContext\(/],
      ['connectOverCDP', /\.connectOverCDP\(/],
      ['a browser type connecting', /\b(chromium|webkit|firefox)\s*\.\s*connect\(/],
      ['newPage', /\bnewPage\(/, true],
      [
        'a browser type of playwright',
        /\bplaywright\s*\.\s*(chromium|webkit|firefox|_android|_electron)\b/,
      ],
      ['playwright by name', /\bplaywright\s*\[/],
      [
        'a browser type taken out of playwright',
        /\{[^}]*\b(chromium|webkit|firefox)\b[^}]*\}\s*=\s*(await\s+)?playwright\b/,
      ],
      ['playwright itself, imported', /from\s+'(playwright|playwright-core)'/],
    ];
    for (const { name, text } of code) {
      for (const [what, pattern, specsOnly] of starts) {
        if (specsOnly && !name.endsWith('.spec.ts')) continue;
        expect(text, `${name} starts a browser (${what})`).not.toMatch(pattern);
      }
    }
  });

  it('has a permanent proof, expected to fail, that a tagged test asking for a page is refused', () => {
    const proof = readFileSync(
      join(ROOT, 'product/web/e2e/journeys/api-only-guard.spec.ts'),
      'utf8',
    );
    expect(proof).toMatch(/test\.fail\(/);
    expect(proof).toMatch(/tag:\s*'@api-only'/);
    expect(proof).toMatch(/async \(\{ page \}\)/);
    expect(proof).toContain(GUARD);
  });

  it('keeps the guard refusing a page, a context and a browser, and an untagged test', () => {
    const guard = readFileSync(join(ROOT, 'product/web/e2e/support/api-only.ts'), 'utf8');
    for (const fixture of ['page', 'context', 'browser']) {
      expect(guard, fixture).toMatch(new RegExp(`\\b${fixture}:\\s*(\\[\\s*)?refuseABrowser`));
    }
    expect(guard).toContain("scope: 'worker'");
    expect(guard).toContain('auto: true');
    // `playwright` stays, for its request client, but its browser types refuse to start a browser.
    expect(guard).toMatch(/playwright:\s*\[/);
    expect(guard).toContain('BROWSER_TYPES = new Set(');
    for (const type of ['chromium', 'webkit', 'firefox']) {
      expect(guard, type).toContain(`'${type}'`);
    }
    for (const start of ['launch', 'launchPersistentContext', 'connect', 'connectOverCDP']) {
      expect(guard, start).toContain(`'${start}'`);
    }
    expect(guard).toContain('STARTS.has(key)');
    // The group's hook, which makes a test that wasn't made with the guard fail to load.
    expect(guard).toMatch(/test\.beforeEach\(async \(\{ apiOnlyTag \}\)/);
    expect(guard).toContain('BROWSER_TYPES.has(key)');
    expect(guard).toContain('testInfo.tags.includes(API_ONLY_TAG)');
    expect(guard).toContain('may not open a browser');
  });
});
