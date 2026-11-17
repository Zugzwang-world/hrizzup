-- Tests for migrations/*_social.sql, reading (docs/social/build.md, D5, D7 and section 4): the board's two orders
-- and filters, paging by key, what stays off the board, a story's desk and brief, Top's rank, the agent
-- directory and profiles, and the check-in. Run by the Database check on every pull request against a fresh
-- database; everything runs in a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(54);

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

create function pg_temp.hash(n integer)
returns text
language sql
as $$ select '\x' || lpad(to_hex(n), 64, '0') $$;

create function pg_temp.req(n integer)
returns text
language sql
as $$ select '00000000-0000-4000-8000-' || lpad(n::text, 12, '0') $$;

-- An agent that is registered (and claimed unless `claim` is false) by a new account; its first key's ID.
create function pg_temp.agent(n integer, handle text, listed boolean default true, claim boolean default true)
returns text
language plpgsql
as $$
declare
  account text := '00000000-0000-4000-8000-00000000c' || lpad(n::text, 3, '0');
  email text := handle || '@social-board.test';
  registered jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at) values (account::uuid, email, now());
  perform pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
    'select social.admin_create_invite(%L, %L, null, false, %L, %L::bytea, ''hz-aaaa'')::text', pg_temp.req(n * 10 + 1), email, listed, pg_temp.hash(n)));
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

create function pg_temp.story_id(n integer)
returns text
language sql
as $$ select '019a6c00-0000-7000-8000-0000000002' || lpad(n::text, 2, '0') $$;

-- Saves a story at `created` (today, 2026-11-17, at that hour) in the categories and places given.
create function pg_temp.save_story(n integer, hour integer, categories text[], places text[], listed boolean default true)
returns void
language plpgsql
as $$
begin
  perform intake.save_story(jsonb_build_object('format', 'story/1', 'id', pg_temp.story_id(n), 'title', 'Story number ' || n,
    'summary', 'What is happening in story ' || n || '.', 'locations', to_jsonb(places), 'categories', to_jsonb(categories),
    'state', 'live', 'created_at', format('2026-11-17T%s:00:00Z', lpad(hour::text, 2, '0')),
    'updated_at', format('2026-11-17T%s:00:00Z', lpad(hour::text, 2, '0'))));
  perform social._list_story(pg_temp.story_id(n)::uuid, listed, 'console', null);
end;
$$;

create function pg_temp.save_update(id text, story integer, hour integer, minute integer)
returns void
language sql
as $$
  select intake.save_update(jsonb_build_object('format', 'update/1', 'id', id, 'story_id', pg_temp.story_id(story),
    'headline', 'A development in story ' || story, 'reported_at', format('2026-11-17T%s:%s:00Z', lpad(hour::text, 2, '0'), lpad(minute::text, 2, '0')),
    'sources', jsonb_build_array('https://example.com/a'), 'state', 'live',
    'created_at', format('2026-11-17T%s:%s:00Z', lpad(hour::text, 2, '0'), lpad(minute::text, 2, '0')),
    'updated_at', format('2026-11-17T%s:%s:00Z', lpad(hour::text, 2, '0'), lpad(minute::text, 2, '0'))))
$$;

-- Every story the board lists, page by page with `size`, following each answer's `next`: the IDs in order.
create function pg_temp.page_all(how text, size integer, category text default null, places text[] default null)
returns text[]
language plpgsql
as $$
declare
  found_ids text[] := '{}';
  answer jsonb;
  after jsonb := null;
  rounds integer := 0;
begin
  loop
    answer := pg_temp.as_app(null, null, format('select social.board(%L, %L, %L, %L, %s)::text', how, category, places, after, size))::jsonb;
    found_ids := found_ids || array(select s ->> 'id' from jsonb_array_elements(answer -> 'stories') s);
    after := answer -> 'next';
    exit when after is null or jsonb_typeof(after) = 'null';
    rounds := rounds + 1;
    exit when rounds > 40;
  end loop;
  return found_ids;
end;
$$;

-- People, stories and the rest -----------------------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-board.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');
create temporary table keys_ on commit drop as
select 'ada' as who, pg_temp.agent(1, 'ada_bot') as key
union all select 'ben', pg_temp.agent(2, 'ben_bot')
union all select 'zed', pg_temp.agent(3, 'zed_bot', false)
union all select 'wait', pg_temp.agent(4, 'wait_bot', true, false);

-- Six listed stories an hour apart; one unlisted, one merged into the sixth, one withdrawn.
select pg_temp.save_story(1, 8, '{ai}', '{india}');
select pg_temp.save_story(2, 9, '{sports}', '{india,mumbai}');
select pg_temp.save_story(3, 10, '{ai,finance}', '{global}');
select pg_temp.save_story(4, 11, '{crypto}', '{bengaluru,india}');
select pg_temp.save_story(5, 12, '{general}', '{global}');
select pg_temp.save_story(6, 13, '{ai}', '{mumbai}');
select pg_temp.save_story(7, 14, '{general}', '{global}', false);
select pg_temp.save_story(8, 14, '{general}', '{global}');
select pg_temp.save_story(9, 15, '{general}', '{global}');
select intake.save_story(jsonb_build_object('format', 'story/1', 'id', pg_temp.story_id(8), 'title', 'Story number 8', 'summary', 'Merged.',
  'locations', '["global"]'::jsonb, 'categories', '["general"]'::jsonb, 'state', 'merged', 'merged_into', pg_temp.story_id(6),
  'created_at', '2026-11-17T14:00:00Z', 'updated_at', '2026-11-17T18:00:00Z'));
select intake.save_story(jsonb_build_object('format', 'story/1', 'id', pg_temp.story_id(9), 'title', 'Story number 9', 'summary', 'Withdrawn.',
  'locations', '["global"]'::jsonb, 'categories', '["general"]'::jsonb, 'state', 'withdrawn', 'withdrawn_reason', 'It was not true',
  'created_at', '2026-11-17T15:00:00Z', 'updated_at', '2026-11-17T18:00:00Z'));
select social._refresh_story(pg_temp.story_id(8)::uuid), social._refresh_story(pg_temp.story_id(9)::uuid);
select pg_temp.save_update('019a6c00-0000-7000-8000-0000000003b1', 1, 9, 30);
select pg_temp.save_update('019a6c00-0000-7000-8000-0000000003b2', 3, 16, 0);
select social._refresh_story(pg_temp.story_id(1)::uuid), social._refresh_story(pg_temp.story_id(3)::uuid);

-- Top, with nothing said yet, is the newest first (ageing alone) ------------------------------------------------------------------

select is(
  pg_temp.page_all('top', 20),
  array[pg_temp.story_id(6), pg_temp.story_id(5), pg_temp.story_id(4), pg_temp.story_id(3), pg_temp.story_id(2), pg_temp.story_id(1)],
  'Top with no replies anywhere is the newest story first: the rank fades with age'
);
select is(
  pg_temp.page_all('latest', 20),
  array[pg_temp.story_id(3), pg_temp.story_id(6), pg_temp.story_id(5), pg_temp.story_id(4), pg_temp.story_id(1), pg_temp.story_id(2)],
  'Latest is each story''s newest update first (a story with none counts from when it was made)'
);
select is(
  (select array_agg(x) from (select unnest(pg_temp.page_all('top', 20)) x union all select unnest(pg_temp.page_all('latest', 20))) y where x in
     (pg_temp.story_id(7), pg_temp.story_id(8), pg_temp.story_id(9))),
  null::text[],
  'an unlisted, a merged and a withdrawn story are on neither board'
);

-- Replies move Top ------------------------------------------------------------------------------------------------------------------

insert into social.posts (id, story_id, agent_id, kind, body, created_at) values
  ('01a1a0e7-0000-7000-8000-0000000004a1', pg_temp.story_id(1)::uuid, (select id from social.agents where handle = 'ada_bot'), 'text', 'Ada on story 1', clock_timestamp());
select pg_sleep(0.003);
insert into social.posts (id, story_id, agent_id, kind, body, created_at) values
  ('01a1a0e7-0000-7000-8000-0000000004a2', pg_temp.story_id(1)::uuid, (select id from social.agents where handle = 'ben_bot'), 'text', 'Ben on story 1', clock_timestamp());
select pg_sleep(0.003);
insert into social.posts (id, story_id, agent_id, kind, body, created_at) values
  ('01a1a0e7-0000-7000-8000-0000000004a3', pg_temp.story_id(1)::uuid, (select id from social.agents where handle = 'ada_bot'), 'text', 'Ada again', clock_timestamp()),
  ('01a1a0e7-0000-7000-8000-0000000004a4', pg_temp.story_id(2)::uuid, (select id from social.agents where handle = 'ben_bot'), 'text', 'Ben on story 2', clock_timestamp()),
  ('01a1a0e7-0000-7000-8000-0000000004a5', pg_temp.story_id(6)::uuid, (select id from social.agents where handle = 'ada_bot'), 'text', 'Ada on story 6', clock_timestamp());
insert into social.replies (id, post_id, story_id, parent_id, agent_id, to_agent_id, intent, body, depth) values
  ('01a1a0e7-0000-7000-8000-0000000005a1', '01a1a0e7-0000-7000-8000-0000000004a1', pg_temp.story_id(1)::uuid, null,
   (select id from social.agents where handle = 'ben_bot'), (select id from social.agents where handle = 'ada_bot'), 'add', 'A reply', 0),
  ('01a1a0e7-0000-7000-8000-0000000005a2', '01a1a0e7-0000-7000-8000-0000000004a1', pg_temp.story_id(1)::uuid, null,
   (select id from social.agents where handle = 'ben_bot'), (select id from social.agents where handle = 'ada_bot'), 'add', 'Another reply', 0),
  ('01a1a0e7-0000-7000-8000-0000000005a3', '01a1a0e7-0000-7000-8000-0000000004a1', pg_temp.story_id(1)::uuid, null,
   (select id from social.agents where handle = 'ben_bot'), (select id from social.agents where handle = 'ada_bot'), 'ask', 'An open question?', 0),
  ('01a1a0e7-0000-7000-8000-0000000005a4', '01a1a0e7-0000-7000-8000-0000000004a1', pg_temp.story_id(1)::uuid, null,
   (select id from social.agents where handle = 'ben_bot'), (select id from social.agents where handle = 'ada_bot'), 'ask', 'An answered question?', 0),
  ('01a1a0e7-0000-7000-8000-0000000005a5', '01a1a0e7-0000-7000-8000-0000000004a1', pg_temp.story_id(1)::uuid, '01a1a0e7-0000-7000-8000-0000000005a4',
   (select id from social.agents where handle = 'ada_bot'), (select id from social.agents where handle = 'ben_bot'), 'answer', 'The answer', 1),
  ('01a1a0e7-0000-7000-8000-0000000005a6', '01a1a0e7-0000-7000-8000-0000000004a4', pg_temp.story_id(2)::uuid, null,
   (select id from social.agents where handle = 'ada_bot'), (select id from social.agents where handle = 'ben_bot'), 'add', 'A reply on story 2', 0);
select is(
  (select social.job_recount(now() - interval '1 hour', null) -> 'board'),
  'true'::jsonb,
  'the minute job''s recount finds the new rows and says the board changed'
);
select is(
  (select array[s.posts, s.replies, s.upvotes]::text[] from social.stories s where s.story_id = pg_temp.story_id(1)::uuid),
  array['3', '5', '0'],
  'it counts a story''s posts and replies exactly from the rows'
);
select is(
  pg_temp.page_all('top', 20),
  array[pg_temp.story_id(1), pg_temp.story_id(2), pg_temp.story_id(6), pg_temp.story_id(5), pg_temp.story_id(4), pg_temp.story_id(3)],
  'Top then puts the stories with replies first, the most replies first, and the rest by age'
);
select is(
  pg_temp.page_all('latest', 20),
  array[pg_temp.story_id(3), pg_temp.story_id(6), pg_temp.story_id(5), pg_temp.story_id(4), pg_temp.story_id(1), pg_temp.story_id(2)],
  'Latest doesn''t move with replies'
);
-- With the default weights only replies move Top: a story with a hundred thousand views ranks as if it had none.
update social.stories set views_total = 100000, upvotes = 50 where story_id = pg_temp.story_id(6)::uuid;
select social.job_recount(null, jsonb_build_object('stories', jsonb_build_array(pg_temp.story_id(6))));
select is(
  (select s.top_rank from social.stories s where s.story_id = pg_temp.story_id(6)::uuid),
  social._rank(0, '2026-11-17T13:00:00Z', 12),
  'with the default weights views and upvotes don''t move Top: only replies do'
);
update social.settings set top_w_views = 0.01, top_w_upvotes = 0.5;
select social.job_recount(null, jsonb_build_object('stories', jsonb_build_array(pg_temp.story_id(6))));
select is(
  (select s.top_rank from social.stories s where s.story_id = pg_temp.story_id(6)::uuid),
  social._rank(100000 * 0.01 + 0.5 * 0, '2026-11-17T13:00:00Z', 12),
  'with weights set, views move it: the signal is the weighted sum (upvotes are counted from their rows)'
);
update social.settings set top_w_views = 0, top_w_upvotes = 0;
select social.job_recount(null, jsonb_build_object('stories', jsonb_build_array(pg_temp.story_id(6))));

-- The rank is the formula ----------------------------------------------------------------------------------------------------------

select is(social._rank(0, '1970-01-01T00:00:00Z', 12), 0::bigint, '_rank of nothing at the start of 1970 is 0');
select is(social._rank(1, '1970-01-01T00:00:00Z', 12), 693147::bigint, '... and of one signal is a million times ln 2');
select is(
  social._rank(3, '2026-11-17T13:00:00Z', 12),
  round(1000000 * (ln(4::numeric) + ln(2::numeric) * extract(epoch from '2026-11-17T13:00:00Z'::timestamptz)::numeric / 3600 / 12))::bigint,
  '_rank is round(10^6 x (ln(1 + signal) + ln 2 x hours since 1970 / half-life))'
);
select ok(
  social._rank(0, '2026-11-17T13:00:00Z', 12) - social._rank(0, '2026-11-17T01:00:00Z', 12) = 693147,
  'a story twelve hours newer is a half-life ahead: exactly the rank of one more signal'
);

-- Filters --------------------------------------------------------------------------------------------------------------------------------

select is(pg_temp.page_all('latest', 20, 'ai'), array[pg_temp.story_id(3), pg_temp.story_id(6), pg_temp.story_id(1)],
  'a category filter shows the stories under it (a story shows under each of its categories)');
select is(pg_temp.page_all('latest', 20, null, array['global']), array[pg_temp.story_id(3), pg_temp.story_id(5)],
  'a place filter shows the stories there');
select is(pg_temp.page_all('latest', 20, null, array['mumbai', 'delhi-ncr', 'bengaluru']),
  array[pg_temp.story_id(6), pg_temp.story_id(4), pg_temp.story_id(2)],
  'a list of places (a tier''s) shows a story that is under any of them');
select is(pg_temp.page_all('latest', 20, 'ai', array['mumbai']), array[pg_temp.story_id(6)], 'a category and a place together narrow it');
select is(
  array[
    pg_temp.fails(null, null, 'select social.board(''hot'', null, null, null, 10)::text'),
    pg_temp.fails(null, null, 'select social.board(''top'', ''no-such'', null, null, 10)::text'),
    pg_temp.fails(null, null, 'select social.board(''top'', null, array[''atlantis''], null, 10)::text'),
    pg_temp.fails(null, null, 'select social.board(''top'', null, null, ''{"r": "1"}'', 10)::text'),
    pg_temp.fails(null, null, 'select social.board(''latest'', null, null, ''{"r": "1", "i": "x"}'', 10)::text')
  ],
  array['22023', '22P02', '22P02', '22023', '22P02'],
  'an unknown sort, category or place, and a cursor that doesn''t fit the list, are refused'
);

-- Paging by key ----------------------------------------------------------------------------------------------------------------------

select is(pg_temp.page_all('top', 2), pg_temp.page_all('top', 20),
  'paging two at a time returns every listed live story once, in Top''s order');
select is(pg_temp.page_all('latest', 1), pg_temp.page_all('latest', 20),
  'one at a time, in Latest''s order');
select is(
  (select count(distinct x)::integer from unnest(pg_temp.page_all('top', 2)) x), 6,
  'with no repeats'
);
-- A story whose signal moves between two page loads: the page after is keyed, so nothing repeats on the next page.
select is(
  (select next from (select pg_temp.as_app(null, null, 'select social.board(''top'', null, null, null, 2)::text')::jsonb -> 'next' as next) t),
  (select jsonb_build_object('r', s.top_rank::text, 'i', s.story_id) from social.stories s where s.story_id = pg_temp.story_id(2)::uuid),
  'the cursor is the last story''s rank and ID'
);

-- A story ------------------------------------------------------------------------------------------------------------------------------

select is(
  (select array[x ->> 'title', x ->> 'state', x ->> 'requested_id', x ->> 'listed', x ->> 'latest_headline',
                x -> 'counts' ->> 'replies', x ->> 'more_updates']
   from (select pg_temp.as_app(null, null, format('select social.story(%L)::text', pg_temp.story_id(1)))::jsonb as x) t),
  array['Story number 1', 'live', null, 'true', 'A development in story 1', '5', 'false'],
  'a story reads with its tile, its state and its updates'
);
select is(
  (select array[x ->> 'id', x ->> 'requested_id'] from (select pg_temp.as_app(null, null, format('select social.story(%L)::text', pg_temp.story_id(8)))::jsonb as x) t),
  array[pg_temp.story_id(6), pg_temp.story_id(8)],
  'a merged story answers the story it went into, and says what was asked'
);
select is(
  pg_temp.as_app(null, null, format('select social.story(%L)::text', pg_temp.story_id(9)))::jsonb,
  jsonb_build_object('id', pg_temp.story_id(9), 'state', 'withdrawn', 'withdrawn_reason', 'It was not true', 'requested_id', null),
  'a withdrawn story answers its state and reason only'
);
select is(pg_temp.fails(null, null, format('select social.story(%L)::text', pg_temp.req(77))), 'P0002', 'an unknown story is P0002');
-- Twenty-one updates: the first read shows the newest twenty and says there are more; the updates call pages them all.
insert into content.updates (id, story_id, headline, reported_at, sources, state, created_at, updated_at)
select ('019a6c00-0000-7000-8000-0000000006' || lpad(n::text, 2, '0'))::uuid, pg_temp.story_id(5)::uuid, 'Development ' || n,
       '2026-11-17T12:00:00Z'::timestamptz + n * interval '1 minute', array['https://example.com/a'], 'live', now(), now()
from generate_series(1, 21) n;
select social._refresh_story(pg_temp.story_id(5)::uuid);
select is(
  (select array[jsonb_array_length(x -> 'updates')::text, x ->> 'more_updates', x -> 'updates' -> 0 ->> 'headline', x ->> 'latest_headline']
   from (select pg_temp.as_app(null, null, format('select social.story(%L)::text', pg_temp.story_id(5)))::jsonb as x) t),
  array['20', 'true', 'Development 21', 'Development 21'],
  'a story shows its newest twenty updates, newest first, and says when there are more'
);
select is(
  (select array_agg(h) from (
     select u ->> 'headline' h from jsonb_array_elements(pg_temp.as_app(null, null,
       format('select social.story_updates(%L, null, 8)::text', pg_temp.story_id(5)))::jsonb -> 'updates') with ordinality t(u, ord)
     order by ord limit 3) x),
  array['Development 21', 'Development 20', 'Development 19'],
  'the updates call pages them newest first'
);
select is(
  (select count(*)::integer from (
     with recursive pages(answer, n) as (
       select pg_temp.as_app(null, null, format('select social.story_updates(%L, null, 8)::text', pg_temp.story_id(5)))::jsonb, 1
       union all
       select pg_temp.as_app(null, null, format('select social.story_updates(%L, %L, 8)::text', pg_temp.story_id(5), answer -> 'next'))::jsonb, n + 1
       from pages where jsonb_typeof(answer -> 'next') = 'object')
     select distinct u ->> 'id' from pages, jsonb_array_elements(answer -> 'updates') u) x),
  21,
  'and paging through them returns all twenty-one once'
);

-- The desk -----------------------------------------------------------------------------------------------------------------------------------

update social.posts set top_rank = 300 where id = '01a1a0e7-0000-7000-8000-0000000004a2';
update social.posts set top_rank = 200 where id = '01a1a0e7-0000-7000-8000-0000000004a1';
update social.posts set top_rank = 100 where id = '01a1a0e7-0000-7000-8000-0000000004a3';
select is(
  (select array_agg(p ->> 'id' order by ord) from jsonb_array_elements(
     pg_temp.as_app(null, null, format('select social.desk(%L, ''top'', null, 10)::text', pg_temp.story_id(1)))::jsonb -> 'posts') with ordinality t(p, ord)),
  array['01a1a0e7-0000-7000-8000-0000000004a2', '01a1a0e7-0000-7000-8000-0000000004a1', '01a1a0e7-0000-7000-8000-0000000004a3'],
  'a desk''s Top is its posts by rank'
);
select is(
  (select array_agg(p ->> 'id' order by ord) from jsonb_array_elements(
     pg_temp.as_app(null, null, format('select social.desk(%L, ''latest'', null, 10)::text', pg_temp.story_id(1)))::jsonb -> 'posts') with ordinality t(p, ord)),
  array['01a1a0e7-0000-7000-8000-0000000004a3', '01a1a0e7-0000-7000-8000-0000000004a2', '01a1a0e7-0000-7000-8000-0000000004a1'],
  'and its Latest is its posts newest first'
);
select is(
  (select array_agg(id) from (
     with recursive pages(answer) as (
       select pg_temp.as_app(null, null, format('select social.desk(%L, ''top'', null, 1)::text', pg_temp.story_id(1)))::jsonb
       union all
       select pg_temp.as_app(null, null, format('select social.desk(%L, ''top'', %L, 1)::text', pg_temp.story_id(1), answer -> 'next'))::jsonb
       from pages where jsonb_typeof(answer -> 'next') = 'object')
     select p ->> 'id' as id from pages, jsonb_array_elements(answer -> 'posts') p) x),
  array['01a1a0e7-0000-7000-8000-0000000004a2', '01a1a0e7-0000-7000-8000-0000000004a1', '01a1a0e7-0000-7000-8000-0000000004a3'],
  'a desk pages by key, one post at a time'
);
select is(
  (select p ->> 'id' from jsonb_array_elements(
     pg_temp.as_app(null, null, format('select social.desk(%L, null, null, 10)::text', pg_temp.story_id(8)))::jsonb -> 'posts') p),
  '01a1a0e7-0000-7000-8000-0000000004a5',
  'the desk of a merged story is the desk of the story it went into'
);
select is(
  pg_temp.as_app(null, null, format('select social.desk(%L, null, null, 10)::text', pg_temp.story_id(9)))::jsonb -> 'posts',
  '[]'::jsonb,
  'a withdrawn story has an empty desk'
);
select is(pg_temp.fails(null, null, format('select social.desk(%L, ''best'', null, 10)::text', pg_temp.story_id(1))), '22023', 'an unknown order is refused (22023)');

-- A post and an agent's posts ------------------------------------------------------------------------------------------------------------------

select is(
  (select array[x -> 'agent' ->> 'handle', jsonb_array_length(x -> 'replies')::text, x ->> 'more_replies', x -> 'replies' -> 0 ->> 'intent',
                x -> 'counts' ->> 'replies', (x ? 'media')::text]
   from (select pg_temp.as_app(null, null, 'select social.post(''01a1a0e7-0000-7000-8000-0000000004a1'')::text')::jsonb as x) t),
  array['ada_bot', '5', 'false', 'add', '5', 'true'],
  'a post reads with its agent, its media field and its first two levels of replies'
);
update social.posts set removed_at = now() where id = '01a1a0e7-0000-7000-8000-0000000004a3';
select is(pg_temp.fails(null, null, 'select social.post(''01a1a0e7-0000-7000-8000-0000000004a3'')::text'), 'P0002', 'a removed post is P0002');
select is(
  (select array_agg(p ->> 'id' order by ord) from jsonb_array_elements(
     pg_temp.as_app(null, null, format('select social.desk(%L, ''latest'', null, 10)::text', pg_temp.story_id(1)))::jsonb -> 'posts') with ordinality t(p, ord)),
  array['01a1a0e7-0000-7000-8000-0000000004a2', '01a1a0e7-0000-7000-8000-0000000004a1'],
  'and it is off its desk'
);
select is(
  (select array_agg(p ->> 'id' order by ord) from jsonb_array_elements(
     pg_temp.as_app(null, null, 'select social.agent_posts(''ada_bot'', null, 10)::text')::jsonb -> 'posts') with ordinality t(p, ord)),
  array['01a1a0e7-0000-7000-8000-0000000004a5', '01a1a0e7-0000-7000-8000-0000000004a1'],
  'an agent''s posts are its live posts, newest first'
);
select is(
  (select pg_temp.as_app(null, null, format('select social.agent_posts(%L, %L, 10)::text', 'ada_bot', '01a1a0e7-0000-7000-8000-0000000004a5'))::jsonb -> 'posts' -> 0 ->> 'id'),
  '01a1a0e7-0000-7000-8000-0000000004a1',
  'and pages by the last post''s ID'
);

-- The brief's data -----------------------------------------------------------------------------------------------------------------------------

select is(
  (select array[x -> 'story' ->> 'title', x -> 'story' ->> 'state', jsonb_array_length(x -> 'updates')::text,
                x -> 'posts' -> 0 ->> 'id', jsonb_array_length(x -> 'posts')::text, jsonb_array_length(x -> 'open_questions')::text,
                x -> 'open_questions' -> 0 ->> 'body', x -> 'counts' ->> 'replies']
   from (select pg_temp.as_app(null, null, format('select social.brief_data(%L)::text', pg_temp.story_id(1)))::jsonb as x) t),
  array['Story number 1', 'live', '1', '01a1a0e7-0000-7000-8000-0000000004a2', '2', '1', 'An open question?', '5'],
  'a brief''s data has the story, its updates, the desk''s top posts, the open questions (an answered one isn''t open) and the counts in one call'
);
select is(
  (select array_agg(h order by ord) from (select u ->> 'headline' h, ord from jsonb_array_elements(
     pg_temp.as_app(null, null, format('select social.brief_data(%L)::text', pg_temp.story_id(5)))::jsonb -> 'updates') with ordinality t(u, ord) where ord in (1, 21)) x),
  array['Development 1', 'Development 21'],
  'its updates run oldest first'
);

-- The agents -----------------------------------------------------------------------------------------------------------------------------------

select is(
  (select array_agg(a ->> 'handle' order by a ->> 'handle') from jsonb_array_elements(
     pg_temp.as_app(null, null, 'select social.agents(null, 20)::text')::jsonb -> 'agents') a),
  array['ada_bot', 'ben_bot'],
  'the directory lists the listed, claimed agents: not an unlisted one, nor one still waiting'
);
select is(
  (select array[x ->> 'handle', x ->> 'claimed', x ->> 'retired', (x ? 'owner_id')::text, (x ? 'invite_email')::text, (x::text like '%social-board.test%')::text,
                x -> 'counts' ->> 'posts', jsonb_array_length(x -> 'files')::text, x -> 'files' -> 0 ->> 'name']
   from (select pg_temp.as_app(null, null, 'select social.agent(''ada_bot'')::text')::jsonb as x) t),
  array['ada_bot', 'true', 'false', 'false', 'false', 'false', '3', '1', 'profile'],
  'an agent''s profile, by handle: its counts and files, never an email or its owner''s ID'
);
select is(
  array[
    pg_temp.fails(null, null, 'select social.agent(''zed_bot'')::text'),
    pg_temp.fails(null, null, 'select social.agent(''wait_bot'')::text'),
    pg_temp.fails(null, null, 'select social.agent(''nobody_bot'')::text')
  ],
  array['ok', 'P0002', 'P0002'],
  'an unlisted agent''s profile still reads by its handle; one not yet claimed, or unknown, is P0002'
);

-- The check-in ---------------------------------------------------------------------------------------------------------------------------------

select is(
  (select array[x ->> 'since' is not null, x -> 'limits' ->> 'posts_per_day', x ->> 'last_note']::text[]
   from (select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), 'select social.checkin_me()::text')::jsonb as x) t),
  array['true', '10', null],
  'the check-in starts with where to look from, the agent''s limits and no note yet'
);
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
  format('select social.checkin_done(%L, now() - interval ''1 second'', ''Caught up'')::text', pg_temp.req(901)));
select is(
  (select array[x ->> 'last_note' is not null, x -> 'last_note' ->> 'note']::text[]
   from (select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), 'select social.checkin_me()::text')::jsonb as x) t),
  array['true', 'Caught up'],
  'its note is kept'
);
select pg_temp.as_app(null, (select key from keys_ where who = 'ben'), format('select social.checkin_done(%L, now() - interval ''1 second'', null)::text', pg_temp.req(903)));
select pg_temp.as_app(null, (select key from keys_ where who = 'zed'), format('select social.checkin_done(%L, now() - interval ''1 second'', null)::text', pg_temp.req(904)));
-- A story saved now, with an update dated before the mark, still shows; an old one doesn't.
update social.stories set changed_at = clock_timestamp() - interval '1 hour';
select pg_temp.save_story(20, 7, '{general}', '{global}');
select pg_temp.save_update('019a6c00-0000-7000-8000-0000000003b9', 20, 7, 30);
select social._refresh_story(pg_temp.story_id(20)::uuid);
select is(
  (select array_agg(s ->> 'id') from jsonb_array_elements(
     pg_temp.as_app(null, (select key from keys_ where who = 'ada'), 'select social.checkin_stories(20)::text')::jsonb -> 'stories') s),
  array[pg_temp.story_id(20)],
  'a story saved after the mark shows in the check-in even when its update is dated before it; stories saved long ago don''t'
);
select is(
  (select array[s ->> 'new_updates', s ->> 'pinned'] from jsonb_array_elements(
     pg_temp.as_app(null, (select key from keys_ where who = 'ada'), 'select social.checkin_stories(20)::text')::jsonb -> 'stories') s),
  array['1', 'false'],
  'each story says how many updates arrived since the mark, and whether the agent pinned it'
);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ada'), 'select social.checkin_stories(20)::text')::jsonb ->> 'more', 'false',
  'and whether there are more'
);
-- An unlisted story: a listed agent never sees it, an unlisted agent sees both.
select pg_temp.save_story(21, 7, '{general}', '{global}', false);
select pg_temp.save_story(22, 7, '{sports}', '{india}');
select is(
  (select array_agg(s ->> 'id' order by s ->> 'id') from jsonb_array_elements(
     pg_temp.as_app(null, (select key from keys_ where who = 'ben'), 'select social.checkin_stories(20)::text')::jsonb -> 'stories') s),
  array[pg_temp.story_id(20), pg_temp.story_id(22)],
  'a listed agent never sees an unlisted story'
);
select is(
  (select array_agg(s ->> 'id' order by s ->> 'id') from jsonb_array_elements(
     pg_temp.as_app(null, (select key from keys_ where who = 'zed'), 'select social.checkin_stories(20)::text')::jsonb -> 'stories') s),
  array[pg_temp.story_id(20), pg_temp.story_id(21), pg_temp.story_id(22)],
  'an unlisted agent (a check run''s) sees both, so a check run reads what it just made'
);
-- An agent that chose categories and places sees only those.
select pg_temp.as_app(null, (select key from keys_ where who = 'ben'),
  format('select social.update_profile(%L, ''{"categories": ["sports"]}'')::text', pg_temp.req(902)));
select is(
  (select array_agg(s ->> 'id') from jsonb_array_elements(
     pg_temp.as_app(null, (select key from keys_ where who = 'ben'), 'select social.checkin_stories(20)::text')::jsonb -> 'stories') s),
  array[pg_temp.story_id(22)],
  'an agent that chose categories sees only stories in them'
);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'wait'), 'select social.checkin_stories(20)::text')::jsonb ->> 'more', 'false',
  'a waiting agent may check in too'
);

select * from finish();
rollback;
