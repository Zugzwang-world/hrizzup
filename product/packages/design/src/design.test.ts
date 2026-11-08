import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import lists from '@hrizzup/agreement/definitions/lists.schema.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { expectedFiles } from '../scripts/write.ts';
import { contrast, READABLE, textPairs } from './contrast.ts';
import { iconNames, icons, isIconName } from './icons.ts';
import { categoryCodes, colorRoles } from './types.ts';
import { activeDirection, directions, values } from './values.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const all = Object.entries(directions);

describe('the files written from the values', () => {
  for (const [path, content] of Object.entries(expectedFiles())) {
    it(`${path} is current (run \`pnpm --filter @hrizzup/design write\` if not)`, () => {
      expect(readFileSync(`${root}${path}`, 'utf8')).toBe(content);
    });
  }
});

describe('readable text', () => {
  for (const [key, direction] of all) {
    it(`every text colour in ${key} meets WCAG's 4.5 to 1, in light and dark`, () => {
      const unreadable = textPairs(direction)
        .filter((pair) => pair.ratio < READABLE)
        .map((pair) => `${pair.name}: ${pair.text} on ${pair.on} is ${pair.ratio.toFixed(2)} to 1`);
      expect(unreadable).toEqual([]);
    });
  }

  it('measures contrast as WCAG does', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });
});

describe('the values', () => {
  it('cover every category in the agreement, and no others', () => {
    const agreed = lists.$defs.category.oneOf.map((item) => item.const);
    expect([...categoryCodes].sort()).toEqual([...agreed].sort());
    for (const [, direction] of all) {
      expect(Object.keys(direction.category).sort()).toEqual([...agreed].sort());
    }
  });

  it('give every colour role a light and a dark six-digit colour', () => {
    for (const [, direction] of all) {
      for (const role of colorRoles) {
        expect(direction.color[role].light).toMatch(/^#[0-9A-F]{6}$/);
        expect(direction.color[role].dark).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it('name only icons that exist', () => {
    for (const [, direction] of all) {
      const named = [...Object.values(direction.category), direction.categoryFallback].map(
        (look) => look.icon,
      );
      for (const icon of named) expect(isIconName(icon), icon).toBe(true);
    }
    for (const name of iconNames) expect(icons[name].length).toBeGreaterThan(0);
  });

  it('use free typefaces only', () => {
    for (const [, direction] of all) {
      for (const font of Object.values(direction.font)) {
        expect(font.licence).toMatch(/Open Font License|phone's own/);
      }
    }
  });

  it('make the active direction the values every screen reads', () => {
    expect(values).toBe(directions[activeDirection]);
  });
});
