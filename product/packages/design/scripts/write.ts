import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as lucide from 'lucide';
import { tokensCss } from '../src/css.ts';
import { iconNames } from '../src/icon-names.ts';
import { activeDirection, directions } from '../src/values.ts';

/**
 * Writes the two files that come from the design values, so nobody edits them by hand:
 *
 * - `tokens.css`: the website's CSS for every value (see src/css.ts);
 * - `src/icons.generated.ts`: the drawings of the icons listed in src/icon-names.ts, copied from
 *   the `lucide` package (ISC licence; LICENSE-lucide.txt and THIRD_PARTY_NOTICES.md).
 *
 * `pnpm --filter @hrizzup/design write` after changing a value or the icon list. The test in
 * src/files.test.ts fails while either file differs from what this writes.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

const pascal = (name: string) =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

function lucideVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(import.meta.resolve('lucide/package.json')), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

export function iconsFile(): string {
  const library = lucide as unknown as Record<string, unknown>;
  const entries = iconNames.map((name) => {
    const node = library[pascal(name)];
    if (!Array.isArray(node)) throw new Error(`Lucide has no icon called ${name}`);
    return `  '${name}': ${JSON.stringify(node)},`;
  });
  return [
    '/*',
    ` * The drawings of the icons listed in icon-names.ts, copied from Lucide ${lucideVersion()}`,
    ' * (https://lucide.dev). ISC License, Copyright (c) 2026 Lucide Icons and Contributors; some',
    ' * icons derive from Feather, MIT License, Copyright (c) 2013-present Cole Bemis. The full',
    ' * notices are in ../LICENSE-lucide.txt and THIRD_PARTY_NOTICES.md.',
    ' *',
    ' * Written by scripts/write.ts. Do not edit: change the list in icon-names.ts, then run',
    ' * `pnpm --filter @hrizzup/design write`.',
    ' */',
    '',
    'export const iconNodes = {',
    ...entries,
    '} as const;',
    '',
  ].join('\n');
}

/** Every file this script writes, by its path inside the package, with what it should hold. */
export function expectedFiles(): Record<string, string> {
  return {
    'tokens.css': tokensCss(activeDirection, directions),
    'src/icons.generated.ts': iconsFile(),
  };
}

if (process.argv.includes('--write')) {
  for (const [path, content] of Object.entries(expectedFiles())) {
    writeFileSync(`${root}${path}`, content);
    console.log(`Wrote ${path}`);
  }
}
