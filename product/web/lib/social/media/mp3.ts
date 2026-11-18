import { FileProblem } from './refusals.ts';

/**
 * The MP3 frame walker (docs/social/media-design.md, 7.5): it streams the file once and counts every audio
 * frame, so the length is the sound's own, never a header's claim (a lying Xing header can't hide a long
 * file). Only layer III, MPEG-1, MPEG-2 and MPEG-2.5, and every frame has the version, layer and sample rate of
 * the first (as FFmpeg's own parser requires): a header that disagrees is junk, so a fake header's span can't hide
 * frames of another rate that a player would still decode. Skips an ID3v2 tag at the start (at most 10 MiB, looked
 * through for audio hidden in it) and the ID3v1 tag at the end (`trailerLength`); nothing else is skipped, so an
 * APE tag's bytes are walked like any junk, and any frames in them count. Junk between frames is scanned past, at
 * most 64 KiB of it in the whole file; at most 1,000,000 frames. A leading Xing, Info or VBRI frame is not sound
 * and isn't counted. Anything else is a `FileProblem`: `unreadable`, or `too_long`.
 */

/** The bytes at the end of a file the walker needs to see before streaming: an ID3v1 tag's 128. */
export const TAIL_BYTES = 128;

/**
 * A tag's size is a header too, and a header that lies could swallow audio the walker never counts: so what is
 * skipped (the ID3v2 tag at the start) is looked through for a run of this many frames
 * back to back, which is sound and no tag (random bytes make four in a row about once in 10^12 places).
 */
const HIDDEN_RUN = 4;
/** The longest frame there is (MPEG-1 at 320 kbit/s and 32 kHz, padded). */
const LONGEST_FRAME = 1441;
const SCAN_BLOCK = 65_536;

const MOST_ID3_BYTES = 10 * 1024 * 1024;
const MOST_SKIPPED_BYTES = 65_536;
const MOST_FRAMES = 1_000_000;
/** The longest audio, in milliseconds, and the slack video's tracks get too: an encoder's padding mustn't refuse a true 5 minutes. */
const LIMIT_MS = 300_000n;
const SLACK_MS = 1_000n;

const BITRATES_MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
/** Sample rates by the header's version bits: 3 is MPEG-1, 2 is MPEG-2, 0 is MPEG-2.5 (1 is reserved). */
const RATES: Record<number, number[]> = {
  3: [44_100, 48_000, 32_000],
  2: [22_050, 24_000, 16_000],
  0: [11_025, 12_000, 8_000],
};

const unreadable = (detail: string) => new FileProblem('unreadable', detail);

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  at >= 0 &&
  at + text.length <= bytes.length &&
  [...text].every((letter, i) => bytes[at + i] === letter.charCodeAt(0));

