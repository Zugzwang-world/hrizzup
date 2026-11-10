-- Tests for migrations/*_perp_book_rules.sql (PLAN.md step 3.4a), run by the Database check on every
-- pull request against a fresh database built from the migrations. Everything runs in a transaction
-- that is rolled back, so nothing is left behind.
--
-- 1. The pools balance as Manifold's maths balances them: a long pool left short of its own side's
--    margins (a short closed at a profit while the long was losing, then the price came back) is
--    topped up from the short pool with the next price, no position changing; never past its side's
--    margins, never both ways at once, never in a trade. Three windows a little over 5 seconds
--    apart, since a new price needs a new 5-second step. The steps run as the server runs them
--    (begin_step, then apply_step with its plan, worked out by hand here).
-- 2. Funding on each perp's own hourly slots, and the books refusing one before its slot.
-- 3. A check run's test perp leaves the schedule's work two hours after it's made.
-- 4. The listed perp stays off where its scheduled jobs aren't set up; the app's roles can't read
--    Vault, where they are.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'ada@perp-rules.test'),
  ('00000000-0000-4000-8000-0000000000d2', 'ann@perp-rules.test'),
  ('00000000-0000-4000-8000-0000000000d3', 'bob@perp-rules.test');
insert into private.admins (user_id, note) values
  ('00000000-0000-4000-8000-0000000000d1', 'Ada, the perp rules tests'' admin');
select ledger.open_account('00000000-0000-4000-8000-0000000000d2', 1000);
select ledger.open_account('00000000-0000-4000-8000-0000000000d3', 1000);

create function pg_temp.user_id(name text)
returns uuid
language sql
as $$
  select case name
    when 'ada' then '00000000-0000-4000-8000-0000000000d1'::uuid
    when 'ann' then '00000000-0000-4000-8000-0000000000d2'::uuid
    when 'bob' then '00000000-0000-4000-8000-0000000000d3'::uuid
  end;
$$;

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
    when 'b1' then '01a1c504-0000-7000-8000-000000000001'::uuid
    when 'b2' then '01a1c504-0000-7000-8000-000000000002'::uuid
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

create function pg_temp.position(name text)
returns uuid
language sql
as $$
  select case name
    when 'ann' then '0b000000-0000-4000-8000-0000000000d1'::uuid
    when 'bob' then '0b000000-0000-4000-8000-0000000000d2'::uuid
    when 'bob2' then '0b000000-0000-4000-8000-0000000000d3'::uuid
  end;
$$;

create function pg_temp.opened(name text)
returns text
language sql
as $$
  select markets.utc(opened_at) from perps.positions where id = pg_temp.position(name);
$$;

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
    'id', pg_temp.position(holder), 'accountId', pg_temp.acct(rtrim(holder, '2')),
    'direction', direction,
    'size', size, 'costBasis', cost_basis, 'originalCostBasis', original_cost_basis,
    'takerFeeCostBasis', fee_cost_basis, 'entryPrice', entry_price, 'leverage', leverage,
    'liquidationPrice', liquidation_price, 'openedAt', opened, 'updatedAt', 'now',
    'closeReason', close_reason);
$$;

-- Runs one query as the app's own role, signed in as `name`, and gives back its one value as text.
create function pg_temp.as_app(name text, query text)
returns text
language plpgsql
as $$
declare
  answer text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.user_id(name), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', pg_temp.user_id(name)::text, true);
  set local role hrizzup_app;
  execute query into answer;
  reset role;
  return answer;
end;
$$;

-- One step, the way the server runs it: begin_step, then apply_step with the plan, as the app's
-- own role. A trade is placed just before the book's price (or, with no price yet, 6 seconds ago),
-- so it fills at a price published after it. In the plan, "now" stands for the step's moment.
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
  set local role hrizzup_app;
  answer := perps.apply_step(plan);
  reset role;
  return answer;
end;
$$;

-- A test perp made and switched on by Ada: Ṁ1 in the long pool, Ṁ1,000 in the short one, its first
-- funding period started `funding_hours_ago` hours ago.
create function pg_temp.make_perp(perp text, funding_hours_ago integer)
returns void
language plpgsql
as $$
begin
  perform pg_temp.as_app('ada', format(
    $q$select admin.create_test_perp(%L, %L, '00112233aabbccdd',
         jsonb_build_object('origin', '2026-11-01T00:00:00Z', 'startPrice', '100', 'volatility', '40'),
         jsonb_build_object('maxLeverage', '10', 'takerFeeBps', '10', 'takerFeeImpact', '0',
                            'fundingPeriodMs', '3600000', 'fundingSensitivity', '1',
                            'maxFundingRate', '0.0001', 'maxPriceAgeMs', '120000',
                            'subsidyLong', '1', 'subsidyShort', '1000'),
         clock_timestamp() - interval '%s hours',
         'The perp rules tests'' own test perp')::text$q$,
    pg_temp.perp(perp), 'Rules test perp ' || perp, funding_hours_ago));
  perform pg_temp.as_app('ada', format(
    $q$select admin.set_perp_mode(%L, 'enabled', 'The rules tests trade it')::text$q$,
    pg_temp.perp(perp)));
end;
$$;

select pg_temp.make_perp('b1', 0);
select pg_temp.make_perp('b2', 2);


-- 1. The pools balance as Manifold's maths balances them ------------------------------------------------

-- Window 1, at $100: Ann opens a 10-times long of Ṁ100 and Bob a 10-times short of Ṁ100.
select is(
  pg_temp.step('ann', 'b1', 'open', '0c000000-0000-4000-8000-0000000000d1',
    '{"direction": "long", "margin": "100", "leverage": "10"}',
    jsonb_build_object(
      'price', jsonb_build_object('at', 'now', 'price', '100'),
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.acct('ann'), pg_temp.pool('b1', 'long'), '100'),
        pg_temp.mv('trade', pg_temp.acct('ann'), pg_temp.pool('b1', 'long'), '1')),
      'positions', jsonb_build_array(
        pg_temp.pos('ann', 'long', '1000', '100', '100', '1', '100', '10', '90')),
      'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'ann', '1000', '100', '100', '1')),
      'pools', jsonb_build_object('long', '102', 'short', '1000'))) ->> 'status',
  'opened',
  'Ann opens a 10-times long at $100'
);
select is(
  pg_temp.step('bob', 'b1', 'open', '0c000000-0000-4000-8000-0000000000d2',
    '{"direction": "short", "margin": "100", "leverage": "10"}',
    jsonb_build_object(
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.acct('bob'), pg_temp.pool('b1', 'short'), '100'),
        pg_temp.mv('trade', pg_temp.acct('bob'), pg_temp.pool('b1', 'short'), '1')),
      'positions', jsonb_build_array(
        pg_temp.pos('bob', 'short', '1000', '100', '100', '1', '100', '10', '110')),
      'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'bob', '1000', '100', '100', '1')),
      'pools', jsonb_build_object('long', '102', 'short', '1101'))) ->> 'status',
  'opened',
  'and Bob a 10-times short'
);

-- Window 2, at $91: Bob closes in profit, Ṁ90 of it paid from the long pool, which is left with Ṁ12
-- against Ann's Ṁ100 of margin (her long is losing Ṁ90 of it at this price, so that's enough now).
do $$ begin perform pg_sleep(5.1); end $$;
select is(
  pg_temp.step('bob', 'b1', 'close', '0c000000-0000-4000-8000-0000000000d3', '{"fraction": "1"}',
    jsonb_build_object(
      'price', jsonb_build_object('at', 'now', 'price', '91'),
      'moves', jsonb_build_array(
        pg_temp.mv('trade', pg_temp.pool('b1', 'short'), pg_temp.acct('bob'), '100'),
        pg_temp.mv('trade', pg_temp.pool('b1', 'long'), pg_temp.acct('bob'), '90')),
      'positions', jsonb_build_array(
        pg_temp.pos('bob', 'short', '1000', '100', '100', '1', '100', '10', '110', 'closed',
                    pg_temp.opened('bob'))),
      'events', jsonb_build_array(
        pg_temp.ev('trade', 'close', 'bob', '-1000', '-100', '0', '0', '190')),
      'pools', jsonb_build_object('long', '12', 'short', '1001'))) ->> 'status',
  'closed',
  'Bob closes his short at $91, Ṁ90 of profit from the long pool'
);

-- Window 3, at $99: Ann's long is worth Ṁ90 again, but the long pool holds Ṁ12. Manifold moves the
-- Ṁ78 across from the short pool (which no one's margin needs), no position changing.
do $$ begin perform pg_sleep(5.1); end $$;
select throws_ok(
  $$select pg_temp.step(null, 'b1', 'tick', null, null,
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '99'),
        'moves', jsonb_build_array(
          pg_temp.mv('price', pg_temp.pool('b1', 'short'), pg_temp.pool('b1', 'long'), '89')),
        'pools', jsonb_build_object('long', '101', 'short', '912')))$$,
  '23514', 'A move between the wrong pool and person, or more than the maths allows',
  'never past the receiving side''s own margins (Ann''s Ṁ100)'
);
select throws_ok(
  $$select pg_temp.step(null, 'b1', 'tick', null, null,
      jsonb_build_object(
        'price', jsonb_build_object('at', 'now', 'price', '99'),
        'moves', jsonb_build_array(
          pg_temp.mv('price', pg_temp.pool('b1', 'short'), pg_temp.pool('b1', 'long'), '79'),
          pg_temp.mv('price', pg_temp.pool('b1', 'long'), pg_temp.pool('b1', 'short'), '1')),
        'pools', jsonb_build_object('long', '90', 'short', '923')))$$,
  '23514', 'A move between the wrong pool and person, or more than the maths allows',
  'one way only'
);
-- Bob opens a 1-times short of Ṁ10 at the book's $91, the plan also moving Ṁ78 between the pools.
select throws_ok(
  $$select pg_temp.step('bob', 'b1', 'open', '0c000000-0000-4000-8000-0000000000d4',
      '{"direction": "short", "margin": "10", "leverage": "1"}',
      jsonb_build_object(
        'moves', jsonb_build_array(
          pg_temp.mv('trade', pg_temp.acct('bob'), pg_temp.pool('b1', 'short'), '10'),
          pg_temp.mv('trade', pg_temp.acct('bob'), pg_temp.pool('b1', 'short'), '0.01'),
          pg_temp.mv('trade', pg_temp.pool('b1', 'short'), pg_temp.pool('b1', 'long'), '78')),
        'positions', jsonb_build_array(
          pg_temp.pos('bob2', 'short', '10', '10', '10', '0.01', '91', '1', '182')),
        'events', jsonb_build_array(pg_temp.ev('trade', 'open', 'bob2', '10', '10', '10', '0.01')),
        'pools', jsonb_build_object('long', '90', 'short', '933.01')))$$,
  '23514', 'A move to or from someone the step can''t pay or charge',
  'and never in a trade'
);
select is(
  pg_temp.step(null, 'b1', 'tick', null, null,
    jsonb_build_object(
      'price', jsonb_build_object('at', 'now', 'price', '99'),
      'moves', jsonb_build_array(
        pg_temp.mv('price', pg_temp.pool('b1', 'short'), pg_temp.pool('b1', 'long'), '78')),
      'pools', jsonb_build_object('long', '90', 'short', '923'))) ->> 'price',
  '99',
  'the new price tops the long pool up to what Ann''s long is worth, from the short pool'
);
select results_eq(
  $$select pg_temp.balance(pg_temp.pool('b1', 'long')), pg_temp.balance(pg_temp.pool('b1', 'short'))$$,
  $$values (90::numeric, 923::numeric)$$,
  'Ṁ78 moved from the short pool to the long, the two still holding Ṁ1,013 between them'
);
select is(
  (select count(*) from perps.events where perp_id = pg_temp.perp('b1') and phase = 'price'),
  0::bigint,
  'no position changed'
);
select is_empty($$select problem from ledger.problems()$$, 'the books have no problem');


-- 2. Funding on each perp's own hourly slots -----------------------------------------------------------

-- The next funding of a perp whose last ran `last_after` after its first period started.
create function pg_temp.next_after(perp text, last_after interval)
returns interval
language sql
as $$
  select perps.next_funding_at(jsonb_populate_record(p, jsonb_build_object(
           'last_funding_at', p.funding_from + last_after))) - p.funding_from
  from perps.perps p where p.id = pg_temp.perp(perp);
$$;
select is(
  (select perps.next_funding_at(p) - p.funding_from from perps.perps p where p.id = pg_temp.perp('b1')),
  interval '1 hour',
  'never funded: due a whole period after its first period started'
);
select is(pg_temp.next_after('b1', interval '1 hour 30 seconds'), interval '2 hours',
  'funded 30 seconds into its slot: the next slot, an hour after the slot');
select is(pg_temp.next_after('b1', interval '1 hour 5 minutes'), interval '2 hours 4 minutes',
  'funded 5 minutes late: the next no sooner than the engine takes one (59 minutes on)');
select is(pg_temp.next_after('b1', interval '2 hours 4 minutes'), interval '3 hours 3 minutes',
  'and back towards its slot by a minute each time');
select is(pg_temp.next_after('b1', interval '3 hours 59 seconds'), interval '4 hours',
  'until it''s on its slot again: never every 59 minutes');
select is(pg_temp.next_after('b1', interval '7 hours 10 minutes'), interval '8 hours 9 minutes',
  'after an outage, one run, then back onto its slots: never a catch-up of the missed ones');
select throws_ok(
  $$insert into perps.fundings (perp_id, step, at, rate, price, open_interest_long,
                                open_interest_short, pool_long_before, pool_short_before,
                                pool_long_after, pool_short_after)
    values (pg_temp.perp('b1'), 99, clock_timestamp(), 0, 99, 1000, 0, 90, 923, 90, 923)$$,
  '23514', 'Funding runs once a period, on its perp''s own hourly slots',
  'the books refuse a funding before its perp''s slot, whatever asks for it'
);
select lives_ok(
  $$insert into perps.fundings (perp_id, step, at, rate, price, open_interest_long,
                                open_interest_short, pool_long_before, pool_short_before,
                                pool_long_after, pool_short_after)
    values (pg_temp.perp('b2'), 99, clock_timestamp(), 0, 100, 0, 0, 1, 1000, 1, 1000)$$,
  'and take one once its slot has come'
);


-- 3. A test perp leaves the schedule's work two hours after it's made ----------------------------------

select ok(
  (select perps.has_work(p, 'tick', clock_timestamp()) from perps.perps p where p.id = pg_temp.perp('b1')),
  'switched on with Ann''s long open: work for the 5-second tick'
);
select ok(
  not (select perps.has_work(p, 'tick', clock_timestamp() + interval '2 hours 1 minute')
       from perps.perps p where p.id = pg_temp.perp('b1')),
  'but none two hours after it was made: a check run is long done'
);
select ok(
  (select perps.has_work(jsonb_populate_record(p, '{"listed": true}'), 'tick',
                         clock_timestamp() + interval '1 day')
   from perps.perps p where p.id = pg_temp.perp('b1')),
  'a listed perp keeps its work however long it lives'
);


-- 4. The listed perp stays off where its scheduled jobs aren't set up ---------------------------------

select throws_ok(
  $$select pg_temp.as_app('ada', $q$select admin.set_perp_mode('01a1c501-ec40-78f6-87b6-3fb041143421', 'enabled', 'On, with no jobs')::text$q$)$$,
  '55000', 'The perp stays off until this environment''s scheduled jobs are set up',
  'the Bitcoin perp stays off where nothing would run its liquidations and funding'
);
select vault.create_secret('http://127.0.0.1:9/api/jobs/perps', 'perps_jobs_url', 'The rules tests'' address');
select vault.create_secret('the-rules-tests-jobs-secret-that-is-not-a-key', 'perps_jobs_secret',
                           'The rules tests'' secret');
select is(
  pg_temp.as_app('ada', $q$select admin.set_perp_mode('01a1c501-ec40-78f6-87b6-3fb041143421', 'enabled', 'Its jobs are set up')::jsonb ->> 'tradingMode'$q$),
  'enabled',
  'and switches on once they are'
);
select ok(
  not pg_catalog.has_table_privilege('hrizzup_app', 'vault.decrypted_secrets', 'SELECT')
  and not pg_catalog.has_table_privilege('hrizzup_app', 'vault.secrets', 'SELECT')
  and not pg_catalog.has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT'),
  'the app''s role, and anyone signed in or not, can''t read the jobs'' secret in Vault'
);

select * from finish();
rollback;
