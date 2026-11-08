import { type IconName, iconFrame, icons } from '@hrizzup/design';
import { createElement } from 'react';
import { cn } from '@/lib/utils.ts';

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const sizes = {
  small: 'size-(--hz-icon-small)',
  medium: 'size-(--hz-icon-medium)',
  large: 'size-(--hz-icon-large)',
} as const;

type Props = {
  name: IconName;
  size?: keyof typeof sizes;
  /** A name for people who can't see it; leave it out when the icon sits beside its words. */
  label?: string;
  /** Draw only the middle of the icon, larger: for the category marks on picture-less cards. */
  crop?: boolean;
  className?: string;
};

/**
 * One of the design values' icons (`@hrizzup/design`), drawn inline: no icon library ships to
 * the browser. Its size and line thickness come from the design values; its colour is the
 * text colour around it.
 */
export function Icon({ name, size = 'medium', label, crop, className }: Props) {
  const frame = {
    viewBox: crop ? '3 3 18 18' : iconFrame.viewBox,
    fill: iconFrame.fill,
    stroke: iconFrame.stroke,
    strokeLinecap: iconFrame.strokeLinecap,
    strokeLinejoin: iconFrame.strokeLinejoin,
    style: { strokeWidth: 'var(--hz-icon-stroke)' },
    className: cn('shrink-0', !crop && sizes[size], className),
  };
  // Each icon's elements never change order, so their position is a stable key.
  const drawing = icons[name].map(([tag, attributes], i) =>
    createElement(tag, {
      key: i,
      ...Object.fromEntries(Object.entries(attributes).map(([k, v]) => [camel(k), v])),
    }),
  );
  if (label) {
    return (
      <svg role="img" aria-label={label} {...frame}>
        <title>{label}</title>
        {drawing}
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" {...frame}>
      {drawing}
    </svg>
  );
}
