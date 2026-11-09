# @hrizzup/db

The server's one way into the database (blueprint section 5, "The app's own role"). Server code never queries the database on its own: it hands its work to `transaction()`, which runs it as one transaction, as the app's own role, with the signed-in account set.

```ts
import { transaction } from '@hrizzup/db';

const result = await transaction(pool, (tx) => tx.query('select markets.begin_trade(…)'), {
  account: user.id, // the signed-in Supabase user, or null
});
```

## What each transaction gets

- **The app's own role, `hrizzup_app`:** the server logs in as Supabase's `postgres` (the pooler's address, `DATABASE_URL`), which owns every table and passes row-level security. Each transaction switches to `hrizzup_app` first (`SET LOCAL ROLE`, which ends with the transaction, so it works through the pooler in transaction mode). That role owns nothing, passes no row-level security, and may only call the functions a migration grants it (today: starting and applying a trade). The database refuses everything else, so a mistake in server code can't reach a table directly.
- **The signed-in account,** set the way Supabase's own Data API sets it (`request.jwt.claims`, and `request.jwt.claim.sub` for older definitions), so `auth.uid()` names the person in every function and row-level policy. The account is checked to be a user ID before it reaches the database.
- **Time limits:** a statement waits at most 2 seconds for a lock and runs at most 10 (both adjustable), so a busy market answers "try again" instead of hanging.
- **Another try when the database asks:** after a lock wait that ran out, a deadlock the database broke, or a serialization failure, the whole transaction runs again, up to 3 attempts in all, waiting a little longer each time (25 ms, then 50 ms, with jitter); then `DatabaseBusyError`, which the typed API can answer as "try again". The work must be safe to repeat: a trade is, because each trade request carries its own ID.

## Checks

- **Unit tests** (`src/transaction.test.ts`, in Quick checks): the statements each transaction sends, the role and account set, retries and when they stop, and a broken connection discarded.
- **Against a real database:** `@hrizzup/ledger`'s database tests run every trade through this helper, and prove the app's role can't read or write the books directly.

## What the role switch is, and isn't

It keeps every mistake in server code away from the tables: a query that isn't one of the granted functions is refused. It is not a wall against SQL injected into the connection, which could switch back (`RESET ROLE`) or set another account, because the server still logs in as `postgres`. So every statement the server sends is parameterised, never built from text it was given, and the stronger step, a database login of the app's own that can never become anything else, waits for the founder: it needs its own password, made in Supabase and kept in Doppler (Product brief, "For the founder").

Not in this package: the connection pool, which the website makes (`product/web/lib/db.ts`: Supabase's pooler, its certificate checked) and passes in.
