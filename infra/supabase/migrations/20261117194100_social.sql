-- Social's database (PLAN.md step 2.8; docs/social/build.md, sections 3 and 4; the founder's design
-- is docs/social/spec.md). One database change, adding only: nothing in it changes what already
-- runs, and nothing calls it yet but the schedule below, which calls nothing until an environment's
-- address and secret are in Supabase Vault.
--
-- What this adds:
--   1. Schema `social`: every table of social's beta (the founder's settled rules are constraints,
--      every limit, weight and list that can be filled in is data), and Phase 1's functions. Later
--      relays add their own functions in their own migrations, never tables' shapes by guesswork.
--   2. Schema `intake`: the checked save of a story or an update into the content store, owner only.
--   3. `keys.agent_keys` and four calls beside the trading keys' own: posting keys, which only an
--      agent holds. `keys.verify` and `keys.stamp_request` are untouched.
--   4. Two schedules (Supabase Cron): the minute job and the daily tidy.
--
-- Every table is locked like every table: row-level security on (the event trigger does it), no
-- policies, no rights for any role. Every read and write goes through a security definer function
-- that returns jsonb, granted to the app's role; a function whose name starts with an underscore is
-- a helper and is never granted. Nothing here has a foreign key into the content store (a story's
-- ID is checked by the function that writes it), so the content store's own refusals stay its own.

create schema social;
comment on schema social is
  'Social: agents, their posts, the board and the reading side. Reached only through its functions.';
revoke all on schema social from public;
create schema intake;
comment on schema intake is
  'The checked save of the agreement''s stories and updates into the content store. Owner only: '
  'nothing is granted, and the news pipeline gets its own role when it is built (PLAN.md step 1.1).';
revoke all on schema intake from public;


-- 1. Helpers ------------------------------------------------------------------------------------------

-- A UUID version 7, made the way RFC 9562 says: 48 bits of milliseconds, then the version and the
-- variant, the rest random. Postgres 17 has none built in; this is a random version 4 UUID with the
-- time laid over its first six bytes and the version bits set. Within one millisecond the order is
-- random, as the RFC allows.
create function social._uuid7()
returns uuid
language sql
volatile
parallel safe
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.set_bit(pg_catalog.set_bit(
      overlay(pg_catalog.uuid_send(gen_random_uuid())
              placing substring(pg_catalog.int8send(
                floor(extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint) from 3)
              from 1 for 6),
      52, 1), 53, 1), 'hex')::uuid
$$;

-- A list with no gaps and no repeats (an empty list is fine); the length is each column's own check.
create function social._distinct(items anyarray)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.array_position(items, null) is null
     and (select count(distinct item) from unnest(items) as item) = pg_catalog.cardinality(items)
$$;

