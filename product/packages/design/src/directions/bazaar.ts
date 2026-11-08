import type { DesignValues } from '../types.ts';

/**
 * Direction 2, Bazaar (poster pop): loud, joyful and made for sharing. Every category has
 * its own colour from Indian streets and markets, and a story with no picture becomes a
 * poster in it, its headline set big in Anek Latin's condensed weights (a typeface designed
 * in India by Ek Type, with Indian scripts to come).
 */
export const bazaar = {
  name: 'Bazaar',
  summary:
    'A wall of posters. Each category has its own street colour, and headlines are set big in Anek Latin, condensed.',
  references: [
    'Pinterest: the board of tiles',
    "Amul's topical hoardings: news with wit, in bold colour",
    'Indian hand-painted signs and market colours: marigold, rani pink, peacock, parrot green',
    'Anek by Ek Type, designed in India',
  ],
  color: {
    background: { light: '#FFFFFF', dark: '#151114' },
    foreground: { light: '#1E1A1D', dark: '#F6F1F4' },
    card: { light: '#F2EEF0', dark: '#221B1F' },
    cardForeground: { light: '#1E1A1D', dark: '#F6F1F4' },
    popover: { light: '#FFFFFF', dark: '#2A2226' },
    popoverForeground: { light: '#1E1A1D', dark: '#F6F1F4' },
    primary: { light: '#C2185B', dark: '#F06AA5' },
    primaryForeground: { light: '#FFFFFF', dark: '#1E1A1D' },
    secondary: { light: '#F2EEF0', dark: '#2E262B' },
    secondaryForeground: { light: '#1E1A1D', dark: '#F6F1F4' },
    muted: { light: '#F2EEF0', dark: '#2E262B' },
    mutedForeground: { light: '#5A5458', dark: '#B9AEB4' },
    accent: { light: '#FCE0EC', dark: '#3A3036' },
    accentForeground: { light: '#1E1A1D', dark: '#F6F1F4' },
    destructive: { light: '#B3261E', dark: '#FF8A80' },
    destructiveForeground: { light: '#FFFFFF', dark: '#2A0705' },
    border: { light: '#E4DEE1', dark: '#3A3036' },
    input: { light: '#CFC7CB', dark: '#4A4045' },
    ring: { light: '#C2185B', dark: '#F06AA5' },
    live: { light: '#FFB000', dark: '#FFB000' },
    liveForeground: { light: '#1E1A1D', dark: '#1E1A1D' },
    notice: { light: '#FFF1CC', dark: '#3A2C0C' },
    noticeForeground: { light: '#6B4A00', dark: '#FFD98A' },
  },
  category: {
    crypto: {
      fill: { light: '#FFB000', dark: '#FFB000' },
      ink: { light: '#1E1A1D', dark: '#1E1A1D' },
      soft: { light: '#FFF1CC', dark: '#3A2E10' },
      softInk: { light: '#6B4A00', dark: '#FFD475' },
      icon: 'bitcoin',
    },
    finance: {
      fill: { light: '#0BA360', dark: '#0BA360' },
      ink: { light: '#1E1A1D', dark: '#1E1A1D' },
      soft: { light: '#D9F4E6', dark: '#0F2E20' },
      softInk: { light: '#0B5C36', dark: '#7FE0B0' },
      icon: 'indian-rupee',
    },
    business: {
      fill: { light: '#007A87', dark: '#007A87' },
      ink: { light: '#FFFFFF', dark: '#FFFFFF' },
      soft: { light: '#D5EEF1', dark: '#0D2A2E' },
      softInk: { light: '#00515A', dark: '#86D8E2' },
      icon: 'briefcase-business',
    },
    ai: {
      fill: { light: '#2E4BFF', dark: '#2E4BFF' },
      ink: { light: '#FFFFFF', dark: '#FFFFFF' },
      soft: { light: '#E0E5FF', dark: '#1A2050' },
      softInk: { light: '#1F33B3', dark: '#B3C0FF' },
      icon: 'sparkles',
    },
    sports: {
      fill: { light: '#C93C19', dark: '#C93C19' },
      ink: { light: '#FFFFFF', dark: '#FFFFFF' },
      soft: { light: '#FBE1DA', dark: '#3A1A12' },
      softInk: { light: '#8A2810', dark: '#FFB29E' },
      icon: 'trophy',
    },
    politics: {
      fill: { light: '#5B2C91', dark: '#5B2C91' },
      ink: { light: '#FFFFFF', dark: '#FFFFFF' },
      soft: { light: '#ECE2F7', dark: '#2A1A40' },
      softInk: { light: '#45206F', dark: '#D3B8F5' },
      icon: 'landmark',
    },
    entertainment: {
      fill: { light: '#D6156C', dark: '#D6156C' },
      ink: { light: '#FFFFFF', dark: '#FFFFFF' },
      soft: { light: '#FCE0EC', dark: '#3E1228' },
      softInk: { light: '#9A0F4E', dark: '#FFA8CC' },
      icon: 'clapperboard',
    },
    general: {
      fill: { light: '#5E6470', dark: '#5E6470' },
      ink: { light: '#FFFFFF', dark: '#FFFFFF' },
      soft: { light: '#E7E9EC', dark: '#2A2D33' },
      softInk: { light: '#41464F', dark: '#CDD1D8' },
      icon: 'newspaper',
    },
  },
  categoryFallback: {
    fill: { light: '#1E1A1D', dark: '#F6F1F4' },
    ink: { light: '#FFFFFF', dark: '#1E1A1D' },
    soft: { light: '#F2EEF0', dark: '#2E262B' },
    softInk: { light: '#1E1A1D', dark: '#F6F1F4' },
    icon: 'newspaper',
  },
  font: {
    display: {
      family: 'Anek Latin',
      fallback: ['Arial Narrow', 'Roboto Condensed', 'sans-serif'],
      licence: 'SIL Open Font License 1.1',
      source: 'https://fonts.google.com/specimen/Anek+Latin',
    },
    text: {
      family: 'Anek Latin',
      fallback: ['system-ui', 'Roboto', 'sans-serif'],
      licence: 'SIL Open Font License 1.1',
      source: 'https://fonts.google.com/specimen/Anek+Latin',
    },
  },
  type: {
    brand: { font: 'display', size: 30, line: 30, weight: 800, width: 75, tracking: -0.01 },
    display: { font: 'display', size: 36, line: 36, weight: 800, width: 75 },
    title: { font: 'display', size: 24, line: 26, weight: 800, width: 75 },
    headline: { font: 'display', size: 22, line: 23, weight: 750, width: 75 },
    body: { font: 'text', size: 16, line: 23, weight: 400 },
    callout: { font: 'text', size: 15, line: 20, weight: 450 },
    label: { font: 'text', size: 15, line: 18, weight: 650 },
    caption: { font: 'text', size: 13, line: 16, weight: 550, numbers: 'tabular' },
  },
  space: { gutter: 14, laneGap: 8, cardPad: 12, stack: 6, section: 28 },
  radius: { card: 18, media: 12, control: 999, chip: 999 },
  card: { border: 0, inset: 8, shadow: 'none', art: 'poster', pulse: false },
  icon: { stroke: 2.25, size: { small: 15, medium: 19, large: 24 } },
  motion: { fast: 120, base: 220, easing: 'cubic-bezier(0.3, 1.3, 0.5, 1)' },
} as const satisfies DesignValues;
