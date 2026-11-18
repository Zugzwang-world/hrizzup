import { describe, expect, it } from 'vitest';
import { type ByteSource, readMp4 } from './mp4.ts';
import { FileProblem } from './refusals.ts';
import { box, sampleM4a, sampleMp4 } from './samples.ts';

/**
 * The MP4 and M4A reader (docs/social/media-design.md, 7.5): every sample of 7.12, and what it must never do:
 * throw anything but a `FileProblem`, read without a bound, or hang.
 */

/** A source over a buffer that counts its reads and the most it was ever asked for at once. */
function sourceOf(file: Uint8Array) {
  const reads: [number, number][] = [];
  const source: ByteSource = {
    size: file.length,
    read: async (start, end) => {
      reads.push([start, end]);
      return file.subarray(start, end);
    },
  };
  return { source, reads };
}

const video = (options: Partial<Parameters<typeof sampleMp4>[0]> = {}) =>
  sampleMp4({ seconds: 3, width: 1080, height: 1920, tracks: ['video', 'audio'], ...options });

/** What reading a file comes to: its facts, or the code it is refused with. */
async function read(file: Uint8Array, type: 'video/mp4' | 'audio/mp4' = 'video/mp4') {
  try {
    return await readMp4(sourceOf(file).source, type);
  } catch (error) {
    if (error instanceof FileProblem) return error.code;
    throw error;
  }
}

describe('a video', () => {
  it('is measured: its length and its size', async () => {
    expect(await read(video())).toEqual({ durationMs: 3000, width: 1080, height: 1920 });
  });

  it('is read with moov at the end, as a phone writes it, and with a 64-bit media data size', async () => {
    expect(await read(video({ moovAtEnd: true }))).toMatchObject({ durationMs: 3000 });
    expect(await read(video({ largeSize: true }))).toMatchObject({ durationMs: 3000 });
    expect(await read(video({ moovAtEnd: true, largeSize: true }))).toMatchObject({
      durationMs: 3000,
    });
  });

  it('has its size swapped when the matrix turns it a quarter', async () => {
    expect(await read(video({ width: 1920, height: 1080, rotate: true }))).toMatchObject({
      width: 1080,
      height: 1920,
    });
  });

  it('keeps no size when the header says none (zero), and refuses one over 10,000 pixels a side', async () => {
    expect(await read(video({ width: 0, height: 0 }))).toEqual({
      durationMs: 3000,
      width: null,
      height: null,
    });
    expect(await read(video({ width: 10_000, height: 10_000 }))).toMatchObject({ width: 10_000 });
    expect(await read(video({ width: 10_001, height: 100 }))).toBe('dimensions');
    expect(await read(video({ width: 100, height: 10_001 }))).toBe('dimensions');
    expect(await read(video({ width: 10_001, height: 100, rotate: true }))).toBe('dimensions');
  });

  it('may be 60.0 seconds, with 40 ms of audio priming and half a second of slack in the movie header, and not a second more', async () => {
    expect(await read(video({ seconds: 60 }))).toMatchObject({ durationMs: 60_000 });
    expect(
      await read(video({ seconds: 60, tracks: ['video', { kind: 'audio', seconds: 60.04 }] })),
    ).toMatchObject({ durationMs: 60_000 });
    expect(await read(video({ seconds: 61 }))).toBe('too_long');
    // The movie header's slack is under a second: 60,499 is taken (and stored as 60,000), 60,501 is not.
    expect(await read(video({ seconds: 60.499 }))).toMatchObject({ durationMs: 60_000 });
    expect(await read(video({ seconds: 60.5 }))).toMatchObject({ durationMs: 60_000 });
    expect(await read(video({ seconds: 60.501 }))).toBe('too_long');
  });

  it('is refused when a header hides a longer file: the movie says 30 s, its samples 90', async () => {
    expect(await read(video({ seconds: 90, movieSeconds: 30 }))).toBe('too_long');
    expect(await read(video({ seconds: 3, movieSeconds: 90 }))).toBe('too_long');
  });

  it('is refused when it is fragmented, however many fragments it has (a real one passes 64 boxes)', async () => {
    expect(await read(video({ fragmented: true }))).toBe('fragmented');
    expect(await read(video({ fragmented: true, fragments: 40 }))).toBe('fragmented');
    expect(await read(video({ fragmented: true, fragments: 200 }))).toBe('fragmented');
    expect(await read(video({ fragmented: true, fragments: 200, moovAtEnd: true }))).toBe(
      'fragmented',
    );
  });

  it('needs a video track: sound alone declared video/mp4 is wrong_tracks', async () => {
    expect(await read(video({ tracks: ['audio'] }))).toBe('wrong_tracks');
    expect(await read(video({ tracks: [] }))).toBe('wrong_tracks');
  });
});

