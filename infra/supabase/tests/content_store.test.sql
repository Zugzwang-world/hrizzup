-- Tests for migrations/20261109115247_content_store.sql, run by the "Database check" on every pull
-- request against a fresh database built from the migrations: the content store's tables exist,
-- each locked like every table, with no policy and no right for any role but their owner, so
-- nothing but a migration can write to them, read them or fill them yet (PLAN.md step 1.9). The
-- agreement's records and rules are tested in tests/agreement/. Rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(8);

select tables_are(
  'content',
  array['stories', 'updates', 'sourced_items', 'creations'],
  'the content store has its four tables, one for each shape it holds'
);

select is_empty(
  $$ select format('%I.%I', schemaname, tablename) from pg_catalog.pg_tables
     where schemaname in ('content', 'agreement') and not rowsecurity $$,
  'each is locked: row-level security is on'
);

select is_empty(
  $$ select format('%s on %I.%I', policyname, schemaname, tablename) from pg_catalog.pg_policies
     where schemaname in ('content', 'agreement') $$,
  'no policy opens any of them'
);

select is_empty(
  $$ select format('%s: %s on %s', a.grantee::regrole, a.privilege_type, c.oid::regclass)
     from pg_catalog.pg_class c
     cross join lateral aclexplode(c.relacl) a
     where c.relnamespace in ('content'::regnamespace, 'agreement'::regnamespace)
       and a.grantee <> c.relowner $$,
  'no role but their owner has any right on them (anon, authenticated and service_role included)'
);

select is_empty(
  $$ select format('%s: %s on schema %I', a.grantee::regrole, a.privilege_type, n.nspname)
     from pg_catalog.pg_namespace n
     cross join lateral aclexplode(n.nspacl) a
     where n.nspname in ('content', 'agreement') and a.grantee <> n.nspowner $$,
  'no role but their owner can reach the schemas content and agreement'
);

select is_empty(
  $$ select format('%s: %s on %s.%s', a.grantee::regrole, a.privilege_type, c.oid::regclass, att.attname)
     from pg_catalog.pg_class c
     join pg_catalog.pg_attribute att on att.attrelid = c.oid
     cross join lateral aclexplode(att.attacl) a
     where c.relnamespace in ('content'::regnamespace, 'agreement'::regnamespace) $$,
  'no role has a right on any of their columns either'
);

-- The functions that hold its rules (the triggers' and the one that raises a refusal) run only
-- for their owner. The pure helpers its checks and indexes call (agreement.is_list(), the post's
-- number, the checks on plain text) stay callable by anyone, as every check constraint's function
-- must be for whoever writes the table one day; they read nothing and change nothing.
select is_empty(
  $$ select format('%s: %s on %s', a.grantee::regrole, a.privilege_type, p.oid::regprocedure)
     from pg_catalog.pg_proc p
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'content'::regnamespace
       and (p.prorettype = 'trigger'::regtype or p.proname = 'refuse')
       and a.grantee <> p.proowner $$,
  'no role but their owner can run the functions that hold its rules'
);

select set_eq(
  $$ select p.oid::regprocedure::text
     from pg_catalog.pg_proc p
     where p.pronamespace in ('content'::regnamespace, 'agreement'::regnamespace)
       and p.prorettype <> 'trigger'::regtype
       and p.proname <> 'refuse' $$,
  array[
    'agreement.is_list(anyarray,integer)',
    'agreement.is_id_list(uuid[],integer)',
    'agreement.passes_code_checks(text)',
    'content.post_number(text)'
  ],
  'the only other functions are the pure helpers its checks and indexes call'
);

select * from finish();
rollback;
