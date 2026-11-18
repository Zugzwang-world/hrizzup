import { randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { thumbHashToRGBA } from 'thumbhash';
import { describe, expect, it } from 'vitest';
import { cleanImage, ImageTimeout, problemOf } from './image.ts';
import { FileProblem } from './refusals.ts';
import { sampleJpeg, samplePng } from './samples.ts';

/**
 * The image pipeline (docs/social/media-design.md, 7.5, "Images"): what comes out holds nothing the sender put
 * in but the pixels, turned upright, at 4,096 pixels at most, in the format it came in.
 */

/** The code an image is refused with, or null when it was taken. */
async function refusedWith(bytes: Uint8Array, type: Parameters<typeof cleanImage>[1]) {
  try {
    await cleanImage(bytes, type);
    return null;
  } catch (error) {
    if (error instanceof FileProblem) return error.code;
    throw error;
  }
}

/** The raw red channel of the picture's first column, top to bottom. */
async function redDown(image: Uint8Array): Promise<number[]> {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Array.from({ length: info.height }, (_, y) => data[y * info.width * info.channels] ?? 0);
}

describe('a JPEG with a position and a sideways orientation', () => {
  it('comes out upright, with no EXIF, XMP, IPTC or profile at all', async () => {
    const original = await sampleJpeg({ width: 40, height: 20, orientation: 6, location: true });
    // The sample really carries what must go.
    const before = await sharp(original).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif).toBeDefined();
    expect(original.includes(Buffer.from('WGS-84', 'latin1')), 'with its position').toBe(true);
    expect([before.width, before.height]).toEqual([40, 20]);

    const cleaned = await cleanImage(original, 'image/jpeg');
    expect([cleaned.width, cleaned.height]).toEqual([20, 40]);
    const after = await sharp(cleaned.bytes).metadata();
    expect([after.format, after.width, after.height]).toEqual(['jpeg', 20, 40]);
    expect(after.orientation).toBeUndefined();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.tifftagPhotoshop).toBeUndefined();
    // And not a byte of an EXIF or XMP segment is left in the file.
    expect(cleaned.bytes.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
    expect(cleaned.bytes.includes(Buffer.from('WGS-84', 'latin1'))).toBe(false);
    expect(cleaned.bytes.includes(Buffer.from('http://ns.adobe.com/xap', 'latin1'))).toBe(false);
  });

  it('has its pixels turned upright: the gradient that ran left to right now runs top to bottom', async () => {
    // Orientation 6: the picture is shown turned a quarter clockwise, so the left edge becomes the top.
    const upright = await cleanImage(
      await sampleJpeg({ width: 40, height: 20, orientation: 6 }),
      'image/jpeg',
    );
    const column = await redDown(upright.bytes);
    expect(column).toHaveLength(40);
    expect(column[0] ?? 255).toBeLessThan(column.at(-1) ?? 0);
    expect(column[0] ?? 255).toBeLessThan(90);
    expect(column.at(-1) ?? 0).toBeGreaterThan(170);
  });
});

describe('an image', () => {
  it('keeps its format: PNG stays PNG, WebP stays WebP, JPEG stays JPEG', async () => {
    const png = await samplePng({ width: 64, height: 32 });
    const cleanedPng = await cleanImage(png, 'image/png');
    expect((await sharp(cleanedPng.bytes).metadata()).format).toBe('png');
    const webp = await sharp(png).webp().toBuffer();
    expect((await sharp((await cleanImage(webp, 'image/webp')).bytes).metadata()).format).toBe(
      'webp',
    );
    const jpeg = await sampleJpeg({ width: 64, height: 32 });
    expect((await sharp((await cleanImage(jpeg, 'image/jpeg')).bytes).metadata()).format).toBe(
      'jpeg',
    );
  });

  it('is at most 4,096 pixels on its longest side, shrunk to fit, and never enlarged', async () => {
    const wide = await cleanImage(await samplePng({ width: 5000, height: 100 }), 'image/png');
    expect([wide.width, wide.height]).toEqual([4096, 82]);
    const small = await cleanImage(await samplePng({ width: 300, height: 100 }), 'image/png');
    expect([small.width, small.height]).toEqual([300, 100]);
  });

  it('has a ThumbHash for its placeholder, of the agreement’s length, that decodes', async () => {
    const cleaned = await cleanImage(await samplePng({ width: 200, height: 100 }), 'image/png');
    const hash = cleaned.placeholder ?? '';
    expect(hash.length).toBeGreaterThanOrEqual(16);
    expect(hash.length).toBeLessThanOrEqual(100);
    expect(hash).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const { w, h } = thumbHashToRGBA(Buffer.from(hash, 'base64'));
    expect(w / h).toBeCloseTo(2, 0);
  });
});

