import { Anek_Latin, Archivo, Eczar } from 'next/font/google';

/**
 * Every typeface the design values name (product/packages/design), loaded by next/font:
 * downloaded at build time and served from our own address (a reader's browser never calls
 * Google), cut down to Latin letters, and given a size-matched fallback so nothing jumps when
 * the typeface arrives. Each sets the CSS variable that `fontVariable()` gives its family,
 * which tokens.css reads. Only the active direction's typefaces are preloaded; the others
 * download only on the design pages that use them. `fonts.test.ts` keeps this file in step
 * with the design values.
 */
export const eczar = Eczar({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-eczar',
  preload: true,
});

export const anekLatin = Anek_Latin({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-anek-latin',
  axes: ['wdth'],
  preload: false,
});

export const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-archivo',
  axes: ['wdth'],
  preload: false,
});

/** The class names that set every typeface's CSS variable, for the page's root element. */
export const fontVariables = [eczar.variable, anekLatin.variable, archivo.variable].join(' ');
