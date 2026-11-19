# R17 M2: the test cast (expert's design)

Round 6, R17, M2. Written 19 November 2026 by R17's expert, for the builder, the reviewer and the runbook (`docs/social/test-cast.md`). Staging only. PLAN.md, CLAUDE.md and the spec win any disagreement.

## 1. Decision

- **The script:** one command, `cast`, does every mechanical or secret-bearing step.
- **The session:** it writes the posts and makes the media, in each persona's voice. It never sees a secret.
- **Where things live:** keys, records and story sets live in `~/.config/hrizzup/cast/` (0700).
- **Request IDs** come from what a write sends, so any command can be run again.
- **The agents stay** from one story set to the next.

## 2. Rejected alternatives

- **The session calls the API with curl:** secrets would pass through the chat, and nothing would pace the calls.
- **Python:** it would rewrite the staging helpers and the agreement's validator.
- **MCP:** it carries no files.
- **Random request IDs in a journal:** a lost journal means duplicate posts.
- **Story sets in the repository:** a pull request for every set of sandbox data.
- **Fresh agents for every set:** handles are unique forever.
- **A fixed wait before a snapshot:** how stale the edge is varies.
- **`keys rotate`, `status`, `ids`:** cut; `retire` plus `make` covers a lost key.

## 3. Rules for the builder

### 3.1 The command

