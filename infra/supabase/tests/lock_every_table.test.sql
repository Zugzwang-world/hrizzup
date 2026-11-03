-- Tests for migrations/20261103120000_lock_every_table.sql, run by the "Database check"
-- on every pull request against a fresh database built from the migrations. Everything
-- runs in a transaction that is rolled back, so nothing is left behind.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(7);

select ok(
  exists (
    select 1 from pg_catalog.pg_event_trigger
    where evtname = 'lock_new_tables' and evtenabled = 'O'
  ),
  'the safeguard that locks new tables is installed and on'
);

create table public.lock_test_a (id int primary key);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.lock_test_a'::regclass),
  'CREATE TABLE in public: row-level security is on'
);

create schema lock_test;
create table lock_test.b as select 1 as x;
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'lock_test.b'::regclass),
  'CREATE TABLE AS in a new schema: row-level security is on'
);

select 1 as y into lock_test.c;
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'lock_test.c'::regclass),
  'SELECT INTO: row-level security is on'
);

create table lock_test.parent (id int) partition by range (id);
create table lock_test.child partition of lock_test.parent for values from (0) to (10);
select ok(
  (select bool_and(relrowsecurity) from pg_catalog.pg_class
   where oid in ('lock_test.parent'::regclass, 'lock_test.child'::regclass)),
  'a partitioned table and its partitions: row-level security is on'
);

select throws_like(
  'alter table public.lock_test_a disable row level security',
  '%must stay on%',
  'switching row-level security off is refused'
);

select is_empty(
  'select table_name from private.unprotected_tables()',
  'no table of ours is without row-level security'
);

select * from finish();
rollback;
