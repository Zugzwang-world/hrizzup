-- Tests for migrations/*_social_media.sql, the console's own agents (Round 6, R8, M1; docs/social/media-design.md,
-- sections 4 and 11.1): making one (claimed at once, no owner, never a key, its own used invite and profile
-- file), how it shows (claimed, listed, never retired for having no owner), who may act as it (only an admin's
-- transaction, through the transaction's own setting, with no key at all), "post as" through the very same
-- create_post (Hrizzup's limit, the media rules, a retry, the log), the console's uploads, nothing else reaching
-- such an agent, a withdrawn story's tile having no picture, and an owner's deleted account still retiring its
-- agent everywhere. Run by the Database check on every pull request against a fresh database; everything runs in a
-- transaction that is rolled back. Every hash here is made-up and low-entropy.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(35);

-- Runs one query as the app's own role, signed in as `account` (null: nobody), with `api_key` as the key that
-- signed the request (null: none) and `console` as the transaction's console-agent setting (null: leave the
-- setting as it is; otherwise set for this one query and cleared), and gives back its one value as text. What
-- the setting held right after the query is kept in `test.console_after`, before anything clears it.
create function pg_temp.run(account text, api_key text, console text, query text)
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
  if console is not null then
    perform set_config('hrizzup.console_agent', console, true);
  end if;
  set local role hrizzup_app;
  execute query into answer;
  perform set_config('test.console_after', coalesce(current_setting('hrizzup.console_agent', true), 'unset'), true);
  reset role;
  perform set_config('hrizzup.api_key', '', true);
  if console is not null then
    perform set_config('hrizzup.console_agent', '', true);
  end if;
  return answer;
end;
$$;

create function pg_temp.as_app(account text, api_key text, query text)
returns text
language sql
as $$ select pg_temp.run(account, api_key, null, query) $$;

-- The SQLSTATE a query as the app's role fails with (the detail after a colon when it is one of ours; the
-- constraint after a space when it names one), or 'ok'.
create function pg_temp.fails_with(account text, api_key text, console text, query text)
returns text
language plpgsql
as $$
declare
  detail text;
  cn text;
begin
  perform pg_temp.run(account, api_key, console, query);
  return 'ok';
exception when others then
  get stacked diagnostics detail = pg_exception_detail, cn = constraint_name;
  reset role;
  perform set_config('hrizzup.api_key', '', true);
  if console is not null then
    perform set_config('hrizzup.console_agent', '', true);
  end if;
  return sqlstate || coalesce(' ' || nullif(cn, ''), '') || case when sqlstate like 'HZ%' then coalesce(':' || nullif(detail, ''), '') else '' end;
end;
$$;

create function pg_temp.fails(account text, api_key text, query text)
returns text
language sql
as $$ select pg_temp.fails_with(account, api_key, null, query) $$;

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

-- As the admin: a query's answer as jsonb, and what it fails with.
create function pg_temp.admin(query text)
returns jsonb
language sql
as $$ select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, query)::jsonb $$;

create function pg_temp.admin_fails(query text)
returns text
language sql
as $$ select pg_temp.fails('00000000-0000-4000-8000-00000000d0a1', null, query) $$;

-- An agent that is registered (and claimed unless `claim` is false) by a new account, and its first key's ID.
create function pg_temp.agent(n integer, handle text, claim boolean default true)
returns text
language plpgsql
as $$
declare
  account text := '00000000-0000-4000-8000-00000000c' || lpad(n::text, 3, '0');
  email text := handle || '@social-house.test';
  registered jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at) values (account::uuid, email, now());
  perform pg_temp.admin(format(
    'select social.admin_create_invite(%L, %L, null, false, true, %L::bytea, ''hz-aaaa'')::text', pg_temp.req(5000 + n * 10 + 1), email, pg_temp.hash(n)));
  registered := pg_temp.as_app(null, null, format(
    'select social.register_agent(%L::bytea, %L, %L, %L, null, null, null, %L::bytea, %L, %L::bytea)::text',
    pg_temp.hash(n), pg_temp.req(5000 + n * 10 + 2), handle, 'Agent ' || handle, pg_temp.hash(1000 + n),
    'hz_demo_K' || lpad(n::text, 3, '0'), pg_temp.hash(2000 + n)))::jsonb;
  if claim then
    perform pg_temp.as_app(account, null, format(
      'select social.claim_agent(%L, %L::bytea, %L)::text', pg_temp.req(5000 + n * 10 + 3), pg_temp.hash(2000 + n), 'Owner of ' || handle));
  end if;
  return registered -> 'key' ->> 'id';
end;
$$;

create function pg_temp.agent_id(handle text)
returns uuid
language sql
as $$ select id from social.agents where social.agents.handle = agent_id.handle $$;

create function pg_temp.mid(n text)
returns uuid
language sql
as $$ select ('01a1a0e7-0000-7000-8000-0000000004' || n)::uuid $$;

-- A ready image of an agent, made as the owner (inserts aren't guarded; functions only make waiting rows).
create function pg_temp.ready_image(id uuid, handle text)
returns void
language sql
as $$
  insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, media_key, upload_expires_at, checked_at,
                            width, height, placeholder, description)
  select ready_image.id, a.id, 'image', 'image/png', 'ready', 1000, 'social/' || a.id || '/' || ready_image.id,
         'social/' || a.id || '/' || ready_image.id || '.png', now() + interval '1 hour', now(), 800, 600, 'AAAAAAAAAAAAAAAAAAAA', 'A test picture'
  from social.agents a where a.handle = ready_image.handle
$$;

create function pg_temp.make_sql(request integer, handle text, name text, listed text, bio text default null)
returns text
language sql
as $$ select format('select social.admin_make_console_agent(%L, %L, %L, %L, %L)::text', pg_temp.req(request), handle, name, bio, listed) $$;

create function pg_temp.post_as_sql(request integer, agent uuid, story text, kind text, body text, media text default null)
returns text
language sql
as $$
  select format('select social.admin_post_as(%L, %L, %L, %L, %L, null, null, null, %L)::text', pg_temp.req(request), agent, story, kind, body, media)
$$;

-- People and stories ------------------------------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-house.test', now()),
  ('00000000-0000-4000-8000-00000000d0b1', 'reader@social-house.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');
create temporary table keys_ on commit drop as
select 'ada' as who, pg_temp.agent(1, 'ada_bot') as key
union all select 'new', pg_temp.agent(2, 'new_bot', false);

select intake.save_story(jsonb_build_object('format', 'story/1', 'id', s.id, 'title', s.title, 'summary', 'What is happening.',
  'locations', jsonb_build_array('global'), 'categories', jsonb_build_array('general'), 'state', 'live',
  'created_at', '2026-11-17T10:00:00Z', 'updated_at', '2026-11-17T10:00:00Z'))
from (values ('019a6c00-0000-7000-8000-0000000002a1', 'The first story'), ('019a6c00-0000-7000-8000-0000000002a2', 'The second story')) as s(id, title);
select intake.save_update(jsonb_build_object('format', 'update/1', 'id', u.id, 'story_id', u.story, 'headline', 'A development',
  'reported_at', '2026-11-17T10:05:00Z', 'sources', jsonb_build_array('https://example.com/a'), 'state', 'live',
  'created_at', '2026-11-17T10:05:00Z', 'updated_at', '2026-11-17T10:05:00Z'))
from (values ('019a6c00-0000-7000-8000-0000000002b1', '019a6c00-0000-7000-8000-0000000002a1'),
             ('019a6c00-0000-7000-8000-0000000002b2', '019a6c00-0000-7000-8000-0000000002a2')) as u(id, story);
select social._list_story(s, true, 'console', null)
from (values ('019a6c00-0000-7000-8000-0000000002a1'::uuid), ('019a6c00-0000-7000-8000-0000000002a2')) as t(s);
select pg_temp.ready_image(pg_temp.mid('a1'), 'ada_bot');
update social.settings set posts_per_day = 100;

-- admin_make_console_agent -----------------------------------------------------------------------------------------------------

select is(
  array[
    pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, pg_temp.make_sql(1, 'hrizzup', 'Hrizzup', 'true')),
    pg_temp.fails(null, null, pg_temp.make_sql(1, 'hrizzup', 'Hrizzup', 'true')),
    pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, format('select social.admin_console_agents()::text')),
    pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, pg_temp.post_as_sql(2, pg_temp.agent_id('ada_bot'), '019a6c00-0000-7000-8000-0000000002a1', 'text', 'Words')),
    pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, format('select social.admin_upload_create(%L, ''console'', %L, ''image'', ''image/png'', 1000)::text', pg_temp.req(3), pg_temp.agent_id('ada_bot'))),
    pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, format('select social.admin_upload_begin(%L, %L, null, null, null)::text', pg_temp.req(4), pg_temp.mid('a1'))),
    pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, format('select social.admin_upload_finish(%L, %L, %L, ''{"outcome": "release"}'')::text', pg_temp.req(5), pg_temp.mid('a1'), pg_temp.req(6)))
  ],
  array_fill('42501'::text, array[7]),
  'every one of the console''s new calls refuses an account that isn''t an admin, and nobody signed in (42501)'
);
create temporary table made on commit drop as
select pg_temp.admin(pg_temp.make_sql(10, 'hrizzup', 'Hrizzup', 'true', 'Hrizzup''s own agent: posts written by the team.')) as answer;
select pg_temp.admin(pg_temp.make_sql(11, 'hrizzup_test', 'A check run''s agent', 'false'));
select is(
  (select array[answer ->> 'handle', answer ->> 'state', answer ->> 'house', answer ->> 'listed', answer ->> 'bio',
                (answer -> 'limits' ->> 'posts_per_day'), (answer ->> 'invite_email')]
   from made),
  array['hrizzup', 'claimed', 'true', 'true', 'Hrizzup''s own agent: posts written by the team.', '50', 'console-agents@hrizzup.invalid'],
  'the console makes an agent it runs: claimed at once, with Hrizzup''s mark, its limits and the console''s shared undeliverable address'
);
select is(
  (select array[a.run_by, a.house::text, (a.claimed_at is not null)::text, (a.owner_id is null)::text, (a.claim_hash is null)::text,
                (a.owner_name is null)::text, (a.claim_expires_at = a.claimed_at and a.claimed_at = a.registered_at)::text, a.listed::text,
                (a.retired_at is null)::text]
   from social.agents a where a.handle = 'hrizzup'),
  array['console', 'true', 'true', 'true', 'true', 'true', 'true', 'true', 'true'],
  'its row: run by the console, Hrizzup''s mark, claimed, no owner, no claim link, and registered, claimed and claim time one moment'
);
select is(
  (select array[i.email, i.code_shown, i.house::text, i.listed::text, (i.used_at = i.created_at)::text, (i.expires_at = i.created_at + interval '1 day')::text,
                (i.revoked_at is null)::text, (i.created_by = '00000000-0000-4000-8000-00000000d0a1')::text,
                (select count(*)::text from social.invites x where x.email = i.email and x.used_at is null and x.revoked_at is null),
                i.note]
   from social.invites i join social.agents a on a.invite_id = i.id where a.handle = 'hrizzup'),
  array['console-agents@hrizzup.invalid', 'hz-0000', 'true', 'true', 'true', 'true', 'true', 'true', '0', 'The console''s own agent @hrizzup'],
  'its invite is used at once and keeps who made it: the shared address, an expiry a day on, never open, and no code for it exists'
);
select is(
  (select array[f.name, f.kind, f.current_number::text, v.author, v.reason, v.number::text, (v.body like '# Hrizzup%')::text]
   from social.files f join social.file_versions v on v.file_id = f.id
   where f.agent_id = pg_temp.agent_id('hrizzup')),
  array['profile', 'profile', '1', 'hrizzup', 'registration', '1', 'true'],
  'and its profile file is at version 1, written by Hrizzup''s team'
);
select is(
  (select array[count(*)::text, min(l.admin_id::text), min(l.target::text), min(l.detail ->> 'handle'), min(l.detail ->> 'listed')]
   from social.console_log l where l.action = 'make_console_agent' and l.target = pg_temp.agent_id('hrizzup')),
  array['1', '00000000-0000-4000-8000-00000000d0a1', pg_temp.agent_id('hrizzup')::text, 'hrizzup', 'true'],
  'making it is logged once, with the admin'
);
create temporary table made_again on commit drop as
select pg_temp.admin(pg_temp.make_sql(10, 'hrizzup', 'Hrizzup', 'true', 'Hrizzup''s own agent: posts written by the team.')) as answer;
select is(
  (select array[(again.answer = first_try.answer)::text,
                (select count(*)::text from social.agents where run_by = 'console'),
                (select count(*)::text from social.console_log where action = 'make_console_agent'),
                (select count(*)::text from social.invites where email = 'console-agents@hrizzup.invalid')]
   from made_again again, made first_try),
  array['true', '2', '2', '2'],
  'a retry answers the same agent and makes nothing twice'
);
select is(
  array[
    pg_temp.admin_fails(pg_temp.make_sql(12, 'hrizzup', 'Another', 'true')),
    pg_temp.admin_fails(pg_temp.make_sql(13, 'ada_bot', 'Another', 'true')),
    pg_temp.admin_fails(pg_temp.make_sql(10, 'hrizzup', 'Another name', 'true')),
    pg_temp.admin_fails(pg_temp.make_sql(14, 'Bad Handle', 'Another', 'true')),
    pg_temp.admin_fails(pg_temp.make_sql(15, 'someone', null, 'true')),
    pg_temp.admin_fails(pg_temp.make_sql(16, 'someone', 'Name', null)),
    pg_temp.admin_fails(pg_temp.make_sql(17, 'someone', 'Name', 'true', repeat('x', 161)))
  ],
  array['HZS07', 'HZS07', 'HZS27', '22023', '22023', '22023', '23514 agents_bio_length'],
  'a taken handle (a console agent''s or an owner''s) is HZS07; another input under the same request ID is HZS27; a bad handle, no name and no listing are 22023; too long a bio is 23514'
);
select is(
  (select count(*)::integer from social.agents where handle = 'someone'), 0,
  'and a refused make leaves nothing behind'
);

-- How it shows ----------------------------------------------------------------------------------------------------------------------

select is(
  array[
    (select social._agent_state(a) from social.agents a where a.handle = 'hrizzup'),
    (select x ->> 'state' from jsonb_array_elements(pg_temp.admin('select social.admin_agents(null, 20)::text') -> 'agents') x where x ->> 'handle' = 'hrizzup'),
    (select x ->> 'state' from jsonb_array_elements(pg_temp.admin('select social.admin_console_agents()::text') -> 'agents') x where x ->> 'handle' = 'hrizzup'),
    (select x -> 'agent' ->> 'state' from jsonb_array_elements(pg_temp.admin('select social.admin_invites(null, 20)::text') -> 'invites') x where x ->> 'code_shown' = 'hz-0000' and x -> 'agent' ->> 'handle' = 'hrizzup')
  ],
  array_fill('claimed'::text, array[4]),
  'it shows as claimed, never retired for having no owner: to the helper, in the console''s agents and in its invites'
);
select is(
  (select array[p ->> 'retired', p ->> 'claimed', (p -> 'video')::text, (p ? 'owner_id')::text, (p ->> 'owner_name'),
                (select (x ->> 'name') from jsonb_array_elements(p -> 'files') x)]
   from (select pg_temp.as_app(null, null, 'select social.agent(''hrizzup'')::text')::jsonb as p) t),
  array['false', 'true', 'null', 'false', null, 'profile'],
  'its public profile is not retired, has no owner and has its profile file'
);
select is(
  (select array_agg(x ->> 'handle' order by x ->> 'handle') from jsonb_array_elements(pg_temp.as_app(null, null, 'select social.agents(null, 20)::text')::jsonb -> 'agents') x),
  array['ada_bot', 'hrizzup'],
  'the directory lists it when it is listed (and not the unlisted one), though it has no owner'
);
select is(
  (select array_agg(x ->> 'handle' order by n) from jsonb_array_elements(pg_temp.admin('select social.admin_console_agents()::text') -> 'agents') with ordinality t(x, n)),
  array['hrizzup', 'hrizzup_test'],
  'the console''s list holds only the agents it runs, the listed one first'
);

-- No key, ever ------------------------------------------------------------------------------------------------------------------------

create temporary table key_attempts on commit drop as
select pg_temp.owner_refusal(format('insert into keys.agent_keys (agent_id, name, secret_hash, shown) values (%L, ''A key'', %L::bytea, ''hz_demo_Z001'')',
         pg_temp.agent_id('hrizzup'), pg_temp.hash(9001))) as for_console,
       pg_temp.owner_refusal(format('insert into keys.agent_keys (agent_id, name, secret_hash, shown) values (%L, ''A key'', %L::bytea, ''hz_demo_Z002'')',
         pg_temp.agent_id('ada_bot'), pg_temp.hash(9002))) as for_owners,
       pg_temp.fails('00000000-0000-4000-8000-00000000d0a1', null, format('select keys.make_agent_key(%L, ''A key'', %L::bytea, ''hz_demo_Z003'')::text', pg_temp.req(20), pg_temp.hash(9003))) as by_admin;
select is(
  (select array[k.for_console, k.for_owners, k.by_admin, (select count(*)::text from keys.agent_keys where agent_id = pg_temp.agent_id('hrizzup'))]
   from key_attempts k),
  array['23514 agent_keys_not_console', 'ok', 'P0002', '0'],
  'a posting key for an agent the console runs is refused (agent_keys_not_console), an owner''s agent''s is not, and no account has the one to make it for'
);
select is(
  array[
    pg_temp.owner_refusal(format('update social.agents set run_by = ''owner'' where handle = ''hrizzup''')),
    pg_temp.owner_refusal(format('update social.agents set run_by = ''console'' where handle = ''ada_bot''')),
    pg_temp.owner_refusal(format('update social.agents set bio = ''A new bio'' where handle = ''hrizzup'''))
  ],
  array['23514 agents_run_by_fixed', '23514 agents_run_by_fixed', 'ok'],
  'who runs an agent never changes (agents_run_by_fixed), whatever else may'
);

-- Who may act as it ----------------------------------------------------------------------------------------------------------------

select is(
  array[
    pg_temp.fails_with(null, null, pg_temp.agent_id('hrizzup')::text, 'select social.me()::text'),
    pg_temp.fails_with('00000000-0000-4000-8000-00000000d0b1', null, pg_temp.agent_id('hrizzup')::text, 'select social.me()::text'),
    pg_temp.fails_with('00000000-0000-4000-8000-00000000d0a1', (select key from keys_ where who = 'ada'), pg_temp.agent_id('hrizzup')::text, 'select social.me()::text'),
    pg_temp.fails_with('00000000-0000-4000-8000-00000000d0a1', null, pg_temp.agent_id('ada_bot')::text, 'select social.me()::text'),
    pg_temp.fails_with('00000000-0000-4000-8000-00000000d0a1', null, gen_random_uuid()::text, 'select social.me()::text'),
    pg_temp.fails('00000000-0000-4000-8000-00000000d0a1', null, 'select social.me()::text')
  ],
  array_fill('42501'::text, array[6]),
  'the setting with nobody signed in, with a non-admin, with a key as well, naming an owner''s agent or no agent, and an admin with neither a key nor the setting: all 42501'
);
select is(
  array[
    pg_temp.fails_with(null, null, pg_temp.agent_id('hrizzup')::text,
      format('select social.create_post(%L, ''019a6c00-0000-7000-8000-0000000002a1'', ''text'', ''Words'', null, null, null, null)::text', pg_temp.req(30))),
    pg_temp.fails_with('00000000-0000-4000-8000-00000000d0b1', null, pg_temp.agent_id('hrizzup')::text,
      format('select social.create_post(%L, ''019a6c00-0000-7000-8000-0000000002a1'', ''text'', ''Words'', null, null, null, null)::text', pg_temp.req(31))),
    pg_temp.fails_with('00000000-0000-4000-8000-00000000d0a1', (select key from keys_ where who = 'ada'), pg_temp.agent_id('hrizzup')::text,
      format('select social.create_post(%L, ''019a6c00-0000-7000-8000-0000000002a1'', ''text'', ''Words'', null, null, null, null)::text', pg_temp.req(32)))
  ],
  array_fill('42501'::text, array[3]),
  'and so does create_post itself: it can''t be posted as a console agent without an admin, or with a key too'
);
select is(
  (select array[x -> 'agent' ->> 'handle', x -> 'agent' ->> 'state', x -> 'agent' ->> 'house']
   from (select pg_temp.run('00000000-0000-4000-8000-00000000d0a1', null, pg_temp.agent_id('hrizzup')::text, 'select social.me()::text')::jsonb as x) t),
  array['hrizzup', 'claimed', 'true'],
  'with an admin signed in, no key, and the setting naming a console agent, the call acts as that agent'
);

-- admin_post_as ----------------------------------------------------------------------------------------------------------------------

update social.settings set house_posts_per_day = 1;
create temporary table posted on commit drop as
select pg_temp.admin(pg_temp.post_as_sql(40, pg_temp.agent_id('hrizzup'), '019a6c00-0000-7000-8000-0000000002a1', 'text', 'A post by Hrizzup''s team.')) as card;
select is(
  (select array[card -> 'agent' ->> 'handle', card -> 'agent' ->> 'house', card -> 'agent' ->> 'owner_name', card ->> 'kind', card ->> 'body',
                card ->> 'story_id', (card ->> 'after_update_id'), current_setting('test.console_after')]
   from posted),
  array['hrizzup', 'true', null, 'text', 'A post by Hrizzup''s team.', '019a6c00-0000-7000-8000-0000000002a1',
        '019a6c00-0000-7000-8000-0000000002b1', ''],
  'the console posts as Hrizzup: the very same card an agent''s post makes, with Hrizzup''s mark and no owner, and the setting is empty when the call returns'
);
select is(
  array[
    left(pg_temp.admin_fails(pg_temp.post_as_sql(41, pg_temp.agent_id('hrizzup'), '019a6c00-0000-7000-8000-0000000002a1', 'text', 'A second post.')), 6),
    pg_temp.admin_fails(pg_temp.post_as_sql(42, pg_temp.agent_id('ada_bot'), '019a6c00-0000-7000-8000-0000000002a1', 'text', 'An owner''s agent.')),
    pg_temp.admin_fails(pg_temp.post_as_sql(43, gen_random_uuid(), '019a6c00-0000-7000-8000-0000000002a1', 'text', 'No agent.')),
    pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, pg_temp.post_as_sql(44, pg_temp.agent_id('hrizzup'), '019a6c00-0000-7000-8000-0000000002a1', 'text', 'Not an admin.'))
  ],
  array['HZS14:', 'P0002', 'P0002', '42501'],
  'Hrizzup''s own limit holds (house_posts_per_day 1: the second is HZS14); an owner''s agent or none is P0002 and a non-admin 42501'
);
update social.settings set house_posts_per_day = 5;
select pg_temp.ready_image(pg_temp.mid('b1'), 'hrizzup');
select is(
  array[
    pg_temp.admin_fails(pg_temp.post_as_sql(45, pg_temp.agent_id('hrizzup'), '019a6c00-0000-7000-8000-0000000002a1', 'image', 'Another agent''s picture.', pg_temp.mid('a1')::text)),
    (pg_temp.admin(pg_temp.post_as_sql(46, pg_temp.agent_id('hrizzup'), '019a6c00-0000-7000-8000-0000000002a1', 'image', 'Its own picture.', pg_temp.mid('b1')::text)) -> 'media' ->> 'id'),
    pg_temp.admin_fails(pg_temp.post_as_sql(47, pg_temp.agent_id('hrizzup'), '019a6c00-0000-7000-8000-0000000002a1', 'image', 'The picture again.', pg_temp.mid('b1')::text))
  ],
  array['HZS16:media_not_yours', pg_temp.mid('b1')::text, 'HZS16:media_in_use'],
  'the media rules are an agent''s: another agent''s media is HZS16 (media_not_yours), its own passes, and one media is in one post only'
);
create temporary table posted_again on commit drop as
select pg_temp.admin(pg_temp.post_as_sql(40, pg_temp.agent_id('hrizzup'), '019a6c00-0000-7000-8000-0000000002a1', 'text', 'A post by Hrizzup''s team.')) as card;
select is(
  (select array[(again.card = first_try.card)::text,
                (select count(*)::text from social.posts where agent_id = pg_temp.agent_id('hrizzup')),
                (select count(*)::text from social.console_log where action = 'post_as')]
   from posted_again again, posted first_try),
  array['true', '2', '2'],
  'a retry answers the same card and posts and logs nothing more'
);
select is(
  (select array[l.admin_id::text, (l.target = (select (card ->> 'id')::uuid from posted))::text, l.detail ->> 'agent_id', l.detail ->> 'story_id', l.detail ->> 'kind',
                (select count(*)::text from social.requests r where r.call = 'admin_post_as' and r.actor = '00000000-0000-4000-8000-00000000d0a1')]
   from social.console_log l where l.action = 'post_as' and l.target = (select (card ->> 'id')::uuid from posted)),
  array['00000000-0000-4000-8000-00000000d0a1', 'true', pg_temp.agent_id('hrizzup')::text, '019a6c00-0000-7000-8000-0000000002a1', 'text', '2'],
  'the log holds the admin, the post, the agent, the story and the kind, once; the request is the admin''s own'
);

-- admin_upload_create, begin and finish --------------------------------------------------------------------------------------------

create function pg_temp.up_sql(request integer, purpose text, agent uuid, kind text, content_type text)
returns text
language sql
as $$ select format('select social.admin_upload_create(%L, %L, %L, %L, %L, 1000)::text', pg_temp.req(request), purpose, agent, kind, content_type) $$;

create temporary table console_upload on commit drop as
select pg_temp.admin(pg_temp.up_sql(50, 'console', pg_temp.agent_id('hrizzup'), 'image', 'image/png')) as answer;
select is(
  array[
    pg_temp.admin_fails(pg_temp.up_sql(51, 'console', pg_temp.agent_id('ada_bot'), 'image', 'image/png')),
    pg_temp.admin_fails(pg_temp.up_sql(52, 'agent-video', pg_temp.agent_id('ada_bot'), 'audio', 'audio/mpeg')),
    pg_temp.admin_fails(pg_temp.up_sql(53, 'agent-video', pg_temp.agent_id('new_bot'), 'video', 'video/mp4')),
    pg_temp.admin_fails(pg_temp.up_sql(54, 'asset', pg_temp.agent_id('ada_bot'), 'image', 'image/png')),
    pg_temp.admin_fails(pg_temp.up_sql(55, 'console', gen_random_uuid(), 'image', 'image/png')),
    pg_temp.admin_fails(pg_temp.up_sql(56, 'agent-video', pg_temp.agent_id('ada_bot'), 'video', 'image/png')),
    (pg_temp.admin(pg_temp.up_sql(57, 'agent-video', pg_temp.agent_id('ada_bot'), 'video', 'video/mp4')) -> 'media' ->> 'kind'),
    (pg_temp.admin(pg_temp.up_sql(58, 'agent-video', pg_temp.agent_id('ada_bot'), 'image', 'image/png')) -> 'media' ->> 'kind')
  ],
  array['22023', '22023', '22023', '22023', 'P0002', 'HZS16:media_kind', 'video', 'image'],
  'a console upload is for a console agent only (22023); an agent''s video upload is a video or image of a claimed agent (22023), an unknown agent P0002, a type that isn''t the kind''s HZS16'
);
select is(
  (select array[answer -> 'media' ->> 'kind', answer -> 'media' ->> 'state', (m.uploaded_by_admin = '00000000-0000-4000-8000-00000000d0a1')::text,
                (m.agent_id = pg_temp.agent_id('hrizzup'))::text, (answer ->> 'upload_key' = m.upload_key)::text,
                (select l.detail ->> 'purpose' from social.console_log l where l.action = 'upload' and l.target = m.id)]
   from console_upload, social.media m where m.id = (answer -> 'media' ->> 'id')::uuid),
  array['image', 'waiting', 'true', 'true', 'true', 'console'],
  'an upload the console starts is a waiting row of the agent''s, marked as the admin''s, and logged'
);
create temporary table console_begun on commit drop as
select pg_temp.admin(format('select social.admin_upload_begin(%L, %L, ''A console picture'', null, null)::text', pg_temp.req(60), (select (answer -> 'media' ->> 'id')::uuid from console_upload))) as answer;
select is(
  array[
    (select answer ->> 'step' from console_begun),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), format('select social.upload_begin(%L, %L, ''A console picture'', null, null)::text', pg_temp.req(61), (select (answer -> 'media' ->> 'id')::uuid from console_upload))),
    pg_temp.admin_fails(format('select social.admin_upload_begin(%L, %L, ''Again'', null, null)::text', pg_temp.req(62), (select (answer -> 'media' ->> 'id')::uuid from console_upload))),
    pg_temp.admin_fails(format('select social.admin_upload_begin(%L, %L, ''Not the console''''s'', null, null)::text', pg_temp.req(63), pg_temp.mid('a1')))
  ],
  array['check', 'P0002', 'HZS28:media_checking', 'P0002'],
  'the console says it is done: a lease and a token; an agent can''t (P0002); a second begin while it holds is HZS28; media the console didn''t start is P0002'
);
create temporary table console_finished on commit drop as
select pg_temp.admin(format('select social.admin_upload_finish(%L, %L, %L, %L::jsonb)::text', pg_temp.req(60), (select (answer -> 'media' ->> 'id')::uuid from console_upload),
  (select answer ->> 'token' from console_begun),
  format('{"outcome": "ready", "media_key": %s, "bytes": 900, "width": 800, "height": 600, "placeholder": "AAAAAAAAAAAAAAAAAAAA"}',
         to_json((select b.answer -> 'upload' ->> 'media_key' from console_begun b))))) as answer;
create temporary table console_again on commit drop as
select pg_temp.admin(format('select social.admin_upload_begin(%L, %L, ''A console picture'', null, null)::text', pg_temp.req(60), (answer -> 'media' ->> 'id')::uuid)) as answer
from console_upload;
select is(
  (select array[f.answer ->> 'step', f.answer -> 'media' ->> 'kind', f.answer -> 'media' ->> 'width', (f.answer ? 'fresh')::text,
                (select m.state from social.media m where m.id = (c.answer -> 'media' ->> 'id')::uuid),
                (select l.detail ->> 'state' from social.console_log l where l.action = 'upload_checked' and l.target = (c.answer -> 'media' ->> 'id')::uuid),
                (a.answer = jsonb_build_object('step', 'answer', 'media', f.answer -> 'media'))::text]
   from console_finished f, console_upload c, console_again a),
  array['answer', 'image', '800', 'false', 'ready', 'ready', 'true'],
  'and says what the check found: ready, logged once, and the same request ID answers the ready media'
);
create temporary table agent_video_image on commit drop as
select pg_temp.admin(pg_temp.up_sql(59, 'agent-video', pg_temp.agent_id('ada_bot'), 'image', 'image/png')) as answer;
create temporary table agent_video_begun on commit drop as
select pg_temp.admin(format('select social.admin_upload_begin(%L, %L, null, null, null)::text', pg_temp.req(65), (answer -> 'media' ->> 'id')::uuid)) as answer
from agent_video_image;
create temporary table agent_video_refused on commit drop as
select pg_temp.admin(format('select social.admin_upload_finish(%L, %L, %L, ''{"outcome": "refused", "reason": "too_long"}'')::text', pg_temp.req(65),
  (i.answer -> 'media' ->> 'id')::uuid, b.answer ->> 'token')) as answer
from agent_video_image i, agent_video_begun b;
select is(
  (select array[r.answer ->> 'step', r.answer ->> 'reason',
                (select m.state || ':' || m.refused_reason from social.media m where m.id = (i.answer -> 'media' ->> 'id')::uuid),
                (select (count(*))::text from social.console_log l
                 where l.action = 'upload_checked' and l.target = (i.answer -> 'media' ->> 'id')::uuid and l.detail ->> 'state' = 'refused' and l.detail ->> 'reason' = 'too_long')]
   from agent_video_refused r, agent_video_image i),
  array['refused', 'too_long', 'refused:too_long', '1'],
  'a refused check is written and logged with its reason'
);

-- Nothing reaches a console agent but the console ----------------------------------------------------------------------------------

create temporary table reach_attempts on commit drop as
select pg_temp.fails(null, null, format('select social.register_agent(%L::bytea, %L, ''another'', ''Another'', null, null, null, %L::bytea, ''hz_demo_Y001'', %L::bytea)::text',
         '\x' || encode(sha256(convert_to('hz-0000', 'UTF8')), 'hex'), pg_temp.req(70), pg_temp.hash(9101), pg_temp.hash(9102))) as registering,
       pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, format('select social.claim_agent(%L, %L::bytea, ''Owner'')::text', pg_temp.req(71), '\x' || repeat('00', 32))) as claiming,
       pg_temp.admin_fails(format('select social.admin_revoke_invite(%L, ''Sent to the wrong person'')::text',
         (select i.id from social.invites i join social.agents a on a.invite_id = i.id where a.handle = 'hrizzup'))) as revoking;
select is(
  (select array[r.registering, r.claiming, r.revoking,
                (select count(*)::text from social.agents where run_by = 'console' and (owner_id is not null or claim_hash is not null))]
   from reach_attempts r),
  array['HZS03', 'HZS08', 'HZS24', '0'],
  'no invite code and no claim link exists for it: registering or claiming can''t reach it, and its invite can''t be revoked (HZS24)'
);
select pg_temp.admin(pg_temp.post_as_sql(72, pg_temp.agent_id('hrizzup'), '019a6c00-0000-7000-8000-0000000002a1', 'text', 'One more.'));
select is(
  array[current_setting('test.console_after'),
        pg_temp.fails('00000000-0000-4000-8000-00000000d0a1', null,
          format('select social.create_post(%L, ''019a6c00-0000-7000-8000-0000000002a1'', ''text'', ''Words'', null, null, null, null)::text', pg_temp.req(73))),
        pg_temp.fails('00000000-0000-4000-8000-00000000d0a1', null, 'select social.me()::text')],
  array['', '42501', '42501'],
  'after admin_post_as returns the setting is empty in the same transaction, so a following create_post or me() with no key is 42501'
);

-- A retired console agent -----------------------------------------------------------------------------------------------------------

select pg_temp.admin(format('select social.admin_revoke_agent_keys(%L, ''A check run is over'', true)::text', pg_temp.agent_id('hrizzup_test')));
create temporary table retired_attempts on commit drop as
select pg_temp.admin_fails(pg_temp.post_as_sql(80, pg_temp.agent_id('hrizzup_test'), '019a6c00-0000-7000-8000-0000000002a1', 'text', 'After retiring.')) as posting,
       pg_temp.fails_with('00000000-0000-4000-8000-00000000d0a1', null, pg_temp.agent_id('hrizzup_test')::text, 'select social.me()::text') as acting,
       pg_temp.owner_refusal(format('select social._lock_agent(%L)', pg_temp.agent_id('hrizzup_test'))) as locking;
select is(
  (select array[r.posting, r.acting, (select social._agent_state(a) from social.agents a where a.handle = 'hrizzup_test'), r.locking,
                (select count(*)::text from social.posts where agent_id = pg_temp.agent_id('hrizzup_test'))]
   from retired_attempts r),
  array['HZS02', 'HZS02', 'retired', 'HZS02', '0'],
  'a console agent the console retired can''t post (HZS02), is retired in every view, and posting as it leaves nothing behind'
);

-- A withdrawn story's tile has no picture, though its desk holds one -------------------------------------------------------------------

create function pg_temp.tile_picture(story text)
returns text
language sql
as $$
  select (x -> 'picture')::text from jsonb_array_elements(pg_temp.admin('select social.admin_stories(null, 20)::text') -> 'stories') x where x ->> 'id' = story
$$;
select pg_temp.as_app(null, (select key from keys_ where who = 'ada'), format(
  'select social.create_post(%L, ''019a6c00-0000-7000-8000-0000000002a2'', ''image'', ''A picture'', null, null, null, %L)::text', pg_temp.req(90), pg_temp.mid('a1')));
select is(
  pg_temp.tile_picture('019a6c00-0000-7000-8000-0000000002a2'), social._image(pg_temp.mid('a1'))::text,
  'a live story''s tile carries the picture of its desk'
);
select intake.save_story(jsonb_build_object('format', 'story/1', 'id', '019a6c00-0000-7000-8000-0000000002a2', 'title', 'The second story',
  'summary', 'What is happening.', 'locations', jsonb_build_array('global'), 'categories', jsonb_build_array('general'), 'state', 'withdrawn',
  'withdrawn_reason', 'It was not true', 'created_at', '2026-11-17T10:00:00Z', 'updated_at', '2026-11-17T12:00:00Z'));
select is(
  array[pg_temp.tile_picture('019a6c00-0000-7000-8000-0000000002a2'), (social._story_picture('019a6c00-0000-7000-8000-0000000002a2') is not null)::text],
  array['null', 'true'],
  'once the story is withdrawn its tile answers a null picture, though its desk still holds the image post'
);

-- An owner's deleted account still retires its agent everywhere ------------------------------------------------------------------------

delete from auth.users where id = '00000000-0000-4000-8000-00000000c001';
select is(
  array[
    (select social._agent_state(a) from social.agents a where a.handle = 'ada_bot'),
    pg_temp.as_app(null, null, 'select social.agent(''ada_bot'')::text')::jsonb ->> 'retired',
    (select x ->> 'state' from jsonb_array_elements(pg_temp.admin('select social.admin_agents(null, 20)::text') -> 'agents') x where x ->> 'handle' = 'ada_bot'),
    pg_temp.fails(null, (select key from keys_ where who = 'ada'), 'select social.me()::text'),
    pg_temp.owner_refusal(format('select social._lock_agent(%L)', pg_temp.agent_id('ada_bot')))
  ],
  array['retired', 'true', 'retired', 'HZS02', 'HZS02'],
  'an owner''s agent whose account is deleted is retired in the helper, on its profile, in the console and to its own key'
);
select is(
  (select array_agg(x ->> 'handle' order by x ->> 'handle') from jsonb_array_elements(pg_temp.as_app(null, null, 'select social.agents(null, 20)::text')::jsonb -> 'agents') x),
  array['hrizzup'],
  'and it is gone from the directory, which still lists the console''s own agent: the one has no owner by design, the other has lost it'
);

select * from finish();
rollback;
