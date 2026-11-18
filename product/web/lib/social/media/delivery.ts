/**
 * How a picture is delivered (docs/social/media-design.md, 7.7): the original file's address, and
 * Cloudflare's resized copies of it on the same host, by width. Pure: no environment, safe in client code.
 */

/** The widths a picture is offered at: `imageWidths` of the contract's `social/media.ts`, written again here so client code needs no import of the whole contract (a test pins them equal). */
export const WIDTHS: readonly number[] = [320, 640, 960, 1280];

/** The address of a resized copy: `<origin>/cdn-cgi/image/width=<w>,format=auto<path>`. `fit` defaults to `scale-down`, which never enlarges. */
export function transformed(url: string, width: number): string {
  const { origin, pathname } = new URL(url);
  return `${origin}/cdn-cgi/image/width=${width},format=auto${pathname}`;
}

/** What an `<img>` and its `<source>` need: the widths at or under the picture's own (just the smallest when none is), `src` the 640 one when offered, else the largest. */
export function imageSet(image: { url: string; width: number }): {
  src: string;
  srcSet: string;
  widths: number[];
} {
  const fitting = WIDTHS.filter((width) => width <= image.width);
  const widths = fitting.length > 0 ? fitting : [WIDTHS[0] ?? 320];
  const chosen = widths.includes(640) ? 640 : (widths.at(-1) ?? 320);
  return {
    src: transformed(image.url, chosen),
    srcSet: widths.map((width) => `${transformed(image.url, width)} ${width}w`).join(', '),
    widths,
  };
}
