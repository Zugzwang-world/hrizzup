import sharp from 'sharp';

/**
 * Sample files for tests, journeys and fixtures (docs/social/media-design.md, 7.12): made here from nothing, so
 * no real photo, no real person and no real place is ever in the repository. Pure TypeScript and `sharp`: this
 * file reads no environment and imports nothing that does (the journeys' keys are checked by following their
 * relative imports, `infra/doppler/test_workflows.py`).
 *
 * The images are real images (a two-colour gradient). The MP4, M4A and MP3 files are **structure only**: their
 * boxes and frame headers are right, so the reader measures them, but nothing plays. That is all the check and
 * the layout need.
 */

type Size = { width: number; height: number };

/** A gradient from one colour on the left to another on the right, as raw RGB pixels. */
function gradient({ width, height }: Size): Buffer {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const along = width === 1 ? 0 : x / (width - 1);
      const at = (y * width + x) * 3;
      raw[at] = Math.round(40 + 180 * along);
      raw[at + 1] = Math.round(90 + 60 * (y / Math.max(1, height - 1)));
      raw[at + 2] = Math.round(220 - 170 * along);
    }
  }
  return raw;
}

const rawOf = ({ width, height }: Size) => ({ raw: { width, height, channels: 3 as const } });

/** A PNG: a two-colour gradient. */
export function samplePng(size: Size): Promise<Buffer> {
  return sharp(gradient(size), rawOf(size)).png().toBuffer();
}

/**
 * A JPEG: the same gradient. `orientation` (1 to 8) writes the EXIF orientation tag, which a viewer turns the
 * picture by; `location` writes a made-up GPS position (1 degree north, 4 east: open sea, nobody's place).
 */
export function sampleJpeg(
  options: Size & { orientation?: number; location?: boolean },
): Promise<Buffer> {
  let image = sharp(gradient(options), rawOf(options)).jpeg({ quality: 90 });
  if (options.location) {
    image = image.withExif({
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '1/1 2/1 3/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '4/1 5/1 6/1',
      },
    });
  }
  // `withExif` can't set the orientation tag (sharp keeps its own); `withMetadata` does.
  if (options.orientation !== undefined)
    image = image.withMetadata({ orientation: options.orientation });
  return image.toBuffer();
}

// MP4 -----------------------------------------------------------------------------------------------------

const u32 = (value: number) => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0);
  return out;
};
const i32 = (value: number) => {
  const out = Buffer.alloc(4);
  out.writeInt32BE(value);
  return out;
};
const u16 = (value: number) => {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(value);
  return out;
};
const zeros = (count: number) => Buffer.alloc(count);

/** A box: its 32-bit size, its four-letter type and its payload. */
export const box = (type: string, ...payload: Buffer[]): Buffer => {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
};
/** A box with its version and flags (all zero). */
const full = (type: string, ...payload: Buffer[]) => box(type, zeros(4), ...payload);

/** One track of a sample: its kind, and its own length in seconds when it differs from the file's. */
export type SampleTrack = 'video' | 'audio' | { kind: 'video' | 'audio'; seconds: number };

export type Mp4Options = {
  /** The length of each track, in seconds, and (unless `movieSeconds` says otherwise) of the movie. */
  seconds: number;
  /** The picture's size, written to each video track's header. */
  width?: number;
  height?: number;
  /** What the file holds, in order. */
  tracks: SampleTrack[];
  /** `moov` after the media data (as a phone writes it), not before. */
  moovAtEnd?: boolean;
  /** The movie header's length, when it should say something else than the tracks do. */
  movieSeconds?: number;
  /** A matrix that turns the picture a quarter. */
  rotate?: boolean;
  /** A fragmented file: movie length zero, an `mvex`, and a `moof` after the data. */
  fragmented?: boolean;
  /** The media data's box with a 64-bit size. */
  largeSize?: boolean;
  /** The major brand (`isom`, or `M4A ` for audio). */
  brand?: string;
};

const MOVIE_TIMESCALE = 1000;
const MATRIX = (rotate: boolean) =>
  Buffer.concat(
    (rotate
      ? [0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x40000000]
      : [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000]
    ).map(i32),
  );

