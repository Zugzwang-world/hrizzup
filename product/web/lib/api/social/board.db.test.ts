import { randomBytes, randomUUID } from 'node:crypto';
import { social } from '@hrizzup/api';
import { transaction } from '@hrizzup/db';
import { createRouterClient } from '@orpc/server';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newRecordId } from '@/lib/record-id.ts';
import { resetSocialCache } from '@/lib/social/cache.ts';
import { localDatabaseOrThrow } from '@/lib/social/local-database.ts';

/**
 * The board's six reads against a real database (docs/social/build.md, D5; R5's design note, M1; the
 * advisor's review of the design): the real router, handlers, mappers and output checks over the real
 * functions of migrations/*_social.sql, so what `board.test.ts`'s stand-in can only assume is proven:
 * that the hand-written mappers (`lib/social/stories.ts`, `post-card.ts`) match what the SQL emits, that
 * every `next` the database makes is a cursor the API can hand out and take back (the time text of
 * `markets.utc`, the rank as text), and that a merged story, a withdrawn one and an unlisted one read as
 * the design says. R6 builds on `postCardOf` and `agentCardOf`, so a post card from the real database is
 * parsed here.
 *
 * It seeds through M2's own functions, as the pgTAP tests do (`intake.save_story`, `social._list_story`,
 * the invite, registration and claim of an agent, a post made with its posting key, the minute job's
 * recount), and every ID, handle and email is this run's own, so a database that holds the last run's
 * stories (a local one is not rebuilt between runs) changes nothing: a story is looked for by its ID.
 *
 * Run it on this Mac, on the slot's database (`infra/slots/slot db start` first):
 *
 *   SOCIAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$(infra/slots/slot env | sed -n 's/^export SUPABASE_DB_PORT=//p')/postgres" \
 *     pnpm --filter @hrizzup/web exec vitest run lib/api/social/board.db.test.ts
 *
 * Without `SOCIAL_DATABASE_URL` the file does not run: Quick checks have no database, and the website has
 * no `test:db` of its own yet (see the milestone's report).
 */

const url = process.env.SOCIAL_DATABASE_URL;

// The guard is shared (`lib/social/local-database.ts`): the host pg would connect to must be this Mac's.

const held = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@/lib/db.ts', () => ({ database: () => held.pool }));

const { router } = await import('../router.ts');

function api() {
  const resHeaders = new Headers();
  const called = createRouterClient(router, {
    context: {
      headers: new Headers(),
      resHeaders,
      url: 'https://staging.hrizzup.com/api/v1/social/board',
    },
  });
  return { api: called, resHeaders };
}

let owner: pg.Pool;
let app: pg.Pool;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = () => randomBytes(32);
const letters = (n: number) =>
  Array.from(randomBytes(n), (b) => 'abcdefghijklmnopqrstuvwxyz'[b % 26]).join('');
const iso = (agoMinutes: number) => new Date(Date.now() - agoMinutes * 60_000).toISOString();

/** What the run seeded. */
const seeded = {
  listed: '',
  other: '',
  unlisted: '',
  merged: '',
  withdrawn: '',
  mergedIntoWithdrawn: '',
  fresh: '',
  updateIds: [] as string[],
  postIds: [] as string[],
  handle: '',
  ownerName: 'Board test owner',
  headlines: [] as string[],
  title: '',
};

type Tx = Parameters<Parameters<typeof transaction>[1]>[0];
const asApp = <T>(
  work: (tx: Tx) => Promise<T>,
  options: { account?: string; apiKey?: string } = {},
) =>
  transaction(app, work, {
    account: options.account ?? null,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
  });

function storyRecord(
  id: string,
  title: string,
  categories: string[],
  locations: string[],
  createdMinutesAgo: number,
  extra: Record<string, unknown> = {},
) {
  return {
    format: 'story/1',
    id,
    title,
    summary: `What is happening in ${title}.`,
    locations,
    categories,
    state: 'live',
    created_at: iso(createdMinutesAgo),
    updated_at: iso(createdMinutesAgo - 1),
    ...extra,
  };
}