describe('an M4A', () => {
  it('is measured, with no size', async () => {
    expect(await read(sampleM4a({ seconds: 151 }), 'audio/mp4')).toEqual({
      durationMs: 151_000,
      width: null,
      height: null,
    });
  });

  it('may be 5 minutes and not more', async () => {
    expect(await read(sampleM4a({ seconds: 300 }), 'audio/mp4')).toMatchObject({
      durationMs: 300_000,
    });
    expect(await read(sampleM4a({ seconds: 301 }), 'audio/mp4')).toBe('too_long');
    // Real exports of exactly 5:00 write a little over it in the movie header (Apple's: 300,001.8 and 300,048.3 ms).
    expect(await read(sampleM4a({ seconds: 300.048 }), 'audio/mp4')).toMatchObject({
      durationMs: 300_000,
    });
    expect(await read(sampleM4a({ seconds: 300.499 }), 'audio/mp4')).toMatchObject({
      durationMs: 300_000,
    });
    expect(await read(sampleM4a({ seconds: 300.501 }), 'audio/mp4')).toBe('too_long');
  });

  it('is wrong_tracks with a video track, or with no sound', async () => {
    expect(await read(video(), 'audio/mp4')).toBe('wrong_tracks');
    expect(await read(video({ tracks: ['video'] }), 'audio/mp4')).toBe('wrong_tracks');
  });
});

