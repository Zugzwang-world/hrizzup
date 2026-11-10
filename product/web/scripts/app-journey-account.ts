/**
 * The app's signed-in journey's own account (PLAN.md step 1.6b; each check run on its own,
 * e2e/support/run.ts): App journeys signs the app in with a code typed into it, as a person
 * does, but the code never comes by email. Staging only (stagingKeys() refuses any other
 * project), with staging's server key, which only this command is given (product/app/journeys/
 * run.sh asks Doppler for it by name); the app itself holds no secret.
 *
 *   node scripts/app-journey-account.ts create          makes the run's fresh account; prints its address
 *   node scripts/app-journey-account.ts code <address>  prints a working sign-in code for it
 *
 * The code is made with staging's admin access, which sends no email (Resend's test inbox would
 * drop one anyway), so the journey spends none of staging's 30 emails an hour. Asking for a new
 * code cancels the last, so run.sh asks just before each screen size's journeys. The account is
 * kept, like every run's: the books keep their history.
 */
import { RUN_PREFIX, runKey } from '../e2e/support/run.ts';
import { createRunAccount, readSignInCode, stagingKeys } from '../e2e/support/test-accounts.ts';

const [command, address] = process.argv.slice(2);
const keys = stagingKeys();
if (!keys) {
  console.error(
    'SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are needed (staging)',
  );
  process.exit(1);
}

if (command === 'create') {
  // The run's own address, as every run account's is: what it's for, then the device.
  const email = `${RUN_PREFIX}${runKey()}-app-android@resend.dev`;
  await createRunAccount(keys, email);
  console.log(email);
} else if (
  command === 'code' &&
  address?.startsWith(RUN_PREFIX) &&
  address.endsWith('@resend.dev')
) {
  console.log(await readSignInCode(keys, address));
} else {
  console.error(
    'Usage: node scripts/app-journey-account.ts create | code <a run account’s address>',
  );
  process.exit(2);
}
