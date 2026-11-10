-- Tests for migrations/*_starting_balance.sql (play money on signup; PLAN.md section 2, "Play
-- money"), run by the Database check against a fresh database built from the migrations. Rolled
-- back, so nothing is left behind. A sign-up made by Supabase Auth's own role, and sign-ups and
-- calls at the same moment, are tested in product/packages/ledger (src/signup.db.test.ts).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(42);

-- How much, and who may give it ---------------------------------------------------------------------

select is(
  ledger.starting_balance(),
  1000.000000::numeric,
  'the starting balance is Ṁ1,000, Manifold''s default, in exact decimals'
);
select is(
  pg_catalog.pg_get_function_result('ledger.starting_balance()'::regprocedure),
  'numeric',
  '... an exact decimal, never floating point'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'ledger.starting_balances'::regclass),
  'who has had a starting balance is locked like every table'
);
select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role', 'hrizzup_app']) as r (role)
    where pg_catalog.has_table_privilege(r.role, 'ledger.starting_balances',
                                         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
  ),
  '... and no role the app or Supabase uses can read or write it'
);
select ok(
  not exists (
    select 1
    from unnest(array['ledger.give_starting_balance(uuid)',
                      'ledger.give_missing_starting_balances()',
                      'ledger.open_account(uuid,numeric)',
                      'ledger.on_new_sign_in_account()']) as f (fn),
         unnest(array['anon', 'authenticated', 'service_role', 'hrizzup_app']) as r (role)
    where pg_catalog.has_function_privilege(r.role, f.fn, 'EXECUTE')
  ),
  'only the books'' owner can give play money: no role the app or Supabase uses may call it'
);
select is(
  (select array[t.tgenabled::text,
                (t.tgtype & 1 = 1)::text,       -- for each row
                (t.tgtype & 2 = 0)::text,       -- after
                (t.tgtype & 4 = 4)::text,       -- on insert
                t.tgdeferrable::text,
                p.prosecdef::text]
   from pg_catalog.pg_trigger t
   join pg_catalog.pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'auth.users'::regclass and t.tgname = 'hrizzup_starting_balance'),
  array['O', 'true', 'true', 'true', 'false', 'true'],
  'every new sign-in account fires the starting balance: after each insert, never put off to the end of the transaction, as the books'' owner'
);

-- At signup ---------------------------------------------------------------------------------------

select ledger.house();  -- made the first time it's needed
create temporary table house_before on commit drop as
select id, balance from ledger.accounts where kind = 'house';

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'ann@start.test');

create temporary table ann on commit drop as
select a.id from ledger.accounts a
where a.kind = 'person' and a.user_id = '00000000-0000-4000-8000-0000000000f1';

select is(
  (select count(*)::int from ann),
  1,
  'signing up opens the person''s play-money account'
);
select is(
  (select balance from ledger.accounts where id = (select id from ann)),
  1000.000000::numeric,
  '... holding the starting balance'
);
select is(
  (select balance from ledger.accounts where kind = 'house') - (select balance from house_before),
  -1000.000000::numeric,
  '... which comes from the house, exactly'
);
select is(
  (select array_agg(row(e.kind, e.memo, m.from_account = (select id from house_before), m.amount)::text)
   from ledger.moves m join ledger.entries e on e.id = m.entry_id
   where m.to_account = (select id from ann) or m.from_account = (select id from ann)),
  array[row('grant', 'Starting balance', true, 1000.000000::numeric)::text],
  '... as one grant: one move, out of the house and into the person''s account'
);
select is(
  (select row(s.amount, s.entry_id = (select m.entry_id from ledger.moves m
                                      where m.to_account = (select id from ann)))::text
   from ledger.starting_balances s where s.account_id = (select id from ann)),
  row(1000.000000::numeric, true)::text,
  '... recorded as the person''s starting balance, by that entry'
);
select is_empty('select problem from ledger.problems()', 'the books have no problem');
select is((select sum(amount) from ledger.lines), 0::numeric, 'the books'' lines sum to zero');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f2', 'raj@start.test'),
  ('00000000-0000-4000-8000-0000000000f3', 'sam@start.test'),
  ('00000000-0000-4000-8000-0000000000f4', 'tia@start.test');
select is(
  (select array_agg(a.balance order by u.email)
   from auth.users u
   join ledger.accounts a on a.kind = 'person' and a.user_id = u.id
   join ledger.starting_balances s on s.account_id = a.id
   where u.email in ('raj@start.test', 'sam@start.test', 'tia@start.test')),
  array[1000.000000, 1000.000000, 1000.000000]::numeric[],
  'several accounts made at once each get their own starting balance'
);

-- Never twice ------------------------------------------------------------------------------------

select is(
  ledger.give_starting_balance('00000000-0000-4000-8000-0000000000f1'),
  (select id from ann),
  'giving it again finds the same account'
);
select is(
  (select row(a.balance, (select count(*) from ledger.starting_balances s where s.account_id = a.id),
              (select count(*) from ledger.moves m where m.to_account = a.id))::text
   from ledger.accounts a where a.id = (select id from ann)),
  row(1000.000000::numeric, 1, 1)::text,
  '... and gives nothing more'
);
select lives_ok(
  $$select ledger.correct((select id from ann), ledger.house(), 1000, 'Ann spends it all (a test)')$$,
  'once the person has spent it all'
);
select is(
  ledger.give_missing_starting_balances(),
  0,
  '... nobody is missing a starting balance'
);
select lives_ok(
  $$select ledger.give_starting_balance('00000000-0000-4000-8000-0000000000f1')$$,
  '... and giving it again'
);
select is(
  (select balance from ledger.accounts where id = (select id from ann)),
  0.000000::numeric,
  '... still gives nothing: a starting balance comes once'
);
select throws_ok(
  $$insert into ledger.starting_balances (account_id, entry_id, amount)
    values ((select id from ann), (select max(id) from ledger.entries), 1)$$,
  '23505', null, 'even the owner can''t record a second starting balance for an account'
);
select throws_ok(
  'update ledger.starting_balances set amount = amount + 1',
  '23001', null, 'a starting balance is never edited'
);
select throws_ok('delete from ledger.starting_balances', '23001', null, '... nor deleted');
select throws_ok('truncate ledger.starting_balances', '23001', null, '... nor emptied');
select throws_ok(
  $$select ledger.give_starting_balance(null)$$,
  '22023', null, 'a starting balance goes to a sign-in account'
);

-- No account without it ---------------------------------------------------------------------------

-- If the starting balance can't be given, the sign-up fails too, and leaves nothing behind.
alter table ledger.starting_balances
  add constraint refuse_every_new_row_for_this_test check (amount < 0) not valid;
select throws_ok(
  $$insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f5', 'uma@start.test')$$,
  '23514', null, 'a sign-up whose starting balance can''t be given fails'
);
alter table ledger.starting_balances drop constraint refuse_every_new_row_for_this_test;
select is(
  (select count(*)::int from auth.users where id = '00000000-0000-4000-8000-0000000000f5')
  + (select count(*)::int from ledger.accounts where user_id = '00000000-0000-4000-8000-0000000000f5'),
  0,
  '... leaving no sign-in account and no play-money account'
);
select is_empty('select problem from ledger.problems()', 'the books still have no problem');

-- Accounts made before the starting balance: the migration's own once-only pass -------------------

-- The past, for a moment: sign-ups that gave nothing (as before this migration). One person had
-- no play money at all; another had an account the old way, with play money from the house.
create temporary table signup_function on commit drop as
select pg_catalog.pg_get_functiondef('ledger.on_new_sign_in_account()'::regprocedure) as definition;
create or replace function ledger.on_new_sign_in_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$ begin return null; end; $$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f6', 'old@start.test'),
  ('00000000-0000-4000-8000-0000000000f7', 'older@start.test');
with opened as (
  insert into ledger.accounts (kind, user_id)
  values ('person', '00000000-0000-4000-8000-0000000000f7')
  returning id
)
select ledger.post('grant', null, 'Starting balance',
  jsonb_build_array(jsonb_build_object('from', ledger.house(), 'to', id, 'amount', '10000')))
from opened;

do $$ begin execute (select definition from signup_function); end; $$;
select is(
  pg_catalog.pg_get_functiondef('ledger.on_new_sign_in_account()'::regprocedure),
  (select definition from signup_function),
  '(the sign-up''s own function is back as the migration made it)'
);

select bag_eq(
  'select problem from ledger.problems()',
  $$values
    ('Sign-in account 00000000-0000-4000-8000-0000000000f6 has no play-money account'),
    (format('Person %s has no starting balance',
            (select id from ledger.accounts where user_id = '00000000-0000-4000-8000-0000000000f7')))$$,
  'the books'' own check finds an account without play money, and a person without a starting balance'
);
select is(
  ledger.give_missing_starting_balances(),
  2,
  'the once-only pass gives both their starting balance'
);
select is(
  (select array_agg(a.balance order by u.email)
   from auth.users u join ledger.accounts a on a.kind = 'person' and a.user_id = u.id
   where u.email in ('old@start.test', 'older@start.test')),
  array[1000.000000, 11000.000000]::numeric[],
  '... Ṁ1,000 each, on top of whatever play money they had'
);
select is(
  (select count(*)::int from ledger.starting_balances s
   join ledger.accounts a on a.id = s.account_id
   where a.user_id in ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000f7')),
  2,
  '... each recorded once'
);
select is(ledger.give_missing_starting_balances(), 0, 'a second pass gives nobody anything');
select is_empty('select problem from ledger.problems()', 'and the books have no problem');

-- The books' own check knows a starting balance must be exactly its entry -----------------------------

alter table ledger.starting_balances disable trigger starting_balances_never_change;
update ledger.starting_balances set amount = amount + 1 where account_id = (select id from ann);
alter table ledger.starting_balances enable trigger starting_balances_never_change;
select is(
  (select array_agg(problem) from ledger.problems()),
  array[format('The starting balance of %s is not the entry %s says it is',
               (select id from ann),
               (select entry_id from ledger.starting_balances where account_id = (select id from ann)))],
  'a starting balance that isn''t its entry is a problem the books report'
);
alter table ledger.starting_balances disable trigger starting_balances_never_change;
update ledger.starting_balances set amount = amount - 1 where account_id = (select id from ann);
alter table ledger.starting_balances enable trigger starting_balances_never_change;
select is_empty('select problem from ledger.problems()', '(put back)');

-- The owner's tool for tests and scripts ---------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f8', 'low@start.test'),
  ('00000000-0000-4000-8000-0000000000f9', 'high@start.test'),
  ('00000000-0000-4000-8000-0000000000fa', 'same@start.test');
create temporary table tool on commit drop as
select ledger.open_account('00000000-0000-4000-8000-0000000000f8', 250.5) as low,
       ledger.open_account('00000000-0000-4000-8000-0000000000f9', 2500) as high,
       ledger.open_account('00000000-0000-4000-8000-0000000000fa', 1000) as same;
select is(
  array[(select balance from ledger.accounts where id = (select low from tool)),
        (select balance from ledger.accounts where id = (select high from tool)),
        (select balance from ledger.accounts where id = (select same from tool))],
  array[250.500000, 2500.000000, 1000.000000]::numeric[],
  'the owner''s tool gives a test person exactly the play money asked for'
);
select is(
  (select array_agg(row(e.kind, m.amount)::text order by m.id)
   from ledger.moves m join ledger.entries e on e.id = m.entry_id
   join ledger.accounts a on a.id in (m.from_account, m.to_account)
   where a.user_id = '00000000-0000-4000-8000-0000000000f8'),
  array[row('grant', 1000.000000::numeric)::text, row('correction', 749.500000::numeric)::text],
  '... after the starting balance, by a correction back to the house (or a grant from it)'
);
select throws_ok(
  $$select ledger.open_account('00000000-0000-4000-8000-0000000000f8', 100)$$,
  '23505', null, '... and opens an account only once'
);
select throws_ok(
  $$select ledger.open_account('00000000-0000-4000-8000-0000000000fa', -1)$$,
  '22023', null, '... with zero or more'
);
select is_empty('select problem from ledger.problems()', 'the books end with no problem');

select * from finish();
rollback;
