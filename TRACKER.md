# Hrizzup: news features, stage by stage

> Where each news feature stands on the website and in the app, what must be done before the first one starts, and where the markets track stands. Claude Code keeps it current: each step and stage moves in the pull request that finishes it, with that pull request's link. Nobody maintains this file by hand. The steps and what they need are in [PLAN.md](PLAN.md) section 5; if this file and PLAN.md disagree, PLAN.md wins.

Last updated: 9 November 2026

---

## Round 3's queue (the founder's order, 9 November 2026)

Round 2 closed on 9 November 2026. Round 3 runs in relays numbered 1 to 12, with 1b, in waves, attached to the GitHub milestone "Round 3"; each relay moves only its own rows here and in the tables below, and keeps only its own line in the Product brief's "Round 3 progress" current (CLAUDE.md, "Unattended sessions"). Each row is **not started**, **in progress**, **done** with the pull request that finished it, or **cancelled**.

| Relay | When | Step | What | Needs | Status |
|---|---|---|---|---|---|
| 1 | Wave 1, now | — | The round's records: the founder's decisions of 9 November 2026; then (1c) how rounds run, and the perp split into its back end and its page | — | done, [#60](https://github.com/Zugzwang-world/hrizzup/pull/60); 1c: [#62](https://github.com/Zugzwang-world/hrizzup/pull/62) |
| 1b | Wave 1, after relay 1 | — | Correcting the round's records about Sourcing: no xAI API; Sourcing's work runs in its own project; relays 4, 10 and 11 cancelled | Relay 1 | done, [#61](https://github.com/Zugzwang-world/hrizzup/pull/61) |
| 2 | Wave 1, now | 1.8 | Parallel local development: three sessions run the website, the app's dev server and the local database side by side, and sign in and upload locally; with the database-order check (each pull request's database changes come after the newest one on `main`) | 0.6 | done: slots, [#64](https://github.com/Zugzwang-world/hrizzup/pull/64) (this Mac holds four: three for relays at once, one kept for the design chat); the database-order check, [#66](https://github.com/Zugzwang-world/hrizzup/pull/66); sign-in and uploads from every slot, [#68](https://github.com/Zugzwang-world/hrizzup/pull/68) |
| 3 | Wave 1, now | Hardening | The release pipeline refuses to release when production's keys include a name that isn't an app key | [#54](https://github.com/Zugzwang-world/hrizzup/pull/54), merged 9 November 2026 | done, [#65](https://github.com/Zugzwang-world/hrizzup/pull/65) |
| 3 | Wave 1, now | Hardening | The Screen check loads only the keys its tests use, not the whole preview config | [#54](https://github.com/Zugzwang-world/hrizzup/pull/54), merged 9 November 2026 | done, [#84](https://github.com/Zugzwang-world/hrizzup/pull/84) |
| 3 | Wave 1, now | Hardening | The three open Dependabot alerts fixed (zod; glob and minimatch) | [#54](https://github.com/Zugzwang-world/hrizzup/pull/54), merged 9 November 2026 | not started |
| 3 | Wave 1, now | Hardening | The tools the checks download (Maestro, gitleaks and any other) kept in a cache, with retries, after GitHub's 504 errors failed three checks on 9 November 2026 | — | done, [#63](https://github.com/Zugzwang-world/hrizzup/pull/63) |
| 4 | — | 0.8 | Sourcing's research for step 0.8 | — | **cancelled** (the founder, 9 November 2026: Sourcing's work runs in its own project) |
| 5 | Wave 2, after 1.8 | 1.6a | The website's sign-in: Google, then email codes with the bot check, and the access-token hook that refuses passwords; the flows proven on the sign-in test page | 0.6, 1.5c | done: the access-token hook, switched off, [#70](https://github.com/Zugzwang-world/hrizzup/pull/70); email codes on the sign-in test page, [#71](https://github.com/Zugzwang-world/hrizzup/pull/71); the hook switched on for staging, [#74](https://github.com/Zugzwang-world/hrizzup/pull/74) (production at its next release). The founder's one Google sign-in on staging confirms Google with the hook on |
| 6 | Wave 2, after 1.8 | 1.7b | The ledger: double-entry books in exact decimals, with play-money balances, trades and positions; each trade one transaction, one at a time per market, never twice for one request | 0.6, 0.7 (first half, Agreed), 1.7a | done: the tables, [#69](https://github.com/Zugzwang-world/hrizzup/pull/69); the trade code with its tests, [#73](https://github.com/Zugzwang-world/hrizzup/pull/73) |
| 7 | Wave 2, after 1.8; waits for a free slot if the Mac holds only two sessions | 1.9 | The content store's tables: story, update, sourced item, creation and the launch list, with the agreement's rules as database rules; nothing writes or reads them yet | 0.6, 0.7 (first half, Agreed), 1.8 | done, [#72](https://github.com/Zugzwang-world/hrizzup/pull/72): the four tables and the lists, with every rule of the agreement a database can hold (`infra/supabase/content-store.md`), tested against every agreement example in the Database check |
| 8 | After wave 2 | 1.7c | Markets as data, settled by hand in the market console (admins only, every settlement logged), with the admins table and the console's calls in the typed API: create, open, close and settle | 0.7 (first half, Agreed), 1.6a, 1.7b; 1.9 for the categories markets share | done: the database, [#75](https://github.com/Zugzwang-world/hrizzup/pull/75); staging's admins, [#76](https://github.com/Zugzwang-world/hrizzup/pull/76); the calls, [#77](https://github.com/Zugzwang-world/hrizzup/pull/77); the console, [#78](https://github.com/Zugzwang-world/hrizzup/pull/78); on staging, an admin made, opened, closed and settled a test market in the console, the payouts adding up and the log showing it ([#79](https://github.com/Zugzwang-world/hrizzup/pull/79)) |
| 9 | After 1.7c | 1.7d | The engine's other calls in the typed API: list, trade and positions, with the trade call's refusals | 1.5c, 1.7c | done: the database's reads, [#80](https://github.com/Zugzwang-world/hrizzup/pull/80), with their fix for retried requests from the AI review, [#82](https://github.com/Zugzwang-world/hrizzup/pull/82); the calls, [#81](https://github.com/Zugzwang-world/hrizzup/pull/81), whose done-test passed on its preview (a signed-in test account listed a test market, bought, retried, sold, placed and cancelled a limit order and read its positions; every bad input refused; the console settled it, the payouts adding up; the list served from the edge and refreshed 1.6 seconds after the trade); on staging itself, in a browser, the same: a test market listed, traded and settled Yes in the console, Ṁ9.950495 to the trader and Ṁ995.03713 to the house, all it held; records, [#83](https://github.com/Zugzwang-world/hrizzup/pull/83) |
| 10 | — | 0.8; 0.7, second half | Sourcing: a test bot run and the second half's draft | — | **cancelled** (the founder, 9 November 2026: Sourcing's work runs in its own project) |
| 11 | — | 0.7, second half | Product's review of the second half's draft | — | **cancelled** (the founder, 9 November 2026); Product reviews the second half once Sourcing's project designs it |
| 12 | Last | — | The round's closing record | Every other relay | not started |
| 13 | Added 10 November 2026, alongside relay 3 | — | The repository ready to go public until launch (the founder's decision, 10 November 2026: GitHub's included Actions minutes ran out on 9 November, and checks are free on public repositories): every ref's history scanned for keys, past check logs and artifacts deleted, the workflows made safe for it, outsiders kept out, the founder's personal details listed for him; once he's made it public, GitHub's secret scanning with push protection, and the checks running again | — | done, [#86](https://github.com/Zugzwang-world/hrizzup/pull/86): no key in any ref's history; past logs and artifacts deleted; the workflows safe for it, only the founder releasing; only collaborators open pull requests and issues or comment; public since 10 November 2026, with secret scanning and push protection on and the checks running again; what the switch turned up, [#88](https://github.com/Zugzwang-world/hrizzup/pull/88) |

- **Alongside, in the design chat:** step 1.4 restarts from the founder's references and diagrams; the first feature round (the board first) waits for its three core screens.
- **Side by side only when independent** (settled in the Product chat at the founder's request, 9 November 2026): relays run side by side only when their work is independent; work that builds on other work runs after it (PLAN.md section 3).
- **Nothing is added to Round 3:** the perp starts the next round (its back end, 3.4a).
- **Relays 4, 10 and 11 are cancelled** (founder's decision, 9 November 2026), keeping their numbers so other relays' references stay valid. Hrizzup uses no xAI API: Grok bots source everything, and Sourcing's work, step 0.8 and the second half's design included, runs asynchronously in the Sourcing project, on its own schedule. Product receives what it shows through the content store's tables (1.9), and reviews the second half once Sourcing designs it, as the agreement's rules set out.
- **No background jobs in Round 3** (founder's decision, 9 November 2026): the choice stays Sourcing's, made in its own project.
- **After the queue:** the next round starts with the perp's back end (3.4a), once its first settings are decided; then the market pages (3.1) and the perp's page (3.4c), each from its approved design; the app's sign-in (1.6b); the first feature round, once 1.4's core screens are approved.

## Before the first feature round

Everything PLAN.md lists as a need of the first news feature (the board, step 2.1), and so of the round that starts the features. Round 2 ran most of it, in relays in parallel worktrees, attached to the GitHub milestone "Round 2" (closed 9 November 2026); Round 3 runs the rest, in the order of "Round 3's queue", above. Each row is **not started**, **in progress**, or **done** with the pull request that finished it.

| Step | What | Needs | Who | Status |
|---|---|---|---|---|
| 1.5a | The speed check: performance budgets measured on every pull request | 0.6 | Round 2, relay 2 | done, [#41](https://github.com/Zugzwang-world/hrizzup/pull/41) |
| 1.5b | Journey tests on the website and in the app, including the app's first Maestro test | 1.5a | Round 2, relay 2 | done, [#47](https://github.com/Zugzwang-world/hrizzup/pull/47) |
| 1.5c | The typed API (oRPC, contract first), with calls that aren't content (health, who am I); done when the website makes a real call through it | 1.5b | Round 2, relay 2 | done, [#48](https://github.com/Zugzwang-world/hrizzup/pull/48) |
| 1.5d | The empty app on the founder's Android phone, answering from the typed API on staging, with its own budget; staging becomes public | 1.5c | Round 2, relay 2; the founder installs it | done, [#49](https://github.com/Zugzwang-world/hrizzup/pull/49), [#51](https://github.com/Zugzwang-world/hrizzup/pull/51), [#55](https://github.com/Zugzwang-world/hrizzup/pull/55) and [#50](https://github.com/Zugzwang-world/hrizzup/pull/50); on the founder's phone: he installed it and confirmed on 9 November 2026 |
| 1.7a | Manifold's maths with its tests, plus our own tests that money in equals money out | 0.6 | Round 2, relay 3 | done ([#38](https://github.com/Zugzwang-world/hrizzup/pull/38), [#43](https://github.com/Zugzwang-world/hrizzup/pull/43), [#44](https://github.com/Zugzwang-world/hrizzup/pull/44)) |
| 1.4, first pass | The design values, plus the board and a story page at phone size, on preview links, built only from the founder's references and diagrams | The founder's references and diagrams, given in the design chat; 0.7 (first half, Agreed), for the board and the story page | The design chat (the founder, with Claude Code). Relay 4's pass, built from Claude Code's own picks, was retired on 9 November 2026: [#46](https://github.com/Zugzwang-world/hrizzup/pull/46) closed, its values removed in [#58](https://github.com/Zugzwang-world/hrizzup/pull/58) | not started |
| 0.7, first half: Sourcing's review | Run by a Claude Code session in the repository, working from Sourcing's brief | — | Round 2, relay 5 | done: the review [#37](https://github.com/Zugzwang-world/hrizzup/pull/37), its changes [#42](https://github.com/Zugzwang-world/hrizzup/pull/42) and [#45](https://github.com/Zugzwang-world/hrizzup/pull/45) |
| 0.7, first half: the founder's approval | In News Desk's place; then Agreed, in a change he asks for | Sourcing's review; the agreement's market following the market model (done: [#52](https://github.com/Zugzwang-world/hrizzup/pull/52), Round 2, relay 6) | The founder | done: approved on 9 November 2026, and marked Agreed at his request in [#59](https://github.com/Zugzwang-world/hrizzup/pull/59) (Round 2, relay 7) |
| 1.8 | Parallel local development: three sessions run the website, the app's dev server and the local database side by side, and sign in and upload locally; with the database-order check | 0.6 | Round 3, relay 2 | done, [#64](https://github.com/Zugzwang-world/hrizzup/pull/64), [#66](https://github.com/Zugzwang-world/hrizzup/pull/66) and [#68](https://github.com/Zugzwang-world/hrizzup/pull/68): three slots ran side by side and each signed in and uploaded; the order check is a step of the required Database check |
| 1.6a | The website's sign-in: Google (working on staging), then email codes with the bot check; passwords refused by the access-token hook; the flows proven on the sign-in test page, the real sign-in screen coming from the design chat. The board needs it for favourites and bookmarks (founder's decision, 9 November 2026) | 0.6, 1.5c | Round 3, relay 5 | done, [#70](https://github.com/Zugzwang-world/hrizzup/pull/70), [#71](https://github.com/Zugzwang-world/hrizzup/pull/71) and [#74](https://github.com/Zugzwang-world/hrizzup/pull/74) |
| 1.9 | The content store's tables: story, update, sourced item, creation and the launch list, with the agreement's rules as database rules. Every news feature's back end builds on them (founder's decision, 9 November 2026) | 0.6, 0.7 (first half, Agreed), 1.8 | Round 3, relay 7 | done, [#72](https://github.com/Zugzwang-world/hrizzup/pull/72) |

- **Not needed before the first feature:** the rest of the markets track (below), which runs alongside Phase 2; the app's sign-in (1.6b), which the board's and posting's app joins and the paid tier (2.7) need.
- **1.4 restarts in the design chat** (founder's decision, 9 November 2026): design starts only from the founder's references and diagrams, given there, and no session builds design directions, values or screens of its own choosing. The readable-text check (`@hrizzup/core`) is ready for the values when they arrive.
- **The rest of 1.4:** the market page, with placeholder questions, is the third and last core screen. Whether the remaining screens (the feed, the app frame and the rest) are designed up front or feature by feature is settled in the design chat (founder's decision, 8 November 2026).

## How a news feature is built (founder's decision, 8 November 2026)

The website and the app are built in parallel, with the website one stage ahead (PLAN.md sections 2 and 3). Every news feature reaches both surfaces through the same stages:

| Stage | What it is | Can start when |
|---|---|---|
| 1. Design | One phone-first design for both surfaces, built by Claude Code in the design chat, only from the founder's references and diagrams, on preview links | The design values and 1.4's three core screens are approved (step 1.4) |
| 2. Contract | The feature's part of the one typed API that both surfaces use, with example data drawn from the hand-over agreement. The design and engineering tracks meet here | The design is done, and the typed API exists (step 1.5c) |
| 3. Back end | The tables, rules and server code behind the contract, on staging; its database changes merge first, in their own pull request, and the code follows | The contract is done, and the content store's tables exist (step 1.9) |
| 4a. Website screen | The website's screens, built by the round's relays from the design chat's approved design, against the contract and its example data | The contract is done, and the website's checks exist (steps 1.5a and 1.5b) |
| 4b. App screen | The app's screens, built by the round's relays at the same time as 4a, in a separate worktree | The contract is done, and the app's checks exist (step 1.5b's Maestro test, step 1.5d's budget) |
| 5. Website join | The website's screens wired to the real back end, checked on the pull request's preview | The back end and the website screen are done |
| 6. App join | The app's screens wired to the same back end, checked on an Android phone | The website join and the app screen are done |

- **Two tracks** (founder's decision, 8 November 2026): design runs in a dedicated design chat, led by the founder with Claude Code; engineering (the maths, the back end, the database, deployment, and joining the front end to the back end) runs in each round's chat. They meet at the contract (stage 2).
- **Who builds the screens** (founder's decision, 9 November 2026): the round's relays, from the design chat's approved design.
- **Separate worktrees:** stages 4a and 4b each run in their own Claude Code session, branch and pull request, and never touch the same files. Code both need goes into `product/packages/` in the contract stage, before they split.
- **Website first:** the website joins first, so any change the real data forces on the contract is found there and the app joins a settled contract.
- **Database changes land first** (founder's decision, 9 November 2026): each merges in its own pull request and only adds things, so whatever is on staging keeps working, and the code and screens that use it follow in the next one. Previews use staging's database, which gets a change only when its pull request merges (CLAUDE.md, "Database changes").
- **Done** means stage 6 is done: the feature works on the website and in the app, each passing its checks (performance budget, core-journey tests, every screen size).
- **The iPhone** comes from the same app code, so it needs no stages of its own; it adds only Sign in with Apple and Apple's review (step 4.3).

## News features

Each cell is **not started**, **in progress**, or **done** with the pull request that finished it.

| Feature | Step | 1. Design | 2. Contract | 3. Back end | 4a. Website screen | 4b. App screen | 5. Website join | 6. App join |
|---|---|---|---|---|---|---|---|---|
| Board: Latest, Top, For You; categories; favourites and bookmarks | 2.1 | not started | not started | not started | not started | not started | not started | not started |
| Story pages with timelines | 2.2 | not started | not started | not started | not started | not started | not started | not started |
| Feed and ranking: three routes, each credited; likes and dislikes; following creators | 2.3 | not started | not started | not started | not started | not started | not started | not started |
| Posting: text for everyone, creators' media, reporting and blocking | 2.4 | not started | not started | not started | not started | not started | not started | not started |
| Paid tier: RevenueCat in the app, Razorpay with UPI on the website | 2.7 | not started | not started | not started | not started | not started | not started | not started |

- **The board (2.1)** needs the website's sign-in (1.6a) for favourites and bookmarks, and joins the app only once the app's sign-in (1.6b) is done (founder's decision, 9 November 2026).
- **Posting (2.4)** joins the app only once the app's sign-in (1.6b) is done.
- **Every feature's back end** (stage 3) builds on the content store's tables (step 1.9; founder's decision, 9 November 2026), which follow the agreement's first half, Agreed on 9 November 2026.
- **The paid tier (2.7)** starts with deciding what's free and what's paid, before its design.

## Markets track (founder's decision, 8 November 2026)

Website only. The markets product comes first and works the same for any question; the topics come once markets work end to end on staging (PLAN.md section 2, "Markets"). Until then, staging uses test markets with placeholder questions, and the perp is built against a stand-in price. Each row is **not started**, **in progress**, **parked**, or **done** with the pull request that finished it.

| Order | Step | What | Needs | Status |
|---|---|---|---|---|
| 1 | 1.7a | The engine maths: Manifold's maths with its tests, plus our own tests that money in equals money out | 0.6 | done (Round 2, relay 3: [#38](https://github.com/Zugzwang-world/hrizzup/pull/38), [#43](https://github.com/Zugzwang-world/hrizzup/pull/43), [#44](https://github.com/Zugzwang-world/hrizzup/pull/44)) |
| 2 | 1.7b | The ledger: double-entry books in exact decimals (each person, each market's pool and a house account), with play-money balances, trades and positions; each trade one transaction, one at a time per market, with its own request ID; never below zero but for a cancel, which takes back sale profits, the balance showing what's owed | 0.6, 0.7 (first half, Agreed), 1.7a | done (Round 3, relay 6: [#69](https://github.com/Zugzwang-world/hrizzup/pull/69), [#73](https://github.com/Zugzwang-world/hrizzup/pull/73)) |
| 3 | 1.7c | Markets as data, created only by Hrizzup, settled by hand in the market console: admins only (the admins table, which only reviewed migrations write), every settlement logged; the console's calls in the typed API (create, open, close, settle) | 0.7 (first half, Agreed), 1.6a, 1.7b; 1.9 for the categories markets share | done (Round 3, relay 8: [#75](https://github.com/Zugzwang-world/hrizzup/pull/75), [#76](https://github.com/Zugzwang-world/hrizzup/pull/76), [#77](https://github.com/Zugzwang-world/hrizzup/pull/77), [#78](https://github.com/Zugzwang-world/hrizzup/pull/78)) |
| 4 | 1.7d | The engine's other calls in the typed API: list, trade, positions; the trade call refuses limits outside 1% to 99%, an expiry of zero, and amounts not positive or over the balance | 1.5c, 1.7c | done (Round 3, relay 9: [#80](https://github.com/Zugzwang-world/hrizzup/pull/80), [#82](https://github.com/Zugzwang-world/hrizzup/pull/82), [#81](https://github.com/Zugzwang-world/hrizzup/pull/81); on staging itself, [#83](https://github.com/Zugzwang-world/hrizzup/pull/83)) |
| 5 | 3.1 | The market pages, on test markets with placeholder questions; a starting balance on signup, from the house account; the reads its design shapes (its price chart) join the typed API at its contract stage | 1.4, 1.5c, 1.7d | not started |
| After 1.7d | 3.4a | The perp's back end on the stand-in price: Manifold's perps maths with our tests that no play money is created or lost; its books in the ledger; its checks every few seconds on Supabase Cron; its calls in the typed API | 1.7d; the perp's first settings decided, for the maths | not started (it starts the next round) |
| After 3.1 and 3.4a | 3.4c | The perp's page, built from its approved design | 3.1, 3.4a | not started |
| Alongside | 3.3 | Markets linked to the website's news through shared categories | 1.5c, 2.1, 3.1 | not started |
| Then: the topics | 1.2 | Topics and data sources: the topics, many copied from Kalshi's market formats, and the source each settles from | Markets working end to end on staging (3.1) | **parked** until markets work end to end on staging |
| Then: the topics | 3.2a | Automatic resolvers: each reads the source named in a market's rules at its closing moment | 1.2, 1.7c | not started |
| Then: the topics | 3.2b | Series: templates for recurring questions | 3.2a | not started |
| Then: the topics | 3.4b | The perp's real price feed, replacing the stand-in | 1.2, 3.4a | not started |

- **Markets work end to end on staging** once 3.1 is done: a visitor signs in, bets on a test market in a few taps and sees the position, and an admin settles it by hand, with the payouts adding up.
- **1.7a** is also in "Before the first feature round", since Round 2 ran it; 1.7b, 1.7c and 1.7d are also in "Round 3's queue": a pull request that moves one moves every row it has.
- **The market console** (founder's decisions, 9 November 2026) comes with 1.7c: admins create, open and close markets there and settle by hand the ones that don't settle automatically; it's a plain internal tool (stock components, no look of its own), and everyone but an admin gets "not found"; the rest of the admin page stays later. **Money rules:** the fee is zero at launch (`TAKER_FEE_RATE`), and a market is cancelled only when it can't be settled fairly. **The books:** double-entry in exact decimals, summing to zero, rounded once with any remainder to the house account; closing times and limit-order expiry are checked inside each trade, so no money waits for a job (PLAN.md section 2, "Markets"; blueprint section 5).
- **The perp in two steps** (settled in the Product chat at the founder's request, 9 November 2026): its back end (3.4a) needs only the engine's calls (1.7d), not the market pages, and its maths starts once the perp's first settings are decided; its page (3.4c) follows the market pages (3.1), from its approved design. Nothing is added to Round 3: the perp starts the next round. The real price feed (3.4b) is unchanged.
- **The readiness check's market-data research** (`docs/research/round-2-readiness.md`, D2 to D4) is reference for step 1.2, not decisions.

## One surface only

These steps don't split into stages; they are tracked in PLAN.md section 5 and Product's status file ([docs/status/product.md](docs/status/product.md)).

| Surface | Step | What |
|---|---|---|
| Website | 1.6a | The website's sign-in: Google (working on staging), then email codes; passwords refused; proven on the sign-in test page, the real sign-in screen coming from the design chat. The board (2.1) and the market console (1.7c) need it, so it's also in "Round 3's queue" |
| App | 1.6b | The app's sign-in: native Google sign-in and email codes, on the same accounts |
| App | 2.5 | Notifications for breaking and developing stories |
| App | 2.6 | The Android store build and the Google Play closed test |
| App | 4.3 | The iPhone build: Sign in with Apple and Apple's review |
| App | 4.5 | Google Play production access |
| Website | 1.7a to 3.4c | The markets track, tracked step by step in "Markets track", above |
