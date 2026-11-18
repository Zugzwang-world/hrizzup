import { randomBytes, randomUUID } from 'node:crypto';
import { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { transaction } from '@hrizzup/db';
import { createRouterClient } from '@orpc/server';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashKey, makeKeyText } from '@/lib/api/keys.ts';
import { newRecordId } from '@/lib/record-id.ts';
import { resetSocialCache } from '@/lib/social/cache.ts';
import { localDatabaseOrThrow } from '@/lib/social/local-database.ts';
import { type MemoryStorage, memoryStorage } from '@/lib/social/media/memory-storage.ts';
import { sampleJpeg, sampleMp4, samplePng } from '@/lib/social/media/samples.ts';

/**
 * Saying an upload is done, against a real database (docs/social/media-design.md, 11.3; section 7.4): the real
 * router, handlers, mappers and output checks over the real functions of migrations/*_social_media.sql, with
 * both buckets in memory. What `media.test.ts`'s stand-in can only assume is proven: that the two short
 * transactions fit the functions' own lease (a second `done` while a check runs is 409, a released check may be
 * tried again), that what `finish` writes is what `_media` reads back into the contract's `Media`, that a post
 * with media answers its card, that a story's picture is a video's still, and that the format guide's example
 * is what the database answers.
 *
 * Every ID, handle and email is this run's own, so a database that holds the last run's rows (a local one is
 * not rebuilt between runs) changes nothing. Run it on this Mac, on the slot's database:
 *
 *   SOCIAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$(infra/slots/slot env | sed -n 's/^export SUPABASE_DB_PORT=//p')/postgres" \
 *     pnpm --filter @hrizzup/web exec vitest run lib/api/social/media.db.test.ts
 *
 * Without `SOCIAL_DATABASE_URL` the file does not run: Quick checks have no database.
 */

const url = process.env.SOCIAL_DATABASE_URL;

const held = vi.hoisted(() => ({
  pool: null as import('pg').Pool | null,
  storage: null as unknown,
}));
const background: Promise<unknown>[] = [];
vi.mock('@/lib/db.ts', () => ({ database: () => held.pool }));
vi.mock('@/lib/social/media/storage.ts', async (original) => ({
  ...(await original<typeof import('@/lib/social/media/storage.ts')>()),
  mediaStorage: () => held.storage,
}));
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  waitUntil: (promise: Promise<unknown>) => {
    background.push(promise);
  },
}));

const { router } = await import('../router.ts');

const MEDIA_HOST = 'https://media.example.test';
let owner: pg.Pool;
let app: pg.Pool;
let storage: MemoryStorage;

const letters = (n: number) =>
  Array.from(randomBytes(n), (b) => 'abcdefghijklmnopqrstuvwxyz'[b % 26]).join('');
const iso = (agoMinutes: number) => new Date(Date.now() - agoMinutes * 60_000).toISOString();

/** What the run seeded. */
const seeded = { story: '', handle: '', keyText: '', agentId: '' };

function api(headers: Record<string, string> = {}) {
  const resHeaders = new Headers();
  const called = createRouterClient(router, {
    context: {
      headers: new Headers(headers),
      resHeaders,
      url: 'https://staging.hrizzup.com/api/v1/social/me/uploads',
    },
  });
  return { api: called, resHeaders };
}
/** The agent's own calls. */
const asAgent = () => api({ authorization: `Bearer ${seeded.keyText}` });

type Tx = Parameters<Parameters<typeof transaction>[1]>[0];
const asApp = <T>(
  work: (tx: Tx) => Promise<T>,
  options: { account?: string; apiKey?: string } = {},
) =>
  transaction(app, work, {
    account: options.account ?? null,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
  });

/** One row of `social.media`, read as the owner. */
async function rowOf(id: string) {
  const { rows } = await owner.query(
    'select state, kind, refused_reason, check_token, check_until, media_key, upload_key, width, height, duration_ms, placeholder, description, transcript, still_media_id, checked_at, upload_expires_at from social.media where id = $1',
    [id],
  );
  return rows[0] as {
    state: string;
    kind: string;
    refused_reason: string | null;
    check_token: string | null;
    check_until: Date | null;
    media_key: string | null;
    upload_key: string;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
    placeholder: string | null;
    description: string | null;
    transcript: string | null;
    still_media_id: string | null;
    checked_at: Date | null;
    upload_expires_at: Date;
  };
}

