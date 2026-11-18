import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { MEDIA_FIXTURE_STORY } from '../../lib/social/fixture-ids.ts';
import { sampleMp4, samplePng } from '../../lib/social/media/samples.ts';
import { fitsEverywhere } from '../support/fits-everywhere.ts';
import { call } from '../support/quiet-request.ts';
import { runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';

/**
 * Journey: the console's "Post as Hrizzup" page (docs/social/media-design.md, sections 9.5 and 10; R8's M4), driven as
 * the founder would, as the console's admin test account, in Chromium and WebKit, on every pull request's preview. Its
 * twin, `social-house.spec.ts`, proves the console's calls over HTTP; this one proves the page, the browser's own
 * upload and the post. It has a file of its own because that one never opens a page and is on the API-only guard,
 * which no journey that opens a page may be (e2e/support/api-only.ts).
 *
 * The run makes its own agent of the console's (unlisted, no owner, no key) and its own unlisted test story through the
 * API, never Hrizzup itself and never a listed agent. Then, on `/console/social/post?as=<agent>&story=<story>`:
 * - The agent and the story are the ones the address names, selected (never the first of a list); an agent or a story
 *   that the address names wrongly selects nothing and says so; the media fixture's story, which the checks keep,
 *   selects nothing and says so, and a post on it is refused in words before any call.
 * - A video chosen with nothing else is refused in words under each field that is wrong, what was typed is kept, and
 *   nothing is sent.
 * - An image from this journey (a small PNG, through the file field) with a description and a caption: Preview sends it
 *   straight to the uploads bucket with a real `PUT` (answered 200, as the type the link was signed for: this proves
 *   the bucket's CORS rule from the preview) and shows the post as it will look, its picture drawn from the media
 *   host's resize; Post answers "Posted", a link to the story's page and the card. The desk (the public read) holds the
 *   post, by the run's agent, with its media and description.
 * - A video with its still image and a transcript, the same way: two real `PUT`s, the still first; the preview shows the
 *   still image under a button that says what it plays, with no `<video>` and no request for the file itself (nothing is
 *   tapped here: the player is `social-media-pages.spec.ts`'s); the post's own page holds the transcript.
 * - The page fits at every size of the screen check (the 13 widths, sideways, the phone widths at 200% text) with the
 *   form open, with each kind's fields, with a preview shown and with the post's card shown.
 *
 * The browser's requests to the media host's resize (`/cdn-cgi/image/`) are routed (and only those): answered with a
 * small picture and recorded, so a run uses none of Cloudflare's free transformations. The `PUT` to the uploads bucket
 * is never routed, and a failure never names its address (it holds a signature): only the status is read. Routing is
 * safe in WebKit here for what the page loads (no Turnstile on a console page); that a routed WebKit page still `PUT`s a
 * file across origins is proven by this journey on the preview. Every account call goes through
 * support/quiet-request.ts. Social doesn't exist on production until launch, and a check run writes only through its
 * own preview, so staging is skipped too (its done-test, making Hrizzup, is made from this page by the coordinator).
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** What an answer says about a refusal, for a failure's message: the reason and the words (the API's, never a secret). */
const why = (answer: { body: Record<string, unknown> }) =>
  JSON.stringify({ data: answer.body.data, message: answer.body.message });

/** A story/1 record of the run's: an unlisted test story, made at `at`. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Post page journey (${label}): a test story`,
    summary: `A test story of a check run (${label}), made for the console's post page journey. Unlisted: it never shows on the board.`,
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
    headline: `Post page journey (${label}): the first update of the test story`,
    reported_at: now,
    sources: ['https://example.com/sources/post-page-journey'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

type DeskPost = {
  id: string;
  kind: string;
  body: string;
  sources: string[];
  format: string | null;
  agent: { id: string; handle: string; house: boolean; ownerName: string | null };
  media: {
    id: string;
    kind: string;
    url: string;
    width: number | null;
    durationSeconds: number | null;
    description: string | null;
    transcript?: string | null;
    still: { url: string } | null;
  } | null;
};

test.describe('the console’s post page', () => {
  test.beforeEach(() => {
    test.skip(environment() === 'production', "Social doesn't exist on production until launch");
    // Writes: a check run owns what it changes and writes only through its own preview (CLAUDE.md, "How checks
    // behave"); staging's own done-test (making Hrizzup) is made from this page by the coordinator.
    test.skip(
      environment() === 'staging',
      "Staging's done-test runs from the Mac; the checks run this on previews",
    );
  });

  test('an admin previews and posts an image and a video as the run’s own agent, through the browser’s own upload, and the page fits', async ({
    browser,
    playwright,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(300_000);
    const handle = `hp_${browserName === 'webkit' ? 'w' : 'c'}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const label = `run ${runKey()}, ${browserName}`;
    const agentName = 'Post page journey';

    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    const context = await browser.newContext({
      storageState: adminState(browserName),
      viewport: { width: 390, height: 844 },
    });
    let agentId: string | null = null;
    try {
      // The run's own console agent and story, all through the API.
      const agentMade = await call(admin, 'POST', '/api/v1/admin/social/house/agents', {
        requestId: randomUUID(),
        handle,
        name: agentName,
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

      const page = await context.newPage();

      // The media host's resizes are answered here and recorded; nothing else is routed (above all, not the bucket).
      const png = await samplePng({ width: 320, height: 180 });
      const resized: string[] = [];
      await page.route(/\/cdn-cgi\/image\//, async (route) => {
        resized.push(route.request().url());
        await route.fulfill({ status: 200, contentType: 'image/png', body: png });
      });
      // Every request the page makes, but the uploads (their address holds a signature), and every `PUT`'s status.
      const requested: string[] = [];
      const puts: { status: number; type: string | null }[] = [];
      page.on('request', (request) => {
        if (!request.url().includes('X-Amz-')) requested.push(request.url());
      });
      page.on('response', (response) => {
        const request = response.request();
        if (request.method() === 'PUT') {
          void request.headerValue('content-type').then((type) => {
            puts.push({ status: response.status(), type });
          });
        }
      });

      // ---- The address chooses the agent and the story; a wrong choice selects nothing and says so. ----
      const post = '/console/social/post';
      const opened = await page.goto(`${post}?as=${agent.id}&story=${storyId}`);
      expect(opened?.status(), 'the post page, as an admin').toBe(200);
      await expect(page.getByTestId('post-preview-button')).toBeEnabled();
      await expect(page.getByRole('heading', { level: 1, name: 'Post as Hrizzup' })).toBeVisible();
      await expect(page.locator('#post-agent')).toHaveValue(agent.id);
      await expect(page.locator('#post-story')).toHaveValue(storyId);
      // (Its label marks it "(test, unlisted)" when it is among the newest; either way it carries its title.)
      await expect(page.locator('#post-story option:checked')).toContainText(
        `Post page journey (${label}): a test story`,
      );
      // Nothing about a wrong address is said of the right one.
      await expect(page.locator('main')).not.toContainText(
        'No agent that the console runs has that ID',
      );
      await expect(page.locator('main')).not.toContainText('is kept for the checks');
      await expect(page.locator('#post-kind')).toHaveValue('text');
      expect(await page.locator('#post-file').count(), 'a text post has no file field').toBe(0);

      // The kept fixture's story: nothing is selected, it isn't offered, the page says why, and a Preview is refused
      // in words under the story, before anything is sent. (The run's own agent is named, so the form is always
      // there: the listed agents are none on staging until Hrizzup is made.)
      await page.goto(`${post}?as=${agent.id}&story=${MEDIA_FIXTURE_STORY}`);
      await expect(page.getByTestId('post-preview-button')).toBeEnabled();
      await expect(page.locator('#post-agent')).toHaveValue(agent.id);
      await expect(page.locator('#post-story')).toHaveValue('');
      await expect(page.getByTestId('post-notes')).toContainText(
        'That story is kept for the checks: nothing is posted on it.',
      );
      await expect(page.locator(`#post-story option[value="${MEDIA_FIXTURE_STORY}"]`)).toHaveCount(
        0,
      );
      await page.locator('#post-body').fill('Words that must be kept');
      await page.getByTestId('post-preview-button').click();
      await expect(page.getByTestId('console-refusal')).toHaveText(
        'Not previewed: see the lines under the fields.',
      );
      await expect(page.locator('#post-story-problem')).toHaveText('Choose a story.');
      await expect(page.locator('#post-body')).toHaveValue('Words that must be kept');
      expect(puts, 'nothing was sent').toEqual([]);

      // An agent that isn't one of the console's: nothing is selected, and the page says so. Whether the form is there
      // or only the line "no agent" depends on whether a listed agent exists yet (Hrizzup, once the founder makes
      // it), so both are accepted, and neither is allowed to pick another agent for the one asked for.
      await page.goto(`${post}?as=${randomUUID()}&story=${storyId}`);
      await expect(page.getByTestId('post-notes')).toContainText(
        'No agent that the console runs has that ID: choose one.',
      );
      const form = page.getByTestId('post-form');
      const none = page.getByTestId('post-no-agent');
      await expect(form.or(none)).toBeVisible();
      if ((await form.count()) > 0) {
        await expect(page.locator('#post-agent')).toHaveValue('');
        await expect(page.locator('#post-story')).toHaveValue(storyId);
      }

      // ---- The form, with the run's own agent and story. ----
      await page.goto(`${post}?as=${agent.id}&story=${storyId}`);
      // The form's buttons are off until it has mounted, so nothing typed before then is lost to a native submit.
      await expect(page.getByTestId('post-preview-button')).toBeEnabled();
      await expect(page.locator('#post-agent')).toHaveValue(agent.id);
      await expect(page.locator('#post-story')).toHaveValue(storyId);
      await fitsEverywhere(page, 'the post page, as it opens');

      // A video chosen with nothing else: each field that is wrong says so, what was typed is kept, nothing is sent.
      await page.locator('#post-kind').selectOption('video');
      await expect(page.locator('#post-file')).toBeVisible();
      await expect(page.locator('#post-still')).toBeVisible();
      await expect(page.locator('#post-transcript')).toBeVisible();
      expect(await page.locator('#post-description').count(), 'a video has no description').toBe(0);
      await page.locator('#post-body').fill('A caption that must be kept');
      await page.getByTestId('post-preview-button').click();
      await expect(page.getByTestId('console-refusal')).toHaveText(
        'Not previewed: see the lines under the fields.',
      );
      await expect(page.locator('#post-file-problem')).toHaveText(
        'The file is needed: choose one.',
      );
      await expect(page.locator('#post-still-problem')).toHaveText(
        'The still image is needed: choose one.',
      );
      await expect(page.locator('#post-transcript-problem')).toHaveText(
        'A video or audio needs its transcript: type the words it says.',
      );
      await expect(page.locator('#post-body')).toHaveValue('A caption that must be kept');
      expect(puts, 'nothing was sent').toEqual([]);
      await fitsEverywhere(page, 'the post page, with a video’s fields and their refusals');

      // ---- An image: description, caption and a source, Preview, Post. ----
      const caption = `A picture posted through the console's page (${label})`;
      const description = 'A test picture, a gradient';
      await page.locator('#post-kind').selectOption('image');
      await expect(page.locator('#post-description')).toBeVisible();
      expect(await page.locator('#post-transcript').count(), 'an image has no transcript').toBe(0);
      expect(await page.locator('#post-still').count(), 'an image has no still image').toBe(0);
      await page
        .locator('#post-file')
        .setInputFiles({ name: 'journey-picture.png', mimeType: 'image/png', buffer: png });
      await page.locator('#post-description').fill(description);
      await page.locator('#post-body').fill(caption);
      await page.locator('#post-sources').fill('https://example.com/sources/post-page-journey');
      // No Post button until a Preview has shown what it will post.
      await expect(page.getByTestId('post-send-button')).toHaveCount(0);
      await page.getByTestId('post-preview-button').click();

      const previewed = page.getByTestId('post-preview-section');
      await expect(previewed).toBeVisible({ timeout: 90_000 });
      await expect.poll(() => puts.length, 'the file is sent to the uploads bucket').toBe(1);
      expect(puts[0], 'the PUT is answered, as the type it was signed for').toEqual({
        status: 200,
        type: 'image/png',
      });
      const shownImage = previewed.locator('[data-testid="preview-media"][data-kind="image"]');
      await expect(shownImage).toHaveCount(1);
      const shownPicture = shownImage.locator('picture > img');
      await shownPicture.scrollIntoViewIfNeeded();
      await expect(shownPicture).toHaveAttribute(
        'src',
        /\/cdn-cgi\/image\/width=\d+,format=auto\//,
      );
      await expect(shownPicture).toHaveAttribute('alt', description);
      await expect(shownPicture).toHaveAttribute('width', '320');
      await expect(shownPicture).toHaveAttribute('height', '180');
      await expect(shownPicture).toHaveAttribute(
        'style',
        /background-image:\s*url\(["']?data:image\/png;base64,/,
      );
      await expect(shownPicture).toHaveJSProperty('complete', true);
      await expect(previewed.getByTestId('preview-body')).toHaveText(caption);
      await expect(previewed.getByTestId('preview-kind')).toContainText('image');
      await expect(previewed.getByTestId('preview-kind')).toContainText('Not posted yet');
      await expect(previewed.getByTestId('source-links')).toContainText(
        'https://example.com/sources/post-page-journey',
      );
      await expect(page.getByTestId('post-posted-section')).toHaveCount(0);
      await fitsEverywhere(page, 'the post page, with an image previewed');

      // An edit hides Post until the next Preview: it posts only what was previewed.
      await page.locator('#post-body').fill(`${caption} (edited)`);
      await expect(page.getByTestId('post-send-button')).toHaveCount(0);
      await expect(page.getByTestId('post-preview-section')).toHaveCount(0);
      await page.getByTestId('post-preview-button').click();
      await expect(page.getByTestId('post-preview-section')).toBeVisible({ timeout: 90_000 });
      // The same file and words: nothing is sent a second time.
      expect(puts.length, 'a second Preview sends the file once only').toBe(1);
      await expect(page.getByTestId('post-send-button')).toHaveText(`Post as ${agentName}`);
      await expect(page.locator('#post-agent')).toHaveValue(agent.id);
      await page.getByTestId('post-send-button').click();

      await expect(page.getByTestId('console-saved')).toHaveText('Posted', { timeout: 60_000 });
      await expect(page.getByTestId('post-story-link')).toHaveAttribute(
        'href',
        `/sandbox/social/stories/${storyId}`,
      );
      const postedImage = page.getByTestId('post-posted-section').getByTestId('post-preview');
      await expect(postedImage.getByTestId('preview-body')).toHaveText(`${caption} (edited)`);
      await expect(postedImage.getByTestId('preview-agent')).toContainText(`@${handle}`);
      await expect(postedImage.getByTestId('preview-kind')).not.toContainText('Not posted yet');
      await expect(page.getByTestId('post-send-button')).toHaveCount(0);
      await fitsEverywhere(page, 'the post page, with an image posted');

      // The desk (the public read) holds it, by the run's agent, with its media and description.
      const readDesk = async () => {
        const answer = await call(
          admin,
          'GET',
          `/api/v1/social/stories/${storyId}/posts?sort=latest&limit=20`,
        );
        expect(answer.status, "the story's desk").toBe(200);
        return answer.body.posts as DeskPost[];
      };
      const imagePost = (await readDesk()).find((one) => one.kind === 'image');
      expect(imagePost, 'the image post is on the desk').toBeDefined();
      expect(imagePost).toMatchObject({
        body: `${caption} (edited)`,
        sources: ['https://example.com/sources/post-page-journey'],
        agent: { id: agent.id, handle, house: true, ownerName: null },
        media: { kind: 'image', width: 320, description },
      });

      // ---- A video with its still image and a transcript: two real PUTs, the still first. ----
      const transcript = 'Nothing is said in the test video.';
      const videoCaption = `A video posted through the console's page (${label})`;
      await page.locator('#post-kind').selectOption('video');
      await page.locator('#post-body').fill(videoCaption);
      await page.locator('#post-sources').fill('');
      await page.locator('#post-file').setInputFiles({
        name: 'journey-video.mp4',
        mimeType: 'video/mp4',
        buffer: sampleMp4({ seconds: 3, width: 320, height: 180, tracks: ['video', 'audio'] }),
      });
      await page
        .locator('#post-still')
        .setInputFiles({ name: 'journey-still.png', mimeType: 'image/png', buffer: png });
      await page.locator('#post-transcript').fill(transcript);
      await fitsEverywhere(page, 'the post page, with a video’s fields filled in');
      await page.getByTestId('post-preview-button').click();
      const videoPreview = page.getByTestId('post-preview-section');
      await expect(videoPreview).toBeVisible({ timeout: 120_000 });
      await expect.poll(() => puts.length, 'the still image and the video are sent').toBe(3);
      expect(puts.slice(1), 'both PUTs are answered, as the types they were signed for').toEqual([
        { status: 200, type: 'image/png' },
        { status: 200, type: 'video/mp4' },
      ]);
      const shownVideo = videoPreview.locator('[data-testid="preview-media"][data-kind="video"]');
      await expect(shownVideo).toHaveCount(1);
      await expect(shownVideo.getByTestId('post-media-play')).toHaveText('Play the video, 0:03');
      const stillImage = shownVideo.locator('picture > img');
      await stillImage.scrollIntoViewIfNeeded();
      await expect(stillImage).toHaveAttribute('src', /\/cdn-cgi\/image\/width=\d+,format=auto\//);
      await expect(stillImage).toHaveJSProperty('complete', true);
      await expect(page.locator('video, audio')).toHaveCount(0);
      await expect(videoPreview.getByTestId('preview-transcript')).toContainText(transcript);
      await fitsEverywhere(page, 'the post page, with a video previewed');
      await expect(page.getByTestId('post-send-button')).toHaveText(`Post as ${agentName}`);
      await expect(page.locator('#post-agent')).toHaveValue(agent.id);
      await page.getByTestId('post-send-button').click();
      await expect(page.getByTestId('console-saved')).toHaveText('Posted', { timeout: 60_000 });
      await expect(
        page
          .getByTestId('post-posted-section')
          .locator('[data-testid="preview-media"][data-kind="video"]')
          .getByTestId('post-media-play'),
      ).toHaveText('Play the video, 0:03');
      await fitsEverywhere(page, 'the post page, with a video posted');

      const videoPost = (await readDesk()).find((one) => one.kind === 'video');
      expect(videoPost, 'the video post is on the desk').toBeDefined();
      expect(videoPost).toMatchObject({
        body: videoCaption,
        agent: { id: agent.id, handle, house: true },
        media: { kind: 'video', width: 320 },
      });
      expect(videoPost?.media?.still, 'the video has its still image').not.toBeNull();
      // The post's own page holds the transcript (a card carries none).
      const detail = await call(admin, 'GET', `/api/v1/social/posts/${videoPost?.id}`);
      expect(detail.status, "the video post's own page").toBe(200);
      expect((detail.body.media as { transcript: string | null }).transcript).toBe(transcript);

      // Nothing of the video or the image was asked of the media host but the resizes of pictures: no file was tapped.
      const mediaOrigin = new URL(videoPost?.media?.url ?? '').origin;
      const direct = requested.filter(
        (address) => address.startsWith(mediaOrigin) && !address.includes('/cdn-cgi/image/'),
      );
      expect(direct, 'no file of the media host was asked for').toEqual([]);
      expect(resized.length, 'the pictures were resized by the media host').toBeGreaterThan(0);
      expect(puts.length, 'the image, the still image and the video were each sent once').toBe(3);
    } finally {
      // The run's console agent is retired (it can post no more, and has no key to revoke), whatever happened. A
      // refusal fails the test after the clean-up, without hiding what failed first.
      const retired =
        agentId === null
          ? null
          : await call(admin, 'POST', `/api/v1/admin/social/agents/${agentId}/revoke-keys`, {
              reason: `The post page journey is over (${label})`,
              retire: true,
            }).then(
              (answer) => answer.status,
              () => 0,
            );
      await context.close();
      await admin.dispose();
      if (retired !== null) expect.soft(retired, "the console retires the run's agent").toBe(200);
    }
  });
});
