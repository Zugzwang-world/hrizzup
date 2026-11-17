-- Tests for migrations/*_social.sql, accounts that go (docs/social/build.md, section 3.1): deleting an account
-- takes its reader's rows with it (the append-only profile history included: only that cascade may remove it),
-- leaves its agent with no owner (the agent stays, and can no longer write), and doesn't touch what an admin's
-- account was named in. A direct delete of a version is still refused. Run by the Database check on every pull
-- request against a fresh database; everything runs in a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(24);

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

-- What an owner-run statement fails with: its SQLSTATE and the constraint it names, or 'ok'.
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
  return sqlstate || ' ' || coalesce(nullif(cn, ''), '-');
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

-- People: an admin who made things, Ada (an agent's owner and a reader), Ben (a reader only) ------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-accounts.test', now()),
  ('00000000-0000-4000-8000-00000000d0b1', 'ada@social-accounts.test', now()),
  ('00000000-0000-4000-8000-00000000d0b2', 'ben@social-accounts.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');
update social.environment set test_stories = true;

-- The admin makes an invite for Ada, saves a story, changes a setting.
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
  'select social.admin_create_invite(%L, ''ada@social-accounts.test'', null, false, true, %L::bytea, ''hz-aaaa'')::text', pg_temp.req(1), pg_temp.hash(1)));
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null,
  'select social.admin_set_settings(''{"posts_per_day": 12}'', ''A test change'')::text');
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, $q$
  select social.admin_save_story('{"format": "story/1", "id": "019a6c00-0000-7000-8000-0000000004a1", "title": "A story",
    "summary": "What is happening.", "locations": ["global"], "categories": ["general"], "state": "live",
    "created_at": "2026-11-17T10:00:00Z", "updated_at": "2026-11-17T10:00:00Z"}', true)::text$q$);

-- Ada's agent joins and is claimed, posts, and has files, versions and keys.
create temporary table joined on commit drop as
select pg_temp.as_app(null, null, format(
  'select social.register_agent(%L::bytea, %L, ''ada_bot'', ''Ada''''s agent'', null, null, null, %L::bytea, ''hz_demo_K001'', %L::bytea)::text',
  pg_temp.hash(1), pg_temp.req(2), pg_temp.hash(1001), pg_temp.hash(2001)))::jsonb as answer;
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format(
  'select social.claim_agent(%L, %L::bytea, ''Ada'')::text', pg_temp.req(3), pg_temp.hash(2001)));
select pg_temp.as_app(null, (select answer -> 'key' ->> 'id' from joined), format(
  'select social.create_post(%L, ''019a6c00-0000-7000-8000-0000000004a1'', ''text'', ''A post'', null, null, null, null)::text', pg_temp.req(4)));
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format(
  'select keys.make_agent_key(%L, ''Second key'', %L::bytea, ''hz_demo_K002'')::text', pg_temp.req(5), pg_temp.hash(1002)));
insert into social.files (id, agent_id, name, kind, current_number)
  select '01a1a0e7-0000-7000-8000-0000000005f1', a.id, 'purpose', 'text', 2 from social.agents a where a.handle = 'ada_bot';
insert into social.file_versions (file_id, agent_id, number, body, author, reason)
  select '01a1a0e7-0000-7000-8000-0000000005f1', a.id, n, 'Version ' || n, 'owner', 'edit' from social.agents a, generate_series(1, 2) n where a.handle = 'ada_bot';
insert into social.chat_messages (agent_id, author, body) select a.id, 'owner', 'Hello' from social.agents a where a.handle = 'ada_bot';
insert into social.checkins (agent_id, seen_until, note) select a.id, now() - interval '1 minute', 'Caught up' from social.agents a where a.handle = 'ada_bot';

-- Ada and Ben are readers, with a reading profile and its history, and messages.
insert into social.readers (user_id, profile, profile_number, holds_something) values
  ('00000000-0000-4000-8000-00000000d0b1', '## More of
- ai news', 2, true),
  ('00000000-0000-4000-8000-00000000d0b2', '', 0, false);
insert into social.reader_profile_versions (user_id, number, body, author) values
  ('00000000-0000-4000-8000-00000000d0b1', 1, '## More of', 'reader'),
  ('00000000-0000-4000-8000-00000000d0b1', 2, '## More of
- ai news', 'agent'),
  ('00000000-0000-4000-8000-00000000d0b2', 1, '## More of', 'reader');
insert into social.reader_messages (user_id, author, body) values
  ('00000000-0000-4000-8000-00000000d0b1', 'reader', 'Show me AI news'),
  ('00000000-0000-4000-8000-00000000d0b1', 'agent', 'Done'),
  ('00000000-0000-4000-8000-00000000d0b2', 'reader', 'Hello');
insert into social.reader_days (user_id, day, messages, neurons) values
  ('00000000-0000-4000-8000-00000000d0b1', current_date, 2, 40),
  ('00000000-0000-4000-8000-00000000d0b2', current_date, 1, 10);

-- Before ---------------------------------------------------------------------------------------------------------------------------------

select is(
  (select array[(select count(*) from social.reader_profile_versions)::text, (select count(*) from social.reader_messages)::text,
                (select count(*) from social.reader_days)::text, (select count(*) from social.readers)::text]),
  array['3', '3', '2', '2'],
  'two readers, with their profile versions, messages and days'
);
select is(
  (select a.owner_id::text from social.agents a where a.handle = 'ada_bot'), '00000000-0000-4000-8000-00000000d0b1',
  'Ada owns a claimed agent with a post, files, versions, keys and a chat'
);
select is(
  array[pg_temp.refuses($$delete from social.reader_profile_versions where number = 1 and user_id = '00000000-0000-4000-8000-00000000d0b1'$$),
        pg_temp.refuses($$update social.reader_profile_versions set body = 'Changed' where number = 1$$),
        pg_temp.refuses($$delete from social.file_versions$$)],
  array['23514 reader_profile_versions_append_only', '23514 reader_profile_versions_append_only', '23514 file_versions_append_only'],
  'while the account exists, a direct delete or update of a version is refused'
);

-- Ada's account is deleted ------------------------------------------------------------------------------------------------------------------

select is(
  (select array_agg(a ->> 'handle') from jsonb_array_elements(pg_temp.as_app(null, null, 'select social.agents(null, 20)::text')::jsonb -> 'agents') a),
  array['ada_bot'],
  'while Ada owns it, the directory lists her agent'
);

create temporary table agent_before on commit drop as
select a.id, a.handle, a.claimed_at, a.posts from social.agents a where a.handle = 'ada_bot';
delete from auth.users where id = '00000000-0000-4000-8000-00000000d0b1';

select is(
  (select array[(select count(*) from social.readers where user_id = '00000000-0000-4000-8000-00000000d0b1')::text,
                (select count(*) from social.reader_profile_versions where user_id = '00000000-0000-4000-8000-00000000d0b1')::text,
                (select count(*) from social.reader_messages where user_id = '00000000-0000-4000-8000-00000000d0b1')::text,
                (select count(*) from social.reader_days where user_id = '00000000-0000-4000-8000-00000000d0b1')::text]),
  array['0', '0', '0', '0'],
  'deleting an account takes its reader, the reader''s profile versions, messages and days with it'
);
select is(
  (select array[(select count(*) from social.readers)::text, (select count(*) from social.reader_profile_versions)::text,
                (select count(*) from social.reader_messages)::text]),
  array['1', '1', '1'],
  'and nobody else''s'
);
select is(
  (select array[a.owner_id is null, a.claimed_at is not null, a.retired_at is null]::text[] from social.agents a where a.handle = 'ada_bot'),
  array['true', 'true', 'true'],
  'the agent stays, with no owner: still claimed, not retired'
);
select is(
  (select array[a ->> 'retired', a ->> 'claimed'] from (select pg_temp.as_app(null, null, 'select social.agent(''ada_bot'')::text')::jsonb as a) t),
  array['true', 'true'],
  'its public profile says it is retired: no owner is left to run it'
);
select is(
  (select count(*)::integer from jsonb_array_elements(pg_temp.as_app(null, null, 'select social.agents(null, 20)::text')::jsonb -> 'agents')), 0,
  'and the directory no longer lists it'
);
select is(
  (select a ->> 'state' from jsonb_array_elements(pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, 'select social.admin_agents(null, 20)::text')::jsonb -> 'agents') a
   where a ->> 'handle' = 'ada_bot'),
  'retired',
  'and the console shows it as retired, as every call it makes says'
);
select is(
  (select array[(select count(*) from social.posts p where p.agent_id = (select id from agent_before))::text,
                (select count(*) from social.files f where f.agent_id = (select id from agent_before))::text,
                (select count(*) from social.file_versions v where v.agent_id = (select id from agent_before))::text,
                (select count(*) from keys.agent_keys k where k.agent_id = (select id from agent_before))::text,
                (select count(*) from social.chat_messages c where c.agent_id = (select id from agent_before))::text,
                (select count(*) from social.checkins c where c.agent_id = (select id from agent_before))::text]),
  array['1', '2', '3', '2', '1', '1'],
  'and keeps its posts, files, every version, keys, chat and check-ins'
);
select is(
  array[
    pg_temp.fails(null, (select answer -> 'key' ->> 'id' from joined), format(
      'select social.create_post(%L, ''019a6c00-0000-7000-8000-0000000004a1'', ''text'', ''Another post'', null, null, null, null)::text', pg_temp.req(10))),
    pg_temp.fails(null, (select answer -> 'key' ->> 'id' from joined), 'select social.me()::text'),
    pg_temp.fails(null, (select answer -> 'key' ->> 'id' from joined), format('select social.pin(%L, ''019a6c00-0000-7000-8000-0000000004a1'')::text', pg_temp.req(11))),
    pg_temp.fails(null, (select answer -> 'key' ->> 'id' from joined), format('select social.checkin_done(%L, now() - interval ''1 second'', null)::text', pg_temp.req(12)))
  ],
  array['HZS02', 'HZS02', 'HZS02', 'HZS02'],
  'but it can''t write or act: its own key answers "retired" (HZS02) to every agent call'
);
select is(
  (select count(*)::integer from social.posts), 1,
  'no post was made'
);
select is(
  pg_temp.as_app(null, null, 'select social.agent(''ada_bot'')::text')::jsonb ->> 'handle', 'ada_bot',
  'its profile and posts are still public'
);
select is(
  (select jsonb_array_length(pg_temp.as_app(null, null, 'select social.agent_posts(''ada_bot'', null, 10)::text')::jsonb -> 'posts')), 1,
  'and its post stays on the desk'
);
select is(
  (select pg_temp.as_app(null, null, format('select keys.find(%L::bytea)::text', pg_temp.hash(1001)))::jsonb ->> 'kind'), 'post',
  'keys.find still knows its key: it is the agent call that refuses'
);
select is(
  pg_temp.fails(null, null, format('select social.claim_preview(%L::bytea)::text', pg_temp.hash(2001))), 'HZS08',
  'the claim link was spent: nobody can claim the agent again'
);
select is(
  pg_temp.refuses($$delete from social.reader_profile_versions where user_id = '00000000-0000-4000-8000-00000000d0b2'$$),
  '23514 reader_profile_versions_append_only',
  'a direct delete of a version is still refused for a reader who remains'
);
select is(
  pg_temp.refuses($$delete from social.file_versions where agent_id = (select id from social.agents where handle = 'ada_bot')$$),
  '23514 file_versions_append_only',
  'and of an agent''s file versions'
);

-- The admin's account is deleted -----------------------------------------------------------------------------------------------------------------

create temporary table logs_before on commit drop as
select (select count(*) from social.console_log) as log, (select count(*) from social.setting_changes) as changes,
       (select count(*) from social.invites) as invites, (select count(*) from social.stories) as stories;
delete from auth.users where id = '00000000-0000-4000-8000-00000000d0a1';
select is(
  (select array[(select count(*) from social.console_log)::text, (select count(*) from social.setting_changes)::text,
                (select count(*) from social.invites)::text, (select count(*) from social.stories)::text]),
  (select array[log::text, changes::text, invites::text, stories::text] from logs_before),
  'an admin''s account goes without touching the console''s log, the setting changes, the invites or the stories it made'
);
select ok(
  (select count(*) >= 3 from social.console_log where admin_id = '00000000-0000-4000-8000-00000000d0a1'),
  'the log still names the admin who did each thing (it keeps the ID as a record, with no foreign key)'
);
select is(
  (select i.created_by::text from social.invites i), '00000000-0000-4000-8000-00000000d0a1',
  'and the invite still says who made it'
);
select is(
  (select s.made_by_admin::text from social.stories s), '00000000-0000-4000-8000-00000000d0a1',
  'and the story who saved it'
);

-- Ben's account goes too: the last reader.
delete from auth.users where id = '00000000-0000-4000-8000-00000000d0b2';
select is(
  (select array[(select count(*) from social.readers)::text, (select count(*) from social.reader_profile_versions)::text,
                (select count(*) from social.reader_messages)::text, (select count(*) from social.reader_days)::text]),
  array['0', '0', '0', '0'],
  'when the last reader''s account goes, no reader row is left'
);

select * from finish();
rollback;
