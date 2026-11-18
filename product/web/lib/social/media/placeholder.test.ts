import sharp from 'sharp';
import { rgbaToThumbHash, thumbHashToDataURL, thumbHashToRGBA } from 'thumbhash';
import { describe, expect, it } from 'vitest';
import { placeholderDataUrl, pngOf } from './placeholder.ts';

/** The data URL a ThumbHash makes: a PNG of the hash's own size, small, and nothing for what isn't a hash. */

/** A ThumbHash of a 16 by 12 gradient, in base64. */
function hashOf(seed = 0): string {
  const [w, h] = [16, 12];
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = (i * 7 + seed * 31) % 256;
    rgba[i * 4 + 1] = (i * 3 + seed * 17) % 256;
    rgba[i * 4 + 2] = 200 - (i % w) * 8;
    rgba[i * 4 + 3] = 255;
  }
  return Buffer.from(rgbaToThumbHash(w, h, rgba)).toString('base64');
}

describe('a placeholder', () => {
  it('is a data URL of a PNG of the hash’s own size, which decodes', async () => {
    const hash = hashOf();
    const url = placeholderDataUrl(hash);
    expect(url).toMatch(/^data:image\/png;base64,/);
    const png = Buffer.from((url ?? '').replace('data:image/png;base64,', ''), 'base64');
    const meta = await sharp(png).metadata();
    const { w, h } = thumbHashToRGBA(Buffer.from(hash, 'base64'));
    expect([meta.format, meta.width, meta.height, meta.channels]).toEqual(['png', w, h, 4]);
    expect(w).toBeLessThanOrEqual(32);
    expect(h).toBeLessThanOrEqual(32);
    // The pixels are the hash's own.
    const raw = await sharp(png).raw().toBuffer();
    expect([...raw]).toEqual([...thumbHashToRGBA(Buffer.from(hash, 'base64')).rgba]);
  });

  it('is small: deflated, never the library’s uncompressed PNG', () => {
    const hash = hashOf();
    const url = placeholderDataUrl(hash) ?? '';
    const bytes = Buffer.from(hash, 'base64');
    const { w, h, rgba } = thumbHashToRGBA(bytes);
    expect(url.length).toBeLessThan(thumbHashToDataURL(bytes).length);
    expect(pngOf(w, h, rgba).length).toBeLessThan(w * h * 4);
  });

  it('is the same for the same hash, however often it is asked (the memory is bounded and only a copy)', () => {
    const first = placeholderDataUrl(hashOf(1));
    for (let seed = 2; seed < 60; seed++) placeholderDataUrl(hashOf(seed));
    expect(placeholderDataUrl(hashOf(1))).toBe(first);
  });

  it('is null for what is not a hash: null, too short or long, not base64, or not a base64 that round-trips', () => {
    expect(placeholderDataUrl(null)).toBeNull();
    expect(placeholderDataUrl(undefined)).toBeNull();
    expect(placeholderDataUrl('')).toBeNull();
    expect(placeholderDataUrl('abc')).toBeNull();
    expect(placeholderDataUrl('A'.repeat(101))).toBeNull();
    expect(placeholderDataUrl('not base64 at all!!!!!')).toBeNull();
    expect(placeholderDataUrl(`${hashOf().slice(0, -1)}`)).toBeNull();
  });
});
