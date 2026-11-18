# Social R5: the board's reads, the minute job and the console (design)

> Written by Round 6's R5 expert on 18 November 2026 for M1, M2, M3a and M3b. [build.md](build.md), the spec, PLAN.md and CLAUDE.md win over this note. `A/` is `product/packages/api/src/social/`, `W/` is `product/web/`, "the SQL" is `infra/supabase/migrations/20261117194100_social.sql`. No milestone here needs a migration.

## 1. Decisions

**R1. A withdrawn story.** `StoryDetail` (`A/board.ts:49`) becomes a union on `state`. A live story is `StoryTile` plus `state: 'live'`, `requestedId`, `listed`, `updates` and `moreUpdates`. A withdrawn story is `{id, state: 'withdrawn', withdrawnReason, requestedId}`, exactly what `social.story` answers (the SQL, :2339). A merged story answers as the story it went into, with `requestedId`, and never as `merged`. For a withdrawn story, `.updates` and `.posts` answer an empty page (as the SQL does), and `.brief` answers 422 `story_not_live` with HZS22's words.
- *Rejected:* every tile field nullable: it weakens the shape every client reads, for a rare case.
- *Rejected:* blank tile fields: invented data.
- *Rejected:* a 404 for the brief: the story exists, and a 404 tells an agent its ID is wrong.

**R2. Edge tags.** Each read tags the ID it was asked for and every story ID its answer shows, lower-cased (the tag builders refuse capitals). Purging a story ID always purges both its `social:story:` and its `social:desk:` tag. That makes 5 social tags at most per response.
- *Rejected:* per-story tags on the board: 50 tiles would exceed 8 tags. The board's one tag is purged whenever a listed story changes.
- *Rejected:* a second `social.story` call so `.updates` learns the surviving story's ID: a query on every page, for an address clients rarely use. The edge life bounds the lag at 60 s.

**R3. The brief.** Redis first (`socialRedis.brief`, 120 s), then the database. A copy is kept only under the ID of the story it describes, since only that story's recount deletes it. A change deletes the Redis copy, then purges the tags, both after the commit, so the edge's refresh can't read the old copy.
- *Rejected:* keeping the copy under the ID asked for: a merged ID's copy would outlive the surviving story's changes.
- *Rejected:* versioned keys per change: more names to manage, for a race of milliseconds.

**R4. Purges.** One new R5 file, `W/lib/social/purge.ts`, does all of social's purges: 16 tags a call, every call at once (Vercel Pro allows 200 calls a second), a bounded wait under `waitUntil`. A failed purge never fails the write that asked for it.
- *Rejected:* the markets' `refreshEdge` (`W/lib/api/edge-cache.ts:34`): it neither splits tags into calls nor counts failures.
- *Rejected:* `dangerouslyDeleteByTag`: every waiting reader would hit the server at once.

**R5. The minute run's time.** pg_net gives up at 25 s with no status, failing `check --jobs`. Each step passes its own statement and lock limits (17.5 s in all), and the door answers by 18 s regardless.
- *Rejected:* `asJob`'s default 30 s (`W/lib/social/access.ts:100`): it outlives pg_net.
- *Rejected:* no deadline at the door: a hung connection would show only as pg_net's empty status.

**R6. What the recount hands the purge.** The purge reads `earlier.recount.ids` and `earlier.recount.data`:
- a story gets its story and desk tags, and its Redis brief is deleted;
- a post gets `social:post:<id>`, and its desk comes from its story: with `since` set, `job_recount` always adds each recounted post's story (the SQL, :3294);
- an agent gets `social:agent:<id>`;
- `directory` adds `social:agents`;
- `board` adds `social:board`, and so does any story the stories step returned. The `board` mark (:3356) needs `state = 'live'`, so a listed story the pipeline just withdrew would otherwise stay on the board.
- *Rejected:* the `board` mark alone, for that reason.

**R7. The test `minute.test.ts:150`.** "The stubs run clean" becomes "the four steps run clean, against a stand-in that answers each statement as its function does". Any other statement fails it. It also checks the statements' order (`job_begin`, `job_sync_stories`, `job_recount`, `job_end`) and that the recount got the stories step's IDs. That is stronger than a test that passed because no step did anything. R11 adds its own statement later.

