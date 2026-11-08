import {
  type CategoryCode,
  type CategoryLook,
  type ColorRole,
  categoryCodes,
  colorRoles,
  type DesignValues,
  type Font,
  radiusRoles,
  type SpaceRole,
  spaceRoles,
  typeRoles,
} from './types.ts';

/**
 * Turns design values into the website's CSS (`tokens.css`): custom properties for the active
 * direction on every page, the same for each direction under `[data-direction="…"]` (for the
 * design pages that compare them), dark versions that follow the device's setting, and the
 * names Tailwind and shadcn/ui use. `scripts/write.ts` writes it; a test keeps it current.
 */

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const rem = (px: number) => `${Number((px / 16).toFixed(4))}rem`;

/** The CSS variable next/font sets for a Google font: `Anek Latin` becomes `--font-anek-latin`. */
export function fontVariable(family: string): string {
  return `--font-${family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/** Generic names, which CSS reads as keywords and so must never be quoted. */
const GENERIC_FONTS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  '-apple-system',
  'BlinkMacSystemFont',
]);

function fontStack(font: Font): string {
  const fallback = font.fallback.map((f) => (GENERIC_FONTS.has(f) ? f : `"${f}"`));
  if (font.family === 'system') return fallback.join(', ');
  return [`var(${fontVariable(font.family)}, "${font.family}")`, ...fallback].join(', ');
}

/** The names Tailwind's utilities use for spacing, so `px-gutter` and `gap-lane` read well. */
const spaceName: Record<SpaceRole, string> = {
  gutter: 'gutter',
  laneGap: 'lane',
  cardPad: 'card',
  stack: 'stack',
  section: 'section',
};

type Scheme = 'light' | 'dark';

function colorLines(values: DesignValues, scheme: Scheme): string[] {
  const lines = colorRoles.map(
    (role: ColorRole) => `--hz-${kebab(role)}: ${values.color[role][scheme]};`,
  );
  const look = (code: string, l: CategoryLook) => [
    `--hz-cat-${code}-fill: ${l.fill[scheme]};`,
    `--hz-cat-${code}-ink: ${l.ink[scheme]};`,
    `--hz-cat-${code}-soft: ${l.soft[scheme]};`,
    `--hz-cat-${code}-soft-ink: ${l.softInk[scheme]};`,
  ];
  for (const code of categoryCodes) lines.push(...look(code, values.category[code]));
  lines.push(...look('other', values.categoryFallback));
  const shadow = values.card.shadow;
  lines.push(
    `--hz-card-shadow: ${shadow === 'none' ? 'none' : `0 ${shadow.y}px ${shadow.blur}px ${shadow[scheme]}`};`,
  );
  return lines;
}

function otherLines(values: DesignValues): string[] {
  const lines = [
    `--hz-family-display: ${fontStack(values.font.display)};`,
    `--hz-family-text: ${fontStack(values.font.text)};`,
  ];
  for (const role of typeRoles) {
    const t = values.type[role];
    lines.push(
      `--hz-type-${role}-family: var(--hz-family-${t.font});`,
      `--hz-type-${role}-size: ${rem(t.size)};`,
      `--hz-type-${role}-line: ${Number((t.line / t.size).toFixed(4))};`,
      `--hz-type-${role}-weight: ${t.weight};`,
      `--hz-type-${role}-tracking: ${t.tracking ?? 0}em;`,
      `--hz-type-${role}-width: ${t.width ?? 100}%;`,
      `--hz-type-${role}-numbers: ${t.numbers === 'tabular' ? 'tabular-nums' : 'normal'};`,
    );
  }
  for (const role of spaceRoles)
    lines.push(`--hz-space-${spaceName[role]}: ${rem(values.space[role])};`);
  for (const role of radiusRoles) lines.push(`--hz-radius-${role}: ${values.radius[role]}px;`);
  lines.push(
    `--hz-card-border: ${values.card.border}px;`,
    `--hz-card-inset: ${rem(values.card.inset)};`,
    `--hz-icon-stroke: ${values.icon.stroke};`,
    `--hz-icon-small: ${rem(values.icon.size.small)};`,
    `--hz-icon-medium: ${rem(values.icon.size.medium)};`,
    `--hz-icon-large: ${rem(values.icon.size.large)};`,
    `--hz-motion-fast: ${values.motion.fast}ms;`,
    `--hz-motion-base: ${values.motion.base}ms;`,
    `--hz-motion-easing: ${values.motion.easing};`,
  );
  return lines;
}

function block(selector: string, lines: string[], indent = ''): string {
  return `${indent}${selector} {\n${lines.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}}`;
}

function themeLines(): string[] {
  const lines = colorRoles.map((role) => `--color-${kebab(role)}: var(--hz-${kebab(role)});`);
  lines.push(
    '--color-cat-fill: var(--cat-fill);',
    '--color-cat-ink: var(--cat-ink);',
    '--color-cat-soft: var(--cat-soft);',
    '--color-cat-soft-ink: var(--cat-soft-ink);',
    '--font-display: var(--hz-family-display);',
    '--font-text: var(--hz-family-text);',
    '--font-sans: var(--hz-family-text);',
  );
  for (const role of spaceRoles) {
    lines.push(`--spacing-${spaceName[role]}: var(--hz-space-${spaceName[role]});`);
  }
  for (const role of radiusRoles) lines.push(`--radius-${role}: var(--hz-radius-${role});`);
  lines.push(
    // shadcn/ui's components use Tailwind's own corner names.
    '--radius-sm: var(--hz-radius-control);',
    '--radius-md: var(--hz-radius-control);',
    '--radius-lg: var(--hz-radius-card);',
    '--radius-xl: var(--hz-radius-card);',
    '--shadow-card: var(--hz-card-shadow);',
    '--ease-standard: var(--hz-motion-easing);',
  );
  return lines;
}

function typeUtilities(): string[] {
  return typeRoles.map((role) =>
    block(`@utility type-${role}`, [
      `font-family: var(--hz-type-${role}-family);`,
      `font-size: var(--hz-type-${role}-size);`,
      `line-height: var(--hz-type-${role}-line);`,
      `font-weight: var(--hz-type-${role}-weight);`,
      `letter-spacing: var(--hz-type-${role}-tracking);`,
      `font-stretch: var(--hz-type-${role}-width);`,
      `font-variant-numeric: var(--hz-type-${role}-numbers);`,
    ]),
  );
}

function categorySelectors(): string[] {
  const set = (code: string) => [
    `--cat-fill: var(--hz-cat-${code}-fill);`,
    `--cat-ink: var(--hz-cat-${code}-ink);`,
    `--cat-soft: var(--hz-cat-${code}-soft);`,
    `--cat-soft-ink: var(--hz-cat-${code}-soft-ink);`,
  ];
  return [
    // A category the agreement adds before it has a look of its own shows in the plain one.
    block('[data-category]', set('other')),
    ...categoryCodes.map((code: CategoryCode) => block(`[data-category="${code}"]`, set(code))),
  ];
}

export function tokensCss(
  active: string,
  directions: Readonly<Record<string, DesignValues>>,
): string {
  const current = directions[active];
  if (!current) throw new Error(`No direction called ${active}`);
  const parts: string[] = [
    [
      '/*',
      " * Hrizzup's design values for the website, written by product/packages/design/scripts/write.ts",
      " * from the values in product/packages/design/src. Don't edit this file: change a value there,",
      ' * then run `pnpm --filter @hrizzup/design write`. A test fails when this file is out of date.',
      ' */',
    ].join('\n'),
    `/* The active direction (${current.name}), on every page. */`,
    block(':root', [...colorLines(current, 'light'), ...otherLines(current)]),
    `@media (prefers-color-scheme: dark) {\n${block(':root', colorLines(current, 'dark'), '  ')}\n}`,
    '/* Every direction, for the design pages that compare them. */',
  ];
  for (const [key, values] of Object.entries(directions)) {
    const selector = `[data-direction="${key}"]`;
    parts.push(
      block(selector, [...colorLines(values, 'light'), ...otherLines(values)]),
      `@media (prefers-color-scheme: dark) {\n${block(selector, colorLines(values, 'dark'), '  ')}\n}`,
    );
  }
  parts.push(
    "/* Each category's own look, for anything marked with data-category. */",
    ...categorySelectors(),
    "/* The names Tailwind's utilities and shadcn/ui's components read. */",
    block('@theme inline', themeLines()),
    '/* One utility per text style: type-brand, type-display, type-title, … */',
    ...typeUtilities(),
  );
  return `${parts.join('\n\n')}\n`;
}
