/**
 * Every screen size the screen check covers (CLAUDE.md, "Screens fit every device"):
 * 13 widths, each at a typical height for that kind of device; phones and tablets also
 * turned sideways; and the phone widths again with the text size at 200%.
 */
export type View = {
  name: string;
  width: number;
  height: number;
  touch: boolean;
  largeText?: boolean;
  /** Screenshots for the founder are taken at 360, 768, 1440 and 1920 pixels wide. */
  screenshot?: boolean;
};

const phones = [
  [320, 568],
  [360, 800],
  [390, 844],
  [412, 915],
] as const;
const tablets = [
  [768, 1024],
  [820, 1180],
  [1024, 1366],
] as const;
const laptops = [
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1536, 864],
] as const;
const monitors = [
  [1920, 1080],
  [2560, 1440],
] as const;

const SCREENSHOT_WIDTHS = new Set([360, 768, 1440, 1920]);

export const views: View[] = [
  ...[...phones, ...tablets].map(([width, height]) => ({
    name: `${width}x${height}`,
    width,
    height,
    touch: true,
    screenshot: SCREENSHOT_WIDTHS.has(width),
  })),
  ...[...laptops, ...monitors].map(([width, height]) => ({
    name: `${width}x${height}`,
    width,
    height,
    touch: false,
    screenshot: SCREENSHOT_WIDTHS.has(width),
  })),
  ...[...phones, ...tablets].map(([width, height]) => ({
    name: `${height}x${width}-sideways`,
    width: height,
    height: width,
    touch: true,
  })),
  ...phones.map(([width, height]) => ({
    name: `${width}x${height}-text-200`,
    width,
    height,
    touch: true,
    largeText: true,
  })),
];