/** Asks for a link, then puts the file at the upload's key as the agent's PUT would. Answers the media's ID. */
async function uploaded(
  file: Uint8Array,
  kind: 'image' | 'video' | 'audio',
  contentType: social.UploadInput['contentType'],
  put = true,
): Promise<string> {
  const { api: called } = asAgent();
  const link = await called.social.me.upload({
    requestId: randomUUID(),
    kind,
    contentType,
    bytes: file.length,
  });
  expect(social.upload.parse(link)).toEqual(link);
  expect(link.media.state).toBe('waiting');
  if (put) storage.put((await rowOf(link.media.id)).upload_key, file, contentType);
  return link.media.id;
}

/** Waits for the background deletions the handlers started. */
async function settled() {
  await Promise.all(background.splice(0));
}

beforeAll(async () => {
  if (!url) return;
  localDatabaseOrThrow(url);
  owner = new pg.Pool({ connectionString: url, max: 2 });
  app = new pg.Pool({ connectionString: url, max: 6 });
  owner.on('error', () => {});
  app.on('error', () => {});
  held.pool = app;
  storage = memoryStorage();
  held.storage = storage;
  resetSocialCache(null);
  vi.stubEnv('MEDIA_BASE_URL', MEDIA_HOST);

  const run = randomUUID().slice(0, 8);
  const admin = randomUUID();
  const ownerAccount = randomUUID();
  const email = `media-${run}@social-media.test`;
  await owner.query(
    'insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now())',
    [admin, `admin-${run}@social-media.test`, ownerAccount, email],
  );
  await owner.query("insert into private.admins (user_id, note) values ($1, 'A test admin')", [
    admin,
  ]);

  // An unlisted-by-default story is enough for a desk, but its picture shows only on a live one: list it.
  seeded.story = newRecordId();
  await owner.query('select intake.save_story($1::jsonb)', [
    JSON.stringify({
      format: 'story/1',
      id: seeded.story,
      title: `Media test ${run}: a story`,
      summary: 'What is happening, for the media test.',
      locations: ['mumbai'],
      categories: ['general'],
      state: 'live',
      created_at: iso(30),
      updated_at: iso(29),
    }),
  ]);
  await owner.query("select social._list_story($1, true, 'console', null)", [seeded.story]);
  const update = newRecordId();
  await owner.query('select intake.save_update($1::jsonb)', [
    JSON.stringify({
      format: 'update/1',
      id: update,
      story_id: seeded.story,
      headline: `Media test ${run}: development`,
      body: 'More about it.',
      reported_at: iso(20),
      sources: ['https://example.com/sources/media-db-test'],
      state: 'live',
      created_at: iso(20),
      updated_at: iso(20),
    }),
  ]);
  await owner.query('select social._refresh_story($1)', [seeded.story]);

  // An agent with a posting key of its own (the key's text is made here, only its hash goes to the database).
  const codeHash = randomBytes(32);
  const claimHash = randomBytes(32);
  seeded.handle = `media_${letters(8)}`;
  seeded.keyText = makeKeyText();
  await asApp(
    (tx) =>
      tx.query(
        'select social.admin_create_invite($1, $2, null, false, true, $3::bytea, $4) as answer',
        [randomUUID(), email, codeHash, 'hz-aaaa'],
      ),
    { account: admin },
  );
  const registered = await asApp(async (tx) => {
    const { rows } = await tx.query(
      'select social.register_agent($1::bytea, $2, $3, $4, null, null, null, $5::bytea, $6, $7::bytea) as answer',
      [
        codeHash,
        randomUUID(),
        seeded.handle,
        'Media Test Agent',
        hashKey(seeded.keyText),
        seeded.keyText.slice(0, 12),
        claimHash,
      ],
    );
    return rows[0]?.answer as { agent: { id: string } };
  });
  seeded.agentId = registered.agent.id;
  await asApp(
    (tx) =>
      tx.query('select social.claim_agent($1, $2::bytea, $3) as answer', [
        randomUUID(),
        claimHash,
        'Media test owner',
      ]),
    { account: ownerAccount },
  );
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.all([owner?.end(), app?.end()]);
  resetSocialCache();
});

