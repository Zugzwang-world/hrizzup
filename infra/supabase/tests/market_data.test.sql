-- Tests for migrations/*_market_data.sql (PLAN.md steps 3.5c, 3.5d and 3.4b's price reads), run by
-- the Database check on every pull request against a fresh database built from the migrations.
-- Everything runs in a transaction that is rolled back, so nothing is left behind.
--
-- The reads run as the app's own role, with nobody signed in (the public reads) or an account signed
-- in (its own trades), the way the server's database helper (@hrizzup/db) runs them, through
-- pg_temp.as_app() below. The trades they read are made the way the server makes them
-- (markets.begin_trade, then markets.apply_trade), from plans worked out by hand, as in
-- trading_reads.test.sql; the server's maths and these reads through the typed API, with real trades,
-- are tested in product/packages/markets and the journeys.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(48);

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

-- A public read as the app's role with nobody signed in, as JSON.
create function pg_temp.read(query text)
returns jsonb
language sql
as $$ select pg_temp.as_app(null, query)::jsonb $$;

-- Who may call what -----------------------------------------------------------------------------------

select set_eq(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'market_data'::regnamespace
      and pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')$$,
  array[
    'market_data.one_market(uuid)',
    'market_data.market_history(uuid,text)',
    'market_data.book(uuid)',
    'market_data.trades(uuid,integer,integer)',
    'market_data.quote_state(uuid)',
    'market_data.price(text)',
    'market_data.price_history(text,text)',
    'market_data.perp_quote_state(uuid)'
  ],
  'the app''s role may call the eight public reads, and none of their helpers'
);
select is_empty(
  $$select r.rolname || ' may run ' || p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    cross join pg_catalog.pg_roles r
    where (p.pronamespace = 'market_data'::regnamespace
           or p.oid = 'trading.my_trades(uuid,integer)'::regprocedure)
      and r.rolname in ('anon', 'authenticated', 'service_role')
      and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')$$,
  'Supabase''s own roles may call none of them'
);
select is_empty(
  $$select r.rolname from pg_catalog.pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and pg_catalog.has_schema_privilege(r.oid, 'market_data', 'USAGE')$$,
  'Supabase''s own roles cannot even see the market_data schema'
);
select ok(
  pg_catalog.has_function_privilege('hrizzup_app', 'trading.my_trades(uuid,integer)', 'EXECUTE'),
  'the app''s role may read an account''s own trades'
);
select is_empty(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where (p.pronamespace = 'market_data'::regnamespace
           or p.oid = 'trading.my_trades(uuid,integer)'::regprocedure)
      and pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')
      and not (p.prosecdef and p.provolatile = 's'
               and p.proconfig @> array['search_path=""'])$$,
  'each runs as its owner, reads only, and trusts no search path'
);
select is_empty(
  $$select c.relname from pg_catalog.pg_class c
    where c.relnamespace = 'market_data'::regnamespace$$,
  'the market_data schema holds no table of its own'
);

-- People and markets ----------------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'ada@data.test'),
  ('00000000-0000-4000-8000-0000000000f2', 'ann@data.test'),
  ('00000000-0000-4000-8000-0000000000f3', 'raj@data.test');
insert into private.admins (user_id, note) values
  ('00000000-0000-4000-8000-0000000000f1', 'A test admin');
select ok(
  ledger.open_account('00000000-0000-4000-8000-0000000000f2', 100) is not null
  and ledger.open_account('00000000-0000-4000-8000-0000000000f3', 100) is not null,
  'two people with Ṁ100 each'
);

-- Four markets: 1 open, 2 a draft, 3 settled Yes, 4 settled at a set probability.
create function pg_temp.market(n integer)
returns text
language sql
as $$ select format('019a7100-000%s-7000-8000-00000000000%s', n, n) $$;

select is(
  (select array_agg(pg_temp.as_app('00000000-0000-4000-8000-0000000000f1', format(
     $q$select admin.create_market(%L, %L, array['general'], 'Rules.', 'Hrizzup''s test desk', null,
          now(), now() + interval '1 day', 0.5, 100) ->> 'state'$q$,
     pg_temp.market(n), format('Will data event %s happen?', n))) order by n)
   from generate_series(1, 4) as n),
  array['draft', 'draft', 'draft', 'draft'],
  'four markets, made as drafts'
);
select is(
  (select array_agg(pg_temp.as_app('00000000-0000-4000-8000-0000000000f1', format(
     'select admin.open_market(%L) ->> ''state''', pg_temp.market(n))) order by n)
   from unnest(array[1, 3, 4]) as n),
  array['open', 'open', 'open'],
  'all but the second opened'
);
select is(
  array[
    pg_temp.as_app('00000000-0000-4000-8000-0000000000f1', format(
      'select admin.close_market(%L) ->> ''state''', pg_temp.market(3))),
    pg_temp.as_app('00000000-0000-4000-8000-0000000000f1', format(
      'select admin.close_market(%L) ->> ''state''', pg_temp.market(4))),
    pg_temp.as_app('00000000-0000-4000-8000-0000000000f1', format(
      $q$select admin.settle_market(%L, 'yes', null, 'The test desk said yes.', null) ->> 'state'$q$,
      pg_temp.market(3))),
    pg_temp.as_app('00000000-0000-4000-8000-0000000000f1', format(
      $q$select admin.settle_market(%L, 'probability', 0.3, 'Split.', null) ->> 'state'$q$,
      pg_temp.market(4)))
  ],
  array['closed', 'closed', 'settled', 'settled'],
  'the third and fourth closed, then settled: Yes, and at a set probability'
);

-- Trades in market 1, worked out by hand (as in trading_reads.test.sql): Ann buys Ṁ10 of Yes at 50%,
-- getting 19.090909 shares, and the pool holds 90.909091 Yes and 110 No; then Raj places two limit
-- orders that rest (Yes only up to 40%, No only from 70%), and Ann one more (Yes up to 30%).
select is(
  pg_temp.trade('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-00000000a001',
    pg_temp.market(1), 'buy', '{"outcome": "YES", "amount": "10.000000"}',
    '{"trade": {"id": "00000000-0000-4000-8000-00000000a101", "outcome": "YES",
                "order_amount": "10.000000", "is_filled": true},
      "fills": [{"matched": null, "amount": "10.000000", "shares": "19.090909"}],
      "makers": [], "cancel": [], "pool": {"yes": "90.909091", "no": "110.000000"}}') ->> 'status',
  'filled',
  'Ann buys Ṁ10 of Yes in market 1'
);
select is(
  (select array_agg(pg_temp.trade(o.who, o.request, pg_temp.market(1), 'buy',
     jsonb_build_object('outcome', o.outcome, 'amount', o.amount, 'limitProb', o.limit_prob),
     jsonb_build_object(
       'trade', jsonb_build_object('id', o.id, 'outcome', o.outcome, 'order_amount', o.amount,
                                   'limit_prob', o.limit_prob, 'is_filled', false),
       'fills', '[]'::jsonb, 'makers', '[]'::jsonb, 'cancel', '[]'::jsonb,
       'pool', '{"yes": "90.909091", "no": "110.000000"}'::jsonb)) ->> 'status' order by o.n)
   from (values
     (1, '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-00000000a002',
      '00000000-0000-4000-8000-00000000a102', 'YES', '5.000000', '0.40000000'),
     (2, '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-00000000a003',
      '00000000-0000-4000-8000-00000000a103', 'NO', '8.000000', '0.70000000'),
     (3, '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-00000000a004',
      '00000000-0000-4000-8000-00000000a104', 'YES', '3.000000', '0.40000000')
   ) as o (n, who, request, id, outcome, amount, limit_prob)),
  array['resting', 'resting', 'resting'],
  'three limit orders rest in market 1'
);

-- One market ------------------------------------------------------------------------------------------

select is(
  pg_temp.read(format('select market_data.one_market(%L)', pg_temp.market(1))) ->> 'probability',
  markets.probability(0.5, 90.909091, 110)::text,
  'an open market answers with its probability now'
);
select is(
  pg_temp.read(format('select market_data.one_market(%L)', pg_temp.market(1))) -> 'market',
  markets.market_record(pg_temp.market(1)::uuid),
  '... and the agreement''s record of it'
);
select is(
  pg_temp.read(format('select market_data.one_market(%L)', pg_temp.market(3))),
  jsonb_build_object('market', markets.market_record(pg_temp.market(3)::uuid), 'probability', null),
  'a settled market answers, with no probability (its record says how it settled)'
);
select is(
  array[
    pg_temp.read(format('select market_data.one_market(%L)', pg_temp.market(2))),
    pg_temp.read(format('select market_data.one_market(%L)', pg_temp.market(4))),
    pg_temp.read('select market_data.one_market(''019a7100-0009-7000-8000-000000000009'')')
  ],
  array[null, null, null]::jsonb[],
  'a draft, a market settled at a set probability, and no market at all: nothing'
);

-- Its history -------------------------------------------------------------------------------------------

select is(
  (select array_agg(p ->> 'probability')
   from jsonb_array_elements(pg_temp.read(format(
     'select market_data.market_history(%L, ''all'')', pg_temp.market(1))) -> 'points') p),
  array['0.50000000', markets.probability(0.5, 90.909091, 110)::text,
        markets.probability(0.5, 90.909091, 110)::text,
        markets.probability(0.5, 90.909091, 110)::text,
        markets.probability(0.5, 90.909091, 110)::text],
  'its history: the starting chance, then the chance after each trade (resting orders leave it)'
);
select is(
  (select array_agg(p ->> 'probability')
   from jsonb_array_elements(pg_temp.read(format(
     'select market_data.market_history(%L, ''1h'')', pg_temp.market(1))) -> 'points') p)
   = (select array_agg(p ->> 'probability')
      from jsonb_array_elements(pg_temp.read(format(
        'select market_data.market_history(%L, ''all'')', pg_temp.market(1))) -> 'points') p),
  true,
  'the last hour holds all of it, since the market opened just now'
);
select is(
  pg_temp.read(format('select market_data.market_history(%L, ''1d'')', pg_temp.market(2))),
  null,
  'a draft has no history anyone may read'
);
select throws_ok(
  format('select pg_temp.as_app(null, %L)',
    format('select market_data.market_history(%L, ''5y'')', pg_temp.market(1))),
  '22023', 'A range is 1h, 1d, 1w, 1m or all',
  'any other range is refused'
);

-- A market with more trades than a chart takes: 1,200 made by hand, a minute apart, in market 3 (the
-- settled one: its history stays), as if over the last 20 hours. The history keeps 1,000 points, the
-- first the chance as the range starts, then the last of each slice, in time order.
insert into markets.trades (id, market_id, account_id, request_id, number, kind, outcome, amount,
                            shares, prob_before, prob_after, created_at, updated_at)
select gen_random_uuid(), pg_temp.market(3)::uuid, a.id, gen_random_uuid(), 1000 + s, 'buy', 'YES', 0, 0,
       0.5, round(0.5 + s / 10000.0, 8), now() - interval '20 hours' + s * interval '1 minute',
       now() - interval '20 hours' + s * interval '1 minute'
from generate_series(1, 1200) s
cross join (select a.id from ledger.accounts a
            where a.user_id = '00000000-0000-4000-8000-0000000000f2') a;
select is(
  (select jsonb_array_length(pg_temp.read(format(
     'select market_data.market_history(%L, ''1d'')', pg_temp.market(3))) -> 'points')),
  1000,
  'a history never gives more than 1,000 points'
);
select is(
  (select bool_and((p ->> 'at')::timestamptz <= (q ->> 'at')::timestamptz)
   from (select p, lead(p) over (order by n) as q
         from jsonb_array_elements(pg_temp.read(format(
           'select market_data.market_history(%L, ''1d'')', pg_temp.market(3))) -> 'points')
           with ordinality as x (p, n)) pairs
   where q is not null),
  true,
  '... in time order'
);
select is(
  (select p ->> 'probability'
   from jsonb_array_elements(pg_temp.read(format(
     'select market_data.market_history(%L, ''1d'')', pg_temp.market(3))) -> 'points')
     with ordinality as x (p, n)
   order by n desc limit 1),
  '0.62000000',
  '... the last of them the chance after the last trade'
);

-- The resting orders, by price -------------------------------------------------------------------------

select is(
  pg_temp.read(format('select market_data.book(%L)', pg_temp.market(1))),
  jsonb_build_object(
    'probability', markets.probability(0.5, 90.909091, 110)::text,
    'yes', '[{"limitProb": "0.40000000", "amount": "8.000000", "orders": 2}]'::jsonb,
    'no', '[{"limitProb": "0.70000000", "amount": "8.000000", "orders": 1}]'::jsonb),
  'the book: what''s unfilled at each price, each side best first, with the pool''s price'
);
update markets.trades set expires_at = now() - interval '1 second'
where id = '00000000-0000-4000-8000-00000000a104';
select is(
  pg_temp.read(format('select market_data.book(%L)', pg_temp.market(1))) -> 'yes',
  '[{"limitProb": "0.40000000", "amount": "5.000000", "orders": 1}]'::jsonb,
  'an order that has expired leaves the book, though no trade has cancelled it yet'
);
select is(
  pg_temp.read(format('select market_data.book(%L)', pg_temp.market(2))),
  null,
  'a draft has no book anyone may read'
);

-- The latest trades --------------------------------------------------------------------------------------

select is(
  pg_temp.read(format('select market_data.trades(%L, null, 10)', pg_temp.market(1))),
  jsonb_build_object(
    'trades', jsonb_build_array(jsonb_build_object(
      'id', '00000000-0000-4000-8000-00000000a101',
      'outcome', 'YES',
      'action', 'buy',
      'amount', '10.000000',
      'shares', '19.090909',
      'limitProb', null,
      'probBefore', '0.50000000',
      'probAfter', markets.probability(0.5, 90.909091, 110)::text,
      'at', (select markets.utc(t.created_at) from markets.trades t
             where t.id = '00000000-0000-4000-8000-00000000a101'))),
    'next', null),
  'the latest trades: Ann''s buy, what it paid and got; orders that filled nothing aren''t trades yet'
);
select is(
  (select count(*)::integer
   from regexp_matches(
     pg_temp.read(format('select market_data.trades(%L, null, 100)', pg_temp.market(1)))::text
     || pg_temp.read(format('select market_data.book(%L)', pg_temp.market(1)))::text
     || pg_temp.read(format('select market_data.quote_state(%L)', pg_temp.market(1)))::text,
     '0000000000f[0-9]|@data\.test|' || (select string_agg(a.id::text, '|') from ledger.accounts a
                                          where a.user_id::text like '%0000000000f_'),
     'g')),
  0,
  'no public read names anyone: no account, no sign-in, no email'
);
select is(
  (select array_agg(t ->> 'probAfter' order by n)
   from jsonb_array_elements(pg_temp.read(format(
     'select market_data.trades(%L, null, 3)', pg_temp.market(3))) -> 'trades')
     with ordinality as x (t, n)),
  null,
  'trades with nothing filled as they were placed aren''t listed (the hand-made ones in market 3)'
);
insert into markets.fills (trade_id, matched_trade_id, amount, shares, created_at)
select t.id, null, 1, 1, t.created_at
from markets.trades t where t.market_id = pg_temp.market(3)::uuid and t.number between 1001 and 1005;
select is(
  pg_temp.read(format('select market_data.trades(%L, null, 2)', pg_temp.market(3))) ->> 'next',
  '1004',
  'a page of two, newest first, says where the next starts'
);
select is(
  (select array_agg(t ->> 'probAfter' order by n)
   from jsonb_array_elements(pg_temp.read(format(
     'select market_data.trades(%L, 1004, 2)', pg_temp.market(3))) -> 'trades')
     with ordinality as x (t, n)),
  array['0.50030000', '0.50020000'],
  '... and the next page carries on from there'
);
select throws_ok(
  format('select pg_temp.as_app(null, %L)',
    format('select market_data.trades(%L, null, 101)', pg_temp.market(1))),
  '22023', 'A page holds 1 to 100 trades',
  'a page holds at most 100 trades'
);

-- What a quote needs -------------------------------------------------------------------------------------

select is(
  (select jsonb_build_object(
     'market', (q -> 'market') - 'closes_at',
     'owners', (select array_agg(o ->> 'account_id' order by n)
                from jsonb_array_elements(q -> 'orders') with ordinality as x (o, n)),
     'balances', q -> 'balances')
   from pg_temp.read(format('select market_data.quote_state(%L)', pg_temp.market(1))) q),
  jsonb_build_object(
    'market', jsonb_build_object('id', pg_temp.market(1), 'state', 'open', 'p', '0.50000000',
                                 'pool_yes', '90.909091', 'pool_no', '110.000000',
                                 'seed', '100.000000'),
    'owners', array['o1', 'o1'],
    'balances', jsonb_build_object('o1', (select a.balance::text from ledger.accounts a
                                          where a.user_id = '00000000-0000-4000-8000-0000000000f3'))),
  'a quote''s market as a trade finds it: the pool, the live orders (owners as tokens) and what they can pay'
);
select is(
  pg_temp.read(format('select market_data.quote_state(%L)', pg_temp.market(2))),
  null,
  'a draft can''t be quoted'
);

-- Our own Bitcoin price ----------------------------------------------------------------------------------

select is(
  pg_temp.read('select market_data.price(''btc-usd'')'),
  null,
  'before the first price, there is none'
);
select is(
  pg_temp.read('select market_data.price_history(''btc-usd'', ''1d'')'),
  null,
  '... nor any history'
);
insert into prices.points (feed, at, price, sources, published_at)
select 'btc-usd', now() - interval '2 hours' + s * interval '5 seconds', 70000 + s, 3,
       now() - interval '2 hours' + s * interval '5 seconds' + interval '1 second'
from generate_series(0, 1439) s;
select is(
  pg_temp.read('select market_data.price(''btc-usd'')') - 'publishedAt' - 'at',
  '{"feed": "btc-usd", "price": "71439.00", "sources": 3}'::jsonb,
  'then the newest stored price, to the cent, and how many exchanges made it'
);
select is(
  (select jsonb_array_length(h -> 'points') from
   pg_temp.read('select market_data.price_history(''btc-usd'', ''1h'')') h),
  720,
  'the last hour: every 5-second price (720)'
);
select is(
  (select jsonb_array_length(h -> 'points') from
   pg_temp.read('select market_data.price_history(''btc-usd'', ''1d'')') h),
  1000,
  'the last day here holds 1,440: the last of each of 1,000 slices'
);
select is(
  (select h -> 'points' -> -1 ->> 'price' from
   pg_temp.read('select market_data.price_history(''btc-usd'', ''1d'')') h),
  '71439.00',
  '... ending with the newest'
);
select throws_ok(
  'select pg_temp.as_app(null, ''select market_data.price_history(''''btc-usd'''', ''''forever'''')'')',
  '22023', 'A range is 1h, 1d, 1w, 1m or all',
  'any other range is refused'
);

-- What a perp quote needs ------------------------------------------------------------------------------

select is(
  (select jsonb_build_object('trader', q -> 'trader', 'long', q -> 'perp' -> 'longAccountId',
                             'short', q -> 'perp' -> 'shortAccountId', 'feed', q -> 'perp' -> 'feed',
                             'point', q -> 'perp' -> 'point' ->> 'price')
   from pg_temp.read(format('select market_data.perp_quote_state(%L)',
     (select p.id from perps.perps p where p.listed))) q),
  '{"trader": null, "long": "pool-long", "short": "pool-short", "feed": "btc-usd", "point": "71439.00"}'::jsonb,
  'the Bitcoin perp as an open would find it: no trader, its pools as tokens, the newest price'
);
select is(
  pg_temp.read('select market_data.perp_quote_state(''019a7100-0009-7000-8000-000000000009'')'),
  null,
  'no such perp: nothing'
);

-- A bot's own trades -----------------------------------------------------------------------------------

select is(
  (select array_agg(t ->> 'id' order by n)
   from jsonb_array_elements(pg_temp.as_app('00000000-0000-4000-8000-0000000000f3',
     'select trading.my_trades(null, 10)')::jsonb -> 'trades') with ordinality as x (t, n)),
  array['00000000-0000-4000-8000-00000000a103', '00000000-0000-4000-8000-00000000a102'],
  'Raj''s own trades, newest first'
);
select is(
  (pg_temp.as_app('00000000-0000-4000-8000-0000000000f3', 'select trading.my_trades(null, 10)')::jsonb
    -> 'trades' -> 0) - 'at',
  jsonb_build_object(
    'id', '00000000-0000-4000-8000-00000000a103', 'market_id', pg_temp.market(1),
    'question', 'Will data event 1 happen?', 'action', 'buy', 'outcome', 'NO',
    'amount', '0.000000', 'shares', '0.000000', 'order_amount', '8.000000',
    'limit_prob', '0.70000000', 'expires_at', null, 'is_filled', false, 'is_cancelled', false,
    'cancel_reason', null, 'prob_before', markets.probability(0.5, 90.909091, 110)::text,
    'prob_after', markets.probability(0.5, 90.909091, 110)::text,
    'request_id', '00000000-0000-4000-8000-00000000a003', 'is_api', false),
  '... each as the books keep it, saying whether a bot''s key placed it'
);
select is(
  (select array_agg(t ->> 'id' order by n)
   from jsonb_array_elements(pg_temp.as_app('00000000-0000-4000-8000-0000000000f3',
     'select trading.my_trades(''00000000-0000-4000-8000-00000000a103'', 1)')::jsonb -> 'trades')
     with ordinality as x (t, n)),
  array['00000000-0000-4000-8000-00000000a102'],
  'a page after one of them carries on from it'
);
select throws_ok(
  'select pg_temp.as_app(null, ''select trading.my_trades(null, 10)'')',
  '42501', 'Trades are read for a signed-in account',
  'nobody signed in has no trades to read'
);
select throws_ok(
  'select pg_temp.as_app(''00000000-0000-4000-8000-0000000000f2'', ''select trading.my_trades(''''00000000-0000-4000-8000-00000000a103'''', 10)'')',
  '22023', 'No such trade on this account',
  'nobody pages after someone else''s trade'
);

select * from finish();
rollback;
