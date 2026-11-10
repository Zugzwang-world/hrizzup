# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 10 November 2026 by Round 4's records relay (R1, records only): the founder's decisions of 10 November and Round 4's relays numbered. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Round 4 is under way** (milestone "Round 4"), its relays numbered R1 to R5; Round 3 closed on 10 November ([#89](https://github.com/Zugzwang-world/hrizzup/pull/89)).
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API; a one-screen app on the founder's phone; Manifold's maths (1.7a); the ledger (1.7b); the content store (1.9); the website's sign-in on its test page (1.6a: Google and email codes); the admins' **market console** (1.7c) and **list, trade and positions** in the typed API (1.7d); no screens until 3.1.
- **Checks:** Secret, Quick, Database, Screen (with the website's journeys), Speed and App journeys, all required, free while the repository is public.
- **Design** restarts in the design chat, from the founder's references and diagrams.

## Round 4 progress

One line per relay; each relay keeps only its own line current.

- **R1, the round's records:** done, [#95](https://github.com/Zugzwang-world/hrizzup/pull/95): the founder's decisions of 10 November recorded, the relays numbered. For the founder: one optional click (below).
- **R2, checks you can trust:** the console page's speed fix, [#93](https://github.com/Zugzwang-world/hrizzup/pull/93): strangers get the site's own "not found" page from the server, so its busy time, measured 20 times on GitHub's runner, was 35 to 168 ms (budget 200; before, 114 to 292); and the Speed check warns on any single run over a budget (three so far, queued in the status file). Play money on signup, [#97](https://github.com/Zugzwang-world/hrizzup/pull/97): Ṁ1,000 from the house for every sign-in account, once. Unlisted markets, [#103](https://github.com/Zugzwang-world/hrizzup/pull/103): a run's markets stay off the public list. Next: every check run on its own (its accounts, markets and journeys), then retry-passes fail. Nothing for the founder.
- **R3, the perp's maths (3.4a):** Manifold's perps maths and its 274 tests copied in, [#92](https://github.com/Zugzwang-world/hrizzup/pull/92) (1 of 3). Next: our settings (Manifold's defaults, the 10 times cap), the time passed in and the seeded stand-in price (2 of 3); then our tests that no play money is created or lost, with a long simulation (3 of 3). Nothing for the founder.
- **R4, the app's sign-in (1.6b):** staging's firewall lets the app's writes through ([#94](https://github.com/Zugzwang-world/hrizzup/pull/94), applied); our server's half, the app's settings and email codes in the typed API and the bot check page ([#96](https://github.com/Zugzwang-world/hrizzup/pull/96)); Google through the phone's browser ([#100](https://github.com/Zugzwang-world/hrizzup/pull/100)); email codes in the app ([#101](https://github.com/Zugzwang-world/hrizzup/pull/101)); now the test screen ([#102](https://github.com/Zugzwang-world/hrizzup/pull/102)); then a new build for your phone and the signed-in App journey. Nothing for the founder yet.
- **R5, the perp's back end (3.4a),** after R3: not started.
- **Later** (3.1, 3.4c and 2.1 once their designs are approved, then the closing record): numbered when written.

## Decisions in force

- **Product first until launch** (the founder, 10 November): work goes to the product; no new privacy, security or production work unless it blocks the product; existing checks, budgets and rules stay exactly as they are, nothing looser.
- **Nothing paid for now** (the founder, 10 November): free versions and free tiers only; no new paid tool, plan or licence until the founder says so.
- **Two surfaces, one account,** the website a stage ahead: the app (news and social), the website (news and play-money markets); English; India first. Engineering in each round's chat, relays side by side only when independent.
- **Design (1.4):** only from the founder's references and diagrams, the sign-in screens included; admin-only tools use stock components.
- **Database changes land first,** each in its own pull request, adding only, in order. **Scheduled jobs are defined in migrations** (the founder, 10 November).
- **Content:** the agreement's shapes as tables (1.9), its rules as database rules; no xAI or X API in Product (X's own embed is display); three credited routes; no money in ranking. **Legal** is the founder's legal team's.
- **Markets:** created only by Hrizzup, settled by hand or by our resolver; double-entry play money in exact decimals, one transaction per trade; admins added only by reviewed migrations; no fee at launch on yes/no markets. **Play money at signup** for every new account, from the house, at Manifold's default while PLAN.md sets none (the founder, 10 November; R2, not 3.1).
- **Manifold's defaults** for market settings, unless the plan sets them. **The perp's first settings:** Manifold's opening fee (10 basis points, with its cap) and hourly funding; a seeded stand-in price every 5 seconds; the 10 times cap; every rule change logged. A market settled at a set probability stays off the public list until market/2.
- **Sign-in:** no passwords; email codes through our server, behind the bot check. The app's (1.6b): Google through the phone's browser with Supabase's sign-in, as on the website (the founder, 10 November: free, no Google module); a test screen; the bot check in a small web view; its writes through staging's firewall (production's in P.14). Apple with the iPhone (4.3).
- **How checks behave** (the founder, 10 November): each check run owns what it changes (fresh staging accounts, their play money, its own test markets off the public list); every journey that trades ends with its books adding up, to the exact decimal. Once that lands (R2), a test passing only on its retry fails its check, and only an outage outside our code earns a re-run; until then, one re-run stays (overlapping Screen checks; the console page's Speed re-run ended with [#93](https://github.com/Zugzwang-world/hrizzup/pull/93)). A slow single Speed run warns, queued in the status file. **Budgets never move.**
- **Public until launch,** then private again (P.17): nothing secret or personal in the repository; this Mac's commits carry the founder's GitHub username and no-reply address, GitHub's merges the address; only the founder starts a release.

## What changed in the latest session

On 10 November 2026, Round 4's records ([#95](https://github.com/Zugzwang-world/hrizzup/pull/95), R1, records only):

- **The founder's decisions, recorded** in PLAN.md, CLAUDE.md and the blueprint: product first; nothing paid (no more "default to paid tiers"); how checks behave; signup's play money moved from 3.1 to R2; the app's Google sign-in through the phone's browser; scheduled jobs in migrations; commits under his GitHub username, set on this Mac.
- **Closed:** the Screen check's retry, shared play money, and the journeys' test markets and top-ups (all R2's now); whole-config keys and Dependabot's setting (no new security work). **Held until launch** (the runbook's "Also before launch"): the app's own database login; visitors' addresses for Supabase's limits.
- **Relays numbered** in `TRACKER.md`, the speed-fix row folded into R2; Sourcing's and News Desk's briefs gained decisions 1 and 2.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, drafted by Product when 3.3 nears, together with the address-and-handle check below, so the first half changes once.
- **A post's address and handle:** `validate()` doesn't check they match. Recommendation: add it, with Sourcing's agreement.
- **The perp's jobs on production** (R5): migrations run there too. Recommendation: each job does nothing while the perp is switched off, and production's perp stays off until launch.
- **The pipeline's write access** (1.1). Recommendation: a role of its own that inserts and updates, never deletes.
- **Also in the status file:** the ledger's next steps; live prices (3.1); creators' X accounts; embedding found posts; a deleted account's posts; the Hermes rewrite; shared code.

## For the founder

- **Nothing blocks Round 4.** A new build of the app for your phone comes with R4 (1.6b); its relay sends the link.
- **Design:** your references and diagrams in the design chat: the board and a story page, then the market and perp pages.
- **You're an admin on staging (nothing to do):** sign in with Google on the sign-in test page, then open `staging.hrizzup.com/console`.
- **Optional, a minute: your username on GitHub's merges.** GitHub signs each merge into `main` with your profile's display name, "Zugzwang/world", not your username. To match your decision, set Settings → Public profile → **Name** to `Zugzwang-world`; or skip it, since this Mac's commits already carry your username.
- **Three decisions, recommended:** posting on both surfaces (2.4); the closed test without News Desk's content (2.6); reading and betting free, play money never sold (2.7). **When you choose:** the developer accounts (0.4; they cost money, so they wait for your say-so), 12 Google Play testers, News Desk.
- **Spending, parked under "nothing paid for now":** Calibre ($75 a month) once the board exists; Expo's Maestro job (about $60 a month) if the emulator proves flaky; a database per pull request if needed.
- **Parked until launch:** the runbook's pre-launch checklist, with P.14, P.16, P.17 and "Also before launch".

## What's next

Round 4 (`TRACKER.md`): R2, R3 and R4 side by side; then R5, the perp's back end, its database changes first; once their designs are approved, the market page (3.1), the perp's page (3.4c) and the board (2.1); then the closing record. Before 3.3: the agreement's market/2.

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/setup/BLUEPRINT.md` (database 5, staging 6, sign-in 9, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/setup.md` (the setup log, newest last).
- `infra/supabase/auth/README.md` (sign-in and the hook); `infra/supabase/content-store.md`; `.github/scripts/test_public_repo.py` (the workflows' rules while public).
- `product/packages/` (the contract, ledger, db, markets and market-engine); `docs/research/manifold.md` (the perps maths, section 1); `agreement/README.md`.
- `docs/status/product.md`: Product's status in full.
