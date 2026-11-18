import { describe, expect, it } from 'vitest';
import { readMp3, TAIL_BYTES, trailerLength } from './mp3.ts';
import { FileProblem } from './refusals.ts';
import { sampleMp3 } from './samples.ts';

/** The MP3 frame walker (docs/social/media-design.md, 7.5): lengths, tags, other MPEG versions, junk and bounds. */

/** A file as a stream of chunks of `size` bytes. */
async function* chunked(file: Uint8Array, size = 1000) {
  for (let at = 0; at < file.length; at += size) yield file.subarray(at, at + size);
}

/** What reading a file comes to: its length, or the code it is refused with. */
async function read(file: Uint8Array, size = 1000) {
  try {
    const trailer = trailerLength(file.subarray(Math.max(0, file.length - TAIL_BYTES)));
    return (await readMp3(chunked(file, size), file.length, trailer)).durationMs;
  } catch (error) {
    if (error instanceof FileProblem) return error.code;
    throw error;
  }
}

/** The length of `frames` MPEG-1 layer III frames of 1,152 samples at 44.1 kHz, in whole milliseconds rounded up. */
const ms = (frames: number) => Math.ceil((frames * 1152 * 1000) / 44_100);

/** An MPEG-2 layer III frame: 80 kbit/s, 22.05 kHz, 576 samples, 261 bytes. */
const mpeg2 = () => Buffer.concat([Buffer.from([0xff, 0xf3, 0x90, 0x00]), Buffer.alloc(257)]);

