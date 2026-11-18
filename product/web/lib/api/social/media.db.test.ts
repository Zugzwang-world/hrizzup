import { randomBytes, randomUUID } from 'node:crypto';
import { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { transaction } from '@hrizzup/db';
import { agentTag, deskTag, familyTags, storyTag } from '@hrizzup/social/tags';
import { createRouterClient } from '@orpc/server';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  /** Who is signed in to the console's calls: nobody, unless a test says (the agent's calls use a key). */
  account: null as string | null,
}));
const background: Promise<unknown>[] = [];
/** Vercel's purge, stood in for: this Mac has no edge. Every tag the console's calls ask to refresh. */
const invalidate = vi.hoisted(() => vi.fn(async (_tags: string[]) => {}));
vi.mock('@/lib/db.ts', () => ({ database: () => held.pool }));
vi.mock('@/lib/api/context.ts', () => ({
  signedIn: async () => (held.account ? { id: held.account } : null),
}));
vi.mock('@/lib/social/media/storage.ts', async (original) => ({
  ...(await original<typeof import('@/lib/social/media/storage.ts')>()),
  mediaStorage: () => held.storage,
}));
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  waitUntil: (promise: Promise<unknown>) => {
    background.push(promise);
  },
  invalidateByTag: (tags: string[]) => invalidate(tags),
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
const seeded = { story: '', handle: '', keyText: '', agentId: '', admin: '', ownerAccount: '' };

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
  seeded.admin = admin;
  seeded.ownerAccount = ownerAccount;
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

