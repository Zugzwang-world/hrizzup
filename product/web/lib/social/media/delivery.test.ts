import { social } from '@hrizzup/api';
import { describe, expect, it } from 'vitest';
import { imageSet, transformed, WIDTHS } from './delivery.ts';

/** Transformation addresses and the widths chosen (docs/social/media-design.md, 7.7). */

const URL_OF = 'https://media.example.test/social/a/b.webp';

describe('a transformed address', () => {
  it('is the media host, Cloudflare’s path with the width and automatic format, then the file’s own path', () => {
    expect(transformed(URL_OF, 640)).toBe(
      'https://media.example.test/cdn-cgi/image/width=640,format=auto/social/a/b.webp',
    );
    expect(transformed('https://media.example.test:8443/social/x.jpg', 320)).toBe(
      'https://media.example.test:8443/cdn-cgi/image/width=320,format=auto/social/x.jpg',
    );
  });
});

describe('the widths', () => {
  it('are the contract’s imageWidths, written once more where client code can import them', () => {
    expect([...WIDTHS]).toEqual([...social.imageWidths]);
  });

  it('offered are those at or under the picture’s own, and `src` is the 640 one', () => {
    const set = imageSet({ url: URL_OF, width: 1280 });
    expect(set.widths).toEqual([320, 640, 960, 1280]);
    expect(set.src).toBe(transformed(URL_OF, 640));
    expect(set.srcSet).toBe(
      [320, 640, 960, 1280].map((width) => `${transformed(URL_OF, width)} ${width}w`).join(', '),
    );
    expect(imageSet({ url: URL_OF, width: 960 }).widths).toEqual([320, 640, 960]);
    expect(imageSet({ url: URL_OF, width: 700 }).widths).toEqual([320, 640]);
  });

  it('are just 320 when the picture is narrower, and src is then that one', () => {
    for (const width of [1, 200, 319]) {
      const set = imageSet({ url: URL_OF, width });
      expect(set.widths).toEqual([320]);
      expect(set.src).toBe(transformed(URL_OF, 320));
      expect(set.srcSet).toBe(`${transformed(URL_OF, 320)} 320w`);
    }
    // 320 exactly offers 320, with no 640 to be the `src`: the largest listed is.
    expect(imageSet({ url: URL_OF, width: 320 }).src).toBe(transformed(URL_OF, 320));
  });
});