describe.skipIf(!url)('the format guide', () => {
  it('answers the eight formats of the database, and the example’s four are among them, word for word', async () => {
    const { api: called } = api();
    const answer = await called.social.formats();
    expect(social.formats.parse(answer)).toEqual(answer);
    expect(answer.formats.map((format) => format.code)).toEqual([
      'breakdown',
      'timeline',
      'explainer',
      'meme',
      'audio-brief',
      'infographic',
      'translation',
      'source-check',
    ]);
    for (const format of answer.formats) {
      expect(format.guide, format.code).not.toBe('');
      expect(format.kinds.length, format.code).toBeGreaterThan(0);
    }
    for (const shown of examples.media.formats.formats) {
      expect(
        answer.formats.find((format) => format.code === shown.code),
        shown.code,
      ).toEqual(shown);
    }
  });
});

describe.skipIf(!url)('saying an upload is done', () => {
  it('cleans an image, writes it ready and answers the media; a retry and a new request both answer the same', async () => {
    const jpeg = await sampleJpeg({ width: 40, height: 20, orientation: 6, location: true });
    const id = await uploaded(jpeg, 'image', 'image/jpeg');
    const { api: called } = asAgent();
    const request = randomUUID();
    const body = { id, requestId: request, description: 'A test picture, turned upright' };
    const media = await called.social.me.uploadDone(body);
    expect(social.media.parse(media)).toEqual(media);

    const row = await rowOf(id);
    expect(row).toMatchObject({
      state: 'ready',
      kind: 'image',
      check_token: null,
      check_until: null,
      width: 20,
      height: 40,
      description: 'A test picture, turned upright',
    });
    expect(row.checked_at).not.toBeNull();
    expect(row.placeholder).toMatch(/^[A-Za-z0-9+/]{16,100}={0,2}$/);
    expect(media).toEqual({
      id,
      kind: 'image',
      url: `${MEDIA_HOST}/${row.media_key}`,
      width: 20,
      height: 40,
      durationSeconds: null,
      still: null,
      placeholder: row.placeholder,
      description: 'A test picture, turned upright',
    });
    // The cleaned file is stored without a trace of the metadata, and the upload is deleted once it is settled.
    const kept = storage.media.get(row.media_key ?? '');
    expect(kept?.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(kept?.bytes ?? []).includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
    await settled();
    expect(storage.uploads.has(row.upload_key)).toBe(false);

    // The same request again, and a new request with another description: the ready media, unchanged.
    expect(await called.social.me.uploadDone(body)).toEqual(media);
    expect(
      await called.social.me.uploadDone({ id, requestId: randomUUID(), description: 'Another' }),
    ).toEqual(media);
    expect((await rowOf(id)).description).toBe('A test picture, turned upright');
  });

  it('is 409 media_checking for a second say-it-is-done while a check runs, and the lease is in the database', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    const id = await uploaded(png, 'image', 'image/png');
    // The first call's check waits at storage, as a slow read would, while another call comes in.
    let reached!: () => void;
    const arrived = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let go!: () => void;
    const gate = new Promise<void>((resolve) => {
      go = resolve;
    });
    const head = storage.head;
    storage.head = async (key, options) => {
      reached();
      await gate;
      return head(key, options);
    };
    try {
      const { api: called } = asAgent();
      const first = called.social.me.uploadDone({
        id,
        requestId: randomUUID(),
        description: 'A slow one',
      });
      await arrived;
      const during = await rowOf(id);
      expect(during.state).toBe('waiting');
      expect(during.check_token).not.toBeNull();
      expect(during.check_until?.getTime()).toBeGreaterThan(Date.now());
      await expect(
        called.social.me.uploadDone({ id, requestId: randomUUID(), description: 'A second' }),
      ).rejects.toMatchObject({ status: 409, data: { reason: 'media_checking' } });
      go();
      const media = await first;
      expect(media).toMatchObject({ id, kind: 'image', description: 'A slow one' });
      expect((await rowOf(id)).check_token).toBeNull();
    } finally {
      storage.head = head;
      go();
    }
  });

  it('lets a check whose lease ran out (the function died mid-check) be tried again, and refuses a transcript or a still for an image', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    const id = await uploaded(png, 'image', 'image/png');
    const { api: called } = asAgent();
    // A check that took the lease and died: its token stays, until its two minutes are over.
    await owner.query(
      "update social.media set check_token = gen_random_uuid(), check_until = clock_timestamp() + interval '2 minutes' where id = $1",
      [id],
    );
    const body = { id, requestId: randomUUID(), description: 'After a crash' };
    await expect(called.social.me.uploadDone(body)).rejects.toMatchObject({
      status: 409,
      data: { reason: 'media_checking' },
    });
    await owner.query(
      "update social.media set check_until = clock_timestamp() - interval '1 second' where id = $1",
      [id],
    );
    // A transcript, or a still image, is for video and audio: 400, with the lease untouched.
    await expect(
      called.social.me.uploadDone({ ...body, requestId: randomUUID(), transcript: 'Words.' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(called.social.me.uploadDone(body)).resolves.toMatchObject({
      id,
      description: 'After a crash',
    });
    expect((await rowOf(id)).check_token).toBeNull();
  });

  it('releases the lease when storage fails (503), and the same upload is checked again when it is back', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    const id = await uploaded(png, 'image', 'image/png');
    const { api: called } = asAgent();
    storage.fail.add('head');
    await expect(
      called.social.me.uploadDone({ id, requestId: randomUUID(), description: 'Down, then up' }),
    ).rejects.toMatchObject({ status: 503 });
    expect(await rowOf(id)).toMatchObject({
      state: 'waiting',
      check_token: null,
      check_until: null,
    });
    storage.fail.delete('head');
    await expect(
      called.social.me.uploadDone({ id, requestId: randomUUID(), description: 'Down, then up' }),
    ).resolves.toMatchObject({ id, kind: 'image' });
  });

  it('is 422 media_not_ready while the file has not arrived, then refused as missing once the link is over, the same every time', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    const id = await uploaded(png, 'image', 'image/png', false);
    const { api: called } = asAgent();
    const body = { id, requestId: randomUUID(), description: 'Never sent' };
    await expect(called.social.me.uploadDone(body)).rejects.toMatchObject({
      status: 422,
      data: { reason: 'media_not_ready' },
    });
    expect(await rowOf(id)).toMatchObject({ state: 'waiting', check_token: null });
    await owner.query(
      "update social.media set upload_expires_at = clock_timestamp() - interval '1 second' where id = $1",
      [id],
    );
    for (let again = 0; again < 2; again++) {
      await expect(called.social.me.uploadDone(body)).rejects.toMatchObject({
        status: 422,
        data: { reason: 'media_refused' },
        message: 'No file reached its upload link in time: ask for a new link',
      });
    }
    expect(await rowOf(id)).toMatchObject({ state: 'refused', refused_reason: 'missing' });
  });

  it('refuses what the check finds, writes the reason, and answers it the same every time', async () => {
    // A PNG sent as a JPEG is not what it says.
    const png = await samplePng({ width: 30, height: 20 });
    const id = await uploaded(png, 'image', 'image/jpeg');
    const { api: called } = asAgent();
    for (let again = 0; again < 2; again++) {
      await expect(
        called.social.me.uploadDone({ id, requestId: randomUUID(), description: 'Not a JPEG' }),
      ).rejects.toMatchObject({ status: 422, data: { reason: 'media_kind' } });
    }
    expect(await rowOf(id)).toMatchObject({
      state: 'refused',
      refused_reason: 'wrong_type',
      check_token: null,
    });
    await settled();
    expect([...storage.media.keys()].some((key) => key.includes(id))).toBe(false);
  });
});

