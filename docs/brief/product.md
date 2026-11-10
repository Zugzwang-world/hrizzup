# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 10 November 2026 by Round 4's relay R4 (the app's sign-in, 1.6b). PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Round 4 is under way** (milestone "Round 4"), its relays numbered R1 to R5.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API; the app, now with a **sign-in test** (1.6b, waiting for the founder's try); the market engine, ledger and console (1.7a to 1.7d); the content store (1.9); the website's sign-in test page (1.6a); play money on signup (R2).
- **Checks:** Secret, Quick, Database, Screen, Speed and App journeys, all required. **Design** restarts in the design chat.

## Round 4 progress

One line per relay; each relay keeps only its own line current.

- **R1, the round's records:** done, [#95](https://github.com/Zugzwang-world/hrizzup/pull/95): the founder's decisions of 10 November recorded, the relays numbered. Nothing for the founder: you keep your GitHub display name on merges (your choice).
- **R2, checks you can trust:** the console page's speed fix, [#93](https://github.com/Zugzwang-world/hrizzup/pull/93): strangers get the site's own "not found" page from the server, so its busy time, measured 20 times on GitHub's runner, was 35 to 168 ms (budget 200; before, 114 to 292); and the Speed check warns on any single run over a budget (three so far, queued in the status file). Play money on signup, [#97](https://github.com/Zugzwang-world/hrizzup/pull/97): Ṁ1,000 from the house for every sign-in account, once. Unlisted markets, [#103](https://github.com/Zugzwang-world/hrizzup/pull/103): a run's markets stay off the public list. Next: every check run on its own (its accounts, markets and journeys), then retry-passes fail. Nothing for the founder.
- **R3, the perp's maths (3.4a):** Manifold's perps maths and its 274 tests copied in, [#92](https://github.com/Zugzwang-world/hrizzup/pull/92) (1 of 3). Next: our settings (Manifold's defaults, the 10 times cap), the time passed in and the seeded stand-in price (2 of 3); then our tests that no play money is created or lost, with a long simulation (3 of 3). Nothing for the founder.
- **R4, the app's sign-in (1.6b):** built and merged: staging's firewall for the app's writes ([#94](https://github.com/Zugzwang-world/hrizzup/pull/94)), our server's half ([#96](https://github.com/Zugzwang-world/hrizzup/pull/96)), Google through the phone's browser ([#100](https://github.com/Zugzwang-world/hrizzup/pull/100)), email codes in the app ([#101](https://github.com/Zugzwang-world/hrizzup/pull/101)) and the test screen ([#102](https://github.com/Zugzwang-world/hrizzup/pull/102)); **a new build for your phone is ready** (below). Next: the App journey that signs a run's own fresh account in, once R2's accounts merge ([#105](https://github.com/Zugzwang-world/hrizzup/pull/105)). For you: try the build.
- **R5, the perp's back end (3.4a),** after R3: not started.
- **Later** (3.1, 3.4c and 2.1 once their designs are approved, then the closing record): numbered when written.

## Decisions in force

- **Product first, nothing paid** (the founder, 10 November): no new privacy, security or production work unless it blocks the product; free tiers only; checks, budgets and rules never looser.
- **Two surfaces, one account,** the website a stage ahead; English; India first. **Design** only from the founder's references and diagrams. **Database changes land first,** adding only, in order.
- **Content:** the agreement's shapes as tables, no xAI or X API in Product, three credited routes. **Markets:** created only by Hrizzup, double-entry play money in exact decimals, Manifold's defaults unless the plan sets them.
- **Sign-in:** no passwords; email codes through our server, behind the bot check. **The app's (1.6b):** Google through the phone's browser (free, no Google module); the bot check in a small web view, checked by our server; Supabase's settings from our API, nothing built in; the session encrypted on the phone; the token on personal calls only. Apple with the iPhone (4.3).
- **How checks behave:** each run owns what it changes; once R2's work lands, a test passing only on its retry fails. **Budgets never move.** **Public until launch** (P.17): nothing secret or personal in the repository.

## What changed in the latest session

On 10 November 2026, R4, the app's sign-in (1.6b), five pull requests, each with an independent AI review:

- **Staging's firewall** lets the app's writes through, behind the same per-visitor limit; email calls 5 a minute ([#94](https://github.com/Zugzwang-world/hrizzup/pull/94)).
- **Our server's half** ([#96](https://github.com/Zugzwang-world/hrizzup/pull/96)): the app's Supabase settings and email codes in the typed API, the bot check's answer checked as on the website and each visitor counted by our server too; the bot check page.
- **Google** ([#100](https://github.com/Zugzwang-world/hrizzup/pull/100)): Chrome's tab, back to the app's own address, PKCE with SHA-256; a journey reaches Google's real sign-in page.
- **Email codes** ([#101](https://github.com/Zugzwang-world/hrizzup/pull/101)): the bot check runs while the address is typed; the app checks the code itself. The App journeys wait out Play services' restart after boot and start each journey from a clean app.
- **The test screen** ([#102](https://github.com/Zugzwang-world/hrizzup/pull/102)): who's signed in, from the typed API; the token on personal calls only.
- **Found:** staging's 30 emails an hour ran out with several relays' checks running (below); the app's journeys send none.
- **Your build:** Expo, free plan, from `main` ([#106](https://github.com/Zugzwang-world/hrizzup/pull/106)).

## Open questions

One line each; the detail, and the rest, are in the status file.

- **Staging's 30 emails an hour** are shared by every check run and the founder's own sign-ins. Recommendation (R2's to weigh): the website's email journey gets its code from staging's admin access, so no check run sends an email; staging's limit stays at 30.
- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, drafted when 3.3 nears, with the address-and-handle check, so the first half changes once.
- **The perp's jobs on production** (R5). Recommendation: each does nothing while the perp is off, and production's perp stays off until launch.
- **The pipeline's write access** (1.1). Recommendation: a role of its own that inserts and updates, never deletes.
- **Also in the status file:** Vercel's toolbar over the app's bot check on staging; the ledger's next steps; live prices (3.1); creators' X accounts; embedding found posts; a deleted account's posts; the Hermes rewrite; shared code.

## For the founder

- **Try the new build on your phone (step 1.6b's done-test), about 5 minutes:** open https://expo.dev/accounts/hrizzups-team/projects/hrizzup/builds/5a489227-4661-459e-a619-ecbf0bc7a2b2 on the phone, then:
  1. tap **Install** (Android may ask you to allow installs from your browser once: allow it, then go back);
  2. open **Hrizzup** and scroll to **Sign-in test**;
  3. **Continue with Google**, pick your Google account, and you're back in the app, signed in;
  4. **Sign out**;
  5. **Email me a code**: type your email, let the bot check pass (tap its box if it asks), tap **Email me a code**, then type the 8-digit code from the email and tap **Sign in**;
  6. close the app (swipe it away) and open it again: you're still signed in.
  If it says "Too many codes were asked for", wait two minutes and try again (staging's email limit). Tell the Product chat how it went; once you're signed in both ways and still signed in after reopening, 1.6b is done.
- **Design:** your references and diagrams in the design chat.
- **Three decisions, recommended:** posting on both surfaces (2.4); the closed test without News Desk's content (2.6); reading and betting free (2.7). **When you choose:** the developer accounts (0.4), 12 testers, News Desk. **Spending, parked;** **launch items** in the runbook's pre-launch checklist.

## What's next

Round 4 (`TRACKER.md`): R2, R3 and R4 side by side (R4's signed-in App journey after R2's fresh accounts); then R5, the perp's back end; once their designs are approved, the market page (3.1), the perp's page (3.4c) and the board (2.1); then the closing record. Before 3.3: the agreement's market/2.

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/setup/BLUEPRINT.md` (database 5, staging 6, sign-in 9, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/setup.md` (the setup log, newest last).
- `infra/supabase/auth/README.md`; `infra/vercel/README.md`; `product/app/` (`lib/auth/`, `components/`, `journeys/`); `product/packages/`; `agreement/README.md`; `docs/status/product.md` (Product's status in full).
