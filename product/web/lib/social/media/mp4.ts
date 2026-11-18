import { FileProblem } from './refusals.ts';

/**
 * The MP4 and M4A reader (docs/social/media-design.md, 7.5): our own, bounded, a few hundred lines, because
 * a media library is large, has many dependencies and trusts headers. It reads the boxes of a file through a
 * `ByteSource` (ranged reads, so a 100 MB video is never held in memory), finds its length by two measures
 * (the header's and the samples' own table, so a header that hides a longer file is caught) and its size,
 * and answers a `FileProblem` for anything it won't take. It never throws anything else and never loops
 * without a bound: 64 top-level boxes, a `moov` of at most 16 MiB, 50,000 boxes inside it, nesting at most
 * eight deep. Nothing else in the file is read or changed.
 */

/** The file's bytes, by range. `read` answers `[start, end)`, fewer only at the end of the file. */
export type ByteSource = {
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
};

/** What the reader found: the length in milliseconds (1 or more), and the picture's size when a video says one. */
export type Mp4Facts = { durationMs: number; width: number | null; height: number | null };

const FIRST_READ = 65_536;
const MOST_TOP_LEVEL_BOXES = 64;
const MOST_MOOV_BYTES = 16 * 1024 * 1024;
const MOST_MOOV_BOXES = 50_000;
const MOST_DEPTH = 8;
const MOST_PIXELS = 10_000;
const SLACK_MS = 1_000n;

/** The longest each kind of file may be, in milliseconds. */
const LIMIT_MS = { 'video/mp4': 60_000n, 'audio/mp4': 300_000n } as const;

const CONTAINERS = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'edts',
  'mvex',
  'udta',
  'meta',
  'ilst',
]);

/**
 * Boxes a parent may hold once. Two of them make two answers, and a player reads the first while a reader that
 * keeps the last would read the other: a file could carry a short `mdhd` for us and a long one for the player. So a
 * second one is not first-wins or last-wins, it is refused.
 */
const ONCE = new Set([
  'mvhd',
  'mvex',
  'tkhd',
  'mdia',
  'mdhd',
  'hdlr',
  'minf',
  'stbl',
  'stts',
  'stsz',
  'stz2',
  'edts',
  'elst',
]);

/**
 * Where each box that decides a length may be. A player's parser takes a box of these types wherever it finds it
 * (FFmpeg reads an `stts` inside `edts` as the track's own), so one anywhere else is a second answer, and is refused.
 */
const ONLY_IN: Record<string, string> = {
  mvhd: 'moov',
  tkhd: 'moov/trak',
  mdhd: 'moov/trak/mdia',
  stts: 'moov/trak/mdia/minf/stbl',
  stsz: 'moov/trak/mdia/minf/stbl',
  stz2: 'moov/trak/mdia/minf/stbl',
  elst: 'moov/trak/edts',
};

const unreadable = (detail?: string) => new FileProblem('unreadable', detail);

type Track = {
  handler: string | null;
  timescale: bigint | null;
  duration: bigint | null;
  /** The samples' total length in the media's timescale, and how many samples `stts` counts. */
  sampled: bigint | null;
  samples: bigint | null;
  /** How many samples `stsz` or `stz2` counts, and how many of the two the track has. */
  table: bigint | null;
  tables: number;
  /** The edit list's segments added up, in the movie's timescale. */
  edited: bigint;
  width: number | null;
  height: number | null;
  turned: boolean;
};

/** A bounds-checked reader over one buffer: every read past its end is `unreadable`. */
function viewOf(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (at: number, length: number): void => {
    if (at < 0 || length < 0 || at + length > bytes.length) throw unreadable('a read past a box');
  };
  return {
    length: bytes.length,
    u8(at: number): number {
      need(at, 1);
      return view.getUint8(at);
    },
    u32(at: number): number {
      need(at, 4);
      return view.getUint32(at);
    },
    i32(at: number): number {
      need(at, 4);
      return view.getInt32(at);
    },
    u64(at: number): bigint {
      need(at, 8);
      return view.getBigUint64(at);
    },
    text(at: number, length: number): string {
      need(at, length);
      return String.fromCharCode(...bytes.subarray(at, at + length));
    },
  };
}

type View = ReturnType<typeof viewOf>;

