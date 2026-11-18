import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MemoryStorage, memoryStorage } from '@/lib/social/media/memory-storage.ts';
import { sampleJpeg, sampleMp4, samplePng } from '@/lib/social/media/samples.ts';

/**
 * The media area's agent calls (lib/api/social/media.ts; docs/social/media-design.md, 3.8 and 7.3 to 7.10):
 * the upload link, saying it's done (begin, the check, finish), the format guide, R8's own error map and the
 * 429s' `Retry-After`. Who is signed in, the keys' Redis copies and the limits are stood in for, and so is
 * the database (a recording stand-in that answers like the functions of migrations/*_social_media.sql) and
 * storage (both buckets in memory, except for the link, which is signed for real: no network is needed to sign).
 * What is proven here is the handlers: what they send, in what order, with what open, what they map and how
 * they refuse. That the functions do what the stand-in says is proven on a real database by `media.db.test.ts`.
 */

const signedIn = vi.fn();
const findKey = vi.fn();
const allowKeyRead = vi.fn();
const allowAgentWrite = vi.fn();
/** Every commit and Redis delete, and every storage call, in order. */
const events: string[] = [];
/** The promises handed to `waitUntil`, for a test to wait for. */
const background: Promise<unknown>[] = [];

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/api/keys.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/keys.ts')>()),
  findKey: (_pool: unknown, text: string) => findKey(text),
  revokeAgentKeys: async () => {
    events.push('revoke');
  },
}));
vi.mock('@/lib/api/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit.ts')>()),
  allowKeyRead: (key: string) => allowKeyRead(key),
}));
vi.mock('@/lib/social/limits.ts', async (original) => ({
  ...(await original<typeof import('@/lib/social/limits.ts')>()),
  allowAgentWrite: (key: string) => allowAgentWrite(key),
}));
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  waitUntil: (promise: Promise<unknown>) => {
    background.push(promise);
  },
}));

/** The storage the handlers get: the memory one, none, or (when null) the real one made from the environment. */
const held = vi.hoisted(() => ({ storage: 'real' as unknown }));
vi.mock('@/lib/social/media/storage.ts', async (original) => {
  const actual = await original<typeof import('@/lib/social/media/storage.ts')>();
  return {
    ...actual,
    mediaStorage: () => (held.storage === 'real' ? actual.mediaStorage() : held.storage),
  };
});

type Statement = { text: string; values: unknown[] | undefined };
const asked: Statement[] = [];
const setUp: unknown[][] = [];
let answer: (statement: Statement) => unknown | Error = () => ({});
/** How many clients of the pool are checked out right now. */
let open = 0;

const client = {
  query: vi.fn(async (text: string, values?: unknown[]) => {
    if (text.startsWith('select set_config')) {
      setUp.push(values ?? []);
      return { rows: [] };
    }
    if (text === 'begin' || text === 'rollback') return { rows: [] };
    if (text === 'commit') {
      events.push('commit');
      return { rows: [] };
    }
    asked.push({ text, values });
    events.push(`sql ${text.slice(0, 32)}`);
    const result = answer({ text, values });
    if (result instanceof Error) throw result;
    return { rows: [{ answer: result }] };
  }),
  release: vi.fn(() => {
    open -= 1;
  }),
};
vi.mock('@/lib/db.ts', () => ({
  database: () => ({
    connect: async () => {
      open += 1;
      return client;
    },
  }),
}));

const redis = {
  get: vi.fn(async () => null),
  set: vi.fn(async () => 'OK'),
  del: vi.fn(async (...keys: string[]) => {
    for (const key of keys) events.push(`redis del ${key}`);
    return keys.length;
  }),
};

const { router } = await import('../router.ts');
const { resetSocialCache } = await import('@/lib/social/cache.ts');
const { formatOf } = await import('./media.ts');

const ORIGIN = 'https://abc-preview.hrizzup.test';
const MEDIA_HOST = 'https://media.example.test';
const KEY_ID = '019a7b10-0000-7000-8000-0000000000d1';
const AGENT_ID = '019a7b10-0000-7000-8000-0000000000b1';
const MEDIA_ID = '019a7b10-0000-7000-8000-0000000000e1';
const STILL_ID = '019a7b10-0000-7000-8000-0000000000e2';
const REQUEST = '019a7b10-0000-7000-8000-0000000000f1';
const TOKEN = '019a7b10-0000-7000-8000-0000000000f9';
const STORY_ID = '019a7b10-0000-7000-8000-0000000000c1';
const POST_KEY = `hz_demo_${'p'.repeat(43)}`;
const asKey = { authorization: `Bearer ${POST_KEY}` };
const COPY_KEY = `stg:cache:social-checkin:v2:${AGENT_ID}`;
const UPLOAD_KEY = `social/${AGENT_ID}/${MEDIA_ID}`;

