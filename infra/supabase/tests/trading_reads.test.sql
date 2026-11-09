-- Tests for migrations/*_trading_reads.sql (PLAN.md step 1.7d), run by the Database check on every
-- pull request against a fresh database built from the migrations. Everything runs in a transaction
-- that is rolled back, so nothing is left behind.
--
-- The reads run as the app's own role with an account signed in (or nobody), the way the server's
-- database helper (@hrizzup/db) runs them, through pg_temp.as_app() below. The trades they read are
-- made the way the server makes them (markets.begin_trade, then markets.apply_trade), from plans
-- worked out by hand here: the server's maths, and these reads through the typed API with real
-- trades, are tested in product/packages/ledger and product/packages/markets.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(65);

-- Runs one query as the app's own role, signed in as `account` (null: nobody), and gives back its
-- one value as text. The role lasts only for the query, so pgTAP's own functions (which the app's
-- role can't see) run as the owner around it.
create function pg_temp.as_app(account text, query text)
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
  set local role hrizzup_app;
  execute query into answer;
  reset role;
  return answer;
end;
$$;

-- One trade as `account`, the way the server runs it: begin_trade, then apply_trade with the plan
-- (here worked out by hand), as the app's own role. Gives back the trade's result.
create function pg_temp.trade(account text, request text, market text, action text, params jsonb,
                              plan jsonb)
returns jsonb
language plpgsql
as $$
declare
  answer jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', account, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', account, true);
  set local role hrizzup_app;
  perform markets.begin_trade(request::uuid, market::uuid, action, params);
  answer := markets.apply_trade(plan || jsonb_build_object(
    'request_id', request, 'market_id', market, 'action', action, 'params', params));
  reset role;
  return answer;
end;
$$;

-- Who may call what -----------------------------------------------------------------------------------

select set_eq(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'trading'::regnamespace$$,
  array[
    'trading.markets(uuid,integer)',
    'trading.holdings(uuid)',
    'trading.positions(uuid,integer)',
    'trading.orders(uuid,integer)'
  ],
  'the trading schema holds the four reads, and nothing else'
);
select is_empty(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'trading'::regnamespace
      and not pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')$$,
  'the app''s role may call each of them'
);
select is_empty(
  $$select r.rolname || ' may run ' || p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    cross join pg_catalog.pg_roles r
    where p.pronamespace = 'trading'::regnamespace
      and r.rolname in ('anon', 'authenticated', 'service_role')
      and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')$$,
  'Supabase''s own roles may call none of them'
);
select is_empty(
  $$select r.rolname from pg_catalog.pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and pg_catalog.has_schema_privilege(r.oid, 'trading', 'USAGE')$$,
  'Supabase''s own roles cannot even see the trading schema'
);
select is_empty(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'trading'::regnamespace
      and not (p.prosecdef and p.provolatile = 's'
               and p.proconfig @> array['search_path=""'])$$,
  'each runs as its owner, reads only, and trusts no search path'
);
select is_empty(
  $$select c.relname from pg_catalog.pg_class c
    where c.relnamespace = 'trading'::regnamespace$$,
  'the trading schema holds no table of its own'
);
select ok(
  not pg_catalog.has_function_privilege('hrizzup_app', 'markets.market_record(uuid)', 'EXECUTE'),
  'the app''s role still reads a market''s record only through the list'
);

-- People and markets, as the owner and an admin set them up -------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'ada@trading.test'),
  ('00000000-0000-4000-8000-0000000000d2', 'ann@trading.test'),
  ('00000000-0000-4000-8000-0000000000d3', 'raj@trading.test'),
  ('00000000-0000-4000-8000-0000000000d4', 'zoe@trading.test');
insert into private.admins (user_id, note) values
  ('00000000-0000-4000-8000-0000000000d1', 'A test admin');
select ok(
  ledger.open_account('00000000-0000-4000-8000-0000000000d2', 100) is not null
  and ledger.open_account('00000000-0000-4000-8000-0000000000d3', 100) is not null,
  'two people with play money (Zoe has none yet)'
);

-- Six markets, made by the admin: 1 and 2 open; 3 a draft; 4 settled Yes; 5 cancelled; 6 settled at a
-- set probability. Their IDs sort in the order they were made, as version 7 UUIDs do.
create function pg_temp.market(n integer)
returns text
language sql
as $$ select format('019a7000-000%s-7000-8000-00000000000%s', n, n) $$;

select is(
  (select array_agg(pg_temp.as_app('00000000-0000-4000-8000-0000000000d1', format(
     $q$select admin.create_market(%L, %L, array['general'], 'Rules.', 'Hrizzup''s test desk', null,
          now(), now() + interval '1 day', 0.5, 100) ->> 'state'$q$,
     pg_temp.market(n), format('Will test event %s happen?', n))) order by n)
   from generate_series(1, 6) as n),
  array['draft', 'draft', 'draft', 'draft', 'draft', 'draft'],
  'six markets, made as drafts'
);
select is(
  (select array_agg(pg_temp.as_app('00000000-0000-4000-8000-0000000000d1', format(
     'select admin.open_market(%L) ->> ''state''', pg_temp.market(n))) order by n)
   from unnest(array[1, 2, 4, 5, 6]) as n),
  array['open', 'open', 'open', 'open', 'open'],
  'all but the third opened'
);
select is(
  (select array_agg(pg_temp.as_app('00000000-0000-4000-8000-0000000000d1', format(
     'select admin.close_market(%L) ->> ''state''', pg_temp.market(n))) order by n)
   from unnest(array[4, 5, 6]) as n),
  array['closed', 'closed', 'closed'],
  'the fourth, fifth and sixth closed'
);
select is(
  array[
    pg_temp.as_app('00000000-0000-4000-8000-0000000000d1', format(
      $q$select admin.settle_market(%L, 'yes', null, 'The test desk said yes.', null) ->> 'state'$q$,
      pg_temp.market(4))),
    pg_temp.as_app('00000000-0000-4000-8000-0000000000d1', format(
      $q$select admin.settle_market(%L, 'cancel', null, 'Nothing recorded.', 'No answer came.')
           ->> 'state'$q$,
      pg_temp.market(5))),
    pg_temp.as_app('00000000-0000-4000-8000-0000000000d1', format(
      $q$select admin.settle_market(%L, 'probability', 0.3, 'Split.', null) ->> 'state'$q$,
      pg_temp.market(6)))
  ],
  array['settled', 'cancelled', 'settled'],
  'then settled: Yes, cancelled, and at a set probability'
);

-- Trades, worked out by hand -----------------------------------------------------------------------------
-- Market 1 opens with 100 Yes and 100 No in its pool at p = 0.5, so y^0.5 · n^0.5 = 100. Buying Ṁ10 of
-- Yes puts Ṁ10 into both sides (110 each), then takes out Yes until the curve holds again: y = 10000 /
-- 110 = 90.909090…, so the buyer gets 110 − 90.909090… = 19.090909… shares, rounded down to 19.090909.
-- The market then holds Ṁ110: its pool is 110 − 19.090909 = 90.909091 Yes and 110 No.

select is(
  pg_temp.trade('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-00000000e001',
    pg_temp.market(1), 'buy', '{"outcome": "YES", "amount": "10.000000"}',
    '{"trade": {"id": "00000000-0000-4000-8000-00000000e101", "outcome": "YES",
                "order_amount": "10.000000", "is_filled": true},
      "fills": [{"matched": null, "amount": "10.000000", "shares": "19.090909"}],
      "makers": [], "cancel": [], "pool": {"yes": "90.909091", "no": "110.000000"}}') ->> 'status',
  'filled',
  'Ann buys Ṁ10 of Yes in market 1'
);
select is(
  pg_temp.trade('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-00000000e002',
    pg_temp.market(2), 'buy', '{"outcome": "YES", "amount": "10.000000"}',
    '{"trade": {"id": "00000000-0000-4000-8000-00000000e102", "outcome": "YES",
                "order_amount": "10.000000", "is_filled": true},
      "fills": [{"matched": null, "amount": "10.000000", "shares": "19.090909"}],
      "makers": [], "cancel": [], "pool": {"yes": "90.909091", "no": "110.000000"}}') ->> 'status',
  'filled',
  'Raj buys the same in market 2'
);
-- Limit orders to buy Yes only up to 30%: market 1 now shows about 54.75%, so nothing fills, and each
-- rests until it's filled, cancelled or expired.
select is(
  (select array_agg(pg_temp.trade('00000000-0000-4000-8000-0000000000d2', o.request,
     pg_temp.market(1), 'buy',
     jsonb_build_object('outcome', 'YES', 'amount', o.amount, 'limitProb', '0.30000000'),
     jsonb_build_object(
       'trade', jsonb_build_object('id', o.id, 'outcome', 'YES', 'order_amount', o.amount,
                                   'limit_prob', '0.30000000', 'is_filled', false),
       'fills', '[]'::jsonb, 'makers', '[]'::jsonb, 'cancel', '[]'::jsonb,
       'pool', '{"yes": "90.909091", "no": "110.000000"}'::jsonb)) ->> 'status' order by o.n)
   from (values
     (1, '00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000e103', '5.000000'),
     (2, '00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000e104', '6.000000'),
     (3, '00000000-0000-4000-8000-00000000e005', '00000000-0000-4000-8000-00000000e105', '7.000000'),
     (4, '00000000-0000-4000-8000-00000000e006', '00000000-0000-4000-8000-00000000e106', '8.000000')
   ) as o (n, request, id, amount)),
  array['resting', 'resting', 'resting', 'resting'],
  'Ann places four limit orders in market 1, which rest'
);
-- One of them expires (as the clock passing its expiry would make it); another she cancels.
update markets.trades set expires_at = now() - interval '1 second'
where id = '00000000-0000-4000-8000-00000000e105';
select is(
  pg_temp.trade('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-00000000e007',
    pg_temp.market(1), 'cancel_order', '{"orderId": "00000000-0000-4000-8000-00000000e106"}',
    '{}') ->> 'status',
  'cancelled',
  'Ann cancels one of them'
);

-- 1. The markets anyone may see ---------------------------------------------------------------------------

-- The first page starts after a made-up ID newer than every test market here, so markets other tests
-- left in this database (with later IDs) can't change what's counted.
create function pg_temp.listed(answer text)
returns text[]
language sql
as $$
  select coalesce(array_agg(item -> 'market' ->> 'id' order by n), '{}')
  from jsonb_array_elements(answer::jsonb -> 'markets') with ordinality as x (item, n)
  where item -> 'market' ->> 'id' like '019a7000-%'
$$;

select is(
  pg_temp.listed(pg_temp.as_app(null,
    $q$select trading.markets('019a7001-0000-7000-8000-000000000000', 100)$q$)),
  array[pg_temp.market(5), pg_temp.market(4), pg_temp.market(2), pg_temp.market(1)],
  'anyone, signed in or not, sees the markets newest first: never a draft, nor one settled at a set probability'
);
select is(
  pg_temp.listed(pg_temp.as_app('00000000-0000-4000-8000-0000000000d4',
    $q$select trading.markets('019a7001-0000-7000-8000-000000000000', 100)$q$)),
  array[pg_temp.market(5), pg_temp.market(4), pg_temp.market(2), pg_temp.market(1)],
  '... the same for someone signed in'
);
create temporary table listed on commit drop as
select item
from jsonb_array_elements(pg_temp.as_app(null,
  $q$select trading.markets('019a7001-0000-7000-8000-000000000000', 100)$q$)::jsonb -> 'markets')
  as item;
select is(
  (select item -> 'market' from listed where item -> 'market' ->> 'id' = pg_temp.market(1)),
  markets.market_record(pg_temp.market(1)::uuid),
  'each is the agreement''s market record (market/1), as the database gives it'
);
select is(
  (select item ->> 'probability' from listed where item -> 'market' ->> 'id' = pg_temp.market(1)),
  (select markets.probability(p, pool_yes, pool_no)::text from markets.markets
   where id = pg_temp.market(1)::uuid),
  'an open market shows the probability its pool shows now'
);
select is(
  (select item ->> 'probability' from listed where item -> 'market' ->> 'id' = pg_temp.market(1)),
  '0.54751131',
  '... after Ann''s Ṁ10 of Yes, about 54.75%'
);
select is(
  (select item ->> 'probability' from listed where item -> 'market' ->> 'id' = pg_temp.market(2)),
  '0.54751131',
  '... and market 2 the same, after Raj''s'
);
select is(
  (select array_agg(item -> 'market' ->> 'state' order by item -> 'market' ->> 'id' desc) from listed
   where item -> 'market' ->> 'id' like '019a7000-%'),
  array['cancelled', 'settled', 'open', 'open'],
  'each in its state'
);
select is(
  (select item -> 'market' ->> 'result' from listed where item -> 'market' ->> 'id' = pg_temp.market(4)),
  'yes',
  'a settled market says what won'
);
select ok(
  (select item ? 'probability' and item -> 'probability' = 'null'::jsonb
   from listed where item -> 'market' ->> 'id' = pg_temp.market(4))
  and (select item -> 'probability' = 'null'::jsonb
       from listed where item -> 'market' ->> 'id' = pg_temp.market(5)),
  'a settled or cancelled market shows no probability'
);
select is(
  (select pg_temp.listed(page::text) from (select pg_temp.as_app(null,
    $q$select trading.markets('019a7001-0000-7000-8000-000000000000', 2)$q$)::jsonb as page) x),
  array[pg_temp.market(5), pg_temp.market(4)],
  'a page holds as many as asked'
);
select is(
  pg_temp.as_app(null,
    $q$select trading.markets('019a7001-0000-7000-8000-000000000000', 2) ->> 'next'$q$),
  pg_temp.market(4),
  '... and says where the next starts'
);
select is(
  pg_temp.listed(pg_temp.as_app(null, format(
    'select trading.markets(%L, 2)', pg_temp.market(4)))),
  array[pg_temp.market(2), pg_temp.market(1)],
  'the next page starts after it'
);
select is(
  pg_temp.as_app(null, format('select trading.markets(%L, 2) ->> ''next''', pg_temp.market(2))),
  null,
  '... and the last says there is no next'
);
select throws_ok(
  $$select pg_temp.as_app(null, 'select trading.markets(null, 0)')$$,
  '22023', 'A page holds 1 to 100 markets', 'a page holds at least one market'
);
select throws_ok(
  $$select pg_temp.as_app(null, 'select trading.markets(null, 101)')$$,
  '22023', 'A page holds 1 to 100 markets', '... and at most 100'
);

-- 2. Holdings: what the trade call checks before it touches the books ----------------------------------

select throws_ok(
  $$select pg_temp.as_app(null, format('select trading.holdings(%L)', pg_temp.market(1)))$$,
  '42501', 'Holdings are read for a signed-in account', 'nobody signed in reads no holdings'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2', format(
    'select trading.holdings(%L)', pg_temp.market(1)))::jsonb,
  jsonb_build_object('market_id', pg_temp.market(1), 'state', 'open',
    'closes_at', markets.utc((select closes_at from markets.markets where id = pg_temp.market(1)::uuid)),
    'has_account', true, 'balance', '90.000000', 'yes', '19.090909', 'no', '0.000000'),
  'Ann sees her balance (Ṁ100 less the Ṁ10 she spent) and her shares, with the market''s state and closing time'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2', format(
    'select trading.holdings(%L) ->> ''yes''', pg_temp.market(2))),
  '0.000000',
  '... and none of Raj''s shares in market 2 as hers'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d4', format(
    'select trading.holdings(%L)', pg_temp.market(1)))::jsonb
    - 'closes_at',
  jsonb_build_object('market_id', pg_temp.market(1), 'state', 'open', 'has_account', false,
    'balance', '0.000000', 'yes', '0.000000', 'no', '0.000000'),
  'Zoe, with no play money yet, holds nothing'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2', format(
    'select trading.holdings(%L)', pg_temp.market(3))),
  null,
  'a draft answers as no market at all: it exists only for admins until it opens'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2',
    $q$select trading.holdings('019a7000-0009-7000-8000-000000000009')$q$),
  null,
  'there are no holdings in a market that doesn''t exist'
);

-- 3. Positions -----------------------------------------------------------------------------------------

select throws_ok(
  $$select pg_temp.as_app(null, 'select trading.positions(null, 50)')$$,
  '42501', 'Positions are read for a signed-in account', 'nobody signed in reads no positions'
);
create temporary table ann_positions on commit drop as
select pg_temp.as_app('00000000-0000-4000-8000-0000000000d2',
  $q$select trading.positions('019a7001-0000-7000-8000-000000000000', 50)$q$)::jsonb as page;
select is(
  (select page ->> 'balance' from ann_positions),
  '90.000000',
  'Ann''s positions come with her balance'
);
select is(
  (select page -> 'positions' from ann_positions),
  jsonb_build_array(jsonb_build_object(
    'market_id', pg_temp.market(1),
    'question', 'Will test event 1 happen?',
    'state', 'open',
    'closes_at', markets.utc((select closes_at from markets.markets where id = pg_temp.market(1)::uuid)),
    'yes', '19.090909',
    'no', '0.000000',
    'probability', '0.54751131')),
  '... and her one position: her Yes shares in market 1, never Raj''s in market 2'
);
select is(
  (select page -> 'next' from ann_positions),
  'null'::jsonb,
  '... with no next page'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d3',
    $q$select trading.positions(null, 50) #>> '{positions,0,market_id}'$q$),
  pg_temp.market(2),
  'Raj sees his own'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d4', 'select trading.positions(null, 50)')::jsonb,
  '{"balance": "0.000000", "positions": [], "next": null}'::jsonb,
  'Zoe, with no play money yet, has a balance of nothing and no positions'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000d2', 'select trading.positions(null, 0)')$$,
  '22023', 'A page holds 1 to 100 positions', 'a page holds at least one position'
);

-- 4. Open orders --------------------------------------------------------------------------------------

select throws_ok(
  $$select pg_temp.as_app(null, 'select trading.orders(null, 50)')$$,
  '42501', 'Orders are read for a signed-in account', 'nobody signed in reads no orders'
);
create temporary table ann_orders on commit drop as
select pg_temp.as_app('00000000-0000-4000-8000-0000000000d2',
  'select trading.orders(null, 50)')::jsonb as page;
select is(
  (select array_agg(o ->> 'id' order by n)
   from ann_orders, jsonb_array_elements(page -> 'orders') with ordinality as x (o, n)),
  array['00000000-0000-4000-8000-00000000e104', '00000000-0000-4000-8000-00000000e103'],
  'Ann''s open orders, newest first: never her bought shares, her expired order or her cancelled one'
);
select is(
  (select (page -> 'orders' -> 1) - 'created_at' from ann_orders),
  jsonb_build_object(
    'id', '00000000-0000-4000-8000-00000000e103',
    'market_id', pg_temp.market(1),
    'question', 'Will test event 1 happen?',
    'state', 'open',
    'outcome', 'YES',
    'order_amount', '5.000000',
    'amount', '0.000000',
    'shares', '0.000000',
    'limit_prob', '0.30000000',
    'expires_at', null),
  'each says what it is and how much of it has filled'
);
select ok(
  (select (page #>> '{orders,1,created_at}') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
   from ann_orders),
  '... and when it was placed, as the agreement writes a time'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2', 'select trading.orders(null, 1)')::jsonb
    #>> '{orders,0,id}',
  '00000000-0000-4000-8000-00000000e104',
  'a page holds as many as asked'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2', 'select trading.orders(null, 1) ->> ''next'''),
  '00000000-0000-4000-8000-00000000e104',
  '... and says where the next starts'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2',
    $q$select trading.orders('00000000-0000-4000-8000-00000000e104', 1)$q$)::jsonb
    - 'orders',
  '{"next": null}'::jsonb,
  'the next page is the last'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2',
    $q$select trading.orders('00000000-0000-4000-8000-00000000e104', 1) #>> '{orders,0,id}'$q$),
  '00000000-0000-4000-8000-00000000e103',
  '... and holds the older order'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d3', 'select trading.orders(null, 50)')::jsonb,
  '{"orders": [], "next": null}'::jsonb,
  'Raj has no open orders, and sees none of Ann''s'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000d3',
      $q$select trading.orders('00000000-0000-4000-8000-00000000e104', 50)$q$)$$,
  '22023', 'No such order on this account', 'a page can''t start after someone else''s order'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d4', 'select trading.orders(null, 50)')::jsonb,
  '{"orders": [], "next": null}'::jsonb,
  'Zoe has none'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000d4',
      $q$select trading.orders('00000000-0000-4000-8000-00000000e104', 50)$q$)$$,
  '22023', 'No such order on this account', '... and can''t page after anyone''s'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000d2', 'select trading.orders(null, 101)')$$,
  '22023', 'A page holds 1 to 100 orders', 'a page holds at most 100 orders'
);

-- Once a market closes, and once it's settled ------------------------------------------------------------

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d1', format(
    'select admin.close_market(%L) ->> ''state''', pg_temp.market(1))),
  'closed',
  'the admin closes market 1'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2',
    $q$select trading.positions(null, 50) #>> '{positions,0,state}'$q$),
  'closed',
  'Ann''s position stays, waiting for the settlement'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2',
    'select jsonb_array_length(trading.orders(null, 50) -> ''orders'')')::integer,
  2,
  '... and so do her open orders, which she can still cancel'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d1', format(
    $q$select admin.settle_market(%L, 'yes', null, 'The test desk said yes.', null) ->> 'state'$q$,
    pg_temp.market(1))),
  'settled',
  'the admin settles it Yes'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2', 'select trading.positions(null, 50)')::jsonb,
  '{"balance": "109.090909", "positions": [], "next": null}'::jsonb,
  'Ann''s Yes shares are paid out (Ṁ1 each), and the position is gone from her positions'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2', 'select trading.orders(null, 50)')::jsonb,
  '{"orders": [], "next": null}'::jsonb,
  '... and so are her orders, cancelled by the settlement'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000d2', format(
    'select trading.holdings(%L) ->> ''state''', pg_temp.market(1))),
  'settled',
  'holdings show it''s settled'
);
select is_empty('select problem from ledger.problems()', 'the books have no problem');

select * from finish();
rollback;
