/**
 * Every icon the website and the app use, by the name Lucide gives it (lucide.dev, ISC
 * licence). Lucide draws on a 24-unit grid with round line ends, so every icon matches.
 *
 * The drawings themselves are copied into `icons.generated.ts` by `scripts/write.ts`, so both
 * surfaces carry only the icons listed here (the app's bundler can't drop unused ones). To add
 * or swap an icon: change this list, then run `pnpm --filter @hrizzup/design write`.
 */
export const iconNames = [
  // Categories (each category's look names one).
  'bitcoin',
  'indian-rupee',
  'briefcase-business',
  'sparkles',
  'trophy',
  'landmark',
  'clapperboard',
  'newspaper',
  // Places.
  'globe',
  'map-pin',
  // Actions.
  'bookmark',
  'bookmark-check',
  'share-2',
  'thumbs-up',
  'thumbs-down',
  'external-link',
  'search',
  // Moving around.
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'house',
  'user-round',
  'x',
  'check',
  // Stories and takes.
  'radio',
  'clock',
  'pencil-line',
  'messages-square',
  'message-square-text',
  'play',
  'image',
] as const;

export type IconName = (typeof iconNames)[number];