const api = (headers: Record<string, string> = asKey) => {
  const resHeaders = new Headers();
  return {
    resHeaders,
    call: createRouterClient(router, {
      context: { headers: new Headers(headers), url: `${ORIGIN}/api/v1/x`, resHeaders },
    }),
  };
};

const fault = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...extra });

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  vi.stubEnv('MEDIA_BASE_URL', MEDIA_HOST);
  // Low-entropy made-up names, never a real key: the link is signed with them and no request is ever sent.
  vi.stubEnv('R2_ENDPOINT', 'https://account.r2.example.test');
  vi.stubEnv('R2_BUCKET_UPLOADS', 'uploads-for-tests');
  vi.stubEnv('R2_BUCKET_MEDIA', 'media-for-tests');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'access-key-for-tests');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret-for-tests');
  held.storage = 'real';
  signedIn.mockResolvedValue(null);
  findKey.mockImplementation(async (text: string) =>
    text === POST_KEY ? { id: KEY_ID, kind: 'post', agentId: AGENT_ID } : null,
  );
  allowKeyRead.mockResolvedValue({ allowed: true });
  allowAgentWrite.mockResolvedValue({ allowed: true });
  resetSocialCache({ redis: redis as never, prefix: 'stg' });
  answer = () => ({});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  asked.length = 0;
  setUp.length = 0;
  events.length = 0;
  background.length = 0;
  open = 0;
  resetSocialCache(undefined);
});

// What the stand-in database answers ---------------------------------------------------------------------

const upload = (changes: Record<string, unknown> = {}) => ({
  id: MEDIA_ID,
  agent_id: AGENT_ID,
  kind: 'image',
  content_type: 'image/png',
  bytes: 100,
  upload_key: UPLOAD_KEY,
  media_key: `${UPLOAD_KEY}.png`,
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  ...changes,
});
/** What `social._media` answers for a ready image. */
const imageRow = (changes: Record<string, unknown> = {}) => ({
  id: MEDIA_ID,
  kind: 'image',
  media_key: `${UPLOAD_KEY}.png`,
  width: 30,
  height: 20,
  duration_ms: null,
  still: null,
  placeholder: null,
  description: 'A test picture',
  ...changes,
});

