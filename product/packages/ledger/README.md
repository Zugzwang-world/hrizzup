# @hrizzup/ledger

The markets' books (PLAN.md step 1.7b; blueprint section 5, "The markets' books"): play-money trades, each one database transaction, running Manifold's maths (`@hrizzup/market-engine`) on the market as it stands and writing the result into double-entry books in exact decimals. Server only. The typed API's trade call (step 1.7d) calls `trade()`; nothing calls it yet.

```ts
import { trade } from '@hrizzup/ledger';

const result = await trade(pool, user.id, {
  action: 'buy', // or 'sell', or 'cancel_order'
  requestId, // chosen by the sender; a retry sends the same one
  marketId,
  outcome: 'YES',
  amount: '25', // exact decimal text, at most six places
  limitProb: '0.6', // optional: a limit order, resting until filled, cancelled or expired
  expiresAt, // optional, for a limit order
});
// { status: 'filled' | 'partly_filled' | 'resting' | 'cancelled' | 'refused', … }
```

**For the typed API (1.7d):** the website calls `trade(database(), user.id, request)` from its server code, with the pool `product/web/lib/db.ts` makes, and lists `@hrizzup/ledger`, `@hrizzup/db` and `@hrizzup/market-engine` in `transpilePackages` (`next.config.ts`), as it does the other shared packages. `TradeInputError` is the caller's mistake (a 400); a refusal is a result; `DatabaseBusyError` (from `@hrizzup/db`) means "try again" (a 503).

## How a trade runs

One transaction, as the app's own role with the trader signed in (`@hrizzup/db`):

1. **`markets.begin_trade`** takes the market's lock, so trades on one market run strictly one after another (trades on different markets run side by side). If this request ID was already answered, it returns that answer: a retry never trades twice. Otherwise it locks every account the trade can touch, always in the same order (so two trades never wait on each other forever), and hands over the market, the trader's balance and position, the open orders (in the order they were placed) and their owners' balances, and the time: always the database's own clock, never earlier than the market's last trade. No caller can choose it.
2. **The server** checks the request against that (the market open and before its closing time, the amount within the balance, the shares held), then runs Manifold's maths with that time passed in, and rounds the results once to millionths (`src/plan.ts`). A refusal is a result too, stored like any other.
3. **`markets.apply_trade`** writes the trade, its fills, the resting orders it filled, the positions (Yes and No held together cancel out at Ṁ1 a pair), the moves and the pool together, and stores the result under the request ID. Expired orders are marked as such, so expiry never waits for a job.

Any failure rolls all of it back; the database's own rules (below) refuse anything that would break the books.

## The database checks each trade itself

`apply_trade` doesn't take the server's figures on trust. It refuses a trade:

