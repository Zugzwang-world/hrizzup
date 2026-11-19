import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
  webkit,
} from '@playwright/test';
import lighthouse from 'lighthouse';
import puppeteer from 'puppeteer-core';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { playLabel } from '../../lib/social/media/label.ts';
import { budgets } from '../pages.ts';
import { judge, type LighthouseResult, metricsFromLighthouse, RUNS, summarize } from '../speed.ts';
import { type NotedAgent, revokeAgentKeys } from '../support/agent-clean-up.ts';
import { asBrowserCookie } from '../support/bypass.ts';
import { fitsEverywhere } from '../support/fits-everywhere.ts';
import { call, callWith, quietly } from '../support/quiet-request.ts';
import { runAddress, runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { sessionFor, stagingKeys } from '../support/test-accounts.ts';

/**
 * The founder's done-test of Round 6's R8 (docs/social/media-design.md, sections 9 and 12: images, video and audio on
 * the desk, and "Post as Hrizzup" in the console): on a listed test story a fresh agent posts an image, a video
 * under a minute with its still image and transcript, and audio; the console's admin test account posts an image as
 * Hrizzup from the console's own page; and a reader who is signed out sees each on the desk, loads the video and
 * the audio on a tap, and finds the newest picture on the story's tile on the board. On staging itself. Run by hand,
 * once, from this Mac, never by the checks (several minutes: it makes real files, uploads them, and measures the
 * board), once M4 is on staging:
 *   infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com \
 *     pnpm exec playwright test --config playwright.done.config.ts e2e/done/social-r8.spec.ts'
 * The path, as R7's (`social-7.3.spec.ts`) and R5's (`social-r5.spec.ts`) go: Doppler `stg` only, no bypass cookie, no
 * real email (the owner and the admin are signed in through staging's admin access), every account, invite, handle,
 * key and file the run's own:
 * 1. one listed test story ("Test story: media on the desk (R8's done-test, <date>, run <key>)") with one update,
 *    made through the console's saves, one category and one place;
 * 2. a fresh agent: an unlisted invite, a run account for its owner, its registration and the owner's claim;
 * 3. real, playable files made here, in a new folder outside the repository, with FFmpeg: a JPEG test pattern with a
 *    description, a 20-second vertical H.264 and AAC MP4 test pattern with a tone, its still image (a PNG frame) and
 *    a transcript, and a 30-second MP3 tone with its still image and a transcript (nothing of a real person, no
 *    place; nothing committed; the folder is deleted at the end). The agent uploads each through the API (a link, a
 *    PUT to it, "done"), then posts the image, the video and the audio, each with a caption and a source;
 * 4. in a real browser, as the console's admin test account: `/console/social/post`; the one listed console agent
 *    (the one-time form makes Hrizzup, handle `hrizzup`, when there is none), the story, an image of its own with a
 *    description, a caption and a source; Preview shows it; "Post as Hrizzup"; "Posted". This is the only place
 *    anything makes or posts as the listed Hrizzup, so the founder finds it ready;
 * 5. signed out, in Chromium and in WebKit (launched here: the done config runs Chromium only): the board's Latest
 *    order shows the story's tile with a thumbnail that is Hrizzup's image, the newest picture (read every 10 seconds
 *    for up to 4 minutes, in case the minute job is what settles it); then the story's page: all four posts, the
 *    thumbnail Hrizzup's, nothing of the video or the audio asked for before a tap, the video and the audio each
 *    loaded by a tap and really playing (its `currentTime` advances, with the size and length of the file made here,
 *    so the bytes are real, from staging's media host), and the video's own post page showing its transcript;
 * 6. the board's safety (the advisor's rule), run right after the tile shows its picture, in both engines: the fit pass
 *    of the Screen check (support/fits-everywhere.ts: every width, sideways, 200% text) on the board's Latest, on the
 *    board's own address (what the Speed check measures) and on the story's page, before and after the taps; and,
 *    in Chromium, a Lighthouse measure of the board (mobile preset, one uncounted warm-up, then the median of the
 *    Speed check's own runs, against the standard budget, with its tolerance: the Speed check's own arithmetic, from
 *    e2e/speed.ts, on both of those board addresses). If any of that fails, the story is withdrawn at once through the
 *    console's own save (as the admin test account, read back, with the console's page as the fallback), before
 *    the failure is thrown, so staging's board, which every pull request's checks read, is never left broken;
 * 7. at the end, whatever happened, the agent's keys are revoked (answering 200) and the folder is deleted. A run that
 *    passes leaves the story and its four posts listed, for the founder to look at: he withdraws the story in the
 *    console. One line prints the story's sandbox address, the board's and Hrizzup's profile.
 * A run that fails at any step after the story is made withdraws the story the same way (the console's save, read
 * back, the console's page as the fallback) before the failure is thrown, so only a run that passes ever leaves a
 * listed story on staging's board. Nothing is printed or logged that is a secret: a key, a claim link, an invite code or an upload
 * link is only ever checked as a shape or a presence, never compared, logged or put in a message; every request goes
 * through support/quiet-request.ts, which throws a new error naming only the method and the path, because a thrown
 * request's call log holds every header it sent (the PUT to an upload link, whose address holds a signature, is
 * wrapped the same way, and a browser's PUT is only counted and its status read). The speed measure is `lighthouse`
 * and `puppeteer-core`, as e2e/speed-check.ts uses them (a script that runs the whole page list when it is loaded,
 * so it can't be asked to measure one address), with the Chrome of this Mac (CHROME_PATH changes which).
 */

const BASE = process.env.BASE_URL ?? '';

/** How long a page is waited on for the board and the desk to settle, and how often it is read. */
const WAIT_MS = 4 * 60_000;
const EVERY_MS = 10_000;
/** How many pages of the board are looked through, by its "Next" link, for the story. */
const BOARD_PAGES = 3;

const FFMPEG = process.env.FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg';
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SOURCE = 'https://example.com/sources/social-r8-done-test';

/** What a transcript says: the files made here have a test pattern and a tone, and no words. */
const VIDEO_WORDS =
  "Nothing is said in this test video: a counter and a steady tone (R8's done-test).";
const AUDIO_WORDS =
  "Nothing is said in this test audio: a steady tone for thirty seconds (R8's done-test).";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What an answer says about a refusal, for a failure's message: the reason and the words (the API's, never a secret). */
