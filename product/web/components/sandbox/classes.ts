/**
 * Class strings the sandbox's server pages and client parts both use. This module has no
 * 'use client' on purpose: a server page that imports a value from a client module gets a stand-in
 * that throws when it is turned into text, so a class string made from it puts that error into the
 * page (lib/client-boundary.test.ts checks every server file for it). Keep shared strings here.
 */

/** The one button that does the thing: Buy, Sell, Open. Ink on paper, the site's own values. */
export const PRIMARY =
  'min-h-11 min-w-0 rounded-md border border-ink bg-ink px-5 font-medium break-words text-paper disabled:opacity-60';
