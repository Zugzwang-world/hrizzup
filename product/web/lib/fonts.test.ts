import { readFileSync } from 'node:fs';
import { activeDirection, directions, fontVariable } from '@hrizzup/design';
import { describe, expect, it } from 'vitest';

/**
 * next/font only reads literal options, so lib/fonts.ts can't be written from the design
 * values. This keeps the two in step instead: every typeface a direction names has a loader
 * with the CSS variable tokens.css reads, and only the active direction's are preloaded.
 */
const source = readFileSync(new URL('./fonts.ts', import.meta.url), 'utf8');
const loaders = [...source.matchAll(/= (\w+)\(\{([^}]*)\}\)/g)].map(([, name, options = '']) => ({
  name,
  variable: /variable: '([^']+)'/.exec(options)?.[1],
  preload: /preload: true/.test(options),
}));

const families = (key: keyof typeof directions) =>
  Object.values(directions[key].font)
    .map((font) => font.family)
    .filter((family) => family !== 'system');

describe('the typefaces', () => {
  const all = new Set(
    Object.keys(directions).flatMap((key) => families(key as keyof typeof directions)),
  );

  it('load every typeface the design values name, under the variable tokens.css reads', () => {
    const variables = loaders.map((loader) => loader.variable);
    for (const family of all) expect(variables, family).toContain(fontVariable(family));
  });

  it("preload only the active direction's typefaces", () => {
    const active = new Set(families(activeDirection).map(fontVariable));
    for (const loader of loaders) {
      expect(loader.preload, loader.name).toBe(active.has(loader.variable ?? ''));
    }
  });
});