/** The statement's own name: `begin`, `finish`, `create` or `guide`. */
const nameOf = (text: string) => /social\.(\w+)\(/.exec(text)?.[1] ?? text;

/** The stand-in answering by statement. */
function database(handlers: Record<string, (values: unknown[]) => unknown | Error>) {
  answer = ({ text, values }) => {
    const handler = handlers[nameOf(text)];
    if (handler === undefined) throw new Error(`Unexpected statement: ${text}`);
    return handler(values ?? []);
  };
}

/** The memory storage as the handlers get it, holding the file at the upload's key. */
function stored(file: Uint8Array, contentType: string) {
  const storage = memoryStorage();
  storage.put(UPLOAD_KEY, file, contentType);
  held.storage = storage;
  return storage;
}

// social.me.upload (7.3) ---------------------------------------------------------------------------------

describe('social.me.upload', () => {
  const input = {
    requestId: REQUEST,
    kind: 'image',
    contentType: 'image/jpeg',
    bytes: 184_320,
  } as const;

  const created = (changes: Record<string, unknown> = {}) => ({
    media: { id: MEDIA_ID, kind: 'image', state: 'waiting' },
    content_type: 'image/jpeg',
    bytes: 184_320,
    upload_key: UPLOAD_KEY,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...changes,
  });

  it('asks the database as the agent, signs a link for exactly that file, and forgets the check-in’s copy', async () => {
    const row = created();
    database({ upload_create: () => row });
    const { call, resHeaders } = api();
    const result = await call.social.me.upload(input);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe('select social.upload_create($1, $2, $3, $4) as answer');
    expect(asked[0]?.values).toEqual([REQUEST, 'image', 'image/jpeg', 184_320]);
    expect(setUp[0]).toContain(KEY_ID);
    expect(allowAgentWrite).toHaveBeenCalledWith(KEY_ID);

    expect(result.media).toEqual({ id: MEDIA_ID, kind: 'image', state: 'waiting' });
    expect(result.headers).toEqual({ 'Content-Type': 'image/jpeg', 'Content-Length': '184320' });
    const link = new URL(result.uploadUrl);
    expect(link.origin).toBe('https://account.r2.example.test');
    expect(link.pathname).toBe(`/uploads-for-tests/${UPLOAD_KEY}`);
    // Both headers are signed with it, so the bucket refuses another type or size.
    expect(link.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(link.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    const seconds = Number(link.searchParams.get('X-Amz-Expires'));
    expect(seconds).toBeGreaterThanOrEqual(590);
    expect(seconds).toBeLessThanOrEqual(600);
    expect(result.expiresAt).toBe(row.expires_at);
    // No secret reaches the answer but the signature, and the secret key itself never does.
    expect(JSON.stringify(result)).not.toContain('secret-for-tests');
    expect(resHeaders.get('Retry-After')).toBeNull();
    expect(events.filter((event) => event.startsWith('redis del'))).toEqual([
      `redis del ${COPY_KEY}`,
    ]);
  });

  it('signs for the time the row has left, never under a minute or over ten', async () => {
    for (const [left, expected] of [
      [5_000, 60],
      [120_000, 120],
      [3_600_000, 600],
    ] as const) {
      database({
        upload_create: () => created({ expires_at: new Date(Date.now() + left).toISOString() }),
      });
      const result = await api().call.social.me.upload(input);
      const seconds = Number(new URL(result.uploadUrl).searchParams.get('X-Amz-Expires'));
      expect(Math.abs(seconds - expected), `${left} ms left`).toBeLessThanOrEqual(2);
    }
  });

  it('is 503 "not set up here" with no storage, before the database is asked', async () => {
    held.storage = null;
    await expect(api().call.social.me.upload(input)).rejects.toMatchObject({
      status: 503,
      message: 'Uploads are not set up here',
    });
    expect(asked).toHaveLength(0);
    vi.stubEnv('R2_BUCKET_MEDIA', '');
    held.storage = 'real';
    await expect(api().call.social.me.upload(input)).rejects.toMatchObject({ status: 503 });
    expect(asked).toHaveLength(0);
  });

  it('refuses a type that isn’t the kind’s (422 media_kind) and a size over the kind’s (422 media_too_big) before the database', async () => {
    const { call } = api();
    await expect(
      call.social.me.upload({ ...input, kind: 'image', contentType: 'video/mp4' }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'media_kind' } });
    await expect(
      call.social.me.upload({ ...input, kind: 'video', contentType: 'image/png' }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'media_kind' } });
    await expect(
      call.social.me.upload({
        ...input,
        kind: 'audio',
        contentType: 'audio/mpeg',
        bytes: 20_971_521,
      }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'media_too_big' } });
    await expect(call.social.me.upload({ ...input, bytes: 10_485_761 })).rejects.toMatchObject({
      status: 422,
      data: { reason: 'media_too_big' },
    });
    expect(asked).toHaveLength(0);
    // The exact limits pass.
    database({ upload_create: () => created() });
    await expect(call.social.me.upload({ ...input, bytes: 10_485_760 })).resolves.toBeDefined();
  });

  it('needs the agent’s posting key, and counts a write against it', async () => {
    await expect(api({}).call.social.me.upload(input)).rejects.toMatchObject({ status: 401 });
    allowAgentWrite.mockResolvedValue({ allowed: false, retryAfterSeconds: 7 });
    const { call, resHeaders } = api();
    await expect(call.social.me.upload(input)).rejects.toMatchObject({ status: 429 });
    expect(resHeaders.get('Retry-After')).toBe('7');
    expect(asked).toHaveLength(0);
  });
});

// R8's error map (3.8) -----------------------------------------------------------------------------------

