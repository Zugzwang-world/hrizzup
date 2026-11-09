-- Staging's admins (PLAN.md step 1.7c; the founder's decisions of 9 November 2026; CLAUDE.md,
-- "The admins table"). A reviewed migration naming each account by its ID, as the admins table
-- requires.
--
-- Every migration also runs on production, so each row is added only where its account exists:
-- neither account exists on production, nor in the throwaway database the Database check builds,
-- so there this changes nothing. Production's admin comes after the founder's first sign-in there
-- (runbook, pre-launch checklist, P.16).
--
--   d4ea0acb-ae92-41ea-a1df-2ecc69411c2d  the founder's account on staging: his Google sign-in on
--     staging's sign-in test page on 3 November 2026 (runbook step 9.6, docs/setup.md), the one
--     account on staging that isn't a test account, with a Google identity and nothing else.
--   d0606352-12bf-4f3c-bcc7-9fbbce431a3a  the market console's test account on staging,
--     delivered+market-admin@resend.dev: marked as a test account, with no password and no Google
--     identity, so only a check holding staging's server key can sign in to it
--     (product/web/e2e/support/test-accounts.ts). The console's journeys sign in with it.

insert into private.admins (user_id, note)
select account.id, chosen.note
from (values
  ('d4ea0acb-ae92-41ea-a1df-2ecc69411c2d'::uuid,
   'The founder''s account on staging (Google)'),
  ('d0606352-12bf-4f3c-bcc7-9fbbce431a3a'::uuid,
   'The market console''s test account on staging (delivered+market-admin@resend.dev)')
) as chosen (id, note)
join auth.users account on account.id = chosen.id
on conflict (user_id) do nothing;