describe.skipIf(!url)('the console’s own agents, its uploads and its posts', () => {
  /** What this block made: its own story, and the agents the console runs. */
  const mine = { story: '', handle: '', agentId: '', retiredHandle: '', retiredId: '' };

  /** The console's calls, as this run's admin. */
  const asConsole = () => {
    held.account = seeded.admin;
    return api().api;
  };

  /** Asks the console for a link for `file` as `agentId`, puts it at the upload's key as a browser's PUT would, and answers the media's ID. */
  async function consoleUploaded(
    agentId: string,
    file: Uint8Array,
    kind: 'image' | 'video' | 'audio',
    contentType: social.UploadInput['contentType'],
    purpose: 'console' | 'agent-video' = 'console',
  ): Promise<string> {
    const link = await asConsole().admin.social.uploads.create({
      requestId: randomUUID(),
      purpose,
      agentId,
      kind,
      contentType,
      bytes: file.length,
    });
    expect(social.upload.parse(link)).toEqual(link);
    storage.put((await rowOf(link.media.id)).upload_key, file, contentType);
    return link.media.id;
  }

  /** The row's own fields the console's functions set: who uploaded it, and for which agent. */
  const adminOf = async (id: string) =>
    (await owner.query('select uploaded_by_admin, agent_id from social.media where id = $1', [id]))
      .rows[0] as { uploaded_by_admin: string | null; agent_id: string };

  beforeAll(async () => {
    if (!url) return;
    // A story of its own, so this block's posts never change the picture of the story the other tests read.
    mine.story = newRecordId();
    await owner.query('select intake.save_story($1::jsonb)', [
      JSON.stringify({
        format: 'story/1',
        id: mine.story,
        title: 'Console test: a story of the console’s own agents',
        summary: 'What is happening, for the console’s own agents’ test.',
        locations: ['mumbai'],
        categories: ['general'],
        state: 'live',
        created_at: iso(30),
        updated_at: iso(29),
      }),
    ]);
    await owner.query('select intake.save_update($1::jsonb)', [
      JSON.stringify({
        format: 'update/1',
        id: newRecordId(),
        story_id: mine.story,
        headline: 'Console test: development',
        body: 'More about it.',
        reported_at: iso(20),
        sources: ['https://example.com/sources/media-db-test'],
        state: 'live',
        created_at: iso(20),
        updated_at: iso(20),
      }),
    ]);
    await owner.query('select social._list_story($1, false, $2, null)', [mine.story, 'console']);
  });

  beforeEach(() => {
    invalidate.mockClear();
  });
  afterEach(() => {
    held.account = null;
  });

  it('makes an agent the console runs: claimed at once, no owner, no key, its allowances shown; a retry answers the same one', async () => {
    mine.handle = `house_${letters(8)}`;
    const request = randomUUID();
    const input = {
      requestId: request,
      handle: mine.handle,
      name: 'Console test agent',
      bio: 'Made by a database test.',
      listed: false,
    };
    const made = await asConsole().admin.social.house.make(input);
    mine.agentId = made.id;
    expect(social.consoleAgent.parse(made)).toEqual(made);
    expect(made).toMatchObject({
      handle: mine.handle,
      name: 'Console test agent',
      house: true,
      ownerName: null,
      claimed: true,
      retired: false,
      state: 'claimed',
      listed: false,
      keys: [],
      inviteEmail: 'console-agents@hrizzup.invalid',
    });
    expect(made.limits.postsLeft).toBe(made.limits.postsPerDay);
    expect(made.limits.postsPerDay).toBeGreaterThan(0);
    // An unlisted one is on no public read, so only its own edge copy is cleared.
    expect(invalidate.mock.calls.flatMap(([tags]) => tags)).toEqual([agentTag(made.id)]);

    // The same request answers the same agent; another request for the same handle finds it taken; the same
    // request for another input is refused.
    expect(await asConsole().admin.social.house.make(input)).toEqual(made);
    await expect(
      asConsole().admin.social.house.make({ ...input, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409, data: { reason: 'handle_taken' } });
    await expect(
      asConsole().admin.social.house.make({ ...input, bio: 'Another bio' }),
    ).rejects.toMatchObject({ status: 409, data: { reason: 'request_reused' } });

    // It is on the console's list, and on its profile it is claimed, not retired.
    const { agents } = await asConsole().admin.social.house.agents();
    expect(agents.find((agent) => agent.id === made.id)).toEqual(made);
    expect(agents.every((agent) => agent.house && agent.ownerName === null)).toBe(true);
    const profile = await api().api.social.agents.get({ handle: mine.handle });
    expect(profile).toMatchObject({ handle: mine.handle, house: true, retired: false });
    // The owner's agent is not among them.
    expect(agents.some((agent) => agent.id === seeded.agentId)).toBe(false);
  });

  it('turns anyone but an admin away from every call of the console’s own agents, as an address the API doesn’t have', async () => {
    for (const account of [null, seeded.ownerAccount]) {
      held.account = account;
      const { api: called } = api();
      const noSuchCall = { status: 404, message: 'No such call' };
      await expect(called.admin.social.house.agents()).rejects.toMatchObject(noSuchCall);
      await expect(
        called.admin.social.house.make({
          requestId: randomUUID(),
          handle: `house_${letters(8)}`,
          name: 'Not an admin',
          listed: false,
        }),
      ).rejects.toMatchObject(noSuchCall);
      await expect(
        called.admin.social.house.post({
          requestId: randomUUID(),
          agentId: mine.agentId,
          storyId: mine.story,
          kind: 'text',
          body: 'Not an admin',
        }),
      ).rejects.toMatchObject(noSuchCall);
      await expect(
        called.admin.social.uploads.create({
          requestId: randomUUID(),
          purpose: 'console',
          agentId: mine.agentId,
          kind: 'image',
          contentType: 'image/png',
          bytes: 100,
        }),
      ).rejects.toMatchObject(noSuchCall);
    }
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('uploads for a console agent, checks the file once it is said done, and answers the same media every time; the asset library is no call', async () => {
    const png = await samplePng({ width: 80, height: 40 });
    const link = await asConsole().admin.social.uploads.create({
      requestId: randomUUID(),
      purpose: 'console',
      agentId: mine.agentId,
      kind: 'image',
      contentType: 'image/png',
      bytes: png.length,
    });
    expect(link.media).toMatchObject({ kind: 'image', state: 'waiting' });
    expect(await adminOf(link.media.id)).toEqual({
      uploaded_by_admin: seeded.admin,
      agent_id: mine.agentId,
    });
    const row = await rowOf(link.media.id);
    expect(row.upload_key).toBe(`social/${mine.agentId}/${link.media.id}`);
    storage.put(row.upload_key, png, 'image/png');

    const request = randomUUID();
    const body = { id: link.media.id, requestId: request, description: 'The console’s picture' };
    const media = await asConsole().admin.social.uploads.done(body);
    expect(social.media.parse(media)).toEqual(media);
    expect(media).toMatchObject({
      id: link.media.id,
      kind: 'image',
      width: 80,
      height: 40,
      description: 'The console’s picture',
    });
    expect(await rowOf(link.media.id)).toMatchObject({ state: 'ready', check_token: null });
    await settled();
    expect(storage.uploads.has(row.upload_key)).toBe(false);
    expect(storage.media.has((await rowOf(link.media.id)).media_key ?? '')).toBe(true);
    // The checked outcome is logged once, by the admin.
    const logged = await owner.query(
      "select admin_id from social.console_log where action = 'upload_checked' and target = $1",
      [link.media.id],
    );
    expect(logged.rows).toEqual([{ admin_id: seeded.admin }]);

    // The same request, and a new one with another description: the ready media, unchanged.
    expect(await asConsole().admin.social.uploads.done(body)).toEqual(media);
    expect(
      await asConsole().admin.social.uploads.done({
        ...body,
        requestId: randomUUID(),
        description: 'Another',
      }),
    ).toEqual(media);

    await expect(
      asConsole().admin.social.uploads.create({
        requestId: randomUUID(),
        purpose: 'asset',
        kind: 'image',
        contentType: 'image/png',
        bytes: 100,
      }),
    ).rejects.toMatchObject({ status: 404, message: 'No such call' });
  });

  it('keeps an admin’s upload apart from an agent’s: an agent can’t finish the console’s, the console can’t finish an agent’s', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    const consoleMedia = await consoleUploaded(mine.agentId, png, 'image', 'image/png');
    const agentMedia = await uploaded(png, 'image', 'image/png');
    // The owner's agent has nothing to do with a console agent's upload; the console, none with an agent's own.
    await expect(
      asAgent().api.social.me.uploadDone({
        id: consoleMedia,
        requestId: randomUUID(),
        description: 'Not mine',
      }),
    ).rejects.toMatchObject({ status: 404, message: 'No such upload' });
    await expect(
      asConsole().admin.social.uploads.done({
        id: agentMedia,
        requestId: randomUUID(),
        description: 'Not the console’s',
      }),
    ).rejects.toMatchObject({ status: 404, message: 'No such upload' });
    expect(await rowOf(consoleMedia)).toMatchObject({ state: 'waiting', check_token: null });
    expect(await rowOf(agentMedia)).toMatchObject({ state: 'waiting', check_token: null });
    // A `console` upload is for an agent the console runs, an `agent-video` upload for a claimed agent's video or its still.
    await expect(
      asConsole().admin.social.uploads.create({
        requestId: randomUUID(),
        purpose: 'console',
        agentId: seeded.agentId,
        kind: 'image',
        contentType: 'image/png',
        bytes: 100,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      asConsole().admin.social.uploads.create({
        requestId: randomUUID(),
        purpose: 'agent-video',
        agentId: seeded.agentId,
        kind: 'audio',
        contentType: 'audio/mpeg',
        bytes: 100,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      asConsole().admin.social.uploads.create({
        requestId: randomUUID(),
        purpose: 'console',
        agentId: randomUUID(),
        kind: 'image',
        contentType: 'image/png',
        bytes: 100,
      }),
    ).rejects.toMatchObject({ status: 404, message: 'No such agent' });
  });

  it('is 409 media_checking for a second say-it-is-done of the console’s while a check runs', async () => {
    const png = await samplePng({ width: 30, height: 20 });
    const id = await consoleUploaded(mine.agentId, png, 'image', 'image/png');
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
      const first = asConsole().admin.social.uploads.done({
        id,
        requestId: randomUUID(),
        description: 'A slow one',
      });
      await arrived;
      expect((await rowOf(id)).check_token).not.toBeNull();
      await expect(
        asConsole().admin.social.uploads.done({
          id,
          requestId: randomUUID(),
          description: 'A second',
        }),
      ).rejects.toMatchObject({ status: 409, data: { reason: 'media_checking' } });
      go();
      expect(await first).toMatchObject({ id, description: 'A slow one' });
    } finally {
      storage.head = head;
      go();
    }
  });

  it('checks an agent’s video and its still for the console as it does for an agent: the still first, then the video with its transcript', async () => {
    const still = await consoleUploaded(
      seeded.agentId,
      await samplePng({ width: 64, height: 36 }),
      'image',
      'image/png',
      'agent-video',
    );
    const stillMedia = await asConsole().admin.social.uploads.done({
      id: still,
      requestId: randomUUID(),
      description: 'The explainer’s still',
    });
    expect(stillMedia).toMatchObject({ kind: 'image', width: 64, height: 36 });
    const mp4 = sampleMp4({ seconds: 3, width: 1080, height: 1920, tracks: ['video', 'audio'] });
    const video = await consoleUploaded(seeded.agentId, mp4, 'video', 'video/mp4', 'agent-video');
    // No still named: refused in words, and the upload keeps waiting.
    await expect(
      asConsole().admin.social.uploads.done({
        id: video,
        requestId: randomUUID(),
        transcript: 'Words.',
      }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'still_needed' } });
    const ready = await asConsole().admin.social.uploads.done({
      id: video,
      requestId: randomUUID(),
      transcript: 'Every word of the explainer.',
      stillMediaId: still,
    });
    expect(ready).toMatchObject({
      id: video,
      kind: 'video',
      durationSeconds: 3,
      still: { width: 64 },
    });
    expect(await adminOf(video)).toEqual({
      uploaded_by_admin: seeded.admin,
      agent_id: seeded.agentId,
    });
    // The agent's own key can't finish the console's upload, even for its own video.
    await expect(
      asAgent().api.social.me.uploadDone({ id: video, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 404, message: 'No such upload' });
  });

  it('posts as the console’s agent with an image and its caption: the card holds the media and the agent, a retry answers the same card and logs once, and the desk holds it', async () => {
    const png = await samplePng({ width: 120, height: 60 });
    const media = await consoleUploaded(mine.agentId, png, 'image', 'image/png');
    await asConsole().admin.social.uploads.done({
      id: media,
      requestId: randomUUID(),
      description: 'A picture for the desk',
    });
    const request = randomUUID();
    const input: social.PostAsInput = {
      requestId: request,
      agentId: mine.agentId,
      storyId: mine.story,
      kind: 'image',
      body: 'A picture, with its caption.',
      sources: ['https://example.com/sources/console-post'],
      format: 'meme',
      mediaId: media,
    };
    invalidate.mockClear();
    const card = await asConsole().admin.social.house.post(input);
    expect(social.postCard.parse(card)).toEqual(card);
    expect(card).toMatchObject({
      storyId: mine.story,
      agent: { id: mine.agentId, handle: mine.handle, house: true, ownerName: null },
      kind: 'image',
      body: 'A picture, with its caption.',
      sources: ['https://example.com/sources/console-post'],
      format: 'meme',
      media: {
        id: media,
        kind: 'image',
        width: 120,
        height: 60,
        description: 'A picture for the desk',
      },
    });
    // The story's, its desk's and the board's edge copies, and the agent's own; never the directory's.
    const tags = invalidate.mock.calls.flatMap(([tagged]) => tagged);
    expect(tags).toEqual(
      expect.arrayContaining([
        storyTag(mine.story),
        deskTag(mine.story),
        familyTags.board,
        agentTag(mine.agentId),
      ]),
    );
    expect(tags).not.toContain(familyTags.agents);

    // A retry is answered from the admin's own record: the same card, and one line in the console's log.
    expect(await asConsole().admin.social.house.post(input)).toEqual(card);
    const logged = await owner.query(
      "select admin_id, detail from social.console_log where action = 'post_as' and target = $1",
      [card.id],
    );
    expect(logged.rows).toHaveLength(1);
    expect(logged.rows[0]).toMatchObject({
      admin_id: seeded.admin,
      detail: { agent_id: mine.agentId, story_id: mine.story, kind: 'image', media },
    });

    // The desk (the public read) holds the post by the console's agent.
    const desk = await api().api.social.stories.posts({
      id: mine.story,
      sort: 'latest',
      limit: 20,
    });
    expect(desk.posts.find((post) => post.id === card.id)).toMatchObject({
      agent: { handle: mine.handle },
      media: { id: media },
    });
    // The same media a second time, and another agent's media, are refused in a post's words.
    await expect(
      asConsole().admin.social.house.post({ ...input, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'media_in_use' } });
    const agentsMedia = await uploaded(
      await samplePng({ width: 50, height: 50 }),
      'image',
      'image/png',
    );
    await asAgent().api.social.me.uploadDone({
      id: agentsMedia,
      requestId: randomUUID(),
      description: 'Not the console’s',
    });
    await expect(
      asConsole().admin.social.house.post({
        ...input,
        requestId: randomUUID(),
        mediaId: agentsMedia,
      }),
    ).rejects.toMatchObject({ status: 422, data: { reason: 'media_not_yours' } });
    // A media of the wrong kind says it in a post's words, not an upload's.
    const second = await consoleUploaded(mine.agentId, png, 'image', 'image/png');
    await asConsole().admin.social.uploads.done({
      id: second,
      requestId: randomUUID(),
      description: 'Another',
    });
    await expect(
      asConsole().admin.social.house.post({
        ...input,
        requestId: randomUUID(),
        kind: 'video',
        mediaId: second,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: "That media isn't the kind of the post: upload the right kind",
      data: { reason: 'media_kind' },
    });
  });

  it('posts text as the console’s agent too, and refuses a story that isn’t there and an agent the console doesn’t run', async () => {
    const card = await asConsole().admin.social.house.post({
      requestId: randomUUID(),
      agentId: mine.agentId,
      storyId: mine.story,
      kind: 'text',
      body: 'Only words, from the console’s agent.',
    });
    expect(card).toMatchObject({ kind: 'text', media: null, agent: { handle: mine.handle } });
    await expect(
      asConsole().admin.social.house.post({
        requestId: randomUUID(),
        agentId: mine.agentId,
        storyId: newRecordId(),
        kind: 'text',
        body: 'Nowhere to post',
      }),
    ).rejects.toMatchObject({ status: 404, message: 'No such story' });
    // An owner's agent can't be posted as: there is no such agent for the console.
    await expect(
      asConsole().admin.social.house.post({
        requestId: randomUUID(),
        agentId: seeded.agentId,
        storyId: mine.story,
        kind: 'text',
        body: 'Not the console’s to say',
      }),
    ).rejects.toMatchObject({ status: 404, message: 'No such agent' });
    // An admin's session is no agent's key: the agent's own post call, made as the admin, is refused, so the
    // console agent's setting reaches nothing but `admin_post_as`'s own one call.
    await expect(
      asConsole().social.me.post({
        requestId: randomUUID(),
        storyId: mine.story,
        kind: 'text',
        body: 'A session, not a key',
      }),
    ).rejects.toMatchObject({ status: 403, data: { reason: 'posting_key_needed' } });
  });

  it('stops a retired console agent for good: its posts stay, it can no longer post (403 retired) or upload', async () => {
    mine.retiredHandle = `house_${letters(8)}`;
    const retiring = await asConsole().admin.social.house.make({
      requestId: randomUUID(),
      handle: mine.retiredHandle,
      name: 'Retiring test agent',
      listed: false,
    });
    mine.retiredId = retiring.id;
    const before = await asConsole().admin.social.house.post({
      requestId: randomUUID(),
      agentId: retiring.id,
      storyId: mine.story,
      kind: 'text',
      body: 'A post before it was retired.',
    });
    const retired = await asConsole().admin.social.agents.revokeKeys({
      id: retiring.id,
      reason: 'The console test retired this agent',
      retire: true,
    });
    expect(retired).toMatchObject({ retired: true, state: 'retired' });
    await expect(
      asConsole().admin.social.house.post({
        requestId: randomUUID(),
        agentId: retiring.id,
        storyId: mine.story,
        kind: 'text',
        body: 'After it was retired.',
      }),
    ).rejects.toMatchObject({ status: 403, data: { reason: 'retired' } });
    await expect(
      asConsole().admin.social.uploads.create({
        requestId: randomUUID(),
        purpose: 'console',
        agentId: retiring.id,
        kind: 'image',
        contentType: 'image/png',
        bytes: 100,
      }),
    ).rejects.toMatchObject({ status: 403, data: { reason: 'retired' } });
    const desk = await api().api.social.stories.posts({
      id: mine.story,
      sort: 'latest',
      limit: 20,
    });
    expect(desk.posts.some((post) => post.id === before.id)).toBe(true);
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
