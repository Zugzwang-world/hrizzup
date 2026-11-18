import { expect, type Page } from '@playwright/test';
import { layoutProblems } from '../layout.ts';
import { views } from '../viewports.ts';

/** The screen check's large text, as screens.spec.ts sets it: the page's root text at 200%. */
const LARGE_TEXT_CSS = 'html { font-size: 200% !important; }';

/**
 * The page at every size of the screen check (e2e/viewports.ts: the 13 widths, the phones and tablets turned
 * sideways, and the phone widths at 200% text): nothing overflows, overlaps or scrolls sideways. One pass in place,
 * never a reload, so whatever the journey has typed, previewed or opened stays as it is; the large text is switched on
 * for its sizes and off again after, and the window goes back to a phone's. A browser context here is the journey's
 * own, a desktop's or a phone-sized one: the touch and mobile emulation belong to the screen check's own pass over
 * every page. A problem's text names the element's own words (at most 40 characters of each), so a journey may call
 * this only on a page that shows no one's private words.
 */
export async function fitsEverywhere(page: Page, what: string): Promise<void> {
  const problems: string[] = [];
  let large: Awaited<ReturnType<Page['addStyleTag']>> | null = null;
  try {
    for (const view of views) {
      await page.setViewportSize({ width: view.width, height: view.height });
      if (view.largeText && large === null)
        large = await page.addStyleTag({ content: LARGE_TEXT_CSS });
      if (!view.largeText && large !== null) {
        await large.evaluate((style) => style.parentNode?.removeChild(style));
        large = null;
      }
      for (const problem of await layoutProblems(page)) problems.push(`${view.name}: ${problem}`);
    }
  } finally {
    if (large !== null)
      await large.evaluate((style) => style.parentNode?.removeChild(style)).catch(() => undefined);
    await page.setViewportSize({ width: 390, height: 844 });
  }
  expect(problems, `${what}: problems at some size`).toEqual([]);
}
