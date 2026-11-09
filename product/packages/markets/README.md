# @hrizzup/markets

Markets as data, run by admins (PLAN.md step 1.7c; blueprint sections 5 and 13): the market console's calls. Server only. The typed API's console calls (`admin.markets.*`, `product/web/lib/api/router.ts`) and the console's pages (`product/web/app/console`) use it.

```ts
import { createMarket, settleMarket } from '@hrizzup/markets';

const draft = await createMarket(pool, admin.id, {
  id,
  question,
  categories,
  rules,
  source,
  opensAt,
  closesAt,
  probability: '0.5',
  seed: '1000',
});
const settled = await settleMarket(pool, admin.id, {
  id,
  outcome: 'yes',
  evidence: 'What the source said, and when.',
});
```

## What each call does

Each call is one transaction through `@hrizzup/db`, as the app's own role with the admin signed in, calling the database's own function in schema `admin` (`infra/supabase/migrations/*_market_console.sql`). Each of those checks the admins table before anything else and writes the market log, so the database refuses anyone but an admin, whatever the server code does.

| Call           | Does                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isAdmin`      | Whether the account is an admin (the console asks before it shows anything)                                                                                                                                              |
| `listMarkets`  | Markets, newest first (their IDs sort by when they were made), a page at a time                                                                                                                                          |
| `getMarket`    | One market, with its log                                                                                                                                                                                                 |
| `createMarket` | A yes-or-no market, as a draft holding no money; the caller chooses its ID (a version 7 UUID), so a retry gets back the same market                                                                                      |
| `openMarket`   | Betting starts at once; the house seeds the pool at the starting probability                                                                                                                                             |
| `closeMarket`  | Betting stops at once, after any trade in flight; the closing moment always comes after the last trade                                                                                                                   |
| `settleMarket` | From closed only, in one transaction with the ledger's `markets.settle`: Yes, No, a set probability (1% to 99%), or cancel with its reason, always with evidence; the log keeps what it paid, to people and to the house |

The answers are the contract's own types (`@hrizzup/api`). The database's refusals come back as a `ConsoleError`: `not_admin`, `not_found`, `conflict` (the market's state doesn't allow it) or `invalid`, each in words for people. `DatabaseBusyError` (from `@hrizzup/db`) means "try again".

## Checks

- **Quick checks** (`pnpm --filter @hrizzup/markets test`): the refusals become the console's own; each call sends the database what it was asked and reads the answer in the contract's shape.
- **The Database check** (`pnpm --filter @hrizzup/markets test:db`, which `pnpm test:db` includes), against a fresh database built from the migrations, through the app's own role, with real trades through the ledger's `trade()`:
  - everyone but an admin refused every call;
  - a market's whole life;
  - every settlement adding up to what the market held;
  - a cancel taking back a sale profit;
  - closing while trades are in flight;
  - two settlements at once settling once;
  - a retried create making one market;
  - paging.
- **On staging, on demand** (not part of the checks): `product/web/e2e/proofs/console-staging.spec.ts` drives the console in a browser as the admin test account. It creates, opens, closes and settles a test market, with one bet placed through the ledger in between, and checks the log and the payouts.