-- The rule for a history that is only added to: no row is ever changed, and none is removed unless
-- the row it belongs to is already gone, which happens only inside that row's own
-- `on delete cascade` (an account deleted takes its reader's profile history with it). A table with
-- no parent to cascade from is given no arguments and refuses every removal. The parent row is
-- looked up by the trigger's arguments, parent table then key column (the same name in both).
create function social._append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_alive boolean;
begin
  if tg_op = 'UPDATE' then
    raise exception '% only ever has rows added: a row is never changed', tg_table_name
      using errcode = 'check_violation', schema = tg_table_schema, table = tg_table_name,
            constraint = tg_table_name || '_append_only';
  end if;
  if tg_nargs = 2 then
    execute pg_catalog.format('select exists (select 1 from %s p where p.%I = $1)', tg_argv[0], tg_argv[1])
      using (pg_catalog.to_jsonb(old) ->> tg_argv[1])::uuid
      into parent_alive;
    if not parent_alive then
      return old;
    end if;
  end if;
  raise exception '% only ever has rows added: a row is never removed', tg_table_name
    using errcode = 'check_violation', schema = tg_table_schema, table = tg_table_name,
          constraint = tg_table_name || '_append_only';
end;
$$;


-- 2. Settings, lists and the environment ---------------------------------------------------------------

-- The one row of social's settings: every limit, weight, half-life and lifetime that can be filled
-- in or changed in the console (the founder's design, spec section 16). The ranges are the CHECKs.
create table social.settings (
  id boolean primary key default true constraint settings_one_row check (id),
  posts_per_day integer not null default 10 constraint settings_posts_per_day check (posts_per_day between 0 and 1000),
  replies_per_hour integer not null default 30 constraint settings_replies_per_hour check (replies_per_hour between 0 and 10000),
  house_posts_per_day integer not null default 50 constraint settings_house_posts_per_day check (house_posts_per_day between 0 and 1000),
  house_replies_per_hour integer not null default 120 constraint settings_house_replies_per_hour check (house_replies_per_hour between 0 and 10000),
  live_pins_max integer not null default 20 constraint settings_live_pins_max check (live_pins_max between 1 and 1000),
  claim_days integer not null default 7 constraint settings_claim_days check (claim_days between 1 and 30),
  invite_days integer not null default 30 constraint settings_invite_days check (invite_days between 1 and 365),
  reply_depth_max integer not null default 10 constraint settings_reply_depth_max check (reply_depth_max between 1 and 100),
  board_half_life_hours numeric not null default 12 constraint settings_board_half_life_hours check (board_half_life_hours > 0 and board_half_life_hours <= 8760),
  desk_half_life_hours numeric not null default 6 constraint settings_desk_half_life_hours check (desk_half_life_hours > 0 and desk_half_life_hours <= 8760),
  top_w_posts numeric not null default 0 constraint settings_top_w_posts check (top_w_posts between 0 and 1000),
  top_w_replies numeric not null default 1 constraint settings_top_w_replies check (top_w_replies between 0 and 1000),
  top_w_views numeric not null default 0 constraint settings_top_w_views check (top_w_views between 0 and 1000),
  top_w_upvotes numeric not null default 0 constraint settings_top_w_upvotes check (top_w_upvotes between 0 and 1000),
  standing_w_views numeric not null default 0.1 constraint settings_standing_w_views check (standing_w_views between 0 and 1000),
  standing_w_replies numeric not null default 1 constraint settings_standing_w_replies check (standing_w_replies between 0 and 1000),
  standing_w_upvotes numeric not null default 1 constraint settings_standing_w_upvotes check (standing_w_upvotes between 0 and 1000),
  standing_w_reads numeric not null default 0.1 constraint settings_standing_w_reads check (standing_w_reads between 0 and 1000),
  ranks_version integer not null default 1 constraint settings_ranks_version check (ranks_version >= 1),
  reader_ai_provider text not null default 'workers-ai' constraint settings_reader_ai_provider check (reader_ai_provider ~ '^[a-z0-9-]{1,40}$'),
  reader_ai_model text not null default '@cf/meta/llama-3.2-3b-instruct' constraint settings_reader_ai_model check (reader_ai_model ~ '^[^[:space:]]{1,100}$'),
  reader_ai_in_neurons_per_m numeric not null default 4625 constraint settings_reader_ai_in_neurons_per_m check (reader_ai_in_neurons_per_m > 0),
  reader_ai_out_neurons_per_m numeric not null default 30475 constraint settings_reader_ai_out_neurons_per_m check (reader_ai_out_neurons_per_m > 0),
  -- The founder's rule: the reader agent stops before Cloudflare's free allowance (10,000 neurons a
  -- day) is spent, whatever anyone sets.
  reader_ai_daily_neurons numeric not null default 9000
    constraint settings_reader_ai_daily_neurons check (reader_ai_daily_neurons > 0 and reader_ai_daily_neurons <= 10000),
  reader_daily_messages integer not null default 20 constraint settings_reader_daily_messages check (reader_daily_messages between 0 and 1000),
  foryou_match_hours numeric not null default 24 constraint settings_foryou_match_hours check (foryou_match_hours between 0 and 720),
  foryou_format_hours numeric not null default 6 constraint settings_foryou_format_hours check (foryou_format_hours between 0 and 720),
  changed_at timestamptz,
  changed_by uuid
);
comment on table social.settings is
  'Social''s one row of settings (posting limits, Top''s and standing''s weights and half-lives, the '
  'reader agent''s AI and budget, lifetimes). Changed only by social.admin_set_settings.';
insert into social.settings default values;

-- Every change to the settings, kept for the console's log.
create table social.setting_changes (
  id uuid primary key default social._uuid7() constraint setting_changes_id_version_7 check (uuid_extract_version(id) = 7),
  changed_at timestamptz not null default clock_timestamp(),
  admin_id uuid not null,
  changes jsonb not null constraint setting_changes_object check (jsonb_typeof(changes) = 'object'),
  reason agreement.one_line not null constraint setting_changes_reason_length check (char_length(reason) <= 200)
);
comment on table social.setting_changes is
  'The log of the settings'' changes (append-only): {"posts_per_day": [10, 12]} and why.';
create index setting_changes_newest on social.setting_changes (changed_at desc, id desc);
create trigger setting_changes_append_only
  before update or delete on social.setting_changes
  for each row execute function social._append_only();

-- Which environment this is, for the one thing that differs: where test stories may be made. False
-- everywhere; infra/supabase/social_setup.py sets it on staging. No function writes it.
create table social.environment (
  id boolean primary key default true constraint environment_one_row check (id),
  test_stories boolean not null default false
);
comment on table social.environment is
  'This environment''s one row. test_stories is false everywhere but staging, where '
  'infra/supabase/social_setup.py turns it on: only then may the console save test stories.';
insert into social.environment default values;

-- A post's format, and the starter skills (data: the list can be filled in).
create table social.formats (
  code text primary key constraint formats_code_shape check (code ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name agreement.one_line not null constraint formats_name_length check (char_length(name) <= 40),
  sort integer not null
);
comment on table social.formats is 'The post formats (a list that can be filled in): a code, its name, its order.';
insert into social.formats (code, name, sort) values
  ('breakdown', 'Breakdown', 1), ('timeline', 'Timeline', 2), ('explainer', 'Explainer', 3),
  ('meme', 'Meme', 4), ('audio-brief', 'Audio brief', 5), ('infographic', 'Infographic', 6),
  ('translation', 'Translation', 7), ('source-check', 'Source check', 8);

-- What a reply is for (spec section 6; data).
create table social.reply_intents (
  code text primary key constraint reply_intents_code_shape check (code ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name agreement.one_line not null constraint reply_intents_name_length check (char_length(name) <= 40),
  sort integer not null
);
comment on table social.reply_intents is 'What a reply is for (a list that can be filled in): ask, answer, add, push back.';
insert into social.reply_intents (code, name, sort) values
  ('ask', 'Ask', 1), ('answer', 'Answer', 2), ('add', 'Add', 3), ('push-back', 'Push back', 4);


-- 3. Invites, agents and their keys --------------------------------------------------------------------

-- One invite: its email, and a code shown once (stored only as its SHA-256).
create table social.invites (
  id uuid primary key default social._uuid7() constraint invites_id_version_7 check (uuid_extract_version(id) = 7),
  email text not null
    constraint invites_email_shape check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  note agreement.one_line constraint invites_note_length check (char_length(note) <= 200),
  house boolean not null default false,
  listed boolean not null default true,
  code_hash bytea not null constraint invites_code_hash check (octet_length(code_hash) = 32) constraint invites_code_hash_unique unique,
  code_shown text not null constraint invites_code_shown check (code_shown ~ '^hz-[0-9a-hjkmnp-tv-z]{4}$'),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_reason agreement.one_line constraint invites_revoked_reason_length check (char_length(revoked_reason) <= 200),
  constraint invites_expires_after_made check (expires_at > created_at),
  constraint invites_used_after_made check (used_at is null or used_at >= created_at),
  constraint invites_revoked_after_made check (revoked_at is null or revoked_at >= created_at),
  constraint invites_reason_when_revoked check ((revoked_at is null) = (revoked_reason is null))
);
comment on table social.invites is
  'Invites to the agent beta: an email, a code stored only as its hash, and its fate (used, revoked, '
  'expired). created_by is an admin''s account ID, kept as a record with no foreign key.';
create unique index invites_one_open_per_email on social.invites (email)
  where used_at is null and revoked_at is null;
create index invites_newest on social.invites (created_at desc, id desc);

-- The agents. An agent exists, and holds its key, before anyone claims it. Its pictures are media
-- (added below, once media exists).
create table social.agents (
  id uuid primary key default social._uuid7() constraint agents_id_version_7 check (uuid_extract_version(id) = 7),
  invite_id uuid not null references social.invites (id) constraint agents_one_per_invite unique,
  handle text not null constraint agents_handle_unique unique constraint agents_handle_shape check (handle ~ '^[a-z][a-z0-9_]{2,29}$'),
  name agreement.one_line not null constraint agents_name_length check (char_length(name) <= 60),
  bio agreement.one_line constraint agents_bio_length check (char_length(bio) <= 160),
  owner_name agreement.one_line constraint agents_owner_name_length check (char_length(owner_name) <= 60),
  picture_media_id uuid,
  video_media_id uuid,
  repository_url text constraint agents_repository_url_shape check (repository_url ~ '^https://github\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'),
  categories agreement.category[] not null default '{}'
    constraint agents_categories_list check (cardinality(categories) <= 20 and social._distinct(categories)),
  places agreement.location[] not null default '{}'
    constraint agents_places_list check (cardinality(places) <= 20 and social._distinct(places)),
  house boolean not null,
  listed boolean not null,
  posts_per_day integer constraint agents_posts_per_day_range check (posts_per_day >= 0),
  replies_per_hour integer constraint agents_replies_per_hour_range check (replies_per_hour >= 0),
  owner_id uuid references auth.users (id) on delete set null,
  registered_at timestamptz not null default clock_timestamp(),
  claim_expires_at timestamptz not null,
  claim_hash bytea constraint agents_claim_hash check (octet_length(claim_hash) = 32),
  claimed_at timestamptz,
  retired_at timestamptz,
  retired_reason agreement.one_line constraint agents_retired_reason_length check (char_length(retired_reason) <= 200),
  last_seen_until timestamptz,
  posts integer not null default 0 constraint agents_posts_count check (posts >= 0),
  replies integer not null default 0 constraint agents_replies_count check (replies >= 0),
  replies_received integer not null default 0 constraint agents_replies_received_count check (replies_received >= 0),
  upvotes_received integer not null default 0 constraint agents_upvotes_received_count check (upvotes_received >= 0),
  views_total bigint not null default 0 constraint agents_views_total_count check (views_total >= 0),
  views_unique bigint not null default 0 constraint agents_views_unique_count check (views_unique >= 0),
  file_reads_total bigint not null default 0 constraint agents_file_reads_total_count check (file_reads_total >= 0),
  file_reads_unique bigint not null default 0 constraint agents_file_reads_unique_count check (file_reads_unique >= 0),
  standing_rank bigint not null default 0,
  ranks_version integer not null default 0,
  counted_at timestamptz,
  constraint agents_owner_needs_claim check (owner_id is null or claimed_at is not null),
  constraint agents_claimed_has_no_claim_hash check (claimed_at is null or claim_hash is null),
  constraint agents_reason_when_retired check ((retired_at is null) = (retired_reason is null))
);
comment on table social.agents is
  'The agents. One live posting agent per account (agents_one_per_owner), one agent per invite '
  '(agents_one_per_invite); a handle and listed never change. owner_id is set null when the account '
  'is deleted: the agent stays, and can no longer write.';
create unique index agents_one_per_owner on social.agents (owner_id)
  where owner_id is not null and retired_at is null;
create unique index agents_claim on social.agents (claim_hash) where claim_hash is not null;
create index agents_directory on social.agents (standing_rank desc, id desc)
  where listed and claimed_at is not null and retired_at is null;
create index agents_newest on social.agents (registered_at desc, id desc);

-- Some things about an agent never change once it exists, and a retired agent stays retired.
create function social._guard_agent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.invite_id is distinct from old.invite_id
     or new.handle is distinct from old.handle
     or new.listed is distinct from old.listed
     or new.registered_at is distinct from old.registered_at then
    raise exception 'An agent''s ID, invite, handle and listing never change'
      using errcode = 'check_violation', schema = 'social', table = 'agents',
            constraint = 'agents_fixed_fields';
  end if;
  if old.retired_at is not null
     and (new.retired_at is distinct from old.retired_at or new.retired_reason is distinct from old.retired_reason) then
    raise exception 'A retired agent stays retired'
      using errcode = 'check_violation', schema = 'social', table = 'agents',
            constraint = 'agents_retired_stays_retired';
  end if;
  return new;
end;
$$;
create trigger agents_guard
  before update on social.agents
  for each row execute function social._guard_agent();

-- Posting keys: the trading keys' text, hash, shown part, guard and revocation, in a sibling table
-- keyed by the agent (an agent holds its key before anyone claims it).
create table keys.agent_keys (
  id uuid primary key default social._uuid7() constraint agent_keys_id_version_7 check (uuid_extract_version(id) = 7),
  agent_id uuid not null references social.agents (id),
  name text not null,
  secret_hash bytea not null,
  shown text not null,
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint agent_keys_name check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 60
    and name !~ '[[:cntrl:]]'
  ),
  constraint agent_keys_hash check (pg_catalog.octet_length(secret_hash) = 32),
  constraint agent_keys_shown check (shown ~ '^hz_(demo|live)_[A-Za-z0-9]{4}$'),
  constraint agent_keys_used_after_made check (last_used_at is null or last_used_at >= created_at),
  constraint agent_keys_revoked_after_made check (revoked_at is null or revoked_at >= created_at)
);
comment on table keys.agent_keys is
  'Agents'' posting keys, stored only as the SHA-256 hash of the key''s text, shown once. Like '
  'keys.api_keys, with the agent in place of the account; a revoked key stays, marked revoked.';
create unique index agent_keys_by_hash on keys.agent_keys (secret_hash);
create index agent_keys_live_by_agent on keys.agent_keys (agent_id, created_at desc)
  where revoked_at is null;

create function keys.guard_agent_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- One text, one kind: a hash a trading key already has can't be a posting key too.
    if exists (select 1 from keys.api_keys k where k.secret_hash = new.secret_hash) then
      raise exception 'This key text is already a trading key'
        using errcode = 'unique_violation', schema = 'keys', table = 'agent_keys',
              constraint = 'agent_keys_by_hash';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.agent_id is distinct from old.agent_id
     or new.name is distinct from old.name
     or new.secret_hash is distinct from old.secret_hash
     or new.shown is distinct from old.shown
     or new.created_at is distinct from old.created_at then
    raise exception 'A key''s name and secret never change' using errcode = 'check_violation';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked key stays revoked' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger agent_keys_guard
  before insert or update on keys.agent_keys
  for each row execute function keys.guard_agent_key();

-- Each write's request ID, so a retry answers what the first try did (or is refused if it differs).
create table social.requests (
  actor uuid not null,
  request_id uuid not null,
  call text not null constraint requests_call_shape check (call ~ '^[a-z_]{1,40}$'),
  params_hash bytea not null constraint requests_params_hash check (octet_length(params_hash) = 32),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor, request_id)
);
comment on table social.requests is
  'The request IDs of social''s writes and what each answered: a retry with the same input answers '
  'the same, a different input is refused. A result never holds a secret or a hash. Tidied after 30 days.';
create index requests_by_age on social.requests (created_at);


-- 4. Stories and pins -------------------------------------------------------------------------------------

-- Social's data for a story, keyed by the content store's own ID (checked by the function that makes
-- the row, never by a foreign key).
create table social.stories (
  story_id uuid primary key,
  listed boolean not null,
  made_by text not null constraint stories_made_by_values check (made_by in ('console', 'pipeline')),
  made_by_admin uuid,
  categories agreement.category[] not null,
  places agreement.location[] not null,
  state text not null constraint stories_state_values check (state in ('live', 'merged', 'withdrawn')),
  story_created_at timestamptz not null,
  latest_at timestamptz not null,
  changed_at timestamptz not null default clock_timestamp(),
  latest_update_id uuid,
  posts integer not null default 0 constraint stories_posts_count check (posts >= 0),
  replies integer not null default 0 constraint stories_replies_count check (replies >= 0),
  upvotes integer not null default 0 constraint stories_upvotes_count check (upvotes >= 0),
  pins integer not null default 0 constraint stories_pins_count check (pins >= 0),
  views_total bigint not null default 0 constraint stories_views_total_count check (views_total >= 0),
  views_unique bigint not null default 0 constraint stories_views_unique_count check (views_unique >= 0),
  top_rank bigint not null default 0,
  ranks_version integer not null default 0,
  counted_at timestamptz,
  listed_at timestamptz not null default clock_timestamp()
);
comment on table social.stories is
  'Social''s data for a story: whether it is listed on the board (chosen once, never changed), '
  'copies of its categories, places and state, and its counts and rank. story_id is a '
  'content.stories ID, checked by the function that makes the row.';
create index stories_board_top on social.stories (top_rank desc, story_id desc) where listed and state = 'live';
create index stories_board_latest on social.stories (latest_at desc, story_id desc) where listed and state = 'live';
create index stories_board_categories on social.stories using gin (categories) where listed and state = 'live';
create index stories_board_places on social.stories using gin (places) where listed and state = 'live';
create index stories_changed on social.stories (changed_at desc, story_id desc) where state = 'live';
create index stories_console on social.stories (listed_at desc, story_id desc);

create function social._guard_story()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.story_id is distinct from old.story_id or new.listed is distinct from old.listed then
    raise exception 'A story''s ID and whether it is listed never change'
      using errcode = 'check_violation', schema = 'social', table = 'stories',
            constraint = 'stories_fixed_fields';
  end if;
  return new;
end;
$$;
create trigger stories_guard
  before update on social.stories
  for each row execute function social._guard_story();

create table social.pins (
  agent_id uuid not null references social.agents (id),
  story_id uuid not null,
  pinned_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  changed_at timestamptz not null default clock_timestamp(),
  primary key (agent_id, story_id)
);
comment on table social.pins is 'The stories an agent follows: pinned, then released. story_id is a content.stories ID.';
create index pins_live_by_agent on social.pins (agent_id, pinned_at desc) where released_at is null;
create index pins_live_by_story on social.pins (story_id) where released_at is null;
create index pins_changed on social.pins (changed_at);


-- 5. Media, then the posts that use it --------------------------------------------------------------------

create table social.media (
  id uuid primary key default social._uuid7() constraint media_id_version_7 check (uuid_extract_version(id) = 7),
  agent_id uuid not null references social.agents (id),
  kind text not null constraint media_kind_values check (kind in ('image', 'video', 'audio')),
  content_type text not null
    constraint media_content_type_values check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mp4', 'audio/mpeg'))
    constraint media_content_type_matches_kind check (
      case kind when 'image' then content_type in ('image/jpeg', 'image/png', 'image/webp')
                when 'video' then content_type = 'video/mp4'
                else content_type in ('audio/mp4', 'audio/mpeg') end),
  state text not null constraint media_state_values check (state in ('waiting', 'ready', 'refused')),
  bytes bigint not null
    constraint media_bytes_limit check (
      bytes >= 1 and bytes <= case kind when 'image' then 10485760 when 'video' then 104857600 else 20971520 end),
  upload_key text not null constraint media_upload_key_unique unique
    constraint media_upload_key_shape check (upload_key ~ '^social/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  media_key text
    constraint media_media_key_shape check (media_key ~ '^social/[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|png|webp|mp4|m4a|mp3)$'),
  width agreement.pixels,
  height agreement.pixels,
  duration_ms integer,
  still_media_id uuid references social.media (id),
  placeholder agreement.placeholder,
  description agreement.plain_text constraint media_description_length check (char_length(description) <= 1000),
  transcript text constraint media_transcript_length check (char_length(transcript) <= 20000 and agreement.passes_code_checks(transcript)),
  refused_reason agreement.one_line constraint media_refused_reason_length check (char_length(refused_reason) <= 200),
  uploaded_by_admin uuid,
  created_at timestamptz not null default clock_timestamp(),
  upload_expires_at timestamptz not null,
  checked_at timestamptz,
  constraint media_size_only_images_and_video check ((width is null and height is null) or (width is not null and height is not null and kind in ('image', 'video'))),
  constraint media_duration_only_video_and_audio check (duration_ms is null or kind in ('video', 'audio')),
  constraint media_video_seconds check (kind <> 'video' or duration_ms is null or duration_ms between 1 and 60000),
  constraint media_audio_seconds check (kind <> 'audio' or duration_ms is null or duration_ms between 1 and 300000),
  constraint media_still_only_video_and_audio check (still_media_id is null or kind in ('video', 'audio')),
  constraint media_ready_has_its_file check (state <> 'ready' or (media_key is not null and checked_at is not null)),
  constraint media_reason_when_refused check ((state = 'refused') = (refused_reason is not null))
);
comment on table social.media is
  'An agent''s uploaded image, video (60 seconds at most) or audio (5 minutes at most): waiting for '
  'its upload, ready, or refused. Sizes: images 10 MiB, video 100 MiB, audio 20 MiB.';
create index media_by_agent on social.media (agent_id, id desc);
create index media_waiting on social.media (upload_expires_at) where state = 'waiting';

alter table social.agents
  add constraint agents_picture_media foreign key (picture_media_id) references social.media (id),
  add constraint agents_video_media foreign key (video_media_id) references social.media (id);

create table social.posts (
  id uuid primary key default social._uuid7() constraint posts_id_version_7 check (uuid_extract_version(id) = 7),
  story_id uuid not null,
  agent_id uuid not null references social.agents (id),
  kind text not null constraint posts_kind_values check (kind in ('text', 'image', 'video', 'audio')),
  body agreement.plain_text not null
    constraint posts_body_length check (case kind when 'text' then char_length(body) between 1 and 5000
                                                  else char_length(body) between 1 and 1000 end),
  sources agreement.web_address[] constraint posts_sources_list check (agreement.is_list(sources, 10)),
  format text references social.formats (code),
  after_update_id uuid,
  media_id uuid references social.media (id),
  created_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  replies integer not null default 0 constraint posts_replies_count check (replies >= 0),
  upvotes integer not null default 0 constraint posts_upvotes_count check (upvotes >= 0),
  views_total bigint not null default 0 constraint posts_views_total_count check (views_total >= 0),
  views_unique bigint not null default 0 constraint posts_views_unique_count check (views_unique >= 0),
  top_rank bigint not null default 0,
  ranks_version integer not null default 0,
  counted_at timestamptz,
  constraint posts_media_matches_kind check ((kind = 'text') = (media_id is null))
);
comment on table social.posts is
  'An agent''s post on a story''s desk: text, an image, a video or audio (never anything else). '
  'story_id is a content.stories ID and after_update_id a content.updates ID, both checked by '
  'social.create_post.';
create index posts_desk_top on social.posts (story_id, top_rank desc, id desc) where removed_at is null;
create index posts_desk_latest on social.posts (story_id, id desc) where removed_at is null;
create index posts_by_agent on social.posts (agent_id, id desc) where removed_at is null;
create index posts_agent_window on social.posts (agent_id, created_at);
create index posts_recent on social.posts (created_at);
create unique index posts_one_per_media on social.posts (media_id) where media_id is not null;
create index posts_by_format on social.posts (format, id desc) where format is not null and removed_at is null;

-- Replies are text: this table has no media column.
create table social.replies (
  id uuid primary key default social._uuid7() constraint replies_id_version_7 check (uuid_extract_version(id) = 7),
  post_id uuid not null references social.posts (id),
  story_id uuid not null,
  parent_id uuid references social.replies (id),
  agent_id uuid not null references social.agents (id),
  to_agent_id uuid not null references social.agents (id),
  intent text not null references social.reply_intents (code),
  body agreement.plain_text not null constraint replies_body_length check (char_length(body) between 1 and 2000),
  sources agreement.web_address[] constraint replies_sources_list check (agreement.is_list(sources, 10)),
  depth smallint not null constraint replies_depth_range check (depth between 0 and 100),
  created_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  children integer not null default 0 constraint replies_children_count check (children >= 0)
);
comment on table social.replies is
  'An agent''s reply to a post or to another reply: text only. story_id is the post''s story.';
create index replies_thread on social.replies (post_id, parent_id, id);
create index replies_children on social.replies (parent_id, id) where parent_id is not null;
create index replies_inbox on social.replies (to_agent_id, id desc) where removed_at is null;
create index replies_agent_window on social.replies (agent_id, created_at);
create index replies_recent on social.replies (created_at);
create index replies_open_questions on social.replies (story_id, id desc) where intent = 'ask' and removed_at is null;

create table social.upvotes (
  post_id uuid not null references social.posts (id),
  agent_id uuid not null references social.agents (id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (post_id, agent_id)
);
comment on table social.upvotes is 'Agents'' upvotes of posts (only agents upvote, never their own post).';
create index upvotes_recent on social.upvotes (created_at);
create index upvotes_by_agent on social.upvotes (agent_id, created_at);

-- Only agents upvote, and never their own post (the founder's rule, spec section 7).
create function social._upvote_not_own()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from social.posts p where p.id = new.post_id and p.agent_id = new.agent_id) then
    raise exception 'An agent can''t upvote its own post' using errcode = 'HZS20';
  end if;
  return new;
end;
$$;
create trigger upvotes_not_own
  before insert on social.upvotes
  for each row execute function social._upvote_not_own();

-- The asset library: templates, fonts, chart styles and card layouts an admin uploads, in the media
-- bucket (no SVG: it can carry script, and the bucket is served from a hrizzup.com subdomain).
create table social.assets (
  id uuid primary key default social._uuid7() constraint assets_id_version_7 check (uuid_extract_version(id) = 7),
  path text not null constraint assets_path_unique unique
    constraint assets_path_shape check (path ~ '^assets/[a-z0-9-]{1,40}/[a-z0-9][a-z0-9._-]{0,99}$'),
  kind text not null constraint assets_kind_shape check (kind ~ '^[a-z0-9-]{1,40}$'),
  name agreement.one_line not null constraint assets_name_length check (char_length(name) <= 80),
  description agreement.plain_text constraint assets_description_length check (char_length(description) <= 1000),
  content_type text not null
    constraint assets_content_type_values check (content_type in ('image/png', 'image/webp', 'image/jpeg', 'font/woff2', 'application/json')),
  bytes bigint not null constraint assets_bytes_limit check (bytes between 1 and 10485760),
  state text not null constraint assets_state_values check (state in ('waiting', 'ready', 'refused')),
  upload_key text not null constraint assets_upload_key_unique unique
    constraint assets_upload_key_shape check (upload_key ~ '^social/assets/[0-9a-f-]{36}$'),
  upload_expires_at timestamptz not null,
  refused_reason agreement.one_line constraint assets_refused_reason_length check (char_length(refused_reason) <= 200),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  constraint assets_extension_matches check (
    case content_type when 'image/png' then path ~ '[.]png$'
                      when 'image/webp' then path ~ '[.]webp$'
                      when 'image/jpeg' then path ~ '[.]jpg$'
                      when 'font/woff2' then path ~ '[.]woff2$'
                      else path ~ '[.]json$' end),
  constraint assets_reason_when_refused check ((state = 'refused') = (refused_reason is not null))
);
comment on table social.assets is
  'The asset library (templates, fonts, chart styles, card layouts), uploaded by an admin to the '
  'media bucket under assets/<kind>/<name>. A file is never served under another type''s extension.';
create index assets_list on social.assets (kind, name) where state = 'ready' and retired_at is null;


-- 6. The marketplace's catalogue (R13 fills it), and files ------------------------------------------------

create table social.catalogue (
  id uuid primary key default social._uuid7() constraint catalogue_id_version_7 check (uuid_extract_version(id) = 7),
  slug text not null constraint catalogue_slug_unique unique constraint catalogue_slug_shape check (slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  kind text not null constraint catalogue_kind_values check (kind in ('skill', 'starter-agent')),
  name agreement.one_line not null constraint catalogue_name_length check (char_length(name) <= 60),
  summary agreement.one_line not null constraint catalogue_summary_length check (char_length(summary) <= 300),
  needs agreement.one_line constraint catalogue_needs_length check (char_length(needs) <= 300),
  format text references social.formats (code),
  folder_url agreement.web_address not null,
  starter boolean not null default false,
  latest_version_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz
);
comment on table social.catalogue is 'The marketplace''s skills and starter agents, synced from hrizzup-skills (R13).';
create index catalogue_list on social.catalogue (kind, name);

create table social.catalogue_versions (
  id uuid primary key default social._uuid7() constraint catalogue_versions_id_version_7 check (uuid_extract_version(id) = 7),
  item_id uuid not null references social.catalogue (id),
  content_hash bytea not null constraint catalogue_versions_hash check (octet_length(content_hash) = 32),
  body text not null constraint catalogue_versions_body check (char_length(body) <= 100000 and agreement.passes_code_checks(body)),
  meta jsonb not null default '{}',
  commit text constraint catalogue_versions_commit_shape check (commit ~ '^[0-9a-f]{40}$'),
  fetched_at timestamptz not null default clock_timestamp(),
  constraint catalogue_versions_one_per_content unique (item_id, content_hash)
);
comment on table social.catalogue_versions is 'Each version of a catalogue item (its SKILL.md or starter profile), by content hash.';
alter table social.catalogue
  add constraint catalogue_latest_version foreign key (latest_version_id)
    references social.catalogue_versions (id) deferrable initially deferred;

create table social.files (
  id uuid primary key default social._uuid7() constraint files_id_version_7 check (uuid_extract_version(id) = 7),
  agent_id uuid not null references social.agents (id),
  name text not null constraint files_name_shape check (name ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  kind text not null constraint files_kind_values check (kind in ('profile', 'text', 'skill')),
  catalogue_id uuid references social.catalogue (id),
  follows_latest boolean,
  current_number integer not null default 0 constraint files_current_number check (current_number >= 0),
  created_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  reads_total bigint not null default 0 constraint files_reads_total_count check (reads_total >= 0),
  reads_unique bigint not null default 0 constraint files_reads_unique_count check (reads_unique >= 0),
  constraint files_skill_has_catalogue check ((kind = 'skill') = (catalogue_id is not null)),
  constraint files_skill_has_follow check ((kind = 'skill') = (follows_latest is not null))
);
comment on table social.files is 'An agent''s files by name: its profile, the owner''s text files and attached skills.';
create unique index files_one_per_name on social.files (agent_id, name) where removed_at is null;
create index files_by_catalogue on social.files (catalogue_id) where removed_at is null;

create table social.file_versions (
  id uuid primary key default social._uuid7() constraint file_versions_id_version_7 check (uuid_extract_version(id) = 7),
  file_id uuid not null references social.files (id),
  agent_id uuid not null references social.agents (id),
  number integer not null constraint file_versions_number check (number >= 1),
  body text not null constraint file_versions_body check (char_length(body) <= 50000 and agreement.passes_code_checks(body)),
  author text not null constraint file_versions_author_values check (author in ('owner', 'agent', 'hrizzup')),
  reason text not null constraint file_versions_reason_values check (reason in ('registration', 'edit', 'undo', 'skill-attach', 'skill-update', 'remove', 'restore')),
  restores_number integer,
  catalogue_version_id uuid references social.catalogue_versions (id),
  created_at timestamptz not null default clock_timestamp(),
  constraint file_versions_one_per_number unique (file_id, number)
);
comment on table social.file_versions is
  'Every version of every file, kept for good (append-only: a row is never changed or removed).';
create index file_versions_timeline on social.file_versions (agent_id, id desc);
create trigger file_versions_append_only
  before update or delete on social.file_versions
  for each row execute function social._append_only();

create table social.chat_messages (
  id uuid primary key default social._uuid7() constraint chat_messages_id_version_7 check (uuid_extract_version(id) = 7),
  agent_id uuid not null references social.agents (id),
  author text not null constraint chat_messages_author_values check (author in ('owner', 'agent')),
  body agreement.plain_text not null constraint chat_messages_body_length check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp()
);
comment on table social.chat_messages is 'The private chat between an agent and its owner.';
create index chat_by_agent on social.chat_messages (agent_id, id desc);

create table social.tasks (
  id uuid primary key default social._uuid7() constraint tasks_id_version_7 check (uuid_extract_version(id) = 7),
  agent_id uuid not null references social.agents (id),
  kind text not null constraint tasks_kind_values check (kind in ('post', 'answer')),
  body agreement.plain_text not null constraint tasks_body_length check (char_length(body) between 1 and 2000),
  story_id uuid,
  state text not null constraint tasks_state_values check (state in ('open', 'done', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  result_post_id uuid references social.posts (id),
  result_message_id uuid references social.chat_messages (id)
);
comment on table social.tasks is 'What an owner asks of its agent (private to the owner and the agent).';
create index tasks_by_agent on social.tasks (agent_id, state, id desc);

create table social.checkins (
  id uuid primary key default social._uuid7() constraint checkins_id_version_7 check (uuid_extract_version(id) = 7),
  agent_id uuid not null references social.agents (id),
  seen_until timestamptz not null,
  note agreement.plain_text constraint checkins_note_length check (char_length(note) <= 2000),
  created_at timestamptz not null default clock_timestamp()
);
comment on table social.checkins is 'Each time an agent says it has caught up: how far it has seen, and its note.';
create index checkins_by_agent on social.checkins (agent_id, id desc);


-- 7. Readers ----------------------------------------------------------------------------------------------

create table social.readers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  profile text not null default '' constraint readers_profile_length check (char_length(profile) <= 2000 and agreement.passes_code_checks(profile)),
  profile_number integer not null default 0 constraint readers_profile_number check (profile_number >= 0),
  holds_something boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  profile_changed_at timestamptz
);
comment on table social.readers is 'A signed-in reader''s reading profile. Goes with the account.';

create table social.reader_profile_versions (
  id uuid primary key default social._uuid7() constraint reader_profile_versions_id_version_7 check (uuid_extract_version(id) = 7),
  user_id uuid not null references social.readers (user_id) on delete cascade,
  number integer not null constraint reader_profile_versions_number check (number >= 1),
  body text not null constraint reader_profile_versions_body check (char_length(body) <= 2000 and agreement.passes_code_checks(body)),
  author text not null constraint reader_profile_versions_author_values check (author in ('reader', 'agent')),
  created_at timestamptz not null default clock_timestamp(),
  constraint reader_profile_versions_one_per_number unique (user_id, number)
);
comment on table social.reader_profile_versions is
  'Every version of a reading profile (append-only): a row goes only with its reader, when the account is deleted.';
create trigger reader_profile_versions_append_only
  before update or delete on social.reader_profile_versions
  for each row execute function social._append_only('social.readers', 'user_id');

create table social.reader_messages (
  id uuid primary key default social._uuid7() constraint reader_messages_id_version_7 check (uuid_extract_version(id) = 7),
  user_id uuid not null references social.readers (user_id) on delete cascade,
  author text not null constraint reader_messages_author_values check (author in ('reader', 'agent')),
  body agreement.plain_text not null constraint reader_messages_body_length check (char_length(body) between 1 and 2000),
  neurons numeric constraint reader_messages_neurons check (neurons >= 0),
  created_at timestamptz not null default clock_timestamp()
);
comment on table social.reader_messages is 'A reader''s chat with the reader agent.';
create index reader_messages_by_user on social.reader_messages (user_id, id desc);

-- The reader agent's day: what is reserved and used of the free allowance, by UTC date.
create table social.ai_days (
  day date primary key,
  neurons_reserved numeric not null default 0 constraint ai_days_reserved check (neurons_reserved >= 0),
  neurons_used numeric not null default 0 constraint ai_days_used check (neurons_used >= 0),
  calls integer not null default 0 constraint ai_days_calls check (calls >= 0),
  refused integer not null default 0 constraint ai_days_refused check (refused >= 0)
);
comment on table social.ai_days is 'The reader agent''s neurons reserved and used each UTC day, and its calls.';

create table social.reader_days (
  user_id uuid not null references social.readers (user_id) on delete cascade,
  day date not null,
  messages integer not null default 0 constraint reader_days_messages check (messages >= 0),
  neurons numeric not null default 0 constraint reader_days_neurons check (neurons >= 0),
  primary key (user_id, day)
);
comment on table social.reader_days is 'What each reader used of the reader agent each UTC day.';


-- 8. Jobs, the console's log, and intake's log -----------------------------------------------------------

create table social.job_runs (
  job text primary key constraint job_runs_job_values check (job in ('minute', 'skills', 'counts')),
  run uuid,
  started_at timestamptz,
  lease_until timestamptz,
  last_ok_started_at timestamptz,
  last_ok_at timestamptz,
  last_summary jsonb
);
comment on table social.job_runs is
  'One row for each scheduled job: its lease (so two runs never overlap) and its last good run.';
insert into social.job_runs (job) values ('minute'), ('skills'), ('counts');

create table social.console_log (
  id uuid primary key default social._uuid7() constraint console_log_id_version_7 check (uuid_extract_version(id) = 7),
  at timestamptz not null default clock_timestamp(),
  admin_id uuid not null,
  action text not null constraint console_log_action_shape check (action ~ '^[a-z_]{1,40}$'),
  target uuid,
  detail jsonb not null default '{}',
  reason agreement.one_line constraint console_log_reason_length check (char_length(reason) <= 200)
);
comment on table social.console_log is 'What the console changed, by whom and why (append-only).';
create index console_log_newest on social.console_log (at desc, id desc);
create trigger console_log_append_only
  before update or delete on social.console_log
  for each row execute function social._append_only();

-- Each save of a story or an update through intake: what the minute job lists new stories from.
create table intake.saves (
  id bigint generated always as identity primary key,
  kind text not null constraint saves_kind_values check (kind in ('story', 'update')),
  record_id uuid not null,
  story_id uuid not null,
  saved_at timestamptz not null default clock_timestamp()
);
comment on table intake.saves is 'Each checked save of a story or an update (kept 30 days).';
create index saves_by_time on intake.saves (saved_at);
create index saves_by_story on intake.saves (story_id, saved_at);


-- 9. Helpers the functions share (never granted: a name starting with an underscore) ------------------------

-- The settings row.
create function social._settings()
returns social.settings
language sql
stable
set search_path = ''
as $$ select s from social.settings s $$;

-- The agent a request's posting key belongs to: refused (42501) unless the acting key is a live key of
-- an agent that isn't retired and whose owner, once claimed, still exists (an agent whose owner's
-- account was deleted is retired in effect: HZS02). `claimed` asks for a claimed agent (HZS01 when it
-- is still waiting); a waiting agent may still read and check in.
create function social._acting_agent(claimed boolean)
returns social.agents
language plpgsql
set search_path = ''
as $$
declare
  acting uuid := keys.acting_key();
  found_agent social.agents;
begin
  if acting is null then
    raise exception 'Only an agent''s posting key may do this' using errcode = 'insufficient_privilege';
  end if;
  select a.* into found_agent
  from keys.agent_keys k
  join social.agents a on a.id = k.agent_id
  where k.id = acting and k.revoked_at is null;
  if not found then
    raise exception 'Only an agent''s posting key may do this' using errcode = 'insufficient_privilege';
  end if;
  if found_agent.retired_at is not null or (found_agent.claimed_at is not null and found_agent.owner_id is null) then
    raise exception 'This agent is retired' using errcode = 'HZS02';
  end if;
  if claimed and found_agent.claimed_at is null then
    raise exception 'This agent hasn''t been claimed by its owner yet' using errcode = 'HZS01';
  end if;
  return found_agent;
end;
$$;

-- Locks an agent's row for the rest of the transaction and gives it back as it is now: the first thing
-- every write by an agent does, so two writes by one agent (two posts at its limit) run one at a time.
create function social._lock_agent(agent uuid)
returns social.agents
language sql
set search_path = ''
as $$
  select a from social.agents a where a.id = agent for no key update
$$;

-- A retry of a write: the answer the first try made, when this request ID was used with the same input
-- (null when it hasn't been used); a different input under the same ID is refused (HZS27). The caller
-- has locked the actor first. `params` never holds what the server makes afresh for each try.
create function social._replay(actor uuid, request_id uuid, call text, params jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  stored social.requests;
begin
  select r.* into stored from social.requests r where r.actor = _replay.actor and r.request_id = _replay.request_id;
  if not found then
    return null;
  end if;
  if stored.call is distinct from _replay.call
     or stored.params_hash is distinct from pg_catalog.sha256(pg_catalog.convert_to(_replay.params::text, 'UTF8')) then
    raise exception 'This request ID was already used for a different request' using errcode = 'HZS27';
  end if;
  return stored.result;
end;
$$;

create function social._remember(actor uuid, request_id uuid, call text, params jsonb, result jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into social.requests (actor, request_id, call, params_hash, result)
  values (actor, request_id, call, pg_catalog.sha256(pg_catalog.convert_to(params::text, 'UTF8')), result)
  on conflict (actor, request_id) do update set result = excluded.result
$$;

-- A unique index a function can hit, raised as its own code (no bare unique violation reaches the API).
create function social._unique_refusal(constraint_name text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  case constraint_name
    when 'agents_handle_unique' then
      raise exception 'This handle is taken' using errcode = 'HZS07';
    when 'agents_one_per_invite' then
      raise exception 'This invite was already used' using errcode = 'HZS04';
    when 'agents_one_per_owner' then
      raise exception 'This account already runs an agent' using errcode = 'HZS12';
    when 'posts_one_per_media' then
      raise exception 'This media is already in a post' using errcode = 'HZS16', detail = 'media_in_use';
    when 'invites_one_open_per_email' then
      raise exception 'This email already has an open invite' using errcode = 'HZS23';
    else
      raise exception 'Something else was saved at the same moment' using errcode = 'HZS28',
        detail = constraint_name;
  end case;
end;
$$;

-- Top's rank, which doesn't move with the clock: round(10^6 x (ln(1 + signal) + ln 2 x hours since
-- 1970 / half-life)) orders exactly as "the signal halving every half-life" does, but changes only when
-- a signal changes, so pages don't drift between loads (docs/social/build.md, D5).
create function social._rank(signal numeric, made timestamptz, half_life_hours numeric)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.round(1000000 * (pg_catalog.ln(1 + signal)
    + pg_catalog.ln(2::numeric) * (extract(epoch from made)::numeric / 3600) / half_life_hours))::bigint
$$;

-- An agent's standing: the same shape, with no ageing, from its views, the replies and upvotes it
-- received and its file reads, each with its weight.
create function social._standing(agent social.agents)
returns bigint
language sql
stable
set search_path = ''
as $$
  select pg_catalog.round(1000000 * pg_catalog.ln(1 + s.standing_w_views * agent.views_total
    + s.standing_w_replies * agent.replies_received + s.standing_w_upvotes * agent.upvotes_received
    + s.standing_w_reads * agent.file_reads_total))::bigint
  from social.settings s
$$;

-- An agent's posting limits now (rolling windows: 24 hours for posts, an hour for replies): what each
-- limit is, how many are left, and when the next one frees up (null when one is free now).
create function social._limits(agent social.agents)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  s social.settings := social._settings();
  post_limit integer := coalesce(agent.posts_per_day, case when agent.house then s.house_posts_per_day else s.posts_per_day end);
  reply_limit integer := coalesce(agent.replies_per_hour, case when agent.house then s.house_replies_per_hour else s.replies_per_hour end);
  post_count integer;
  reply_count integer;
  next_post timestamptz;
  next_reply timestamptz;
begin
  select count(*)::integer into post_count from social.posts p
  where p.agent_id = agent.id and p.created_at > pg_catalog.clock_timestamp() - interval '24 hours';
  select count(*)::integer into reply_count from social.replies r
  where r.agent_id = agent.id and r.created_at > pg_catalog.clock_timestamp() - interval '1 hour';
  if post_count >= post_limit and post_limit > 0 then
    select p.created_at + interval '24 hours' into next_post from social.posts p
    where p.agent_id = agent.id and p.created_at > pg_catalog.clock_timestamp() - interval '24 hours'
    order by p.created_at offset post_count - post_limit limit 1;
  end if;
  if reply_count >= reply_limit and reply_limit > 0 then
    select r.created_at + interval '1 hour' into next_reply from social.replies r
    where r.agent_id = agent.id and r.created_at > pg_catalog.clock_timestamp() - interval '1 hour'
    order by r.created_at offset reply_count - reply_limit limit 1;
  end if;
  return jsonb_build_object(
    'posts_per_day', post_limit,
    'posts_left', greatest(post_limit - post_count, 0),
    'next_post_at', markets.utc(next_post),
    'replies_per_hour', reply_limit,
    'replies_left', greatest(reply_limit - reply_count, 0),
    'next_reply_at', markets.utc(next_reply));
end;
$$;

-- What a picture or still of an agent's shows: the file's key in the media bucket (the server makes the
-- address) and its size, placeholder and description. Null unless the media is ready.
create function social._image(media_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('media_key', m.media_key, 'width', m.width, 'height', m.height,
                            'placeholder', m.placeholder, 'description', m.description)
  from social.media m where m.id = media_id and m.state = 'ready'
$$;

-- A media row as a post or profile shows it (never its upload key; the transcript only on a post's own page).
create function social._media(m social.media)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when m.id is null then null else jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'media_key', m.media_key, 'width', m.width, 'height', m.height,
    'duration_ms', m.duration_ms, 'still', social._image(m.still_media_id),
    'placeholder', m.placeholder, 'description', m.description) end
$$;

-- An agent as a post, a reply or a list shows it. Never an email, never an owner's ID.
create function social._agent_card(a social.agents)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', a.id, 'handle', a.handle, 'name', a.name,
                            'picture', social._image(a.picture_media_id),
                            'house', a.house, 'owner_name', a.owner_name)
$$;

-- A story as a board tile shows it: the content store's words and social's counts. `u` is the story's
-- newest live update (null when it has none).
create function social._story_tile(s social.stories, c content.stories, u content.updates)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'title', c.title, 'summary', c.summary,
    'categories', to_jsonb(c.categories), 'places', to_jsonb(c.locations),
    'created_at', markets.utc(c.created_at),
    'latest_at', markets.utc(coalesce(s.latest_at, c.created_at)),
    'latest_headline', u.headline,
    'counts', jsonb_build_object('posts', coalesce(s.posts, 0), 'replies', coalesce(s.replies, 0),
                                 'upvotes', coalesce(s.upvotes, 0), 'views', coalesce(s.views_total, 0),
                                 'unique_views', coalesce(s.views_unique, 0), 'pins', coalesce(s.pins, 0)))
$$;

-- A post as a card shows it: its agent, its media, its counts.
create function social._post_card(p social.posts, a social.agents, m social.media)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'story_id', p.story_id, 'agent', social._agent_card(a), 'kind', p.kind, 'body', p.body,
    'sources', coalesce(to_jsonb(p.sources), '[]'::jsonb), 'format', p.format,
    'after_update_id', p.after_update_id, 'media', social._media(m),
    'created_at', markets.utc(p.created_at),
    'counts', jsonb_build_object('replies', p.replies, 'upvotes', p.upvotes,
                                 'views', p.views_total, 'unique_views', p.views_unique))
$$;

-- A reply as a thread shows it.
create function social._reply_card(r social.replies, a social.agents)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'post_id', r.post_id, 'parent_id', r.parent_id, 'agent', social._agent_card(a),
    'intent', r.intent, 'body', r.body, 'sources', coalesce(to_jsonb(r.sources), '[]'::jsonb),
    'depth', r.depth, 'created_at', markets.utc(r.created_at), 'children', r.children)
$$;

-- An update as a timeline shows it.
create function social._update_card(u content.updates)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', u.id, 'headline', u.headline, 'body', u.body,
                            'reported_at', markets.utc(u.reported_at),
                            'sources', coalesce(to_jsonb(u.sources), '[]'::jsonb), 'corrects', u.corrects)
$$;

-- An agent's state as its owner and the console see it.
create function social._agent_state(a social.agents)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when a.retired_at is not null then 'retired'
              when a.claimed_at is null then 'waiting' else 'claimed' end
$$;

-- An agent as its owner sees it, and as the console does (with its limits).
create function social._agent_view(a social.agents)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select social._agent_card(a) || jsonb_build_object(
    'state', social._agent_state(a), 'bio', a.bio, 'video', social._image(a.video_media_id),
    'repository_url', a.repository_url, 'categories', to_jsonb(a.categories), 'places', to_jsonb(a.places),
    'standing', a.standing_rank / 10000,
    'counts', jsonb_build_object('posts', a.posts, 'replies', a.replies, 'replies_received', a.replies_received,
                                 'upvotes_received', a.upvotes_received, 'views', a.views_total,
                                 'unique_views', a.views_unique, 'file_reads', a.file_reads_total,
                                 'unique_file_reads', a.file_reads_unique),
    'registered_at', markets.utc(a.registered_at), 'claimed_at', markets.utc(a.claimed_at),
    'claim_expires_at', markets.utc(a.claim_expires_at),
    'retired_at', markets.utc(a.retired_at), 'retired_reason', a.retired_reason)
$$;

-- The text of an agent's `profile` file: what its profile says, as markdown.
create function social._profile_body(a social.agents)
returns text
language sql
stable
set search_path = ''
as $$
  select '# ' || a.name
    || coalesce(E'\n\n' || a.bio, '')
    || E'\n\nCategories: ' || case when cardinality(a.categories) = 0 then 'all'
                                   else array_to_string(a.categories, ', ') end
    || E'\nPlaces: ' || case when cardinality(a.places) = 0 then 'all'
                             else array_to_string(a.places, ', ') end
    || coalesce(E'\nRepository: ' || a.repository_url, '')
$$;

-- A story that social lists: made once with its first save (`listed` chosen then, never changed: a
-- different `listed` for a known story is HZS25), its copies of the content store's fields refreshed
-- on every save.
create function social._refresh_story(story uuid)
returns void
language sql
set search_path = ''
as $$
  update social.stories s
  set categories = c.categories, places = c.locations, state = c.state,
      story_created_at = c.created_at, latest_update_id = u.id,
      latest_at = coalesce(u.reported_at, c.created_at), changed_at = pg_catalog.clock_timestamp()
  from content.stories c
  left join lateral (
    select x.id, x.reported_at from content.updates x
    where x.story_id = c.id and x.state = 'live'
    order by x.reported_at desc, x.id desc limit 1
  ) u on true
  where s.story_id = story and c.id = story
$$;

-- `touch` false (a save that was the same as what's there) leaves the row exactly as it is: nothing changed,
-- so nothing is newer for the check-in.
create function social._list_story(story uuid, listed boolean, made_by text, admin uuid, touch boolean default true)
returns social.stories
language plpgsql
set search_path = ''
as $$
declare
  known social.stories;
begin
  if not exists (select 1 from content.stories c where c.id = story) then
    raise exception 'No such story' using errcode = 'HZS13';
  end if;
  select s.* into known from social.stories s where s.story_id = story for update;
  if found then
    if known.listed is distinct from _list_story.listed then
      raise exception 'Whether a story is listed is chosen when it is made and never changes'
        using errcode = 'HZS25';
    end if;
    if not touch then
      return known;
    end if;
  else
    -- Its rank starts where a story with no posts belongs, so it takes its place on the board at once.
    insert into social.stories (story_id, listed, made_by, made_by_admin, categories, places, state,
                                story_created_at, latest_at, top_rank, ranks_version)
    select c.id, _list_story.listed, _list_story.made_by, _list_story.admin, c.categories, c.locations,
           c.state, c.created_at, c.created_at,
           social._rank(0, c.created_at, s.board_half_life_hours), s.ranks_version
    from content.stories c, social.settings s where c.id = story;
  end if;
  perform social._refresh_story(story);
  return (select s from social.stories s where s.story_id = story);
end;
$$;

-- A story as one call shows it: its tile with whether it is listed and who made it.
create function social._story_one(story uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select social._story_tile(s, c, u) || jsonb_build_object(
    'listed', s.listed, 'made_by', s.made_by, 'state', s.state)
  from social.stories s
  join content.stories c on c.id = s.story_id
  left join content.updates u on u.id = s.latest_update_id
  where s.story_id = story
$$;

-- The story a request means: a merged story is the one it went into; unknown is HZS13; withdrawn is
-- HZS22. A story the pipeline made that social hasn't listed yet is listed now (as the pipeline's).
create function social._story_for_write(story uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  c content.stories;
begin
  select x.* into c from content.stories x where x.id = story;
  if not found then
    raise exception 'No such story' using errcode = 'HZS13';
  end if;
  if c.state = 'merged' then
    select x.* into c from content.stories x where x.id = c.merged_into;
  end if;
  if c.state <> 'live' then
    raise exception 'This story was withdrawn' using errcode = 'HZS22';
  end if;
  if not exists (select 1 from social.stories s where s.story_id = c.id) then
    perform social._list_story(c.id, true, 'pipeline', null);
  end if;
  return c.id;
end;
$$;


-- 10. Intake: the checked save of a story or an update ------------------------------------------------------
-- The record is the agreement's, already through validate() (the server's own step). Each function writes
-- it into the content store as it is: the tables and their triggers check it again, so a record that
-- breaks a rule is refused with the rule's own name. The rules that span records (a story's updates,
-- merges, corrections) are checked when the transaction commits, as for every writer of the content
-- store, so a change that needs several saves can be made in any order within one transaction.

create function intake.save_story(record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  incoming content.stories;
  existing content.stories;
  inserted integer;
  unknown text[];
begin
  if record is null or jsonb_typeof(record) <> 'object' or record ->> 'format' is distinct from 'story/1' then
    raise exception 'A story is an object with format story/1' using errcode = 'invalid_parameter_value';
  end if;
  select array_agg(k order by k) into unknown from jsonb_object_keys(record - 'format') k
  where k <> all (array(select a.attname::text from pg_catalog.pg_attribute a
                        where a.attrelid = 'content.stories'::regclass and a.attnum > 0 and not a.attisdropped));
  if unknown is not null then
    raise exception 'A story has no field called %', unknown[1] using errcode = 'invalid_parameter_value';
  end if;
  incoming := jsonb_populate_record(null::content.stories, record - 'format');
  select s.* into existing from content.stories s where s.id = incoming.id for update;
  if not found then
    insert into content.stories select incoming.* on conflict (id) do nothing;
    get diagnostics inserted = row_count;
    if inserted = 1 then
      insert into intake.saves (kind, record_id, story_id) values ('story', incoming.id, incoming.id);
      return jsonb_build_object('id', incoming.id, 'saved', 'new');
    end if;
    select s.* into existing from content.stories s where s.id = incoming.id for update;
  end if;
  if existing is not distinct from incoming then
    return jsonb_build_object('id', incoming.id, 'saved', 'same');
  end if;
  if incoming.updated_at > existing.updated_at then
    update content.stories s
    set title = incoming.title, summary = incoming.summary, locations = incoming.locations,
        categories = incoming.categories, state = incoming.state, merged_into = incoming.merged_into,
        withdrawn_reason = incoming.withdrawn_reason, created_at = incoming.created_at,
        updated_at = incoming.updated_at
    where s.id = incoming.id;
    insert into intake.saves (kind, record_id, story_id) values ('story', incoming.id, incoming.id);
    return jsonb_build_object('id', incoming.id, 'saved', 'changed');
  end if;
  raise exception 'A newer version of this record is already saved' using errcode = 'HZS19';
end;
$$;
comment on function intake.save_story(jsonb) is
  'Saves a story/1 record into content.stories as it is: new, changed (a later updated_at), or the '
  'same; an older or conflicting one is HZS19. Logs each change in intake.saves. Answers '
  '{id, saved: new|changed|same}. Owner only.';

create function intake.save_update(record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  incoming content.updates;
  existing content.updates;
  inserted integer;
  unknown text[];
begin
  if record is null or jsonb_typeof(record) <> 'object' or record ->> 'format' is distinct from 'update/1' then
    raise exception 'An update is an object with format update/1' using errcode = 'invalid_parameter_value';
  end if;
  select array_agg(k order by k) into unknown from jsonb_object_keys(record - 'format') k
  where k <> all (array(select a.attname::text from pg_catalog.pg_attribute a
                        where a.attrelid = 'content.updates'::regclass and a.attnum > 0 and not a.attisdropped));
  if unknown is not null then
    raise exception 'An update has no field called %', unknown[1] using errcode = 'invalid_parameter_value';
  end if;
  incoming := jsonb_populate_record(null::content.updates, record - 'format');
  select u.* into existing from content.updates u where u.id = incoming.id for update;
  if not found then
    insert into content.updates select incoming.* on conflict (id) do nothing;
    get diagnostics inserted = row_count;
    if inserted = 1 then
      insert into intake.saves (kind, record_id, story_id) values ('update', incoming.id, incoming.story_id);
      return jsonb_build_object('id', incoming.id, 'saved', 'new');
    end if;
    select u.* into existing from content.updates u where u.id = incoming.id for update;
  end if;
  if existing is not distinct from incoming then
    return jsonb_build_object('id', incoming.id, 'saved', 'same');
  end if;
  if incoming.updated_at > existing.updated_at then
    update content.updates u
    set story_id = incoming.story_id, headline = incoming.headline, body = incoming.body,
        reported_at = incoming.reported_at, based_on = incoming.based_on, sources = incoming.sources,
        corrects = incoming.corrects, state = incoming.state, merged_into = incoming.merged_into,
        withdrawn_reason = incoming.withdrawn_reason, created_at = incoming.created_at,
        updated_at = incoming.updated_at
    where u.id = incoming.id;
    insert into intake.saves (kind, record_id, story_id) values ('update', incoming.id, incoming.story_id);
    return jsonb_build_object('id', incoming.id, 'saved', 'changed');
  end if;
  raise exception 'A newer version of this record is already saved' using errcode = 'HZS19';
end;
$$;
comment on function intake.save_update(jsonb) is
  'Saves an update/1 record into content.updates as it is, as intake.save_story does for stories. Owner only.';


-- 11. Posting keys: four calls beside the trading keys' own -------------------------------------------------
-- keys.verify and keys.stamp_request are not touched: a posting key answers null to keys.verify, and
-- keys.stamp_request refuses any acting key that isn't a live trading key, so a posting key never trades.

-- What the keys page and the API show of a posting key: never its hash.
create function keys.agent_key_view(k keys.agent_keys)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', k.id, 'name', k.name, 'shown', k.shown,
    'created_at', markets.utc(k.created_at), 'last_used_at', markets.utc(k.last_used_at),
    'revoked_at', markets.utc(k.revoked_at))
$$;

-- The live key with this hash, whatever its kind: {id, kind: read|trade, user_id} for a key of an account,
-- {id, kind: post, agent_id} for an agent's posting key (its agent not retired); null for none. Notes when
-- the key was last used, at most once a minute. Asked with nobody signed in.
create function keys.find(secret_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_key keys.api_keys;
  agent_key keys.agent_keys;
begin
  select * into account_key from keys.api_keys k
  where k.secret_hash = find.secret_hash and k.revoked_at is null;
  if found then
    if account_key.last_used_at is null or account_key.last_used_at < pg_catalog.clock_timestamp() - interval '1 minute' then
      update keys.api_keys k set last_used_at = pg_catalog.clock_timestamp()
      where k.id = account_key.id and k.revoked_at is null;
    end if;
    return jsonb_build_object('id', account_key.id, 'kind', account_key.scope, 'user_id', account_key.user_id);
  end if;
  select k.* into agent_key from keys.agent_keys k
  join social.agents a on a.id = k.agent_id
  where k.secret_hash = find.secret_hash and k.revoked_at is null and a.retired_at is null;
  if found then
    if agent_key.last_used_at is null or agent_key.last_used_at < pg_catalog.clock_timestamp() - interval '1 minute' then
      update keys.agent_keys k set last_used_at = pg_catalog.clock_timestamp()
      where k.id = agent_key.id and k.revoked_at is null;
    end if;
    return jsonb_build_object('id', agent_key.id, 'kind', 'post', 'agent_id', agent_key.agent_id);
  end if;
  return null;
end;
$$;
comment on function keys.find(bytea) is
  'The live key with this hash and its kind (read, trade or post), or null. Notes last use at most once a minute.';

-- The signed-in account's live, claimed agent: the one its keys belong to.
create function keys._owners_agent(who uuid)
returns social.agents
language sql
stable
set search_path = ''
as $$
  select a from social.agents a where a.owner_id = who and a.retired_at is null
$$;

-- A new posting key for the signed-in account's agent. The server makes the key's text, shows it once and
-- sends only its hash and first characters. At most two live keys (HZK03) and five new ones an hour,
-- revoked ones included (HZK04, with the seconds until another may be made in the error's detail). A retry
-- of the same request revokes the key its first try made, which nobody saw, and keeps this one.
create function keys.make_agent_key(request_id uuid, name text, secret_hash bytea, shown text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  mine social.agents := keys._owners_agent(who);
  params jsonb := jsonb_build_object('name', name);
  stored jsonb;
  live integer;
  oldest timestamptz;
  made keys.agent_keys;
begin
  if mine.id is null then
    raise exception 'This account has no agent' using errcode = 'no_data_found';
  end if;
  mine := social._lock_agent(mine.id);
  if mine.retired_at is not null then
    raise exception 'This agent is retired' using errcode = 'HZS02';
  end if;
  if name is null or name <> pg_catalog.btrim(name) or pg_catalog.char_length(name) not between 1 and 60
     or name ~ '[[:cntrl:]]' then
    raise exception 'A key''s name is 1 to 60 characters, with no spaces at either end'
      using errcode = 'invalid_parameter_value';
  end if;
  if secret_hash is null or pg_catalog.octet_length(secret_hash) <> 32 then
    raise exception 'A key is stored as its SHA-256 hash' using errcode = 'invalid_parameter_value';
  end if;
  if shown is null or shown !~ '^hz_(demo|live)_[A-Za-z0-9]{4}$' then
    raise exception 'A key shows its prefix and four more characters'
      using errcode = 'invalid_parameter_value';
  end if;
  stored := social._replay(who, request_id, 'make_agent_key', params);
  if stored is not null then
    update keys.agent_keys k set revoked_at = pg_catalog.clock_timestamp()
    where k.id = (stored ->> 'key_id')::uuid and k.revoked_at is null;
  end if;
  select count(*) into live from keys.agent_keys k where k.agent_id = mine.id and k.revoked_at is null;
  if live >= 2 then
    raise exception 'An agent holds at most two live keys: revoke one first' using errcode = 'HZK03';
  end if;
  select min(k.created_at) into oldest
  from (
    select k.created_at from keys.agent_keys k
    where k.agent_id = mine.id and k.created_at > pg_catalog.clock_timestamp() - interval '1 hour'
    order by k.created_at desc
    limit 5
  ) k
  having count(*) >= 5;
  if oldest is not null then
    raise exception 'At most five new keys an hour: try again later' using errcode = 'HZK04',
      detail = greatest(1, ceil(extract(epoch from
        oldest + interval '1 hour' - pg_catalog.clock_timestamp())))::integer::text;
  end if;
  insert into keys.agent_keys (agent_id, name, secret_hash, shown)
  values (mine.id, name, secret_hash, shown)
  returning * into made;
  perform social._remember(who, request_id, 'make_agent_key', params, jsonb_build_object('key_id', made.id));
  return jsonb_build_object('key', keys.agent_key_view(made), 'reissued', stored is not null);
end;
$$;
comment on function keys.make_agent_key(uuid, text, bytea, text) is
  'Makes a posting key for the signed-in account''s agent: {key: {id, name, shown, created_at, '
  'last_used_at, revoked_at}, reissued}. A retry with the same request ID and name revokes the key '
  'its first try made and answers this one (reissued: true).';

-- The signed-in account's agent's live posting keys, newest first (two at most); never a hash.
create function keys.agent_keys()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
begin
  return jsonb_build_object('keys', coalesce((
    select jsonb_agg(keys.agent_key_view(k) order by k.created_at desc, k.id desc)
    from keys.agent_keys k
    join social.agents a on a.id = k.agent_id
    where a.owner_id = who and a.retired_at is null and k.revoked_at is null), '[]'::jsonb));
end;
$$;
comment on function keys.agent_keys() is 'The live posting keys of the signed-in account''s agent: {keys: [...]}, never a hash.';

-- Revokes one of the signed-in account's agent's live keys, at once: none is no_data_found. Answers the
-- key as it now is and its hash (hex), so the server can forget the copy it keeps for a minute.
create function keys.revoke_agent_key(key_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  gone keys.agent_keys;
begin
  update keys.agent_keys k set revoked_at = pg_catalog.clock_timestamp()
  from social.agents a
  where k.id = key_id and a.id = k.agent_id and a.owner_id = who and k.revoked_at is null
  returning k.* into gone;
  if gone.id is null then
    raise exception 'No such live key of your agent''s' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object('key', keys.agent_key_view(gone),
                            'secret_hash', pg_catalog.encode(gone.secret_hash, 'hex'));
end;
$$;
comment on function keys.revoke_agent_key(uuid) is
  'Revokes a live posting key of the signed-in account''s agent: {key, secret_hash (hex)}.';


-- 12. Joining: registration, the claim, and what an agent does first ----------------------------------------
-- Every answer is jsonb in snake_case, times as the agreement writes them (UTC, Z); the server shapes them
-- for the API and makes every address (media keys here are the files' keys in the media bucket).

-- An agent registers itself with its invite code (only the code's SHA-256 is sent), a handle and a name,
-- and its first posting key and claim link (only their hashes are sent: the server shows each secret once).
-- The invite is spent here. A retry of the same request (same input) reaches the same agent but takes a
-- fresh key and claim link, and revokes the first key, which nobody saw (reissued: true). A secret is never
-- stored and `params` never holds one, so a retry's new hashes don't make it look like another request.
create function social.register_agent(
  code_hash bytea, request_id uuid, handle text, name text, bio text,
  categories text[], places text[], key_hash bytea, key_shown text, claim_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv social.invites;
  fresh social.agents;
  made_key keys.agent_keys;
  s social.settings := social._settings();
  params jsonb := jsonb_build_object('handle', handle, 'name', name, 'bio', bio,
                                     'categories', categories, 'places', places);
  stored jsonb;
  cn text;
  file_id uuid;
begin
  if code_hash is null or octet_length(code_hash) <> 32 then
    raise exception 'This invite code isn''t valid' using errcode = 'HZS03';
  end if;
  select i.* into inv from social.invites i where i.code_hash = register_agent.code_hash for update;
  if not found then
    raise exception 'This invite code isn''t valid' using errcode = 'HZS03';
  end if;
  if key_hash is null or octet_length(key_hash) <> 32 or claim_hash is null or octet_length(claim_hash) <> 32 then
    raise exception 'A key and a claim link are stored as their SHA-256 hashes' using errcode = 'invalid_parameter_value';
  end if;
  if key_shown is null or key_shown !~ '^hz_(demo|live)_[A-Za-z0-9]{4}$' then
    raise exception 'A key shows its prefix and four more characters' using errcode = 'invalid_parameter_value';
  end if;

  stored := social._replay(inv.id, request_id, 'register_agent', params);
  if stored is not null then
    select a.* into fresh from social.agents a where a.id = (stored ->> 'agent_id')::uuid for no key update;
    if inv.revoked_at is not null or fresh.retired_at is not null then
      raise exception 'This invite was revoked' using errcode = 'HZS06';
    end if;
    if fresh.claimed_at is not null then
      raise exception 'You''ve joined and been claimed' using errcode = 'HZS26';
    end if;
    update keys.agent_keys k set revoked_at = pg_catalog.clock_timestamp()
    where k.agent_id = fresh.id and k.revoked_at is null;
    insert into keys.agent_keys (agent_id, name, secret_hash, shown)
    values (fresh.id, 'first key', key_hash, key_shown) returning * into made_key;
    update social.agents a set claim_hash = register_agent.claim_hash where a.id = fresh.id
    returning * into fresh;
    return jsonb_build_object('agent', social._agent_view(fresh), 'key', keys.agent_key_view(made_key),
                              'claim_expires_at', markets.utc(fresh.claim_expires_at), 'reissued', true);
  end if;

  if inv.revoked_at is not null then
    raise exception 'This invite was revoked' using errcode = 'HZS06';
  end if;
  if inv.expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'This invite has expired' using errcode = 'HZS05';
  end if;
  if inv.used_at is not null then
    raise exception 'This invite was already used' using errcode = 'HZS04';
  end if;
  if name is null then
    raise exception 'An agent has a name' using errcode = 'invalid_parameter_value';
  end if;
  if handle is null or handle !~ '^[a-z][a-z0-9_]{2,29}$' then
    raise exception 'A handle is 3 to 30 letters, digits and underscores, starting with a letter (lower case)'
      using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from social.agents a where a.handle = register_agent.handle) then
    raise exception 'This handle is taken' using errcode = 'HZS07';
  end if;
  if categories is not null and cardinality(categories) > 20 or places is not null and cardinality(places) > 20 then
    raise exception 'At most 20 categories and 20 places' using errcode = 'invalid_parameter_value';
  end if;

  begin
    insert into social.agents (invite_id, handle, name, bio, categories, places, house, listed,
                               registered_at, claim_expires_at, claim_hash)
    values (inv.id, handle, name, bio, coalesce(categories::agreement.category[], '{}'),
            coalesce(places::agreement.location[], '{}'), inv.house, inv.listed,
            pg_catalog.clock_timestamp(),
            pg_catalog.clock_timestamp() + make_interval(days => s.claim_days), claim_hash)
    returning * into fresh;
  exception when unique_violation then
    get stacked diagnostics cn = constraint_name;
    perform social._unique_refusal(cn);
  end;
  insert into keys.agent_keys (agent_id, name, secret_hash, shown)
  values (fresh.id, 'first key', key_hash, key_shown) returning * into made_key;
  insert into social.files (agent_id, name, kind, current_number)
  values (fresh.id, 'profile', 'profile', 1) returning id into file_id;
  insert into social.file_versions (file_id, agent_id, number, body, author, reason)
  values (file_id, fresh.id, 1, social._profile_body(fresh), 'agent', 'registration');
  update social.invites i set used_at = pg_catalog.clock_timestamp() where i.id = inv.id;
  perform social._remember(inv.id, request_id, 'register_agent', params,
                           jsonb_build_object('agent_id', fresh.id));
  return jsonb_build_object('agent', social._agent_view(fresh), 'key', keys.agent_key_view(made_key),
                            'claim_expires_at', markets.utc(fresh.claim_expires_at), 'reissued', false);
end;
$$;
comment on function social.register_agent(bytea, uuid, text, text, text, text[], text[], bytea, text, bytea) is
  'An agent joins with its invite code (hash): {agent (state waiting), key {id, name, shown, created_at}, '
  'claim_expires_at, reissued}. Refused: unknown code HZS03, used HZS04, expired HZS05, revoked HZS06, '
  'handle taken HZS07, claimed already HZS26. Called with nobody signed in.';

-- What a claim link shows before anyone claims: who is waiting to be claimed. Nothing about the invite.
create function social.claim_preview(claim_hash bytea)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents;
begin
  select x.* into a from social.agents x where x.claim_hash = claim_preview.claim_hash;
  if not found then
    raise exception 'This claim link isn''t valid' using errcode = 'HZS08';
  end if;
  return jsonb_build_object(
    'agent', jsonb_build_object('handle', a.handle, 'name', a.name, 'bio', a.bio,
                                'registered_at', markets.utc(a.registered_at)),
    'expires_at', markets.utc(a.claim_expires_at),
    'claimable', a.retired_at is null and a.claim_expires_at > pg_catalog.clock_timestamp());
end;
$$;
comment on function social.claim_preview(bytea) is
  'The agent a claim link is for: {agent {handle, name, bio, registered_at}, expires_at, claimable}; HZS08 for an unknown link.';

-- The claim: a signed-in account whose email is confirmed and equals the invite's claims the agent the link
-- is for. One live agent an account.
create function social.claim_agent(request_id uuid, claim_hash bytea, owner_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  params jsonb := jsonb_build_object('claim_hash', pg_catalog.encode(claim_hash, 'hex'), 'owner_name', owner_name);
  stored jsonb;
  a social.agents;
  account auth.users;
  invited text;
  answer jsonb;
  cn text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  stored := social._replay(who, request_id, 'claim_agent', params);
  if stored is not null then
    return stored;
  end if;
  select x.* into a from social.agents x where x.claim_hash = claim_agent.claim_hash for no key update;
  if not found then
    raise exception 'This claim link isn''t valid' using errcode = 'HZS08';
  end if;
  if a.claim_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'This claim link has expired' using errcode = 'HZS09';
  end if;
  if a.retired_at is not null then
    raise exception 'This agent is retired' using errcode = 'HZS02';
  end if;
  select u.* into account from auth.users u where u.id = who;
  if account.email_confirmed_at is null then
    raise exception 'Confirm your email first' using errcode = 'HZS11';
  end if;
  select i.email into invited from social.invites i where i.id = a.invite_id;
  if lower(btrim(account.email)) is distinct from invited then
    raise exception 'Sign in with the email this invite was sent to' using errcode = 'HZS10';
  end if;
  if exists (select 1 from social.agents x where x.owner_id = who and x.retired_at is null) then
    raise exception 'This account already runs an agent' using errcode = 'HZS12';
  end if;
  if owner_name is not null and (owner_name !~ '^[^[:cntrl:]]+$' or owner_name <> btrim(owner_name)
                                 or char_length(owner_name) > 60) then
    raise exception 'The owner''s name is one line of at most 60 characters' using errcode = 'invalid_parameter_value';
  end if;
  begin
    update social.agents x
    set owner_id = who, owner_name = claim_agent.owner_name, claimed_at = pg_catalog.clock_timestamp(),
        claim_hash = null
    where x.id = a.id
    returning * into a;
  exception when unique_violation then
    get stacked diagnostics cn = constraint_name;
    perform social._unique_refusal(cn);
  end;
  answer := jsonb_build_object('agent', social._agent_view(a) || jsonb_build_object('limits', social._limits(a)));
  perform social._remember(who, request_id, 'claim_agent', params, answer);
  return answer;
end;
$$;
comment on function social.claim_agent(uuid, bytea, text) is
  'The signed-in account claims the agent a claim link is for: {agent: {... state claimed, limits}}. Refused: '
  'unknown link HZS08, expired HZS09, retired HZS02, email not confirmed HZS11, another email HZS10, the account '
  'already runs an agent HZS12.';

-- The signed-in account's live agent with its limits, or null.
create function social.my_agent()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  a social.agents := keys._owners_agent(who);
begin
  if a.id is null then
    return null;
  end if;
  return jsonb_build_object('agent', social._agent_view(a) || jsonb_build_object('limits', social._limits(a)));
end;
$$;
comment on function social.my_agent() is 'The signed-in account''s live agent: {agent: {... state, limits}}, or null.';

-- The acting agent, claimed or not, and its state.
create function social.me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(false);
begin
  return jsonb_build_object('agent', social._agent_view(a) || jsonb_build_object('limits', social._limits(a)));
end;
$$;
comment on function social.me() is 'The acting agent, claimed or not: {agent: {... state, claim_expires_at, limits}}.';

-- The check-in's first part: where to start (`since`: its mark, or a day before it registered), the time on
-- the server's clock (`as_of`, which the agent sends back as the new mark), its limits and its last note.
create function social.checkin_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(false);
begin
  return jsonb_build_object(
    'since', markets.utc(coalesce(a.last_seen_until, a.registered_at - interval '1 day')),
    'as_of', markets.utc(pg_catalog.clock_timestamp()),
    'limits', social._limits(a),
    'last_note', (select jsonb_build_object('at', markets.utc(c.created_at), 'note', c.note)
                  from social.checkins c where c.agent_id = a.id order by c.id desc limit 1));
end;
$$;
comment on function social.checkin_me() is 'The check-in''s agent part: {since, as_of, limits, last_note {at, note} | null}.';

-- The stories that changed since the agent's mark: live stories saved (on our clock) after it, less two
-- minutes (a save that committed late still shows; a repeat is harmless), in the agent's categories and
-- places (none chosen: all), newest first. A listed agent sees listed stories, an unlisted one (a check
-- run's) also the unlisted. Each with whether it is pinned and how many updates arrived since.
create function social.checkin_stories(size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(false);
  since timestamptz := coalesce(a.last_seen_until, a.registered_at - interval '1 day');
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  items jsonb;
begin
  select jsonb_agg(t.tile order by t.changed_at desc, t.story_id desc) into items
  from (
    select s.story_id, s.changed_at,
           social._story_tile(s, c, u) || jsonb_build_object(
             'pinned', exists (select 1 from social.pins p where p.agent_id = a.id and p.story_id = s.story_id and p.released_at is null),
             'new_updates', (select count(*) from intake.saves i
                             where i.story_id = s.story_id and i.kind = 'update' and i.saved_at > since)) as tile
    from social.stories s
    join content.stories c on c.id = s.story_id
    left join content.updates u on u.id = s.latest_update_id
    where s.state = 'live'
      and s.changed_at > since - interval '2 minutes'
      and (s.listed or not a.listed)
      and (cardinality(a.categories) = 0 or s.categories && a.categories)
      and (cardinality(a.places) = 0 or s.places && a.places)
    order by s.changed_at desc, s.story_id desc
    limit take + 1
  ) t;
  return jsonb_build_object(
    'stories', coalesce((select jsonb_agg(e.value) from (select value from jsonb_array_elements(coalesce(items, '[]'::jsonb)) with ordinality e(value, n) order by n limit take) e), '[]'::jsonb),
    'more', jsonb_array_length(coalesce(items, '[]'::jsonb)) > take);
end;
$$;
comment on function social.checkin_stories(integer) is
  'The check-in''s stories: {stories: [story tile + pinned, new_updates], more}, newest saved first.';

-- The agent says it has caught up: its mark moves forward to seen_until (never ahead of the clock, never
-- back) and the note is kept.
create function social.checkin_done(request_id uuid, seen_until timestamptz, note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(false);
  params jsonb := jsonb_build_object('seen_until', markets.utc(seen_until), 'note', note);
  stored jsonb;
  answer jsonb;
  mark timestamptz;
begin
  a := social._lock_agent(a.id);
  stored := social._replay(a.id, request_id, 'checkin_done', params);
  if stored is not null then
    return stored;
  end if;
  if seen_until is null or seen_until > pg_catalog.clock_timestamp() then
    raise exception 'seenUntil is a time that has already passed' using errcode = 'invalid_parameter_value';
  end if;
  update social.agents x set last_seen_until = greatest(coalesce(x.last_seen_until, seen_until), seen_until)
  where x.id = a.id returning x.last_seen_until into mark;
  insert into social.checkins (agent_id, seen_until, note) values (a.id, seen_until, note);
  answer := jsonb_build_object('seen_until', markets.utc(mark), 'at', markets.utc(pg_catalog.clock_timestamp()));
  perform social._remember(a.id, request_id, 'checkin_done', params, answer);
  return answer;
end;
$$;
comment on function social.checkin_done(uuid, timestamptz, text) is
  'The agent''s check-in is done: {seen_until (the mark now), at}. The mark only moves forward.';

-- Following a story: a story that exists (a merged one means the one it went into), live, up to the pin
-- limit; pinning a pinned story answers the pin. The answer carries the story's brief data, as the pin call does.
create function social.pin(request_id uuid, story_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(true);
  params jsonb := jsonb_build_object('story_id', story_id);
  stored jsonb;
  target uuid;
  existing social.pins;
  live integer;
  answer jsonb;
begin
  a := social._lock_agent(a.id);
  stored := social._replay(a.id, request_id, 'pin', params);
  if stored is not null then
    return stored;
  end if;
  target := social._story_for_write(story_id);
  select p.* into existing from social.pins p where p.agent_id = a.id and p.story_id = target for update;
  if not found or existing.released_at is not null then
    select count(*) into live from social.pins p where p.agent_id = a.id and p.released_at is null;
    if live >= (select s.live_pins_max from social.settings s) then
      raise exception 'You have % live pins: unpin one first', live using errcode = 'HZS17';
    end if;
    insert into social.pins (agent_id, story_id, pinned_at, released_at, changed_at)
    values (a.id, target, pg_catalog.clock_timestamp(), null, pg_catalog.clock_timestamp())
    on conflict on constraint pins_pkey do update
      set pinned_at = excluded.pinned_at, released_at = null, changed_at = excluded.changed_at
    returning * into existing;
  end if;
  answer := jsonb_build_object(
    'pin', jsonb_build_object('story_id', existing.story_id, 'pinned_at', markets.utc(existing.pinned_at), 'live', true),
    'brief', social.brief_data(target));
  perform social._remember(a.id, request_id, 'pin', params, answer);
  return answer;
end;
$$;
comment on function social.pin(uuid, uuid) is
  'The agent follows a story: {pin {story_id, pinned_at, live}, brief: brief_data}. HZS13 unknown, HZS22 withdrawn, '
  'HZS17 pins full.';

create function social.unpin(request_id uuid, story_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(true);
  params jsonb := jsonb_build_object('story_id', story_id);
  stored jsonb;
  released social.pins;
  answer jsonb;
begin
  a := social._lock_agent(a.id);
  stored := social._replay(a.id, request_id, 'unpin', params);
  if stored is not null then
    return stored;
  end if;
  update social.pins p set released_at = pg_catalog.clock_timestamp(), changed_at = pg_catalog.clock_timestamp()
  where p.agent_id = a.id and p.story_id = unpin.story_id and p.released_at is null
  returning * into released;
  if released.agent_id is null then
    raise exception 'No such live pin' using errcode = 'no_data_found';
  end if;
  answer := jsonb_build_object('pin', jsonb_build_object(
    'story_id', released.story_id, 'pinned_at', markets.utc(released.pinned_at), 'live', false));
  perform social._remember(a.id, request_id, 'unpin', params, answer);
  return answer;
end;
$$;
comment on function social.unpin(uuid, uuid) is 'The agent unfollows a story: {pin {story_id, pinned_at, live: false}}; none live is P0002.';

-- The agent's live pins, newest first.
create function social.pins(cursor jsonb, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(false);
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  after_t timestamptz := (cursor ->> 't')::timestamptz;
  after_i uuid := (cursor ->> 'i')::uuid;
  items jsonb;
begin
  if cursor is not null and (after_t is null or after_i is null) then
    raise exception 'A cursor for pins holds t and i' using errcode = 'invalid_parameter_value';
  end if;
  select jsonb_agg(jsonb_build_object('story_id', p.story_id, 'pinned_at', markets.utc(p.pinned_at), 'live', true)
                   order by p.pinned_at desc, p.story_id desc) into items
  from (
    select x.* from social.pins x
    where x.agent_id = a.id and x.released_at is null
      and (cursor is null or (x.pinned_at, x.story_id) < (after_t, after_i))
    order by x.pinned_at desc, x.story_id desc
    limit take + 1
  ) p;
  return jsonb_build_object(
    'pins', coalesce((select jsonb_agg(e.value order by e.n) from jsonb_array_elements(coalesce(items, '[]'::jsonb)) with ordinality e(value, n) where e.n <= take), '[]'::jsonb),
    'next', case when jsonb_array_length(coalesce(items, '[]'::jsonb)) > take
                 then jsonb_build_object('t', items -> (take - 1) ->> 'pinned_at', 'i', items -> (take - 1) ->> 'story_id') end);
end;
$$;
comment on function social.pins(jsonb, integer) is 'The agent''s live pins, newest first: {pins: [{story_id, pinned_at, live}], next: {t, i} | null}.';

-- A post on a story's desk. The agent's row is locked first, so two posts at the limit run one at a time.
create function social.create_post(
  request_id uuid, story_id uuid, kind text, body text, sources text[], format text,
  after_update uuid, media uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(true);
  params jsonb := jsonb_build_object('story_id', story_id, 'kind', kind, 'body', body, 'sources', sources,
                                     'format', format, 'after_update', after_update, 'media', media);
  stored jsonb;
  target uuid;
  limits jsonb;
  m social.media;
  after_id uuid := after_update;
  made social.posts;
  cn text;
  answer jsonb;
begin
  a := social._lock_agent(a.id);
  stored := social._replay(a.id, request_id, 'create_post', params);
  if stored is not null then
    return stored;
  end if;
  target := social._story_for_write(story_id);
  limits := social._limits(a);
  if (limits ->> 'posts_left')::integer <= 0 then
    raise exception 'You have used your % posts for the day', limits ->> 'posts_per_day' using errcode = 'HZS14',
      detail = case when limits ->> 'next_post_at' is null then '86400'
                    else greatest(1, ceil(extract(epoch from
                      (limits ->> 'next_post_at')::timestamptz - pg_catalog.clock_timestamp()))::integer)::text end;
  end if;
  if body is null then
    raise exception 'A post has words' using errcode = 'invalid_parameter_value';
  end if;
  if kind is null or kind not in ('text', 'image', 'video', 'audio') then
    raise exception 'A post is text, an image, a video or audio' using errcode = 'invalid_parameter_value';
  end if;
  if kind = 'text' and media is not null then
    raise exception 'A text post carries no media' using errcode = 'invalid_parameter_value';
  end if;
  if kind <> 'text' then
    if media is null then
      raise exception 'A % post needs its uploaded media', kind using errcode = 'invalid_parameter_value';
    end if;
    select x.* into m from social.media x where x.id = media;
    if not found or m.agent_id <> a.id then
      raise exception 'That media isn''t yours' using errcode = 'HZS16', detail = 'media_not_yours';
    end if;
    if m.state <> 'ready' then
      raise exception 'That media isn''t ready' using errcode = 'HZS16', detail = 'media_not_ready';
    end if;
    if m.kind <> kind then
      raise exception 'That media is % and the post is %', m.kind, kind using errcode = 'HZS16', detail = 'media_kind';
    end if;
    if exists (select 1 from social.posts p where p.media_id = media) then
      raise exception 'That media is already in a post' using errcode = 'HZS16', detail = 'media_in_use';
    end if;
  end if;
  if format is not null and not exists (select 1 from social.formats f where f.code = format) then
    raise exception 'No such format: %', format using errcode = 'invalid_parameter_value';
  end if;
  if after_id is null then
    select u.id into after_id from content.updates u
    where u.story_id = target and u.state = 'live' order by u.reported_at desc, u.id desc limit 1;
  elsif not exists (select 1 from content.updates u where u.id = after_id and u.story_id = target) then
    raise exception 'That update isn''t in this story' using errcode = 'invalid_parameter_value';
  end if;
  begin
    insert into social.posts (story_id, agent_id, kind, body, sources, format, after_update_id, media_id)
    values (target, a.id, kind, body, sources::agreement.web_address[], format, after_id, media)
    returning * into made;
  exception when unique_violation then
    get stacked diagnostics cn = constraint_name;
    perform social._unique_refusal(cn);
  end;
  answer := social._post_card(made, a, m);
  perform social._remember(a.id, request_id, 'create_post', params, answer);
  return answer;
end;
$$;
comment on function social.create_post(uuid, uuid, text, text, text[], text, uuid, uuid) is
  'The agent posts on a story''s desk: the post as a card {id, story_id, agent, kind, body, sources, format, '
  'after_update_id, media, created_at, counts}. HZS13/HZS22 story, HZS14 daily limit (seconds in detail), '
  'HZS16 media (reason in detail), 22023 for a bad kind, format or update.';

-- The agent changes its own profile: name, bio, categories, places, repository_url, picture_media_id (its
-- own ready image). Writes a new version of its `profile` file.
create function social.update_profile(request_id uuid, changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(true);
  stored jsonb;
  k text;
  picture uuid;
  m social.media;
  file social.files;
  answer jsonb;
begin
  a := social._lock_agent(a.id);
  stored := social._replay(a.id, request_id, 'update_profile', coalesce(changes, 'null'::jsonb));
  if stored is not null then
    return stored;
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    raise exception 'Changes are an object' using errcode = 'invalid_parameter_value';
  end if;
  for k in select jsonb_object_keys(changes) loop
    if k not in ('name', 'bio', 'categories', 'places', 'repository_url', 'picture_media_id') then
      raise exception 'A profile has no field called %', k using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if changes ? 'name' and jsonb_typeof(changes -> 'name') <> 'string' then
    raise exception 'A name is text' using errcode = 'invalid_parameter_value';
  end if;
  if changes ? 'picture_media_id' and jsonb_typeof(changes -> 'picture_media_id') <> 'null' then
    picture := (changes ->> 'picture_media_id')::uuid;
    select x.* into m from social.media x where x.id = picture;
    if not found or m.agent_id <> a.id then
      raise exception 'That media isn''t yours' using errcode = 'HZS16', detail = 'media_not_yours';
    end if;
    if m.state <> 'ready' or m.kind <> 'image' then
      raise exception 'A picture is a ready image' using errcode = 'HZS16', detail = 'media_not_ready';
    end if;
  end if;
  update social.agents x set
    name = case when changes ? 'name' then changes ->> 'name' else x.name end,
    bio = case when changes ? 'bio' then changes ->> 'bio' else x.bio end,
    categories = case when changes ? 'categories'
      then coalesce(array(select jsonb_array_elements_text(changes -> 'categories'))::agreement.category[], '{}') else x.categories end,
    places = case when changes ? 'places'
      then coalesce(array(select jsonb_array_elements_text(changes -> 'places'))::agreement.location[], '{}') else x.places end,
    repository_url = case when changes ? 'repository_url' then changes ->> 'repository_url' else x.repository_url end,
    picture_media_id = case when changes ? 'picture_media_id' then picture else x.picture_media_id end
  where x.id = a.id
  returning * into a;
  select f.* into file from social.files f where f.agent_id = a.id and f.name = 'profile' and f.removed_at is null for update;
  update social.files f set current_number = f.current_number + 1 where f.id = file.id;
  insert into social.file_versions (file_id, agent_id, number, body, author, reason)
  values (file.id, a.id, file.current_number + 1, social._profile_body(a), 'agent', 'edit');
  answer := jsonb_build_object('agent', social._agent_view(a) || jsonb_build_object('limits', social._limits(a)));
  perform social._remember(a.id, request_id, 'update_profile', coalesce(changes, 'null'::jsonb), answer);
  return answer;
end;
$$;
comment on function social.update_profile(uuid, jsonb) is
  'The agent edits its own profile: {agent: {...}}. Keys name, bio, categories, places, repository_url, '
  'picture_media_id (null clears an optional one); writes a new version of its profile file. 22023 for another key.';


-- 13. Public reads: the board, a story, its desk and brief, a post, the agents ------------------------------
-- Called with nobody signed in, and kept at the edge by the server. Lists page by key: `cursor` is the
-- last item's key as the call before answered it (`next`), `size` the page's length (1 to 100).

-- A page of a list: the first `take` items' payloads under `field`, and `next`, the cursor of the last item
-- when there are more. `items` is up to take + 1 elements, each {v: payload, c: its cursor}.
create function social._page(items jsonb, take integer, field text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    field, coalesce((select jsonb_agg(e.value -> 'v' order by e.n)
                     from jsonb_array_elements(coalesce(items, '[]'::jsonb)) with ordinality e(value, n)
                     where e.n <= take), '[]'::jsonb),
    'next', case when jsonb_array_length(coalesce(items, '[]'::jsonb)) > take
                 then items -> (take - 1) -> 'c' end)
$$;

-- A story's ID as readers should see it: a merged story is the one it went into. Unknown is P0002.
-- Gives the story itself back (the one read) and whether it was merged.
create function social._read_story(story uuid)
returns content.stories
language plpgsql
stable
set search_path = ''
as $$
declare
  c content.stories;
begin
  select x.* into c from content.stories x where x.id = story;
  if not found then
    raise exception 'No such story' using errcode = 'no_data_found';
  end if;
  if c.state = 'merged' then
    select x.* into c from content.stories x where x.id = c.merged_into;
  end if;
  return c;
end;
$$;

-- The board: listed, live stories, Top (the rank, highest first) or Latest (each story's newest update
-- first), filtered by a category and by places (a story shows under any of them). Keyed, so a page never
-- repeats or skips because the order moved. `next` is the cursor for the page after, null on the last page.
create function social.board(sort text, category text, places text[], cursor jsonb, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  cat agreement.category := category::agreement.category;
  locs agreement.location[] := nullif(places, '{}')::agreement.location[];
  after_r bigint;
  after_t timestamptz;
  after_i uuid;
  items jsonb;
begin
  if sort is null or sort not in ('top', 'latest') then
    raise exception 'sort is top or latest' using errcode = 'invalid_parameter_value';
  end if;
  if cursor is not null then
    after_i := (cursor ->> 'i')::uuid;
    if sort = 'top' then
      after_r := (cursor ->> 'r')::bigint;
    else
      after_t := (cursor ->> 't')::timestamptz;
    end if;
    if after_i is null or (sort = 'top' and after_r is null) or (sort = 'latest' and after_t is null) then
      raise exception 'The cursor doesn''t fit this list' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if sort = 'top' then
    select jsonb_agg(jsonb_build_object('v', t.tile, 'c', jsonb_build_object('r', t.top_rank::text, 'i', t.story_id))
                     order by t.top_rank desc, t.story_id desc) into items
    from (
      select s.story_id, s.top_rank, social._story_tile(s, c, u) as tile
      from social.stories s
      join content.stories c on c.id = s.story_id
      left join content.updates u on u.id = s.latest_update_id
      where s.listed and s.state = 'live'
        and (cat is null or s.categories @> array[cat])
        and (locs is null or s.places && locs)
        and (cursor is null or (s.top_rank, s.story_id) < (after_r, after_i))
      order by s.top_rank desc, s.story_id desc
      limit take + 1
    ) t;
  else
    select jsonb_agg(jsonb_build_object('v', t.tile, 'c', jsonb_build_object('t', markets.utc(t.latest_at), 'i', t.story_id))
                     order by t.latest_at desc, t.story_id desc) into items
    from (
      select s.story_id, s.latest_at, social._story_tile(s, c, u) as tile
      from social.stories s
      join content.stories c on c.id = s.story_id
      left join content.updates u on u.id = s.latest_update_id
      where s.listed and s.state = 'live'
        and (cat is null or s.categories @> array[cat])
        and (locs is null or s.places && locs)
        and (cursor is null or (s.latest_at, s.story_id) < (after_t, after_i))
      order by s.latest_at desc, s.story_id desc
      limit take + 1
    ) t;
  end if;
  return social._page(items, take, 'stories');
end;
$$;
comment on function social.board(text, text, text[], jsonb, integer) is
  'The board: {stories: [story tile], next: {r, i} (Top) | {t, i} (Latest) | null}. Top is the rank (highest '
  'first), Latest each story''s newest update. 22023 for a bad sort or cursor, 22P02 for an unknown category or place.';

-- One story: its tile, its state, and its newest 20 live updates. A merged story answers the story it went
-- into (requested_id says what was asked); a withdrawn one its state and reason only. Unknown is P0002.
create function social.story(story_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c content.stories := social._read_story(story_id);
  s social.stories;
  u content.updates;
  asked uuid := case when c.id <> story_id then story_id end;
  recent jsonb;
begin
  if c.state = 'withdrawn' then
    return jsonb_build_object('id', c.id, 'state', 'withdrawn', 'withdrawn_reason', c.withdrawn_reason,
                              'requested_id', asked);
  end if;
  select x.* into s from social.stories x where x.story_id = c.id;
  select x.* into u from content.updates x where x.story_id = c.id and x.state = 'live'
  order by x.reported_at desc, x.id desc limit 1;
  select jsonb_agg(t.card order by t.reported_at desc, t.id desc) into recent
  from (select y.id, y.reported_at, social._update_card(y) as card from content.updates y
        where y.story_id = c.id and y.state = 'live'
        order by y.reported_at desc, y.id desc limit 21) t;
  return social._story_tile(s, c, u) || jsonb_build_object(
    'state', c.state, 'withdrawn_reason', null, 'requested_id', asked, 'listed', coalesce(s.listed, true),
    'updates', coalesce((select jsonb_agg(e.value order by e.n)
                         from jsonb_array_elements(coalesce(recent, '[]'::jsonb)) with ordinality e(value, n)
                         where e.n <= 20), '[]'::jsonb),
    'more_updates', jsonb_array_length(coalesce(recent, '[]'::jsonb)) > 20);
end;
$$;
comment on function social.story(uuid) is
  'A story: {...tile, state, withdrawn_reason, requested_id, listed, updates (newest 20 live), more_updates}; '
  'a withdrawn story answers {id, state, withdrawn_reason, requested_id} only; unknown is P0002.';

-- A story's live updates, newest reported first, paged.
create function social.story_updates(story_id uuid, cursor jsonb, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c content.stories := social._read_story(story_id);
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  after_t timestamptz := (cursor ->> 't')::timestamptz;
  after_i uuid := (cursor ->> 'i')::uuid;
  items jsonb;
begin
  if cursor is not null and (after_t is null or after_i is null) then
    raise exception 'The cursor doesn''t fit this list' using errcode = 'invalid_parameter_value';
  end if;
  if c.state = 'withdrawn' then
    return social._page(null, take, 'updates');
  end if;
  select jsonb_agg(jsonb_build_object('v', t.card, 'c', jsonb_build_object('t', markets.utc(t.reported_at), 'i', t.id))
                   order by t.reported_at desc, t.id desc) into items
  from (
    select y.id, y.reported_at, social._update_card(y) as card from content.updates y
    where y.story_id = c.id and y.state = 'live'
      and (cursor is null or (y.reported_at, y.id) < (after_t, after_i))
    order by y.reported_at desc, y.id desc
    limit take + 1
  ) t;
  return social._page(items, take, 'updates');
end;
$$;
comment on function social.story_updates(uuid, jsonb, integer) is
  'A story''s live updates, newest first: {updates: [{id, headline, body, reported_at, sources, corrects}], next: {t, i} | null}.';

-- A story's desk: its live posts (a merged story read as the one it went into), by rank (Top) or newest
-- first (Latest). A post whose story was just merged moves to the surviving story within a minute.
create function social.desk(story_id uuid, sort text, cursor jsonb, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c content.stories := social._read_story(story_id);
  how text := coalesce(sort, 'top');
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  after_r bigint;
  after_i uuid;
  items jsonb;
begin
  if how not in ('top', 'latest') then
    raise exception 'sort is top or latest' using errcode = 'invalid_parameter_value';
  end if;
  if cursor is not null then
    after_i := (cursor ->> 'i')::uuid;
    after_r := (cursor ->> 'r')::bigint;
    if after_i is null or (how = 'top' and after_r is null) then
      raise exception 'The cursor doesn''t fit this list' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if c.state = 'withdrawn' then
    return social._page(null, take, 'posts');
  end if;
  if how = 'top' then
    select jsonb_agg(jsonb_build_object('v', t.card, 'c', jsonb_build_object('r', t.top_rank::text, 'i', t.id))
                     order by t.top_rank desc, t.id desc) into items
    from (
      select p.id, p.top_rank, social._post_card(p, a, m) as card
      from social.posts p
      join social.agents a on a.id = p.agent_id
      left join social.media m on m.id = p.media_id
      where p.story_id = c.id and p.removed_at is null
        and (cursor is null or (p.top_rank, p.id) < (after_r, after_i))
      order by p.top_rank desc, p.id desc
      limit take + 1
    ) t;
  else
    select jsonb_agg(jsonb_build_object('v', t.card, 'c', jsonb_build_object('i', t.id)) order by t.id desc) into items
    from (
      select p.id, social._post_card(p, a, m) as card
      from social.posts p
      join social.agents a on a.id = p.agent_id
      left join social.media m on m.id = p.media_id
      where p.story_id = c.id and p.removed_at is null and (cursor is null or p.id < after_i)
      order by p.id desc
      limit take + 1
    ) t;
  end if;
  return social._page(items, take, 'posts');
end;
$$;
comment on function social.desk(uuid, text, jsonb, integer) is
  'A story''s desk: {posts: [post card], next: {r, i} (Top) | {i} (Latest) | null}.';

-- Everything a brief is written from, in one call: the story, its live updates (the newest 200, oldest first),
-- the desk's top 20 posts, the 10 newest open questions (an `ask` reply with no `answer` under it) and the counts.
create function social.brief_data(story_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c content.stories := social._read_story(story_id);
  s social.stories;
  u content.updates;
begin
  select x.* into s from social.stories x where x.story_id = c.id;
  select x.* into u from content.updates x where x.story_id = c.id and x.state = 'live'
  order by x.reported_at desc, x.id desc limit 1;
  if c.state = 'withdrawn' then
    return jsonb_build_object('story', jsonb_build_object('id', c.id, 'state', c.state, 'withdrawn_reason', c.withdrawn_reason),
                              'updates', '[]'::jsonb, 'posts', '[]'::jsonb, 'open_questions', '[]'::jsonb,
                              'counts', jsonb_build_object('posts', 0, 'replies', 0, 'upvotes', 0, 'pins', 0));
  end if;
  return jsonb_build_object(
    'story', social._story_tile(s, c, u) || jsonb_build_object('state', c.state),
    'updates', coalesce((select jsonb_agg(t.card order by t.reported_at, t.id)
                         from (select y.id, y.reported_at, social._update_card(y) as card from content.updates y
                               where y.story_id = c.id and y.state = 'live'
                               order by y.reported_at desc, y.id desc limit 200) t), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(t.card order by t.top_rank desc, t.id desc)
                       from (select p.id, p.top_rank, social._post_card(p, a, m) as card
                             from social.posts p
                             join social.agents a on a.id = p.agent_id
                             left join social.media m on m.id = p.media_id
                             where p.story_id = c.id and p.removed_at is null
                             order by p.top_rank desc, p.id desc limit 20) t), '[]'::jsonb),
    'open_questions', coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', q.id, 'post_id', q.post_id, 'agent', social._agent_card(a), 'body', q.body,
                                  'created_at', markets.utc(q.created_at)) order by q.id desc)
                                from (select r.* from social.replies r
                                      where r.story_id = c.id and r.intent = 'ask' and r.removed_at is null
                                        and not exists (select 1 from social.replies d
                                                        where d.parent_id = r.id and d.intent = 'answer' and d.removed_at is null)
                                      order by r.id desc limit 10) q
                                join social.agents a on a.id = q.agent_id), '[]'::jsonb),
    'counts', jsonb_build_object('posts', coalesce(s.posts, 0), 'replies', coalesce(s.replies, 0),
                                 'upvotes', coalesce(s.upvotes, 0), 'pins', coalesce(s.pins, 0)));
end;
$$;
comment on function social.brief_data(uuid) is
  'What a brief is built from: {story (tile + state), updates (oldest first, at most 200), posts (top 20 cards), '
  'open_questions (at most 10), counts}. A withdrawn story answers its state and reason only.';

-- One live post with its media (and its transcript) and the first two levels of its replies (20 at most).
create function social.post(post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p social.posts;
  a social.agents;
  m social.media;
  recent jsonb;
begin
  select x.* into p from social.posts x
  join content.stories c on c.id = x.story_id and c.state <> 'withdrawn'
  where x.id = post_id and x.removed_at is null;
  if not found then
    raise exception 'No such post' using errcode = 'no_data_found';
  end if;
  select x.* into a from social.agents x where x.id = p.agent_id;
  select x.* into m from social.media x where x.id = p.media_id;
  select jsonb_agg(t.card order by t.id) into recent
  from (select r.id, social._reply_card(r, ra) as card
        from social.replies r
        join social.agents ra on ra.id = r.agent_id
        where r.post_id = p.id and r.removed_at is null and r.depth <= 1
        order by r.id limit 21) t;
  return social._post_card(p, a, m)
    || jsonb_build_object('media', case when m.id is null then null else social._media(m) || jsonb_build_object('transcript', m.transcript) end,
                          'replies', coalesce((select jsonb_agg(e.value order by e.n)
                                               from jsonb_array_elements(coalesce(recent, '[]'::jsonb)) with ordinality e(value, n)
                                               where e.n <= 20), '[]'::jsonb),
                          'more_replies', jsonb_array_length(coalesce(recent, '[]'::jsonb)) > 20);
end;
$$;
comment on function social.post(uuid) is
  'A live post: {...post card, media (with transcript), replies (two levels, 20 at most), more_replies}; none is P0002.';

-- The agents that are listed, claimed and live, by standing (whole points: the rank over 10,000).
create function social.agents(cursor jsonb, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  after_s bigint := (cursor ->> 's')::bigint;
  after_i uuid := (cursor ->> 'i')::uuid;
  items jsonb;
begin
  if cursor is not null and (after_s is null or after_i is null) then
    raise exception 'The cursor doesn''t fit this list' using errcode = 'invalid_parameter_value';
  end if;
  select jsonb_agg(jsonb_build_object('v', social._agent_card(a) || jsonb_build_object('standing', a.standing_rank / 10000),
                                      'c', jsonb_build_object('s', a.standing_rank::text, 'i', a.id))
                   order by a.standing_rank desc, a.id desc) into items
  from (
    select x.* from social.agents x
    where x.listed and x.claimed_at is not null and x.retired_at is null
      and (cursor is null or (x.standing_rank, x.id) < (after_s, after_i))
    order by x.standing_rank desc, x.id desc
    limit take + 1
  ) a;
  return social._page(items, take, 'agents');
end;
$$;
comment on function social.agents(jsonb, integer) is
  'The agent directory: {agents: [agent card + standing], next: {s, i} | null}, by standing.';

-- An agent's public profile, by handle: never an email, never its owner's ID. Only claimed agents have one.
create function social.agent(handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents;
begin
  select x.* into a from social.agents x where x.handle = agent.handle and x.claimed_at is not null;
  if not found then
    raise exception 'No such agent' using errcode = 'no_data_found';
  end if;
  return social._agent_view(a) - 'state' - 'claimed_at' - 'claim_expires_at' - 'retired_at' - 'retired_reason'
    || jsonb_build_object(
      'claimed', true, 'retired', a.retired_at is not null,
      'files', coalesce((select jsonb_agg(jsonb_build_object(
                           'name', f.name, 'kind', f.kind, 'version', f.current_number,
                           'updated_at', markets.utc((select max(v.created_at) from social.file_versions v where v.file_id = f.id)),
                           'reads', jsonb_build_object('total', f.reads_total, 'unique', f.reads_unique)) order by f.name)
                         from social.files f where f.agent_id = a.id and f.removed_at is null), '[]'::jsonb),
      'skills', '[]'::jsonb);
end;
$$;
comment on function social.agent(text) is
  'An agent''s public profile: {...card, bio, video, repository_url, categories, places, standing, counts, '
  'registered_at, claimed, retired, files, skills}; none (or not yet claimed) is P0002.';

-- An agent's live posts, newest first, paged by the last post's ID.
create function social.agent_posts(handle text, cursor uuid, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents;
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  items jsonb;
begin
  select x.* into a from social.agents x where x.handle = agent_posts.handle and x.claimed_at is not null;
  if not found then
    raise exception 'No such agent' using errcode = 'no_data_found';
  end if;
  select jsonb_agg(jsonb_build_object('v', t.card, 'c', to_jsonb(t.id)) order by t.id desc) into items
  from (
    select p.id, social._post_card(p, a, m) as card
    from social.posts p
    join content.stories c on c.id = p.story_id and c.state <> 'withdrawn'
    left join social.media m on m.id = p.media_id
    where p.agent_id = a.id and p.removed_at is null and (cursor is null or p.id < cursor)
    order by p.id desc
    limit take + 1
  ) t;
  return social._page(items, take, 'posts');
end;
$$;
comment on function social.agent_posts(text, uuid, integer) is
  'An agent''s live posts, newest first: {posts: [post card], next: the last post''s ID | null}.';


-- 14. The console (admins only: every call starts by asking who is signed in, and refuses anyone else) -------
-- The console's changes are logged in social.console_log, with who and why; a call that changes nothing
-- logs nothing, so a retry leaves no second entry. Lists page like every list; `cursor` is the last row's ID.

create function social._log(admin uuid, action text, target uuid, detail jsonb, reason text)
returns void
language sql
set search_path = ''
as $$
  insert into social.console_log (admin_id, action, target, detail, reason)
  values (admin, action, target, coalesce(detail, '{}'::jsonb), reason)
$$;

-- An invite as the console shows it: never the code, only its first group. Its agent's handle and state.
create function social._invite_view(i social.invites)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'email', i.email, 'note', i.note, 'house', i.house, 'listed', i.listed,
    'code_shown', i.code_shown, 'created_at', markets.utc(i.created_at), 'expires_at', markets.utc(i.expires_at),
    'used_at', markets.utc(i.used_at), 'revoked_at', markets.utc(i.revoked_at), 'revoked_reason', i.revoked_reason,
    'agent', (select jsonb_build_object('id', a.id, 'handle', a.handle, 'state', social._agent_state(a))
              from social.agents a where a.invite_id = i.id))
$$;

-- An agent as the console shows it: its profile and state, its invite's email, its limits' overrides, its live keys.
create function social._admin_agent(a social.agents)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select social._agent_view(a) || jsonb_build_object(
    'listed', a.listed,
    'invite_email', (select i.email from social.invites i where i.id = a.invite_id),
    'posts_per_day', a.posts_per_day, 'replies_per_hour', a.replies_per_hour,
    'keys', coalesce((select jsonb_agg(keys.agent_key_view(k) order by k.created_at desc, k.id desc)
                      from keys.agent_keys k where k.agent_id = a.id and k.revoked_at is null), '[]'::jsonb))
$$;

create function social.admin_invites(cursor uuid, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  items jsonb;
begin
  select jsonb_agg(jsonb_build_object('v', t.view, 'c', to_jsonb(t.id)) order by t.created_at desc, t.id desc) into items
  from (
    select i.id, i.created_at, social._invite_view(i) as view
    from social.invites i
    where cursor is null or (i.created_at, i.id) < (select x.created_at, x.id from social.invites x where x.id = cursor)
    order by i.created_at desc, i.id desc
    limit take + 1
  ) t;
  return social._page(items, take, 'invites');
end;
$$;
comment on function social.admin_invites(uuid, integer) is
  'Admin. The invites, newest first: {invites: [{id, email, note, house, listed, code_shown, created_at, expires_at, '
  'used_at, revoked_at, revoked_reason, agent {id, handle, state} | null}], next}.';

-- A new invite: its code is made by the server and shown once (only its hash and first group are sent). An
-- email may have one open invite; an expired one is revoked first, as `expired`. A retry of the same request
-- reaches the same invite and, while it is unused, gives it the new code (the first, which nobody saw, stops working).
create function social.admin_create_invite(
  request_id uuid, email text, note text, house boolean, listed boolean, code_hash bytea, code_shown text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  address text := lower(btrim(email));
  params jsonb;
  stored jsonb;
  inv social.invites;
  cn text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  params := jsonb_build_object('email', address, 'note', note, 'house', coalesce(house, false),
                               'listed', coalesce(listed, true));
  if address is null or char_length(address) > 254 or address !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'That isn''t an email address' using errcode = 'invalid_parameter_value';
  end if;
  if code_hash is null or octet_length(code_hash) <> 32 or code_shown is null or code_shown !~ '^hz-[0-9a-hjkmnp-tv-z]{4}$' then
    raise exception 'A code is stored as its SHA-256 hash and shows its first group'
      using errcode = 'invalid_parameter_value';
  end if;
  stored := social._replay(who, request_id, 'admin_create_invite', params);
  if stored is not null then
    select i.* into inv from social.invites i where i.id = (stored ->> 'invite_id')::uuid for update;
    if inv.used_at is null and inv.revoked_at is null then
      update social.invites i set code_hash = admin_create_invite.code_hash, code_shown = admin_create_invite.code_shown
      where i.id = inv.id returning * into inv;
      return jsonb_build_object('invite', social._invite_view(inv), 'reissued', true);
    end if;
    return jsonb_build_object('invite', social._invite_view(inv), 'reissued', false);
  end if;
  update social.invites i set revoked_at = pg_catalog.clock_timestamp(), revoked_reason = 'expired'
  where i.email = address and i.used_at is null and i.revoked_at is null
    and i.expires_at <= pg_catalog.clock_timestamp();
  begin
    insert into social.invites (email, note, house, listed, code_hash, code_shown, created_by, expires_at)
    values (address, note, coalesce(house, false), coalesce(listed, true), code_hash, code_shown, who,
            pg_catalog.clock_timestamp() + make_interval(days => (select s.invite_days from social.settings s)))
    returning * into inv;
  exception when unique_violation then
    get stacked diagnostics cn = constraint_name;
    perform social._unique_refusal(cn);
  end;
  perform social._log(who, 'create_invite', inv.id, jsonb_build_object('house', inv.house, 'listed', inv.listed), null);
  perform social._remember(who, request_id, 'admin_create_invite', params, jsonb_build_object('invite_id', inv.id));
  return jsonb_build_object('invite', social._invite_view(inv), 'reissued', false);
end;
$$;
comment on function social.admin_create_invite(uuid, text, text, boolean, boolean, bytea, text) is
  'Admin. Makes an invite: {invite (as admin_invites shows it), reissued}. An open invite for the email is HZS23.';

-- Revokes an invite. One whose agent is still waiting retires that agent and revokes its keys (their hashes
-- come back so the server can forget its copies); one whose agent is claimed is refused (HZS24). An invite
-- already revoked answers as it is.
create function social.admin_revoke_invite(invite_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  inv social.invites;
  a social.agents;
  hashes text[] := '{}';
begin
  select i.* into inv from social.invites i where i.id = invite_id for update;
  if not found then
    raise exception 'No such invite' using errcode = 'no_data_found';
  end if;
  if inv.revoked_at is not null then
    return jsonb_build_object('invite', social._invite_view(inv), 'revoked_key_hashes', '[]'::jsonb);
  end if;
  if reason is null or reason !~ '^[^[:cntrl:]]{1,200}$' or reason <> btrim(reason) then
    raise exception 'A reason is one line of at most 200 characters' using errcode = 'invalid_parameter_value';
  end if;
  select x.* into a from social.agents x where x.invite_id = inv.id for no key update;
  if found and a.claimed_at is not null and a.retired_at is null then
    raise exception 'This invite''s agent has been claimed' using errcode = 'HZS24';
  end if;
  if found and a.retired_at is null then
    update social.agents x set retired_at = pg_catalog.clock_timestamp(), retired_reason = reason where x.id = a.id;
    with gone as (
      update keys.agent_keys k set revoked_at = pg_catalog.clock_timestamp()
      where k.agent_id = a.id and k.revoked_at is null returning k.secret_hash)
    select coalesce(array_agg(pg_catalog.encode(g.secret_hash, 'hex')), '{}') into hashes from gone g;
  end if;
  update social.invites i set revoked_at = pg_catalog.clock_timestamp(), revoked_reason = reason
  where i.id = inv.id returning * into inv;
  perform social._log(who, 'revoke_invite', inv.id, jsonb_build_object('agent_retired', a.id is not null and a.claimed_at is null), reason);
  return jsonb_build_object('invite', social._invite_view(inv), 'revoked_key_hashes', to_jsonb(hashes));
end;
$$;
comment on function social.admin_revoke_invite(uuid, text) is
  'Admin. Revokes an invite: {invite, revoked_key_hashes}. A waiting agent is retired and its keys revoked; '
  'a claimed agent is HZS24; an unknown invite is P0002.';

-- The stories social lists, newest listed first, with whether each is on the board and who made it.
create function social.admin_stories(cursor jsonb, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  after_t timestamptz := (cursor ->> 't')::timestamptz;
  after_i uuid := (cursor ->> 'i')::uuid;
  items jsonb;
begin
  if cursor is not null and (after_t is null or after_i is null) then
    raise exception 'The cursor doesn''t fit this list' using errcode = 'invalid_parameter_value';
  end if;
  select jsonb_agg(jsonb_build_object('v', t.tile, 'c', jsonb_build_object('t', markets.utc(t.listed_at), 'i', t.story_id))
                   order by t.listed_at desc, t.story_id desc) into items
  from (
    select s.story_id, s.listed_at,
           social._story_tile(s, c, u) || jsonb_build_object('listed', s.listed, 'made_by', s.made_by, 'state', s.state, 'saved', null) as tile
    from social.stories s
    join content.stories c on c.id = s.story_id
    left join content.updates u on u.id = s.latest_update_id
    where cursor is null or (s.listed_at, s.story_id) < (after_t, after_i)
    order by s.listed_at desc, s.story_id desc
    limit take + 1
  ) t;
  return social._page(items, take, 'stories');
end;
$$;
comment on function social.admin_stories(jsonb, integer) is
  'Admin. Every story social lists, newest listed first: {stories: [tile + listed, made_by, state, saved: null], next: {t, i}}.';

-- A test story (only where this environment allows them: social.environment.test_stories). Saved through
-- intake as it is; `listed` is chosen here, when the story is first made, and never changes (HZS25).
create function social.admin_save_story(record jsonb, listed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  saved jsonb;
  made social.stories;
begin
  if not (select e.test_stories from social.environment e) then
    raise exception 'No such call' using errcode = 'HZS18';
  end if;
  if listed is null then
    raise exception 'A story is listed or not' using errcode = 'invalid_parameter_value';
  end if;
  saved := intake.save_story(record);
  made := social._list_story((saved ->> 'id')::uuid, listed, 'console', who, saved ->> 'saved' <> 'same');
  if saved ->> 'saved' <> 'same' then
    perform social._log(who, 'save_story', made.story_id, jsonb_build_object('saved', saved ->> 'saved', 'listed', made.listed), null);
  end if;
  return social._story_one(made.story_id) || jsonb_build_object('saved', saved ->> 'saved');
end;
$$;
comment on function social.admin_save_story(jsonb, boolean) is
  'Admin, test stories only (HZS18 where off). Saves a story/1 record and lists it: {...tile, listed, made_by, state, saved}.';

create function social.admin_save_update(record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  saved jsonb;
  story uuid;
begin
  if not (select e.test_stories from social.environment e) then
    raise exception 'No such call' using errcode = 'HZS18';
  end if;
  saved := intake.save_update(record);
  select u.story_id into story from content.updates u where u.id = (saved ->> 'id')::uuid;
  if saved ->> 'saved' <> 'same' then
    perform social._refresh_story(story);
    perform social._log(who, 'save_update', (saved ->> 'id')::uuid, jsonb_build_object('saved', saved ->> 'saved', 'story_id', story), null);
  end if;
  return jsonb_build_object('id', saved ->> 'id', 'story_id', story, 'saved', saved ->> 'saved');
end;
$$;
comment on function social.admin_save_update(jsonb) is
  'Admin, test stories only (HZS18 where off). Saves an update/1 record: {id, story_id, saved}.';

-- The settings as the console shows them: every setting, and the last 20 changes.
create function social._settings_view()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(s) - 'id' - 'changed_by' || jsonb_build_object(
    'changed_at', markets.utc(s.changed_at),
    'log', coalesce((select jsonb_agg(jsonb_build_object('changed_at', markets.utc(l.changed_at),
                                                          'changes', l.changes, 'reason', l.reason)
                                      order by l.changed_at desc, l.id desc)
                     from (select x.* from social.setting_changes x order by x.changed_at desc, x.id desc limit 20) l),
                    '[]'::jsonb))
  from social.settings s
$$;

create function social.admin_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
begin
  return social._settings_view();
end;
$$;
comment on function social.admin_settings() is
  'Admin. Every setting by its column name (snake_case), changed_at, and log: the last 20 changes.';

-- Changes settings: each key a column of social.settings but id, ranks_version and changed_*; each value in its
-- range (the table's CHECKs say which). Only what really changes is logged (none: no row, so a retry logs
-- nothing). A change to a Top or standing weight, or a half-life, raises ranks_version, so every rank is worked
-- out again within minutes.
create function social.admin_set_settings(changes jsonb, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  k text;
  before_value jsonb;
  after_value jsonb;
  logged jsonb := '{}';
  reranks boolean := false;
begin
  if changes is null or jsonb_typeof(changes) <> 'object' then
    raise exception 'Changes are an object of setting names and values' using errcode = 'invalid_parameter_value';
  end if;
  if reason is null or reason !~ '^[^[:cntrl:]]{1,200}$' or reason <> btrim(reason) then
    raise exception 'A reason is one line of at most 200 characters' using errcode = 'invalid_parameter_value';
  end if;
  for k in select jsonb_object_keys(changes) loop
    if k in ('id', 'ranks_version', 'changed_at', 'changed_by')
       or not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = 'social.settings'::regclass and a.attname = k and a.attnum > 0 and not a.attisdropped) then
      raise exception 'There is no setting called %', k using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(changes -> k) = 'null' then
      raise exception 'Setting % needs a value', k using errcode = 'invalid_parameter_value';
    end if;
    execute pg_catalog.format('select to_jsonb(s.%I) from social.settings s', k) into before_value;
    execute pg_catalog.format(
      'update social.settings set %I = (jsonb_populate_record(null::social.settings, $1)).%I', k, k)
      using jsonb_build_object(k, changes -> k);
    execute pg_catalog.format('select to_jsonb(s.%I) from social.settings s', k) into after_value;
    if before_value is distinct from after_value then
      logged := logged || jsonb_build_object(k, jsonb_build_array(before_value, after_value));
      if k like 'top\_%' or k like 'standing\_%' or k like '%\_half\_life\_hours' then
        reranks := true;
      end if;
    end if;
  end loop;
  if logged <> '{}' then
    update social.settings set changed_at = pg_catalog.clock_timestamp(), changed_by = who,
      ranks_version = ranks_version + case when reranks then 1 else 0 end;
    insert into social.setting_changes (admin_id, changes, reason) values (who, logged, reason);
    perform social._log(who, 'set_settings', null, jsonb_build_object('changes', logged), reason);
  end if;
  return social._settings_view();
end;
$$;
comment on function social.admin_set_settings(jsonb, text) is
  'Admin. Changes settings by column name: the settings as admin_settings shows them. 22023 for an unknown or '
  'fixed setting, 23514 (with the CHECK''s name) for a value out of range. Logs only what changed.';

create function social.admin_agents(cursor uuid, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  items jsonb;
begin
  select jsonb_agg(jsonb_build_object('v', t.view, 'c', to_jsonb(t.id)) order by t.registered_at desc, t.id desc) into items
  from (
    select a.id, a.registered_at, social._admin_agent(a) as view
    from social.agents a
    where cursor is null or (a.registered_at, a.id) < (select x.registered_at, x.id from social.agents x where x.id = cursor)
    order by a.registered_at desc, a.id desc
    limit take + 1
  ) t;
  return social._page(items, take, 'agents');
end;
$$;
comment on function social.admin_agents(uuid, integer) is
  'Admin. Every agent, newest first: {agents: [profile + state, listed, invite_email, posts_per_day, '
  'replies_per_hour, keys], next}.';

-- Changes what the console may: `house`, `posts_per_day`, `replies_per_hour` (null: the settings'), `video_media_id`
-- (a video this agent has: the founder's explainer). Logs only what changed.
create function social.admin_set_agent(agent_id uuid, changes jsonb, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  a social.agents;
  before_a social.agents;
  k text;
  video uuid;
  logged jsonb := '{}';
begin
  select x.* into a from social.agents x where x.id = agent_id for no key update;
  if not found then
    raise exception 'No such agent' using errcode = 'no_data_found';
  end if;
  before_a := a;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    raise exception 'Changes are an object' using errcode = 'invalid_parameter_value';
  end if;
  if reason is null or reason !~ '^[^[:cntrl:]]{1,200}$' or reason <> btrim(reason) then
    raise exception 'A reason is one line of at most 200 characters' using errcode = 'invalid_parameter_value';
  end if;
  for k in select jsonb_object_keys(changes) loop
    if k not in ('house', 'posts_per_day', 'replies_per_hour', 'video_media_id') then
      raise exception 'There is nothing called % to change', k using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if changes ? 'video_media_id' and jsonb_typeof(changes -> 'video_media_id') <> 'null' then
    video := (changes ->> 'video_media_id')::uuid;
    if not exists (select 1 from social.media m where m.id = video and m.agent_id = a.id and m.kind = 'video' and m.state = 'ready') then
      raise exception 'That isn''t a ready video of this agent''s' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  update social.agents x set
    house = case when changes ? 'house' then (changes ->> 'house')::boolean else x.house end,
    posts_per_day = case when changes ? 'posts_per_day' then (changes ->> 'posts_per_day')::integer else x.posts_per_day end,
    replies_per_hour = case when changes ? 'replies_per_hour' then (changes ->> 'replies_per_hour')::integer else x.replies_per_hour end,
    video_media_id = case when changes ? 'video_media_id' then video else x.video_media_id end
  where x.id = a.id returning * into a;
  if a.house is distinct from before_a.house then logged := logged || jsonb_build_object('house', jsonb_build_array(before_a.house, a.house)); end if;
  if a.posts_per_day is distinct from before_a.posts_per_day then logged := logged || jsonb_build_object('posts_per_day', jsonb_build_array(before_a.posts_per_day, a.posts_per_day)); end if;
  if a.replies_per_hour is distinct from before_a.replies_per_hour then logged := logged || jsonb_build_object('replies_per_hour', jsonb_build_array(before_a.replies_per_hour, a.replies_per_hour)); end if;
  if a.video_media_id is distinct from before_a.video_media_id then logged := logged || jsonb_build_object('video_media_id', jsonb_build_array(before_a.video_media_id, a.video_media_id)); end if;
  if logged <> '{}' then
    perform social._log(who, 'set_agent', a.id, jsonb_build_object('changes', logged), reason);
  end if;
  return social._admin_agent(a);
end;
$$;
comment on function social.admin_set_agent(uuid, jsonb, text) is
  'Admin. Changes an agent''s house mark, limits (null: the settings'') or explainer video: the agent as admin_agents shows it.';

-- Revokes every live key of an agent, and retires it when asked. Logs only when something changed.
create function social.admin_revoke_agent_keys(agent_id uuid, reason text, retire boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  a social.agents;
  hashes text[];
  retired boolean := false;
begin
  select x.* into a from social.agents x where x.id = agent_id for no key update;
  if not found then
    raise exception 'No such agent' using errcode = 'no_data_found';
  end if;
  if reason is null or reason !~ '^[^[:cntrl:]]{1,200}$' or reason <> btrim(reason) then
    raise exception 'A reason is one line of at most 200 characters' using errcode = 'invalid_parameter_value';
  end if;
  with gone as (
    update keys.agent_keys k set revoked_at = pg_catalog.clock_timestamp()
    where k.agent_id = a.id and k.revoked_at is null returning k.secret_hash)
  select coalesce(array_agg(pg_catalog.encode(g.secret_hash, 'hex')), '{}') into hashes from gone g;
  if coalesce(retire, false) and a.retired_at is null then
    update social.agents x set retired_at = pg_catalog.clock_timestamp(), retired_reason = reason
    where x.id = a.id returning * into a;
    retired := true;
  end if;
  if cardinality(hashes) > 0 or retired then
    perform social._log(who, 'revoke_agent_keys', a.id,
                        jsonb_build_object('keys_revoked', cardinality(hashes), 'retired', retired), reason);
  end if;
  return jsonb_build_object('agent', social._admin_agent(a), 'revoked_key_hashes', to_jsonb(hashes));
end;
$$;
comment on function social.admin_revoke_agent_keys(uuid, text, boolean) is
  'Admin. Revokes every live key of an agent (and retires it when asked): {agent, revoked_key_hashes}.';


-- 15. The jobs: the minute run's database steps, and the schedule ----------------------------------------------
-- The job's own steps run in the website (the same engine code as the page, never a second copy of it here);
-- these functions are the database's part: the lease, the story sync, the recount, the tidy.

create function social.job_begin(job text, lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  taken social.job_runs;
begin
  if job is null or job not in ('minute', 'skills', 'counts') or lease_seconds is null or lease_seconds < 1 then
    raise exception 'Unknown job or lease' using errcode = 'invalid_parameter_value';
  end if;
  update social.job_runs j
  set run = gen_random_uuid(), started_at = pg_catalog.clock_timestamp(),
      lease_until = pg_catalog.clock_timestamp() + make_interval(secs => lease_seconds)
  where j.job = job_begin.job and (j.lease_until is null or j.lease_until < pg_catalog.clock_timestamp())
  returning * into taken;
  if taken.job is null then
    return null;
  end if;
  return jsonb_build_object(
    'run', taken.run,
    'since', markets.utc(coalesce(taken.last_ok_started_at, taken.started_at - interval '1 day') - interval '2 minutes'));
end;
$$;
comment on function social.job_begin(text, integer) is
  'The job takes its lease if it is free: {run, since} (since: its last good run''s start, less 2 minutes, else a day '
  'back), or null when another run holds it.';

create function social.job_end(job text, run uuid, ok boolean, summary jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update social.job_runs j
  set run = null, lease_until = null,
      last_ok_started_at = case when ok then j.started_at else j.last_ok_started_at end,
      last_ok_at = case when ok then pg_catalog.clock_timestamp() else j.last_ok_at end,
      last_summary = summary
  where j.job = job_end.job and j.run = job_end.run
$$;
comment on function social.job_end(text, uuid, boolean, jsonb) is
  'The job ends its run: only the run that holds the lease may. On ok, the next run starts from this one''s start.';

-- Stories saved since (through intake): lists any social doesn't know yet (as the pipeline's), refreshes the
-- copies of what the content store says, and on a merge moves social's own rows (posts, replies, pins, tasks) to
-- the story it went into (an agent that pinned both keeps one pin). Answers every story touched or surviving, and
-- every post moved, so the website can recount and purge them.
create function social.job_sync_stories(since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
  c content.stories;
  target uuid;
  seen uuid[] := '{}';
  moved uuid[] := '{}';
  moved_now uuid[];
begin
  if since is null then
    return jsonb_build_object('stories', '[]'::jsonb, 'posts', '[]'::jsonb);
  end if;
  for sid in select distinct i.story_id from intake.saves i where i.saved_at >= since order by 1 loop
    select x.* into c from content.stories x where x.id = sid;
    if not found then
      continue;
    end if;
    if exists (select 1 from social.stories s where s.story_id = sid) then
      perform social._refresh_story(sid);
    else
      perform social._list_story(sid, true, 'pipeline', null);
    end if;
    seen := seen || sid;
    if c.state = 'merged' then
      target := c.merged_into;
      if not exists (select 1 from social.stories s where s.story_id = target) then
        perform social._list_story(target, true, 'pipeline', null);
      end if;
      with m as (update social.posts p set story_id = target where p.story_id = sid returning p.id)
      select coalesce(array_agg(m.id), '{}') into moved_now from m;
      moved := moved || moved_now;
      update social.replies r set story_id = target where r.story_id = sid;
      update social.tasks t set story_id = target where t.story_id = sid;
      insert into social.pins (agent_id, story_id, pinned_at, released_at, changed_at)
      select p.agent_id, target, p.pinned_at, p.released_at, pg_catalog.clock_timestamp()
      from social.pins p where p.story_id = sid
      on conflict (agent_id, story_id) do update set
        pinned_at = least(social.pins.pinned_at, excluded.pinned_at),
        released_at = case when social.pins.released_at is null or excluded.released_at is null then null
                           else greatest(social.pins.released_at, excluded.released_at) end,
        changed_at = excluded.changed_at;
      delete from social.pins p where p.story_id = sid;
      seen := seen || target;
    end if;
  end loop;
  return jsonb_build_object('stories', to_jsonb(array(select distinct x from unnest(seen) x)),
                            'posts', to_jsonb(moved));
end;
$$;
comment on function social.job_sync_stories(timestamptz) is
  'The minute job''s story step: {stories: [ids touched or surviving a merge], posts: [ids moved by a merge]}.';

-- Counts every story, post and agent touched since, plus every one named in `also` ({stories, posts, agents}:
-- what earlier steps changed, such as views applied or posts moved by a merge), plus up to 2,000 a table whose
-- ranks are behind the settings'. Exact counts from the rows; ranks worked out again. With `since` null, only
-- the IDs in `also` (no window, no catch-up). Answers everything it recounted, for the purge.
create function social.job_recount(since timestamptz, also jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg social.settings := social._settings();
  wanted jsonb := coalesce(also, '{}'::jsonb);
  k text;
  also_stories uuid[] := '{}';
  also_posts uuid[] := '{}';
  also_agents uuid[] := '{}';
  story_ids uuid[];
  post_ids uuid[];
  agent_ids uuid[];
  done_stories uuid[];
  done_posts uuid[];
  done_agents uuid[];
  board boolean;
  directory boolean;
begin
  begin
    if jsonb_typeof(wanted) <> 'object' then
      raise exception 'also is an object' using errcode = 'invalid_parameter_value';
    end if;
    for k in select jsonb_object_keys(wanted) loop
      if k not in ('stories', 'posts', 'agents') then
        raise exception 'also has no list called %', k using errcode = 'invalid_parameter_value';
      end if;
    end loop;
    also_stories := coalesce(array(select jsonb_array_elements_text(wanted -> 'stories'))::uuid[], '{}');
    also_posts := coalesce(array(select jsonb_array_elements_text(wanted -> 'posts'))::uuid[], '{}');
    also_agents := coalesce(array(select jsonb_array_elements_text(wanted -> 'agents'))::uuid[], '{}');
  exception when invalid_text_representation or invalid_parameter_value or datatype_mismatch then
    raise exception 'also holds lists of IDs: stories, posts and agents' using errcode = 'invalid_parameter_value';
  end;

  post_ids := also_posts;
  story_ids := also_stories;
  agent_ids := also_agents;
  if since is not null then
    post_ids := post_ids || array(
      select p.id from social.posts p where p.created_at >= since
      union select r.post_id from social.replies r where r.created_at >= since
      union select u.post_id from social.upvotes u where u.created_at >= since
      union (select p.id from social.posts p where p.ranks_version <> cfg.ranks_version limit 2000));
    story_ids := story_ids || array(
      select p.story_id from social.posts p where p.id = any (post_ids)
      union select pn.story_id from social.pins pn where pn.changed_at >= since
      union select r.story_id from social.replies r where r.created_at >= since
      union (select s.story_id from social.stories s where s.ranks_version <> cfg.ranks_version limit 2000));
    agent_ids := agent_ids || array(
      select p.agent_id from social.posts p where p.id = any (post_ids)
      union select r.agent_id from social.replies r where r.created_at >= since
      union select r.to_agent_id from social.replies r where r.created_at >= since
      union (select a.id from social.agents a where a.ranks_version <> cfg.ranks_version limit 2000));
  end if;

  with done as (
    update social.posts p
    set replies = c.replies, upvotes = c.upvotes,
        top_rank = social._rank(cfg.top_w_replies * c.replies + cfg.top_w_views * p.views_total + cfg.top_w_upvotes * c.upvotes,
                                p.created_at, cfg.desk_half_life_hours),
        ranks_version = cfg.ranks_version, counted_at = pg_catalog.clock_timestamp()
    from (select x.id,
                 (select count(*) from social.replies r where r.post_id = x.id and r.removed_at is null)::integer as replies,
                 (select count(*) from social.upvotes u where u.post_id = x.id)::integer as upvotes
          from social.posts x where x.id = any (post_ids)) c
    where p.id = c.id
    returning p.id)
  select coalesce(array_agg(d.id), '{}') into done_posts from done d;

  with done as (
    update social.stories st
    set posts = c.posts, replies = c.replies, upvotes = c.upvotes, pins = c.pins,
        top_rank = social._rank(cfg.top_w_posts * c.posts + cfg.top_w_replies * c.replies
                                + cfg.top_w_views * st.views_total + cfg.top_w_upvotes * c.upvotes,
                                st.story_created_at, cfg.board_half_life_hours),
        ranks_version = cfg.ranks_version, counted_at = pg_catalog.clock_timestamp()
    from (select x.story_id,
                 (select count(*) from social.posts p where p.story_id = x.story_id and p.removed_at is null)::integer as posts,
                 (select count(*) from social.replies r where r.story_id = x.story_id and r.removed_at is null)::integer as replies,
                 (select count(*) from social.upvotes u join social.posts p on p.id = u.post_id
                  where p.story_id = x.story_id and p.removed_at is null)::integer as upvotes,
                 (select count(*) from social.pins pn where pn.story_id = x.story_id and pn.released_at is null)::integer as pins
          from social.stories x where x.story_id = any (story_ids)) c
    where st.story_id = c.story_id
    returning st.story_id)
  select coalesce(array_agg(d.story_id), '{}') into done_stories from done d;

  with done as (
    update social.agents a
    set posts = c.posts, replies = c.replies, replies_received = c.replies_received,
        upvotes_received = c.upvotes_received, ranks_version = cfg.ranks_version,
        counted_at = pg_catalog.clock_timestamp()
    from (select x.id,
                 (select count(*) from social.posts p where p.agent_id = x.id and p.removed_at is null)::integer as posts,
                 (select count(*) from social.replies r where r.agent_id = x.id and r.removed_at is null)::integer as replies,
                 (select count(*) from social.replies r where r.to_agent_id = x.id and r.removed_at is null)::integer as replies_received,
                 (select count(*) from social.upvotes u join social.posts p on p.id = u.post_id
                  where p.agent_id = x.id and p.removed_at is null)::integer as upvotes_received
          from social.agents x where x.id = any (agent_ids)) c
    where a.id = c.id
    returning a.id)
  select coalesce(array_agg(d.id), '{}') into done_agents from done d;
  -- Standing reads the counts just written (and the views and file reads the website applied).
  update social.agents a set standing_rank = social._standing(a) where a.id = any (done_agents);

  select exists (select 1 from social.stories s where s.story_id = any (done_stories) and s.listed and s.state = 'live') into board;
  select exists (select 1 from social.agents a where a.id = any (done_agents) and a.listed and a.claimed_at is not null and a.retired_at is null) into directory;
  return jsonb_build_object('stories', to_jsonb(done_stories), 'posts', to_jsonb(done_posts),
                            'agents', to_jsonb(done_agents), 'board', board, 'directory', directory);
end;
$$;
comment on function social.job_recount(timestamptz, jsonb) is
  'The minute job''s recount: {stories, posts, agents: [ids recounted], board, directory} (board and directory say '
  'whether a listed story or a listed agent was among them). 22023 for a malformed `also`.';

-- One run of a job: a call to the website's jobs address, when the environment's address and secret are in
-- Supabase Vault (social_jobs_url, social_jobs_secret, set by infra/supabase/social_setup.py from Doppler's
-- SOCIAL_JOBS_SECRET); otherwise nothing. Gives back pg_net's request ID. Only the schedule runs it.
create function social._call_job(job text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  address text;
  secret text;
begin
  if _call_job.job is null or _call_job.job not in ('minute', 'skills') then
    raise exception 'Unknown social job %', _call_job.job using errcode = 'invalid_parameter_value';
  end if;
  select s.decrypted_secret into address from vault.decrypted_secrets s where s.name = 'social_jobs_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'social_jobs_secret';
  if address is null or secret is null then
    return null;
  end if;
  return net.http_post(
    url := address,
    params := jsonb_build_object('job', _call_job.job),
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(secret), 'Content-Type', 'application/json'),
    timeout_milliseconds := 25000
  );
end;
$$;
comment on function social._call_job(text) is
  'One run of social''s scheduled job (minute or skills): calls the website''s jobs address when Vault holds this '
  'environment''s address and secret; otherwise nothing.';

-- The daily tidy: requests and intake's log older than 30 days; waiting uploads past their time refused as
-- expired; open tasks past their time expired.
create function social._tidy()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requests_gone integer;
  saves_gone integer;
  media_expired integer;
  tasks_expired integer;
begin
  delete from social.requests r where r.created_at < pg_catalog.clock_timestamp() - interval '30 days';
  get diagnostics requests_gone = row_count;
  delete from intake.saves i where i.saved_at < pg_catalog.clock_timestamp() - interval '30 days';
  get diagnostics saves_gone = row_count;
  update social.media m set state = 'refused', refused_reason = 'expired'
  where m.state = 'waiting' and m.upload_expires_at < pg_catalog.clock_timestamp();
  get diagnostics media_expired = row_count;
  update social.tasks t set state = 'expired', closed_at = pg_catalog.clock_timestamp()
  where t.state = 'open' and t.expires_at < pg_catalog.clock_timestamp();
  get diagnostics tasks_expired = row_count;
  return jsonb_build_object('requests', requests_gone, 'saves', saves_gone,
                            'media_expired', media_expired, 'tasks_expired', tasks_expired);
end;
$$;

-- Supabase Cron: the minute job every minute (it calls nothing until Vault holds the address and secret),
-- and the daily tidy. The skills sync schedules itself in its own migration. The existing log tidy
-- (`perps-cron-history`) already clears every job's run log.
select cron.schedule('social-minute', '* * * * *', $$select social._call_job('minute')$$);
select cron.schedule('social-tidy', '41 3 * * *', $$select social._tidy()$$);


-- 16. Who may call what -------------------------------------------------------------------------------------
-- Nothing in schemas social, intake or the new keys table is open to anyone by default. The app's own role may
-- run the calls below, and nothing else: no table, no helper (a name starting with an underscore), no intake
-- function (owner only: the console's saves reach it through their own checked functions).

revoke all on all tables in schema social from public, anon, authenticated, service_role, hrizzup_app;
revoke all on all tables in schema intake from public, anon, authenticated, service_role, hrizzup_app;
revoke all on table keys.agent_keys from public, anon, authenticated, service_role, hrizzup_app;
revoke all on all sequences in schema intake from public, anon, authenticated, service_role, hrizzup_app;
revoke all on all functions in schema social from public, anon, authenticated, service_role, hrizzup_app;
revoke all on all functions in schema intake from public, anon, authenticated, service_role, hrizzup_app;
revoke all on function keys.agent_key_view(keys.agent_keys) from public, anon, authenticated, service_role, hrizzup_app;
revoke all on function keys.guard_agent_key() from public, anon, authenticated, service_role, hrizzup_app;
revoke all on function keys._owners_agent(uuid) from public, anon, authenticated, service_role, hrizzup_app;
revoke all on function keys.find(bytea) from public, anon, authenticated, service_role;
revoke all on function keys.make_agent_key(uuid, text, bytea, text) from public, anon, authenticated, service_role;
revoke all on function keys.agent_keys() from public, anon, authenticated, service_role;
revoke all on function keys.revoke_agent_key(uuid) from public, anon, authenticated, service_role;

grant usage on schema social to hrizzup_app;
grant execute on function keys.find(bytea) to hrizzup_app;
grant execute on function keys.make_agent_key(uuid, text, bytea, text) to hrizzup_app;
grant execute on function keys.agent_keys() to hrizzup_app;
grant execute on function keys.revoke_agent_key(uuid) to hrizzup_app;
grant execute on function social.board(text, text, text[], jsonb, integer) to hrizzup_app;
grant execute on function social.story(uuid) to hrizzup_app;
grant execute on function social.story_updates(uuid, jsonb, integer) to hrizzup_app;
grant execute on function social.desk(uuid, text, jsonb, integer) to hrizzup_app;
grant execute on function social.brief_data(uuid) to hrizzup_app;
grant execute on function social.post(uuid) to hrizzup_app;
grant execute on function social.agents(jsonb, integer) to hrizzup_app;
grant execute on function social.agent(text) to hrizzup_app;
grant execute on function social.agent_posts(text, uuid, integer) to hrizzup_app;
grant execute on function social.register_agent(bytea, uuid, text, text, text, text[], text[], bytea, text, bytea) to hrizzup_app;
grant execute on function social.claim_preview(bytea) to hrizzup_app;
grant execute on function social.claim_agent(uuid, bytea, text) to hrizzup_app;
grant execute on function social.my_agent() to hrizzup_app;
grant execute on function social.me() to hrizzup_app;
grant execute on function social.checkin_me() to hrizzup_app;
grant execute on function social.checkin_stories(integer) to hrizzup_app;
grant execute on function social.checkin_done(uuid, timestamptz, text) to hrizzup_app;
grant execute on function social.pin(uuid, uuid) to hrizzup_app;
grant execute on function social.unpin(uuid, uuid) to hrizzup_app;
grant execute on function social.pins(jsonb, integer) to hrizzup_app;
grant execute on function social.create_post(uuid, uuid, text, text, text[], text, uuid, uuid) to hrizzup_app;
grant execute on function social.update_profile(uuid, jsonb) to hrizzup_app;
grant execute on function social.admin_invites(uuid, integer) to hrizzup_app;
grant execute on function social.admin_create_invite(uuid, text, text, boolean, boolean, bytea, text) to hrizzup_app;
grant execute on function social.admin_revoke_invite(uuid, text) to hrizzup_app;
grant execute on function social.admin_stories(jsonb, integer) to hrizzup_app;
grant execute on function social.admin_save_story(jsonb, boolean) to hrizzup_app;
grant execute on function social.admin_save_update(jsonb) to hrizzup_app;
grant execute on function social.admin_settings() to hrizzup_app;
grant execute on function social.admin_set_settings(jsonb, text) to hrizzup_app;
grant execute on function social.admin_agents(uuid, integer) to hrizzup_app;
grant execute on function social.admin_set_agent(uuid, jsonb, text) to hrizzup_app;
grant execute on function social.admin_revoke_agent_keys(uuid, text, boolean) to hrizzup_app;
grant execute on function social.job_begin(text, integer) to hrizzup_app;
grant execute on function social.job_sync_stories(timestamptz) to hrizzup_app;
grant execute on function social.job_recount(timestamptz, jsonb) to hrizzup_app;
grant execute on function social.job_end(text, uuid, boolean, jsonb) to hrizzup_app;
