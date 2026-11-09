import pg from 'pg';
import projects from '../../../../infra/supabase/project/settings.json' with { type: 'json' };
import { databaseAddress } from '../../lib/db.ts';
import { SUPABASE_ROOT_CA } from '../../lib/supabase-ca.ts';

/**
 * Play money for the checks' test accounts (support/test-accounts.ts), so the trading journeys can
 * trade on staging's database, which previews share (PLAN.md step 1.7d). Until signup gives everyone a
 * starting balance (step 3.1), only the books' owner can give play money (`ledger.open_account`,
 * `ledger.grant_money`, from the house account), so this reaches staging's database as its owner,
 * through the same address and password the preview uses (Doppler `stg_preview`, or `dev` on this
 * Mac), for test data only: changing test data in staging is fine (CLAUDE.md, "Database changes").
 * It refuses any database but staging's, and gives money only to accounts the checks own.
 */

/** What each test account is topped up to, from the house, when it runs low. */
export const TEST_MONEY = '10000';
/** Below this, it's topped up again. */
const LOW = '1000';

const STAGING_POOLER_USER = `postgres.${projects.environments.staging.project_ref}`;

/** Staging's database as its owner, or null where no database is set up here. */
function stagingOwner(env = process.env): pg.Pool | null {
  const address = databaseAddress(env);
  if (!address) return null;
  if (decodeURIComponent(new URL(address).username) !== STAGING_POOLER_USER) {
    throw new Error(
      "Play money for test accounts goes only to staging's database; refusing another",
    );
  }
  const pool = new pg.Pool({
    connectionString: address,
    ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
    max: 1,
    application_name: 'hrizzup-checks',
  });
  pool.on('error', () => {});
  return pool;
}

/**
 * Gives each of these test accounts (by their sign-in emails, which must already exist) play money:
 * a starting balance of Ṁ10,000 the first time, and a top-up back to it whenever it falls below
 * Ṁ1,000. Every grant comes from the house account, as two matching lines in the books. Does nothing
 * where no database is set up here (the journeys that need the money say so).
 */
export async function ensurePlayMoney(emails: readonly string[]): Promise<void> {
  const db = stagingOwner();
  if (!db) return;
  try {
    for (const email of emails) {
      if (!/^delivered\+[a-z0-9-]+@resend\.dev$/.test(email)) {
        throw new Error("Only the checks' own test accounts get play money");
      }
      await db.query(
        `select ledger.open_account(u.id, $2)
         from auth.users u
         where u.email = $1
           and not exists (
             select 1 from ledger.accounts a where a.kind = 'person' and a.user_id = u.id)`,
        [email, TEST_MONEY],
      );
      await db.query(
        `select ledger.grant_money(a.id, $2::numeric - a.balance,
                                   'Play money for the checks'' test account')
         from ledger.accounts a
         join auth.users u on u.id = a.user_id
         where a.kind = 'person' and u.email = $1 and a.balance < $3::numeric`,
        [email, TEST_MONEY, LOW],
      );
    }
  } finally {
    await db.end();
  }
}
