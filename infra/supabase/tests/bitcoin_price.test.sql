-- Tests for migrations/*_bitcoin_price.sql (PLAN.md step 3.4b), run by the Database check on every
-- pull request against a fresh database built from the migrations. Everything runs in a transaction
-- that is rolled back, so nothing is left behind, and Supabase Cron's own runs never see it.
--
-- No test here asks an exchange anything, nor queues a request to one: the answers are made up and
-- written where pg_net would put them, and the last test checks nothing is waiting to be sent.
--
-- The schedule; who may reach the prices; each exchange's answer read; the median, the spare and
-- the 1% rule; asking only where a perp on the price is switched on and the jobs are set up; an
-- ask's price stored once, held for 30 seconds, never older than the newest; the listed perp's one
-- move to our price; a step on it applying exactly the newest stored price, an order filling only
-- at a price stored after it; and the hourly tidy.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(62);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'ada@bitcoin-price.test'),
  ('00000000-0000-4000-8000-0000000000e2', 'ivy@bitcoin-price.test');
insert into private.admins (user_id, note) values
  ('00000000-0000-4000-8000-0000000000e1', 'Ada, the Bitcoin price tests'' admin');
select ledger.open_account('00000000-0000-4000-8000-0000000000e2', 1000);

-- The listed perp (the Bitcoin perp, made by its migration).
create function pg_temp.btc()
returns uuid
language sql
as $$
  select '01a1c501-ec40-78f6-87b6-3fb041143421'::uuid;
$$;

-- Runs one query as the app's own role, signed in as `who` (or as nobody), and gives back its one
-- value as text.
create function pg_temp.as_app(who uuid, query text)
returns text
language plpgsql
as $$
declare
  answer text;
begin
  perform set_config('request.jwt.claims',
    case when who is null then '{"role": "anon"}'
         else json_build_object('sub', who, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  set local role hrizzup_app;
  execute query into answer;
  reset role;
  return answer;
end;
$$;

-- The tests' own clock: every ask is so many seconds from this moment.
create table pg_temp.started as select date_trunc('milliseconds', clock_timestamp()) as at;
create function pg_temp.t(seconds numeric)
returns timestamptz
language sql
as $$
  select at + make_interval(secs => seconds) from pg_temp.started;
$$;

-- An ask at `asked`, with each exchange's made-up answer ({source: [status, body]}; a source with
-- null for its answer hasn't answered yet), written where pg_net puts answers, under request IDs
-- pg_net never gives (negative ones).
create sequence pg_temp.fake_ids;
create function pg_temp.fake_ask(asked timestamptz, answers jsonb)
returns void
language plpgsql
as $$
declare
  item record;
  id bigint;
begin
  for item in select * from jsonb_each(answers) loop
    id := -nextval('pg_temp.fake_ids');
    insert into prices.quotes (feed, at, source, request_id)
    values ('btc-usd', asked, item.key, id);
    if jsonb_typeof(item.value) = 'array' then
      insert into net._http_response (id, status_code, content, created)
      values (id, (item.value ->> 0)::integer, item.value ->> 1, asked + interval '200 milliseconds');
    end if;
  end loop;
end;
$$;

-- Each exchange's answer, as it really writes one (10 November 2026, from staging).
create function pg_temp.body(source text, price text)
returns text
language sql
as $$
  select case source
    when 'coinbase' then format('{"ask":"73342.18","bid":"73342.17","volume":"10128.50159005","trade_id":1118362427,"price":"%s","size":"0.00000006","time":"2026-11-10T19:05:03.380541869Z","rfq_volume":"84.962637"}', price)
    when 'kraken' then format('{"error":[],"result":{"XXBTZUSD":{"a":["73339.00000","3","3.000"],"b":["73338.90000","1","1.000"],"c":["%s","0.00020000"],"v":["2959.00635755","3614.93421486"],"p":["73675.96686","73905.68926"],"t":[148467,179873],"l":["72584.60000","72584.60000"],"h":["75323.50000","75323.50000"],"o":"75253.10000"}}}', price)
    when 'bitstamp' then format('{"timestamp":"1794337791","open":"75255.09","high":"75333.75","low":"72677.46","last":"%s","volume":"2257.19935407","vwap":"74085.32","bid":"73355.63","ask":"73355.64","side":"0","open_24":"75255.09","percent_change_24":"-2.54"}', price)
    when 'gemini' then format('{"bid":"73346.58000","ask":"73346.59000","last":"%s","volume":{"BTC":"246.86000813","USD":"18105609.0980837119","timestamp":1794337500000}}', price)
  end;
$$;

-- An ask's answers, each exchange's price as a 200 (null: a 503).
create function pg_temp.answering(coinbase text, kraken text, bitstamp text, gemini text default 'none')
returns jsonb
language sql
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'coinbase', case when coinbase is null then jsonb_build_array(503, 'no')
                     else jsonb_build_array(200, pg_temp.body('coinbase', coinbase)) end,
    'kraken', case when kraken is null then jsonb_build_array(503, 'no')
                   else jsonb_build_array(200, pg_temp.body('kraken', kraken)) end,
    'bitstamp', case when bitstamp is null then jsonb_build_array(503, 'no')
                     else jsonb_build_array(200, pg_temp.body('bitstamp', bitstamp)) end,
    'gemini', case when gemini = 'none' then null
                   when gemini is null then jsonb_build_array(503, 'no')
                   else jsonb_build_array(200, pg_temp.body('gemini', gemini)) end));
$$;

create function pg_temp.queued_to_exchanges()
returns bigint
language sql
as $$
  select count(*) from net.http_request_queue q
  where q.url in (select e.url from prices.exchanges() e);
$$;


-- The schedule ----------------------------------------------------------------------------------------

select results_eq(
  $$select jobname::text, schedule::text, command::text, username::text, active
    from cron.job where jobname like 'prices-%' order by jobname$$,
  $$values ('prices-btc-usd', '5 seconds', 'call prices.fetch()', 'postgres', true),
           ('prices-tidy', '41 * * * *', 'select prices.tidy()', 'postgres', true)$$,
  'Supabase Cron asks for the price every 5 seconds, and tidies its history every hour'
);
select results_eq(
  $$select source, url, spare from prices.exchanges() order by spare, source$$,
  $$values ('bitstamp', 'https://www.bitstamp.net/api/v2/ticker/btcusd/', false),
           ('coinbase', 'https://api.exchange.coinbase.com/products/BTC-USD/ticker', false),
           ('kraken', 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD', false),
           ('gemini', 'https://api.gemini.com/v1/pubticker/btcusd', true)$$,
  'three exchanges for Bitcoin in US dollars, and Gemini standing by'
);


-- Who may reach the prices ------------------------------------------------------------------------------

select ok(
  (select bool_and(c.relrowsecurity) from pg_catalog.pg_class c
   where c.relnamespace = 'prices'::regnamespace and c.relkind = 'r'),
  'every table of the prices has row-level security on'
);
select is_empty(
  $$select c.relname::text || ' ' || r.rolname::text
    from pg_catalog.pg_class c, pg_catalog.pg_roles r
    where c.relnamespace = 'prices'::regnamespace and c.relkind = 'r'
      and r.rolname in ('hrizzup_app', 'anon', 'authenticated', 'service_role')
      and (pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT')
           or pg_catalog.has_table_privilege(r.oid, c.oid, 'INSERT')
           or pg_catalog.has_table_privilege(r.oid, c.oid, 'UPDATE')
           or pg_catalog.has_table_privilege(r.oid, c.oid, 'DELETE'))$$,
  'neither the app nor any of Supabase''s roles may read or write the prices'' tables'
);
select is_empty(
  $$select p.oid::regprocedure::text || ' ' || r.rolname::text
    from pg_catalog.pg_proc p, pg_catalog.pg_roles r
    where p.pronamespace = 'prices'::regnamespace
      and r.rolname in ('hrizzup_app', 'anon', 'authenticated', 'service_role')
      and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')$$,
  'nor call any of their functions, nor the schedule''s procedure: only the schedule asks'
);
select is_empty(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'prices'::regnamespace and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and not (p.proconfig @> array['search_path=""'])$$,
  'each of the prices'' functions trusts no search path'
);


-- Each exchange's answer, read ---------------------------------------------------------------------------

select results_eq(
  $$select prices.read_answer(s, 200, pg_temp.body(s, p))
    from (values ('coinbase', '73342.17'), ('kraken', '73337.70000'), ('bitstamp', '73343.63'),
                 ('gemini', '73347.56000')) v (s, p)$$,
  $$values (73342.17::numeric), (73337.7), (73343.63), (73347.56)$$,
  'each exchange''s last trade price, read from where that exchange puts it'
);
select ok(
  (select bool_and(prices.read_answer(s, st, b) is null) from (values
    ('coinbase', 503, pg_temp.body('coinbase', '73342.17')),
    ('coinbase', 200, 'not json'),
    ('coinbase', 200, '[{"price": "73342.17"}]'),
    ('coinbase', 200, '{"last": "73342.17"}'),
    ('coinbase', 200, '{"price": "7.3e4"}'),
    ('coinbase', 200, '{"price": "-73342.17"}'),
    ('coinbase', 200, '{"price": "0"}'),
    ('coinbase', 200, '{"price": "NaN"}'),
    ('coinbase', 200, '{"price": "Infinity"}'),
    ('coinbase', 200, '{"price": ""}'),
    ('coinbase', null, null),
    ('kraken', 200, '{"error":["EService:Unavailable"],"result":{"XXBTZUSD":{"c":["73337.7","1"]}}}'),
    ('kraken', 200, '{"error":[],"result":{"XBTUSDT":{"c":["73337.7","1"]}}}'),
    ('gemini', 200, pg_temp.body('coinbase', '73342.17')),
    ('binance', 200, '{"price": "73342.17"}')) v (s, st, b)),
  'anything else is no price: not a 200, not JSON, not where that exchange puts it, not a plain decimal'
);


-- The median, the spare and the 1% rule --------------------------------------------------------------

select results_eq(
  $$select prices.median(f) from (values ('{}'::numeric[]), ('{3,1,2}'), ('{4,1,3,2}'),
                                         ('{5,null,1}'), (null)) v (f)$$,
  $$values (null::numeric), (2::numeric), (2.5), (3), (null)$$,
  'the median: the middle one, or the average of the middle two; gaps ignored'
);

create function pg_temp.combine(coinbase text, kraken text, bitstamp text, gemini text default null)
returns jsonb
language sql
as $$
  select prices.combine(jsonb_build_array(
    jsonb_build_object('source', 'coinbase', 'price', coinbase),
    jsonb_build_object('source', 'kraken', 'price', kraken),
    jsonb_build_object('source', 'bitstamp', 'price', bitstamp),
    jsonb_build_object('source', 'gemini', 'spare', true, 'price', gemini)));
$$;

select is(
  pg_temp.combine('73342.17', '73337.7', '73343.63'),
  '{"price": "73342.17", "sources": 3, "outcomes": {"coinbase": "used", "kraken": "used",
    "bitstamp": "used", "gemini": "failed"}}'::jsonb,
  'the three agreeing: their median'
);
select is(
  pg_temp.combine('73342.17', '73337.7', '73343.63', '73345.00'),
  '{"price": "73342.17", "sources": 3, "outcomes": {"coinbase": "used", "kraken": "used",
    "bitstamp": "used", "gemini": "unused"}}'::jsonb,
  'the spare isn''t needed while the three are there'
);
select is(
  pg_temp.combine('73342.17', '73337.7', null, '73345.00'),
  '{"price": "73342.17", "sources": 3, "outcomes": {"coinbase": "used", "kraken": "used",
    "bitstamp": "failed", "gemini": "used"}}'::jsonb,
  'one failed: the spare stands in for it'
);
select is(
  pg_temp.combine('73342.17', '73337.7', '75000.00', '73345.00'),
  '{"price": "73342.17", "sources": 3, "outcomes": {"coinbase": "used", "kraken": "used",
    "bitstamp": "dropped", "gemini": "used"}}'::jsonb,
  'one more than 1% from the median of all the answers is dropped, and the spare stands in'
);
select is(
  pg_temp.combine('73342.17', '73340.10', null),
  '{"price": "73341.14", "sources": 2, "outcomes": {"coinbase": "used", "kraken": "used",
    "bitstamp": "failed", "gemini": "failed"}}'::jsonb,
  'two: their average, to the cent'
);
select is(
  pg_temp.combine('73342.17', null, null, null),
  '{"price": null, "sources": 0, "outcomes": {"coinbase": "unused", "kraken": "failed",
    "bitstamp": "failed", "gemini": "failed"}}'::jsonb,
  'one alone is no price'
);
select is(
  pg_temp.combine('100', '103', null),
  '{"price": null, "sources": 0, "outcomes": {"coinbase": "dropped", "kraken": "dropped",
    "bitstamp": "failed", "gemini": "failed"}}'::jsonb,
  'two 3% apart: neither is within 1% of their median, so no price'
);
select is(
  pg_temp.combine(null, null, null, null) -> 'price', 'null'::jsonb,
  'nothing answered: no price'
);


-- Asking, only where a perp on the price is switched on and the jobs are set up ------------------------

select ok(not prices.wanted('btc-usd'), 'a fresh database wants no price: its perp is off');
select is(prices.ask('btc-usd'), null, 'so an ask asks nothing');
select lives_ok('call prices.fetch()', 'and the schedule''s run does nothing');
select is((select count(*) from prices.quotes), 0::bigint, 'no ask is recorded');
select throws_ok(
  $$select prices.ask('eth-usd')$$, '22023', 'No price eth-usd', 'a price we don''t have is refused'
);

-- The listed perp, moved onto our price by its own migration (3.4b's third), and switched on.
select results_eq(
  $$select p.feed, r.old_value, r.new_value, r.by_account is null, r.reason like 'Our own Bitcoin price replaces the stand-in%'
    from perps.perps p join perps.rule_changes r on r.perp_id = p.id and r.rule = 'feed'
    where p.id = pg_temp.btc()$$,
  $$values ('btc-usd'::text, 'stand-in-btc-usd'::text, 'btc-usd'::text, true, true)$$,
  'the Bitcoin perp is on our own price, its move in its rule-change log'
);
select ok(not prices.wanted('btc-usd'), 'on our price but switched off: still nothing');
select vault.create_secret('http://127.0.0.1:9/api/jobs/perps', 'perps_jobs_url',
                           'The Bitcoin price tests'' address');
select vault.create_secret('the-bitcoin-price-tests-jobs-secret-not-a-key', 'perps_jobs_secret',
                           'The Bitcoin price tests'' secret');
select pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
  $q$select admin.set_perp_mode(%L, 'enabled', 'The price tests switch it on')::text$q$,
  pg_temp.btc()));
select ok(prices.wanted('btc-usd'), 'switched on, with the jobs set up: the price is wanted');
delete from vault.secrets where name = 'perps_jobs_url';
select ok(not prices.wanted('btc-usd'),
          'without the jobs'' address in Vault (a check''s database, this Mac''s), never');
select vault.create_secret('http://127.0.0.1:9/api/jobs/perps', 'perps_jobs_url',
                           'The Bitcoin price tests'' address');


-- The listed perp's one move ---------------------------------------------------------------------------

select throws_ok(
  $$update perps.perps set feed = 'stand-in-btc-usd' where id = '01a1c501-ec40-78f6-87b6-3fb041143421'$$,
  '23001', 'A perp''s identity, pools, listing, price walk and seed never change',
  'the listed perp never moves back to its stand-in'
);
select pg_temp.as_app('00000000-0000-4000-8000-0000000000e1',
  $q$select admin.create_test_perp('01a1c504-0000-7000-8000-000000000001', 'Price test perp',
       '00112233aabbccdd',
       jsonb_build_object('origin', '2026-11-01T00:00:00Z', 'startPrice', '100', 'volatility', '40'),
       jsonb_build_object('maxLeverage', '10', 'takerFeeBps', '10', 'takerFeeImpact', '0',
                          'fundingPeriodMs', '3600000', 'fundingSensitivity', '1',
                          'maxFundingRate', '0.0001', 'maxPriceAgeMs', '120000',
                          'subsidyLong', '1000', 'subsidyShort', '1000'),
       clock_timestamp(), 'The price tests'' own test perp')::text$q$);
select throws_ok(
  $$update perps.perps set feed = 'btc-usd' where id = '01a1c504-0000-7000-8000-000000000001'$$,
  '23001', null,
  'a check run''s test perp keeps its stand-in'
);
select lives_ok(
  $$insert into perps.rule_changes (perp_id, by_account, rule, old_value, new_value, reason)
    values ('01a1c501-ec40-78f6-87b6-3fb041143421', null, 'feed', 'stand-in-btc-usd', 'btc-usd',
            'The price tests log the move')$$,
  'the rule-change log takes the move'
);


-- An ask's price -----------------------------------------------------------------------------------------

-- The first ask, a minute ago: the three main exchanges agreeing.
select pg_temp.fake_ask(pg_temp.t(-60),
                        pg_temp.answering('73342.17', '73337.70000', '73343.63'));
select ok(prices.ready('btc-usd', pg_temp.t(-60)), 'its answers are in');
select ok(not prices.needs_spare('btc-usd', pg_temp.t(-60)), 'three agreeing: no spare needed');
select is(prices.ask_spare('btc-usd', pg_temp.t(-60)), false, 'so none is asked');
select is(
  prices.settle('btc-usd', pg_temp.t(-60)) - 'publishedAt',
  jsonb_build_object('feed', 'btc-usd', 'at', markets.utc(pg_temp.t(-60)), 'price', '73342.17',
                     'sources', 3),
  'the median is stored, under the ask''s time'
);
select results_eq(
  $$select source, outcome, price from prices.quotes where at = pg_temp.t(-60) order by source$$,
  $$values ('bitstamp', 'used', 73343.63::numeric), ('coinbase', 'used', 73342.17),
           ('kraken', 'used', 73337.7)$$,
  'with each exchange''s answer and what became of it'
);
select is(prices.settle('btc-usd', pg_temp.t(-60)), null, 'once');
select throws_ok(
  $$update prices.points set price = 1$$, '23001', null, 'a stored price is never edited'
);

-- The second, 55 seconds ago: Bitstamp failed, then the spare.
select pg_temp.fake_ask(pg_temp.t(-55),
                        pg_temp.answering('73350.00', '73348.10000', null));
select ok(prices.needs_spare('btc-usd', pg_temp.t(-55)), 'one failed: the spare is needed');
select pg_temp.fake_ask(pg_temp.t(-55), '{"gemini": [200, "{\"last\": \"73352.00000\"}"]}');
select ok(not prices.needs_spare('btc-usd', pg_temp.t(-55)), 'and asked only once');
select is(
  prices.settle('btc-usd', pg_temp.t(-55)) ->> 'price', '73350.00',
  'the median of the two and the spare'
);
insert into net._http_response (id, status_code, content, created)
select q.request_id, 200, pg_temp.body('coinbase', '99999.00'), q.at + interval '300 milliseconds'
from prices.quotes q where q.at = pg_temp.t(-55) and q.source = 'coinbase';
select results_eq(
  $$select came, price from prices.answers('btc-usd', pg_temp.t(-55)) where source = 'coinbase'$$,
  $$values (true, null::numeric)$$,
  'a second answer under one request''s ID makes that exchange''s answer a failure'
);

-- The third, 50 seconds ago: an answer not in yet, and nothing else.
select pg_temp.fake_ask(pg_temp.t(-50),
                        jsonb_build_object('coinbase', null, 'kraken', jsonb_build_array(503, 'no'),
                                           'bitstamp', jsonb_build_array(503, 'no')));
select ok(not prices.ready('btc-usd', pg_temp.t(-50)), 'an answer still to come: not ready');
select is(
  prices.settle('btc-usd', pg_temp.t(-50)) - 'publishedAt',
  jsonb_build_object('feed', 'btc-usd', 'at', markets.utc(pg_temp.t(-50)), 'price', '73350.00',
                     'sources', 0),
  'no price: the last real one is held'
);
select is(
  (select outcome from prices.quotes where at = pg_temp.t(-50) and source = 'coinbase'),
  'failed', 'an answer not in by then counts as failed'
);

-- 30 seconds after the last real price (55 seconds ago), nothing more is held.
select pg_temp.fake_ask(pg_temp.t(-26), pg_temp.answering(null, null, null, null));
select is(prices.settle('btc-usd', pg_temp.t(-26)) ->> 'sources', '0', 'held, 29 seconds on');
select pg_temp.fake_ask(pg_temp.t(-25), pg_temp.answering(null, null, null, null));
select is(prices.settle('btc-usd', pg_temp.t(-25)), null,
          '30 seconds after the last real price, nothing: the perp then fills and liquidates nothing');

-- A price returns.
select pg_temp.fake_ask(pg_temp.t(-4),
                        pg_temp.answering('73360.00', '73361.00000', '73359.50'));
select is(prices.settle('btc-usd', pg_temp.t(-4)) ->> 'price', '73360.00', 'and prices return');
-- An ask older than the newest price is never stored.
select pg_temp.fake_ask(pg_temp.t(-10),
                        pg_temp.answering('1', '1', '1'));
select is(prices.settle('btc-usd', pg_temp.t(-10)), null, 'never older');
select is(
  prices.latest('btc-usd') ->> 'price', '73360.00', 'the newest stored price is the one everyone reads'
);


-- The perp on our price ----------------------------------------------------------------------------------

select is(
  perps.price_sources(array[pg_temp.btc(), '01a1c504-0000-7000-8000-000000000001'::uuid])
    -> pg_temp.btc()::text -> 'point' ->> 'price',
  '73360.00', 'the server finds the perp''s newest price where it finds its price''s source'
);
select is(
  perps.price_sources(array['01a1c504-0000-7000-8000-000000000001'::uuid])
    -> '01a1c504-0000-7000-8000-000000000001' -> 'point', null,
  'a test perp has none: its price is its stand-in''s'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000e2',
    format($q$select perps.holdings(%L, gen_random_uuid()) ->> 'feed'$q$, pg_temp.btc())),
  'btc-usd', 'before a trade, the server learns which price the perp is on'
);

-- Ivy opens a 10-times long of Ṁ100, placed just before the newest price: the step, the way the
-- server runs it, filling at `price` stored at `at`.
create function pg_temp.ivy_opens(at text, price text, placed timestamptz)
returns jsonb
language plpgsql
as $$
declare
  ivy uuid := (select a.id from ledger.accounts a
               where a.kind = 'person' and a.user_id = '00000000-0000-4000-8000-0000000000e2');
  long_pool uuid := (select p.long_account_id from perps.perps p where p.id = pg_temp.btc());
  pools jsonb := (select jsonb_build_object(
                    'long', (select balance + 101 from ledger.accounts where id = p.long_account_id)::text,
                    'short', (select balance from ledger.accounts where id = p.short_account_id)::text)
                  from perps.perps p where p.id = pg_temp.btc());
  request uuid := gen_random_uuid();
  params jsonb := '{"direction": "long", "margin": "100", "leverage": "10"}';
  begun jsonb;
  moment text;
  answer jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e2', true);
  set local role hrizzup_app;
  begun := perps.begin_step(pg_temp.btc(), 'open', request, params, placed);
  reset role;
  moment := begun ->> 'now';
  set local role hrizzup_app;
  answer := perps.apply_step(jsonb_build_object(
    'perp_id', pg_temp.btc(), 'action', 'open', 'request_id', request, 'params', params,
    'price', jsonb_build_object('at', at, 'price', price),
    'paused_reason', null,
    'moves', jsonb_build_array(
      jsonb_build_object('phase', 'trade', 'from', ivy, 'to', long_pool, 'amount', '100'),
      jsonb_build_object('phase', 'trade', 'from', ivy, 'to', long_pool, 'amount', '1')),
    'positions', jsonb_build_array(jsonb_build_object(
      'id', '0b000000-0000-4000-8000-0000000000e1', 'accountId', ivy, 'direction', 'long',
      'size', '1000', 'costBasis', '100', 'originalCostBasis', '100', 'takerFeeCostBasis', '1',
      'entryPrice', price, 'leverage', '10',
      'liquidationPrice', (price::numeric * 0.9)::text,
      'openedAt', moment, 'updatedAt', moment, 'closeReason', null)),
    'events', jsonb_build_array(jsonb_build_object(
      'phase', 'trade', 'kind', 'open', 'positionId', '0b000000-0000-4000-8000-0000000000e1',
      'sizeChange', '1000', 'costBasisChange', '100', 'margin', '100', 'fee', '1', 'payout', '0')),
    'pools', pools));
  reset role;
  return answer;
end;
$$;

select is(
  (select pg_temp.as_app('00000000-0000-4000-8000-0000000000e2', format(
     $q$select perps.begin_step(%L, 'open', gen_random_uuid(), '{"direction": "long", "margin": "100", "leverage": "10"}', clock_timestamp() - interval '5 seconds') -> 'perp' -> 'point' ->> 'at'$q$,
     pg_temp.btc()))),
  markets.utc(pg_temp.t(-4)),
  'a step on the perp is handed the newest stored price'
);
select set_config('perps.stepping', '', true);
select throws_ok(
  format($q$select pg_temp.ivy_opens(%L, '73350.00', %L)$q$,
         markets.utc(pg_temp.t(-50)), pg_temp.t(-50) - interval '1 millisecond'),
  '23514', 'A new price is our own, the newest stored as the step began, newer than the last',
  'the books refuse an older stored price'
);
select throws_ok(
  format($q$select pg_temp.ivy_opens(%L, '73000.00', %L)$q$,
         markets.utc(pg_temp.t(-4)), pg_temp.t(-4) - interval '1 millisecond'),
  '23514', 'A new price is our own, the newest stored as the step began, newer than the last',
  'and the newest one at any other price'
);
select throws_ok(
  format($q$select pg_temp.ivy_opens(%L, '73360.00', %L)$q$,
         markets.utc(pg_temp.t(-4)), pg_temp.t(-4) + interval '1 millisecond'),
  '23514', 'An order fills only at a fresh price published after it was placed',
  'an order placed after the newest price was asked for waits for the next'
);
select is(
  pg_temp.ivy_opens(markets.utc(pg_temp.t(-4)), '73360.00',
                    pg_temp.t(-4) - interval '1 millisecond') ->> 'price',
  '73360.00',
  'an order placed before it fills at exactly the newest stored price'
);
select results_eq(
  $$select markets.utc(at), price::text from perps.prices where perp_id = pg_temp.btc()$$,
  $$values (markets.utc(pg_temp.t(-4)), '73360.00')$$,
  'which the perp''s book applied'
);
select ok(
  not pg_temp.btc() = any (perps.due('tick')),
  'with no newer price stored, a tick has no work on it'
);
insert into prices.points (feed, at, price, sources, published_at)
values ('btc-usd', pg_temp.t(-1), 73370, 3, pg_temp.t(-1));
select ok(pg_temp.btc() = any (perps.due('tick')), 'once one is, it has');


-- The hourly tidy ------------------------------------------------------------------------------------------

insert into prices.points (feed, at, price, sources, published_at)
select 'btc-usd', m + s * interval '5 seconds', 70000 + s, 3, m + s * interval '5 seconds'
from (values (date_trunc('minute', clock_timestamp() - interval '31 days', 'UTC')),
             (date_trunc('minute', clock_timestamp() - interval '29 days', 'UTC'))) v (m),
     generate_series(0, 11) s;
insert into prices.quotes (feed, at, source, request_id, outcome)
values ('btc-usd', clock_timestamp() - interval '3 days', 'coinbase', -9001, 'failed');
select is(
  prices.tidy(), '{"thinned": 11, "forgotten": 1}'::jsonb,
  'the hourly tidy keeps each minute''s last price once it''s 30 days old, and two days of answers'
);
select results_eq(
  $$select count(*)::integer, max(price)::integer from prices.points
    where at < clock_timestamp() - interval '28 days'
    group by date_trunc('minute', at, 'UTC') order by 1$$,
  $$values (1, 70011), (12, 70011)$$,
  'the 31-day-old minute keeps its last price; the 29-day-old one keeps all twelve'
);

select is(pg_temp.queued_to_exchanges(), 0::bigint, 'and no test asked an exchange anything');

select * from finish();
rollback;