describe('the error map (3.8)', () => {
  const input = {
    requestId: REQUEST,
    kind: 'image',
    contentType: 'image/jpeg',
    bytes: 1000,
  } as const;

  /** Each row of the design's table: the database's fault, and what the API says. */
  const rows: [string, Error, number, string | undefined][] = [
    ['media_kind', fault('HZS16', 'type', { detail: 'media_kind' }), 422, 'media_kind'],
    ['media_too_big', fault('HZS16', 'size', { detail: 'media_too_big' }), 422, 'media_too_big'],
    ['still_needed', fault('HZS16', 'still', { detail: 'still_needed' }), 422, 'still_needed'],
    [
      'still_not_ready',
      fault('HZS16', 'still', { detail: 'still_not_ready' }),
      422,
      'still_not_ready',
    ],
    [
      'media_checking',
      fault('HZS28', 'checking', { detail: 'media_checking' }),
      409,
      'media_checking',
    ],
    // The shared map's own, left alone.
    [
      'media_not_ready',
      fault('HZS16', 'ready', { detail: 'media_not_ready' }),
      422,
      'media_not_ready',
    ],
    ['media_in_use', fault('HZS16', 'use', { detail: 'media_in_use' }), 422, 'media_in_use'],
    ['a clash with no detail', fault('HZS28', 'other'), 409, 'clash'],
    [
      'an unknown HZS16 detail',
      fault('HZS16', 'other', { detail: 'something_new' }),
      422,
      'media_not_ready',
    ],
    ['no such upload', fault('P0002', 'No such upload'), 404, undefined],
  ];

  it.each(rows)('answers %s', async (_name, error, status, reason) => {
    database({ upload_create: () => error, upload_begin: () => error });
    for (const make of [
      () => api().call.social.me.upload(input),
      () => api().call.social.me.uploadDone({ id: MEDIA_ID, requestId: REQUEST }),
    ]) {
      held.storage = memoryStorage();
      const failed = await make().then(
        () => null,
        (e: unknown) => e as { status: number; data?: { reason?: string }; message: string },
      );
      expect(failed?.status).toBe(status);
      if (reason !== undefined) expect(failed?.data?.reason).toBe(reason);
      if (_name === 'no such upload') expect(failed?.message).toBe('No such upload');
    }
  });

  it('answers the day’s uploads used as 429 with the seconds to wait in `Retry-After`', async () => {
    database({
      upload_create: () => fault('HZS16', 'used', { detail: 'uploads_per_day', hint: '3601' }),
    });
    const { call, resHeaders } = api();
    await expect(call.social.me.upload(input)).rejects.toMatchObject({
      status: 429,
      data: { reason: 'uploads_per_day', retryAfterSeconds: 3601 },
    });
    expect(resHeaders.get('Retry-After')).toBe('3601');
    // A hint that isn't a wait is a day.
    database({
      upload_create: () => fault('HZS16', 'used', { detail: 'uploads_per_day', hint: 'soon' }),
    });
    const second = api();
    await expect(second.call.social.me.upload(input)).rejects.toMatchObject({
      data: { retryAfterSeconds: 86_400 },
    });
    expect(second.resHeaders.get('Retry-After')).toBe('86400');
  });

  it('says what to do next in every message', async () => {
    database({ upload_create: () => fault('HZS16', 'x', { detail: 'media_kind' }) });
    await expect(api().call.social.me.upload(input)).rejects.toMatchObject({
      message:
        "That type isn't one of this kind's: images are JPEG, PNG or WebP, video MP4, audio M4A or MP3",
    });
    database({ upload_begin: () => fault('HZS28', 'x', { detail: 'media_checking' }) });
    held.storage = memoryStorage();
    await expect(
      api().call.social.me.uploadDone({ id: MEDIA_ID, requestId: REQUEST }),
    ).rejects.toMatchObject({
      message: "This upload is being checked: say it's done again in a minute",
    });
  });
});

// social.me.uploadDone (7.4) -----------------------------------------------------------------------------