/** Saves a story through `intake`, as the pipeline and the console do; `listed` undefined leaves it with no row of social's own. */
async function saveStory(record: Record<string, unknown>, listed: boolean | undefined) {
  await owner.query('select intake.save_story($1::jsonb)', [JSON.stringify(record)]);
  if (listed === undefined) return;
  await owner.query("select social._list_story($1, $2, 'console', null)", [record.id, listed]);
  await owner.query('select social._refresh_story($1)', [record.id]);
}

async function saveUpdate(id: string, story: string, headline: string, reportedMinutesAgo: number) {
  const reported = iso(reportedMinutesAgo);
  await owner.query('select intake.save_update($1::jsonb)', [
    JSON.stringify({
      format: 'update/1',
      id,
      story_id: story,
      headline,
      body: `More about ${headline}.`,
      reported_at: reported,
      sources: ['https://example.com/sources/board-db-test'],
      state: 'live',
      created_at: reported,
      updated_at: reported,
    }),
  ]);
  await owner.query('select social._refresh_story($1)', [story]);
}

beforeAll(async () => {
  if (!url) return;
  localDatabaseOrThrow(url);
  owner = new pg.Pool({ connectionString: url, max: 2 });
  app = new pg.Pool({ connectionString: url, max: 4 });
  owner.on('error', () => {});
  app.on('error', () => {});
  held.pool = app;
  resetSocialCache(null);

  const run = randomUUID().slice(0, 8);
  const admin = randomUUID();
  const ownerAccount = randomUUID();
  const email = `board-${run}@social-board.test`;
  await owner.query(
    'insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now())',
    [admin, `admin-${run}@social-board.test`, ownerAccount, email],
  );
  await owner.query("insert into private.admins (user_id, note) values ($1, 'A test admin')", [
    admin,
  ]);

  // Stories: a listed one that everything happens on, another listed one, an unlisted one, a story merged
  // into the first, a withdrawn one and a story merged into the withdrawn one.
  const ids = Object.fromEntries(
    ['listed', 'other', 'unlisted', 'merged', 'withdrawn', 'mergedIntoWithdrawn'].map((name) => [
      name,
      newRecordId(),
    ]),
  ) as Record<
    'listed' | 'other' | 'unlisted' | 'merged' | 'withdrawn' | 'mergedIntoWithdrawn',
    string
  >;
  Object.assign(seeded, ids);
  seeded.title = `Board test ${run}: the first story`;
  await saveStory(
    storyRecord(ids.listed, seeded.title, ['ai', 'business'], ['mumbai', 'india'], 120),
    true,
  );
  await saveStory(
    storyRecord(ids.other, `Board test ${run}: the second story`, ['sports'], ['india'], 100),
    true,
  );
  await saveStory(
    storyRecord(ids.unlisted, `Board test ${run}: an unlisted story`, ['general'], ['global'], 90),
    false,
  );
  await saveStory(
    storyRecord(
      ids.withdrawn,
      `Board test ${run}: a withdrawn story`,
      ['general'],
      ['global'],
      80,
      {
        state: 'withdrawn',
        withdrawn_reason: 'It was not true',
      },
    ),
    true,
  );
  await saveStory(
    storyRecord(
      ids.merged,
      `Board test ${run}: a story merged into the first`,
      ['ai'],
      ['mumbai'],
      70,
      {
        state: 'merged',
        merged_into: ids.listed,
      },
    ),
    true,
  );
  await saveStory(
    storyRecord(
      ids.mergedIntoWithdrawn,
      `Board test ${run}: a story merged into the withdrawn one`,
      ['general'],
      ['global'],
      60,
      {
        state: 'merged',
        merged_into: ids.withdrawn,
      },
    ),
    true,
  );

  // A story the pipeline saved less than a minute ago: saved by `intake` alone, with no row of social's own
  // yet (the minute job lists it and recounts it on its next run).
  seeded.fresh = newRecordId();
  await saveStory(
    storyRecord(
      seeded.fresh,
      `Board test ${run}: a story saved a moment ago`,
      ['finance'],
      ['global'],
      2,
    ),
    undefined,
  );

  // Three updates of the first story, reported at different times.
  for (const [n, ago] of [
    [1, 50],
    [2, 40],
    [3, 30],
  ] as const) {
    const id = newRecordId();
    const headline = `Board test ${run}: development ${n}`;
    seeded.updateIds.push(id);
    seeded.headlines.push(headline);
    await saveUpdate(id, ids.listed, headline, ago);
    await sleep(3);
  }

  // An agent, through the invite, registration and claim, and two posts it makes with its posting key.
  const inviteRequest = randomUUID();
  const codeHash = bytes();
  const claimHash = bytes();
  seeded.handle = `board_${letters(8)}`;
  await asApp(
    (tx) =>
      tx.query(
        'select social.admin_create_invite($1, $2, null, false, true, $3::bytea, $4) as answer',
        [inviteRequest, email, codeHash, 'hz-aaaa'],
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
        'Board Test Agent',
        bytes(),
        `hz_demo_${letters(4)}`,
        claimHash,
      ],
    );
    return rows[0]?.answer as { key: { id: string } };
  });
  await asApp(
    (tx) =>
      tx.query('select social.claim_agent($1, $2::bytea, $3) as answer', [
        randomUUID(),
        claimHash,
        seeded.ownerName,
      ]),
    { account: ownerAccount },
  );
  for (const body of ['The first take on the first story', 'The second take on the first story']) {
    const { rows } = await asApp(
      (tx) =>
        tx.query('select social.create_post($1, $2, $3, $4, null, null, null, null) as answer', [
          randomUUID(),
          ids.listed,
          'text',
          body,
        ]),
      { apiKey: registered.key.id },
    );
    const made = rows[0]?.answer as { id: string } | undefined;
    if (!made) throw new Error('The agent made no post');
    seeded.postIds.push(made.id);
    await sleep(5);
  }
  // The minute job's recount, so the story's counts and the rank hold the posts.
  await owner.query('select social.job_recount(null, $1::jsonb)', [
    JSON.stringify({ stories: [ids.listed], posts: seeded.postIds }),
  ]);
}, 60_000);

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
  resetSocialCache();
});