describe('an MP3', () => {
  it('is measured by its frames: CBR, whatever the chunks the stream comes in', async () => {
    const file = sampleMp3({ seconds: 3 });
    expect(file.length).toBe(114 * 417);
    expect(await read(file)).toBe(ms(114));
    expect(await read(file, 1)).toBe(ms(114));
    expect(await read(file, 417)).toBe(ms(114));
    expect(await read(file, 100_000)).toBe(ms(114));
  });

  it('skips an ID3 tag at the start, however big (2 MB of cover art)', async () => {
    expect(await read(sampleMp3({ seconds: 2, id3: 2_000_000 }))).toBe(ms(76));
    expect(await read(sampleMp3({ seconds: 2, id3: 0 }))).toBe(ms(76));
  });

  it('is refused for an ID3 tag over 10 MiB, one that runs past the file, or one that is cut short', async () => {
    expect(await read(sampleMp3({ frames: 3, id3: 11 * 1024 * 1024 }))).toBe('unreadable');
    const file = sampleMp3({ frames: 3, id3: 100 });
    expect(await read(file.subarray(0, 60))).toBe('unreadable');
    const big = Buffer.from(sampleMp3({ frames: 3, id3: 100 }));
    big[6] = 0x7f;
    expect(await read(big)).toBe('unreadable');
  });

  it('reads MPEG-2 frames (576 samples each) when the file starts with them', async () => {
    const frames = Buffer.concat(Array.from({ length: 50 }, mpeg2));
    expect(await read(frames)).toBe(Math.ceil((50 * 576 * 1000) / 22_050));
  });

  it('holds the walk to the first frame’s version, layer and sample rate, but counts what a player would decode in the junk, at its own rate', async () => {
    const first = sampleMp3({ frames: 10 });
    // 50 frames of another version (13 KB) after 10 of the first: junk to the walk, but each is sound a player
    // plays, so each is counted at its own samples and rate (50 × 576 samples at 22.05 kHz).
    const other = Buffer.concat(Array.from({ length: 50 }, mpeg2));
    expect(await read(Buffer.concat([first, other]))).toBe(
      Math.ceil((10 * 1152 * 1000) / 44_100 + (50 * 576 * 1000) / 22_050),
    );
    // Enough of them to pass the junk bound (64 KiB) is refused, not read as a file of two kinds.
    const much = Buffer.concat(Array.from({ length: 400 }, mpeg2));
    expect(await read(Buffer.concat([first, much]))).toBe('unreadable');
    // Another sample rate of the same version is another kind too.
    const rate48 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x94, 0x00]), Buffer.alloc(380)]);
    expect(await read(Buffer.concat([first, ...Array.from({ length: 5 }, () => rate48)]))).toBe(
      Math.ceil((10 * 1152 * 1000) / 44_100 + (5 * 1152 * 1000) / 48_000),
    );
  });

  it('counts frames of another rate or layer hidden among a file’s own, at least as long as a player plays them', async () => {
    // The reviewer's shapes. 100 frames of 44.1 kHz layer III, then 900 other frames (64,800 bytes, inside the
    // 64 KiB junk bound), then 100 more. FFmpeg plays the whole 70 s; it was read as 5.2 s.
    const f44 = sampleMp3({ frames: 1 });
    const f8 = Buffer.concat([Buffer.from([0xff, 0xe3, 0x18, 0x00]), Buffer.alloc(68)]); // MPEG-2.5 layer III, 8 kHz: 72 ms
    const layer2 = Buffer.concat([Buffer.from([0xff, 0xf5, 0x18, 0x00]), Buffer.alloc(68)]); // MPEG-2 layer II, 16 kHz: 72 ms
    const layer1 = Buffer.concat([Buffer.from([0xff, 0xff, 0x18, 0x00]), Buffer.alloc(8)]); // MPEG-1 layer I, 32 kbit/s, 32 kHz: 384 samples
    const among = (frame: Buffer, count: number) =>
      Buffer.concat([
        ...Array.from({ length: 100 }, () => f44),
        ...Array.from({ length: count }, () => frame),
        ...Array.from({ length: 100 }, () => f44),
      ]);
    const own = (200 * 1152 * 1000) / 44_100;
    expect(await read(among(f8, 900))).toBe(Math.ceil(own + 900 * 72));
    expect(await read(among(layer2, 900))).toBe(Math.ceil(own + 900 * 72));
    expect(await read(among(layer2, 900))).toBeGreaterThanOrEqual(70_024);
    // Layer I plays 384 samples a frame; a header with no bitrate (free format) or a reserved rate is none.
    expect(await read(among(layer1, 20))).toBe(Math.ceil(own + (20 * 384 * 1000) / 32_000));
    const free = Buffer.concat([Buffer.from([0xff, 0xe3, 0x08, 0x00]), Buffer.alloc(68)]);
    const reserved = Buffer.concat([Buffer.from([0xff, 0xe3, 0x1c, 0x00]), Buffer.alloc(68)]);
    expect(await read(among(free, 20))).toBe(Math.ceil(own));
    expect(await read(among(reserved, 20))).toBe(Math.ceil(own));
    // One more than the bound's worth is refused.
    expect(await read(among(f8, 920))).toBe('unreadable');
  });

  it('skips the ID3v1 tag at the end, and walks an APE tag like junk: any frames in it count', async () => {
    const audio = sampleMp3({ frames: 20 });
    const v1 = Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125)]);
    expect(await read(Buffer.concat([audio, v1]))).toBe(ms(20));
    const footer = Buffer.alloc(32);
    footer.write('APETAGEX', 0, 'latin1');
    footer.writeUInt32LE(2000 + 32, 12);
    // A small APE tag is 2 KB of junk, well inside the bound; the frames before it are the file's length.
    const ape = Buffer.concat([Buffer.alloc(2000, 0x41), footer]);
    expect(await read(Buffer.concat([audio, ape]))).toBe(ms(20));
    expect(await read(Buffer.concat([audio, ape, v1]))).toBe(ms(20));
    // One that passes the junk bound (64 KiB, a cover picture's size) is refused.
    const big = Buffer.concat([Buffer.alloc(70_000, 0x41), footer]);
    expect(await read(Buffer.concat([audio, big]))).toBe('unreadable');
  });

  it('scans past junk between frames, up to 64 KiB of it in the whole file, and no more', async () => {
    const [a, b] = [sampleMp3({ frames: 10 }), sampleMp3({ frames: 10 })];
    expect(await read(Buffer.concat([a, Buffer.alloc(1000), b]))).toBe(ms(20));
    expect(await read(Buffer.concat([a, Buffer.alloc(65_536), b]))).toBe(ms(20));
    expect(await read(Buffer.concat([a, Buffer.alloc(65_537), b]))).toBe('unreadable');
    // The bound is for the whole file, not each gap.
    expect(await read(Buffer.concat([a, Buffer.alloc(40_000), b, Buffer.alloc(40_000), a]))).toBe(
      'unreadable',
    );
  });

  it('must start with two valid frames back to back', async () => {
    expect(await read(Buffer.concat([Buffer.alloc(10), sampleMp3({ frames: 10 })]))).toBe(
      'unreadable',
    );
    expect(
      await read(
        Buffer.concat([sampleMp3({ frames: 1 }), Buffer.alloc(50), sampleMp3({ frames: 5 })]),
      ),
    ).toBe('unreadable');
    expect(await read(sampleMp3({ frames: 1 }))).toBe('unreadable');
    expect(await read(sampleMp3({ frames: 2 }))).toBe(ms(2));
    expect(await read(Buffer.from('this is not an mp3 file at all, just words'))).toBe(
      'unreadable',
    );
    expect(await read(new Uint8Array(0))).toBe('unreadable');
  });

  it('is refused for layer I or II, or a reserved version, in the first frame', async () => {
    const layer2 = Buffer.concat(
      Array.from({ length: 5 }, () => Buffer.from([0xff, 0xfd, 0x90, 0, ...Buffer.alloc(413)])),
    );
    expect(await read(layer2)).toBe('unreadable');
  });

  it('may be 5 minutes, with a second of slack for an encoder’s padding, and the table never gets more than 300,000', async () => {
    // 48 kHz frames last 24 ms exactly: 12,500 are 300,000 ms.
    const frame48 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x94, 0x00]), Buffer.alloc(380)]);
    const at48 = (frames: number) => Buffer.concat(Array.from({ length: frames }, () => frame48));
    expect(await read(at48(12_499))).toBe(299_976);
    expect(await read(at48(12_500))).toBe(300_000);
    // 300,984 ms: over, by the padding's worth, and stored as the limit.
    expect(await read(at48(12_541))).toBe(300_000);
    // 301,008 ms: past the slack.
    expect(await read(at48(12_542))).toBe('too_long');
    // 44.1 kHz: the same edges, whatever the frame's length.
    expect(await read(sampleMp3({ frames: 11_484 }))).toBeLessThanOrEqual(300_000);
    expect(await read(sampleMp3({ frames: 11_485 }))).toBe(300_000);
    expect(await read(sampleMp3({ frames: 11_522 }))).toBe(300_000); // 300,977 ms
    expect(await read(sampleMp3({ frames: 11_523 }))).toBe('too_long'); // 301,003 ms
  });

  it('stops reading once it has what it needs', async () => {
    let pulled = 0;
    async function* counting() {
      for (let i = 0; i < 100; i++) {
        pulled += 1;
        yield sampleMp3({ frames: 4 });
      }
    }
    const frames = 100 * 4;
    await expect(readMp3(counting(), frames * 417, 0)).resolves.toMatchObject({
      durationMs: ms(frames),
    });
    expect(pulled).toBe(100);
    pulled = 0;
    // A stream longer than the file said: read only what the file's size covers.
    await readMp3(counting(), 10 * 417, 0);
    expect(pulled).toBeLessThanOrEqual(3);
  });

  it('is unreadable when the stream ends before the file’s size', async () => {
    const file = sampleMp3({ frames: 10 });
    await expect(readMp3(chunked(file), file.length + 5000, 0)).rejects.toMatchObject({
      code: 'unreadable',
    });
  });
});

