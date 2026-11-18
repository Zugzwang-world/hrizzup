import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';
import { newRecordId } from '../../lib/record-id.ts';
import { MEDIA_FIXTURE_STORY } from '../../lib/social/fixture-ids.ts';
import { transformed } from '../../lib/social/media/delivery.ts';
import { sampleMp3, sampleMp4, samplePng } from '../../lib/social/media/samples.ts';
import { layoutProblems } from '../layout.ts';
import { call, quietly } from '../support/quiet-request.ts';
import { runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { views } from '../viewports.ts';

/**
 * Journey: the pictures, video and audio on a story's page (docs/social/media-design.md, 8.4; R8's M3), opened in a
 * browser as a reader would, in Chromium and WebKit, on every pull request's preview. Its twin, `social-media.spec.ts`,
 * proves the uploads over HTTP; this one proves what a reader sees. It has a file of its own because that one never
 * opens a page and is on the API-only guard, which no journey that opens a page may be (e2e/support/api-only.ts).
 *
 * The run makes its own agent of the console's (unlisted, no owner, no key), its own unlisted story and, as that
 * agent, an image post, a video post with its still image and an audio post, made from small files made here
 * (lib/social/media/samples.ts: a 320 by 180 picture, so one width is ever asked for). Then, signed out:
 * - The story's picture, the hero, is the video's still image: loaded at once and first, offered on the media host's
 *   `/cdn-cgi/image/` at that one width, with the placeholder drawn behind it (a `data:image/png` background) and its size
 *   in the markup, so its box is the same before and after.
 * - The image post's picture is the same, lazily. A video and an audio post show their still image under a button
 *   that says what it plays and for how long; before a tap the page holds no `<video>` and no `<audio>`, and no request
 *   is made for the video's or the audio's own address.
 * - A tap on the video's button puts a `<video>` there with the file's address as its `src`, asks for exactly that
 *   address and no other file, and plays; the same for the audio. (More than one request for the address is the
 *   browser's own: WebKit reads a media file in ranges.)
 * - A card carries no transcript, so each video and audio post links to the post's own page, which has it under the
 *   player: the words that stand in for captions.
 * - The page fits at every size of the screen check: the 13 widths, sideways, and the phone widths at 200% text,
 *   before the taps, after them, and on the post's own page.
 * - Cloudflare's resize itself is proven once, on the fixture's kept picture (`fixtures/social/media.ts`): one `GET`
 *   with `Accept: image/avif` answers a picture 640 pixels wide, from the 1280 one. The same address every run, so after the first it is the edge's copy
 *   and costs no new transformation.
 *
 * The browser's requests to the media host are routed (and only those): a resize is answered with a small picture
 * and the raw files with a few bytes, each recorded, so a run uses none of Cloudflare's free transformations and no
 * real bytes. Routing is safe in WebKit here (the recorded problem is WebKit's routes breaking Turnstile's blob
 * worker, and no page this opens loads Turnstile). Every account's call goes through support/quiet-request.ts, and the
 * PUT to an upload link (whose address holds a signature) is wrapped the same way: a failure names a method and a
 * path. An upload link is only ever sent to, never compared, logged or put in a message. Social doesn't exist on
 * production until launch, and a check run writes only through its own preview, so staging is skipped too.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** The screen check's large text, as screens.spec.ts sets it: the page's root text at 200%. */
const LARGE_TEXT_CSS = 'html { font-size: 200% !important; }';

/**
 * The page at every size of the screen check (e2e/viewports.ts: the 13 widths, the phones and tablets turned
 * sideways, and the phone widths at 200% text): nothing overflows, overlaps or scrolls sideways. One pass in place,
 * never a reload; the large text is switched on for its sizes and off again after, and the window goes back to a
 * phone's. A browser context here is the journey's own, a desktop's: the touch and mobile emulation belong to the
 * screen check's own pass over every page.
 */
async function fitsEverywhere(page: Page, what: string): Promise<void> {
  const problems: string[] = [];
  let large: Awaited<ReturnType<Page['addStyleTag']>> | null = null;
  try {
    for (const view of views) {
      await page.setViewportSize({ width: view.width, height: view.height });
      if (view.largeText && large === null)
        large = await page.addStyleTag({ content: LARGE_TEXT_CSS });
      if (!view.largeText && large !== null) {
        await large.evaluate((style) => style.parentNode?.removeChild(style));
        large = null;
      }
      for (const problem of await layoutProblems(page)) problems.push(`${view.name}: ${problem}`);
    }
  } finally {
    if (large !== null)
      await large.evaluate((style) => style.parentNode?.removeChild(style)).catch(() => undefined);
    await page.setViewportSize({ width: 390, height: 844 });
  }
  expect(problems, `${what}: problems at some size`).toEqual([]);
}

/** What an answer says about a refusal, for a failure's message: the reason and the words (the API's, never a secret). */
const why = (answer: { body: Record<string, unknown> }) =>
  JSON.stringify({ data: answer.body.data, message: answer.body.message });

/** A story/1 record of the run's: an unlisted test story, made at `at`. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Media pages journey (${label}): a test story`,
    summary: `A test story of a check run (${label}), made for the media pages journey. Unlisted: it never shows on the board.`,
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
    headline: `Media pages journey (${label}): the first update of the test story`,
    reported_at: now,
    sources: ['https://example.com/sources/media-pages-journey'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

type Card = {
  id: string;
  kind: string;
  media: {
    id: string;
    kind: string;
    url: string;
    still: { url: string; width: number; height: number } | null;
  } | null;
};

test.describe('pictures, video and audio on a story’s page', () => {
  test.beforeEach(() => {
    test.skip(environment() === 'production', "Social doesn't exist on production until launch");
    // Writes: a check run owns what it changes and writes only through its own preview (CLAUDE.md, "How checks
    // behave"); staging's own done-test runs from the Mac.
    test.skip(
      environment() === 'staging',
      "Staging's done-test runs from the Mac; the checks run this on previews",
    );
  });

  test('the hero and the posts’ pictures are the stills with placeholders, nothing of a video or audio is asked for, and the page fits', async ({
    page,
    playwright,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(240_000);
    const handle = `mp_${browserName === 'webkit' ? 'w' : 'c'}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const label = `run ${runKey()}, ${browserName}`;

    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    let agentId: string | null = null;
    try {
      // The run's own console agent, story and posts, all through the API.
      const agentMade = await call(admin, 'POST', '/api/v1/admin/social/house/agents', {
        requestId: randomUUID(),
        handle,
        name: 'Media pages journey',
        bio: 'An agent of the console, made by a check run.',
        listed: false,
      });
      expect(agentMade.status, `the console makes its agent: ${why(agentMade)}`).toBe(201);
      const agent = agentMade.body as { id: string };
      agentId = agent.id;

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

      /** A ready media of the agent's: asked for, sent to its link from here, said done. Its ID. */
      async function ready(
        kind: 'image' | 'video' | 'audio',
        contentType: string,
        file: Buffer,
        fields: Record<string, unknown>,
      ): Promise<string> {
        const link = await call(admin, 'POST', '/api/v1/admin/social/uploads', {
          requestId: randomUUID(),
          purpose: 'console',
          agentId: agent.id,
          kind,
          contentType,
          bytes: file.length,
        });
        expect(link.status, `a ${kind} link: ${why(link)}`).toBe(201);
        const upload = link.body as unknown as {
          media: { id: string };
          uploadUrl: string;
          headers: Record<string, string>;
        };
        const sent = await quietly('PUT', upload.uploadUrl, async () => {
          const answer = await fetch(upload.uploadUrl, {
            method: 'PUT',
            headers: upload.headers,
            body: new Uint8Array(file),
          });
          await answer.arrayBuffer();
          return answer.status;
        });
        expect(sent, `the ${kind} reaches the uploads bucket`).toBe(200);
        const done = await call(
          admin,
          'POST',
          `/api/v1/admin/social/uploads/${upload.media.id}/done`,
          { requestId: randomUUID(), ...fields },
        );
        expect(done.status, `a ${kind} is checked and ready: ${why(done)}`).toBe(200);
        return upload.media.id;
      }
      const post = async (kind: string, mediaId: string) => {
        const made = await call(admin, 'POST', '/api/v1/admin/social/house/posts', {
          requestId: randomUUID(),
          agentId: agent.id,
          storyId,
          kind,
          body: `A ${kind} on the desk of the media pages journey (${label})`,
          mediaId,
        });
        expect(made.status, `a ${kind} post: ${why(made)}`).toBe(201);
      };

      // An image post, then a video post with its still, then an audio post: the video's still is the story's picture.
      const small = await samplePng({ width: 320, height: 180 });
      await post(
        'image',
        await ready('image', 'image/png', small, { description: 'A test picture, a gradient' }),
      );
      const still = await ready('image', 'image/png', small, {
        description: 'The still of the test video',
      });
      await post(
        'video',
        await ready(
          'video',
          'video/mp4',
          sampleMp4({ seconds: 3, width: 320, height: 180, tracks: ['video', 'audio'] }),
          { transcript: 'Nothing is said in the test video.', stillMediaId: still },
        ),
      );
      await post(
        'audio',
        await ready('audio', 'audio/mpeg', sampleMp3({ seconds: 4 }), {
          transcript: 'Nothing is said in the test audio.',
          stillMediaId: still,
        }),
      );

      // What the API says the page must show (the public read, as any reader's call is made).
      const read = async (path: string) => {
        const answer = await quietly('GET', path, async () => {
          const response = await page.request.get(path);
          return { status: response.status(), text: await response.text() };
        });
        expect(answer.status, path).toBe(200);
        return JSON.parse(answer.text) as Record<string, unknown>;
      };
      const desk = (await read(`/api/v1/social/stories/${storyId}/posts?sort=latest&limit=20`))
        .posts as Card[];
      const imagePost = desk.find((card) => card.kind === 'image')?.media;
      const videoCard = desk.find((card) => card.kind === 'video');
      const videoPost = videoCard?.media;
      const audioCard = desk.find((card) => card.kind === 'audio');
      const audioPost = audioCard?.media;
      if (!imagePost || !videoCard || !videoPost?.still || !audioCard || !audioPost) {
        throw new Error('The desk is missing a post this journey made');
      }
      const mediaOrigin = new URL(imagePost.url).origin;
      expect(new URL(videoPost.url).origin, 'one media host').toBe(mediaOrigin);
      const story = await read(`/api/v1/social/stories/${storyId}`);
      expect(story.picture, "the story's picture is the video's still").toMatchObject({
        url: videoPost.still.url,
        width: 320,
        height: 180,
      });

      // The browser's requests to the media host, and only those, are answered here and recorded.
      const requested: string[] = [];
      await page.route(`${mediaOrigin}/**`, async (route) => {
        const url = route.request().url();
        requested.push(url);
        if (url.startsWith(`${mediaOrigin}/cdn-cgi/image/`)) {
          await route.fulfill({ status: 200, contentType: 'image/png', body: small });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/octet-stream',
            body: Buffer.from([0, 0, 0, 0]),
          });
        }
      });

      // Every call of a media element's `play()`, counted in the page: the player starts what it made, as well as
      // asking for it by attribute (a WebKit element made after a tap can be left paused).
      await page.addInitScript(() => {
        const w = window as unknown as { __plays: number };
        w.__plays = 0;
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
          w.__plays += 1;
          return play.call(this);
        };
      });
      const plays = () => page.evaluate(() => (window as unknown as { __plays: number }).__plays);

      const response = await page.goto(`/sandbox/social/stories/${storyId}`);
      expect(response?.status(), "the story's page").toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      /** The picture's address as the page offers it: the media host's resize, at the one width a 320-pixel picture is. */
      const resized = (url: string) => transformed(url, 320);
      const offered = (url: string) => `${resized(url)} 320w`;

      // The hero: the video's still, eager and first, with its placeholder and its size.
      const hero = page.getByTestId('story-picture');
      await expect(hero).toHaveCount(1);
      await expect(hero).toHaveAttribute('data-kind', 'image');
      const heroImage = hero.locator('picture > img');
      await expect(heroImage).toHaveAttribute('src', resized(videoPost.still.url));
      await expect(hero.locator('picture > source')).toHaveAttribute(
        'srcset',
        offered(videoPost.still.url),
      );
      await expect(hero.locator('picture > source')).toHaveAttribute('sizes', /36rem/);
      await expect(heroImage).toHaveAttribute('loading', 'eager');
      await expect(heroImage).toHaveAttribute('fetchpriority', 'high');
      await expect(heroImage).toHaveAttribute('width', '320');
      await expect(heroImage).toHaveAttribute('height', '180');
      await expect(heroImage).toHaveAttribute(
        'style',
        /background-image:\s*url\(["']?data:image\/png;base64,/,
      );
      await expect(heroImage).toHaveAttribute('alt', 'The still of the test video');
      await expect(heroImage).toHaveJSProperty('complete', true);

      // The image post: the same, lazily.
      const imageFigure = page.locator('[data-testid="post-media"][data-kind="image"]');
      await expect(imageFigure).toHaveCount(1);
      const postImage = imageFigure.locator('picture > img');
      await postImage.scrollIntoViewIfNeeded();
      await expect(postImage).toHaveAttribute('src', resized(imagePost.url));
      await expect(imageFigure.locator('picture > source')).toHaveAttribute(
        'srcset',
        offered(imagePost.url),
      );
      await expect(postImage).toHaveAttribute('loading', 'lazy');
      await expect(postImage).toHaveAttribute('width', '320');
      await expect(postImage).toHaveAttribute('height', '180');
      await expect(postImage).toHaveAttribute(
        'style',
        /background-image:\s*url\(["']?data:image\/png;base64,/,
      );
      await expect(postImage).toHaveJSProperty('complete', true);

      // The video and the audio: their still image under a button that says what it plays, and a link to the
      // post's own page for the transcript (a card has none); no player and no file asked for.
      const videoFigure = page.locator('[data-testid="post-media"][data-kind="video"]');
      const audioFigure = page.locator('[data-testid="post-media"][data-kind="audio"]');
      for (const [figure, words, card] of [
        [videoFigure, 'Play the video, 0:03', videoCard],
        [audioFigure, 'Play the audio, 0:04', audioCard],
      ] as const) {
        await expect(figure).toHaveCount(1);
        await expect(figure.getByTestId('post-media-play')).toHaveText(words);
        await expect(figure.getByTestId('post-media-transcript-link')).toHaveAttribute(
          'href',
          `/sandbox/social/posts/${card.id}`,
        );
        const stillImage = figure.locator('picture > img');
        await stillImage.scrollIntoViewIfNeeded();
        await expect(stillImage).toHaveAttribute('src', resized(videoPost.still.url));
        await expect(stillImage).toHaveJSProperty('complete', true);
      }
      await expect(page.locator('video, audio')).toHaveCount(0);
      // Everything asked of the media host is a resize at 320 of the picture or the still, and of nothing else.
      expect(
        [...new Set(requested)].sort(),
        'only the two pictures were asked for, at the one width',
      ).toEqual([resized(imagePost.url), resized(videoPost.still.url)].sort());
      expect(requested, 'no request for the video or the audio themselves').not.toContain(
        videoPost.url,
      );
      expect(requested).not.toContain(audioPost.url);

      // The page fits at every size, with its pictures drawn.
      await fitsEverywhere(page, 'the story page, with an image, a video and an audio');

      // A tap on the video: the `<video>` is there with exactly that file as its source, the file is asked for
      // (and the audio's is not), and it is started.
      const mediaRequests = (url: string) => requested.filter((asked) => asked === url).length;
      expect(await plays(), 'nothing has played before a tap').toBe(0);
      await videoFigure.getByTestId('post-media-play').click();
      const video = videoFigure.getByTestId('post-media-video');
      await expect(video).toHaveAttribute('src', videoPost.url);
      await expect(video).toHaveAttribute('poster', resized(videoPost.still.url));
      await expect(video).toHaveAttribute('controls', '');
      // Focus follows the tap onto the player (WebKit's focus() on a media element is not relied on).
      if (browserName === 'chromium') await expect(video).toBeFocused();
      await expect(videoFigure.getByTestId('post-media-play')).toHaveCount(0);
      await expect
        .poll(() => mediaRequests(videoPost.url), 'the video is asked for')
        .toBeGreaterThan(0);
      await expect.poll(plays, 'the video is started').toBeGreaterThan(0);
      expect(mediaRequests(audioPost.url), "the audio's file is still not asked for").toBe(0);
      await expect(page.locator('audio')).toHaveCount(0);

      // A tap on the audio: the same, under its still image.
      const playsBefore = await plays();
      await audioFigure.getByTestId('post-media-play').click();
      const audio = audioFigure.getByTestId('post-media-audio');
      await expect(audio).toHaveAttribute('src', audioPost.url);
      await expect(audio).toHaveAttribute('controls', '');
      if (browserName === 'chromium') await expect(audio).toBeFocused();
      await expect(audioFigure.locator('picture > img')).toHaveCount(1);
      await expect(audioFigure.getByTestId('post-media-play')).toHaveCount(0);
      await expect
        .poll(() => mediaRequests(audioPost.url), 'the audio is asked for')
        .toBeGreaterThan(0);
      await expect.poll(plays, 'the audio is started').toBeGreaterThan(playsBefore);
      // No file was asked for but the two that were tapped, and each at its own address.
      for (const asked of new Set(requested)) {
        if (asked.includes('/cdn-cgi/image/')) continue;
        expect([videoPost.url, audioPost.url], 'a file nobody tapped was asked for').toContain(
          asked,
        );
      }
      await fitsEverywhere(page, 'the story page, after a tap on the video and the audio');

      // The transcript: a card links to the post's own page, which has it under the player.
      await videoFigure.getByTestId('post-media-transcript-link').click();
      await expect(page).toHaveURL(new RegExp(`/sandbox/social/posts/${videoCard.id}$`));
      const transcript = page.getByTestId('post-media-transcript');
      await expect(transcript).toHaveCount(1);
      await transcript.getByText('Transcript', { exact: true }).click();
      await expect(transcript).toContainText('Nothing is said in the test video.');
      await expect(transcript.getByText('Nothing is said in the test video.')).toBeVisible();
      await expect(page.getByTestId('post-media-transcript-link')).toHaveCount(0);
      await expect(page.getByTestId('post-media-play')).toHaveText('Play the video, 0:03');
      await fitsEverywhere(page, "the post's own page, with its transcript open");

      // Cloudflare's resize is proven once, on the fixture's kept picture (the same address every run).
      if (browserName === 'chromium') {
        const kept = (
          (await read(`/api/v1/social/stories/${MEDIA_FIXTURE_STORY}/posts?sort=latest&limit=20`))
            .posts as Card[]
        ).find((card) => card.kind === 'image')?.media;
        expect(kept, "the media fixture's picture is on its desk").toBeTruthy();
        const resizedAddress = transformed(kept?.url ?? '', 640);
        const served = await quietly('GET', resizedAddress, async () => {
          const answer = await fetch(resizedAddress, { headers: { accept: 'image/avif' } });
          return {
            status: answer.status,
            type: answer.headers.get('content-type') ?? '',
            bytes: Buffer.from(await answer.arrayBuffer()),
          };
        });
        expect(served.status, "Cloudflare's resize answers").toBe(200);
        expect(served.type, 'with a picture').toMatch(/^image\//);
        // Proven by its size, whatever format `format=auto` chose for a browser that takes AVIF: the kept picture
        // is 1280 pixels wide, so the resize is 640 (and the one before the resize would be 1280).
        expect((await sharp(served.bytes).metadata()).width, 'resized to 640 wide').toBe(640);
      }
    } finally {
      // The run's console agent is retired (it can post no more, and has no key to revoke), whatever happened. A
      // refusal fails the test after the clean-up, without hiding what failed first.
      const retired =
        agentId === null
          ? null
          : await call(admin, 'POST', `/api/v1/admin/social/agents/${agentId}/revoke-keys`, {
              reason: `The media pages journey is over (${label})`,
              retire: true,
            }).then(
              (answer) => answer.status,
              () => 0,
            );
      await admin.dispose();
      if (retired !== null) expect.soft(retired, "the console retires the run's agent").toBe(200);
    }
  });
});
