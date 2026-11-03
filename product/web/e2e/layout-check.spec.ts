import { expect, test } from '@playwright/test';
import { layoutProblems } from './layout.ts';

/**
 * Proves the screen check catches what it is meant to catch: each page below is broken
 * on purpose, and the check must report it. A fitting page must report nothing.
 */
test.use({ viewport: { width: 360, height: 800 } });

const cases: { name: string; html: string; expected: RegExp }[] = [
  {
    name: 'a fixed width wider than a phone',
    html: '<div style="width:500px">Too wide for a phone</div>',
    expected: /scrolls sideways|sticks out/,
  },
  {
    name: 'text drawn on top of other text',
    html: '<p>First line of text</p><p style="margin-top:-1.2em">Second line on top</p>',
    expected: /overlaps/,
  },
  {
    name: 'text cut off by its box',
    html: '<p style="width:100px;overflow:hidden;white-space:nowrap">A sentence far too long for its box</p>',
    expected: /cuts off/,
  },
  {
    name: 'a button pushed off the side',
    html: '<button style="position:relative;left:330px">Sign in</button>',
    expected: /sticks out/,
  },
];

for (const c of cases) {
  test(`catches ${c.name}`, async ({ page }) => {
    await page.setContent(
      `<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0">${c.html}</body>`,
    );
    const problems = await layoutProblems(page);
    expect(problems.join('\n')).toMatch(c.expected);
  });
}

test('reports nothing for a page that fits', async ({ page }) => {
  await page.setContent(
    '<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:16px"><h1>Title</h1><p>Some text that wraps across several lines on a small phone screen without trouble.</p><button>Go</button></body>',
  );
  expect(await layoutProblems(page)).toEqual([]);
});
