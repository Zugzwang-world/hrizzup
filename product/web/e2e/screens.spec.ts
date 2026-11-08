import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type BrowserContextOptions, expect, test } from '@playwright/test';
import { layoutProblems } from './layout.ts';
import { pagesIn } from './pages.ts';
import { views } from './viewports.ts';

/**
 * The screen check (CLAUDE.md, "Screens fit every device"): every page in pages.ts, at every
 * size in viewports.ts, in Chromium and WebKit, must fit with nothing cut off, overlapping or
 * scrolling sideways. Outside production, the sign-in test page is also checked signed in.
 * Screenshots for the founder are saved at 360, 768, 1440 and 1920 pixels.
 */

type Check = { name: string; path: string; signedIn?: boolean; status?: number };

function pagesToCheck(): Check[] {
  const checks: Check[] = pagesIn(process.env.SCREEN_CHECK_ENVIRONMENT).map((page) => ({
    name: page.name,
    path: page.path,
    ...(page.status ? { status: page.status } : {}),
  }));
  if (checks.some((check) => check.name === 'sign-in-test')) {
    checks.push({ name: 'sign-in-test-signed-in', path: '/sign-in-test', signedIn: true });
  }
  return checks;
}

const LARGE_TEXT = `
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = 'html { font-size: 200% !important; }';
    document.head.appendChild(style);
  });
`;

const screenshotsDir = process.env.SCREENSHOTS_DIR ?? 'screenshots';

for (const view of views) {
  test(`fits at ${view.name}`, async ({ browser, browserName }, testInfo) => {
    const base = testInfo.project.use;
    const options: BrowserContextOptions = {
      ...(base.baseURL ? { baseURL: base.baseURL } : {}),
      ...(base.extraHTTPHeaders ? { extraHTTPHeaders: base.extraHTTPHeaders } : {}),
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: view.touch ? 2 : 1,
      hasTouch: view.touch,
      isMobile: view.touch && view.width < 1024 && browserName !== 'firefox',
    };
    const signedInState = process.env[`SIGNED_IN_STATE_${browserName.toUpperCase()}`];
    const failures: string[] = [];

    const environment = process.env.SCREEN_CHECK_ENVIRONMENT;
    if (environment !== 'production' && !signedInState) {
      throw new Error(
        `Signed-in pages can't be checked on ${environment}: staging's Supabase keys are missing`,
      );
    }

    for (const check of pagesToCheck()) {
      const context = await browser.newContext({
        ...options,
        ...(check.signedIn && signedInState ? { storageState: signedInState } : {}),
      });
      if (view.largeText) await context.addInitScript(LARGE_TEXT);
      const page = await context.newPage();
      const response = await page.goto(check.path, { waitUntil: 'load' });
      expect(response?.status(), `${check.path} status`).toBe(check.status ?? 200);
      await page.evaluate(() => document.fonts.ready);
      if (check.signedIn) {
        await expect(
          page.getByTestId('signed-in-email'),
          'signed in as the test account',
        ).toBeVisible();
      }
      for (const problem of await layoutProblems(page)) failures.push(`${check.name}: ${problem}`);
      if (view.screenshot && !view.largeText) {
        await mkdir(screenshotsDir, { recursive: true });
        await page.screenshot({
          path: join(screenshotsDir, `${browserName}-${view.width}-${check.name}.png`),
          fullPage: true,
        });
      }
      await context.close();
    }

    expect(failures, `layout problems at ${view.name} in ${browserName}`).toEqual([]);
  });
}
