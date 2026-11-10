# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 10 November 2026 by Round 5's relay R1 (the markets sandbox). PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Round 5 is open** (milestone "Round 5"). The real market page (3.1), the perp's page (3.4c) and the board (2.1) wait for the design chat's designs; **the founder asked for a sandbox first**, to try the back end by hand: it's built (R1, below).
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API; the app with its sign-in test (1.6b: Google worked on the founder's phone; his email-code and close-and-reopen tries are still open); the market engine, ledger and console (1.7a to 1.7d); play money on signup; the content store (1.9); the website's sign-in test page (1.6a); **the Bitcoin perp end to end on staging** (3.4a, done: play money, the seeded stand-in price, its books, console, calls and Supabase Cron jobs; staging's perp is on, production's off); and now **the markets sandbox**.
- **Checks:** Secret, Quick, Database, Screen, Speed and App journeys, all required. Each run is on its own and sends no real email; a pass on retry fails; every page is inside its speed budget on every run. **Design** restarts in the design chat.

## Round 5 progress

- **R1, the markets sandbox:** done, [#121](https://github.com/Zugzwang-world/hrizzup/pull/121). Next: nothing; the founder tries it. For the founder: the five steps below.

## Decisions in force

- **Product first, nothing paid** (the founder, 10 November): no new privacy, security or production work unless it blocks the product; free tiers only; checks, budgets and rules never looser.
- **How sessions work** (the founder, 10 November): one background watcher on checks, never polling; no questions to the founder during or after a relay, one short final report instead; his own tries are the record; records inside each milestone's pull request; small conversations.
- **Two surfaces, one account,** the website a stage ahead; English; India first. **Design** only from the founder's references and diagrams. **Database changes land first,** adding only, in order.
- **Content:** the agreement's shapes as tables, no xAI or X API in Product. **Markets:** created only by Hrizzup, double-entry play money in exact decimals, Manifold's defaults unless the plan sets them. **The perp:** Manifold's defaults with the 10-times cap; fills at the next 5-second price; jobs defined in migrations; the stand-in price's seed secret, until the real feed (3.4b).
- **Sign-in:** no passwords; email codes through our server, behind the bot check; the app's Google through the phone's browser.
- **How checks behave:** each run owns what it changes; a failed check is re-run only for an outage outside our code. **Budgets never move.** **Public until launch** (P.17): nothing secret or personal in the repository.

## What changed in the latest session

On 10 November 2026, R1, **the markets sandbox** ([#121](https://github.com/Zugzwang-world/hrizzup/pull/121), one pull request, no database change): a plain working copy of Kalshi's layout at **`/sandbox`** on staging, previews and this Mac (production answers "not found"), markets only, from stock components with no design values and no chart library.

- **Pages:** the open markets as rows with chance and Yes/No prices; a market's page (question, chance, close time, a price line drawn from what the page has seen since it opened, Kalshi's trade panel: buy and sell Yes or No at market or with a limit, cancel a resting limit, and the account's position); the Bitcoin perp's page (price and change, open interest, funding, a price line every 5 seconds, Up or Down, 25%, 50% and Max, a multiplier of 1 to 10 times, the liquidation price, open positions with profit or loss and Close). The header has Markets, Perps, the play-money balance, Sign in (through the sign-in test page, which now returns to the page that sent you) and, for admins, the console.
- **Checks:** all four pages are in the Screen and Speed checks; the layout rules held at every width in both engines, signed in and out. Tried by hand against staging's books: a buy, a sell, a resting limit and its cancel, a refusal, a perp opened and closed, every figure exact.
- **On staging:** four listed test markets with placeholder questions, the first closing within a day so it can be settled. The founder's account was already an admin ([#76](https://github.com/Zugzwang-world/hrizzup/pull/76)).
- **Left out** (the back end doesn't have it): take profit and stop loss, multi-date markets, charts over past days, a payout preview before trading, a perp's part-close.
- **Limits:** a market's page exists only for a market on the public list (not an unlisted one, nor one settled at a set probability), because the API has no read of a single market (open question below).

## Open questions

One line each; the detail, and the rest, are in the status file.

- **A public read of one market** (3.1's contract stage; R1). The sandbox finds a market through the list, so only listed markets have a page. Recommendation: a public `markets.get` for any market that isn't a draft, with the reads the market page's design needs.
- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, drafted when 3.3 nears, with the address-and-handle check, so the first half changes once.
- **The pipeline's write access** (1.1). Recommendation: a role of its own that inserts and updates, never deletes.
- **pg_net, the way Supabase Cron calls the website, is open to every database role** (Supabase's own grants). Recommendation: leave it until launch: the Data API is off, and the jobs' secret only starts a job run.
- **Also in the status file:** Vercel's toolbar over the app's bot check; sign-ups waiting for the house; the ledger's next steps; live prices (3.1); creators' X accounts; embedding found posts; a deleted account's posts; the Hermes rewrite; shared code.

## For the founder

- **Try the sandbox, about 10 minutes, at `staging.hrizzup.com/sandbox`** (live once this has merged): (1) **Sign in:** press **Sign in**, continue with Google, and you return with your balance in the header. (2) **Buy and sell:** open a market, choose Yes, type an amount, **Buy Yes**; the chance moves and your position shows; then **Sell**, 50%, **Sell**. (3) **A limit order:** **Order**, then **Limit**, an amount of 20 and a limit of 10, **Buy Yes with a limit** (it rests, the chance being about 50); **Cancel** it under your orders. (4) **The perp:** **Perps**, the Bitcoin perp, **Up**, a cost of 100, drag the multiplier, **Open Up** (it fills within 5 seconds); see its profit or loss; **Close**. (5) **Settle a market:** **Console**, the market closing within a day, **Close**, then **Settle** with a reason; back in the sandbox it shows under "closed and settled", and a winner's payout in the balance. **Funding only moves money when both Up and Down are open,** which takes two accounts, and it runs hourly.
- **Your two phone tries for 1.6b, about 3 minutes.** In the app's **Sign-in test**: **Sign out**; then **Email me a code** (your email, the bot check, then the 8-digit code, **Sign in**); then close the app and open it again: still signed in. Tell the Product chat how it went.
- **Designs:** your references and diagrams in the design chat; the market page (3.1) and the perp's page (3.4c) wait on them.
- **Three decisions, recommended:** posting on both surfaces (2.4); the closed test without News Desk's content (2.6); reading and betting free (2.7). **When you choose:** the developer accounts (0.4), 12 testers, News Desk. **Spending, parked;** **launch items** in the runbook's pre-launch checklist (the perp on production is P.18).

## What's next

Round 5 (`TRACKER.md`): the market page (3.1), then the perp's page (3.4c), and the board (2.1), each once the design chat approves its design; what you find in the sandbox shapes them. Before 3.3: the agreement's market/2. The next relay that touches the engine splits Manifold's fuzz test into smaller tests (the same cases, the same limit).

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/setup/BLUEPRINT.md` (database 5, staging 6, sign-in 9, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/setup.md` (the setup log, newest last).
- `product/web/app/sandbox/` and `product/web/components/sandbox/` (the sandbox), `product/web/scripts/sandbox-markets.ts` (its test markets), `product/packages/perps/`, `product/packages/market-engine/`; `product/app/`; `agreement/README.md`; `docs/status/product.md` (Product's status in full).