describe('the database this test seeds', () => {
  it('is on this Mac: any other host stops it before a connection is made', () => {
    expect(() =>
      localDatabaseOrThrow('postgresql://postgres:postgres@127.0.0.1:55352/postgres'),
    ).not.toThrow();
    expect(() =>
      localDatabaseOrThrow('postgresql://postgres:postgres@localhost:5432/postgres'),
    ).not.toThrow();
    for (const elsewhere of [
      'postgresql://postgres:x@db.example.supabase.co:5432/postgres',
      'postgresql://postgres:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
      'postgresql://postgres:x@127.0.0.1.example.com:5432/postgres',
      'postgresql://postgres:x@localhost.example.com/postgres',
      'postgresql://postgres:x@10.0.0.5:5432/postgres',
      'not an address',
    ]) {
      expect(() => localDatabaseOrThrow(elsewhere), elsewhere).toThrow();
    }
  });
});

describe.skipIf(!url)('the six reads over the real functions', () => {
  /** Every story the board lists for this sort and filter, page by page, following `next`. */
  async function wholeBoard(input: Record<string, unknown> = {}) {
    const { api: called } = api();
    const found: social.StoryTile[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 40; round++) {
      const page = await called.social.board({
        ...input,
        limit: 5,
        ...(cursor ? { cursor } : {}),
      } as never);
      found.push(...page.stories);
      if (page.next === null) return found;
      cursor = page.next;
    }
    throw new Error('The board never ended');
  }

  it('lists the categories, places and tiers from the agreement', async () => {
    const { api: called } = api();
    const lists = await called.social.lists();
    expect(social.lists.parse(lists)).toEqual(lists);
    expect(lists.places.map((place) => place.code)).toEqual(
      expect.arrayContaining(['mumbai', 'india', 'global']),
    );
  });

  it("lists the listed live story, in Top's and Latest's order, and never an unlisted, merged or withdrawn one", async () => {
    for (const sort of ['top', 'latest'] as const) {
      const board = await wholeBoard({ sort });
      const ids = board.map((tile) => tile.id);
      expect(ids, sort).toContain(seeded.listed);
      expect(ids, sort).toContain(seeded.other);
      for (const hidden of [
        seeded.unlisted,
        seeded.merged,
        seeded.withdrawn,
        seeded.mergedIntoWithdrawn,
      ]) {
        expect(ids, `${sort}: ${hidden}`).not.toContain(hidden);
      }
      expect(new Set(ids).size, `${sort}: no story twice`).toBe(ids.length);
      const tile = board.find((one) => one.id === seeded.listed);
      expect(social.storyTile.parse(tile)).toEqual(tile);
      expect(tile).toMatchObject({
        title: seeded.title,
        categories: ['ai', 'business'],
        latestHeadline: seeded.headlines[2],
        counts: { posts: 2, replies: 0, upvotes: 0, views: 0, uniqueViews: 0, pins: 0 },
      });
      expect([...(tile?.places ?? [])].sort()).toEqual(['india', 'mumbai']);
    }
  });

  it('pages one at a time with the cursors the database makes (the rank as text, the time as markets.utc writes it)', async () => {
    const { api: called } = api();
    for (const sort of ['top', 'latest'] as const) {
      const first = await called.social.board({ sort, limit: 1 });
      expect(first.stories, sort).toHaveLength(1);
      expect(first.next, sort).toEqual(expect.any(String));
      const second = await called.social.board({ sort, limit: 1, cursor: first.next ?? '' });
      expect(second.stories, sort).toHaveLength(1);
      expect(second.stories[0]?.id, sort).not.toBe(first.stories[0]?.id);
    }
  });

  it('filters by a category, by a place and by a tier', async () => {
    const byCategory = await wholeBoard({ category: 'business' });
    expect(byCategory.map((tile) => tile.id)).toContain(seeded.listed);
    expect(byCategory.map((tile) => tile.id)).not.toContain(seeded.other);
    const byPlace = await wholeBoard({ place: 'mumbai' });
    expect(byPlace.map((tile) => tile.id)).toContain(seeded.listed);
    expect(byPlace.map((tile) => tile.id)).not.toContain(seeded.other);
    const byTier = await wholeBoard({ place: 'local', category: 'ai' });
    expect(byTier.map((tile) => tile.id)).toContain(seeded.listed);
    for (const tile of byTier) expect(tile.categories).toContain('ai');
  });

  it('reads a live story with its updates newest first, and says it is listed', async () => {
    const { api: called, resHeaders } = api();
    const story = await called.social.stories.get({ id: seeded.listed });
    expect(social.storyDetail.parse(story)).toEqual(story);
    expect(story).toMatchObject({
      state: 'live',
      id: seeded.listed,
      requestedId: null,
      listed: true,
      moreUpdates: false,
      title: seeded.title,
    });
    if (story.state !== 'live') throw new Error('The story is live');
    expect(story.updates.map((update) => update.headline)).toEqual([...seeded.headlines].reverse());
    expect(story.updates.map((update) => update.id)).toEqual([...seeded.updateIds].reverse());
    expect(story.updates[0]).toMatchObject({
      corrects: null,
      sources: ['https://example.com/sources/board-db-test'],
    });
    expect(story).not.toHaveProperty('withdrawnReason');
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(`social:stories,social:story:${seeded.listed}`);
  });

  it('answers a story saved a moment ago, before the minute job has listed it: live, listed, no counts, and its other reads too', async () => {
    const { api: called } = api();
    const story = await called.social.stories.get({ id: seeded.fresh });
    expect(social.storyDetail.parse(story)).toEqual(story);
    expect(story).toMatchObject({
      state: 'live',
      id: seeded.fresh,
      requestedId: null,
      listed: true,
      latestHeadline: null,
      updates: [],
      moreUpdates: false,
      counts: { posts: 0, replies: 0, upvotes: 0, views: 0, uniqueViews: 0, pins: 0 },
    });
    await expect(called.social.stories.updates({ id: seeded.fresh })).resolves.toEqual({
      updates: [],
      next: null,
    });
    await expect(called.social.stories.posts({ id: seeded.fresh })).resolves.toEqual({
      posts: [],
      next: null,
    });
    const brief = await called.social.stories.brief({ id: seeded.fresh });
    expect(brief.storyId).toBe(seeded.fresh);
    expect(brief.markdown).toContain('a story saved a moment ago');
    // It is on no board until the minute job lists it.
    for (const sort of ['top', 'latest'] as const) {
      expect((await wholeBoard({ sort })).map((tile) => tile.id)).not.toContain(seeded.fresh);
    }
  });

  it('reads an unlisted story by its ID, as not listed', async () => {
    const story = await api().api.social.stories.get({ id: seeded.unlisted });
    expect(story).toMatchObject({ state: 'live', id: seeded.unlisted, listed: false, updates: [] });
  });

  it('answers a merged story as the story it went into, with the ID asked for', async () => {
    const { api: called, resHeaders } = api();
    const story = await called.social.stories.get({ id: seeded.merged });
    expect(story).toMatchObject({ state: 'live', id: seeded.listed, requestedId: seeded.merged });
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(
      `social:stories,social:story:${seeded.merged},social:story:${seeded.listed}`,
    );
  });

  it('answers a withdrawn story as its state and reason only, and so a story merged into it', async () => {
    const { api: called } = api();
    const story = await called.social.stories.get({ id: seeded.withdrawn });
    expect(story).toEqual({
      id: seeded.withdrawn,
      state: 'withdrawn',
      withdrawnReason: 'It was not true',
      requestedId: null,
    });
    expect(social.storyDetail.parse(story)).toEqual(story);
    const merged = await called.social.stories.get({ id: seeded.mergedIntoWithdrawn });
    expect(merged).toEqual({
      id: seeded.withdrawn,
      state: 'withdrawn',
      withdrawnReason: 'It was not true',
      requestedId: seeded.mergedIntoWithdrawn,
    });
  });

  it('is 404 "No such story" for an ID no story has', async () => {
    const { api: called } = api();
    const unknown = newRecordId();
    for (const read of [
      () => called.social.stories.get({ id: unknown }),
      () => called.social.stories.updates({ id: unknown }),
      () => called.social.stories.posts({ id: unknown }),
      () => called.social.stories.brief({ id: unknown }),
    ]) {
      await expect(read()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
        message: 'No such story',
      });
    }
  });

  it("pages a story's updates newest first, one at a time, to the last page", async () => {
    const { api: called, resHeaders } = api();
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 5; round++) {
      const page = await called.social.stories.updates({
        id: seeded.listed,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      expect(social.updatePage.parse(page)).toEqual(page);
      expect(page.updates).toHaveLength(1);
      seen.push(page.updates[0]?.id ?? '');
      if (page.next === null) break;
      cursor = page.next;
    }
    expect(seen).toEqual([...seeded.updateIds].reverse());
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(`social:stories,social:story:${seeded.listed}`);
    // A merged ID's updates are its survivor's; a withdrawn story has none.
    const viaMerged = await called.social.stories.updates({ id: seeded.merged });
    expect(viaMerged.updates.map((update) => update.id)).toEqual([...seeded.updateIds].reverse());
    await expect(called.social.stories.updates({ id: seeded.withdrawn })).resolves.toEqual({
      updates: [],
      next: null,
    });
  });

  it("reads a story's desk in Top's and Latest's order, one at a time, as cards with no picture or media", async () => {
    const { api: called, resHeaders } = api();
    for (const sort of ['top', 'latest'] as const) {
      const seen: social.PostCard[] = [];
      let cursor: string | undefined;
      for (let round = 0; round < 5; round++) {
        const page = await called.social.stories.posts({
          id: seeded.listed,
          sort,
          limit: 1,
          ...(cursor ? { cursor } : {}),
        });
        expect(social.postPage.parse(page)).toEqual(page);
        seen.push(...page.posts);
        if (page.next === null) break;
        cursor = page.next;
      }
      expect(seen.map((post) => post.id).sort(), sort).toEqual([...seeded.postIds].sort());
      for (const post of seen) {
        expect(post).toMatchObject({
          storyId: seeded.listed,
          kind: 'text',
          media: null,
          format: null,
          afterUpdateId: expect.any(String),
          sources: [],
          counts: { replies: 0, upvotes: 0, views: 0, uniqueViews: 0 },
        });
        expect(post.agent).toEqual({
          id: expect.any(String),
          handle: seeded.handle,
          name: 'Board Test Agent',
          picture: null,
          house: false,
          ownerName: seeded.ownerName,
        });
      }
      // Latest is the newest post first.
      if (sort === 'latest')
        expect(seen.map((post) => post.id)).toEqual([...seeded.postIds].reverse());
    }
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(`social:desks,social:desk:${seeded.listed}`);
    // A merged story's desk is its survivor's, tagged with both; a withdrawn story's is empty.
    const merged = await called.social.stories.posts({ id: seeded.merged });
    expect(merged.posts.map((post) => post.id).sort()).toEqual([...seeded.postIds].sort());
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(
      `social:desks,social:desk:${seeded.merged},social:desk:${seeded.listed}`,
    );
    await expect(called.social.stories.posts({ id: seeded.withdrawn })).resolves.toEqual({
      posts: [],
      next: null,
    });
  });

  it("builds a story's brief from the database: the title, every update and the desk, with one version for one file", async () => {
    const { api: called, resHeaders } = api();
    const first = await called.social.stories.brief({ id: seeded.listed });
    await sleep(5);
    const second = await called.social.stories.brief({ id: seeded.listed });
    expect(social.brief.parse(first)).toEqual(first);
    expect(first.storyId).toBe(seeded.listed);
    expect(first.markdown).toContain(`# ${seeded.title}`);
    for (const headline of seeded.headlines) expect(first.markdown).toContain(headline);
    expect(first.markdown).toContain(`@${seeded.handle}`);
    expect(first.markdown).toContain('The first take on the first story');
    expect(second.version).toBe(first.version);
    expect(second.markdown).toBe(first.markdown);
    expect(resHeaders.get('Vercel-Cache-Tag')).toBe(
      `social:briefs,social:story:${seeded.listed},social:desk:${seeded.listed}`,
    );
    // A merged ID's brief is the survivor's.
    const viaMerged = await called.social.stories.brief({ id: seeded.merged });
    expect(viaMerged.storyId).toBe(seeded.listed);
    expect(viaMerged.version).toBe(first.version);
  });

  it('refuses a withdrawn story’s brief with 422 `story_not_live`', async () => {
    const { api: called } = api();
    for (const id of [seeded.withdrawn, seeded.mergedIntoWithdrawn]) {
      await expect(called.social.stories.brief({ id })).rejects.toMatchObject({
        code: 'REFUSED',
        status: 422,
        data: { reason: 'story_not_live' },
      });
    }
  });

  it('emits the keys the mappers read: a tile, an update and a post card each hold every field, and nothing the contract lacks is sent on', async () => {
    const rows = await asApp(async (tx) => {
      const story = (await tx.query('select social.story($1) as answer', [seeded.listed])).rows[0]
        ?.answer;
      const desk = (
        await tx.query("select social.desk($1, 'top', null, 5) as answer", [seeded.listed])
      ).rows[0]?.answer;
      return { story, desk };
    });
    const story = rows.story as Record<string, unknown>;
    expect(Object.keys(story).sort()).toEqual(
      [
        'categories',
        'counts',
        'created_at',
        'id',
        'latest_at',
        'latest_headline',
        'listed',
        'more_updates',
        'places',
        'requested_id',
        'state',
        'summary',
        'title',
        'updates',
        'withdrawn_reason',
      ].sort(),
    );
    const post = (rows.desk as { posts: Record<string, unknown>[] }).posts[0];
    expect(Object.keys(post ?? {}).sort()).toEqual(
      [
        'after_update_id',
        'agent',
        'body',
        'counts',
        'created_at',
        'format',
        'id',
        'kind',
        'media',
        'sources',
        'story_id',
      ].sort(),
    );
    expect(Object.keys((post?.agent ?? {}) as object).sort()).toEqual(
      ['handle', 'house', 'id', 'name', 'owner_name', 'picture'].sort(),
    );
    // Nothing writes media before R8: the database answers none, as the mappers say.
    expect(post?.media).toBeNull();
    expect((post?.agent as { picture: unknown } | undefined)?.picture).toBeNull();
  });
});
