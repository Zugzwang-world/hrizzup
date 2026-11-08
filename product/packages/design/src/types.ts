/**
 * The shape of Hrizzup's design values: every colour, typeface, text size, spacing, corner
 * and icon setting the website and the app use. Each value is defined once, in a direction
 * (`directions/`), and both surfaces read it from there: the website through the CSS that
 * `scripts/write.ts` writes (`tokens.css`), the app straight from these objects. Change a
 * value in one place and every screen on both surfaces follows.
 */

/** A colour as six-digit hex (`#RRGGBB`), the one format both the website and the app read. */
export type Hex = `#${string}`;

/** One colour for each of the device's two settings, light and dark. */
export type Pair = { light: Hex; dark: Hex };

/**
 * The colour roles. The first nineteen are the names shadcn/ui's components expect, so its
 * components work unchanged; the rest are Hrizzup's own.
 */
export const colorRoles = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'destructive',
  'destructiveForeground',
  'border',
  'input',
  'ring',
  /** A story that is developing right now. */
  'live',
  'liveForeground',
  /** Corrections in a timeline. */
  'notice',
  'noticeForeground',
] as const;

export type ColorRole = (typeof colorRoles)[number];

/** The categories in the hand-over agreement's shared list (a test keeps the two in step). */
export const categoryCodes = [
  'crypto',
  'finance',
  'business',
  'ai',
  'sports',
  'politics',
  'entertainment',
  'general',
] as const;

export type CategoryCode = (typeof categoryCodes)[number];

/**
 * A category's own look (the agreement's decision D5: a story card with no picture shows "a
 * design in the category's own look"). `fill` is the category's colour and `ink` the text on
 * it; `soft` is a quiet tint of it and `softInk` the text on that.
 */
export type CategoryLook = {
  fill: Pair;
  ink: Pair;
  soft: Pair;
  softInk: Pair;
  icon: string;
};

/** A typeface, by the name Google Fonts gives it, or the phone's own (`system`). */
export type Font = {
  family: string;
  /** Shown before the typeface loads, and wherever it can't. */
  fallback: readonly string[];
  /** Free licences only (spending needs the founder). */
  licence: string;
  source: string;
  /**
   * The typeface's average character width, in em at normal width, as measured in a browser.
   * A fact about the typeface, not a choice: the board uses it to estimate how many lines a
   * headline takes, so it can lay out its cards before the browser does.
   */
  measure: number;
};

export const typeRoles = [
  /** The wordmark. */
  'brand',
  /** A story page's headline. */
  'display',
  /** Section titles. */
  'title',
  /** A story card's headline. */
  'headline',
  /** Reading text. */
  'body',
  /** Summaries and the latest update on a card. */
  'callout',
  /** Tabs, chips and buttons. */
  'label',
  /** Times and counts. */
  'caption',
] as const;

export type TypeRole = (typeof typeRoles)[number];

/** One text style. Sizes are in pixels at the default text size; the website turns them into
 *  rem, so text grows with the reader's text-size setting. */
export type TypeStyle = {
  font: 'display' | 'text';
  size: number;
  line: number;
  weight: number;
  /** Letter spacing, in em. */
  tracking?: number;
  /** Width, as a percentage, for typefaces with a width axis (100 is normal). */
  width?: number;
  /** Tabular numbers line up in columns of times, counts and prices. */
  numbers?: 'tabular';
};

export const spaceRoles = [
  /** The page's side margin on a phone. */
  'gutter',
  /** The gap between the board's columns, and between cards. */
  'laneGap',
  /** The space inside a card. */
  'cardPad',
  /** The space between small things in a stack (a headline and its details). */
  'stack',
  /** The space between sections of a page. */
  'section',
] as const;

export type SpaceRole = (typeof spaceRoles)[number];

export const radiusRoles = ['card', 'media', 'control', 'chip'] as const;
export type RadiusRole = (typeof radiusRoles)[number];

/**
 * How a category's own look is drawn when a story has no picture:
 * `ink` a printed panel (a tint with a fine dot print and the category's mark),
 * `poster` the category's colour filling the whole card,
 * `field` a field of the category's colour that deepens with how fast the story is moving.
 */
export type ArtStyle = 'ink' | 'poster' | 'field';

export type DesignValues = {
  /** The direction's name and what it is, for the design pages and the design log. */
  name: string;
  summary: string;
  references: readonly string[];
  color: Record<ColorRole, Pair>;
  category: Record<CategoryCode, CategoryLook>;
  /** For a category added to the agreement's list before it has a look of its own. */
  categoryFallback: CategoryLook;
  font: { display: Font; text: Font };
  type: Record<TypeRole, TypeStyle>;
  space: Record<SpaceRole, number>;
  radius: Record<RadiusRole, number>;
  card: {
    /** Border width in pixels; 0 for none. */
    border: number;
    /** The space between a card's edge and its picture, in pixels; 0 runs it edge to edge. */
    inset: number;
    /** The shadow under a card, or none. Colours are `#RRGGBBAA` (the last two digits are
     *  its opacity), which both the website and the app read. */
    shadow: 'none' | { y: number; blur: number; light: string; dark: string };
    /** How a story with no picture shows its category's look. */
    art: ArtStyle;
    /** Whether cards show the pulse strip: a tick for each update in the story's last day. */
    pulse: boolean;
  };
  icon: {
    /** Line thickness on the icons' 24-unit grid. */
    stroke: number;
    size: { small: number; medium: number; large: number };
  };
  motion: { fast: number; base: number; easing: string };
};