describe('an image that is refused', () => {
  it('is wrong_type when it is not the type it was declared', async () => {
    const png = await samplePng({ width: 20, height: 20 });
    expect(await refusedWith(png, 'image/jpeg')).toBe('wrong_type');
    expect(await refusedWith(png, 'image/webp')).toBe('wrong_type');
  });

  it('is unreadable when sharp can’t decode it: junk, a cut file, nothing', async () => {
    expect(await refusedWith(Buffer.from('not an image at all'), 'image/png')).toBe('unreadable');
    const jpeg = await sampleJpeg({ width: 200, height: 200 });
    expect(await refusedWith(jpeg.subarray(0, 150), 'image/jpeg')).toBe('unreadable');
    expect(await refusedWith(new Uint8Array(0), 'image/jpeg')).toBe('unreadable');
  });

  it('takes an animated PNG (APNG) as its first frame: only the default image is read', async () => {
    // A PNG with an animation control chunk added before its data, as an APNG carries.
    const plain = await samplePng({ width: 20, height: 10 });
    const at = plain.indexOf('IDAT') - 4;
    const control = Buffer.alloc(8);
    control.writeUInt32BE(3, 0); // frames
    const type = Buffer.from('acTL', 'latin1');
    const chunk = Buffer.alloc(8 + 8 + 4);
    chunk.writeUInt32BE(8, 0);
    type.copy(chunk, 4);
    control.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([type, control])), 16);
    const apng = Buffer.concat([plain.subarray(0, at), chunk, plain.subarray(at)]);
    const cleaned = await cleanImage(apng, 'image/png');
    expect([cleaned.width, cleaned.height]).toEqual([20, 10]);
    expect((await sharp(cleaned.bytes).metadata()).pages ?? 1).toBe(1);
  });

  it('is animated when it has more than one frame', async () => {
    const frame = (background: string) =>
      sharp({ create: { width: 10, height: 10, channels: 3, background } })
        .png()
        .toBuffer();
    const frames = await Promise.all(['#ff0000', '#00ff00', '#0000ff'].map(frame));
    const animated = await sharp(frames, { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100, 100] })
      .toBuffer();
    expect(await refusedWith(animated, 'image/webp')).toBe('animated');
  });

  it('is too_large_image from its header, before it is decoded, past 50 megapixels', async () => {
    // 56 megapixels of one colour: a small file that would be 168 MB decoded.
    const bomb = await sharp({
      create: { width: 8000, height: 7000, channels: 3, background: '#335577' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(1_000_000);
    expect(await refusedWith(bomb, 'image/png')).toBe('too_large_image');
  });

  it('is too_big when it is over 10 MB even cleaned (a PNG of noise)', async () => {
    const [width, height] = [2400, 1500];
    const noise = await sharp(randomBytes(width * height * 3), {
      raw: { width, height, channels: 3 },
    })
      .png({ compressionLevel: 1 })
      .toBuffer();
    expect(await refusedWith(noise, 'image/png')).toBe('too_big');
  }, 60_000);
});

describe('what sharp says when it gives up', () => {
  it('is a time-out (a passing failure) for its own time limit, as it words it, and not a refusal of the file', () => {
    // Taken from sharp 0.35.5's real error for a pipeline killed by `.timeout({ seconds })`.
    const real = new Error('timeout: 13% complete\nVipsImage: killed for image "temp-51"');
    expect(problemOf(real)).toBeInstanceOf(ImageTimeout);
    expect(problemOf(new Error('Input image exceeds pixel limit'))).toMatchObject({
      code: 'too_large_image',
    });
    expect(problemOf(new Error('Input buffer contains unsupported image format'))).toMatchObject({
      code: 'unreadable',
    });
  });
});