describe('social.me.uploadDone', () => {
  const input = { id: MEDIA_ID, requestId: REQUEST, description: 'A test picture' } as const;
  const check = (png: Uint8Array) => ({
    step: 'check',
    token: TOKEN,
    upload: upload({ bytes: png.length }),
  });

  it('begins, checks with no database client checked out, then finishes: the order, and what each statement is sent', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    const storage = stored(png, 'image/png');
    const openDuringStorage: number[] = [];
    storage.onCall = (name) => {
      events.push(name === 'removeUpload' ? 'removeUpload' : 'storage');
      openDuringStorage.push(open);
    };
    database({
      upload_begin: () => check(png),
      upload_finish: () => ({ step: 'answer', media: imageRow() }),
    });
    const { call } = api();
    const media = await call.social.me.uploadDone(input);

    // Begin's transaction commits, then the check reads storage with nothing open, then finish's transaction.
    const at = (match: (event: string) => boolean) => events.findIndex(match);
    const [firstStorage, lastStorage] = [events.indexOf('storage'), events.lastIndexOf('storage')];
    const begin = at((event) => event.startsWith('sql select social.upload_begin'));
    const finish = at((event) => event.startsWith('sql select social.upload_finish'));
    expect(begin).toBeLessThan(events.indexOf('commit'));
    expect(events.indexOf('commit')).toBeLessThan(firstStorage);
    expect(finish).toBeGreaterThan(lastStorage);
    // The upload is deleted only after finish's transaction has committed.
    expect(events.indexOf('removeUpload')).toBeGreaterThan(events.lastIndexOf('commit'));
    expect(events.lastIndexOf('commit')).toBeGreaterThan(finish);
    expect(openDuringStorage.length).toBeGreaterThan(0);
    expect(openDuringStorage.every((count) => count === 0)).toBe(true);
    expect(open).toBe(0);

    expect(asked.map((statement) => nameOf(statement.text))).toEqual([
      'upload_begin',
      'upload_finish',
    ]);
    expect(asked[0]?.values).toEqual([REQUEST, MEDIA_ID, 'A test picture', null, null]);
    expect(asked[1]?.values?.slice(0, 3)).toEqual([REQUEST, MEDIA_ID, TOKEN]);
    const outcome = JSON.parse(String(asked[1]?.values?.[3]));
    expect(outcome).toMatchObject({
      outcome: 'ready',
      media_key: `${UPLOAD_KEY}.png`,
      width: 30,
      height: 20,
    });
    expect(media).toEqual({
      id: MEDIA_ID,
      kind: 'image',
      url: `${MEDIA_HOST}/${UPLOAD_KEY}.png`,
      width: 30,
      height: 20,
      durationSeconds: null,
      still: null,
      placeholder: null,
      description: 'A test picture',
    });
    // The cleaned file is in the media bucket, and the upload is deleted in the background, after the commit.
    expect(storage.media.has(`${UPLOAD_KEY}.png`)).toBe(true);
    await Promise.all(background);
    expect(storage.uploads.has(UPLOAD_KEY)).toBe(false);
    expect(events.at(-1)).toBe(`redis del ${COPY_KEY}`);
  });

  it('sends a video’s transcript and still, and answers its measured length', async () => {
    const mp4 = sampleMp4({ seconds: 3, width: 1080, height: 1920, tracks: ['video', 'audio'] });
    const storage = stored(mp4, 'video/mp4');
    storage.onCall = () => openDuring.push(open);
    const openDuring: number[] = [];
    database({
      upload_begin: () => ({
        step: 'check',
        token: TOKEN,
        upload: upload({
          kind: 'video',
          content_type: 'video/mp4',
          bytes: mp4.length,
          media_key: `${UPLOAD_KEY}.mp4`,
        }),
      }),
      upload_finish: () => ({
        step: 'answer',
        media: imageRow({
          kind: 'video',
          media_key: `${UPLOAD_KEY}.mp4`,
          width: 1080,
          height: 1920,
          duration_ms: 3000,
          still: {
            media_key: `social/${AGENT_ID}/${STILL_ID}.jpg`,
            width: 640,
            height: 360,
            placeholder: null,
            description: null,
          },
        }),
      }),
    });
    const media = await api().call.social.me.uploadDone({
      id: MEDIA_ID,
      requestId: REQUEST,
      transcript: 'What is said.',
      stillMediaId: STILL_ID,
    });
    expect(asked[0]?.values).toEqual([REQUEST, MEDIA_ID, null, 'What is said.', STILL_ID]);
    expect(JSON.parse(String(asked[1]?.values?.[3]))).toMatchObject({
      outcome: 'ready',
      duration_ms: 3000,
      width: 1080,
      height: 1920,
    });
    expect(media).toMatchObject({ kind: 'video', durationSeconds: 3, still: { width: 640 } });
    expect(openDuring.every((count) => count === 0)).toBe(true);
    expect(storage.media.has(`${UPLOAD_KEY}.mp4`)).toBe(true);
  });

  it('answers an upload that is already ready from begin alone: no storage, no finish', async () => {
    const storage = memoryStorage();
    held.storage = storage;
    database({ upload_begin: () => ({ step: 'answer', media: imageRow() }) });
    const media = await api().call.social.me.uploadDone(input);
    expect(media.id).toBe(MEDIA_ID);
    expect(asked).toHaveLength(1);
    expect(storage.log).toEqual([]);
  });

  it('answers a refusal from begin with the same words every time', async () => {
    held.storage = memoryStorage();
    database({ upload_begin: () => ({ step: 'refused', reason: 'too_long' }) });
    for (let again = 0; again < 2; again++) {
      await expect(api().call.social.me.uploadDone(input)).rejects.toMatchObject({
        status: 422,
        message: 'Video is at most 60 seconds and audio 5 minutes: cut it',
        data: { reason: 'media_too_long' },
      });
    }
  });

  it.each([
    ['expired', 'media_refused', 'No file reached its upload link in time: ask for a new link'],
    ['missing', 'media_refused', 'No file reached its upload link in time: ask for a new link'],
    [
      'size_mismatch',
      'media_refused',
      "The file isn't the size you declared: ask for a new link with its real size",
    ],
    ['too_big', 'media_too_big', 'Too big for its kind, even cleaned: images are at most 10 MB'],
    [
      'wrong_type',
      'media_kind',
      "The file isn't what you declared: a video needs a video track, audio a sound track and no video",
    ],
    [
      'wrong_tracks',
      'media_kind',
      "The file isn't what you declared: a video needs a video track, audio a sound track and no video",
    ],
    ['animated', 'media_refused', "Animated images aren't taken: upload a still image"],
    ['too_large_image', 'media_refused', 'Images are at most 50 megapixels: make it smaller'],
    ['dimensions', 'media_refused', 'A video is at most 10,000 pixels a side'],
    ['too_long', 'media_too_long', 'Video is at most 60 seconds and audio 5 minutes: cut it'],
    [
      'fragmented',
      'media_refused',
      "A fragmented MP4 isn't taken: export a regular one (FFmpeg: -movflags +faststart)",
    ],
    ['unreadable', 'media_refused', "This file can't be read as its type: export it again"],
    [
      'changed',
      'media_refused',
      'The file changed after it was checked: ask for a new link and upload it again',
    ],
    ['something_new', 'media_refused', 'This upload was refused'],
  ])('answers a refusal %s as 422 %s', async (code, reason, message) => {
    held.storage = memoryStorage();
    database({ upload_begin: () => ({ step: 'refused', reason: code }) });
    await expect(api().call.social.me.uploadDone(input)).rejects.toMatchObject({
      status: 422,
      message,
      data: { reason },
    });
  });

  it('refuses what the check finds, writes the refusal, and deletes the upload after it commits', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    // Declared as a JPEG: the check says wrong_type, which finish records, and the answer is that refusal.
    const storage = stored(png, 'image/jpeg');
    database({
      upload_begin: () => ({
        step: 'check',
        token: TOKEN,
        upload: upload({
          content_type: 'image/jpeg',
          bytes: png.length,
          media_key: `${UPLOAD_KEY}.jpg`,
        }),
      }),
      upload_finish: () => ({ step: 'refused', reason: 'wrong_type' }),
    });
    await expect(api().call.social.me.uploadDone(input)).rejects.toMatchObject({
      status: 422,
      data: { reason: 'media_kind' },
    });
    expect(JSON.parse(String(asked[1]?.values?.[3]))).toEqual({
      outcome: 'refused',
      reason: 'wrong_type',
    });
    expect(storage.media.size).toBe(0);
    await Promise.all(background);
    expect(storage.uploads.has(UPLOAD_KEY)).toBe(false);
  });

  it('is 422 media_not_ready when the file hasn’t arrived yet, and the upload stays', async () => {
    const storage = memoryStorage();
    held.storage = storage;
    database({
      upload_begin: () => ({ step: 'check', token: TOKEN, upload: upload() }),
      upload_finish: () => ({ step: 'released' }),
    });
    await expect(api().call.social.me.uploadDone(input)).rejects.toMatchObject({
      status: 422,
      message:
        "The file hasn't reached its upload link yet: PUT it there, then say it's done again",
      data: { reason: 'media_not_ready' },
    });
    // The lease is released, not settled: nothing is deleted, and the database is told only "release".
    expect(JSON.parse(String(asked[1]?.values?.[3]))).toEqual({ outcome: 'release' });
    expect(background).toHaveLength(0);
  });

  it('is 503 "say it’s done again" when storage fails, with the lease released and nothing deleted', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    const storage = stored(png, 'image/png');
    storage.fail.add('head');
    database({
      upload_begin: () => check(png),
      upload_finish: () => ({ step: 'released' }),
    });
    await expect(api().call.social.me.uploadDone(input)).rejects.toMatchObject({
      status: 503,
      message: "The upload couldn't be checked just now: say it's done again in a moment",
    });
    expect(JSON.parse(String(asked[1]?.values?.[3]))).toEqual({ outcome: 'release' });
    expect(background).toHaveLength(0);
    expect(storage.uploads.has(UPLOAD_KEY)).toBe(true);
  });

  it('is 409 media_checking when another check holds the lease (finish answers waiting)', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    stored(png, 'image/png');
    database({ upload_begin: () => check(png), upload_finish: () => ({ step: 'waiting' }) });
    await expect(api().call.social.me.uploadDone(input)).rejects.toMatchObject({
      status: 409,
      data: { reason: 'media_checking' },
    });
    expect(background).toHaveLength(0);
  });

  it('releases the lease at once and answers 500 when the check hits a fault of ours', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    const storage = stored(png, 'image/png');
    storage.putMedia = async () => {
      throw new TypeError('a bug of ours');
    };
    database({ upload_begin: () => check(png), upload_finish: () => ({ step: 'released' }) });
    await expect(api().call.social.me.uploadDone(input)).rejects.toThrow('a bug of ours');
    expect(asked.map((statement) => nameOf(statement.text))).toEqual([
      'upload_begin',
      'upload_finish',
    ]);
    expect(JSON.parse(String(asked[1]?.values?.[3]))).toEqual({ outcome: 'release' });
    expect(background).toHaveLength(0);
    // And a release that itself fails never hides the original fault.
    asked.length = 0;
    database({
      upload_begin: () => check(png),
      upload_finish: () => fault('57014', 'the release failed too'),
    });
    await expect(api().call.social.me.uploadDone(input)).rejects.toThrow('a bug of ours');
  });

  it('is a 500, not a made-up answer, when a ready media can’t be shown (no media host)', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    stored(png, 'image/png');
    vi.stubEnv('MEDIA_BASE_URL', '');
    database({ upload_begin: () => ({ step: 'answer', media: imageRow() }) });
    await expect(api().call.social.me.uploadDone(input)).rejects.toThrow('could not be shown');
  });

  it('is 503 with no storage, before begin takes a lease, and 404 for an upload that isn’t the agent’s', async () => {
    held.storage = null;
    await expect(api().call.social.me.uploadDone(input)).rejects.toMatchObject({ status: 503 });
    expect(asked).toHaveLength(0);
    held.storage = memoryStorage();
    database({ upload_begin: () => fault('P0002', 'No such upload') });
    await expect(api().call.social.me.uploadDone(input)).rejects.toMatchObject({
      status: 404,
      message: 'No such upload',
    });
  });

  it('sets `Retry-After` on a 429 from the key’s write limit', async () => {
    held.storage = memoryStorage();
    allowAgentWrite.mockResolvedValue({ allowed: false, retryAfterSeconds: 11 });
    const { call, resHeaders } = api();
    await expect(call.social.me.uploadDone(input)).rejects.toMatchObject({ status: 429 });
    expect(resHeaders.get('Retry-After')).toBe('11');
    expect(asked).toHaveLength(0);
  });

  it('counts a JPEG with a position as any image: its bytes are never in the answer', async () => {
    const jpeg = await sampleJpeg({ width: 40, height: 20, orientation: 6, location: true });
    const storage: MemoryStorage = stored(jpeg, 'image/jpeg');
    database({
      upload_begin: () => ({
        step: 'check',
        token: TOKEN,
        upload: upload({
          content_type: 'image/jpeg',
          bytes: jpeg.length,
          media_key: `${UPLOAD_KEY}.jpg`,
        }),
      }),
      upload_finish: () => ({
        step: 'answer',
        media: imageRow({ media_key: `${UPLOAD_KEY}.jpg`, width: 20, height: 40 }),
      }),
    });
    await api().call.social.me.uploadDone(input);
    const outcome = JSON.parse(String(asked[1]?.values?.[3]));
    expect(outcome).toMatchObject({ outcome: 'ready', width: 20, height: 40 });
    const out = storage.media.get(`${UPLOAD_KEY}.jpg`)?.bytes ?? new Uint8Array();
    expect(Buffer.from(out).includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
  });
});

