import { type IconName, iconNames } from './icon-names.ts';
import { iconNodes } from './icons.generated.ts';

export { type IconName, iconNames };

/** One element of an icon's drawing: its tag (`path`, `circle`, …) and its attributes. */
export type IconElement = readonly [tag: string, attributes: Readonly<Record<string, string>>];

/** An icon's drawing on Lucide's 24-unit grid, drawn with lines (no fill). */
export type IconNode = readonly IconElement[];

export const icons: Readonly<Record<IconName, IconNode>> = iconNodes;

export function isIconName(value: string): value is IconName {
  return (iconNames as readonly string[]).includes(value);
}

/** The attributes every icon shares; the line thickness comes from the design values. */
export const iconFrame = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
