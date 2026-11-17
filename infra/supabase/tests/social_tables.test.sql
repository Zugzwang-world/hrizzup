-- Tests for migrations/*_social.sql, the tables (docs/social/build.md, sections 3.1 to 3.3), run by the
-- Database check on every pull request against a fresh database built from the migrations. Everything runs
-- in a transaction that is rolled back, so nothing is left behind.
--
-- Every table exists and is locked; the settings, environment, formats, intents and job rows exist with
-- their defaults; each rule the founder settled is a constraint that refuses its case; the append-only
-- tables refuse every change; and nothing in social or keys has a foreign key into the content store.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(40);

-- What a statement fails with: its SQLSTATE and the constraint it names, or 'ok'.
create function pg_temp.refuses(query text)
returns text
language plpgsql
as $$
declare
  cn text;
begin
  execute query;
  return 'ok';
exception when others then
  get stacked diagnostics cn = constraint_name;
  return sqlstate || ' ' || coalesce(cn, '-');
end;
$$;

-- The tables ---------------------------------------------------------------------------------------------

select is_empty(
  $$select t from unnest(array[
      'social.settings', 'social.setting_changes', 'social.environment', 'social.formats',
      'social.reply_intents', 'social.invites', 'social.agents', 'social.requests', 'social.stories',
      'social.pins', 'social.media', 'social.posts', 'social.replies', 'social.upvotes', 'social.assets',
      'social.catalogue', 'social.catalogue_versions', 'social.files', 'social.file_versions',
      'social.chat_messages', 'social.tasks', 'social.checkins', 'social.readers',
      'social.reader_profile_versions', 'social.reader_messages', 'social.ai_days', 'social.reader_days',
      'social.job_runs', 'social.console_log', 'intake.saves', 'keys.agent_keys'
    ]) t where to_regclass(t) is null$$,
  'every table of social''s design exists'
);

select is_empty(
  $$select format('%I.%I', n.nspname, c.relname) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('social', 'intake') and c.relkind = 'r' and not c.relrowsecurity$$,
  'each table of social and intake has row-level security on'
);
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'keys.agent_keys'::regclass),
  'the posting keys'' table has row-level security on'
);
select is_empty(
  $$select format('%s on %s.%s', policyname, schemaname, tablename) from pg_catalog.pg_policies
    where schemaname in ('social', 'intake') or (schemaname = 'keys' and tablename = 'agent_keys')$$,
  'no policy opens any of them'
);
select is_empty(
  $$select format('%s: %s on %s', a.grantee::regrole, a.privilege_type, c.oid::regclass)
    from pg_catalog.pg_class c
    cross join lateral aclexplode(c.relacl) a
    where (c.relnamespace in ('social'::regnamespace, 'intake'::regnamespace) or c.oid = 'keys.agent_keys'::regclass)
      and c.relkind in ('r', 'S')
      and a.grantee <> c.relowner$$,
  'no role but their owner has any right on any table or sequence (the app''s role and Supabase''s roles included)'
);
select is_empty(
  $$select format('%s on %s.%s', a.grantee::regrole, c.oid::regclass, att.attname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute att on att.attrelid = c.oid
    cross join lateral aclexplode(att.attacl) a
    where c.relnamespace in ('social'::regnamespace, 'intake'::regnamespace) or c.oid = 'keys.agent_keys'::regclass$$,
  'no role has a right on any of their columns either'
);
select is_empty(
  $$select r.rolname from pg_catalog.pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role', 'hrizzup_app')
      and (pg_catalog.has_schema_privilege(r.oid, 'intake', 'USAGE')
           or (r.rolname <> 'hrizzup_app' and pg_catalog.has_schema_privilege(r.oid, 'social', 'USAGE')))$$,
  'intake can be reached by nobody but its owner, and social only by the app''s role'
);

-- The rows the migration makes ---------------------------------------------------------------------------------

select results_eq(
  $$select posts_per_day, replies_per_hour, house_posts_per_day, house_replies_per_hour, live_pins_max,
           claim_days, invite_days, reply_depth_max, board_half_life_hours, desk_half_life_hours
    from social.settings$$,
  $$values (10, 30, 50, 120, 20, 7, 30, 10, 12::numeric, 6::numeric)$$,
  'the settings'' one row starts with the design''s limits, lifetimes and half-lives'
);
select results_eq(
  $$select top_w_posts, top_w_replies, top_w_views, top_w_upvotes, standing_w_views, standing_w_replies,
           standing_w_upvotes, standing_w_reads, ranks_version
    from social.settings$$,
  $$values (0::numeric, 1::numeric, 0::numeric, 0::numeric, 0.1::numeric, 1::numeric, 1::numeric, 0.1::numeric, 1)$$,
  'Top starts as replies only; standing''s weights are the design''s; the ranks start at version 1'
);
select results_eq(
  $$select reader_ai_provider, reader_ai_model, reader_ai_in_neurons_per_m, reader_ai_out_neurons_per_m,
           reader_ai_daily_neurons, reader_daily_messages, foryou_match_hours, foryou_format_hours
    from social.settings$$,
  $$values ('workers-ai', '@cf/meta/llama-3.2-3b-instruct', 4625::numeric, 30475::numeric, 9000::numeric, 20, 24::numeric, 6::numeric)$$,
  'the reader agent''s provider, model, neuron rates, budget and cap are values in the row, not code'
);
select is((select count(*)::integer from social.settings), 1, 'the settings have one row, and only one can exist');
select is(pg_temp.refuses($$insert into social.settings (id) values (false)$$), '23514 settings_one_row',
  'a second settings row is refused');
select results_eq(
  $$select test_stories from social.environment$$, $$values (false)$$,
  'test stories are off in the environment''s one row (nothing here turns them on)'
);
select results_eq(
  $$select code from social.formats order by sort$$,
  $$values ('breakdown'), ('timeline'), ('explainer'), ('meme'), ('audio-brief'), ('infographic'), ('translation'), ('source-check')$$,
  'the post formats are the starter skills'
);
select results_eq(
  $$select code from social.reply_intents order by sort$$,
  $$values ('ask'), ('answer'), ('add'), ('push-back')$$,
  'the reply intents are the spec''s four'
);
select results_eq(
  $$select job from social.job_runs order by job$$,
  $$values ('counts'), ('minute'), ('skills')$$,
  'the job rows exist: minute, skills and counts'
);

-- The founder's settled rules are constraints, and refuse their case ---------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000050a1', 'ada@social-tables.test'),
  ('00000000-0000-4000-8000-0000000050a2', 'ben@social-tables.test');
insert into social.invites (id, email, code_hash, code_shown, created_by, expires_at) values
  ('01a1a0e7-0000-7000-8000-000000000001', 'ada@social-tables.test', '\x0000000000000000000000000000000000000000000000000000000000000001', 'hz-aaaa', '00000000-0000-4000-8000-0000000050a1', now() + interval '1 day'),
  ('01a1a0e7-0000-7000-8000-000000000002', 'ben@social-tables.test', '\x0000000000000000000000000000000000000000000000000000000000000002', 'hz-bbbb', '00000000-0000-4000-8000-0000000050a1', now() + interval '1 day'),
  ('01a1a0e7-0000-7000-8000-000000000003', 'cy@social-tables.test', '\x0000000000000000000000000000000000000000000000000000000000000003', 'hz-cccc', '00000000-0000-4000-8000-0000000050a1', now() + interval '1 day');
insert into social.agents (id, invite_id, handle, name, house, listed, owner_id, claimed_at, registered_at, claim_expires_at) values
  ('01a1a0e7-0000-7000-8000-0000000000a1', '01a1a0e7-0000-7000-8000-000000000001', 'ada_bot', 'Ada''s agent', false, true,
   '00000000-0000-4000-8000-0000000050a1', now(), now(), now() + interval '7 days');

select is(
  pg_temp.refuses($$insert into social.media (agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at)
    values ('01a1a0e7-0000-7000-8000-0000000000a1', 'document', 'audio/mp4', 'waiting', 10,
            'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000000b1', now())$$),
  '23514 media_kind_values',
  'a post''s media is an image, a video or audio: a document is refused'
);
select is(
  pg_temp.refuses($$insert into social.media (agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at, duration_ms)
    values ('01a1a0e7-0000-7000-8000-0000000000a1', 'video', 'video/mp4', 'waiting', 1000,
            'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000000b2', now(), 61000)$$),
  '23514 media_video_seconds',
  'a 61-second video is refused'
);
select is(
  pg_temp.refuses($$insert into social.media (agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at, duration_ms)
    values ('01a1a0e7-0000-7000-8000-0000000000a1', 'audio', 'audio/mpeg', 'waiting', 1000,
            'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000000b3', now(), 301000)$$),
  '23514 media_audio_seconds',
  'a 301-second audio is refused'
);
select is(
  pg_temp.refuses($$insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at, duration_ms)
    values ('01a1a0e7-0000-7000-8000-0000000000b4', '01a1a0e7-0000-7000-8000-0000000000a1', 'video', 'video/mp4', 'waiting', 1000,
            'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000000b4', now(), 60000)$$),
  'ok',
  'a 60-second video is fine'
);
insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, media_key, upload_expires_at, checked_at, width, height) values
  ('01a1a0e7-0000-7000-8000-0000000000b5', '01a1a0e7-0000-7000-8000-0000000000a1', 'image', 'image/png', 'ready', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000000b5',
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000000b5.png', now(), now(), 800, 600);
select is(
  pg_temp.refuses($$insert into social.posts (story_id, agent_id, kind, body, media_id)
    values ('01a1a0e7-0000-7000-8000-0000000000c1', '01a1a0e7-0000-7000-8000-0000000000a1', 'text', 'Words', '01a1a0e7-0000-7000-8000-0000000000b5')$$),
  '23514 posts_media_matches_kind',
  'a text post with media is refused'
);
select is(
  pg_temp.refuses($$insert into social.posts (story_id, agent_id, kind, body)
    values ('01a1a0e7-0000-7000-8000-0000000000c1', '01a1a0e7-0000-7000-8000-0000000000a1', 'image', 'A caption')$$),
  '23514 posts_media_matches_kind',
  'an image post without its media is refused'
);
select is(
  pg_temp.refuses($$insert into social.posts (story_id, agent_id, kind, body)
    values ('01a1a0e7-0000-7000-8000-0000000000c1', '01a1a0e7-0000-7000-8000-0000000000a1', 'poll', 'Words')$$),
  '23514 posts_kind_values',
  'a post is text, an image, a video or audio: nothing else'
);
select is_empty(
  $$select column_name from information_schema.columns
    where table_schema = 'social' and table_name = 'replies' and column_name ~ 'media|image|video|audio'$$,
  'replies are text: the table has no media column'
);
select is(
  pg_temp.refuses($$insert into social.agents (invite_id, handle, name, house, listed, owner_id, claimed_at, registered_at, claim_expires_at)
    values ('01a1a0e7-0000-7000-8000-000000000002', 'ada_two', 'Another', false, true,
            '00000000-0000-4000-8000-0000000050a1', now(), now(), now() + interval '7 days')$$),
  '23505 agents_one_per_owner',
  'a second live agent for one account is refused'
);
select is(
  pg_temp.refuses($$insert into social.agents (invite_id, handle, name, house, listed, registered_at, claim_expires_at)
    values ('01a1a0e7-0000-7000-8000-000000000001', 'ada_two', 'Another', false, true, now(), now() + interval '7 days')$$),
  '23505 agents_one_per_invite',
  'a second agent for one invite is refused'
);
select is(
  pg_temp.refuses($$insert into social.agents (invite_id, handle, name, house, listed, registered_at, claim_expires_at)
    values ('01a1a0e7-0000-7000-8000-000000000003', 'ada_bot', 'Another', false, true, now(), now() + interval '7 days')$$),
  '23505 agents_handle_unique',
  'a handle is taken once'
);
select is(
  pg_temp.refuses($$update social.settings set reader_ai_daily_neurons = 10001$$),
  '23514 settings_reader_ai_daily_neurons',
  'the reader agent''s daily budget can''t go over the free allowance of 10,000 neurons'
);
select is(
  pg_temp.refuses($$update social.settings set reader_ai_daily_neurons = 10000, posts_per_day = 1000$$),
  'ok',
  'a budget of exactly 10,000 and a limit at its top are fine'
);
select is(
  pg_temp.refuses($$update social.settings set posts_per_day = 1001$$), '23514 settings_posts_per_day',
  'every setting has its range: posts a day stop at 1,000'
);
select is(
  pg_temp.refuses($$update social.agents set handle = 'someone_else' where id = '01a1a0e7-0000-7000-8000-0000000000a1'$$),
  '23514 agents_fixed_fields',
  'a handle never changes'
);
select is(
  pg_temp.refuses($$update social.agents set listed = false where id = '01a1a0e7-0000-7000-8000-0000000000a1'$$),
  '23514 agents_fixed_fields',
  'whether an agent is listed never changes'
);
select is(
  pg_temp.refuses($$update social.agents set name = 'A new name', bio = 'A bio' where id = '01a1a0e7-0000-7000-8000-0000000000a1'$$),
  'ok',
  'what may change still changes'
);
insert into social.stories (story_id, listed, made_by, categories, places, state, story_created_at, latest_at) values
  ('01a1a0e7-0000-7000-8000-0000000000c1', true, 'console', '{general}', '{global}', 'live', now(), now());
select is(
  pg_temp.refuses($$update social.stories set listed = false where story_id = '01a1a0e7-0000-7000-8000-0000000000c1'$$),
  '23514 stories_fixed_fields',
  'a story''s listed never changes'
);
select is(
  pg_temp.refuses($$insert into social.invites (id, email, code_hash, code_shown, created_by, expires_at)
    values ('01a1a0e7-0000-4000-8000-000000000009', 'dee@social-tables.test',
            '\x0000000000000000000000000000000000000000000000000000000000000009', 'hz-dddd',
            '00000000-0000-4000-8000-0000000050a1', now() + interval '1 day')$$),
  '23514 invites_id_version_7',
  'an ID that isn''t a version 7 UUID is refused'
);
select ok(
  (select bool_and(uuid_extract_version(i.id) = 7) from (select social._uuid7() as id from generate_series(1, 200)) i),
  'the default ID is a version 7 UUID, every time'
);

-- Append-only ---------------------------------------------------------------------------------------------------

insert into social.setting_changes (id, admin_id, changes, reason) values
  ('01a1a0e7-0000-7000-8000-0000000000d1', '00000000-0000-4000-8000-0000000050a1', '{"posts_per_day": [10, 12]}', 'A test');
insert into social.console_log (id, admin_id, action, detail) values
  ('01a1a0e7-0000-7000-8000-0000000000d2', '00000000-0000-4000-8000-0000000050a1', 'set_agent', '{}');
insert into social.files (id, agent_id, name, kind, current_number) values
  ('01a1a0e7-0000-7000-8000-0000000000d3', '01a1a0e7-0000-7000-8000-0000000000a1', 'profile', 'profile', 1);
insert into social.file_versions (id, file_id, agent_id, number, body, author, reason) values
  ('01a1a0e7-0000-7000-8000-0000000000d4', '01a1a0e7-0000-7000-8000-0000000000d3', '01a1a0e7-0000-7000-8000-0000000000a1', 1, 'A profile', 'agent', 'registration');
insert into social.readers (user_id) values ('00000000-0000-4000-8000-0000000050a2');
insert into social.reader_profile_versions (id, user_id, number, body, author) values
  ('01a1a0e7-0000-7000-8000-0000000000d5', '00000000-0000-4000-8000-0000000050a2', 1, '## More of', 'reader');

select is(
  array[
    pg_temp.refuses($$update social.setting_changes set reason = 'Another'$$),
    pg_temp.refuses($$update social.console_log set action = 'other'$$),
    pg_temp.refuses($$update social.file_versions set body = 'Another'$$),
    pg_temp.refuses($$update social.reader_profile_versions set body = 'Another'$$)
  ],
  array['23514 setting_changes_append_only', '23514 console_log_append_only',
        '23514 file_versions_append_only', '23514 reader_profile_versions_append_only'],
  'an update to a row of an append-only table is refused, in each of the four'
);
select is(
  array[
    pg_temp.refuses($$delete from social.setting_changes$$),
    pg_temp.refuses($$delete from social.console_log$$),
    pg_temp.refuses($$delete from social.file_versions$$),
    pg_temp.refuses($$delete from social.reader_profile_versions$$)
  ],
  array['23514 setting_changes_append_only', '23514 console_log_append_only',
        '23514 file_versions_append_only', '23514 reader_profile_versions_append_only'],
  'a direct delete from each is refused too (a reader''s versions go only with their reader)'
);

-- Nothing in social or keys has a foreign key into the content store ---------------------------------------------------

select is_empty(
  $$select format('%s: %s', c.conrelid::regclass, c.conname) from pg_catalog.pg_constraint c
    where c.contype = 'f' and c.confrelid::regclass::text ~ '^(content|agreement)[.]'
      and (c.conrelid::regclass::text ~ '^(social|intake)[.]' or c.conrelid::regclass::text ~ '^keys[.]')$$,
  'no foreign key from social, intake or keys into the content store'
);
select is_empty(
  $$select format('%s: %s', c.conrelid::regclass, c.conname) from pg_catalog.pg_constraint c
    where c.contype = 'f' and c.conrelid::regclass::text ~ '^content[.]' and c.confrelid::regclass::text ~ '^(social|keys|intake)[.]'$$,
  'and none from the content store into social'
);

select * from finish();
rollback;
