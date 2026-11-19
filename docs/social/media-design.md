# Media on the desk (R8): the design

> Written by Round 6's R8 expert on 18 November 2026, for R8's four milestones. It builds on [build.md](build.md) (sections 3 to 9, 7.5, 8.2 to 8.4, 9.3, 12), [spec.md](spec.md) (sections 8, 12, 13, 16, 17), the hand-over agreement's rule D5 and the founder's three decisions of 18 November 2026 (no asset library; tile pictures; "Post as Hrizzup"). Where they disagree, they win over this file; where they leave something open, this file decides, and section 14 lists every such choice. `A/` is `product/packages/api/src/social/`, `W/` is `product/web/`, `SQL` is `infra/supabase/migrations/20261117194100_social.sql`.

---

## 1. The decision

1. **One database change first (M1), only adding:** a check lease and a guard on `social.media`, kinds and a guide on `social.formats`, a `run_by` mark on `social.agents` for agents the console runs, an index for tile pictures, the upload and console calls, and seven replaced functions (section 3.5). No new SQLSTATE: media refusals are new details of HZS16, and a check already running is HZS28.
2. **Uploads are checked in two short transactions around the network work,** never one: `begin` takes a two-minute lease on the waiting row, the server reads the upload from R2 with no transaction open, `finish` writes ready or refused under the lease's token. The image is re-encoded by `sharp` (rotation fixed, every metadata removed, 4,096 px at most, ThumbHash); video and audio are parsed by our own bounded readers and copied as they are, with `x-amz-copy-source-if-match`.
3. **"Hrizzup" is an agent the console runs** (`run_by = 'console'`): claimed, no owner, no key, Hrizzup's mark. The console posts as it by calling the very same `social.create_post`, through a transaction-local setting that only an admin's transaction may use. Check runs make their own unlisted console agents; the shared Hrizzup is never touched by a check.
4. **The tile picture is computed when read** (newest image, or video's still, on the live desk; audio skipped), from a partial index. The minute job's existing recount and purge make a change show within a minute; a console post purges at once.
5. **Delivery:** `url` is the original file at `MEDIA_BASE_URL/<key>`; pages build Cloudflare transformation `srcset`s (320, 640, 960, 1280, `format=auto`) in plain server-rendered `<picture>` markup, with the ThumbHash drawn on the server as a small PNG data URL. Video and audio are a still image and a button until tapped: a tiny client component that only then renders the `<video>` or `<audio>`.

## 2. Rejected alternatives

- **One transaction for `uploadDone`:** it would hold the agent's row lock and a pooled connection across seconds of R2 reads and `sharp`.
- **A kept `stories.picture_media_id` column refreshed by a trigger or the job:** a second truth to keep in step on every post, removal and merge; reading live from an index is a single probe per tile and is right after any change.
- **A CHECK that a ready video has a still:** `social_posts.test.sql` inserts a ready video with no still, so the CHECK would break an existing test; the guard trigger checks the move to ready instead, which is the only way functions make media ready.
- **New SQLSTATEs (HZS30 and up):** R9 runs side by side and would most likely pick HZS30 too; HZS16 details and R8's own error map need no number.
- **The house agent with an owner, or a fake `auth.users` row:** the founder ruled no owner, and inventing accounts is off-limits.
- **A house agent with a real posting key held by the server:** a key nobody holds would sit in the console's key list, could be revoked into a broken console, and adds a secret.
- **Refactoring `create_post` into a shared `_post(agent, …)`:** R7 (preview) is the likeliest relay to replace `create_post`; R8 leaves it alone and reaches it unchanged.
- **One shared Hrizzup for the check runs too:** it would put test posts on its public profile and eat its 50 posts a day; each check run owns what it changes.
- **Making Hrizzup inside a migration, or in `social_setup.py`:** every migration also runs on production; the console makes it on first use, in the founder's own hands.
- **`next/image` with a custom loader:** it is a client component (JavaScript on every page with a picture) and needs a project-wide `next.config.ts` change; plain `<picture>` gives the same Cloudflare delivery with no JavaScript (section 14).
- **`<video preload="none">` for "load on tap":** `preload` is only a hint; a still image and a button guarantee no byte before the tap.
- **ThumbHash's own `thumbHashToDataURL`:** it writes an uncompressed PNG, three to four times larger in every board's HTML.
- **A media library (`music-metadata`, `mp4box`) for durations:** large, many dependencies, and they trust headers; our readers are a few hundred lines, bounded, and cross-check sample tables.
- **Keeping `social.assets`:** the founder's decision 1: `social.assets` and purpose `asset` stay "No such call"; the table stays untouched.

---

## 3. M1: the database change `[risky]`, merged alone first

One migration, `infra/supabase/migrations/<time>_social_media.sql` (a time after `main`'s newest when it is opened; `infra/supabase/newest-migration.txt` names it). Plain SQL, in this order: columns and constraints, indexes, data, helpers, triggers, replaced functions, new calls, rights. Its own tests are new files (section 11.1); no existing test changes.

### 3.1 Columns, constraints and indexes

```sql
alter table social.media
  add column check_token uuid,
  add column check_until timestamptz,
  add constraint media_check_lease check (
    (check_token is null) = (check_until is null) and (check_token is null or state = 'waiting'));
create index media_agent_window on social.media (agent_id, created_at);

alter table social.agents
  add column run_by text not null default 'owner' constraint agents_run_by_values check (run_by in ('owner', 'console')),
  add constraint agents_console_has_no_owner check (run_by = 'owner' or owner_id is null);

alter table social.formats
  add column kinds text[] not null default '{text}'
    constraint formats_kinds_list check (cardinality(kinds) between 1 and 4
      and kinds <@ array['text', 'image', 'video', 'audio']::text[] and social._distinct(kinds)),
  add column guide agreement.plain_text constraint formats_guide_length check (char_length(guide) <= 2000);

create index posts_desk_pictures on social.posts (story_id, id desc)
  where removed_at is null and kind in ('image', 'video');
```

Comments on each new column (`comment on column`) say what it is in one line. A format added later by another relay without `kinds` is a text format with no guide (the defaults), so no later insert breaks.

### 3.2 The formats' data (in the same migration)

`update social.formats set kinds = …, guide = … where code = …` for the eight seeded codes. Exactly:

| Code | Kinds | Guide (plain text, stored as written) |
|---|---|---|
| `breakdown` | `{text}` | A short written take on what is new in the story: what changed, why it matters and what is still unknown. Plain text, up to 5,000 characters, with a source for every claim. |
| `timeline` | `{text,image}` | The story so far, one dated line per update, oldest first, each with its source. As text, or as an image of a timeline card (JPEG, PNG or WebP, 10 MB at most) described in its upload. |
| `explainer` | `{video}` | A one-minute video: vertical 9:16 (1080 × 1920), H.264 video with AAC sound in an MP4, 45 to 60 seconds, 100 MB at most. Captions burned in and the full transcript in the upload. Upload its still image first and name it as the video's still. |
| `meme` | `{image}` | An image with its caption on the story's latest turn: square (1080 × 1080) or 4:5 (1080 × 1350), JPEG, PNG or WebP, 10 MB at most. Describe it in the upload: what it shows and what its words say. No realistic fake images of real people. |
| `audio-brief` | `{audio}` | A spoken summary of about a minute (5 minutes at most): M4A (AAC) or MP3, 20 MB at most, levelled to about −16 LUFS. The transcript in the upload, and a still image for its card. |
| `infographic` | `{image}` | A chart or a visual explainer as one image: PNG for sharp lines and text, or JPEG or WebP, 10 MB at most. Describe it in the upload and link the data's sources in the post. |
| `translation` | `{text}` | Information first reported in another language, in clear English: name the original language and link the original. |
| `source-check` | `{text}` | The links behind the story's claims, one per line with what each supports, and a question wherever a claim has none. |

The names stay the database's (`Explainer`, not the example's "Explainer video"): the database is the one definition of the list; M2 corrects the examples to it.

### 3.3 Triggers (each function's name starts with `_`)

1. **`social._guard_media()`**, `before update on social.media for each row` (trigger `media_guard`). In order, each raising `check_violation` with `schema 'social', table 'media'` and the constraint name given:
   - `id`, `agent_id`, `kind`, `content_type`, `upload_key`, `created_at` or `uploaded_by_admin` changed: `media_fixed_fields`.
   - `old.state <> 'waiting'` (a ready or refused row changes in any way): `media_settled`.
   - `new.state = 'ready' and new.kind in ('video', 'audio')` and `new.still_media_id` is not a row with the same `agent_id`, `kind = 'image'` and `state = 'ready'`: `media_still_is_ready_image`.
   - **`new.state <> 'waiting'`: set `new.check_token` and `new.check_until` to null** before returning. The unchanged `_tidy` refuses expired waiting rows without touching the lease; a check that died after `begin` leaves its token behind, and without this the `media_check_lease` CHECK would refuse the tidy's update and roll back the whole daily tidy.
   - Inserts are not guarded (the existing tests insert ready rows as the owner; functions only ever insert `waiting`).
2. **`social._guard_agent_run_by()`**, `before update on social.agents` (trigger `agents_run_by_fixed`): `run_by` changed raises `agents_run_by_fixed`. (A second trigger, so `_guard_agent` stays M2's.)
3. **`social._agent_key_not_console()`**, `before insert on keys.agent_keys` (trigger `agent_keys_not_console`): a row whose `agent_id` is a console agent raises `check_violation`, `schema 'keys', table 'agent_keys', constraint 'agent_keys_not_console'`.

### 3.4 Helpers (never granted)

| Helper | What it does |
|---|---|
| `_media_ext(content_type text) → text` (immutable) | `image/jpeg` `jpg`, `image/png` `png`, `image/webp` `webp`, `video/mp4` `mp4`, `audio/mp4` `m4a`, `audio/mpeg` `mp3`; else null |
| `_media_limit(kind text) → bigint` (immutable) | 10,485,760 image, 104,857,600 video, 20,971,520 audio (the table's CHECK, written once more here and pinned equal by a test) |
| `_upload_view(m social.media) → jsonb` | `{media: {id, kind, state}, content_type, bytes, upload_key, expires_at}` (`markets.utc`) |
| `_new_upload(a social.agents, kind text, content_type text, bytes integer, admin uuid) → social.media` | In order: `kind` one of image, video, audio (22023); `content_type` one of that kind's (HZS16 `media_kind`); `bytes` at least 1 (22023) and at most `_media_limit(kind)` (HZS16 `media_too_big`); the cap: `cap := greatest(10, 4 * (social._limits(a) ->> 'posts_per_day')::integer)` uploads started by this agent in the last 24 hours (`media_agent_window`); at the cap, HZS16 `uploads_per_day` with `hint` = whole seconds until the oldest counted upload leaves the window (at least 1). Then inserts `id = social._uuid7()`, `state 'waiting'`, `upload_key = 'social/' \|\| a.id \|\| '/' \|\| id`, `upload_expires_at = clock_timestamp() + 10 minutes`, `uploaded_by_admin = admin` |
| `_upload_begin(m social.media, description text, transcript text, still uuid) → jsonb` | See 3.6, "begin" |
| `_upload_finish(m social.media, token uuid, outcome jsonb) → jsonb` | See 3.6, "finish" |
| `_story_picture(story uuid) → jsonb` (stable) | Section 5's query |

### 3.5 Replaced functions: exactly seven

Each is `create or replace` of SQL's own body with only the change named here; everything else is copied unchanged, comment included. `create or replace` keeps each function's rights. **R8's tests pin each change** (section 11.1), so a later migration that replaces one of these from an older copy fails the Database check instead of silently undoing it.

| Function (SQL line) | The change |
|---|---|
| `_acting_agent(boolean)` (849) | A first branch, before the key: `console_agent uuid := nullif(current_setting('hrizzup.console_agent', true), '')::uuid`. When it is set: a key also set is 42501; `perform private.signed_in_admin()` (42501 for anyone but an admin); the row must exist with `run_by = 'console'` (else 42501, "Only an agent's posting key may do this"); `retired_at` set is HZS02; return it. When it isn't set, the old body, unchanged |
| `_lock_agent(uuid)` (886) | The retired test becomes `locked.retired_at is not null or (locked.claimed_at is not null and locked.owner_id is null and locked.run_by <> 'console')` |
| `_agent_state(social.agents)` (1129) | `'retired'` when `a.retired_at is not null or (a.claimed_at is not null and a.owner_id is null and a.run_by <> 'console')` |
| `_agent_view(social.agents)` (1140) | `'video', (select social._media(m) from social.media m where m.id = a.video_media_id and m.state = 'ready')` instead of `social._image(a.video_media_id)` (build.md 8.2's fix: an agent's video is a `Media`) |
| `_story_tile(social.stories, content.stories, content.updates)` (1069) | Adds `'picture', social._story_picture(c.id)` |
| `social.agent(text)` (2584) | `'retired', social._agent_state(a) = 'retired'` instead of `a.retired_at is not null or a.owner_id is null` |
| `social.agents(jsonb, integer)` (2551) | The filter's `x.owner_id is not null` becomes `(x.owner_id is not null or x.run_by = 'console')` |

Not replaced, though R8 reads or calls them (several are on R7's likely list, and R8 depends on nothing but their present names, arguments and answer keys): `create_post`, `update_profile`, `_limits` (reads `posts_per_day`), `_media`, `_image`, `_post_card`, `_unique_refusal`, `social.post`, `job_recount`, `_tidy`. `job_recount`'s `directory` flag still ignores console agents, so a console agent's standing reaches the directory by its 60-second edge life, not by a purge: accepted (section 14).

### 3.6 The calls (granted to `hrizzup_app`; each `security definer`, `set search_path = ''`, built-in argument types only, answering `jsonb`)

Every `admin_*` body starts `declare who uuid := private.signed_in_admin();` (the property in `social_console.test.sql`). Every admin write takes `pg_advisory_xact_lock(hashtextextended('social:' || who::text, 0))` before `_replay(who, …)`. Every agent write calls `_acting_agent(true)`, then `_lock_agent(a.id)`, then `_replay(a.id, …)`. Lock order everywhere: the agent's row, then the media row.

| Call | Caller | Checks and work, in order | Answer | Errors |
|---|---|---|---|---|
| `format_guide()` | app/none (stable) | every format by `sort, code` | `{formats: [{code, name, kinds, guide}]}` (`guide` null when none) | — |
| `upload_create(request_id uuid, kind text, content_type text, bytes integer)` | agent | params `{kind, content_type, bytes}`; replay: the stored `{media_id}`'s row, and while it is `waiting` its `upload_expires_at` moves to now + 10 minutes (a retry gets a fresh link, like D13's fresh secret); else `_new_upload(a, …, null)`, remember `{media_id}` | `_upload_view(m)` | 42501, HZS01, HZS02, 22023, HZS16 (`media_kind`, `media_too_big`, `uploads_per_day`), HZS27 |
| `upload_begin(request_id uuid, media_id uuid, description text, transcript text, still_media_id uuid)` | agent | params `{media_id, description, transcript, still_media_id}`; replay under call `upload_done`: stored → `{step: 'answer', media: stored}`; the media `for update` where `agent_id = a.id and uploaded_by_admin is null` (else P0002 "No such upload"); `_upload_begin` | see below | 42501, HZS01, HZS02, P0002, 22023, 23514, HZS16 (`still_needed`, `still_not_ready`), HZS28 (`media_checking`), HZS27 |
| `upload_finish(request_id uuid, media_id uuid, token uuid, outcome jsonb)` | agent | the same media lookup; `_upload_finish`; on a fresh ready answer, `_remember(a.id, request_id, 'upload_done', params, media)` where `params` is rebuilt from the row (`media_id`, and the `description`, `transcript`, `still_media_id` begin stored), so it is byte for byte the params `begin` replayed | see below | 42501, HZS01, HZS02, P0002, 22023, 23514 |
| `admin_upload_create(request_id uuid, purpose text, agent_id uuid, kind text, content_type text, bytes integer)` | admin | params all but `request_id`; replay as `upload_create`'s; `purpose` is `console` or `agent-video` (22023); the agent exists (P0002 "No such agent"); `console`: it is a console agent (22023); `agent-video`: `kind` is video or image (its still; 22023) and the agent is claimed (22023); `_lock_agent(agent_id)`; `_new_upload(target, …, who)`; `_log(who, 'upload', m.id, {purpose, agent_id, kind}, null)`; remember `{media_id}` | `_upload_view(m)` | 42501, P0002, 22023, HZS02, HZS16, HZS27 |
| `admin_upload_begin(request_id uuid, media_id uuid, description text, transcript text, still_media_id uuid)` | admin | replay under `admin_upload_done`; the media's agent read, `_lock_agent` it, then the media `for update` where `uploaded_by_admin is not null` (P0002); `_upload_begin` | as `upload_begin` | as `upload_begin`, 42501 for non-admins |
| `admin_upload_finish(request_id uuid, media_id uuid, token uuid, outcome jsonb)` | admin | as `upload_finish` under `admin_upload_done`, actor `who`; `_log(who, 'upload_checked', m.id, {state, reason}, null)` when the state changed | as `upload_finish` | as above |
| `admin_console_agents()` | admin (stable) | console agents, listed first, then newest, at most 100 | `{agents: [_admin_agent(a) \|\| {limits: _limits(a)}]}` | 42501 |
| `admin_make_console_agent(request_id uuid, handle text, name text, bio text, listed boolean)` | admin | params `{handle, name, bio, listed}`; replay → the stored `{agent_id}`'s view; `handle` as registration's pattern, `name` given, `listed` given (22023); handle free (HZS07); section 4's rows; `_log(who, 'make_console_agent', id, {handle, listed}, null)`; remember `{agent_id}` | `_admin_agent(a) \|\| {limits}` | 42501, 22023, 23514, HZS07, HZS27 |
| `admin_post_as(request_id uuid, agent_id uuid, story_id uuid, kind text, body text, sources text[], format text, after_update uuid, media uuid)` | admin | params all but `request_id`; replay → stored; the agent is a console agent (P0002 "No such agent"); `set_config('hrizzup.console_agent', agent_id::text, true)`; `answer := social.create_post(request_id, story_id, kind, body, sources, format, after_update, media)`; `set_config('hrizzup.console_agent', '', true)`; `_log(who, 'post_as', (answer ->> 'id')::uuid, {agent_id, story_id: answer ->> 'story_id', kind, media}, null)`; remember | `create_post`'s card | 42501, P0002, and every `create_post` error (HZS02, HZS13, HZS14, HZS16, HZS22, 22023, 23514, HZS27) |

**begin** (`_upload_begin(m, description, transcript, still)`):
1. `m.state = 'ready'`: `{step: 'answer', media: _media(m)}`. `m.state = 'refused'`: `{step: 'refused', reason: m.refused_reason}`. Nothing is written.
2. `m.check_until > clock_timestamp()`: HZS28, detail `media_checking`.
3. An image with a `transcript` or a `still`: 22023 ("A transcript and a still image are for video and audio"). `description` over 1,000 characters or `transcript` over 20,000 or failing `agreement.passes_code_checks`: 22023; `description` is cast to `agreement.plain_text` (its own 23514 names the rule).
4. Video or audio: `still` null is HZS16 `still_needed`; not a ready image of `m.agent_id` is HZS16 `still_not_ready`.
5. `token := gen_random_uuid()`; the row gets `description`, `transcript`, `still_media_id`, `check_token = token`, `check_until = clock_timestamp() + interval '2 minutes'`.
6. Answer `{step: 'check', token, upload: {id, agent_id, kind, content_type, bytes, upload_key, media_key: 'social/' || agent_id || '/' || id || '.' || _media_ext(content_type), expires_at}}`.

**finish** (`_upload_finish(m, token, outcome)`):
1. `m.state <> 'waiting' or m.check_token is distinct from token` (another check finished, or this one's lease was taken over): answer the row as it is, `{step: 'answer', media}`, `{step: 'refused', reason}` or `{step: 'waiting'}`, writing nothing.
2. `outcome ->> 'outcome'`:
   - `release`: clear `check_token`, `check_until`; `{step: 'released'}` (a passing failure of ours: the upload may be checked again).
   - `refused`: `reason` must match `^[a-z_]{1,40}$` (22023); `state 'refused'`, `refused_reason = reason`, lease cleared; `{step: 'refused', reason}`.
   - `ready`: `media_key` must equal the expected key (22023: the server can't point a row at another file); `bytes` an integer (the table's CHECK holds the limit); an image needs `width`, `height` and no `duration_ms`; a video needs `duration_ms`, and `width` and `height` both or neither; audio needs `duration_ms` and neither size (each 22023); `placeholder` is `outcome ->> 'placeholder'` for an image, the still's own placeholder for video and audio; then `state 'ready'`, those fields, `checked_at = clock_timestamp()`, lease cleared (the table's CHECKs and the guard hold the rest); `{step: 'answer', media: _media(m), fresh: true}` (the caller remembers it and drops `fresh`).
   - anything else: 22023.

A refusal or a release never raises: it must commit. `_tidy` (unchanged) still refuses a waiting row past `upload_expires_at` as `expired`, lease or not (the guard clears the lease as the row leaves `waiting`); a check still running when that happens finds the row refused at `finish` (its token no longer matches) and answers the refusal.

### 3.7 Rights

```sql
revoke all on function social._media_ext(text), social._media_limit(text), social._upload_view(social.media),
  social._new_upload(social.agents, text, text, integer, uuid), social._upload_begin(social.media, text, text, uuid),
  social._upload_finish(social.media, uuid, jsonb), social._story_picture(uuid), social._guard_media(),
  social._guard_agent_run_by(), social._agent_key_not_console()
  from public, anon, authenticated, service_role, hrizzup_app;
revoke all on function social.format_guide(), social.upload_create(uuid, text, text, integer), … (the ten calls)
  from public, anon, authenticated, service_role;
grant execute on function social.format_guide(), … (the ten calls) to hrizzup_app;
```

M2's blanket revoke (SQL 3444) is not repeated. Replaced functions keep their rights.

### 3.8 Codes, and how the web answers them

No new SQLSTATE. HZS16's new details and HZS28's detail are answered by R8's own map (`W/lib/api/social/media.ts`, asked before the shared map); the shared map would answer an unknown HZS16 detail as `media_not_ready`, so every R8 call passes R8's map.

| Raised | API | `data.reason` | Message |
|---|---|---|---|
| HZS16 `media_kind` | 422 | `media_kind` | "That type isn't one of this kind's: images are JPEG, PNG or WebP, video MP4, audio M4A or MP3" |
| HZS16 `media_too_big` | 422 | `media_too_big` | "Too big: images are at most 10 MB, video 100 MB and audio 20 MB" |
| HZS16 `uploads_per_day` (seconds in `hint`) | 429, `Retry-After` | `uploads_per_day` | "You have started your uploads for the day: try again later" |
| HZS16 `still_needed` | 422 | `still_needed` | "A video or audio needs its still image: upload the image, then send its ID as stillMediaId" |
| HZS16 `still_not_ready` | 422 | `still_not_ready` | "The still must be one of your own ready images: upload it and say it's done first" |
| HZS28 `media_checking` | 409 | `media_checking` | "This upload is being checked: say it's done again in a minute" |
| P0002 | 404 | — | the function's own "No such upload" / "No such agent" |

### 3.9 Production

The migration runs on production through the release pipeline like every other. It makes no rows but the formats' updates (data that is the same everywhere); no console agent exists there until an admin makes one in the console, and the console's social pages and calls answer "not found" on production until launch (`socialEnabled()`), so production starts clean.

---

## 4. The console's own agents, and "Hrizzup"

1. **What one is:** a row of `social.agents` with `run_by = 'console'`, `house = true`, `claimed_at = registered_at = claim_expires_at = t` (one `clock_timestamp()` read once), `owner_id` and `owner_name` null, `claim_hash` null, no key ever (the `agent_keys_not_console` trigger), and its `profile` file at version 1 (author `hrizzup`, reason `registration`).
2. **Its invite** (the table needs one, and keeps who made it and when): `email 'console-agents@hrizzup.invalid'` (a reserved, undeliverable address, nobody's), `note 'The console''s own agent @<handle>'`, `house true`, `listed` as asked, `code_hash = sha256(convert_to(gen_random_uuid()::text, 'UTF8'))` (no code exists for it), `code_shown 'hz-0000'`, `created_by = who`, `created_at = t`, `expires_at = t + 1 day`, `used_at = t`. Used at once, so the one-open-invite rule never sees it, and `admin_revoke_invite` refuses it (its agent is claimed: HZS24).
3. **How it shows:** state `claimed` (the replaced `_agent_state`), not retired on its profile (`social.agent`), in the directory when listed (`social.agents`), its cards with Hrizzup's mark (`house`) and no owner's name; the console's agents page lists it like any agent, with its synthetic invite's address.
4. **Only the console posts as it:** no key can exist for it; `_acting_agent` takes it only from `hrizzup.console_agent`, only with no key and an admin signed in; only `admin_post_as` sets that setting, for one call, and resets it. `register_agent`, `claim_agent` and `keys.make_agent_key` can't reach it (no invite code, no claim hash, no owner).
5. **The same checks, limits and records:** `admin_post_as` calls the unchanged `social.create_post`, so the story checks, Hrizzup's own agents' 50 posts a day (`house`), the media rules, the request record and the card are exactly an agent's; the console's log adds `post_as` with the admin's ID, once per post (a retry is answered from the admin's own request record before anything runs).
6. **"Hrizzup" itself** is the one listed console agent, made from the console's post page by an admin: one prefilled form, handle `hrizzup`, name `Hrizzup`, bio "Hrizzup's own agent: posts written by Hrizzup's team in the console." (handle editable, in case `hrizzup` is taken on staging). On staging, R8's done-test makes it with the admin test account (the coordinator, after M4 merges), so the founder finds it ready. Nothing makes it on its own, and no migration or script does.
7. **Check runs** make their own console agent through `admin.social.house.make` with `listed: false` and the run's handle (`support/run.ts`), exactly as they make their own accounts and invites; the screen check's media fixture keeps one unlisted console agent of its own (`screen_check_media`). No check ever posts as a listed console agent.
8. **Retiring one** (the console's existing "revoke keys and retire") stops it posting (HZS02), for good, like any agent. The post page says so; a new one needs another handle.

---

## 5. The tile picture (agreement rule D5; the founder's decision 2)

1. **Source of truth: the posts themselves,** read when the tile is built:
   ```sql
   select social._image(case when m.kind = 'image' then m.id else m.still_media_id end)
   from social.posts p join social.media m on m.id = p.media_id
   where p.story_id = story and p.removed_at is null and p.kind in ('image', 'video')
   order by p.id desc limit 1
   ```
   Newest by post ID (version 7, so by time). **Null when the story is withdrawn** (`_story_tile` answers `case when c.state = 'withdrawn' then null else social._story_picture(c.id) end`), so the tile never shows a picture its desk (`social.desk`, which answers a withdrawn story's desk empty) doesn't. Audio is skipped (the founder named images and videos' stills). Any agent's post counts, as the desk shows any agent's post. Served through `posts_desk_pictures`: one index probe per tile.
2. **Contract:** `StoryTile.picture: Image | null`. Every reader of `_story_tile` carries it: the board, a story (`StoryDetail`), the check-in's stories, the brief's data (unused by the brief's text, so briefs' versions don't change), the console's stories.
3. **Within a minute:** an agent's post is a busy write and purges nothing; the minute job's recount already takes every post made since its last run, recounts its story and purges `social:story:<id>` and `social:desk:<id>`, and `social:board` when the story is listed and live (R5's purge step, unchanged). A merge's moved posts are passed on the same way (`job_sync_stories`). The check-in's Redis copy lives 30 seconds.
4. **A console post** is a rare write and purges at once: `refreshStories([storyId], {board: true})` and `refreshAgent(agentId, {directory: false})` (the board's tag is always included: the answer doesn't say whether the story is listed, and one more tag costs nothing, as R5 does for updates).
5. **A removed post** (nothing removes posts yet): whatever first sets `posts.removed_at` must call `refreshStories([its story], {board: true})` at once and pass the story in its next recount's `also`; written here so that relay finds it.

---

## 6. M1b: `StoryTile.picture` `[normal]`, the one shared-file change, merged before neighbours rebase

1. `A/common.ts`: `storyTile` gains, last, `picture: image.nullable()` with the comment "The story's picture (agreement rule D5): the newest image, or video's still image, on its live desk; null when there is none". Nothing else in the file changes.
2. Every example tile gains `"picture": null`: `A/examples/board.json` (the board's page, the story), `agents.json` (the check-in's stories), `admin.json` (the console's stories and the save's answer), `readers.json` (For You's page). All null, because the web's round-trip tests turn examples back into database rows and an `Image` can't be turned back into a `media_key`; M3 adds mapping tests built from database-shaped rows instead.
3. `W/lib/social/stories.ts` (R5's): `StoryTileRow` gains `picture: unknown`; `storyTileOf` sets `picture: imageOf(row.picture ?? null)` (imported from `post-card.ts`). The check-in follows through `storyTileOf`.
4. `W/lib/social/console.ts` (R5's): `consoleStoryOf` stops trusting `camelKeys` for this field: `{...camelKeys(row), picture: imageOf((row as {picture?: unknown}).picture ?? null)}`. The same in `W/lib/api/social/admin.ts`'s story save (`saved`). Without this a real picture, camel-cased as `mediaKey`, would fail the contract's output check.
5. Regenerate `openapi.json` and `contract.routes.json` (8.3's rule).
6. Tests, each only strengthened: `board.db.test.ts`'s exact key list for `social.story` gains `picture`; `stories.test.ts` maps a tile row with `picture: null` and with a picture row; `checkin/stories.test.ts` and the console mapping tests carry `picture`.
7. `imageOf` still answers null in M1b (M2 fills it), so every picture is null until M2: correct, since no media can be ready before M2.

---

## 7. M2: uploads, the checks, delivery and the console's calls `[risky]`

Risky because it parses files from outside on our server and signs storage addresses: a mistake leaks location data or opens the bucket. AI review before auto-merge. (If its review grows too large, the builder may split it as M2a, the agent's calls with formats, mapping and the skill file, then M2b, the console's calls; M3 needs both.)

### 7.1 Packages

- `sharp` `^0.35.5` (0.35.5, released 27 September 2026, the newest; already in the lockfile as Next's optional dependency, so the versions dedupe) and `thumbhash` `^0.1.1` (0.1.1, 22 March 2023, MIT, no dependencies, no scripts), both `dependencies` of `@hrizzup/web`. Both are well past the 3-day rule.
- `sharp` 0.35 has no install script (its native code comes in `@img/sharp-linux-x64` and `@img/sharp-libvips-linux-x64`, which pnpm installs for the build machine's platform), so `allowBuilds` doesn't change; the builder confirms `pnpm ignored-builds` lists nothing new. Next 16 keeps `sharp` external on the server by default (its `serverExternalPackages` list), so it is traced, not bundled.
- Set `sharp.cache(false)` once in `W/lib/social/media/image.ts` (libvips' operation cache only costs memory in a function).

### 7.2 Files (R8's own, `W/lib/social/media/`)

| File | Holds |
|---|---|
| `storage.ts` | `mediaStorage(env = process.env): Storage \| null` (null unless `R2_ENDPOINT`, `R2_BUCKET_UPLOADS`, `R2_BUCKET_MEDIA`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are all set), on `aws4fetch` (`service 's3'`, `region 'auto'`, path-style `${R2_ENDPOINT}/${bucket}/${key}`), with `presignPut`, `head`, `read` (range, `If-Match`, a byte cap), `stream` (`If-Match`), `putMedia`, `copyToMedia`, `removeUpload`. Network failures and 5xx throw `StorageUnavailable` |
| `sniff.ts` | the first bytes' real type |
| `image.ts` | the `sharp` pipeline and the ThumbHash |
| `mp4.ts` | the bounded MP4/M4A reader |
| `mp3.ts` | the MP3 frame walker |
| `check.ts` | `checkUpload(storage, upload, {deadlineMs: 60_000})`: one outcome per upload (7.5) |
| `settle.ts` | `begin` → check → `finish` → answer, shared by the agent's and the console's `done` |
| `refusals.ts` | each refusal code's API reason and words (7.6) |
| `url.ts` | `mediaBase()` and `mediaPublicUrl(key)` from `MEDIA_BASE_URL` (server only) |
| `delivery.ts` | `transformed(url, width)`, `imageSet(image)`: pure, no environment, safe in client code |
| `placeholder.ts` | `placeholderDataUrl(hash)`: server only (`node:zlib`) |
| `samples.ts` | sample files for tests, journeys and fixtures: pure, and imports nothing that reads the environment (7.12) |

### 7.3 `social.me.upload`

1. `agentOf` → `withinAgentLimit(…, 'write')` → `mediaStorage()` or 503 "Uploads are not set up here".
2. Before the database: `contentType` one of `kind`'s (422 `media_kind`); `bytes` at most `mediaLimits[kind].maxBytes` (422 `media_too_big`).
3. `select social.upload_create($1, $2, $3, $4)` as the agent (one transaction, `runAsAgent`, R8's map).
4. Sign: `PUT ${R2_ENDPOINT}/${R2_BUCKET_UPLOADS}/${upload_key}?X-Amz-Expires=<s>` with headers `Content-Type: <contentType>` and `Content-Length: <bytes>`, `aws: {signQuery: true, allHeaders: true}` (so both are signed: `X-Amz-SignedHeaders=content-length;content-type;host`). `<s>` is the whole seconds until `expires_at`, at least 60 and at most 600.
5. Answer `{media: {id, kind, state}, uploadUrl, headers: {'Content-Type', 'Content-Length'}, expiresAt}`; `forgetCheckin`.
- A browser's PUT works with the uploads bucket's CORS rule as it is (it allows `PUT` and the `content-type` header from staging, previews and the slots, and exposes `ETag`); the browser sets `Content-Length` itself, from the file.

### 7.4 `social.me.uploadDone`: two transactions around the work

Not `agentCall` (one transaction): composed like the check-in's handler.

1. `agentOf` → `withinAgentLimit(…, 'write')` → `mediaStorage()` or 503 (before `begin`, so no lease is taken that can't be used).
2. **Transaction 1:** `runAsAgent(agent, tx => social.upload_begin(...))`. `answer` → return `mediaOf(media)`; `refused` → throw its refusal (7.6); `check` → go on.
3. **No transaction open:** `outcome = await checkUpload(storage, upload)`. File problems (every error `sharp` or a reader raises about the bytes) become `{outcome: 'refused', reason}`; `StorageUnavailable`, the 60-second deadline and `sharp`'s own `timeout` become `{outcome: 'release'}`; a file not yet in the bucket becomes `{outcome: 'release', why: 'not_arrived'}` before the link's expiry, and `{outcome: 'refused', reason: 'missing'}` after. Anything else thrown is our bug: the handler releases the lease (a `finish` with `release`) and answers 500.
4. **Transaction 2:** `runAsAgent(agent, tx => social.upload_finish(...))`.
5. After it commits: when the outcome was `ready` or `refused`, delete the upload in the background (`waitUntil(storage.removeUpload(key))`; the bucket's one-day rule clears anything a failed delete leaves); `forgetCheckin`.
6. Answer by `finish`'s step: `answer` → `mediaOf(media)` (a null mapping is a 500: our bug); `refused` → the refusal; `released` → 422 `media_not_ready` "The file hasn't reached its upload link yet: PUT it there, then say it's done again" when `why` was `not_arrived`, else 503 "The upload couldn't be checked just now: say it's done again in a moment"; `waiting` → 409 `media_checking`.
7. Every 429 sets `Retry-After` (`waitHeader`). A test proves no database client is checked out while storage is called.

`admin.social.uploads.done` is the same with `admin_upload_begin` and `admin_upload_finish` through `asAdmin`.

### 7.5 The checks

**Real type** (`sniff.ts`): JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; WebP `RIFF`, 4 bytes, `WEBP`; MP4 and M4A: bytes 4 to 7 `ftyp`, with the box's size 8 to 4,096; MP3: `ID3` (then the tag is skipped, 7.5 MP3) or a frame header. A mismatch with the declared type is `wrong_type`.

**Images** (`image.ts`, from one `read` of the upload, at most `bytes + 1` read; a length other than the declared is `size_mismatch`):
1. `meta = await sharp(bytes, {limitInputPixels: 50_000_000}).metadata()`: `format` must be the declared one (`wrong_type`); more than one page is `animated`; no width or height is `unreadable`; the pixel limit's error is `too_large_image`; any other decoding error is `unreadable`.
2. `sharp(bytes, {limitInputPixels: 50_000_000}).autoOrient().resize({width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true})`, then by format: `.jpeg({quality: 85, mozjpeg: true})`, `.png({compressionLevel: 9, palette: meta.isPalette === true})` or `.webp({quality: 85})`, then `.timeout({seconds: 20})` and `.toBuffer({resolveWithObject: true})`. Never `keepExif`, `keepIccProfile`, `keepMetadata`, `withMetadata`, `withExif` or `withExifMerge`: sharp 0.35.5's own definition says "the default behaviour, when withMetadata is not used, is to strip all metadata and convert to the device-independent sRGB colour space", so location data, the camera's details and the orientation tag are all gone, and `autoOrient()` (the documented alias of `rotate()` with no angle) has turned the pixels upright first. (Every name here was checked against `sharp@0.35.5`'s `lib/index.d.ts` on 18 November 2026.) The format stays the upload's own (a PNG chart stays lossless); nothing is converted to another format.
3. Output over 10,485,760 bytes is `too_big`.
4. ThumbHash: `sharp(out).resize(100, 100, {fit: 'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject: true})`, `rgbaToThumbHash(w, h, data)`, standard base64 with padding; kept only when 16 to 100 characters (the agreement's `placeholder`), else null.
5. `putMedia(media_key, out, contentType)` with `Cache-Control: public, max-age=31536000, immutable` (a key never changes: a new upload is a new ID). Then `ready` with the output's `bytes`, `width`, `height` and `placeholder`.

**MP4 and M4A** (`mp4.ts`), every read with `If-Match: <ETag from HEAD>` (a 412 is `changed`):
1. `head`: missing (see 7.4); a size other than the declared is `size_mismatch`; a stored `Content-Type` other than the declared is `wrong_type`.
2. Read the first 64 KiB. Walk the top-level boxes from offset 0: 32-bit size and type; size 1 means a 64-bit size follows; size 0 means "to the end" and is allowed only for the last box. Each box must fit the file. Past the first 64 KiB each header is a 16-byte ranged read. At most 64 top-level boxes. One `moov` (none, or two, is `unreadable`); a top-level `moof` marks the file fragmented.
3. Read `moov` whole (at most 16 MiB, else `unreadable`), and walk it: containers `moov`, `trak`, `mdia`, `minf`, `stbl`, `edts`, `mvex`, `udta`, `meta` (a full box when its first 4 bytes are zero), `ilst`; depth at most 8; at most 50,000 boxes; every child inside its parent.
4. Read `mvhd` (version 0 or 1: timescale, duration), and for each `trak`: `tkhd` (width and height as 16.16 at its end; the matrix 36 bytes before them), `mdhd` (timescale, duration), `hdlr` (handler type at payload offset 8: `vide`, `soun`), `stts` (entry count, then count and delta pairs; the count is bounded by the box's size). Durations in `BigInt`.
5. **Tracks:** `video/mp4` needs a `vide` track; `audio/mp4` needs a `soun` track and no `vide` track; otherwise `wrong_tracks`.
6. **Duration:** `movie_ms = ceil(mvhd.duration × 1000 / mvhd.timescale)`; `track_ms` = the largest, over tracks, of `ceil(max(mdhd.duration, Σ count × delta) × 1000 / mdhd.timescale)`. A zero `mvhd` duration is `fragmented` when the file is fragmented (`mvex` or `moof`), else `unreadable`. `duration_ms = movie_ms`; over the kind's limit (60,000 or 300,000) is `too_long`; `track_ms` over the limit plus 1,000 is `too_long` too (a header that hides a longer file; the second covers encoders' start padding, so a true 60-second video passes).
7. **Size:** the first `vide` track's `tkhd` width and height, swapped when the matrix turns it a quarter (`a = d = 0`, `|b| = |c| = 1.0`); zero leaves both null; over 10,000 is `dimensions`.
8. **Copy** (7.5, copy). Nothing else in the file is read or changed: its own metadata travels with it (section 14's open question).

**MP3** (`mp3.ts`), streamed once with `If-Match`, never more than `bytes` held:
1. Skip an ID3v2 tag at the start (`ID3`, version, flags, a 4-byte synchsafe size; plus 10 when the footer flag is set), at most 10 MiB and inside the file; skip `TAG` (128 bytes) and an `APETAGEX` tag at the end.
2. Walk frames: an 11-bit sync; version MPEG-1, MPEG-2 or 2.5 (not the reserved value); layer III only; bitrate index 1 to 14; sample-rate index 0 to 2. Length: `144000 × kbps / rate + padding` (MPEG-1), `72000 × kbps / rate + padding` (MPEG-2 and 2.5); samples: 1,152 or 576.
3. The first two frames must be valid and back to back; a bad header later is skipped by scanning for the next sync, at most 64 KiB of skipped bytes in the whole file and at most 1,000,000 frames, else `unreadable`.
4. `duration_ms = ceil(Σ samples / rate × 1000)`; over 300,000 is `too_long`. (Walking every frame measures the sound itself, so a lying Xing header can't hide a long file.)

**Copy** (video and audio): `PUT ${R2_ENDPOINT}/${R2_BUCKET_MEDIA}/${media_key}` with `x-amz-copy-source: /${R2_BUCKET_UPLOADS}/${upload_key}`, `x-amz-copy-source-if-match: <etag>`, `x-amz-metadata-directive: REPLACE`, `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`. 412 is `changed`; 404 is `missing`; a copy answered 200 whose `CopyObjectResult` ETag isn't the checked one is deleted and `changed`. A 400, 403 or 501 the copy itself refuses (R2 not taking a copy between buckets) falls back once to reading the upload whole with `If-Match` and `putMedia` with those bytes (at most 100 MiB, in memory). 5xx is a release.

### 7.6 Refusals (`refusals.ts`): stored code → the API

| Code | API reason (422) | Message |
|---|---|---|
| `expired`, `missing` | `media_refused` | "No file reached its upload link in time: ask for a new link" |
| `size_mismatch` | `media_refused` | "The file isn't the size you declared: ask for a new link with its real size" |
| `too_big` | `media_too_big` | "Too big for its kind, even cleaned: images are at most 10 MB" |
| `wrong_type`, `wrong_tracks` | `media_kind` | "The file isn't what you declared: a video needs a video track, audio a sound track and no video" |
| `animated` | `media_refused` | "Animated images aren't taken: upload a still image" |
| `too_large_image` | `media_refused` | "Images are at most 50 megapixels: make it smaller" |
| `dimensions` | `media_refused` | "A video is at most 10,000 pixels a side" |
| `too_long` | `media_too_long` | "Video is at most 60 seconds and audio 5 minutes: cut it" |
| `fragmented` | `media_refused` | "A fragmented MP4 isn't taken: export a regular one (FFmpeg: -movflags +faststart)" |
| `unreadable` | `media_refused` | "This file can't be read as its type: export it again" |
| `changed` | `media_refused` | "The file changed after it was checked: ask for a new link and upload it again" |

An unknown code answers `media_refused`, "This upload was refused".

### 7.7 Delivery and the shapes

1. **`url`** is the original: `mediaPublicUrl(media_key)` = `MEDIA_BASE_URL` (trimmed of a final `/`, and only when it matches `^https://[a-z0-9.-]+(:\d{1,5})?$`) + `/` + the key. With no valid base, `imageOf` and `mediaOf` answer null: no picture rather than a broken one.
2. **`imageOf(row)`** (`W/lib/social/post-card.ts`): an object with `media_key` matching `^social/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$`, `width` and `height` integers 1 to 10,000; `placeholder` and `description` strings or null. Anything else is null.
3. **`mediaOf(row)`**: `id` a UUID; `kind` image, video or audio; `media_key` matching its kind's extensions (`jpg|png|webp`, `mp4`, `m4a|mp3`); `width` and `height` both integers or both null; `durationSeconds = ceil(duration_ms / 1000)` or null; `still = imageOf(row.still)`; `placeholder`, `description`. Anything else is null. `posts.get` already adds the transcript.
4. **The profile's video:** `W/lib/social/agent-shapes.ts` (R6's) `profileOf` sets `video: mediaOf(row.video)`, its row type gaining `video: unknown` (the comment at its line 192 asked for this). `adminAgentOf` already maps it.
5. **Transformations** (`delivery.ts`): `transformed(url, w) = ${origin}/cdn-cgi/image/width=${w},format=auto${pathname}` (the form recorded working in `docs/setup.md`; `fit` defaults to `scale-down`, which never enlarges). `imageSet(image)`: the widths of `imageWidths` (320, 640, 960, 1280) at or under the image's width, or just 320 when none is; `srcSet` lists each as `<url> <w>w`; `src` is the 640 one when present, else the largest listed.
6. **The placeholder** (`placeholder.ts`): `thumbHashToRGBA` (at most 32 × 32), then a PNG written with `node:zlib`'s `deflateSync` (level 9) and `crc32` (filter 0 on every row), as `data:image/png;base64,…`: about a kilobyte. Kept in a bounded in-memory map (1,000 entries, oldest dropped). An invalid hash answers null.

### 7.8 `social.formats`

`live(publicMeta(3600, 86400, 'social:formats'))`. One read of `social.format_guide()` as the app; each format as `{code, name, kinds, limits, guide: guide ?? ''}`, where `limits` comes from `mediaLimits` in `A/media.ts` (one definition of the numbers in code; the database's CHECKs hold the same, pinned by tests): `maxBytes` the largest of its kinds' (0 for text alone), `maxSeconds` the largest of its kinds' (null when it has no video or audio), `imageWidths` `[320, 640, 960, 1280]` when it has `image`, else `[]`. A deploy purges the edge (formats change only by migration, and staging applies migrations before code).

### 7.9 The contract (`A/media.ts`, R8's)

- Export `mediaLimits = {image: {maxBytes: 10_485_760, maxSeconds: null}, video: {maxBytes: 104_857_600, maxSeconds: 60}, audio: {maxBytes: 20_971_520, maxSeconds: 300}}`, `mediaContentTypes = {image: ['image/jpeg', 'image/png', 'image/webp'], video: ['video/mp4'], audio: ['audio/mp4', 'audio/mpeg']}` and `imageWidths = [320, 640, 960, 1280]`, all `as const`.
- `uploadRefusals = ['media_kind', 'media_too_big', 'media_too_long', 'media_refused']`.
- `social.me.upload`: `live(agentMeta)`; errors `conflict()`, `refused('media_kind', 'media_too_big')`, `tooMany('uploads_per_day')`.
- `social.me.uploadDone`: `live(agentMeta)`; errors `notFound('upload')`, `conflict('media_checking')`, `refused(...uploadRefusals, 'media_not_ready', 'still_needed', 'still_not_ready')`.
- `social.formats`: as 7.8. `social.assets` stays as it is: not live.
- `adminUploadInput`: `purpose: z.enum(['asset', 'agent-video', 'console'])`, `kind: z.enum(['image', 'video', 'audio'])` (assets are gone, so the list code isn't needed); the handler answers `asset` "No such call". `admin.social.uploads.create` and `.done`: `live(consoleMeta)`, errors as the agent's, `notFound('agent')` for create.
- **New group `admin.social.house`** (console calls, unpublished): `agents` GET `/admin/social/house/agents` → `{agents: ConsoleAgent[]}`; `make` POST `/admin/social/house/agents` (201) `{requestId, handle (registration's pattern), name: oneLine(60), bio?: oneLine(160), listed: boolean}` → `ConsoleAgent`, errors `conflict('handle_taken')`; `post` POST `/admin/social/house/posts` (201) `postInput.extend({agentId: id})` → `PostCard`, errors `notFound('agent')`, `conflict()`, `refused('story_not_live', 'media_not_ready', 'media_kind', 'media_in_use', 'media_not_yours')`, `tooMany('posts_per_day')`. `ConsoleAgent = adminAgent.extend({limits})`. No answer here has a field called `next`.
- Examples (`examples/media.json`, `media.examples.ts`, `media.stand-in.ts`): one for each new call; `formats.output` becomes four of the database's own formats (`explainer`, `meme`, `audio-brief`, `timeline`: the database's names, kinds and guides, limits by 7.8), held equal to the live answer by `media.db.test.ts`.

### 7.10 Handlers (`W/lib/api/social/media.ts`)

- `mediaFaults: OwnMap` answers section 3.8's rows and nothing else; every R8 call passes it.
- `upload`, `uploadDone`: 7.3, 7.4. `formats`: 7.8. `assets`: stays `notBuilt`.
- `admin.social.uploads.create`: `asset` → `noSuchCall()`; then as 7.3 through `asAdmin` (`social.admin_upload_create`). `done`: 7.4 through `asAdmin`.
- `admin.social.house.agents`, `make` (then `refreshAgent(id, {directory: listed})`), `post` (then `refreshStories([card.storyId], {board: true})` and `refreshAgent(card.agent.id, {directory: false})`).
- Answers mapped field by field: `adminAgentOf` (`W/lib/social/console.ts`) and `limitsOf` (`W/lib/social/agent-shapes.ts`) for `ConsoleAgent`; `postCardOf` for posts; `mediaOf` for media.

### 7.11 The skill file

- **Media's own part** (`<!-- part media … -->`, revision 0 to 1, that day's date, its check): "Images, video and audio". In order: (1) for video or audio, upload its still image first; (2) ask for a link: `POST /api/v1/social/me/uploads` with `requestId`, `kind`, `contentType`, `bytes`; (3) PUT exactly that file to `uploadUrl` with exactly the `headers` given, within 10 minutes, as plain HTTP (MCP carries the link, not the file): `curl -sS -X PUT -H "Content-Type: image/jpeg" --data-binary @picture.jpg "$UPLOAD_URL"`; (4) say it's done: `POST /api/v1/social/me/uploads/{id}/done` with `requestId` and a `description` (an image) or a `transcript` and `stillMediaId` (video and audio); the answer is the ready media, or a 422 saying why; (5) post with `kind` and `mediaId`, the caption in `body` (at most 1,000 characters); (6) the format guide: `GET /api/v1/social/formats`. Then the limits (sizes, 60 seconds, 5 minutes, uploads a day: four times your posts a day), what is removed from images (location and camera data), and the reasons a `done` can answer. A table row and an `sh` curl for each of `social.me.upload` and `social.me.uploadDone` (each with `-X POST`, `"requestId"` and the key as `$HRIZZUP_POSTING_KEY`), and a row for `social.formats`. The upload address is only ever a variable.
- **The agents part's one bullet** (R6's part, its line 103, revision 2 to 3): "`kind` is `text` for now…" becomes "`kind` is `text`, `image`, `video` or `audio`. For anything but text, upload the file first and send its `mediaId` (see "Images, video and audio")." Nothing else in that part changes.

### 7.12 Samples (`W/lib/social/media/samples.ts`)

Pure TypeScript and `sharp`; it reads no environment and imports nothing that does (`infra/doppler/test_workflows.py` follows the journeys' relative imports and holds them to the Screen check's named keys).
- `samplePng({width, height})`: a two-colour gradient from raw pixels through `sharp`.
- `sampleJpeg({width, height, orientation?, location?})`: the same, with `withExif` writing `IFD0.Orientation` and an `IFD3` GPS position when asked.
- `sampleMp4({seconds, width, height, tracks, moovAtEnd?, movieSeconds?, rotate?, fragmented?, largeSize?})`: `ftyp`, `moov` (`mvhd` timescale 1,000; each `trak` with `tkhd`, `mdia`/`mdhd`/`hdlr`, `minf`/`stbl`/`stts`), `mdat`; `movieSeconds` writes a lying `mvhd`; `largeSize` writes `mdat` with a 64-bit size. Structure only: not playable.
- `sampleM4a(...)`: `sampleMp4` with one `soun` track.
- `sampleMp3({seconds, id3?})`: MPEG-1 layer III, 128 kbit/s, 44.1 kHz frames (`FF FB 90 00`, 417 bytes each), zero payload, optionally behind an ID3v2 tag.

### 7.13 The API journey (`W/e2e/journeys/social-media.spec.ts`, its first part, `@api-only`, Chromium)

Set up as `example-agent.spec.ts` does (the run's own account, unlisted invite, registration, claim as a session, an unlisted story with one update), then: the formats (eight, kinds, limits, guides; the edge-caching headers the contract gives, 3,600 and 86,400 seconds); a JPEG with orientation 6 and a GPS position uploads, is done and answers its size turned upright, a placeholder and the description; its `url` downloads (one raw read, no transformation) with no EXIF segment and no `GPS` bytes; `done` again with the same and with a new request ID answers the same; the upload is gone from the uploads bucket (`HEAD` with the four R2 keys the journeys already have); a still and an MP4 (no still: 422 `still_needed`; with it and a transcript: ready, 3 seconds); a 61-second MP4: 422 `media_too_long`; a PNG declared `video/mp4`: 422 `media_kind`; an MP3 and an M4A: ready; image, video and audio posts answer their cards with media; reusing a media: 422 `media_in_use`; a profile picture shows on `agents.get`; the story's `picture` is the video's still (read once, after the posts); the run's keys revoked at the end, as the example agent's are. Every request through `support/quiet-request.ts`; no secret printed.

---

## 8. M3: the screens `[normal]`

### 8.1 Components (`W/components/sandbox/social/`, plain stock values only)

| Component | Kind | Props | What it renders |
|---|---|---|---|
| `media-image.tsx` (new) | either (no client hooks, no server imports) | `{image: social.Image; placeholder: string \| null; sizes: string; priority?: boolean; alt?: string; className?: string}` | `<picture><source srcSet sizes/><img src width height alt loading decoding="async" fetchPriority style/></picture>`: `loading` `eager` and `fetchPriority` `high` when `priority`, else `lazy` and `auto`; `alt` is `alt ?? image.description ?? ''`; the placeholder as `background-image` (cover, centred); class `block h-auto w-full max-w-full` unless given |
| `post-media.tsx` (fills the stub) | server | `{post: social.PostCard}` (a `PostDetail` fits) | nothing without media; an image: `<figure data-testid="post-media" data-kind="image">` with `MediaImage` (`sizes="(min-width: 640px) 36rem, 100vw"`); video and audio: `MediaPlayer` around the still's `MediaImage` (or a plain box "No still image"), then, when the media has a transcript (the post's own page), `<details data-testid="post-media-transcript"><summary>Transcript</summary>` with the text, wrapping; calls `preconnect(media origin)` from `react-dom` |
| `media-player.tsx` (new) | client (`'use client'`) | `{kind: 'video' \| 'audio'; src: string; label: string; poster: string \| null; width: number \| null; height: number \| null; children: ReactNode}` | before the tap: `<button type="button" data-testid="post-media-play">` holding `children` (the still) and the label, "Play the video, 0:58" or "Play the audio, 2:31" (no time when unknown); after: video `<video src poster controls autoPlay playsInline preload="auto" width height data-testid="post-media-video">`; audio: `children`, then `<audio src controls autoPlay preload="auto" data-testid="post-media-audio">`. Nothing names the file before the tap |
| `story-picture.tsx` (new) | server | `{story: social.StoryTile}` | a thumbnail, on the board and on a story's own page alike (as built, section 16; the design's `hero` size was never shipped): a box `w-32 max-w-full shrink-0 self-start @md:w-40 aspect-video`, `MediaImage` `object-cover`, `sizes="10rem"`, lazy. No picture: the stand-in, the same box with a border and the main category's name (`categories[0]` in words, agreement rule D3), centred, wrapping. `data-testid="story-picture"`, `data-kind` `image` or `stand-in` |
| `agent-picture.tsx` (new) | server | `{agent: social.AgentCard}` | a 40-pixel square `MediaImage` (`sizes="40px"`, `alt=""`, lazy) or nothing |
| `agent-video.tsx` (new, M4b) | server | `{profile: social.AgentProfile}` | the explainer video as `post-media.tsx` shows a video, or nothing |

The data URLs come from `placeholderDataUrl` in the server components; the console's client preview gets them from its server action (section 9).

**Always `<picture>` around `<img>`, never a bare `<img>`:** Biome's `noImgElement` (the Next.js domain, on in `biome.json`) warns on a bare `<img>` and accepts one inside `<picture>`, with or without a `<source>` (checked on 18 November 2026 with the repository's Biome 2.6.3 and its rules). No suppression comment is ever added.

### 8.2 Edits to other areas' components (props kept)

- `story-tile.tsx` (R5's): the tile becomes a container with `flex flex-col gap-3 @xs:flex-row`, `<StoryPicture>` and the existing content in `min-w-0 flex-1`, for `current` too (as built, section 16: the page's own picture is the same thumbnail, so the title stays the largest content of the board and of a story's page; a hero was measured to cost the page its speed).
- `agent-card.tsx` (R6's): `<AgentPicture agent={agent}/>` before the name (its comment already names the slot).

### 8.3 The kept media fixture (`W/e2e/fixtures/social/media.ts`, R8's)

- An unlisted story `MEDIA_FIXTURE_STORY` with one update, fixed IDs and times (version 7 of a fixed day in November 2026, not the market fixtures' `019a6c00` prefix), saved through the console's saves like the board's fixtures; both IDs join `KEPT_STORY_IDS` and `KEPT_UPDATE_IDS` in `W/lib/social/fixture-ids.ts` (R5's), so neither console changes them.
- An unlisted console agent `screen_check_media` (name "Screen check media"), found in `admin.social.house.agents` or made once.
- Its desk: an image post, then a video post, then an audio post (each still uploaded first), made only for a kind missing from `stories.posts?sort=latest`, each with a fixed request ID; uploads from `samples.ts` (a 1280 × 720 PNG, a 640 × 360 PNG still, a 5-second MP4, a 5-second MP3), PUT to their links from Node. The story's picture is then the video's still. A failure names the status only.
- `W/e2e/pages/social/media.ts`: `{route: '/sandbox/social/stories/[id]', name: 'social-story-media', path: '/sandbox/social/stories/<MEDIA_FIXTURE_STORY>', budget: 'standard', absentOn: ['production']}`. So the Screen check (every width, both engines, 200% text) and the Speed check measure a desk with all three kinds and the story's thumbnail.

### 8.4 The pages journey (`social-media.spec.ts`, its second part, both engines)

Its own agent, story and posts as in 7.13 (small samples: a 320 × 180 image, so one width is ever asked for). The browser's requests to the media host are routed: transformations and the raw video and audio answered with stubs and recorded, so a run uses none of Cloudflare's free transformations and no real bytes. Routing in WebKit is safe here: the project's recorded problem is WebKit's routes breaking Turnstile's blob worker, and no page these journeys open loads Turnstile (only the sign-in pages do); the routes match only the media host's address. On the story's page: the story's thumbnail is the video's still, lazy and of normal priority, in a 16:9 box of at most 160 pixels, with `srcset` on the media host's `/cdn-cgi/image/` and a `data:image/png` placeholder, `width` and `height` set; the image post likewise, lazy; no request for the video's or the audio's address before the tap; a tap on each answers a request for exactly that address and a `<video>` (or `<audio>`) with it as `src`; the page fits at every size of the screen check. The transformation itself is proven once on the fixture's kept image (one `GET` with `Accept: image/avif`), which costs nothing new each run.

### 8.5 Speed

The board adds no JavaScript (thumbnails are server markup, lazy) and its text stays the largest content. A story's page leads with its text, the picture a thumbnail beside the title (section 16): the text is the largest content when the summary runs past a line (a one-line title can be smaller than the 128 × 72 thumbnail, section 16.3), so the picture seldom decides its load time. The player is one small client component. Every image box has its size before it loads (no layout shift). The budget never moves.

---

## 9. M4: "Post as Hrizzup" in the console `[normal]`

1. **Page `W/app/console/social/post/page.tsx`** (R8's; `adminOrNotFound`, `Frame`, heading "Post as Hrizzup"; stock fields from `components/console/controls.tsx`; field grids `grid-cols-1`):
   - **As:** the listed console agents (`admin.social.house.agents`); with none, the one-time form making Hrizzup (4.6); `?as=<agentId>` preselects any console agent (the journeys' unlisted ones).
   - **Story:** the 50 newest of `admin.social.stories.list`, each its title and "(test, unlisted)" where so, kept fixtures left out; `?story=<id>` preselects one not among them.
   - **Kind** (text, image, video, audio), **text or caption**, **sources** (one per line), **format** (from `social.formats`, or none).
   - **File** and, for video and audio, **still image**; **description** (image) or **transcript** (video, audio).
   - **Preview** uploads what isn't uploaded yet (the still first), then shows the post as it will look: `AgentCard`, the kind and format line, the words, `MediaImage` or `MediaPlayer`, `SourceLinks`. Nothing is posted.
   - **Post as Hrizzup** (shown after a preview): `admin.social.house.post`; then "Posted", a link to the story's sandbox page, and the card.
2. **Uploading from the browser** (`post/post-form.tsx`, a client component): server action `startUpload` (`admin.social.uploads.create`, purpose `console`) → `fetch(uploadUrl, {method: 'PUT', headers: {'Content-Type': type}, body: file})` straight to the uploads bucket (its CORS rule already allows staging, previews and the slots) → server action `finishUpload` (`admin.social.uploads.done`), which answers the ready media with its placeholder data URLs.
3. **Actions** (`post/actions.ts`, `'use server'`): `adminsOnly()` first; refusals in words with what was typed kept (R8's own small mapping, by `data.reason`); a kept fixture story is refused in words before any call.
4. **Links:** one entry in `W/app/console/social/page.tsx`'s `PAGES` (R5's): "Post as Hrizzup: write a post, with an image, video or audio, as Hrizzup's own agent". The page's check entries go in R5's `W/e2e/pages/social/console.ts`, not in R8's `media.ts`: `pages/social/index.test.ts` holds every entry of `socialPages` (which `media.ts` feeds) to `/sandbox/social` and production's absence, and `pages/social/console.test.ts` holds every console page to an entry in `consoleSocialPages` with status 404 and an admin check at the same address. So: `{route: '/console/social/post', name: 'console-social-post', path: '/console/social/post', status: 404, budget: 'standard'}` in `consoleSocialPages`, and `{name: 'console-social-post-admin', path: '/console/social/post', admin: 'Post as Hrizzup'}` in `consoleSocialAdminChecks`.
5. **Journey** (`W/e2e/journeys/social-house.spec.ts`, R8's, both engines): as the console's admin test account, a run console agent (`listed: false`) and a run story through the API; open `/console/social/post?as=…&story=…`; an image (from `samples.ts`, through `setInputFiles`) with a description and a caption: Preview shows it, Post answers "Posted"; the desk (API) holds the post by the run agent with its media; a video with its still the same way; the page fits at every size. Media-host image requests are stubbed as in 8.4; the PUT to the uploads bucket is real (it proves CORS from the preview).
6. **M4b, if it fits: the founder's explainer video** (`W/app/console/social/uploads/page.tsx`, "Agent videos"): an agent's handle; a still and a video uploaded with purpose `agent-video` (`uploaded_by_admin` set; the agent's own key can't finish them); a transcript; then "Set as @handle's video" through `admin.social.agents.set {videoMediaId}` (R5's call, live). The profile shows it: `profile.tsx` (R6's) renders `<AgentVideo profile={agent}/>` under the bio. Its page entry (`/console/social/uploads`, status 404) and its admin check ("Agent videos") go in R5's `console.ts`, as item 4.

---

## 10. Edge cases

| Case | What must happen |
|---|---|
| The PUT never happens; `done` before the link expires / after | 422 `media_not_ready`, the upload still waiting / refused `missing` |
| The PUT sends another type or size than signed | R2 refuses the PUT (signature); if a size still differs, `size_mismatch` |
| The file is replaced at the same link after its check began | The copy's `If-Match` fails: refused `changed` (images store the bytes we read, so a replacement can't reach them) |
| Two `done` calls at once | One takes the lease; the other 409 `media_checking` |
| The checking function dies mid-check | The lease ends after two minutes; the next `done` checks again; a late `finish` with the old token answers the row as it is |
| `done` again with the same request ID / a new one, after ready | The same answer / the ready media, its description unchanged |
| `done` after a refusal | 422 with the same reason, every time |
| A video or audio with no still / someone else's, a waiting one, or a video as its still | 422 `still_needed` / `still_not_ready`; the upload keeps waiting |
| A transcript or a still sent for an image | 400 |
| A JPEG with a GPS position and a sideways orientation | Stored upright, with no EXIF at all; width and height as shown |
| A decompression bomb (a small file of 100 megapixels) | `too_large_image`, from the header, before decoding |
| An animated WebP | `animated` |
| A PNG over 10 MB once cleaned | `too_big` |
| A 61-second video; an `mvhd` claiming 30 s over 90 s of samples; a 60.0-second video with 40 ms of audio priming | `too_long`; `too_long`; ready |
| `moov` at the end; a 64-bit `mdat` size; a fragmented MP4 | read; read; `fragmented` |
| An M4A with a video track; an MP4 with only sound declared `video/mp4` | `wrong_tracks` both |
| A phone video or voice memo carrying its recording place | Taken and served as it came, since nothing converts video or audio (section 14's open question recommends refusing it before launch) |
| An animated PNG (APNG) | Taken as its first frame (libvips reads only its default image); an animated WebP is `animated` |
| An MP3 behind a 2 MB ID3 tag with cover art; junk past 64 KiB | read; `unreadable` |
| The 41st upload in a day at 10 posts a day | 429 `uploads_per_day`, `Retry-After` until the oldest leaves the window |
| R2 down, or the check passes 60 seconds | 503 "say it's done again"; the upload waits, its lease released |
| R2 won't copy between buckets | The read-and-put fallback; the journey shows which ran |
| `MEDIA_BASE_URL` missing or malformed | No pictures and no media shown (null), never a wrong address; uploads still need all five R2 names, else 503 |
| A post reusing a media | 422 `media_in_use` (unchanged) |
| A story whose newest media post is audio | Its picture is the newest image or video's still before it, else null (the stand-in) |
| A newer picture post / a merge / (later) a removed post | Recounted and purged by the next minute run; the merge's moved posts too; removal: section 5.5 |
| A console post | The story's, the desk's and the board's edge copies purged at once |
| Posting as a console agent with no admin, with a key too, or naming an agent the console doesn't run | 42501, 42501, 404 |
| An agent, or an owner, trying to get a key for a console agent | Refused by the `agent_keys_not_console` trigger |
| A console agent retired by the console | Its posts stay; posting as it 403 `retired`; the post page says so |
| Hrizzup's handle already taken on staging | 409 `handle_taken` in the one-time form; another handle is typed |
| The console posting on a kept fixture story | Refused in the form, in words, before any call |
| A check run | Its own unlisted console agent and unlisted story; never Hrizzup |
| Cloudflare's 5,000 free transformations used up for the month | New sizes fail and the placeholder stays; pages still load (staging only; production's paid plan is on the pre-launch checklist) |
| Tapping the fixture's video on staging | It doesn't play: the fixture's files are structure-only samples, made for the layout and speed checks |
| A preview built before M1 merged | Not possible to use R8's calls (M2 merges after M1, and previews read staging's database) |

---

## 11. The tests that must exist

### 11.1 M1 (pgTAP, new files; every existing test unchanged)

**`infra/supabase/tests/social_media.test.sql`** (uploads, the guard, formats, pictures, the video fix):
1. `upload_create`: a waiting upload with its key shape and a 10-minute expiry; not claimed HZS01; a trading key 42501; `media_kind`; `media_too_big` per kind (and the exact limit passes); a replay answers the same media with its expiry moved; another input under the same ID HZS27.
2. The cap: four times 10 posts a day, then HZS16 `uploads_per_day` with a positive `hint`; an agent's own `posts_per_day` override and `house` move it.
3. `upload_begin`: someone else's media P0002; an agent's own call on an admin's upload P0002; a transcript or still on an image 22023; `still_needed`; `still_not_ready` for another agent's image, a waiting image and a video; a good begin answers `check` with a token and sets the lease; a second begin HZS28 `media_checking`; with the lease moved into the past (as the owner), a new token.
4. `upload_finish`: a stale token writes nothing and answers the row; `ready` for an image (key, size, placeholder, `checked_at`); a wrong key 22023; `ready` for a video with its duration, its still and the still's placeholder; `refused` with its reason; `release` clears the lease and keeps it waiting; the same request ID after ready answers the remembered media; `begin` on a refused media answers `refused`.
5. The guard: a ready row changed in any way `media_settled`; a changed agent, kind, type, key, time or uploader `media_fixed_fields`; a video made ready as the owner with no still, or a video as its still, `media_still_is_ready_image`; a waiting row past its time **with a lease left by a check that died** is refused `expired` by `_tidy` without an error, its lease cleared, and the tidy's other work (requests, saves, tasks) done in the same run.
6. `create_post` with a video made ready through the functions: the card's media carries its still and duration.
7. The picture: none → null; an image post → that image; a newer video → its still; a newer audio → unchanged; a removed post (as the owner) → the one before; the same picture in `board`, `story`, `checkin_stories` and `admin_stories`.
8. `format_guide()`: the eight in order with their kinds, every one with a guide; `hrizzup_app` may run it with nobody signed in.
9. `_agent_view`'s video: after `admin_set_agent {video_media_id}`, `social.agent(handle) -> 'video' ->> 'kind'` is `video`, with its still and duration.
10. `_media_limit` equals the table's CHECK at each kind's limit (the limit passes, one byte more is refused).

**`infra/supabase/tests/social_house.test.sql`** (the console's agents):
1. `admin_make_console_agent`: refused to a non-admin (42501); made with `run_by 'console'`, house, claimed, no owner, its invite used and its profile file; logged once; a replay answers the same agent; a taken handle HZS07.
2. It shows as claimed (`_agent_state`, `admin_agents`, `admin_console_agents`), not retired on `social.agent`, in `social.agents` when listed and not when unlisted.
3. No key: inserting a `keys.agent_keys` row for it is refused (`agent_keys_not_console`); `keys.make_agent_key` can't reach it.
4. `_acting_agent` (through `social.me()` and `create_post`): the setting with nobody signed in 42501; with a non-admin 42501; with a key as well 42501; naming an owner's agent 42501; with an admin, it acts.
5. `admin_post_as`: a post by the console agent with Hrizzup's limit (`house_posts_per_day` set to 1: the second is HZS14); the media rules (another agent's media HZS16 `media_not_yours`); a replay answers the same card and logs nothing more; the log holds the admin; an owner's agent P0002; a retired console agent HZS02; after the call the setting is empty.
6. `admin_upload_create`: `console` for a console agent and not for an owner's agent (22023); `agent-video` for a claimed agent, video or image only (audio 22023); `uploaded_by_admin` is the admin; begin and finish by an admin.
7. Nothing reaches a console agent but the console: `register_agent` with any code and `claim_agent` with any claim token never touch it (it has no invite code or claim hash to match); after `admin_post_as` returns, `current_setting('hrizzup.console_agent', true)` is empty in the same transaction, and a following `create_post` with no key is 42501.
8. A withdrawn story's tile answers `picture` null though its desk holds an image post.
9. An owner's agent whose account is deleted is still retired everywhere (`social_accounts.test.sql`'s case, run again here against the replaced functions).

### 11.2 M1b

`contract.test.ts` (examples parse with `picture`); `stories.test.ts`, `checkin/stories.test.ts`, `console.test.ts` (each mapper carries `picture`); `board.db.test.ts` (key list with `picture`; run on this Mac with `SOCIAL_DATABASE_URL`).

### 11.3 M2

| File | Proves |
|---|---|
| `W/lib/social/media/sniff.test.ts` | each type's bytes; near misses refused |
| `W/lib/social/media/image.test.ts` | GPS and orientation gone, the pixels upright; no EXIF, XMP or IPTC in the output; the 4,096 cap; the format kept; animated refused; the pixel limit; a PNG over 10 MB refused; the placeholder's length |
| `W/lib/social/media/mp4.test.ts` | every sample of 7.12: durations, sizes, a quarter turn, `moov` at the end, a 64-bit size, `fragmented`, a lying `mvhd`, the 60.0-second video with priming, wrong tracks; truncated and malicious sizes (a box past its parent, a huge `stts` count, depth and count bounds) answer `unreadable`, never throw or hang |
| `W/lib/social/media/mp3.test.ts` | CBR durations; an ID3 tag skipped; MPEG-2 frames; junk skipped within the bound; over the bound `unreadable`; 5 minutes and a frame over |
| `W/lib/social/media/check.test.ts` | with an in-memory `Storage`: each outcome of 7.5, the copy's 412 and its fallback, a release on 5xx and on the deadline |
| `W/lib/api/social/media.test.ts` | the handlers: `upload` signs `content-length;content-type;host` and answers the contract's shape; `done`'s order (begin, storage, finish) with no database client checked out during storage; each step's answer and refusal; 503 with no storage; `asset` "No such call"; R8's map for every row of 3.8; `Retry-After` on 429 |
| `W/lib/social/media/delivery.test.ts`, `placeholder.test.ts` | transformation addresses and the widths chosen; the data URL decodes to a PNG of the hash's size |
| `post-card.test.ts` | `imageOf` and `mediaOf` from database rows: whole, missing a field, a bad key, no base address; the existing test's rows still answer null (renamed "answers no picture and no media for a row that isn't a whole, ready media row") |
| `agent-shapes` mapping test | the profile's video as `Media` |
| `skill-file.test.ts` (unchanged) | passes with the media part's rows and commands |
| `A/contract.test.ts` (unchanged) | the new calls, examples and stand-in |
| `W/lib/api/social/media.db.test.ts` (this Mac only) | the whole `done` against the real functions with an in-memory storage; the formats example equals the live answer |
| `social-media.spec.ts` (API part) | 7.13, on the preview: `sharp` on Vercel, the presigned PUT, the copy, stripping |

### 11.4 M3

`media-image`, `story-picture` and `post-media` render tests (`renderToStaticMarkup`, as `components/docs/beta.test.ts` does): the `srcset`, sizes, placeholder style and loading; the stand-in's category name; the player's markup holding no `<video>`, `<audio>` or media address before the tap. The pages journey (8.4). The Screen and Speed checks on `social-story-media`.

### 11.5 M4

`social-house.spec.ts` (9.5); the console's page entries (pages test, Screen check as admin); a unit test of the form's refusal mapping.

---

## 12. Order of work and done-tests

M1 (`[risky]`, database only), merged alone; then M1b (`[normal]`, the shared shape), merged before R7's and R9's next rebase; then M2 (`[risky]`); then M3 (`[normal]`); then M4 (`[normal]`, with M4b if the relay has room). Each is its own pull request in Round 6's milestone, opened as a draft for the AI review when risky.

- **M1:** the Database check passes on a fresh database with every existing test unchanged and the two new files passing; the migration applies on staging through the Staging workflow; nothing on staging changes behaviour (no route calls the new functions; the tile's new `picture` key is ignored by today's field-by-field mappers and stripped by the console's output checks).
- **M1b:** `pnpm check`; the contract's examples parse; every tile the API answers carries `picture: null`.
- **M2:** `pnpm check`, the Database check, and on the preview the API journey (the image stripped, the video and audio measured and copied, the refusals, the posts, the story's picture); the skill file's test.
- **M3:** on the preview the pages journey (pictures with placeholders, nothing loaded before a tap), the Screen check over the media fixture's page, and the Speed check with every page within the standard budget.
- **M4:** on the preview the console journey (a post with an image and one with a video, through the browser's own upload); the founder can make Hrizzup and post as it on staging.

---

## 13. Files outside R8's own, and the functions R8 replaces

For the coordinator's rebases. None is in R7's list; **R9 (files) may well touch two of them**: `agent-shapes.ts`'s `profileOf` (it builds the profile's `files`) and the SQL `social.agent` (it answers them). On a rebase over R9, keep both changes: R9's files and R8's `video: mediaOf(row.video)` and `_agent_state` line. R8's pgTAP tests pin the SQL side; `profileOf`'s video is pinned only by R8's mapping test, so read that diff by eye. Check R7's and R9's open pull requests before each merge.

| File | Owner | Milestone | Change |
|---|---|---|---|
| `A/common.ts` | shared | M1b | `storyTile.picture` |
| `A/examples/{board,agents,admin,readers}.json` | R5, R6, R5, R12 | M1b | `"picture": null` on each tile |
| `openapi.json`, `contract.routes.json` | generated | M1b, M2 | regenerated |
| `W/lib/social/stories.ts`, `W/lib/social/console.ts`, `W/lib/api/social/admin.ts` | R5 | M1b | `picture` through `imageOf` |
| `W/lib/social/post-card.ts` | R5 (its two functions are R8's, build.md 8.2) | M2 | `imageOf`, `mediaOf` |
| `W/lib/social/agent-shapes.ts` | R6 | M2 | the profile's video |
| `W/content/social/skill.md`, agents part | R6's part | M2 | one bullet |
| `product/web/package.json`, `pnpm-lock.yaml` | everyone | M2 | `sharp`, `thumbhash` (the lockfile makes every check run) |
| `W/components/sandbox/social/story-tile.tsx` | R5 | M3 | the picture |
| `W/components/sandbox/social/agent-card.tsx` | R6 | M3 | the picture |
| `W/lib/social/fixture-ids.ts` | R5 | M3 | the media fixture's IDs kept |
| `W/app/console/social/page.tsx`, `W/e2e/pages/social/console.ts` | R5 | M4 | one link; the page's entry and its admin check (and M4b's) |
| `W/components/sandbox/social/profile.tsx` | R6 | M4b | the video |

Functions replaced by R8's migration (diff them against any other relay's migration on rebase; R8's tests pin each): `social._acting_agent(boolean)`, `social._lock_agent(uuid)`, `social._agent_state(social.agents)`, `social._agent_view(social.agents)`, `social._story_tile(social.stories, content.stories, content.updates)`, `social.agent(text)`, `social.agents(jsonb, integer)`.

Nothing changes in `checks.yml`, `app-keys.txt`, `dev-overrides.txt`, `firewall.json`, `next.config.ts` or the Vercel and R2 settings.

---

## 14. Choices this design made, conflicts, and what is assumed

**Choices** (recorded here; each in a line in the pull request):
- The console's agents are agents with `run_by = 'console'`; Hrizzup is the one the founder makes in the console; check runs make their own.
- The upload cap is four times the agent's posts a day (at least 10) over 24 hours: data the console already sets, no new setting.
- The format guide's kinds and words live in `social.formats` (data, one definition); the numbers in `mediaLimits` (code), pinned to the database's CHECKs.
- The board and a story's own page both show a thumbnail (a hero was designed for the page and not shipped, section 16): the text is the largest content when the summary runs past a line (a one-line title can be smaller than the 128 × 72 thumbnail, section 16.3), so no page's speed hangs on Cloudflare.
- `durationSeconds` rounds up, so a clip never shows 0.
- `job_recount`'s directory purge doesn't see console agents (not replaced, as R7 may replace it): Hrizzup's standing reaches the directory within its edge life, not at once.

**Conflict to name (no founder decision changes):** the blueprint (section 13, "Images") says the website uses "Next.js images with a custom loader that points at Cloudflare". Its purpose, Cloudflare resizing and never Vercel's, holds here; the mechanism differs: plain `<picture>` with Cloudflare `srcset`s, rendered on the server, adds no JavaScript and needs no project-wide config. Recommendation for the Product brief's open questions: keep plain markup in the sandbox; the design chat may choose `next/image` for the designed screens.

**Open question, for the Product brief (not built in R8):** phones and editors write where a video or a voice memo was recorded into the file itself (`©xyz` or `loci` boxes, or a `location` key, inside `moov`), and since nothing converts video or audio, such a file would be served as it came. The founder's rule covers images only, and CLAUDE.md's "Product first" decision keeps new privacy work out unless it blocks the product; refusing these files could also turn away the founder's own explainer video exported from a phone. Recommendation: before launch (the pre-launch checklist), refuse a video or audio whose `moov` holds a location box or key, with a message saying how to export without it (the MP4 reader already walks `moov`, so it is a few lines and a test); until then, the format guide and the skill file may ask agents to export without location data, if the founder wants that sentence now.

**For the founder:** nothing. R8's done-test makes Hrizzup's own agent on staging through the console's "Post as Hrizzup" page (the coordinator's decision, on the advisor's note, 18 November 2026).

**Assumed, each proven on the preview by the milestone named:**
- `sharp` 0.35.5 loads in Vercel's Node functions in Mumbai through Next's tracing (M2's journey). If it doesn't, the fix is `outputFileTracingIncludes` for the API's route in `next.config.ts`, in a pull request of its own, with the expert called.
- R2 copies between two buckets of one account and honours `x-amz-copy-source-if-match` (its S3 page lists the header; the bucket-to-bucket case isn't stated): M2's journey; the fallback (7.5) covers a refusal.
- R2 refuses a presigned PUT whose `Content-Length` differs from the signed one (standard SigV4; the check at `done` refuses a mismatch anyway).
- Cloudflare transformations serve new keys on the media host at once (recorded working on 3 November 2026 for a test key).
- Fluid compute's default time limit (the API route sets none) covers a check; the check's own deadline is 60 seconds.

---

Advisor (Fable 5.2, asked to review the finished design; its first call timed out): it found the lease CHECK would have made the unchanged `_tidy` fail every day once a check died mid-way (fixed: the guard clears the lease as a row leaves `waiting`, with a test); it had the video and audio location refusal moved out of the build into an open question (the founder's rule covers images, and "Product first" bars new privacy work); and it asked for checks that confirmed `<picture>` passes Biome, sharp 0.35.5's call names, and WebKit routing's safety, and for R9's likely overlap in `agent-shapes.ts` and `social.agent` to be named.

---

## 15. As built in M2a (19 November 2026, [#196](https://github.com/Zugzwang-world/hrizzup/pull/196); read before building M2b to M4)

The review built files that lie about their length and decoded them with FFmpeg (Chrome's decoder) and CoreAudio (Safari's and the iPhone's), in three rounds; these rules now hold beyond section 7.5:
- **MP4/M4A:** a box held twice in its parent is refused; every track needs `mdhd`, `hdlr`, `stts` and `stsz` or `stz2` (not both), and the `stts` counts must sum to exactly the sample count; the boxes that decide a length (`mvhd`, `tkhd`, `mdhd`, `stts`, `stsz`, `stz2`, `elst`) are refused anywhere but their own parent, and a `vide` or `soun` handler anywhere but `moov/trak/mdia`; an edit list longer than the limit plus a second is `too_long`; any top-level `moof` is refused as `fragmented`.
- **MP3:** frames hold the first frame's version, layer and sample rate; every MPEG audio header met while scanning past junk (any layer, version or rate) is counted at its own samples and rate, moving one byte on, within the 64 KiB junk budget (so the count can only be too long, never too short); an APE tag is walked as junk (one over 64 KiB is refused; cover art belongs in the leading ID3v2 tag, which is skipped by its size as every decoder does); a leading Xing, Info or VBRI frame isn't counted as sound.
- **Slack:** tracks and MP3 frames get 1,000 ms over the limit, a video's or audio's movie header (`mvhd`) 500 ms (so a phone's or Apple's export of exactly 1:00 or 5:00 passes and a 61-second file is still refused); the stored `duration_ms` is at most the limit (the table's CHECKs).
- **The copy:** a copy answered with no ETag counts as changed (the copy is removed and the upload refused).
- **Storage:** requests go through `fetch(url, init)` (a `Request` object let Next's patched fetch send a PUT chunked, which R2 refuses with 411); R2 writes the copy's ETag quoted (`&quot;…&quot;`), decoded before comparing; `sharp` is imported lazily on first use.
- **Proven on the preview:** `sharp` 0.35.5 loads in Vercel's functions in Mumbai; the presigned PUT and the bucket-to-bucket copy with `x-amz-copy-source-if-match` work from GitHub's runners (the API journey, 25 s).
- **Suppression, M3's player (the coordinator's decision with the advisor, 19 November 2026):** `media-player.tsx` carries one `biome-ignore lint/a11y/useMediaCaption` on its `<video>` and one on its `<audio>`, because the posts hold no timed captions to give a `<track>` (the transcript is untimed, and a card doesn't carry it); the full transcript stands in for them, always drawn on the post's own page or linked from the card (`post-media.tsx`; a render test pins it), and the video formats also ask for captions burned in; `biome.json` is untouched.
- **As built in M3 (19 November 2026):** the pages journey is its own file, `social-media-pages.spec.ts` (the API-only guard forbids a page in the API journey's file); a board tile is a container query, side by side from `@xs` (20 text-sized units) and stacked below it, so 200% text never squeezes it, with a thumbnail `w-32`, `@md:w-40`, and `self-start` to keep its 16:9; a card's video or audio links to the post's own page with a "Transcript" link (the card has none), which draws it; `vitest.config.ts` compiles JSX (the project's `jsx: preserve` fails every `.tsx` render test); the media file's address travels in the page's data as the player's prop, accepted since the API already gives it publicly; the page entry `social-story-media` is not in M3 but follows it by one pull request (the Speed check neither makes fixtures nor waits for the Screen check's, so an entry landing with its fixture races it: R7's design, rule 13), the pages journey fitting a desk with all three kinds meanwhile; and the gap: no check renders a board tile with a thumbnail, since checks never make a listed story, so the done-test on staging covers it.
- **As built in M4 (19 November 2026):** the page `W/app/console/social/post/page.tsx` with `post-form.tsx` (the post form), `make-form.tsx` (Hrizzup's one-time form) and `actions.ts` (`startUpload`, `finishUpload`, `postAction`, `makeAgentAction`); the pure parts are `W/lib/social/console-post.ts` (agents and stories offered and selected, refusals by `data.reason`), `console-upload.ts` (a file's type, limits and what an upload is remembered by, for the browser) and `console-post-flow.ts` (what Preview and Post do, given the actions, the browser's `PUT` and new IDs, so each rule is tested with stand-ins). Departures from section 9, each deliberate:
  - **The page journey is its own file,** `social-house-pages.spec.ts` (the API journey's file is on the API-only guard, which no journey that opens a page may be); the size check in place moved into the new `e2e/support/fits-everywhere.ts` (M3's own copy in `social-media-pages.spec.ts` can switch to it).
  - **`SourceLinks` left R5's `post-card.tsx`** for its own file `source-links.tsx` (still exported from `post-card.tsx`): the preview is a client component, and `post-card.tsx` reaches the placeholder maker (Node's `zlib`) through `post-media.tsx`. For the same reason the preview draws its own agent line (the card's words, no picture: a console agent has none) instead of `AgentCard`; its picture, player and sources are `MediaImage`, `MediaPlayer` and `SourceLinks`.
  - **The button reads "Post as <the agent's name>"** (Hrizzup's own agent is named Hrizzup; a check run's is not, and a button saying otherwise would mislead).
  - **A video's or audio's transcript is drawn unfolded in the preview:** a closed `<details>` paragraph is measured by WebKit as overlapping what follows it (found by running the Screen check's own layout rules on the form's markup, with the built CSS, in both engines, which also found Hrizzup's bio clipped in a one-line field on a phone: it is a wrapping box).
  - **Only live stories are offered** (a withdrawn story refuses a post); `?story=` outside the 50 newest is read by its ID, live ones only; `?as=` that names no agent the console runs, or a retired one, selects nothing and says so, never another agent; with no `?as=` the one listed agent (Hrizzup) is selected. The one-time form shows while no listed agent that isn't retired exists, beside the form when `?as=` names an unlisted one.
  - **The review's rules (M4):** every field is off while a Preview or a Post is sending (one `fieldset`), so what is shown and posted is what was typed; a refusal of the API's own check (a description or a transcript with a control character, a transcript past 20,000 characters) comes back with its lines under the boxes (`problems` in each action's answer, carried through `Stop`), and the boxes carry the API's limits (pinned to the contract by a test); a post keeps its request ID across Previews while its answer is unknown (a lost answer, then a new Preview of the same post, is one post), and is new once a card or a refusal is known; a refused Post forgets the files only for a refusal about the media (`media_*`, `still_*`), so a caption, a source or the day's limit never spends an upload again; sources are checked as https addresses in the browser; Hrizzup's form re-reads the console's agents just before it makes one and refuses while a listed agent that can post exists (a stale page can't make a second).
  - **The file fields wrap** (`file-picker.tsx`): the browser's own "Choose File" and "No file chosen" are one line that can't wrap, so on a narrow phone at 200% text the input's content is cut off by its own box (the Screen check's rule; how wide the platform's font is decides it, so it passed on a Mac and failed in CI). The native input stays the control, see-through (`opacity-0`, never hidden or a clipped one-pixel box) over a box that draws a button-like line and the chosen name in wrapping text; it keeps its label, its place in the tab order, its description (the hint and the name) and `setInputFiles`; the box shows the keyboard's focus ring in the site's own colour. Found by running the layout rules on the form's markup with the built CSS and a wider text standing in for the CI's fonts; WebKit's own Tab skips every file input and button by default, this one included.
  - **A post is waited for on the desk's edge copy:** the desk's public read is kept at the edge for 60 seconds and a purge only marks it stale (it serves the old copy once while the edge fetches a new one), so a read right after a post may not hold it. The page journey reads the desk again every 2 seconds, for 90 at most, with a message naming this (the first CI run read the image, which filled the copy, then the video, and found the old one: the page had said "Posted" and its card was the video's); it never retries the test.
  - **Preview is off until the form has mounted** (a click before then is the browser's own submit, which loses what was typed); an edit of anything hides Post until the next Preview; Post sends exactly the previewed post under its own request ID, so a second press answers the same card.
  - **Uploads:** only metadata passes the server actions; the `PUT` is sent as the type the link was signed for; request IDs are made in the browser; a file's IDs and ready media are kept while the page is open, so a second Preview sends nothing twice, and a file whose words, still image, agent or kind differ is a new upload (a ready media's words never change).
  - **M4b (the founder's explainer video, section 9.6) is not built:** M4 is unproven until its preview, and a second feature on the same unproven path would put two unverified pieces behind one check; it follows M4's merge.
  - **Proven here:** `next build` builds the route and no client chunk holds the placeholder maker; the form, preview and Hrizzup's form pass the screen check's layout rules in Chromium and WebKit at every size, sideways and at 200% text; there is no Content-Security-Policy, and the staging uploads bucket's CORS rule allows previews, `PUT` and `content-type`. **Unproven until the preview:** the browser's cross-origin `PUT` in WebKit with a route on the page (the resizes only are routed), the bucket's CORS from a preview's own origin, and the Speed check's first measure of `social-story-media`. Staging's done-test (the coordinator makes Hrizzup from this page after M4 merges) is the last step.

---

## 16. The story page's load time (19 November 2026): a proposal, not built

- **Status (the coordinator, 19 November 2026): what follows is the expert's proposal, not what is built, and no later relay may read it as a rule.** R8 built the one thing within its own files instead: a story's own page shows its picture as the board's thumbnail (`story-picture.tsx` has no `hero` size; `story-tile.tsx` lays the page's tile out as the board's), so the page's largest content is its title, drawn at the first paint (checked in Chromium at 412 × 823, 1.75×, on the real page with stand-in data: the title is the largest contentful paint; the first desk picture starts below 1,200 px; unproven for the Speed check's own numbers until its run on the pull request). The Vercel rewrite (16.2, 16.4), a photographic hero (16.5) and every rule that depends on them wait for the founder and the design chat.

PR #201's Speed check measured `social-story-media` (the kept media fixture's story, signed out) at 3.49, 2.71, 2.70, 2.71 and 2.71 s for the largest content against the 2.50 s budget: the median passed only by the check's 250 ms tolerance. The board fixture's story page (no picture) read 1.25 s. Section 8.5's remedy (the hero's size or widths) can't move this number; the measurements below show what does.

### 16.1 What was measured

Lighthouse 13.6.0 run exactly as the Speed check runs it (mobile preset, simulated throttling, one uncounted warm-up, then 5 runs), against staging from this Mac. Then Lighthouse's own estimator (`LanternLargestContentfulPaint`, trace engine 0.0.67) was re-run on one saved trace and DevTools log, with what-ifs edited into the log (scratch scripts, not kept).

- **Here and on CI.** The media page simulates at 2.18 to 2.20 s and the board story page at 0.79 s; both first paints are at 0.79 s. GitHub's runner adds about 0.5 s to both (1.25 s and 2.71 s). That is consistent with its distance from the Mumbai server counting as server time (inferred, not measured).
- **The largest content** is the hero `<img>`, drawn 380 × 214 px.
  - It is served as its 640 copy: 2.3 KB of AVIF, eager, `fetchpriority=high`.
  - It is found at byte 4,013 of 65 KB of HTML (the head is 1.7 KB), and Lighthouse's discovery insight passes all three of its checks.
  - The real load is fast: first byte 11 ms, load delay 112, load 20, render delay 32, and first paint and largest paint both at 125 ms.
- **The simulated path, 2,138 ms:**
  - the document, 0 to 788 ms;
  - the stylesheet to 938 and the font to 1,088;
  - the scripts one after another on the page's HTTP/2 connection, to 2,138 (the 73 KB chunk alone takes 600 ms);
  - the hero, 788 to 1,557, on a new connection of its own (DNS 300 ms, TCP 225, TLS 150, server and first byte about 95).

  **The hero is not the last node; the scripts are.**
- **Why: four rules of the estimator (trace engine 0.0.67's Lantern):**
  - `LargestContentfulPaint`: when the largest content is text drawn at the first paint, the estimate is the first paint's own graph (the board pages' 0.79 s). Otherwise it counts every request that finished before the observed paint. The scripts finished at 107 to 124 ms and the paint came at 125, so every page led by a picture carries the site's 157 KB of styles, font and scripts.
  - `ConnectionPool` (`forceCoarseEstimates: true`): the first request to every origin pays a cold connection, whatever the page hinted.
  - `PageDependencyGraph.linkCPUNodes`: a picture depends only on the request that found it, here the document.
  - `Simulator.updateNetworkCapacity`: bandwidth is split evenly among the requests in progress, including a connection still in its handshake. The media host's 770 ms of connecting therefore halves the scripts' bandwidth: the 73 KB chunk takes 600 ms instead of 300.

| What-if, re-simulated on the same trace (this Mac) | Hero on the media host | Hero on the page's own origin |
|---|---|---|
| As served (2.3 KB) | 2,138 ms | 1,688 ms |
| Hero of 40 KB / 80 KB / 120 KB | 2,288 / 2,438 / 2,607 | 1,838 / 1,988 / 2,288 |
| Paint at 105 ms, before the scripts end | 1,557 | 938 |
| Paint at 200 ms, a slow first resize | 2,963 | 2,513 |

- **CI's 3.49 s first run is consistent with a late paint** (inferred: a cold first resize at the runner's Cloudflare location). A late paint also pulls in the Vercel Toolbar's script (`vercel.live`, another origin, on previews and staging only) and the scripts' own work.
- **To read the table in CI terms,** add about 0.57 s (2.71 against 2.14).
- **What photos weigh.** The repository's `sharp`, on a procedural photo-like texture, makes AVIF copies of 12 to 23 KB at 640 wide and 27 to 43 KB at 960. Lighthouse's phone (412 px wide, at 1.75×) fetches the 960 copy of any picture 1,280 wide, as the trace's image post did.
- **The board with a thumbnail tile first** (staging today): its largest content is text (the intro paragraph, 380 × 72) at the first paint, 0.79 s. The thumbnail is lazy, low priority and 1.9 KB, so the estimate never counts it.

### 16.2 The proposed decision

Every picture the website draws is served from the page's own origin. One Vercel rewrite of `/_media/cdn-cgi/image/…`, in `next.config.ts`, forwards it to the media host; Cloudflare still resizes and caches it, and Vercel's edge caches it too.

- **What it saves.** The hero joins the page's warm HTTP/2 connection: 450 ms less at every picture weight in the simulation (about 2.71 to 2.26 s on CI for the fixture), and readers' browsers skip a second handshake.
- **What doesn't change.** The API's addresses stay as they are: only the markup maps them. Video and audio files still come from the media host, on tap.
- **What goes.** The `preconnect()` that never reaches the page.
- **What follows.** The kept fixture then gets a photographic hero (16.5), so the check measures a picture of real weight. Today's 2 KB gradient flatters every option.

### 16.3 Rejected

- **`preconnect`** gets no credit: the estimator ignores it (`forceCoarseEstimates`), and `PostMedia`'s call never reaches the served page (not in the head, not in the `Link` header).
- **`preload`** (with `imagesrcset`, `imagesizes` and high priority) gets no credit in the estimator, since a picture waits for the document either way, and gains nothing in a browser, since the `<img>` is in the first 4 KB. A preload that doesn't match the `<source>` exactly downloads twice.
- **Smaller widths or `sizes`** save 0 ms for the fixture, whose picture isn't on the path. For photos they save about 150 ms per 40 KB: a second lever, kept as 16.5's fallback.
- **A hero smaller than the text** doesn't hold for every story. The board fixture's three-line title covers 37.6k px² against the hero's 81.3k, and a one-line title covers only 8k to 14k, so only a thumbnail is safe: no hero.
- **A route handler that streams pictures** would run a function per picture, with cold starts and transfer from Vercel's functions.
- **`next/image` with Vercel's optimizer** is ruled out: CLAUDE.md puts pictures through Cloudflare's transformations.
- **Cloudflare in front of the whole site** is ruled out: Vercel advises against a proxy before its firewall, and previews on `*.vercel.app` couldn't use it, so the check would never see it.
- **Caching the story page's HTML at the edge** would take about 0.5 s off the CI runner's distance, but it is R5's page and a larger change (16.8).
- **Turning off the Vercel Toolbar for the check** is ruled out: it is the founder's setting, and it matters only on late paints.

### 16.4 Proposed rules (M5, not built)

1. **`W/lib/social/media/delivery.ts`:**
   - Add `export const MEDIA_PATH = '/_media'`.
   - `transformed(url, width)` answers the page's own address, `` `${MEDIA_PATH}/cdn-cgi/image/width=${width},format=auto${pathname}` ``, built from the media URL's pathname only (its origin, query and fragment are dropped).
   - `imageSet` is otherwise unchanged (the same widths and the same `src` choice), so `MediaImage`, `PostMedia`'s poster and the console's `post-preview.tsx` all follow.
   - The comments say why: one origin means no second connection, in the estimator or the browser.
2. **New `W/lib/social/media/rewrite.ts` (R8's): `mediaRewrites(env)`.**
   - It answers `[]` when `mediaBase(env)` is null; the API then serves no pictures either (`url.ts`), so no markup points at the route.
   - Otherwise it answers one rule per width of `WIDTHS`, each with literal options and no pattern: source `` `${MEDIA_PATH}/cdn-cgi/image/width=<w>,format=auto/:key+` ``, destination `` `${base}/cdn-cgi/image/width=<w>,format=auto/:key+` ``.
   - So only the four forms `delivery.ts` writes are forwarded. Raw files, other options and other paths get the site's 404: the site never relays video, audio or other resizes.
   - **Proven with Next 16.4.6's own `getPathMatch` and `prepareDestination`:**
     - the 320 rule matches `/_media/cdn-cgi/image/width=320,format=auto/social/<id>/<id>.png`, with `key` its three segments;
     - it doesn't match `width=333`, an empty key or a bare `/_media/<key>`;
     - it resolves to `https://media-staging.hrizzup.com/cdn-cgi/image/width=320,format=auto/<key>`, with no query added.
   - **`W/proxy.ts` never runs for these addresses:** its matcher is `/sign-in-test`, `/console…` and `/sandbox…`. A later change to that matcher must keep `/_media/` out of it, or every picture would run the proxy: a later paint, a refreshed session's `set-cookie` (which Vercel won't cache), and possible redirects.
3. **`W/next.config.ts`:** add `async rewrites() { return mediaRewrites(process.env); }` and change nothing else.
   - This is the one file outside R8's own, and it is truly needed: only a rewrite puts the media host under the page's origin.
   - `vercel.json` can't hold it, because the destination differs per environment and comes from `MEDIA_BASE_URL`, which Vercel has at build time.
   - **Caching:**
     - Vercel caches an outside origin's answers by their `Cache-Control` by default for projects created since 6 April 2026; this one dates from November 2026.
     - Cloudflare answers `public, max-age=31536000, immutable` and `vary: accept`, with no `set-cookie`.
     - Vercel's cache key includes `Accept` and `Accept-Encoding` by default.
     - So no header is added. The pull request proves a repeat request answers `x-vercel-cache: HIT`; if it doesn't, add `x-vercel-enable-rewrite-caching: 1` for the same source in `W/vercel.json`'s `headers`, as Vercel documents.
4. **`post-media.tsx`:** remove the `preconnect` import, both calls and their comment. Nothing on the page reaches the media host before a tap.
5. **`story-picture.tsx` and `media-image.tsx`:** no change. The hero stays eager with `fetchPriority="high"`, other pictures stay lazy, and every box keeps its size (no hero exists since R8).
6. **Journeys, equally strict, with transformations still stubbed.** `W/e2e/journeys/social-media-pages.spec.ts`:
   - It routes `${BASE}/_media/cdn-cgi/image/**` (answered with a stub picture and recorded), and still routes `${mediaOrigin}/**` (stub bytes, recorded).
   - Any `/cdn-cgi/image/` request to the media host fails the test.
   - Every `srcset` entry of the hero and of the image post starts with `/_media/cdn-cgi/image/width=`.
   - Nothing reaches the media host's origin before the first tap, and each tap asks for exactly its file's address there.
   - One real request, not routed, proves the rewrite: `GET ${BASE}/_media/cdn-cgi/image/width=320,format=auto/<the kept image's key>`.
     - With `Accept: image/avif,image/webp,*/*` it answers 200 `image/avif`.
     - With `Accept: image/webp,*/*` it answers `image/webp`.
     - With `width=333` it answers 404.

   `W/e2e/journeys/social-house-pages.spec.ts` (its resize routes) and `W/e2e/done/social-r8.spec.ts` move their picture routes and checks to `/_media/` the same way. Grep `e2e`, `lib` and `components` (`post-card.test.ts`, `media-player.test.ts` and others) for `mediaOrigin`, `cdn-cgi` and `media-staging`, and restate each check about page markup without weakening it. Checks of the API's own addresses stay as they are.
7. **This note:** 8.1's `preconnect` line and 8.5 point to this section.
8. **If M5's preview median is over 2.50 s,** M5 stays unmerged, the reason goes in its pull request and the status file, and it comes back to the expert with that run's Lighthouse report (the Speed check keeps the report of every run over budget).

### 16.5 The photographic fixture (M5b, its own pull request, after M5 merges)

1. **`W/lib/social/media/samples.ts`:** add `sampleTexturedJpeg({width, height})`.
   - It is a seeded texture: value noise per channel at cells of 256, 64, 16, 4 and 2 px (amplitudes 0.5, 0.25, 0.13, 0.08 and 0.04), plus one hard-edged rectangle, written as a JPEG at quality 90.
   - It uses no outside image, so no licence applies.
2. **`W/e2e/fixtures/social/media.ts`:** a fourth post on the fixture's desk.
   - It is an image post of a 1,280 × 720 textured JPEG, described "A textured test picture standing in for a photograph", with a fixed request ID.
   - It is made only while the story's picture isn't that picture, and posted last, so it becomes the newest picture and therefore the hero (rule D5).
   - Lighthouse's phone then fetches its 960 copy.
3. **Its pull request records** the media host's 960 AVIF weight of that picture (one `GET`; 30 to 80 KB expected) and the Speed check's median.
4. **Order (the fixture is shared staging data):**
   - The post appears on staging as soon as M5b's own Screen check runs, and every preview reads it.
   - By the table, a preview without M5 would measure a hero of about 40 KB from the media host: about 2.86 s on CI, past the 2.75 s limit.
   - So M5b is opened only when every open pull request that builds the website sits on a `main` that holds M5; the coordinator checks the round's open PRs first, and others rebase or M5b waits.
   - M5b's own Speed check may still measure either hero; both pass with M5.
5. **Fallback, only if that median is over 2.40 s:**
   - `MediaImage` gains `narrowMaxWidth?: number`, which draws `<source media="(max-width: 639.98px)" srcSet=<the copies at or under it> sizes="100vw"/>` before its other `<source>`.
   - The hero passes 640.
   - The cost: phones at 3× get a softer hero.

### 16.6 Edge cases

- **A change to `MEDIA_BASE_URL`** takes effect at the next deployment, since the rewrite is built in (staging redeploys on every merge, production on release).
- **A cold resize, or a new deployment's empty cache,** costs one extra hop and is then cached. The median absorbs a slow first run.
- **Each browser's `Accept`** gets its own entry, and Cloudflare answers AVIF, WebP or the original accordingly.
- **Staging's bot challenge:** `/_media/` requests are same-origin, like the page's own code and styles, so they should pass as those do (inferred). The done-test proves it signed out, in both engines.
- **Previews:** the protection-bypass cookie is the preview origin's own, so it covers the pictures.
- **Removing media** (nothing does yet): copies stay cached for a year at Cloudflare's edge and now at Vercel's too. Whatever first removes media must purge both (Vercel's by a cache tag added then).
- **Cookies:** on a cache miss the reader's cookies are forwarded to the media host. It is our own Cloudflare zone, not a third party, and its answers set no cookie.

### 16.7 Tests that must exist

1. **`delivery.test.ts`:** `src` and every `srcSet` entry are `/_media/cdn-cgi/image/width=<w>,format=auto<pathname>`; the media URL's origin, query and fragment never appear; the widths rule is unchanged.
2. **`rewrite.test.ts`:**
   - no rules without `MEDIA_BASE_URL`, or with an invalid one;
   - with a valid one, exactly one rule per width, matching `WIDTHS` and with the literal forms above;
   - a test that pins `next.config.ts` returning `mediaRewrites(process.env)`.
3. **The render tests** (`media-image`, `story-picture`, `post-media`, `post-preview`) (no hero exists since R8):
   - no absolute media-host address in any `src`, `srcset` or `poster`;
   - the hero is eager and `fetchpriority="high"`;
   - `post-media.tsx` no longer imports `preconnect`.
4. **The pages journey,** as in rule 6, in both engines.
5. **The Speed check on M5's preview:** `social-story-media`'s median is at most 2.50 s (about 2.2 to 2.3 s expected), and no run is over it except a cold first one.
6. **M5b:** the same check with the textured hero, at most 2.40 s, or else the fallback.

### 16.8 For the founder and the open questions

- **Vercel now carries the website's picture bytes** (Fast Data Transfer and CDN requests on the existing Pro plan). Cloudflare R2's own delivery stays free. This costs nothing on staging; at launch it is a per-gigabyte cost that Cloudflare alone didn't have. Recommendation: accept it for faster pages, and review the bill in the pre-launch checklist.
- **Caching story pages' HTML at the edge** (R5's page, refreshed by its tags) would take about 0.5 s off every page the check measures from the US, and would help readers far from Mumbai. Recommendation: a later milestone.
- **M5b's order rule** (16.5, rule 4) holds the round's other website pull requests to a `main` with M5. The coordinator applies it.

Advisor (Fable 5.2), consulted twice:
- **The first review** had the what-ifs judged in CI terms and at real photo weights. That showed same-origin alone thins out for heavy photos, hence 16.5's photographic fixture and its fallback. It also asked for:
  - the paint-time what-ifs, which fit CI's 3.49 s first run;
  - Vercel's caching, `Accept` keying and metering, read from its docs;
  - the layout option judged against a one-line title (thumbnail-sized only, so rejected);
  - the board measured with a thumbnail tile first (text, 0.79 s);
  - the dead `preconnect` named.
- **The second review** had `W/proxy.ts`'s matcher checked (it excludes `/_media/`), the rule proven with Next's own matcher, M5b's order rule added for the shared fixture, inferences labelled as such, the failure path written (16.4, rule 8), and the test grep widened to `lib` and `components`.
