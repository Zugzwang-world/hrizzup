import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { budgets, pages } from './pages.ts';

const APP = new URL('../app', import.meta.url).pathname;
const PAGE_FILE = /^page\.(tsx|ts|jsx|js|mdx)$/;
const NOT_FOUND_FILE = /^(global-)?not-found\.(tsx|ts|jsx|js)$/;

/**
 * Every page an `app/` folder defines, as Next.js routes it: folders are parts of the address,
 * except route groups `(name)` and parallel slots `@name`, which don't appear in it. The 404
 * page (`not-found.tsx` at the top) is the page called `not-found`.
 */
function routesIn(folder: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const parts = relative(folder, entry.parentPath).split(sep).filter(Boolean);
    if (NOT_FOUND_FILE.test(entry.name) && parts.length === 0) {
      routes.push('not-found');
      continue;
    }
    if (!PAGE_FILE.test(entry.name)) continue;
    const visible = parts.filter((part) => !/^\(.*\)$/.test(part) && !part.startsWith('@'));
    routes.push(`/${visible.join('/')}`);
  }
  return [...new Set(routes)].sort();
}

describe('every page has its checks and a speed budget', () => {
  const routes = routesIn(APP);

  it('lists every page in app/ (add a new page to e2e/pages.ts, with its budget)', () => {
    const listed = new Set(pages.map((page) => page.route));
    expect(routes.filter((route) => !listed.has(route))).toEqual([]);
  });

  it('lists no page that no longer exists', () => {
    const existing = new Set(routes);
    expect(pages.filter((page) => !existing.has(page.route)).map((p) => p.route)).toEqual([]);
  });

  it('gives each page a budget that exists, a real address and its own name', () => {
    for (const page of pages) {
      expect(Object.hasOwn(budgets, page.budget), `${page.route}'s budget`).toBe(true);
      expect(page.path, `${page.route}'s address`).toMatch(/^\/[^[\]\s]*$/);
    }
    const names = pages.map((page) => page.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('finding pages', () => {
  const folder = mkdtempSync(join(tmpdir(), 'hrizzup-routes-'));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('reads addresses the way Next.js routes them', () => {
    const files = [
      'page.tsx',
      'not-found.tsx',
      'layout.tsx',
      'privacy/page.tsx',
      '(marketing)/about/page.tsx',
      'stories/[id]/page.tsx',
      'feed/@modal/page.tsx',
      'api/health/route.ts',
      'stories/[id]/not-found.tsx',
    ];
    for (const file of files) {
      mkdirSync(join(folder, file, '..'), { recursive: true });
      writeFileSync(join(folder, file), '');
    }
    expect(routesIn(folder)).toEqual([
      '/',
      '/about',
      '/feed',
      '/privacy',
      '/stories/[id]',
      'not-found',
    ]);
  });
});