// The asset library and the format guide ------------------------------------------------------------------

describe('social.assets', () => {
  it('stays "No such call": the founder decided there is no asset library', async () => {
    await expect(api().call.social.assets()).rejects.toThrow('No such call');
  });
});

describe('social.formats (7.8)', () => {
  const rows = [
    { code: 'breakdown', name: 'Breakdown', kinds: ['text'], guide: 'A short written take.' },
    { code: 'timeline', name: 'Timeline', kinds: ['text', 'image'], guide: null },
    { code: 'explainer', name: 'Explainer', kinds: ['video'], guide: 'A one-minute video.' },
    { code: 'audio-brief', name: 'Audio brief', kinds: ['audio'], guide: 'A spoken summary.' },
    { code: 'mixed', name: 'Mixed', kinds: ['image', 'video', 'audio'], guide: 'All three.' },
  ];

  it('reads the guide once, as nobody, and answers each format with the limits the code holds', async () => {
    database({ format_guide: () => ({ formats: rows }) });
    const result = await api({}).call.social.formats();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toBe('select social.format_guide() as answer');
    expect(setUp[0]?.[0]).not.toContain(KEY_ID);
    expect(result.formats.map((format) => format.code)).toEqual(rows.map((row) => row.code));
    const widths = [320, 640, 960, 1280];
    expect(result.formats[0]).toEqual({
      code: 'breakdown',
      name: 'Breakdown',
      kinds: ['text'],
      limits: { maxBytes: 0, maxSeconds: null, imageWidths: [] },
      guide: 'A short written take.',
    });
    // A format with no guide answers an empty one.
    expect(result.formats[1]).toMatchObject({
      limits: { maxBytes: 10_485_760, maxSeconds: null, imageWidths: widths },
      guide: '',
    });
    expect(result.formats[2]?.limits).toEqual({
      maxBytes: 104_857_600,
      maxSeconds: 60,
      imageWidths: [],
    });
    expect(result.formats[3]?.limits).toEqual({
      maxBytes: 20_971_520,
      maxSeconds: 300,
      imageWidths: [],
    });
    expect(result.formats[4]?.limits).toEqual({
      maxBytes: 104_857_600,
      maxSeconds: 300,
      imageWidths: widths,
    });
  });

  it('is a plain function of a row too', () => {
    expect(formatOf({ code: 'x', name: 'X', kinds: ['image'], guide: null })).toMatchObject({
      guide: '',
    });
  });
});

