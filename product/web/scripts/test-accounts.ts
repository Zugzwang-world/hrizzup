/**
 * Creates (or confirms) the screen checks' test accounts on staging, and prints their
 * emails and IDs only. Run with staging's keys:
 *
 *   doppler run --config stg -- pnpm --filter @hrizzup/web test-accounts
 */
import { ensureTestAccount, stagingKeys, TEST_ACCOUNTS } from '../e2e/support/test-accounts.ts';

const keys = stagingKeys();
if (!keys) {
  console.error(
    'SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are needed (staging)',
  );
  process.exit(1);
}
for (const [engine, email] of Object.entries(TEST_ACCOUNTS)) {
  const id = await ensureTestAccount(keys, email);
  console.log(`${engine}: ${email} (${id}), marked as a test account`);
}
