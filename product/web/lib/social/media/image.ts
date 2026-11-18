import { rgbaToThumbHash } from 'thumbhash';
import { FileProblem } from './refusals.ts';

/**
 * The image pipeline (docs/social/media-design.md, 7.5, "Images"): the bytes of an upload are decoded and
 * written again by `sharp`, so nothing the sender put in the file reaches the media bucket but its pixels.
 * Rotation is fixed first (`autoOrient`), the largest side is 4,096 pixels at most, and no metadata is
 * kept, whatever the format: location, the camera's details, the orientation tag, colour profiles and
 * thumbnails are all gone (sharp's own default when no `keep…` or `with…` option is used, so none of those
 * options is ever called here). The format stays the upload's own (a PNG chart stays lossless); nothing is
 * converted. The ThumbHash for the picture's placeholder is made from the cleaned pixels.
 *
 * `sharp` is loaded on first use, not at import: this file is part of the API's one router module, and the
 * public reads must not wait on libvips.
 */

/** What the pipeline made of an image: the bytes to store, its size and its placeholder (null when the hash doesn't fit the agreement). */
export type CleanImage = {
  bytes: Buffer;
  width: number;
  height: number;
  placeholder: string | null;
};

/** `sharp` ran past its own time limit: a passing failure, so the check is released and may be tried again. */
export class ImageTimeout extends Error {
  constructor() {
    super('The image took too long to process');
    this.name = 'ImageTimeout';
  }
}

const MOST_PIXELS = 50_000_000;
const LARGEST_SIDE = 4_096;
const MOST_BYTES = 10_485_760;
const SECONDS = 20;

const FORMAT = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' } as const;

type Sharp = typeof import('sharp')['default'];
let loaded: Promise<Sharp> | null = null;

/** `sharp`, loaded once, with libvips' own operation cache off (it only costs memory in a function). */
export function sharpOf(): Promise<Sharp> {
  loaded ??= import('sharp').then((module) => {
    const sharp = module.default;
    sharp.cache(false);
    return sharp;
  });
  return loaded;
}

/** Whether sharp's error says a limit was hit rather than a file was bad. */
const isPixelLimit = (error: unknown) =>
  error instanceof Error && /pixel limit/i.test(error.message);
const isTimeout = (error: unknown) =>
  error instanceof Error && /time(d)? ?out|took more than/i.test(error.message);

/** What a thrown error from `sharp` about the uploaded bytes means for the upload. */
export function problemOf(error: unknown): Error {
  if (isPixelLimit(error)) return new FileProblem('too_large_image');
  if (isTimeout(error)) return new ImageTimeout();
  return new FileProblem('unreadable', error instanceof Error ? error.message : 'unreadable');
}

/**
 * The cleaned image for `bytes` declared as `contentType`, or a `FileProblem` (`wrong_type`, `animated`,
 * `unreadable`, `too_large_image`, `too_big`), or `ImageTimeout`.
 */
export async function cleanImage(
  bytes: Uint8Array,
  contentType: 'image/jpeg' | 'image/png' | 'image/webp',
): Promise<CleanImage> {
  const sharp = await sharpOf();
  const options = { limitInputPixels: MOST_PIXELS } as const;
  const format = FORMAT[contentType];

  let meta: Awaited<ReturnType<ReturnType<Sharp>['metadata']>>;
  try {
    meta = await sharp(bytes, options).metadata();
  } catch (error) {
    throw problemOf(error);
  }
  if (meta.format !== format) throw new FileProblem('wrong_type');
  if ((meta.pages ?? 1) > 1) throw new FileProblem('animated');
  if (!meta.width || !meta.height) throw new FileProblem('unreadable', 'no size');

  let cleaned: { data: Buffer; info: { width: number; height: number } };
  try {
    const pipeline = sharp(bytes, options).autoOrient().resize({
      width: LARGEST_SIDE,
      height: LARGEST_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const written =
      format === 'jpeg'
        ? pipeline.jpeg({ quality: 85, mozjpeg: true })
        : format === 'png'
          ? pipeline.png({ compressionLevel: 9, palette: meta.isPalette === true })
          : pipeline.webp({ quality: 85 });
    cleaned = await written.timeout({ seconds: SECONDS }).toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw problemOf(error);
  }
  if (cleaned.data.length > MOST_BYTES) throw new FileProblem('too_big');
  return {
    bytes: cleaned.data,
    width: cleaned.info.width,
    height: cleaned.info.height,
    placeholder: await placeholderOf(sharp, cleaned.data),
  };
}

/** The ThumbHash of an image, in base64, when it fits the agreement's 16 to 100 characters; null otherwise (a missing placeholder never fails an upload). */
async function placeholderOf(sharp: Sharp, image: Buffer): Promise<string | null> {
  try {
    const small = await sharp(image)
      .resize(100, 100, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const hash = Buffer.from(
      rgbaToThumbHash(small.info.width, small.info.height, small.data),
    ).toString('base64');
    return hash.length >= 16 && hash.length <= 100 ? hash : null;
  } catch {
    return null;
  }
}
