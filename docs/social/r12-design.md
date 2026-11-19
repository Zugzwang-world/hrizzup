# Social R12: the reader agent, its reading profile and For You (design)

> Round 6, R12 ("Readers"), 19 November 2026, by R12's expert, for M1, M2 and M3. [build.md](build.md) (D5, D8, 3.3, 4, 5, 6, 7.7, 8 and 9), [spec.md](spec.md) (sections 9 and 11), PLAN.md and CLAUDE.md win over this note: it settles only what they leave open. `A/` is `product/packages/api/src/social/`, `W/` is `product/web/`, "the SQL" is `infra/supabase/migrations/20261117194100_social.sql` and "R8's SQL" is `20261118174000_social_media.sql`. **M1's rules are final once M1 merges, since a migration is never replaced.** M2's and M3's are complete enough to build, and may be refined after M1 merges.

## 0. Settled before this note (recorded, not reopened)

- **The keys** are `WORKERS_AI_TOKEN` and `WORKERS_AI_ACCOUNT_ID` (#204, merged). `CLOUDFLARE_ACCOUNT_ID` isn't used: `hrizzup-tools` holds that name, and the key guard refuses a shared name. `dev` holds the token empty.
- **One rule for the stand-in:** with no token or no account ID, the provider is the local stub, wherever that is. The stub uses no neurons.
- **Staging's Doppler doesn't hold the token yet;** adding it is the founder's job. Until then everything works, and is tested, with the stub.
- **Nothing paid.** Workers AI is never called from this Mac. Previews use staging's token and staging's database, so a check run's calls count: the journey sends at most one chat message.
- **File ownership:** R12 edits only its own files (build.md 8.2's R12 row). A change to a shared file is additive, in its own pull request (8.3). R5's `W/app/sandbox/social/page.tsx` isn't R12's. **This design needs no shared-file change.**
- **Codes:** R12 takes the block **HZS40 to HZS49**, so R11, running side by side, can use HZS30 to HZS39. M1 raises none of them (decision 4), so the block stays free for later.

---

## 1. Decisions

**1. One migration that only adds: one column, ten helpers, seven calls, and no new table.**
- **The new column:** `social.ai_days.exhausted_at timestamptz null`.
- **Nothing replaced or changed:** no `create or replace`, and no other table, column, index, trigger or setting.
- **No new index:** every read uses an index M2 made: `reader_messages_by_user`, the `readers`, `reader_days` and `ai_days` primary keys, `requests_pkey`, `stories_board_top` and `posts_desk_latest`.
- *Rejected:* a ledger table for AI calls (`reader_calls`). Between the two transactions, the request's own row in `social.requests` already holds the reservation (decision 4). An answered call's facts go into that row's final result, and its neurons into the reply's `reader_messages.neurons`. A second record of the same call would be a second truth to keep equal.
- *Rejected:* recording Cloudflare's "allowance spent" (3036) by raising `neurons_used` to the cap. The done-test reads that count, so it must only ever be what was used.

**2. Rows are made by writes; reads never write.** Nothing creates a `social.readers` row yet.
- `reader_save_profile` and `reader_chat_begin` insert it (`on conflict do nothing`).
- `reader_state`, `reader_chat` and `foryou_candidates` are `stable` and write nothing. A signed-in reader with no row reads the defaults: an empty profile, nothing held, the day's full allowance.
- *Rejected:* creating the row on `reader.get`. A GET that writes can't be cached or retried freely, and every signed-in board view calls it (decision 16).

**3. The reading profile has one stored form, checked by SQL; `holds_something` is derived by SQL.**
- **The canonical form:** both writers store exactly what `writeProfile()` (`@hrizzup/social/src/reading-profile.ts`) makes:
  - the title `# Reading profile`;
  - the three headings, always in the order `## More of`, `## Less of`, `## Formats`;
  - each item as `- item`;
  - one blank line between the parts, and no final new line.
- **What the reader types:** the parser is lenient (section 3.4). It accepts any heading case, `*`, `+` and numbered bullets, blank lines and a missing heading. It rewrites them into the canonical form, and refuses only what it can't read, naming the line.
- **What SQL checks:** `social._reader_profile_ok(body)` holds the canonical shape (section 2.3). `holds_something` is `body ~ '\n- '`: a canonical bullet always starts a line with `- `, and nothing else does.
- **Body length:** the existing CHECKs (`readers_profile_length`, `reader_profile_versions_body`: 2,000 at most, code checks) already guard it, and the function checks the length first, so a long body is a 22023, not a 23514.
- *Rejected:* trusting a `holds_something` boolean from the app. A buggy caller could store a pair that disagrees, and opening on For You reads it.
- *Rejected:* storing the hand-typed text as it came. SQL couldn't check its shape, so the For You builder would have to cope with text that doesn't parse. Every version is kept either way.

**4. Reserve and settle are two transactions around the AI call, and the request's own row holds the reservation between them.**
- `reader_chat_begin` reserves. It stores a pending marker under the request ID with `_remember`, whose upsert replaces the result: `{"pending": {day, reserved, in, out, message_id, started_at, lease_until}}`.
- `reader_chat_settle` and `reader_chat_fail` read the marker back, through the same `_replay`, so a changed body is still HZS27.
- `settle` replaces the marker with the final result, and `fail` deletes it, so the request ID is free to try again.
- **Refusals that count are answered as data, never raised.** The allowance's refusal must commit `refused + 1`, and an exception would roll it back. So `begin` answers every outcome as `{state: …}`: `reserved`, `done`, `refused` or `in_progress`. The handler turns them into the 429 and 409. Raised errors are only the caller's mistakes and the shared ones: 42501, 22023, HZS27, P0002.
- *Rejected:* one transaction held across the AI call. It would hold the reader's lock, today's `ai_days` row and a pooled connection for seconds.
- *Rejected:* the reservation in Redis. Redis is never the only copy, and the allowance must survive Redis dropping a key.

**5. The neuron books are exact decimals, and every amount is a product: `× 0.000001`, never `÷ 10⁶`.**
- **The reservation** is `R = (2000 × in + 300 × out) × 0.000001`. `in` and `out` are the settings' `reader_ai_in_neurons_per_m` and `reader_ai_out_neurons_per_m`, captured in the marker. With the default settings, R = **18.3925**.
- **Settling with usage:** `neurons = (prompt_tokens × in + completion_tokens × out) × 0.000001`. With 600 and 85 tokens that is **5.365375**.
- **Settling without usage:** `null` usage is not zero usage. When the response gives no token counts, `neurons = R` (the reservation stands, D8).
- **The stub** sends explicit zeros, so its neurons are 0. Stub chats never fill staging's day.
- **The books:**
  - A reserve adds R to `ai_days.neurons_reserved`.
  - A settle moves R out of `neurons_reserved` and adds `neurons` to `neurons_used`, both on the marker's day.
  - At every commit, `neurons_used` is the sum of every settled call's neurons that UTC day, and `neurons_reserved` is the sum of the reservations still open.
- **Numbers as text:** all of them are `numeric`. The API shows them as decimal text (`trim_scale(x)::text`), as amounts are.
- **The truth over the reservation:** the true count is recorded even when it passes R, which a non-Latin prompt can (section 3.3). The 1,000 neurons between Hrizzup's cap (9,000) and Cloudflare's free 10,000 absorb such overruns.

**6. A failure releases or keeps the reservation, depending on whether the model could have run.**

| Kind | When | Effect on the books |
|---|---|---|
| `released` | Cloudflare refused before running: 3040 (capacity), 5016 (model terms), any other 4xx but 408 (bad request, token, model name), or an unknown provider or a model name the code won't send | `reserved −= R`; the reader's message slot is given back |
| `exhausted` | 3036, the daily free allocation is spent | As `released`, and the marker's own day's `ai_days.exhausted_at` is set (never a fresh day that began after the call), so chat pauses until 00:00 UTC with no more calls |
| `kept` | The model may have run: a timeout or abort (408, or our 20-second limit), a network error, a 5xx, or an answer whose envelope can't be read | `reserved −= R; used += R`; the slot **stays taken** (decision 7) |

An answered call is always settled, never failed. That includes a 200 whose `response` isn't our JSON: decision 12 keeps its text.
- *Rejected:* releasing on every failure. A timeout or a 5xx may have spent neurons at Cloudflare.

**7. The reader's daily cap counts each message when it is reserved, and gives it back only when the model surely didn't run.**
- **When it counts:** `reader_days.messages + 1` happens in `begin`, under the reader's lock. So two tabs at 19 of 20 can't both pass.
- **When it is given back:** only a `released` or `exhausted` failure takes the 1 back (`messages − 1`). Cloudflare refused before running, so nothing of the shared allowance was used.
- **When it stays taken:** a `kept` failure (a timeout, a 5xx) keeps the slot, though the reader got no answer. The model may have run, and the cap is the only per-reader bound on the shared allowance. With it, one reader can use at most `reader_daily_messages × R` a day (20 × 18.3925 = 367.85 neurons), whatever fails. If kept failures gave slots back, about 489 timeouts from one reader could drain the whole day.
- **A takeover is never a free retry** (decision 8): the abandoned try's slot stays taken, as a `kept` failure's does, and the retry takes a new slot of its own, through the cap. So a crash, or a client that disconnects mid-call, costs the reader a slot, and repeating it can't pass their cap.
- **What the slot measures:** messages that were answered, are being answered, or may have run. Hrizzup's allowance counts everything that may have run.
- *Rejected:* counting at settle. Two sends at once would both see room.
- *Rejected:* giving the slot back on every failure. One reader could then spend the day's allowance through failures.

**8. Retries are safe by request ID.**
1. **After a send finished:** a retry with the same request ID answers the same two messages, with no AI call.
2. **While the first try is in flight** (its marker's 60-second lease is live): `in_progress`, which becomes a 409 `clash` ("still answering"), with `Retry-After`.
3. **After a crash past the lease** (a function that died, or a client that disconnected and ended the handler between `begin` and `settle`): the retry is a new request, never a free one.
   - **The abandoned try is charged as `kept`** (it may have run), exactly as `reader_chat_fail(…, 'kept')` charges it, on the marker's own day: `neurons_reserved −= p.reserved`, `neurons_used += p.reserved`, and the reader's day `neurons += p.reserved`. Its message slot stays taken (`messages` unchanged).
   - **The marker is deleted** (the request ID is free again), and the request goes on down the normal begin path (2.4 step 7 on) with the same request ID and body: the body checks, the reader's cap (`daily_cap` is possible), the allowance (`allowance_used` is possible, and counted), a new reservation at today's rates, a new slot (`messages + 1`), a new message ID and a new lease, all on today's settings and date.
   - **So every AI call that goes out passes the cap and the allowance,** and one reader's failures are bounded by their daily cap: each costs at most R and a slot. A takeover that kept the reservation would let one marker be retaken every 60 seconds with no check, about 1,440 calls (26,000 neurons) a day, past Hrizzup's 9,000 and the shared free allowance.
   - **If nobody ever retries,** the reservation stays open for that day, which is conservative.
4. **After a failure:** the marker is gone, so the same request ID tries again with a new reservation.
5. **A late answer from a try a takeover replaced is fenced out.** The abandoned try may still be alive, and finish after the takeover's new `begin` made a new marker under the same request ID. Each reservation's own message ID is its fence: `begin`'s `call.message_id` (the marker's `message_id`), which `settle` (in its `answer`) and `fail` (a fourth argument) must name. One that isn't the marker's is P0002 "No such message" and writes nothing, so a late settle can't save a wrong reply under the new message ID, a late `released` can't free the live call's slot, a late `exhausted` can't pause a fresh UTC day on a stale 3036, and a late `kept` can't lose the live reply. A fenced late call can only over-charge: the abandoned try was already charged at the takeover. A stored `done` still answers `done` whatever call is named, since the replay comes first.

- *Rejected:* refusing the retry of a crashed try for good. That would strand the reader's message.
- *Rejected:* a takeover that keeps the old reservation and slot (this note's first form). It was a free call past the cap and the allowance, repeatable every 60 seconds.
- *Rejected:* a sweep job for abandoned reservations. It changes nothing the budget sees, since reserved and used both count.

**9. Two tabs, one profile: the agent's edit is re-applied to the profile as it stands at settle.** `settle` takes `{base_number, body}`, the profile number the model saw and the new canonical body.
- **If the number moved** (a hand save, or the other tab's settle), `settle` writes nothing and answers `{state: 'stale', profile}`. The handler applies the same edit operations to that profile and settles again, up to 3 times. After that it settles without the profile change, adding a note to the reply.
- **Hand saves (`reader.saveProfile`)** are last-write-wins, as a plain editor's Save is. Every version is kept.
- **The reply always sorts after the reader's message.** The message's ID is made at `begin` and kept in the marker. The reply's ID is made at settle by `social._uuid7_after(message_id)`. `_uuid7()` alone is random within a millisecond, and the chat lists by `id desc`.
- *Rejected:* skipping the agent's edit when the profile moved. Its reply would say "added X" when X wasn't added.
- *Rejected:* a base number on hand saves. A plain editor is expected to save what the reader sees, and nothing is lost.

**10. The pause, and the seconds until 05:30 IST.**
- **One helper decides "paused":** `social._reader_paused(day row, settings)` is true when `exhausted_at` is set, or when `used + reserved + R > reader_ai_daily_neurons`, so one more full reservation doesn't fit. `reader_state` and `begin` both use it, so the page's "paused" and the 429 never disagree.
- **When the day ends:** `day_end = ((today + 1)::timestamp at time zone 'UTC')`, where `today = (clock_timestamp() at time zone 'UTC')::date`, never `current_date`.
- **What the reader is told:** `retry_after_seconds = greatest(1, ceil(extract(epoch from day_end − clock_timestamp())))`. `paused_until` is `day_end`, and so is `resets_at` for the cap. 00:00 UTC is always 05:30 IST: India has no summer time.

**11. The model answers small edit operations, never a rewritten profile.**
- **Its output:** `{reply, edits: [{op: add|remove, list: more|less|formats, item}]}`.
- **Why not a rewrite:** 300 output tokens can't hold a 2,000-character profile (500 or more tokens) plus a reply. A rewrite would be cut off into broken JSON, and a 3B model rewriting a list drops items.
- **Checked in code:** each operation is checked on its own. The final profile must parse and fit 2,000 characters, or the old one stays (7.7's rule).
- *Rejected:* the full profile (build.md 7.7's `{reply, profile | null}`). The output cap and dropped items make it unreliable.
- **A format word always goes to Formats** (found on staging with the real model, 19 November 2026): told "AI and crypto news, mostly timelines, no politics", Workers AI's 3B model put "timelines" under More of, not Formats, despite the system prompt. By decision 15 "More of" matches a story's own words and only "Formats" match a desk's formats, so the reader's format preference did nothing. The model's choice of list is not trusted for a format, by plain code (`applyEdits`, section 3.4), with the formats' names from the shared candidates' copy:
  - an **add to More of** whose item is a format is an add to Formats, the item as the reader wrote it;
  - an **add to Less of** whose item is a format is a remove from Formats, and is never added to Less of (a format a reader doesn't want is not lifted; it never hides a story, decision 15);
  - a **remove** from More of or Less of also removes the item from Formats;
  - **a format word never stays under More of or Less of:** each of the three, and an **add to Formats** of a format word (the one case where the model named Formats), also takes that format, in any spelling, out of both, so a profile that already holds "timelines" under More of has it moved to Formats, not duplicated (an add that is dropped, as one to a full Formats list is, moves nothing);
  - a **remove** from Formats, and any item that isn't a format, are as the model gave them; with no names (the candidates can't be read) nothing is rerouted or moved, and the send never fails for it.

**12. JSON is asked for in the prompt only; JSON mode stays off.**
- **Why:** Cloudflare's JSON mode list doesn't include `llama-3.2-3b-instruct`, and the model is a console setting. A `response_format` a model doesn't take could fail every call.
- **The answer is read tolerantly** (section 3.5). Text that isn't our JSON is kept as the reply, and the profile stays as it was.
- **The live call records:** the type of `response`, the `usage` field names, and whether 5016 fires.
- *Rejected:* sending `json_schema` by default. One live call couldn't test both forms.

**13. The stub makes small rule-based edits and says it is the stand-in.**
- **What it does:** it is deterministic and spends no neurons. It reads "no X", "less X" and format words (section 3.7).
- **Why edits:** local tests, previews and staging all exercise the profile path, including `apply → check → version (agent)`, before the token exists. The founder can also try the whole flow on staging.
- **What it says:** every stub reply begins "(Stand-in, Workers AI isn't set up here)".
- *Rejected:* a fixed answer with no edit. The agent's profile path would go untested until the token arrives.

**14. For You is built in three parts.**
- **Candidates, shared:** one Redis copy a minute of the board's top 300 listed live stories. Each is the board's own tile, with its rank and its desk's formats.
- **A build per reader:** the ranked IDs. Its ID is the first 16 hex of the SHA-256 of the ordered IDs, and it records the profile number it was built from.
- **Pages:** sliced from the build and filled with tiles from the same shared copy.
- **Why the ID comes from the content:** two first-page loads at once agree on it. A build that expired and is rebuilt unchanged (or rebuilt on every page while Redis is down) keeps old cursors working. Only a real change of order answers "rebuilt".
- **Why the profile number:** a first page whose build has an older profile number than the reader's current one is rebuilt. That covers a stale build written back just after a profile change deleted it.
- *Rejected:* random build IDs. Concurrent first pages would overwrite each other, and every second page would answer "rebuilt" whenever Redis is down.
- *Rejected:* filling pages from the database on every read (a `story_tiles` call). The tiles are already in the shared copy that the same trip reads.

**15. Matching: "More of" and "Less of" match the story's own words; "Formats" match the desk's formats.**
- **"More of" and "Less of"** match the story's title, summary, latest headline, category names and place names.
- **"Formats"** match the names of the formats on its desk.
- *Rejected:* matching every item against the desk's formats too, which is one reading of 7.7's sentence. "Less of: memes" would then hide every story with one meme on its desk.
- This reads build.md (R3's design), not a founder's decision, and it is recorded as an open question with a recommendation (section 7).

**16. Opening on For You: the tab redirects, and the reader's choice of the board is remembered.**
- **The tab:** `ForYouTab` (`for-you-tab.tsx`, R12's slot on R5's board) reads the reader's state and a cookie. A signed-in reader whose profile holds something, and who hasn't chosen the board in this browser session, is redirected (`redirect()`, a 307) to For You, at `/sandbox/social/reader/for-you`.
- **The choice:** a session cookie, `hz-social-tab=board`. The tab strip's buttons set and clear it through server actions (POST forms). A server component can read a cookie but not set one, and a link that set it would be prefetched.
- **Why a remembered choice is needed:** the bare `/sandbox/social` is also the board's default view, and `boardHref` writes nothing for Top and no filters. Without it, any redirect would trap the reader whenever they chose "Top", "All categories" or "First page".
- *Rejected:* an additive prop from `page.tsx`. It still needs the remembered choice, so it would mean a change to another relay's file for little gain.
- *Rejected:* reading the address through `W/proxy.ts` or a header. The proxy is the shared sign-in path, and Next.js gives a server component no URL.
- *Rejected:* For You drawn in place inside the tab. The board's own list would still render below it.
- *Rejected:* a client-side redirect. The board would flash, and its code budget would grow.

**17. The allowance's count is shown on the reader page, to every signed-in reader.**
- **What it shows:** Hrizzup's total today, `neurons used of the daily cap`, and each reply's own neurons. It is an aggregate with nothing personal in it.
- **What the done-test reads:** the count before and after a message, and the reply's own figure, which accounts for the difference.
- **The console:** it can show the count later with no new call. Its pages are R5's.
- *Rejected:* the console only. Its files aren't R12's, and the founder would have to switch pages to check one message.

**18. Nothing private is kept outside the reader's own rows, and nothing private is logged.**
- **The request store holds no text:** `social.requests`, which has no foreign key and is kept for 30 days, holds only IDs and facts for R12's calls, such as `{message_id, reply_id, profile_changed, facts}` and `{profile_number}`. A replay rebuilds its answer from the reader's own rows, which go with the account.
- **The provider logs one line a call,** with no text and no user: the outcome, the HTTP status, Cloudflare's code, the token counts, the answer's form and the milliseconds taken.
- **What goes to Cloudflare** is only the reader's own profile, at most their last 10 messages, and the new one.

---

## 2. M1: the database (`[risky]`, its own pull request, merged first)

### 2.1 The migration

**The file:** `infra/supabase/migrations/<time>_social_readers.sql`, with `<time>` after `main`'s newest, and `newest-migration.txt` naming it (the existing rule). Its header copies R7's, and says:
- it only adds: one column, ten helpers and seven calls, with no `create or replace`;
- every index it reads already exists;
- it raises no new SQLSTATE, and HZS40 to HZS49 are R12's;
- it makes no rows, so it runs on production unchanged.

The parts, in order:

1. `alter table social.ai_days add column exhausted_at timestamptz;`, with `comment on column`: "When Workers AI said the free daily allocation was spent (3036): chat pauses until the next 00:00 UTC, and no more calls go out that day. Null otherwise."
2. The helpers (2.3), then the calls (2.4), each with its `comment on function` (2.4 gives the text).
3. The grants:
   - every helper: `revoke all … from public, anon, authenticated, service_role, hrizzup_app`;
   - the seven calls: `revoke all … from public, anon, authenticated, service_role` then `grant execute … to hrizzup_app`.

   `social_grants.test.sql` holds them to its property without being edited: only built-in argument types, jsonb answers, `security definer` and `search_path = ''`.
4. **Parameters named like columns:** a parameter that shares its name with a column (`body`, `cursor`) is written with its function's name inside SQL (`reader_chat_begin.body`), as R7's header explains.

### 2.2 Lock order (every R12 write)

1. **The reader's lock first,** before any row: `pg_advisory_xact_lock(hashtextextended('social:' || who::text, 0))`, the documented actor lock (section 4 of build.md; `claim_agent` uses the same key, which is harmless).
2. **The reader's own rows, in any order, before or after `ai_days`:** `readers`, `reader_days` and their `requests` row. Only transactions holding the same advisory lock touch them, so they can never take part in a deadlock.
3. **`ai_days` rows in ascending day order** (a call's own day before today, in `fail`). They are the only rows other readers' transactions also lock. A transaction never waits on a shared row while holding another shared row in the opposite order, so there is no deadlock. Each holds its row for a statement or two.

Under the app's read committed, a waiting writer re-reads the row once the other commits. The transaction helper retries a whole transaction on 40001, 40P01 or 55P03, and every function here is safe to repeat (the replay).

### 2.3 Helpers (never granted)

| Helper | Does |
|---|---|
| `_reader_today() → date` (volatile) | `(clock_timestamp() at time zone 'UTC')::date` |
| `_reader_day_end(day date) → timestamptz` (immutable) | `((day + 1)::timestamp at time zone 'UTC')`: 05:30 IST |
| `_reader_most(s social.settings) → numeric` (immutable) | `(2000 * s.reader_ai_in_neurons_per_m + 300 * s.reader_ai_out_neurons_per_m) * 0.000001` |
| `_reader_paused(a social.ai_days, s social.settings) → boolean` (immutable) | `a.exhausted_at is not null or coalesce(a.neurons_used, 0) + coalesce(a.neurons_reserved, 0) + _reader_most(s) > s.reader_ai_daily_neurons` (a missing row is all nulls) |
| `_reader_profile_ok(body text) → boolean` (**stable**: it asks Postgres whether the agreement's `one_line` takes each item) | The canonical form, checked in four parts (below): the length and the code checks, the shape, each item (its length, no control or end-space character, and the agreement's `one_line` rule), and the count under each heading |
| `_reader_holds(body text) → boolean` (immutable) | `coalesce(body, '') ~ '\n- '` |
| `_uuid7_after(prev uuid) → uuid` (volatile) | `made := _uuid7()`; when `prev is null or made > prev`, `made`; else a version 7 ID in the millisecond after `prev`'s: `ms := ('x' \|\| lpad(substr(replace(prev::text, '-', ''), 1, 12), 16, '0'))::bit(64)::bigint + 1`, laid over `gen_random_uuid()`'s first six bytes with bits 52 and 53 set, exactly as `_uuid7` builds one |
| `_reader_message_view(m social.reader_messages) → jsonb` (**stable**: `markets.utc` is) | `{id, author, body, neurons: trim_scale(m.neurons)::text or null, created_at: markets.utc(m.created_at)}` |
| `_reader_view(who uuid) → jsonb` (stable) | the state: section 2.4's `reader_state` answer |
| `_reader_answer(who uuid, done jsonb) → jsonb` (stable) | `_reader_view(who) \|\| {message, reply, profile_changed, profile_refused}` (`profile_refused` from the stored facts, false when absent, so a replay carries it too): the two messages read by `done`'s IDs **and** `user_id = who` (missing: P0002 "No such message") |

**The canonical form, as `_reader_profile_ok` checks it.** It is one `language sql` expression, true only when all four parts hold:

1. **Length and code checks:** `body is not null and char_length(body) <= 2000 and agreement.passes_code_checks(body)`.
2. **The shape:** `body ~ '^# Reading profile\n\n## More of(\n- [^\n]+)*\n\n## Less of(\n- [^\n]+)*\n\n## Formats(\n- [^\n]+)*$'`.
3. **Each item:** `not exists (select 1 from regexp_matches(body, '\n- ([^\n]*)', 'g') m where char_length(m[1]) > 60 or m[1] !~ '^[^[:space:][:cntrl:]]([^[:cntrl:]]*[^[:space:][:cntrl:]])?$')`. An item is 1 to 60 characters, with no control character and no space at either end, and one the agreement's `one_line` domain takes: the item check also asks `pg_input_is_valid(m[1], 'agreement.one_line')`, which refuses a hidden (zero-width), direction or private-use character.
4. **Twenty a heading:** `(select coalesce(max((select count(*) from regexp_matches(part, '\n- ', 'g'))), 0) from regexp_split_to_table(body, '\n\n') part) <= 20`.

**Why four parts and no bounded repetition** (`{0,20}` around `{0,58}`): Postgres's regex engine compiles bounded repetition by copying states, nested three times over. The four parts read plainly, and each is cheap on 2,000 characters.

The TS side (`isCanonical` in `reading-profile.ts`) makes the same four checks in the same order, with `\s` and `\p{Cc}` for the classes, and the agreement's `one_line` pattern (from `@hrizzup/agreement`'s `parts`) for the item rule. The database's `[:space:]` follows its character classification (an item ending in a no-break space is refused there), so the TS check must refuse it too. `writeProfile`'s output always passes both.

The empty profile is therefore `# Reading profile\n\n## More of\n\n## Less of\n\n## Formats` (53 characters, holds nothing). The table's default `''` means "never saved", and the API shows it as that empty profile.

### 2.4 The seven calls

Every answer uses snake_case, times come from `markets.utc`, and numerics are decimal text (`trim_scale(x)::text`, also in the request's marker and the candidates' settings), so a number reads `18.3925`, never `18.392500`. Callers: **session** is `keys.session_account()` (42501 when nobody is signed in, or when a key signed the request); **app/none** is nobody.

**`social.reader_state() → jsonb`** (session, `stable`)
1. `who`.
2. Answer `_reader_view(who)`:

```
{profile ('' until first saved), profile_number, holds_something, profile_changed_at|null,
 usage {day, messages_today, daily_messages, messages_left_today = greatest(0, daily − today's),
        paused_until (day_end when _reader_paused, else null), resets_at (day_end)},
 allowance {neurons_used, neurons_reserved, daily_neurons, calls}}   ← today's ai_days row, zeros when none
```
Comment: "The signed-in reader's reading profile and today's allowance (the shape above). Writes nothing: a reader with no row reads the defaults."

**`social.reader_save_profile(request_id uuid, body text) → jsonb`** (session)
1. `who`; `request_id` null → 22023.
2. The reader's lock.
3. `_replay(who, request_id, 'reader_save_profile', {body})` (HZS27). If it was stored, answer `_reader_view(who)`.
4. `_reader_profile_ok(body)`, else 22023, detail `profile`: "A reading profile is its three headings with items of up to 60 characters, 20 a heading, 2,000 characters in all".
5. Insert the `readers` row if missing, then `select … for update`.
6. If `body` differs from the stored profile:
   - set `profile = body`, `profile_number + 1`, `holds_something = _reader_holds(body)` and `profile_changed_at = clock`;
   - insert `reader_profile_versions` (that number, `body`, author `reader`).

   An equal body writes nothing.
7. `_remember(…, {profile_number})`.
8. Answer `_reader_view(who)`.

Comment: "The reader's own save of their reading profile, in its one stored form: writes a version (author reader) when it changed. 22023 (detail profile) for any other form; HZS27 for a request ID used with another body."

**`social.reader_chat(cursor uuid, size integer) → jsonb`** (session, `stable`)
- `take = least(greatest(coalesce(size, 20), 1), 100)`.
- The reader's messages with `id < cursor`, `id desc`, `take + 1` rows.
- `_page(items, take, 'messages')`, each item `{v: _reader_message_view(m), c: to_jsonb(m.id)}`.
- Answer `{messages, next: the last ID | null}`.

Comment: "The signed-in reader's chat with their reader agent, newest first: {messages: [{id, author, body, neurons, created_at}], next}. Only their own."

**`social.reader_chat_begin(request_id uuid, body text) → jsonb`** (session): the reserve.
1. `who`; `request_id` null → 22023.
2. The reader's lock.
3. **Before anything else:** `s := _settings()`, `today := _reader_today()`, `R := _reader_most(s)`. Every path below, the takeover included, answers from these.
4. `stored := _replay(who, request_id, 'reader_chat', {body})` (HZS27).
5. **Already answered** (`stored ? 'message_id'`): answer `{state: 'done', answer: _reader_answer(who, stored)}`.
6. **In flight** (`stored ? 'pending'`):
   - while `lease_until > clock`: answer `{state: 'in_progress', retry_after_seconds: greatest(1, ceil(lease_until − clock))}`;
   - otherwise the abandoned try may have run, and a takeover is never a free retry. Charge it as `kept`, exactly as `reader_chat_fail(…, 'kept')` does, on the marker's own day (`ai_days(p.day)`: `neurons_reserved − p.reserved`, `neurons_used + p.reserved`; `reader_days(who, p.day).neurons + p.reserved`; `messages` unchanged, so its slot stays taken); delete the marker (`delete from social.requests where actor = who and request_id = …`, so the request ID is free); then **continue at step 7** as a new request with the same request ID and body. It passes the body checks, the cap and the allowance (each may refuse as data, and the charge and the deleted marker commit with the refusal), then reserves anew: a new reservation at today's R and rates, a new slot, a new message ID and lease, all on today's settings and date (step 3's `s`, `today` and `R`). The marker's day's `ai_days` row is locked before today's (2.2's ascending order). Step 11's `ai`, `profile` and `history` are read fresh.
7. **The message:** `body` is not null, 1 to 2,000 characters, and passes `body::agreement.plain_text` (in a sub-block that catches `check_violation`). Otherwise 22023, detail `body`. Then insert the `readers` row if missing (a begin refused for the cap or the allowance still leaves it).
8. **The reader's cap:** if today's `reader_days.messages ≥ s.reader_daily_messages`, answer `{state: 'refused', reason: 'daily_cap', retry_after_seconds, resets_at, view: _reader_view(who)}`. The refusal counts nothing.
9. **The allowance:** insert today's `ai_days` row if missing, then lock it (`for update`). If `_reader_paused(a, s)`:
   - `refused + 1`;
   - answer `{state: 'refused', reason: 'allowance_used', retry_after_seconds, paused_until, view}`. This commits.
10. **The reservation:**
    - today's `ai_days`: `neurons_reserved + R`, `calls + 1`;
    - `reader_days (who, today)`: upsert `messages + 1`;
    - the marker `{pending: {day: today, reserved: R::text, in: s.in::text, out: s.out::text, message_id: _uuid7(), started_at, lease_until: clock + 60 s}}`, through `_remember`.
11. Answer:

```
{state: 'reserved', call: {day, reserved, message_id, lease_until},
 ai: {provider: s.reader_ai_provider, model: s.reader_ai_model, max_input_tokens: 2000, max_output_tokens: 300},
 profile: {body, number}, history: [{author, body}]}
```
`call.message_id` is the call's fence (decision 8): the marker's own `message_id`, as text. `history` is the reader's last 10 messages, oldest first. The cap is checked before the allowance, so a reader past their own cap is never counted as an allowance refusal.

Comment: "Reserves one reader-agent call (D8). Answers {state: reserved | done | in_progress | refused}, never raising for the cap or the allowance, since the allowance's refusal is counted. 22023 (detail body), HZS27."

**`social.reader_chat_settle(request_id uuid, body text, answer jsonb) → jsonb`** (session)
1. `who`, then the reader's lock.
2. `stored := _replay(who, request_id, 'reader_chat', {body})` (HZS27):
   - `null`: P0002 "No such message" (a null `request_id` finds nothing, so it is P0002 too);
   - `? 'message_id'`: answer `{state: 'done', answer: _reader_answer(who, stored)}`.

   `p := stored -> 'pending'`.
3. **The fence, then `answer`'s form.** `answer ->> 'message_id'` must be a string UUID, else 22023, detail `answer`; if it isn't the pending marker's `message_id`, P0002 "No such message" and nothing is written (the call it names isn't the one the marker holds). Then anything else wrong is 22023, detail `answer`:
   - `provider` matches `^[a-z0-9-]{1,40}$`;
   - `prompt_tokens` and `completion_tokens` are both null, or both whole numbers from 0 to 1,000,000;
   - `provider = 'stub'` requires both to be 0;
   - `answer_form` is null or one of `json`, `json_in_text`, `text`;
   - `reply` is 1 to 2,000 characters and passes `agreement.plain_text`;
   - `profile` is null or `{base_number ≥ 0, body}`;
   - any other key is ignored, so M2 can send a new fact without a migration (it just isn't stored).
4. **If `profile` is given:**
   - lock the `readers` row (`for update`);
   - if `profile_number ≠ base_number`, answer `{state: 'stale', profile: {body, number}}` and write nothing;
   - when `_reader_profile_ok(body)` is false, the old profile stays: the call settles as if `profile` were null, with `profile_refused: true` in the remembered facts (never 22023: the brief's rule is "or the old one stays", and the reply is still saved; the coordinator's decision, 19 November 2026, on the advisor's review);
   - it is a change only when it differs from the stored profile.
5. **Neurons:** `neurons := case when prompt_tokens is null then p.reserved else (pt * p.in + ct * p.out) * 0.000001 end`.
6. **Writes:**
   - `ai_days(p.day)`: `neurons_reserved − p.reserved`, `neurons_used + neurons`;
   - `reader_days(who, p.day)`: `neurons + neurons`;
   - if it changed: the `readers` update and a version, author `agent`;
   - the reader's message: `id = p.message_id`, `created_at = p.started_at`;
   - the reply: `id = _uuid7_after(p.message_id)`, `neurons = neurons`.
7. **Remember the call:** `done := {message_id, reply_id, profile_changed, facts: {provider, prompt_tokens, completion_tokens, answer_form, neurons, reserved}}`, through `_remember`, which replaces the marker.
8. Answer `{state: 'done', answer: _reader_answer(who, done)}`.

Comment: "Settles a reserved call with the provider's answer: the reader's message, the reply, the profile version (author agent), the neurons used (the reservation stands without usage). The answer names the call (message_id, from begin's call): another call's is P0002 and writes nothing. {state: done | stale}; P0002 when nothing was reserved or the call isn't the marker's; 22023 (detail answer); a profile not in its stored form leaves the old one (profile_refused); HZS27."

**`social.reader_chat_fail(request_id uuid, body text, kind text, message_id uuid) → jsonb`** (session)
1. `who`, the reader's lock, the replay:
   - `null`: P0002 (a null `request_id` too);
   - `? 'message_id'`: answer `{state: 'done', answer}`.
2. **The fence:** a null `message_id`, or one that isn't the pending marker's, is P0002 "No such message" and nothing is written. It is checked **before** `kind`.
3. `kind` is one of `released`, `exhausted`, `kept`; otherwise 22023, detail `kind`.
4. **Writes:**
   - `released` and `exhausted`: `ai_days(p.day).neurons_reserved − p.reserved`; `reader_days(who, p.day).messages − 1`.
   - `exhausted` also sets `exhausted_at = coalesce(exhausted_at, clock)` on the marker's own day's row (`p.day`, whose row exists since the reservation made it), never on a fresh day that began after the call.
   - `kept`: `ai_days(p.day)`: `neurons_reserved − p.reserved`, `neurons_used + p.reserved`; `reader_days(who, p.day)`: `neurons + p.reserved`. `messages` is unchanged: the slot stays taken (decision 7).
   - `calls` is never lowered by a failure: it counts the reservations made.
5. Delete the marker: `delete from social.requests where actor = who and request_id = …`.
6. Answer `{state: 'failed', kind, view: _reader_view(who), retry_after_seconds}`, where `retry_after_seconds` is the seconds to the end of today's UTC day on the database's clock, counted exactly as begin's refusal counts them (decision 10), so the handler's 429 after `exhausted` needs no clock of its own.

Comment: "Ends a reserved call that got no answer: released (it didn't run: the reservation and the reader's message slot come back), exhausted (as released, and chat pauses for the marker's UTC day: 3036) or kept (it may have run: the reservation counts as used and the slot stays taken). {state: failed, kind, view, retry_after_seconds}; the request ID is free again. message_id is begin's call.message_id: another call's, or none, is P0002 and writes nothing. P0002, 22023 (detail kind), HZS27."

**`social.foryou_candidates() → jsonb`** (app/none, `stable`)
- **The stories:** the top 300 rows of `social.stories` that are `listed and state = 'live'`, ordered by `top_rank desc, story_id desc` (`stories_board_top`), joined to `content.stories` and the latest update as `social.board` does.
- **Each story:** `social._story_tile(s, c, u) || {top_rank: s.top_rank::text, formats: <its desk's distinct formats>}`. The formats are `(select coalesce(jsonb_agg(distinct p.format order by p.format), '[]') from social.posts p where p.story_id = s.story_id and p.removed_at is null and p.format is not null)`, through `posts_desk_latest`.
- **The answer:**

```
{as_of, half_life_hours: board_half_life_hours::text, match_hours: foryou_match_hours::text,
 format_hours: foryou_format_hours::text, formats: [{code, name}] (by sort), stories: [...]}
```

Comment: "For You's candidates: the board's top 300 listed live stories as tiles, each with its rank and its desk's formats, and the settings For You ranks by. Nothing personal: kept once in Redis for every reader."

The tile is R8's own (`_story_tile`, with its picture), so `storyTileOf` maps it unchanged. R8's tests pin `_story_tile`: this composes with it and never replaces it.

### 2.5 What M1's builder does first
1. Rebase on `main`, and take the next migration time after `main`'s newest.
2. **Before anything else, prove the two pieces of SQL this note couldn't run** (the slot's database wasn't started for the design), on the slot's database with `psql`:
   - **`_reader_profile_ok`'s four parts** (2.3). They accept the examples' profile, the empty profile, a 60-character item and 20 items; they refuse a 61-character item, 21 items, a missing heading, a final new line and a tab.
   - **`_uuid7_after`'s bit cast:** `('x' || lpad(…, 16, '0'))::bit(64)::bigint` gives the millisecond, and a made ID is version 7, with the variant, greater than `prev` even when `prev` is in the current millisecond.

   If either misbehaves, the builder stops and the expert re-designs that piece; nothing else changes.
3. Write the migration from 2.1 to 2.4. Copy R7's header and grants block, and `claim_agent`'s lock-then-replay frame.
4. Write the tests in section 6.1, `infra/supabase/tests/social_readers.test.sql`, with `pg_temp.as_app` copied from `social_join.test.sql`.
5. `pnpm test:db` through the slot. The existing `social_grants`, `social_tables` and `social_accounts` tests must pass unchanged. They test properties and the presence of tables, so they do.

---

## 3. M2: the provider, the calls and the caches (`[risky]`: the allowance's books and a third party)

### 3.1 Contract changes (`A/readers.ts`, `examples/readers.json`, both R12's; reader calls are never published)
- **`readerUsage`** gains `messagesToday: count`, `dailyMessages: count` and `resetsAt: moment`.
- **`readerState`** gains `allowance: {neuronsUsed: decimal, neuronsReserved: decimal, dailyNeurons: decimal, calls: count}`. `decimal` comes from `../console.ts`.
- **`readerMessage`** gains `neurons: decimal.nullable()`: an agent reply's neurons, and null for the reader's own message.
- **`readerReply`** gains `holdsSomething`, `usage` and `allowance`, the state after the message.
- **`send`'s errors:**
  - a 409 for a message still being answered, under the existing reason `clash`;
  - a new **503 `SERVICE_UNAVAILABLE`**, declared inline in `readers.ts`: `data: {reason: 'busy' | 'unavailable' | 'too_slow', retryAfterSeconds}`.
- **The examples** gain the new fields, consistent with the arithmetic: a reply of `5.365375` neurons, and a day's `neuronsUsed` that is the sum of the replies shown. The `rebuilt` example's message becomes the issue's own sentence, as `cursorFrom`'s are.
- Each call is marked `.meta(live(sessionMeta))`, and `contract.routes.json` is regenerated (8.3).

### 3.2 Where the code lives
- **`@hrizzup/social/src/reading-profile.ts`** has no Node imports. It holds:
  - `EMPTY_PROFILE`;
  - `parseProfile(text) → {ok, profile} | {ok: false, issues}`;
  - `writeProfile(profile)`;
  - `cleanItem(text)`;
  - `applyEdits(profile, edits, options?) → {profile, applied, dropped}`, with `options.formatNames` (decision 11);
  - `holdsSomething(profile)`;
  - `isCanonical(text)`, the same four checks as SQL's `_reader_profile_ok` (section 2.3), in JS (flag `u`).
- **`@hrizzup/social/src/words.ts`** has no Node imports. It holds `words`, `itemWords`, `holds` and `matches`: the word rules (section 4.1), which `reading-profile.ts` also reads a format word by (decision 11) and `for-you.ts` re-exports.
- **`@hrizzup/social/src/for-you.ts`** is server only (`node:crypto`). It holds `buildForYou` and `buildId`, and re-exports `words`, `itemWords` and `matches`.
- **`W/lib/social/reader-ai/`** is the provider:
  - `index.ts`: `readerAi(env, settings) → Provider`;
  - `workers-ai.ts`;
  - `stub.ts`;
  - `prompt.ts`: `SYSTEM_PROMPT`, `buildPrompt` and `estimateTokens`;
  - `answer.ts`: `readAnswer` and `cleanReply`;
  - `failures.ts`: `classify`.
- **`W/lib/api/social/readers.ts`** holds the five handlers and R12's own error map.

### 3.3 The request to Workers AI
- **Address:** `POST https://api.cloudflare.com/client/v4/accounts/${WORKERS_AI_ACCOUNT_ID}/ai/run/${model}`.
  - `model` is the setting, and is sent only when it matches `^@(cf|hf)/[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$` (each part starts with a letter or a digit, as built in M2: the first form let `@cf/../x` change the request's path). Anything else fails as `released` before any request.
  - The provider is chosen from the setting `reader_ai_provider`. Only `workers-ai` exists. Another name fails as `released` (503 `unavailable`), and the log says the name.
- **Sending:** headers `Authorization: Bearer ${WORKERS_AI_TOKEN}` and `Content-Type: application/json`; `fetch(url, init)` (never a `Request`, as `storage.ts` notes); `cache: 'no-store'`; `signal: AbortSignal.timeout(20_000)`.
- **The body:** `{messages: [{role: 'system', content: SYSTEM_PROMPT}, {role: 'user', content: <turn>}], max_tokens: <max_output_tokens from begin, 300>, temperature: 0.2}`, with no `response_format` (decision 12).
- **No automatic retries:** a retry may cost neurons, and the reader can send again.

**`SYSTEM_PROMPT`, exactly:**

```
You are the reader agent in Hrizzup, a news app. You help one reader choose what they see in their For You feed. You never post anything and you never write news.

The reader's reading profile has three lists:
- "more": topics, places, people or things they want more of
- "less": topics they want less of
- "formats": the kinds of post they like: breakdowns, timelines, explainers, memes, audio briefs, infographics, translations, source checks

From the reader's new message, make small edits to the lists:
- Add or remove one item at a time. Never rewrite or empty the lists unless the reader asks.
- Keep each item short: a few words, at most 60 characters, in the reader's own words (for example "AI", "the Philippines", "cricket").
- To move an item from one list to the other, remove it from one list and add it to the other.
- Formats go only in "formats", and only the kinds named above.
- If the message asks for no change, make no edits.

Then reply to the reader in one or two short sentences, in their language, saying what you changed. Do not use markdown.

Answer with JSON only, in exactly this shape:
{"reply": "...", "edits": [{"op": "add", "list": "more", "item": "..."}]}
"op" is "add" or "remove"; "list" is "more", "less" or "formats". Use an empty "edits" list when nothing changes.

Example. Profile: {"more": [], "less": [], "formats": []}. Message: "AI news from the Philippines, mostly timelines and memes, no crypto". Answer:
{"reply": "Done: more AI and the Philippines, timelines and memes, and no crypto.", "edits": [{"op": "add", "list": "more", "item": "AI"}, {"op": "add", "list": "more", "item": "the Philippines"}, {"op": "add", "list": "formats", "item": "timelines"}, {"op": "add", "list": "formats", "item": "memes"}, {"op": "add", "list": "less", "item": "crypto"}]}
```

**The user turn**, one message (a transcript, not chat turns, so past replies can't pull the model out of JSON):

```
Profile: {"more": [...], "less": [...], "formats": [...]}

Earlier messages, oldest first:
Reader: …
Agent: …

New message:
…
```
The "Earlier messages" block is left out when there are none. `Profile` is the parsed current profile as compact JSON.

**Trimming to the 2,000-token cap** (`buildPrompt`):
- **The estimate:** `estimateTokens(text) = ceil(utf8Bytes(text) / 3)`, plus 8 a message and 16 a call. That is about 40% over Llama 3's English rate, and about one token a character for Devanagari.
- **The target:** `floor(0.9 × max_input_tokens) = 1,800`.
- **Always sent in full:** the system prompt and the profile.
- **The new message** is sent in full when it fits; otherwise it is cut at a word boundary with "…" to fit, never below 400 characters.
- **History fills what is left,** newest first, each message cut to 400 characters, stopping at the first that doesn't fit.
- **When the rule can't hold:** with a full profile in a non-Latin script, the system prompt, profile and 400 characters may still pass 1,800. The call still goes out, and settle records the true count (decision 5).
- `buildPrompt` answers `{messages, estimatedTokens}`.

### 3.4 Parsing the reader's own profile (`parseProfile`)

Lines are split on `\n` (longText already refuses `\r`). Each line, numbered from 1, is read as follows:
- **Blank lines** are skipped.
- **A `# …` line** is accepted only before the first heading, and is dropped: the writer writes the title.
- **A `## …` line:** its text, trimmed, with spaces collapsed and lower-cased, must be `more of`, `less of` or `formats`. A repeat is an issue ("Line N: ## More of appears twice: keep one"). Any other heading, or `###` and deeper, is an issue ("Line N: the headings are ## More of, ## Less of and ## Formats").
- **A bullet** (`- `, `* `, `+ `, or `1. ` / `1) `):
  - `cleanItem` the rest: NFC, trim, and collapse runs of white space to one space;
  - an empty item is skipped;
  - a bullet before any heading is an issue ("Line N: put each item under a heading");
  - over 60 characters, or failing the agreement's `one_line` pattern (from `@hrizzup/agreement`'s `parts`), is an issue ("Line N: an item is at most 60 characters (this one is K)");
  - a repeat in its section, compared case-insensitively after NFKC, is dropped silently.
- **Anything else** is an issue ("Line N: each line is a heading or an item starting with "- "").

After the lines:
- a section with more than 20 items is an issue ("## More of has K items: at most 20");
- `writeProfile` longer than 2,000 characters is an issue ("Your profile would be K characters: at most 2,000, so take some items out").

**The answer:** at most the first 10 issues, all on path `body`. A missing heading is an empty section.

**`applyEdits(profile, edits, options?)`:**
- **Order and count:** at most the first 10 operations, in order.
- **`add`:** `cleanItem`, then the item rules. An item that is already in that list, compared case-insensitively, is a no-op. Adding to `more` removes the same item from `less`, and the other way round, so an item is never in both after the agent's edit. A full list (20) drops the operation.
- **`remove`:** removes the case-insensitive match from that list; an item that isn't there is a no-op.
- **What it answers:** `{profile, applied, dropped}`. When `writeProfile(profile)` passes 2,000 characters, the old profile stays and every operation counts as dropped.
- **The formats' names** (`options.formatNames`, optional; decision 11): when given, an operation on `more` or `less`, or an add to `formats`, whose item is a format is read as follows, before the rules above run. An item is a format when its `words` are one name's `words`, the same number in the same order, each the name's word or that word with a final `s` or `es` (`holds`): so "timelines", "Memes" and "audio briefs" are formats, and "AI", "brief" and "memes and timelines" are not.
  - **add to `more`:** an add to `formats`, the item as the reader wrote it, and the same format (in any spelling) taken out of `more` and `less`. An add of a format already in `formats` (under another spelling: "Meme" for "memes") only clears `more` and `less`; a full list drops it, as it does any add, and then moves nothing.
  - **add to `formats`:** a format word added there is read as the add to `more` above: the same format (in any spelling) taken out of `more` and `less`, the add a no-op if `formats` already holds it, dropped (and nothing moved) if the list is full or the item is refused.
  - **add to `less`:** a remove of every item that is the same format from `formats`, `more` and `less`; never added to `less`. A format that isn't anywhere is a no-op, not dropped.
  - **remove from `more` or `less`:** the same remove, from all three lists.
  - Each is applied once if it changed the profile.
  - A remove from `formats`, a non-format item, and any call with no names or an empty list are read exactly as above.

### 3.5 Reading the model's answer (`readAnswer`, `cleanReply`)

**The envelope.** On a 200, parse `{success, result: {response, usage}, errors}`.
- **Usage:** `usage.prompt_tokens` and `usage.completion_tokens` are used only when both are whole numbers from 0 to 1,000,000; otherwise both count as null.
- **`success: false` or a non-200:** classified by `errors[0].code` and the status (3.6).

**The response:**
1. **An object:** checked as `{reply, edits}`; form `json`.
2. **A string:** trimmed, with any ` ``` ` or ` ```json ` fence removed.
   - `JSON.parse` of the whole: form `json`;
   - else the slice from the first `{` to the last `}`: form `json_in_text`;
   - else form `text`.
3. **The check is lenient:** `reply` is a string; `edits` is an array, or missing for none. Each edit is checked on its own, and a bad one is dropped.
4. **Form `text`:** the reply is the cleaned text, with no edits. Text that starts with `{` (broken JSON) is never shown: the reply is the fallback "I couldn't read my own answer this time: try saying it another way".
5. **`response` missing:** an answered call, form `text`, with that fallback.

**`cleanReply`:**
- **Characters:** NFC; `\t` becomes a space; other control characters except `\n` are dropped; `\p{Cf}` (but U+200D), `\p{Co}` and `\p{Cs}` are dropped.
- **Lines:** three or more new lines become two; the whole is trimmed.
- **Length:** 2,000 characters at most, cut at a word boundary with "…".
- **Fallbacks:** when the cleaned reply is empty, or still fails the contract's `plainText(2000)`, the fallback is "Done: I updated your reading profile." when operations were applied, else "I didn't change anything: tell me what you'd like more or less of."
- **Notes:** when any operation was dropped, the note "(Some changes didn't fit: items are at most 60 characters, 20 a heading.)" is added, if the total stays within 2,000. When the profile was re-applied three times without settling, the note is instead: "Your profile changed while I was answering, so I left it as it is: tell me again if something is missing."

### 3.6 Failures, and what the reader sees

| What Workers AI did | Kind (decision 6) | Answer | Words (`Retry-After`) |
|---|---|---|---|
| 3036, daily free allocation used | `exhausted` | 429 `allowance_used` | "The reader agent has used today's allowance: chat pauses until 05:30 IST, and your feed keeps working" (until 00:00 UTC) |
| 3040 capacity, or 429 with no known code | `released` | 503 `busy` | "Your reader agent is busy right now: try again in a minute" (30) |
| 5016 model terms (log "Llama 3.2 terms not agreed"), 401 or 403, any other 4xx but 408, a model name the code won't send, an unknown provider | `released` | 503 `unavailable` | "Your reader agent isn't available right now: try again later" (60) |
| 408 (3007, 3008), our 20-second abort | `kept` | 503 `too_slow` | "Your reader agent took too long to answer: send your message again" (5) |
| 5xx, a network error, an envelope that can't be read | `kept` | 503 `unavailable` | as above (60) |
| 200 with a `response` that isn't our JSON | answered | 201 | the cleaned text or the fallback; the profile unchanged |

**Every error after `begin` reserved ends the call, exactly once.** The handler wraps the provider and the settle loop in one guard with a flag, `ended`, set as soon as its own `reader_chat_fail` or a `done` settle has returned.
- **On any throw while `ended` is false** (a bug in our code, settle's 22023, a database error), it calls `reader_chat_fail(…, 'kept')`, best effort, before the error goes out.
- **It never calls `fail` twice.** If that `fail` itself throws, P0002 included (nothing pending any more), the throw is swallowed and logged, and the first error goes out.
- **If the settle had committed** before the throw, `fail` answers `done` and changes nothing.
- **Both name the call** (decision 8's fence): `settle` carries `begun.call.message_id` as `answer.message_id`, and `fail` takes it as its fourth argument. A P0002 from either after a takeover means another try owns the call now: the guard swallows it, as it does any `fail` that throws, and the first error goes out. A fenced late call can only over-charge, since the abandoned try was charged at the takeover.

### 3.7 The stub (`stub.ts`)

The stub is deterministic and takes no time. Its usage is `{prompt_tokens: 0, completion_tokens: 0}`, its provider `stub`, and its `answer_form` null. Its edits go through the same `applyEdits`, with its own format names (decision 11), and its reply names what that changed in the profile, list by list ("More of: …", then "Removed from Formats: memes"), never what its edits said: "no memes" is a remove from Formats, not an add to Less of.

**How it reads the message:**
1. Split the message into clauses on `,`, `;`, `.`, `!`, `?`, new lines, and the words `and`, `but`, `from`, `in` and `about`.
2. Read each clause, trimmed and lower-cased only for matching, kept as the reader wrote it:
   1. **Less:** it starts with `no more`, `no`, `not`, `less`, `fewer`, `without`, `stop` or `skip`. The rest becomes `add less <rest>`.
   2. **Remove:** it starts with `remove`, `drop` or `forget`. The rest becomes `remove` from every list that holds it.
   3. **Formats:** it names a format: timeline, meme, explainer, breakdown, infographic, audio brief, translation or source check, each with or without a final `s`. Each found becomes `add formats <the plural name>`.
   4. **More:** otherwise, after stripping a leading `more`, `mostly`, `some`, `i want`, `i like` or `show me`, the rest becomes `add more <rest>`, if any is left.

**What it replies:** "(Stand-in, Workers AI isn't set up here.) More of: …; Less of: …; Formats: …", then "Removed from More of: …", "Removed from Less of: …" and "Removed from Formats: …" for what went out for good, each naming only what changed in the profile (an item that moved to another list is told where it landed). So "no memes" on a profile that likes memes replies "Removed from Formats: memes". With nothing to change: "(Stand-in, Workers AI isn't set up here.) I didn't find anything to change: try "more cricket, no crypto"."

**Example.** "AI news from the Philippines, mostly timelines and memes, no crypto" gives:
- More of: `AI news`, `the Philippines`;
- Formats: `timelines`, `memes`;
- Less of: `crypto`.

### 3.8 The handlers (`W/lib/api/social/readers.ts`)

Every call starts with `sessionOf(context.headers)` (401, or 403 for a key) and runs its database work through `asSession(user.id, …, readerRefusals)`.

`readerRefusals` maps:
- 22023 with detail `body` or `profile` to a 400 on path `body`, in the database's words;
- 22023 with detail `answer` or `kind` to a bug, a 500, never a 400.

Everything else is the shared map: HZS27 is a 409 `request_reused`, and 42501 the session's 403.

1. **`reader.get`:** `remember(reader key, ttl, () => reader_state())`, where `ttl = max(1, min(60, seconds to 00:00 UTC))`, so no copy lives past the day's turn. The copy is the database's answer, and is mapped per call:
   - `profile: ''` becomes `EMPTY_PROFILE`;
   - `profileNumber` is kept in the copy for For You, but never answered.
2. **`reader.saveProfile`:**
   - `parseProfile(body)`; issues become a 400 (`badRequest(first, issues)`);
   - `canonical = writeProfile(…)`;
   - `reader_save_profile(requestId, canonical)`;
   - `forget([reader key, forYou key])`;
   - answer the state.
3. **`reader.chat.list`:** `cursorFrom('last', cursor)`; `reader_chat(cursor, limit ?? DEFAULT_PAGE)`; `next` through `nextFrom('last', …)`. No Redis: it is read once a page view.
4. **`reader.chat.send`:**
   1. `begun = reader_chat_begin(requestId, body)`. Then by `begun.state`:
      - `done`: answer it (a replay, with no AI call);
      - `refused`: `forget([reader key])`, then a 429 with `retryAfterSeconds` (the `Retry-After` header and the data), `allowance_used` or `daily_cap`. The cap's words: "You've used today's N messages with your reader agent: chat opens again at 05:30 IST, and your feed keeps working";
      - `in_progress`: 409 `clash`, "Your reader agent is still answering this message: try again in a few seconds", with `Retry-After`.
   2. `readerAi(env, begun.ai)`: the stub when the token or the account ID is missing, else Workers AI.
   3. `buildPrompt`, call the provider, `readAnswer`, then `applyEdits` to `parseProfile(begun.profile.body)`, with the formats' names (decision 11) read once from the shared candidates' copy, only when an operation could touch a format word (any but a remove from Formats), after the provider has answered; if the copy can't be read, with none, and the send goes on.
   4. **On a failure:** `reader_chat_fail(requestId, body, kind, begun.call.message_id)`, `forget([reader key])`, then the answer from 3.6.
   5. **Otherwise, settle:** `reader_chat_settle(requestId, body, {message_id: begun.call.message_id, provider, prompt_tokens, completion_tokens, answer_form, reply, profile: changed ? {base_number, body: writeProfile(…)} : null})`. On `stale`, apply the same edits to the profile it returned and settle again, three times at most; then settle with `profile: null` and the note (3.5).
   6. **After it commits:** `forget([reader key, …(profile_changed ? [forYou key] : [])])`, then answer `201`.
   7. Log one line (decision 18).
5. **`reader.forYou`:** section 4.2.

**Redis** (key names from `socialRedis`, the environment's prefix first, each written with its expiry):

| Key | What it holds | Life | Deleted by |
|---|---|---|---|
| `cache:social-reader:v1:<userId>` | `reader_state()`'s answer | ≤ 60 s (never past 00:00 UTC) | every save, send, refusal and failure of that reader |
| `cache:social-foryou:v1:<userId>` | `{id, ids, profileNumber, builtAt}` | 300 s | a profile save, and a send that changed the profile |
| `cache:social-board-top:v1` | the candidates, mapped: `{asOf, halfLifeHours, matchHours, formatHours, formats {code: name}, stories [{tile, rank, formats}]}`, about 300 KB at most (Upstash takes 10 MB a request) | 60 s | its expiry: it holds nothing personal |

`cache.ts` (shared) is used only through `remember` and `forget`. A read with no write is `remember(key, s, async () => null)`, since a null answer isn't kept. Calls issued together share one trip (auto-pipelining). No shared change is needed.

**Speed targets** (server time, p95): `reader.get` 50 ms warm, 150 ms cold; `reader.forYou` 100 ms warm, 400 ms when it builds; `reader.chat.list` 100 ms. `reader.chat.send` takes 150 ms beside the provider: two short transactions, and the provider's own time, 1 to 3 s typically, 20 s at most. Pages are in section 4.6.

### 3.9 The one live call on staging (M2's done-test, once the founder has added the token)

1. **When:** after M2 is on staging, with `WORKERS_AI_TOKEN` and `WORKERS_AI_ACCOUNT_ID` in Doppler `stg`. Until then it is recorded as waiting on the founder, and M2 merges with the stub.
2. **How:** `W/e2e/done/social-r12.spec.ts`, by hand, once, as R7's done-test is: `infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com pnpm exec playwright test --config playwright.done.config.ts e2e/done/social-r12.spec.ts'`. This Mac calls staging's API; only staging calls Workers AI.
   1. A run account signs in (staging's admin access gives the code; no email).
   2. One `POST /api/v1/reader/chat` with "More cricket, no crypto".
   3. The same request ID again, which must be the same answer with no second call.
   4. `GET /reader` and `/reader/chat`.
3. **It must confirm** (each recorded in the pull request):
   - a 201;
   - the reply's `neurons` is under the reservation, which proves `usage` came, with integer counts;
   - the replay's IDs equal the first;
   - `allowance.neuronsUsed` grew by at least the reply's neurons.
4. **Then read on staging's database** (read-only): `infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- psql -c "select result->'facts' from social.requests where call = 'reader_chat' order by created_at desc limit 1"`. It gives `answer_form`, `prompt_tokens` and `completion_tokens`.
5. **Record in the pull request:**
   - the form (`json`, `json_in_text` or `text`);
   - `prompt_tokens` against `buildPrompt`'s `estimatedTokens` for that same input. `prompt.test.ts` prints it for the exact message. If the true count is above 1.1 times the estimate, raise the divisor's safety (3 to 2.5) in a follow-up;
   - whether the profile changed as asked.
6. **5016 means the model's terms aren't agreed:** nothing is spent, the call is `released`, and accepting Meta's Llama 3.2 licence goes to the founder (section 7).

---

## 4. M3: For You, opening on it, the pages and the journey (`[normal]`)

### 4.1 The build (`buildForYou`, plain code, no clock)
- **Words** (`words(text)`): `text.normalize('NFKC').toLowerCase()`, split on `/[^\p{L}\p{M}\p{N}]+/u` (letters with their marks, so Hindi's vowel signs don't split a word, and digits), drop empty pieces and `the a an of and news`. An item's words are `words(item)`. An item with no words left matches nothing.
- **Matching:** an item matches a set of words when every item word `w` is in the set, or `w` without a final `es`, or without a final `s`, is.
  - **A story's words:** its tile's title, summary and latest headline, its categories' and places' names (`categoryNames()`, `placeNames()`), all in one set.
  - **Its desk's words:** the names of its desk's formats, from the candidates' `formats`.
- **Ranking:**
  - **Units:** `unit(h) = BigInt(Math.round(1e6 × Math.LN2 × h ÷ halfLifeHours))`, with the setting the board's Top uses. With 24 and 12 that is 1,386,294; with 6, 346,574.
  - **Dropped:** a story that any "Less of" item matches.
  - **Score:** `BigInt(rank) + unit(matchHours) × (More of items matching) + unit(formatHours) × (Formats items matching its desk)`, computed in BigInt.
  - **Order:** score descending, then story ID descending (lower-case UUID text compares as the board's `story_id desc`).
  - **Size:** every candidate kept, at most 300.
- **The empty profile** gives the board's Top, as it is.
- **The build's ID:** `buildId(ids) = sha256(ids.join('\n')).hex.slice(0, 16)`, which fits the cursor's `b`.

### 4.2 `reader.forYou`
1. `at = cursorFrom('forYou', cursor)` (`{b, o}` or null); `take = limit ?? DEFAULT_PAGE`.
2. **One trip** (issued together):
   - `saved = remember(build key, 300, () => null)`;
   - `candidates = remember(top key, 60, loadCandidates)`;
   - on a first page only, `state = remember(reader key, ttl, loadState)`.

   `loadCandidates` is `asApp(foryou_candidates())`, mapped once through `storyTileOf`.
3. **First page:** if `saved` is missing, or its `profileNumber` isn't the state's, rebuild:
   - `forget([build key])` when it was stale;
   - `buildForYou(parse(state.profile), candidates)`;
   - `remember(build key, 300, () => built)`.

   Use whatever `remember` answers.
4. **A later page:**
   - if `saved` is missing, rebuild the same way, with the state;
   - if the build's `id` isn't `at.b`, answer 400 on `cursor`: "Your For You was rebuilt: start again from the first page";
   - if `at.o` is past the build's length, answer 400 with the usual cursor message.
5. **The page:**
   - `ids = build.ids.slice(o, o + take)`;
   - the tiles are those IDs' tiles from `candidates`, in order. An ID missing from the current copy (withdrawn, or no longer in the top 300) is skipped, so a page may be short;
   - `next = o + take < build.ids.length ? {b: build.id, o: o + take} : null`, through `nextFrom('forYou', …)`. It is measured against the whole build, never the page, so a page shortened by skipped tiles still pages on.
6. **With Redis down,** every call loads from the database and rebuilds. The build's ID depends only on the order, so cursors stay good while nothing changes.

### 4.3 Opening on For You (`for-you-tab.tsx`, R12's)

`ForYouTab` is an async server component with no props:
1. `who = await viewer()`. It is React-cached, and the header already called it, so signed out costs nothing.
2. **Signed out:** one line with a plain link: "Sign in to get your own For You" (`/sign-in-test?next=/sandbox/social/reader`). The board's Speed check, which runs signed out, does no extra work.
3. **Signed in:**
   - `holds = (await serverApi.reader.get()).holdsSomething`, in a `try`; a failure means `false`, never a broken board;
   - `chose = (await cookies()).get('hz-social-tab')?.value === 'board'`;
   - `if (holds && !chose) redirect('/sandbox/social/reader/for-you')`. **`redirect()` stays outside any `try`:** it works by throwing.
4. **Otherwise,** the tab strip: **Board** (the current tab, plain text) and **For You** (a form button posting `showForYou`).

**The server actions** (`W/app/sandbox/social/reader/actions.ts`, `'use server'`, each starting with `sandboxOnly()`):
- **`showBoard()`:**
  - sets `hz-social-tab=board`: `httpOnly`, `sameSite: 'lax'`, `path: '/sandbox/social'`, no `maxAge` (a session cookie);
  - `secure` when the request is HTTPS (`x-forwarded-proto`), as `pendingCookieOptions(secure)` takes it;
  - then `redirect('/sandbox/social')`.
- **`showForYou()`:** deletes the cookie, then `redirect('/sandbox/social/reader/for-you')`. The delete must name the same `path: '/sandbox/social'` (`cookies().delete({name, path})`), or the browser keeps the cookie and the board stays chosen.

**What the reader gets:**
- a reader whose profile holds something opens on For You at each new browser session;
- once they choose the board, every board address (filters, orders, pages) stays on the board for the rest of the session;
- a reader whose profile holds nothing always opens on the board.

The design chat's real board will hold its tabs itself (PLAN.md's "Latest, Top and For You").

### 4.4 The pages
- **`/sandbox/social/reader/for-you/page.tsx`:**
  - `sandboxOnly()`; signed out, the sign-in line;
  - signed in, the tab strip with **For You** current and **Board** posting `showBoard`;
  - one line: "Built from your reading profile", or "Your profile is empty, so this is the board's Top: tell your reader agent what you like", with a link to the reader page;
  - `serverApi.reader.forYou({cursor, limit: 20})`. A 400 for the cursor is the note "Your For You was rebuilt: showing the first page" over page 1;
  - R5's `StoryTile` for each story, used as it is, with props;
  - "First page" and "Next" links, `?cursor=`, `prefetch={false}`;
  - "No stories match your profile right now" when there are none.
- **`/sandbox/social/reader/page.tsx`** (chat and profile). Signed out, the sign-in line. Signed in, in order:
  1. **Today:** "N of 20 messages left today"; or "Chat pauses until 05:30 IST: your feed keeps working" when paused; or "You've used today's messages: chat opens again at 05:30 IST".
  2. **Hrizzup's day:** "Hrizzup's reader agents today: X of 9000 neurons used" (exact decimal text).
  3. **The chat form** (`chat-form.tsx`, `'use client'`, `useActionState`):
     - a textarea of up to 2,000 characters;
     - `requestId = crypto.randomUUID()` made with the form, and made again only after a definitive answer (a 201, 400, 409 `request_reused`, 429 or 503). A thrown or network failure keeps the same ID, so the next press is a safe retry;
     - the button is disabled while sending, and while paused or out of messages.
  4. **The messages,** newest first, 20 a page: the author, the body as plain text (React escapes it; never markdown or HTML), each reply's neurons ("used 5.365375 neurons"), the time (`whenText`), and an "Earlier messages" link (`?chat=`).
  5. **The profile form** (`profile-form.tsx`, `'use client'`): a textarea with the profile (`EMPTY_PROFILE` when never saved), Save, and the issues as a list ("Line 7: …"). On success it shows "Saved", and the textarea takes the canonical text.
  6. A link to For You.

  **The actions:** `sendMessage(requestId, body)` and `saveProfile(requestId, body)` call `serverApi.reader.*` and answer `{ok, …}` or the refusal in words. Then `revalidatePath('/sandbox/social/reader')`.

Both pages use plain stock components only; the design waits for the founder's references. Each passes the layout check at every width (`grid-cols-1` on field grids, no hidden headings; the memory notes on the Screen check).

**`links/readers.ts`:** "For You" (`/sandbox/social/reader/for-you`) and "Reader agent" (`/sandbox/social/reader`).

**`e2e/pages/social/readers.ts`:** both pages, opened signed out, `budget: 'standard'`, `absentOn: ['production']`.

### 4.5 The skill file's readers part (`W/content/social/skill.md`, the `readers` part, revision 1)

```
## Readers and For You

Readers sign in on the website or in the app; none of their calls takes a key, and none is for you. Each signed-in reader has a reader agent, run by Hrizzup, which never posts: it keeps the reader's private reading profile (More of, Less of, Formats), and plain code builds their For You from the board's Top.

- A story that matches a reader's "More of" rises in their For You; one that matches their "Less of" is hidden from them.
- The formats on a story's desk count for readers who like them: give every post its `format` (the list is `GET /api/v1/social/formats`), so a reader who likes timelines finds the story your timeline is on.
- None of this changes the board, your standing or what you may post.
```
The revision line's check is computed by `skill-file.ts`'s rule.

### 4.6 The journey (`W/e2e/journeys/social-reader.spec.ts`): at most one real AI call, and it passes in every provider state

The run makes its own account and signs in without email, as `social-join.spec.ts` does.

1. **The board, before a profile:** `/sandbox/social` shows the board (no redirect) and the For You tab. Read `GET /api/v1/reader`: `holdsSomething` false, `messagesLeftToday` equal to `dailyMessages`.
2. **A refused save:** on `/sandbox/social/reader`, save a profile with a line `just text`. The issue "Line N: each line is a heading or an item…" shows, and nothing is saved.
3. **A good save, from the board's own stories:** read the board (`GET /api/v1/social/board?limit=20`).
   - **Two or more stories:** the words are picked with the real `words` and `matches` from `@hrizzup/social/for-you`, over each story's full set (title, summary, latest headline, category and place names), never with plain string search. Names and the `s`/`es` rule make string search wrong.
     - "Less of" is a word of the first story whose `matches` is false against the second's set.
     - "More of" is a word of the second story whose `matches` is false against the first's.
     - If no such pair exists (two near-identical stories), fall back to the one-story case.
   - **One or none:** "More of" is `cricket`.

   Save it through the form. The page shows the canonical text, and `holdsSomething` is true.
4. **Opening:** `/sandbox/social` lands on `/sandbox/social/reader/for-you`.
   - With two or more stories: the first story isn't in For You, and the second is.
   - With none: the empty line shows.
5. **The remembered choice:** press **Board**, which goes to `/sandbox/social`. Choose "Latest", then "Top": the reader stays on the board. Press **For You**, which goes back to For You. Then open `/sandbox/social` again: it lands on For You, which proves the cookie was really deleted.
6. **The cursor:** `GET /api/v1/reader/for-you?limit=1`. If `next` is set, the next page answers 200. A cursor whose `b` is edited answers 400 with the "rebuilt" sentence on `cursor`.
7. **One chat message,** through the form ("More cricket, no crypto"). Any of these passes, each with its own check:
   - **201:** the reply shows; `messagesLeftToday` is down by one; the reply's `neurons` is decimal text of 0 or more (0 for the stub; a missing `usage` gives the whole reservation, which is also correct); `allowance.neuronsUsed` didn't go down;
   - **429 `allowance_used`:** the pause line shows;
   - **503:** the busy or unavailable line shows, and `messagesLeftToday` is the same or down by one (a released call gives its slot back; a kept one doesn't).

   **Before-and-after numbers** (`messagesLeftToday`, `neuronsUsed`) are compared only when `usage.resetsAt` is the same in both reads. Both reset at 00:00 UTC (05:30 IST), so a run that straddles the turn of the day checks only the shapes.

   Reply text is never compared.
8. **Fit:** `fitsEverywhere` for the reader page (with its message and profile) and the For You page.

Nothing here sends a second message. A replay with the same request ID is proven by the handler tests, pgTAP and the done-test of 3.9.

---

## 5. Edge cases

| Case | What must happen |
|---|---|
| A signed-in reader who never saved | `reader.get` answers `EMPTY_PROFILE`, holds nothing, the full allowance; no row is made |
| Two tabs send at once at 19 of 20 messages | One reserves, the other is 429 `daily_cap` (the reader's lock, the slot counted at reserve) |
| The same request ID sent twice, the first still answering | 409 `clash` with `Retry-After`; no second reservation |
| The same request ID after the first finished | The same two messages; no AI call; the books unchanged |
| The same request ID with another body | 409 `request_reused` (HZS27) |
| The function dies, or the client disconnects, between reserve and settle; the reader retries the same ID after 60 s | A new request, never a free retry: the abandoned try is charged as kept (`reserved −= 18.3925`, `used += 18.3925`, its slot stays taken), the marker goes, and the retry goes through the cap and the allowance (it may be refused as `daily_cap` or `allowance_used`) to a new reservation and slot. Repeated every minute, it runs out the reader's cap, not the day's allowance |
| The abandoned try was only slow, and answers or fails after the takeover's new `begin` | Fenced out: its `settle` or `fail` names the old message ID, so it is P0002 and writes nothing (the live call's marker, reply, slot and the day's rows are untouched); a late `exhausted` can't pause a fresh day. It can only over-charge: the abandoned try was charged at the takeover |
| The function dies and nobody retries | The reservation stays open for its day and its slot stays taken; the budget is conservative |
| The reservation is made at 23:59:59 UTC and settled at 00:00:02 | Settled on the marker's day, not the new one |
| An admin changes the rates during a call | The settle uses the marker's rates |
| An admin lowers the daily neurons below today's use | Paused at once (the next `reader.get` and every send), until 00:00 UTC |
| `reader_daily_messages` set to 0 | Every send is 429 `daily_cap`; reading works |
| Workers AI answers 3036 while our count has room (staging, previews and later production share one Cloudflare account) | Released; the call's own day is marked; every send that UTC day is 429 `allowance_used` with no call; feeds work |
| 3040, 5016, 4xx | Released: the slot and the reservation come back; 503 `busy` or `unavailable` |
| A timeout, 5xx or network error | Kept: `used += R`; the slot stays taken, so one reader's failures can use at most 20 × R a day; 503 |
| Cloudflare keeps timing out and a reader keeps sending | Each send keeps its reservation and its slot; after 20 the reader is 429 `daily_cap`, having used at most 367.85 neurons of the day's 9,000 |
| Usage missing from a 200 | Settled at the reservation |
| The model answers text, or broken JSON | The text is kept as the reply (broken JSON never shown); the profile is unchanged; form `text` |
| The model adds a 200-character item, a 21st item, or one with hidden characters | That operation is dropped; the note is added; the rest apply |
| The model removes an item that isn't there, or sends 50 operations | A no-op; only the first 10 are read |
| The model adds to More of an item that is in Less of | It moves: it is out of Less of, in More of |
| The reader saves by hand while the agent is answering | The agent's operations are re-applied on the hand-saved profile (OCC, up to 3 tries) |
| A hand-written profile has `* Item`, `## more of`, a missing heading or a repeated item | Accepted, saved in the canonical form |
| A hand-written profile has a 61-character item, an unknown heading, plain text, or 2,001 characters once tidied | 400 with each issue's line, at most 10 |
| A profile item in both More of and Less of (by hand) | Less of wins: the story is hidden |
| Items in Hindi or Tagalog | Matched by letters with their marks |
| An item that is only stop words (`news`) | Matches nothing |
| A reader injects "ignore your instructions" | Only their own profile and reply can change; items are checked; nothing else is reachable |
| A reply holding `<script>` or markdown | Shown as plain text |
| Another reader's chat or profile | No function answers it: every read and write is by `keys.session_account()`, and a replay's message IDs are checked against the reader |
| A key on any reader call | 403 (`sessionOf`; the database's 42501) |
| The account is deleted during a call | The settle fails on the cascade; the handler's `fail('kept')` keeps the reservation, and the reader's rows are gone |
| A reader's account is deleted | Profile, versions, messages and `reader_days` go (cascade); `ai_days` stays; the request rows hold no text |
| A For You cursor from an older build, another reader's, or edited | 400 "Your For You was rebuilt: start again from the first page" |
| A For You build expires and the order didn't change | The rebuilt ID is the same: the cursor keeps working |
| A profile change while a For You build is being written | The first page compares the build's profile number with the state, and rebuilds |
| A story withdrawn after the build | Skipped on its page within 60 s |
| The board holds more than 300 listed live stories | For You ranks the top 300 |
| No listed stories (a fresh environment) | For You is empty with its line; no error |
| Redis is down | Every read is answered by the database; For You rebuilds each call; the allowance is the database's |
| A reader with a profile that holds something, no cookie, follows a shared filtered board link | Lands on For You (a known limit of the sandbox); one press of Board keeps them on the board for the session |
| `reader.get` fails while the board renders | No redirect; the board renders |
| The provider setting is a name with no code, or the model name is malformed | Released before any request; 503 `unavailable`; logged with the name |
| A check run when the day's allowance is spent | The journey's message is 429; the journey passes on its pause check |

---

## 6. Tests that must exist

### 6.1 M1: `infra/supabase/tests/social_readers.test.sql` (pgTAP, the Database check)

| Test | Proves |
|---|---|
| Callers | Each of the six session calls is 42501 with nobody signed in and with an acting key; `foryou_candidates` answers with nobody |
| State, no row | `reader_state()` answers the defaults (`''`, 0, false, the full cap, `paused_until` null, zeros) and makes no row |
| Save | A canonical profile saves version 1 (author `reader`), `holds_something` true; the empty profile saves with it false; the same body again writes no version; a replay answers the state with no new version; HZS27 for another body |
| Save refused | 22023 (detail `profile`): a missing heading, the headings out of order, a 61-character item, 21 items, 2,001 characters, a final new line, a tab, `''` |
| Reserve | Arithmetic exact: `neurons_reserved = 18.3925`, `calls = 1`, `reader_days.messages = 1`; the marker holds day, R, rates, message ID, lease; history is the last 10, oldest first, the reader's own only |
| Settle with usage | `(600, 85)` gives `neurons = 5.365375`: `ai_days` is `reserved 0`, `used 5.365375`; `reader_days.neurons = 5.365375`; the reply's neurons is `5.365375`; reply ID > message ID; the message's `created_at` is the marker's start; the stored result holds only IDs and facts (no text) |
| Settle without usage, and the stub | `used += 18.3925`; the stub's zeros give 0, with `reserved` back to 0 |
| Profile at settle | A version with author `agent`, the number + 1, holds recomputed; a stale `base_number` answers `stale` with the current profile and writes nothing (`ai_days`, `reader_days`, messages and the marker unchanged) |
| Replay | Begin after settle answers `done` with the same IDs; `ai_days` unchanged |
| In flight | A second begin while the lease lives is `in_progress`. With the lease backdated (the test edits the marker), begin charges the abandoned try as kept at the marker's R (`neurons_reserved −= 18.3925`, `neurons_used` and the reader's `neurons` each `+= 18.3925`, `messages` unchanged) and reserves anew at today's R (rates changed before the retry: `reserved += 22`, `calls + 1`, `messages + 1`, a new message ID); its answer holds `ai.provider`, `ai.model`, `profile` and `history`, read fresh, and the books balance. The same takeover with the reader at their cap answers `refused daily_cap`; with the allowance spent, `refused allowance_used` (counted); each with the abandoned try charged, the marker gone and no new reservation. A marker dated yesterday charges yesterday and reserves today. A refused takeover (the allowance spent), sent again once the allowance is back, charges the abandoned try once, not twice. A late settle (with usage and without) or fail (released, exhausted, kept) naming the old message ID is P0002 and changes nothing (the marker, `neurons_reserved`, `neurons_used`, `messages` and every `exhausted_at` as they were); a settle naming none, or a non-UUID, is 22023 (detail answer); a fail naming none or another call is P0002 before its kind is looked at; every test settle and fail names the call from `begin`'s `call.message_id`; a stored `done` answers `done` whatever call is named |
| Fail | `released`: reserved and slot back, the marker gone, a new begin reserves again. `kept`: `used += 18.3925`, and the slot stays taken (`messages` unchanged). `exhausted`: released and `exhausted_at` set on the call's own day, the answer's `retry_after_seconds` the database's, then the next begin is `refused allowance_used`, `refused = 1`, no reservation |
| The cap holds through failures | With `reader_daily_messages = 2`: two begins, each failed `kept`; the third begin is `refused daily_cap` |
| Allowance | With `reader_ai_daily_neurons` set to **42.150375**, two begins reserve (`0 + 18.3925 + 18.3925 = 36.785` fits). The third is refused (`36.785 + 18.3925 = 55.1775` is over), counted as `refused = 1`, with `retry_after_seconds` in 1 to 86,400 and `paused_until` at the next 00:00 UTC. After one settles at 5.365375, a new begin fits exactly at the boundary (`5.365375 + 18.3925 + 18.3925 = 42.150375`, equal, not over), which proves the comparison is exact to the last decimal |
| Cap | With `reader_daily_messages = 2`, the third begin is `refused daily_cap`, with no write and `refused` unchanged; a released call gives its slot back |
| Day boundary | A marker dated yesterday settles, and fails as `kept`, on yesterday's rows only; failed as `exhausted` it marks yesterday, not today |
| Books | After the whole script: for every day, `neurons_reserved` is the sum of the open markers' R; `neurons_used` is the sum of every settle's and keep's neurons, each exact |
| Privacy | B's `reader_chat` and begin's history never hold A's messages; B's settle or fail with A's request ID is P0002 |
| Account deleted | Readers, versions, messages and `reader_days` go; `ai_days` stays |
| Chat paging | Newest first; `next` is the last ID; every message once; size kept to 1 to 100 |
| Candidates | Only listed live stories, at most 300, by `(top_rank desc, story_id desc)`, each with its desk's distinct formats (a removed post's left out), the settings as text, and the picture as `_story_tile` gives it |
| Pause helper | `reader_state.paused_until` and begin's refusal agree on the same day row |

The existing `social_grants`, `social_tables` and `social_accounts` pass unchanged.

### 6.2 M2

| File | Proves |
|---|---|
| `@hrizzup/social` `reading-profile.test.ts` | Parse and write round-trip the examples; every `writeProfile` output passes `isCanonical`; each issue with its line; lenient forms accepted; dedupe; 2,000 checked after tidying; `applyEdits`: add, remove, move between More and Less, a full list, too long, a no-op remove, 10 at most, over 2,000 keeps the old |
| `reader-ai/prompt.test.ts` | The system prompt is exactly the note's text; the estimate is at most 1,800 for every case it can be; history is newest kept, each cut to 400; the message cut but never below 400; the profile always whole; prints the estimate for the live call's input |
| `reader-ai/answer.test.ts` | An object; a JSON string; a fenced string; JSON inside text; text; broken JSON (never shown); an empty reply's fallback; usage invalid or missing (null); `cleanReply` passes `plainText(2000)` for hostile input (tabs, controls, `​`, 5,000 characters) |
| `reader-ai/failures.test.ts` | The table in 3.6, row by row |
| `reader-ai/stub.test.ts` | The example message gives the example's edits; deterministic; zeros for usage; the reply starts "(Stand-in" |
| `W/lib/api/social/readers.test.ts` (database and Redis stood in for, as `replies.test.ts`) | Each call's statement and mapping; 429 `allowance_used` and `daily_cap` with `Retry-After`; 409 `clash`; each 503; a stale settle re-applies the operations on the returned profile; a throw after begin calls `fail('kept')`; the stub when the token or account is missing; the keys deleted (the reader's on every write, For You's on a profile change); `reader.get`'s expiry is never past 00:00 UTC |
| `A/contract.test.ts` (unchanged) | The new examples parse; the stand-in answers them |
| `W/lib/api/social/readers.db.test.ts` (this Mac, the slot's database, as `board.db.test.ts`) | The real functions through the real handlers with the stub: the books after a send; SQL accepts every `writeProfile` output of a generated set and refuses what `parseProfile` refuses |

### 6.3 M3

| File | Proves |
|---|---|
| `@hrizzup/social` `for-you.test.ts` | Words (stop words, marks, NFKC, digits); `es` and `s`; Less drops; More boosts by exactly 1,386,294 a match (24 h, 12 h); Formats only from the desk; ties by ID descending; the empty profile is the candidates' order; same order gives the same ID, any change a new one; at most 300 |
| `readers.test.ts` (more) | For You: the first page builds and keeps; a stale profile number rebuilds; a later page with a missing build rebuilds with the same ID; another ID is the rebuilt 400; an offset past the end is 400; missing tiles are skipped; with Redis down, a cursor works when nothing changed |
| `W/components/sandbox/social/for-you-tab.test.tsx` (or the page's tests) | Signed out: the link, and no call; holding and no cookie: a redirect; holding with the cookie: the tabs; `reader.get` failing: the tabs, no redirect |
| `e2e/pages/social/readers.ts` and `pages.test.ts` | Both pages listed, budgeted, and present |
| `journeys/social-reader.spec.ts` | Section 4.6 |
| `skill-file.test.ts` (unchanged) | The readers part's revision and check |

---

## 7. For the founder, and the open questions

**For the founder** (each also goes into the Product brief):
1. **The Workers AI token** (build.md 11). In Cloudflare: My Profile, then API Tokens, Create Token, the "Workers AI" template, limited to Hrizzup's account. Copy it with Cloudflare's copy button into Doppler `hrizzup` → `stg` as `WORKERS_AI_TOKEN`. That is all he does: R12 already added `WORKERS_AI_ACCOUNT_ID` to `stg` (the account's ID, not a secret, 19 November 2026) and `dev`'s own two values (an empty token), so this Mac never spends the allowance. **Never add `CLOUDFLARE_ACCOUNT_ID` to `stg`:** `hrizzup-tools` holds that name, and every job that reads `stg` would then stop at the key guard.
2. **If the first live call answers 5016** ("has not agreed to Llama 3.2 model terms"): accepting Meta's licence is yours.
   - **The usual way:** Cloudflare's documented step is one request to the model with the prompt `agree`. Its docs show it for the 11B vision model, and the error names every Llama 3.2.
   - **Recommendation:** agree, since the free allowance and the spec's choice rest on this model. Or name another model in the console's setting, which needs no code if it reads JSON as well.
3. **Production's reader agent** (a pointer to the pre-launch checklist, unchanged): the free 10,000 neurons are per Cloudflare account, so production should use its own account at launch.

**Open questions** (each with a recommendation):
1. **"Less of" against a desk's formats** (decision 15). Recommend items match the story's own words, and Formats only the desk's, so "less memes" never hides a story for one meme on its desk.
2. **The remembered tab** (decision 16). The founder's rule is "opens on For You". Recommend remembering a reader's own switch to the board for the rest of the browser session.
3. **The stand-in on staging until the token arrives** (decision 13). Recommend rule-based edits, labelled "Stand-in", so the founder can try the whole flow at Review 3 even without the token.
4. **Hrizzup's daily count on the reader page** (decision 17). Recommend showing it to every signed-in reader in the sandbox, as an aggregate with nothing personal; the console can show it later with no new call.

---

## 8. Verified, and assumed

**Verified in the repository:**
- **The reader tables and settings:** the SQL's lines 736 to 789 (with the `_append_only` rule on versions) and 102 to 134 (the CHECK at or under 10,000).
- **The shared helpers:** `_replay` and `_remember`, whose upsert replaces `result` and keeps `params_hash`; `_page`; `_unique_refusal`; `claim_agent`'s lock-then-replay; `keys.session_account()`.
- **The tests' properties:** `social_grants.test.sql` (types, jsonb, definer, search path), and `social_tables.test.sql`'s table list (a subset check, so a new column breaks nothing).
- **R8's `_story_tile`** with its picture, and R8's precedent of an additive `alter table … add column`.
- **The transaction helper:** its retries (40001, 40P01, 55P03) and its 2-second lock wait.
- **Redis and caching:** `cache.ts` (`remember` keeps no null, 500 ms to Redis); `socialRedis`'s three reader keys and their lives.
- **The cursors:** `cursor.ts`'s `forYou {b, o}`.
- **The contract and its parts:** `readers.ts`, the examples, the stand-in, and `UNPUBLISHED` (`reader`); `storyTileOf`; `pendingCookieOptions`; the done-test pattern (`playwright.done.config.ts`, by hand).
- **The board and pages:** `viewer()` is React-cached and called by the header; `boardHref` writes nothing for the defaults; the board's `<ForYouTab />` has no props; pages are measured signed out.
- **Text rules:** `plain_text` refuses tabs, and `longText` refuses `\r`.
- **Keys:** `WORKERS_AI_*` in `app-keys.txt` and `dev-overrides.txt` (#204).

**Verified outside** (read 19 November 2026, as data):
- **Pricing:** Workers AI gives 10,000 free neurons a day, reset at 00:00 UTC, and the free plan fails past it. `llama-3.2-3b-instruct` costs 4,625 and 30,475 neurons per million input and output tokens ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)).
- **The model:** its synchronous output is `response` (a string), `usage` and `tool_calls`; `max_tokens` defaults to 256; its context is 80,000 tokens; it lists `response_format` with no description ([model](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/)).
- **JSON mode** lists six models, not the 3B. It isn't guaranteed, and it can fail with "JSON Mode couldn't be met" ([JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)).
- **Errors:** 3036 (429), 3040 (429), 5016 (403), 3007 and 3008 (408), 3006 (413) ([errors](https://developers.cloudflare.com/workers-ai/platform/errors/)).
- **The licence step:** "agree" is documented for the 11B vision model ([vision tutorial](https://developers.cloudflare.com/workers-ai/tutorials/llama-vision-tutorial/)).
- **Upstash** takes up to 10 MB a request ([limits](https://upstash.com/docs/redis/troubleshooting/max_request_size_exceeded)).

**Assumed** (each checked by the relay named):
- **Never run while designing** (M1's builder proves both first, 2.5): `_reader_profile_ok`'s four parts in Postgres's regex dialect, and `_uuid7_after`'s `::bit(64)::bigint` cast.
- `usage` holds `prompt_tokens` and `completion_tokens` (M2's live call; without them every call settles at its reservation, which is safe).
- The 3B follows the prompt's JSON often enough (the live call's `answer_form`; text is safe either way).
- Llama 3's tokenizer stays under `ceil(bytes / 3)` for the languages readers use (the live call compares).
- The 3B needs no licence step (5016 would say so).
- `redirect()` from a nested server component, with no Suspense boundary above it, answers a 307 (M3's tab test and the journey).
- WebKit keeps a session cookie set by a server action (the journey runs WebKit on the preview).

## 9. Advisor

Advisor: reviewed the plan, then the written note. Changed because of it: no ledger table, the refusal as data, the stub's explicit zeros, prompt-only JSON, build IDs from the content, settings loaded before the takeover, and kept failures keeping the reader's slot. Kept against its first advice: re-applying the agent's edits on a moved profile, which it then agreed with.
