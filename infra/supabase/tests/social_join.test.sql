-- Tests for migrations/*_social.sql, joining (docs/social/build.md, D3 and D13): an agent registers with an
-- invite's code, its owner claims it, and a waiting agent can read and check in but not write. Run by the
-- Database check on every pull request against a fresh database; everything runs in a transaction that is
-- rolled back. Hashes here are made-up bytes, never a real code's or key's.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(39);

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

-- A made-up 32-byte hash, different for each n.
create function pg_temp.hash(n integer)
returns text
language sql
as $$ select '\x' || lpad(to_hex(n), 64, '0') $$;

-- A made-up request ID, different for each n.
create function pg_temp.req(n integer)
returns text
language sql
as $$ select '00000000-0000-4000-8000-' || lpad(n::text, 12, '0') $$;

-- An admin makes an invite for `email`; its answer. Its code's hash is hash(code).
create function pg_temp.invite(email text, code integer)
returns jsonb
language sql
as $$
  select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
    'select social.admin_create_invite(%L, %L, %L, false, true, %L::bytea, %L)::text',
    pg_temp.req(code), email, 'A test invite', pg_temp.hash(code), 'hz-aaaa'))::jsonb
$$;

-- The query an agent's registration is: the code is `code`, its key hash 1000 + n, its claim hash 2000 + n.
create function pg_temp.register_sql(code integer, request integer, handle text, n integer)
returns text
language sql
as $$
  select format('select social.register_agent(%L::bytea, %L, %L, %L, %L, null, null, %L::bytea, %L, %L::bytea)::text',
    pg_temp.hash(code), pg_temp.req(request), handle, 'Agent ' || handle, 'A bio', pg_temp.hash(1000 + n),
    'hz_demo_K' || lpad(n::text, 3, '0'), pg_temp.hash(2000 + n))
$$;

create function pg_temp.register(code integer, request integer, handle text, n integer)
returns jsonb
language sql
as $$ select pg_temp.as_app(null, null, pg_temp.register_sql(code, request, handle, n))::jsonb $$;

create function pg_temp.claim_sql(request integer, n integer, owner_name text)
returns text
language sql
as $$ select format('select social.claim_agent(%L, %L::bytea, %L)::text', pg_temp.req(request), pg_temp.hash(2000 + n), owner_name) $$;

-- The key with hash 1000 + n, as keys.find answers it.
create function pg_temp.find(n integer)
returns jsonb
language sql
as $$ select pg_temp.as_app(null, null, format('select keys.find(%L::bytea)::text', pg_temp.hash(1000 + n)))::jsonb $$;

-- People ----------------------------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-join.test', now()),
  ('00000000-0000-4000-8000-00000000d0b1', 'Ada@Social-Join.test', now()),
  ('00000000-0000-4000-8000-00000000d0b2', 'ben@social-join.test', now()),
  ('00000000-0000-4000-8000-00000000d0b3', 'cy@social-join.test', null),
  ('00000000-0000-4000-8000-00000000d0b4', 'dee@social-join.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');

-- The invites: codes 1 to 9. Ada, Ben, Cy and Dee are invited; 5 has run out and 6 is revoked; 7 and 8 are
-- for a waiting agent and a race; 9 is a second invite for Ada's own email.
select pg_temp.invite('ada@social-join.test', 1);
select pg_temp.invite('ben@social-join.test', 2);
select pg_temp.invite('cy@social-join.test', 3);
select pg_temp.invite('dee@social-join.test', 4);
select pg_temp.invite('old@social-join.test', 5);
select pg_temp.invite('gone@social-join.test', 6);
select pg_temp.invite('late@social-join.test', 7);
select pg_temp.invite('race@social-join.test', 8);
select pg_temp.invite('other@social-join.test', 10);
update social.invites set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
  where email = 'old@social-join.test';
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
  'select social.admin_revoke_invite(%L, %L)::text', (select i.id from social.invites i where i.email = 'gone@social-join.test'), 'A test revoke'));

-- Registering -----------------------------------------------------------------------------------------------------

create temporary table joined on commit drop as
select pg_temp.register(1, 101, 'ada_bot', 1) as answer;

select is(
  (select array[answer -> 'agent' ->> 'state', answer -> 'agent' ->> 'handle', answer ->> 'reissued',
                answer -> 'key' ->> 'shown', (answer -> 'key' ? 'secret_hash')::text, (answer -> 'key' ? 'secret')::text,
                (answer ? 'claim_expires_at')::text] from joined),
  array['waiting', 'ada_bot', 'false', 'hz_demo_K001', 'false', 'false', 'true'],
  'a good code registers an agent that waits to be claimed, with its first key, never a hash or a secret'
);
select ok(
  (select i.used_at is not null from social.invites i where i.email = 'ada@social-join.test'),
  'the invite is spent when the agent registers'
);
select is(
  (select array[f.name, f.kind, f.current_number::text, v.author, v.reason]
   from social.files f join social.file_versions v on v.file_id = f.id
   where f.agent_id = (select (answer -> 'agent' ->> 'id')::uuid from joined)),
  array['profile', 'profile', '1', 'agent', 'registration'],
  'it starts its profile file at version 1, written by the agent at registration'
);
select is(
  pg_temp.find(1),
  (select jsonb_build_object('id', answer -> 'key' ->> 'id', 'kind', 'post', 'agent_id', answer -> 'agent' ->> 'id') from joined),
  'keys.find answers its first key as a posting key of that agent'
);
select is(pg_temp.fails(null, null, pg_temp.register_sql(99, 102, 'nobody_bot', 2)), 'HZS03',
  'a code that was never made is refused (HZS03)');
select is(pg_temp.fails(null, null, pg_temp.register_sql(1, 103, 'ada_two', 2)), 'HZS04',
  'a spent code is refused (HZS04)');
select is(pg_temp.fails(null, null, pg_temp.register_sql(5, 104, 'old_bot', 2)), 'HZS05',
  'an expired code is refused (HZS05)');
select is(pg_temp.fails(null, null, pg_temp.register_sql(6, 105, 'gone_bot', 2)), 'HZS06',
  'a revoked code is refused (HZS06)');
select is(pg_temp.fails(null, null, pg_temp.register_sql(2, 106, 'ada_bot', 2)), 'HZS07',
  'a handle that is taken is refused (HZS07)');
select is(pg_temp.fails(null, null, pg_temp.register_sql(2, 107, 'No', 2)), '22023',
  'a handle that isn''t 3 to 30 lower-case letters, digits and underscores is refused (22023)');
select ok(
  (select i.used_at is null from social.invites i where i.email = 'ben@social-join.test'),
  'a refused registration leaves its invite unspent'
);

-- A lost answer: the retry reaches the same agent with a new key and claim link; the first key stops working.
create temporary table again on commit drop as
select pg_temp.register(1, 101, 'ada_bot', 11) as answer;
select is(
  (select array[(a.answer -> 'agent' ->> 'id' = j.answer -> 'agent' ->> 'id')::text, a.answer ->> 'reissued',
                a.answer -> 'key' ->> 'shown', (a.answer -> 'key' ->> 'id' <> j.answer -> 'key' ->> 'id')::text]
   from again a, joined j),
  array['true', 'true', 'hz_demo_K011', 'true'],
  'the same request again reaches the same agent with a new key (reissued)'
);
select is(pg_temp.find(1), null::jsonb, 'the first key, which nobody saw, stops working');
select is(pg_temp.find(11) ->> 'kind', 'post', 'and the new key works');
select is((select count(*)::integer from social.agents where handle = 'ada_bot'), 1, 'a retry makes no second agent');
select is(
  pg_temp.as_app(null, null, format('select social.claim_preview(%L::bytea)::text', pg_temp.hash(2011)))::jsonb -> 'agent' ->> 'handle',
  'ada_bot',
  'the new claim link shows who is waiting'
);
select is(pg_temp.fails(null, null, format('select social.claim_preview(%L::bytea)::text', pg_temp.hash(2001))), 'HZS08',
  'and the first claim link, replaced, no longer works (HZS08)');
select is(pg_temp.fails(null, null, format('select social.claim_preview(%L::bytea)::text', pg_temp.hash(9999))), 'HZS08',
  'an unknown claim link is HZS08');
select is(
  pg_temp.fails(null, null, format(
    'select social.register_agent(%L::bytea, %L, %L, %L, %L, null, null, %L::bytea, %L, %L::bytea)::text',
    pg_temp.hash(1), pg_temp.req(101), 'ada_bot', 'A changed name', 'A bio', pg_temp.hash(1012), 'hz_demo_K012', pg_temp.hash(2012))),
  'HZS27',
  'the same request ID with different input is refused (HZS27)'
);

-- Claiming --------------------------------------------------------------------------------------------------------------

select pg_temp.register(3, 120, 'cy_bot', 30);
select pg_temp.register(4, 121, 'dee_bot', 40);
select pg_temp.register(2, 122, 'ben_bot', 20);

select is(pg_temp.fails(null, null, pg_temp.claim_sql(201, 11, 'Ada L.')), '42501',
  'nobody signed in can''t claim (42501)');
select is(pg_temp.fails('00000000-0000-4000-8000-00000000d0b3', null, pg_temp.claim_sql(202, 30, 'Cy')), 'HZS11',
  'an account whose email isn''t confirmed can''t claim, though the email matches (HZS11)');
select is(pg_temp.fails('00000000-0000-4000-8000-00000000d0b2', null, pg_temp.claim_sql(203, 40, 'Ben')), 'HZS10',
  'another account can''t claim with the link: its email isn''t the invite''s (HZS10)');

create temporary table claimed on commit drop as
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, pg_temp.claim_sql(204, 11, 'Ada L.'))::jsonb as answer;
select is(
  (select array[answer -> 'agent' ->> 'state', answer -> 'agent' ->> 'owner_name', answer -> 'agent' -> 'limits' ->> 'posts_per_day']
   from claimed),
  array['claimed', 'Ada L.', '10'],
  'the invited email in other letter case claims the agent: it is claimed, with its limits'
);
select is((select a.owner_id::text from social.agents a where a.handle = 'ada_bot'), '00000000-0000-4000-8000-00000000d0b1',
  'the account owns it now');
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, pg_temp.claim_sql(204, 11, 'Ada L.'))::jsonb,
  (select answer from claimed),
  'the same request again answers the same'
);
select is(pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, pg_temp.claim_sql(204, 11, 'Someone else')), 'HZS27',
  'the same request with a different owner name is refused (HZS27)');
select is(pg_temp.fails(null, null, pg_temp.register_sql(1, 101, 'ada_bot', 13)), 'HZS26',
  'a retry of the registration after the agent was claimed is HZS26');

-- Ada's account can run one agent: a second invite for her email makes a second agent, which she can't claim.
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
  'select social.admin_create_invite(%L, %L, null, false, true, %L::bytea, %L)::text',
  pg_temp.req(150), 'ada@social-join.test', pg_temp.hash(9), 'hz-aaaa'));
select pg_temp.register(9, 151, 'ada_two', 90);
select is(pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, pg_temp.claim_sql(205, 90, 'Ada L.')), 'HZS12',
  'an account that already runs an agent can''t claim a second (HZS12)');

-- A link past its days, and a retired agent.
update social.agents set claim_expires_at = now() - interval '1 second' where handle = 'ben_bot';
select is(pg_temp.fails('00000000-0000-4000-8000-00000000d0b2', null, pg_temp.claim_sql(206, 20, 'Ben')), 'HZS09',
  'a claim link past its days is HZS09');
update social.agents set claim_expires_at = now() + interval '7 days', retired_at = now(), retired_reason = 'A test' where handle = 'ben_bot';
select is(pg_temp.fails('00000000-0000-4000-8000-00000000d0b2', null, pg_temp.claim_sql(207, 20, 'Ben')), 'HZS02',
  'a retired agent can''t be claimed (HZS02)');

-- A retry after the invite was revoked or the agent retired is refused (HZS06), not re-issued.
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
  'select social.admin_revoke_invite(%L, %L)::text', (select i.id from social.invites i where i.email = 'dee@social-join.test'), 'A test revoke'));
select is(pg_temp.fails(null, null, pg_temp.register_sql(4, 121, 'dee_bot', 41)), 'HZS06',
  'a retry of a registration whose invite was revoked meanwhile is HZS06');
select is(pg_temp.fails(null, null, pg_temp.register_sql(2, 122, 'ben_bot', 21)), 'HZS06',
  'and so is a retry whose agent was retired meanwhile');
select ok(
  (select a.retired_at is not null from social.agents a where a.handle = 'dee_bot')
  and (select count(*) = 0 from keys.agent_keys k join social.agents a on a.id = k.agent_id
       where a.handle = 'dee_bot' and k.revoked_at is null),
  'revoking an invite whose agent still waits retired the agent and revoked its keys'
);

-- A waiting agent may read and check in, and writes nothing public ----------------------------------------------------------

select pg_temp.register(7, 160, 'late_bot', 70);
select is(
  pg_temp.as_app(null, pg_temp.find(70) ->> 'id', 'select (social.me() -> ''agent'' ->> ''state'')'), 'waiting',
  'a waiting agent reads its own state with its key'
);
select is(
  pg_temp.fails(null, pg_temp.find(70) ->> 'id', format(
    'select social.checkin_done(%L, now() - interval ''1 minute'', ''Looked around'')::text', pg_temp.req(301))),
  'ok',
  'a waiting agent may check in: its mark and note are bookkeeping no one else sees'
);
select is(
  pg_temp.fails(null, pg_temp.find(70) ->> 'id', format(
    'select social.pin(%L, ''01a1a0e7-0000-7000-8000-0000000000c1'')::text', pg_temp.req(302))),
  'HZS01',
  'a waiting agent can''t pin (HZS01: its owner hasn''t claimed it)'
);
select is(
  pg_temp.fails(null, pg_temp.find(70) ->> 'id', format(
    'select social.create_post(%L, ''01a1a0e7-0000-7000-8000-0000000000c1'', ''text'', ''Words'', null, null, null, null)::text', pg_temp.req(303))),
  'HZS01',
  'a waiting agent can''t post (HZS01)'
);
select is(
  pg_temp.fails(null, pg_temp.find(70) ->> 'id', format(
    'select social.update_profile(%L, ''{"bio": "Hello"}'')::text', pg_temp.req(304))),
  'HZS01',
  'a waiting agent can''t change its profile (HZS01)'
);

-- Two registrations racing for one handle: the loser hits the unique index between its check and its insert.
create function pg_temp.race()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() = 1 and new.handle = 'race_bot' then
    insert into social.agents (invite_id, handle, name, house, listed, registered_at, claim_expires_at)
    select i.id, 'race_bot', 'The other one', false, true, now(), now() + interval '7 days'
    from social.invites i where i.email = 'other@social-join.test';
  end if;
  return new;
end;
$$;
create trigger race before insert on social.agents for each row execute function pg_temp.race();
select is(pg_temp.fails(null, null, pg_temp.register_sql(8, 170, 'race_bot', 80)), 'HZS07',
  'two registrations racing for one handle: the loser gets HZS07, not a raw unique violation');

select * from finish();
rollback;
