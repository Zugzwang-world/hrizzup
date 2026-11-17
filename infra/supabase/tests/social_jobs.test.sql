-- Tests for migrations/*_social.sql, the minute job's database steps (docs/social/build.md, D6, D7 and section 7.2):
-- the lease; the story sync (a pipeline story listed, a merge moving social's rows); the recount (exact, the
-- same twice, every ID passed in `also`, no window or catch-up for a null `since`); the `counts` lease never
-- touching the minute run's; re-ranking after a weight change; the call to the website (none without Vault);
-- the two schedules; and the daily tidy. Run by the Database check on every pull request against a fresh
-- database; everything runs in a transaction that is rolled back (and Supabase Cron's own runs, in their own
-- transactions, never see what these tests make, nor send the calls they queue).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(61);

create function pg_temp.as_app(account text, api_key text, query text)
returns text
language plpgsql
as $$
declare
  answer text;
begin
  perform set_config('request.jwt.claims',
    case when account is null then '{"role": "anon"}'
         else json_build_object('sub', account, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(account, ''), true);
  perform set_config('hrizzup.api_key', coalesce(api_key, ''), true);
  set local role hrizzup_app;
  execute query into answer;
  reset role;
  perform set_config('hrizzup.api_key', '', true);
  return answer;
end;
$$;

create function pg_temp.fails(account text, api_key text, query text)
returns text
language plpgsql
as $$
begin
  perform pg_temp.as_app(account, api_key, query);
  return 'ok';
exception when others then
  reset role;
  perform set_config('hrizzup.api_key', '', true);
  return sqlstate;
end;
$$;

-- The job's own calls, as the app's role (the job door runs as it).
create function pg_temp.job(query text)
returns jsonb
language sql
as $$ select pg_temp.as_app(null, null, query)::jsonb $$;

create function pg_temp.hash(n integer)
returns text
language sql
as $$ select '\x' || lpad(to_hex(n), 64, '0') $$;

create function pg_temp.req(n integer)
returns text
language sql
as $$ select '00000000-0000-4000-8000-' || lpad(n::text, 12, '0') $$;

create function pg_temp.queued()
returns bigint
language sql
as $$ select count(*) from net.http_request_queue $$;

create function pg_temp.agent(n integer, handle text)
returns uuid
language plpgsql
as $$
declare
  account text := '00000000-0000-4000-8000-00000000c' || lpad(n::text, 3, '0');
  email text := handle || '@social-jobs.test';
begin
  insert into auth.users (id, email, email_confirmed_at) values (account::uuid, email, now());
  perform pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
    'select social.admin_create_invite(%L, %L, null, false, true, %L::bytea, ''hz-aaaa'')::text', pg_temp.req(n * 10 + 1), email, pg_temp.hash(n)));
  perform pg_temp.as_app(null, null, format(
    'select social.register_agent(%L::bytea, %L, %L, %L, null, null, null, %L::bytea, %L, %L::bytea)::text',
    pg_temp.hash(n), pg_temp.req(n * 10 + 2), handle, 'Agent ' || handle, pg_temp.hash(1000 + n),
    'hz_demo_K' || lpad(n::text, 3, '0'), pg_temp.hash(2000 + n)));
  perform pg_temp.as_app(account, null, format(
    'select social.claim_agent(%L, %L::bytea, %L)::text', pg_temp.req(n * 10 + 3), pg_temp.hash(2000 + n), 'Owner of ' || handle));
  return (select a.id from social.agents a where a.handle = agent.handle);
end;
$$;

create function pg_temp.story_id(n integer)
returns text
language sql
as $$ select '019a6c00-0000-7000-8000-0000000003' || lpad(n::text, 2, '0') $$;

create function pg_temp.story_record(n integer, hour integer, updated text, state text default 'live', merged_into text default null)
returns jsonb
language sql
as $$
  select jsonb_strip_nulls(jsonb_build_object('format', 'story/1', 'id', pg_temp.story_id(n), 'title', 'Story number ' || n,
    'summary', 'What is happening.', 'locations', '["global"]'::jsonb, 'categories', '["general"]'::jsonb, 'state', state,
    'merged_into', merged_into, 'created_at', format('2026-11-17T%s:00:00Z', lpad(hour::text, 2, '0')), 'updated_at', updated))
$$;

insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-jobs.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');

-- The schedules ------------------------------------------------------------------------------------------------------------------

select results_eq(
  $$select jobname::text, schedule::text, command::text, username::text, active
    from cron.job where jobname in ('social-minute', 'social-tidy') order by jobname$$,
  $$values ('social-minute', '* * * * *', 'select social._call_job(''minute'')', 'postgres', true),
           ('social-tidy', '41 3 * * *', 'select social._tidy()', 'postgres', true)$$,
  'Supabase Cron runs the minute job every minute and tidies at 03:41 UTC (a later relay''s own schedules are its own to test)'
);

-- The lease ---------------------------------------------------------------------------------------------------------------------------

create temporary table runs (label text, answer jsonb) on commit drop;
insert into runs select 'first', pg_temp.job('select social.job_begin(''minute'', 55)::text');
select is(
  (select array[(answer ? 'run')::text, ((answer ->> 'since')::timestamptz is not null)::text, ((answer ->> 'since')::timestamptz < now() - interval '1 day')::text] from runs where label = 'first'),
  array['true', 'true', 'true'],
  'a job takes its lease: its run, and where to start (a day and two minutes back on the very first run)'
);
select is(pg_temp.job('select social.job_begin(''minute'', 55)::text'), null::jsonb, 'a second begin, while the lease is held, gets nothing');
select is(
  pg_temp.fails(null, null, format('select social.job_end(''minute'', %L, true, ''{}'')::text', pg_temp.req(999))), 'ok',
  'ending with a run that isn''t the lease''s is allowed to call...'
);
select is(
  (select j.run::text from social.job_runs j where j.job = 'minute'), (select answer ->> 'run' from runs where label = 'first'),
  '... and changes nothing: the lease still belongs to its own run'
);
select is(pg_temp.job('select social.job_begin(''minute'', 55)::text'), null::jsonb, 'so it is still held');
select pg_temp.as_app(null, null, format('select social.job_end(''minute'', %L, false, ''{"ran": false}'')::text', (select answer ->> 'run' from runs where label = 'first')));
select is(
  (select array[j.run is null, j.lease_until is null, j.last_ok_started_at is null, j.last_summary ->> 'ran']::text[] from social.job_runs j where j.job = 'minute'),
  array['true', 'true', 'true', 'false'],
  'a failed run frees the lease and doesn''t move the last good run''s start'
);
insert into runs select 'second', pg_temp.job('select social.job_begin(''minute'', 55)::text');
select pg_temp.as_app(null, null, format('select social.job_end(''minute'', %L, true, ''{"ran": true}'')::text', (select answer ->> 'run' from runs where label = 'second')));
select is(
  (select j.last_ok_started_at = j.started_at and j.last_ok_at is not null from social.job_runs j where j.job = 'minute'), true,
  'a good run moves the last good start to its own start'
);
-- A stop of three hours: the next run starts from the last good run's start, less two minutes.
update social.job_runs set last_ok_started_at = clock_timestamp() - interval '3 hours' where job = 'minute';
insert into runs select 'third', pg_temp.job('select social.job_begin(''minute'', 55)::text');
select ok(
  (select abs(extract(epoch from (clock_timestamp() - interval '3 hours 2 minutes') - (answer ->> 'since')::timestamptz)) < 5 from runs where label = 'third'),
  'after a stop, since covers the gap: the last good start less two minutes'
);
-- A lease that has run out can be taken by the next run.
update social.job_runs set lease_until = clock_timestamp() - interval '1 second' where job = 'minute';
select isnt(pg_temp.job('select social.job_begin(''minute'', 55)::text'), null::jsonb, 'a lease that ran out is free for the next run');
select is(pg_temp.fails(null, null, 'select social.job_begin(''nightly'', 55)::text'), '22023', 'a job that doesn''t exist is refused (22023)');
select is(pg_temp.fails(null, null, 'select social.job_begin(''minute'', 0)::text'), '22023', 'and so is a lease of no time');

-- The counts lease and its end never touch the minute run's row.
create temporary table minute_row on commit drop as select j.run, j.started_at, j.lease_until, j.last_ok_started_at, j.last_ok_at, j.last_summary from social.job_runs j where j.job = 'minute';
create temporary table counts_run on commit drop as select pg_temp.job('select social.job_begin(''counts'', 30)::text') as answer;
select pg_temp.as_app(null, null, format('select social.job_end(''counts'', %L, true, ''{"stories": 1}'')::text', (select answer ->> 'run' from counts_run)));
select is(
  (select row(j.run, j.started_at, j.lease_until, j.last_ok_started_at, j.last_ok_at, j.last_summary)::text from social.job_runs j where j.job = 'minute'),
  (select row(m.run, m.started_at, m.lease_until, m.last_ok_started_at, m.last_ok_at, m.last_summary)::text from minute_row m),
  'taking and ending the counts lease leaves the minute row exactly as it was'
);
select is(
  (select array[j.last_ok_at is not null, j.last_summary ->> 'stories']::text[] from social.job_runs j where j.job = 'counts'),
  array['true', '1'],
  'the counts row holds its own run'
);
select pg_temp.as_app(null, null, format('select social.job_end(''minute'', %L, true, ''{}'')::text', (select run from social.job_runs where job = 'minute')));

-- Stories and their rows ------------------------------------------------------------------------------------------------------------

create temporary table agents_ on commit drop as
select 'ada' as who, pg_temp.agent(1, 'ada_bot') as id union all select 'ben', pg_temp.agent(2, 'ben_bot');
select intake.save_story(pg_temp.story_record(1, 8, '2026-11-17T08:00:00Z'));
select intake.save_story(pg_temp.story_record(2, 9, '2026-11-17T09:00:00Z'));
select intake.save_story(pg_temp.story_record(3, 10, '2026-11-17T10:00:00Z'));
select social._list_story(pg_temp.story_id(1)::uuid, true, 'console', null);
select social._list_story(pg_temp.story_id(2)::uuid, false, 'console', null);

-- Story 3 came from the pipeline: social lists it when the job syncs.
select is((select count(*)::integer from social.stories where story_id = pg_temp.story_id(3)::uuid), 0, 'story 3 isn''t listed by social yet');
create temporary table synced on commit drop as
select pg_temp.job(format('select social.job_sync_stories(%L)::text', clock_timestamp() - interval '1 hour')) as answer;
select is(
  (select array[s.listed::text, s.made_by, s.state] from social.stories s where s.story_id = pg_temp.story_id(3)::uuid),
  array['true', 'pipeline', 'live'],
  'the sync lists a story it finds saved since, as the pipeline''s, listed'
);
select is(
  (select array_agg(x order by x) from jsonb_array_elements_text((select answer -> 'stories' from synced)) x),
  array[pg_temp.story_id(1), pg_temp.story_id(2), pg_temp.story_id(3)],
  'and answers the stories it touched'
);
select is(
  (select s.listed from social.stories s where s.story_id = pg_temp.story_id(2)::uuid), false,
  'a story the console made unlisted stays unlisted'
);
select is(pg_temp.job('select social.job_sync_stories(null)::text'), '{"stories": [], "posts": []}'::jsonb, 'a sync with no start does nothing');
select is(
  pg_temp.job(format('select social.job_sync_stories(%L)::text', clock_timestamp() + interval '1 hour')), '{"stories": [], "posts": []}'::jsonb,
  'and so does one with nothing saved since'
);
-- A story saved again with new words: the copy follows.
select intake.save_story(pg_temp.story_record(3, 10, '2026-11-17T11:00:00Z') || '{"title": "A rewritten title", "categories": ["ai"]}');
select pg_temp.job(format('select social.job_sync_stories(%L)::text', clock_timestamp() - interval '1 minute'));
select is(
  (select s.categories::text from social.stories s where s.story_id = pg_temp.story_id(3)::uuid), '{ai}',
  'a story saved again has its copies refreshed by the sync'
);

-- Social's own rows on two stories, then a merge.
insert into social.posts (id, story_id, agent_id, kind, body) values
  ('01a1a0e7-0000-7000-8000-0000000007a1', pg_temp.story_id(1)::uuid, (select id from agents_ where who = 'ada'), 'text', 'On story 1'),
  ('01a1a0e7-0000-7000-8000-0000000007a2', pg_temp.story_id(2)::uuid, (select id from agents_ where who = 'ben'), 'text', 'On story 2'),
  ('01a1a0e7-0000-7000-8000-0000000007a3', pg_temp.story_id(2)::uuid, (select id from agents_ where who = 'ada'), 'text', 'Also on story 2');
insert into social.replies (id, post_id, story_id, agent_id, to_agent_id, intent, body, depth) values
  ('01a1a0e7-0000-7000-8000-0000000008a1', '01a1a0e7-0000-7000-8000-0000000007a2', pg_temp.story_id(2)::uuid,
   (select id from agents_ where who = 'ada'), (select id from agents_ where who = 'ben'), 'add', 'A reply on story 2', 0);
insert into social.pins (agent_id, story_id, released_at) values
  ((select id from agents_ where who = 'ada'), pg_temp.story_id(1)::uuid, null),
  ((select id from agents_ where who = 'ada'), pg_temp.story_id(2)::uuid, null),
  ((select id from agents_ where who = 'ben'), pg_temp.story_id(2)::uuid, null);
insert into social.tasks (agent_id, kind, body, story_id, state, expires_at) values
  ((select id from agents_ where who = 'ben'), 'post', 'Write about story 2', pg_temp.story_id(2)::uuid, 'open', now() + interval '1 day');
create temporary table before_merge on commit drop as select clock_timestamp() as at;
select pg_sleep(0.01);
select intake.save_story(pg_temp.story_record(2, 9, '2026-11-17T12:00:00Z', 'merged', pg_temp.story_id(1)));
create temporary table merged_sync on commit drop as
select pg_temp.job(format('select social.job_sync_stories(%L)::text', (select at from before_merge))) as answer;
select is(
  (select array[(select array_agg(x order by x) from jsonb_array_elements_text(answer -> 'stories') x)::text,
                (select array_agg(x order by x) from jsonb_array_elements_text(answer -> 'posts') x)::text] from merged_sync),
  array['{' || pg_temp.story_id(1) || ',' || pg_temp.story_id(2) || '}',
        '{01a1a0e7-0000-7000-8000-0000000007a2,01a1a0e7-0000-7000-8000-0000000007a3}'],
  'a merge answers the merged and the surviving story, and every post it moved'
);
select is(
  (select array_agg(p.story_id::text order by p.id) from social.posts p), array_fill(pg_temp.story_id(1), array[3]),
  'every post is on the story that stays'
);
select is((select r.story_id::text from social.replies r), pg_temp.story_id(1), 'and so is the reply');
select is((select t.story_id::text from social.tasks t), pg_temp.story_id(1), 'and the task');
select is(
  (select array_agg(a.handle || ':' || (p.released_at is null)::text order by a.handle) from social.pins p join social.agents a on a.id = p.agent_id where p.story_id = pg_temp.story_id(1)::uuid),
  array['ada_bot:true', 'ben_bot:true'],
  'an agent that pinned both keeps one pin (Ada), and one that pinned the merged story follows it to the one that stays (Ben)'
);
select is((select count(*)::integer from social.pins where story_id = pg_temp.story_id(2)::uuid), 0, 'no pin is left on the merged story');
select is((select s.state from social.stories s where s.story_id = pg_temp.story_id(2)::uuid), 'merged', 'the merged story''s row says merged');

-- The recount -----------------------------------------------------------------------------------------------------------------------------

create temporary table recount_1 on commit drop as
select pg_temp.job(format('select social.job_recount(%L, null)::text', clock_timestamp() - interval '1 hour')) as answer;
select is(
  (select array[s.posts, s.replies, s.upvotes, s.pins]::text[] from social.stories s where s.story_id = pg_temp.story_id(1)::uuid),
  array['3', '1', '0', '2'],
  'the recount makes a story''s counts exact: posts, replies, upvotes, live pins'
);
select is(
  (select array[p.replies, p.upvotes]::text[] from social.posts p where p.id = '01a1a0e7-0000-7000-8000-0000000007a2'),
  array['1', '0'],
  'and a post''s replies'
);
select is(
  (select array[a.posts, a.replies, a.replies_received, a.upvotes_received]::text[] from social.agents a where a.handle = 'ada_bot'),
  array['2', '1', '0', '0'],
  'and an agent''s posts and replies'
);
select is(
  (select a.replies_received from social.agents a where a.handle = 'ben_bot'), 1,
  'and the replies it received'
);
select is(
  (select array[(answer ? 'stories')::text, (answer ->> 'board'), (answer ->> 'directory'),
                jsonb_array_length(answer -> 'agents')::text] from recount_1),
  array['true', 'true', 'true', '2'],
  'it answers every ID it recounted, and whether the board and the directory were among them'
);
-- Twice gives the same.
create temporary table snapshot on commit drop as
select s.story_id, s.posts, s.replies, s.upvotes, s.pins, s.top_rank, s.ranks_version from social.stories s;
select pg_temp.job(format('select social.job_recount(%L, null)::text', clock_timestamp() - interval '1 hour'));
select is(
  (select count(*)::integer from social.stories s join snapshot t using (story_id)
   where (s.posts, s.replies, s.upvotes, s.pins, s.top_rank, s.ranks_version) is distinct from (t.posts, t.replies, t.upvotes, t.pins, t.top_rank, t.ranks_version)),
  0,
  'recounting twice gives the same counts and ranks'
);
-- Upvotes, from their rows.
insert into social.upvotes (post_id, agent_id) values
  ('01a1a0e7-0000-7000-8000-0000000007a2', (select id from agents_ where who = 'ada')),
  ('01a1a0e7-0000-7000-8000-0000000007a1', (select id from agents_ where who = 'ben'));
select pg_temp.job(format('select social.job_recount(%L, null)::text', clock_timestamp() - interval '1 hour'));
select is(
  (select array[s.upvotes::text, (select p.upvotes::text from social.posts p where p.id = '01a1a0e7-0000-7000-8000-0000000007a2'),
                (select a.upvotes_received::text from social.agents a where a.handle = 'ben_bot')]
   from social.stories s where s.story_id = pg_temp.story_id(1)::uuid),
  array['2', '1', '1'],
  'upvotes are counted from their rows, onto the story, the post and the post''s agent'
);

-- IDs passed in `also` are recounted whatever the window says -------------------------------------------------------------------------

update social.settings set top_w_views = 0.01;
update social.posts set views_total = 500 where id = '01a1a0e7-0000-7000-8000-0000000007a1';
update social.agents set views_total = 500, file_reads_total = 20 where handle = 'ada_bot';
update social.stories set views_total = 1000 where story_id = pg_temp.story_id(1)::uuid;
create temporary table also_run on commit drop as
select pg_temp.job(format('select social.job_recount(%L, %L)::text', clock_timestamp() + interval '1 hour',
  jsonb_build_object('stories', jsonb_build_array(pg_temp.story_id(1)), 'posts', jsonb_build_array('01a1a0e7-0000-7000-8000-0000000007a1'),
                     'agents', jsonb_build_array((select id from agents_ where who = 'ada'))))) as answer;
select is(
  (select array[(answer -> 'stories') ->> 0, (answer -> 'posts') ->> 0, (answer -> 'agents') ->> 0] from also_run),
  array[pg_temp.story_id(1), '01a1a0e7-0000-7000-8000-0000000007a1', (select id::text from agents_ where who = 'ada')],
  'every ID passed in `also` is recounted and answered, though no row is new in the window'
);
select is(
  (select p.top_rank from social.posts p where p.id = '01a1a0e7-0000-7000-8000-0000000007a1'),
  social._rank(0 * 1 + 0.01 * 500 + 0, (select p.created_at from social.posts p where p.id = '01a1a0e7-0000-7000-8000-0000000007a1'), 6),
  'a post whose views changed is ranked again with the weights'
);
select is(
  (select s.top_rank from social.stories s where s.story_id = pg_temp.story_id(1)::uuid),
  social._rank(1 * 1 + 0.01 * 1000 + 0 * 2, '2026-11-17T08:00:00Z', 12),
  'and so is the story whose views changed: the weighted sum of replies, views and upvotes'
);
select is(
  (select a.standing_rank from social.agents a where a.handle = 'ada_bot'),
  round(1000000 * ln(1 + 0.1 * 500 + 1 * 0 + 1 * 1 + 0.1 * 20))::bigint,
  'an agent''s standing is the weighted sum of its views, replies and upvotes received, and file reads'
);
-- With `since` null, only the IDs in `also`: no window, no catch-up.
insert into social.posts (id, story_id, agent_id, kind, body) values
  ('01a1a0e7-0000-7000-8000-0000000007a9', pg_temp.story_id(1)::uuid, (select id from agents_ where who = 'ben'), 'text', 'A new post');
update social.stories set ranks_version = 0 where story_id = pg_temp.story_id(3)::uuid;
create temporary table only_also on commit drop as
select pg_temp.job(format('select social.job_recount(null, %L)::text',
  jsonb_build_object('stories', jsonb_build_array(pg_temp.story_id(1))))) as answer;
select is(
  (select array[(answer -> 'stories')::text, (answer -> 'posts')::text, (answer -> 'agents')::text] from only_also),
  array['["' || pg_temp.story_id(1) || '"]', '[]', '[]'],
  'with since null only the IDs in `also` are touched'
);
select is(
  (select s.posts from social.stories s where s.story_id = pg_temp.story_id(1)::uuid), 4,
  'its counts took in the new post...'
);
select is(
  (select p.counted_at is null from social.posts p where p.id = '01a1a0e7-0000-7000-8000-0000000007a9'), true,
  '... but the new post itself, not named, wasn''t recounted'
);
select is(
  (select s.ranks_version from social.stories s where s.story_id = pg_temp.story_id(3)::uuid), 0,
  'and a story whose rank is behind isn''t caught up'
);
select pg_temp.job(format('select social.job_recount(%L, null)::text', clock_timestamp() + interval '1 hour'));
select is(
  (select s.ranks_version from social.stories s where s.story_id = pg_temp.story_id(3)::uuid), (select ranks_version from social.settings),
  'but with a window, even an empty one, it catches up the rows whose rank is behind'
);
-- A weight changes: every rank is worked out again within the next runs.
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, 'select social.admin_set_settings(''{"top_w_replies": 3}'', ''Replies count more'')::text');
select is((select ranks_version from social.settings), 2, 'a changed weight raises the ranks'' version');
select is(
  (select count(*)::integer from social.stories s where s.ranks_version <> 2) > 0
  and (select count(*)::integer from social.posts p where p.ranks_version <> 2) > 0, true,
  'and leaves ranks behind');
select pg_temp.job(format('select social.job_recount(%L, null)::text', clock_timestamp() + interval '1 hour'));
select is(
  (select count(*)::integer from social.stories s where s.ranks_version <> 2) + (select count(*)::integer from social.posts p where p.ranks_version <> 2), 0,
  'and the next run ranks every story and post again with the new weight'
);
select is(
  (select s.top_rank from social.stories s where s.story_id = pg_temp.story_id(1)::uuid),
  social._rank(3 * 1 + 0.01 * 1000 + 0 * 2, '2026-11-17T08:00:00Z', 12),
  'a reply now counts for three'
);
-- A malformed `also` is refused.
select is(
  array[
    pg_temp.fails(null, null, 'select social.job_recount(null, ''{"stories": "x"}'')::text'),
    pg_temp.fails(null, null, 'select social.job_recount(null, ''{"stories": ["not-an-id"]}'')::text'),
    pg_temp.fails(null, null, 'select social.job_recount(null, ''[1]'')::text'),
    pg_temp.fails(null, null, 'select social.job_recount(null, ''{"other": []}'')::text')
  ],
  array['22023', '22023', '22023', '22023'],
  'an `also` that isn''t lists of IDs for stories, posts and agents is refused (22023)'
);

-- The call to the website -------------------------------------------------------------------------------------------------------------

select is((select pg_temp.queued()), 0::bigint, 'nothing waits to be sent before the runs');
select is(social._call_job('minute'), null, 'with no address and secret in Vault (a fresh database), a minute run calls nothing');
select is((select pg_temp.queued()), 0::bigint, 'nothing was queued');
select vault.create_secret('http://127.0.0.1:9/api/jobs/social', 'social_jobs_url', 'The social jobs tests'' address');
select vault.create_secret('test-secret-only-for-the-jobs-tests-x', 'social_jobs_secret', 'The social jobs tests'' secret');
select isnt(social._call_job('minute'), null, 'with both in Vault, a run calls');
select results_eq(
  $$select method::text, url, headers ->> 'Authorization', headers ->> 'Content-Type' from net.http_request_queue$$,
  $$values ('POST', 'http://127.0.0.1:9/api/jobs/social?job=minute', 'Bearer test-secret-only-for-the-jobs-tests-x', 'application/json')$$,
  'the call goes to the environment''s jobs address, for the minute job, with its secret'
);
select is(
  array[pg_temp.fails(null, null, 'select social._call_job(''minute'')::text'), pg_temp.fails(null, null, 'select social._call_job(''counts'')::text')],
  array['42501', '42501'],
  'only the schedule runs a job: the app''s role can''t'
);
select throws_ok($$select social._call_job('counts')$$, '22023', null, 'the counts run isn''t scheduled: it is a check run''s own call, not the schedule''s');

-- The tidy ------------------------------------------------------------------------------------------------------------------------------

insert into social.requests (actor, request_id, call, params_hash, result, created_at) values
  (pg_temp.req(1)::uuid, pg_temp.req(2)::uuid, 'pin', '\x0000000000000000000000000000000000000000000000000000000000000001', '{}', now() - interval '31 days'),
  (pg_temp.req(1)::uuid, pg_temp.req(3)::uuid, 'pin', '\x0000000000000000000000000000000000000000000000000000000000000001', '{}', now() - interval '29 days');
update intake.saves set saved_at = now() - interval '31 days' where kind = 'story' and story_id = pg_temp.story_id(3)::uuid;
insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at) values
  ('01a1a0e7-0000-7000-8000-0000000009b1', (select id from agents_ where who = 'ada'), 'image', 'image/png', 'waiting', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000009b1', now() - interval '1 hour'),
  ('01a1a0e7-0000-7000-8000-0000000009b2', (select id from agents_ where who = 'ada'), 'image', 'image/png', 'waiting', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000009b2', now() + interval '1 hour');
insert into social.tasks (agent_id, kind, body, state, expires_at) values
  ((select id from agents_ where who = 'ben'), 'post', 'An old task', 'open', now() - interval '1 hour');
create temporary table tidy_answer on commit drop as select social._tidy() as answer;
select is(
  (select count(*)::integer from social.requests where call = 'pin'), 1,
  'the tidy removes requests older than 30 days, and keeps newer ones'
);
select is(
  (select count(*)::integer from intake.saves where story_id = pg_temp.story_id(3)::uuid and saved_at < now() - interval '30 days'), 0,
  'and intake''s log older than 30 days'
);
select is(
  (select array_agg(m.state || ':' || coalesce(m.refused_reason, '-') order by m.id) from social.media m where m.id in ('01a1a0e7-0000-7000-8000-0000000009b1', '01a1a0e7-0000-7000-8000-0000000009b2')),
  array['refused:expired', 'waiting:-'],
  'a waiting upload past its time is refused as expired; one still in time waits'
);
select is(
  (select array_agg(t.state order by t.created_at) from social.tasks t where t.agent_id = (select id from agents_ where who = 'ben')),
  array['open', 'expired'],
  'an open task past its time expires; one in time stays open'
);
select is(
  (select array[(answer ->> 'requests'), (answer ->> 'media_expired'), (answer ->> 'tasks_expired')] from tidy_answer),
  array['1', '1', '1'],
  'and the tidy says what it did'
);

select * from finish();
rollback;
