-- Tests for migrations/*_markets_books.sql (PLAN.md step 1.7b), run by the Database check on
-- every pull request against a fresh database built from the migrations. Everything runs in a
-- transaction that is rolled back, so nothing is left behind. The trades themselves, with
-- Manifold's maths, are tested in product/packages/ledger (its *.db.test.ts files).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(45);

-- Who may do what ---------------------------------------------------------------------------

select has_role('hrizzup_app', 'the app has its own role');
select ok(
  not (select rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb
       from pg_catalog.pg_roles where rolname = 'hrizzup_app'),
  'the app''s role cannot log in, and has no special powers'
);
select ok(
  pg_catalog.pg_has_role('postgres', 'hrizzup_app', 'SET'),
  'the server (logged in as postgres) can switch to the app''s role'
);
select is_empty(
  $$select c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('ledger', 'markets') and c.relkind in ('r', 'p') and not c.relrowsecurity$$,
  'every table in the books has row-level security'
);
select is_empty(
  $$select r.rolname || ' on ' || c.oid::regclass::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join pg_catalog.pg_roles r
    where n.nspname in ('ledger', 'markets') and c.relkind in ('r', 'p', 'v')
      and r.rolname in ('hrizzup_app', 'anon', 'authenticated', 'service_role')
      and pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')$$,
  'no role the app or Supabase uses can read or write a table of the books directly'
);
select is_empty(
  $$select r.rolname || ' may run ' || p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join pg_catalog.pg_roles r
    where n.nspname in ('ledger', 'markets')
      and r.rolname in ('anon', 'authenticated', 'service_role', 'hrizzup_app')
      and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
      and not (r.rolname = 'hrizzup_app'
               and p.oid in ('markets.begin_trade(uuid, uuid, text, jsonb)'::regprocedure,
                             'markets.apply_trade(jsonb)'::regprocedure))$$,
  'the app''s role may only start and apply a trade; Supabase''s own roles may call nothing'
);
select is(
  (select array_agg(p.oid::regprocedure::text) from pg_catalog.pg_proc p
   where p.pronamespace = 'markets'::regnamespace and p.proname = 'begin_trade'),
  array['markets.begin_trade(uuid,uuid,text,jsonb)'],
  'a trade''s time is the database''s own: no caller can pass one'
);
select ok(
  not pg_catalog.has_schema_privilege('hrizzup_app', 'ledger', 'USAGE'),
  'the app''s role cannot even see the books'' schema'
);

-- Some people and a market, as the owner sets them up ------------------------------------------

-- What the house had given out before (other tests may have run on this database first).
create temporary table house_before on commit drop as
select coalesce((select balance from ledger.accounts where kind = 'house'), 0) as balance;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'ann@books.test'),
  ('00000000-0000-4000-8000-0000000000a2', 'raj@books.test');
create temporary table people on commit drop as
select ledger.open_account('00000000-0000-4000-8000-0000000000a1', 500) as ann,
       ledger.open_account('00000000-0000-4000-8000-0000000000a2', 0) as raj;
create temporary table test_market on commit drop as
select markets.create_market(now() + interval '1 day', 0.5, 1000) as id;

select is(
  (select balance from ledger.accounts where id = (select ann from people)),
  500.000000::numeric,
  'a starting balance arrives from the house'
);
select is(
  (select count(*)::int from ledger.accounts where kind = 'house'),
  1,
  'there is exactly one house account'
);
select is(
  (select balance from ledger.accounts where kind = 'house') - (select balance from house_before),
  -1500.000000::numeric,
  'the house''s balance goes down by everything it gives out'
);
select is(
  (select a.balance from ledger.accounts a join markets.markets m on m.account_id = a.id
   where m.id = (select id from test_market)),
  1000.000000::numeric,
  'a new market holds its seed'
);
select is_empty('select problem from ledger.problems()', 'the books have no problem');
select is(
  (select sum(amount) from ledger.lines),
  0::numeric,
  'the books'' lines sum to zero'
);
select is(
  (select count(*)::int from ledger.lines),
  2 * (select count(*)::int from ledger.moves),
  'every move is two lines'
);

-- The books never change -------------------------------------------------------------------------

select throws_ok(
  'update ledger.moves set amount = amount + 1',
  '23001', null, 'a move is never edited'
);
select throws_ok('delete from ledger.moves', '23001', null, 'a move is never deleted');
select throws_ok('truncate ledger.moves cascade', '23001', null, 'the moves are never emptied');
select throws_ok(
  'update ledger.entries set memo = ''changed''', '23001', null, 'an entry is never edited'
);
select throws_ok('delete from ledger.entries', '23001', null, 'an entry is never deleted');
select throws_ok('delete from ledger.accounts', '23001', null, 'an account is never deleted');
select throws_ok(
  'update ledger.accounts set balance = balance + 1',
  '23001', null, 'a balance changes only through its moves'
);
select throws_ok(
  $$insert into ledger.accounts (kind, user_id, balance) values ('person', null, 5)$$,
  '23514', null, 'an account starts at zero'
);
select throws_ok(
  $$update ledger.accounts set kind = 'house' where id = (select raj from people)$$,
  '23001', null, 'an account''s kind never changes'
);

-- Markets ----------------------------------------------------------------------------------------

select throws_ok(
  $$select markets.create_market(now() + interval '1 day', 0.995, 1000)$$,
  '22023', null, 'a market opens between 1% and 99%'
);
create temporary table other_market on commit drop as
select markets.create_market(now() + interval '1 day', 0.5, 100) as id;
set constraints markets.markets_backed immediate;
select throws_ok(
  $$update markets.markets set pool_yes = pool_yes + 1 where id = (select id from other_market)$$,
  '23514', null, 'a market whose shares are not backed by its money is refused'
);
set constraints markets.markets_backed deferred;
select throws_ok(
  $$select markets.settle((select id from test_market), 'MKT')$$,
  '22023', null, 'a settlement at a set probability names it'
);

-- Every move fits its entry, and never takes a person below zero -----------------------------

select throws_ok(
  $$select ledger.post('trade', (select id from test_market), null,
      jsonb_build_array(jsonb_build_object(
        'from', (select ann from people), 'to', (select raj from people), 'amount', '1')))$$,
  '23514', null, 'a trade never moves money from one person to another'
);
select throws_ok(
  $$select ledger.post('cancel', (select id from test_market), null,
      jsonb_build_array(jsonb_build_object(
        'from', (select ann from people),
        'to', (select account_id from markets.markets where id = (select id from test_market)),
        'amount', '1')))$$,
  '23514', null, 'a cancel''s moves fit only a cancelled market'
);
select throws_ok(
  $$select ledger.post('grant', null, null,
      jsonb_build_array(jsonb_build_object(
        'from', (select ann from people), 'to', ledger.house(), 'amount', '1')))$$,
  '23514', null, 'a grant only ever comes from the house'
);
select throws_ok(
  $$select ledger.correct((select ann from people), (select raj from people), 1, 'x')$$,
  '23514', null, 'a correction is only between the house and a person'
);
select throws_ok(
  $$select ledger.correct((select ann from people), ledger.house(), 500.000001, 'too much')$$,
  '23514', null, 'no move takes a person below zero'
);
select lives_ok(
  $$select ledger.correct((select ann from people), ledger.house(), 500, 'all of it')$$,
  'a person can be taken to exactly zero'
);
update markets.markets set state = 'cancelled', resolution = 'CANCEL', settled_at = now()
where id = (select id from test_market);
select lives_ok(
  $$select ledger.post('cancel', (select id from test_market), null,
      jsonb_build_array(jsonb_build_object(
        'from', (select raj from people),
        'to', (select account_id from markets.markets where id = (select id from test_market)),
        'amount', '3')))$$,
  'only a cancelled market can take a person below zero'
);
select throws_ok(
  $$select ledger.post('trade', (select id from test_market), null,
      jsonb_build_array(jsonb_build_object(
        'from', (select ann from people),
        'to', (select account_id from markets.markets where id = (select id from test_market)),
        'amount', '1')))$$,
  '23514', null, 'a trade''s moves fit only an open market'
);
update markets.markets set state = 'open', resolution = null, settled_at = null
where id = (select id from test_market);
select is(
  (select balance from ledger.accounts where id = (select raj from people)),
  -3.000000::numeric,
  'and the balance then shows what''s owed'
);
select throws_ok(
  $$insert into ledger.moves (entry_id, from_account, to_account, amount)
    values ((select max(id) from ledger.entries), ledger.house(), ledger.house(), 1)$$,
  '23514', null, 'a move is between two different accounts'
);
select throws_ok(
  $$insert into ledger.moves (entry_id, from_account, to_account, amount)
    values ((select max(id) from ledger.entries), ledger.house(), (select ann from people), 0)$$,
  '23514', null, 'a move is more than zero'
);
select throws_ok(
  $$insert into ledger.moves (entry_id, from_account, to_account, amount)
    values ((select max(id) from ledger.entries), ledger.house(), (select ann from people), 0.0000001)$$,
  '23514', null, 'an amount below a millionth rounds to zero and is refused'
);

-- A trade needs its start, in the same transaction, with someone signed in ---------------------

select throws_ok(
  $$select markets.apply_trade(jsonb_build_object(
      'request_id', gen_random_uuid(), 'market_id', (select id from test_market), 'action', 'buy'))$$,
  '25000', null, 'a trade is applied only after begin_trade, in the same transaction'
);
select throws_ok(
  $$select markets.begin_trade(gen_random_uuid(), (select id from test_market), 'buy', '{}')$$,
  '42501', null, 'a trade needs a signed-in account'
);
select ok(
  set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a9', true) is not null,
  'signed in as someone with no account yet'
);
select throws_ok(
  $$select markets.begin_trade(gen_random_uuid(), (select id from test_market), 'buy', '{}')$$,
  'P0002', null, 'a trade needs an account with play money'
);
select ok(
  set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true) is not null,
  'signed in as Ann'
);
select ok(
  markets.begin_trade(gen_random_uuid(), (select id from test_market), 'buy', '{}') ? 'market',
  'a signed-in person with an account can start a trade'
);

select * from finish();
rollback;
