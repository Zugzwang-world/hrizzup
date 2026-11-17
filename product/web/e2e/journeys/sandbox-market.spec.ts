import { expect, test } from '@playwright/test';
import { SANDBOX_FIXTURE_MARKET } from '../pages.ts';
import { phone } from './phone.ts';

/**
 * Journey: a market's page in the sandbox tells when the market closes, in India time (the Speed
 * check's busy-time fix of 18 November 2026: the time is written by plain arithmetic, on the server
 * and in the browser alike, so no page asks the browser's locale formatting while it loads). Signed
 * out, on a phone, in Chromium and WebKit: the line under the question ends in a closing time as
 * people read it, "10 Nov 2026, 6:00 pm IST", and the page shows no script error, which a server and
 * a browser writing the time differently (a hydration mismatch) would cause.
 */
test.use(phone);

test.describe('a market in the sandbox', () => {
  test.skip(
    () => process.env.SCREEN_CHECK_ENVIRONMENT === 'production',
    "The sandbox isn't on production",
  );

  test('says when it closes, in India time, the same on the server and in the browser', async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`script error: ${error.message}`));
    await page.goto(`/sandbox/markets/${SANDBOX_FIXTURE_MARKET}`);
    await expect(page.getByTestId('market-state')).toContainText(
      / · closes \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Oct|Nov|Dec) \d{4}, (1[0-2]|[1-9]):[0-5]\d (am|pm) IST$/,
    );
    await page.waitForLoadState('load');
    expect(problems).toEqual([]);
  });
});
