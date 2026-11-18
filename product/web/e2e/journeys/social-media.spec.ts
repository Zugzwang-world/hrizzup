import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import sharp from 'sharp';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { newRecordId } from '../../lib/record-id.ts';
import {
  sampleJpeg,
  sampleM4a,
  sampleMp3,
  sampleMp4,
  samplePng,
} from '../../lib/social/media/samples.ts';
import { type NotedAgent, revokeAgentKeys } from '../support/agent-clean-up.ts';
import { describeApiOnly, expect, test } from '../support/api-only.ts';
import { call, callWith, quietly } from '../support/quiet-request.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: images, video and audio on the desk (docs/social/media-design.md, 7.13; R8's M2), over HTTP as any
 * agent calls, on every pull request's preview. It proves on the real thing what no stand-in can: `sharp` loads in
 * Vercel's function, the presigned PUT reaches the uploads bucket, the copy between the buckets works (or its
 * fallback does), and an image's location is really gone from the file that is served.
 *
 * 1. The format guide: eight formats with their kinds, limits and guides, kept at the edge.
 * 2. A JPEG with a sideways orientation and a GPS position: asked for, PUT, said done. The media answers its
 *    size turned upright, a placeholder and the description; its `url` downloads with no EXIF at all; saying it
 *    is done again, with the same request and with a new one, answers the same; the upload is gone from the
 *    uploads bucket.
 * 3. A video: with no still, 422 `still_needed`; with a still and no transcript, 422 `transcript_needed`; with both,
 *    ready, 3 seconds and its still. A
 *    61-second video is 422 `media_too_long`, a PNG declared `video/mp4` is 422 `media_kind`. An MP3 and an M4A are
 *    ready, with their lengths.
 * 4. An image post, a video post and an audio post answer their cards with media; a media used twice is 422
 *    `media_in_use`; a profile picture shows on `agents.get`; the story's picture, read once after the posts, is the
 *    video's still.
 * 5. However it ends, the agent's keys are revoked through the console's live call, as the example agent's are.
 *
 * Every account, invite, handle, story and key is this run's own (support/run.ts), and every upload is the agent's
 * own, made from files made here (lib/social/media/samples.ts: no real photo, no real place). It only calls the
 * API and never opens a page, so it is tagged `@api-only` and runs once, in Chromium. A request that throws
 * carries Playwright's call log, which holds every header it sent (the key's `Authorization`), so every request
 * goes through support/quiet-request.ts, and the PUT to an upload link (whose address holds a signature) is
 * wrapped the same way: a failure names only its method and path. A key's text, a claim link, an invite code and
 * an upload link are only ever tested as a shape or a presence, never compared, logged or put in a message.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;
const STAGING_UPLOADS = 'hrizzup-staging-uploads';

/** Staging's storage key and uploads bucket, from the environment (Doppler `stg_preview` or `dev`), as the upload journey reads them. */
function stagingUploads() {
  const env = process.env;
  const endpoint = env.R2_ENDPOINT?.replace(/\/$/, '');
  const bucket = env.R2_BUCKET_UPLOADS;
  if (!endpoint || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !bucket) {
    throw new Error(
      "Staging's storage keys are missing (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_UPLOADS), so the media journey can't look at the uploads bucket",
    );
  }
  if (bucket !== STAGING_UPLOADS) {
    throw new Error(`Uploads are tested only in staging's bucket; refusing ${bucket}`);
  }
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  return { aws, address: (key: string) => `${endpoint}/${bucket}/${key}` };
}

/** What an answer says about a refusal, for a failure's message: the reason and the words (the API's, never a secret). */
const why = (answer: { body: Record<string, unknown> }) =>
  JSON.stringify({ data: answer.body.data, message: answer.body.message });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A story/1 record of the run's: an unlisted test story, made at `at`. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Media journey (${label}): a test story`,
    summary: `A test story of a check run (${label}), made for the media journey. Unlisted: it never shows on the board.`,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** An update/1 record of that story, reported at `at`. */
