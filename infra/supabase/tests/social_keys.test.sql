-- Tests for migrations/*_social.sql, posting keys (docs/social/build.md, D1 and D13): keys.find answers every
-- kind of key; a posting key never trades and a trading key never posts; the agent-key guard; the key limits;
-- a retry makes a new key and revokes the first. Run by the Database check on every pull request against a fresh
-- database; everything runs in a transaction that is rolled back. Hashes here are made-up bytes.
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

-- The SQLSTATE a query as the app's role fails with (and its detail, after a colon, when it has one), or 'ok'.
create function pg_temp.fails(account text, api_key text, query text)
returns text
language plpgsql
as $$
declare
  detail text;
begin
  perform pg_temp.as_app(account, api_key, query);
  return 'ok';
exception when others then
  get stacked diagnostics detail = pg_exception_detail;
  reset role;
  perform set_config('hrizzup.api_key', '', true);
  return sqlstate || coalesce(':' || nullif(detail, ''), '');
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

-- The key with hash n, as keys.find answers it.
create function pg_temp.find(n integer)
returns jsonb
language sql
as $$ select pg_temp.as_app(null, null, format('select keys.find(%L::bytea)::text', pg_temp.hash(n)))::jsonb $$;

-- Ada's agent makes a new key (name, hash n); its answer.
create function pg_temp.make(request integer, name text, n integer)
returns text
language sql
as $$
  select pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, format(
    'select keys.make_agent_key(%L, %L, %L::bytea, %L)::text', pg_temp.req(request), name, pg_temp.hash(n),
    'hz_demo_M' || lpad((n % 1000)::text, 3, '0')))
$$;

-- People: an admin, Ada (who owns an agent), Ben (who owns none) ----------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-keys.test', now()),
  ('00000000-0000-4000-8000-00000000d0b1', 'ada@social-keys.test', now()),
  ('00000000-0000-4000-8000-00000000d0b2', 'ben@social-keys.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');
select ledger.open_account('00000000-0000-4000-8000-00000000d0b1', 1000);

select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
  'select social.admin_create_invite(%L, %L, null, false, true, %L::bytea, %L)::text',
  pg_temp.req(1), 'ada@social-keys.test', pg_temp.hash(1), 'hz-aaaa'));
create temporary table joined on commit drop as
select pg_temp.as_app(null, null, format(
  'select social.register_agent(%L::bytea, %L, %L, %L, null, null, null, %L::bytea, %L, %L::bytea)::text',
  pg_temp.hash(1), pg_temp.req(2), 'ada_bot', 'Ada''s agent', pg_temp.hash(1001), 'hz_demo_K001', pg_temp.hash(2001)))::jsonb as answer;
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format(
  'select social.claim_agent(%L, %L::bytea, %L)::text', pg_temp.req(3), pg_temp.hash(2001), 'Ada'));
-- Ada's own keys for the markets: a trading key (hash 5001) and a read-only key (hash 5002).
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format(
  'select keys.create(%L, %L, %L::bytea, %L)::text', 'Trading bot', 'trade', pg_temp.hash(5001), 'hz_demo_T001'));
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format(
  'select keys.create(%L, %L, %L::bytea, %L)::text', 'Reading bot', 'read', pg_temp.hash(5002), 'hz_demo_R001'));

-- keys.find ---------------------------------------------------------------------------------------------------------------------

select is(pg_temp.find(5001) ->> 'kind', 'trade', 'keys.find answers a trading key with its kind');
select is(pg_temp.find(5002) ->> 'kind', 'read', 'keys.find answers a read-only key with its kind');
select is(
  pg_temp.find(1001),
  (select jsonb_build_object('id', answer -> 'key' ->> 'id', 'kind', 'post', 'agent_id', answer -> 'agent' ->> 'id') from joined),
  'keys.find answers a posting key with its kind and its agent'
);
select is((pg_temp.find(5001) ->> 'user_id'), '00000000-0000-4000-8000-00000000d0b1', 'a trading key''s answer names its account');
select is(pg_temp.find(7777), null::jsonb, 'keys.find answers null for a key that was never made');
select is(
  pg_temp.as_app(null, null, format('select keys.verify(%L::bytea)::text', pg_temp.hash(1001))), null,
  'keys.verify, untouched, doesn''t know a posting key: it answers null'
);
select is(
  pg_temp.as_app(null, null, format('select keys.verify(%L::bytea)::text', pg_temp.hash(5001)))::jsonb ->> 'scope', 'trade',
  'and still answers a trading key as it always did'
);

-- A revoked key and a retired agent's key are null ------------------------------------------------------------------------------

select is(pg_temp.make(10, 'Second key', 1002), 'ok', 'Ada makes a second key for her agent');
select is(pg_temp.find(1002) ->> 'kind', 'post', 'it works');
create temporary table revoked on commit drop as
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format(
  'select keys.revoke_agent_key(%L)::text', (pg_temp.find(1002) ->> 'id')))::jsonb as answer;
select is(
  (select array[answer ->> 'secret_hash', (answer -> 'key' ->> 'revoked_at' is not null)::text] from revoked),
  array[substr(pg_temp.hash(1002), 3), 'true'],
  'revoking it answers the key and its hash, so the server can forget its copy'
);
select is(pg_temp.find(1002), null::jsonb, 'a revoked key answers null');
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
  'select social.admin_create_invite(%L, %L, null, false, true, %L::bytea, %L)::text',
  pg_temp.req(4), 'cy@social-keys.test', pg_temp.hash(4), 'hz-aaaa'));
select pg_temp.as_app(null, null, format(
  'select social.register_agent(%L::bytea, %L, %L, %L, null, null, null, %L::bytea, %L, %L::bytea)::text',
  pg_temp.hash(4), pg_temp.req(5), 'cy_bot', 'Cy''s agent', pg_temp.hash(3001), 'hz_demo_K300', pg_temp.hash(3002)));
select is(pg_temp.find(3001) ->> 'kind', 'post', 'a waiting agent''s key is a posting key too');
update social.agents set retired_at = now(), retired_reason = 'A test' where handle = 'cy_bot';
select is(pg_temp.find(3001), null::jsonb, 'a key of a retired agent answers null');

-- A posting key never trades; a trading key never posts ---------------------------------------------------------------------------

create function pg_temp.market_request(account text, api_key text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', account, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', account, true);
  perform set_config('hrizzup.api_key', coalesce(api_key, ''), true);
  insert into markets.requests (account_id, id, market_id, action, params, result)
  select a.id, pg_temp.req(900)::uuid, '019a7a00-0000-7000-8000-0000000000a1', 'cancel_order', '{}', '{}'
  from ledger.accounts a where a.kind = 'person' and a.user_id = account::uuid;
  perform set_config('hrizzup.api_key', '', true);
  return 'ok';
exception when others then
  perform set_config('hrizzup.api_key', '', true);
  return sqlstate;
end;
$$;
create function pg_temp.perp_request(account text, api_key text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', account, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', account, true);
  perform set_config('hrizzup.api_key', coalesce(api_key, ''), true);
  insert into perps.requests (account_id, id, perp_id, action, params, placed_at, result)
  select a.id, pg_temp.req(901)::uuid, '01a1c501-ec40-78f6-87b6-3fb041143421', 'open', '{}', now(), '{}'
  from ledger.accounts a where a.kind = 'person' and a.user_id = account::uuid;
  perform set_config('hrizzup.api_key', '', true);
  return 'ok';
exception when others then
  perform set_config('hrizzup.api_key', '', true);
  return sqlstate;
end;
$$;
select is(
  pg_temp.market_request('00000000-0000-4000-8000-00000000d0b1', (select answer -> 'key' ->> 'id' from joined)), '42501',
  'a posting key as the acting key is refused by markets.requests (42501)'
);
select is(
  pg_temp.perp_request('00000000-0000-4000-8000-00000000d0b1', (select answer -> 'key' ->> 'id' from joined)), '42501',
  'and by perps.requests (42501)'
);

-- Every agent write refuses a trading key, a read key, a session and no key at all (42501).
select is(
  array(select pg_temp.fails(null, k.key, w.query)
        from (values
          ('select social.pin(%L, ''01a1a0e7-0000-7000-8000-0000000000c1'')::text'),
          ('select social.unpin(%L, ''01a1a0e7-0000-7000-8000-0000000000c1'')::text'),
          ('select social.create_post(%L, ''01a1a0e7-0000-7000-8000-0000000000c1'', ''text'', ''Words'', null, null, null, null)::text'),
          ('select social.update_profile(%L, ''{"bio": "Hello"}'')::text'),
          ('select social.checkin_done(%L, now() - interval ''1 minute'', null)::text')
        ) as q(template)
        cross join lateral (select format(q.template, pg_temp.req(500)) as query) w
        cross join (select pg_temp.find(5001) ->> 'id' as key) k),
  array['42501', '42501', '42501', '42501', '42501'],
  'a trading key as the acting key is refused by every agent write (42501)'
);
select is(
  array(select pg_temp.fails(null, pg_temp.find(5002) ->> 'id', format(q.template, pg_temp.req(501)))
        from (values
          ('select social.pin(%L, ''01a1a0e7-0000-7000-8000-0000000000c1'')::text'),
          ('select social.create_post(%L, ''01a1a0e7-0000-7000-8000-0000000000c1'', ''text'', ''Words'', null, null, null, null)::text')
        ) as q(template)),
  array['42501', '42501'],
  'a read-only key can''t post or pin either'
);
select is(
  array[
    pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, format('select social.pin(%L, ''01a1a0e7-0000-7000-8000-0000000000c1'')::text', pg_temp.req(502))),
    pg_temp.fails(null, null, format('select social.pin(%L, ''01a1a0e7-0000-7000-8000-0000000000c1'')::text', pg_temp.req(503))),
    pg_temp.fails(null, pg_temp.req(999), 'select social.me()::text')
  ],
  array['42501', '42501', '42501'],
  'a signed-in session with no key, no key at all, and a key that was never made can''t act as an agent'
);

-- The agent-key guard: the same rules as the trading keys' -----------------------------------------------------------------------

create function pg_temp.owner_fails(query text)
returns text
language plpgsql
as $$
begin
  execute query;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
select is(
  array[
    pg_temp.owner_fails($$update keys.agent_keys set name = 'Another' where shown = 'hz_demo_K001'$$),
    pg_temp.owner_fails($$update keys.agent_keys set secret_hash = '\x0000000000000000000000000000000000000000000000000000000000009999' where shown = 'hz_demo_K001'$$),
    pg_temp.owner_fails($$update keys.agent_keys set revoked_at = null where shown = 'hz_demo_M002'$$),
    pg_temp.owner_fails($$update keys.agent_keys set last_used_at = clock_timestamp() where shown = 'hz_demo_K001'$$)
  ],
  array['23514', '23514', '23514', 'ok'],
  'only the last use and the revoking ever change, and a revoked key stays revoked'
);
select is(
  pg_temp.owner_fails($$insert into keys.agent_keys (agent_id, name, secret_hash, shown)
    select a.id, 'Copy', k.secret_hash, 'hz_demo_C001' from social.agents a, keys.api_keys k where a.handle = 'ada_bot' limit 1$$),
  '23505',
  'a key text that is already a trading key can''t be a posting key'
);

-- Two live keys, five new an hour -----------------------------------------------------------------------------------------------

select is(pg_temp.make(11, 'Another', 1003), 'ok', 'a second live key is fine');
select is(pg_temp.make(12, 'A third', 1004), 'HZK03', 'a third live key is refused (HZK03)');
select is(
  (select jsonb_array_length(pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, 'select keys.agent_keys()::text')::jsonb -> 'keys')),
  2,
  'the account sees its agent''s two live keys'
);
select is(
  (select (pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, 'select keys.agent_keys()::text')::jsonb -> 'keys') ->> 0 like '%secret%'),
  false,
  'and never a hash'
);
-- Revoke and make again until five have been made in the hour: the first, the second (revoked above), the
-- third, then two more.
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format('select keys.revoke_agent_key(%L)::text', pg_temp.find(1003) ->> 'id'));
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, format(
    'select keys.make_agent_key(%L, %L, %L::bytea, %L)::text', pg_temp.req(16), 'Clash', pg_temp.hash(5001), 'hz_demo_M016')),
  'HZS28:agent_keys_by_hash',
  'a new key whose text is already a trading key''s is refused as a clash (HZS28), never a raw unique violation'
);
select is(pg_temp.make(13, 'Fourth', 1005), 'ok', 'a fourth key in the hour, once one is revoked');
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format('select keys.revoke_agent_key(%L)::text', pg_temp.find(1005) ->> 'id'));
select is(pg_temp.make(14, 'Fifth', 1006), 'ok', 'a fifth key in the hour');
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format('select keys.revoke_agent_key(%L)::text', pg_temp.find(1006) ->> 'id'));
select ok(
  pg_temp.make(15, 'Sixth', 1007) ~ '^HZK04:[0-9]+$' and (regexp_replace(pg_temp.make(15, 'Sixth', 1007), '^HZK04:', '')::integer between 1 and 3600),
  'a sixth is refused (HZK04) with the seconds to wait in the detail'
);

-- A retry of the same request makes a new key and revokes the first ----------------------------------------------------------------

alter table keys.agent_keys disable trigger agent_keys_guard;
update keys.agent_keys set created_at = created_at - interval '2 hours';
alter table keys.agent_keys enable trigger agent_keys_guard;
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format('select keys.revoke_agent_key(%L)::text', pg_temp.find(1001) ->> 'id'));
create temporary table first_try on commit drop as
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format(
  'select keys.make_agent_key(%L, %L, %L::bytea, %L)::text', pg_temp.req(20), 'Retry key', pg_temp.hash(1010), 'hz_demo_M010'))::jsonb as answer;
create temporary table second_try on commit drop as
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', null, format(
  'select keys.make_agent_key(%L, %L, %L::bytea, %L)::text', pg_temp.req(20), 'Retry key', pg_temp.hash(1011), 'hz_demo_M011'))::jsonb as answer;
select is(
  (select array[f.answer ->> 'reissued', s.answer ->> 'reissued', s.answer -> 'key' ->> 'shown',
                (f.answer -> 'key' ->> 'id' <> s.answer -> 'key' ->> 'id')::text] from first_try f, second_try s),
  array['false', 'true', 'hz_demo_M011', 'true'],
  'the same request again answers a new key (reissued)'
);
select is(pg_temp.find(1010), null::jsonb, 'the first key, which nobody saw, stops working');
select is(pg_temp.find(1011) ->> 'kind', 'post', 'and the new one works');
select is(
  (select count(*)::integer from keys.agent_keys k join social.agents a on a.id = k.agent_id
   where a.handle = 'ada_bot' and k.name = 'Retry key'),
  2,
  'nothing doubled: the retry leaves one live key and the first, revoked'
);
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, format(
    'select keys.make_agent_key(%L, %L, %L::bytea, %L)::text', pg_temp.req(20), 'Another name', pg_temp.hash(1012), 'hz_demo_M012')),
  'HZS27',
  'the same request ID with another name is refused (HZS27)'
);
select is(pg_temp.make(21, 'x' || repeat('y', 60), 1013), '22023', 'a key''s name is 1 to 60 characters (22023)');
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', null, format(
    'select keys.make_agent_key(%L, %L, %L::bytea, %L)::text', pg_temp.req(22), 'Short hash', '\x00', 'hz_demo_M013')),
  '22023',
  'a hash that is not 32 bytes is refused (22023)'
);

-- Who may call them ----------------------------------------------------------------------------------------------------------------------

select is(
  array[
    pg_temp.fails(null, null, format('select keys.make_agent_key(%L, %L, %L::bytea, %L)::text', pg_temp.req(30), 'A key', pg_temp.hash(1020), 'hz_demo_M020')),
    pg_temp.fails(null, null, 'select keys.agent_keys()::text'),
    pg_temp.fails(null, null, format('select keys.revoke_agent_key(%L)::text', pg_temp.req(31)))
  ],
  array['42501', '42501', '42501'],
  'making, listing and revoking posting keys are for a signed-in account only'
);
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', pg_temp.find(5001) ->> 'id', 'select keys.agent_keys()::text'),
  '42501',
  'and never in a request a key signed: a leaked key can''t make another or hide itself'
);
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000d0b2', null, format('select keys.make_agent_key(%L, %L, %L::bytea, %L)::text', pg_temp.req(32), 'A key', pg_temp.hash(1021), 'hz_demo_M021')),
  'P0002',
  'an account with no agent has none to make a key for'
);
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000d0b2', null, format('select keys.revoke_agent_key(%L)::text', pg_temp.find(1011) ->> 'id')),
  'P0002',
  'nobody revokes another account''s agent''s key'
);

select * from finish();
rollback;