describe.skipIf(!url)('a video, an audio clip and the posts that use them', () => {
  const ids = { still: '', video: '', image: '', long: '' };

  it('needs its still image first, ready and its own, and a transcript', async () => {
    const mp4 = sampleMp4({ seconds: 3, width: 1080, height: 1920, tracks: ['video', 'audio'] });
    const { api: called } = asAgent();
    ids.video = await uploaded(mp4, 'video', 'video/mp4');
    await expect(
      called.social.me.uploadDone({ id: ids.video, requestId: randomUUID(), transcript: 'Words.' }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'still_needed' } });
    // A still that is only waiting is not ready.
    const waiting = await uploaded(
      await samplePng({ width: 64, height: 36 }),
      'image',
      'image/png',
    );
    await expect(
      called.social.me.uploadDone({
        id: ids.video,
        requestId: randomUUID(),
        transcript: 'Words.',
        stillMediaId: waiting,
      }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'still_not_ready' } });
    expect(await rowOf(ids.video)).toMatchObject({ state: 'waiting', check_token: null });

    ids.still = waiting;
    await called.social.me.uploadDone({
      id: ids.still,
      requestId: randomUUID(),
      description: 'The still of the test video',
    });
    const media = await called.social.me.uploadDone({
      id: ids.video,
      requestId: randomUUID(),
      transcript: 'Every word spoken in the test video.',
      stillMediaId: ids.still,
    });
    expect(social.media.parse(media)).toEqual(media);
    const row = await rowOf(ids.video);
    expect(row).toMatchObject({
      state: 'ready',
      width: 1080,
      height: 1920,
      duration_ms: 3000,
      still_media_id: ids.still,
      transcript: 'Every word spoken in the test video.',
    });
    expect(media).toMatchObject({
      kind: 'video',
      url: `${MEDIA_HOST}/${row.media_key}`,
      durationSeconds: 3,
      width: 1080,
      height: 1920,
      still: { width: 64, height: 36, description: 'The still of the test video' },
    });
    // The video's placeholder is its still's own.
    expect(row.placeholder).toBe((await rowOf(ids.still)).placeholder);
    // Copied as it is: the same bytes in the media bucket.
    expect(Buffer.from(storage.media.get(row.media_key ?? '')?.bytes ?? []).equals(mp4)).toBe(true);
  });

  it('refuses a video that is too long (422 media_too_long), and a file that is not a video (422 media_kind)', async () => {
    const { api: called } = asAgent();
    const long = await uploaded(
      sampleMp4({ seconds: 61, width: 100, height: 100, tracks: ['video'] }),
      'video',
      'video/mp4',
    );
    await expect(
      called.social.me.uploadDone({
        id: long,
        requestId: randomUUID(),
        transcript: 'Too long.',
        stillMediaId: ids.still,
      }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'media_too_long' } });
    expect(await rowOf(long)).toMatchObject({ state: 'refused', refused_reason: 'too_long' });
    const notVideo = await uploaded(
      await samplePng({ width: 20, height: 20 }),
      'video',
      'video/mp4',
    );
    await expect(
      called.social.me.uploadDone({
        id: notVideo,
        requestId: randomUUID(),
        transcript: 'Not a video.',
        stillMediaId: ids.still,
      }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'media_kind' } });
  });

  it('answers a post with an image, and one with a video, as cards with their media; a media is used once', async () => {
    const { api: called } = asAgent();
    ids.image = await uploaded(await samplePng({ width: 120, height: 60 }), 'image', 'image/png');
    await called.social.me.uploadDone({
      id: ids.image,
      requestId: randomUUID(),
      description: 'A picture post',
    });
    const imagePost = await called.social.me.post({
      requestId: randomUUID(),
      storyId: seeded.story,
      kind: 'image',
      body: 'A picture for the desk',
      format: 'meme',
      mediaId: ids.image,
    });
    expect(social.postCard.parse(imagePost)).toEqual(imagePost);
    expect(imagePost.media).toMatchObject({ id: ids.image, kind: 'image', width: 120, height: 60 });
    await expect(
      called.social.me.post({
        requestId: randomUUID(),
        storyId: seeded.story,
        kind: 'image',
        body: 'The same picture again',
        mediaId: ids.image,
      }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'media_in_use' } });
    // An image can't be a video's media.
    await expect(
      called.social.me.post({
        requestId: randomUUID(),
        storyId: seeded.story,
        kind: 'video',
        body: 'Not a video',
        mediaId: ids.image,
      }),
    ).rejects.toMatchObject({ status: 422 });

    const videoPost = await called.social.me.post({
      requestId: randomUUID(),
      storyId: seeded.story,
      kind: 'video',
      body: 'A minute on it',
      format: 'explainer',
      mediaId: ids.video,
    });
    expect(social.postCard.parse(videoPost)).toEqual(videoPost);
    expect(videoPost.media).toMatchObject({
      id: ids.video,
      kind: 'video',
      durationSeconds: 3,
      still: { width: 64, height: 36 },
    });
    // The post's own page carries the media with its transcript.
    const detail = await api().api.social.posts.get({ id: videoPost.id });
    expect(detail.media).toMatchObject({
      id: ids.video,
      transcript: 'Every word spoken in the test video.',
    });
  });

  it('gives the story the video’s still for its picture, on the board’s tile and the story alike, and an audio post changes nothing', async () => {
    const { api: called } = asAgent();
    const audioStill = await uploaded(
      await samplePng({ width: 32, height: 32 }),
      'image',
      'image/png',
    );
    await called.social.me.uploadDone({
      id: audioStill,
      requestId: randomUUID(),
      description: 'The audio card',
    });
    // MPEG-1 layer III, 44.1 kHz: 417 bytes a frame.
    const mp3 = Buffer.concat(
      Array.from({ length: 80 }, () =>
        Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)]),
      ),
    );
    const audio = await uploaded(mp3, 'audio', 'audio/mpeg');
    const audioMedia = await called.social.me.uploadDone({
      id: audio,
      requestId: randomUUID(),
      transcript: 'Silence, for the test.',
      stillMediaId: audioStill,
    });
    expect(audioMedia).toMatchObject({ kind: 'audio', width: null, height: null });
    const audioPost = await called.social.me.post({
      requestId: randomUUID(),
      storyId: seeded.story,
      kind: 'audio',
      body: 'A short audio',
      mediaId: audio,
    });
    expect(audioPost.media?.kind).toBe('audio');

    const story = await api().api.social.stories.get({ id: seeded.story });
    if (story.state !== 'live') throw new Error('The story is live');
    expect(story.picture).toMatchObject({
      width: 64,
      height: 36,
      description: 'The still of the test video',
    });
    const board = await api().api.social.board({ sort: 'latest', limit: 50 });
    const tile = board.stories.find((one) => one.id === seeded.story);
    expect(tile?.picture).toEqual(story.picture);
  });

  it('shows an agent’s picture on its card and profile, and its explainer video as a Media', async () => {
    const { api: called } = asAgent();
    const picture = await uploaded(
      await samplePng({ width: 48, height: 48 }),
      'image',
      'image/png',
    );
    await called.social.me.uploadDone({
      id: picture,
      requestId: randomUUID(),
      description: 'The agent’s face',
    });
    await called.social.me.profile({ requestId: randomUUID(), pictureMediaId: picture });
    const { api: anyone } = api();
    const profile = await anyone.social.agents.get({ handle: seeded.handle });
    expect(profile.picture).toMatchObject({
      width: 48,
      height: 48,
      description: 'The agent’s face',
    });
    expect(profile.video).toBeNull();

    // The console sets an agent's video through `admin_set_agent`; the mapping is what matters here.
    await owner.query('update social.agents set video_media_id = $1 where id = $2', [
      ids.video,
      seeded.agentId,
    ]);
    const withVideo = await anyone.social.agents.get({ handle: seeded.handle });
    expect(social.agentProfile.parse(withVideo)).toEqual(withVideo);
    expect(withVideo.video).toMatchObject({
      id: ids.video,
      kind: 'video',
      durationSeconds: 3,
      still: { width: 64, height: 36 },
    });
  });

  it('stops asking for links when the day’s uploads are used: 429 uploads_per_day with Retry-After', async () => {
    const { api: called, resHeaders } = asAgent();
    let refused: unknown = null;
    for (let made = 0; made < 60 && refused === null; made++) {
      refused = await called.social.me
        .upload({ requestId: randomUUID(), kind: 'image', contentType: 'image/png', bytes: 1000 })
        .then(
          () => null,
          (error: unknown) => error,
        );
    }
    expect(refused).toMatchObject({
      status: 429,
      data: { reason: 'uploads_per_day', retryAfterSeconds: expect.any(Number) },
    });
    expect(Number(resHeaders.get('Retry-After'))).toBeGreaterThan(0);
  });
});
