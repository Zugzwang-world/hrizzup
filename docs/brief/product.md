# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 10 November 2026 by Round 4's relay R2 (checks you can trust), at the end of its session. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Round 4 is under way** (milestone "Round 4"), its relays numbered R1 to R5.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API; the app, now with a **sign-in test** (1.6b: Google worked on the founder's phone; his email code and reopen check to come); the market engine, ledger and console (1.7a to 1.7d); the perp's maths (3.4a's first part: settings, engine steps and a seeded stand-in price, proven to keep every Ṁ); the content store (1.9); the website's sign-in test page (1.6a); play money on signup (R2).
- **Checks:** Secret, Quick, Database, Screen, Speed and App journeys, all required. **Each check run is on its own** (its own accounts, unlisted markets and files, no real email), a test passing only on its retry fails its check, and every page is inside its speed budget on every run (R2). **Design** restarts in the design chat.

## Round 4 progress

One line per relay; each relay keeps only its own line current.

- **R1, the round's records:** done, [#95](https://github.com/Zugzwang-world/hrizzup/pull/95): the founder's decisions of 10 November recorded, the relays numbered. Nothing for the founder: you keep your GitHub display name on merges (your choice, [#108](https://github.com/Zugzwang-world/hrizzup/pull/108)).
- **R2, checks you can trust:** done: the console page's speed fix and the Speed check's single-run warning ([#93](https://github.com/Zugzwang-world/hrizzup/pull/93)); play money on signup ([#97](https://github.com/Zugzwang-world/hrizzup/pull/97)); every check run on its own ([#103](https://github.com/Zugzwang-world/hrizzup/pull/103), [#105](https://github.com/Zugzwang-world/hrizzup/pull/105)), sending no real email ([#109](https://github.com/Zugzwang-world/hrizzup/pull/109)); a test passing only on its retry fails its check ([#112](https://github.com/Zugzwang-world/hrizzup/pull/112), proven on [#113](https://github.com/Zugzwang-world/hrizzup/pull/113)); the flagged pages inside their budget on every run ([#110](https://github.com/Zugzwang-world/hrizzup/pull/110)). Nothing for the founder.
- **R3, the perp's maths (3.4a):** done ([#92](https://github.com/Zugzwang-world/hrizzup/pull/92), [#98](https://github.com/Zugzwang-world/hrizzup/pull/98), [#99](https://github.com/Zugzwang-world/hrizzup/pull/99)). Nothing for the founder.
- **R4, the app's sign-in (1.6b):** built and merged: staging's firewall for the app's writes ([#94](https://github.com/Zugzwang-world/hrizzup/pull/94)), our server's half ([#96](https://github.com/Zugzwang-world/hrizzup/pull/96)), Google through the phone's browser ([#100](https://github.com/Zugzwang-world/hrizzup/pull/100)), email codes in the app ([#101](https://github.com/Zugzwang-world/hrizzup/pull/101)), the test screen ([#102](https://github.com/Zugzwang-world/hrizzup/pull/102)), your build ([#106](https://github.com/Zugzwang-world/hrizzup/pull/106)) and the signed-in App journey ([#107](https://github.com/Zugzwang-world/hrizzup/pull/107)). **Google worked on your phone** (10 November). For you: the email code and the close-and-reopen check (below); then 1.6b is done.
- **R5, the perp's back end (3.4a),** after R3: not started.
- **Later** (3.1, 3.4c and 2.1 once their designs are approved, then the closing record): numbered when written.

## Decisions in force

- **Product first, nothing paid** (the founder, 10 November): no new privacy, security or production work unless it blocks the product; free tiers only; checks, budgets and rules never looser.
- **Two surfaces, one account,** the website a stage ahead; English; India first. **Design** only from the founder's references and diagrams. **Database changes land first,** adding only, in order.
- **Content:** the agreement's shapes as tables, no xAI or X API in Product, three credited routes. **Markets:** created only by Hrizzup, double-entry play money in exact decimals, Manifold's defaults unless the plan sets them.
- **Sign-in:** no passwords; email codes through our server, behind the bot check. **The app's (1.6b):** Google through the phone's browser (free, no Google module); the bot check in a small web view, checked by our server; Supabase's settings from our API, nothing built in; the session encrypted on the phone; the token on personal calls only. Apple with the iPhone (4.3).
- **How checks behave:** each run owns what it changes and sends no real email; a test passing only on its retry fails its check, and a failed check is re-run only for an outage outside our code. **Budgets never move.** **Public until launch** (P.17): nothing secret or personal in the repository.

## What changed in the latest session

On 10 November 2026, R2, checks you can trust: seven pull requests, the Product chat's two additions among them, each risky one with an independent AI review:

- **The console page's speed** ([#93](https://github.com/Zugzwang-world/hrizzup/pull/93)): strangers get the site's own "not found" page from the server, so its busy time was 35 to 168 ms over 20 runs (budget 200). The Speed check warns on any single run over a budget.
- **Play money on signup** ([#97](https://github.com/Zugzwang-world/hrizzup/pull/97)): Ṁ1,000 from the house for every sign-in account, once; accounts already made got it once too.
- **Every check run on its own** ([#103](https://github.com/Zugzwang-world/hrizzup/pull/103), [#105](https://github.com/Zugzwang-world/hrizzup/pull/105)): each run's own fresh accounts, unlisted markets and files; the trading journeys make every call and refusal and settle every way, each checking its books to the millionth. Two Screen checks at once both passed. **No run sends a real email** ([#109](https://github.com/Zugzwang-world/hrizzup/pull/109)): the email journey's code comes from staging's admin access.
- **A pass on retry is a failure** ([#112](https://github.com/Zugzwang-world/hrizzup/pull/112), proven on [#113](https://github.com/Zugzwang-world/hrizzup/pull/113)): two real flakes fixed first, a page fetch cut off by the next address and Vercel's preview toolbar dropping its connection.
- **The flagged pages, inside budget on every run** ([#110](https://github.com/Zugzwang-world/hrizzup/pull/110)): the slow single runs were the browser's own start-up and the run straight after an untraced contrast run, not the pages; the Speed check now warms up on the site's first page, uncounted, and checks dark-scheme contrast last. All 180 runs under 200 ms (each page 20 times, on four Speed checks of one commit), the highest 159 ms; the home page 16 to 135 ms.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **The stand-in price's seed is secret** (R3): this public code plus a known seed would let anyone win every trade. Recommendation: keep it so; R5 puts staging's seed in Doppler.
- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, drafted when 3.3 nears, with the address-and-handle check, so the first half changes once.
- **The perp's jobs on production** (R5). Recommendation: each does nothing while the perp is off, and production's perp stays off until launch.
- **The pipeline's write access** (1.1). Recommendation: a role of its own that inserts and updates, never deletes.
- **A reader's first visit, cold** (R2): the Speed check measures every run with Next.js's code warm, as all but one always were. Recommendation: measure first visits on real users once live, as planned.
- **Also in the status file:** the perp's hourly funding job (R5); Manifold's fuzz test near its time limit; Vercel's toolbar over the app's bot check on staging; sign-out waiting on Supabase (the website's and the app's); the ledger's next steps; live prices (3.1); creators' X accounts; embedding found posts; a deleted account's posts; the Hermes rewrite; shared code.

## For the founder

- **Finish trying the new build on your phone (step 1.6b's done-test), about 3 minutes.** Google already worked (10 November). In Hrizzup, under **Sign-in test**:
  1. **Sign out**;
  2. **Email me a code**: type your email, let the bot check pass (tap its box if it asks), tap **Email me a code**, then type the 8-digit code from the email and tap **Sign in**;
  3. close the app (swipe it away) and open it again: you're still signed in.
  If it says "Too many codes were asked for", wait two minutes and try again (staging's email limit). Tell the Product chat how it went; then 1.6b is done. The build, if you need it again: https://expo.dev/accounts/hrizzups-team/projects/hrizzup/builds/5a489227-4661-459e-a619-ecbf0bc7a2b2
- **Design:** your references and diagrams in the design chat.
- **Three decisions, recommended:** posting on both surfaces (2.4); the closed test without News Desk's content (2.6); reading and betting free (2.7). **When you choose:** the developer accounts (0.4), 12 testers, News Desk. **Spending, parked;** **launch items** in the runbook's pre-launch checklist.

## What's next

Round 4 (`TRACKER.md`): R2's checks are done; R3's maths is done and R4's sign-in is built, waiting only on the founder's last two tries; then R5, the perp's back end; once their designs are approved, the market page (3.1), the perp's page (3.4c) and the board (2.1); then the closing record. Before 3.3: the agreement's market/2.

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/setup/BLUEPRINT.md` (database 5, staging 6, sign-in 9, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/setup.md` (the setup log, newest last).
- `infra/supabase/auth/README.md`; `infra/vercel/README.md`; `product/app/` (`lib/auth/`, `components/`, `journeys/`); `product/packages/`; `agreement/README.md`; `docs/status/product.md` (Product's status in full).
