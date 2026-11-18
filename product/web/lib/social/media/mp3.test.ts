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
    const trailer = trailerLength(
      file.subarray(Math.max(0, file.length - TAIL_BYTES)),
      file.length,
    );
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

  it('reads MPEG-2 frames (576 samples each) and mixes of versions', async () => {
    const frames = Buffer.concat(Array.from({ length: 50 }, mpeg2));
    expect(await read(frames)).toBe(Math.ceil((50 * 576 * 1000) / 22_050));
    const mixed = Buffer.concat([sampleMp3({ frames: 10 }), frames]);
    // Exact: 10 frames at 44.1 kHz and 50 at 22.05 kHz, added as fractions, then rounded up once.
    expect(await read(mixed)).toBe(
      Math.ceil((10 * 1152 * 1000) / 44_100 + (50 * 576 * 1000) / 22_050),
    );
  });

  it('skips the tags at the end: an ID3v1 tag, and an APE tag before it', async () => {
    const audio = sampleMp3({ frames: 20 });
    const v1 = Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125)]);
    expect(await read(Buffer.concat([audio, v1]))).toBe(ms(20));
    const footer = Buffer.alloc(32);
    footer.write('APETAGEX', 0, 'latin1');
    footer.writeUInt32LE(2000 + 32, 12);
    const ape = Buffer.concat([Buffer.alloc(2000, 0x41), footer]);
    expect(await read(Buffer.concat([audio, ape]))).toBe(ms(20));
    expect(await read(Buffer.concat([audio, ape, v1]))).toBe(ms(20));
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

  it('may be 5 minutes (299.99 s here) and not a frame more', async () => {
    expect(await read(sampleMp3({ frames: 11_484 }))).toBeLessThanOrEqual(300_000);
    expect(await read(sampleMp3({ frames: 11_485 }))).toBe('too_long');
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

describe('the trailer', () => {
  it('is 128 bytes for an ID3v1 tag, the APE tag’s size (and its header) before it, and nothing else', () => {
    const v1 = Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125)]);
    expect(trailerLength(v1, 500)).toBe(128);
    expect(trailerLength(Buffer.alloc(160), 500)).toBe(0);
    const footer = Buffer.alloc(32);
    footer.write('APETAGEX', 0, 'latin1');
    footer.writeUInt32LE(100, 12);
    expect(trailerLength(footer, 500)).toBe(100);
    footer.writeUInt32LE(0x8000_0000, 20);
    expect(trailerLength(footer, 500)).toBe(132);
    // A tag claiming more than the file, or less than a footer, is none.
    footer.writeUInt32LE(5000, 12);
    expect(trailerLength(footer, 500)).toBe(0);
    footer.writeUInt32LE(5, 12);
    expect(trailerLength(footer, 500)).toBe(0);
    expect(trailerLength(new Uint8Array(0), 0)).toBe(0);
  });
});