/** One `trak`: header, media header, handler and a sample table of one entry covering the whole length. */
function track(kind: 'video' | 'audio', seconds: number, id: number, options: Mp4Options): Buffer {
  const timescale = kind === 'video' ? 1000 : 48_000;
  const units = Math.round(seconds * timescale);
  const movieUnits = Math.round(seconds * MOVIE_TIMESCALE);
  const tkhd = full(
    'tkhd',
    u32(0), // creation
    u32(0), // modification
    u32(id),
    u32(0), // reserved
    u32(movieUnits),
    zeros(8), // reserved
    u16(0), // layer
    u16(0), // alternate group
    u16(kind === 'audio' ? 0x0100 : 0),
    u16(0), // reserved
    MATRIX(options.rotate === true && kind === 'video'),
    u32(kind === 'video' ? (options.width ?? 0) * 0x10000 : 0),
    u32(kind === 'video' ? (options.height ?? 0) * 0x10000 : 0),
  );
  const mdhd = full('mdhd', u32(0), u32(0), u32(timescale), u32(units), u16(0x55c4), u16(0));
  const hdlr = full(
    'hdlr',
    u32(0),
    Buffer.from(kind === 'video' ? 'vide' : 'soun', 'latin1'),
    zeros(12),
    zeros(1),
  );
  const stts = full('stts', u32(1), u32(1), u32(units));
  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', box('stbl', stts))));
}

/**
 * An MP4: `ftyp`, `moov` (a movie header with a timescale of 1,000, and a `trak` for each track) and an `mdat`
 * of a few bytes. Structure only: nothing plays.
 */
export function sampleMp4(options: Mp4Options): Buffer {
  const ftyp = box(
    'ftyp',
    Buffer.from(options.brand ?? 'isom', 'latin1'),
    u32(0),
    Buffer.from('isom', 'latin1'),
  );
  const tracks = options.tracks.map((one, at) => {
    const spec = typeof one === 'string' ? { kind: one, seconds: options.seconds } : one;
    return track(spec.kind, spec.seconds, at + 1, options);
  });
  const movieUnits = options.fragmented
    ? 0
    : Math.round((options.movieSeconds ?? options.seconds) * MOVIE_TIMESCALE);
  const mvhd = full(
    'mvhd',
    u32(0),
    u32(0),
    u32(MOVIE_TIMESCALE),
    u32(movieUnits),
    u32(0x10000), // rate
    u16(0x0100), // volume
    zeros(10),
    MATRIX(false),
    zeros(24),
    u32(options.tracks.length + 1),
  );
  const moov = box(
    'moov',
    mvhd,
    ...tracks,
    ...(options.fragmented
      ? [box('mvex', full('trex', u32(1), u32(1), u32(0), u32(0), u32(0)))]
      : []),
  );
  const payload = Buffer.from('structure only, nothing plays', 'latin1');
  const mdat = options.largeSize
    ? Buffer.concat([u32(1), Buffer.from('mdat', 'latin1'), bigSize(16 + payload.length), payload])
    : box('mdat', payload);
  const moof = options.fragmented ? [box('moof', full('mfhd', u32(1)))] : [];
  return Buffer.concat(
    options.moovAtEnd ? [ftyp, mdat, moov, ...moof] : [ftyp, moov, mdat, ...moof],
  );
}

const bigSize = (value: number) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(value));
  return out;
};

/** An M4A: an MP4 with one sound track. */
export function sampleM4a(options: Omit<Mp4Options, 'tracks'>): Buffer {
  return sampleMp4({ ...options, tracks: ['audio'], brand: options.brand ?? 'M4A ' });
}

// MP3 -----------------------------------------------------------------------------------------------------

/** One MPEG-1 layer III frame at 128 kbit/s and 44.1 kHz: its header, then 413 zero bytes (417 in all). */
const FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), zeros(413)]);

/**
 * An MP3: frames of silence (zero payload), whole ones that fit `seconds` (or exactly `frames`), optionally behind an
 * ID3v2 tag of `id3` bytes (a cover picture's size, say).
 */
export function sampleMp3(options: { seconds?: number; frames?: number; id3?: number }): Buffer {
  const frames = options.frames ?? Math.floor(((options.seconds ?? 1) * 44_100) / 1152);
  const parts: Buffer[] = [];
  if (options.id3 !== undefined) {
    const size = options.id3;
    parts.push(
      Buffer.from([
        0x49,
        0x44,
        0x33, // ID3
        3,
        0, // version 2.3.0
        0, // flags
        (size >> 21) & 0x7f,
        (size >> 14) & 0x7f,
        (size >> 7) & 0x7f,
        size & 0x7f,
      ]),
      zeros(size),
    );
  }
  for (let i = 0; i < frames; i++) parts.push(FRAME);
  return Buffer.concat(parts);
}
