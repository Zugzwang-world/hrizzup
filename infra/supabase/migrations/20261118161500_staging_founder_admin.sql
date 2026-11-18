-- The founder's second account on staging becomes an admin (PLAN.md step 1.7c; the founder,
-- 18 November 2026; CLAUDE.md, "The admins table"). A reviewed migration naming the account by its
-- ID, in the same shape as 20261109153044_staging_admins.sql.
--
-- Every migration also runs on production, so the row is added only where the account exists: it
-- doesn't exist on production, nor in the throwaway database the Database check builds, so there
-- this changes nothing. Production's admin comes after the founder's first sign-in there (runbook,
-- pre-launch checklist, P.16).
--
--   6364fd12-782c-49ef-bbe4-d1e6dd1350bf  the founder's account on staging that he signs in with
--     now: a Google sign-in made on 9 November 2026, after 20261109153044_staging_admins.sql was
--     written, with a Google identity and nothing else, and not a test account. Checked on
--     18 November 2026 with read-only queries on staging's database: besides the check runs'
--     accounts, staging has only this account and the founder's 3 November one
--     (d4ea0acb-ae92-41ea-a1df-2ecc69411c2d), which stays an admin.

insert into private.admins (user_id, note)
select account.id, chosen.note
from (values
  ('6364fd12-782c-49ef-bbe4-d1e6dd1350bf'::uuid,
   'The founder''s second account on staging (Google, 9 November 2026)')
) as chosen (id, note)
join auth.users account on account.id = chosen.id
on conflict (user_id) do nothing;
