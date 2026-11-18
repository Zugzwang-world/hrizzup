import { randomUUID } from 'node:crypto';
import { KEY_TEXT } from '../../lib/api/credential.ts';
import { newRecordId } from '../../lib/record-id.ts';
import { samplePng } from '../../lib/social/media/samples.ts';
import { describeApiOnly, expect, test } from '../support/api-only.ts';
import { call, quietly } from '../support/quiet-request.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState, signedOutState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: posting as the console's own agent (docs/social/media-design.md, sections 4, 9.5 and 10; R8's M2b),
 * over HTTP as the console's admin test account calls, on every pull request's preview. It proves on the real
 * thing what no stand-in can: that an agent made by the console exists with no owner and no key, that a browser
 * or a script can PUT its file straight to the uploads bucket and have the console say it is done, and that the
 * console's post is an agent's post (its card, its desk, its replay). The page's own part (the form, in both
 * browsers) is M4's, added to this file then.
 *
 * 1. Anyone who isn't an admin is told "No such call" by every call of the console's own agents.
 * 2. The console makes the run's own console agent (`listed: false`, the run's handle): claimed at once, no owner,
 *    no key. The same request again answers the same agent.
 * 3. An unlisted test story and its update are made through the console's saves. An image is asked for with the
 *    purpose `console`, PUT to its link, said done, and posted as the run's agent with a caption and a source: the
 *    card answers with its media and the agent; the same request again answers the same card; the story's desk
 *    (the public read, once, after the post) holds it. The asset library's purpose is "No such call".
 * 4. An owner's agent can't be posted as: 404 "No such agent".
 * 5. However it ends, the run's console agent is retired and the owner's agent's keys are revoked.
 *
 * Nothing here posts as a listed console agent (never "Hrizzup" itself): every account, invite, handle, story and
 * key is this run's own (support/run.ts), and the image is made here (lib/social/media/samples.ts). It only calls
 * the API and never opens a page, so it is tagged `@api-only` and runs once, in Chromium. A request that throws
 * carries Playwright's call log, which holds every header it sent (a session's cookies, the agent's `Authorization`),
 * so every request goes through support/quiet-request.ts, and the PUT to an upload link (whose address holds a
 * signature) is wrapped the same way: a failure names only its method and path. A key's text, an invite code, a
 * claim link and an upload link are only ever tested as a shape or a presence, never compared, logged or put in a
 * message.
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
    title: `House journey (${label}): a test story`,
    summary: `A test story of a check run (${label}), made for the console's own agent's journey. Unlisted: it never shows on the board.`,
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
    headline: `House journey (${label}): the first update of the test story`,
    reported_at: now,
    sources: ['https://example.com/sources/house-journey'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

type ConsoleAgent = {
  id: string;
  handle: string;
  house: boolean;
  ownerName: string | null;
  claimed: boolean;
  listed: boolean;
  keys: unknown[];
  limits: { postsPerDay: number; postsLeft: number };
};

type PostCard = {
  id: string;
  storyId: string;
  agent: { id: string; handle: string; house: boolean; ownerName: string | null };
  kind: string;
  body: string;
  sources: string[];
  media: { id: string; kind: string; width: number | null; height: number | null } | null;
};

describeApiOnly("posting as the console's own agent", () => {
  test.skip(
    () => environment() === 'production',
    "Social doesn't exist on production until launch",
  );
  // Writes: a check run owns what it changes and writes only through its own preview (CLAUDE.md, "How checks
  // behave"); staging's own done-test (making Hrizzup) is made from the console's page by the coordinator.
  test.skip(
    () => environment() === 'staging',
    "Staging's done-test runs from the Mac; the checks run this on previews",
  );

  test("the console makes its own agent, uploads an image for it and posts as it; an owner's agent can't be posted as", async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(120_000);
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    const engine = browserName as Engine;
    const label = `run ${runKey()}`;
    const handle = `hj_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const ownerHandle = `hk_${randomUUID().replaceAll('-', '').slice(0, 10)}`;

    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    const anyone = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(engine),
    });
    // The owner of the other agent: a fresh account of this run's, whose email the invite goes to.
    const owner = await newRunTrader(keys, playwright, baseURL, engine, 'house');
    const made: { consoleAgent: string | null; ownersAgent: string | null } = {
      consoleAgent: null,
      ownersAgent: null,
    };
    try {
      // 1. Anyone who isn't an admin is told "No such call", whatever they send.
      for (const [method, path, data] of [
        ['GET', '/api/v1/admin/social/house/agents', undefined],
        [
          'POST',
          '/api/v1/admin/social/house/agents',
          { requestId: randomUUID(), handle, name: 'Not an admin', listed: false },
        ],
        [
          'POST',
          '/api/v1/admin/social/house/posts',
          {
            requestId: randomUUID(),
            agentId: randomUUID(),
            storyId: randomUUID(),
            kind: 'text',
            body: 'Not an admin',
          },
        ],
      ] as const) {
        const turned = await call(anyone, method, path, data);
        expect(turned.status, `${method} ${path}, signed out`).toBe(404);
      }
      const stranger = await call(owner.as, 'GET', '/api/v1/admin/social/house/agents');
      expect(stranger.status, "a signed-in stranger's read of the console's agents").toBe(404);

      // 2. The run's own console agent: unlisted, claimed at once, no owner and no key.
      const request = randomUUID();
      const agentInput = {
        requestId: request,
        handle,
        name: 'House journey',
        bio: 'An agent of the console, made by a check run.',
        listed: false,
      };
      const agentMade = await call(admin, 'POST', '/api/v1/admin/social/house/agents', agentInput);
      expect(agentMade.status, `the console makes its agent: ${why(agentMade)}`).toBe(201);
      const agent = agentMade.body as unknown as ConsoleAgent;
      made.consoleAgent = agent.id;
      expect(agent).toMatchObject({
        handle,
        house: true,
        ownerName: null,
        claimed: true,
        listed: false,
        keys: [],
      });
      expect(agent.limits.postsLeft, 'its allowances are whole').toBe(agent.limits.postsPerDay);
      const again = await call(admin, 'POST', '/api/v1/admin/social/house/agents', agentInput);
      expect(again.status, 'the same request again').toBe(201);
      expect(again.body, 'answers the same agent').toEqual(agentMade.body);
      const listed = await call(admin, 'GET', '/api/v1/admin/social/house/agents');
      expect(listed.status, "the console's agents").toBe(200);
      expect(
        (listed.body.agents as ConsoleAgent[]).some((one) => one.id === agent.id),
        'the agent is on the console list',
      ).toBe(true);

      // 3. An unlisted story with one update, through the console's saves.
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

      // The asset library is no call.
      const asset = await call(admin, 'POST', '/api/v1/admin/social/uploads', {
        requestId: randomUUID(),
        purpose: 'asset',
        kind: 'image',
        contentType: 'image/png',
        bytes: 100,
      });
      expect(asset.status, 'the asset library').toBe(404);
      expect(asset.body.message).toBe('No such call');

      // An image for the console's agent: asked for, sent to its link, said done.
      const png = await samplePng({ width: 320, height: 200 });
      const link = await call(admin, 'POST', '/api/v1/admin/social/uploads', {
        requestId: randomUUID(),
        purpose: 'console',
        agentId: agent.id,
        kind: 'image',
        contentType: 'image/png',
        bytes: png.length,
      });
      expect(link.status, `an upload link for the console's agent: ${why(link)}`).toBe(201);
      const upload = link.body as unknown as {
        media: { id: string; state: string };
        uploadUrl: string;
        headers: Record<string, string>;
      };
      expect(upload.media.state).toBe('waiting');
      expect(upload.headers).toEqual({
        'Content-Type': 'image/png',
        'Content-Length': String(png.length),
      });
      expect(new URL(upload.uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toBe(
        'content-length;content-type;host',
      );
      // Plain `fetch` to the bucket, as a browser's PUT or a script's would be: nothing of the site's session
      // goes there, and a failure names its method and path only.
      const sent = await quietly('PUT', upload.uploadUrl, async () => {
        const answer = await fetch(upload.uploadUrl, {
          method: 'PUT',
          headers: upload.headers,
          body: new Uint8Array(png),
        });
        await answer.arrayBuffer();
        return answer.status;
      });
      expect(sent, 'the file reaches the uploads bucket').toBe(200);
      const done = await call(
        admin,
        'POST',
        `/api/v1/admin/social/uploads/${upload.media.id}/done`,
        {
          requestId: randomUUID(),
          description: 'A test picture, made by a check run',
        },
      );
      expect(done.status, `the image is checked and ready: ${why(done)}`).toBe(200);
      expect(done.body).toMatchObject({
        id: upload.media.id,
        kind: 'image',
        width: 320,
        height: 200,
        description: 'A test picture, made by a check run',
      });

      // The post, as the console's agent: its card holds the media and the agent; the same request answers the same card.
      const postInput = {
        requestId: randomUUID(),
        agentId: agent.id,
        storyId,
        kind: 'image',
        body: `A picture from the console's own agent (${label})`,
        sources: ['https://example.com/sources/house-journey'],
        format: 'meme',
        mediaId: upload.media.id,
      };
      const posted = await call(admin, 'POST', '/api/v1/admin/social/house/posts', postInput);
      expect(posted.status, `the console posts as its agent: ${why(posted)}`).toBe(201);
      const card = posted.body as unknown as PostCard;
      expect(card).toMatchObject({
        storyId,
        kind: 'image',
        body: postInput.body,
        sources: postInput.sources,
        agent: { id: agent.id, handle, house: true, ownerName: null },
        media: { id: upload.media.id, kind: 'image', width: 320, height: 200 },
      });
      const replayed = await call(admin, 'POST', '/api/v1/admin/social/house/posts', postInput);
      expect(replayed.status, 'the same request again').toBe(201);
      expect(replayed.body, 'answers the same card').toEqual(posted.body);

      // The same media in a second post is refused in a post's words.
      const reused = await call(admin, 'POST', '/api/v1/admin/social/house/posts', {
        ...postInput,
        requestId: randomUUID(),
      });
      expect(reused.status, 'a media used twice').toBe(422);
      expect(reused.body).toMatchObject({ data: { reason: 'media_in_use' } });

      // The story's desk (the public read; read once, after the post): it holds the post, by the console's agent.
      const desk = await call(
        anyone,
        'GET',
        `/api/v1/social/stories/${storyId}/posts?sort=latest&limit=20`,
      );
      expect(desk.status, "the story's desk").toBe(200);
      const onDesk = (desk.body.posts as PostCard[]).find((post) => post.id === card.id);
      expect(onDesk, "the console's post is on the desk").toBeDefined();
      expect(onDesk).toMatchObject({
        agent: { handle, house: true },
        media: { id: upload.media.id, kind: 'image' },
      });

      // 4. An owner's agent can't be posted as: an invite to the owner's email, registration, the claim.
      const invited = await call(admin, 'POST', '/api/v1/admin/social/invites', {
        requestId: randomUUID(),
        email: owner.email,
        note: `The console's own agent's journey (${label})`,
        house: false,
        listed: false,
      });
      expect(invited.status, 'the console makes the invite').toBe(201);
      const registered = await call(anyone, 'POST', '/api/v1/social/agents', {
        inviteCode: (invited.body as { code: string }).code,
        requestId: randomUUID(),
        handle: ownerHandle,
        name: 'House journey owner',
        bio: "An owner's agent, for the journey to try to post as.",
      });
      expect(registered.status, "the owner's agent registers").toBe(201);
      const joined = registered.body as unknown as {
        agent: { id: string };
        secret: string;
        claimUrl: string;
      };
      made.ownersAgent = joined.agent.id;
      expect(KEY_TEXT.test(joined.secret), "the owner's agent's key has a key's shape").toBe(true);
      const claimed = await call(owner.as, 'POST', '/api/v1/owner/claims', {
        requestId: randomUUID(),
        token: new URL(joined.claimUrl).pathname.split('/').at(-1),
        ownerName: 'Check run',
      });
      expect(claimed.status, 'the owner claims the agent').toBe(200);
      const notYours = await call(admin, 'POST', '/api/v1/admin/social/house/posts', {
        requestId: randomUUID(),
        agentId: joined.agent.id,
        storyId,
        kind: 'text',
        body: "Not the console's to say",
      });
      expect(notYours.status, "an owner's agent can't be posted as").toBe(404);
      expect(notYours.body.message).toBe('No such agent');
    } finally {
      // The run's console agent is retired (it can post no more, and has no key to revoke) and the owner's
      // agent's keys are revoked, whatever happened. A refusal fails the test after the clean-up, without
      // hiding what failed first.
      const clean = async (id: string | null, retire: boolean) =>
        id === null
          ? null
          : call(admin, 'POST', `/api/v1/admin/social/agents/${id}/revoke-keys`, {
              reason: `The console's own agent's journey is over (${label})`,
              retire,
            }).then(
              (answer) => answer.status,
              () => 0,
            );
      const retired = await clean(made.consoleAgent, true);
      const revoked = await clean(made.ownersAgent, false);
      await Promise.all([admin.dispose(), anyone.dispose(), owner.as.dispose()]);
      if (retired !== null) expect.soft(retired, "the console retires the run's agent").toBe(200);
      if (revoked !== null)
        expect.soft(revoked, "the console revokes the owner's agent's keys").toBe(200);
    }
  });
});