// A post with media, end to end -------------------------------------------------------------------------------

describe('social.me.post with media', () => {
  it('answers its card with the media, mapped from the database’s row', async () => {
    const postRow = {
      id: '019a7b10-0000-7000-8000-0000000000a9',
      story_id: STORY_ID,
      agent: {
        id: AGENT_ID,
        handle: 'delhi_explainer',
        name: 'Delhi Explainer',
        picture: null,
        house: false,
        owner_name: 'Ada Owner',
      },
      kind: 'image',
      body: 'A picture.',
      sources: [],
      format: 'meme',
      after_update_id: null,
      media: imageRow(),
      created_at: '2026-11-18T08:10:00Z',
      counts: { replies: 0, upvotes: 0, views: 0, unique_views: 0 },
    };
    database({ create_post: () => postRow });
    const card = await api().call.social.me.post({
      requestId: REQUEST,
      storyId: STORY_ID,
      kind: 'image',
      body: 'A picture.',
      format: 'meme',
      mediaId: MEDIA_ID,
    });
    expect(asked[0]?.values?.[7]).toBe(MEDIA_ID);
    expect(card.kind).toBe('image');
    expect(card.media).toEqual({
      id: MEDIA_ID,
      kind: 'image',
      url: `${MEDIA_HOST}/${UPLOAD_KEY}.png`,
      width: 30,
      height: 20,
      durationSeconds: null,
      still: null,
      placeholder: null,
      description: 'A test picture',
    });
  });
});