describe('a file that is not a regular MP4', () => {
  const good = video();

  it('has exactly one moov', async () => {
    const ftyp = good.subarray(0, 24);
    const rest = good.subarray(24);
    expect(await read(ftyp)).toBe('unreadable');
    expect(await read(Buffer.concat([good, rest]))).toBe('unreadable');
  });

  it('is unreadable when cut anywhere, but at a box boundary: every truncation answers a refusal, never anything else', async () => {
    // Cut where the media data begins, the file is whole boxes (a movie with no data): its structure reads.
    const boundary = good.indexOf('mdat') - 4;
    for (let length = 0; length < good.length; length++) {
      const result = await read(good.subarray(0, length));
      if (length === boundary) expect(result, `${length}`).toMatchObject({ durationMs: 3000 });
      else expect(result, `${length}`).toBe('unreadable');
    }
  });

  it('is unreadable when a box is bigger than what holds it', async () => {
    const trak = box('trak', box('tkhd', Buffer.alloc(84)));
    trak.writeUInt32BE(trak.length + 100, 0);
    const file = Buffer.concat([
      box('ftyp', Buffer.from('isom'), Buffer.alloc(4)),
      box('moov', trak),
    ]);
    expect(await read(file)).toBe('unreadable');
    const top = Buffer.from(good);
    // The ftyp's size, claiming to run past the file.
    top.writeUInt32BE(top.length + 1, 0);
    expect(await read(top)).toBe('unreadable');
  });

  it('is unreadable when a box is smaller than its own header, or a 64-bit size does not fit', async () => {
    const tiny = Buffer.from(good);
    tiny.writeUInt32BE(4, 0);
    expect(await read(tiny)).toBe('unreadable');
    const huge = Buffer.concat([
      box('ftyp', Buffer.from('isom'), Buffer.alloc(4)),
      Buffer.from([0, 0, 0, 1, ...Buffer.from('mdat')]),
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    ]);
    expect(await read(huge)).toBe('unreadable');
  });

  it('is unreadable when a sample table claims more entries than it holds', async () => {
    const stts = box(
      'stts',
      Buffer.alloc(4),
      Buffer.from([0x7f, 0xff, 0xff, 0xff]),
      Buffer.alloc(8),
    );
    const file = Buffer.concat([
      box('ftyp', Buffer.from('isom'), Buffer.alloc(4)),
      box('moov', box('trak', box('mdia', box('minf', box('stbl', stts))))),
    ]);
    expect(await read(file)).toBe('unreadable');
  });

  it('is unreadable when boxes nest more than eight deep', async () => {
    let inner = box('free', Buffer.alloc(4));
    for (let depth = 0; depth < 12; depth++) inner = box('udta', inner);
    const file = Buffer.concat([
      box('ftyp', Buffer.from('isom'), Buffer.alloc(4)),
      box('moov', inner),
    ]);
    expect(await read(file)).toBe('unreadable');
  });

  it('is unreadable when moov holds more than 50,000 boxes', async () => {
    const leaf = box('free');
    const many = Buffer.concat(Array.from({ length: 50_001 }, () => leaf));
    const file = Buffer.concat([
      box('ftyp', Buffer.from('isom'), Buffer.alloc(4)),
      box('moov', many),
    ]);
    expect(await read(file)).toBe('unreadable');
  });

  it('is unreadable with more than 64 top-level boxes, and reads no more than that to find out', async () => {
    const boxes = Array.from({ length: 70 }, () => box('free', Buffer.alloc(100_000)));
    const file = Buffer.concat([box('ftyp', Buffer.from('isom'), Buffer.alloc(4)), ...boxes]);
    const { source, reads } = sourceOf(file);
    await expect(readMp4(source, 'video/mp4')).rejects.toMatchObject({ code: 'unreadable' });
    // The first 64 KiB, then one 16-byte header for each box past it.
    expect(reads.length).toBeLessThanOrEqual(65);
    for (const [start, end] of reads.slice(1)) expect(end - start).toBeLessThanOrEqual(16);
  });

  it('is unreadable when moov is over 16 MiB, without reading it', async () => {
    const head = Buffer.concat([box('ftyp', Buffer.from('isom'), Buffer.alloc(4))]);
    const size = 17 * 1024 * 1024;
    const claims = Buffer.alloc(8);
    claims.writeUInt32BE(size, 0);
    claims.write('moov', 4, 'latin1');
    // A file whose moov box claims 17 MiB and really is that long, backed by a source that has no such bytes.
    const length = head.length + size;
    const source: ByteSource = {
      size: length,
      read: async (start, end) => {
        if (end - start > 100_000) throw new Error('read the whole moov');
        return Buffer.concat([head, claims]).subarray(start, end);
      },
    };
    await expect(readMp4(source, 'video/mp4')).rejects.toMatchObject({ code: 'unreadable' });
  });

  describe('with the tables a player reads missing, or disagreeing', () => {
    // A player does not stop at a missing box: FFmpeg reads a track with no `mdhd` in the movie's timescale, and
    // repeats the last delta of `stts` for the samples `stsz` holds that it doesn't count. A file can say 30 seconds
    // to us and play 30 minutes. Each of these shapes is refused.
    const one = sampleMp4({ seconds: 30, width: 64, height: 64, tracks: ['video'] });
    const u32 = (value: number) => {
      const out = Buffer.alloc(4);
      out.writeUInt32BE(value);
      return out;
    };

    const startOf = (file: Buffer, type: string) => file.indexOf(type, 0, 'latin1') - 4;

    /** The file with its first `type` box changed by `patch` (in place, same size). */
    function patched(type: string, patch: (box: Buffer) => void, file = one): Buffer {
      const made = Buffer.from(file);
      const at = startOf(made, type);
      patch(made.subarray(at, at + made.readUInt32BE(at)));
      return made;
    }

    /** The file with a box put straight after its first `type` box, each parent's size grown to hold it. */
    function putAfter(type: string, parents: string[], added: Buffer, file = one): Buffer {
      const at = startOf(file, type);
      const end = at + file.readUInt32BE(at);
      const made = Buffer.concat([file.subarray(0, end), added, file.subarray(end)]);
      for (const parent of parents) {
        const where = startOf(made, parent);
        made.writeUInt32BE(made.readUInt32BE(where) + added.length, where);
      }
      return made;
    }

    /** The file with its first `type` box replaced by another, each parent's size changed to fit. */
    function swapped(type: string, parents: string[], replacement: Buffer): Buffer {
      const at = startOf(one, type);
      const end = at + one.readUInt32BE(at);
      const made = Buffer.concat([one.subarray(0, at), replacement, one.subarray(end)]);
      for (const parent of parents) {
        const where = startOf(made, parent);
        made.writeUInt32BE(made.readUInt32BE(where) + replacement.length - (end - at), where);
      }
      return made;
    }

    const stbl = ['moov', 'trak', 'mdia', 'minf', 'stbl'];

    it('is the sample as it is, and reads', async () => {
      expect(await read(one)).toMatchObject({ durationMs: 30_000 });
    });

    it('refuses a track with no mdhd (the player falls back to the movie’s timescale), hdlr, stts or sample sizes', async () => {
      for (const type of ['mdhd', 'hdlr', 'stts', 'stsz']) {
        // The box's type changed, so its bytes stay where they were and the track simply doesn't have it.
        expect(await read(patched(type, (box) => box.write('free', 4, 'latin1'))), type).toBe(
          'unreadable',
        );
      }
    });

    it('refuses a missing box in a second track, even when the first is whole', async () => {
      const two = sampleMp4({ seconds: 3, width: 8, height: 8, tracks: ['video', 'audio'] });
      const at = two.lastIndexOf('mdhd') - 4;
      const broken = Buffer.from(two);
      broken.write('free', at + 4, 'latin1');
      expect(await read(broken)).toBe('unreadable');
    });

    it('refuses sample tables that disagree: stts counting fewer samples than stsz holds (the last delta is repeated), or more', async () => {
      // stts: 30 samples of 1,000 (30 seconds); stsz: 1,800 samples. FFmpeg would play 1,800 seconds.
      const fewer = patched('stts', (box) => {
        box.writeUInt32BE(30, 16); // the count of the one entry
        box.writeUInt32BE(1000, 20); // its delta
      });
      const sizes = patched('stsz', (box) => box.writeUInt32BE(1800, 16), fewer);
      expect(await read(sizes)).toBe('unreadable');
      // The same shape the other way round: more samples told than sizes held.
      const more = patched(
        'stsz',
        (box) => box.writeUInt32BE(5, 16),
        patched('stts', (box) => box.writeUInt32BE(30, 16)),
      );
      expect(await read(more)).toBe('unreadable');
      // They agree: 30 and 30.
      const agree = patched(
        'stsz',
        (box) => box.writeUInt32BE(30, 16),
        patched('stts', (box) => {
          box.writeUInt32BE(30, 16);
          box.writeUInt32BE(1000, 20);
        }),
      );
      expect(await read(agree)).toMatchObject({ durationMs: 30_000 });
    });

    it('refuses a table of sample sizes that is shorter than its count says (a player reads fewer samples)', async () => {
      // No one size for every sample (0), and a count of 10 with no sizes after it.
      const short = patched('stsz', (box) => {
        box.writeUInt32BE(0, 12);
        box.writeUInt32BE(1, 16);
      });
      expect(await read(short)).toBe('unreadable');
    });

    it('reads a compact table (stz2), and refuses one beside an stsz, or of an odd width, or short', async () => {
      const stz2 = (count: number, width: number, table: Buffer) =>
        box('stz2', Buffer.alloc(4), Buffer.from([0, 0, 0, width]), u32(count), table);
      const compact = swapped('stsz', stbl, stz2(1, 16, Buffer.from([0, 9])));
      expect(await read(compact)).toMatchObject({ durationMs: 30_000 });
      expect(await read(swapped('stsz', stbl, stz2(1, 12, Buffer.from([0, 9]))))).toBe(
        'unreadable',
      );
      expect(await read(swapped('stsz', stbl, stz2(5, 16, Buffer.from([0, 9]))))).toBe(
        'unreadable',
      );
      expect(await read(swapped('stsz', stbl, stz2(2, 16, Buffer.from([0, 9, 0, 9]))))).toBe(
        'unreadable',
      );
      expect(await read(putAfter('stsz', stbl, stz2(1, 16, Buffer.from([0, 9]))))).toBe(
        'unreadable',
      );
    });

    it('refuses a box that decides a length where it does not belong: an stts in edts is the one FFmpeg reads', async () => {
      const long = box('stts', Buffer.alloc(4), u32(1), u32(1800), u32(1000));
      const inEdts = putAfter('tkhd', ['moov', 'trak'], box('edts', long));
      expect(await read(inEdts)).toBe('unreadable');
      const mdhd = box('mdhd', Buffer.alloc(4), u32(0), u32(0), u32(1000), u32(1_800_000), u32(0));
      expect(await read(putAfter('tkhd', ['moov', 'trak'], box('edts', mdhd)))).toBe('unreadable');
      expect(
        await read(putAfter('tkhd', ['moov', 'trak'], box('edts', box('stsz', Buffer.alloc(12))))),
      ).toBe('unreadable');
      expect(
        await read(putAfter('tkhd', ['moov', 'trak'], box('edts', box('mvhd', Buffer.alloc(100))))),
      ).toBe('unreadable');
      // An empty edts, and a hdlr in a udta (a real file has both), are not.
      expect(await read(putAfter('tkhd', ['moov', 'trak'], box('edts')))).toMatchObject({
        durationMs: 30_000,
      });
    });

    it('refuses an edit list that shows a track for longer than the kind allows, and reads one that matches the track', async () => {
      const elst = (...segments: [duration: number, mediaTime: number][]) =>
        box(
          'edts',
          box(
            'elst',
            Buffer.alloc(4),
            u32(segments.length),
            ...segments.map(([duration, mediaTime]) =>
              Buffer.concat([u32(duration), u32(mediaTime), u32(0x10000)]),
            ),
          ),
        );
      const parents = ['moov', 'trak'];
      // An empty edit (media time -1) of 30 minutes before the 30 seconds: the player waits it out.
      expect(
        await read(putAfter('tkhd', parents, elst([1_800_000, 0xffffffff], [30_000, 0]))),
      ).toBe('too_long');
      expect(await read(putAfter('tkhd', parents, elst([30_000, 0])))).toMatchObject({
        durationMs: 30_000,
      });
      // Several segments are added up.
      expect(
        await read(putAfter('tkhd', parents, elst([25_000, 0], [25_000, 0], [25_000, 0]))),
      ).toBe('too_long');
      expect(await read(putAfter('tkhd', parents, elst([25_000, 0], [25_000, 0])))).toMatchObject({
        durationMs: 30_000,
      });
      // A list that claims more entries than it holds, and a second one.
      const cut = putAfter('tkhd', parents, elst([30_000, 0]));
      cut.writeUInt32BE(9, startOf(cut, 'elst') + 12);
      expect(await read(cut)).toBe('unreadable');
    });

    it('takes a track whose own length is a second over the limit (padding) and stores the limit: 60 s, 61 s, and 300 s for sound', async () => {
      // The movie says 60 s; a track says 60.999 s: ready, 60,000 stored. 61.001 s is refused; so is a movie over 60 s.
      const video = (track: number, movie: number) =>
        sampleMp4({ seconds: track, movieSeconds: movie, width: 8, height: 8, tracks: ['video'] });
      expect(await read(video(60.999, 60))).toMatchObject({ durationMs: 60_000 });
      expect(await read(video(61, 60))).toMatchObject({ durationMs: 60_000 });
      expect(await read(video(61.001, 60))).toBe('too_long');
      expect(await read(video(60, 60))).toMatchObject({ durationMs: 60_000 });
      expect(await read(video(60.499, 60.499))).toMatchObject({ durationMs: 60_000 });
      expect(await read(video(60.501, 60.501))).toBe('too_long');
      // A track a second over passes with a movie within its half second; the movie alone decides what is stored.
      expect(await read(video(60.999, 60.499))).toMatchObject({ durationMs: 60_000 });
      const sound = (track: number, movie: number) =>
        sampleM4a({ seconds: track, movieSeconds: movie });
      expect(await read(sound(300.999, 300), 'audio/mp4')).toMatchObject({ durationMs: 300_000 });
      expect(await read(sound(301.001, 300), 'audio/mp4')).toBe('too_long');
      expect(await read(sound(300, 300), 'audio/mp4')).toMatchObject({ durationMs: 300_000 });
      expect(await read(sound(300.499, 300.499), 'audio/mp4')).toMatchObject({
        durationMs: 300_000,
      });
      expect(await read(sound(300.501, 300.501), 'audio/mp4')).toBe('too_long');
    });

    it('refuses a handler of video or sound anywhere but a track’s mdia, and takes the other handlers a real file has elsewhere', async () => {
      const hdlr = (type: string) =>
        box(
          'hdlr',
          Buffer.alloc(4),
          Buffer.alloc(4),
          Buffer.from(type, 'latin1'),
          Buffer.alloc(13),
        );
      const parents = ['moov', 'trak'];
      // In the track itself, its edts or its minf, or beside the tracks in a udta: a player may take it as the track's.
      expect(await read(putAfter('tkhd', parents, hdlr('vide')))).toBe('unreadable');
      expect(await read(putAfter('tkhd', parents, hdlr('soun')))).toBe('unreadable');
      expect(await read(putAfter('tkhd', parents, box('edts', hdlr('vide'))))).toBe('unreadable');
      const inMinf = ['moov', 'trak', 'mdia', 'minf'];
      expect(await read(putAfter('stbl', inMinf, hdlr('soun')))).toBe('unreadable');
      expect(await read(putAfter('mvhd', ['moov'], box('udta', hdlr('vide'))))).toBe('unreadable');
      // What a real file has: `mdir` in a `meta` (full box), `alis` and `url ` in a `minf`, beside the track's own.
      const meta = box('meta', Buffer.alloc(4), hdlr('mdir'));
      expect(await read(putAfter('mvhd', ['moov'], box('udta', meta)))).toMatchObject({
        durationMs: 30_000,
      });
      for (const kind of ['alis', 'url ', 'dhlr']) {
        expect(await read(putAfter('stbl', inMinf, hdlr(kind))), kind).toMatchObject({
          durationMs: 30_000,
        });
      }
    });
  });

  describe('with a box twice that a parent may hold once', () => {
    // A second `mdhd` that says 1 second beside the real one that says 3: a reader that keeps the last box reads
    // 1 second and a player that reads the first reads 3. Neither is trusted: the file is refused.
    const one = sampleMp4({ seconds: 3, width: 1080, height: 1920, tracks: ['video'] });

    /** Where a box of this type begins: the first one in the file. */
    const startOf = (file: Buffer, type: string) => file.indexOf(type, 0, 'latin1') - 4;

    /**
     * The file with a copy of its first `type` box put straight after it (changed by `patch`), and each parent's size
     * grown to hold it.
     */
    function twice(
      type: string,
      parents: string[],
      patch: (copy: Buffer) => void = () => undefined,
    ): Buffer {
      const at = startOf(one, type);
      const end = at + one.readUInt32BE(at);
      const copy = Buffer.from(one.subarray(at, end));
      patch(copy);
      const made = Buffer.concat([one.subarray(0, end), copy, one.subarray(end)]);
      for (const parent of parents) {
        const where = startOf(made, parent);
        made.writeUInt32BE(made.readUInt32BE(where) + copy.length, where);
      }
      return made;
    }

    it('is the sample as it is, and reads', async () => {
      expect(await read(one)).toMatchObject({ durationMs: 3000, width: 1080, height: 1920 });
    });

    it('refuses a second mdhd that claims a shorter length', async () => {
      // Version 0: the duration is the fourth 32-bit word of its payload, after its 8-byte box header.
      const file = twice('mdhd', ['moov', 'trak', 'mdia'], (copy) =>
        copy.writeUInt32BE(1000, 8 + 16),
      );
      expect(await read(file)).toBe('unreadable');
    });

    it('refuses a second mvhd', async () => {
      const file = twice('mvhd', ['moov'], (copy) => copy.writeUInt32BE(1000, 8 + 16));
      expect(await read(file)).toBe('unreadable');
    });

    it('refuses a second stts', async () => {
      const file = twice('stts', ['moov', 'trak', 'mdia', 'minf', 'stbl'], (copy) =>
        copy.writeUInt32BE(1, 8 + 12),
      );
      expect(await read(file)).toBe('unreadable');
    });

    it('refuses a second tkhd that gives another size', async () => {
      const file = twice('tkhd', ['moov', 'trak'], (copy) =>
        copy.writeUInt32BE(100 * 0x10000, 8 + 76),
      );
      expect(await read(file)).toBe('unreadable');
    });

    it('refuses a second hdlr, and a second mdia, minf or stbl', async () => {
      expect(await read(twice('hdlr', ['moov', 'trak', 'mdia']))).toBe('unreadable');
      expect(await read(twice('mdia', ['moov', 'trak']))).toBe('unreadable');
      expect(await read(twice('minf', ['moov', 'trak', 'mdia']))).toBe('unreadable');
      expect(await read(twice('stbl', ['moov', 'trak', 'mdia', 'minf']))).toBe('unreadable');
    });

    it('refuses a second mvex, and still reads a file with one, or with several tracks that each hold their own boxes once', async () => {
      const mvex = box('mvex', box('trex', Buffer.alloc(24)));
      const withMvex = (count: number) => {
        const at = startOf(one, 'moov');
        const end = at + one.readUInt32BE(at);
        const added = Buffer.concat(Array.from({ length: count }, () => mvex));
        const made = Buffer.concat([one.subarray(0, end), added, one.subarray(end)]);
        made.writeUInt32BE(end - at + added.length, at);
        return made;
      };
      // An `mvex` beside a movie that has a length is no fragmenting: it is read.
      expect(await read(withMvex(1))).toMatchObject({ durationMs: 3000 });
      expect(await read(withMvex(2))).toBe('unreadable');
      expect(await read(video({ tracks: ['video', 'audio', 'audio'] }))).toMatchObject({
        durationMs: 3000,
      });
    });
  });

  it('tolerates the four zero bytes that end a QuickTime udta, and no other bytes left over', async () => {
    const plain = sampleMp4({ seconds: 3, width: 8, height: 8, tracks: ['video'] });
    const at = plain.indexOf('moov') - 4;
    const end = at + plain.readUInt32BE(at);
    const udta = box('udta', box('free', Buffer.alloc(4)), Buffer.alloc(4));
    // The same file with the udta inside its moov, which is a little bigger for it.
    const inside = Buffer.concat([plain.subarray(0, end), udta, plain.subarray(end)]);
    inside.writeUInt32BE(end - at + udta.length, at);
    expect(await read(inside)).toMatchObject({ durationMs: 3000 });
    // A leftover that is not zero is not tolerated.
    const dirty = Buffer.from(inside);
    dirty[end + udta.length - 1] = 7;
    expect(await read(dirty)).toBe('unreadable');
  });

  it('answers only a refusal for any file that has been flipped about at random, and never hangs', async () => {
    let state = 0x2545f491;
    const next = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    for (let round = 0; round < 400; round++) {
      const file = Buffer.from(
        round % 2 === 0 ? good : video({ moovAtEnd: true, largeSize: true }),
      );
      for (let flips = 1 + (round % 4); flips > 0; flips--) {
        file[next() % file.length] = next() & 0xff;
      }
      const result = await read(file);
      expect(
        typeof result === 'string' || typeof result.durationMs === 'number',
        `round ${round}`,
      ).toBe(true);
      if (typeof result !== 'string') {
        expect(result.durationMs).toBeGreaterThanOrEqual(1);
        expect(result.durationMs).toBeLessThanOrEqual(61_000);
      }
    }
  });
});
