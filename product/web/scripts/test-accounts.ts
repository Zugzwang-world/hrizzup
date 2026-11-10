/**
 * Confirms the market console's admin test account on staging, the one account check runs share
 * (its admin row comes from the reviewed migration naming its ID,
 * infra/supabase/migrations/*_staging_admins.sql), and prints its email and ID only. Every other
 * account a check uses, each run makes for itself (e2e/support/run.ts). Run with staging's keys:
 *
 *   infra/doppler/run stg -- pnpm --filter @hrizzup/web test-accounts
 */
import {
  ADMIN_TEST_ACCOUNT,
  ensureTestAccount,
  stagingKeys,
} from '../e2e/support/test-accounts.ts';

const keys = stagingKeys();
if (!keys) {
  console.error(
    'SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are needed (staging)',
  );
  process.exit(1);
}
const id = await ensureTestAccount(keys, ADMIN_TEST_ACCOUNT);
console.log(`The console's admin test account: ${ADMIN_TEST_ACCOUNT} (${id}), a test account`);