describe('audio hidden where the file says there is a tag', () => {
  const hidden = (seconds: number) => sampleMp3({ seconds });

  it('is refused in an ID3 tag that swallows frames: the length would be the tag’s, not the sound’s', async () => {
    // A tag of 150 KB holding 30 seconds of frames, before 2 seconds of audio.
    const tag = hidden(30);
    const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
    header[6] = (tag.length >> 21) & 0x7f;
    header[7] = (tag.length >> 14) & 0x7f;
    header[8] = (tag.length >> 7) & 0x7f;
    header[9] = tag.length & 0x7f;
    expect(await read(Buffer.concat([header, tag, sampleMp3({ seconds: 2 })]))).toBe('unreadable');
    // A real tag, with a picture's worth of bytes in it and no frames, is not.
    expect(await read(sampleMp3({ seconds: 2, id3: 150_000 }))).toBe(ms(76));
  });

  it('counts frames that an APE tag’s declared size would hide: junk between them does not beat the scan, since nothing there is skipped', async () => {
    // 5 s of real frames, then what a footer calls a 9 MB APE tag: frames with a junk byte after every third,
    // which a four-in-a-row scan of a skipped region would miss. A player decodes them, so they are counted.
    const frame = sampleMp3({ frames: 1 });
    const head = sampleMp3({ frames: 191 });
    const parts: Buffer[] = [];
    for (let n = 1; n <= 21_566; n++) {
      parts.push(frame);
      if (n % 3 === 0) parts.push(Buffer.from([0x00]));
    }
    const hidden = Buffer.concat(parts);
    const footer = Buffer.alloc(32);
    footer.write('APETAGEX', 0, 'latin1');
    footer.writeUInt32LE(hidden.length + 32, 12);
    expect(await read(Buffer.concat([head, hidden, footer]))).toBe('too_long');
    // The same tag with fewer frames reads as the whole of them, junk byte and all.
    const fewer = Buffer.concat([head, Buffer.concat(parts.slice(0, 40)), footer]);
    expect(await read(fewer)).toBeGreaterThan(ms(191));
  });

  it('refuses frames of another rate hidden in the span of a fake header: its 19 real frames are decoded by a player', async () => {
    // Real frames are MPEG-2.5 layer III at 8 kbit/s and 8 kHz (72 bytes, 72 ms). A fake MPEG-1 header at 320
    // kbit/s and 32 kHz (1,441 bytes, 36 ms) spans 69 bytes and 19 of them.
    const real = Buffer.concat([Buffer.from([0xff, 0xe3, 0x18, 0x00]), Buffer.alloc(68)]);
    const unit = Buffer.concat([
      Buffer.from([0xff, 0xfb, 0xea, 0x00]),
      Buffer.alloc(69),
      ...Array.from({ length: 19 }, () => real),
    ]);
    expect(unit.length).toBe(1441);
    const make = (units: number) =>
      Buffer.concat([real, real, ...Array.from({ length: units }, () => unit)]);
    // 2,000 of them (73 junk bytes each) pass the junk bound: refused.
    expect(await read(make(2000))).toBe('unreadable');
    // A few are read as the real frames they hold, and each fake header is counted at its own rate (36 ms),
    // so the total is at least what a player that takes the fake headers and one that skips them plays.
    const sound = Math.ceil(((2 + 19 * 100) * 72 + 100 * 36) * 1);
    expect(await read(make(100))).toBe(sound);
    // 800 of them are inside the bound and well over 5 minutes: 1,100 seconds.
    expect(await read(make(800))).toBe('too_long');
  });

  it('reads a fake header of the first frame’s own kind as the frame it claims to be, as a player does', async () => {
    // A fake 8 kHz 160 kbit/s header (1,440 bytes) whose span holds 19 real 8 kHz frames: FFmpeg and CoreAudio
    // both play each unit as the one frame it says, 72 ms.
    const real = Buffer.concat([Buffer.from([0xff, 0xe3, 0x18, 0x00]), Buffer.alloc(68)]);
    const unit = Buffer.concat([
      Buffer.from([0xff, 0xe3, 0xe8, 0x00]),
      Buffer.alloc(68),
      ...Array.from({ length: 19 }, () => real),
    ]);
    expect(unit.length).toBe(1440);
    const file = Buffer.concat([real, real, ...Array.from({ length: 100 }, () => unit)]);
    expect(await read(file)).toBe((2 + 100) * 72);
  });

  it('finds frames that straddle the blocks it looks through', async () => {
    // 65,000 bytes of tag, then four frames across the first block's end, then more tag.
    const frames = sampleMp3({ frames: 6 });
    const tag = Buffer.concat([Buffer.alloc(65_000), frames, Buffer.alloc(1000)]);
    const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
    header[8] = (tag.length >> 7) & 0x7f;
    header[7] = (tag.length >> 14) & 0x7f;
    header[9] = tag.length & 0x7f;
    expect(await read(Buffer.concat([header, tag, sampleMp3({ frames: 5 })]))).toBe('unreadable');
  });
});

