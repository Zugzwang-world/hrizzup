-- Tests for migrations/*_perp_books.sql (PLAN.md step 3.4a), run by the Database check on every pull
-- request against a fresh database built from the migrations. Everything runs in a transaction that
-- is rolled back, so nothing is left behind.
--
-- The steps run the way the server runs them: perps.begin_step, then perps.apply_step, as the app's
-- own role with an account signed in (or nobody, for the scheduled jobs' steps), from plans worked
-- out by hand here. The server's maths, and these steps through the typed API, are tested in the
-- perp's own package and its journeys. A new price needs a new 5-second step, so the tests run in
-- three windows, a little over 5 seconds apart.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(177);

-- People, perps and positions, by name -------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'ada@perps.test'),
  ('00000000-0000-4000-8000-0000000000e2', 'ann@perps.test'),
  ('00000000-0000-4000-8000-0000000000e3', 'raj@perps.test'),
  ('00000000-0000-4000-8000-0000000000e4', 'zoe@perps.test'),
  ('00000000-0000-4000-8000-0000000000e5', 'sid@perps.test');
insert into private.admins (user_id, note) values
  ('00000000-0000-4000-8000-0000000000e1', 'Ada, the perps tests'' admin');

create function pg_temp.user_id(name text)
returns uuid
language sql
as $$
  select case name
    when 'ada' then '00000000-0000-4000-8000-0000000000e1'::uuid
    when 'ann' then '00000000-0000-4000-8000-0000000000e2'::uuid
    when 'raj' then '00000000-0000-4000-8000-0000000000e3'::uuid
    when 'zoe' then '00000000-0000-4000-8000-0000000000e4'::uuid
    when 'sid' then '00000000-0000-4000-8000-0000000000e5'::uuid
  end;
$$;

-- A person's play-money account.
create function pg_temp.acct(name text)
returns uuid
language sql
as $$
  select a.id from ledger.accounts a where a.kind = 'person' and a.user_id = pg_temp.user_id(name);
$$;

-- The test perps, and the Bitcoin perp.
create function pg_temp.perp(name text)
returns uuid
language sql
as $$
  select case name
    when 't1' then '01a1c502-0000-7000-8000-000000000001'::uuid
    when 't2' then '01a1c502-0000-7000-8000-000000000002'::uuid
    when 't3' then '01a1c502-0000-7000-8000-000000000003'::uuid
    when 'btc' then '01a1c501-ec40-78f6-87b6-3fb041143421'::uuid
  end;
$$;

create function pg_temp.pool(perp text, side text)
returns uuid
language sql
as $$
  select case side when 'long' then p.long_account_id else p.short_account_id end
  from perps.perps p where p.id = pg_temp.perp(perp);
$$;

create function pg_temp.balance(account uuid)
returns numeric
language sql
as $$
  select a.balance from ledger.accounts a where a.id = account;
$$;

-- Positions, by who holds them.
create function pg_temp.position(name text)
returns uuid
language sql
as $$
  select case name
    when 'ann' then '0b000000-0000-4000-8000-0000000000a1'::uuid
    when 'raj' then '0b000000-0000-4000-8000-0000000000a2'::uuid
    when 'zoe' then '0b000000-0000-4000-8000-0000000000a3'::uuid
    when 'sid' then '0b000000-0000-4000-8000-0000000000a4'::uuid
    when 'sid-long' then '0b000000-0000-4000-8000-0000000000a5'::uuid
    when 'sid-short' then '0b000000-0000-4000-8000-0000000000a6'::uuid
  end;
$$;

-- A move, an event and a position, as a plan writes them.
create function pg_temp.mv(phase text, from_account uuid, to_account uuid, amount text)
returns jsonb
language sql
as $$
  select jsonb_build_object('phase', phase, 'from', from_account, 'to', to_account, 'amount', amount);
$$;

create function pg_temp.ev(phase text, kind text, holder text, size_change text,
                           cost_basis_change text, margin text default '0', fee text default '0',
                           payout text default '0')
returns jsonb
language sql
as $$
  select jsonb_build_object('phase', phase, 'kind', kind, 'positionId', pg_temp.position(holder),
                            'sizeChange', size_change, 'costBasisChange', cost_basis_change,
                            'margin', margin, 'fee', fee, 'payout', payout);
$$;

create function pg_temp.pos(holder text, direction text, size text, cost_basis text,
                            original_cost_basis text, fee_cost_basis text, entry_price text,
                            leverage text, liquidation_price text, close_reason text default null,
                            opened text default 'now')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', pg_temp.position(holder), 'accountId', pg_temp.acct(split_part(holder, '-', 1)),
    'direction', direction,
    'size', size, 'costBasis', cost_basis, 'originalCostBasis', original_cost_basis,
    'takerFeeCostBasis', fee_cost_basis, 'entryPrice', entry_price, 'leverage', leverage,
    'liquidationPrice', liquidation_price, 'openedAt', opened, 'updatedAt', 'now',
    'closeReason', close_reason);
$$;

-- Runs one query as the app's own role, signed in as `name` (null: nobody), and gives back its one
-- value as text.
create function pg_temp.as_app(name text, query text)
returns text
language plpgsql
as $$
declare
  answer text;
begin
  perform set_config('request.jwt.claims',
    case when name is null then '{"role": "anon"}'
         else json_build_object('sub', pg_temp.user_id(name), 'role', 'authenticated')::text end,
    true);
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.user_id(name)::text, ''), true);
  set local role hrizzup_app;
  execute query into answer;
  reset role;
  return answer;
end;
$$;

-- One step, the way the server runs it: begin_step, then apply_step with the plan (worked out by
-- hand here), as the app's own role. A trade is placed just before the book's price (or, on a perp
-- with no price yet, 6 seconds ago), so it fills at a price published after it. In the plan, "now"
-- stands for the step's moment: a new price's time (its 5-second step) and a position's times.
create function pg_temp.step(name text, perp text, action text, request text, params jsonb,
                             plan jsonb)
returns jsonb
language plpgsql
as $$
declare
  begun jsonb;
  answer jsonb;
  placed timestamptz;
  moment text;
  step_time text;
  positions jsonb;
begin
  if action in ('open', 'close') then
    select coalesce(p.price_at - interval '1 millisecond', clock_timestamp() - interval '6 seconds')
      into placed from perps.perps p where p.id = pg_temp.perp(perp);
  end if;
  perform set_config('request.jwt.claims',
    case when name is null then '{"role": "anon"}'
         else json_build_object('sub', pg_temp.user_id(name), 'role', 'authenticated')::text end,
    true);
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.user_id(name)::text, ''), true);
  set local role hrizzup_app;
  begun := perps.begin_step(pg_temp.perp(perp), action, request::uuid, params, placed);
  reset role;
  if begun ? 'replay' then
    return begun -> 'replay';
  end if;
  moment := begun ->> 'now';
  select markets.utc(perps.stand_in_step(p, moment::timestamptz)) into step_time
  from perps.perps p where p.id = pg_temp.perp(perp);
  if plan -> 'price' ->> 'at' = 'now' then
    plan := jsonb_set(plan, '{price,at}', to_jsonb(step_time));
  end if;
  select coalesce(jsonb_agg(
           x || jsonb_build_object(
             'openedAt', case when x ->> 'openedAt' = 'now' then moment else x ->> 'openedAt' end,
             'updatedAt', moment)), '[]'::jsonb)
    into positions
  from jsonb_array_elements(coalesce(plan -> 'positions', '[]'::jsonb)) x;
  plan := plan || jsonb_build_object('positions', positions, 'perp_id', pg_temp.perp(perp),
                                     'action', action, 'request_id', request, 'params', params);
  perform set_config('request.jwt.claims',
    case when name is null then '{"role": "anon"}'
         else json_build_object('sub', pg_temp.user_id(name), 'role', 'authenticated')::text end,
    true);
  set local role hrizzup_app;
  answer := perps.apply_step(plan);
  reset role;
  return answer;
end;
$$;

-- A test perp, made by Ada through the console's call: Ṁ1,000 in each pool, a funding cap of 0.0001
-- a period, and its first funding period started `funding_hours_ago` hours ago.
create function pg_temp.make_test_perp(perp text, funding_hours_ago integer)
returns jsonb
language plpgsql
as $$
begin
  return pg_temp.as_app('ada', format(
    $q$select admin.create_test_perp(%L, %L, '00112233aabbccdd',
         jsonb_build_object('origin', '2026-11-01T00:00:00Z', 'startPrice', '100', 'volatility', '40'),
         jsonb_build_object('maxLeverage', '10', 'takerFeeBps', '10', 'takerFeeImpact', '0',
                            'fundingPeriodMs', '3600000', 'fundingSensitivity', '1',
                            'maxFundingRate', '0.0001', 'maxPriceAgeMs', '120000',
                            'subsidyLong', '1000', 'subsidyShort', '1000'),
         clock_timestamp() - interval '%s hours',
         'A check run''s own test perp')::text$q$,
    pg_temp.perp(perp), 'Test perp ' || perp, funding_hours_ago))::jsonb;
end;
$$;


-- Who may call what -------------------------------------------------------------------------------------

select is_empty(
  $$select table_name from private.unprotected_tables()$$,
  'every table of the perp''s is locked (row-level security)'
);
select is_empty(
  $$select c.relname || ' ' || r.rolname
    from pg_catalog.pg_class c
    cross join pg_catalog.pg_roles r
    where c.relnamespace = 'perps'::regnamespace and c.relkind = 'r'
      and r.rolname in ('hrizzup_app', 'anon', 'authenticated', 'service_role')
      and (pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT')
           or pg_catalog.has_table_privilege(r.oid, c.oid, 'INSERT')
           or pg_catalog.has_table_privilege(r.oid, c.oid, 'UPDATE')
           or pg_catalog.has_table_privilege(r.oid, c.oid, 'DELETE'))$$,
  'no role the app or Supabase uses can read or write the perp''s tables'
);
select set_eq(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'perps'::regnamespace
      and pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')$$,
  array[
    'perps.holdings(uuid,uuid)',
    'perps.begin_step(uuid,text,uuid,jsonb,timestamp with time zone)',
    'perps.apply_step(jsonb)',
    'perps.due(text)',
    'perps.details(uuid)',
    'perps.listed()',
    'perps.positions(uuid,integer)',
    'perps.price_sources(uuid[])'
  ],
  'the app''s role may run a step and the reads in schema perps, and nothing else there'
);
select set_eq(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'admin'::regnamespace and p.proname like '%perp%'
      and pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')$$,
  array[
    'admin.perps(uuid,integer)',
    'admin.perp(uuid)',
    'admin.set_perp_mode(uuid,text,text)',
    'admin.set_perp_settings(uuid,jsonb,text)',
    'admin.create_test_perp(uuid,text,text,jsonb,jsonb,timestamp with time zone,text)',
    'admin.retire_test_perp(uuid,text)'
  ],
  'and the console''s six perp calls, which check the admins table themselves'
);
select is_empty(
  $$select r.rolname || ' may run ' || p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    cross join pg_catalog.pg_roles r
    where (p.pronamespace = 'perps'::regnamespace
           or p.oid::regprocedure::text like 'admin.%perp%'
           or p.oid::regprocedure::text like 'ledger.post_perp%')
      and r.rolname in ('anon', 'authenticated', 'service_role')
      and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')$$,
  'Supabase''s own roles may call none of the perp''s functions'
);
select ok(
  not pg_catalog.has_function_privilege('hrizzup_app', 'ledger.post_perp(text,uuid,text,jsonb)', 'EXECUTE'),
  'the app''s role cannot post a perp''s moves itself'
);
select is_empty(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where (p.pronamespace = 'perps'::regnamespace or p.oid::regprocedure::text like 'admin.%perp%')
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and not (p.proconfig @> array['search_path=""'])$$,
  'each of the perp''s functions trusts no search path'
);


-- The Bitcoin perp -------------------------------------------------------------------------------------

select results_eq(
  $$select p.name::text, p.listed, p.state, p.trading_mode, p.feed, p.stand_in_seed is null,
           p.stand_in_origin, p.stand_in_start_price, p.stand_in_volatility, p.price is null
    from perps.perps p where p.id = '01a1c501-ec40-78f6-87b6-3fb041143421'$$,
  $$values ('Bitcoin price (US dollars)'::text, true, 'live'::text, 'halted'::text,
            'stand-in-btc-usd'::text, true, '2026-01-01 00:00:00+00'::timestamptz, 100000::numeric,
            0.55::numeric, true)$$,
  'the Bitcoin perp is made, listed and switched off, on the stand-in price with no seed of its own'
);
select is(
  (select perps.settings_of(p) from perps.perps p where p.id = pg_temp.perp('btc')),
  jsonb_build_object('maxLeverage', '10', 'takerFeeBps', '10', 'takerFeeImpact', '0',
                     'fundingPeriodMs', '3600000', 'fundingSensitivity', '1',
                     'maxFundingRate', '0.00011415525114155251', 'maxPriceAgeMs', '120000',
                     'subsidyLong', '25000.000000', 'subsidyShort', '25000.000000'),
  'its settings are Manifold''s defaults with the 10-times cap, as R3 set them (PERP_SETTINGS)'
);
select results_eq(
  $$select pg_temp.balance(p.long_account_id), pg_temp.balance(p.short_account_id)
    from perps.perps p where p.id = '01a1c501-ec40-78f6-87b6-3fb041143421'$$,
  $$values (25000::numeric, 25000::numeric)$$,
  'the house seeded each of its pools with Ṁ25,000'
);
select results_eq(
  $$select r.rule, r.new_value, r.by_account is null from perps.rule_changes r
    where r.perp_id = '01a1c501-ec40-78f6-87b6-3fb041143421' order by r.id$$,
  $$values ('created'::text, 'Bitcoin price (US dollars)'::text, true),
           ('stand_in', 'stand-in-btc-usd: from 2026-01-01T00:00:00Z at 100000, volatility 0.55 a year, the environment''s own seed', true),
           ('trading_mode', 'halted', true),
           ('funding_from', (select markets.utc(p.funding_from) from perps.perps p
                             where p.id = '01a1c501-ec40-78f6-87b6-3fb041143421'), true),
           ('max_leverage', '10', true), ('taker_fee_bps', '10', true),
           ('taker_fee_impact', '0', true), ('funding_period_ms', '3600000', true),
           ('funding_sensitivity', '1', true), ('max_funding_rate', '0.00011415525114155251', true),
           ('max_price_age_ms', '120000', true), ('subsidy_long', '25000.000000', true),
           ('subsidy_short', '25000.000000', true)$$,
  'its first rules are its first thirteen lines in the rule-change log, from the migration'
);
select ok(
  (select bool_and(r.reason like 'The perp''s first settings%') from perps.rule_changes r
   where r.perp_id = pg_temp.perp('btc')),
  'each of those lines says why: the founder''s decision of 10 November 2026'
);
select is_empty($$select * from ledger.problems()$$, 'the books have no problem with it');
select is(
  pg_temp.as_app(null, $$select (perps.listed() -> 0 ->> 'id')$$),
  '01a1c501-ec40-78f6-87b6-3fb041143421',
  'anyone may see it among the listed perps'
);
select is(
  pg_temp.as_app(null, $$select perps.details('01a1c501-ec40-78f6-87b6-3fb041143421') ->> 'tradingMode'$$),
  'halted',
  'and its details, switched off'
);
select ok(
  not (pg_temp.as_app(null, $$select perps.details('01a1c501-ec40-78f6-87b6-3fb041143421')::text$$)
       ~ '(seed|standIn|createdBy)'),
  'its details show nobody its seed, its price walk or who made it'
);
select is(
  pg_temp.as_app(null, $$select perps.price_sources(array['01a1c501-ec40-78f6-87b6-3fb041143421'::uuid])::text$$)::jsonb,
  jsonb_build_object('01a1c501-ec40-78f6-87b6-3fb041143421', jsonb_build_object(
    'feed', 'stand-in-btc-usd', 'seed', null,
    'standIn', jsonb_build_object('origin', '2026-01-01T00:00:00Z', 'startPrice', '100000', 'volatility', '0.55'))),
  'the server learns where its price comes from: the walk, and no seed (the environment keeps it)'
);


-- The console: admins only ---------------------------------------------------------------------------------

select throws_ok(
  $$select pg_temp.as_app('ann', $q$select admin.perps(null, 50)::text$q$)$$,
  '42501', null, 'anyone but an admin is refused the perps'
);
select throws_ok(
  $$select pg_temp.as_app('ann', $q$select admin.perp('01a1c501-ec40-78f6-87b6-3fb041143421')::text$q$)$$,
  '42501', null, 'and any one perp'
);
select throws_ok(
  $$select pg_temp.as_app('ann', $q$select admin.set_perp_mode('01a1c501-ec40-78f6-87b6-3fb041143421', 'enabled', 'mine now')::text$q$)$$,
  '42501', null, 'and the off switch'
);
select throws_ok(
  $$select pg_temp.as_app(null, $q$select admin.set_perp_settings('01a1c501-ec40-78f6-87b6-3fb041143421', '{"maxLeverage": "5"}', 'x')::text$q$)$$,
  '42501', null, 'and the settings, signed in or not'
);
select throws_ok(
  $$select pg_temp.as_app('ann', $q$select admin.create_test_perp('01a1c502-0000-7000-8000-00000000000f', 'Mine', '0011223344556677', '{"origin": "2026-11-01T00:00:00Z", "startPrice": "1", "volatility": "1"}', '{}', null, 'x')::text$q$)$$,
  '42501', null, 'and making a test perp'
);
select is(
  pg_temp.as_app('ada', $$select (admin.perp('01a1c501-ec40-78f6-87b6-3fb041143421') -> 'log' -> 0 ->> 'rule')$$),
  'created',
  'an admin sees a perp with its rule-change log'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.retire_test_perp('01a1c501-ec40-78f6-87b6-3fb041143421', 'Tidying up')::text$q$)$$,
  '55000', 'The listed perp is never retired', 'the listed perp is never retired'
);


-- Making a check run's test perps -------------------------------------------------------------------------------

select is(pg_temp.make_test_perp('t1', 0) ->> 'listed', 'false', 'an admin makes a test perp: unlisted');
select is(pg_temp.make_test_perp('t2', 2) ->> 'tradingMode', 'halted', 'switched off until the run switches it on');
select is(pg_temp.make_test_perp('t3', 0) ->> 'id', '01a1c502-0000-7000-8000-000000000003', 'by the ID its admin chose');
select is(
  (select pg_temp.balance(pg_temp.pool('t1', 'long')) + pg_temp.balance(pg_temp.pool('t1', 'short'))),
  2000::numeric,
  'its pools seeded by the house with its own subsidies'
);
select is(
  pg_temp.make_test_perp('t1', 0) ->> 'id', '01a1c502-0000-7000-8000-000000000001',
  'a retried make gives back the perp its first try made'
);
select results_eq(
  $$select x ->> 'id' from jsonb_array_elements(
      pg_temp.as_app('ada', 'select admin.perps(null, 1)::text')::jsonb -> 'perps') x$$,
  $$values ('01a1c501-ec40-78f6-87b6-3fb041143421'::text), ('01a1c502-0000-7000-8000-000000000003')$$,
  'the console lists the Bitcoin perp first, whatever the runs have made since, then their test perps, newest first'
);
select is(
  pg_temp.as_app('ada', $q$select (admin.perps('01a1c502-0000-7000-8000-000000000003', 5) -> 'perps' -> 0 ->> 'id')$q$),
  '01a1c502-0000-7000-8000-000000000002',
  'and pages through the test perps alone'
);
select is(
  (select count(*)::integer from perps.perps where id = pg_temp.perp('t1')), 1, 'and never makes a second'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.create_test_perp('01a1c502-0000-7000-8000-000000000001', 'Another name', '00112233aabbccdd', '{"origin": "2026-11-01T00:00:00Z", "startPrice": "1", "volatility": "1"}', '{"maxLeverage": "10", "takerFeeBps": "10", "takerFeeImpact": "0", "fundingPeriodMs": "3600000", "fundingSensitivity": "1", "maxFundingRate": "0.0001", "maxPriceAgeMs": "120000", "subsidyLong": "1", "subsidyShort": "1"}', null, 'x')::text$q$)$$,
  '23505', null, 'the same ID for another perp is refused'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.create_test_perp('01a1c502-0000-7000-8000-00000000000e', 'No seed', null, '{"origin": "2026-11-01T00:00:00Z", "startPrice": "1", "volatility": "1"}', '{"maxLeverage": "10", "takerFeeBps": "10", "takerFeeImpact": "0", "fundingPeriodMs": "3600000", "fundingSensitivity": "1", "maxFundingRate": "0.0001", "maxPriceAgeMs": "120000", "subsidyLong": "1", "subsidyShort": "1"}', null, 'x')::text$q$)$$,
  '22023', null, 'a test perp brings its own seed'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.create_test_perp('01a1c502-0000-7000-8000-00000000000e', 'Too much', '00112233aabbccdd', '{"origin": "2026-11-01T00:00:00Z", "startPrice": "1", "volatility": "1"}', '{"maxLeverage": "11", "takerFeeBps": "10", "takerFeeImpact": "0", "fundingPeriodMs": "3600000", "fundingSensitivity": "1", "maxFundingRate": "0.0001", "maxPriceAgeMs": "120000", "subsidyLong": "1", "subsidyShort": "1"}', null, 'x')::text$q$)$$,
  '23514', null, 'and no setting of its own outside the bounds: more than 10 times leverage'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.create_test_perp('01a1c502-0000-4000-8000-00000000000e', 'Old ID', '00112233aabbccdd', '{"origin": "2026-11-01T00:00:00Z", "startPrice": "1", "volatility": "1"}', '{}', null, 'x')::text$q$)$$,
  '22023', null, 'a perp''s ID is a version 7 UUID'
);
select is(
  (select count(*)::integer from perps.rule_changes r where r.perp_id = pg_temp.perp('t1')
     and r.by_account = pg_temp.user_id('ada') and r.reason = 'A check run''s own test perp'),
  13,
  'its first rules are in the log, a line each, by its admin, with the reason'
);


-- The off switch and the settings ---------------------------------------------------------------------------------

select is(
  pg_temp.as_app('ada', $$select admin.set_perp_mode('01a1c502-0000-7000-8000-000000000001', 'enabled', 'The run trades it')::jsonb ->> 'tradingMode'$$),
  'enabled',
  'an admin switches a perp on'
);
select is(
  pg_temp.as_app('ada', $$select admin.set_perp_mode('01a1c502-0000-7000-8000-000000000002', 'enabled', 'The run trades it')::jsonb ->> 'tradingMode'$$),
  'enabled',
  'another'
);
select results_eq(
  $$select r.rule, r.old_value, r.new_value, r.reason::text from perps.rule_changes r
    where r.perp_id = '01a1c502-0000-7000-8000-000000000001' order by r.id desc limit 1$$,
  $$values ('trading_mode'::text, 'halted'::text, 'enabled'::text, 'The run trades it'::text)$$,
  'the change is in the log, with the old mode, the new and why'
);
select is(
  (pg_temp.as_app('ada', $$select jsonb_array_length(admin.set_perp_mode('01a1c502-0000-7000-8000-000000000001', 'enabled', 'Again')::jsonb -> 'log')::text$$))::integer,
  14,
  'the same mode again changes nothing and adds no line'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.set_perp_mode('01a1c502-0000-7000-8000-000000000001', 'off', 'x')::text$q$)$$,
  '22023', null, 'the off switch is enabled, reduce-only or halted'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.set_perp_mode('01a1c502-0000-7000-8000-000000000003', 'enabled', ' ')::text$q$)$$,
  '22023', null, 'every rule change says why'
);
select is(
  pg_temp.as_app('ada', $$select admin.set_perp_settings('01a1c502-0000-7000-8000-000000000003', '{"maxLeverage": "5", "takerFeeBps": "20"}', 'Gentler for this run')::jsonb -> 'settings' ->> 'maxLeverage'$$),
  '5',
  'an admin changes a perp''s settings'
);
select results_eq(
  $$select r.rule, r.old_value, r.new_value from perps.rule_changes r
    where r.perp_id = '01a1c502-0000-7000-8000-000000000003' and r.reason = 'Gentler for this run'
    order by r.id$$,
  $$values ('max_leverage'::text, '10'::text, '5'::text), ('taker_fee_bps', '10', '20')$$,
  'a line in the log for each setting that changed, with its old and new value'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.set_perp_settings('01a1c502-0000-7000-8000-000000000003', '{"maxLeverage": "11"}', 'More')::text$q$)$$,
  '23514', null, 'never more than 10 times leverage'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.set_perp_settings('01a1c502-0000-7000-8000-000000000003', '{"takerFeeBps": "101"}', 'More')::text$q$)$$,
  '23514', null, 'never an opening fee above Manifold''s cap of 100 basis points'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.set_perp_settings('01a1c502-0000-7000-8000-000000000003', '{"fundingPeriodMs": "60000"}', 'Faster')::text$q$)$$,
  '23514', null, 'never funding more often than hourly'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.set_perp_settings('01a1c502-0000-7000-8000-000000000003', '{"maxFundingRate": "1"}', 'All of it')::text$q$)$$,
  '23514', null, 'never a funding cap of the whole side'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.set_perp_settings('01a1c502-0000-7000-8000-000000000003', '{"subsidyLong": "1"}', 'Less')::text$q$)$$,
  '22023', null, 'the subsidies never change once a perp is made'
);
select is(
  (select max_leverage from perps.perps where id = pg_temp.perp('t3')), 5::numeric,
  'a refused change leaves the settings as they were'
);


-- Window 1: opening ----------------------------------------------------------------------------------------------------

select results_eq(
  $$select h ->> 'tradingMode', h ->> 'stepsFrom', h ->> 'priceAt', h ->> 'balance', h ->> 'answered',
           h -> 'position' is null or h ->> 'position' is null
    from (select pg_temp.as_app('ann', $q$select perps.holdings('01a1c502-0000-7000-8000-000000000001',
            '0c000000-0000-4000-8000-000000000001')::text$q$)::jsonb as h) x$$,
  $$values ('enabled'::text, '2026-11-01T00:00:00Z'::text, null::text, '1000.000000'::text, 'false'::text, true)$$,
  'before a trade, the read without a lock: the off switch, when its 5-second steps start, the balance, nothing sent yet'
);

-- Ann opens a 10-times long: Ṁ100 of margin at $100, so Ṁ1,000 of size, an opening fee of 10 basis
-- points of it (Ṁ1), both into the long pool; her liquidation price is 90% of her entry.
select is(
  pg_temp.step('ann', 't1', 'open', '0c000000-0000-4000-8000-000000000001',
    '{"direction": "long", "margin": "100", "leverage": "10"}',
    jsonb_build_object(
      'price', jsonb_build_object('at', 'now', 'price', '100'),
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.acct('ann'), pg_temp.pool('t1', 'long'), '100'),
        pg_temp.mv('trade', pg_temp.acct('ann'), pg_temp.pool('t1', 'long'), '1')),
      'positions', jsonb_build_array(
        pg_temp.pos('ann', 'long', '1000', '100', '100', '1', '100', '10', '90')),
      'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'ann', '1000', '100', '100', '1')),
      'pools', jsonb_build_object('long', '1101', 'short', '1000'))) ->> 'status',
  'opened',
  'Ann opens a 10-times long at the first price'
);
select is(pg_temp.balance(pg_temp.acct('ann')), 899::numeric, 'her margin and fee left her balance');
select is(pg_temp.balance(pg_temp.pool('t1', 'long')), 1101::numeric, 'and went into the long pool');
select results_eq(
  $$select r.result ->> 'status', r.result ->> 'margin', r.result ->> 'fee', r.result ->> 'balance',
           r.result -> 'position' ->> 'size', r.placed_at < (r.result ->> 'price_at')::timestamptz
    from perps.requests r where r.id = '0c000000-0000-4000-8000-000000000001'$$,
  $$values ('opened'::text, '100.000000'::text, '1.000000'::text, '899.000000'::text, '1000'::text, true)$$,
  'her request is stored with its answer: filled at a price published after she placed it'
);
select is(
  pg_temp.step('ann', 't1', 'open', '0c000000-0000-4000-8000-000000000001',
    '{"direction": "long", "margin": "100", "leverage": "10"}', '{}') ->> 'status',
  'opened',
  'the same request again gets its first answer'
);
select is(pg_temp.balance(pg_temp.acct('ann')), 899::numeric, 'and trades nothing twice');
select throws_ok(
  $$select pg_temp.step('ann', 't1', 'open', '0c000000-0000-4000-8000-000000000001',
      '{"direction": "long", "margin": "200", "leverage": "10"}', '{}')$$,
  '23505', null, 'the same request ID for another request is refused'
);

-- Raj opens a 5-times short at the same price: Ṁ50 of margin, Ṁ250 of size, a fee of Ṁ0.25.
select is(
  pg_temp.step('raj', 't1', 'open', '0c000000-0000-4000-8000-000000000002',
    '{"direction": "short", "margin": "50", "leverage": "5"}',
    jsonb_build_object(
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.acct('raj'), pg_temp.pool('t1', 'short'), '50'),
        pg_temp.mv('trade', pg_temp.acct('raj'), pg_temp.pool('t1', 'short'), '0.25')),
      'positions', jsonb_build_array(
        pg_temp.pos('raj', 'short', '250', '50', '50', '0.25', '100', '5', '120')),
      'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'raj', '250', '50', '50', '0.25')),
      'pools', jsonb_build_object('long', '1101', 'short', '1050.25'))) ->> 'status',
  'opened',
  'Raj opens a 5-times short at the book''s price'
);

-- What the database refuses, whatever the plan says. Each is Zoe opening on t1, at the book's price.
create function pg_temp.zoe_opens(request text, params jsonb, margin text, fee text, size text,
                                  leverage text, pools jsonb, extra jsonb default '{}',
                                  liquidation text default '90')
returns jsonb
language sql
as $$
  select pg_temp.step('zoe', 't1', 'open', request, params,
    jsonb_build_object(
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t1', 'long'), margin),
        pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t1', 'long'), fee)),
      'positions', jsonb_build_array(
        pg_temp.pos('zoe', 'long', size, margin, margin, fee, '100', leverage, liquidation)),
      'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'zoe', size, margin, margin, fee)),
      'pools', pools) || extra);
$$;

select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '99', '1', '990', '10',
      '{"long": "1201", "short": "1050.25"}')$$,
  '23514', 'The open does not match its request, or breaks the perp''s rules',
  'an open puts in exactly the margin asked'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10", "maxFee": "0.5"}', '100', '1', '1000',
      '10', '{"long": "1202", "short": "1050.25"}')$$,
  '23514', 'The open does not match its request, or breaks the perp''s rules',
  'a fee of at most what the trader accepts'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', '50', '1000', '10',
      '{"long": "1251", "short": "1050.25"}')$$,
  '23514', 'The open does not match its request, or breaks the perp''s rules',
  'a fee of less than half the margin'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "11"}', '100', '1.1', '1100', '11',
      '{"long": "1202.1", "short": "1050.25"}', '{}', '90.90909090909091')$$,
  '23514', 'The open does not match its request, or breaks the perp''s rules',
  'never more than the perp''s leverage cap'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', '1', '1000', '10',
      '{"long": "1202", "short": "1050.25"}',
      jsonb_build_object(
        'positions', jsonb_build_array(
          pg_temp.pos('zoe', 'long', '2000', '200', '100', '1', '100', '10', '90')),
        'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'zoe', '2000', '200', '100', '1'))))$$,
  '23514', 'The open does not match its request, or breaks the perp''s rules',
  'at the leverage asked: a size of the margin times it, and a margin of exactly what was put in'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100"}', '100', '1', '1000', '10',
      '{"long": "1202", "short": "1050.25"}')$$,
  '23514', 'The open does not match its request, or breaks the perp''s rules',
  'an open says its leverage'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', '1', '1000', '10',
      '{"long": "1202", "short": "1050.25"}',
      jsonb_build_object('positions', jsonb_build_array(
        pg_temp.pos('zoe', 'long', '1000', '100', '100', '1', '100', '10', '80'))))$$,
  '23514', 'An open position''s leverage and liquidation price follow from its figures',
  'a position''s liquidation price is the one its leverage gives, never one that saves it'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', 'NaN', '1000', '10',
      '{"long": "1202", "short": "1050.25"}')$$,
  '22023', null,
  'every figure is a finite number: never NaN, which compares above every number'
);
select throws_ok(
  $$select ledger.post('grant', null, 'Not a number',
      jsonb_build_array(jsonb_build_object('from', ledger.house(), 'to', pg_temp.acct('zoe'), 'amount', 'NaN')))$$,
  '23514', null,
  'and the books refuse a move of NaN, for every market and perp'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', '1', '1000', '10',
      '{"long": "1202.000001", "short": "1050.25"}')$$,
  '23514', null,
  'the pools hold exactly what the plan says, to the millionth'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', '1', '1000', '10',
      '{"long": "1203", "short": "1050.25"}',
      jsonb_build_object('events', jsonb_build_array(
        pg_temp.ev('trade', 'open', 'zoe', '1000', '100', '100', '2'))))$$,
  '23514', 'The step''s moves and its events don''t agree',
  'what an event says it moved is what moved (a fee of Ṁ2 said, Ṁ1 charged)'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', '1', '1000', '10',
      '{"long": "2202", "short": "50.25"}',
      jsonb_build_object('moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.pool('t1', 'short'), pg_temp.acct('zoe'), '1000'),
        pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t1', 'long'), '1101'))))$$,
  '23514', 'The step''s moves and its events don''t agree',
  'no leg in and out again carries money from one pool to the other through the trader'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', '1', '1000', '10',
      '{"long": "1202", "short": "1050.25"}',
      jsonb_build_object('moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t1', 'long'), '100'),
        pg_temp.mv('trade', pg_temp.acct('sid'), pg_temp.pool('t1', 'long'), '1'))))$$,
  '23514', 'A move to or from someone the step can''t pay or charge',
  'only the trader pays: never someone else''s money'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', '1', '1000', '10',
      '{"long": "1102", "short": "1050.25"}',
      jsonb_build_object('moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t1', 'long'), '100'),
        pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t1', 'long'), '1'),
        pg_temp.mv('trade', pg_temp.pool('t1', 'long'), pg_temp.acct('sid'), '100'))))$$,
  '23514', 'A move to or from someone the step can''t pay or charge',
  'a payout goes only to someone who held a position'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', '1', '1000', '10',
      '{"long": "1202", "short": "1050.25"}',
      jsonb_build_object('positions', jsonb_build_array(
        pg_temp.pos('zoe', 'long', '1000', '100', '100', '1', '101', '10', '90.9'))))$$,
  '23514', 'A new position is only the trader''s own open, made now at the price',
  'a new position opens at the book''s price, not one of the plan''s choosing'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '100', '1', '1000', '10',
      '{"long": "1202", "short": "1050.25"}',
      jsonb_build_object('price', jsonb_build_object('at', '2026-11-01T00:00:00Z', 'price', '50')))$$,
  '23514', 'A new price is the stand-in''s for this moment''s 5-second step, newer than the last',
  'a price only at this moment''s own 5-second step'
);
select throws_ok(
  $$select pg_temp.as_app('zoe', $q$select perps.apply_step('{"perp_id": "01a1c502-0000-7000-8000-000000000001", "action": "tick", "price": {"at": "2026-11-10T00:00:00Z", "price": "1"}}')::text$q$)$$,
  '25000', null, 'a step is applied only after begin_step, in the same transaction'
);
select throws_ok(
  $$select pg_temp.step(null, 't1', 'open', '0c000000-0000-4000-8000-000000000003',
      '{"direction": "long", "margin": "100", "leverage": "10"}', '{}')$$,
  '42501', null, 'a trade needs a signed-in account'
);
select throws_ok(
  $$select pg_temp.as_app('zoe', $q$select perps.begin_step('01a1c502-0000-7000-8000-000000000001', 'open',
      '0c000000-0000-4000-8000-000000000003', '{"direction": "long"}',
      clock_timestamp() - interval '2 minutes')::text$q$)$$,
  '22023', null, 'an order fills within a minute of being placed'
);

-- A refusal is an answer too: stored, and a retry gets it back.
select is(
  pg_temp.step('zoe', 't1', 'open', '0c000000-0000-4000-8000-000000000004',
    '{"direction": "long", "margin": "5000", "leverage": "2"}',
    jsonb_build_object(
      'refusal', jsonb_build_object('code', 'insufficient_balance', 'message', 'This needs Ṁ5,010; there is Ṁ1,000.'),
      'pools', jsonb_build_object('long', '1101', 'short', '1050.25'))) -> 'refusal' ->> 'code',
  'insufficient_balance',
  'a refused open is answered with its reason'
);
select is(
  pg_temp.step('zoe', 't1', 'open', '0c000000-0000-4000-8000-000000000004',
    '{"direction": "long", "margin": "5000", "leverage": "2"}', '{}') ->> 'status',
  'refused',
  'and a retry gets the same refusal'
);
select is(pg_temp.balance(pg_temp.acct('zoe')), 1000::numeric, 'having moved nothing');
select throws_ok(
  $$select pg_temp.step('zoe', 't1', 'open', '0c000000-0000-4000-8000-000000000005',
      '{"direction": "long", "margin": "100", "leverage": "10"}',
      jsonb_build_object('refusal', jsonb_build_object('code', 'because', 'message', 'No.'),
                         'pools', jsonb_build_object('long', '1101', 'short', '1050.25')))$$,
  '23514', null, 'a refusal is one of the engine''s reasons'
);
select throws_ok(
  $$select pg_temp.step(null, 't1', 'tick', null, null, '{"pools": {"long": "1101", "short": "1050.25"}}')$$,
  '23514', 'A scheduled step with nothing to do writes nothing',
  'a tick applies a new price, or writes nothing'
);

-- Closing only (reduce-only): an open is refused, a close isn't; halted: nothing runs.
select is(
  pg_temp.as_app('ada', $$select admin.set_perp_mode('01a1c502-0000-7000-8000-000000000003', 'reduce-only', 'Winding down')::jsonb ->> 'tradingMode'$$),
  'reduce-only',
  'an admin switches a perp to closing only'
);
select throws_ok(
  $$select pg_temp.step('zoe', 't3', 'open', '0c000000-0000-4000-8000-000000000006',
      '{"direction": "long", "margin": "10", "leverage": "2"}',
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '100'),
        'moves', jsonb_build_array(
          pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t3', 'long'), '10')),
        'positions', jsonb_build_array(
          pg_temp.pos('zoe', 'long', '20', '10', '10', '0', '100', '2', '50')),
        'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'zoe', '20', '10', '10', '0')),
        'pools', jsonb_build_object('long', '1010', 'short', '1000')))$$,
  '23514', null, 'closing only: an open is refused, whatever the plan says'
);
select is(
  pg_temp.step('zoe', 't3', 'open', '0c000000-0000-4000-8000-000000000006',
    '{"direction": "long", "margin": "10", "leverage": "2"}',
    jsonb_build_object(
      'price', jsonb_build_object('at', 'now', 'price', '100'),
      'refusal', jsonb_build_object('code', 'trading_off', 'message', 'The perp is closing-only.'),
      'pools', jsonb_build_object('long', '1000', 'short', '1000'))) -> 'refusal' ->> 'code',
  'trading_off',
  'and answered as switched off'
);
select is(
  pg_temp.as_app('ada', $$select admin.set_perp_mode('01a1c502-0000-7000-8000-000000000003', 'halted', 'Off for the night')::jsonb ->> 'tradingMode'$$),
  'halted',
  'an admin switches it off'
);
select throws_ok(
  $$select pg_temp.step(null, 't3', 'tick', null, null,
      '{"price": {"at": "now", "price": "100"}, "pools": {"long": "1000", "short": "1000"}}')$$,
  '55000', null, 'switched off: no new price runs'
);
select throws_ok(
  $$select pg_temp.step(null, 't3', 'funding', null, null,
      '{"price": {"at": "now", "price": "100"}, "pools": {"long": "1000", "short": "1000"}}')$$,
  '55000', null, 'and no funding'
);
select throws_ok(
  $$select pg_temp.step('zoe', 't3', 'close', '0c000000-0000-4000-8000-000000000007',
      '{"fraction": "1"}',
      jsonb_build_object('price', jsonb_build_object('at', 'now', 'price', '100'),
                         'refusal', jsonb_build_object('code', 'trading_off', 'message', 'Halted.'),
                         'pools', jsonb_build_object('long', '1000', 'short', '1000')))$$,
  '23514', null, 'and a trade is only refused, with no new price'
);
select is(
  pg_temp.step('zoe', 't3', 'close', '0c000000-0000-4000-8000-000000000007', '{"fraction": "1"}',
    jsonb_build_object('refusal', jsonb_build_object('code', 'trading_off', 'message', 'Perp trading is halted.'),
                       'pools', jsonb_build_object('long', '1000', 'short', '1000'))) ->> 'status',
  'refused',
  'refused as switched off'
);

-- The perps the scheduled jobs have work on.
select is(
  pg_temp.as_app(null, $$select perps.due('tick')::text$$),
  '{01a1c502-0000-7000-8000-000000000001}',
  'the 5-second job has work only on a perp that''s switched on with an open position'
);

-- Zoe and Sid open on t2, whose first funding period started two hours ago.
select is(
  pg_temp.step('zoe', 't2', 'open', '0c000000-0000-4000-8000-000000000008',
    '{"direction": "long", "margin": "100", "leverage": "10"}',
    jsonb_build_object(
      'price', jsonb_build_object('at', 'now', 'price', '100'),
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t2', 'long'), '100'),
        pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t2', 'long'), '1')),
      'positions', jsonb_build_array(
        pg_temp.pos('zoe', 'long', '1000', '100', '100', '1', '100', '10', '90')),
      'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'zoe', '1000', '100', '100', '1')),
      'pools', jsonb_build_object('long', '1101', 'short', '1000'))) ->> 'status',
  'opened',
  'Zoe opens a 10-times long on another perp'
);
select is(
  pg_temp.step('sid', 't2', 'open', '0c000000-0000-4000-8000-000000000009',
    '{"direction": "short", "margin": "100", "leverage": "2"}',
    jsonb_build_object(
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.acct('sid'), pg_temp.pool('t2', 'short'), '100'),
        pg_temp.mv('trade', pg_temp.acct('sid'), pg_temp.pool('t2', 'short'), '0.2')),
      'positions', jsonb_build_array(
        pg_temp.pos('sid', 'short', '200', '100', '100', '0.2', '100', '2', '150')),
      'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'sid', '200', '100', '100', '0.2')),
      'pools', jsonb_build_object('long', '1101', 'short', '1100.2'))) ->> 'status',
  'opened',
  'and Sid a 2-times short'
);
select is(
  pg_temp.as_app(null, $$select perps.due('funding')::text$$),
  '{01a1c502-0000-7000-8000-000000000002}',
  'the hourly job has work only where funding is due'
);
select is(
  pg_temp.as_app('zoe', $$select (perps.positions(null, 50) -> 'positions' -> 0 ->> 'perpId')$$),
  '01a1c502-0000-7000-8000-000000000002',
  'Zoe sees her own open position'
);
select is(
  pg_temp.as_app('ann', $$select jsonb_array_length(perps.positions(null, 50) -> 'positions')::text$$),
  '1',
  'and Ann only hers'
);
select throws_ok(
  $$select pg_temp.as_app('ann', $q$select admin.retire_test_perp('01a1c502-0000-7000-8000-000000000002', 'Done')::text$q$)$$,
  '42501', null, 'only an admin retires a test perp'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.retire_test_perp('01a1c502-0000-7000-8000-000000000002', 'Done')::text$q$)$$,
  '55000', null, 'and only once every position on it is closed'
);


-- Window 2: a new price, a liquidation, a close, funding ---------------------------------------------------------------

do $$ begin perform pg_sleep(5.1); end $$;

-- At $89, Ann's long (liquidated at $90) is liquidated: her margin stays in the pool, nothing moves.
select throws_ok(
  $$select pg_temp.step(null, 't1', 'tick', null, null,
      '{"price": {"at": "now", "price": "89"}, "pools": {"long": "1101", "short": "1050.25"}}')$$,
  '23514', 'A position is left open past its liquidation price',
  'a new price leaves no position open past its liquidation price'
);
select throws_ok(
  $$select pg_temp.step(null, 't1', 'tick', null, null,
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '89'),
        'positions', jsonb_build_array(
          pg_temp.pos('ann', 'long', '1000', '100', '100', '1', '100', '10', '90', 'liquidated',
                      (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('ann'))),
          pg_temp.pos('raj', 'short', '250', '50', '50', '0.25', '100', '5', '120', 'liquidated',
                      (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('raj')))),
        'events', jsonb_build_array(
          pg_temp.ev('price', 'liquidation', 'ann', '-1000', '-100'),
          pg_temp.ev('price', 'liquidation', 'raj', '-250', '-50')),
        'pools', jsonb_build_object('long', '1101', 'short', '1050.25')))$$,
  '23514', 'A liquidation only where the price reached the position''s liquidation price',
  'and liquidates only a position the price reached (Raj''s short goes at $120)'
);
select throws_ok(
  $$select pg_temp.step(null, 't1', 'tick', null, null,
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '89'),
        'positions', jsonb_build_array(
          pg_temp.pos('ann', 'long', '1000', '100', '100', '1', '100', '10', '90', 'liquidated', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('ann'))),
          pg_temp.pos('raj', 'short', '249', '50', '50', '0.25', '100', '4.98', '120.08032128514057', 'liquidated', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('raj')))),
        'events', jsonb_build_array(
          pg_temp.ev('price', 'liquidation', 'ann', '-1000', '-100'),
          pg_temp.ev('price', 'adl', 'raj', '-1', '0')),
        'pools', jsonb_build_object('long', '1101', 'short', '1050.25')))$$,
  '23514', null,
  'a winner scaled down stays open: a scaling never closes a position'
);
select throws_ok(
  $$select pg_temp.step(null, 't1', 'tick', null, null,
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '89'),
        'positions', jsonb_build_array(
          pg_temp.pos('ann', 'long', '1000', '100', '100', '1', '100', '10', '90', 'liquidated', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('ann'))),
          pg_temp.pos('raj', 'short', '249', '40', '50', '0.25', '100', '6.225', '116.06425702811245', null, (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('raj')))),
        'events', jsonb_build_array(
          pg_temp.ev('price', 'liquidation', 'ann', '-1000', '-100'),
          pg_temp.ev('price', 'adl', 'raj', '-1', '-10')),
        'pools', jsonb_build_object('long', '1101', 'short', '1050.25')))$$,
  '23514', 'Scaling down a winner shrinks its size alone',
  'and changes its size alone, never its margin'
);
select throws_ok(
  $$select pg_temp.step(null, 't1', 'tick', null, null,
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '89'),
        'positions', jsonb_build_array(
          pg_temp.pos('ann', 'long', '500', '100', '100', '1', '100', '5', '80', null, (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('ann')))),
        'events', jsonb_build_array(pg_temp.ev('price', 'adl', 'ann', '-500', '0')),
        'pools', jsonb_build_object('long', '1101', 'short', '1050.25')))$$,
  '23514', 'Scaling down a winner shrinks its size alone',
  'only a winner is scaled down: a position the price reached is liquidated, never rescued'
);
select is(
  pg_temp.step(null, 't1', 'tick', null, null,
    jsonb_build_object(
      'price', jsonb_build_object('at', 'now', 'price', '89'),
      'positions', jsonb_build_array(
        pg_temp.pos('ann', 'long', '1000', '100', '100', '1', '100', '10', '90', 'liquidated',
                    (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('ann')))),
      'events', jsonb_build_array(pg_temp.ev('price', 'liquidation', 'ann', '-1000', '-100')),
      'pools', jsonb_build_object('long', '1101', 'short', '1050.25'))) ->> 'liquidations',
  '1',
  'the 5-second check liquidates Ann''s long at $89'
);
select results_eq(
  $$select x.close_reason, x.closed_at is not null from perps.positions x
    where x.id = '0b000000-0000-4000-8000-0000000000a1'$$,
  $$values ('liquidated'::text, true)$$,
  'her position closes, kept as it stood'
);
select is(pg_temp.balance(pg_temp.pool('t1', 'long')), 1101::numeric, 'her margin stays in the long pool');
select is(pg_temp.balance(pg_temp.acct('ann')), 899::numeric, 'and nothing comes back to her');
select results_eq(
  $$select p.price, p.liquidations from perps.prices p
    where p.perp_id = '01a1c502-0000-7000-8000-000000000001' order by p.at$$,
  $$values (100::numeric, 0), (89::numeric, 1)$$,
  'each price applied once, with the liquidations it made'
);
select throws_ok(
  $$select pg_temp.step(null, 't1', 'tick', null, null,
      '{"price": {"at": "now", "price": "88"}, "pools": {"long": "1101", "short": "1050.25"}}')$$,
  '23514', 'A new price is the stand-in''s for this moment''s 5-second step, newer than the last',
  'each 5-second step''s price once, however often the job runs'
);

-- Raj closes his short at $89, in profit: (100 - 89) / 100 of his Ṁ250 is Ṁ27.50, paid from the long
-- pool, and his Ṁ50 of margin from his own.
select throws_ok(
  $$select pg_temp.step('raj', 't1', 'close', '0c000000-0000-4000-8000-00000000000a', '{"fraction": "1"}',
      jsonb_build_object(
        'moves', jsonb_build_array(
          pg_temp.mv('trade', pg_temp.pool('t1', 'short'), pg_temp.acct('raj'), '50'),
          pg_temp.mv('trade', pg_temp.pool('t1', 'long'), pg_temp.acct('raj'), '27.6')),
        'positions', jsonb_build_array(
          pg_temp.pos('raj', 'short', '250', '50', '50', '0.25', '100', '5', '120', 'closed',
                      (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('raj')))),
        'events', jsonb_build_array(pg_temp.ev('trade', 'close', 'raj', '-250', '-50', '0', '0', '77.6')),
        'pools', jsonb_build_object('long', '1073.4', 'short', '1000.25')))$$,
  '23514', 'A close pays at most what the position is worth at the price',
  'a close pays at most what the position is worth at the price'
);
select throws_ok(
  $$select pg_temp.step('raj', 't1', 'close', '0c000000-0000-4000-8000-00000000000a', '{"fraction": "1"}',
      jsonb_build_object(
        'moves', jsonb_build_array(
          pg_temp.mv('trade', pg_temp.pool('t1', 'short'), pg_temp.acct('raj'), '1000'),
          pg_temp.mv('trade', pg_temp.pool('t1', 'long'), pg_temp.acct('raj'), '1027.5')),
        'positions', jsonb_build_array(
          pg_temp.pos('raj', 'short', '250', '50', '50', '0.25', '100', '5', '120', 'closed', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('raj')))),
        'events', jsonb_build_array(pg_temp.ev('trade', 'close', 'raj', '-250', '-2000', '0', '0', '2027.5')),
        'pools', jsonb_build_object('long', '73.5', 'short', '50.25')))$$,
  '23514', null,
  'a close takes the position''s own margin, never more, however the plan words it'
);
select throws_ok(
  $$select pg_temp.step('raj', 't1', 'close', '0c000000-0000-4000-8000-00000000000a', '{"fraction": "1"}',
      jsonb_build_object(
        'moves', jsonb_build_array(
          pg_temp.mv('trade', pg_temp.pool('t1', 'short'), pg_temp.acct('raj'), '77.5')),
        'positions', jsonb_build_array(
          pg_temp.pos('raj', 'short', '250', '50', '50', '0.25', '100', '5', '120', 'closed', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('raj')))),
        'events', jsonb_build_array(pg_temp.ev('trade', 'close', 'raj', '-250', '-50', '0', '0', '77.5')),
        'pools', jsonb_build_object('long', '1101', 'short', '972.75')))$$,
  '23514', 'A move between the wrong pool and person, or more than the maths allows',
  'a winner''s profit comes from the other side''s pool, never from their own side''s margins'
);
select throws_ok(
  $$select pg_temp.step('raj', 't1', 'close', '0c000000-0000-4000-8000-00000000000a', '{"fraction": "1"}',
      jsonb_build_object(
        'moves', jsonb_build_array(
          pg_temp.mv('trade', pg_temp.pool('t1', 'short'), pg_temp.acct('raj'), '50'),
          pg_temp.mv('trade', pg_temp.pool('t1', 'long'), pg_temp.acct('raj'), '27.5')),
        'positions', jsonb_build_array(
          pg_temp.pos('raj', 'short', '250', '50', '50', '0.25', '100', '5', '120', 'closed', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('raj'))),
          pg_temp.pos('raj', 'short', '250', '50', '50', '0.25', '100', '5', '120', 'closed', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('raj')))
            || jsonb_build_object('id', upper(pg_temp.position('raj')::text))),
        'events', jsonb_build_array(
          pg_temp.ev('trade', 'close', 'raj', '-250', '-50', '0', '0', '77.5'),
          pg_temp.ev('trade', 'close', 'raj', '-250', '-50', '0', '0', '77.5')
            || jsonb_build_object('positionId', upper(pg_temp.position('raj')::text))),
        'pools', jsonb_build_object('long', '1073.5', 'short', '1000.25')))$$,
  '23514', 'The step names a position more than once',
  'a position is named once, however its ID is written'
);
select throws_ok(
  $$select pg_temp.step('raj', 't1', 'close', '0c000000-0000-4000-8000-00000000000b', '{"fraction": "0.5"}',
      jsonb_build_object(
        'moves', jsonb_build_array(
          pg_temp.mv('trade', pg_temp.pool('t1', 'short'), pg_temp.acct('raj'), '50'),
          pg_temp.mv('trade', pg_temp.pool('t1', 'long'), pg_temp.acct('raj'), '27.5')),
        'positions', jsonb_build_array(
          pg_temp.pos('raj', 'short', '250', '50', '50', '0.25', '100', '5', '120', 'closed', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('raj')))),
        'events', jsonb_build_array(pg_temp.ev('trade', 'close', 'raj', '-250', '-50', '0', '0', '77.5')),
        'pools', jsonb_build_object('long', '1073.5', 'short', '1000.25')))$$,
  '23514', 'Closing all of a position takes all its margin, and only when asked',
  'a close takes the share asked: half asked, never all of it'
);
select is(
  pg_temp.step('raj', 't1', 'close', '0c000000-0000-4000-8000-00000000000a', '{"fraction": "1"}',
    jsonb_build_object(
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.pool('t1', 'short'), pg_temp.acct('raj'), '50'),
        pg_temp.mv('trade', pg_temp.pool('t1', 'long'), pg_temp.acct('raj'), '27.5')),
      'positions', jsonb_build_array(
        pg_temp.pos('raj', 'short', '250', '50', '50', '0.25', '100', '5', '120', 'closed',
                    (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('raj')))),
      'events', jsonb_build_array(pg_temp.ev('trade', 'close', 'raj', '-250', '-50', '0', '0', '77.5')),
      'pools', jsonb_build_object('long', '1073.5', 'short', '1000.25'))) ->> 'payout',
  '77.500000',
  'Raj closes his short at a profit: his margin and his winnings'
);
select is(pg_temp.balance(pg_temp.acct('raj')), 1027.25::numeric, 'Ṁ1,000, less his margin and fee, plus his payout');
select is(
  (select count(*)::integer from perps.positions x where x.perp_id = pg_temp.perp('t1') and x.closed_at is null),
  0,
  'and t1 has no open position left'
);

select throws_ok(
  $$select pg_temp.step('sid', 't1', 'open', '0c000000-0000-4000-8000-00000000000e',
      '{"direction": "long", "margin": "10", "leverage": "2"}',
      jsonb_build_object(
        'moves', jsonb_build_array(
          pg_temp.mv('trade', pg_temp.acct('sid'), pg_temp.pool('t1', 'short'), '10'),
          pg_temp.mv('trade', pg_temp.acct('sid'), pg_temp.pool('t1', 'short'), '0.02')),
        'positions', jsonb_build_array(
          pg_temp.pos('sid-long', 'long', '20', '10', '10', '0.02', '89', '2', '44.5')),
        'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'sid-long', '20', '10', '10', '0.02')),
        'pools', jsonb_build_object('long', '1073.5', 'short', '1010.27')))$$,
  '23514', 'A move between the wrong pool and person, or more than the maths allows',
  'an open''s margin and fee go into the trader''s own side''s pool'
);
-- Sid opens a 2-times long on t1 at $89, then flips it to a 2-times short at the same price: the
-- long closes (no profit, no loss: his Ṁ10 back from the long pool), and the short opens in the same
-- step, into the short pool. The plan lists the new short first; the database closes the long
-- first, so the two never stand open together.
select is(
  pg_temp.step('sid', 't1', 'open', '0c000000-0000-4000-8000-00000000000e',
    '{"direction": "long", "margin": "10", "leverage": "2"}',
    jsonb_build_object(
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.acct('sid'), pg_temp.pool('t1', 'long'), '10'),
        pg_temp.mv('trade', pg_temp.acct('sid'), pg_temp.pool('t1', 'long'), '0.02')),
      'positions', jsonb_build_array(
        pg_temp.pos('sid-long', 'long', '20', '10', '10', '0.02', '89', '2', '44.5')),
      'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'sid-long', '20', '10', '10', '0.02')),
      'pools', jsonb_build_object('long', '1083.52', 'short', '1000.25'))) ->> 'status',
  'opened',
  'Sid opens a 2-times long at $89'
);
select is(
  pg_temp.step('sid', 't1', 'open', '0c000000-0000-4000-8000-00000000000f',
    '{"direction": "short", "margin": "10", "leverage": "2"}',
    jsonb_build_object(
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.pool('t1', 'long'), pg_temp.acct('sid'), '10'),
        pg_temp.mv('trade', pg_temp.acct('sid'), pg_temp.pool('t1', 'short'), '10'),
        pg_temp.mv('trade', pg_temp.acct('sid'), pg_temp.pool('t1', 'short'), '0.02')),
      'positions', jsonb_build_array(
        pg_temp.pos('sid-short', 'short', '20', '10', '10', '0.02', '89', '2', '133.5'),
        pg_temp.pos('sid-long', 'long', '20', '10', '10', '0.02', '89', '2', '44.5', 'flipped',
                    (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('sid-long')))),
      'events', jsonb_build_array(
        pg_temp.ev('trade', 'close', 'sid-long', '-20', '-10', '0', '0', '10'),
        pg_temp.ev('trade', 'open', 'sid-short', '20', '10', '10', '0.02')),
      'pools', jsonb_build_object('long', '1073.52', 'short', '1010.27'))) ->> 'status',
  'opened',
  'and flips it to a short at the same price, in one step'
);
select results_eq(
  $$select x.direction, x.close_reason from perps.positions x
    where x.perp_id = '01a1c502-0000-7000-8000-000000000001' and x.account_id = pg_temp.acct('sid')
    order by x.opened_at, x.closed_at nulls last$$,
  $$values ('long'::text, 'flipped'::text), ('short', null)$$,
  'his long closed as flipped, his short open'
);

-- Funding on t2: longs crowd it (Ṁ1,000 against Ṁ200 of open interest), so at a sensitivity of 1 the
-- rate is (5 - 1) / (5 - 1 + 1) of its cap of 0.0001, 0.00008: the long pool pays 0.00008 of its
-- Ṁ1,101, Ṁ0.08808, to the short pool, and every position is scaled by it.
create function pg_temp.funding_plan(rate text, oi_long text, oi_short text, extra jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'price', jsonb_build_object('at', 'now', 'price', '100'),
    'funding', jsonb_build_object('rate', rate, 'openInterestLong', oi_long, 'openInterestShort', oi_short),
    'moves', jsonb_build_array(pg_temp.mv('funding', pg_temp.pool('t2', 'long'), pg_temp.pool('t2', 'short'), '0.08808')),
    'positions', jsonb_build_array(
      pg_temp.pos('zoe', 'long', '999.92', '99.992', '100', '1', '100', '10', '90', null,
                  (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('zoe'))),
      pg_temp.pos('sid', 'short', '200.016011634248', '100.008005817124', '100', '0.2', '100', '2', '150', null,
                  (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('sid')))),
    'events', jsonb_build_array(
      pg_temp.ev('funding', 'funding', 'zoe', '-0.08', '-0.008'),
      pg_temp.ev('funding', 'funding', 'sid', '0.016011634248', '0.008005817124')),
    'pools', jsonb_build_object('long', '1100.91192', 'short', '1100.28808')) || extra;
$$;

select throws_ok(
  $$select pg_temp.step(null, 't2', 'funding', null, null, pg_temp.funding_plan('0.0002', '1000', '200'))$$,
  '23514', 'Funding runs once a period, inside its cap, paid by the crowded side',
  'funding stays inside its cap'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'funding', null, null, pg_temp.funding_plan('-0.00008', '1000', '200'))$$,
  '23514', 'Funding runs once a period, inside its cap, paid by the crowded side',
  'and the crowded side pays'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'funding', null, null, pg_temp.funding_plan('0.00008', '1000', '200',
      jsonb_build_object('moves', jsonb_build_array(
        pg_temp.mv('funding', pg_temp.pool('t2', 'long'), pg_temp.pool('t2', 'short'), '0.08808'),
        pg_temp.mv('funding', pg_temp.pool('t2', 'long'), pg_temp.acct('ann'), '1')),
      'pools', jsonb_build_object('long', '1099.91192', 'short', '1100.28808'))))$$,
  '23514', 'A move to or from someone the step can''t pay or charge',
  'funding pays nobody who holds no position'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'funding', null, null, pg_temp.funding_plan('0.00008', '1000', '200',
      jsonb_build_object(
        'moves', jsonb_build_array(
          pg_temp.mv('funding', pg_temp.pool('t2', 'long'), pg_temp.pool('t2', 'short'), '1101')),
        'pools', jsonb_build_object('long', '0', 'short', '2201.2'))))$$,
  '23514', 'Funding moves at most its rate of the crowded side''s pool',
  'funding moves at most its rate of the crowded side''s pool, never the whole pool'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'funding', null, null, pg_temp.funding_plan('0.00008', '1000', '200',
      jsonb_build_object(
        'moves', jsonb_build_array(
          pg_temp.mv('funding', pg_temp.pool('t2', 'long'), pg_temp.pool('t2', 'short'), '0.08808'),
          pg_temp.mv('funding', pg_temp.pool('t2', 'short'), pg_temp.pool('t2', 'long'), '1000')),
        'pools', jsonb_build_object('long', '2100.91192', 'short', '100.28808'))))$$,
  '23514', 'A move between the wrong pool and person, or more than the maths allows',
  'funding moves money one way only: from the crowded side''s pool'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'funding', null, null, pg_temp.funding_plan('0.00008', '5000', '200'))$$,
  '23514', 'Funding runs once a period, inside its cap, paid by the crowded side',
  'funding comes from the open interest the database counts itself'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'funding', null, null, pg_temp.funding_plan('0.00008', '1000', '200',
      jsonb_build_object(
        'positions', jsonb_build_array(
          pg_temp.pos('zoe', 'long', '999.92', '99.992', '100', '1', '100', '10', '90', null,
                      (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('zoe')))),
        'events', jsonb_build_array(pg_temp.ev('funding', 'funding', 'zoe', '-0.08', '-0.008')))))$$,
  '23514', 'Funding scales every open position',
  'and scales every open position, the receiving side''s too'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'funding', null, null, pg_temp.funding_plan('0.00008', '1000', '200',
      jsonb_build_object(
        'positions', jsonb_build_array(
          pg_temp.pos('zoe', 'long', '999.92', '99.992', '100', '1', '100', '10', '90', null,
                      (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('zoe'))),
          pg_temp.pos('sid', 'short', '200.032024550000', '100.016012275000', '100', '0.2', '100', '2', '150', null, (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('sid')))),
        'events', jsonb_build_array(
          pg_temp.ev('funding', 'funding', 'zoe', '-0.08', '-0.008'),
          pg_temp.ev('funding', 'funding', 'sid', '0.016011634248', '0.008005817124'),
          pg_temp.ev('funding', 'funding', 'sid', '0.016012916302', '0.008006458151')))))$$,
  '23514', null,
  'funding scales each position once: never twice in one step'
);
select is(
  pg_temp.step(null, 't2', 'funding', null, null, pg_temp.funding_plan('0.00008', '1000', '200')) ->> 'funded',
  'true',
  'the hourly job funds t2: the long pool pays the short pool'
);
select results_eq(
  $$select f.rate, f.pool_long_before, f.pool_long_after, f.pool_short_after from perps.fundings f
    where f.perp_id = '01a1c502-0000-7000-8000-000000000002'$$,
  $$values (0.00008::numeric, 1101::numeric, 1100.91192::numeric, 1100.28808::numeric)$$,
  'the funding is recorded, with the pools before and after'
);
select is(
  (select sum(m.amount) from ledger.moves m join ledger.entries e on e.id = m.entry_id
   where e.kind = 'perp_funding' and e.perp_id = pg_temp.perp('t2')),
  0.08808::numeric,
  'and it is in the books, as a move from one pool to the other'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'funding', null, null,
      pg_temp.funding_plan('0.00008', '999.92', '200.016011634248') - 'price')$$,
  '23514', 'Funding runs once a period, inside its cap, paid by the crowded side',
  'funding runs once a period, however often the job runs'
);
select is(
  pg_temp.as_app(null, $$select perps.due('funding')::text$$),
  '{}',
  'and the hourly job has no more funding work until the next period'
);

-- Zoe closes half at $100, her entry: her margin share back, no profit, no loss.
select is(
  pg_temp.step('zoe', 't2', 'close', '0c000000-0000-4000-8000-00000000000b',
    '{"direction": "long", "fraction": "0.5", "expectedSize": "999.92"}',
    jsonb_build_object(
      'moves', jsonb_build_array(pg_temp.mv('trade', pg_temp.pool('t2', 'long'), pg_temp.acct('zoe'), '49.996')),
      'positions', jsonb_build_array(
        pg_temp.pos('zoe', 'long', '499.96', '49.996', '50', '0.5', '100', '10', '90', null,
                    (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('zoe')))),
      'events', jsonb_build_array(pg_temp.ev('trade', 'close', 'zoe', '-499.96', '-49.996', '0', '0', '49.996')),
      'pools', jsonb_build_object('long', '1050.91592', 'short', '1100.28808'))) ->> 'status',
  'closed',
  'Zoe closes half her long at her entry price'
);
select is(
  (select x.size from perps.positions x where x.id = pg_temp.position('zoe')), 499.96::numeric,
  'the rest stays open'
);


-- Window 3: a settlement, the last close, retiring a test perp -------------------------------------------------------

do $$ begin perform pg_sleep(5.1); end $$;

-- Sid's short scaled down to nothing when the pools run short (Manifold's settlement): his margin
-- back, at most.
select throws_ok(
  $$select pg_temp.step(null, 't2', 'tick', null, null,
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '99'),
        'moves', jsonb_build_array(pg_temp.mv('price', pg_temp.pool('t2', 'short'), pg_temp.acct('sid'), '101')),
        'positions', jsonb_build_array(
          pg_temp.pos('sid', 'short', '200.016011634248', '100.008005817124', '100', '0.2', '100', '2', '150', 'settled',
                      (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('sid')))),
        'events', jsonb_build_array(pg_temp.ev('price', 'settle', 'sid', '-200.016011634248', '-100.008005817124', '0', '0', '101')),
        'pools', jsonb_build_object('long', '1050.91592', 'short', '999.28808')))$$,
  '23514', 'A settlement pays back a winner''s margin, no more',
  'a settlement pays back at most the position''s margin'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'tick', null, null,
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '99'),
        'moves', jsonb_build_array(
          pg_temp.mv('price', pg_temp.pool('t2', 'short'), pg_temp.acct('sid'), '100.008005'),
          pg_temp.mv('price', pg_temp.pool('t2', 'short'), pg_temp.acct('sid'), '100.008005')),
        'positions', jsonb_build_array(
          pg_temp.pos('sid', 'short', '200.016011634248', '100.008005817124', '100', '0.2', '100', '2', '150', 'settled', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('sid')))),
        'events', jsonb_build_array(
          pg_temp.ev('price', 'settle', 'sid', '-200.016011634248', '-100.008005817124', '0', '0', '100.008005'),
          pg_temp.ev('price', 'settle', 'sid', '-200.016011634248', '-100.008005817124', '0', '0', '100.008005')),
        'pools', jsonb_build_object('long', '1050.91592', 'short', '900.27207')))$$,
  '23514', 'One event a phase for each position',
  'a position is settled once, never paid twice in one step'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'tick', null, null,
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '99'),
        'positions', jsonb_build_array(
          pg_temp.pos('sid', 'short', '200.016011634248', '100.008005817124', '100', '0.2', '100', '2', '150', 'settled', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('sid')))),
        'events', jsonb_build_array(pg_temp.ev('price', 'settle', 'sid', '-200.016011634248', '-100.008005817124', '0', '0', '0')),
        'pools', jsonb_build_object('long', '1050.91592', 'short', '1100.28808')))$$,
  '23514', 'A settlement pays back a winner''s margin, no more',
  'a winner settled when the pools run short gets their margin back, never nothing'
);
select throws_ok(
  $$select pg_temp.step(null, 't2', 'tick', null, null,
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '99'),
        'moves', jsonb_build_array(
          pg_temp.mv('price', pg_temp.pool('t2', 'long'), pg_temp.pool('t2', 'short'), '1000'),
          pg_temp.mv('price', pg_temp.pool('t2', 'short'), pg_temp.acct('sid'), '100.008005')),
        'positions', jsonb_build_array(
          pg_temp.pos('sid', 'short', '200.016011634248', '100.008005817124', '100', '0.2', '100', '2', '150', 'settled', (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('sid')))),
        'events', jsonb_build_array(pg_temp.ev('price', 'settle', 'sid', '-200.016011634248', '-100.008005817124', '0', '0', '100.008005')),
        'pools', jsonb_build_object('long', '50.91592', 'short', '2000.280075')))$$,
  '23514', 'A move between the wrong pool and person, or more than the maths allows',
  'a pool topped up by the other ends no higher than its own side''s margins'
);
select is(
  pg_temp.step(null, 't2', 'tick', null, null,
    jsonb_build_object(
      'price', jsonb_build_object('at', 'now', 'price', '99'),
      'moves', jsonb_build_array(pg_temp.mv('price', pg_temp.pool('t2', 'short'), pg_temp.acct('sid'), '100.008005')),
      'positions', jsonb_build_array(
        pg_temp.pos('sid', 'short', '200.016011634248', '100.008005817124', '100', '0.2', '100', '2', '150', 'settled',
                    (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('sid')))),
      'events', jsonb_build_array(pg_temp.ev('price', 'settle', 'sid', '-200.016011634248', '-100.008005817124', '0', '0', '100.008005')),
      'pools', jsonb_build_object('long', '1050.91592', 'short', '1000.280075'))) ->> 'price',
  '99',
  'a new price settles Sid''s short, paying back his margin, rounded down'
);
select is(pg_temp.balance(pg_temp.acct('sid')), 989.768005::numeric,
  'he has his margin back, less his fees (Ṁ0.20 here, Ṁ0.04 on t1)');

select throws_ok(
  $$select pg_temp.step('zoe', 't2', 'open', '0c000000-0000-4000-8000-000000000011',
      '{"direction": "long", "margin": "10", "leverage": "2"}',
      jsonb_build_object(
        'moves', jsonb_build_array(
          pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t2', 'long'), '10'),
          pg_temp.mv('trade', pg_temp.acct('zoe'), pg_temp.pool('t2', 'long'), '0.02')),
        'positions', jsonb_build_array(
          pg_temp.pos('zoe', 'long', '519.96', '59.996', '60', '0.52', '100', '8.666577771851457', '88.46143384180023', null, (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('zoe')))),
        'events', jsonb_build_array(pg_temp.ev('trade', 'add', 'zoe', '20', '10', '10', '0.02')),
        'pools', jsonb_build_object('long', '1060.93592', 'short', '1000.280075')))$$,
  '23514', 'A position''s entry price moves only when it''s added to',
  'adding at $99 moves the entry price to the units-weighted mean, not one the plan chooses'
);

-- Zoe closes the rest at $99, at a loss: (99 - 100) / 100 of Ṁ499.96 is Ṁ4.9996 off her Ṁ49.996.
select is(
  pg_temp.step('zoe', 't2', 'close', '0c000000-0000-4000-8000-00000000000c', '{"direction": "long", "fraction": "1"}',
    jsonb_build_object(
      'moves', jsonb_build_array(pg_temp.mv('trade', pg_temp.pool('t2', 'long'), pg_temp.acct('zoe'), '44.9964')),
      'positions', jsonb_build_array(
        pg_temp.pos('zoe', 'long', '499.96', '49.996', '50', '0.5', '100', '10', '90', 'closed',
                    (select markets.utc(opened_at) from perps.positions where id = pg_temp.position('zoe')))),
      'events', jsonb_build_array(pg_temp.ev('trade', 'close', 'zoe', '-499.96', '-49.996', '0', '0', '44.9964')),
      'pools', jsonb_build_object('long', '1005.91952', 'short', '1000.280075'))) ->> 'payout',
  '44.996400',
  'Zoe closes the rest at a loss'
);
select is(pg_temp.balance(pg_temp.acct('zoe')), 993.9924::numeric, 'Ṁ1,000, less her margin and fee, plus her two payouts');

select is(
  pg_temp.as_app('ada', $$select admin.retire_test_perp('01a1c502-0000-7000-8000-000000000002', 'The run is done')::jsonb ->> 'state'$$),
  'retired',
  'with every position closed, an admin retires the test perp'
);
select results_eq(
  $$select pg_temp.balance(p.long_account_id), pg_temp.balance(p.short_account_id), p.trading_mode
    from perps.perps p where p.id = '01a1c502-0000-7000-8000-000000000002'$$,
  $$values (0::numeric, 0::numeric, 'halted'::text)$$,
  'it ends holding nothing, switched off for good: its pools went back to the house'
);
select is(
  (select sum(m.amount) from ledger.moves m join ledger.entries e on e.id = m.entry_id
   where e.kind = 'perp_retire' and e.perp_id = pg_temp.perp('t2')),
  2006.199595::numeric,
  'the house got back its Ṁ2,000 and the Ṁ6.199595 its traders left in the pools'
);
select is(
  (select sum(l.amount) from ledger.lines l join ledger.accounts a on a.id = l.account_id
   join ledger.entries e on e.id = l.entry_id
   where e.perp_id = pg_temp.perp('t2') and a.kind = 'person'),
  -6.199595::numeric,
  'which is exactly what Zoe and Sid lost between them, to the millionth: nothing made, nothing lost'
);
select results_eq(
  $$select r.rule, r.new_value from perps.rule_changes r
    where r.perp_id = '01a1c502-0000-7000-8000-000000000002' order by r.id desc limit 2$$,
  $$values ('retired'::text, 'retired'::text), ('trading_mode', 'halted')$$,
  'switching it off and retiring it are in its log'
);
select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.set_perp_mode('01a1c502-0000-7000-8000-000000000002', 'enabled', 'Again')::text$q$)$$,
  '55000', null, 'a retired perp is never switched on again'
);
select throws_ok(
  $$select pg_temp.step('zoe', 't2', 'open', '0c000000-0000-4000-8000-00000000000d',
      '{"direction": "long", "margin": "10", "leverage": "2"}',
      jsonb_build_object('refusal', jsonb_build_object('code', 'trading_off', 'message', 'Retired.'),
                         'pools', jsonb_build_object('long', '0', 'short', '0')))$$,
  '55000', null, 'nor traded'
);
select is(
  pg_temp.as_app('ada', $$select admin.retire_test_perp('01a1c502-0000-7000-8000-000000000003', 'Never used')::jsonb ->> 'state'$$),
  'retired',
  'a test perp nobody traded is retired too'
);


-- The pause: a new price that couldn't be applied without leaving the pools short moves the price
-- on and nothing else, and pauses trading until a later price applies cleanly.
select is(
  pg_temp.step(null, 't1', 'tick', null, null,
    jsonb_build_object(
      'price', jsonb_build_object('at', 'now', 'price', '95'),
      'paused_reason', 'The pools could not pay every winner at this price',
      'pools', jsonb_build_object('long', '1073.52', 'short', '1010.27'))) ->> 'paused_reason',
  'The pools could not pay every winner at this price',
  'a price that can''t be applied cleanly pauses trading, moving the price alone'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000010',
      '{"direction": "long", "margin": "10", "leverage": "2"}', '10', '0.02', '20', '2',
      '{"long": "1083.54", "short": "1010.27"}',
      jsonb_build_object('positions', jsonb_build_array(
        pg_temp.pos('zoe', 'long', '20', '10', '10', '0.02', '95', '2', '47.5'))))$$,
  '23514', 'Only a new price pauses trading, or ends a pause',
  'while paused, a trade can''t pretend the pause is over'
);
select throws_ok(
  $$select pg_temp.zoe_opens('0c000000-0000-4000-8000-000000000010',
      '{"direction": "long", "margin": "10", "leverage": "2"}', '10', '0.02', '20', '2',
      '{"long": "1083.54", "short": "1010.27"}',
      jsonb_build_object(
        'paused_reason', 'The pools could not pay every winner at this price',
        'positions', jsonb_build_array(
          pg_temp.pos('zoe', 'long', '20', '10', '10', '0.02', '95', '2', '47.5'))))$$,
  '23514', 'Trading is paused: nothing trades and nothing funds',
  'nor trade through it'
);
select is(
  pg_temp.step('zoe', 't1', 'open', '0c000000-0000-4000-8000-000000000010',
    '{"direction": "long", "margin": "10", "leverage": "2"}',
    jsonb_build_object(
      'paused_reason', 'The pools could not pay every winner at this price',
      'refusal', jsonb_build_object('code', 'paused', 'message', 'Trading is paused.'),
      'pools', jsonb_build_object('long', '1073.52', 'short', '1010.27'))) -> 'refusal' ->> 'code',
  'paused',
  'it is refused as paused'
);


-- What never changes ----------------------------------------------------------------------------------------------------

select throws_ok(
  $$update perps.perps set listed = true where id = '01a1c502-0000-7000-8000-000000000001'$$,
  '23001', null, 'a perp''s listing never changes, even for the owner'
);
select throws_ok(
  $$update perps.perps set stand_in_volatility = 1 where id = '01a1c502-0000-7000-8000-000000000001'$$,
  '23001', null, 'nor its price walk'
);
select throws_ok(
  $$delete from perps.perps where id = '01a1c502-0000-7000-8000-000000000001'$$,
  '23001', null, 'a perp is never deleted'
);
select throws_ok(
  $$delete from perps.positions where id = '0b000000-0000-4000-8000-0000000000a1'$$,
  '23001', null, 'nor a position'
);
select throws_ok(
  $$update perps.positions set size = 1 where id = '0b000000-0000-4000-8000-0000000000a1'$$,
  '23001', null, 'a closed position stays as it closed'
);
select throws_ok(
  $$update perps.rule_changes set reason = 'Rewritten' where perp_id = '01a1c502-0000-7000-8000-000000000001'$$,
  '23001', null, 'the rule-change log is never edited'
);
select throws_ok(
  $$delete from perps.events$$, '23001', null, 'nor the events'
);
select throws_ok(
  $$delete from perps.prices$$, '23001', null, 'nor the prices'
);
select throws_ok(
  $$delete from perps.requests$$, '23001', null, 'nor the requests'
);
select throws_ok(
  $$update perps.fundings set rate = 0$$, '23001', null, 'nor the fundings'
);
select throws_ok(
  $$insert into ledger.entries (kind, perp_id) values ('perp_trade', null)$$,
  '23514', null, 'a perp''s entry names its perp'
);
select throws_ok(
  $$insert into ledger.entries (kind, perp_id) values ('trade', '01a1c502-0000-7000-8000-000000000001')$$,
  '23514', null, 'and no other entry names one'
);
select throws_ok(
  $$select ledger.post_perp('perp_trade', '01a1c502-0000-7000-8000-000000000001', null,
      jsonb_build_array(jsonb_build_object('from', pg_temp.acct('ann'), 'to', pg_temp.pool('t1', 'long'), 'amount', '0.0000001')))$$,
  '22023', null, 'a perp''s move is to the millionth, never rounded away'
);
select throws_ok(
  $$select ledger.post_perp('perp_trade', '01a1c502-0000-7000-8000-000000000001', null,
      jsonb_build_array(jsonb_build_object('from', pg_temp.acct('ann'), 'to', pg_temp.pool('t2', 'long'), 'amount', '1')))$$,
  '23514', null, 'a perp''s moves go only to its own pools'
);
select throws_ok(
  $$select ledger.post_perp('perp_trade', '01a1c502-0000-7000-8000-000000000001', null,
      jsonb_build_array(jsonb_build_object('from', pg_temp.pool('t1', 'long'), 'to', ledger.house(), 'amount', '1')))$$,
  '23514', null, 'and a trade never pays the house'
);
select throws_ok(
  $$select ledger.post_perp('perp_trade', '01a1c502-0000-7000-8000-000000000001', null,
      jsonb_build_array(jsonb_build_object('from', pg_temp.acct('ann'), 'to', pg_temp.pool('t1', 'long'), 'amount', '5000')))$$,
  '23514', null, 'nobody pays more than they hold'
);
select throws_ok(
  $$select ledger.post_perp('perp_price', '01a1c502-0000-7000-8000-000000000001', null,
      jsonb_build_array(jsonb_build_object('from', pg_temp.pool('t1', 'long'), 'to', pg_temp.pool('t1', 'short'), 'amount', '1101.000001')))$$,
  '23514', null, 'and no pool goes below zero'
);
select is_empty($$select * from ledger.problems()$$, 'after it all, the books have no problem');

select * from finish();
rollback;
