import type { DesignValues, Hex } from './types.ts';

/**
 * Readable text, measured the way the Web Content Accessibility Guidelines (WCAG 2.2) do: the
 * contrast ratio between a text colour and the colour behind it, from 1 (none) to 21 (black on
 * white). Normal text needs 4.5 or more; large text (24 px, or 18.66 px bold) needs 3.
 */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A colour's relative luminance, from 0 (black) to 1 (white). */
export function luminance(hex: Hex): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrast(a: Hex, b: Hex): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The minimum ratio for normal text. */
export const READABLE = 4.5;

/** One text colour on one background, as the screens use them. */
export type TextPair = { name: string; text: Hex; on: Hex; ratio: number };

/**
 * Every pairing of text and background the components use, in both of the device's settings.
 * A component that puts text on a new background adds its pairing here, so the check covers it.
 */
export function textPairs(values: DesignValues): TextPair[] {
  const c = values.color;
  const pairs: TextPair[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    const add = (name: string, text: Hex, on: Hex) =>
      pairs.push({ name: `${name} (${scheme})`, text, on, ratio: contrast(text, on) });
    add('foreground on background', c.foreground[scheme], c.background[scheme]);
    add('muted text on background', c.mutedForeground[scheme], c.background[scheme]);
    add('card text on card', c.cardForeground[scheme], c.card[scheme]);
    add('muted text on card', c.mutedForeground[scheme], c.card[scheme]);
    add('muted text on muted', c.mutedForeground[scheme], c.muted[scheme]);
    add('popover text on popover', c.popoverForeground[scheme], c.popover[scheme]);
    add('primary button', c.primaryForeground[scheme], c.primary[scheme]);
    add('primary text on background', c.primary[scheme], c.background[scheme]);
    add('primary text on card', c.primary[scheme], c.card[scheme]);
    add('secondary button', c.secondaryForeground[scheme], c.secondary[scheme]);
    add('accent', c.accentForeground[scheme], c.accent[scheme]);
    add('destructive button', c.destructiveForeground[scheme], c.destructive[scheme]);
    add('live label', c.liveForeground[scheme], c.live[scheme]);
    add('notice', c.noticeForeground[scheme], c.notice[scheme]);
    const looks = { ...values.category, other: values.categoryFallback };
    for (const [code, look] of Object.entries(looks)) {
      add(`${code}: ink on its colour`, look.ink[scheme], look.fill[scheme]);
      add(`${code}: ink on its tint`, look.softInk[scheme], look.soft[scheme]);
    }
  }
  return pairs;
}
