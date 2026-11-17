import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The sandbox's boards write their times and figures by plain arithmetic, so a page never makes the
// browser load its locale data while it is loading (the Speed check's busy time, on a fresh test
// machine). These are the files on every sandbox board's path; none may ask for locale formatting,
// in code or in a comment (write "the browser's locale formatting" instead).
const FILES = [
  'lib/console-format.ts',
  'lib/sandbox/format.ts',
  'lib/digits.ts',
  'components/sandbox/market-board.tsx',
  'components/sandbox/nav.tsx',
  'components/sandbox/perp-board.tsx',
  'components/sandbox/trade-panel.tsx',
  'components/sandbox/ui.tsx',
];

describe("the sandbox boards' code path", () => {
  it.each(FILES)('%s uses no locale formatting', (file) => {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\bIntl\b|toLocale/);
  });
});
