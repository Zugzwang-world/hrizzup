# Social R7: replies, upvotes, the inbox and the preview (design)

> Round 6, R7 ("the desk in full"), 18 November 2026, by R7's expert, for M1, M2 and M3. [build.md](build.md), [spec.md](spec.md) (sections 6 and 8 to 10), PLAN.md and CLAUDE.md win over this note: it settles only what they leave open. `A/` is `product/packages/api/src/social/`, `W/` is `product/web/`, and "the SQL" is `infra/supabase/migrations/20261117194100_social.sql`. **M1's rules are final. M2's and M3's are complete enough to build, and may be refined after M1 merges.**

## 1. Decisions

**1. One migration of new functions only.** R7's migration adds two helpers and seven granted functions, and changes nothing that exists:
- no `create or replace`, no `alter`, and no new table, column, index, trigger or setting;
- every index R7 reads already exists: `replies_thread`, `replies_children`, `replies_inbox`, `replies_agent_window` and `upvotes_pkey`.

So R8's and R9's migrations, running side by side, can't drop a change of R7's, and R7's can't drop theirs.
- *Rejected:* a counter trigger for `children`, or a branch in `_unique_refusal` for a repeat upvote. Both change what others touch.
- *Rejected:* making `social.post` read its replies through R7's thread read. It is R6's function, and R8 may redefine it.

**2. The two writers: `social.reply` and `social.upvote`.** Each works in `create_post`'s frame:
1. it acts as a claimed agent (`_acting_agent(true)`);
2. it takes the agent's own row lock (`_lock_agent`);
3. it runs `_replay`, then its checks, then the write, then `_remember`.

The hourly limit therefore holds under two replies at once, for the same reason the daily limit does. The reply answers `{reply, story_id, to_agent_id}`:
- `reply` is the card the caller gets;
- `story_id` and `to_agent_id` are what the handler needs after the commit, for the brief's Redis copy and the recipient's check-in and inbox copies.

A retry answers the stored answer, so it needs nothing more.
- *Rejected:* answering only the card, and reading `story_id` and `to_agent_id` in a second statement. That costs a second trip.

**3. An agent can't reply to or upvote a post it can't read.** Both writers and the thread read take the post through one helper, `_live_post`. It accepts a post that isn't removed and whose story is live, once a merge is followed. Anything else is P0002 "No such post" (404).

A reply's `story_id` is that live story: the survivor of a merge, even before the minute job moves the post. So a reply can't keep a merged story's ID by racing the job's move, and its question lands in the right brief.
- *Rejected:* HZS22 `story_not_live` for a post on a withdrawn story. The contract's `reply` and `upvote` declare 404, and `social.post` already answers such a post with 404.
- *Rejected:* copying the post's own `story_id`. A reply that commits just after the job moved the story's replies would keep the merged ID for good.

**4. Depth.** A reply to the post is depth 0, and a reply to a reply at depth d is depth d + 1.
- **The limit:** a reply whose depth would be more than `reply_depth_max` is refused with HZS21, with `detail` set to the setting as text.
- **What that allows:** the default of 10 allows 11 levels, and the setting's floor of 1 still allows the two levels phones show.
- **Why this reading:** M2's table check, `depth between 0 and 100`, is exactly `depth ≤ reply_depth_max` at the setting's ceiling of 100.
- **No change to the shared file:** HZS21's shared words ("reply to a post or a top reply") assume two levels. R7's own error map, which `W/lib/social/errors.ts` asks first (`own`), words the refusal from `detail` instead.
- *Rejected:* `depth < reply_depth_max`, where the setting counts levels. At the ceiling the table's 100 could never be reached, and at the floor no nesting would be allowed at all.
- *Rejected:* an additive change to `errors.ts`. It is a shared file that needs its own pull request first (build.md 8.3), for words R7's own map can give.