describe('a header that lies about the length', () => {
  /** A frame of silence carrying a Xing (or Info) header that says it holds `claimed` frames: where the side information ends. */
  function withXing(tag: 'Xing' | 'Info', claimed: number): Buffer {
    const frame = Buffer.from(sampleMp3({ frames: 1 }));
    frame.write(tag, 36, 'latin1');
    frame.writeUInt32BE(1, 40); // flags: the frame count is given
    frame.writeUInt32BE(claimed, 44);
    return frame;
  }

  it('is never trusted: the sound’s own frames are counted, and a leading header is not sound', async () => {
    // A header claiming 10 frames over 11,600 frames of sound is over 5 minutes, whatever it claims.
    const rest = sampleMp3({ frames: 11_600 });
    expect(await read(Buffer.concat([withXing('Xing', 10), rest]))).toBe('too_long');
    expect(await read(Buffer.concat([withXing('Info', 0), rest]))).toBe('too_long');
    // One claiming a huge count over a short file is that short file's length, without its own frame.
    expect(
      await read(Buffer.concat([withXing('Xing', 4_000_000_000), sampleMp3({ frames: 9 })])),
    ).toBe(ms(9));
  });

  it('is not counted as sound when it leads (Xing, Info or VBRI), and a file of nothing else is refused', async () => {
    expect(await read(Buffer.concat([withXing('Info', 1), sampleMp3({ frames: 7 })]))).toBe(ms(7));
    const vbri = Buffer.from(sampleMp3({ frames: 1 }));
    vbri.write('VBRI', 36, 'latin1');
    expect(await read(Buffer.concat([vbri, sampleMp3({ frames: 7 })]))).toBe(ms(7));
    // Behind an ID3 tag too, and for MPEG-2 (its side information is shorter, so the tag sits earlier).
    const tagged = Buffer.concat([
      sampleMp3({ id3: 500, frames: 0 }),
      withXing('Xing', 1),
      sampleMp3({ frames: 5 }),
    ]);
    expect(await read(tagged)).toBe(ms(5));
    const mpeg2Info = mpeg2();
    mpeg2Info.write('Xing', 21, 'latin1');
    expect(await read(Buffer.concat([mpeg2Info, mpeg2(), mpeg2()]))).toBe(
      Math.ceil((2 * 576 * 1000) / 22_050),
    );
    // One frame of sound under a header is a file; a header alone is not.
    expect(await read(Buffer.concat([withXing('Xing', 1), sampleMp3({ frames: 1 })]))).toBe(ms(1));
    expect(await read(withXing('Xing', 1))).toBe('unreadable');
  });

  it('counts a second header, or one in the middle, as the frame it is: only a leading one is dropped', async () => {
    const twice = Buffer.concat([
      withXing('Xing', 1),
      withXing('Info', 1),
      sampleMp3({ frames: 8 }),
    ]);
    expect(await read(twice)).toBe(ms(9));
    const middle = Buffer.concat([
      sampleMp3({ frames: 5 }),
      withXing('Xing', 1),
      sampleMp3({ frames: 5 }),
    ]);
    expect(await read(middle)).toBe(ms(11));
  });
});

describe('the trailer', () => {
  it('is 128 bytes for an ID3v1 tag, and nothing else: an APE tag’s footer is not believed', () => {
    const v1 = Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125)]);
    expect(trailerLength(v1)).toBe(128);
    expect(trailerLength(Buffer.alloc(128))).toBe(0);
    expect(trailerLength(Buffer.from('TAG'))).toBe(0);
    const footer = Buffer.alloc(32);
    footer.write('APETAGEX', 0, 'latin1');
    footer.writeUInt32LE(100, 12);
    expect(trailerLength(footer)).toBe(0);
    expect(trailerLength(Buffer.concat([footer, Buffer.alloc(96)]))).toBe(0);
    expect(trailerLength(new Uint8Array(0))).toBe(0);
  });
});
