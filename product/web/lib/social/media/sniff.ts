/**
 * What a file really is, from its first bytes (docs/social/media-design.md, 7.5, "Real type"): never what
 * the sender says it is. A mismatch with the declared type is `wrong_type`.
 */

export type Sniffed = 'jpeg' | 'png' | 'webp' | 'mp4' | 'mp3';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (bytes: Uint8Array, at: number, text: readonly number[]) =>
  bytes.length >= at + text.length && text.every((byte, i) => bytes[at + i] === byte);

const ascii = (text: string) => [...text].map((letter) => letter.charCodeAt(0));

/** An MPEG audio frame header: 11 sync bits, a version that isn't the reserved one, layer III. */
function isMp3Header(bytes: Uint8Array, at: number): boolean {
  const [b0, b1] = [bytes[at], bytes[at + 1]];
  if (b0 === undefined || b1 === undefined) return false;
  return b0 === 0xff && (b1 & 0xe0) === 0xe0 && ((b1 >> 3) & 3) !== 1 && ((b1 >> 1) & 3) === 1;
}

/** The real type of a file from its first bytes (at least 12 of them), or null when it is none we take. */
export function sniff(head: Uint8Array): Sniffed | null {
  if (startsWith(head, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, 0, PNG)) return 'png';
  if (startsWith(head, 0, ascii('RIFF')) && startsWith(head, 8, ascii('WEBP'))) return 'webp';
  if (startsWith(head, 4, ascii('ftyp'))) {
    const size = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0);
    return size >= 8 && size <= 4096 ? 'mp4' : null;
  }
  if (startsWith(head, 0, ascii('ID3')) || isMp3Header(head, 0)) return 'mp3';
  return null;
}

/** The type a declared content type must really be. */
export const REAL_TYPE: Record<string, Sniffed> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
};

/** Whether the first bytes are what the declared content type says. */
export function matchesDeclared(head: Uint8Array, contentType: string): boolean {
  const wanted = REAL_TYPE[contentType];
  return wanted !== undefined && sniff(head) === wanted;
}