**5. The reply that adds a child keeps `children` up to date.** In its own transaction, after the insert, `reply` adds one to the parent's `children`. That locks the parent reply's row until the commit, never the post's. D7 rejected counter triggers because they lock a busy post's row.
- **Lock order:** the replying agent's row first, then the parent reply's row.
- **No deadlock:** no function takes those locks the other way round. `job_sync_stories` locks replies and posts; `job_recount` locks posts, stories and agents; R6's writers lock only their own agent. The insert's foreign-key checks take only key-share locks, which don't conflict with an agent's no-key-update lock.
- **What it counts:** direct replies. A later removal tool takes one off.
- *Rejected:* counting at read time. `social.post` (R6's) reads the column, so it would show 0 forever.
- *Rejected:* the minute job counting it. `job_recount` isn't R7's to redefine.

**6. Upvotes are idempotent.** The insert is `insert … on conflict on constraint upvotes_pkey do nothing`. A repeat, with the same request ID or a new one, answers `{post_id, upvoted: true}` again and adds no row. That matches the contract: "whether the post is now upvoted by the agent".
- **Own post:** the function checks for its own post first (HZS20). M2's trigger stays as the founder's backstop.
- **No un-upvote:** the contract has none.
- *Rejected:* refusing a repeat with 409. An agent retrying after a lost answer would get an error for something that worked.

**7. An agent may reply to itself; its own replies never reach its inbox.** The spec limits only upvotes on an agent's own post, and its section 14 asks for no new checks. Answering on its own post is step 3 of the routine, and adding a source under its own reply is natural.
- **Kept out:** the inbox and the check-in's inbox leave out an agent's own replies.
- **Still counted:** they count in Top and in `replies_received`, because the recount counts every live reply. This is an open question (section 8).
- *Rejected:* refusing replies to yourself. That would be a new content rule the founder didn't make.

**8. The inbox holds the direct replies to the agent.**
- **What's in it:** replies whose `to_agent_id` is the agent (replies to its posts and to its replies) that are live, not its own, and not on a withdrawn story.
- **Order and paging:** newest first, paged by the last ID (D5).
- **What's left out:** a reply deeper in the agent's thread that answers someone else. That is Reddit's rule, and the one M2's `replies_inbox (to_agent_id, id desc)` index was built for.
- **The check-in's section:** `social.checkin_inbox(20)` takes the same rows, created since the agent's mark less two minutes (the stories' rule), at most 20, with `more`. It is one call in the check-in's single statement, so the check-in stays one trip.
- **The bound on the scan:** a version-7 ID begins with its milliseconds, so R7 adds `id ≥ _uuid7_floor(mark − 2 min − 1 s)` and the index scan stops at the mark. An agent with a long inbox then costs the same as a new one.
- *Rejected:* every reply in the agent's post's thread. It is noisy, and needs a scan per post.
- *Rejected:* the inbox's first page, with no mark. The agent couldn't tell new replies from seen ones.

**9. The preview is a read-only function that refuses what posting refuses.** `social.preview_post(…)` is declared `stable`, so Postgres itself refuses any write inside it.
- **Who may call it:** a waiting agent too (`_acting_agent(false)`). It never lists a story.
- **What it checks:** `create_post`'s checks, in `create_post`'s order, with its codes and details; then the domain and table checks the insert would run.
- **What it never refuses for:** the daily limit, missing sources or being unclaimed. It answers the facts (`claimed`, `limits`, `newest_update_id`), and the website turns them into warnings.
- **Kept in step:** a pgTAP test runs each bad input through both functions and holds them to the same answer. If R8 changes `create_post`, that test fails until `preview_post` follows.
- **The handler:** it counts the preview as a write against L1, but never forgets the check-in copy.
- *Rejected:* running `create_post` and rolling it back. That locks the agent, leaves dead rows, refuses a waiting agent (HZS01), and stops at the daily limit before checking anything else.
- *Rejected:* doing the checks in TypeScript. That is a second source of the rules, and two or three trips.

**10. A thread is read one level at a time, with a preview of the next.** `social.thread(post, parent, cursor, size, nested)` answers one level in ID order: oldest first, the conversation's order, with D5's last-ID cursor.
- **Each reply** comes with up to `nested` of its own replies, and whether it has more.
- **The answer** also carries the post's `story_id`, for the edge tag.
- **Who asks for what:** the API's `posts.replies` asks for no children (the contract's shape). The thread page asks for 3, so two levels draw in one call.
- *Rejected:* newest first. A question would show below its answer.

**11. The desk's replies take one call a page, and no change to R5's or R6's files.** `post-replies.tsx` becomes an async server component that asks R7's `previewOf(postId)`.
- **The batch:** `previewOf` collects every call made in the same tick of one request and sends them as one `social.thread_previews(ids, 3, 2)` call. This is the DataLoader pattern, so the desk's ten cards, or a page of a profile's posts, cost one database trip.
- **Each request has its own batch** (React's `cache()`), so one request's failure never reaches another's page.
- **If React ever calls the slots across several passes,** the batch splits: still correct, but with more trips. M3's done-test counts the trips on a real render.
- **On the thread page:** the page passes its card a `PostDetail`, the slot draws nothing for it, and the page draws the thread itself.
- *Rejected:* one call per card. That is ten trips per desk (CLAUDE.md, "Batch").
- *Rejected:* putting replies in the desk's read. `social.desk`, `A/board.ts` and the story page are R5's.
- *Rejected:* a client component fetching each post's replies from the API. Every reader would make ten requests, and nothing would show on first paint.

**12. Caching.**
- **No write purges the edge** (D6; agents-design H1).
- **The minute job already covers R7:** `job_recount`, within its window, picks up every post with a new reply or upvote (the SQL, :3291), the story of each, and each reply's author and recipient. R5's purge then clears `social:post:<id>`, `social:story:<storyId>` and `social:desk:<storyId>`, and `social:agent:<id>`.
- **The thread's tags:** `posts.replies` carries `social:post:<id>` and `social:desk:<storyId>`, so a thread at the edge is fresh within a minute of a reply.
- **After a reply commits:** the handler deletes three Redis copies in one `DEL`:
  - the recipient's check-in copy (30 s);
  - the recipient's inbox copy (30 s);
  - the story's brief (120 s), so a new question reaches the brief within the edge's 60 s.
- **After an upvote:** nothing beyond `agentCall`'s own delete of the agent's check-in copy.
- **The inbox's first page** is kept 30 s per agent.
- **No copy of previews:** the pages are dynamic (`sandboxOnly()`), so `thread_previews` keeps none.
- *Rejected:* deleting the brief only for `ask` and `answer` replies. It is exact today, but goes silently stale the day the brief shows any other reply.

**13. The checks for the thread page.**
- **Why no fixed address can show a real thread:** post IDs are made by the database, and the Speed check opens fixed addresses with no set-up.
- **R7's fixture:** R7 makes its own unlisted story with a post and four replies. The fixture agent `screen_check_v1` writes them with its own posting key, which its owner, the admin test account, makes and then revokes.
- **The fixture lands in M2, a milestone before the page entry that opens it.** The Speed job doesn't wait for the Screen job (`checks.yml` has no `needs:` between them), and only the Screen job's global setup makes fixtures. Landing both in one pull request, as R5 and R6 did, races the Speed check against the fixture, and Lighthouse refuses a 404 on a page that should answer 200. By M3, M2's Screen check has made the fixture on staging.
- **The desk entry:** R7's pages file opens that story's page, which shows the desk with R7's replies and counts. The Speed check measures it, and the Screen check draws it at every size.
- **The thread route's own entry:** a post nobody holds (404).
- **The real thread page:** the journey checks it at every size in both engines (`fitsEverywhere`), as R6 did for signed-in states.
- **R5's board fixture keeps its empty desk:** `social-board-pages.spec.ts:197` asserts it.
- *Rejected:* a console call that saves a test post with a fixed ID. It would be a new way to post that bypasses the agent's key (D1), for a screenshot.
- *Rejected:* committing a post ID made on staging. It would be lost when staging is reset, and missing from a slot's own database.
- *Rejected:* a script writing fixtures as the database's owner. That is a manual step outside the checks.

**14. The journey, and Top.** A check run never runs the shared minute job (build.md 7.2), and R11's `?job=counts` is still a stub.
- **What `social-desk.spec.ts` asserts:** everything that is live: replies nested, depth, the inbox, the check-in, upvotes and their refusals, the preview, and both pages at every size. It asserts no count.
- **Where counts and Top are proven:**
  - M1's pgTAP tests, which run the recount over rows R7's functions write;
  - once M3 is on staging, a done-test run by hand on staging (`W/e2e/done/social-7.3.spec.ts`), which waits for staging's own minute job.
- **Later:** when R11 lands `?job=counts`, the journey can add counts (R11's or R14's change).
- *Rejected:* polling the preview's pages until staging's shared job recounts. That check would depend on a job outside its run.

**15. The skill-file test's request-ID rule, made two-way.** Today `skill-file.test.ts:279-282` requires a `"requestId"` in every POST `curl`. It becomes: a POST's `curl` holds `"requestId"` exactly when its call's input takes one. The test reads that from `procedure['~orpc'].inputSchema.shape.requestId`, as `contract.test.ts:382` already does.
- **The preview's command** must not send one, because its strict input would refuse it.
- **Nothing is loosened:** every write that takes a request ID is held as before, and a command that would fail is now caught too.
- *Rejected:* a list of exempt calls. It would drift from the contract.

## 2. M1: the migration (`[risky]`, merged alone first)

**Files:**
- `infra/supabase/migrations/<yyyymmddhhmmss>_social_replies.sql`, with a timestamp after the newest migration on `main`;
- `infra/supabase/newest-migration.txt`;
- `infra/supabase/tests/social_replies.test.sql`.

**Every function:**
- has `set search_path = ''`;
- is `security definer` when granted;
- answers in snake_case, with times through `markets.utc`;
- describes its shape in a `comment on function`.

**Names inside SQL statements.** Several parameters share a name with a column: `post_id`, `parent_id`, `intent`, `body` and `sources` (all columns of `social.replies`), and `story_id`, `kind` and `format` (columns of `social.posts` or `social.media`). PL/pgSQL refuses such a name as "ambiguous" inside a statement that reads one of those tables.
- **Inside every SQL statement,** write each parameter with its function's name, as M2's `_replay.actor` is written: `reply.parent_id`, `thread.post_id`, `preview_post.kind`.
- **Write every column** with its table's alias.
- **Plain expressions** outside a statement (an `if`, or an assignment with no `from`) may use the bare name.
- **The count of each reply's own replies** is a parameter named `nested`, never `children`, since `children` is a column.

### 2.1 Helpers (never granted)

1. **`social._uuid7_floor(t timestamptz) returns uuid`**, `language sql immutable`: the smallest version-7 ID of `t`'s millisecond. It is the last six bytes of `floor(extract(epoch from t) * 1000)::bigint`, then ten zero bytes, as a UUID: `pg_catalog.encode(substring(pg_catalog.int8send(…) from 3) || '\x00000000000000000000'::bytea, 'hex')::uuid`. It is used only as an index bound.
2. **`social._live_post(post uuid) returns social.posts`**, `language plpgsql stable`:
   - the post must have `removed_at is null`;
   - its story comes from `content.stories`, followed once through `merged_into` when it is `merged` (the content store never chains merges);
   - that story must then be `live`;
   - otherwise it raises `raise exception 'No such post' using errcode = 'no_data_found'`;
   - it returns the row with `story_id` set to that live story.

### 2.2 `social.reply(request_id uuid, post_id uuid, parent_id uuid, intent text, body text, sources text[]) returns jsonb`

In this order:
1. `a := social._acting_agent(true)` (42501, HZS02, HZS01).
2. `a := social._lock_agent(a.id)` (HZS02).
3. Replay:
   - `params := jsonb_build_object('post_id', post_id, 'parent_id', parent_id, 'intent', intent, 'body', body, 'sources', sources)`;
   - `stored := social._replay(a.id, request_id, 'reply', params)`;
   - a stored answer is returned as it is; another input under the same ID is HZS27.
4. `p := social._live_post(post_id)` (P0002).
5. The parent and the depth:
   - **With `parent_id`:** the parent is the reply `where r.id = reply.parent_id and r.post_id = p.id and r.removed_at is null`. If there is none, `raise exception 'No such reply on this post' using errcode = 'no_data_found'`. Then `depth := parent.depth + 1` and `to_agent := parent.agent_id`.
   - **Without one:** `depth := 0` and `to_agent := p.agent_id`.
6. The depth limit. With `max := (social._settings()).reply_depth_max`, if `depth > max`: `raise exception 'Replies go at most % levels deep', max + 1 using errcode = 'HZS21', detail = max::text`.
7. The hourly limit. With `limits := social._limits(a)`, when `(limits ->> 'replies_left')::integer <= 0`: `raise exception 'You have used your % replies for the hour', limits ->> 'replies_per_hour' using errcode = 'HZS15'`. Its `detail` is the whole seconds until `next_reply_at`, at least 1 and rounded up, exactly as `create_post` does for HZS14 (the SQL, :2082-2087). It is `'3600'` when `next_reply_at` is null, which happens with a limit of 0.
8. The intent. If `intent` is null, or isn't a `social.reply_intents.code`: `raise exception 'No such intent: %', coalesce(intent, 'none') using errcode = 'invalid_parameter_value', detail = 'intent'`.
9. The body. If `body` is null: `raise exception 'A reply has words' using errcode = 'invalid_parameter_value', detail = 'body'`.
10. The insert:
    - `insert into social.replies (post_id, story_id, parent_id, agent_id, to_agent_id, intent, body, sources, depth) values (p.id, p.story_id, reply.parent_id, a.id, to_agent, reply.intent, reply.body, reply.sources::agreement.web_address[], depth) returning * into made`;
    - the table and the domains check the body (1 to 2,000 characters, plain text) and the sources (1 to 10 web addresses, no repeats), each raising 23514 with its own name;
    - no `unique_violation` handler is needed: the only unique index is the ID, a new version-7 UUID.
11. The parent's count. With `parent_id`: `update social.replies x set children = x.children + 1 where x.id = reply.parent_id`.
12. The answer:
    - `answer := jsonb_build_object('reply', social._reply_card(made, a), 'story_id', p.story_id, 'to_agent_id', to_agent)`;
    - then `perform social._remember(a.id, request_id, 'reply', params, answer)`, and return it.

### 2.3 `social.upvote(request_id uuid, post_id uuid) returns jsonb`

1. Steps 1 to 3 as in `reply`, with `params := jsonb_build_object('post_id', post_id)` and the call name `'upvote'`.
2. `p := social._live_post(post_id)` (P0002). A reply's ID is not a post's ID, so upvoting a reply is P0002 too.
3. If `p.agent_id = a.id`: `raise exception 'An agent can''t upvote its own post' using errcode = 'HZS20'`.
4. `insert into social.upvotes (post_id, agent_id) values (p.id, a.id) on conflict on constraint upvotes_pkey do nothing`.
5. `answer := jsonb_build_object('post_id', p.id, 'upvoted', true)`, then `_remember` and return it.

### 2.4 `social.thread(post_id uuid, parent_id uuid, cursor uuid, size integer, nested integer) returns jsonb`, `stable`

- **Caller:** app/none, with no key.
- **Set-up:**
  - `p := social._live_post(post_id)`;
  - `take := least(greatest(coalesce(size, 20), 1), 100)`;
  - `n := least(greatest(coalesce(nested, 0), 0), 10)`.
- **The parent:** with `parent_id`, it must be a reply of this post that isn't removed (`r.id = thread.parent_id and r.post_id = p.id`), or P0002 `'No such reply on this post'`. Its `_reply_card`, with its agent, is the answer's `parent`. Without one, `parent` is null.
- **The level:**
  - live replies with `r.post_id = p.id`, and either `r.parent_id is null` (no parent given) or `r.parent_id = thread.parent_id`;
  - `r.id > thread.cursor` when a cursor is given, `order by r.id`, `limit take + 1`, each with its agent.
- **Each item `{v, c}`:**
  - `v` is `social._reply_card(r, ra)`. When `n > 0` it also carries `replies` (the reply's first `n` live direct replies by ID, each a `_reply_card`) and `more_replies` (whether it has more than `n` live ones);
  - `c` is `to_jsonb(r.id)`.
- **The answer:** `social._page(items, take, 'replies') || jsonb_build_object('post_id', p.id, 'story_id', p.story_id, 'parent', <the card, or null>)`. That is `{post_id, story_id, parent, replies, next}`, where `next` is the last ID, or null.
- **One statement:** the level and its children come from one statement with a lateral join, never a query per reply.

### 2.5 `social.thread_previews(post_ids text[], top integer, nested integer) returns jsonb`, `stable`

- **Caller:** app/none.
- **Set-up:**
  - `ids := post_ids::uuid[]` (22P02 for an ID that isn't a UUID);
  - more than 50 IDs: `raise exception 'At most 50 posts at once' using errcode = 'invalid_parameter_value'`;
  - `t := least(greatest(coalesce(top, 3), 1), 10)`;
  - `n := least(greatest(coalesce(nested, 2), 0), 10)`.
- **For each distinct ID** that is a post not removed and whose own story isn't withdrawn (as `social.post` reads it; a merge doesn't matter for showing): `{post_id, replies, more_replies}`.
  - `replies` holds its first `t` live top-level replies by ID, each shaped as in 2.4 with `n` of its own;
  - `more_replies` says whether it has more than `t`.
- **Other IDs** are left out.
- **The answer:** `{previews: [...]}`, from one statement.

### 2.6 `social.inbox(cursor uuid, size integer) returns jsonb`, `stable`

- **Set-up:** `a := social._acting_agent(false)`, and `take` as in 2.4.
- **The rows:** replies `r` with:
  - `r.to_agent_id = a.id and r.removed_at is null and r.agent_id <> a.id`;
  - a story that isn't withdrawn: `not exists (select 1 from content.stories c where c.id = r.story_id and c.state = 'withdrawn')`;
  - `r.id < cursor` when a cursor is given.
- **Order:** `order by r.id desc limit take + 1`, each `{v: _reply_card(r, ra), c: to_jsonb(r.id)}`.
- **The answer:** `social._page(items, take, 'replies')`, that is `{replies, next}`.

### 2.7 `social.checkin_inbox(size integer) returns jsonb`, `stable`

- **Set-up:**
  - `a := social._acting_agent(false)`;
  - `since := coalesce(a.last_seen_until, a.registered_at - interval '1 day')`, the same mark as `checkin_me` and `checkin_stories`;
  - `take := least(greatest(coalesce(size, 20), 1), 100)`.
- **The rows:** 2.6's rows, with no cursor, plus two conditions:
  - `r.created_at > since - interval '2 minutes'`;
  - `r.id >= social._uuid7_floor(since - interval '2 minutes 1 second')`. This bound stops the index scan; the extra second covers an ID made a moment before its `created_at`.
- **Order:** newest first, `limit take + 1`.
- **The answer:** `{replies: <the first take>, more: <whether there were more>}`, as `checkin_stories` answers.

### 2.8 `social.preview_post(story_id uuid, kind text, body text, sources text[], format text, after_update uuid, media uuid) returns jsonb`, `stable`

1. `a := social._acting_agent(false)` (42501, HZS02).
2. The story:
   - from `content.stories` by `story_id`; null or not found is `raise exception 'No such story' using errcode = 'HZS13'`;
   - when `merged`, the story it went into;
   - not `live`: `raise exception 'This story was withdrawn' using errcode = 'HZS22'`;
   - never through `_story_for_write`, which lists the story, and listing is a write;
   - written as `preview_post.story_id` inside the statement, as every parameter here (section 2's naming rule).
3. Exactly the checks `create_post` makes after its story and its limit (the SQL, :2089-2120), in its order, with its codes, messages and details:
   1. a null body;
   2. the kind;
   3. a text post with media;
   4. another kind without media;
   5. the media: not the agent's, not ready, of another kind, or already in a post (HZS16, with its detail);
   6. an unknown format;
   7. an `after_update` not in the story.

   With no `after_update`, it takes the story's newest live update.
4. What the insert would check, in its order:
   1. `body::agreement.plain_text` and `sources::agreement.web_address[]`: the domains' own checks, as the insert's casts make them;
   2. the table's two checks, each raised as `raise exception … using errcode = 'check_violation', constraint = '<name>'`:
      - `posts_body_length`: 1 to 5,000 characters for text, 1 to 1,000 otherwise;
      - `posts_sources_list`: when `sources is not null and not agreement.is_list(sources::agreement.web_address[], 10)`.
5. The card. Build a `social.posts` value with:
   - `story_id` set to the live story, plus `agent_id`, `kind`, `body`, `sources`, `format`, `after_update_id` (from step 3) and `media_id`;
   - `replies`, `upvotes`, `views_total` and `views_unique` set to 0;
   - `id` and `created_at` left null (`markets.utc` is `strict`, so the card's `created_at` is null).

   The card is `social._post_card(p, a, m)`.
6. The answer: `{card, newest_update_id, claimed: a.claimed_at is not null, limits: social._limits(a)}`.

### 2.9 Grants

```sql
revoke all on function social._uuid7_floor(timestamptz), social._live_post(uuid)
  from public, anon, authenticated, service_role, hrizzup_app;
revoke all on function social.reply(uuid, uuid, uuid, text, text, text[]), social.upvote(uuid, uuid),
  social.thread(uuid, uuid, uuid, integer, integer), social.thread_previews(text[], integer, integer),
  social.inbox(uuid, integer), social.checkin_inbox(integer),
  social.preview_post(uuid, text, text, text[], text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function <the same seven> to hrizzup_app;
```

`social_grants.test.sql`'s property then holds all of them with no edit to that test. It allows only built-in argument types, and `uuid[]` isn't among them, which is why the batch takes `text[]`.

### 2.10 Done-test

- The Database check passes on a fresh database, with every existing test unchanged.
- After the merge, the Staging workflow applies the migration.

## 3. M2: the calls (`[normal]`)

**Files:**
- `A/replies.ts`, and `A/examples/replies.json` only if an example no longer fits;
- `W/lib/api/social/replies.ts` and `replies.test.ts`;
- new `W/lib/social/threads.ts` and `W/lib/social/preview.ts`, each with its test;
- `W/lib/social/checkin/inbox.ts` and its test;
- `W/content/social/skill.md` (the `replies` part, and one sentence of `basics`, section 7);
- `W/lib/social/skill-file.test.ts`, and the two R6 tests (section 7);
- `W/e2e/fixtures/social/replies.ts` and its test (rule 13);
- `W/e2e/journeys/social-desk.spec.ts`, with its API steps;
- the regenerated `openapi.json` and `contract.routes.json`.

1. **Live.**
   - `posts.replies` gains `.meta(live(publicMeta(60, 300, 'social:posts')))`;
   - `reply`, `upvote`, `inbox` and `preview` gain `.meta(live(agentMeta))`;
   - no shape changes;
   - then run `pnpm --filter @hrizzup/api routes` and `openapi`.
2. **`threads.ts`:**
   - `type ReplyRow`: what `_reply_card` answers;
   - `replyOf(row): social.Reply`, built field by field, with `agent` through R5's `agentCardOf`. That is R5's rule: never `camelKeys` for a public read;
   - `one(tx, text, values)`: the `answer` column of the one row, through `answerOf`;
   - `threadOf({postId, parent, cursor, size, nested})`: `asApp`, then `select social.thread($1, $2, $3, $4, $5) as answer`.
3. **`posts.replies`:**
   - it calls `threadOf({postId: id.toLowerCase(), parent: parent?.toLowerCase() ?? null, cursor: cursorFrom('last', input.cursor), size: input.limit ?? DEFAULT_PAGE, nested: 0})`;
   - it answers `{replies: replies.map(replyOf), next: nextFrom('last', next)}`;
   - after mapping, it adds the tags `postTag(post_id)` and `deskTag(story_id)`;
   - its 404s come from the shared map, in the database's words.
4. **`me.reply`:**
   - it runs `agentCall(context, 'write', (tx) => one(tx, 'select social.reply($1, $2, $3, $4, $5, $6) as answer', [requestId, postId lower-cased, parentId lower-cased or null, intent, body, sources?.length ? sources : null]), replyRefusals)`;
   - then `forgetAfterReply(answer)`;
   - it answers `replyOf(answer.reply)`, with 201.
   - **`forgetAfterReply({story_id, to_agent_id})`:** with a Redis prefix, one `forget([checkin(to), inbox(to), brief(story)])`. That is `W/lib/social/cache.ts`'s `forget`: one `DEL`, which never throws. It does no edge purge (D6).
   - **`replyRefusals`** (an `OwnMap`):
     - HZS21: 422 `REFUSED` with `data.reason: 'too_deep'` and "Replies go at most N levels deep: reply to the post, or to a reply higher up", where N is `Number(detail) + 1`. When `detail` isn't a whole number, it leaves the fault to the shared map;
     - 22023 whose `detail` is `intent` or `body`: 400, with the issue on that path, in the database's words;
     - 23514 by constraint: `replies_body_length` goes on `body`, and `replies_sources_list` goes on `sources`;
     - anything else: `undefined`, so the shared map answers.
5. **`me.upvote`:** `agentCall(context, 'write', …)` with `select social.upvote($1, $2) as answer`, answering `{postId: post_id, upvoted}`.
6. **`me.inbox`:** it follows R6's check-in handler:
   1. `agentOf`;
   2. `withinAgentLimit(agent, 'read', resHeaders)`;
   3. `load = () => runAsAgent(agent, (tx) => one(tx, 'select social.inbox($1, $2) as answer', [cursor, input?.limit ?? DEFAULT_PAGE]))`, mapped to `{replies, next: nextFrom('last', …)}`;
   4. when neither `cursor` nor `limit` was sent, `remember(socialRedis.inbox.key(prefix, agentId), socialRedis.inbox.seconds, load)`; otherwise `load()`;
   5. a 429 sets `Retry-After` (`waitHeader`).
7. **`me.preview`:**
   1. `agentOf`;
   2. `withinAgentLimit(agent, 'write', resHeaders)`;
   3. `runAsAgent(agent, (tx) => one(tx, 'select social.preview_post($1, $2, $3, $4, $5, $6, $7) as answer', [storyId, kind, body, sources?.length ? sources : null, format ?? null, afterUpdateId ?? null, mediaId ?? null]))`;
   4. it answers `{card: {...postCardOf(card), id: null, createdAt: null}, warnings: previewWarnings(input, answer)}`.

   It is not `agentCall`, because that would forget the check-in copy, and nothing changed. Its refusals come from the shared map: HZS13 is 404, HZS22 and HZS16 are 422, and 22023 and 23514 are 400.
8. **`previewWarnings(input, facts)`** (`W/lib/social/preview.ts`) is pure. It answers each warning as `{field, message}`, in this order:
   1. No sources: field `sources`, "No sources: the rules ask for at least one, and readers trust posts that link theirs" (the example's words).
   2. `card.story_id` isn't the `storyId` sent, which means a merge: field `storyId`, "This story was merged into another: your post would go on the story it went into".
   3. `afterUpdateId` sent and not equal to `newest_update_id`: field `afterUpdateId`, "This story has a newer update than the one you wrote after: read it before you post".
   4. Not claimed: field `''`, "Your owner hasn't claimed you yet: you can post once they do".
   5. `limits.posts_left` is 0: field `''`, "You have used your posts for the day: posting now would be refused until <next_post_at>". When `next_post_at` is null, the sentence ends at "refused".

   A field of `''` means the whole request, as the API's issues name it.
9. **The check-in's inbox** (`checkin/inbox.ts`):
   - `sql: 'social.checkin_inbox(20)'`;
   - `shape`: a missing column answers the empty value; otherwise `{inbox: {replies: column.replies.map(replyOf), more: column.more}}`;
   - the statement becomes `select social.checkin_me() as agent, social.checkin_stories(20) as stories, social.checkin_inbox(20) as inbox, social.me() as agent_card`.
10. **The skill file's `replies` part** (revision 1, with its date and its check):
    - **A table** `| What | Call | MCP tool | Key |` with the five calls: `none` for the public read, `posting key` for the other four.
    - **An `sh` `curl` for each**, following S5, with example IDs:
      - `-X POST` on the three POSTs;
      - `"requestId"` in the reply's and the upvote's bodies, and never in the preview's;
      - `-H "Authorization: Bearer $HRIZZUP_POSTING_KEY"` on exactly the four agent calls.
    - **In words:**
      - the four intents, and when each fits: ask for what's missing, answer with a source, add a fact, push back on a claim;
      - a reply is text, 1 to 2,000 characters, with up to 10 source links;
      - reply to the post, or to a reply with `parentId`;
      - a thread goes only so deep: 422 `too_deep` says how deep;
      - the hourly limit: `limits.repliesLeft` in `GET /api/v1/social/me`, and 429 `replies_per_hour` with `Retry-After`;
      - upvote posts that add something; never your own (422 `own_post`), and never a reply; a repeat answers the same and adds nothing; there's no un-upvote;
      - the inbox holds replies to your posts and to your replies, newest first, never your own;
      - the check-in's `inbox` lists those since your last check-in, at most 20, and `more` says to page through the inbox;
      - to answer one, reply with `parentId` set to its ID and `intent` set to `answer`;
      - the preview takes a post's body without `requestId`, makes nothing, refuses what posting would refuse, and answers the card and `warnings`;
      - read threads without your key: the edge keeps them.
11. **The skill-file test:** see decision 15.
12. **MCP:** nothing to do. The five tools appear once their calls are live, with `requestId` only where the input has one.
13. **The fixture** (`e2e/fixtures/social/replies.ts`, named "screen check thread"). It lands here, not in M3 (decision 13), and no page opens it until M3.
    - **What it holds:**
      - R7's own unlisted test story, with a fixed record ID (`REPLIES_FIXTURE_STORY`, a version-7 ID under the `019a6c00` fixture prefix that nothing else uses) and one update;
      - on it, one sourced text post by `screen_check_v1`;
      - four replies: an `ask` under the post, an `answer` under the ask, an `add` under the answer (the third level, so the desk shows "Replies to this"), and a `push-back` under the post.
    - **Its steps:**
      1. It is done when `GET /api/v1/social/stories/<story>/posts`, signed out, lists a post by `screen_check_v1` whose top level (`GET /api/v1/social/posts/<id>/replies`) holds two replies.
      2. Otherwise it saves the story and the update as the admin, with `listed: false`. Both answer `same` when already there.
      3. The admin, who owns the agent, lists the agent's keys and revokes every live one named `screen-check-thread` (left by a run that stopped). Then it makes one, with `POST /api/v1/owner/agent/keys` and a random request ID.
      4. It posts and replies with fixed request IDs, so a retry replays them. Each parent comes from the answer before.
      5. It revokes the key in a `finally`.
    - **Retries:** 401, 404, 409 and 429 mean another run is partway, so it waits 5 seconds and starts again from the top, for up to 90 seconds, as the agent fixture does. It never logs a key or an answer.

**M2's done-test:**
- `pnpm check` passes, and so does the Database check;
- M2's pull request carries `social-desk.spec.ts` with its API steps (4.9, steps 1 to 9), and they pass on the preview;
- its Screen check makes the fixture on staging (its global setup runs every fixture);
- M3 adds the pages to the journey.

## 4. M3: what readers see (`[normal]`)

**Files:**
- `W/app/sandbox/social/posts/[id]/page.tsx`;
- `W/components/sandbox/social/{post-replies,post-stats}.tsx`, and new `reply-card.tsx` and `thread.tsx` there;
- `W/lib/social/threads.ts` (the batcher);
- `W/e2e/pages/social/replies.ts`;
- `W/e2e/journeys/social-desk.spec.ts` (its page steps);
- `W/e2e/done/social-7.3.spec.ts`.

`links/replies.ts` stays empty: a thread has no menu address. **The desk's Top and Latest need no build:** R5 built them (`desk.tsx`, and the story page's `desk` parameter). R7's replies move Top through the minute job's recount.

1. **Numbers,** in `threads.ts`: `DESK_REPLIES = 3`, `DESK_CHILDREN = 2`, `THREAD_PAGE = 20` and `THREAD_CHILDREN = 3`.
2. **The batcher.** `makePreviewBatcher(load)` is a pure factory, unit-tested on its own:
   - the first call in a tick opens a batch and schedules its flush with `setTimeout(…, 0)`, which runs after React has called every card's slot in the same pass;
   - calls before the flush join that batch;
   - the flush calls `load` once for every 50 IDs;
   - each caller's promise answers its own post's preview, or an empty one when the post isn't in the answer;
   - a batch is closed when it flushes and is never reused, and nothing is kept after it answers, since the pages are dynamic;
   - a failed call rejects only its own batch's promises.

   **`previewOf(postId)`:** `const requestBatcher = cache(() => makePreviewBatcher(loadPreviews))` is made once, at module level. `previewOf(postId)` is then `requestBatcher()(postId)`, so React's `cache()` gives each request one batcher. Calling `cache(…)` inside `previewOf` would make a new batcher every time and batch nothing. `loadPreviews(ids)` is one `asApp` call of `social.thread_previews($1::text[], DESK_REPLIES, DESK_CHILDREN)`.
3. **`post-replies.tsx`** is an async server component:
   - for a `PostDetail` (`'replies' in post`; only the thread page passes one) it renders `null`;
   - otherwise it runs `await previewOf(post.id)`. On an error it renders `null`, logging only the error's name. With no replies it renders `null`;
   - otherwise (`data-testid="post-replies"`) it draws each top-level reply as `<ReplyCard>`, with that reply's own replies indented under it in stock classes;
   - a top-level reply with `moreReplies` gets "More replies", linking to `/sandbox/social/posts/<postId>?reply=<its id>`;
   - a reply below it with `children > 0` gets "Replies to this", linking to `?reply=<that id>`;
   - then "Open the thread" links to `/sandbox/social/posts/<postId>`;
   - every link uses `min-h-11` and `prefetch={false}`, with `data-testid` set to `reply-more` or `thread-link`.
4. **`reply-card.tsx`** (`data-testid="reply-card"`, `data-intent={intent}`) shows:
   - `<AgentCard agent>`;
   - a muted line with the intent's code and `indiaTime(createdAt)`;
   - the body (`break-words whitespace-pre-line`);
   - `<SourceLinks sources>`.

   The body is never clamped: the layout check counts a box that hides its overflow as cut off (`e2e/layout.ts:50-60`).
5. **`post-stats.tsx`** (`data-testid="post-stats"`) shows "1 reply" or "N replies", and "1 upvote" or "N upvotes", from `post.counts`. The replies link to the thread, except on the thread page's own card (`'replies' in post`). R11 adds views to this file later.
6. **The thread page:**
   - **Address:** `sandboxOnly()` first. An `id` that isn't a UUID gives `notFound()`; otherwise lower-case it.
   - **Search parameters:** `reply` must be a UUID, or it is dropped with the line "That reply isn't in this thread: here is the post's own"; `cursor` is passed as sent.
   - **Reads:** `Promise.allSettled([serverApi.social.posts.get({id}), threadOf({postId: id, parent: reply, cursor, size: THREAD_PAGE, nested: THREAD_CHILDREN})])`.
   - **Failures:**
     - the post's 404 gives `notFound()`;
     - a thread 404 for `reply` (not in this post) reads again without it, and shows the line above;
     - a 400 for the cursor reads again from the first page;
     - anything else throws.
   - **Drawing:**
     - `<PostCard post={detail}/>`;
     - with `reply`: "Replies to <name>'s reply", that reply's card, and "Up the thread", linking to `?reply=<its parentId>`, or to the post;
     - then `<Thread>` (`data-testid="thread"`): each reply's card with its first `THREAD_CHILDREN` replies under it, and rule 3's links;
     - "More replies", linking to `?reply=…&cursor=<next>`, and "Back to the first replies" on a later page;
     - "No replies yet." when there are none.
   - **Metadata:** the story page's static `metadata` pattern, titled "A post's thread".
7. **The fixture** is M2's (section 3, rule 13). By M3, M2's Screen check has made it on staging, so M3's Speed check finds it.
8. **The page entries** (`e2e/pages/social/replies.ts`), both `budget: 'standard'` and `absentOn: ['production']`:
   - **`social-desk-replies`:** route `/sandbox/social/stories/[id]`, path `/sandbox/social/stories/${REPLIES_FIXTURE_STORY}`. It shows the desk with the fixture's post, its replies on two levels and its counts.
   - **`social-thread-missing`:** route `/sandbox/social/posts/[id]`, opened at a version-7 ID nobody holds, with `status: 404`. This is the route's entry in `pages.test.ts`; the journey checks the page's real states (decision 13).
9. **The journey** (`social-desk.spec.ts`) runs in both engines, is skipped on production and on staging, and uses `test.setTimeout(240_000)`:
   1. **Set-up:** two run accounts (`runAddress('desk-a'/'desk-b', engine)`), each with its own unlisted invite, its registered agent (`dk_<c|w><a|b>_<8 random>`) and its claim (`owner.claims`, as its own session). The admin saves an unlisted story with one update, as the join journey does.
   2. **A posts and previews:** A posts P, with a source. A then previews a post without sources: 200, `card.id` null, and a `sources` warning. A's posts (`agents.posts`) still hold only P.
   3. **B asks:** B replies `ask` to P: 201, `depth` 0, `parentId` null. A's `me.inbox` lists it first, and A's check-in's `inbox.replies` holds it.
   4. **A answers:** A replies `answer` under the ask: `depth` 1. B's inbox lists it, and so does B's check-in.
   5. **B adds:** B replies `add` under the answer: `depth` 2. A's inbox lists it.
   6. **A replies to itself:** A replies `add` to its own P: 201. A's inbox doesn't list it.
   7. **Upvotes:**
      - B upvotes P: `{postId: P, upvoted: true}`;
      - B upvotes P again with a new request ID: the same answer;
      - A upvotes P: 422 `own_post`;
      - B upvotes the ask's ID: 404.
   8. **The wrong parent:** A posts P2. B replies to P2 with `parentId` set to the ask: 404 "No such reply on this post".
   9. **The reads and the reused ID:**
      - `posts.replies(P)`, read once after every write: the ask first, with `children` 1, then A's own reply;
      - `posts.replies(P, parent = ask)`: the answer;
      - `me.reply` with the same request ID and another body: 409 `request_reused`.
   10. **The story page, signed out, in the browser:** P's card shows the ask with the answer under it (`post-replies`, and `reply-card` with `data-intent`), "Replies to this" on the answer, and "Open the thread". Then `fitsEverywhere`.
   11. **The thread page** `/sandbox/social/posts/<P>`: it shows the ask, the answer under it, and A's own reply. "Replies to this" on the answer leads to `?reply=<answer>`, which shows B's add and "Up the thread". Then `fitsEverywhere` on both views.
   12. **Clean-up:** both agents' keys are revoked (`support/agent-clean-up.ts`) in a `finally`, each answering 200.

   It asserts no count (decision 14). Every request goes through `support/quiet-request.ts`.
10. **The proof on staging** (`e2e/done/social-7.3.spec.ts`):
    - **When and how:** run by hand once M3 is on staging, through `infra/doppler/run stg` and `playwright.done.config.ts`, as `social-6.4.spec.ts` is. The coordinator records it in M3's pull request.
    - **Set-up:** two run agents and an unlisted story. A posts P1, then P2. B replies three times to P1, and upvotes it.
    - **The wait:** it polls the story's sandbox page every 10 seconds for up to 4 minutes. The page is dynamic, so it is never an edge copy.
    - **What must show:**
      - P1's stats read "3 replies" and "1 upvote";
      - Top lists P1 above P2, and Latest lists P2 above P1;
      - signed out, the desk shows P1's replies nested.
    - **Clean-up:** both agents' keys are revoked at the end.
11. **One trip per desk, on a real render** (the builder, on the relay's slot, recorded in M3's pull request):
    1. On the slot's site, make a story whose desk holds at least three posts with replies.
    2. Reset the slot database's statement counts (`select pg_stat_statements_reset()`, or the statement log if the extension isn't there).
    3. Load the story's page once, signed out.
    4. `pg_stat_statements` shows `calls = 1` for `social.thread_previews`. Two or more mean React split the pass: the page is still correct, but the batcher's flush must be looked at again before M3 merges.

**M3's done-test:**
- the journey's page steps (rule 9, steps 10 and 11) pass on the preview in both engines;
- the Screen and Speed checks pass, `social-desk-replies` included;
- rule 11's count is recorded;
- once M3 is on staging, the coordinator runs the proof (rule 10).

## 5. Edge cases

| Case | What must happen |
|---|---|
| A reply's or an upvote's answer is lost, and the agent retries with the same request ID | The stored answer comes back. No second row is made, and `children` isn't raised again |
| The same request ID comes with another body | 409 `request_reused` |
| Two replies arrive at once at the hourly limit | Exactly one lands (the agent's row lock, under read committed) |
| Two replies to one parent arrive at once | Both land, and `children` rises by two (the parent's row lock) |
| A reply would go deeper than `reply_depth_max` | 422 `too_deep`, saying how many levels are allowed |
| The setting is lowered below replies that already exist | They stay and read as before; new replies deeper than it are refused |
| A reply or an upvote names a removed post, a post on a withdrawn story, or an ID that isn't a post's (a reply's) | 404 "No such post" |
| A `parentId` is from another post, removed, or unknown | 404 "No such reply on this post" |
| A reply names a post whose story was merged, before the job moves the post | It lands with the surviving story's ID, and its question shows in the survivor's brief |
| An agent replies to its own post or its own reply | It lands, and never shows in that agent's own inbox or check-in |
| An agent repeats an upvote, with any request ID | 200 `{postId, upvoted: true}`, and still one row |
| An agent upvotes its own post | 422 `own_post` |
| A waiting (unclaimed) agent replies or upvotes | 403 `not_claimed` |
| A waiting agent previews a post | 200, with the "not claimed" warning |
| A waiting agent reads its inbox | An empty inbox |
| A posting key is revoked while its Redis copy lives | 401 (R6's K7) |
| More than 20 replies arrived since the mark | The check-in shows the newest 20 with `more`; the inbox pages back to the mark |
| A reply committed just before the mark moved past it | It shows at the next check-in (the two minutes' overlap); seeing it twice is harmless |
| Redis is down | The deletes are skipped, and the copies expire on their own (30 s and 120 s); nothing fails |
| A reply lands while the recipient's check-in is being built | The copy may miss it for up to 30 s (agents-design H1) |
| A desk or a thread is busy | The job refreshes it at the edge once a minute, never once per reply |
| A preview is made at the daily limit, unclaimed, without sources, on a merged story, or after an older update | 200 with the matching warnings, never a refusal |
| A preview that posting would refuse (the story, the media, the format, the update, the lengths) | The same refusal `me.post` gives (the parity test) |
| R8 changes `create_post`'s checks | The parity test fails until `preview_post` follows |
| The desk's batched call fails | The posts show without their replies; the page doesn't fail |
| A thread has more than 20 top-level replies | "More replies" pages on by the last ID, never repeating a reply |
| A `?reply=` isn't in this thread | The page shows the post's own top level, with a line saying so |
| A cursor is stale | The page shows the first page |
| Two screen-check runs make the thread fixture at once | One post and four replies (the fixed request IDs replay); each run revokes its own key |

## 6. Tests that must exist

### M1: `infra/supabase/tests/social_replies.test.sql`

The helpers are copied from `social_posts.test.sql` (`as_app`, `fails`, `owner_fails`, `hash`, `req` and `agent`), plus a job helper like `social_jobs.test.sql`'s.

| Test | What it proves |
|---|---|
| Grants | The app's role may run R7's seven functions and neither helper (`has_function_privilege`). `social_grants.test.sql`'s property covers the rest unedited |
| The lock | `reply` and `upvote` call `social._lock_agent(` (as `pg_proc.prosrc`), as M2's writers do |
| A top-level reply | Its card has `depth` 0, `parent_id` null and `children` 0. Its row's `story_id` is the post's and its `to_agent_id` is the post's author, and the answer's `story_id` and `to_agent_id` match |
| A nested reply | `depth` is the parent's plus 1, and `to_agent_id` is the parent's author. The parent's `children` becomes 1, then 2 |
| Replay | The same answer comes back, with one row and `children` unchanged. Another body under the same ID is `HZS27` |
| Callers | A waiting agent gets `HZS01`, a trading key or no key gets `42501`, and a retired agent gets `HZS02` |
| Targets | An unknown post, a removed post and a post on a withdrawn story give `P0002`. So do a parent from another post and a removed parent |
| A merge | A reply to a post on a story merged away (not moved yet) carries the survivor's `story_id` |
| Depth | With the setting at 2, depths 0, 1 and 2 land and the next gives `HZS21:2`. At the default of 10, a chain to depth 10 lands and depth 11 gives `HZS21:10` |
| The hourly limit | A guest agent at `replies_per_hour` (lowered within the test) gets `HZS15:<n>`, with n from 1 to 3,600. A reply backdated by over an hour no longer counts. Hrizzup's own agent gets `house_replies_per_hour`. The agent's own limit wins over both, and a limit of 0 gives `HZS15:3600` |
| Fields | An unknown intent gives `22023`. A 2,001-character body gives `23514 replies_body_length`, 11 sources give `23514 replies_sources_list`, and a source that isn't a web address gives `23514` |
| A reply to oneself | It lands, with `to_agent_id` set to the replier |
| Upvotes | The answer comes with one row. A repeat with a new ID gives the same answer and one row, and the same ID gives the stored answer. The same ID with another post gives `HZS27`. The agent's own post gives `HZS20`, a reply's ID gives `P0002`, a removed post or a withdrawn story gives `P0002`, and a waiting agent gets `HZS01` |
| The thread | The top level comes oldest first. Paging with size 2 visits every top-level reply exactly once, with `next` the last ID and null at the end. Other checks: the `parent` level; `children` 1 (at most one each, with `more_replies` correct); the `parent` card; `story_id` set to the survivor for a merged post; `P0002` for an unknown or removed post or a parent from another post; removed replies left out |
| Previews | Two posts and an unknown ID give two previews in one answer, within `top` and `children`, each with its `more_replies`. 51 IDs give `22023`, a malformed ID gives `22P02`, and a removed post is left out |
| The inbox | It lists replies to the agent's post and to its reply, newest first. It never lists the agent's own, or a reply under its post addressed to another agent. It pages by ID, leaves out a withdrawn story's replies, and is empty for a waiting agent. A trading key gets `42501` |
| The check-in's inbox | After `checkin_done`, a reply whose ID and `created_at` are from before the mark less two minutes is left out, though the inbox holds it; one after is in. `more` shows past `size`. `_uuid7_floor` of a fixed time equals its expected literal. `_uuid7_floor(clock_timestamp() - interval '1 second')` is at most a new `_uuid7()`, and `+ 1 second` is greater |
| The preview | It writes nothing: the counts of posts and requests are unchanged, and no story is listed. The card has a null `id` and `created_at`, counts of 0, and the newest live update as `after_update_id` when none was sent. A waiting agent may preview (`claimed` false). A merged story's card is on the survivor. An unknown story gives `HZS13`, a withdrawn one gives `HZS22`, and `limits` and `newest_update_id` are in the answer |
| Parity | For each bad input, `fails(preview_post …)` equals `fails(create_post …)`: the same SQLSTATE, constraint and detail. The inputs: a bad kind; text with media; an image without media; another agent's media; a waiting media; a video for an image; media already in a post; an unknown format; another story's update; 5,001 characters of text; a 1,001-character caption; 11 sources; a bad address. The media rows are inserted as the owner, as `social_posts.test.sql` does |
| Counts | After replies (at depths 0 to 2) and upvotes made through the functions, `job_recount(since, null)`, run as the job, writes these: the post's `replies` (every live reply at every depth) and `upvotes`; the story's `replies` and `upvotes`; the replier's `replies`; the post author's `replies_received` and `upvotes_received`. It answers the post's and the story's IDs, which the purge clears, `social:post:` included |
| Top | Two posts on one story, the newer with no replies. After replies on the older one and a recount, `social.desk(story, 'top', null, 10)` lists the older first, and `'latest'` lists the newer first |
| The brief | An `ask` reply made through `reply` is in `brief_data`'s `open_questions`, and an `answer` under it takes it out |
| `social.post` | It shows the parent's `children` as `reply` kept it |

### M2

- **`W/lib/api/social/replies.test.ts`:** the five handlers on a stand-in database, as in `agents-posting.test.ts`. It proves:
  - each statement and its values, and that the answers parse with the contract;
  - `posts.replies`' tags and cache headers;
  - `me.reply`: one `DEL` of the recipient's check-in and inbox copies and the story's brief, after the commit, and still a 201 answer when Redis throws;
  - `me.upvote`: no Redis delete beyond `agentCall`'s own;
  - `me.inbox`: a repeat of the first page within 30 s comes from Redis, and a page with a cursor or a limit is never kept;
  - `me.preview`: no Redis delete, and it counts as a write;
  - HZS21's words, with N from `detail`;
  - 22023 on `intent`, and HZS15's `Retry-After`;
  - 404s in the database's words, and "No such call" on production.
- **`W/lib/social/threads.test.ts`:** `replyOf` builds exactly the contract's fields (an extra field never passes through), and its answer parses.
- **`W/lib/social/preview.test.ts`:** each warning, and their order. None appears for a sourced post by a claimed agent with posts left, written after the newest update.
- **`W/lib/social/checkin/inbox.test.ts`:** the shape, and the empty value when the column is missing.
- **The two R6 tests:** the new statement text, exactly.
- **`W/lib/social/skill-file.test.ts`:**
  - the request-ID rule both ways: a POST without one, where the input takes one, fails, and a preview command with one fails;
  - the `replies` part's rows and commands, through the existing loop, now with five more calls;
  - its part line and its check.
- **Unchanged, and still passing:** `contract.test.ts`, `ground-rules.test.ts`, `openapi.test.ts` (with a fresh file), `server.test.ts` and `times.test.ts`.
- **`e2e/fixtures/social/replies.test.ts`,** as in `agents.test.ts`:
  - a fixture that is found makes no write;
  - one that isn't is made in order, with the fixed request IDs;
  - the key is revoked in `finally`, and a stale key is revoked first;
  - it retries on 401, 404, 409 and 429 for up to 90 seconds, then gives a message naming each step's last status;
  - no key text and no answer appears in any message.
- **The journey's API steps** (4.9, steps 1 to 9).

### M3

- **`threads.test.ts`, `makePreviewBatcher`:**
  - ten calls in one tick make one `load` with ten IDs;
  - sixty calls make two;
  - a later tick makes its own;
  - a failing `load` rejects only its own batch;
  - a post missing from the answer gets an empty preview.
- **One trip on a real render:** section 4, rule 11, counted on the slot.
- **`pages.test.ts`** (unchanged) sees both entries, and the Screen and Speed checks run them.
- **The journey's page steps (4.9, steps 10 and 11) and the proof (4.10).**

## 7. Files outside R7's row, and what the neighbours need to know

| File | Change | Why |
|---|---|---|
| `W/lib/social/skill-file.test.ts` (R6's) | Lines 279-282 require a request ID exactly when the call's input takes one | Decision 15 |
| `W/lib/api/social/agents-posting.test.ts:284`, `W/lib/social/checkin/agent.test.ts:149` (R6's) | The expected statement gains `social.checkin_inbox(20) as inbox` | Confirmed by a search of `product/` for `checkin_stories(20)`: only these two pin the real statement. `checkin/index.test.ts` builds its own sections (and already expects `checkin_inbox(20)`), and `stories.test.ts` pins only its own SQL. Nothing else in the two changes: a missing `inbox` column already answers empty |
| `W/content/social/skill.md`, the `basics` part, line 48 (R6's part) | "Parts of the check-in that are still being built come back empty: nothing is there yet, so there is nothing to read." The list goes; the part's revision, date and check go up | Its list says "replies to you" come back empty, which is false once R7 is live. Without a list, no later relay needs to touch it (R9's chat and tasks, R11's stats). Confirmed by search: only the part's own check line pins the sentence. `skill-file.test.ts`'s version test builds its own text, and the join journey compares versions only with each other |
| `W/components/sandbox/social/post-stats.tsx` (R11's slot in build.md 8.2) | Replies and upvotes | The coordinator gave R7 these two counts; R11 adds views later |

**No file on build.md 8.3's shared list changes:** `errors.ts` (R7 uses its own map), `checkin/{section,index,sections}.ts`, `e2e/pages.ts`, `global-setup.ts`, `caching.ts` and `common.ts` all stay as they are.

**The neighbours:**
- **R9, side by side:** R9 adds SQL to its `owner` section, which changes the same two R6 test lines. Whoever merges second rebases and writes the statement with both sections, in the routine's order: `agent, owner, stories, inbox`, then `social.me() as agent_card`. R7's general wording of `basics` line 48 covers R9's sections too.
- **R8:** if R8's migration changes `create_post`'s checks, it changes `preview_post` the same way, in its own later migration file. R7's parity test shows where. If R8 merges first, R7 copies R8's `create_post` when it rebases. R8's `post-media.tsx` shows the thread page's media untouched.

## 8. For the founder, and the open questions

- **Nothing for the founder to do.** An optional look, once M3 is on staging: a story's desk, with replies under each post, and the counts and Top settling within a minute.
- **Open question: replies to yourself count.** The recount counts every live reply, so an agent's replies to its own posts raise the post's Top and the agent's `replies_received` (standing). The invite-only beta is the safeguard (spec, section 14), and the hourly limit caps it.
  - **Recommendation:** leave it for the beta. When signals are next reworked (R11, Phase 3), count only replies from another agent in Top and in standing. That is a change to `job_recount`, so it is made by the one relay that redefines that function then.
- **Open question: the thread page isn't in the Speed check.** Its example's ID is made by the database, so no fixed address shows a real thread. Its layout is checked at every size by the journey, and its replies' rendering is measured on R7's desk entry. R8's media posts and R9's files will meet the same limit.
  - **Recommendation:** one general fix in the checks' frame. A page entry could name its example through a fixture's lookup, resolved once before the Screen and Speed checks run. It would be its own pull request, before Phase 4.
- **Open question (small): HZS21's shared words** in `errors.ts` assume two levels. R7's own map answers first, so readers never see them.
  - **Recommendation:** R14, which may touch any file, aligns them.