/** A box's size as `[boxSize, headerSize]` at `at`, inside `[at, end)`. */
function boxAt(view: View, at: number, end: number): [number, number] {
  const size32 = view.u32(at);
  if (size32 === 1) {
    if (end - at < 16) throw unreadable('a box with no room for its size');
    const big = view.u64(at + 8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw unreadable('a box too big to count');
    return [Number(big), 16];
  }
  // 0 means "to the end of what holds it".
  return [size32 === 0 ? end - at : size32, 8];
}

/**
 * The top-level boxes: where `moov` is. A top-level `moof` makes the file fragmented, which is refused at the
 * first one (a real fragmented file has one for every fragment, so it would pass 64 boxes first): its samples
 * live outside `moov`, so its length can't be measured here.
 */
async function topLevel(source: ByteSource): Promise<{ start: number; end: number }> {
  const { size } = source;
  if (size < 8) throw unreadable('too small to hold a box');
  const first = await source.read(0, Math.min(FIRST_READ, size));
  let offset = 0;
  let boxes = 0;
  let found: { start: number; end: number } | null = null;
  let moovs = 0;
  while (offset < size) {
    boxes += 1;
    if (boxes > MOST_TOP_LEVEL_BOXES) throw unreadable('too many boxes');
    const header =
      offset + 16 <= first.length || first.length >= size
        ? first.subarray(offset, Math.min(offset + 16, size))
        : await source.read(offset, Math.min(offset + 16, size));
    if (header.length < 8) throw unreadable('a box cut short');
    const view = viewOf(header);
    const [boxSize, headerSize] = boxAt(view, 0, size - offset);
    if (boxSize < headerSize || offset + boxSize > size) throw unreadable('a box past the file');
    const type = view.text(4, 4);
    if (type === 'moov') {
      moovs += 1;
      found = { start: offset + headerSize, end: offset + boxSize };
    } else if (type === 'moof') {
      throw new FileProblem('fragmented');
    }
    offset += boxSize;
  }
  if (moovs !== 1 || found === null) throw unreadable(`${moovs} moov boxes`);
  return found;
}

/** What walking `moov` collects. */
type Found = {
  movie: { timescale: bigint; duration: bigint } | null;
  tracks: Track[];
  mvex: boolean;
};

/** A movie or media header: its timescale and duration (versions 0 and 1). */
function timing(view: View, start: number, end: number): { timescale: bigint; duration: bigint } {
  const version = view.u8(start);
  if (version === 0 && end - start >= 20) {
    return { timescale: BigInt(view.u32(start + 12)), duration: BigInt(view.u32(start + 16)) };
  }
  if (version === 1 && end - start >= 32) {
    return { timescale: BigInt(view.u32(start + 20)), duration: view.u64(start + 24) };
  }
  throw unreadable('a header of a kind we do not read');
}

/** A track header's picture size (16.16, so the whole part) and whether its matrix turns it a quarter. */
function pictureOf(view: View, start: number, end: number) {
  const version = view.u8(start);
  const at = version === 0 ? 40 : version === 1 ? 52 : -1;
  if (at < 0 || end - start < at + 44) throw unreadable('a track header of a kind we do not read');
  const [a, b, c, d] = [
    view.i32(start + at),
    view.i32(start + at + 4),
    view.i32(start + at + 12),
    view.i32(start + at + 16),
  ];
  return {
    width: view.u32(start + at + 36) >>> 16,
    height: view.u32(start + at + 40) >>> 16,
    turned: a === 0 && d === 0 && Math.abs(b) === 0x10000 && Math.abs(c) === 0x10000,
  };
}

/** What `stts` says: how many samples, and their total length in the media's own timescale (pairs of a count and a delta). */
function sampled(view: View, start: number, end: number): { samples: bigint; total: bigint } {
  if (end - start < 8) throw unreadable('a sample table cut short');
  const entries = view.u32(start + 4);
  if (entries * 8 > end - start - 8) throw unreadable('a sample table cut short');
  let [samples, total] = [0n, 0n];
  for (let entry = 0; entry < entries; entry++) {
    const at = start + 8 + entry * 8;
    const count = BigInt(view.u32(at));
    samples += count;
    total += count * BigInt(view.u32(at + 4));
  }
  return { samples, total };
}

/**
 * How many samples `stsz` (or `stz2`) holds, and that its table is really there: a player that finds the table
 * short reads fewer samples than the count says. `stts` must count exactly this many.
 */
function counted(view: View, start: number, end: number, compact: boolean): bigint {
  if (end - start < 12) throw unreadable('a sample size table cut short');
  const count = view.u32(start + 8);
  const room = end - start - 12;
  if (compact) {
    const bits = view.u8(start + 7);
    if (![4, 8, 16].includes(bits)) throw unreadable('a sample size of an odd width');
    if (Math.ceil((count * bits) / 8) > room) throw unreadable('a sample size table cut short');
  } else if (view.u32(start + 4) === 0 && count * 4 > room) {
    // No one size for every sample: a size for each follows.
    throw unreadable('a sample size table cut short');
  }
  return BigInt(count);
}

/** An edit list's segments added up, in the movie's timescale (versions 0 and 1). */
function edited(view: View, start: number, end: number): bigint {
  if (end - start < 8) throw unreadable('an edit list cut short');
  const version = view.u8(start);
  const [width, wide] = version === 0 ? [12, false] : version === 1 ? [20, true] : [0, false];
  if (width === 0) throw unreadable('an edit list of a kind we do not read');
  const entries = view.u32(start + 4);
  if (entries * width > end - start - 8) throw unreadable('an edit list cut short');
  let total = 0n;
  for (let entry = 0; entry < entries; entry++) {
    const at = start + 8 + entry * width;
    total += wide ? view.u64(at) : BigInt(view.u32(at));
  }
  return total;
}

/** Walks `moov`'s boxes: the movie's header and each track's own. */
function walk(
  view: View,
  start: number,
  end: number,
  depth: number,
  path: string[],
  budget: { boxes: number },
  found: Found,
): void {
  let at = start;
  const seen = new Set<string>();
  while (at < end) {
    if (end - at < 8) {
      // A QuickTime `udta` ends with four zero bytes; nothing else may be left over.
      for (let i = at; i < end; i++) if (view.u8(i) !== 0) throw unreadable('bytes left in a box');
      return;
    }
    const [boxSize, headerSize] = boxAt(view, at, end);
    if (boxSize < headerSize || at + boxSize > end) throw unreadable('a box past its parent');
    budget.boxes += 1;
    if (budget.boxes > MOST_MOOV_BOXES) throw unreadable('too many boxes');
    const type = view.text(at + 4, 4);
    if (ONCE.has(type)) {
      if (seen.has(type)) throw unreadable(`two ${type} boxes in one`);
      seen.add(type);
    }
    const inner = at + headerSize;
    const outer = at + boxSize;
    const here = path.join('/');
    const only = ONLY_IN[type];
    if (only !== undefined && here !== only) throw unreadable(`a ${type} where it doesn't belong`);
    if (type === 'mvhd' && found.movie === null) {
      found.movie = timing(view, inner, outer);
    } else if (type === 'mvex' && here === 'moov') {
      found.mvex = true;
    } else if (type === 'trak' && here === 'moov') {
      found.tracks.push({
        handler: null,
        timescale: null,
        duration: null,
        sampled: null,
        samples: null,
        table: null,
        tables: 0,
        edited: 0n,
        width: null,
        height: null,
        turned: false,
      });
    } else {
      const track = found.tracks.at(-1);
      if (track !== undefined) {
        if (type === 'tkhd') Object.assign(track, pictureOf(view, inner, outer));
        else if (type === 'mdhd') {
          const times = timing(view, inner, outer);
          track.timescale = times.timescale;
          track.duration = times.duration;
        } else if (type === 'hdlr' && here === 'moov/trak/mdia') {
          if (outer - inner < 12) throw unreadable('a handler cut short');
          track.handler = view.text(inner + 8, 4);
        } else if (type === 'stts') {
          const counts = sampled(view, inner, outer);
          track.sampled = counts.total;
          track.samples = counts.samples;
        } else if (type === 'stsz' || type === 'stz2') {
          track.table = counted(view, inner, outer, type === 'stz2');
          track.tables += 1;
        } else if (type === 'elst') {
          track.edited = edited(view, inner, outer);
        }
      }
    }
    if (CONTAINERS.has(type)) {
      if (depth + 1 > MOST_DEPTH) throw unreadable('boxes nested too deep');
      // A `meta` is a full box (four bytes of version and flags first) unless a child's size comes straight away.
      const full = type === 'meta' && outer - inner >= 4 && view.u32(inner) === 0;
      walk(view, full ? inner + 4 : inner, outer, depth + 1, [...path, type], budget, found);
    }
    at = outer;
  }
}

const larger = (a: bigint, b: bigint) => (a > b ? a : b);
const smaller = (a: bigint, b: bigint) => (a < b ? a : b);

/** `ceil(units * 1000 / timescale)`, in milliseconds. */
function millis(units: bigint, timescale: bigint): bigint {
  if (timescale <= 0n) throw unreadable('a timescale of zero');
  return (units * 1000n + timescale - 1n) / timescale;
}

/**
 * Reads an MP4 or an M4A: its length and a video's picture size, or a `FileProblem` (`unreadable`, `fragmented`,
 * `wrong_tracks`, `too_long`, `dimensions`). A file declared `video/mp4` needs a video track; one declared
 * `audio/mp4` needs a sound track and no video track.
 */
export async function readMp4(
  source: ByteSource,
  declared: 'video/mp4' | 'audio/mp4',
): Promise<Mp4Facts> {
  try {
    const { start, end } = await topLevel(source);
    if (end - start > MOST_MOOV_BYTES) throw unreadable('a moov too big to read');
    const body = await source.read(start, end);
    if (body.length !== end - start) throw unreadable('a moov cut short');
    const view = viewOf(body);
    const found: Found = { movie: null, tracks: [], mvex: false };
    walk(view, 0, body.length, 1, ['moov'], { boxes: 0 }, found);
    const { movie, tracks } = found;
    if (movie === null) throw unreadable('no movie header');

    // Every track says all of what a player reads: a missing box is a fall-back the player makes (the movie's
    // timescale for a missing `mdhd`, the last delta repeated for samples `stts` doesn't count) and plays a length
    // we never measured. So a track without its `mdhd`, `hdlr`, `stts` and one sample size table, or whose `stts`
    // and sample size table count different numbers of samples, is refused.
    for (const track of tracks) {
      if (
        track.timescale === null ||
        track.duration === null ||
        track.handler === null ||
        track.sampled === null ||
        track.samples === null ||
        track.table === null
      ) {
        throw unreadable('a track with a box missing');
      }
      if (track.tables !== 1) throw unreadable('a track with two sample size tables');
      if (track.samples !== track.table)
        throw unreadable('a track whose tables count different samples');
    }

    const video = tracks.find((track) => track.handler === 'vide');
    const hasSound = tracks.some((track) => track.handler === 'soun');
    if (declared === 'video/mp4' ? video === undefined : !hasSound || video !== undefined) {
      throw new FileProblem('wrong_tracks');
    }
    // A fragmented file with its fragments elsewhere has a movie of no length and an `mvex`.
    if (movie.duration === 0n && found.mvex) throw new FileProblem('fragmented');
    if (movie.duration === 0n) throw unreadable('a movie of no length');

    const limit = LIMIT_MS[declared];
    const movieMs = millis(movie.duration, movie.timescale);
    let trackMs = 0n;
    for (const track of tracks) {
      if (track.timescale === null || track.duration === null || track.sampled === null) continue;
      const longest = larger(track.sampled, track.duration);
      const ms = millis(longest, track.timescale);
      if (ms > trackMs) trackMs = ms;
      // An edit list can show a track for longer than it holds (an empty edit, a slowed one).
      if (millis(track.edited, movie.timescale) > limit + SLACK_MS)
        throw new FileProblem('too_long');
    }
    // The second measure covers an encoder's start padding, so a true 60-second video passes, and catches a
    // header that hides a longer file.
    if (movieMs > limit || trackMs > limit + SLACK_MS) throw new FileProblem('too_long');

    let width: number | null = null;
    let height: number | null = null;
    if (declared === 'video/mp4' && video !== undefined) {
      const [w, h] = video.turned ? [video.height, video.width] : [video.width, video.height];
      if ((w ?? 0) > MOST_PIXELS || (h ?? 0) > MOST_PIXELS) throw new FileProblem('dimensions');
      if (w !== null && h !== null && w > 0 && h > 0) [width, height] = [w, h];
    }
    return { durationMs: Number(smaller(movieMs, limit)), width, height };
  } catch (error) {
    if (error instanceof RangeError) throw unreadable('a read past the data');
    throw error;
  }
}
