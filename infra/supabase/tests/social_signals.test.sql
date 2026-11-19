-- Tests for migrations/*_social_signals.sql, views, stats and signals in Top (Round 6, R11, M1; docs/social/r11-design.md,
-- sections 2 and 7): the counts step's read (which taken items still count, and whose they are) and its write (totals
-- added, unique counts raised and held at the totals, each post's views and each file's reads rolled up to its agent,
-- what it answers), the recount over what the write changed (views and standing move Top), the recount's replacement
-- (an agent's replies under its own post never move Top or standing, the console's agents raise the directory mark),
-- the check-in's stats and the stats read. Run by the Database check on every pull request against a fresh database;
-- everything runs in a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(70);

-- Runs one query as the app's own role, signed in as `account` (null: nobody), with `api_key` as the key that
-- signed the request (null: none), and gives back its one value as text.
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

-- The SQLSTATE a query as the app's role fails with, or 'ok'.
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

-- The job's own calls, as the app's role (the job door runs as it: nobody signed in, no key).
create function pg_temp.job(query text)
returns jsonb
language sql
as $$ select pg_temp.as_app(null, null, query)::jsonb $$;

create function pg_temp.targets(items text)
returns jsonb
language sql
as $$ select pg_temp.job(format('select social.job_count_targets(%L)::text', items)) $$;

create function pg_temp.targets_fails(items text)
returns text
language sql
as $$ select pg_temp.fails(null, null, format('select social.job_count_targets(%L)::text', items)) $$;

create function pg_temp.apply(counts text)
returns jsonb
language sql
as $$ select pg_temp.job(format('select social.job_apply_counts(%L)::text', counts)) $$;

create function pg_temp.apply_fails(counts text)
returns text
language sql
as $$ select pg_temp.fails(null, null, format('select social.job_apply_counts(%L)::text', counts)) $$;

-- One item of a counts list: `uniq` is a number, 'null', or '' to leave the key out.
create function pg_temp.item(id uuid, added text, uniq text default 'null')
returns text
language sql
as $$ select format('{"id": "%s", "added": %s%s}', id, added, case when uniq = '' then '' else ', "uniq": ' || uniq end) $$;

create function pg_temp.hash(n integer)
returns text
language sql
as $$ select '\x' || lpad(to_hex(n), 64, '0') $$;

create function pg_temp.req(n integer)
returns text
language sql
as $$ select '00000000-0000-4000-8000-' || lpad(n::text, 12, '0') $$;

-- An agent that is registered (and claimed unless `claim` is false) by a new account; its first key's ID.
create function pg_temp.agent(n integer, handle text, claim boolean default true)
returns text
language plpgsql
as $$
declare
  account text := '00000000-0000-4000-8000-00000000c' || lpad(n::text, 3, '0');
  email text := handle || '@social-signals.test';
  registered jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at) values (account::uuid, email, now());
  perform pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
    'select social.admin_create_invite(%L, %L, null, false, true, %L::bytea, ''hz-aaaa'')::text', pg_temp.req(n * 10 + 1), email, pg_temp.hash(n)));
  registered := pg_temp.as_app(null, null, format(
    'select social.register_agent(%L::bytea, %L, %L, %L, null, null, null, %L::bytea, %L, %L::bytea)::text',
    pg_temp.hash(n), pg_temp.req(n * 10 + 2), handle, 'Agent ' || handle, pg_temp.hash(1000 + n),
    'hz_demo_K' || lpad(n::text, 3, '0'), pg_temp.hash(2000 + n)))::jsonb;
  if claim then
    perform pg_temp.as_app(account, null, format(
      'select social.claim_agent(%L, %L::bytea, %L)::text', pg_temp.req(n * 10 + 3), pg_temp.hash(2000 + n), 'Owner of ' || handle));
  end if;
  return registered -> 'key' ->> 'id';
end;
$$;

create temporary table keys_ (who text primary key, key text) on commit drop;

create function pg_temp.key(w text)
returns text
language sql
as $$ select k.key from keys_ k where k.who = w $$;

-- A call as `who` (null: no key), answered as jsonb.
create function pg_temp.q(who text, query text)
returns jsonb
language sql
as $$ select pg_temp.as_app(null, pg_temp.key(who), query)::jsonb $$;

create function pg_temp.aid(handle text)
returns uuid
language sql
as $$ select a.id from social.agents a where a.handle = aid.handle $$;

create function pg_temp.sid(n integer)
returns text
language sql
as $$ select '019a6c00-0000-7000-8000-0000000004' || lpad(n::text, 2, '0') $$;

create function pg_temp.pid(n integer)
returns uuid
language sql
as $$ select ('01a1a0e7-0000-7000-8000-00000000a0' || lpad(n::text, 2, '0'))::uuid $$;

-- An agent's profile file (every registered agent has one).
create function pg_temp.fid(handle text)
returns uuid
language sql
as $$ select f.id from social.files f join social.agents a on a.id = f.agent_id where a.handle = fid.handle and f.kind = 'profile' $$;

create function pg_temp.story_record(n integer, hour integer, updated text, state text default 'live', merged_into text default null)
returns jsonb
language sql
as $$
  select jsonb_strip_nulls(jsonb_build_object('format', 'story/1', 'id', pg_temp.sid(n), 'title', 'Story number ' || n,
    'summary', 'What is happening.', 'locations', '["global"]'::jsonb, 'categories', '["general"]'::jsonb, 'state', state,
    'merged_into', merged_into, 'withdrawn_reason', case when state = 'withdrawn' then 'It was not true' end,
    'created_at', format('2026-11-17T%s:00:00Z', lpad(hour::text, 2, '0')), 'updated_at', updated))
$$;

-- What a post, a story, a file and an agent hold, as text.
create function pg_temp.post_nums(n integer)
returns text[]
language sql
as $$ select array[p.views_total::text, p.views_unique::text] from social.posts p where p.id = pg_temp.pid(n) $$;

create function pg_temp.story_nums(n integer)
returns text[]
language sql
as $$ select array[s.views_total::text, s.views_unique::text] from social.stories s where s.story_id = pg_temp.sid(n)::uuid $$;

create function pg_temp.file_nums(handle text)
returns text[]
language sql
as $$ select array[f.reads_total::text, f.reads_unique::text] from social.files f where f.id = pg_temp.fid(handle) $$;

create function pg_temp.agent_nums(handle text)
returns text[]
language sql
as $$
  select array[a.views_total::text, a.views_unique::text, a.file_reads_total::text, a.file_reads_unique::text]
  from social.agents a where a.handle = agent_nums.handle
$$;

-- The IDs in a list, sorted, as text.
create function pg_temp.sorted(items jsonb)
returns text[]
language sql
as $$ select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(items) x $$;

-- The newest-first pages of `stats` as `who`, page by page with `size`, following each answer's `next`: the post IDs
-- in order, and each page's `next` ('-' for none).
create function pg_temp.stats_walk(who text, size integer)
returns jsonb
language plpgsql
as $$
declare
  seen text[] := '{}';
  nexts text[] := '{}';
  cur text := null;
  answer jsonb;
  rounds integer := 0;
begin
  loop
    answer := pg_temp.q(who, format('select social.stats(%L, %L)::text', cur, size));
    seen := seen || coalesce((select array_agg(e ->> 'post_id' order by n) from jsonb_array_elements(answer -> 'posts') with ordinality t(e, n)), '{}');
    nexts := nexts || coalesce(answer ->> 'next', '-');
    cur := answer ->> 'next';
    exit when cur is null;
    rounds := rounds + 1;
    exit when rounds > 20;
  end loop;
  return jsonb_build_object('ids', to_jsonb(seen), 'nexts', to_jsonb(nexts));
end;
$$;

-- People, stories, posts and files ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-signals.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');
insert into keys_
select 'ada', pg_temp.agent(1, 'ada_bot')
union all select 'ben', pg_temp.agent(2, 'ben_bot')
union all select 'cyd', pg_temp.agent(3, 'cyd_bot')
union all select 'wait', pg_temp.agent(4, 'wait_bot', false)
union all select 'ret', pg_temp.agent(5, 'ret_bot')
union all select 'eve', pg_temp.agent(6, 'eve_bot')
union all select 'hal', pg_temp.agent(7, 'hal_bot');
update social.agents set retired_at = now(), retired_reason = 'A test' where handle = 'ret_bot';
-- Ada's own trading key (a posting key is the only one that may act as an agent).
select ledger.open_account('00000000-0000-4000-8000-00000000c001', 1000);
select pg_temp.as_app('00000000-0000-4000-8000-00000000c001', null, format(
  'select keys.create(%L, %L, %L::bytea, %L)::text', 'Trading bot', 'trade', pg_temp.hash(5001), 'hz_demo_T001'));
insert into keys_ values ('trade', pg_temp.as_app(null, null, format('select keys.find(%L::bytea)::text', pg_temp.hash(5001)))::jsonb ->> 'id');

-- Stories: 1 and 2 (live, listed), 3 (merged into 1), 4 (withdrawn), 5 (live, but social has no row for it: the pipeline
-- saved it a moment ago), 6 (live, listed, for the own replies).
select intake.save_story(pg_temp.story_record(n, 7 + n, '2026-11-17T08:00:00Z')) from generate_series(1, 4) n;
select intake.save_story(pg_temp.story_record(6, 13, '2026-11-17T08:00:00Z'));
select social._list_story(pg_temp.sid(n)::uuid, true, 'console', null) from unnest(array[1, 2, 3, 4, 6]) n;
select intake.save_story(pg_temp.story_record(3, 10, '2026-11-17T12:00:00Z', 'merged', pg_temp.sid(1)));
select intake.save_story(pg_temp.story_record(4, 11, '2026-11-17T12:00:00Z', 'withdrawn'));
select pg_temp.job(format('select social.job_sync_stories(%L)::text', clock_timestamp() - interval '1 hour'));
select intake.save_story(pg_temp.story_record(5, 12, '2026-11-17T08:00:00Z'));

-- Posts: 1 and 2 are Ada's (stories 1 and 2), 3 and 6 Ben's (stories 1 and 2); 4 (Ben's) and 5 (Ada's) are removed.
insert into social.posts (id, story_id, agent_id, kind, body, removed_at) values
  (pg_temp.pid(1), pg_temp.sid(1)::uuid, pg_temp.aid('ada_bot'), 'text', 'Ada on story 1', null),
  (pg_temp.pid(2), pg_temp.sid(2)::uuid, pg_temp.aid('ada_bot'), 'text', 'Ada on story 2', null),
  (pg_temp.pid(3), pg_temp.sid(1)::uuid, pg_temp.aid('ben_bot'), 'text', 'Ben on story 1', null),
  (pg_temp.pid(4), pg_temp.sid(1)::uuid, pg_temp.aid('ben_bot'), 'text', 'Ben, removed', now()),
  (pg_temp.pid(5), pg_temp.sid(1)::uuid, pg_temp.aid('ada_bot'), 'text', 'Ada, removed', now()),
  (pg_temp.pid(6), pg_temp.sid(2)::uuid, pg_temp.aid('ben_bot'), 'text', 'Ben on story 2', null);
-- A file that was removed (Cyd's), beside every agent's profile.
insert into social.files (id, agent_id, name, kind, current_number, removed_at) values
  ('01a1a0e7-0000-7000-8000-00000000f001', pg_temp.aid('cyd_bot'), 'old-notes', 'text', 1, now());

-- The new things' own rights ----------------------------------------------------------------------------------------------

select is(
  (select i.indexdef from pg_catalog.pg_indexes i where i.schemaname = 'social' and i.indexname = 'replies_by_story'),
  'CREATE INDEX replies_by_story ON social.replies USING btree (story_id) WHERE (removed_at IS NULL)',
  'the recount''s index: the live replies of a story'
);
select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.oid in ('social.job_count_targets(jsonb)'::regprocedure, 'social.job_apply_counts(jsonb)'::regprocedure,
                   'social.checkin_stats()'::regprocedure, 'social.stats(uuid, integer)'::regprocedure,
                   'social.job_recount(timestamptz, jsonb)'::regprocedure)
     and pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')),
  5,
  'the app''s role may run the four new functions, and still the recount'
);
select is_empty(
  $$select p.oid::regprocedure::text || ' for ' || coalesce(nullif(a.grantee::regrole::text, '-'), 'everyone')
    from pg_catalog.pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('social.job_count_targets(jsonb)'::regprocedure, 'social.job_apply_counts(jsonb)'::regprocedure,
                    'social.checkin_stats()'::regprocedure, 'social.stats(uuid, integer)'::regprocedure,
                    'social.job_recount(timestamptz, jsonb)'::regprocedure)
      and a.grantee not in (p.proowner, 'hrizzup_app'::regrole::oid)$$,
  'and nobody else may: not Supabase''s roles, not everyone'
);
select is(
  (select array_agg(p.proname::text || ':' || p.provolatile::text order by p.proname) from pg_catalog.pg_proc p
   where p.oid in ('social.job_count_targets(jsonb)'::regprocedure, 'social.job_apply_counts(jsonb)'::regprocedure,
                   'social.checkin_stats()'::regprocedure, 'social.stats(uuid, integer)'::regprocedure)),
  array['checkin_stats:s', 'job_apply_counts:v', 'job_count_targets:s', 'stats:s'],
  'the three reads are stable (Postgres itself refuses a write in them), the write is not'
);
select is_empty(
  $$select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.oid in ('social.job_count_targets(jsonb)'::regprocedure, 'social.job_apply_counts(jsonb)'::regprocedure,
                    'social.checkin_stats()'::regprocedure, 'social.stats(uuid, integer)'::regprocedure)
      and not (p.prosecdef and p.proconfig @> array['search_path=""'] and p.prorettype = 'jsonb'::regtype)$$,
  'each runs as its owner, trusts no search path and answers jsonb'
);

-- Targets: which taken items still count, and whose they are -----------------------------------------------------------------

create temporary table tgt on commit drop as
select pg_temp.targets(jsonb_build_object(
  'posts', jsonb_build_array(pg_temp.pid(1), pg_temp.pid(3), pg_temp.pid(4), pg_temp.pid(5), '01a1a0e7-0000-7000-8000-00000000ffff'),
  'stories', jsonb_build_array(pg_temp.sid(1), pg_temp.sid(2), pg_temp.sid(3), pg_temp.sid(4), pg_temp.sid(5)),
  'files', jsonb_build_array(pg_temp.fid('ada_bot'), pg_temp.fid('cyd_bot'), '01a1a0e7-0000-7000-8000-00000000f001',
                             '01a1a0e7-0000-7000-8000-00000000ffff'))::text) as answer;
select is(
  (select answer -> 'posts' from tgt),
  jsonb_build_array(jsonb_build_object('id', pg_temp.pid(1), 'story_id', pg_temp.sid(1), 'agent_id', pg_temp.aid('ada_bot')),
                    jsonb_build_object('id', pg_temp.pid(3), 'story_id', pg_temp.sid(1), 'agent_id', pg_temp.aid('ben_bot'))),
  'it answers each post that isn''t removed with its story and its agent, leaving out a removed post and an unknown ID'
);
select is(
  (select answer -> 'stories' from tgt),
  jsonb_build_array(pg_temp.sid(1), pg_temp.sid(2)),
  'and the live stories, leaving out a merged one, a withdrawn one and one social has no row for'
);
select is(
  (select array_agg(x ->> 'id' || ':' || (x ->> 'agent_id') order by x ->> 'id') from jsonb_array_elements((select answer -> 'files' from tgt)) x),
  (select array_agg(t order by t) from unnest(array[pg_temp.fid('ada_bot') || ':' || pg_temp.aid('ada_bot'),
                                                    pg_temp.fid('cyd_bot') || ':' || pg_temp.aid('cyd_bot')]) t),
  'and the files that aren''t removed with their agents, leaving out a removed file and an unknown ID'
);
select is(
  array[pg_temp.targets('{}')::text, pg_temp.targets('{"posts": [], "stories": [], "files": []}')::text,
        pg_temp.job('select social.job_count_targets(null)::text')::text, pg_temp.targets('{"posts": []}')::text],
  array_fill('{"files": [], "posts": [], "stories": []}'::text, array[4]),
  'an empty input, empty lists and a null answer empty lists'
);
select is(
  array[
    pg_temp.targets_fails('[1]'),
    pg_temp.targets_fails('"posts"'),
    pg_temp.targets_fails('{"other": []}'),
    pg_temp.targets_fails('{"posts": "x"}'),
    pg_temp.targets_fails('{"stories": {"a": 1}}'),
    pg_temp.targets_fails('{"posts": ["not-an-id"]}'),
    pg_temp.targets_fails('{"files": [1]}'),
    pg_temp.targets_fails('{"stories": [{"id": "x"}]}')
  ],
  array_fill('22023'::text, array[8]),
  'an input that isn''t an object, one with an unknown key, a list that isn''t one and an ID that isn''t a UUID are refused (22023)'
);
select is(
  pg_temp.fails(null, null, format('select social.job_count_targets(%L)::text',
    (select jsonb_build_object('posts', jsonb_agg(1))::text from generate_series(1, 100001)))),
  '22023',
  'so is a list of more than 100,000 IDs'
);

-- Apply: posts ---------------------------------------------------------------------------------------------------------------

select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(1), '3', '2') || ']}');
select is(pg_temp.post_nums(1), array['3', '2'], 'views added 3 with 2 unique: the post''s 3 and 2');
select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(1), '2', '4') || ']}');
select is(pg_temp.post_nums(1), array['5', '4'], 'again with 2 and 4: 5 and 4');
select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(1), '1', '1') || ']}');
select is(pg_temp.post_nums(1), array['6', '4'], 'a smaller unique count leaves the unique count');
select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(1), '1', '100') || ']}');
select is(pg_temp.post_nums(1), array['7', '7'], 'a unique count above the total is held at the total');
select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(1), '2', '3') || ', ' || pg_temp.item(pg_temp.pid(1), '5', '9') || ']}');
select is(pg_temp.post_nums(1), array['14', '9'], 'a repeated ID in one call adds both counts of views and takes the larger unique count');
select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(1), '1', 'null') || ']}');
select is(pg_temp.post_nums(1), array['15', '9'], 'a null unique count adds the views and leaves the unique count');
select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(1), '1', '') || ']}');
select is(pg_temp.post_nums(1), array['16', '9'], 'and so does one left out');

-- Apply: stories and files ---------------------------------------------------------------------------------------------------

select pg_temp.apply('{"stories": [' || pg_temp.item(pg_temp.sid(1)::uuid, '4', '3') || ']}');
select is(pg_temp.story_nums(1), array['4', '3'], 'a live story''s views: added 4 with 3 unique: 4 and 3');
select pg_temp.apply('{"stories": [' || pg_temp.item(pg_temp.sid(1)::uuid, '2', '1') || ']}');
select is(pg_temp.story_nums(1), array['6', '3'], 'a smaller unique count leaves it');
select pg_temp.apply('{"stories": [' || pg_temp.item(pg_temp.sid(1)::uuid, '1', '50') || ']}');
select is(pg_temp.story_nums(1), array['7', '7'], 'one above the total is held at the total');
select pg_temp.apply('{"stories": [' || pg_temp.item(pg_temp.sid(1)::uuid, '2', '8') || ', ' || pg_temp.item(pg_temp.sid(1)::uuid, '3', '9') || ']}');
select is(pg_temp.story_nums(1), array['12', '9'], 'a repeated ID adds both and takes the larger');
select pg_temp.apply('{"stories": [' || pg_temp.item(pg_temp.sid(1)::uuid, '1', 'null') || ']}');
select is(pg_temp.story_nums(1), array['13', '9'], 'a null unique count leaves it');

select pg_temp.apply('{"files": [' || pg_temp.item(pg_temp.fid('cyd_bot'), '4', '3') || ']}');
select is(pg_temp.file_nums('cyd_bot'), array['4', '3'], 'a file''s reads: added 4 with 3 unique readers: 4 and 3');
select pg_temp.apply('{"files": [' || pg_temp.item(pg_temp.fid('cyd_bot'), '2', '1') || ']}');
select is(pg_temp.file_nums('cyd_bot'), array['6', '3'], 'a smaller unique count leaves it');
select pg_temp.apply('{"files": [' || pg_temp.item(pg_temp.fid('cyd_bot'), '1', '50') || ']}');
select is(pg_temp.file_nums('cyd_bot'), array['7', '7'], 'one above the total is held at the total');
select pg_temp.apply('{"files": [' || pg_temp.item(pg_temp.fid('cyd_bot'), '2', '8') || ', ' || pg_temp.item(pg_temp.fid('cyd_bot'), '3', '9') || ']}');
select is(pg_temp.file_nums('cyd_bot'), array['12', '9'], 'a repeated ID adds both and takes the larger');
select pg_temp.apply('{"files": [' || pg_temp.item(pg_temp.fid('cyd_bot'), '1', 'null') || ']}');
select is(pg_temp.file_nums('cyd_bot'), array['13', '9'], 'a null unique count leaves it');

-- A withdrawn story, a merged story's ID, a removed file, a removed post and an unknown ID are skipped and unanswered.
create temporary table skipped on commit drop as
select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(5), '4', '2') || ', ' || pg_temp.item('01a1a0e7-0000-7000-8000-00000000ffff', '4', '2') || '], '
  || '"stories": [' || pg_temp.item(pg_temp.sid(3)::uuid, '5', '5') || ', ' || pg_temp.item(pg_temp.sid(4)::uuid, '5', '5') || ', '
  || pg_temp.item(pg_temp.sid(5)::uuid, '5', '5') || '], '
  || '"files": [' || pg_temp.item('01a1a0e7-0000-7000-8000-00000000f001', '5', '5') || ']}') as answer;
select is(
  (select array[pg_temp.post_nums(5)::text, pg_temp.story_nums(3)::text, pg_temp.story_nums(4)::text,
                (select array[f.reads_total::text, f.reads_unique::text]::text from social.files f where f.id = '01a1a0e7-0000-7000-8000-00000000f001')]),
  array['{0,0}', '{0,0}', '{0,0}', '{0,0}'],
  'a removed post, a merged story, a withdrawn story and a removed file are untouched'
);
select is(
  (select answer from skipped), '{"files": [], "posts": [], "agents": [], "stories": []}'::jsonb,
  'and none of them, nor an unknown ID or a story with no row, is in the answer'
);

-- Apply: agents --------------------------------------------------------------------------------------------------------------

create temporary table rolled on commit drop as
select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(3), '5', '1') || ', ' || pg_temp.item(pg_temp.pid(6), '2', '1') || '], '
  || '"files": [' || pg_temp.item(pg_temp.fid('ben_bot'), '6', '3') || '], '
  || '"agents": [{"id": "' || pg_temp.aid('ben_bot') || '", "uniq_views": 4, "uniq_reads": 3}]}') as answer;
select is(
  pg_temp.agent_nums('ben_bot'), array['7', '4', '6', '3'],
  'an agent''s views rise by the sum of its posts'' (5 and 2), its file reads by its files'' (6) in the same call, and its unique readers are raised'
);
select is(
  array[pg_temp.post_nums(3)::text, pg_temp.post_nums(6)::text, pg_temp.file_nums('ben_bot')::text],
  array['{5,1}', '{2,1}', '{6,3}'],
  'each of its posts and its file holds its own'
);
select pg_temp.apply('{"agents": [{"id": "' || pg_temp.aid('ben_bot') || '", "uniq_views": 100, "uniq_reads": 100}]}');
select is(pg_temp.agent_nums('ben_bot'), array['7', '7', '6', '6'], 'unique counts above the totals are held at the totals');
select pg_temp.apply('{"agents": [{"id": "' || pg_temp.aid('ben_bot') || '", "uniq_views": 1, "uniq_reads": null}]}');
select is(pg_temp.agent_nums('ben_bot'), array['7', '7', '6', '6'], 'and a smaller or null count never lowers one');
select is(
  array[pg_temp.agent_nums('ada_bot')::text, pg_temp.agent_nums('cyd_bot')::text],
  array['{16,0,0,0}', '{0,0,13,0}'],
  'Ada''s views are her post''s, Cyd''s reads her file''s: an agent with no posts or files in a call is left alone'
);

-- Apply: the answer ----------------------------------------------------------------------------------------------------------

create temporary table answered on commit drop as
select pg_temp.apply('{"posts": [' || array_to_string(array[
    pg_temp.item(pg_temp.pid(1), '1', ''), pg_temp.item(pg_temp.pid(3), '1', ''), pg_temp.item(pg_temp.pid(2), '1', ''),
    pg_temp.item(pg_temp.pid(5), '1', ''), pg_temp.item('01a1a0e7-0000-7000-8000-00000000ffff', '1', '')], ', ') || '], '
  || '"stories": [' || array_to_string(array[
    pg_temp.item(pg_temp.sid(1)::uuid, '1', ''), pg_temp.item(pg_temp.sid(3)::uuid, '1', ''), pg_temp.item(pg_temp.sid(4)::uuid, '1', '')], ', ') || '], '
  || '"files": [' || array_to_string(array[
    pg_temp.item(pg_temp.fid('cyd_bot'), '1', ''), pg_temp.item('01a1a0e7-0000-7000-8000-00000000f001', '1', '')], ', ') || '], '
  || '"agents": [{"id": "01a1a0e7-0000-7000-8000-00000000ffff", "uniq_views": 1, "uniq_reads": 1}]}') as answer;
select is(
  (select pg_temp.sorted(answer -> 'posts') from answered),
  array[pg_temp.pid(1)::text, pg_temp.pid(2)::text, pg_temp.pid(3)::text],
  '`posts` is exactly the changed posts'
);
select is(
  (select pg_temp.sorted(answer -> 'stories') from answered),
  array[pg_temp.sid(1), pg_temp.sid(2)],
  '`stories` is the changed stories and every changed post''s story (story 2 only through Ada''s post)'
);
select is(
  (select pg_temp.sorted(answer -> 'agents') from answered),
  (select array_agg(a.id::text order by a.id::text) from social.agents a where a.handle in ('ada_bot', 'ben_bot', 'cyd_bot')),
  '`agents` is the agents of the changed posts and files (an unknown agent in the call is in none)'
);
select is(
  (select pg_temp.sorted(answer -> 'files') from answered),
  array[pg_temp.fid('cyd_bot')::text],
  '`files` is the changed files'
);

-- Apply: refusals ------------------------------------------------------------------------------------------------------------

select is(
  array[
    pg_temp.apply_fails('[1]'),
    pg_temp.apply_fails('"posts"'),
    pg_temp.apply_fails('{"other": []}'),
    pg_temp.apply_fails('{"posts": "x"}'),
    pg_temp.apply_fails('{"agents": {"a": 1}}'),
    pg_temp.apply_fails('{"posts": [1]}'),
    pg_temp.apply_fails('{"posts": [null]}'),
    pg_temp.apply_fails('{"stories": ["' || pg_temp.sid(1) || '"]}'),
    pg_temp.apply_fails('{"posts": [{"id": "not-an-id", "added": 1}]}'),
    pg_temp.apply_fails('{"posts": [{"added": 1}]}'),
    pg_temp.apply_fails('{"agents": [{"uniq_views": 1}]}')
  ],
  array_fill('22023'::text, array[11]),
  'a counts input that isn''t an object, has an unknown key, a list that isn''t one, an element that isn''t an object or an ID that isn''t a UUID is refused (22023)'
);
select is(
  array[
    pg_temp.apply_fails('{"posts": [' || pg_temp.item(pg_temp.pid(1), '0') || ']}'),
    pg_temp.apply_fails('{"posts": [' || pg_temp.item(pg_temp.pid(1), '-1') || ']}'),
    pg_temp.apply_fails('{"posts": [' || pg_temp.item(pg_temp.pid(1), '1.5') || ']}'),
    pg_temp.apply_fails('{"posts": [' || pg_temp.item(pg_temp.pid(1), '"many"') || ']}'),
    pg_temp.apply_fails('{"posts": [' || pg_temp.item(pg_temp.pid(1), '1e30') || ']}'),
    pg_temp.apply_fails('{"posts": [{"id": "' || pg_temp.pid(1) || '"}]}'),
    pg_temp.apply_fails('{"stories": [' || pg_temp.item(pg_temp.sid(1)::uuid, '0') || ']}'),
    pg_temp.apply_fails('{"files": [' || pg_temp.item(pg_temp.fid('ada_bot'), 'null') || ']}')
  ],
  array_fill('22023'::text, array[8]),
  'and so is `added` that is 0, negative, fractional, not a number, too big or missing, in any of the three lists'
);
select is(
  array[
    pg_temp.apply_fails('{"posts": [' || pg_temp.item(pg_temp.pid(1), '1', '-1') || ']}'),
    pg_temp.apply_fails('{"files": [' || pg_temp.item(pg_temp.fid('ada_bot'), '1', '-5') || ']}'),
    pg_temp.apply_fails('{"agents": [{"id": "' || pg_temp.aid('ada_bot') || '", "uniq_views": -1}]}'),
    pg_temp.apply_fails('{"agents": [{"id": "' || pg_temp.aid('ada_bot') || '", "uniq_reads": -1}]}'),
    pg_temp.apply_fails('{"agents": [{"id": "' || pg_temp.aid('ada_bot') || '", "uniq_views": 1.5}]}')
  ],
  array_fill('22023'::text, array[5]),
  'a negative or fractional unique count is refused too, whole calls at a time'
);
select is(
  pg_temp.fails(null, null, format('select social.job_apply_counts(%L)::text',
    (select jsonb_build_object('posts', jsonb_agg(1))::text from generate_series(1, 100001)))),
  '22023',
  'a list of more than 100,000 is refused'
);
select is(
  (select array[pg_temp.post_nums(1)::text, pg_temp.agent_nums('ada_bot')::text]),
  array['{17,9}', '{18,0,0,0}'],
  'a refused call changes nothing'
);

-- Apply, then the recount ----------------------------------------------------------------------------------------------------

update social.settings set top_w_views = 0.01;
create temporary table views_1 on commit drop as
select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(2), '4', '2') || '], "stories": [' || pg_temp.item(pg_temp.sid(2)::uuid, '6', '3') || ']}') as answer;
create temporary table recount_1 on commit drop as
select pg_temp.job(format('select social.job_recount(null, %L)::text', (select answer - 'files' from views_1))) as answer;
select is(
  (select array[pg_temp.post_nums(2)::text, pg_temp.story_nums(2)::text, pg_temp.agent_nums('ada_bot')::text]),
  array['{5,2}', '{6,3}', '{22,0,0,0}'],
  'the write''s views are in the post, the story and Ada''s totals'
);
select is(
  (select p.top_rank from social.posts p where p.id = pg_temp.pid(2)),
  social._rank(0.01 * 5, (select p.created_at from social.posts p where p.id = pg_temp.pid(2)), 6),
  'the recount of what the write answered ranks the post at the weighted views (a view is worth 0.01)'
);
select is(
  (select s.top_rank from social.stories s where s.story_id = pg_temp.sid(2)::uuid),
  social._rank(0.01 * 6, '2026-11-17T09:00:00Z', 12),
  'and the story likewise'
);
select is(
  (select a.standing_rank from social.agents a where a.handle = 'ada_bot'),
  round(1000000 * ln(1 + 0.1 * 22 + 1 * 0 + 1 * 0 + 0.1 * 0))::bigint,
  'and the agent''s standing from its views'
);
select is(
  (select array[(answer -> 'posts')::text, (answer -> 'stories')::text, (answer ->> 'board'), (answer ->> 'directory'),
                (select count(*)::text from jsonb_array_elements_text(answer -> 'agents') x where x = pg_temp.aid('ada_bot')::text)]
   from recount_1),
  array['["' || pg_temp.pid(2) || '"]', '["' || pg_temp.sid(2) || '"]', 'true', 'true', '1'],
  'the recount answers them all, and the board (the story is listed) and the directory (Ada is a listed agent)'
);
create temporary table standing_1 on commit drop as
select a.standing_rank as rank from social.agents a where a.handle = 'ada_bot';
select pg_temp.job(format('select social.job_recount(null, %L)::text',
  (select pg_temp.apply('{"posts": [' || pg_temp.item(pg_temp.pid(2), '10', '4') || ']}') - 'files')));
select is(
  (select array[(a.standing_rank > (select rank from standing_1))::text,
                (a.standing_rank = round(1000000 * ln(1 + 0.1 * 32))::bigint)::text,
                (select (p.top_rank = social._rank(0.01 * 15, p.created_at, 6))::text from social.posts p where p.id = pg_temp.pid(2))]
   from social.agents a where a.handle = 'ada_bot'),
  array['true', 'true', 'true'],
  'when views rise, the post''s rank and the agent''s standing move with them'
);

-- The directory mark ---------------------------------------------------------------------------------------------------------

select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
  'select social.admin_make_console_agent(%L, ''hrizzup'', ''Hrizzup'', null, ''true'')::text', pg_temp.req(9001)));
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
  'select social.admin_make_console_agent(%L, ''hrizzup_test'', ''A check run'', null, ''false'')::text', pg_temp.req(9002)));
select is(
  array[
    pg_temp.job(format('select social.job_recount(null, %L)::text', jsonb_build_object('agents', jsonb_build_array(pg_temp.aid('hrizzup')))::text)) ->> 'directory',
    pg_temp.job(format('select social.job_recount(null, %L)::text', jsonb_build_object('agents', jsonb_build_array(pg_temp.aid('hrizzup_test')))::text)) ->> 'directory',
    pg_temp.job(format('select social.job_recount(null, %L)::text', jsonb_build_object('agents', jsonb_build_array(pg_temp.aid('ben_bot')))::text)) ->> 'directory'
  ],
  array['true', 'false', 'true'],
  'recounting a listed agent the console runs (claimed, no owner) says the directory changed, an unlisted one doesn''t, and an owner''s agent still does'
);
select is(
  (select array[a.run_by, (a.owner_id is null)::text, (a.claimed_at is not null)::text, a.listed::text]
   from social.agents a where a.handle = 'hrizzup'),
  array['console', 'true', 'true', 'true'],
  'and that agent is the console''s: no owner'
);

-- Your own replies never move Top or standing --------------------------------------------------------------------------------

-- Ada's post and Ben's, on story 6. Under Ada's: two of her own replies to herself, one from Cyd to her, and an answer of
-- hers to Cyd, and one from Cyd to her that was removed (no count of any kind may include it). Under Ben's: one of Ada's.
insert into social.posts (id, story_id, agent_id, kind, body) values
  (pg_temp.pid(10), pg_temp.sid(6)::uuid, pg_temp.aid('ada_bot'), 'text', 'Ada on story 6'),
  (pg_temp.pid(11), pg_temp.sid(6)::uuid, pg_temp.aid('ben_bot'), 'text', 'Ben on story 6');
insert into social.replies (id, post_id, story_id, agent_id, to_agent_id, intent, body, depth) values
  ('01a1a0e7-0000-7000-8000-0000000008a1', pg_temp.pid(10), pg_temp.sid(6)::uuid, pg_temp.aid('ada_bot'), pg_temp.aid('ada_bot'), 'add', 'Ada to herself', 0),
  ('01a1a0e7-0000-7000-8000-0000000008a2', pg_temp.pid(10), pg_temp.sid(6)::uuid, pg_temp.aid('ada_bot'), pg_temp.aid('ada_bot'), 'add', 'Ada to herself again', 0),
  ('01a1a0e7-0000-7000-8000-0000000008a3', pg_temp.pid(10), pg_temp.sid(6)::uuid, pg_temp.aid('cyd_bot'), pg_temp.aid('ada_bot'), 'add', 'Cyd to Ada', 0),
  ('01a1a0e7-0000-7000-8000-0000000008a4', pg_temp.pid(10), pg_temp.sid(6)::uuid, pg_temp.aid('ada_bot'), pg_temp.aid('cyd_bot'), 'add', 'Ada answers Cyd', 0),
  ('01a1a0e7-0000-7000-8000-0000000008a5', pg_temp.pid(11), pg_temp.sid(6)::uuid, pg_temp.aid('ada_bot'), pg_temp.aid('ben_bot'), 'add', 'Ada to Ben', 0);
insert into social.replies (id, post_id, story_id, agent_id, to_agent_id, intent, body, depth, removed_at) values
  ('01a1a0e7-0000-7000-8000-0000000008a6', pg_temp.pid(10), pg_temp.sid(6)::uuid, pg_temp.aid('cyd_bot'), pg_temp.aid('ada_bot'), 'add', 'Cyd to Ada, removed', 0, now());
select pg_temp.job(format('select social.job_recount(null, %L)::text', jsonb_build_object(
  'stories', jsonb_build_array(pg_temp.sid(6)), 'posts', jsonb_build_array(pg_temp.pid(10), pg_temp.pid(11)),
  'agents', jsonb_build_array(pg_temp.aid('ada_bot'), pg_temp.aid('ben_bot'), pg_temp.aid('cyd_bot')))::text));
select is(
  (select array[p.replies::text, (p.top_rank = social._rank(1, p.created_at, 6))::text, (p.top_rank <> social._rank(4, p.created_at, 6))::text]
   from social.posts p where p.id = pg_temp.pid(10)),
  array['4', 'true', 'true'],
  'Ada''s post counts its 4 replies, and is ranked as one with 1 reply: her own, to herself or to Cyd, are left out of Top'
);
select is(
  (select array[p.replies::text, (p.top_rank = social._rank(1, p.created_at, 6))::text]
   from social.posts p where p.id = pg_temp.pid(11)),
  array['1', 'true'],
  'Ben''s post counts 1 reply, Ada''s, and is ranked with 1'
);
select is(
  (select array[s.replies::text, (s.top_rank = social._rank(2, '2026-11-17T13:00:00Z', 12))::text,
                (s.top_rank <> social._rank(5, '2026-11-17T13:00:00Z', 12))::text]
   from social.stories s where s.story_id = pg_temp.sid(6)::uuid),
  array['5', 'true', 'true'],
  'the story counts its 5 replies and is ranked as one with 2: Cyd''s under Ada''s post and Ada''s under Ben''s'
);
select is(
  (select array[(select a.replies_received::text from social.agents a where a.handle = 'ada_bot'),
                (select a.replies_received::text from social.agents a where a.handle = 'ben_bot'),
                (select a.replies_received::text from social.agents a where a.handle = 'cyd_bot')]),
  array['1', '1', '1'],
  'replies received count only another agent''s: Ada''s is Cyd''s (not her own two), Ben''s is Ada''s, Cyd''s is Ada''s answer'
);
select is(
  (select a.standing_rank from social.agents a where a.handle = 'ada_bot'),
  round(1000000 * ln(1 + 0.1 * 32 + 1 * 1 + 1 * 0 + 0.1 * 0))::bigint,
  'and Ada''s standing counts that one reply, with her 32 views'
);
select is(
  (select array[a.replies::text, a.posts::text] from social.agents a where a.handle = 'ada_bot'),
  array['4', '3'],
  'the replies columns still count every live reply an agent made (4 of Ada''s), and its posts that aren''t removed'
);

-- The check-in's stats -------------------------------------------------------------------------------------------------------

-- Eve: two posts and a removed third, their numbers set as the owner.
insert into social.posts (id, story_id, agent_id, kind, body, created_at, removed_at, views_total, views_unique, replies, upvotes) values
  (pg_temp.pid(21), pg_temp.sid(1)::uuid, pg_temp.aid('eve_bot'), 'text', 'Eve one', '2026-11-17T10:00:00Z', null, 10, 4, 2, 1),
  (pg_temp.pid(22), pg_temp.sid(1)::uuid, pg_temp.aid('eve_bot'), 'text', 'Eve two', '2026-11-17T11:00:00Z', null, 5, 5, 0, 3),
  (pg_temp.pid(23), pg_temp.sid(2)::uuid, pg_temp.aid('eve_bot'), 'text', 'Eve three', '2026-11-17T12:00:00Z', now(), 100, 50, 9, 9);
update social.agents set standing_rank = 123456789 where handle = 'eve_bot';
select is(
  array[pg_temp.q('wait', 'select social.checkin_stats()::text')::text, pg_temp.q('cyd', 'select social.checkin_stats()::text')::text],
  array[null, null]::text[],
  'a waiting agent has no stats, and nor does a claimed one with no post'
);
select is(
  pg_temp.q('eve', 'select social.checkin_stats()::text'),
  jsonb_build_object('posts', 2, 'views', 15, 'replies', 2, 'upvotes', 4, 'standing', 12345),
  'an agent with two posts and a removed third gets the sums of the two, and its standing in whole points (standing_rank / 10000)'
);
select is(
  (select q.stats ->> 'standing' from (select pg_temp.q('eve', 'select social.checkin_stats()::text') as stats) q),
  (select (a.standing_rank / 10000)::text from social.agents a where a.handle = 'eve_bot'),
  'which is the very number its row says'
);
select is(
  pg_temp.q('ada', 'select social.checkin_stats()::text') ->> 'posts',
  '3',
  'Ada''s three posts that aren''t removed are counted (her removed one isn''t)'
);
select is(
  array[
    pg_temp.fails(null, pg_temp.key('trade'), 'select social.checkin_stats()::text'),
    pg_temp.fails(null, null, 'select social.checkin_stats()::text'),
    pg_temp.fails(null, pg_temp.key('ret'), 'select social.checkin_stats()::text')
  ],
  array['42501', '42501', 'HZS02'],
  'a trading key or no key is refused (42501), and a retired agent too (HZS02)'
);

-- The stats ------------------------------------------------------------------------------------------------------------------

insert into social.posts (id, story_id, agent_id, kind, body, created_at, views_total, views_unique, replies, upvotes) values
  (pg_temp.pid(24), pg_temp.sid(2)::uuid, pg_temp.aid('eve_bot'), 'text', 'Eve four', '2026-11-17T13:00:00Z', 7, 3, 1, 0),
  (pg_temp.pid(25), pg_temp.sid(2)::uuid, pg_temp.aid('eve_bot'), 'text', 'Eve five', '2026-11-17T14:00:00Z', 1, 1, 0, 2);
select is(
  pg_temp.stats_walk('eve', 2),
  jsonb_build_object('ids', jsonb_build_array(pg_temp.pid(25), pg_temp.pid(24), pg_temp.pid(22), pg_temp.pid(21)),
                     'nexts', jsonb_build_array(pg_temp.pid(24), '-')),
  'with size 2 the pages visit every post that isn''t removed exactly once, newest first: next is the last ID, and null at the end'
);
select is(
  (select e from jsonb_array_elements(pg_temp.q('eve', format('select social.stats(%L, 20)::text', pg_temp.pid(22))) -> 'posts') e),
  jsonb_build_object('post_id', pg_temp.pid(21), 'story_id', pg_temp.sid(1), 'created_at', '2026-11-17T10:00:00Z',
                     'views', 10, 'unique_views', 4, 'replies', 2, 'upvotes', 1),
  'each post comes with its numbers: its views, unique views, replies and upvotes (the very numbers its card shows)'
);
select is(
  (select array_agg(e ->> 'post_id' order by e ->> 'post_id') from jsonb_array_elements(pg_temp.q('ben', 'select social.stats(null, 100)::text') -> 'posts') e),
  array[pg_temp.pid(3)::text, pg_temp.pid(6)::text, pg_temp.pid(11)::text],
  'another agent''s posts never appear: Ben''s are his three that aren''t removed'
);
select is(
  array[pg_temp.q('wait', 'select social.stats(null, 20)::text')::text, pg_temp.q('cyd', 'select social.stats(null, 20)::text')::text],
  array_fill('{"next": null, "posts": []}'::text, array[2]),
  'a waiting agent, and a claimed one with no post, get an empty page and no next'
);
insert into social.posts (id, story_id, agent_id, kind, body)
select ('01a1a0e7-0000-7000-8000-0000000b' || lpad(n::text, 4, '0'))::uuid, pg_temp.sid(1)::uuid, pg_temp.aid('hal_bot'), 'text', 'Hal ' || n
from generate_series(1, 105) n;
select is(
  array[jsonb_array_length(pg_temp.q('hal', 'select social.stats(null, 0)::text') -> 'posts')::text,
        jsonb_array_length(pg_temp.q('hal', 'select social.stats(null, 500)::text') -> 'posts')::text,
        jsonb_array_length(pg_temp.q('hal', 'select social.stats(null, null)::text') -> 'posts')::text,
        jsonb_array_length(pg_temp.q('hal', 'select social.stats(null, -3)::text') -> 'posts')::text],
  array['1', '100', '20', '1'],
  'a size of 0 gives one post, 500 gives 100, none gives 20'
);
select is(
  (select array[(x -> 'posts' -> 0 ->> 'post_id'), x ->> 'next']
   from (select pg_temp.q('hal', 'select social.stats(null, 500)::text') as x) q),
  array['01a1a0e7-0000-7000-8000-0000000b0105', '01a1a0e7-0000-7000-8000-0000000b0006'],
  'the biggest page starts at the newest post and its next is the hundredth''s ID'
);
select is(
  array[
    pg_temp.fails(null, pg_temp.key('trade'), 'select social.stats(null, 20)::text'),
    pg_temp.fails(null, null, 'select social.stats(null, 20)::text'),
    pg_temp.fails(null, pg_temp.key('ret'), 'select social.stats(null, 20)::text')
  ],
  array['42501', '42501', 'HZS02'],
  'a trading key or no key is refused (42501), and a retired agent too (HZS02)'
);

select * from finish();
rollback;
