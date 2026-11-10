-- Tests for migrations/*_unlisted_markets.sql (Round 4, R2: a check run's markets stay off the
-- public list), run by the Database check against a fresh database built from the migrations.
-- Rolled back, so nothing is left behind.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(20);

-- Runs one query as the app's own role, signed in as `account` (null: nobody), and gives back its
-- one value as text (as in trading_reads.test.sql).
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

create function pg_temp.market(n integer)
returns text
language sql
as $$ select format('019a7100-000%s-7000-8000-00000000000%s', n, n) $$;

-- The markets the public list shows, by ID, a page of `size` at a time, every page.
create function pg_temp.listed(size integer)
returns text[]
language plpgsql
as $$
declare
  page jsonb;
  after text;
  ids text[] := '{}';
begin
  loop
    page := pg_temp.as_app(null, format('select trading.markets(%L, %s)', after, size))::jsonb;
    ids := ids || array(select m #>> '{market,id}' from jsonb_array_elements(page -> 'markets') m);
    after := page ->> 'next';
    exit when after is null;
  end loop;
  return ids;
end;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'ada@unlisted.test'),
  ('00000000-0000-4000-8000-0000000000e2', 'ben@unlisted.test');
insert into private.admins (user_id, note) values
  ('00000000-0000-4000-8000-0000000000e1', 'A test admin');

-- Who may do what ----------------------------------------------------------------------------------

select ok(
  pg_catalog.has_function_privilege('hrizzup_app',
    'admin.create_market(uuid,text,text[],text,text,text,timestamptz,timestamptz,numeric,numeric,boolean)',
    'EXECUTE')
  and not exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) as r (role)
    where pg_catalog.has_function_privilege(r.role,
      'admin.create_market(uuid,text,text[],text,text,text,timestamptz,timestamptz,numeric,numeric,boolean)',
      'EXECUTE')),
  'the app''s role may make a market listed or unlisted, and none of Supabase''s own roles may'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000e2', format(
      $q$select admin.create_market(%L, 'Will test event X happen?', array['general'], 'Rules.',
           'Hrizzup''s test desk', null, now(), now() + interval '1 day', 0.5, 100, false)$q$,
      pg_temp.market(9)))$$,
  '42501', null, 'only an admin may make one, listed or not'
);

-- Made listed and unlisted ----------------------------------------------------------------------------

select is(
  array[
    pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
      $q$select admin.create_market(%L, 'Will test event 1 happen?', array['general'], 'Rules.',
           'Hrizzup''s test desk', null, now(), now() + interval '1 day', 0.5, 100) ->> 'listed'$q$,
      pg_temp.market(1))),
    pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
      $q$select admin.create_market(%L, 'Will test event 2 happen?', array['general'], 'Rules.',
           'Hrizzup''s test desk', null, now(), now() + interval '1 day', 0.5, 100, false) ->> 'listed'$q$,
      pg_temp.market(2))),
    pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
      $q$select admin.create_market(%L, 'Will test event 3 happen?', array['general'], 'Rules.',
           'Hrizzup''s test desk', null, now(), now() + interval '1 day', 0.5, 100, true) ->> 'listed'$q$,
      pg_temp.market(3))),
    pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
      $q$select admin.create_market(%L, 'Will test event 4 happen?', array['general'], 'Rules.',
           'Hrizzup''s test desk', null, now(), now() + interval '1 day', 0.5, 100, false) ->> 'listed'$q$,
      pg_temp.market(4)))
  ],
  array['true', 'false', 'true', 'false'],
  'the console makes a market listed, as before, or unlisted when its admin asks, and says which'
);
select is(
  (select array_agg(pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
     'select admin.open_market(%L) ->> ''state''', pg_temp.market(n))) order by n)
   from generate_series(1, 4) as n),
  array['open', 'open', 'open', 'open'],
  'all four open, the house seeding each'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
    $q$select admin.create_market(%L, 'Will test event 2 happen?', array['general'], 'Rules.',
         'Hrizzup''s test desk', null, now(), now() + interval '1 day', 0.5, 100, false) ->> 'state'$q$,
    pg_temp.market(2))),
  'open',
  'a retried create gets back the market its first try made'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
      $q$select admin.create_market(%L, 'Will test event 2 happen?', array['general'], 'Rules.',
           'Hrizzup''s test desk', null, now(), now() + interval '1 day', 0.5, 100, true)$q$,
      pg_temp.market(2)))$$,
  '23505', null, '... but asking for the other choice under its ID is another market, refused'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
      $q$select admin.create_market(%L, 'Will test event 8 happen?', array['general'], 'Rules.',
           'Hrizzup''s test desk', null, now(), now() + interval '1 day', 0.5, 100, null)$q$,
      pg_temp.market(8)))$$,
  '22023', null, 'a market is listed or unlisted, never neither'
);

-- The public list ----------------------------------------------------------------------------------

select is(
  pg_temp.listed(100),
  array[pg_temp.market(3), pg_temp.market(1)],
  'the public list shows the listed markets, newest first, never an unlisted one'
);
select is(
  pg_temp.listed(1),
  array[pg_temp.market(3), pg_temp.market(1)],
  '... a page of one at a time too, each page skipping the unlisted ones'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000e2',
    format('select trading.markets(%L, 100) -> ''markets''', pg_temp.market(4)))::jsonb
    @> jsonb_build_array(jsonb_build_object('market', jsonb_build_object('id', pg_temp.market(2)))),
  false,
  '... and paging from an unlisted market''s ID still never shows one'
);
select is(
  (select array_agg(i.indexname::text)
   from pg_catalog.pg_indexes i
   where i.schemaname = 'markets' and i.tablename = 'details' and i.indexname = 'details_listed'),
  array['details_listed'],
  'an index walks the listed markets, so the list never steps over the unlisted ones'
);

-- Everything else reads an unlisted market as before --------------------------------------------------

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000e2', format(
    'select trading.holdings(%L, ''00000000-0000-4000-8000-00000000ffff'') ->> ''state''',
    pg_temp.market(2))),
  'open',
  'anyone signed in reaches an unlisted market by its address, to trade it'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
    'select admin.market(%L) ->> ''listed''', pg_temp.market(2))),
  'false',
  'the console shows it, and says it''s unlisted'
);
select is(
  (select array_agg(x.v order by x.v)
   from jsonb_array_elements_text(pg_temp.as_app('00000000-0000-4000-8000-0000000000e1',
     'select jsonb_path_query_array(admin.markets(null, 100), ''$.markets[*].listed'')')::jsonb) as x (v)),
  array['false', 'false', 'true', 'true'],
  '... as it does every market, listed or not'
);
select is(
  array[
    pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
      'select admin.close_market(%L) ->> ''state''', pg_temp.market(2))),
    pg_temp.as_app('00000000-0000-4000-8000-0000000000e1', format(
      $q$select admin.settle_market(%L, 'no', null, 'The test desk said no.', null) ->> 'state'$q$,
      pg_temp.market(2)))],
  array['closed', 'settled'],
  'an unlisted market closes and settles like any other'
);
select is(
  pg_temp.listed(100),
  array[pg_temp.market(3), pg_temp.market(1)],
  '... and stays off the public list once settled'
);

-- The migration's one pass over the markets the checks made before, replayed -----------------------
-- (the migration itself ran on an empty database here; this is its sequence, on a market the
-- console's test account makes now, as staging has hundreds of)

insert into auth.users (id, email) values
  ('d0606352-12bf-4f3c-bcc7-9fbbce431a3a', 'market-admin@unlisted.test');
insert into private.admins (user_id, note) values
  ('d0606352-12bf-4f3c-bcc7-9fbbce431a3a', 'The console''s test account, for this test');
select pg_temp.as_app('d0606352-12bf-4f3c-bcc7-9fbbce431a3a', format(
  $q$select admin.create_market(%L, 'Will test event 5 happen?', array['general'], 'Rules.',
       'Hrizzup''s test desk', null, now(), now() + interval '1 day', 0.5, 100) ->> 'state'$q$,
  pg_temp.market(5)));
set constraints all immediate;
set constraints all deferred;
alter table markets.details disable trigger details_listing_never_changes;
update markets.details set listed = false where created_by = 'd0606352-12bf-4f3c-bcc7-9fbbce431a3a';
select throws_ok(
  'create index replayed on markets.details (market_id)',
  '55006', null,
  'right after the pass, the details'' queued check stops any index being made (so the migration runs it first)'
);
set constraints markets.details_rules_across_tables immediate;
set constraints markets.details_rules_across_tables deferred;
select lives_ok(
  'create index replayed on markets.details (market_id)',
  '... and once it has run, as the migration runs it, the index is made'
);
alter table markets.details enable trigger details_listing_never_changes;
select is(
  (select array_agg(row(d.market_id, d.listed)::text order by d.market_id)
   from markets.details d where d.market_id in (pg_temp.market(5)::uuid, pg_temp.market(1)::uuid)),
  array[row(pg_temp.market(1)::uuid, true)::text, row(pg_temp.market(5)::uuid, false)::text],
  'the pass takes only the console''s test account''s markets off the list, never another admin''s'
);

-- Chosen once ------------------------------------------------------------------------------------

select throws_ok(
  format('update markets.details set listed = true where market_id = %L', pg_temp.market(4)),
  '23001', null, 'whether a market is listed never changes once it''s made, even by the owner'
);

select * from finish();
rollback;
