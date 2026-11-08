import type { PlaywrightTestOptions } from '@playwright/test';

/** Journeys run on a phone-sized screen, the way most readers will use the site (phone first). */
export const phone: Partial<PlaywrightTestOptions> = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
};
