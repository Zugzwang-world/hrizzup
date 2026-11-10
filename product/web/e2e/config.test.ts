import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

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