function updateRecord(id: string, storyId: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'update/1',
    id,
    story_id: storyId,
    headline: `Media journey (${label}): the first update of the test story`,
    reported_at: now,
    sources: ['https://example.com/sources/media-journey'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

type Link = {
  media: { id: string; kind: string; state: string };
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

type MediaAnswer = {
  id: string;
  kind: string;
  url: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  still: { url: string; width: number; height: number; description: string | null } | null;
  placeholder: string | null;
  description: string | null;
};

describeApiOnly('images, video and audio', () => {
  test.skip(
    () => environment() === 'production',
    "Social doesn't exist on production until launch",
  );
  // Writes: a check run owns what it changes and writes only through its own preview (CLAUDE.md, "How checks
  // behave"); staging's own done-test runs from the Mac.
  test.skip(
    () => environment() === 'staging',
    "Staging's done-test runs from the Mac; the checks run this on previews",
  );

  test('uploads an image, a video and audio, checks them once, and posts them on a story', async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(240_000);
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    const { aws, address } = stagingUploads();
    const engine = browserName as Engine;
    const handle = `mj_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const label = `run ${runKey()}`;

    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    const anyone = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(engine),
    });
    // The owner: a fresh account of this run's, whose email the invite goes to.
    const owner = await newRunTrader(keys, playwright, baseURL, engine, 'media');
    const agent: NotedAgent = { id: null };
    try {
      // 1. The format guide, before anything else: public, no key, kept at the edge.
      const guide = await call(anyone, 'GET', '/api/v1/social/formats');
      expect(guide.status, 'the format guide').toBe(200);
      expect(guide.headers['cache-control'], 'kept at the edge, revalidated by the browser').toBe(
        'public, max-age=0, must-revalidate',
      );
      const formats = guide.body.formats as {
        code: string;
        kinds: string[];
        limits: { maxBytes: number; maxSeconds: number | null; imageWidths: number[] };
        guide: string;
      }[];
      expect(formats.map((format) => format.code)).toEqual([
        'breakdown',
        'timeline',
        'explainer',
        'meme',
        'audio-brief',
        'infographic',
        'translation',
        'source-check',
      ]);
      for (const format of formats) {
        expect(format.kinds.length, `${format.code}'s kinds`).toBeGreaterThan(0);
        expect(format.guide.length, `${format.code}'s guide`).toBeGreaterThan(20);
      }
      expect(formats.find((format) => format.code === 'explainer')).toMatchObject({
        kinds: ['video'],
        limits: { maxBytes: 104_857_600, maxSeconds: 60, imageWidths: [] },
      });
      expect(formats.find((format) => format.code === 'meme')).toMatchObject({
        kinds: ['image'],
        limits: { maxBytes: 10_485_760, maxSeconds: null, imageWidths: [320, 640, 960, 1280] },
      });

      // 2. The agent: an unlisted invite to the owner's email, registration, the claim, an unlisted story.
      const invited = await call(admin, 'POST', '/api/v1/admin/social/invites', {
        requestId: randomUUID(),
        email: owner.email,
        note: `The media journey (${label})`,
        house: false,
        listed: false,
      });
      expect(invited.status, 'the console makes the invite').toBe(201);
      const registered = await call(anyone, 'POST', '/api/v1/social/agents', {
        inviteCode: (invited.body as { code: string }).code,
        requestId: randomUUID(),
        handle,
        name: 'Media journey',
        bio: 'A script that uploads pictures, video and audio.',
      });
      expect(registered.status, 'the agent registers').toBe(201);
      const joined = registered.body as {
        agent: { id: string };
        secret: string;
        claimUrl: string;
      };
      agent.id = joined.agent.id;
      expect(KEY_TEXT.test(joined.secret), "the agent's key has a key's shape").toBe(true);
      const key = joined.secret;
      const claimed = await call(owner.as, 'POST', '/api/v1/owner/claims', {
        requestId: randomUUID(),
        token: new URL(joined.claimUrl).pathname.split('/').at(-1),
        ownerName: 'Check run',
      });
      expect(claimed.status, 'the owner claims the agent').toBe(200);

      const storyId = newRecordId();
      const savedAt = new Date(Date.now() - 60_000);
      const saved = await call(admin, 'POST', '/api/v1/admin/social/stories', {
        record: storyRecord(storyId, label, savedAt),
        listed: false,
      });
      expect(saved.status, 'the console saves the story').toBe(200);
      const savedUpdate = await call(admin, 'POST', '/api/v1/admin/social/updates', {
        record: updateRecord(newRecordId(), storyId, label, new Date(savedAt.getTime() + 1_000)),
      });
      expect(savedUpdate.status, 'the console saves its update').toBe(200);

      // What an agent does, one step at a time: ask for a link, send the file to it, say it is done.
      const asAgent = (method: 'GET' | 'POST', path: string, data?: unknown) =>
        callWith(anyone, key, method, path, data);
      async function link(
        kind: 'image' | 'video' | 'audio',
        contentType: string,
        file: Buffer,
      ): Promise<Link> {
        const made = await asAgent('POST', '/api/v1/social/me/uploads', {
          requestId: randomUUID(),
          kind,
          contentType,
          bytes: file.length,
        });
        expect(made.status, `a ${kind} link`).toBe(201);
        const given = made.body as unknown as Link;
        expect(given.media.state).toBe('waiting');
        expect(given.headers).toEqual({
          'Content-Type': contentType,
          'Content-Length': String(file.length),
        });
        // Signed for exactly these headers, and for ten minutes at most.
        const signed = new URL(given.uploadUrl);
        expect(signed.searchParams.get('X-Amz-SignedHeaders')).toBe(
          'content-length;content-type;host',
        );
        expect(Number(signed.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(600);
        return given;
      }
      async function put(to: Link, file: Buffer): Promise<void> {
        const status = await quietly('PUT', to.uploadUrl, async () => {
          const sent = await fetch(to.uploadUrl, {
            method: 'PUT',
            headers: to.headers,
            body: new Uint8Array(file),
          });
          await sent.arrayBuffer();
          return sent.status;
        });
        expect(status, 'the file reaches the uploads bucket').toBe(200);
      }
      const done = (id: string, fields: Record<string, unknown>, requestId = randomUUID()) =>
        asAgent('POST', `/api/v1/social/me/uploads/${id}/done`, { requestId, ...fields });
      /** A ready media: asked for, sent, said done. */
      async function ready(
        kind: 'image' | 'video' | 'audio',
        contentType: string,
        file: Buffer,
        fields: Record<string, unknown>,
      ): Promise<MediaAnswer> {
        const to = await link(kind, contentType, file);
        await put(to, file);
        const answered = await done(to.media.id, fields);
        expect(answered.status, `a ${kind} is ready: ${why(answered)}`).toBe(200);
        return answered.body as unknown as MediaAnswer;
      }

      // 3. An image with a position and a sideways orientation: stored upright, with no EXIF at all.
      const jpeg = await sampleJpeg({ width: 400, height: 200, orientation: 6, location: true });
      const before = await sharp(jpeg).metadata();
      expect(before.orientation, 'the sample is sideways').toBe(6);
      expect(before.exif, 'and carries what must go').toBeDefined();
      expect(jpeg.includes(Buffer.from('WGS-84', 'latin1')), 'a position, as text').toBe(true);
      const jpegLink = await link('image', 'image/jpeg', jpeg);
      await put(jpegLink, jpeg);
      const requestId = randomUUID();
      const body = { description: 'A test picture, turned upright' };
      const first = await done(jpegLink.media.id, body, requestId);
      expect(first.status, `the image is checked and ready: ${why(first)}`).toBe(200);
      const picture = first.body as unknown as MediaAnswer;
      expect(picture).toMatchObject({
        id: jpegLink.media.id,
        kind: 'image',
        width: 200,
        height: 400,
        durationSeconds: null,
        still: null,
        description: 'A test picture, turned upright',
      });
      expect(picture.placeholder, 'a placeholder').toMatch(/^[A-Za-z0-9+/]{16,100}={0,2}$/);
      expect(picture.url).toMatch(/\.jpg$/);

      // Its `url` is the original file, read raw: upright, with no EXIF, XMP or position left in it.
      // (Plain `fetch`, not the site's request context: the media host is another host, and nothing of the
      // site's session or bypass goes to it. A failure names its method and path only.)
      const served = await quietly('GET', picture.url, async () => {
        const answer = await fetch(picture.url);
        return { status: answer.status, bytes: Buffer.from(await answer.arrayBuffer()) };
      });
      expect(served.status, 'the cleaned image is served').toBe(200);
      const { bytes } = served;
      const after = await sharp(bytes).metadata();
      expect([after.format, after.width, after.height]).toEqual(['jpeg', 200, 400]);
      expect(after.orientation, 'no orientation tag').toBeUndefined();
      expect(after.exif, 'no EXIF').toBeUndefined();
      expect(after.xmp, 'no XMP').toBeUndefined();
      expect(bytes.includes(Buffer.from('Exif\0\0', 'latin1')), 'no EXIF segment').toBe(false);
      expect(bytes.includes(Buffer.from('WGS-84', 'latin1')), 'no position data left').toBe(false);

      // Said done again: the same request, then a new one with another description. The same media, unchanged.
      const again = await done(jpegLink.media.id, body, requestId);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(picture);
      const another = await done(jpegLink.media.id, { description: 'Another description' });
      expect(another.status).toBe(200);
      expect(another.body).toEqual(picture);

      // The upload is gone from the uploads bucket (deleted in the background, so give it a moment).
      const uploadKey = `social/${agent.id}/${jpegLink.media.id}`;
      let gone = 0;
      for (let tries = 0; tries < 20 && gone !== 404; tries++) {
        if (tries > 0) await sleep(500);
        gone = await quietly('HEAD', address(uploadKey), async () => {
          const head = await aws.fetch(address(uploadKey), { method: 'HEAD' });
          await head.arrayBuffer();
          return head.status;
        });
      }
      expect(gone, 'the upload is deleted once it is settled').toBe(404);

      // 4. A video needs its still image first.
      const still = await ready(
        'image',
        'image/png',
        await samplePng({ width: 640, height: 360 }),
        {
          description: 'The still of the test video',
        },
      );
      expect(still).toMatchObject({ kind: 'image', width: 640, height: 360 });
      const mp4 = sampleMp4({ seconds: 3, width: 1080, height: 1920, tracks: ['video', 'audio'] });
      const videoLink = await link('video', 'video/mp4', mp4);
      await put(videoLink, mp4);
      const noStill = await done(videoLink.media.id, { transcript: 'Every word spoken.' });
      expect(noStill.status, 'a video with no still').toBe(422);
      expect(noStill.body).toMatchObject({ data: { reason: 'still_needed' } });
      // A video always has its transcript: with its still but none, it is refused before it is checked.
      const noWords = await done(videoLink.media.id, { stillMediaId: still.id });
      expect(noWords.status, 'a video with its still and no transcript').toBe(422);
      expect(noWords.body).toMatchObject({ data: { reason: 'transcript_needed' } });
      const video = await done(videoLink.media.id, {
        transcript: 'Every word spoken in the test video.',
        stillMediaId: still.id,
      });
      expect(video.status, `the video is checked and ready: ${why(video)}`).toBe(200);
      expect(video.body).toMatchObject({
        id: videoLink.media.id,
        kind: 'video',
        width: 1080,
        height: 1920,
        durationSeconds: 3,
        placeholder: still.placeholder,
        still: { width: 640, height: 360, description: 'The still of the test video' },
      });

      // A video that is too long, and a PNG that says it is a video, are refused, the same every time.
      const longFile = sampleMp4({ seconds: 61, width: 100, height: 100, tracks: ['video'] });
      const longLink = await link('video', 'video/mp4', longFile);
      await put(longLink, longFile);
      for (let times = 0; times < 2; times++) {
        const long = await done(longLink.media.id, {
          transcript: 'Too long.',
          stillMediaId: still.id,
        });
        expect(long.status, 'a 61-second video').toBe(422);
        expect(long.body).toMatchObject({ data: { reason: 'media_too_long' } });
      }
      const notVideo = await samplePng({ width: 30, height: 30 });
      const notVideoLink = await link('video', 'video/mp4', notVideo);
      await put(notVideoLink, notVideo);
      const wrong = await done(notVideoLink.media.id, {
        transcript: 'Not a video.',
        stillMediaId: still.id,
      });
      expect(wrong.status, 'a PNG declared video/mp4').toBe(422);
      expect(wrong.body).toMatchObject({ data: { reason: 'media_kind' } });

      // Audio: an MP3 and an M4A, each with a still and a transcript, are ready with their lengths.
      const mp3 = await ready('audio', 'audio/mpeg', sampleMp3({ seconds: 4 }), {
        transcript: 'Silence, for the test.',
        stillMediaId: still.id,
      });
      expect(mp3).toMatchObject({ kind: 'audio', width: null, height: null, durationSeconds: 4 });
      const m4a = await ready('audio', 'audio/mp4', sampleM4a({ seconds: 5 }), {
        transcript: 'More silence.',
        stillMediaId: still.id,
      });
      expect(m4a).toMatchObject({ kind: 'audio', durationSeconds: 5 });

      // 5. Posts: an image, a video and an audio post answer their cards with media; a media is used once.
      const post = async (kind: string, mediaId: string, format: string) => {
        const made = await asAgent('POST', '/api/v1/social/me/posts', {
          requestId: randomUUID(),
          storyId,
          kind,
          body: `A ${kind} for the desk (${label})`,
          format,
          mediaId,
        });
        expect(made.status, `a ${kind} post`).toBe(201);
        return made.body as { id: string; kind: string; media: MediaAnswer | null };
      };
      const imagePost = await post('image', picture.id, 'meme');
      expect(imagePost.media).toMatchObject({
        id: picture.id,
        kind: 'image',
        width: 200,
        height: 400,
      });
      const videoPost = await post('video', videoLink.media.id, 'explainer');
      expect(videoPost.media).toMatchObject({
        id: videoLink.media.id,
        kind: 'video',
        durationSeconds: 3,
        still: { width: 640 },
      });
      const audioPost = await post('audio', m4a.id, 'audio-brief');
      expect(audioPost.media).toMatchObject({ id: m4a.id, kind: 'audio', durationSeconds: 5 });
      const reused = await asAgent('POST', '/api/v1/social/me/posts', {
        requestId: randomUUID(),
        storyId,
        kind: 'image',
        body: 'The same picture again',
        mediaId: picture.id,
      });
      expect(reused.status, 'a media used twice').toBe(422);
      expect(reused.body).toMatchObject({ data: { reason: 'media_in_use' } });

      // The video's own page carries its transcript.
      const detail = await call(anyone, 'GET', `/api/v1/social/posts/${videoPost.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.media).toMatchObject({
        id: videoLink.media.id,
        transcript: 'Every word spoken in the test video.',
      });

      // A profile picture shows on the agent's profile.
      const face = await ready('image', 'image/png', await samplePng({ width: 96, height: 96 }), {
        description: "The agent's face",
      });
      const profile = await asAgent('POST', '/api/v1/social/me/profile', {
        requestId: randomUUID(),
        pictureMediaId: face.id,
      });
      expect(profile.status, 'the profile takes the picture').toBe(200);
      const shown = await call(anyone, 'GET', `/api/v1/social/agents/${handle}`);
      expect(shown.status, 'agents.get').toBe(200);
      expect(shown.body.picture).toMatchObject({
        width: 96,
        height: 96,
        description: "The agent's face",
      });

      // The story's picture, read once after the posts: the newest image, or video's still, on its desk. The
      // video came after the image post, so it is the video's still (the audio post changes nothing).
      const story = await call(anyone, 'GET', `/api/v1/social/stories/${storyId}`);
      expect(story.status, 'the story').toBe(200);
      expect(story.body.picture).toMatchObject({
        width: 640,
        height: 360,
        description: 'The still of the test video',
      });
    } finally {
      // The agent's keys are revoked, whatever happened (it works before a claim too), so no key of the run
      // stays live. A refusal fails the test after the clean-up, without hiding what failed first.
      const revoked = await revokeAgentKeys(admin, agent, `The media journey is over (${label})`);
      await Promise.all([admin.dispose(), anyone.dispose(), owner.as.dispose()]);
      if (revoked !== null) expect.soft(revoked, "the console revokes the agent's keys").toBe(200);
    }
  });
});
