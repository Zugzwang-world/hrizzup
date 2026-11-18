import { describe, expect, it } from 'vitest';
import { EMPTY_PAGE_CURSOR } from '../../../lib/social/console-forms.ts';
import type { Page } from '../../pages.ts';
import { consoleSocialAdminChecks, consoleSocialPages } from './console.ts';

/**
 * The console's social pages for the checks (docs/social/build.md, section 8.3): R5 adds each one's
 * entry in `console.ts`, and these rules hold every entry to the console's own. `problems` is also
 * tried on small lists, one good and some not, to show it finds what it should.
 */

const BASE = '/console/social';
type AdminCheck = { name: string; path: string; admin: string };

const under = (path: string) => path === BASE || path.startsWith(`${BASE}/`);

/** What is wrong with these pages and admin checks: each reads as a line, none when all is well. */
function problems(
  pages: readonly (Page & { status?: number })[],
  checks: readonly AdminCheck[],
): string[] {
  const found: string[] = [];
  for (const page of pages) {
    if (!under(page.route))
      found.push(`${page.name}: its route ${page.route} is not under ${BASE}`);
    if (!under(page.path))
      found.push(`${page.name}: its address ${page.path} is not under ${BASE}`);
    if (page.status !== 404) found.push(`${page.name}: anyone but an admin must get 404`);
    if (!checks.some((check) => check.path === page.path)) {
      found.push(`${page.name}: no admin check opens ${page.path}`);
    }
  }
  for (const check of checks) {
    if (!pages.some((page) => page.path === check.path)) {
      found.push(`${check.name}: no page is at ${check.path}`);
    }
    if (check.admin.trim() === '') found.push(`${check.name}: no heading to look for`);
  }
  const names = checks.map((check) => check.name);
  if (new Set(names).size !== names.length) found.push('two admin checks share a name');
  return found;
}

describe('the console’s social pages', () => {
  it('are under /console/social, answer 404 to everyone but an admin, and each has an admin check, and the reverse', () => {
    expect(problems(consoleSocialPages, consoleSocialAdminChecks)).toEqual([]);
  });

  it('find a page outside /console/social, one anyone can open, one with no admin check, and the reverse', () => {
    const page = (name: string, path: string, status?: number): Page => ({
      route: path,
      name,
      path,
      budget: 'standard',
      ...(status ? { status } : {}),
    });
    const check = (name: string, path: string, admin = 'A heading'): AdminCheck => ({
      name,
      path,
      admin,
    });
    expect(
      problems([page('good', `${BASE}/stories`, 404)], [check('good-admin', `${BASE}/stories`)]),
    ).toEqual([]);
    expect(
      problems([page('x', '/console/socialite', 404)], [check('x-admin', '/console/socialite')]),
    ).toEqual([
      'x: its route /console/socialite is not under /console/social',
      'x: its address /console/socialite is not under /console/social',
    ]);
    expect(problems([page('open', `${BASE}/a`)], [check('open-admin', `${BASE}/a`)])).toEqual([
      'open: anyone but an admin must get 404',
    ]);
    expect(problems([page('alone', `${BASE}/a`, 404)], [])).toEqual([
      `alone: no admin check opens ${BASE}/a`,
    ]);
    expect(problems([], [check('orphan-admin', `${BASE}/a`, ' ')])).toEqual([
      `orphan-admin: no page is at ${BASE}/a`,
      'orphan-admin: no heading to look for',
    ]);
  });
});

describe('the pages that list people', () => {
  it('open the invites and agents lists past their last page, so a screenshot of the check shows no email', () => {
    // The Screen check's screenshots are a download of a public repository's check run: an invite's email
    // and an agent's invite email must never be on one (`EMPTY_PAGE_CURSOR`, `lib/social/console-forms.ts`).
    for (const name of ['console-social-invites', 'console-social-agents']) {
      const page = consoleSocialPages.find((entry) => entry.name === name);
      expect(page?.path, name).toMatch(new RegExp(`\\?after=${EMPTY_PAGE_CURSOR}$`));
      const check = consoleSocialAdminChecks.find((entry) => entry.name === `${name}-admin`);
      expect(check?.path, `${name}-admin`).toBe(page?.path);
    }
  });
});