/** One frame's header, read from four bytes: its length in bytes, its samples and its sample rate; null when it isn't a layer III frame. */
function headerOf(
  bytes: Uint8Array,
): { length: number; samples: number; rate: number; kind: number } | null {
  const [b0, b1, b2] = [bytes[0], bytes[1], bytes[2]];
  if (b0 !== 0xff || b1 === undefined || b2 === undefined || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3;
  if (version === 1 || ((b1 >> 1) & 3) !== 1) return null;
  const bitrate = b2 >> 4;
  const rateAt = (b2 >> 2) & 3;
  if (bitrate < 1 || bitrate > 14 || rateAt > 2) return null;
  const mpeg1 = version === 3;
  const kbps = (mpeg1 ? BITRATES_MPEG1 : BITRATES_MPEG2)[bitrate] ?? 0;
  const rate = RATES[version]?.[rateAt] ?? 0;
  if (kbps === 0 || rate === 0) return null;
  const padding = (b2 >> 1) & 1;
  return {
    length: Math.floor(((mpeg1 ? 144_000 : 72_000) * kbps) / rate) + padding,
    samples: mpeg1 ? 1152 : 576,
    rate,
    // What every frame of a file must share: its version, its layer and its sample rate.
    kind: ((b1 & 0x1e) << 8) | rateAt,
  };
}

/** Whether a whole frame is the Xing, Info or VBRI header that encoders put first: it describes the sound and holds none. */
function isInfoFrame(frame: Uint8Array): boolean {
  const [b1, b3] = [frame[1] ?? 0, frame[3] ?? 0];
  const mpeg1 = ((b1 >> 3) & 3) === 3;
  const mono = b3 >> 6 === 3;
  const sideInformation = mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const at = 4 + sideInformation + ((b1 & 1) === 0 ? 2 : 0);
  return ascii(frame, at, 'Xing') || ascii(frame, at, 'Info') || ascii(frame, 36, 'VBRI');
}

/** Whether a run of `HIDDEN_RUN` frames back to back starts within the first `limit` bytes. */
function hasFrameRun(bytes: Uint8Array, limit: number): boolean {
  for (let at = 0; at < limit; at++) {
    if (bytes[at] !== 0xff) continue;
    let [run, position] = [0, at];
    while (run < HIDDEN_RUN && position + 4 <= bytes.length) {
      const header = headerOf(bytes.subarray(position, position + 4));
      if (header === null) break;
      run += 1;
      position += header.length;
    }
    if (run === HIDDEN_RUN) return true;
  }
  return false;
}

/**
 * How many bytes at the end of the file aren't audio: an ID3v1 tag (128 bytes starting `TAG`), and nothing else.
 * An APE tag is not skipped (a player decodes whatever frames are in it), so it is walked like junk. `tail` is
 * the file's last `TAIL_BYTES` bytes (or all of a shorter file).
 */
export function trailerLength(tail: Uint8Array): number {
  return tail.length >= 128 && ascii(tail, tail.length - 128, 'TAG') ? 128 : 0;
}

/** A window over a stream of chunks: look at the next few bytes, move past some, never hold more than the next chunk. */
class Window {
  offset = 0;
  private bytes: Uint8Array = new Uint8Array(0);
  private at = 0;
  private ended = false;

  constructor(private readonly chunks: AsyncIterator<Uint8Array>) {}

  /** Up to `count` bytes from here (fewer only at the end of the stream). */
  async peek(count: number): Promise<Uint8Array> {
    while (this.bytes.length - this.at < count && !this.ended) {
      const next = await this.chunks.next();
      if (next.done) {
        this.ended = true;
        break;
      }
      const rest = this.bytes.subarray(this.at);
      const merged = new Uint8Array(rest.length + next.value.length);
      merged.set(rest);
      merged.set(next.value, rest.length);
      this.bytes = merged;
      this.at = 0;
    }
    return this.bytes.subarray(this.at, this.at + count);
  }

  /** Moves past `count` bytes; false when the stream ended first. */
  async discard(count: number): Promise<boolean> {
    let left = count;
    while (left > 0) {
      const have = this.bytes.length - this.at;
      if (have > 0) {
        const taken = Math.min(have, left);
        this.at += taken;
        this.offset += taken;
        left -= taken;
        continue;
      }
      if (this.ended) return false;
      const next = await this.chunks.next();
      if (next.done) {
        this.ended = true;
        return false;
      }
      this.bytes = next.value;
      this.at = 0;
    }
    return true;
  }
}

/** Moves past `length` bytes of a tag, looking through them for hidden audio (`HIDDEN_RUN`): `unreadable` when it holds any, or the stream ends early. */
async function skipTag(window: Window, length: number): Promise<void> {
  let left = length;
  while (left > 0) {
    const step = Math.min(SCAN_BLOCK, left);
    // Looking ahead by a few frames, but never past the tag itself.
    const block = (
      await window.peek(Math.min(left, SCAN_BLOCK + HIDDEN_RUN * LONGEST_FRAME))
    ).subarray(0, left);
    if (hasFrameRun(block, step)) throw unreadable('audio inside a tag');
    if (!(await window.discard(step))) throw unreadable('a file cut short');
    left -= step;
  }
}

/** The sum of every frame's samples over its rate, in whole milliseconds rounded up, exactly. */
function millis(samplesByRate: Map<number, bigint>): bigint {
  let common = 1n;
  for (const rate of samplesByRate.keys()) common *= BigInt(rate);
  let total = 0n;
  for (const [rate, samples] of samplesByRate) total += samples * 1000n * (common / BigInt(rate));
  return (total + common - 1n) / common;
}

/**
 * Walks an MP3 streamed once: `size` is its length, `trailer` the bytes at its end that aren't audio. Answers
 * the length in milliseconds (1 or more, at most 300,000, though a file measuring up to 301,000 is taken) or a
 * `FileProblem`.
 */
export async function readMp3(
  stream: AsyncIterable<Uint8Array>,
  size: number,
  trailer: number,
): Promise<{ durationMs: number }> {
  const chunks = stream[Symbol.asyncIterator]();
  try {
    const window = new Window(chunks);
    const end = size - trailer;
    const start = await window.peek(10);
    if (ascii(start, 0, 'ID3') && start.length === 10) {
      const sizes = [start[6] ?? 0x80, start[7] ?? 0x80, start[8] ?? 0x80, start[9] ?? 0x80];
      if (sizes.some((byte) => byte >= 0x80)) throw unreadable('an ID3 tag of an impossible size');
      const [a = 0, b = 0, c = 0, d = 0] = sizes;
      const footer = ((start[5] ?? 0) & 0x10) !== 0 ? 10 : 0;
      const tag = ((a << 21) | (b << 14) | (c << 7) | d) + 10 + footer;
      if (tag > MOST_ID3_BYTES || tag > end) throw unreadable('an ID3 tag too big');
      await skipTag(window, tag);
    }

    const samplesByRate = new Map<number, bigint>();
    let [frames, sound, skipped] = [0, 0, 0];
    let kind: number | null = null;
    while (window.offset < end) {
      const room = end - window.offset;
      const next = await window.peek(Math.min(4, room));
      const header = next.length === 4 ? headerOf(next) : null;
      if (header !== null && header.length <= room && (kind === null || header.kind === kind)) {
        kind ??= header.kind;
        frames += 1;
        if (frames > MOST_FRAMES) throw unreadable('too many frames');
        // The first frame may be an encoder's description of the sound, with none of it.
        const info = frames === 1 && isInfoFrame(await window.peek(header.length));
        if (!info) {
          sound += 1;
          samplesByRate.set(
            header.rate,
            (samplesByRate.get(header.rate) ?? 0n) + BigInt(header.samples),
          );
        }
        if (!(await window.discard(header.length))) throw unreadable('a file cut short');
        continue;
      }
      // Not a frame here (or one of another version, layer or rate): the first two must be valid and back to back;
      // later junk is scanned past, within a bound.
      if (frames < 2) throw unreadable('the first frames are not back to back');
      skipped += 1;
      if (skipped > MOST_SKIPPED_BYTES) throw unreadable('too much junk between frames');
      if (!(await window.discard(1))) throw unreadable('a file cut short');
    }
    if (frames < 2 || sound < 1) throw unreadable('fewer than two frames');
    const ms = millis(samplesByRate);
    if (ms > LIMIT_MS + SLACK_MS) throw new FileProblem('too_long');
    // The table holds at most 300,000: the slack is for padding, and never reaches the row.
    return { durationMs: Number(ms < LIMIT_MS ? ms : LIMIT_MS) };
  } finally {
    // Stop reading: the stream's rest is never needed.
    await chunks.return?.().catch(() => undefined);
  }
}