**R8. The console.**
- Settings map through one fixed table, never by converting the case of whatever was sent.
- `AdminAgent` drops `files` and `skills` (answering `[]` would be false, since every agent holds a `profile` file) and gains `listed` and `retiredReason`, which the database already answers.
- `Invite` gains `revokedReason` (expired invites are revoked as `expired`).
- Agents' limits get the settings' maximums: an unbounded number overflows the integer column, which today is a 500.
- The ready message names staging's address on staging and on previews, which share staging's database: staging has been public since 9 November (`docs/setup.md:1296`), while previews ask for a Vercel login. On this Mac it names the local address, since the slot's database is its own.
  - **As built (M3a): the ready message always names `STAGING_ORIGIN`**, in every environment: every environment that makes an invite uses staging's database, and an invited agent can reach only staging's public `/skill.md`, never a preview's (a Vercel login) or this Mac's.
- *Rejected:* `files: []` (false data), and a preview's own address (unreachable for invited agents).

**R9. Revocations.** The order is: the database (the truth), then R6's `revokeAgentKeys(hashes)` ("none" over `key:v1` and `key:v2`), then the edge purge. The promise: the database refuses a revoked key at once, on every call. When Redis takes the marks, the API's key check refuses it at once too; otherwise the check may recognise it for up to 60 s, but no write succeeds. *Requirement on R6:* write `key:v2` copies with `NX`, as `key:v1`'s are today (`W/lib/api/keys.ts:119`), so a lookup that began before a revocation can't overwrite "none".
- *Rejected:* Redis first: a refused revocation (HZS24, P0002) would lock out live keys for 60 s.

## 2. M1: the six reads live, and the console saves' purge (`[normal]`)

Files: `A/board.ts`, `A/board.examples.ts`, `A/examples/board.json`, `W/lib/api/social/{board,admin}.ts`; new `W/lib/social/{stories,post-card,brief,paging,purge}.ts` with tests; `W/lib/api/social/board.test.ts`; `W/e2e/journeys/social-board.spec.ts`; regenerated `openapi.json` and `contract.routes.json`.

1. **Contract:**
   - each of the six calls takes `.meta(live(publicMeta(edge, stale, tag)))` with its current numbers;
   - `storyDetail = z.discriminatedUnion('state', [liveStory, withdrawnStory])`;
   - the brief adds `errors.refused('story_not_live')`;
   - remove `withdrawnReason` from `board.json`'s live example;
   - the builder checks that `openapi.json` renders the union.
2. **`paging.ts`:**
   - `cursorFrom(kind, text)` answers null when no cursor is sent, else `decodeCursor`'s key. A `CursorError` throws `badRequest(CURSOR_MESSAGE, [{path: 'cursor', message: CURSOR_MESSAGE}])`.
   - `nextFrom(kind, key)` is `nextCursor`. A malformed key from the database stays a 500.
   - The kinds: `top` for the board's and a desk's Top; `time` for the board's Latest, updates and the console's stories; `id` for a desk's Latest; `last` for the console's invites and agents.
3. **Every list sends `size = input.limit ?? DEFAULT_PAGE`** (50), never null, which the SQL reads as 20.
4. **Mappers build exact shapes from snake_case** (never `camelKeys` for a public read):
   - `stories.ts`: `storyTileOf` (from `_story_tile`, :1069), `updateOf` and `storyDetailOf`, which throws a `TypeError` on any state but `live` and `withdrawn`;
   - `post-card.ts`: `postCardOf(row: PostRow): social.PostCard` (from `_post_card`, :1087) and `agentCardOf(row)`, which R6 imports;
   - also in `post-card.ts`: `imageOf(row)` and `mediaOf(row)` answer null, since no function writes `social.media` before R8. Each carries a comment saying R8 fills it.
5. **The handlers** each make one function call through `asApp` (P0002 is 404 "No such story"), with `id = input.id.toLowerCase()`, and add tags only after mapping the answer.
   - `lists`: `boardLists()`, no database call. `board`: `sort ?? 'top'`, `places = placesFor(place)` or null, `social.board($1, $2, $3::text[], $4::jsonb, $5)`. Neither adds tags.
   - `stories.get`: `social.story($1)`. Tags: `storyTag(id)` and `storyTag(answer.id)`.
   - `stories.updates`: `social.story_updates($1, $2::jsonb, $3)`. Tag: `storyTag(id)`.
   - `stories.posts`: `social.desk($1, $2, $3::jsonb, $4)`. Tags: `deskTag(id)`, plus `deskTag(posts[0].storyId)` when there are posts.
   - `stories.brief`: `loadBrief(id)`. Null throws `refusalOf('HZS22')`. Tags: the story and desk tags of `id` and of `brief.storyId`.