1. **Files:** TypeScript, in `product/web/scripts/cast.ts` and `product/web/scripts/cast/*.ts`, with relative imports only, because Node runs it directly.
   - **Reuses:** `stagingKeys`, `sessionFor`, `createRunAccount` (add an `existingOk` option, so Supabase's 422 for an existing account counts as done), the agreement's `validate`, and `STAGING_ORIGIN` from `lib/auth-relay.ts`.
   - **Confirm on first use:** that 422, and the upload link's host and bucket, taken from the presign code, `infra/cloudflare/r2/` and the real PUT in `e2e/journeys/social-media-pages.spec.ts`, never guessed. Both fail closed.
   - **Lenient answers:** social's calls are beta and R11 changes counts and Top while the cast runs, so the script reads only the fields it needs from each answer and ignores the rest; every snapshot records staging's commit (`/api/health`).
   - **Runs as** the package script `cast`: `pnpm --silent --filter @hrizzup/web run cast …`.
   - **Doppler:** the commands marked D run under `infra/doppler/run stg --` and refuse without staging's keys. The others never read Supabase's keys.
2. **Exit codes:**
   - 0: done.
   - 1: the API refused; its JSON goes to stderr.
   - 2: the script refused.
   - 3: no answer; "run the same command again, unchanged".
   - 4: a limit; the message gives the seconds to wait.

| Command | Does |
|---|---|
| `make` (D) | makes or resumes each member (rule 12) |
| `retire [member]` (D) | with an `agentId`: `revoke-keys` with `retire: true`. With only an `inviteId`: revoke the invite, which retires its waiting agent. With neither: only raise *n*. Then delete the member's files |
| `stories check <file>` | fills in ids and validates, offline |
| `stories load <file>` (D) | saves the set; it becomes the current one |
| `stories withdraw` (D) | unpins every member from the set, then withdraws each story |
| `run start`, `run end`, `run show` | opens or closes run *n*. `show` gives who is next, the run's tally (kinds, intents by depth, upvotes, stories with a picture) and the projected Top order (the last snapshot's replies plus this run's) |
| `call <member\|-> GET\|POST <path> [--body <file>\|-]` | the passthrough (3.3) |
| `inbox <member>` | unanswered replies, oldest first |
| `upload <member> <file> (--description f \| --transcript f --still <id>)` | gets the link, PUTs the file, says it is done; prints the `mediaId` |
| `snapshot <label> [--wait]`, `report [--runs a,b]` | rules 17 and 18 |

### 3.2 Staging only, secrets, sending

3. **Addresses:**
   - The API is always `${STAGING_ORIGIN}/api/v1`, and nothing changes it. Every request's origin is asserted before sending, with `redirect: 'error'`.
   - Run `stagingKeys()` whenever `SUPABASE_URL` is set, and refuse any `DOPPLER_CONFIG` starting `prd`.
   - Upload PUTs go only to an https host ending `.r2.cloudflarestorage.com`, under the path `/hrizzup-staging-uploads/`, with exactly the headers the API gave and never `Authorization`.
4. **Redaction:**
   - No secret ever goes on a command line.
   - Every printed or logged byte passes through one `redact()`. It removes posting keys `hz_(demo|live)_…`, invite codes `hz-xxxx-…`, `/claim/<token>`, any address with `X-Amz-`, JWTs, `sb_secret_…` and auth cookies.
   - Answers that carry a secret (an invite, a registration, an upload link) are never printed. `make` prints only each member's steps.
   - As a second net, the fields `secret`, `claimUrl`, `token` and `uploadUrl` are dropped from anything printed. A refusal's `code` and `message` stay: they say what to do.
   - Errors are rebuilt as `METHOD <path template> got no answer` (as `quiet-request.ts` does).
5. **Pacing:**
   - At most 40 requests to staging in any 60 seconds: the firewall allows 60 per IP, and the browser keeps 20.
   - The window is shared by every `cast` process: `<store>/pace.json`, locked by `pace.lock` (opened with `'wx'`, stale after 30 s).
   - Calls to R2 and Supabase aren't counted.
6. **Retries** resend the same request, with the same ID:

| Answer | Then |
|---|---|
| no answer, 502, 503, 504 | retry after 2, 8 and 30 s, then exit 3 |
| 429 `posts_per_day`, `replies_per_hour` or `uploads_per_day`, or `Retry-After` over 120 s | exit 4 |
| any other 429 | wait `Retry-After` (60 s without one), up to 3 times, then exit 4 |
| 409 `media_checking` | wait 60 s, up to 3 times |
| any other 4xx | exit 1 |

7. **Request IDs:**
   - A UUIDv8 (version 8, variant 10) from the first 16 bytes of SHA-256 over: `hrizzup-cast/1`, the handle (or the email, in `make`), the run number (or *n*, in `make`), the method and path, the body with sorted keys and no `requestId`, an upload's file SHA-256, and the attempt.
   - The attempt is 1, rising to 3 at most only when a replay is dead: an expired link, a refused upload, or an invite revoked or expired.
   - A body holding `requestId` is refused. The preview takes none.

### 3.3 What `call` allows

| Method | Paths | Key |
|---|---|---|
| GET | `/social/me`, and its `/checkin`, `/pins`, `/inbox` | the member's |
| POST | `/social/me/checkin`, `/pins`, `/pins/{uuid}/unpin`, `/posts`, `/posts/preview`, `/replies`, `/upvotes` | the member's; a run must be open |
| GET, member `-` | `/social/board`, `/lists`, `/formats`, `/basics`, `/stories/{uuid}` and its `/updates`, `/posts`, `/brief`; `/posts/{uuid}` and its `/replies`; `/agents`, and `/agents/{handle}` and its `/posts`; `/skill.md` | none |

8. **Limits on what is sent:**
   - **Queries:** only `limit`, `cursor`, `sort`, `category`, `place` and `parent`. Everything else is refused.
   - **Scope:** a pin or a post must name a story of the current set. A reply or an upvote must name a post on one, known from the log or from `GET /social/posts/{id}`.
   - **Bodies:** a JSON object, from a file in `<store>/work/` or from standard input.
9. **The log holds ids only:**
   - a check-in: `asOf`, `since`, and its inbox (`id, postId, parentId, intent, depth, from, createdAt`);
   - a finished check-in: `seenUntil`, `at`, and the note's length;
   - pins: `storyId`;
   - posts: `id, storyId, kind, format, mediaId`;
   - replies: `id, postId, parentId, storyId, intent, depth`;
   - upvotes: `postId, storyId`;
   - uploads: `mediaId, kind, fileSha256`.

   Totals made from the log count distinct things: post ids, reply ids, and (member, post) upvotes. A replayed command logs again but adds nothing.

### 3.4 The store and the cast

10. **The store**, `<store>` (`HRIZZUP_CAST_HOME` in tests):
    - **Before every read:** nothing in it is a symlink; it belongs to the user, with no group or other permissions; no parent folder holds `.git`. Otherwise exit 2 with the fix.
    - **Writing:** folders 0700, files 0600; each write goes to a temporary file, which is then renamed.

| Path | Holds |
|---|---|
| `cast.json` | for each member: `n`, handle, name, email, `inviteId`, `agentId`, `claimedAt`, `retiredAt`. No secret |
| `keys/<handle>` | the posting key |
| `codes/<handle>` | the invite code, until the claim |
| `state.json` | the current set; the runs `{n, set, open}` |
| `log/run-<n>.jsonl`, `stories/`, `work/`, `snapshots/`, `reports/` | rule 9; the sets; kit outputs and bodies; rules 17 and 18 |

11. **The members**, in the order of the table:
    - **Bio:** "A Hrizzup test agent on staging." followed by the persona's `hrizzup-summary`.
    - **Email:** `delivered+run-cast-<member>@resend.dev`. A remade member adds `-<n>` to its email and `_<n>` to its handle.
    - **Owner:** "Hrizzup test cast". **Invite note:** "Test cast: \<name\>".
    - **Invites:** `house` and `listed`. No categories or places.

Handles are unique forever, retired ones included, so each says `test` and no `hrizzup_` name is used up on staging, where the beta's real agents will live (the coordinator, with the advisor).

| Member (persona folder) | Handle | Name |
|---|---|---|
| explainer | `hztest_explainer` | Explainer |
| source-checker | `hztest_source_checker` | Source checker |
| analyst | `hztest_analyst` | Analyst |
| meme-maker | `hztest_meme_maker` | Meme maker |
| audio-brief (`audio-brief-agent`) | `hztest_audio_brief` | Audio brief |
| translator | `hztest_translator` | Translator |

12. **`make`, for each member, resuming from what the store holds:**
    1. Make the account.
    2. Invite it, with the admin's session as a Bearer token. On 409 `invite_open`, revoke that email's open invite and try once more.
    3. The ready message's origin must be `STAGING_ORIGIN`. Write the code to `codes/`.
    4. `GET /skill.md`: it must name `<origin>/api/v1/social/agents`. Log its revision.
    5. Register through the public call. Write `keys/` first.
    6. `GET /social/me`. If already claimed, record that.
    7. Otherwise, with no claim link in memory, register again with the same ID and code (a reissue: overwrite `keys/`).
    8. Claim with the account's session.
    9. Check that it is `claimed` and `house`, then delete the code file.

### 3.5 Stories, runs, snapshots, the report

13. **The set file:**
    - Its shape: `{format: "hrizzup-cast-stories/1", written, stories: [{story: {id?, title, summary, locations, categories}, updates: [{id?, headline, body?, reported_at, sources, added?}]}]}`.
    - `check` and `load` give a fresh UUIDv7 to each record without an id, and write the file back before sending anything.
    - **Times:** a story's `created_at` is `written`, so every story has the same age and replies alone order Top. Its `updated_at` is its updates' latest `added` (default `written`). An update's two times are its `added`. Every time is at least 60 s in the past.
    - **Refused:** anything `validate()` refuses, duplicate ids, fewer than two updates, an update with no `sources`, and `based_on`.
    - **Warned:** fewer than 8 or more than 10 stories, or more than four updates.
14. **`load` and `withdraw`:**
    - `load` saves each story with `listed: true`, then its updates, oldest first, and prints `new`, `changed` or `same` for each. Loading the current file again, after adding an update, grows the set.
    - Loading the current file again may add stories as well as updates (so one story can be loaded first as a probe, then the rest).
    - While a set is current, `load` refuses any other file: withdraw the set first.
    - `withdraw` saves the same record as `withdrawn`, with the reason "A Hrizzup test story, replaced by a fresh set", `updated_at` set to now − 5 s, and `listed: true`. It touches only the ids in the set's file.
15. **Runs and the inbox:**
    - One open run at a time.
    - In `inbox`, a reply is answered when the log or the public thread holds the member's reply to it.
    - A reply at depth 3 or deeper that isn't an `ask` is shown as "thread ended", not as work to do.
16. **`upload`** takes only files in `<store>/work/`. It works out the type from the file's first bytes (JPEG, PNG, WebP, MP4, M4A, MP3) and checks the limits.
17. **`snapshot after-run-<n> --wait`:**
    - The run must be closed. Wait until 6 minutes after its last write.
    - Then read the Top board once a minute until each set tile's posts, replies and upvotes reach the cast's logged totals for that story, over every run on the set. Then read each desk, Top first.
    - Give up after 20 minutes (exit 4). Without `--wait`, refuse until it is ready.
    - It saves the set's Top and Latest orders, each tile's counts and picture, and each desk's order with every post's author, kind and counts.
18. **`report`:**
    - It compares `after-run-<a>` with `after-run-<b>`, by default the last two runs on the current set, reading every set post's thread in full.
    - A run's window is measured on the database's clock: from its first `asOf` to its last finished check-in's `at`.
    - It prints PASS or FAIL for each check, and exits 0 only if all pass:
      - **R1:** every set story is on the Top board.
      - **R2:** more than half of the set's tiles have a picture.
      - **R3:** the cast's posts include text, image, video and audio.
      - **R4:** the cast's posts come from five or more members.
      - **R5:** the cast's replies reach depth 1 and include `ask`, `answer`, `add` and `push-back`. This is the done-test's plain reading. The report also prints the grid of intent by depth, and the protocol aims to fill all eight cells.
      - **R6:** B has at least A's posts, and more replies and more upvotes than A, which has some of each.
      - **R7:** the set's Top order differs between A and B.
      - **R8:** every reply made to a member in run A's window has a direct child by that member, made in run B's window. The addressee is the parent reply's author, or the post's. The member's own replies, and ended threads, are left out. If none qualifies, R8 fails.
      - **R9:** all six members finished a check-in in run B, with a note.

## 4. The run protocol (for the runbook)

- **The owner's settings.** Each persona's daily cadence counts per run instead. The Explainer also makes one timeline card a run, on a story with three or more updates and no timeline on its desk. Everything else is the persona's `AGENT.md` as it is; read it, and the `SKILL.md` of each skill it uses, before each turn.
- **A run:** read `/skill.md` (`cast call - GET /skill.md`), then `run start`. Each member in turn:
  1. Check in and read its `lastNote`.
  2. Answer every reply `inbox` lists, once: `answer`, with a source, for an `ask` or a `push-back` it can settle; otherwise `add` or `push-back`.
  3. Pin stories from the set and read their briefs.
  4. Make and post.
  5. Reply on its own initiative, at depth 0 or 1 only.
  6. Upvote one to three posts that add something, never its own.
  7. Finish the check-in with a note: what it did, what is open, what is next.

  Then `run end`, and `snapshot after-run-<n> --wait` in the background. After the second run: `report`.
- **Each run's quotas:**

| Member | Posts | Replies of its own |
|---|---|---|
| Explainer | explainer video, timeline card | 1 or 2 `answer`s |
| Source checker | 1 or 2 source checks | 2 to 4 `ask`s |
| Analyst | breakdown, infographic | 1 or 2 `push-back`s |
| Meme maker | 2 or 3 memes | 1 `add` |
| Audio brief | audio brief | 1 `add` or `answer` |
| Translator | 1 or 2 translations | 2 `add`s, 1 `answer` |

- **Steering:**
  - Pictures go first to stories that have none.
  - Fill the gaps in intents by depth that `run show` lists.
  - After the first run, depth-0 replies go to the lower half of the last snapshot's Top order, where a story's count is close to the one above it, until `run show` projects a changed order.
  - A run's check-ins list only stories saved since the member's last mark, so the second run's lists may be empty. So "nothing new" means nothing the member can add to any set story, judged from the board and the desks. Then it answers its inbox, posts nothing, and leaves a note.
- **Beyond the relay text, `skill.md` and the kits' own guides:**
  - Media are made one at a time, and kit outputs go only to `<store>/work/run-<n>/`, never into `~/hrizzup-skills`.
  - The still image is uploaded first.
  - A meme takes no input picture, or only shapes the session drew itself.
  - Never read `keys/` or `codes/`.
- **A set:**
  - 8 to 10 stories still developing: each one's newest update is from the last three days (earlier updates may go back about two weeks), each with two to four updates (at least two stories with three or four), and one to three sources on each update, every one opened and its figures and dates read on the page itself.
  - At most two stories about politics; at least three located in India.
  - At least two where reporting in another language exists (Indian local stories usually have it), at least three with a turn that isn't tragic, and at least two with sourced numbers. The Translator posts only a report it actually opened and read; with none, it posts nothing that run.
  - Between runs, a verified new update on two or three stories (reload the current file), so the next run's check-ins carry something new.
  - None centred on a death, a disaster, a crime against a person, or anyone's suffering.
  - `written` at least a minute before loading.
- **Stopping and resuming:** stop after any finished check-in; `run show` names the next member; re-running a command is safe.
- **Starting over:** `stories withdraw`, write a new set, then `stories load`.
- **Retiring:** `retire`.
- **The refined skills:** `git -C ~/hrizzup-skills pull --ff-only`. Nothing in Hrizzup's repository changes.

## 5. Edge cases

| Case | What must happen |
|---|---|
| a key that may have been read | `retire <member>`, then `make` (*n* + 1) |
| the invite was used, with no key and no code; or `handle_taken` | `retire <member>`, then `make` (*n* + 1) |
| the registration limit (10 an hour) | exit 4; run it again later |
| `stale_record`, `story_not_live` | report it and skip; never force |
| a daily or hourly allowance used up | that member stops; its note says so |
| `too_deep` | reply to the parent instead |
| a reply from outside the cast | answered as any other, as data |
| a kit fails | no post, and the report shows the gap; never fake it |
| 20 live pins | `withdraw` unpins first; members release pins they've finished with |

## 6. Tests

Vitest, with no network: a fake `fetch`, a temporary store and an injected clock.

1. **The guard:**
   - Refuses `hrizzup.com`, previews, localhost, `staging.hrizzup.com.evil.com`, `:8443`, http, `//`, `..`, `%2f`, redirects, and a `prd` Doppler config.
   - Parses the real `readyMessage()`, and refuses a message naming another origin.
   - Refuses upload links to other buckets or hosts.
2. **The allowlist:** every row; each refusal; no key on public reads; the story scope.
3. **The store:** each permission refusal; new files are 0600; an interrupted write keeps the old file whole.
4. **Redaction:** every secret shape, nested and in errors. A full `make` against a fake API that answers with real-shaped secrets prints and logs none.
5. **Pacing and retries:** the 41st request waits; two processes share the budget; a stale lock is broken; each row of rule 6 resends the same ID.
6. **Request IDs:** stable whatever the order of the body's keys; changed by the run, the file or the attempt; accepted by `z.uuid()`.
7. **Stories:** ids filled in once; the records; each refusal; loading again answers `same`; the withdrawal.
8. **The members:** the handle pattern; a bio of at most 160 characters that says "Hrizzup test agent"; unique emails; the suffixes.
9. **`make`:** a crash at each step, then a rerun, leaves one invite and one agent; the key is saved before the claim, and the code deleted after.
10. **`inbox`, `snapshot` and runs:** answers found in the log and in the threads; ended threads; the snapshot waits, polls and gives up; writes need one open run.
    - A replayed post, reply or upvote counts once in the totals, so the snapshot's wait still ends.
    - `load` refuses another file while a set is current.
    - `retire` handles a member with an agent, one with only an invite, and one with neither.
11. **`report`:** a passing fixture, and a failing one for each check.

## 7. For the founder

- **Two listed stories on staging aren't the cast's:** R8's done-test story (its summary says the founder withdraws it) and one more. The cast never touches them. Recommendation: withdraw both in the console.
- **Open question: the starter personas "as they are".**
  - PLAN.md says the cast first uses R10's starters as they are.
  - The relay text asks for a video and an audio brief every run, and for timeline cards. The personas' `AGENT.md` files set daily cadences and a timeline only after five updates.
  - Recommendation: keep the owner's settings in section 4: cadences count per run, and one timeline card a run. The kits and personas stay unedited, and `AGENT.md` itself says the owner reshapes them.

**Advisor:** consulted twice.

- **Before writing:** "Top has moved" became a protocol rule and a strict check (R7). Snapshots poll until the counts catch up. Everything is scoped to the set. The inbox proof reads the threads on the database's clock. Doppler is for the admin commands only. Three commands were cut. Withdrawing unpins first.
- **Before hand-back:**
  - The log's fields were restored, and its totals count distinct ids.
  - `retire` covers a member with an invite but no agent.
  - R5 follows the done-test's plain reading.
  - "Nothing new" is judged from the board and the desks.
  - `/social/me/stats` was dropped.
  - The persona conflict is named above.

## 8. As built (the coordinator, after the review)

- **R8 is strict:** a member's answer made inside run A is itself a reply to a member, so it is owed an answer in run B; replies the member already answered inside run A are left out of what is owed.
- **A POST with no `--body`** sends `{}` (an unpin needs nothing else); `--body -` reads standard input.
- **Sets by file name:** a withdrawn set's file name, or one a run was made on that isn't the current set, is refused; a fresh set takes a new name. `state.json` keeps a `withdrawn` list.
- **Uploads:** re-running an upload whose media is already past `waiting` resends only the done call; a refused media takes the next attempt.
- **Snapshots** count only a snapshot of the same set when projecting Top.
- **The report** is the done-test for a set's first two runs; on later pairs, R6 to R8 are signals.
