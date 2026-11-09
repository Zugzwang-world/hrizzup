-- Tests for migrations/*_market_console.sql (PLAN.md step 1.7c), run by the Database check on
-- every pull request against a fresh database built from the migrations. Everything runs in a
-- transaction that is rolled back, so nothing is left behind.
--
-- The console's calls run as the app's own role with an account signed in, the way the server's
-- database helper (@hrizzup/db) runs them, through pg_temp.as_app() below; the rules that wait for
-- the commit are run on the spot with `set constraints all immediate`. Markets with real trades
-- are settled in product/packages/markets (its *.db.test.ts files), and the records the markets
-- give are checked against the agreement in tests/agreement/markets.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(112);

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

-- Who may do what ------------------------------------------------------------------------------

select has_table('private', 'admins', 'there is an admins table');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'private.admins'::regclass),
  'the admins table is locked (row-level security)'
);
select is_empty(
  $$select policyname from pg_catalog.pg_policies where schemaname = 'private' and tablename = 'admins'$$,
  'no policy opens the admins table to anyone'
);
select is_empty(
  $$select r.rolname from pg_catalog.pg_roles r
    where r.rolname in ('hrizzup_app', 'anon', 'authenticated', 'service_role')
      and pg_catalog.has_table_privilege(r.oid, 'private.admins'::regclass,
            'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')$$,
  'no role the app or Supabase uses can read or write the admins table'
);
select ok(
  not pg_catalog.has_schema_privilege('hrizzup_app', 'private', 'USAGE'),
  'the app''s role cannot even see the private schema'
);
select set_eq(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'admin'::regnamespace$$,
  array[
    'admin.is_admin()',
    'admin.markets(uuid,integer)',
    'admin.market(uuid)',
    'admin.create_market(uuid,text,text[],text,text,text,timestamp with time zone,timestamp with time zone,numeric,numeric)',
    'admin.open_market(uuid)',
    'admin.close_market(uuid)',
    'admin.settle_market(uuid,text,numeric,text,text)'
  ],
  'the admin schema holds the console''s calls, and nothing else'
);
select is_empty(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'admin'::regnamespace
      and not pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')$$,
  'the app''s role may make each of the console''s calls'
);
select is_empty(
  $$select r.rolname || ' may run ' || p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    cross join pg_catalog.pg_roles r
    where p.pronamespace in ('admin'::regnamespace, 'private'::regnamespace)
      and r.rolname in ('anon', 'authenticated', 'service_role')
      and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')$$,
  'Supabase''s own roles may call none of them'
);
select is_empty(
  $$select p.oid::regprocedure::text from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')$$,
  'the app''s role may call nothing in the private schema'
);
select ok(
  not pg_catalog.has_function_privilege('hrizzup_app', 'markets.settle(uuid,text,numeric)', 'EXECUTE'),
  'the app''s role still can''t settle a market but through the console''s call'
);

-- An admin and someone who isn't, as the owner sets them up -------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'ada@console.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'raj@console.test');
insert into private.admins (user_id, note) values
  ('00000000-0000-4000-8000-0000000000c1', 'A test admin');

-- Everyone but an admin is refused --------------------------------------------------------------

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c2', 'select admin.is_admin()'),
  'false',
  'someone who isn''t an admin is told so'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c2',
      'select admin.markets(null, 50)')$$,
  '42501', 'Only an admin may do this', 'someone who isn''t an admin can''t list the markets'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c2',
      $q$select admin.market('019a6b3c-0001-7000-8000-000000000001')$q$)$$,
  '42501', 'Only an admin may do this', '... or read one'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c2',
      $q$select admin.create_market('019a6b3c-0001-7000-8000-000000000001',
           'Will test event A happen?', array['general'], 'Rules.', 'Test desk', null, now(),
           now() + interval '1 day', 0.5, 1000)$q$)$$,
  '42501', 'Only an admin may do this', '... or create one'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c2',
      $q$select admin.open_market('019a6b3c-0001-7000-8000-000000000001')$q$)$$,
  '42501', 'Only an admin may do this', '... or open one'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c2',
      $q$select admin.close_market('019a6b3c-0001-7000-8000-000000000001')$q$)$$,
  '42501', 'Only an admin may do this', '... or close one'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c2',
      $q$select admin.settle_market('019a6b3c-0001-7000-8000-000000000001', 'yes', null,
           'Evidence.', null)$q$)$$,
  '42501', 'Only an admin may do this', '... or settle one'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c2',
      'select count(*) from private.admins')$$,
  '42501', null, 'the app''s role can''t read the admins table'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c2',
      $q$insert into private.admins (user_id, note)
         values ('00000000-0000-4000-8000-0000000000c2', 'Me') returning user_id$q$)$$,
  '42501', null, 'the app''s role can''t make anyone an admin'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c2',
      $q$select markets.settle('019a6b3c-0001-7000-8000-000000000001', 'YES')$q$)$$,
  '42501', null, 'the app''s role can''t reach the ledger''s settlement around the console'
);
select is(
  pg_temp.as_app(null, 'select admin.is_admin()'),
  'false',
  'nobody signed in is an admin'
);
select throws_ok(
  $$select pg_temp.as_app(null,
      $q$select admin.create_market('019a6b3c-0001-7000-8000-000000000001',
           'Will test event A happen?', array['general'], 'Rules.', 'Test desk', null, now(),
           now() + interval '1 day', 0.5, 1000)$q$)$$,
  '42501', 'Only an admin may do this', 'nobody signed in can create a market'
);

-- An admin creates a market: a draft, holding no money ----------------------------------------

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1', 'select admin.is_admin()'),
  'true',
  'an admin is told so'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.create_market('019a6b3c-0001-7000-8000-000000000001',
         'Will test event A happen?', array['general', 'ai'],
         E'Yes if the test desk records event A.\nNo otherwise.', 'Hrizzup''s test desk', null,
         now() + interval '1 hour', now() + interval '1 day', 0.4, 1000) ->> 'state'$q$),
  'draft',
  'an admin creates a market, as a draft'
);
select lives_ok('set constraints all immediate', 'the books and the market''s rules hold for a draft');
set constraints all deferred;

select results_eq(
  $$select m.state, m.pool_yes, m.pool_no, a.balance, m.p, m.seed
    from markets.markets m join ledger.accounts a on a.id = m.account_id
    where m.id = '019a6b3c-0001-7000-8000-000000000001'$$,
  $$values ('draft'::text, 0::numeric, 0::numeric, 0::numeric, 0.4::numeric, 1000::numeric)$$,
  'a draft holds no money, keeping its seed and starting probability for when it opens'
);
select results_eq(
  $$select question::text, categories::text[], kind, rules::text, source_name::text, source_url::text,
           settlement, cancel_reason::text, created_by
    from markets.details where market_id = '019a6b3c-0001-7000-8000-000000000001'$$,
  $$values ('Will test event A happen?'::text, array['general', 'ai']::text[], 'yes_no'::text,
            E'Yes if the test desk records event A.\nNo otherwise.'::text,
            'Hrizzup''s test desk'::text, null::text, 'by_hand'::text, null::text,
            '00000000-0000-4000-8000-0000000000c1'::uuid)$$,
  'its question, categories, rules, source and creator are kept, settled by hand'
);
select results_eq(
  $$select action, by_account from markets.log
    where market_id = '019a6b3c-0001-7000-8000-000000000001' order by id$$,
  $$values ('create'::text, '00000000-0000-4000-8000-0000000000c1'::uuid)$$,
  'the log has its creation, by the admin'
);
select is(
  markets.market_record('019a6b3c-0001-7000-8000-000000000001') - 'opens_at' - 'closes_at'
    - 'created_at' - 'updated_at',
  jsonb_build_object(
    'format', 'market/1',
    'id', '019a6b3c-0001-7000-8000-000000000001',
    'question', 'Will test event A happen?',
    'categories', jsonb_build_array('general', 'ai'),
    'kind', 'yes_no',
    'rules', E'Yes if the test desk records event A.\nNo otherwise.',
    'source', jsonb_build_object('name', 'Hrizzup''s test desk'),
    'settlement', 'by_hand',
    'state', 'draft'
  ),
  'it reads back as the agreement''s market record, leaving out what a draft doesn''t have'
);
select is_empty('select problem from ledger.problems()', 'the books have no problem');

-- One market per ID, so a retry never makes two ------------------------------------------------

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.create_market('019a6b3c-0001-7000-8000-000000000001',
         'Will test event A happen?', array['general', 'ai'],
         E'Yes if the test desk records event A.\nNo otherwise.', 'Hrizzup''s test desk', null,
         now() + interval '1 hour', now() + interval '1 day', 0.4, 1000) ->> 'id'$q$),
  '019a6b3c-0001-7000-8000-000000000001',
  'a retried create gets back the market its first try made'
);
select is(
  (select count(*)::int from markets.log
   where market_id = '019a6b3c-0001-7000-8000-000000000001' and action = 'create'),
  1,
  'and makes no second market'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
      $q$select admin.create_market('019a6b3c-0001-7000-8000-000000000001',
           'A different question?', array['general'], 'Rules.', 'Test desk', null, now(),
           now() + interval '1 day', 0.5, 1000)$q$)$$,
  '23505', null, 'the same ID for a different market is refused'
);

-- What a market must be ---------------------------------------------------------------------------

create function pg_temp.create_refusal(
  id text, question text, categories text, source_url text, opens_at text, closes_at text,
  probability text, seed text
)
returns text
language sql
as $$
  select format(
    'select pg_temp.as_app(%L, %L)',
    '00000000-0000-4000-8000-0000000000c1',
    format('select admin.create_market(%L, %L, %s, %L, %L, %s, %s, %s, %s, %s)',
      id, question, categories, 'Rules.', 'Test desk', coalesce(quote_literal(source_url), 'null'),
      opens_at, closes_at, probability, seed));
$$;

select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-4000-8000-000000000009', 'Will test event A happen?',
    $$array['general']$$, null, 'now()', $$now() + interval '1 day'$$, '0.5', '1000'),
  '22023', 'A market''s ID is a version 7 UUID', 'a market''s ID is a version 7 UUID'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', 'Will test event A happen?',
    $$'{}'::text[]$$, null, 'now()', $$now() + interval '1 day'$$, '0.5', '1000'),
  '22023', 'A market has 1 to 3 categories from the list, none repeated', 'at least one category'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', 'Will test event A happen?',
    $$array['general', 'ai', 'sports', 'crypto']$$, null, 'now()', $$now() + interval '1 day'$$,
    '0.5', '1000'),
  '22023', null, 'at most three categories'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', 'Will test event A happen?',
    $$array['general', 'general']$$, null, 'now()', $$now() + interval '1 day'$$, '0.5', '1000'),
  '22023', null, 'none repeated'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', 'Will test event A happen?',
    $$array['weather']$$, null, 'now()', $$now() + interval '1 day'$$, '0.5', '1000'),
  '22023', null, 'only categories from the list'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', 'Will test event A happen?',
    $$array['general']$$, null, $$now() - interval '2 days'$$, $$now() - interval '1 day'$$,
    '0.5', '1000'),
  '22023', 'A market closes in the future', 'a market closes in the future'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', 'Will test event A happen?',
    $$array['general']$$, null, $$now() + interval '1 day'$$, $$now() + interval '1 day'$$,
    '0.5', '1000'),
  '22023', 'A market opens before it closes', 'a market opens before it closes'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', 'Will test event A happen?',
    $$array['general']$$, null, 'now()', $$now() + interval '1 day'$$, '0.995', '1000'),
  '22023', null, 'a market starts between 1% and 99%'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', 'Will test event A happen?',
    $$array['general']$$, null, 'now()', $$now() + interval '1 day'$$, '0.5', '0'),
  '22023', null, 'the house seeds it with more than nothing'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', repeat('x', 121),
    $$array['general']$$, null, 'now()', $$now() + interval '1 day'$$, '0.5', '1000'),
  '23514', null, 'a question is at most 120 characters'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', E'Two\nlines?',
    $$array['general']$$, null, 'now()', $$now() + interval '1 day'$$, '0.5', '1000'),
  '23514', null, 'a question is one line of plain text'
);
select throws_ok(
  pg_temp.create_refusal('019a6b3c-0009-7000-8000-000000000009', 'Will test event A happen?',
    $$array['general']$$, 'http://insecure.example/desk', 'now()', $$now() + interval '1 day'$$,
    '0.5', '1000'),
  '23514', null, 'a source''s address starts https://'
);

-- Opening: betting starts at once, the house seeds the pool ----------------------------------------

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.open_market('019a6b3c-0001-7000-8000-000000000001') ->> 'state'$q$),
  'open',
  'an admin opens the draft'
);
select lives_ok('set constraints all immediate', 'the books and the market''s rules hold once it''s open');
set constraints all deferred;
select results_eq(
  $$select m.pool_yes, m.pool_no, a.balance
    from markets.markets m join ledger.accounts a on a.id = m.account_id
    where m.id = '019a6b3c-0001-7000-8000-000000000001'$$,
  $$values (1000::numeric, 1000::numeric, 1000::numeric)$$,
  'the house seeds its pool as it opens'
);
select is(
  (select markets.probability(p, pool_yes, pool_no) from markets.markets
   where id = '019a6b3c-0001-7000-8000-000000000001'),
  0.40000000::numeric,
  'at its starting probability'
);
select ok(
  (select opens_at >= date_trunc('milliseconds', now()) and opens_at <= clock_timestamp()
   from markets.details where market_id = '019a6b3c-0001-7000-8000-000000000001'),
  'its opening time becomes the moment it opened'
);
select results_eq(
  $$select action from markets.log where market_id = '019a6b3c-0001-7000-8000-000000000001' order by id$$,
  $$values ('create'::text), ('open'::text)$$,
  'the log has its opening'
);
select is_empty('select problem from ledger.problems()', 'the books still have no problem');

select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
      $q$select admin.open_market('019a6b3c-0001-7000-8000-000000000001')$q$)$$,
  '55000', 'Only a draft opens: this market is open', 'an open market can''t open again'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
      $q$select admin.settle_market('019a6b3c-0001-7000-8000-000000000001', 'yes', null,
           'Evidence.', null)$q$)$$,
  '55000', 'Only a closed market is settled: this market is open',
  'an open market can''t be settled before it closes'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
      $q$select admin.open_market('019a6b3c-00ff-7000-8000-0000000000ff')$q$)$$,
  'P0002', 'No such market', 'a market that doesn''t exist can''t be opened'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
      $q$select admin.market('019a6b3c-00ff-7000-8000-0000000000ff')$q$)$$,
  'P0002', 'No such market', '... or read'
);

-- Closing: betting stops at once ------------------------------------------------------------------

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.close_market('019a6b3c-0001-7000-8000-000000000001') ->> 'state'$q$),
  'closed',
  'an admin closes it'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
      $q$select admin.close_market('019a6b3c-0001-7000-8000-000000000001')$q$)$$,
  '55000', 'Only an open market closes: this market is closed', 'a closed market can''t close again'
);
select ok(
  (select closes_at <= clock_timestamp() from markets.markets
   where id = '019a6b3c-0001-7000-8000-000000000001'),
  'its closing time becomes the moment it closed'
);

-- Settling: the outcome, the evidence, a cancel's reason ----------------------------------------------

create function pg_temp.settle_refusal(outcome text, probability text, evidence text, reason text)
returns text
language sql
as $$
  select format(
    'select pg_temp.as_app(%L, %L)',
    '00000000-0000-4000-8000-0000000000c1',
    format('select admin.settle_market(%L, %s, %s, %s, %s)',
      '019a6b3c-0001-7000-8000-000000000001', coalesce(quote_literal(outcome), 'null'),
      coalesce(probability, 'null'), coalesce(quote_literal(evidence), 'null'),
      coalesce(quote_literal(reason), 'null')));
$$;

select throws_ok(
  pg_temp.settle_refusal('maybe', null, 'Evidence.', null),
  '22023', null, 'a market settles yes, no, at a set probability, or is cancelled'
);
select throws_ok(
  pg_temp.settle_refusal('probability', null, 'Evidence.', null),
  '22023', 'A set probability, and only a set probability, gives a probability',
  'a set probability gives its probability'
);
select throws_ok(
  pg_temp.settle_refusal('yes', '0.5', 'Evidence.', null),
  '22023', null, 'only a set probability gives one'
);
select throws_ok(
  pg_temp.settle_refusal('probability', '0.995', 'Evidence.', null),
  '22023', null, 'a set probability is between 1% and 99%'
);
select throws_ok(
  pg_temp.settle_refusal('cancel', null, 'Evidence.', null),
  '22023', 'A cancel, and only a cancel, gives its reason', 'a cancel gives its reason'
);
select throws_ok(
  pg_temp.settle_refusal('yes', null, 'Evidence.', 'A reason.'),
  '22023', null, 'only a cancel gives one'
);
select throws_ok(
  pg_temp.settle_refusal('yes', null, null, null),
  '22023', 'Every settlement gives its evidence', 'every settlement gives its evidence'
);
select throws_ok(
  pg_temp.settle_refusal('yes', null, E'Evidence.\n', null),
  '23514', null, 'the evidence is plain text'
);

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.settle_market('019a6b3c-0001-7000-8000-000000000001', 'yes', null,
         'The test desk recorded event A at 17:05, India time.', null) ->> 'state'$q$),
  'settled',
  'an admin settles it Yes'
);
select lives_ok('set constraints all immediate', 'the books and the market''s rules hold once it''s settled');
set constraints all deferred;
select results_eq(
  $$select m.state, m.resolution, a.balance
    from markets.markets m join ledger.accounts a on a.id = m.account_id
    where m.id = '019a6b3c-0001-7000-8000-000000000001'$$,
  $$values ('settled'::text, 'YES'::text, 0::numeric)$$,
  'settled Yes, the market holds nothing'
);
select results_eq(
  $$select outcome, probability, evidence::text, reason::text, by_account, paid_to_people, people,
           to_house
    from markets.log
    where market_id = '019a6b3c-0001-7000-8000-000000000001' and action = 'settle'$$,
  $$values ('yes'::text, null::numeric, 'The test desk recorded event A at 17:05, India time.'::text,
            null::text, '00000000-0000-4000-8000-0000000000c1'::uuid, 0::numeric, 0,
            1000::numeric)$$,
  'the log shows who settled it, how, on what evidence, and what it paid: with no bets, the seed back to the house'
);
select is(
  markets.market_record('019a6b3c-0001-7000-8000-000000000001') ->> 'result',
  'yes',
  'it reads back as settled, with its result'
);
select is_empty('select problem from ledger.problems()', 'the books still have no problem');
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
      $q$select admin.settle_market('019a6b3c-0001-7000-8000-000000000001', 'no', null,
           'Evidence.', null)$q$)$$,
  '55000', 'Only a closed market is settled: this market is settled', 'a market is settled once'
);

-- A cancel, with its reason; a set probability ---------------------------------------------------------

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.create_market('019a6b3c-0002-7000-8000-000000000002',
         'Will test event B happen?', array['sports'], 'Rules.', 'Hrizzup''s test desk',
         'https://example.com/test-desk', now(), now() + interval '1 day', 0.5, 500)
         -> 'source'$q$)::jsonb,
  '{"name": "Hrizzup''s test desk", "url": "https://example.com/test-desk"}'::jsonb,
  'a market can name where anyone can check its source'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.open_market('019a6b3c-0002-7000-8000-000000000002') ->> 'held'$q$),
  '500.000000',
  'opened, it holds its seed'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.close_market('019a6b3c-0002-7000-8000-000000000002') ->> 'state'$q$),
  'closed',
  'and closes'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.settle_market('019a6b3c-0002-7000-8000-000000000002', 'cancel', null,
         'The test desk recorded nothing about event B.',
         'The test desk recorded nothing within a day of closing.') ->> 'state'$q$),
  'cancelled',
  'an admin cancels a market that can''t be settled fairly, giving the reason'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select (admin.create_market('019a6b3c-0003-7000-8000-000000000003',
                 'Will test event C happen?', array['crypto'], 'Rules.', 'Hrizzup''s test desk',
                 null, now(), now() + interval '1 day', 0.5, 250) ->> 'state')
         || ', ' || (admin.open_market('019a6b3c-0003-7000-8000-000000000003') ->> 'state')
         || ', ' || (admin.close_market('019a6b3c-0003-7000-8000-000000000003') ->> 'state')$q$),
  'draft, open, closed',
  'another market is made, opened and closed'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.settle_market('019a6b3c-0003-7000-8000-000000000003', 'probability', 0.7,
         'The rules settle a partial event at 70%.', null) ->> 'state'$q$),
  'settled',
  'an admin settles a market at a set probability'
);
select lives_ok('set constraints all immediate', 'the books and the market''s rules hold after both');
set constraints all deferred;
select results_eq(
  $$select d.cancel_reason::text, l.reason::text, m.state, m.resolution
    from markets.details d
    join markets.markets m on m.id = d.market_id
    join markets.log l on l.market_id = d.market_id and l.action = 'settle'
    where d.market_id = '019a6b3c-0002-7000-8000-000000000002'$$,
  $$values ('The test desk recorded nothing within a day of closing.'::text,
            'The test desk recorded nothing within a day of closing.'::text,
            'cancelled'::text, 'CANCEL'::text)$$,
  'a cancel''s reason is kept, with the market and in the log'
);
select is(
  markets.market_record('019a6b3c-0002-7000-8000-000000000002') ->> 'cancel_reason',
  'The test desk recorded nothing within a day of closing.',
  'it reads back as cancelled, with its reason'
);
select results_eq(
  $$select m.resolution, m.resolution_probability, l.probability
    from markets.markets m join markets.log l on l.market_id = m.id and l.action = 'settle'
    where m.id = '019a6b3c-0003-7000-8000-000000000003'$$,
  $$values ('MKT'::text, 0.7::numeric, 0.7::numeric)$$,
  'a set probability is kept, with the market and in the log'
);
select is(
  markets.market_record('019a6b3c-0003-7000-8000-000000000003'),
  null,
  'a market settled at a set probability has no market/1 record: the agreement''s market can''t say so'
);
select is_empty('select problem from ledger.problems()', 'the books still have no problem');

-- The log never changes -------------------------------------------------------------------------------

select throws_ok(
  $$update markets.log set evidence = 'Changed.'$$,
  '23001', 'The market log is never edited or deleted', 'a log line is never edited, even by the owner'
);
select throws_ok($$delete from markets.log$$, '23001', null, 'a log line is never deleted');
select throws_ok($$truncate markets.log$$, '23001', null, 'the log is never emptied');

-- Pages of markets ---------------------------------------------------------------------------------------

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select array_agg(x ->> 'id' order by n)
       from jsonb_array_elements(admin.markets(null, 100) -> 'markets') with ordinality as t (x, n)
       where x ->> 'id' like '019a6b3c-%'$q$),
  '{019a6b3c-0003-7000-8000-000000000003,019a6b3c-0002-7000-8000-000000000002,019a6b3c-0001-7000-8000-000000000001}',
  'markets come newest first'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.markets('019a6b3c-0003-7000-8000-000000000003', 1) -> 'markets' -> 0 ->> 'id'$q$),
  '019a6b3c-0002-7000-8000-000000000002',
  'the next page starts after the last market of the page before'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.markets('019a6b3c-0003-7000-8000-000000000003', 1) ->> 'next'$q$),
  '019a6b3c-0002-7000-8000-000000000002',
  'a page that isn''t the last says where the next starts'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.markets('019a6b3c-0002-7000-8000-000000000002', 5) ->> 'next'$q$),
  null,
  'the last page says there''s no more'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c1', 'select admin.markets(null, 0)')$$,
  '22023', 'A page holds 1 to 100 markets', 'a page holds 1 to 100 markets'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select jsonb_array_length(admin.market('019a6b3c-0001-7000-8000-000000000001') -> 'log')$q$),
  '4',
  'a market comes with its log: created, opened, closed, settled'
);
select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.market('019a6b3c-0001-7000-8000-000000000001') -> 'log' -> 3 -> 'by' ->> 'email'$q$),
  'ada@console.test',
  'each line names the admin by their account''s email'
);

-- A draft whose closing time has passed stays a draft ----------------------------------------------------

select is(
  pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
    $q$select admin.create_market('019a6b3c-0004-7000-8000-000000000004',
         'Will test event D happen?', array['general'], 'Rules.', 'Hrizzup''s test desk', null,
         now(), now() + interval '1 day', 0.5, 100) ->> 'state'$q$),
  'draft',
  'a fourth market, left a draft'
);
update markets.markets set closes_at = now() - interval '1 minute'
where id = '019a6b3c-0004-7000-8000-000000000004';
update markets.details set opens_at = now() - interval '2 minutes'
where market_id = '019a6b3c-0004-7000-8000-000000000004';
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
      $q$select admin.open_market('019a6b3c-0004-7000-8000-000000000004')$q$)$$,
  '55000', 'Its closing time has passed: make a new market instead',
  'a draft whose closing time has passed can''t open'
);

-- The rules across a market's details and its state, as the transaction commits -------------------------

update markets.details set opens_at = now() + interval '1 hour'
where market_id = '019a6b3c-0004-7000-8000-000000000004';
select throws_ok(
  'set constraints all immediate',
  '23514', 'Market 019a6b3c-0004-7000-8000-000000000004 would open after it closes',
  'a market opens no later than it closes'
);
update markets.details set opens_at = now() - interval '2 minutes'
where market_id = '019a6b3c-0004-7000-8000-000000000004';
update markets.details set cancel_reason = 'Not cancelled at all.'
where market_id = '019a6b3c-0004-7000-8000-000000000004';
select throws_ok(
  'set constraints all immediate',
  '23514', 'Market 019a6b3c-0004-7000-8000-000000000004 gives a cancel reason exactly when it''s cancelled',
  'a market gives a cancel reason only when it''s cancelled'
);
update markets.details set cancel_reason = null
where market_id = '019a6b3c-0004-7000-8000-000000000004';
select lives_ok('set constraints all immediate', 'with every rule kept again, it would commit');
set constraints all deferred;

-- A draft's pool, and every other state's ------------------------------------------------------------------

select throws_ok(
  $$insert into markets.markets (account_id, state, closes_at, p, pool_yes, pool_no, seed)
    values ((select ledger.house()), 'draft', now() + interval '1 day', 0.5, 100, 100, 100)$$,
  '23514', null, 'a draft''s pool holds nothing'
);
select throws_ok(
  $$insert into markets.markets (account_id, state, closes_at, p, pool_yes, pool_no, seed)
    values ((select ledger.house()), 'open', now() + interval '1 day', 0.5, 0, 0, 100)$$,
  '23514', null, 'an open market''s pool is never empty'
);

-- A multiple-choice market: held as data, never opened (the maths trades only yes or no) ---------------

with account as (insert into ledger.accounts (kind) values ('market') returning id)
insert into markets.markets (id, account_id, state, closes_at, p, pool_yes, pool_no, seed)
select '019a6b3c-0005-7000-8000-000000000005', account.id, 'draft', now() + interval '1 day', 0.5,
       0, 0, 100
from account;
insert into markets.details (market_id, question, categories, kind, outcomes, rules, source_name,
                             settlement, opens_at, created_by)
values ('019a6b3c-0005-7000-8000-000000000005', 'Which test outcome will the test feed report?',
        '{general}', 'multiple_choice',
        '[{"code": "outcome-a", "label": "Outcome A"}, {"code": "outcome-b", "label": "Outcome B"}]',
        'Rules.', 'Hrizzup''s test feed', 'automatic', now(), '00000000-0000-4000-8000-0000000000c1');
select lives_ok('set constraints all immediate', 'a multiple-choice market is held as a draft');
set constraints all deferred;
select is(
  markets.market_record('019a6b3c-0005-7000-8000-000000000005') -> 'outcomes',
  '[{"code": "outcome-a", "label": "Outcome A"}, {"code": "outcome-b", "label": "Outcome B"}]'::jsonb,
  'it reads back with its outcomes, in their order'
);
select throws_ok(
  $$select pg_temp.as_app('00000000-0000-4000-8000-0000000000c1',
      $q$select admin.open_market('019a6b3c-0005-7000-8000-000000000005')$q$)$$,
  '0A000', 'Only a yes-or-no market can open for now', 'it can''t open'
);
select throws_ok(
  $$update markets.details set outcomes = '[{"code": "outcome-a", "label": "Outcome A"}]'
    where market_id = '019a6b3c-0005-7000-8000-000000000005'$$,
  '23514', null, 'a multiple-choice market has 2 to 20 outcomes'
);
select throws_ok(
  $$update markets.details
    set outcomes = '[{"code": "a", "label": "A"}, {"code": "a", "label": "B"}]'
    where market_id = '019a6b3c-0005-7000-8000-000000000005'$$,
  '23514', null, 'each outcome''s code is its own'
);
select throws_ok(
  $$update markets.details
    set outcomes = '[{"code": "a", "label": "A"}, {"code": "b", "label": "B", "extra": 1}]'
    where market_id = '019a6b3c-0005-7000-8000-000000000005'$$,
  '23514', null, 'an outcome holds its code and label, and nothing else'
);
select throws_ok(
  $$update markets.details set kind = 'yes_no'
    where market_id = '019a6b3c-0005-7000-8000-000000000005'$$,
  '23514', null, 'only a multiple-choice market has outcomes'
);
update markets.markets set state = 'open', pool_yes = 100, pool_no = 100
where id = '019a6b3c-0005-7000-8000-000000000005';
select ok(
  ledger.post('seed', '019a6b3c-0005-7000-8000-000000000005', null, jsonb_build_array(
    jsonb_build_object('from', ledger.house(), 'amount', 100, 'to',
      (select account_id from markets.markets where id = '019a6b3c-0005-7000-8000-000000000005'))))
  is not null,
  'the owner opens it by hand, seeding it, so the books hold'
);
select throws_ok(
  'set constraints all immediate',
  '23514', 'Market 019a6b3c-0005-7000-8000-000000000005 isn''t yes-or-no, so it stays a draft',
  'still, it can''t leave draft, whoever opens it'
);

select * from finish();
rollback;
