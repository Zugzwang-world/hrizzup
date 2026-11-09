-- Tests for migrations/*_staging_admins.sql (PLAN.md step 1.7c), run by the Database check against
-- a fresh database built from the migrations, in which neither of the accounts it names exists,
-- as on production. Rolled back, so nothing is left behind.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(2);

select is_empty(
  'select user_id from private.admins',
  'where the accounts it names don''t exist (production, a fresh database), it made nobody an admin'
);
select is_empty(
  $$select id from auth.users
    where id in ('d4ea0acb-ae92-41ea-a1df-2ecc69411c2d', 'd0606352-12bf-4f3c-bcc7-9fbbce431a3a')$$,
  '... and made no account either'
);

select * from finish();
rollback;
