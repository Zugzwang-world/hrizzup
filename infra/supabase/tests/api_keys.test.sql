-- Tests for migrations/*_api_keys.sql (PLAN.md step 3.5a), run by the Database check on every pull
-- request against a fresh database built from the migrations. Everything runs in a transaction that
-- is rolled back, so nothing is left behind.
--
-- The calls run as the app's own role with an account signed in (or nobody), and with the key that
-- signed the request set (or none), the way the server's database helper (@hrizzup/db) runs them,
-- through pg_temp.as_app() below. Hashes here are made-up bytes, never a real key's.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(52);

-- Runs one query as the app's own role, signed in as `account` (null: nobody), with `api_key` as the
-- key that signed the request (null: none), and gives back its one value as text.
create function pg_temp.as_app(account text, api_key text, query text)
returns text
language plpgsql
as $$
declare
  answer text;
begin
  perform set_config('request.jwt.claims',
    case when account is null then '{"role": "anon"}'
         else json_build_object('sub', account, 'role', 'authenticated')::text end,
    true);
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

-- Ada makes a key: its answer.
create function pg_temp.make(account text, name text, scope text, n integer)
returns jsonb
language sql
as $$
  select pg_temp.as_app(account, null, format(
    'select keys.create(%L, %L, %L::bytea, %L)', name, scope, pg_temp.hash(n), 'hz_demo_Ab' || lpad(n::text, 2, '0')))::jsonb
$$;

-- Who may call what ---------------------------------------------------------------------------------

select set_eq(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'keys'::regnamespace
      and pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')$$,
  array[
    'keys."create"(text,text,bytea,text)',
    'keys.list()',
    'keys.revoke(uuid)',
    'keys.verify(bytea)'
  ],
  'the app''s role may call the four key calls, and none of the helpers'
);
select is_empty(
  $$select r.rolname || ' may run ' || p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    cross join pg_catalog.pg_roles r
    where p.pronamespace = 'keys'::regnamespace
      and r.rolname in ('anon', 'authenticated', 'service_role')
      and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')$$,
  'Supabase''s own roles may call none of them'
);
select is_empty(
  $$select r.rolname from pg_catalog.pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and pg_catalog.has_schema_privilege(r.oid, 'keys', 'USAGE')$$,
  'Supabase''s own roles cannot even see the keys schema'
);
select is_empty(
  $$select r.rolname || ' on ' || privilege from pg_catalog.pg_roles r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege
    where r.rolname in ('hrizzup_app', 'anon', 'authenticated', 'service_role')
      and pg_catalog.has_table_privilege(r.oid, 'keys.api_keys', privilege)$$,
  'no role the app or Supabase uses can read or write the keys table itself'
);
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'keys.api_keys'::regclass),
  'the keys table has row-level security on'
);
select is_empty(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'keys'::regnamespace
      and pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')
      and not (p.prosecdef and p.proconfig @> array['search_path=""'])$$,
  'each call runs as its owner and trusts no search path'
);

-- People --------------------------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a0a1', 'ada@keys.test'),
  ('00000000-0000-4000-8000-00000000a0a2', 'ben@keys.test'),
  ('00000000-0000-4000-8000-00000000a0a3', 'cy@keys.test');
insert into private.admins (user_id, note) values
  ('00000000-0000-4000-8000-00000000a0a3', 'A test admin');

-- Making keys ---------------------------------------------------------------------------------------

create temporary table made on commit drop as
select 'read' as label, pg_temp.make('00000000-0000-4000-8000-00000000a0a1', 'My bot', 'read', 1) as key;
insert into made
select 'trade', pg_temp.make('00000000-0000-4000-8000-00000000a0a1', 'Trading bot', 'trade', 2);

select is(
  (select array[key ->> 'name', key ->> 'scope', key ->> 'shown', (key ? 'secret_hash')::text,
                ((key ->> 'last_used_at') is null and (key ->> 'revoked_at') is null
                 and (key ->> 'created_at') ~ '^\d{4}-\d\d-\d\dT[0-9:.]+Z$'
                 and (key ->> 'id') ~ '^[0-9a-f-]{36}$')::text]
   from made where label = 'read'),
  array['My bot', 'read', 'hz_demo_Ab01', 'false', 'true'],
  'Ada makes a read-only key: its name, scope, first characters and times, never its hash'
);
select is(
  (select array[k.scope, k.user_id::text, encode(k.secret_hash, 'hex')]
   from keys.api_keys k where k.id = (select (key ->> 'id')::uuid from made where label = 'trade')),
  array['trade', '00000000-0000-4000-8000-00000000a0a1', right(pg_temp.hash(2), 64)],
  '... and a trading key, stored with its account and only its hash'
);
select is(
  pg_temp.fails(null, null, format(
    $q$select keys.create('Bot', 'read', %L::bytea, 'hz_demo_Zz01')$q$, pg_temp.hash(90))),
  '42501',
  'nobody signed in can make a key'
);
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000a0a1',
    (select key ->> 'id' from made where label = 'trade'), format(
    $q$select keys.create('Bot', 'trade', %L::bytea, 'hz_demo_Zz02')$q$, pg_temp.hash(91))),
  '42501',
  'a request a key signed can''t make a key, not even with a trading key'
);
select is(
  array[
    pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
      $q$select keys.create('', 'read', %L::bytea, 'hz_demo_Zz03')$q$, pg_temp.hash(92))),
    pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
      $q$select keys.create(' Bot', 'read', %L::bytea, 'hz_demo_Zz03')$q$, pg_temp.hash(92))),
    pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
      $q$select keys.create(repeat('x', 61), 'read', %L::bytea, 'hz_demo_Zz03')$q$, pg_temp.hash(92))),
    pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
      $q$select keys.create(E'Bot\n', 'read', %L::bytea, 'hz_demo_Zz03')$q$, pg_temp.hash(92))),
    pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
      $q$select keys.create('Bot', 'admin', %L::bytea, 'hz_demo_Zz03')$q$, pg_temp.hash(92))),
    pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null,
      $q$select keys.create('Bot', 'read', '\x00ff'::bytea, 'hz_demo_Zz03')$q$),
    pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
      $q$select keys.create('Bot', 'read', %L::bytea, 'hz_demo_Zz03xyz')$q$, pg_temp.hash(92))),
    pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
      $q$select keys.create('Bot', 'read', %L::bytea, 'sk_demo_Zz03')$q$, pg_temp.hash(92)))
  ],
  array['22023', '22023', '22023', '22023', '22023', '22023', '22023', '22023'],
  'a name that''s empty, padded, too long or has a control character, another scope, a hash that isn''t SHA-256''s, and first characters that aren''t a key''s are refused'
);
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000a0a2', null, format(
    $q$select keys.create('Copy', 'read', %L::bytea, 'hz_demo_Zz04')$q$, pg_temp.hash(1))),
  '23505',
  'two keys never share a hash'
);

-- At most five live keys, and ten new ones an hour ----------------------------------------------------

insert into made
select 'more ' || n, pg_temp.make('00000000-0000-4000-8000-00000000a0a1', 'Bot ' || n, 'read', n)
from generate_series(3, 5) as n;
select is(
  jsonb_array_length(pg_temp.as_app('00000000-0000-4000-8000-00000000a0a1', null,
    'select keys.list()')::jsonb),
  5,
  'Ada holds five live keys'
);
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
    $q$select keys.create('Sixth', 'read', %L::bytea, 'hz_demo_Ab06')$q$, pg_temp.hash(6))),
  'HZK01',
  '... so a sixth is refused'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000a0a1', null, format(
    'select keys.revoke(%L) -> ''key'' ->> ''name''', (select key ->> 'id' from made where label = 'more 3'))),
  'Bot 3',
  'she revokes one'
);
select is(
  pg_temp.make('00000000-0000-4000-8000-00000000a0a1', 'Sixth', 'read', 6) ->> 'name',
  'Sixth',
  '... and can make another'
);
-- Ada has made six in this hour; she revokes and makes four more, ten in all.
create function pg_temp.swap_four()
returns integer
language plpgsql
as $$
declare
  k record;
  n integer := 0;
begin
  for k in select key ->> 'id' as id from made
           where label in ('more 4', 'more 5', 'read', 'trade') order by label loop
    n := n + 1;
    perform pg_temp.as_app('00000000-0000-4000-8000-00000000a0a1', null,
                           format('select keys.revoke(%L)', k.id));
    perform pg_temp.make('00000000-0000-4000-8000-00000000a0a1', 'Again ' || n, 'read', 6 + n);
  end loop;
  return n;
end;
$$;
select is(pg_temp.swap_four(), 4, 'she revokes four more and makes four, ten keys made this hour');
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
    $q$select keys.revoke(%L)$q$, (select key ->> 'id' from made where label = 'more 3'))),
  'P0002',
  'a revoked key can''t be revoked again'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000a0a1', null, 'select jsonb_array_length(keys.list())'),
  '5',
  'she holds five live keys again'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000a0a1', null, format(
    'select keys.revoke(%L) -> ''key'' ->> ''name''',
    (select k.id from keys.api_keys k where k.name = 'Sixth'))),
  'Sixth',
  'she revokes one, so she holds four'
);
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
    $q$select keys.create('Eleventh', 'read', %L::bytea, 'hz_demo_Ab20')$q$, pg_temp.hash(20))),
  'HZK02',
  '... but an eleventh in the hour is refused, revoked keys counting'
);
create function pg_temp.wait_seconds(account text)
returns text
language plpgsql
as $$
begin
  perform pg_temp.as_app(account, null, format(
    $q$select keys.create('Eleventh', 'read', %L::bytea, 'hz_demo_Ab20')$q$, pg_temp.hash(20)));
  return 'made';
exception when sqlstate 'HZK02' then
  reset role;
  declare
    detail text;
  begin
    get stacked diagnostics detail = pg_exception_detail;
    return detail;
  end;
end;
$$;
select ok(
  pg_temp.wait_seconds('00000000-0000-4000-8000-00000000a0a1')::integer between 3500 and 3600,
  '... saying how many seconds until she may (about an hour, since her first key of the hour)'
);
-- Once the hour has passed for her first keys (moved back here, as the clock would), she may make
-- keys again.
alter table keys.api_keys disable trigger api_keys_guard;
update keys.api_keys set created_at = created_at - interval '2 hours'
where name in ('My bot', 'Trading bot');
alter table keys.api_keys enable trigger api_keys_guard;
select is(
  pg_temp.make('00000000-0000-4000-8000-00000000a0a1', 'Eleventh', 'read', 20) ->> 'name',
  'Eleventh',
  '... and once the hour has passed for her first ones, she may'
);

-- Listing and revoking: only one's own ------------------------------------------------------------------

insert into made
select 'ben', pg_temp.make('00000000-0000-4000-8000-00000000a0a2', 'Ben''s bot', 'trade', 40);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000a0a2', null, 'select keys.list()')::jsonb -> 0 ->> 'name',
  'Ben''s bot',
  'Ben lists only his own key'
);
select is(
  (select count(*)::integer from jsonb_array_elements(pg_temp.as_app(
     '00000000-0000-4000-8000-00000000a0a1', null, 'select keys.list()')::jsonb) k
   where k ->> 'name' = 'Ben''s bot' or k ->> 'revoked_at' is not null or k ? 'secret_hash'),
  0,
  'Ada''s list holds none of his, none she revoked, and no hash'
);
select is(
  (select array_agg(x ->> 'name' order by n)
   from jsonb_array_elements(pg_temp.as_app('00000000-0000-4000-8000-00000000a0a1', null,
     'select keys.list()')::jsonb) with ordinality as l (x, n)),
  array['Eleventh', 'Again 4', 'Again 3', 'Again 2', 'Again 1'],
  '... newest first'
);
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000a0a1', null, format(
    $q$select keys.revoke(%L)$q$, (select key ->> 'id' from made where label = 'ben'))),
  'P0002',
  'Ada can''t revoke Ben''s key'
);
select is(
  array[
    pg_temp.fails(null, null, 'select keys.list()'),
    pg_temp.fails('00000000-0000-4000-8000-00000000a0a2',
      (select key ->> 'id' from made where label = 'ben'), 'select keys.list()'),
    pg_temp.fails('00000000-0000-4000-8000-00000000a0a2',
      (select key ->> 'id' from made where label = 'ben'), format(
      $q$select keys.revoke(%L)$q$, (select key ->> 'id' from made where label = 'ben')))
  ],
  array['42501', '42501', '42501'],
  'nobody signed in can list keys, and a request a key signed can''t list or revoke them'
);
select is(
  (select array[(x -> 'key' ->> 'revoked_at') is not null, x ->> 'secret_hash' = right(pg_temp.hash(40), 64)]::text[]
   from (select pg_temp.as_app('00000000-0000-4000-8000-00000000a0a2', null, format(
     'select keys.revoke(%L)', (select key ->> 'id' from made where label = 'ben')))::jsonb as x) r),
  array['true', 'true'],
  'Ben revokes his key: answered as revoked, with its hash so the server can forget its copy'
);

-- Finding a key by its hash ---------------------------------------------------------------------------

select is(
  pg_temp.as_app(null, null, format('select keys.verify(%L::bytea)', pg_temp.hash(7)))::jsonb
    - 'id',
  jsonb_build_object('user_id', '00000000-0000-4000-8000-00000000a0a1', 'scope', 'read'),
  'a live key is found by its hash, with nobody signed in: its account and scope'
);
select is(
  pg_temp.as_app(null, null, format('select keys.verify(%L::bytea)', pg_temp.hash(7)))::jsonb ->> 'id',
  (select k.id::text from keys.api_keys k where k.secret_hash = decode(right(pg_temp.hash(7), 64), 'hex')),
  '... and its ID'
);
select ok(
  (select k.last_used_at is not null from keys.api_keys k
   where k.secret_hash = decode(right(pg_temp.hash(7), 64), 'hex')),
  '... noting that it was used'
);
update keys.api_keys set last_used_at = created_at
where secret_hash = decode(right(pg_temp.hash(7), 64), 'hex');
create temporary table used on commit drop as
select k.last_used_at from keys.api_keys k where k.secret_hash = decode(right(pg_temp.hash(7), 64), 'hex');
select ok(
  pg_temp.as_app(null, null, format('select keys.verify(%L::bytea)', pg_temp.hash(7))) is not null
  and (select k.last_used_at from keys.api_keys k
       where k.secret_hash = decode(right(pg_temp.hash(7), 64), 'hex')) = (select last_used_at from used),
  'used again within the minute, it isn''t noted again'
);
select is(
  array[
    pg_temp.as_app(null, null, format('select keys.verify(%L::bytea)', pg_temp.hash(40))),
    pg_temp.as_app(null, null, format('select keys.verify(%L::bytea)', pg_temp.hash(999))),
    pg_temp.as_app(null, null, 'select keys.verify(''\x00''::bytea)')
  ],
  array[null, null, null]::text[],
  'a revoked key, a key never made and a hash that isn''t one find nothing'
);

-- A key never changes, and a revoked one stays revoked ------------------------------------------------

select throws_ok(
  $$update keys.api_keys set name = 'Renamed' where name = 'Eleventh'$$,
  '23514', 'A key''s name, scope and secret never change',
  'a key''s name never changes'
);
select throws_ok(
  $$update keys.api_keys set scope = 'trade' where name = 'Eleventh'$$,
  '23514', 'A key''s name, scope and secret never change',
  '... nor its scope'
);
select throws_ok(
  $$update keys.api_keys set revoked_at = null where name = 'Ben''s bot'$$,
  '23514', 'A revoked key stays revoked',
  'a revoked key can''t come back'
);

-- Every trade request records the key that placed it ---------------------------------------------------

-- A market for the requests, made and opened by the test admin, and the Bitcoin perp, which every
-- environment has.
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000a0a3', null,
    $q$select admin.create_market('019a7a00-0000-7000-8000-0000000000a1', 'Will the keys test pass?',
         array['general'], 'Rules.', 'Hrizzup''s test desk', null, now(), now() + interval '1 day',
         0.5, 100) ->> 'state'$q$),
  'draft',
  'a test market, made'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000a0a3', null,
    $q$select admin.open_market('019a7a00-0000-7000-8000-0000000000a1') ->> 'state'$q$),
  'open',
  '... and opened'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000a0a1', null, format(
    'select keys.revoke(%L) -> ''key'' ->> ''name''',
    (select k.id from keys.api_keys k where k.name = 'Eleventh'))),
  'Eleventh',
  'Ada revokes a key to make room for a trading one'
);
insert into made
select 'ada trade', pg_temp.make('00000000-0000-4000-8000-00000000a0a1', 'Trader', 'trade', 50);
insert into made
select 'ben trade', pg_temp.make('00000000-0000-4000-8000-00000000a0a2', 'Ben trades', 'trade', 51);

-- A cancel of an order that isn't there, as the server sends one (begin_trade, then apply_trade): the
-- books refuse it, and write the request with its answer.
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000a0a1', null,
    $q$select markets.begin_trade('00000000-0000-4000-8000-00000000b001',
         '019a7a00-0000-7000-8000-0000000000a1', 'cancel_order',
         '{"orderId": "00000000-0000-4000-8000-00000000a0ff"}') is not null$q$),
  'true',
  'Ada begins a cancel from the website'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000a0a1', null,
    $q$select markets.apply_trade(jsonb_build_object(
         'request_id', '00000000-0000-4000-8000-00000000b001',
         'market_id', '019a7a00-0000-7000-8000-0000000000a1', 'action', 'cancel_order',
         'params', '{"orderId": "00000000-0000-4000-8000-00000000a0ff"}'::jsonb)) ->> 'status'$q$),
  'refused',
  '... which the books refuse (no such order)'
);
select ok(
  (select r.api_key_id is null from markets.requests r where r.id = '00000000-0000-4000-8000-00000000b001'),
  '... and its request records no key'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-00000000a0a1',
    (select key ->> 'id' from made where label = 'ada trade'),
    $q$select markets.begin_trade('00000000-0000-4000-8000-00000000b002',
         '019a7a00-0000-7000-8000-0000000000a1', 'cancel_order',
         '{"orderId": "00000000-0000-4000-8000-00000000a0ff"}') is not null
       and markets.apply_trade(jsonb_build_object(
         'request_id', '00000000-0000-4000-8000-00000000b002',
         'market_id', '019a7a00-0000-7000-8000-0000000000a1', 'action', 'cancel_order',
         'params', '{"orderId": "00000000-0000-4000-8000-00000000a0ff"}'::jsonb)) ->> 'status' = 'refused'$q$),
  'true',
  'Ada''s trading key sends the same cancel'
);
select is(
  (select r.api_key_id::text from markets.requests r where r.id = '00000000-0000-4000-8000-00000000b002'),
  (select key ->> 'id' from made where label = 'ada trade'),
  '... and its request records her key'
);

-- Requests written straight into the tables, as the owner, as the books' functions would.
create function pg_temp.request(account text, api_key text, request text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', account, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', account, true);
  perform set_config('hrizzup.api_key', coalesce(api_key, ''), true);
  insert into markets.requests (account_id, id, market_id, action, params, result, api_key_id)
  select a.id, request::uuid, '019a7a00-0000-7000-8000-0000000000a1', 'cancel_order', '{}', '{}',
         '00000000-0000-4000-8000-00000000dead'
  from ledger.accounts a where a.kind = 'person' and a.user_id = account::uuid;
  perform set_config('hrizzup.api_key', '', true);
  return (select coalesce(r.api_key_id::text, 'none') from markets.requests r where r.id = request::uuid);
exception when others then
  perform set_config('hrizzup.api_key', '', true);
  return sqlstate;
end;
$$;

select is(
  pg_temp.request('00000000-0000-4000-8000-00000000a0a1', null, '00000000-0000-4000-8000-00000000b003'),
  'none',
  'a request no key signed records none, whatever the insert says'
);
select is(
  array[
    pg_temp.request('00000000-0000-4000-8000-00000000a0a1',
      (select k.id::text from keys.api_keys k where k.name = 'Again 1'), '00000000-0000-4000-8000-00000000b004'),
    pg_temp.request('00000000-0000-4000-8000-00000000a0a1',
      (select key ->> 'id' from made where label = 'trade'), '00000000-0000-4000-8000-00000000b005'),
    pg_temp.request('00000000-0000-4000-8000-00000000a0a1',
      (select key ->> 'id' from made where label = 'ben trade'), '00000000-0000-4000-8000-00000000b006'),
    pg_temp.request('00000000-0000-4000-8000-00000000a0a1',
      '00000000-0000-4000-8000-00000000beef', '00000000-0000-4000-8000-00000000b007')
  ],
  array['42501', '42501', '42501', '42501'],
  'a trade request is refused with a read-only key, a revoked key, someone else''s key, or a key never made'
);
select is(
  pg_temp.fails('00000000-0000-4000-8000-00000000a0a1',
    (select k.id::text from keys.api_keys k where k.name = 'Again 1'),
    $q$select markets.begin_trade('00000000-0000-4000-8000-00000000b008',
         '019a7a00-0000-7000-8000-0000000000a1', 'cancel_order',
         '{"orderId": "00000000-0000-4000-8000-00000000a0ff"}') is not null
       and markets.apply_trade(jsonb_build_object(
         'request_id', '00000000-0000-4000-8000-00000000b008',
         'market_id', '019a7a00-0000-7000-8000-0000000000a1', 'action', 'cancel_order',
         'params', '{"orderId": "00000000-0000-4000-8000-00000000a0ff"}'::jsonb)) ->> 'status' = 'refused'$q$),
  '42501',
  'the books refuse a trade a read-only key sends'
);
select is(
  (select count(*)::integer from markets.requests r
   where r.id in ('00000000-0000-4000-8000-00000000b004', '00000000-0000-4000-8000-00000000b005',
                  '00000000-0000-4000-8000-00000000b006', '00000000-0000-4000-8000-00000000b007',
                  '00000000-0000-4000-8000-00000000b008')),
  0,
  '... and none of the refused requests was written'
);

-- The perp's requests, the same way.
create function pg_temp.perp_request(account text, api_key text, request text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', account, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', account, true);
  perform set_config('hrizzup.api_key', coalesce(api_key, ''), true);
  insert into perps.requests (account_id, id, perp_id, action, params, placed_at, result)
  select a.id, request::uuid, '01a1c501-ec40-78f6-87b6-3fb041143421', 'open', '{}', now(), '{}'
  from ledger.accounts a where a.kind = 'person' and a.user_id = account::uuid;
  perform set_config('hrizzup.api_key', '', true);
  return (select coalesce(r.api_key_id::text, 'none') from perps.requests r where r.id = request::uuid);
exception when others then
  perform set_config('hrizzup.api_key', '', true);
  return sqlstate;
end;
$$;

select is(
  array[
    pg_temp.perp_request('00000000-0000-4000-8000-00000000a0a1', null, '00000000-0000-4000-8000-00000000c001'),
    pg_temp.perp_request('00000000-0000-4000-8000-00000000a0a1',
      (select key ->> 'id' from made where label = 'ada trade'), '00000000-0000-4000-8000-00000000c002'),
    pg_temp.perp_request('00000000-0000-4000-8000-00000000a0a1',
      (select k.id::text from keys.api_keys k where k.name = 'Again 1'), '00000000-0000-4000-8000-00000000c003')
  ],
  array['none', (select key ->> 'id' from made where label = 'ada trade'), '42501'],
  'a perp request records no key from the website, her trading key from her bot, and is refused with a read-only key'
);

-- A deleted account's keys go with it; its requests keep the key that placed them.
delete from auth.users where id = '00000000-0000-4000-8000-00000000a0a2';
select is(
  (select count(*)::integer from keys.api_keys k where k.user_id = '00000000-0000-4000-8000-00000000a0a2'),
  0,
  'a deleted account''s keys go with it'
);
select ok(
  (select r.api_key_id is not null from markets.requests r where r.id = '00000000-0000-4000-8000-00000000b002'),
  'requests keep the key that placed them'
);

select * from finish();
rollback;