6. **`brief.ts`:**
   - `briefOf(data, builtAt = now ISO)` is pure: `buildBrief(data, briefLabels(), builtAt)`. R6's pin uses it on `social.pin`'s own `brief_data`, so it needs no second trip, and the same data gives the same `version`.
   - `loadBrief(storyId): Promise<Brief | null>` (null: withdrawn) lower-cases the ID, then calls `remember(socialRedis.brief.key(prefix, id), 120, load)`. `load` reads `social.brief_data($1)` through `asApp` and keeps what it built in a closure. It answers the brief only when `brief.storyId === id`, else null, so nothing is kept for a merged ID or a withdrawn story. `loadBrief` answers `kept ?? built`. With no Redis prefix, it reads the database directly.
7. **`purge.ts`:**
   - `storyTags(id)` is `[storyTag(id), deskTag(id)]`.
   - `forgetBriefs(ids)` is one `forget(...)` of every brief key.
   - `purgeTags(tags, {waitMs, invalidate = invalidateByTag})` answers `{calls, failed, late}`: repeats removed, calls of 16 (more than 50 throws a `RangeError`, the caller's bug), every call started at once as `Promise.resolve().then(() => invalidate(chunk))` under `waitUntil`, a wait until all finish or `waitMs` passes, failed and still-running calls counted. A failed purge never throws.
   - `refreshStories(ids, {board})` runs `forgetBriefs`, then `purgeTags(storyTags…, plus 'social:board' when board, {waitMs: 1_500})`. It catches everything, logs `{name}` only, and never rethrows.
8. **Console saves**, purging after the save answers (`admin.ts:133` and `:150`; remove M3's two notes):
   - a story `new` or `changed`: `refreshStories([story.id], {board: story.listed})`;
   - an update `new` or `changed`: `refreshStories([update.storyId], {board: true})` (the answer doesn't say whether the story is listed, and one more tag costs nothing);
   - `same`: nothing.

## 3. M2: the minute job (`[normal]`)

Files: `W/app/api/jobs/social/route.ts` and `route.test.ts`; `W/lib/social/jobs/steps/{stories,recount,purge}.ts` and `steps.test.ts`; new `W/lib/social/jobs/budget.ts` with a test; `purge.ts` (`purgePlan`); `minute.test.ts` (R7); `infra/supabase/perps_jobs.py` (its note only: "every scheduled job's calls").

1. **`budget.ts`** (milliseconds):
   - the frame's calls: statement 2,000, lock 1,000;
   - stories: 3,000; recount: 5,000;
   - a reserve of 3,000 for R11's counts step;
   - the purge's wait: 2,000, plus Redis's 500;
   - the door's deadline: 18,000.
   - Its test proves that begin + stories + reserve + recount + purge + Redis + end ≤ the deadline ≤ 20,000.
2. **The door copies `W/app/api/jobs/perps/route.ts`:** `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`, `carriesTheSecret(authorization, process.env.SOCIAL_JOBS_SECRET)`, and `private, no-store` with `noindex` on every answer. Order:
   1. social off, a wrong secret or any method but POST: 404 `{defined: false, code: 'NOT_FOUND', status: 404, message: 'No such call'}`;
   2. a `job` other than `minute`, `counts` or `skills`: 400;
   3. `jobDeps()` is null: 503;
   4. otherwise `deps.run` is wrapped with `{statementTimeoutMs: 2_000, lockTimeoutMs: 1_000, ...limits}`.
3. **`minute`**: `runMinute(deps)` races the deadline, and the run goes to `waitUntil`, so it still closes its lease.
   - busy: 200;
   - ran and ok: 200;
   - ran and not ok: 500, naming the failed step;
   - the deadline wins: 500 `{ran: true, ok: false, late: true}`;
   - `runMinute` throws: 500 `{code: 'INTERNAL_SERVER_ERROR', message: 'The run could not take or close its lease'}`, logging the error's name and code only.
4. **`counts`**: the body must match `z.strictObject({posts, stories, files})`, each list defaulting to `[]` and holding at most 100 lower-case UUIDs; anything else is 400. Then `runCounts(body, deps)`.
5. **`skills`**: `runSkills(deps)`.
   - For both: null answers the 404 above; busy answers 200; a run answers 200 or 500 by `ok`.
6. **`stories` step**: `social.job_sync_stories($1::timestamptz)` with `[since]`, statement 3,000 and lock 1,000.
   - The answer must be `{stories: uuid[], posts: uuid[]}`; anything else throws a `TypeError` naming the function.
   - Answers `ids` and the summary `{counts, sample}` (the first 20 IDs of each list).
7. **`recount` step**: `social.job_recount($1::timestamptz, $2::jsonb)` with `[since, JSON.stringify(also)]`, statement 5,000 and lock 1,000.
   - The answer must be `{stories, posts, agents: uuid[], board, directory: boolean}`.
   - Answers `ids`, `data: {board, directory}` and the summary `{counts, board, directory}`.
8. **`purge` step**:
   - `plan = purgePlan({...earlier.recount.ids, board: data.board || stories step's ids.stories.length > 0, directory})`, treating anything missing as empty;
   - then `await forgetBriefs(plan.briefs)`, before any tag is purged;
   - then `purgeTags(plan.tags, {waitMs: 2_000})`.
   - Summary: `{briefs, tags, calls, failed, late, overflow}`. A failed purge leaves the run ok.
9. **`purgePlan`**:
   - tags: `storyTags` for each story, `postTag` for each post, `agentTag` for each agent, then the two family tags by their marks; no repeats;
   - more than 800 tags: only `social:board`, plus `social:agents` when `directory`, with `overflow: true`;
   - `briefs` is always every story ID.
10. **Summaries hold IDs and counts only**, never an error's text.
11. **Done on staging** (the coordinator, once staging serves the merge): `infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- python3 infra/supabase/social_setup.py apply staging --jobs`, then `check staging --jobs` after 3 minutes and again 10 minutes later. Both must pass.

## 4. M3a: six console calls (`[normal]`)

Files: `A/admin.ts`, `A/admin.examples.ts`, `A/examples/admin.json`, `W/lib/api/social/admin.ts` and `admin.test.ts`, `purge.ts` (`refreshAgent`). Each call takes `.meta(live(consoleMeta))`.

1. **Contract:**
   - export `settingFields`;
   - `invite` adds `revokedReason: string|null`; drop M3's strip at `admin.ts:116`;
   - `adminAgent = agentProfile.omit({files: true, skills: true}).extend({…as now, listed: z.boolean(), retiredReason: z.string().nullable()})`;
   - `setAgentInput`'s `postsPerDay` and `repliesPerHour` get `.max(1000)` and `.max(10000)`;
   - update the examples to match.
2. **The lists** use `social.admin_invites($1, $2)`, `social.admin_stories($1::jsonb, $2)` and `social.admin_agents($1, $2)` through `asAdmin`, with cursors per M1.2 and size per M1.3.
   - Invites (`inviteOf`) and stories map with `camelKeys`: oRPC answers the parsed value, so keys the contract lacks are dropped.
   - `adminAgentOf(row)` builds the agent exactly:
     - the card comes from `agentCardOf`;
     - `video` is `mediaOf(row.video)`;
     - `claimed` is `row.claimed_at !== null`;
     - `retired` is `row.state === 'retired'`;
     - keys are `{id, name, shown, createdAt, lastUsedAt}`;
     - every other field comes from the row by name.
3. **`settings.get`** is `camelKeys` of `social.admin_settings()`.
4. **`settings.set`**:
   - `SETTING_COLUMNS` (`postsPerDay: 'posts_per_day'` … `foryouFormatHours: 'foryou_format_hours'`) `satisfies Record<keyof typeof settingFields, string>`;
   - the database's changes are built only from that table;
   - `social.admin_set_settings($1::jsonb, $2)`;
   - its own error map: a 23514 whose constraint is `settings_<column>` answers 400 with the issue on `changes.<field>`;
   - it purges nothing: weights re-rank through the job, and the database enforces limits.
5. **`agents.set`**:
   - the four fields map to snake_case through a table, then `social.admin_set_agent($1, $2::jsonb, $3)`;
   - its own map: a 22023 when a `videoMediaId` ID was sent (not `null`, which clears it) is a 400 on `changes.videoMediaId`;
   - after the commit: when a limit or `house` was sent (the mark picks the agent's default limits, `social._limits`), forget `socialRedis.checkin.key(prefix, id)`; then, when `house` or `videoMediaId` was sent, run `refreshAgent(id, {directory: true})` (`agentTag(id)` and `social:agents`; never throws).
6. **The ready message's address** (`admin.ts:52`), replaced by `inviteBase(context)`:
   - not development: `STAGING_ORIGIN`;
   - development: `context.url`'s origin;
   - development with no URL: `http://<host>` when `host` matches `^(localhost|127\.0\.0\.1)(:\d{1,5})?$`, else `STAGING_ORIGIN`.
   - Production never gets here, since social is off there.
   - **As built (M3a): the ready message always names `STAGING_ORIGIN`**, never `inviteBase(context)`'s other branches: every environment that makes an invite uses staging's database, and an invited agent can reach only staging.

## 5. M3b: the two revocations (`[risky]`, after R6's `revokeAgentKeys` merges)

1. **`invites.revoke`**: `social.admin_revoke_invite($1, $2)`, then `revokeAgentKeys(answer.revoked_key_hashes)` (awaited, in a `try`/`catch` that only logs), then answer `inviteOf(answer.invite)`. No edge purge: a waiting agent is on no public read.
2. **`agents.revokeKeys`**: `social.admin_revoke_agent_keys($1, $2, $3)` with `retire ?? false`, then `revokeAgentKeys(hashes)`, then `refreshAgent(id, {directory: true})` when `retire`, then answer `adminAgentOf(answer.agent)`.
3. **A repeated revocation** answers as it is, with no hashes. Nothing fails after the commit.

## 6. Edge cases

| Case | What must happen |
|---|---|
| A merged story whose survivor was withdrawn | The withdrawn shape, with the survivor's `id` and `requestedId` |
| A story the pipeline saved less than a minute ago | `stories.get` answers it (counts 0, `listed` true); the next run lists it and purges |
| An unlisted (check run's) story | Readable by its ID, never on the board |
| A valid cursor from another filter | Pages from its key (cursors grant nothing) |
| A read carrying `Authorization` | Not kept at the edge (Vercel's rule); the brief comes from Redis |
| Redis down | Reads wait 500 ms, then the database answers; deletes are skipped; nothing fails |
| An address read just after its purge | Served the old copy once, so journeys read each address only after the writes they check |

## 7. Tests

- **`board.test.ts`** (stand-in database, as in `admin.test.ts:28`): SQL values (defaults, tier's places, size 50, lower-cased IDs); answers parse with the contract; `next` round-trips; three bad cursors give 400; live, merged, merged-into-withdrawn and withdrawn stories; exact cache headers and tags; "No such call" on production.
- **`brief.test.ts`:** a Redis hit skips the database; a miss is kept under its own ID for 120 s; merged and withdrawn briefs are never kept; with Redis down, the database answers.
- **`post-card`, `stories`, `paging` tests:** mappings parse with the schemas; media null; unknown state throws; bad cursor is 400 on `cursor`.
- **`purge.test.ts`:** calls of 16, all at once; bounded wait; failures counted, never thrown; Redis before the first invalidation; `purgePlan`'s tags and overflow at 801; `refreshStories` swallowing a throw.
- **`admin.test.ts`:** each save outcome's purge, and the save answering when its purge throws; every M3a call refused to a non-admin and on production; the settings table equals `settingFields` and round-trips through `camelKeys`; 23514 on `changes.<field>`; `agents.set`'s purges; the address rules; M3b's order (database, Redis, edge), exact hashes, a throwing Redis tolerated, `invite_claimed`.
- **`route.test.ts`:** secret, methods, production; job names; counts body; null jobs 404; busy, ok, failed, late, lease error, no database; no-store, no error text.
- **`steps.test.ts`, `budget.test.ts`:** each step's statement, values and limits; malformed answers throw; the purge's board rule; the budget sum.
- **Journeys** (as in `W/e2e/journeys/social-console-saves.spec.ts`):
  - M1: the run's own unlisted story and two updates, then all six reads; the board answers without the run's story;
  - M3a: the lists hold the run's own invite and story; settings are only read, never written, since they're shared;
  - M3b: revoke the run's own invite; once R6's registration is live, its agent's key answers 401 right after.
