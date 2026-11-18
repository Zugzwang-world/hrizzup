-- Tests for migrations/*_social_media.sql, uploads and pictures (Round 6, R8, M1; docs/social/media-design.md,
-- sections 3, 5.1, 10 and 11.1): an upload's link and its daily cap, "say it's done" in two short transactions
-- (the lease, the token, ready, refused, released, a retry), the guard on media rows (fixed fields, settled
-- rows, a video's still, and the daily tidy meeting a lease a dead check left), a post carrying a made-ready
-- video, a story's picture and where it shows, the format guide, an agent's video as a media, and the byte
-- limits written twice. Run by the Database check on every pull request against a fresh database; everything
-- runs in a transaction that is rolled back. Every key, hash and placeholder here is made-up and low-entropy.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(48);

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

-- The SQLSTATE a query as the app's role fails with (the detail after a colon when it is one of ours; the
-- constraint after a space when it names one), or 'ok'.
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

-- The hint a failing query carries (the seconds an upload's refusal says to wait), or null.
create function pg_temp.hint_of(account text, api_key text, query text)
returns text
language plpgsql
as $$
declare
  hint text;
begin
  perform pg_temp.as_app(account, api_key, query);
  return null;
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  reset role;
  perform set_config('hrizzup.api_key', '', true);
  return hint;
end;
$$;

-- What an owner-run query fails with (its SQLSTATE and the constraint it names), or 'ok'.
create function pg_temp.owner_refusal(query text)
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
  return sqlstate || coalesce(' ' || nullif(cn, ''), '');
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

-- An agent that is registered (and claimed unless `claim` is false) by a new account, and its first key's ID.
create function pg_temp.agent(n integer, handle text, house boolean default false, claim boolean default true)
returns text
language plpgsql
as $$
declare
  account text := '00000000-0000-4000-8000-00000000c' || lpad(n::text, 3, '0');
  email text := handle || '@social-media.test';
  registered jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at) values (account::uuid, email, now());
  perform pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
    'select social.admin_create_invite(%L, %L, null, %L, true, %L::bytea, ''hz-aaaa'')::text', pg_temp.req(n * 10 + 1), email, house, pg_temp.hash(n)));
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

-- A handle's agent ID, and the media ID with a given last part.
create function pg_temp.agent_id(handle text)
returns uuid
language sql
as $$ select id from social.agents where social.agents.handle = agent_id.handle $$;

create function pg_temp.mid(n text)
returns uuid
language sql
as $$ select ('01a1a0e7-0000-7000-8000-0000000003' || n)::uuid $$;

-- A ready media row of an agent, made as the owner (inserts aren't guarded; functions only make waiting rows).
create function pg_temp.ready_media(id uuid, handle text, kind text, ext text, w integer, h integer, ms integer, still uuid)
returns void
language sql
as $$
  insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, media_key, upload_expires_at,
                            checked_at, width, height, duration_ms, still_media_id, placeholder, description)
  select ready_media.id, a.id, ready_media.kind,
         case ready_media.ext when 'png' then 'image/png' when 'mp4' then 'video/mp4' else 'audio/mpeg' end,
         'ready', 1000, 'social/' || a.id || '/' || ready_media.id,
         'social/' || a.id || '/' || ready_media.id || '.' || ready_media.ext, now() + interval '1 hour', now(),
         ready_media.w, ready_media.h, ready_media.ms, ready_media.still,
         case when ready_media.kind = 'audio' then null else 'AAAAAAAAAAAAAAAAAAAA' end,
         case when ready_media.kind = 'image' then 'A test picture' end
  from social.agents a where a.handle = ready_media.handle
$$;

-- `n` waiting images of an agent, each made `age` ago (the agent's daily upload window counts them), as the owner.
create function pg_temp.fill(handle text, n integer, age interval)
returns void
language plpgsql
as $$
declare
  new_id uuid;
begin
  for i in 1..n loop
    new_id := social._uuid7();
    insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at, created_at)
    select new_id, a.id, 'image', 'image/png', 'waiting', 1000, 'social/' || a.id || '/' || new_id,
           clock_timestamp() + interval '1 hour', clock_timestamp() - age
    from social.agents a where a.handle = fill.handle;
  end loop;
end;
$$;

-- An upload's link as an agent's call; the media ID it answers.
create function pg_temp.upload_sql(request integer, kind text, content_type text, bytes text)
returns text
language sql
as $$ select format('select social.upload_create(%L, %L, %L, %L)::text', pg_temp.req(request), kind, content_type, bytes) $$;

create function pg_temp.new_upload(api_key text, request integer, kind text, content_type text, bytes text default '1000')
returns uuid
language sql
as $$ select (pg_temp.as_app(null, api_key, pg_temp.upload_sql(request, kind, content_type, bytes))::jsonb -> 'media' ->> 'id')::uuid $$;

-- "Say it's done", first transaction, as an agent's call.
create function pg_temp.begin_sql(request integer, media uuid, description text default null, transcript text default null, still text default null)
returns text
language sql
as $$ select format('select social.upload_begin(%L, %L, %L, %L, %L)::text', pg_temp.req(request), media, description, transcript, still) $$;

-- The second transaction, with the outcome as jsonb text.
create function pg_temp.finish_sql(request integer, media uuid, token text, outcome text)
returns text
language sql
as $$ select format('select social.upload_finish(%L, %L, %L, %L::jsonb)::text', pg_temp.req(request), media, token, outcome) $$;

-- The key an upload's check must come back with.
create function pg_temp.key_of(media uuid)
returns text
language sql
as $$ select 'social/' || m.agent_id || '/' || m.id || '.' || case m.content_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg'
                                                                                    when 'video/mp4' then 'mp4' else 'mp3' end
      from social.media m where m.id = key_of.media $$;

-- People and a story -----------------------------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-media.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');
update social.settings set posts_per_day = 100;
create temporary table keys_ on commit drop as
select 'ada' as who, pg_temp.agent(1, 'ada_bot') as key
union all select 'ben', pg_temp.agent(2, 'ben_bot')
union all select 'hub', pg_temp.agent(3, 'hub_bot', true)
union all select 'cap', pg_temp.agent(4, 'cap_bot')
union all select 'win', pg_temp.agent(5, 'win_bot')
union all select 'new', pg_temp.agent(6, 'new_bot', false, false);
update social.agents set posts_per_day = 10 where handle in ('cap_bot', 'win_bot');
insert into keys.api_keys (id, user_id, name, scope, secret_hash, shown) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000c001', 'A trading key', 'trade', '\x0000000000000000000000000000000000000000000000000000000000009999', 'hz_demo_T001');

select intake.save_story(jsonb_build_object('format', 'story/1', 'id', '019a6c00-0000-7000-8000-0000000001a1', 'title', 'The first story',
  'summary', 'What is happening.', 'locations', jsonb_build_array('global'), 'categories', jsonb_build_array('general'), 'state', 'live',
  'created_at', '2026-11-17T10:00:00Z', 'updated_at', '2026-11-17T10:00:00Z'));
select intake.save_update(jsonb_build_object('format', 'update/1', 'id', '019a6c00-0000-7000-8000-0000000001b1',
  'story_id', '019a6c00-0000-7000-8000-0000000001a1', 'headline', 'The first development', 'reported_at', '2026-11-17T10:05:00Z',
  'sources', jsonb_build_array('https://example.com/a'), 'state', 'live', 'created_at', '2026-11-17T10:05:00Z', 'updated_at', '2026-11-17T10:05:00Z'));
select social._list_story('019a6c00-0000-7000-8000-0000000001a1', true, 'console', null);

-- Ready media made as the owner: Ada's image (a still), Ben's image, Ada's video and her audio; and a waiting image of hers.
select pg_temp.ready_media(pg_temp.mid('a1'), 'ada_bot', 'image', 'png', 800, 600, null, null);
select pg_temp.ready_media(pg_temp.mid('b1'), 'ben_bot', 'image', 'png', 400, 300, null, null);
select pg_temp.ready_media(pg_temp.mid('d1'), 'ada_bot', 'video', 'mp4', 1280, 720, 5000, null);
select pg_temp.ready_media(pg_temp.mid('f1'), 'ada_bot', 'audio', 'mp3', null, null, 5000, null);
insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at)
select pg_temp.mid('c1'), a.id, 'image', 'image/png', 'waiting', 1000, 'social/' || a.id || '/' || pg_temp.mid('c1'), now() + interval '1 hour'
from social.agents a where a.handle = 'ada_bot';

-- upload_create ----------------------------------------------------------------------------------------------------------------

create temporary table first_upload on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(101, 'image', 'image/png', '1000'))::jsonb as answer;
select is(
  (select array[answer -> 'media' ->> 'kind', answer -> 'media' ->> 'state', answer ->> 'content_type', answer ->> 'bytes',
                (answer ->> 'upload_key' = 'social/' || pg_temp.agent_id('ada_bot') || '/' || (answer -> 'media' ->> 'id'))::text,
                ((answer ->> 'expires_at')::timestamptz between clock_timestamp() + interval '9 minutes' and clock_timestamp() + interval '10 minutes')::text]
   from first_upload),
  array['image', 'waiting', 'image/png', '1000', 'true', 'true'],
  'an agent asks for an upload link: a waiting media with its key (the agent''s, then its own ID) and ten minutes to be filled'
);
select is(
  (select array[m.state, (m.uploaded_by_admin is null)::text, (m.check_token is null)::text, (m.media_key is null)::text,
                (m.agent_id = pg_temp.agent_id('ada_bot'))::text]
   from social.media m where m.id = (select (answer -> 'media' ->> 'id')::uuid from first_upload)),
  array['waiting', 'true', 'true', 'true', 'true'],
  'and it is a waiting row of the agent''s, started by the agent, with no lease and no file yet'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'new'), pg_temp.upload_sql(102, 'image', 'image/png', '1000')),
    pg_temp.fails(null, '00000000-0000-4000-8000-0000000000f1', pg_temp.upload_sql(103, 'image', 'image/png', '1000')),
    pg_temp.fails(null, null, pg_temp.upload_sql(104, 'image', 'image/png', '1000'))
  ],
  array['HZS01', '42501', '42501'],
  'an agent not yet claimed (HZS01), a trading key and no key at all (42501) can''t ask for one'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(110, 'image', 'video/mp4', '1000')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(111, 'video', 'image/png', '1000')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(112, 'audio', 'audio/ogg', '1000')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(113, 'document', 'image/png', '1000')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(114, 'image', 'image/png', '0')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(115, 'image', 'image/png', null))
  ],
  array['HZS16:media_kind', 'HZS16:media_kind', 'HZS16:media_kind', '22023', '22023', '22023'],
  'a type that isn''t the kind''s is HZS16 (media_kind); a kind that isn''t one, no bytes and no size are 22023'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(120, 'image', 'image/png', '10485761')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(121, 'video', 'video/mp4', '104857601')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(122, 'audio', 'audio/mpeg', '20971521')),
    (pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(123, 'image', 'image/png', '10485760'))::jsonb -> 'media' ->> 'kind'),
    (pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(124, 'video', 'video/mp4', '104857600'))::jsonb -> 'media' ->> 'kind'),
    (pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(125, 'audio', 'audio/mp4', '20971520'))::jsonb -> 'media' ->> 'kind')
  ],
  array['HZS16:media_too_big', 'HZS16:media_too_big', 'HZS16:media_too_big', 'image', 'video', 'audio'],
  'a file one byte over its kind''s limit is HZS16 (media_too_big), per kind; the exact limit passes'
);
update social.media set upload_expires_at = now() + interval '1 minute'
where id = (select (answer -> 'media' ->> 'id')::uuid from first_upload);
create temporary table uploads_before on commit drop as
select count(*) as n from social.media where agent_id = pg_temp.agent_id('ada_bot');
create temporary table replayed on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(101, 'image', 'image/png', '1000'))::jsonb as r;
select is(
  (select array[(r -> 'media' ->> 'id') = (select answer -> 'media' ->> 'id' from first_upload),
                ((r ->> 'expires_at')::timestamptz > clock_timestamp() + interval '9 minutes'),
                ((select count(*) from social.media where agent_id = pg_temp.agent_id('ada_bot')) = (select n from uploads_before))]::text[]
   from replayed),
  array['true', 'true', 'true'],
  'a retry answers the same media and, while it waits, moves its time to ten minutes from now; it makes no second one'
);
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.upload_sql(101, 'image', 'image/png', '2000')),
  'HZS27',
  'another input under the same request ID is refused (HZS27)'
);

-- The day's cap on uploads: four times the agent's posts a day, at least ten ----------------------------------------------------

select pg_temp.fill('cap_bot', 39, interval '0');
select pg_temp.fill('cap_bot', 5, interval '25 hours');
select is(
  pg_temp.as_app(null, (select key from keys_ where who = 'cap'), pg_temp.upload_sql(201, 'image', 'image/png', '1000'))::jsonb -> 'media' ->> 'state',
  'waiting',
  'with ten posts a day an agent may start 40 uploads in 24 hours: the 40th (39 now, and 5 more than a day old, which don''t count) passes'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'cap'), pg_temp.upload_sql(202, 'image', 'image/png', '1000')),
    (pg_temp.hint_of(null, (select key from keys_ where who = 'cap'), pg_temp.upload_sql(202, 'image', 'image/png', '1000'))::integer between 86000 and 86400)::text
  ],
  array['HZS16:uploads_per_day', 'true'],
  'the 41st is HZS16 (uploads_per_day), and the hint says how many seconds until the oldest leaves the 24 hours'
);
update social.agents set posts_per_day = 20 where handle = 'cap_bot';
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'cap'), pg_temp.upload_sql(203, 'image', 'image/png', '1000')),
  'ok',
  'the agent''s own posts_per_day moves the cap (20 a day: 80 uploads)'
);
update social.agents set posts_per_day = null, house = true where handle = 'cap_bot';
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'cap'), pg_temp.upload_sql(204, 'image', 'image/png', '1000')),
  'ok',
  'and so does Hrizzup''s own mark (the house''s 50 posts a day: 200 uploads)'
);
update social.settings set house_posts_per_day = 1;
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'cap'), pg_temp.upload_sql(205, 'image', 'image/png', '1000')),
  'HZS16:uploads_per_day',
  'and the house''s setting is what it is moved by (1 a day: ten uploads, at least)'
);
update social.settings set house_posts_per_day = 50;
select pg_temp.fill('win_bot', 1, interval '23 hours 59 minutes');
select pg_temp.fill('win_bot', 39, interval '0');
select ok(
  pg_temp.hint_of(null, (select key from keys_ where who = 'win'), pg_temp.upload_sql(206, 'image', 'image/png', '1000'))::integer between 1 and 61,
  'with the oldest upload nearly a day old, the wait is about a minute'
);

-- upload_begin ---------------------------------------------------------------------------------------------------------------------

create temporary table ups on commit drop as
select 'img' as label, pg_temp.new_upload((select key from keys_ where who = 'ada'), 301, 'image', 'image/png') as id
union all select 'vid', pg_temp.new_upload((select key from keys_ where who = 'ada'), 302, 'video', 'video/mp4', '5000')
union all select 'img2', pg_temp.new_upload((select key from keys_ where who = 'ada'), 303, 'image', 'image/png')
union all select 'img3', pg_temp.new_upload((select key from keys_ where who = 'ada'), 304, 'image', 'image/png')
union all select 'img4', pg_temp.new_upload((select key from keys_ where who = 'ada'), 305, 'image', 'image/png')
union all select 'vid2', pg_temp.new_upload((select key from keys_ where who = 'ada'), 306, 'video', 'video/mp4', '5000');
insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at, uploaded_by_admin)
select pg_temp.mid('e1'), a.id, 'image', 'image/png', 'waiting', 1000, 'social/' || a.id || '/' || pg_temp.mid('e1'), now() + interval '1 hour',
       '00000000-0000-4000-8000-00000000d0a1'
from social.agents a where a.handle = 'ada_bot';
create function pg_temp.up(label text) returns uuid language sql as $$ select id from ups where ups.label = up.label $$;

select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), pg_temp.begin_sql(401, pg_temp.up('img'), 'A picture')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(402, pg_temp.mid('e1'), 'A picture')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(403, '01a1a0e7-0000-7000-8000-0000000003ff', 'A picture'))
  ],
  array['P0002', 'P0002', 'P0002'],
  'someone else''s upload, an upload the console started and one that isn''t is P0002 to an agent: no such upload'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(404, pg_temp.up('img'), 'A picture', 'A transcript')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(405, pg_temp.up('img'), 'A picture', null, pg_temp.mid('a1')::text)),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(406, pg_temp.up('img'), repeat('x', 1001))),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(407, pg_temp.up('img'), ' A leading space')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(408, pg_temp.up('vid'), null, repeat('x', 20001), pg_temp.mid('a1')::text))
  ],
  array['22023', '22023', '22023', '23514 plain_text_pattern', '22023'],
  'a transcript or a still for an image, a description over 1,000 characters and a transcript over 20,000 are 22023; a description that isn''t plain text names its rule (23514)'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(410, pg_temp.up('vid'), null, 'A transcript')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(411, pg_temp.up('vid'), null, 'A transcript', pg_temp.mid('b1')::text)),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(412, pg_temp.up('vid'), null, 'A transcript', pg_temp.mid('c1')::text)),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(413, pg_temp.up('vid'), null, 'A transcript', pg_temp.mid('d1')::text))
  ],
  array['HZS16:still_needed', 'HZS16:still_not_ready', 'HZS16:still_not_ready', 'HZS16:still_not_ready'],
  'a video with no still is HZS16 (still_needed); another agent''s image, a waiting one and a video as its still are HZS16 (still_not_ready)'
);
select is(
  (select count(*)::integer from social.media where check_token is not null), 0,
  'and a refused begin takes no lease'
);
create temporary table begun on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(420, pg_temp.up('vid'), null, 'What is said in it', pg_temp.mid('a1')::text))::jsonb as answer;
select is(
  (select array[answer ->> 'step', (answer ->> 'token')::uuid::text = (select check_token::text from social.media where id = pg_temp.up('vid')),
                (answer -> 'upload' ->> 'media_key') = pg_temp.key_of(pg_temp.up('vid')),
                (answer -> 'upload' ->> 'upload_key') = (select upload_key from social.media where id = pg_temp.up('vid')),
                (answer -> 'upload' ->> 'kind'), (answer -> 'upload' ->> 'bytes'),
                ((select check_until from social.media where id = pg_temp.up('vid')) between clock_timestamp() + interval '1 minute' and clock_timestamp() + interval '2 minutes')::text,
                (select state from social.media where id = pg_temp.up('vid'))]::text[]
   from begun),
  array['check', 'true', 'true', 'true', 'video', '5000', 'true', 'waiting'],
  'a good begin answers check with a token and what to check, and takes a lease of two minutes under that token'
);
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(421, pg_temp.up('vid'), null, 'What is said in it', pg_temp.mid('a1')::text)),
  'HZS28:media_checking',
  'a second begin while the lease holds is HZS28 (media_checking)'
);
update social.media set check_until = clock_timestamp() - interval '1 second' where id = pg_temp.up('vid');
create temporary table begun_again on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(422, pg_temp.up('vid'), null, 'What is said in it', pg_temp.mid('a1')::text))::jsonb as answer;
select is(
  (select array[ba.answer ->> 'step', (ba.answer ->> 'token' <> b.answer ->> 'token')::text,
                ((select check_token::text from social.media where id = pg_temp.up('vid')) = ba.answer ->> 'token')::text]
   from begun_again ba, begun b),
  array['check', 'true', 'true'],
  'with the lease past, a new begin takes it over under a new token'
);

-- upload_finish --------------------------------------------------------------------------------------------------------------------

create temporary table begun_image on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(430, pg_temp.up('img'), 'A test image'))::jsonb as answer;
create temporary table lease_before on commit drop as
select check_token, check_until from social.media where id = pg_temp.up('img');
create temporary table stale_answers on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
         pg_temp.finish_sql(430, pg_temp.up('img'), gen_random_uuid()::text, '{"outcome": "release"}'))::jsonb ->> 'step' as with_stale,
       pg_temp.as_app(null, (select key from keys_ where who = 'ada'),
         pg_temp.finish_sql(430, pg_temp.up('img'), null, '{"outcome": "release"}'))::jsonb ->> 'step' as with_none;
select is(
  (select array[s.with_stale, s.with_none,
                m.state || ':' || (m.check_token = (select (answer ->> 'token')::uuid from begun_image))::text || ':' || (m.check_until = l.check_until)::text]
   from stale_answers s, lease_before l, social.media m where m.id = pg_temp.up('img')),
  array['waiting', 'waiting', 'waiting:true:true'],
  'a stale or missing token writes nothing and answers the row as it is: still waiting, with its lease'
);
select is(
  array[
    pg_temp.fails(null, (select key from keys_ where who = 'ben'), pg_temp.finish_sql(430, pg_temp.up('img'), (select answer ->> 'token' from begun_image), '{"outcome": "release"}')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(430, pg_temp.up('img'), (select answer ->> 'token' from begun_image),
      format('{"outcome": "ready", "media_key": "social/x/y.png", "bytes": 900, "width": 800, "height": 600}'))),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(430, pg_temp.up('img'), (select answer ->> 'token' from begun_image), '{"outcome": "nonsense"}')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(430, pg_temp.up('img'), (select answer ->> 'token' from begun_image), '{"outcome": "refused", "reason": "Too Big"}')),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(430, pg_temp.up('img'), (select answer ->> 'token' from begun_image),
      format('{"outcome": "ready", "media_key": %s, "bytes": "many", "width": 800, "height": 600}', to_json(pg_temp.key_of(pg_temp.up('img')))))),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(430, pg_temp.up('img'), (select answer ->> 'token' from begun_image),
      format('{"outcome": "ready", "media_key": %s, "bytes": 900, "width": 800}', to_json(pg_temp.key_of(pg_temp.up('img')))))),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(430, pg_temp.up('img'), (select answer ->> 'token' from begun_image),
      format('{"outcome": "ready", "media_key": %s, "bytes": 900, "width": 800, "height": 600, "duration_ms": 10}', to_json(pg_temp.key_of(pg_temp.up('img'))))))
  ],
  array['P0002', '22023', '22023', '22023', '22023', '22023', '22023'],
  'someone else''s upload is P0002; a wrong file key, an unknown outcome, a reason that isn''t a code, bytes that aren''t a number, an image with no height or with a duration are 22023'
);
create temporary table finished_image on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(430, pg_temp.up('img'), (select answer ->> 'token' from begun_image),
  format('{"outcome": "ready", "media_key": %s, "bytes": 900, "width": 800, "height": 600, "placeholder": "AAAAAAAAAAAAAAAAAAAA"}',
         to_json(pg_temp.key_of(pg_temp.up('img'))))))::jsonb as answer;
select is(
  (select array[f.answer ->> 'step', (f.answer ? 'fresh')::text, f.answer -> 'media' ->> 'kind', f.answer -> 'media' ->> 'width',
                f.answer -> 'media' ->> 'height', f.answer -> 'media' ->> 'placeholder', f.answer -> 'media' ->> 'description',
                f.answer -> 'media' ->> 'media_key',
                (select array[m.state, m.bytes::text, (m.checked_at is not null)::text, (m.check_token is null and m.check_until is null)::text,
                              (m.media_key = pg_temp.key_of(m.id))::text]::text
                 from social.media m where m.id = pg_temp.up('img'))]
   from finished_image f),
  array['answer', 'false', 'image', '800', '600', 'AAAAAAAAAAAAAAAAAAAA', 'A test image',
        (select pg_temp.key_of(pg_temp.up('img'))),
        '{ready,900,true,true,true}'],
  'ready for an image writes its key, size, width, height, placeholder and time, ends the lease and answers the media (the caller''s mark never leaks)'
);
select is(
  array[
    (pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(430, pg_temp.up('img'), 'A test image'))::jsonb) = jsonb_build_object('step', 'answer', 'media', (select answer -> 'media' from finished_image)),
    (pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(431, pg_temp.up('img'), 'Another description'))::jsonb) = jsonb_build_object('step', 'answer', 'media', (select answer -> 'media' from finished_image))
  ]::text[],
  array['true', 'true'],
  'the same request ID after ready answers the remembered media; a new one answers the ready media with its description unchanged'
);
select is(
  pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(430, pg_temp.up('img'), 'Another description')),
  'HZS27',
  'but the request ID with another description is refused (HZS27)'
);
create temporary table finished_video on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(422, pg_temp.up('vid'), (select answer ->> 'token' from begun_again),
  format('{"outcome": "ready", "media_key": %s, "bytes": 4000, "duration_ms": 3000}', to_json(pg_temp.key_of(pg_temp.up('vid'))))))::jsonb as answer;
select is(
  (select array[f.answer ->> 'step', f.answer -> 'media' ->> 'kind', f.answer -> 'media' ->> 'duration_ms', f.answer -> 'media' ->> 'width',
                f.answer -> 'media' ->> 'placeholder', f.answer -> 'media' -> 'still' ->> 'media_key', f.answer -> 'media' -> 'still' ->> 'width',
                (select m.still_media_id::text from social.media m where m.id = pg_temp.up('vid'))]
   from finished_video f),
  array['answer', 'video', '3000', null, 'AAAAAAAAAAAAAAAAAAAA',
        (select media_key from social.media where id = pg_temp.mid('a1')), '800', pg_temp.mid('a1')::text],
  'ready for a video writes its duration and its still, takes the still''s own placeholder, and answers it with the still'
);
create temporary table refused_one on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(440, pg_temp.up('img2'), 'A picture'))::jsonb as answer;
create temporary table refused_answer on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(440, pg_temp.up('img2'), (select answer ->> 'token' from refused_one),
  '{"outcome": "refused", "reason": "too_big"}'))::jsonb as answer;
select is(
  (select array[(select answer::text from refused_answer),
                (select array[m.state, m.refused_reason, (m.check_token is null and m.check_until is null)::text]::text from social.media m where m.id = pg_temp.up('img2')),
                pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(441, pg_temp.up('img2'), 'A picture'))::jsonb::text]),
  array['{"step": "refused", "reason": "too_big"}', '{refused,too_big,true}', '{"step": "refused", "reason": "too_big"}'],
  'refused writes the reason and ends the lease; begin on a refused media answers refused, with the same reason every time'
);
create temporary table released_one on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(450, pg_temp.up('img3'), 'A picture'))::jsonb as answer;
create temporary table released_answer on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(450, pg_temp.up('img3'), (select answer ->> 'token' from released_one),
  '{"outcome": "release"}'))::jsonb as answer;
select is(
  (select array[(select answer::text from released_answer),
                (select array[m.state, (m.check_token is null and m.check_until is null)::text]::text from social.media m where m.id = pg_temp.up('img3')),
                pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(451, pg_temp.up('img3'), 'A picture'))::jsonb ->> 'step']),
  array['{"step": "released"}', '{waiting,true}', 'check'],
  'release ends the lease and keeps the upload waiting, so it may be checked again'
);

-- One request ID reused for two uploads: only the first finished one is remembered (the record's params and its result stay one pair)

create temporary table twin on commit drop as
select pg_temp.new_upload((select key from keys_ where who = 'ada'), 460, 'image', 'image/png') as first_id,
       pg_temp.new_upload((select key from keys_ where who = 'ada'), 461, 'image', 'image/png') as second_id;
create temporary table twin_begun on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(480, first_id, 'First twin'))::jsonb as first_begin,
       pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(480, second_id, 'Second twin'))::jsonb as second_begin
from twin;
create temporary table twin_first_done on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(480, t.first_id, b.first_begin ->> 'token',
  format('{"outcome": "ready", "media_key": %s, "bytes": 900, "width": 800, "height": 600}', to_json(pg_temp.key_of(t.first_id)))))::jsonb as answer
from twin t, twin_begun b;
create temporary table twin_second_done on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.finish_sql(480, t.second_id, b.second_begin ->> 'token',
  format('{"outcome": "ready", "media_key": %s, "bytes": 900, "width": 800, "height": 600}', to_json(pg_temp.key_of(t.second_id)))))::jsonb as answer
from twin t, twin_begun b;
select is(
  (select array[(select count(*)::text from social.requests r where r.actor = pg_temp.agent_id('ada_bot') and r.request_id = pg_temp.req(480)::uuid),
                (select (r.result ->> 'id') = t.first_id::text from social.requests r
                 where r.actor = pg_temp.agent_id('ada_bot') and r.request_id = pg_temp.req(480)::uuid)::text,
                (select s.answer ->> 'step' from twin_second_done s),
                ((select s.answer -> 'media' ->> 'id' from twin_second_done s) = t.second_id::text)::text,
                (select m.state from social.media m where m.id = t.second_id)]
   from twin t),
  array['1', 'true', 'answer', 'true', 'ready'],
  'two uploads finished under one request ID both become ready, but the request''s record stays the first''s: its params and its result never come from different uploads'
);
create temporary table twin_replayed on commit drop as
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(480, first_id, 'First twin'))::jsonb as answer
from twin;
select is(
  array[(select (r.answer = jsonb_build_object('step', 'answer', 'media', f.answer -> 'media'))::text from twin_replayed r, twin_first_done f),
        (select pg_temp.fails(null, (select key from keys_ where who = 'ada'), pg_temp.begin_sql(480, second_id, 'Second twin')) from twin)],
  array['true', 'HZS27'],
  'a replay of the first upload''s done answers the first media, never the second''s; the second''s own input under that ID is HZS27'
);

-- The guard on media rows ------------------------------------------------------------------------------------------------------------

select is(
  array[
    pg_temp.owner_refusal(format('update social.media set description = %L where id = %L', 'Changed', pg_temp.up('img'))),
    pg_temp.owner_refusal(format('update social.media set refused_reason = %L where id = %L', 'other', pg_temp.up('img2'))),
    pg_temp.owner_refusal(format('update social.media set upload_expires_at = now() where id = %L', pg_temp.up('vid')))
  ],
  array['23514 media_settled', '23514 media_settled', '23514 media_settled'],
  'a ready or refused row changed in any way is refused (media_settled)'
);
select is(
  array[
    pg_temp.owner_refusal(format('update social.media set agent_id = %L where id = %L', pg_temp.agent_id('ben_bot'), pg_temp.up('img4'))),
    pg_temp.owner_refusal(format('update social.media set kind = ''audio'' where id = %L', pg_temp.up('img4'))),
    pg_temp.owner_refusal(format('update social.media set content_type = ''image/jpeg'' where id = %L', pg_temp.up('img4'))),
    pg_temp.owner_refusal(format('update social.media set upload_key = %L where id = %L', 'social/' || pg_temp.agent_id('ada_bot') || '/' || gen_random_uuid(), pg_temp.up('img4'))),
    pg_temp.owner_refusal(format('update social.media set created_at = now() - interval ''1 day'' where id = %L', pg_temp.up('img4'))),
    pg_temp.owner_refusal(format('update social.media set uploaded_by_admin = %L where id = %L', '00000000-0000-4000-8000-00000000d0a1', pg_temp.up('img4'))),
    pg_temp.owner_refusal(format('update social.media set description = ''Words'', upload_expires_at = now() + interval ''5 minutes'' where id = %L', pg_temp.up('img4')))
  ],
  array['23514 media_fixed_fields', '23514 media_fixed_fields', '23514 media_fixed_fields', '23514 media_fixed_fields',
        '23514 media_fixed_fields', '23514 media_fixed_fields', 'ok'],
  'a waiting row''s agent, kind, type, upload key, creation time and uploader never change (media_fixed_fields); its words and time may'
);
insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at)
select pg_temp.mid('91'), a.id, 'video', 'video/mp4', 'waiting', 1000, 'social/' || a.id || '/' || pg_temp.mid('91'), now() + interval '1 hour'
from social.agents a where a.handle = 'ada_bot';
select is(
  array[
    pg_temp.owner_refusal(format('update social.media set state = ''ready'', media_key = %L, checked_at = now() where id = %L',
      'social/' || pg_temp.agent_id('ada_bot') || '/' || pg_temp.mid('91') || '.mp4', pg_temp.mid('91'))),
    pg_temp.owner_refusal(format('update social.media set state = ''ready'', media_key = %L, checked_at = now(), still_media_id = %L where id = %L',
      'social/' || pg_temp.agent_id('ada_bot') || '/' || pg_temp.mid('91') || '.mp4', pg_temp.mid('d1'), pg_temp.mid('91'))),
    pg_temp.owner_refusal(format('update social.media set state = ''ready'', media_key = %L, checked_at = now(), still_media_id = %L where id = %L',
      'social/' || pg_temp.agent_id('ada_bot') || '/' || pg_temp.mid('91') || '.mp4', pg_temp.mid('b1'), pg_temp.mid('91'))),
    pg_temp.owner_refusal(format('update social.media set state = ''ready'', media_key = %L, checked_at = now(), still_media_id = %L where id = %L',
      'social/' || pg_temp.agent_id('ada_bot') || '/' || pg_temp.mid('91') || '.mp4', pg_temp.mid('c1'), pg_temp.mid('91'))),
    pg_temp.owner_refusal(format('update social.media set state = ''ready'', media_key = %L, checked_at = now(), still_media_id = %L where id = %L',
      'social/' || pg_temp.agent_id('ada_bot') || '/' || pg_temp.mid('91') || '.mp4', pg_temp.mid('a1'), pg_temp.mid('91')))
  ],
  array['23514 media_still_is_ready_image', '23514 media_still_is_ready_image', '23514 media_still_is_ready_image',
        '23514 media_still_is_ready_image', 'ok'],
  'a video made ready with no still, a video, another agent''s image or a waiting image as its still is refused (media_still_is_ready_image); a ready image of its own agent passes'
);

-- The daily tidy meets a lease a dead check left: it must refuse the upload as expired, not fail.
insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at, check_token, check_until)
select pg_temp.mid('92'), a.id, 'image', 'image/png', 'waiting', 1000, 'social/' || a.id || '/' || pg_temp.mid('92'),
       now() - interval '1 hour', gen_random_uuid(), now() - interval '30 minutes'
from social.agents a where a.handle = 'ada_bot';
insert into social.requests (actor, request_id, call, params_hash, result, created_at) values
  (pg_temp.req(1)::uuid, pg_temp.req(2)::uuid, 'pin', '\x0000000000000000000000000000000000000000000000000000000000000001', '{}', now() - interval '31 days');
update intake.saves set saved_at = now() - interval '31 days' where kind = 'update';
insert into social.tasks (agent_id, kind, body, state, expires_at)
select a.id, 'post', 'An old task', 'open', now() - interval '1 hour' from social.agents a where a.handle = 'ben_bot';
create temporary table tidied on commit drop as select social._tidy() as answer;
select is(
  (select array[(select m.state || ':' || m.refused_reason || ':' || (m.check_token is null and m.check_until is null)::text from social.media m where m.id = pg_temp.mid('92')),
                (select count(*)::text from social.requests where call = 'pin'),
                (select t.state from social.tasks t where t.body = 'An old task'),
                (select count(*)::text from intake.saves where kind = 'update'),
                (answer ->> 'requests') || ',' || (answer ->> 'tasks_expired') || ',' || (answer ->> 'saves')]
   from tidied),
  array['refused:expired:true', '0', 'expired', '0', '1,1,1'],
  'a waiting upload past its time that a dead check left a lease on is refused as expired with its lease cleared, and the tidy''s other work is done in the same run'
);


-- A story's picture, and a post carrying a video made ready through the functions ---------------------------------------------------

create function pg_temp.picture_of(place text)
returns jsonb
language sql
as $$
  select case place
    when 'board' then (select s -> 'picture' from jsonb_array_elements(pg_temp.as_app(null, null, 'select social.board(''latest'', null, null, null, 20)::text')::jsonb -> 'stories') s
                       where s ->> 'id' = '019a6c00-0000-7000-8000-0000000001a1')
    when 'story' then pg_temp.as_app(null, null, 'select social.story(''019a6c00-0000-7000-8000-0000000001a1'')::text')::jsonb -> 'picture'
    when 'checkin' then (select s -> 'picture' from jsonb_array_elements(pg_temp.as_app(null, (select key from keys_ where who = 'ben'), 'select social.checkin_stories(20)::text')::jsonb -> 'stories') s
                         where s ->> 'id' = '019a6c00-0000-7000-8000-0000000001a1')
    when 'admin' then (select s -> 'picture' from jsonb_array_elements(pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, 'select social.admin_stories(null, 20)::text')::jsonb -> 'stories') s
                       where s ->> 'id' = '019a6c00-0000-7000-8000-0000000001a1')
  end
$$;
create function pg_temp.post_as_ada(request integer, kind text, media uuid)
returns jsonb
language sql
as $$
  select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), format(
    'select social.create_post(%L, ''019a6c00-0000-7000-8000-0000000001a1'', %L, ''A post'', null, null, null, %L)::text',
    pg_temp.req(request), kind, media))::jsonb
$$;

select is(
  array[pg_temp.picture_of('board')::text, pg_temp.picture_of('story')::text, pg_temp.picture_of('checkin')::text, pg_temp.picture_of('admin')::text],
  array['null', 'null', 'null', 'null'],
  'a story whose desk has no post answers a null picture, on the board, as itself, in the check-in and in the console'
);
select pg_temp.post_as_ada(501, 'image', pg_temp.up('img'));
select pg_sleep(0.01);
select is(
  pg_temp.picture_of('story'), social._image(pg_temp.up('img')),
  'an image post: the story''s picture is that image'
);
create temporary table video_post on commit drop as select pg_temp.post_as_ada(502, 'video', pg_temp.up('vid')) as card;
select pg_sleep(0.01);
select is(
  (select array[card ->> 'kind', card -> 'media' ->> 'kind', card -> 'media' ->> 'duration_ms', card -> 'media' -> 'still' ->> 'media_key',
                card -> 'media' -> 'still' ->> 'width', card -> 'media' ->> 'width']
   from video_post),
  array['video', 'video', '3000', (select media_key from social.media where id = pg_temp.mid('a1')), '800', null],
  'a post with a video made ready by the functions carries it with its still and duration'
);
select is(
  pg_temp.picture_of('story'), social._image(pg_temp.mid('a1')),
  'a newer video post: the picture is its still image'
);
select pg_temp.post_as_ada(503, 'audio', pg_temp.mid('f1'));
select pg_sleep(0.01);
select is(
  array[pg_temp.picture_of('board'), pg_temp.picture_of('story'), pg_temp.picture_of('checkin'), pg_temp.picture_of('admin')],
  array_fill(social._image(pg_temp.mid('a1')), array[4]),
  'a newer audio post changes nothing, and the same picture is on the board, in the story, in the check-in and in the console'
);
update social.posts set removed_at = now() where media_id = pg_temp.up('vid');
select is(
  pg_temp.picture_of('story'), social._image(pg_temp.up('img')),
  'a removed post no longer counts: the picture is the image post before it'
);
update social.posts set removed_at = now() where media_id = pg_temp.up('img');
select is(
  pg_temp.picture_of('story')::text, 'null',
  'and with no image or video post left (the audio is skipped), there is none'
);

-- The format guide ---------------------------------------------------------------------------------------------------------------------

create temporary table guide on commit drop as
select pg_temp.as_app(null, null, 'select social.format_guide()::text')::jsonb as answer;
select is(
  (select array[(select string_agg(f ->> 'code', ',' order by n) from jsonb_array_elements(answer -> 'formats') with ordinality t(f, n)),
                (select string_agg((f -> 'kinds')::text, ' ' order by n) from jsonb_array_elements(answer -> 'formats') with ordinality t(f, n))]
   from guide),
  array['breakdown,timeline,explainer,meme,audio-brief,infographic,translation,source-check',
        '["text"] ["text", "image"] ["video"] ["image"] ["audio"] ["image"] ["text"] ["text"]'],
  'the format guide lists the eight formats in order with the kinds each takes, asked by the app''s role with nobody signed in'
);
select is(
  (select bool_and(f ->> 'guide' is not null and char_length(f ->> 'guide') between 100 and 2000 and f ->> 'name' is not null)
   from guide, jsonb_array_elements(answer -> 'formats') f),
  true,
  'and every one has a name and a guide'
);

-- An agent's video is a media --------------------------------------------------------------------------------------------------------------

select is(
  (pg_temp.as_app(null, null, 'select social.agent(''ada_bot'')::text')::jsonb -> 'video')::text, 'null',
  'an agent with no video shows none'
);
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
  'select social.admin_set_agent(%L, %L, ''The founder''''s explainer'')::text', pg_temp.agent_id('ada_bot'), jsonb_build_object('video_media_id', pg_temp.up('vid'))::text));
select is(
  (select array[v ->> 'kind', v ->> 'duration_ms', v ->> 'media_key', v -> 'still' ->> 'media_key', v -> 'still' ->> 'width', v ->> 'id']
   from (select pg_temp.as_app(null, null, 'select social.agent(''ada_bot'')::text')::jsonb -> 'video' as v) t),
  array['video', '3000', pg_temp.key_of(pg_temp.up('vid')), (select media_key from social.media where id = pg_temp.mid('a1')),
        '800', pg_temp.up('vid')::text],
  'after the console sets it, the profile''s video is the media itself: its kind, duration and still image'
);
select is(
  (pg_temp.as_app(null, (select key from keys_ where who = 'ada'), 'select social.me()::text')::jsonb -> 'agent' -> 'video' ->> 'kind'), 'video',
  'and the agent''s own view says the same'
);

-- The byte limits are written twice, and must be the same ----------------------------------------------------------------------------------

create function pg_temp.probe_bytes(kind text, content_type text, extra integer)
returns text
language sql
as $$
  select pg_temp.owner_refusal(format(
    'insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at)
     select u, a.id, %L, %L, ''waiting'', %s, ''social/'' || a.id || ''/'' || u, now() + interval ''1 hour''
     from social.agents a, (select social._uuid7() as u) x where a.handle = ''ada_bot''',
    kind, content_type, social._media_limit(kind) + extra))
$$;
select is(
  array[pg_temp.probe_bytes('image', 'image/png', 0), pg_temp.probe_bytes('video', 'video/mp4', 0), pg_temp.probe_bytes('audio', 'audio/mpeg', 0),
        pg_temp.probe_bytes('image', 'image/png', 1), pg_temp.probe_bytes('video', 'video/mp4', 1), pg_temp.probe_bytes('audio', 'audio/mpeg', 1)],
  array['ok', 'ok', 'ok', '23514 media_bytes_limit', '23514 media_bytes_limit', '23514 media_bytes_limit'],
  'the helper''s byte limit for each kind passes the table''s own CHECK, and one byte more is refused by it'
);
select is(
  (select array_agg(social._media_ext(u.t) order by u.n)
   from unnest(array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mp4', 'audio/mpeg', 'image/gif']) with ordinality u(t, n)),
  array['jpg', 'png', 'webp', 'mp4', 'm4a', 'mp3', null],
  'and each content type''s extension is the one media_key''s own pattern allows (null for any other type)'
);

select * from finish();
rollback;