const why = (answer: { body: Record<string, unknown> }) =>
  JSON.stringify({ data: answer.body.data, message: answer.body.message });

/** A value that must be there (a list's first item, an answer's field), or a failure that says what was missing. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// The files, made here with FFmpeg
// ---------------------------------------------------------------------------------------------

const run = promisify(execFile);

/** Runs FFmpeg with the arguments (no shell); a failure names FFmpeg's own words, which hold nothing but local paths. */
async function ffmpeg(args: string[]): Promise<void> {
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

type Files = {
  agentImage: Buffer;
  hrizzupImage: Buffer;
  video: Buffer;
  videoStill: Buffer;
  audio: Buffer;
  audioStill: Buffer;
};

/** The files of the run, in `folder`: test patterns and tones, with no metadata, and nothing of any person or place. */
async function makeFiles(folder: string): Promise<Files> {
  const at = (name: string) => join(folder, name);
  const bare = ['-map_metadata', '-1'];
  // Two different JPEG test patterns, so each post's picture can be told from the other's by its address alone.
  await ffmpeg([
    ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=1', '-frames:v', '1', '-q:v', '3'],
    ...bare,
    at('agent-image.jpg'),
  ]);
  await ffmpeg([
    ...['-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=1', '-frames:v', '1', '-q:v', '3'],
    ...bare,
    at('hrizzup-image.jpg'),
  ]);
  // A vertical 360 by 640 test pattern with a counter and a 440 Hz tone, 20 seconds, H.264 and AAC, a regular MP4
  // (its index first: the checks refuse a fragmented one).
  await ffmpeg([
    ...['-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=20'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=20'],
    ...['-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-preset', 'veryfast'],
    ...['-crf', '30', '-g', '50', '-c:a', 'aac', '-b:a', '64k', '-ac', '1'],
    ...['-movflags', '+faststart', '-shortest', '-fflags', '+bitexact'],
    ...['-flags:v', '+bitexact', '-flags:a', '+bitexact'],
    ...bare,
    at('video.mp4'),
  ]);
  // The video's still image: one of its own frames.
  await ffmpeg([
    ...['-ss', '2', '-i', at('video.mp4'), '-frames:v', '1'],
    ...bare,
    at('video-still.png'),
  ]);
  // Thirty seconds of a 330 Hz tone as MP3, with no tag and no index frame: nothing but audio frames.
  await ffmpeg([
    ...['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=30'],
    ...['-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', '-id3v2_version', '0', '-write_xing', '0'],
    ...['-fflags', '+bitexact'],
    ...bare,
    at('audio.mp3'),
  ]);
  await ffmpeg([
    ...['-f', 'lavfi', '-i', 'rgbtestsrc=size=640x360:rate=1', '-frames:v', '1'],
    ...bare,
    at('audio-still.png'),
  ]);
  const files: Files = {
    agentImage: await readFile(at('agent-image.jpg')),
    hrizzupImage: await readFile(at('hrizzup-image.jpg')),
    video: await readFile(at('video.mp4')),
    videoStill: await readFile(at('video-still.png')),
    audio: await readFile(at('audio.mp3')),
    audioStill: await readFile(at('audio-still.png')),
  };
  for (const [name, file] of Object.entries(files)) {
    expect(file.length, `the ${name} file made here has content`).toBeGreaterThan(1_000);
  }
  expect(files.video.subarray(4, 8).toString('latin1'), 'the video is an MP4').toBe('ftyp');
  return files;
}

// ---------------------------------------------------------------------------------------------
// The records of the run's story
// ---------------------------------------------------------------------------------------------

/** A story/1 record of the run's: a listed test story, made at `at`. */
function storyRecord(id: string, title: string, summary: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title,
    summary,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** An update/1 record of that story, reported at `at`. */
function updateRecord(id: string, storyId: string, headline: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'update/1',
    id,
    story_id: storyId,
    headline,
    reported_at: now,
    sources: [SOURCE],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

type MediaAnswer = {
  id: string;
  kind: string;
  url: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

type DeskPost = {
  id: string;
  kind: string;
  body: string;
  agent: { id: string; handle: string; house: boolean };
  media: MediaAnswer | null;
};

type ConsoleAgent = { id: string; handle: string; name: string; listed: boolean; state: string };

// ---------------------------------------------------------------------------------------------
// The speed measure
// ---------------------------------------------------------------------------------------------

/**
 * Lighthouse's mobile preset on each address, as e2e/speed-check.ts runs it (the performance and accessibility
 * categories, in the light scheme): one run that isn't counted first (a browser just opened and a site's cold first
 * visit are what the Speed check discards the same way), then the median of the Speed check's own number of runs on
 * each address, judged by the Speed check's own arithmetic against the standard budget, tolerance included.
 */
async function speedOf(
  addresses: string[],
): Promise<{ address: string; failing: string[]; says: string[] }[]> {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  try {
    const tab = await browser.newPage();
    await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    const measure = async (address: string) => {
      const result = await lighthouse(
        address,
        { logLevel: 'error', output: 'json', onlyCategories: ['performance', 'accessibility'] },
        undefined,
        tab,
      );
      if (!result) throw new Error('Lighthouse returned nothing for a board address');
      return metricsFromLighthouse(result.lhr as unknown as LighthouseResult, address);
    };
    await measure(must(addresses[0], 'The first board address')); // the warm-up, not counted
    const answers: { address: string; failing: string[]; says: string[] }[] = [];
    for (const address of addresses) {
      const runs = [];
      for (let at = 0; at < RUNS; at++) runs.push(await measure(address));
      const verdicts = judge(summarize(runs), budgets.standard);
      answers.push({
        address,
        failing: verdicts
          .filter((verdict) => !verdict.passes)
          .map((verdict) => `${verdict.label}: ${verdict.value} against ${verdict.limit}`),
        says: verdicts.map((verdict) => `${verdict.label} ${verdict.value} (${verdict.limit})`),
      });
    }
    return answers;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Pictures on a page
// ---------------------------------------------------------------------------------------------

/** Brings a picture into view (a lazy one loads only there) and waits until it has really loaded: `complete` is true for a failed picture too, so its width is read. */
async function pictureLoaded(picture: Locator, what: string): Promise<void> {
  await picture.scrollIntoViewIfNeeded();
  await expect
    .poll(() => picture.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0), {
      message: `${what} has loaded (a picture with a width)`,
      timeout: 90_000,
    })
    .toBe(true);
}

// ---------------------------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------------------------

test("R8's done-test: an agent posts an image, a video and audio, Hrizzup posts an image from the console; the desk shows each, the video and audio load on tap, and the board's tile shows the newest picture on staging", async ({
  playwright,
  browser,
}) => {
  // Every wait below is bounded (the polls at 4 minutes, a page at 30 seconds), so the longest run is well inside this:
  // the clean-up in `finally` always gets to run.
  test.setTimeout(2_400_000);
  expect(BASE, 'run against staging').toBe('https://staging.hrizzup.com');
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing (run with Doppler stg)");
  const key = runKey();
  const label = `run ${key}`;
  const today = new Date().toISOString().slice(0, 10);

  const folder = await mkdtemp(join(tmpdir(), 'hrizzup-r8-done-'));
  const anyone = await playwright.request.newContext({ baseURL: BASE });
  const admin = await playwright.request.newContext({
    baseURL: BASE,
    storageState: adminState('chromium'),
  });
  const owners: Awaited<ReturnType<typeof playwright.request.newContext>>[] = [];
  const noted: NotedAgent = { id: null };
  const contexts: BrowserContext[] = [];
  let engineWebkit: Browser | null = null;
  // What the closing line names, once the run has made it.
  let storyId: string | null = null;
  let hrizzupHandle: string | null = null;
  // Whether the story was withdrawn because the board's safety failed (null: it wasn't needed).
  const safety: { withdrawn: boolean | null } = { withdrawn: null };

  const reason = `R8's done-test withdrew its own story: its board or page failed a check (${label})`;
  const story = {
    id: newRecordId(),
    title: `Test story: media on the desk (R8's done-test, ${today}, ${label})`,
    summary: `A test story made by R8's done-test (${label}): an agent's image, video and audio and Hrizzup's image, to look at on the desk and the board. The founder withdraws it in the console.`,
    savedAt: new Date(Date.now() - 60_000),
  };
  expect(story.title.length, 'the story title is within the agreement').toBeLessThanOrEqual(120);
  expect(story.summary.length, 'the story summary is within the agreement').toBeLessThanOrEqual(
    300,
  );

  /**
   * Withdraws the story, at once, through the console's own save: the story's record as the public read gives it
   * (never typed again), its state `withdrawn` with a reason, its time a little in the past and later than what is kept
   * (as the console's page saves it), then read back until it says so; the console's own page is the fallback. Never
   * throws, so it can't hide the failure that came first. True when the story is withdrawn.
   */
  const withdrawStory = async (): Promise<boolean> => {
    const read = () => call(anyone, 'GET', `/api/v1/social/stories/${story.id}`);
    const isWithdrawn = async () => (await read().catch(() => null))?.body.state === 'withdrawn';
    try {
      const before = await read();
      if (before.body.state === 'withdrawn') return true;
      const known = before.status === 200 ? before.body : {};
      const record = {
        ...storyRecord(story.id, story.title, story.summary, story.savedAt),
        ...(typeof known.createdAt === 'string' ? { created_at: known.createdAt } : {}),
        ...(Array.isArray(known.categories) ? { categories: known.categories } : {}),
        ...(Array.isArray(known.places) ? { locations: known.places } : {}),
        state: 'withdrawn',
        withdrawn_reason: reason,
        updated_at: new Date(Date.now() - 10_000).toISOString(),
      };
      await call(admin, 'POST', '/api/v1/admin/social/stories', { record, listed: true });
      for (let at = 0; at < 6; at++) {
        if (await isWithdrawn()) return true;
        await sleep(5_000);
      }
    } catch {
      // Fall through to the console's page.
    }
    try {
      const context = await browser.newContext({
        baseURL: BASE,
        storageState: adminState('chromium'),
      });
      contexts.push(context);
      context.setDefaultTimeout(30_000);
      const page = await context.newPage();
      await page.goto(`/console/social/stories/${story.id}`);
      const heading = page.getByRole('heading', { level: 1, name: 'This story was withdrawn' });
      if (
        await heading.waitFor({ timeout: 3_000 }).then(
          () => true,
          () => false,
        )
      )
        return true;
      await page.getByText('Withdraw this story…').click();
      await page.getByLabel('Why').fill(reason);
      await page.getByRole('button', { name: 'Withdraw this story', exact: true }).click();
      await heading.waitFor({ timeout: 30_000 });
      return await isWithdrawn();
    } catch {
      return false;
    }
  };

  /** Runs a check of the board's safety; if it fails the story is withdrawn at once, then the failure is thrown. */
  const safely = async (what: string, check: () => Promise<void>): Promise<void> => {
    try {
      await check();
    } catch (error) {
      console.log(
        `R8 done-test: ${what} failed, so the story is withdrawn before the failure is thrown`,
      );
      safety.withdrawn = await withdrawStory();
      console.log(
        `R8 done-test: the story ${safety.withdrawn ? 'is withdrawn' : 'could NOT be withdrawn: withdraw it in the console'}`,
      );
      throw error;
    }
  };

  try {
    // Everything this needs is checked before anything is made on staging: the files (FFmpeg), WebKit and the speed
    // measure's Chrome, so a missing tool can't leave a half-made story on the board.
    const files = await makeFiles(folder);
    await access(CHROME).catch(() => {
      throw new Error(`Chrome is not at ${CHROME}: set CHROME_PATH`);
    });
    engineWebkit = await webkit.launch();

    // 1. The listed test story with one update, made through the console's saves.
    const updateId = newRecordId();
    // Noted before the save, so a save that is stored but answers oddly is still withdrawn on a failure.
    storyId = story.id;
    const saved = await call(admin, 'POST', '/api/v1/admin/social/stories', {
      record: storyRecord(story.id, story.title, story.summary, story.savedAt),
      listed: true,
    });
    expect(saved.status, `the console saves the story: ${why(saved)}`).toBe(200);
    const savedUpdate = await call(admin, 'POST', '/api/v1/admin/social/updates', {
      record: updateRecord(
        updateId,
        story.id,
        `Test story (${label}): the first update`,
        new Date(story.savedAt.getTime() + 1_000),
      ),
    });
    expect(savedUpdate.status, `the console saves its update: ${why(savedUpdate)}`).toBe(200);

    // 2. A fresh agent: a run account for its owner, an unlisted invite, its registration and the owner's claim.
    const email = runAddress('done-r8', 'chromium');
    const session = await sessionFor(keys, email, { create: true });
    const owner = await playwright.request.newContext({
      baseURL: BASE,
      storageState: {
        cookies: session.cookies.map(({ name, value }) => asBrowserCookie(BASE, name, value)),
        origins: [],
      },
    });
    owners.push(owner);
    const invited = await call(admin, 'POST', '/api/v1/admin/social/invites', {
      requestId: randomUUID(),
      email,
      note: `Round 6's R8 done-test (${label})`,
      house: false,
      listed: false,
    });
    expect(invited.status, 'the console makes the agent’s invite').toBe(201);
    const handle = `d8_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const registered = await call(anyone, 'POST', '/api/v1/social/agents', {
      inviteCode: (invited.body as { code: string }).code,
      requestId: randomUUID(),
      handle,
      name: 'R8 done-test agent',
      bio: 'A test agent of a done-test run, made to post a picture, a video and audio.',
    });
    expect(registered.status, `the agent registers: ${why(registered)}`).toBe(201);
    const { secret, claimUrl, agent } = registered.body as {
      secret: string;
      claimUrl: string;
      agent: { id: string };
    };
    noted.id = agent.id;
    expect(KEY_TEXT.test(secret), "the agent's key has a key's shape").toBe(true);
    const claimed = await call(owner, 'POST', '/api/v1/owner/claims', {
      requestId: randomUUID(),
      token: new URL(claimUrl).pathname.split('/').at(-1),
      ownerName: 'Check run',
    });
    expect(claimed.status, 'the owner claims the agent').toBe(200);

    // 3. What an agent does, one step at a time: ask for a link, send the file to it, say it is done; then post.
    const asAgent = (method: 'GET' | 'POST', path: string, data?: unknown) =>
      callWith(anyone, secret, method, path, data);
    /** A ready media: a link, the file sent to it, said done with what its kind needs. */
    const upload = async (
      kind: 'image' | 'video' | 'audio',
      contentType: string,
      file: Buffer,
      fields: Record<string, unknown>,
    ): Promise<MediaAnswer> => {
      const made = await asAgent('POST', '/api/v1/social/me/uploads', {
        requestId: randomUUID(),
        kind,
        contentType,
        bytes: file.length,
      });
      expect(made.status, `a ${kind} link: ${why(made)}`).toBe(201);
      const link = made.body as unknown as {
        media: { id: string };
        uploadUrl: string;
        headers: Record<string, string>;
      };
      // The link is only ever sent to, never compared, logged or put in a message; a failure names its method and path.
      const sent = await quietly('PUT', link.uploadUrl, async () => {
        const answer = await fetch(link.uploadUrl, {
          method: 'PUT',
          headers: link.headers,
          body: new Uint8Array(file),
          signal: AbortSignal.timeout(120_000),
        });
        await answer.arrayBuffer();
        return answer.status;
      });
      expect(sent, `the ${kind}'s file reaches the uploads bucket`).toBe(200);
      const done = await asAgent('POST', `/api/v1/social/me/uploads/${link.media.id}/done`, {
        requestId: randomUUID(),
        ...fields,
      });
      expect(done.status, `the ${kind} is checked and ready: ${why(done)}`).toBe(200);
      return done.body as unknown as MediaAnswer;
    };
    const post = async (
      kind: 'image' | 'video' | 'audio',
      format: string,
      mediaId: string,
      body: string,
    ) => {
      const made = await asAgent('POST', '/api/v1/social/me/posts', {
        requestId: randomUUID(),
        storyId: story.id,
        kind,
        body,
        format,
        mediaId,
        sources: [`${SOURCE}/${kind}`],
      });
      expect(made.status, `the ${kind} post: ${why(made)}`).toBe(201);
      return (made.body as { id: string }).id;
    };

    const captions = {
      image: `Test image, posted by the done-test's agent (${label}): a test pattern.`,
      video: `Test video, posted by the done-test's agent (${label}): 20 seconds of a test pattern with a tone.`,
      audio: `Test audio, posted by the done-test's agent (${label}): 30 seconds of a tone.`,
      hrizzup: `Test image, posted as Hrizzup from the console (${label}): colour bars.`,
    };

    const agentImage = await upload('image', 'image/jpeg', files.agentImage, {
      description: "A test pattern made for R8's done-test: coloured bars, a grid and a counter.",
    });
    expect(agentImage).toMatchObject({ kind: 'image', width: 640, height: 360 });
    await post('image', 'meme', agentImage.id, captions.image);

    const videoStill = await upload('image', 'image/png', files.videoStill, {
      description: "A frame of the test video made for R8's done-test.",
    });
    const video = await upload('video', 'video/mp4', files.video, {
      transcript: VIDEO_WORDS,
      stillMediaId: videoStill.id,
    });
    expect(video, 'the video is as it was made: 360 by 640, about 20 seconds').toMatchObject({
      kind: 'video',
      width: 360,
      height: 640,
    });
    expect(video.durationSeconds ?? 0).toBeGreaterThanOrEqual(19);
    expect(video.durationSeconds ?? 99).toBeLessThanOrEqual(22);
    await post('video', 'explainer', video.id, captions.video);

    const audioStill = await upload('image', 'image/png', files.audioStill, {
      description:
        "A colour test pattern, the still image of the test audio made for R8's done-test.",
    });
    const audio = await upload('audio', 'audio/mpeg', files.audio, {
      transcript: AUDIO_WORDS,
      stillMediaId: audioStill.id,
    });
    expect(audio).toMatchObject({ kind: 'audio' });
    expect(audio.durationSeconds ?? 0).toBeGreaterThanOrEqual(29);
    expect(audio.durationSeconds ?? 99).toBeLessThanOrEqual(32);
    await post('audio', 'audio-brief', audio.id, captions.audio);

    // 4. As the console's admin test account, in a real browser: Hrizzup, the story, an image, Preview, Post.
    const adminContext = await browser.newContext({
      baseURL: BASE,
      storageState: adminState('chromium'),
      viewport: { width: 390, height: 844 },
    });
    contexts.push(adminContext);
    adminContext.setDefaultTimeout(30_000);
    const consolePage = await adminContext.newPage();
    const putStatuses: { status: number; type: string | null }[] = [];
    consolePage.on('response', (response) => {
      const request = response.request();
      if (request.method() === 'PUT') {
        // Only the status and the type: the address of an upload holds a signature.
        void request.headerValue('content-type').then((type) => {
          putStatuses.push({ status: response.status(), type });
        });
      }
    });
    const consoleAgents = async () => {
      const answer = await call(admin, 'GET', '/api/v1/admin/social/house/agents');
      expect(answer.status, `the console's own agents: ${why(answer)}`).toBe(200);
      return answer.body.agents as ConsoleAgent[];
    };
    const listedAgent = async () => {
      const listed = (await consoleAgents()).filter((one) => one.listed && one.state !== 'retired');
      // Hrizzup is the one listed console agent that can post: the page refuses to make a second, so two means the
      // console's agents are not as this test knows them, and it must not guess which one to post as.
      expect(
        listed.length,
        `at most one listed console agent can post, and ${listed.length} are listed: ${listed.map((one) => `@${one.handle}`).join(', ')}`,
      ).toBeLessThanOrEqual(1);
      return listed[0];
    };
    let hrizzup = await listedAgent();
    if (!hrizzup) {
      // None yet: the page offers the one-time form that makes Hrizzup, which starts as `hrizzup`, `Hrizzup` and its bio.
      expect((await consolePage.goto('/console/social/post'))?.status(), 'the post page').toBe(200);
      await expect(consolePage.getByTestId('make-hrizzup')).toBeVisible();
      await expect(consolePage.locator('#make-handle')).toHaveValue('hrizzup');
      await expect(consolePage.locator('#make-name')).toHaveValue('Hrizzup');
      await consolePage.getByTestId('make-hrizzup-button').click();
      try {
        await consolePage.waitForURL(/\/console\/social\/post\?as=[0-9a-f-]{36}$/, {
          timeout: 60_000,
        });
      } catch {
        // The page's own words on a refusal (a taken handle, say): the console's, never a secret.
        const said = await consolePage
          .locator('[data-testid="console-refusal"], #make-handle-problem')
          .allTextContents()
          .catch(() => []);
        throw new Error(`Hrizzup was not made: ${said.join(' ').slice(0, 300)}`);
      }
      hrizzup = await listedAgent();
    }
    const house = must(hrizzup, 'The listed console agent (Hrizzup)');
    hrizzupHandle = house.handle;

    // The page again, with the agent and the story both named (making Hrizzup opens it with the agent alone).
    expect(
      (await consolePage.goto(`/console/social/post?as=${house.id}&story=${story.id}`))?.status(),
      'the post page, as an admin',
    ).toBe(200);
    await expect(consolePage.getByTestId('post-preview-button')).toBeEnabled();
    await expect(consolePage.locator('#post-agent')).toHaveValue(house.id);
    await expect(consolePage.locator('#post-story')).toHaveValue(story.id);
    await consolePage.locator('#post-kind').selectOption('image');
    await consolePage.locator('#post-file').setInputFiles({
      name: 'hrizzup-test-pattern.jpg',
      mimeType: 'image/jpeg',
      buffer: files.hrizzupImage,
    });
    const hrizzupDescription = "Colour bars, a test pattern made for R8's done-test.";
    await consolePage.locator('#post-description').fill(hrizzupDescription);
    await consolePage.locator('#post-body').fill(captions.hrizzup);
    await consolePage.locator('#post-sources').fill(`${SOURCE}/hrizzup`);
    await consolePage.getByTestId('post-preview-button').click();
    const previewed = consolePage.getByTestId('post-preview-section');
    await expect(previewed, 'Preview shows the post').toBeVisible({ timeout: 120_000 });
    await expect.poll(() => putStatuses.length, "the browser's own upload is sent").toBe(1);
    expect(putStatuses, "the browser's own upload of the picture is answered").toEqual([
      { status: 200, type: 'image/jpeg' },
    ]);
    await expect(previewed.getByTestId('preview-body')).toHaveText(captions.hrizzup);
    const previewPicture = previewed.locator(
      '[data-testid="preview-media"][data-kind="image"] picture > img',
    );
    await pictureLoaded(previewPicture, "Hrizzup's previewed picture");
    // The one Post: its agent and story are the ones asked for, and the button names the agent.
    await expect(consolePage.locator('#post-agent')).toHaveValue(house.id);
    await expect(consolePage.locator('#post-story')).toHaveValue(story.id);
    await expect(consolePage.getByTestId('post-send-button')).toHaveText(`Post as ${house.name}`);
    await consolePage.getByTestId('post-send-button').click();
    await expect(consolePage.getByTestId('console-saved')).toHaveText('Posted', {
      timeout: 60_000,
    });
    await expect(consolePage.getByTestId('post-story-link')).toHaveAttribute(
      'href',
      `/sandbox/social/stories/${story.id}`,
    );

    // The public desk holds all four posts (read until it does: the agent's posts purge nothing, the console's post does).
    const readDesk = async () => {
      const answer = await call(
        anyone,
        'GET',
        `/api/v1/social/stories/${story.id}/posts?sort=latest&limit=20`,
      );
      expect(answer.status, "the story's desk").toBe(200);
      return answer.body.posts as DeskPost[];
    };
    let desk: DeskPost[] = [];
    const deskDeadline = Date.now() + WAIT_MS;
    for (;;) {
      desk = await readDesk();
      if (Object.values(captions).every((caption) => desk.some((one) => one.body === caption)))
        break;
      if (Date.now() > deskDeadline) {
        throw new Error(`After 4 minutes the desk holds ${desk.length} of the 4 posts`);
      }
      await sleep(EVERY_MS);
    }
    const postWith = (caption: string) =>
      must(
        desk.find((one) => one.body === caption),
        'A post of the run',
      );
    const hrizzupPost = postWith(captions.hrizzup);
    expect(
      hrizzupPost,
      "Hrizzup's post is Hrizzup's, a house agent's, with its picture",
    ).toMatchObject({
      kind: 'image',
      agent: { id: house.id, house: true },
      media: { kind: 'image', width: 640, height: 360 },
    });
    const videoPost = postWith(captions.video);
    const audioPost = postWith(captions.audio);
    const imagePost = postWith(captions.image);
    expect(imagePost.agent.id, "the agent's image post is the agent's").toBe(agent.id);
    const hrizzupMedia = must(hrizzupPost.media, "Hrizzup's picture");
    const videoMedia = must(videoPost.media, "The video's media");
    const audioMedia = must(audioPost.media, "The audio's media");
    // Where Hrizzup's picture is kept: every address of it on a page (the media host's resizes) holds this path.
    const hrizzupPath = new URL(hrizzupMedia.url).pathname;
    const hrizzupSrc = new RegExp(hrizzupPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    expect(
      [new URL(videoMedia.url).pathname, new URL(audioMedia.url).pathname],
      "the video's and the audio's files are not Hrizzup's picture",
    ).not.toContain(hrizzupPath);

    // 5 and 6. A reader who is signed out, in each engine: the board's tile, the story's page, the taps, the transcript;
    // and the board's safety, which withdraws the story at once if it fails.
    const tileLink = `/sandbox/social/stories/${story.id}`;
    /** The story's tile on a board address, looking through its first pages by their "Next" link; null when it isn't there. */
    const findTile = async (page: Page, path: string): Promise<Locator | null> => {
      let next: string | null = path;
      for (let at = 0; at < BOARD_PAGES && next !== null; at++) {
        const answer = await page.goto(`${BASE}${next}`);
        expect(answer?.status(), 'the board answers').toBe(200);
        await expect(
          page.getByTestId('story-list').or(page.getByTestId('board-empty')),
        ).toBeVisible();
        const tile = page
          .getByTestId('story-tile')
          .filter({ has: page.locator(`a[href="${tileLink}"]`) });
        if ((await tile.count()) > 0) return tile.first();
        const more = page.getByRole('link', { name: 'Next', exact: true });
        next = (await more.count()) > 0 ? await more.first().getAttribute('href') : null;
      }
      return null;
    };

    let spoke = false;
    const readerPass = async (engine: 'chromium' | 'webkit', launcher: Browser) => {
      const context = await launcher.newContext({ viewport: { width: 390, height: 844 } });
      contexts.push(context);
      context.setDefaultTimeout(30_000);
      const page = await context.newPage();
      const requested: string[] = [];
      page.on('request', (request) => requested.push(request.url()));

      // The board's Latest: the story's tile, whose thumbnail is Hrizzup's image (the newest picture).
      let tile: Locator | null = null;
      let problem = '';
      const boardDeadline = Date.now() + WAIT_MS;
      for (;;) {
        tile = await findTile(page, '/sandbox/social?sort=latest');
        if (tile === null) {
          problem = "the story's tile is not on the board's newest pages";
        } else {
          const picture = tile.getByTestId('story-picture');
          const src =
            (await picture.locator('picture > img').count()) > 0
              ? ((await picture.locator('picture > img').first().getAttribute('src')) ?? '')
              : '';
          if ((await picture.getAttribute('data-kind')) !== 'image')
            problem = 'the tile shows its stand-in';
          else if (!src.includes(hrizzupPath)) problem = "the tile's picture is not Hrizzup's";
          else break;
        }
        if (Date.now() > boardDeadline) {
          throw new Error(`After 4 minutes on the board (${engine}): ${problem}`);
        }
        await sleep(EVERY_MS);
      }
      const shownTile = must(tile, "The story's tile");
      const thumbnail = shownTile.locator(
        '[data-testid="story-picture"][data-kind="image"] picture > img',
      );
      await expect(thumbnail, "the tile's thumbnail is one picture").toHaveCount(1);
      await expect(thumbnail, "the thumbnail's picture is Hrizzup's").toHaveAttribute(
        'src',
        hrizzupSrc,
      );
      await pictureLoaded(thumbnail, `The board's thumbnail (${engine})`);
      await expect(shownTile.getByRole('link', { name: story.title, exact: true })).toBeVisible();

      // The board's safety, right after the tile shows its picture: the fit pass on the board's Latest, then on the
      // board's own address, which is what the Speed check measures (whether the tile is on its first pages or not).
      await safely(`the fit pass on the board's Latest (${engine})`, () =>
        fitsEverywhere(page, `the board's Latest (${engine}), with the story's tile`),
      );
      const onTop = (await findTile(page, '/sandbox/social')) !== null;
      console.log(
        `R8 done-test (${engine}): the story's tile is ${onTop ? '' : 'not '}on the first pages of the board's Top`,
      );
      await page.goto(`${BASE}/sandbox/social`);
      await expect(
        page.getByTestId('story-list').or(page.getByTestId('board-empty')),
      ).toBeVisible();
      await safely(`the fit pass on the board (${engine})`, () =>
        fitsEverywhere(page, `the board (${engine}), as the Speed check reads it`),
      );

      // The speed of the board, once, in Chromium: the board's own address (the Speed check's) and its Latest (the tile is first there).
      if (engine === 'chromium') {
        await safely("the board's speed", async () => {
          const measured = await speedOf([
            `${BASE}/sandbox/social`,
            `${BASE}/sandbox/social?sort=latest`,
          ]);
          for (const one of measured) {
            console.log(
              `R8 done-test: speed of ${new URL(one.address).pathname}${new URL(one.address).search}: ${one.says.join('; ')}`,
            );
            expect(
              one.failing,
              `the board's speed, ${one.address.slice(BASE.length)}, against the standard budget`,
            ).toEqual([]);
          }
        });
        spoke = true;
      }

      // The story's page.
      const open = async (path: string) => {
        const answer = await page.goto(`${BASE}${path}`);
        expect(answer?.status(), 'the page answers').toBe(200);
      };
      await open(`/sandbox/social/stories/${story.id}`);
      await expect(page.getByTestId('desk')).toBeVisible();
      const cardOf = (caption: string) =>
        page.getByTestId('post-card').filter({ hasText: caption });
      for (const caption of Object.values(captions)) {
        await expect(cardOf(caption), 'the desk shows each post once').toHaveCount(1, {
          timeout: 60_000,
        });
      }
      // The story's thumbnail is Hrizzup's picture, the newest.
      const pagePicture = page.getByTestId('story-picture');
      await expect(pagePicture, "the story's page has one picture of its own").toHaveCount(1);
      await expect(pagePicture).toHaveAttribute('data-kind', 'image');
      const thumbPicture = pagePicture.locator('picture > img');
      await expect(thumbPicture, "the story's thumbnail is Hrizzup's picture").toHaveAttribute(
        'src',
        hrizzupSrc,
      );
      await pictureLoaded(thumbPicture, `The story's thumbnail (${engine})`);
      // Hrizzup's own card, and the pictures of the two image posts.
      await expect(cardOf(captions.hrizzup).getByTestId('agent-card')).toContainText(
        `@${house.handle}`,
      );
      await expect(cardOf(captions.hrizzup).getByTestId('agent-card')).toContainText(
        "Hrizzup's own",
      );
      await pictureLoaded(
        cardOf(captions.hrizzup).locator(
          '[data-testid="post-media"][data-kind="image"] picture > img',
        ),
        `Hrizzup's post's picture (${engine})`,
      );
      await pictureLoaded(
        cardOf(captions.image).locator(
          '[data-testid="post-media"][data-kind="image"] picture > img',
        ),
        `The agent's image post's picture (${engine})`,
      );
      // The video and the audio: their still image under a button that says what it plays; nothing of them is loaded.
      const videoFigure = cardOf(captions.video).locator(
        '[data-testid="post-media"][data-kind="video"]',
      );
      const audioFigure = cardOf(captions.audio).locator(
        '[data-testid="post-media"][data-kind="audio"]',
      );
      await expect(videoFigure.getByTestId('post-media-play')).toHaveText(
        playLabel('video', videoMedia.durationSeconds),
      );
      await expect(audioFigure.getByTestId('post-media-play')).toHaveText(
        playLabel('audio', audioMedia.durationSeconds),
      );
      await pictureLoaded(
        videoFigure.locator('picture > img'),
        `The video's still image (${engine})`,
      );
      await pictureLoaded(
        audioFigure.locator('picture > img'),
        `The audio's still image (${engine})`,
      );
      await expect(page.locator('video, audio'), 'no player before a tap').toHaveCount(0);
      expect(requested, 'the video was not asked for before a tap').not.toContain(videoMedia.url);
      expect(requested, 'the audio was not asked for before a tap').not.toContain(audioMedia.url);
      await safely(`the fit pass on the story's page (${engine})`, () =>
        fitsEverywhere(page, `the story's page (${engine}), with its four posts`),
      );

      // A tap on the video: the player is there with the file as its source, and it really plays: its clock advances,
      // and it has the size and length of the file made here (the bytes are real, from staging's media host).
      await videoFigure.getByTestId('post-media-play').scrollIntoViewIfNeeded();
      await videoFigure.getByTestId('post-media-play').click();
      const player = videoFigure.getByTestId('post-media-video');
      await expect(player).toHaveAttribute('src', videoMedia.url);
      await expect
        .poll(() => player.evaluate((el) => (el as HTMLVideoElement).currentTime), {
          message: `the video plays (${engine}): its clock advances`,
          timeout: 60_000,
        })
        .toBeGreaterThan(0.5);
      const playing = await player.evaluate((el) => {
        const video = el as HTMLVideoElement;
        return {
          error: video.error?.code ?? null,
          width: video.videoWidth,
          height: video.videoHeight,
          seconds: video.duration,
        };
      });
      expect(playing.error, `the video has no error (${engine})`).toBeNull();
      expect([playing.width, playing.height], `the video's decoded size (${engine})`).toEqual([
        360, 640,
      ]);
      expect(
        Math.abs(playing.seconds - (videoMedia.durationSeconds ?? 0)),
        `the video's length (${engine})`,
      ).toBeLessThan(2);
      await expect(page.locator('audio'), 'the audio is still not loaded').toHaveCount(0);
      expect(requested, 'the audio was not asked for by the video’s tap').not.toContain(
        audioMedia.url,
      );

      // A tap on the audio, the same.
      await audioFigure.getByTestId('post-media-play').scrollIntoViewIfNeeded();
      await audioFigure.getByTestId('post-media-play').click();
      const tone = audioFigure.getByTestId('post-media-audio');
      await expect(tone).toHaveAttribute('src', audioMedia.url);
      await expect
        .poll(() => tone.evaluate((el) => (el as HTMLAudioElement).currentTime), {
          message: `the audio plays (${engine}): its clock advances`,
          timeout: 60_000,
        })
        .toBeGreaterThan(0.5);
      const sounding = await tone.evaluate((el) => {
        const sound = el as HTMLAudioElement;
        return { error: sound.error?.code ?? null, seconds: sound.duration };
      });
      expect(sounding.error, `the audio has no error (${engine})`).toBeNull();
      expect(
        Math.abs(sounding.seconds - (audioMedia.durationSeconds ?? 0)),
        `the audio's length (${engine})`,
      ).toBeLessThan(2);
      await safely(`the fit pass on the story's page after the taps (${engine})`, () =>
        fitsEverywhere(page, `the story's page (${engine}), with the video and the audio playing`),
      );

      // The video's own post page shows its transcript (and the audio's its own).
      for (const [postId, words, name] of [
        [videoPost.id, VIDEO_WORDS, 'video'],
        [audioPost.id, AUDIO_WORDS, 'audio'],
      ] as const) {
        await open(`/sandbox/social/posts/${postId}`);
        const transcript = page.getByTestId('post-media-transcript');
        await expect(transcript, `the ${name}'s own page has its transcript`).toHaveCount(1);
        if (!(await transcript.evaluate((el) => (el as HTMLDetailsElement).open))) {
          await transcript.getByText('Transcript', { exact: true }).click();
        }
        await expect(
          transcript.getByText(words),
          `the ${name}'s transcript shows (${engine})`,
        ).toBeVisible();
      }
    };

    await readerPass('chromium', browser);
    await readerPass('webkit', must(engineWebkit, 'WebKit'));
    expect(spoke, "the board's speed was measured").toBe(true);
  } catch (error) {
    // Only a run that passes leaves its story listed: a failure at any step after the story was made withdraws it
    // first (the same path as the board's safety, which may have done so already), then the failure is thrown.
    if (storyId !== null && safety.withdrawn !== true) {
      console.log(
        'R8 done-test: the run failed, so the story is withdrawn before the failure is thrown',
      );
      safety.withdrawn = await withdrawStory();
      console.log(
        `R8 done-test: the story ${safety.withdrawn ? 'is withdrawn' : 'could NOT be withdrawn: withdraw it in the console'}`,
      );
    }
    throw error;
  } finally {
    // The agent's keys are revoked, whatever step the run stopped at, so nothing of the run stays live.
    const revoked = await revokeAgentKeys(
      admin,
      noted,
      `Round 6's R8 done-test is over (${label})`,
    );
    // A run whose keys could not be revoked has not passed: its story is withdrawn too.
    if (revoked !== null && revoked !== 200 && storyId !== null && safety.withdrawn !== true) {
      safety.withdrawn = await withdrawStory();
    }
    await Promise.all([
      ...contexts.map((context) => context.close().catch(() => undefined)),
      engineWebkit?.close().catch(() => undefined),
      rm(folder, { recursive: true, force: true }).catch(() => undefined),
    ]);
    await Promise.all([anyone, admin, ...owners].map((context) => context.dispose()));
    // A run that passed leaves the story and its posts in place, listed (a run that failed withdrew it): where to look.
    if (storyId !== null) {
      console.log(
        `R8 done-test: the story ${BASE}/sandbox/social/stories/${storyId}, the board ${BASE}/sandbox/social${hrizzupHandle === null ? '' : ` and Hrizzup's profile ${BASE}/sandbox/social/agents/${hrizzupHandle}`}${safety.withdrawn === true ? ' (the story was withdrawn)' : ''}`,
      );
    }
    if (revoked !== null) expect.soft(revoked, "the console revokes the agent's keys").toBe(200);
    if (safety.withdrawn !== null) {
      expect.soft(safety.withdrawn, 'the board safety rule withdrew the story').toBe(true);
    }
  }
});
