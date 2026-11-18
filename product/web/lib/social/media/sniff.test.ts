import { describe, expect, it } from 'vitest';
import { sampleJpeg, sampleMp3, sampleMp4, samplePng } from './samples.ts';
import { matchesDeclared, sniff } from './sniff.ts';

/** The real type of a file from its first bytes: each type, and the near misses that are none. */

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => [...text].map((letter) => letter.charCodeAt(0));

describe('the real type of a file', () => {
  it('is JPEG, PNG and WebP by their own first bytes', async () => {
    expect(sniff(await sampleJpeg({ width: 8, height: 8 }))).toBe('jpeg');
    expect(sniff(await samplePng({ width: 8, height: 8 }))).toBe('png');
    expect(sniff(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP'), 0))).toBe('webp');
  });

  it('is MP4 or M4A when `ftyp` follows a size of 8 to 4,096, and MP3 by an ID3 tag or a frame header', () => {
    expect(sniff(sampleMp4({ seconds: 1, width: 2, height: 2, tracks: ['video'] }))).toBe('mp4');
    expect(sniff(sampleMp3({ seconds: 1 }))).toBe('mp3');
    expect(sniff(sampleMp3({ seconds: 1, id3: 100 }))).toBe('mp3');
    expect(sniff(bytes(0, 0, 0, 8, ...ascii('ftyp'), 0, 0, 0, 0))).toBe('mp4');
    expect(sniff(bytes(0, 0, 0x10, 0, ...ascii('ftyp'), 0, 0, 0, 0))).toBe('mp4');
  });

  it('is nothing for the near misses: a box too small or too big, a wrong sync or version or layer, or a short head', () => {
    expect(sniff(bytes(0, 0, 0, 7, ...ascii('ftyp'), 0, 0, 0, 0))).toBeNull();
    expect(sniff(bytes(0, 0, 0x10, 1, ...ascii('ftyp'), 0, 0, 0, 0))).toBeNull();
    expect(sniff(bytes(0xff, 0xd8, 0xfe, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBeNull();
    expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b))).toBeNull();
    expect(sniff(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toBeNull();
    // No sync, the reserved version (01), layer II (10) and layer I (11) are not MP3 frames.
    expect(sniff(bytes(0xff, 0xdb, 0x90, 0))).toBeNull();
    expect(sniff(bytes(0xff, 0xeb, 0x90, 0))).toBeNull();
    expect(sniff(bytes(0xff, 0xfd, 0x90, 0))).toBeNull();
    expect(sniff(bytes(0xff, 0xff, 0x90, 0))).toBeNull();
    expect(sniff(bytes(0xff))).toBeNull();
    expect(sniff(new Uint8Array(0))).toBeNull();
    expect(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });

  it('must be the type the sender declared', async () => {
    const png = await samplePng({ width: 8, height: 8 });
    expect(matchesDeclared(png, 'image/png')).toBe(true);
    expect(matchesDeclared(png, 'image/jpeg')).toBe(false);
    expect(matchesDeclared(png, 'video/mp4')).toBe(false);
    const mp4 = sampleMp4({ seconds: 1, width: 2, height: 2, tracks: ['video'] });
    expect(matchesDeclared(mp4, 'video/mp4')).toBe(true);
    expect(matchesDeclared(mp4, 'audio/mp4')).toBe(true);
    expect(matchesDeclared(mp4, 'audio/mpeg')).toBe(false);
    expect(matchesDeclared(sampleMp3({ seconds: 1 }), 'audio/mpeg')).toBe(true);
    expect(matchesDeclared(png, 'text/html')).toBe(false);
  });
});
