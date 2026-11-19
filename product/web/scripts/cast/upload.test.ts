import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { social } from '@hrizzup/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fakeUploadUrl,
  type Harness,
  harness,
  idOf,
  inputProblems,
  json,
  seedMember,
  seedSet,
} from './harness.ts';
import { readLog } from './log.ts';
import { main } from './main.ts';
import { LIMITS, sniffFile, uploadCommand } from './upload.ts';

/** `upload` (rule 16): the type from the first bytes, the limits, the link, the file and the done call. */

const bytesOf = (...parts: Array<number[] | string>) =>
  Buffer.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );
const pad = (head: Buffer, size = 64) =>
  Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 1)]);

const PNG = pad(bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const JPEG = pad(bytesOf([0xff, 0xd8, 0xff, 0xe0]));
const WEBP = pad(bytesOf('RIFF', [0, 0, 0, 0], 'WEBP'));
const MP4 = pad(bytesOf([0, 0, 0, 0x20], 'ftyp', 'isom'));
const M4A = pad(bytesOf([0, 0, 0, 0x20], 'ftyp', 'M4A '));
const MP3_ID3 = pad(bytesOf('ID3', [4, 0]));
const MP3_FRAME = pad(bytesOf([0xff, 0xfb, 0x90, 0x00]));

describe('sniffFile()', () => {
  it.each([
    ['a JPEG', JPEG, 'image', 'image/jpeg'],
    ['a PNG', PNG, 'image', 'image/png'],
    ['a WebP', WEBP, 'image', 'image/webp'],
    ['an MP4', MP4, 'video', 'video/mp4'],
    ['an M4A', M4A, 'audio', 'audio/mp4'],
    ['an MP3 with an ID3 tag', MP3_ID3, 'audio', 'audio/mpeg'],
    ['an MP3 frame', MP3_FRAME, 'audio', 'audio/mpeg'],
  ])('knows %s from its first bytes', (_what, head, kind, contentType) => {
    expect(sniffFile(head.subarray(0, 16))).toEqual({ kind, contentType });
  });

  it.each([
    ['text', bytesOf('hello, this is not media')],
    ['a GIF', bytesOf('GIF89a', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
    ['a RIFF that is not WebP', bytesOf('RIFF', [0, 0, 0, 0], 'WAVE', [0, 0, 0, 0])],
    ['nothing much', bytesOf([1, 2, 3])],
  ])('knows %s is none', (_what, head) => {
    expect(sniffFile(head)).toBeNull();
  });

  it("holds the limits the API's contract holds", () => {
    expect(LIMITS).toEqual({
      image: social.mediaLimits.image.maxBytes,
      video: social.mediaLimits.video.maxBytes,
      audio: social.mediaLimits.audio.maxBytes,
    });
  });
});

describe('upload', () => {
  let h: Harness;
  let member: { handle: string; key: string };
  /** Which request IDs the fake has seen, and what each made. */
  let links: Map<string, string>;
  let counter: number;
  let linkFor: () => { url: string; headers?: Record<string, string>; expiresAt?: string };
  let doneStatus: Array<{ status: number; reason?: string }>;

  beforeEach(() => {
    h = harness();
    member = seedMember(h, 'meme-maker');
    seedSet(h, [idOf(10)], { run: 1 });
    links = new Map();
    counter = 1;
    doneStatus = [];
    linkFor = () => ({ url: fakeUploadUrl() });
    h.server.on('POST', '/api/v1/social/me/uploads', (req) => {
      const problem = inputProblems(social.uploadInput, req.body);
      if (problem) return json(400, { code: 'BAD_REQUEST', message: problem });
      const body = req.body as {
        requestId: string;
        kind: string;
        contentType: string;
        bytes: number;
      };
      let id = links.get(body.requestId);
      if (!id) {
        id = idOf(900 + counter++);
        links.set(body.requestId, id);
      }
      const link = linkFor();
      return json(201, {
        media: { id, kind: body.kind, state: 'waiting' },
        uploadUrl: link.url,
        headers: link.headers ?? {
          'Content-Type': body.contentType,
          'Content-Length': String(body.bytes),
        },
        expiresAt: link.expiresAt ?? new Date(h.clock.now() + 600_000).toISOString(),
      });
    });
    h.server.on('POST', /^\/api\/v1\/social\/me\/uploads\/([0-9a-f-]{36})\/done$/, (req, match) => {
      const problem = inputProblems(social.uploadDoneInput, { id: match[1], ...req.body });
      if (problem) return json(400, { code: 'BAD_REQUEST', message: problem });
      const planned = doneStatus.shift();
      if (planned && planned.status !== 200) {
        return {
          status: planned.status,
          body: { code: 'REFUSED', data: { reason: planned.reason } },
        };
      }
      return json(200, { id: match[1], kind: 'image', url: 'https://media.example/x' });
    });
  });
  afterEach(() => h.cleanup());

  /** A file in `work/`, written as bytes (the store writes only text). */
  function put(name: string, bytes: Buffer): void {
    const folder = join(h.home, 'work');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o700);
    writeFileSync(join(folder, name), bytes, { mode: 0o600 });
  }
  const text = (name: string, content: string) => h.store.writeText(`work/${name}`, content);
  const upload = (...argv: string[]) => main(['upload', 'meme-maker', ...argv], h.io, () => h.ctx);

  it('asks for the link, sends the file to it, says it is done, and prints the media id alone', async () => {
    put('meme.png', PNG);
    text('meme.txt', 'A meme: two cats, and the words "the update lands"\n');
    expect(await upload('meme.png', '--description', 'meme.txt')).toBe(0);
    expect(h.printed()).toBe(`${idOf(901)}\n`);

    const [ask] = h.server.to('POST', /me\/uploads$/);
    expect(ask?.headers.authorization).toBe(`Bearer ${member.key}`);
    expect(ask?.body).toMatchObject({ kind: 'image', contentType: 'image/png', bytes: PNG.length });
    expect(h.server.puts).toHaveLength(1);
    const [sent] = h.server.puts;
    expect(sent?.bytes).toBe(PNG.length);
    expect(Object.keys(sent?.headers ?? {}).sort()).toEqual(['content-length', 'content-type']);
    expect(sent?.headers['content-type']).toBe('image/png');
    expect(sent?.url).toBe(fakeUploadUrl());

    const [done] = h.server.to('POST', /uploads\/[0-9a-f-]{36}\/done$/);
    expect(done?.path).toContain(idOf(901));
    expect(done?.body).toMatchObject({
      description: 'A meme: two cats, and the words "the update lands"',
    });
    expect(done?.body).not.toHaveProperty('transcript');

    const [entry] = readLog(h.store, 1);
    expect(entry).toMatchObject({
      type: 'upload',
      member: 'meme-maker',
      mediaId: idOf(901),
      kind: 'image',
      fileSha256: createHash('sha256').update(PNG).digest('hex'),
    });
    expect(h.store.readText('log/run-1.jsonl')).not.toContain('A meme');
    // The link is never printed or logged.
    expect(h.store.readText('log/run-1.jsonl')).not.toContain('X-Amz');
  });

  it("takes a file in a folder of work/ (the kits' run folders) by its relative name, from wherever pnpm ran", async () => {
    mkdirSync(join(h.home, 'work', 'run-1'), { recursive: true, mode: 0o700 });
    writeFileSync(join(h.home, 'work', 'run-1', 'meme.png'), PNG, { mode: 0o600 });
    text('meme.txt', 'A description');
    h.ctx.cwd = '/somewhere/pnpm/ran';
    expect(await upload('run-1/meme.png', '--description', 'meme.txt')).toBe(0);
    expect(h.server.puts).toHaveLength(1);
    expect(await upload('../meme.png', '--description', 'meme.txt')).toBe(2);
    expect(await upload('/etc/hosts', '--description', 'meme.txt')).toBe(2);
  });

  it('sends a video with its transcript and its still, and an audio the same', async () => {
    put('brief.mp4', MP4);
    text('words.txt', 'Every word spoken in the video.');
    const still = idOf(950);
    expect(await upload('brief.mp4', '--transcript', 'words.txt', '--still', still)).toBe(0);
    const [ask] = h.server.to('POST', /me\/uploads$/);
    expect(ask?.body).toMatchObject({ kind: 'video', contentType: 'video/mp4' });
    const [done] = h.server.to('POST', /done$/);
    expect(done?.body).toMatchObject({
      transcript: 'Every word spoken in the video.',
      stillMediaId: still,
    });
    expect(done?.body).not.toHaveProperty('description');

    put('brief.m4a', M4A);
    h.server.requests.length = 0;
    expect(await upload('brief.m4a', '--transcript', 'words.txt', '--still', still)).toBe(0);
    expect(h.server.to('POST', /me\/uploads$/)[0]?.body).toMatchObject({
      kind: 'audio',
      contentType: 'audio/mp4',
    });
    put('brief.mp3', MP3_ID3);
    h.server.requests.length = 0;
    expect(await upload('brief.mp3', '--transcript', 'words.txt', '--still', still)).toBe(0);
    expect(h.server.to('POST', /me\/uploads$/)[0]?.body).toMatchObject({
      kind: 'audio',
      contentType: 'audio/mpeg',
    });
  });

  it('refuses what is wrong before asking for any link', async () => {
    put('meme.png', PNG);
    put('brief.mp4', MP4);
    put('junk.bin', bytesOf('not media at all, just words'));
    text('meme.txt', 'A description');
    text('words.txt', 'A transcript');
    text('empty.txt', '  \n');
    h.store.writeText('stories/meme.png', 'x');
    const still = idOf(950);
    const cases: string[][] = [
      ['meme.png'],
      ['meme.png', '--description', 'empty.txt'],
      ['meme.png', '--description', 'missing.txt'],
      ['meme.png', '--description', 'meme.txt', '--transcript', 'words.txt'],
      ['meme.png', '--description', 'meme.txt', '--still', still],
      ['brief.mp4', '--description', 'meme.txt'],
      ['brief.mp4', '--transcript', 'words.txt'],
      ['brief.mp4', '--transcript', 'words.txt', '--still', 'not-an-id'],
      ['brief.mp4', '--still', still],
      ['junk.bin', '--description', 'meme.txt'],
      ['missing.png', '--description', 'meme.txt'],
      [`${h.home}/stories/meme.png`, '--description', 'meme.txt'],
      ['../meme.png', '--description', 'meme.txt'],
    ];
    for (const argv of cases) expect(await upload(...argv), argv.join(' ')).toBe(2);
    expect(h.server.requests).toEqual([]);
  });

  it("refuses a file over its kind's limit", async () => {
    put('meme.png', pad(PNG, 200));
    text('meme.txt', 'A description');
    const was = LIMITS.image;
    LIMITS.image = 100;
    try {
      expect(await upload('meme.png', '--description', 'meme.txt')).toBe(2);
      expect(h.printed()).toContain('at most 100 bytes');
    } finally {
      LIMITS.image = was;
    }
    expect(h.server.requests).toEqual([]);
  });

  it('needs an open run, and a member that has been made', async () => {
    put('meme.png', PNG);
    text('meme.txt', 'A description');
    h.store.writeJson('state.json', { current: null, runs: [] });
    expect(await upload('meme.png', '--description', 'meme.txt')).toBe(2);
    expect(h.printed()).toContain('No run is open');
    expect(
      await main(['upload', 'analyst', 'meme.png', '--description', 'meme.txt'], h.io, () => h.ctx),
    ).toBe(2);
    expect(h.server.requests).toEqual([]);
  });

  describe("a link that is not staging's uploads bucket", () => {
    it.each([
      ['the production bucket', () => ({ url: fakeUploadUrl('hrizzup-uploads') })],
      [
        'another host',
        () => ({ url: fakeUploadUrl('hrizzup-staging-uploads', 'evil.example.com') }),
      ],
      ['http', () => ({ url: fakeUploadUrl().replace('https:', 'http:') })],
      [
        'a credential header',
        () => ({
          url: fakeUploadUrl(),
          headers: { 'Content-Type': 'image/png', Authorization: 'Bearer x' },
        }),
      ],
    ])('is refused, with %s, and no byte is sent', async (_what, link) => {
      linkFor = link;
      put('meme.png', PNG);
      text('meme.txt', 'A description');
      expect(await upload('meme.png', '--description', 'meme.txt')).toBe(2);
      expect(h.server.puts).toEqual([]);
      expect(h.printed()).not.toContain('X-Amz');
    });
  });

  describe('a replay that is dead', () => {
    const setUp = () => {
      put('meme.png', PNG);
      text('meme.txt', 'A description');
    };
    const asked = () => h.server.to('POST', /me\/uploads$/).map((req) => req.body?.requestId);

    it('takes the next attempt when the link has run out, with a new request ID', async () => {
      setUp();
      let calls = 0;
      linkFor = () =>
        ++calls === 1
          ? { url: fakeUploadUrl(), expiresAt: new Date(h.clock.now() - 1000).toISOString() }
          : { url: fakeUploadUrl() };
      expect(await upload('meme.png', '--description', 'meme.txt')).toBe(0);
      const ids = asked();
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
      expect(h.server.puts).toHaveLength(1);
    });

    it('takes the next attempt when the bucket refuses the link (403)', async () => {
      setUp();
      let puts = 0;
      h.server.onPut = () => {
        h.server.putStatus = ++puts === 1 ? 403 : 200;
      };
      h.server.putStatus = 403;
      expect(await upload('meme.png', '--description', 'meme.txt')).toBe(0);
      expect(asked()).toHaveLength(2);
      expect(h.server.puts).toHaveLength(2);
    });

    it('takes the next attempt when an upload was refused (media_refused), and stops after three', async () => {
      setUp();
      doneStatus = [
        { status: 422, reason: 'media_refused' },
        { status: 422, reason: 'media_refused' },
      ];
      expect(await upload('meme.png', '--description', 'meme.txt')).toBe(0);
      expect(new Set(asked()).size).toBe(3);

      doneStatus = Array.from({ length: 5 }, () => ({ status: 422, reason: 'media_refused' }));
      h.server.requests.length = 0;
      h.writes.length = 0;
      // The same three attempts again: the same request IDs as before, so a rerun reaches the same uploads.
      expect(await upload('meme.png', '--description', 'meme.txt')).toBe(2);
      expect(asked()).toHaveLength(3);
      expect(h.printed()).toContain('did not become ready in 3 attempts');
    });

    it('sends the same request IDs when run again, so it reaches the same upload', async () => {
      setUp();
      await upload('meme.png', '--description', 'meme.txt');
      const firstIds = asked();
      h.server.requests.length = 0;
      await upload('meme.png', '--description', 'meme.txt');
      expect(asked()).toEqual(firstIds);
    });
  });

  it("exits 4 at the day's uploads, and 3 when the bucket never answers, without printing the link", async () => {
    put('meme.png', PNG);
    text('meme.txt', 'A description');
    h.server.on('POST', '/api/v1/social/me/uploads', () => ({
      status: 429,
      body: {
        code: 'TOO_MANY_REQUESTS',
        data: { reason: 'uploads_per_day', retryAfterSeconds: 7200 },
      },
      headers: { 'retry-after': '7200' },
    }));
    expect(await upload('meme.png', '--description', 'meme.txt')).toBe(4);
    expect(h.printed()).toContain('wait 7200 seconds');
  });

  it('retries a PUT that got no answer, then exits 3 naming no address', async () => {
    put('meme.png', PNG);
    text('meme.txt', 'A description');
    h.ctx.fetch = async (input, init) => {
      if (String(input).includes('r2.cloudflarestorage.com'))
        throw new TypeError(`fetch failed ${String(input)}`);
      return h.server.fetch(input, init);
    };
    expect(await upload('meme.png', '--description', 'meme.txt')).toBe(3);
    expect(h.printed()).toContain('PUT upload link got no answer');
    expect(h.printed()).not.toContain('r2.cloudflarestorage');
    expect(
      h.clock.sleeps.filter((ms) => ms === 2_000 || ms === 8_000 || ms === 30_000),
    ).toHaveLength(3);
  });

  it('is exported for direct use', () => {
    expect(typeof uploadCommand).toBe('function');
  });
});