- whose request isn't the one `begin_trade` started (a fingerprint of its action and parameters is kept for the transaction), or that doesn't match that request (the outcome, the amount, the limit, the expiry, the shares sold), or whose fills have the wrong signs;
- that takes the price past its own limit;
- whose fills and filled orders don't agree, one for one, or that names an order twice, or fills one with nothing;
- where a resting order pays anything but its own limit price for the shares it gets (to Ṁ0.000003), or is filled from the wrong side;
- that fills an order its price never reached (each filled order's limit must lie between the price before and after), or passes an order without filling it though its owner could pay (only an owner out of money lets the price pass an order);
- that moves the pool off Manifold's curve: `y^p · n^(1−p)` stays the same through every trade, up to the rounding (Ṁ0.00001 on each side, and Ṁ0.000004 more for each order filled, never more than Ṁ0.001), so no trade can pay out money the pool's prices don't give;
- whose pool, worked out from the money the market holds and everyone's shares (so every share stays backed exactly), differs from the maths' pool by more than Ṁ0.001.

The price checks allow for what rounding can move a price, which grows as a pool thins: each trade keeps on the market how far its own rounding could have moved it, and the next trade allows a resting order that far past the price it starts from. Orders are cancelled for lack of money only where the database itself sees their owners couldn't pay. So even code that calls `apply_trade` with figures of its own (a bug, or anything worse) can only make trades Manifold's maths would have made.

## Exact money

- **Amounts and shares** are decimals with six places (a millionth of a Ṁ), kept in the database as `numeric(20, 6)` and here as whole millionths (`bigint`, `src/decimal.ts`). Floating point appears only inside Manifold's maths.
- **Rounded once, in the house's favour:** what a person receives (shares, money back from a sale, a settlement at a set probability) is rounded down to a millionth; what they pay never above what they asked or hold; a resting order pays at least its limit price for its shares, never past its owner's balance or what's left of the order. A trade's fills are rounded together so they add up to its total exactly. What rounding leaves over (under a millionth a figure) stays in the market's pool, which is the house's stake; settlement pays the market's remainder to the house, so every market ends at exactly zero. Floating point's own noise (a result a hair off a whole millionth) never costs anyone a millionth.
- **No fee:** `TAKER_FEE_RATE` stays at zero; the books have no line for fees yet, so a trade refuses to run if the maths ever charges one.

## Selling

Manifold's sale finds the amount that buys back the shares being sold, and stops within a millionth of them (relative), above or below. The ledger never sells more than was asked (often everything the trader holds): when the maths overshoots, it asks again for that much less, so a sale can leave a trace of a share behind (at most about a millionth of the shares sold); the result says exactly what was sold. A sale the maths can't land at all (tiny, or at an extreme price), and any trade that would leave a side of the pool under Ṁ0.0001 (a sale, unlike a buy, isn't stopped at 1% or 99%), is refused as "price at its limit".

## Trading with yourself

As in Manifold, a trader's trade can fill their own resting order. It's a wash: the Yes and No it gives them cancel out at once, at Ṁ1 a pair, so nothing is gained or lost, and the resting order is used up. Leaving the trader's own orders out would let the pool's price move past them, which Manifold's sale maths doesn't expect (found by the random tests).

## Play money on signup

Every sign-in account gets its starting balance, Ṁ1,000, from the house, in the same transaction that makes it (`infra/supabase/migrations/*_starting_balance.sql`; PLAN.md section 2, "Play money"). PLAN.md sets no amount, so it's Manifold's default (`STARTING_BALANCE`, `common/src/economy.ts`) at the commit step 1.7a copied from, as the rule for market settings says.

- **In the database, not the app:** a trigger on Supabase Auth's accounts (`auth.users`) calls `ledger.give_starting_balance`, so a sign-up by Google, by an email code or through the server key's admin calls all get it, and no code has to remember to. If it can't be given, the sign-up fails, so an account is never without it.
- **Never twice:** `ledger.starting_balances` records each one by its entry (a grant from the house), and its key is the person's account. Asking again, at once or later, gives nothing, even once the money is spent.
- **Accounts made before** got theirs once, with the migration (`ledger.give_missing_starting_balances`), on top of any play money they already had.
- **Tests and scripts** still ask for a person with exactly so much play money with `ledger.open_account(user, amount)`: the signup's starting balance, brought to that amount by a grant from the house or a correction back to it.
- **A deleted sign-in account's** play money stays in the books, its account no longer anyone's.

## The database's own rules

The migration (`infra/supabase/migrations/*_markets_books.sql`) makes the database refuse, whoever writes: a move that isn't a pair out of one account into another; a move that doesn't fit its entry (a trade moves money only between a person and an open market's pool; a settlement only out of a settled market, a cancel only to or from a cancelled one; only the house gives starting balances and seeds markets); any edit or deletion of a move, an entry, an account, a stored request or a fill, and emptying any of the books' tables; a balance changed except by its moves; a move taking a person below zero, except a cancelled market taking back sale profits; and a market whose money no longer backs its shares. `ledger.problems()` lists anything wrong with the books and must always be empty: since the starting balance, that includes a sign-in account without its play-money account or its starting balance, and a starting balance that isn't exactly its entry.

## Checks

- **Quick checks** (`pnpm --filter @hrizzup/ledger test`): exact amounts and rounding (`src/decimal.test.ts`); turning requests into what the database writes, compared with Manifold's maths, the clock forbidden (`src/plan.test.ts`).
- **The Database check** (`pnpm --filter @hrizzup/ledger test:db`, which `pnpm test:db` includes), against a fresh database built from the migrations, in this worktree's slot on this Mac (CLAUDE.md, "Parallel sessions") or in GitHub (`scripts/test-db.ts`):
  - every rule, one by one: buys, limit orders resting, filling (in the order placed), expiring, running out of money and withdrawn, sales, Yes and No cancelling out, every kind of settlement, a cancel taking back sale profits, the books never edited, overdrafts refused whoever writes them, the app's role kept out of the tables, and trades the maths didn't make refused (`src/books.db.test.ts`);
  - long random runs: thousands of trades of every kind across several markets, on the database's own clock (orders expiring within seconds), settled every way, with the books checked after every step, no resting order ever left on the wrong side of the price, and every settlement compared with Manifold's own payout maths (`src/random.db.test.ts`);
  - trades at the same moment: many on one market (each starting at the price the one before left), many across markets (nobody overdrawn), a settlement racing trades on its market and its traders' trades elsewhere, retries alone and at once, and a trade failing part-way leaving nothing (`src/concurrency.db.test.ts`).
  - play money on signup: a sign-up made by Supabase Auth's own role getting Ṁ1,000 from the house, recorded once; twenty at the same moment; one rolled back leaving nothing; the starting balance asked for eight times at once and given once; never again once spent; a deleted account's money kept in the books (`src/signup.db.test.ts`; the rules one by one in `infra/supabase/tests/starting_balance.test.sql`).
