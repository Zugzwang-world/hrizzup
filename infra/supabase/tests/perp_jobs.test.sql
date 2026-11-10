-- Tests for migrations/*_perp_jobs.sql (PLAN.md step 3.4a), run by the Database check on every pull
-- request against a fresh database built from the migrations. Everything runs in a transaction that
-- is rolled back, so nothing is left behind (and Supabase Cron's own runs, in their own
-- transactions, never see what these tests make, nor send the calls they queue).
--
-- The schedules as Supabase Cron holds them; and one run of a job: no call while no perp has work
-- (switched off, or with nobody holding a position, or funding not due), none where the
-- environment's address and secret aren't in Vault, and one call, with the secret, when both are.
-- Only the schedule may run a job: never the app or Supabase's roles.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'ada@perp-jobs.test'),
  ('00000000-0000-4000-8000-0000000000f2', 'ivy@perp-jobs.test');
insert into private.admins (user_id, note) values
  ('00000000-0000-4000-8000-0000000000f1', 'Ada, the perp jobs tests'' admin');
select ledger.open_account('00000000-0000-4000-8000-0000000000f2', 1000);

-- Runs one query as the app's own role, signed in as `who`, and gives back its one value as text.
create function pg_temp.as_app(who uuid, query text)
returns text
language plpgsql
as $$
declare
  answer text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', who, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', who::text, true);
  set local role hrizzup_app;
  execute query into answer;
  reset role;
  return answer;
end;
$$;

-- A test perp, made and switched on by Ada through the console's calls: its first funding period
-- started `funding_hours_ago` hours ago.
create function pg_temp.make_perp(perp uuid, funding_hours_ago integer)
returns void
language plpgsql
as $$
begin
  perform pg_temp.as_app('00000000-0000-4000-8000-0000000000f1', format(
    $q$select admin.create_test_perp(%L, %L, '00112233aabbccdd',
         jsonb_build_object('origin', '2026-11-01T00:00:00Z', 'startPrice', '100', 'volatility', '40'),
         jsonb_build_object('maxLeverage', '10', 'takerFeeBps', '10', 'takerFeeImpact', '0',
                            'fundingPeriodMs', '3600000', 'fundingSensitivity', '1',
                            'maxFundingRate', '0.0001', 'maxPriceAgeMs', '120000',
                            'subsidyLong', '1000', 'subsidyShort', '1000'),
         clock_timestamp() - interval '%s hours',
         'The jobs tests'' own test perp')::text$q$,
    perp, 'Jobs test perp ' || perp, funding_hours_ago));
  perform pg_temp.as_app('00000000-0000-4000-8000-0000000000f1', format(
    $q$select admin.set_perp_mode(%L, 'enabled', 'The jobs tests trade it')::text$q$, perp));
end;
$$;

-- Ivy opens a 10-times long of Ṁ100 on a perp with no price yet: the step, the way the server runs
-- it (begin_step, then apply_step with its plan, worked out by hand), at a first price of 100.
create function pg_temp.ivy_opens(perp uuid, position_id uuid)
returns jsonb
language plpgsql
as $$
declare
  ivy uuid := (select a.id from ledger.accounts a
               where a.kind = 'person' and a.user_id = '00000000-0000-4000-8000-0000000000f2');
  long_pool uuid := (select p.long_account_id from perps.perps p where p.id = perp);
  short_pool uuid := (select p.short_account_id from perps.perps p where p.id = perp);
  request uuid := gen_random_uuid();
  params jsonb := '{"direction": "long", "margin": "100", "leverage": "10"}';
  begun jsonb;
  moment text;
  step_time text;
  answer jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f2', true);
  set local role hrizzup_app;
  begun := perps.begin_step(perp, 'open', request, params, clock_timestamp() - interval '6 seconds');
  reset role;
  moment := begun ->> 'now';
  select markets.utc(perps.stand_in_step(p, moment::timestamptz)) into step_time
  from perps.perps p where p.id = perp;
  set local role hrizzup_app;
  answer := perps.apply_step(jsonb_build_object(
    'perp_id', perp, 'action', 'open', 'request_id', request, 'params', params,
    'price', jsonb_build_object('at', step_time, 'price', '100'),
    'paused_reason', null,
    'moves', jsonb_build_array(
      jsonb_build_object('phase', 'trade', 'from', ivy, 'to', long_pool, 'amount', '100'),
      jsonb_build_object('phase', 'trade', 'from', ivy, 'to', long_pool, 'amount', '1')),
    'positions', jsonb_build_array(jsonb_build_object(
      'id', position_id, 'accountId', ivy, 'direction', 'long', 'size', '1000',
      'costBasis', '100', 'originalCostBasis', '100', 'takerFeeCostBasis', '1',
      'entryPrice', '100', 'leverage', '10', 'liquidationPrice', '90',
      'openedAt', moment, 'updatedAt', moment, 'closeReason', null)),
    'events', jsonb_build_array(jsonb_build_object(
      'phase', 'trade', 'kind', 'open', 'positionId', position_id, 'sizeChange', '1000',
      'costBasisChange', '100', 'margin', '100', 'fee', '1', 'payout', '0')),
    'pools', jsonb_build_object('long', '1101', 'short', '1000')));
  reset role;
  return answer;
end;
$$;

create function pg_temp.queued()
returns bigint
language sql
as $$
  select count(*) from net.http_request_queue;
$$;


-- The schedules ---------------------------------------------------------------------------------------

select results_eq(
  $$select jobname::text, schedule::text, command::text, username::text, active
    from cron.job where jobname like 'perps-%' order by jobname$$,
  $$values ('perps-cron-history', '23 3 * * *',
            'delete from cron.job_run_details where end_time < now() - interval ''2 days''',
            'postgres', true),
           ('perps-funding', '* * * * *', 'select perps.call_job(''funding'')', 'postgres', true),
           ('perps-tick', '5 seconds', 'select perps.call_job(''tick'')', 'postgres', true)$$,
  'Supabase Cron runs the tick every 5 seconds, the funding check every minute, and tidies its log'
);

-- Who may run a job -----------------------------------------------------------------------------------

select ok(
  not pg_catalog.has_function_privilege('hrizzup_app', 'perps.call_job(text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'perps.call_job(text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'perps.call_job(text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('service_role', 'perps.call_job(text)', 'EXECUTE'),
  'only the schedule runs a job: not the app, nor any of Supabase''s roles'
);
select throws_ok(
  $$select perps.call_job('settle')$$,
  '22023', 'Unknown perp job settle',
  'a job it doesn''t have is refused'
);

-- No work, no call ------------------------------------------------------------------------------------

select is(
  (select pg_temp.queued()), 0::bigint, 'nothing waits to be sent before the runs'
);
select is(perps.call_job('tick'), null, 'with no perp switched on and held, a tick calls nothing');
select is(perps.call_job('funding'), null, 'nor does the funding check');

-- A test perp switched on, but nobody holds a position: still nothing to do.
select pg_temp.make_perp('01a1c503-0000-7000-8000-000000000001', 0);
select is(perps.call_job('tick'), null, 'a perp switched on with no position: no call');

select is(
  pg_temp.ivy_opens('01a1c503-0000-7000-8000-000000000001',
                    '0b000000-0000-4000-8000-0000000000f1') ->> 'status',
  'opened',
  'Ivy opens a 10-times long'
);
select ok(
  '01a1c503-0000-7000-8000-000000000001'::uuid = any (perps.due('tick')),
  'the perp now has work for the tick'
);
select ok(
  not '01a1c503-0000-7000-8000-000000000001'::uuid = any (perps.due('funding')),
  'but no funding: its first period started just now'
);
select is(
  perps.call_job('tick'), null,
  'with work but no address and secret in Vault (a fresh database), a tick calls nothing'
);
select is((select pg_temp.queued()), 0::bigint, 'nothing was queued');

-- The environment's address and secret in Vault: one call a run, with the secret.
select vault.create_secret('http://127.0.0.1:9/api/jobs/perps', 'perps_jobs_url',
                           'The jobs tests'' address');
select vault.create_secret('test-secret-only-for-the-jobs-tests-x', 'perps_jobs_secret',
                           'The jobs tests'' secret');
select isnt(perps.call_job('tick'), null, 'with work and somewhere to call, a tick calls');
select results_eq(
  $$select method::text, url, headers ->> 'Authorization', headers ->> 'Content-Type'
    from net.http_request_queue$$,
  $$values ('POST', 'http://127.0.0.1:9/api/jobs/perps?job=tick',
            'Bearer test-secret-only-for-the-jobs-tests-x', 'application/json')$$,
  'the call goes to the environment''s jobs address, for the tick, with its secret'
);
select is(perps.call_job('funding'), null, 'funding not due: no funding call');
select is((select pg_temp.queued()), 1::bigint, 'still the one call');

-- A perp whose first funding period started two hours ago: funding is due.
select pg_temp.make_perp('01a1c503-0000-7000-8000-000000000002', 2);
select pg_temp.ivy_opens('01a1c503-0000-7000-8000-000000000002',
                         '0b000000-0000-4000-8000-0000000000f2');
select isnt(perps.call_job('funding'), null, 'funding due: the funding check calls');
select is(
  (select url from net.http_request_queue order by id desc limit 1),
  'http://127.0.0.1:9/api/jobs/perps?job=funding',
  'for the funding'
);

-- Switched off: no work again, so no call, address and secret or not.
select pg_temp.as_app('00000000-0000-4000-8000-0000000000f1', $q$
  select admin.set_perp_mode('01a1c503-0000-7000-8000-000000000001', 'halted', 'Off again')::text$q$);
select pg_temp.as_app('00000000-0000-4000-8000-0000000000f1', $q$
  select admin.set_perp_mode('01a1c503-0000-7000-8000-000000000002', 'halted', 'Off again')::text$q$);
select is(perps.call_job('tick'), null, 'every perp switched off: a tick calls nothing');

select * from finish();
rollback;
