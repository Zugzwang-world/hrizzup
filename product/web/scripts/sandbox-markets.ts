/**
 * Makes the markets sandbox's few listed test markets on staging (/sandbox; R1 of Round 5), with
 * neutral placeholder questions, through the console's own calls as the console's admin test account.
 * Each has a fixed ID, so running it again finds the markets it made and changes nothing. The first
 * closes within a day, so it can be settled in the console after it is closed. Run with staging's
 * keys, against a website that uses staging's database (staging's own address, a preview, or this
 * Mac's):
 *
 *   infra/doppler/run stg -- pnpm --filter @hrizzup/web sandbox-markets https://… (or http://localhost:3101)
 */
import { ensureFixtureMarket, type FixtureMarket } from '../e2e/support/fixture-markets.ts';
import {
  ADMIN_TEST_ACCOUNT,
  stagingKeys,
  testSessionCookies,
} from '../e2e/support/test-accounts.ts';

const address = process.argv[2];
const keys = stagingKeys();
if (!address || !keys) {
  console.error(
    'Give the website to use as the first argument, and run with staging keys (infra/doppler/run stg).',
  );
  process.exit(1);
}

const RULES =
  'A placeholder test market on staging, made to try the markets sandbox with play money.\n' +
  'The admin settles it by hand in the console: Yes, No, a set probability, or cancelled.';

/**
 * `closesInDays` is a fraction of a day for the one that closes soon. The IDs are fixed and begin
 * with the time this was written (10 November 2026), so the list, which is newest first by ID, shows
 * them above every older market, as any market the console makes later will show above them.
 */
const markets: FixtureMarket[] = [
  {
    id: '01a1c630-0c00-7000-8000-000000000104',
    question: 'Will the first placeholder event happen today? (closes within a day)',
    rules: RULES,
    listed: true,
    closesInDays: 0.5,
    leftIn: ['open', 'closed', 'settled'],
  },
  {
    id: '01a1c630-0c00-7000-8000-000000000103',
    question: 'Will the second placeholder event happen this month?',
    rules: RULES,
    listed: true,
    closesInDays: 30,
    leftIn: ['open', 'closed', 'settled'],
  },
  {
    id: '01a1c630-0c00-7000-8000-000000000102',
    question: 'Will the third placeholder event happen this year?',
    rules: RULES,
    listed: true,
    closesInDays: 200,
    leftIn: ['open', 'closed', 'settled'],
  },
  {
    id: '01a1c630-0c00-7000-8000-000000000101',
    question: 'Will the fourth placeholder event happen by next year?',
    rules: RULES,
    listed: true,
    closesInDays: 365,
    leftIn: ['open', 'closed', 'settled'],
  },
];

const cookies = await testSessionCookies(keys, ADMIN_TEST_ACCOUNT);
const headers = { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; ') };
for (const market of markets) {
  await ensureFixtureMarket(address, headers, market);
  console.log(`Ready: ${market.question}`);
}
