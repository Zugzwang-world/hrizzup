# @hrizzup/markets

Markets as data (PLAN.md steps 1.7c and 1.7d; blueprint sections 5 and 13): the market console's calls, for admins, and the markets' calls for everyone (the list, trading, cancelling an order, positions and open orders). Server only. The typed API (`product/web/lib/api/router.ts`: `admin.markets.*`, `markets.*` and `portfolio.*`) and the console's pages (`product/web/app/console`) use it.

```ts
import { createMarket, placeTrade, settleMarket } from '@hrizzup/markets';

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
const bought = await placeTrade(pool, person.id, {
  marketId: draft.id,
  requestId, // chosen by the sender; a retry sends the same one
  action: 'buy',
  outcome: 'yes',
  amount: '25',
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

## The markets for everyone (step 1.7d)

`src/trading.ts`. Each read is one transaction through `@hrizzup/db`, as the app's own role, calling the database's own reads in schema `trading` (`infra/supabase/migrations/*_trading_reads.sql`); a trade runs through the ledger's `trade()` (`@hrizzup/ledger`), one transaction under its market's lock.

| Call          | Who                                                                          | Does                                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketList`  | anyone (read with nobody signed in, so the answer can be shared at the edge) | The markets anyone may see, newest first, 50 a page, each the agreement's `market/1` record with the probability its pool shows; never a draft                                      |
| `placeTrade`  | the signed-in person                                                         | A buy (now, or a limit order that rests until a later trade reaches its price, with an optional expiry) or a sale, with the sender's request ID: a retry answers what the first did |
| `cancelOrder` | the signed-in person                                                         | Withdraws one of their resting limit orders; no money moves                                                                                                                         |
| `positions`   | the signed-in person                                                         | Their balance and their positions in markets still open or waiting to be settled, newest market first, 50 a page                                                                    |
| `openOrders`  | the signed-in person                                                         | Their resting limit orders, newest first, 50 a page                                                                                                                                 |

**Refused before the books are touched.** The typed API's contract refuses a limit outside 1% to 99%, an expiry that isn't in the future (zero included) and an amount or shares that aren't more than zero before the call runs. Then `placeTrade` reads the person's holdings (`trading.holdings`: their balance and shares, the market's state and closing time) and refuses a market that isn't open or whose closing time has passed, an amount over the balance, or shares over those held (`refusalBefore`), with no lock taken and nothing written. The ledger checks all of it again under the market's lock, so a balance spent in the meantime is still refused there, stored under the request's ID as the books keep every answer.

Refusals come back as a `TradingError`: `not_found` (no such market, or a draft, which only admins see), `conflict` (a request ID already used for a different request), `invalid` (such as an expiry the database's clock has already passed, or a page cursor that isn't the person's) or `refused`, with the books' reason (`market_not_open`, `market_closed`, `insufficient_balance`, `not_enough_shares`, `price_limit`, `no_open_order`). `DatabaseBusyError` (from `@hrizzup/db`) means "try again". The website adds each person's trades a minute and clears the list's edge copies when a market changes (`product/web/lib/api/rate-limit.ts`, `edge-cache.ts`).

## Checks

- **Quick checks** (`pnpm --filter @hrizzup/markets test`): the refusals become the console's own; each call sends the database what it was asked and reads the answer in the contract's shape.
- **Quick checks** also hold the trade call's checks before the books, and its failures as `TradingError`s (`src/trading.test.ts`).
- **The Database check** (`pnpm --filter @hrizzup/markets test:db`, which `pnpm test:db` includes), against a fresh database built from the migrations, through the app's own role, with real trades through the ledger's `trade()`:
  - for everyone (`src/trading.db.test.ts`): the list (never a draft, a trade's new price, a settled market's result, paging); buying, a retry answering the same, selling; a limit order resting, among the open orders, then cancelled; someone else's order never cancelled; a request ID reused for something else refused; every refusal before the books with nothing written (an amount over the balance, shares over those held, no play money yet, a closed market, a draft, no market, a closing time passed); the books refusing a second buy the balance no longer covers, and an expiry the database's clock has passed; positions and open orders, the person's own only; the books without a problem;
  - for the console (`src/console.db.test.ts`): everyone but an admin refused every call; a market's whole life; every settlement adding up to what the market held; a cancel taking back a sale profit; closing while trades are in flight; two settlements at once settling once; a retried create making one market; paging.
- **On staging, on demand** (not part of the checks): `product/web/e2e/proofs/console-staging.spec.ts` drives the console in a browser as the admin test account. It creates, opens, closes and settles a test market, with one bet placed through the ledger in between, and checks the log and the payouts.
