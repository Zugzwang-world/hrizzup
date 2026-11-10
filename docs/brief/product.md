# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 10 November 2026 by Round 4's relay R5 (the perp's back end), closing Round 4. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Round 4 closed on 10 November 2026** ([#120](https://github.com/Zugzwang-world/hrizzup/pull/120)); **Round 5 is open** (milestone "Round 5"), its queue waiting on the design chat.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API; the app with its **sign-in test** (1.6b: Google worked on the founder's phone; his email-code and close-and-reopen tries are still open); the market engine, ledger and console (1.7a to 1.7d); play money on signup; the content store (1.9); the website's sign-in test page (1.6a); and now **the Bitcoin perp, end to end on staging** (3.4a, done): in play money through the typed API on the seeded stand-in price, its books in the ledger, its console (the off switch, settings and rule-change log), its calls, and its scheduled jobs (a new price and the liquidation check every 5 seconds, the hourly funding) on Supabase Cron. **Staging's perp is switched on; production's stays off.**
- **Checks:** Secret, Quick, Database, Screen, Speed and App journeys, all required. Each check run is on its own and sends no real email; a pass on retry fails; every page is inside its speed budget on every run; the perp's journeys show liquidations and funding with no one touching them. **Design** restarts in the design chat.

## Round 5 progress

- **Not started.** Its queue (`TRACKER.md`): the market page (3.1), then the perp's page (3.4c), and the board (2.1), each starting when the design chat approves its design; each relay is numbered when it's written.

## Decisions in force

- **Product first, nothing paid** (the founder, 10 November): no new privacy, security or production work unless it blocks the product; free tiers only; checks, budgets and rules never looser.
- **How sessions work** (the founder, 10 November): one background watcher on checks, never polling; no questions to the founder during or after a relay, one short final report instead; his own tries are the record; records inside each milestone's pull request (no records-only ones but a round's opening and closing); small conversations.
- **Two surfaces, one account,** the website a stage ahead; English; India first. **Design** only from the founder's references and diagrams. **Database changes land first,** adding only, in order.
- **Content:** the agreement's shapes as tables, no xAI or X API in Product. **Markets:** created only by Hrizzup, double-entry play money in exact decimals, Manifold's defaults unless the plan sets them. **The perp:** Manifold's defaults with the 10-times cap; fills at the next 5-second price; scheduled jobs defined in migrations; the stand-in price's seed secret (Doppler), until the real feed (3.4b).
- **Sign-in:** no passwords; email codes through our server, behind the bot check; the app's Google through the phone's browser.
- **How checks behave:** each run owns what it changes and sends no real email; a failed check is re-run only for an outage outside our code. **Budgets never move.** **Public until launch** (P.17): nothing secret or personal in the repository.

## What changed in the latest session

On 10 November 2026, R5, the perp's back end (3.4a), every risky change with an independent AI review and every finding fixed:

- **Its database** ([#111](https://github.com/Zugzwang-world/hrizzup/pull/111)): the Bitcoin perp as data, switched off; its two pools in the ledger; positions, prices, funding and the rule-change log; the database checks every trade, price and funding the server plans. Then **a second pass** ([#116](https://github.com/Zugzwang-world/hrizzup/pull/116)): the pools balance exactly as Manifold's maths does (a perp could have frozen), funding on each perp's own hourly slots (never every 59 minutes), and the Bitcoin perp off until its jobs are set up.
- **Its console** ([#115](https://github.com/Zugzwang-world/hrizzup/pull/115)): admins switch it on, to closing only and off and change its settings, every change logged with who and why.
- **Its calls** ([#117](https://github.com/Zugzwang-world/hrizzup/pull/117)): the price for anyone; opening, closing and positions at the next price, each trade one step in one transaction, a retry never trading twice, every refusal answered. Its secrets' names first ([#114](https://github.com/Zugzwang-world/hrizzup/pull/114)), their values in Doppler, never shown.
- **Its jobs** ([#118](https://github.com/Zugzwang-world/hrizzup/pull/118)): Supabase Cron calls the website every 5 seconds and every minute, only while a perp is on with a position (at most 17,280 calls a day, inside Vercel's included calls); staging's firewall exception and Vault's address and secret set.
- **Its journeys** ([#119](https://github.com/Zugzwang-world/hrizzup/pull/119)): on each run's own test perps, a liquidation and funding with no one touching them, a profit and a loss, the books exact.
- **3.4a's done-test on staging, and Round 4 closed** ([#120](https://github.com/Zugzwang-world/hrizzup/pull/120)): staging's Bitcoin perp switched on in the console, the log keeping why; a fresh account's long opened and closed at the next price (4.4 and 4.9 seconds after each was placed); on the run's own test perps, staging's schedule paid funding once and liquidated a 10-times long with no one touching them; every balance and pool exact to the millionth, staging's books balanced. Then Round 4's rows made final, Round 5's queue written, the Product chat's settlements and the founder's rules for how sessions work recorded, and the milestone "Round 4" closed and "Round 5" opened.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, drafted when 3.3 nears, with the address-and-handle check, so the first half changes once.
- **The pipeline's write access** (1.1). Recommendation: a role of its own that inserts and updates, never deletes.
- **pg_net, the way Supabase Cron calls the website, is open to every database role** (R5; Supabase's own grants, which our migrations can't change). Recommendation: leave it until launch: the Data API is off, and the jobs' secret only starts a job run.
- **Also in the status file:** Vercel's toolbar over the app's bot check on staging; sign-ups waiting for the house; the ledger's next steps; live prices (3.1); creators' X accounts; embedding found posts; a deleted account's posts; the Hermes rewrite; shared code.

## For the founder

- **Your two phone tries for 1.6b, about 3 minutes.** In the app's **Sign-in test**: **Sign out**; then **Email me a code** (your email, the bot check, then the 8-digit code from the email, **Sign in**); then close the app and open it again: you're still signed in. If it says "Too many codes were asked for", wait two minutes. Tell the Product chat how it went; your report is the record.
- **Designs:** your references and diagrams in the design chat; Round 5 waits on them.
- **Three decisions, recommended:** posting on both surfaces (2.4); the closed test without News Desk's content (2.6); reading and betting free (2.7). **When you choose:** the developer accounts (0.4), 12 testers, News Desk. **Spending, parked;** **launch items** in the runbook's pre-launch checklist (the perp on production is P.18).

## What's next

Round 5 (`TRACKER.md`): the market page (3.1), then the perp's page (3.4c), and the board (2.1), each once the design chat approves its design. Before 3.3: the agreement's market/2. The next relay that touches the engine splits Manifold's fuzz test into smaller tests (the same cases, the same limit).

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/setup/BLUEPRINT.md` (database 5, staging 6, sign-in 9, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/setup.md` (the setup log, newest last).
- `product/packages/perps/` (the perp's calls, steps and jobs), `infra/supabase/migrations/` (the perp's books and jobs), `product/packages/market-engine/`; `product/app/`; `agreement/README.md`; `docs/status/product.md` (Product's status in full).
