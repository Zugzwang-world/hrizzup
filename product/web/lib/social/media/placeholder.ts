import { crc32, deflateSync } from 'node:zlib';
import { thumbHashToRGBA } from 'thumbhash';

/**
 * A picture's placeholder as an image the page can draw at once (docs/social/media-design.md, 7.7): the
 * ThumbHash (a few dozen characters, kept on the media row) decoded to at most 32 by 32 pixels and written as a
 * small PNG, as a data URL. ThumbHash's own `thumbHashToDataURL` writes an uncompressed PNG, three to four
 * times larger in every page's HTML; this one deflates it (about a kilobyte). Server only (`node:zlib`).
 */

const KEPT = 1_000;
/** Newest last: a Map keeps insertion order, so the first key is the oldest. */
const kept = new Map<string, string>();

/** One PNG chunk: its length, its type, its data and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** An RGBA image as a PNG: 8-bit colour with alpha, filter 0 on every row, deflated at level 9. */
export function pngOf(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // compression, filter and interlace stay 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    raw.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** The data URL of a ThumbHash given in base64, or null for anything that isn't one (no throw). */
export function placeholderDataUrl(hash: string | null | undefined): string | null {
  if (typeof hash !== 'string' || hash.length < 16 || hash.length > 100) return null;
  const known = kept.get(hash);
  if (known !== undefined) return known;
  let url: string;
  try {
    const bytes = Buffer.from(hash, 'base64');
    // `Buffer.from` ignores what isn't base64: a hash that doesn't round-trip isn't one.
    if (bytes.toString('base64') !== hash) return null;
    const { w, h, rgba } = thumbHashToRGBA(bytes);
    if (!(w >= 1 && h >= 1 && w <= 32 && h <= 32)) return null;
    url = `data:image/png;base64,${pngOf(w, h, rgba).toString('base64')}`;
  } catch {
    return null;
  }
  if (kept.size >= KEPT) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
  kept.set(hash, url);
  return url;
}
