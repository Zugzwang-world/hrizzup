import { describe, expect, it } from 'vitest';
import {
  contentTypeOf,
  fileRefusal,
  megabytes,
  sourcesOf,
  typedText,
  type UploadRules,
  uploadKey,
} from './console-upload.ts';

/**
 * What the console's post page does with a file in the browser (docs/social/media-design.md, section 9.2): the
 * type a file goes up as, whether it may go up at all, what a repeated Preview remembers an upload by, and the text
 * fields as typed. The rules are the contract's own, given here as the page is given them.
 */

const RULES: UploadRules = {
  types: {
    image: ['image/jpeg', 'image/png', 'image/webp'],
    video: ['video/mp4'],
    audio: ['audio/mp4', 'audio/mpeg'],
  },
  maxBytes: { image: 10_485_760, video: 104_857_600, audio: 20_971_520 },
};

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('the type a file goes up as', () => {
  it('is its own when it is one of the kind’s', () => {
    expect(contentTypeOf(file('a.png', 'image/png'), 'image', RULES)).toBe('image/png');
    expect(contentTypeOf(file('clip.mp4', 'video/mp4'), 'video', RULES)).toBe('video/mp4');
    expect(contentTypeOf(file('talk.m4a', 'audio/mp4'), 'audio', RULES)).toBe('audio/mp4');
  });

  it('is the one its ending names when the browser names it by its own words, or not at all', () => {
    // Browsers report an M4A as `audio/x-m4a` or nothing, and an MP3 as `audio/mp3`.
    expect(contentTypeOf(file('talk.M4A', 'audio/x-m4a'), 'audio', RULES)).toBe('audio/mp4');
    expect(contentTypeOf(file('song.mp3', 'audio/mp3'), 'audio', RULES)).toBe('audio/mpeg');
    expect(contentTypeOf(file('song.mp3', ''), 'audio', RULES)).toBe('audio/mpeg');
    expect(contentTypeOf(file('photo.jpeg', ''), 'image', RULES)).toBe('image/jpeg');
    expect(contentTypeOf(file('photo.JPG', 'application/octet-stream'), 'image', RULES)).toBe(
      'image/jpeg',
    );
  });

  it('is none for a type the kind does not take, whatever the ending says', () => {
    expect(contentTypeOf(file('a.gif', 'image/gif'), 'image', RULES)).toBeNull();
    expect(contentTypeOf(file('a.png', 'image/png'), 'video', RULES)).toBe(null);
    // An MP4 is a video, never audio (an audio file is an M4A or an MP3).
    expect(contentTypeOf(file('talk.mp4', 'video/mp4'), 'audio', RULES)).toBeNull();
    expect(contentTypeOf(file('noending', ''), 'image', RULES)).toBeNull();
    expect(contentTypeOf(file('.png', ''), 'video', RULES)).toBeNull();
  });
});

describe('whether a file may go up', () => {
  it('is yes for a file of the kind within its limit, at the limit exactly', () => {
    expect(fileRefusal(file('a.png', 'image/png', 1), 'image', RULES, 'The file')).toBeNull();
    expect(
      fileRefusal(file('a.png', 'image/png', RULES.maxBytes.image), 'image', RULES, 'The file'),
    ).toBeNull();
  });

  it('says nothing chosen, empty, the wrong type and too big, each in words that name the file', () => {
    expect(fileRefusal(null, 'image', RULES, 'The still image')).toBe(
      'The still image is needed: choose one.',
    );
    expect(fileRefusal(file('a.png', 'image/png', 0), 'image', RULES, 'The file')).toBe(
      'The file is empty: choose another.',
    );
    expect(fileRefusal(file('a.gif', 'image/gif'), 'image', RULES, 'The file')).toBe(
      'The file must be a JPEG, PNG or WebP picture: choose another.',
    );
    expect(fileRefusal(file('a.mov', 'video/quicktime'), 'video', RULES, 'The file')).toBe(
      'The file must be an MP4 video: choose another.',
    );
    expect(
      fileRefusal(file('a.png', 'image/png', RULES.maxBytes.image + 1), 'image', RULES, 'The file'),
    ).toBe('The file is too big: a picture is at most 10 MB.');
    expect(
      fileRefusal(
        file('a.mp3', 'audio/mpeg', RULES.maxBytes.audio + 1),
        'audio',
        RULES,
        'The file',
      ),
    ).toBe('The file is too big: an audio file is at most 20 MB.');
  });
});

describe('what an upload is remembered by', () => {
  const clip = { name: 'clip.mp4', size: 5000, lastModified: 1_700_000_000_000 };

  it('is the same for the same agent, kind, file and words, and differs when any of them does', () => {
    const base = uploadKey('agent-1', 'video', clip, {
      transcript: 'Words',
      stillMediaId: 'still-1',
    });
    expect(
      uploadKey('agent-1', 'video', { ...clip }, { transcript: 'Words', stillMediaId: 'still-1' }),
    ).toBe(base);
    for (const other of [
      uploadKey('agent-2', 'video', clip, { transcript: 'Words', stillMediaId: 'still-1' }),
      uploadKey('agent-1', 'audio', clip, { transcript: 'Words', stillMediaId: 'still-1' }),
      uploadKey(
        'agent-1',
        'video',
        { ...clip, size: 5001 },
        { transcript: 'Words', stillMediaId: 'still-1' },
      ),
      uploadKey(
        'agent-1',
        'video',
        { ...clip, lastModified: 1 },
        { transcript: 'Words', stillMediaId: 'still-1' },
      ),
      uploadKey(
        'agent-1',
        'video',
        { ...clip, name: 'other.mp4' },
        { transcript: 'Words', stillMediaId: 'still-1' },
      ),
      // A ready media's words never change: other words are another upload.
      uploadKey('agent-1', 'video', clip, { transcript: 'Other words', stillMediaId: 'still-1' }),
      uploadKey('agent-1', 'video', clip, { transcript: 'Words', stillMediaId: 'still-2' }),
      uploadKey('agent-1', 'video', clip, { transcript: 'Words' }),
    ]) {
      expect(other).not.toBe(base);
    }
  });

  it('tells a description from a transcript of the same words', () => {
    expect(uploadKey('a', 'image', clip, { description: 'Same' })).not.toBe(
      uploadKey('a', 'image', clip, { transcript: 'Same' }),
    );
  });
});

describe('the text fields', () => {
  it('are trimmed and have the newlines the agreement writes', () => {
    expect(typedText('  one\r\ntwo\rthree \n')).toBe('one\ntwo\nthree');
    expect(typedText(null)).toBe('');
    expect(typedText(undefined)).toBe('');
  });

  it('give the sources one to a line, blank lines and spaces left out', () => {
    expect(sourcesOf(' https://a.test/x \r\n\r\n  https://b.test/y\n')).toEqual([
      'https://a.test/x',
      'https://b.test/y',
    ]);
    expect(sourcesOf('')).toEqual([]);
  });

  it('say the limits in whole megabytes', () => {
    expect([10_485_760, 104_857_600, 20_971_520].map(megabytes)).toEqual([10, 100, 20]);
  });
});
