-- The content store's tables (PLAN.md step 1.9; blueprint section 5, "The content store's
-- tables"; the founder's decision, 9 November 2026).
--
-- Tables for the shapes in the hand-over agreement's first half (agreement/README.md, Agreed on
-- 9 November 2026, format version 1): stories, updates, sourced items and creations, with the
-- launch list of locations and categories. One table per shape and one row per record; each
-- column is one of the shape's fields, named as the agreement names it (a nested object's fields
-- are flattened: a sourced item's `post.url` is `post_url`), so every record is stored and read
-- back exactly as it was written.
--
-- Every rule in the agreement that a database can hold is a rule here, so no writer, and no bug
-- in one, can store a record the agreement refuses. infra/supabase/content-store.md lists each
-- rule and where it's enforced. In short:
--   - one record at a time: each field's kind, length, pattern and list, and which fields go
--     together (domains and check constraints), checked by every statement;
--   - across records: what a record names exists; merges never chain; a merged story keeps no
--     updates or sourced items; a correction or a repeat stays in its own story. These are
--     checked when the transaction commits, so a change that spans records (a merge, with its
--     updates and sourced items moving to the story that stays) can be made in any order within
--     one transaction.
-- The content store is changed only in read committed transactions, Postgres's default: the
-- rules across records are written for it, each check seeing what has committed by then and
-- locking what it relies on. Repeatable read and serializable would show a check an older
-- snapshot, and serializable protects only against other serializable transactions.
--
-- Two schemas:
--   agreement  the agreement's shared lists (locations, categories, routes) and building blocks
--              (a record's ID, one line of plain text...), for every store that holds the
--              agreement's shapes: this one now, and the markets (step 1.7c), which share the
--              categories;
--   content    the content store's tables.
--
-- Locked like every table (the first migration switches row-level security on), with no
-- policies, and no rights for any role but their owner: nothing writes to these tables, reads
-- them or fills them until the steps that use them (the news pipeline, 1.1; each news feature's
-- back end; the markets' categories, 1.7c).
--
-- Copies kept honest: the database can't read the agreement's files, so its lists' codes, the
-- patterns, the value lists and the limits are written out here. The Database check fails the
-- moment any of them differs from agreement/definitions/ (infra/supabase/tests/agreement/).

create schema if not exists agreement;
comment on schema agreement is
  'The hand-over agreement''s shared lists and building blocks (agreement/definitions/), for every '
  'store that holds its shapes. Never exposed to the browser or the app.';

create schema if not exists content;
comment on schema content is
  'The content store (PLAN.md step 1.9): stories, updates, sourced items and creations, as the '
  'hand-over agreement defines them. Never exposed to the browser or the app.';

revoke all on schema agreement from public;
revoke all on schema content from public;


-- ---------------------------------------------------------------------------------------------
-- The shared lists (agreement/definitions/lists.schema.json): the codes records carry, in the
-- agreement's order. Names and what each item covers stay in the agreement, where screens and
-- our AI read them, so improving a name never needs a database change. Each list is a type, so
-- every column that holds it (one code, or a list of codes) accepts only its codes, in every
-- table that uses it, the markets' included. A code never changes; adding an item, once the
-- founder approves it, is one line in a migration: alter type agreement.category add value '…'.
-- ---------------------------------------------------------------------------------------------

create type agreement.location as enum ('global', 'india', 'mumbai', 'delhi-ncr', 'bengaluru');
comment on type agreement.location is
  'Where a story matters (agreement/definitions/lists.schema.json, "location"): global, national '
  '(india) or local (an Indian city). The launch list, approved by the founder on 5 November 2026.';

create type agreement.category as enum (
  'crypto', 'finance', 'business', 'ai', 'sports', 'politics', 'entertainment', 'general'
);
comment on type agreement.category is
  'What a story, a post or a market is about (agreement/definitions/lists.schema.json, '
  '"category"). The launch list, approved by the founder on 5 November 2026.';

create type agreement.route as enum ('found', 'made', 'posted');
comment on type agreement.route is
  'How a feed item reached the product, which decides how it is credited '
  '(agreement/definitions/lists.schema.json, "route").';


-- ---------------------------------------------------------------------------------------------
-- Building blocks (agreement/definitions/common.schema.json). Each holds its block's rules, so
-- every column of its kind holds them too. Patterns are the agreement's own, character for
-- character (Postgres reads them the way JavaScript does, `$` included: it matches only at the
-- very end, so no text can end in a new line).
-- ---------------------------------------------------------------------------------------------

create domain agreement.record_id as uuid
  constraint record_id_version_7
    check (value is null or uuid_extract_version(value) is not distinct from 7);
comment on domain agreement.record_id is
  'A record''s own ID: a UUID, version 7, made once by whoever writes the record '
  '(common.schema.json, "record_id"). Stored as a number, so it always reads back in lower case.';

create domain agreement.time as timestamptz
  constraint time_range
    check (value >= '0001-01-01 00:00:00+00' and value < '10000-01-01 00:00:00+00');
comment on domain agreement.time is
  'A moment in time (common.schema.json, "time"): read back in UTC, like 2026-11-05T09:30:00Z, '
  'to the microsecond. Never infinite, and within years 1 to 9999, as the agreement writes them.';

-- The agreement's four checks on plain text that its patterns leave to code (agreement/README.md,
-- "Outside data is data, never instructions"), which every language adds with its own Unicode
-- data. These are the same four as validate()'s, for Unicode 17 (Node 24's):
--   1. no invisible character: beyond what the patterns already refuse in Unicode's main range,
--      every format, private-use and default-ignorable character in the other planes (the tag
--      characters, the extra variation selectors and every character reserved for them among
--      them); the joiner and the two variation selectors emoji use are the only exceptions;
--   2. no two variation selectors in a row;
--   3. a zero-width joiner only inside an emoji: never at either end, next to another joiner,
--      or next to a plain (ASCII) character or a new line;
--   4. no new line at the very end.
-- The Database check compares this with validate() for every character there is, so a newer
-- Unicode on either side can't make them differ unnoticed.
create function agreement.passes_code_checks(value text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select value !~ '[\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF\U000F0000-\U000FFFFD\U00100000-\U0010FFFD]'
     and value !~ '[\uFE00-\uFE0F]{2}'
     and value !~ '^\u200D|\u200D$|\u200D\u200D|[\n -~]\u200D|\u200D[\n -~]'
     and value !~ '\n$';
$$;
comment on function agreement.passes_code_checks(text) is
  'True when plain text passes the agreement''s four checks in code (hidden characters, stacked '
  'variation selectors, stray joiners, a final new line), as validate() makes them.';

create domain agreement.one_line as text
  constraint one_line_pattern check (value ~ '^[^\u0000-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f-\u1160\u17b4-\u17b5\u180b-\u180f\u200b-\u200c\u200e-\u200f\u2028-\u2029\u202a-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufe00-\ufe0d\ufeff\uffa0\ufff0-\ufffb ](?:[^\u0000-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f-\u1160\u17b4-\u17b5\u180b-\u180f\u200b-\u200c\u200e-\u200f\u2028-\u2029\u202a-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufe00-\ufe0d\ufeff\uffa0\ufff0-\ufffb]*[^\u0000-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f-\u1160\u17b4-\u17b5\u180b-\u180f\u200b-\u200c\u200e-\u200f\u2028-\u2029\u202a-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufe00-\ufe0d\ufeff\uffa0\ufff0-\ufffb ])?$')
  constraint one_line_code_checks check (agreement.passes_code_checks(value))
  constraint one_line_length check (char_length(value) <= 300);
comment on domain agreement.one_line is
  'One line of plain text: no spaces at either end, and no control, direction or other '
  'invisible characters but the joiner inside some emoji (common.schema.json, "one_line"). '
  'Each column adds its own, shorter limit.';

create domain agreement.plain_text as text
  constraint plain_text_pattern check (value ~ '^[^\u0000-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f-\u1160\u17b4-\u17b5\u180b-\u180f\u200b-\u200c\u200e-\u200f\u2028-\u2029\u202a-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufe00-\ufe0d\ufeff\uffa0\ufff0-\ufffb ](?:[^\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f-\u1160\u17b4-\u17b5\u180b-\u180f\u200b-\u200c\u200e-\u200f\u2028-\u2029\u202a-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufe00-\ufe0d\ufeff\uffa0\ufff0-\ufffb]*[^\u0000-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f-\u1160\u17b4-\u17b5\u180b-\u180f\u200b-\u200c\u200e-\u200f\u2028-\u2029\u202a-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufe00-\ufe0d\ufeff\uffa0\ufff0-\ufffb ])?$')
  constraint plain_text_code_checks check (agreement.passes_code_checks(value))
  constraint plain_text_length check (char_length(value) <= 5000);
comment on domain agreement.plain_text is
  'Plain text, new lines allowed, but not at either end (common.schema.json, "text"). Each '
  'column adds its own, shorter limit.';

create domain agreement.web_address as text
  constraint web_address_pattern check (value ~ '^https://[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::[0-9]{1,5})?(?:[/?#][^\u0000-\u0020\u007f-\u009f\\]*)?$')
  constraint web_address_length check (char_length(value) <= 2048)
  -- The characters a web address can hold under the standard the agreement's `format: uri`
  -- follows (RFC 3986): plain ASCII letters and digits and the address's own marks, with `%`
  -- only before two hexadecimal digits. So no hidden, direction or non-ASCII look-alike character can sit
  -- in a link; validate() also checks where each mark may go.
  constraint web_address_characters
    check (value ~ '^[A-Za-z0-9._~:/?#@!$&''()*+,;=%-]*$' and value !~ '%(?![0-9A-Fa-f]{2})');
comment on domain agreement.web_address is
  'A public web address starting https:// (common.schema.json, "web_address"), in the characters '
  'a web address can hold. Shown as a plain link; our software never follows it on its own.';

create domain agreement.media_key as text
  constraint media_key_pattern check (value ~ '^(?:[a-z0-9][a-z0-9_-]*/)*[a-z0-9][a-z0-9_.-]*\.(?:avif|jpeg|jpg|png|webp)$')
  constraint media_key_length check (char_length(value) <= 300);
comment on domain agreement.media_key is
  'Where a file sits in our media storage, never a full web address (common.schema.json, '
  '"media_key").';

create domain agreement.placeholder as text
  constraint placeholder_pattern check (value ~ '^[A-Za-z0-9+/]+={0,2}$')
  constraint placeholder_length check (char_length(value) between 16 and 100);
comment on domain agreement.placeholder is
  'A tiny blurred preview (a ThumbHash), in base64 (common.schema.json, "placeholder").';

create domain agreement.pixels as integer
  constraint pixels_range check (value between 1 and 10000);
comment on domain agreement.pixels is 'A size in whole pixels (common.schema.json, "pixels").';

create domain agreement.stream_id as text
  constraint stream_id_pattern check (value ~ '^[0-9a-f]{32}$');
comment on domain agreement.stream_id is
  'A video''s ID in our video service, Cloudflare Stream (common.schema.json, "video").';

-- A list of items, as the agreement's lists are: 1 to `at_most` of them, none missing and none
-- repeated, in one row (a plain, one-dimensional list counted from 1). Their order is kept, so
-- the main one stays first.
create function agreement.is_list(items anyarray, at_most integer)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select array_ndims(items) = 1
     and array_lower(items, 1) = 1
     and cardinality(items) between 1 and at_most
     and array_position(items, null) is null
     and (select count(distinct item) from unnest(items) as item) = cardinality(items);
$$;
comment on function agreement.is_list(anyarray, integer) is
  'True for a list the agreement accepts: 1 to at_most items, none missing, none repeated.';

-- A list of record IDs: a list, as above, of version 7 UUIDs. Lists of IDs are plain uuid[], so
-- the database's own array operators and indexes work on them directly.
create function agreement.is_id_list(ids uuid[], at_most integer)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select agreement.is_list(ids, at_most)
     and not exists (select 1 from unnest(ids) as id where uuid_extract_version(id) is distinct from 7);
$$;
comment on function agreement.is_id_list(uuid[], integer) is
  'True for a list of 1 to at_most record IDs (version 7 UUIDs), none missing, none repeated.';


-- ---------------------------------------------------------------------------------------------
-- The content store's own building blocks: the shapes' fields with patterns of their own.
-- ---------------------------------------------------------------------------------------------

create domain content.x_post_url as text
  constraint x_post_url_pattern check (value ~ '^https://x\.com/[A-Za-z0-9_]{1,15}/status/[1-9][0-9]{0,19}$')
  constraint x_post_url_not_handle_free check (value !~ '^https://x\.com/i/');
comment on domain content.x_post_url is
  'A post''s standard address on X: the account''s handle, then the post''s number, never the '
  'handle-free form Grok cites (sourced.v1.schema.json, "post.url").';

create domain content.x_handle as text
  constraint x_handle_pattern check (value ~ '^[A-Za-z0-9_]{1,15}$');
comment on domain content.x_handle is
  'A handle on X, without the @ (sourced.v1.schema.json, "post.handle").';

create domain content.source_address as agreement.web_address
  constraint source_address_not_on_x check (value !~ '^https://(?:[A-Za-z0-9-]+\.)*(?:[Xx]\.[Cc][Oo][Mm]|[Tt][Ww][Ii][Tt][Tt][Ee][Rr]\.[Cc][Oo][Mm]|[Tt][Ww][Ii][Mm][Gg]\.[Cc][Oo][Mm]|[Tt]\.[Cc][Oo])\.?(?:[/?#:]|$)');
comment on domain content.source_address is
  'A public page an update is based on: a web address, never anything at X''s own addresses '
  '(x.com, twitter.com, t.co, twimg.com), whose posts are named by their sourced items instead '
  '(update.v1.schema.json, "sources").';

-- A post's number on X, from its standard address: the post's identity, since a handle can
-- change. The sourced pool keeps each post once, by this number.
create function content.post_number(post_url text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select split_part(post_url, '/', 6);
$$;
comment on function content.post_number(text) is
  'The post''s number, from its standard address on X (https://x.com/<handle>/status/<number>).';


-- ---------------------------------------------------------------------------------------------
-- Stories (agreement/definitions/story.v1.schema.json).
-- ---------------------------------------------------------------------------------------------

create table content.stories (
  id agreement.record_id primary key,
  title agreement.one_line not null
    constraint stories_title_length check (char_length(title) <= 120),
  summary agreement.plain_text not null
    constraint stories_summary_length check (char_length(summary) <= 300),
  locations agreement.location[] not null
    constraint stories_locations_list check (agreement.is_list(locations, 3)),
  categories agreement.category[] not null
    constraint stories_categories_list check (agreement.is_list(categories, 3)),
  state text not null
    constraint stories_state_values check (state in ('live', 'merged', 'withdrawn')),
  merged_into agreement.record_id
    constraint stories_merged_into_story references content.stories (id)
      deferrable initially deferred,
  withdrawn_reason agreement.one_line
    constraint stories_withdrawn_reason_length check (char_length(withdrawn_reason) <= 200),
  created_at agreement.time not null,
  updated_at agreement.time not null,
  constraint stories_merged_into_only_when_merged
    check ((state = 'merged') = (merged_into is not null)),
  constraint stories_withdrawn_reason_only_when_withdrawn
    check ((state = 'withdrawn') = (withdrawn_reason is not null)),
  constraint stories_not_merged_into_itself check (merged_into <> id)
);
comment on table content.stories is
  'Stories (story/1): a piece of news that develops over time. Written by the news pipeline '
  '(step 1.1); nothing writes or reads it yet.';
comment on column content.stories.locations is
  'Where the story matters, the main one first: 1 to 3, no repeats.';
comment on column content.stories.categories is
  'What the story is about, the main one first: 1 to 3, no repeats.';
comment on column content.stories.merged_into is
  'Only when merged: the story it went into, which is never merged itself.';

create index stories_merged_into on content.stories (merged_into) where merged_into is not null;


-- ---------------------------------------------------------------------------------------------
-- Updates (agreement/definitions/update.v1.schema.json).
-- ---------------------------------------------------------------------------------------------

create table content.updates (
  id agreement.record_id primary key,
  story_id agreement.record_id not null
    constraint updates_story_id_story references content.stories (id)
      deferrable initially deferred,
  headline agreement.one_line not null
    constraint updates_headline_length check (char_length(headline) <= 120),
  body agreement.plain_text
    constraint updates_body_length check (char_length(body) <= 1000),
  reported_at agreement.time not null,
  based_on uuid[]
    constraint updates_based_on_list check (agreement.is_id_list(based_on, 10)),
  sources content.source_address[]
    constraint updates_sources_list check (agreement.is_list(sources, 10)),
  corrects agreement.record_id
    constraint updates_corrects_update references content.updates (id)
      deferrable initially deferred,
  state text not null
    constraint updates_state_values check (state in ('live', 'merged', 'withdrawn')),
  merged_into agreement.record_id
    constraint updates_merged_into_update references content.updates (id)
      deferrable initially deferred,
  withdrawn_reason agreement.one_line
    constraint updates_withdrawn_reason_length check (char_length(withdrawn_reason) <= 200),
  created_at agreement.time not null,
  updated_at agreement.time not null,
  constraint updates_names_what_it_is_based_on check (based_on is not null or sources is not null),
  constraint updates_merged_into_only_when_merged
    check ((state = 'merged') = (merged_into is not null)),
  constraint updates_withdrawn_reason_only_when_withdrawn
    check ((state = 'withdrawn') = (withdrawn_reason is not null)),
  constraint updates_not_correcting_itself check (corrects <> id),
  constraint updates_not_merged_into_itself check (merged_into <> id)
);
comment on table content.updates is
  'Updates (update/1): one development in a story; a story''s updates, by reported_at, are its '
  'timeline. Written by the news pipeline (step 1.1); nothing writes or reads it yet.';
comment on column content.updates.based_on is
  'The sourced items (posts our bots found) this update reports: 1 to 10, no repeats.';
comment on column content.updates.sources is
  'The other public pages it is based on, never on X: 1 to 10, no repeats.';

create index updates_timeline on content.updates (story_id, reported_at);
create index updates_corrects on content.updates (corrects) where corrects is not null;
create index updates_merged_into on content.updates (merged_into) where merged_into is not null;
create index updates_based_on on content.updates using gin (based_on);


-- ---------------------------------------------------------------------------------------------
-- Sourced items (agreement/definitions/sourced.v1.schema.json): the sourced pool.
-- ---------------------------------------------------------------------------------------------

create table content.sourced_items (
  id agreement.record_id primary key,
  route agreement.route not null
    constraint sourced_items_route_values check (route = 'found'),
  kind text not null
    constraint sourced_items_kind_values check (kind in ('news', 'take')),
  post_url content.x_post_url,
  post_handle content.x_handle,
  post_name agreement.one_line
    constraint sourced_items_post_name_length check (char_length(post_name) <= 80),
  post_posted_at agreement.time,
  post_media text
    constraint sourced_items_post_media_values check (post_media in ('text', 'image', 'video')),
  summary agreement.plain_text
    constraint sourced_items_summary_length check (char_length(summary) <= 300),
  story_ids uuid[]
    constraint sourced_items_story_ids_list check (agreement.is_id_list(story_ids, 3)),
  state text not null
    constraint sourced_items_state_values check (state in ('live', 'unavailable', 'withdrawn')),
  withdrawn_reason agreement.one_line
    constraint sourced_items_withdrawn_reason_length check (char_length(withdrawn_reason) <= 200),
  created_at agreement.time not null,
  updated_at agreement.time not null,
  -- An unavailable item keeps nothing of the post: not its address, its account, when it was
  -- posted, what it held, or our summary of it. Any other item keeps all of that (the name
  -- only when X shows a readable one).
  constraint sourced_items_unavailable_keeps_nothing_of_the_post check (
    state <> 'unavailable' or (
      post_url is null and post_handle is null and post_name is null
      and post_posted_at is null and post_media is null and summary is null
    )
  ),
  constraint sourced_items_keeps_its_post_while_available check (
    state = 'unavailable' or (
      post_url is not null and post_handle is not null and post_posted_at is not null
      and post_media is not null and summary is not null
    )
  ),
  -- The address and the handle name the same account (both from X at the last check); handles
  -- on X ignore letter case.
  constraint sourced_items_address_names_the_handle
    check (lower(split_part(post_url, '/', 4)) = lower(post_handle)),
  constraint sourced_items_take_names_a_story check (kind <> 'take' or story_ids is not null),
  constraint sourced_items_withdrawn_reason_only_when_withdrawn
    check ((state = 'withdrawn') = (withdrawn_reason is not null))
);
comment on table content.sourced_items is
  'Sourced items (sourced/1): the sourced pool, one thing the bots found on X per row, kept as a '
  'link, never a copy. Written by the news pipeline (step 1.1); nothing writes or reads it yet.';
comment on column content.sourced_items.story_ids is
  'The stories it belongs to, never a merged one: 1 to 3, no repeats.';

-- One item per post, by its number, whatever its state: a withdrawn item keeps its post so the
-- same post isn't kept again. An unavailable item holds no post, so a post that comes back is
-- kept again as a new item.
create unique index sourced_items_one_per_post
  on content.sourced_items (content.post_number(post_url));
create index sourced_items_story_ids on content.sourced_items using gin (story_ids);


-- ---------------------------------------------------------------------------------------------
-- Creations (agreement/definitions/creation.v1.schema.json): posts, made by News Desk or posted
-- in the app.
-- ---------------------------------------------------------------------------------------------

create table content.creations (
  id agreement.record_id primary key,
  route agreement.route not null,
  kind text not null
    constraint creations_kind_values check (kind in ('text', 'image', 'video')),
  author_kind text not null
    constraint creations_author_kind_values check (author_kind in ('hrizzup', 'creator', 'user')),
  author_account_id uuid not null
    constraint creations_author_account_id_account references auth.users (id)
      deferrable initially deferred,
  text agreement.plain_text
    constraint creations_text_length check (char_length(text) <= 2000),
  image_key agreement.media_key,
  image_width agreement.pixels,
  image_height agreement.pixels,
  image_alt agreement.one_line
    constraint creations_image_alt_length check (char_length(image_alt) <= 300),
  image_placeholder agreement.placeholder,
  video_stream_id agreement.stream_id,
  video_width agreement.pixels,
  video_height agreement.pixels,
  video_duration_seconds numeric
    constraint creations_video_duration_seconds_range
      check (video_duration_seconds > 0 and video_duration_seconds <= 3600),
  video_alt agreement.one_line
    constraint creations_video_alt_length check (char_length(video_alt) <= 300),
  video_placeholder agreement.placeholder,
  story_ids uuid[]
    constraint creations_story_ids_list check (agreement.is_id_list(story_ids, 3)),
  categories agreement.category[]
    constraint creations_categories_list check (agreement.is_list(categories, 3)),
  locations agreement.location[]
    constraint creations_locations_list check (agreement.is_list(locations, 3)),
  based_on uuid[]
    constraint creations_based_on_list check (agreement.is_id_list(based_on, 10)),
  created_at agreement.time not null,
  updated_at agreement.time not null,
  -- Its route follows from its author: made for our own content, posted for creators' and
  -- users' posts. Never found: that route is the sourced pool's.
  constraint creations_route_follows_the_author check (
    route = case author_kind when 'hrizzup' then 'made'::agreement.route
                             else 'posted'::agreement.route end
  ),
  constraint creations_text_has_words check (kind <> 'text' or text is not null),
  constraint creations_image_only_for_an_image check (
    (kind = 'image') = (image_key is not null)
    and (image_key is null) = (image_width is null)
    and (image_key is null) = (image_height is null)
    and (image_key is null) = (image_alt is null)
    and (image_key is null) = (image_placeholder is null)
  ),
  constraint creations_video_only_for_a_video check (
    (kind = 'video') = (video_stream_id is not null)
    and (video_stream_id is null) = (video_width is null)
    and (video_stream_id is null) = (video_height is null)
    and (video_stream_id is null) = (video_duration_seconds is null)
    and (video_stream_id is not null or (video_alt is null and video_placeholder is null))
  ),
  constraint creations_users_post_text check (author_kind <> 'user' or kind = 'text'),
  constraint creations_ours_and_creators_name_a_story_or_category
    check (author_kind = 'user' or story_ids is not null or categories is not null),
  constraint creations_based_on_only_for_made check (based_on is null or route = 'made')
);
comment on table content.creations is
  'Creations (creation/1): a post (text, one image or one video), made by News Desk or posted in '
  'the app. Nothing writes or reads it yet (News Desk, step 1.3; posting, step 2.4).';
comment on column content.creations.author_account_id is
  'The account it was posted from, set by our own software, never taken from the post.';

create index creations_author_account_id on content.creations (author_account_id);
create index creations_story_ids on content.creations using gin (story_ids);
create index creations_based_on on content.creations using gin (based_on);




-- ---------------------------------------------------------------------------------------------
-- The rules that span records, checked when the transaction commits, so a change that spans
-- records can be made in any order within one transaction. Each function runs as the tables'
-- owner (security definer), as Postgres's own foreign keys do, so it sees every row whatever the
-- writer may read; and it locks what it relies on until its transaction ends, so two
-- transactions can't each pass a rule and break it together.
-- ---------------------------------------------------------------------------------------------

-- Refuses a change that breaks one of the content store's rules, naming the rule the way
-- Postgres's own constraints do, so a writer (and the tests) can tell which rule it broke.
create function content.refuse(
  on_table text, rule text, problem text, fix text default null, code text default '23514'
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if fix is null then
    raise exception using
      errcode = code, schema = 'content', table = on_table, constraint = rule, message = problem;
  end if;
  raise exception using
    errcode = code, schema = 'content', table = on_table, constraint = rule, message = problem,
    hint = fix;
end;
$$;

-- The rules across records are written for read committed, Postgres's default: each check sees
-- what has committed by the time it runs, and locks what it relies on until its transaction
-- ends. Repeatable read and serializable show a check only what had committed when its
-- transaction began, and serializable guards only against other serializable transactions, so
-- a check there could miss a change another writer has just committed. Both are refused.
create function content.require_read_committed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = '25000',
      message = format(
        'The content store is changed only in read committed transactions '
        || '(a %s on content.%s, in %s)', lower(tg_op), tg_table_name,
        current_setting('transaction_isolation')),
      hint = 'Its rules across records must see what other writers have committed, as read '
        || 'committed (Postgres''s default) shows them.';
  end if;
  return null;
end;
$$;

-- A record's ID is made once by whoever writes the record, and never changed.
create function content.keep_record_ids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    perform content.refuse(tg_table_name, tg_table_name || '_id_never_changes',
      format('A record''s ID never changes (content.%s %s)', tg_table_name, old.id),
      'Write a new record instead.');
  end if;
  return new;
end;
$$;

-- An unavailable item is final: if the post comes back, it is kept again as a new item.
create function content.keep_unavailable_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'unavailable' and new.state <> 'unavailable' then
    perform content.refuse('sourced_items', 'sourced_items_unavailable_is_final',
      format('Sourced item %s is unavailable, which is final', old.id),
      'If the post comes back, keep it again as a new item.');
  end if;
  return new;
end;
$$;

-- Stories: merges never chain, and a merged story keeps no updates or sourced items.
create function content.check_story()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  story record;
  target_state text;
begin
  -- The story as it is now: a later statement in the transaction may have changed or removed it.
  select s.id, s.state, s.merged_into into story from content.stories s where s.id = new.id;
  if not found or story.state <> 'merged' then
    return null;
  end if;

  -- The story it went into isn't merged. Locking that story until this transaction ends means a
  -- merge of it can't commit in between: it waits, then sees this merge and is refused.
  select s.state into target_state from content.stories s where s.id = story.merged_into for share;
  if target_state = 'merged' then
    perform content.refuse('stories', 'stories_merges_never_chain',
      format('Story %s is merged into story %s, which is merged itself', story.id, story.merged_into),
      'Name the story that one went into: merged_into always names a story that isn''t merged.');
  end if;

  -- And no story names this one as where it went: when the story others went into is merged in
  -- turn, they are repointed in the same transaction.
  if exists (select 1 from content.stories s where s.merged_into = story.id) then
    perform content.refuse('stories', 'stories_merges_never_chain',
      format('Story %s is merged, but other stories still name it as where they went', story.id),
      'Repoint them to the story this one went into, in the same transaction.');
  end if;

  -- A merge moves the duplicate's updates and sourced items to the story that stays.
  if exists (select 1 from content.updates u where u.story_id = story.id) then
    perform content.refuse('stories', 'stories_merge_moves_its_updates',
      format('Story %s is merged, but updates are still in its timeline', story.id),
      'Move its updates to the story it went into, in the same transaction.');
  end if;
  if exists (select 1 from content.sourced_items i where i.story_ids @> array[story.id::uuid]) then
    perform content.refuse('stories', 'stories_merge_moves_its_sourced_items',
      format('Story %s is merged, but sourced items still name it', story.id),
      'Move its sourced items to the story it went into, in the same transaction.');
  end if;
  return null;
end;
$$;

-- Updates: in a story that isn't merged; based on sourced items that exist; a correction names
-- an earlier update in its story, live when the correction is written; a repeat names a live
-- update in its story, which is never merged itself; and what names an update follows it.
create function content.check_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
  other record;
  story_state text;
  found_count integer;
  -- Whether this change set what the update corrects or repeats: "live" is checked then, so a
  -- corrected or repeated update can still be withdrawn later (nothing stops a takedown).
  sets_corrects boolean;
  sets_merged_into boolean;
begin
  if tg_op = 'INSERT' then
    sets_corrects := true;
    sets_merged_into := true;
  else
    sets_corrects := old.corrects is distinct from new.corrects;
    sets_merged_into := old.merged_into is distinct from new.merged_into;
  end if;

  select x.id, x.story_id, x.reported_at, x.based_on, x.corrects, x.state, x.merged_into
    into u from content.updates x where x.id = new.id;
  if not found then
    return null;
  end if;

  -- Its story isn't merged: a merge moves the duplicate's updates to the story that stays.
  select s.state into story_state from content.stories s where s.id = u.story_id for share;
  if story_state = 'merged' then
    perform content.refuse('updates', 'updates_story_is_not_merged',
      format('Update %s is in story %s, which is merged', u.id, u.story_id),
      'Put it in the story that one went into.');
  end if;

  -- Every sourced item it's based on exists, and stays until this transaction ends.
  if u.based_on is not null then
    perform 1 from content.sourced_items i where i.id = any (u.based_on) for key share;
    get diagnostics found_count = row_count;
    if found_count <> cardinality(u.based_on) then
      perform content.refuse('updates', 'updates_based_on_sourced_items',
        format('Update %s is based on a sourced item that doesn''t exist', u.id), null, '23503');
    end if;
  end if;

  -- What it corrects. (One that doesn't exist is the foreign key's to refuse.)
  if u.corrects is not null then
    select x.story_id, x.reported_at, x.state into other
      from content.updates x where x.id = u.corrects for share;
    if found then
      if other.story_id <> u.story_id then
        perform content.refuse('updates', 'updates_correction_stays_in_its_story',
          format('Update %s corrects update %s, which is in another story', u.id, u.corrects));
      end if;
      if not other.reported_at < u.reported_at then
        perform content.refuse('updates', 'updates_correction_comes_later',
          format('Update %s corrects update %s, which wasn''t reported before it', u.id, u.corrects));
      end if;
      if sets_corrects and other.state <> 'live' then
        perform content.refuse('updates', 'updates_correction_names_a_live_update',
          format('Update %s corrects update %s, which isn''t live', u.id, u.corrects));
      end if;
    end if;
  end if;

  -- What it repeats, when it's merged.
  if u.merged_into is not null then
    select x.story_id, x.state into other
      from content.updates x where x.id = u.merged_into for share;
    if found then
      if other.story_id <> u.story_id then
        perform content.refuse('updates', 'updates_repeat_stays_in_its_story',
          format('Update %s repeats update %s, which is in another story', u.id, u.merged_into));
      end if;
      if other.state = 'merged' then
        perform content.refuse('updates', 'updates_merges_never_chain',
          format('Update %s is merged into update %s, which is merged itself', u.id, u.merged_into),
          'Name the update that one is merged into.');
      end if;
      if sets_merged_into and other.state <> 'live' then
        perform content.refuse('updates', 'updates_repeat_names_a_live_update',
          format('Update %s is merged into update %s, which isn''t live', u.id, u.merged_into));
      end if;
    end if;
  end if;

  -- What names this update follows it: its repeats and corrections stay in its story, its
  -- corrections stay later than it, and once it's merged, nothing is merged into it.
  if exists (select 1 from content.updates x where x.merged_into = u.id and x.story_id <> u.story_id) then
    perform content.refuse('updates', 'updates_repeat_stays_in_its_story',
      format('An update merged into update %s is in another story', u.id),
      'Move an update''s repeats and corrections with it.');
  end if;
  if u.state = 'merged' and exists (select 1 from content.updates x where x.merged_into = u.id) then
    perform content.refuse('updates', 'updates_merges_never_chain',
      format('Update %s is merged, but other updates are still merged into it', u.id),
      'Repoint them to the update this one is merged into, in the same transaction.');
  end if;
  if exists (select 1 from content.updates x where x.corrects = u.id and x.story_id <> u.story_id) then
    perform content.refuse('updates', 'updates_correction_stays_in_its_story',
      format('An update correcting update %s is in another story', u.id),
      'Move an update''s repeats and corrections with it.');
  end if;
  if exists (select 1 from content.updates x where x.corrects = u.id and not u.reported_at < x.reported_at) then
    perform content.refuse('updates', 'updates_correction_comes_later',
      format('An update correcting update %s wasn''t reported after it', u.id));
  end if;
  return null;
end;
$$;

-- Sourced items: every story an item belongs to exists and isn't merged, since a merge moves
-- sourced items to the story that stays.
create function content.check_sourced_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  found_count integer;
  merged_count integer;
begin
  select i.id, i.story_ids into item from content.sourced_items i where i.id = new.id;
  if not found or item.story_ids is null then
    return null;
  end if;

  select count(*), count(*) filter (where s.state = 'merged') into found_count, merged_count
    from (select x.state from content.stories x where x.id = any (item.story_ids) for share) as s;
  if found_count <> cardinality(item.story_ids) then
    perform content.refuse('sourced_items', 'sourced_items_story_ids_stories',
      format('Sourced item %s names a story that doesn''t exist', item.id), null, '23503');
  end if;
  if merged_count > 0 then
    perform content.refuse('sourced_items', 'sourced_items_story_is_not_merged',
      format('Sourced item %s names a merged story', item.id),
      'Name the story it went into instead.');
  end if;
  return null;
end;
$$;

-- Creations: the stories a post is on and the sourced items it builds on exist. A post may name
-- a merged story: it is read as naming the story that one went into.
create function content.check_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creation record;
  found_count integer;
begin
  select c.id, c.story_ids, c.based_on into creation from content.creations c where c.id = new.id;
  if not found then
    return null;
  end if;

  if creation.story_ids is not null then
    perform 1 from content.stories s where s.id = any (creation.story_ids) for key share;
    get diagnostics found_count = row_count;
    if found_count <> cardinality(creation.story_ids) then
      perform content.refuse('creations', 'creations_story_ids_stories',
        format('Creation %s names a story that doesn''t exist', creation.id), null, '23503');
    end if;
  end if;

  if creation.based_on is not null then
    perform 1 from content.sourced_items i where i.id = any (creation.based_on) for key share;
    get diagnostics found_count = row_count;
    if found_count <> cardinality(creation.based_on) then
      perform content.refuse('creations', 'creations_based_on_sourced_items',
        format('Creation %s builds on a sourced item that doesn''t exist', creation.id), null, '23503');
    end if;
  end if;
  return null;
end;
$$;

-- A story or a sourced item can't go while a list still names it: the lists' version of a
-- foreign key. (An update's story, the story a merged story went into, and the updates a
-- correction or a repeat names are foreign keys already.)
create function content.check_still_named()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'stories' then
    if exists (select 1 from content.stories s where s.id = old.id) then
      return null; -- written again later in the same transaction
    end if;
    if exists (select 1 from content.sourced_items i where i.story_ids @> array[old.id::uuid]) then
      perform content.refuse('sourced_items', 'sourced_items_story_ids_stories',
        format('Story %s is gone, but sourced items still name it', old.id), null, '23503');
    end if;
    if exists (select 1 from content.creations c where c.story_ids @> array[old.id::uuid]) then
      perform content.refuse('creations', 'creations_story_ids_stories',
        format('Story %s is gone, but posts are still on it', old.id), null, '23503');
    end if;
  else
    if exists (select 1 from content.sourced_items i where i.id = old.id) then
      return null;
    end if;
    if exists (select 1 from content.updates u where u.based_on @> array[old.id::uuid]) then
      perform content.refuse('updates', 'updates_based_on_sourced_items',
        format('Sourced item %s is gone, but updates are still based on it', old.id), null, '23503');
    end if;
    if exists (select 1 from content.creations c where c.based_on @> array[old.id::uuid]) then
      perform content.refuse('creations', 'creations_based_on_sourced_items',
        format('Sourced item %s is gone, but posts still build on it', old.id), null, '23503');
    end if;
  end if;
  return null;
end;
$$;

-- Emptying the stories or the sourced items (TRUNCATE) is refused while a list still names what
-- they held; empty whatever names them in the same statement.
create function content.check_still_named_after_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'stories'
     and (exists (select 1 from content.sourced_items i where i.story_ids is not null)
          or exists (select 1 from content.creations c where c.story_ids is not null)) then
    perform content.refuse('stories', 'stories_still_named',
      'The stories can''t all go while sourced items or posts still name them', null, '23503');
  end if;
  if tg_table_name = 'sourced_items'
     and (exists (select 1 from content.updates u where u.based_on is not null)
          or exists (select 1 from content.creations c where c.based_on is not null)) then
    perform content.refuse('sourced_items', 'sourced_items_still_named',
      'The sourced items can''t all go while updates or posts still name them', null, '23503');
  end if;
  return null;
end;
$$;

revoke all on function content.refuse(text, text, text, text, text) from public;
revoke all on function content.require_read_committed() from public;
revoke all on function content.keep_record_ids() from public;
revoke all on function content.keep_unavailable_final() from public;
revoke all on function content.check_story() from public;
revoke all on function content.check_update() from public;
revoke all on function content.check_sourced_item() from public;
revoke all on function content.check_creation() from public;
revoke all on function content.check_still_named() from public;
revoke all on function content.check_still_named_after_truncate() from public;

-- Every table: changed only in read committed transactions; IDs never change.
create trigger stories_read_committed_only
  before insert or update or delete or truncate on content.stories
  for each statement execute function content.require_read_committed();
create trigger updates_read_committed_only
  before insert or update or delete or truncate on content.updates
  for each statement execute function content.require_read_committed();
create trigger sourced_items_read_committed_only
  before insert or update or delete or truncate on content.sourced_items
  for each statement execute function content.require_read_committed();
create trigger creations_read_committed_only
  before insert or update or delete or truncate on content.creations
  for each statement execute function content.require_read_committed();

create trigger stories_id_never_changes
  before update of id on content.stories
  for each row execute function content.keep_record_ids();
create trigger updates_id_never_changes
  before update of id on content.updates
  for each row execute function content.keep_record_ids();
create trigger sourced_items_id_never_changes
  before update of id on content.sourced_items
  for each row execute function content.keep_record_ids();
create trigger creations_id_never_changes
  before update of id on content.creations
  for each row execute function content.keep_record_ids();

create trigger sourced_items_unavailable_is_final
  before update of state on content.sourced_items
  for each row execute function content.keep_unavailable_final();

-- The rules across records, when the transaction commits.
create constraint trigger stories_rules_across_records
  after insert or update on content.stories
  deferrable initially deferred
  for each row execute function content.check_story();
create constraint trigger updates_rules_across_records
  after insert or update on content.updates
  deferrable initially deferred
  for each row execute function content.check_update();
create constraint trigger sourced_items_rules_across_records
  after insert or update on content.sourced_items
  deferrable initially deferred
  for each row execute function content.check_sourced_item();
create constraint trigger creations_rules_across_records
  after insert or update on content.creations
  deferrable initially deferred
  for each row execute function content.check_creation();

create constraint trigger stories_still_named
  after delete on content.stories
  deferrable initially deferred
  for each row execute function content.check_still_named();
create constraint trigger sourced_items_still_named
  after delete on content.sourced_items
  deferrable initially deferred
  for each row execute function content.check_still_named();
create trigger stories_still_named_after_truncate
  after truncate on content.stories
  for each statement execute function content.check_still_named_after_truncate();
create trigger sourced_items_still_named_after_truncate
  after truncate on content.sourced_items
  for each statement execute function content.check_still_named_after_truncate();
