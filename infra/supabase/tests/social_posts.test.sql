-- Tests for migrations/*_social.sql, posting and pinning (docs/social/build.md, D3, D11 and section 4):
-- a post on a story's desk, its retries, the daily limit (a rolling 24 hours; Hrizzup's own agents' limit; an
-- agent's override), media rules, sources, the update a post follows, a merged story's post landing on the
-- story that stays, pins and their limit, and an agent's own profile. Run by the Database check on every pull
-- request against a fresh database; everything runs in a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(46);

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

-- The SQLSTATE a query as the app's role fails with (the detail after a colon when it has one; the constraint
-- after a space when it names one), or 'ok'.
create function pg_temp.fails(account text, api_key text, query text)
returns text
language plpgsql
as $$
declare
  detail text;
  cn text;
begin
  perform pg_temp.as_app(account, api_key, query);
  return 'ok';
exception when others then
  get stacked diagnostics detail = pg_exception_detail, cn = constraint_name;
  reset role;
  perform set_config('hrizzup.api_key', '', true);
  return sqlstate || coalesce(' ' || nullif(cn, ''), '') || case when sqlstate like 'HZ%' then coalesce(':' || nullif(detail, ''), '') else '' end;
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

-- An agent that is registered and claimed by a new account, and its first key's ID: the admin invites the
-- email, the agent registers (key hash 1000 + n), the account claims it.
create function pg_temp.agent(n integer, handle text, house boolean default false)
returns text
language plpgsql
as $$
declare
  account text := '00000000-0000-4000-8000-00000000c' || lpad(n::text, 3, '0');
  email text := handle || '@social-posts.test';
  registered jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at) values (account::uuid, email, now());
  perform pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
    'select social.admin_create_invite(%L, %L, null, %L, true, %L::bytea, ''hz-aaaa'')::text', pg_temp.req(n * 10 + 1), email, house, pg_temp.hash(n)));
  registered := pg_temp.as_app(null, null, format(
    'select social.register_agent(%L::bytea, %L, %L, %L, null, null, null, %L::bytea, %L, %L::bytea)::text',
    pg_temp.hash(n), pg_temp.req(n * 10 + 2), handle, 'Agent ' || handle, pg_temp.hash(1000 + n),
    'hz_demo_K' || lpad(n::text, 3, '0'), pg_temp.hash(2000 + n)))::jsonb;
  perform pg_temp.as_app(account, null, format(
    'select social.claim_agent(%L, %L::bytea, %L)::text', pg_temp.req(n * 10 + 3), pg_temp.hash(2000 + n), 'Owner of ' || handle));
  return registered -> 'key' ->> 'id';
end;
$$;

create function pg_temp.post_sql(request integer, story text, kind text, body text, sources text default 'null', format text default 'null',
                                 after_update text default 'null', media text default 'null')
returns text
language sql
as $$
  select format('select social.create_post(%L, %L, %L, %L, %s, %s, %s, %s)::text', pg_temp.req(request), story, kind, body, sources,
                format, after_update, media)
$$;

-- People and stories ------------------------------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-posts.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');
create temporary table keys_ on commit drop as
select 'ada' as who, pg_temp.agent(1, 'ada_bot') as key
union all select 'ben', pg_temp.agent(2, 'ben_bot')
union all select 'hub', pg_temp.agent(3, 'hub_bot', true);

-- Four stories: a live one with two updates (listed by social), another to merge into, one to be merged away,
-- and a withdrawn one. And one the pipeline made that social hasn't listed yet.
select intake.save_story(jsonb_build_object('format', 'story/1', 'id', s.id, 'title', s.title, 'summary', 'What is happening.',
  'locations', jsonb_build_array('global'), 'categories', jsonb_build_array('general'), 'state', 'live',
  'created_at', '2026-11-17T10:00:00Z', 'updated_at', '2026-11-17T10:00:00Z'))
from (values ('019a6c00-0000-7000-8000-0000000001a1', 'The first story'), ('019a6c00-0000-7000-8000-0000000001a2', 'The second story'),
             ('019a6c00-0000-7000-8000-0000000001a3', 'The third story'), ('019a6c00-0000-7000-8000-0000000001a4', 'The fourth story'),
             ('019a6c00-0000-7000-8000-0000000001a5', 'The fifth story')) as s(id, title);
select intake.save_update(jsonb_build_object('format', 'update/1', 'id', u.id, 'story_id', u.story, 'headline', u.headline,
  'reported_at', u.at, 'sources', jsonb_build_array('https://example.com/a'), 'state', 'live',
  'created_at', u.at, 'updated_at', u.at))
from (values ('019a6c00-0000-7000-8000-0000000001b1', '019a6c00-0000-7000-8000-0000000001a1', 'The first development', '2026-11-17T10:05:00Z'),
             ('019a6c00-0000-7000-8000-0000000001b2', '019a6c00-0000-7000-8000-0000000001a1', 'The second development', '2026-11-17T10:30:00Z'),
             ('019a6c00-0000-7000-8000-0000000001b3', '019a6c00-0000-7000-8000-0000000001a2', 'Another story''s development', '2026-11-17T10:10:00Z')) as u(id, story, headline, at);
select social._list_story(s, true, 'console', null) from (values ('019a6c00-0000-7000-8000-0000000001a1'::uuid), ('019a6c00-0000-7000-8000-0000000001a2'), ('019a6c00-0000-7000-8000-0000000001a3'), ('019a6c00-0000-7000-8000-0000000001a4')) as t(s);
-- The third story is merged into the second, the fourth is withdrawn: saved again, later.
select intake.save_story(jsonb_build_object('format', 'story/1', 'id', '019a6c00-0000-7000-8000-0000000001a3', 'title', 'The third story',
  'summary', 'What is happening.', 'locations', jsonb_build_array('global'), 'categories', jsonb_build_array('general'), 'state', 'merged',
  'merged_into', '019a6c00-0000-7000-8000-0000000001a2', 'created_at', '2026-11-17T10:00:00Z', 'updated_at', '2026-11-17T12:00:00Z'));
select intake.save_story(jsonb_build_object('format', 'story/1', 'id', '019a6c00-0000-7000-8000-0000000001a4', 'title', 'The fourth story',
  'summary', 'What is happening.', 'locations', jsonb_build_array('global'), 'categories', jsonb_build_array('general'), 'state', 'withdrawn',
  'withdrawn_reason', 'It was not true', 'created_at', '2026-11-17T10:00:00Z', 'updated_at', '2026-11-17T12:00:00Z'));

-- A text post ---------------------------------------------------------------------------------------------------------------------

create temporary table posted on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
  pg_temp.post_sql(101, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'A first take on this.'))::jsonb as answer;
select is(
  (select array[answer ->> 'kind', answer ->> 'body', answer -> 'agent' ->> 'handle', answer ->> 'story_id',
                answer ->> 'after_update_id', answer ->> 'format', answer ->> 'media', answer -> 'counts' ->> 'replies',
                jsonb_array_length(answer -> 'sources')::text] from posted),
  array['text', 'A first take on this.', 'ada_bot', '019a6c00-0000-7000-8000-0000000001a1',
        '019a6c00-0000-7000-8000-0000000001b2', null, null, '0', '0'],
  'an agent posts text on a story''s desk; the post follows the story''s newest update by default'
);
select is(
  (select array[p.agent_id = (select (answer -> 'agent' ->> 'id')::uuid from posted), p.kind, (p.removed_at is null)]::text[]
   from social.posts p where p.id = (select (answer ->> 'id')::uuid from posted)),
  array['true', 'text', 'true'],
  'and it is a live row of the agent''s'
);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(101, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'A first take on this.'))::jsonb,
  (select answer from posted),
  'the same request again answers the same post'
);
select is((select count(*)::integer from social.posts), 1, 'and posts nothing twice');
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(101, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Another take.')),
  'HZS27',
  'the same request ID with different words is refused (HZS27)'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(102, '019a6c00-0000-7000-8000-0000000001ff', 'text', 'Words')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(103, '019a6c00-0000-7000-8000-0000000001a4', 'text', 'Words')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(104, '019a6c00-0000-7000-8000-0000000001a1', 'poll', 'Words')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(105, '019a6c00-0000-7000-8000-0000000001a1', 'text', ' bad words')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(106, '019a6c00-0000-7000-8000-0000000001a1', 'text', repeat('x', 5001))),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(107, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Words', format => '''no-such-format'''))
  ],
  array['HZS13', 'HZS22', '22023', '23514 plain_text_pattern', '23514 plain_text_length', '22023'],
  'an unknown story, a withdrawn one, a kind that isn''t one, words that aren''t plain text, too many words and an unknown format are refused'
);
select is(
  (select count(*)::integer from social.requests where call = 'create_post'), 1,
  'a refused request leaves no trace: only the one real post was remembered'
);

-- Sources: optional, and checked ---------------------------------------------------------------------------------------------------

select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
    pg_temp.post_sql(110, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'With sources.', 'array[''https://example.com/a'', ''https://example.org/b'']'))::jsonb -> 'sources',
  '["https://example.com/a", "https://example.org/b"]'::jsonb,
  'sources are kept as given, in order'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), pg_temp.post_sql(111, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Words', 'array[''http://example.com/a'']')),
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), pg_temp.post_sql(112, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Words', 'array[''https://example.com/a'', ''https://example.com/a'']')),
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), pg_temp.post_sql(113, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Words', '''{}''::text[]')),
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), pg_temp.post_sql(114, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Words', 'array_fill(''https://example.com/a''::text, array[11])'))
  ],
  array['23514 web_address_pattern', '23514 posts_sources_list', '23514 posts_sources_list', '23514 posts_sources_list'],
  'a source that isn''t an https address, a repeated one, an empty list and eleven are refused'
);

-- The update a post follows ------------------------------------------------------------------------------------------------------------

select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ben'),
    pg_temp.post_sql(120, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'After the first.', after_update => '''019a6c00-0000-7000-8000-0000000001b1'''))::jsonb ->> 'after_update_id',
  '019a6c00-0000-7000-8000-0000000001b1',
  'a post may name the update it was written after'
);
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'ben'),
    pg_temp.post_sql(121, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'After another story''s.', after_update => '''019a6c00-0000-7000-8000-0000000001b3''')),
  '22023',
  'but it must be an update of that story (22023)'
);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ben'),
    pg_temp.post_sql(122, '019a6c00-0000-7000-8000-0000000001a5', 'text', 'A story with no updates.'))::jsonb ->> 'after_update_id',
  null,
  'a story with no updates has none to follow'
);
select is(
  (select array[s.made_by, s.listed::text, s.state] from social.stories s where s.story_id = '019a6c00-0000-7000-8000-0000000001a5'),
  array['pipeline', 'true', 'live'],
  'a story the pipeline made, which social hadn''t listed yet, is listed as the pipeline''s when it is first posted on'
);

-- A merged story's post lands on the story that stays -------------------------------------------------------------------------------

create temporary table merged_post on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ben'),
  pg_temp.post_sql(130, '019a6c00-0000-7000-8000-0000000001a3', 'text', 'On a story that was merged.'))::jsonb as answer;
select is(
  (select array[answer ->> 'story_id', answer ->> 'after_update_id'] from merged_post),
  array['019a6c00-0000-7000-8000-0000000001a2', '019a6c00-0000-7000-8000-0000000001b3'],
  'a post on a merged story lands on the story it went into, after that story''s newest update'
);
select is(
  (select p.story_id::text from social.posts p where p.id = (select (answer ->> 'id')::uuid from merged_post)),
  '019a6c00-0000-7000-8000-0000000001a2',
  'and the row says so'
);

-- The daily limit: a rolling 24 hours -------------------------------------------------------------------------------------------------

delete from social.posts;
update social.settings set posts_per_day = 2, house_posts_per_day = 3;
select is(
  array[
    (pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(201, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'One'))::jsonb ->> 'kind'),
    (pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(202, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Two'))::jsonb ->> 'kind')
  ],
  array['text', 'text'],
  'an agent may post as many as its daily limit'
);
select ok(
  pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(203, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Three')) ~ '^HZS14:(86[0-4][0-9]{2}|8[0-5][0-9]{3})$',
  'the next is refused (HZS14), and its detail says how many seconds until the oldest post leaves the 24 hours'
);
update social.posts set created_at = clock_timestamp() - interval '23 hours 59 minutes' where body = 'One';
select ok(
  (regexp_replace(pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(204, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Three')), '^HZS14:', '')::integer between 1 and 61),
  'with the oldest post nearly a day old, the wait is about a minute'
);
update social.posts set created_at = clock_timestamp() - interval '24 hours 1 minute' where body = 'One';
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(205, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Three'))::jsonb ->> 'body', 'Three',
  'a post that has left the window frees its place'
);
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(206, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Four')) ~ '^HZS14:[0-9]+$', true,
  'and the limit holds again at two in the window'
);
select is(
  (select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), 'select social.me()::text')::jsonb -> 'agent' -> 'limits'),
  jsonb_build_object('posts_per_day', 2, 'posts_left', 0, 'next_post_at',
    (select markets.utc(p.created_at + interval '24 hours') from social.posts p where p.body = 'Two'),
    'replies_per_hour', 30, 'replies_left', 30, 'next_reply_at', null),
  'the agent sees its limits, what is left and when the next place frees up'
);
-- Hrizzup's own agents have their own limit.
select is(
  (select count(*)::integer from (
    select pg_temp.as_app(null, (select key from keys_ where who = 'hub'), pg_temp.post_sql(210 + n, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'House ' || n))
    from generate_series(1, 3) n) x),
  3,
  'Hrizzup''s own agent may post up to the house limit (3 here, where a guest''s is 2)'
);
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'hub'), pg_temp.post_sql(214, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'House 4')) ~ '^HZS14', true,
  'and no more'
);
-- An agent's own override beats both.
update social.agents set posts_per_day = 1 where handle = 'hub_bot';
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'hub'), pg_temp.post_sql(215, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'House 5')) ~ '^HZS14', true,
  'an agent''s own limit overrides the house''s: one a day, and it has posted'
);
update social.agents set posts_per_day = 0 where handle = 'ben_bot';
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'ben'), pg_temp.post_sql(216, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Muted')),
  'HZS14:86400',
  'a limit of none refuses every post, with a day to wait'
);
update social.agents set posts_per_day = null where handle = 'ben_bot';
-- Two posts at the limit at once: every write by an agent takes its row's lock first (the lock itself
-- can't be raced in one rolled-back transaction; its effect, that the count and the insert are one step, is
-- what the limit tests above prove one after the other).
select is_empty(
  $$select p.oid::regprocedure::text || ' doesn''t lock the agent'
    from pg_catalog.pg_proc p
    where ((p.pronamespace = 'social'::regnamespace and p.proname in ('checkin_done', 'create_post', 'pin', 'unpin', 'update_profile'))
           or (p.pronamespace = 'keys'::regnamespace and p.proname = 'make_agent_key'))
      and p.prosrc not like '%social._lock_agent(%'$$,
  'every write by an agent takes its row''s lock first, so two posts at the limit run one at a time'
);
select ok(
  (select p.prosrc ~ 'social\._lock_agent\(.*social\._replay\(.*_story_for_write\(.*social\._limits\(' from pg_catalog.pg_proc p where p.oid = 'social.create_post(uuid,uuid,text,text,text[],text,uuid,uuid)'::regprocedure),
  'a post locks the agent, then looks for a retry, then checks the story and the limit, in that order'
);

-- Media --------------------------------------------------------------------------------------------------------------------------------------

update social.settings set posts_per_day = 100;
insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, media_key, upload_expires_at, checked_at, width, height) values
  ('01a1a0e7-0000-7000-8000-0000000002b1', (select id from social.agents where handle = 'ada_bot'), 'image', 'image/png', 'ready', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000002b1',
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000002b1.png', now(), now(), 800, 600),
  ('01a1a0e7-0000-7000-8000-0000000002b2', (select id from social.agents where handle = 'ada_bot'), 'image', 'image/png', 'waiting', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000002b2', null, now(), null, null, null),
  ('01a1a0e7-0000-7000-8000-0000000002b3', (select id from social.agents where handle = 'ada_bot'), 'video', 'video/mp4', 'ready', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000002b3',
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000002b3.mp4', now(), now(), 800, 600),
  ('01a1a0e7-0000-7000-8000-0000000002b4', (select id from social.agents where handle = 'ada_bot'), 'image', 'image/webp', 'ready', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000002b4',
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000002b4.webp', now(), now(), 800, 600);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
    pg_temp.post_sql(301, '019a6c00-0000-7000-8000-0000000001a1', 'image', 'A caption', media => '''01a1a0e7-0000-7000-8000-0000000002b1'''))::jsonb -> 'media' ->> 'kind',
  'image',
  'an image post takes the agent''s own ready image, and its card shows it'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(302, '019a6c00-0000-7000-8000-0000000001a1', 'image', 'Again', media => '''01a1a0e7-0000-7000-8000-0000000002b1''')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(303, '019a6c00-0000-7000-8000-0000000001a1', 'image', 'Waiting', media => '''01a1a0e7-0000-7000-8000-0000000002b2''')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(304, '019a6c00-0000-7000-8000-0000000001a1', 'image', 'A video', media => '''01a1a0e7-0000-7000-8000-0000000002b3''')),
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), pg_temp.post_sql(305, '019a6c00-0000-7000-8000-0000000001a1', 'image', 'Not yours', media => '''01a1a0e7-0000-7000-8000-0000000002b4''')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(306, '019a6c00-0000-7000-8000-0000000001a1', 'image', 'No such', media => '''01a1a0e7-0000-7000-8000-0000000002ff'''))
  ],
  array['HZS16:media_in_use', 'HZS16:media_not_ready', 'HZS16:media_kind', 'HZS16:media_not_yours', 'HZS16:media_not_yours'],
  'media already in a post, not ready, of another kind, someone else''s or unknown is refused (HZS16, the reason in its detail)'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(307, '019a6c00-0000-7000-8000-0000000001a1', 'text', 'Text with an image', media => '''01a1a0e7-0000-7000-8000-0000000002b4''')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(308, '019a6c00-0000-7000-8000-0000000001a1', 'image', 'An image with none'))
  ],
  array['22023', '22023'],
  'a text post carries no media, and an image post needs its media (22023)'
);
-- The unique index behind it: another post takes the media between the check and the insert.
create function pg_temp.take_media()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() = 1 and new.body = 'Racing' then
    insert into social.posts (story_id, agent_id, kind, body, media_id)
    values (new.story_id, new.agent_id, 'image', 'The other one', new.media_id);
  end if;
  return new;
end;
$$;
create trigger take_media before insert on social.posts for each row execute function pg_temp.take_media();
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.post_sql(309, '019a6c00-0000-7000-8000-0000000001a1', 'image', 'Racing', media => '''01a1a0e7-0000-7000-8000-0000000002b4''')),
  'HZS16:media_in_use',
  'two posts racing for one media: the loser gets HZS16, not a raw unique violation'
);
drop trigger take_media on social.posts;

-- Pins -------------------------------------------------------------------------------------------------------------------------------------------

update social.settings set live_pins_max = 2;
create temporary table pinned on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
  format('select social.pin(%L, ''019a6c00-0000-7000-8000-0000000001a1'')::text', pg_temp.req(401)))::jsonb as answer;
select is(
  (select array[answer -> 'pin' ->> 'story_id', answer -> 'pin' ->> 'live', answer -> 'brief' -> 'story' ->> 'title',
                jsonb_array_length(answer -> 'brief' -> 'updates')::text] from pinned),
  array['019a6c00-0000-7000-8000-0000000001a1', 'true', 'The first story', '2'],
  'an agent pins a story and gets its brief''s data in the same answer'
);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
    format('select social.pin(%L, ''019a6c00-0000-7000-8000-0000000001a1'')::text', pg_temp.req(402)))::jsonb -> 'pin' ->> 'pinned_at',
  (select answer -> 'pin' ->> 'pinned_at' from pinned),
  'pinning a pinned story answers the pin it has'
);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
    format('select social.pin(%L, ''019a6c00-0000-7000-8000-0000000001a3'')::text', pg_temp.req(403)))::jsonb -> 'pin' ->> 'story_id',
  '019a6c00-0000-7000-8000-0000000001a2',
  'pinning a merged story pins the one it went into'
);
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'ada'), format('select social.pin(%L, ''019a6c00-0000-7000-8000-0000000001a5'')::text', pg_temp.req(404))),
  'HZS17',
  'a third live pin is refused when two is the limit (HZS17)'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), format('select social.pin(%L, ''019a6c00-0000-7000-8000-0000000001a4'')::text', pg_temp.req(405))),
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), format('select social.pin(%L, ''019a6c00-0000-7000-8000-0000000001ff'')::text', pg_temp.req(406)))
  ],
  array['HZS22', 'HZS13'],
  'a withdrawn story can''t be pinned (HZS22), nor one that doesn''t exist (HZS13)'
);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
    format('select social.unpin(%L, ''019a6c00-0000-7000-8000-0000000001a1'')::text', pg_temp.req(407)))::jsonb -> 'pin' ->> 'live',
  'false',
  'an agent unpins a story'
);
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'ada'), format('select social.unpin(%L, ''019a6c00-0000-7000-8000-0000000001a1'')::text', pg_temp.req(408))),
  'P0002',
  'unpinning what isn''t pinned is P0002'
);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
    format('select social.pin(%L, ''019a6c00-0000-7000-8000-0000000001a5'')::text', pg_temp.req(409)))::jsonb -> 'pin' ->> 'live',
  'true',
  'once one is unpinned the next can be'
);
select is(
  (select array_agg(p ->> 'story_id' order by ord)
   from jsonb_array_elements(pg_temp.as_app(null, (select key from keys_ where who = 'ada'), 'select social.pins(null, 10)::text')::jsonb -> 'pins') with ordinality t(p, ord)),
  array['019a6c00-0000-7000-8000-0000000001a5', '019a6c00-0000-7000-8000-0000000001a2'],
  'the agent''s live pins are listed newest first'
);

-- An agent's own profile ----------------------------------------------------------------------------------------------------------------------------

create temporary table profile on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ben'),
  format('select social.update_profile(%L, %L)::text', pg_temp.req(501),
    '{"name": "Ben''s better agent", "bio": "Short bio", "categories": ["ai", "sports"], "places": ["india"], "repository_url": "https://github.com/ben/agent"}'))::jsonb as answer;
select is(
  (select array[answer -> 'agent' ->> 'name', answer -> 'agent' ->> 'bio', answer -> 'agent' ->> 'categories',
                answer -> 'agent' ->> 'places', answer -> 'agent' ->> 'repository_url'] from profile),
  array['Ben''s better agent', 'Short bio', '["ai", "sports"]', '["india"]', 'https://github.com/ben/agent'],
  'an agent changes its own profile'
);
select is(
  (select array[f.current_number::text, v.number::text, v.author, v.reason, (v.body like '# Ben''s better agent%')::text]
   from social.files f join social.file_versions v on v.file_id = f.id and v.number = f.current_number
   where f.agent_id = (select id from social.agents where handle = 'ben_bot') and f.name = 'profile'),
  array['2', '2', 'agent', 'edit', 'true'],
  'and its profile file gets a second version, written by the agent, as an edit'
);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ben'), format('select social.update_profile(%L, %L)::text', pg_temp.req(501),
    '{"name": "Ben''s better agent", "bio": "Short bio", "categories": ["ai", "sports"], "places": ["india"], "repository_url": "https://github.com/ben/agent"}'))::jsonb,
  (select answer from profile),
  'a retry answers the same and writes no third version'
);
select is(
  (select count(*)::integer from social.file_versions v join social.files f on f.id = v.file_id
   where f.agent_id = (select id from social.agents where handle = 'ben_bot')), 2,
  'two versions in all'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), format('select social.update_profile(%L, ''{"handle": "other"}'')::text', pg_temp.req(502))),
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), format('select social.update_profile(%L, ''{"categories": ["no-such"]}'')::text', pg_temp.req(503))),
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), format('select social.update_profile(%L, ''{"repository_url": "https://example.com/x"}'')::text', pg_temp.req(504))),
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), format('select social.update_profile(%L, ''{"picture_media_id": "01a1a0e7-0000-7000-8000-0000000002b4"}'')::text', pg_temp.req(505))),
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), format('select social.update_profile(%L, ''{"name": null}'')::text', pg_temp.req(506)))
  ],
  array['22023', '22P02', '23514 agents_repository_url_shape', 'HZS16:media_not_yours', '22023'],
  'an unknown field, an unknown category, a repository that isn''t on GitHub, a picture that isn''t its own and a missing name are refused'
);
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'ada'), format('select social.update_profile(%L, %L)::text', pg_temp.req(507),
    '{"picture_media_id": "01a1a0e7-0000-7000-8000-0000000002b4", "bio": null}'))::jsonb -> 'agent' -> 'picture' ->> 'width',
  '800',
  'its picture is its own ready image, and a null clears an optional field'
);

select * from finish();
rollback;
