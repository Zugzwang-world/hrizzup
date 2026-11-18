-- Tests for migrations/*_staging_founder_admin.sql (PLAN.md step 1.7c), run by the Database check
-- against a fresh database built from the migrations, in which the account it names doesn't exist,
-- as on production. Rolled back, so nothing is left behind.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(2);

select is_empty(
  $$select user_id from private.admins
    where user_id in ('6364fd12-782c-49ef-bbe4-d1e6dd1350bf')$$,
  'where the account it names doesn''t exist (production, a fresh database), it made nobody an admin'
);
select is_empty(
  $$select id from auth.users
    where id in ('6364fd12-782c-49ef-bbe4-d1e6dd1350bf')$$,
  '... and made no account either'
);

select * from finish();
rollback;
