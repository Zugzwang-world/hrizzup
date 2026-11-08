# Hrizzup: news features, stage by stage

> Where each news feature stands on the website and in the app, what must be done before the first one starts, and where the markets track stands. Claude Code keeps it current: each step and stage moves in the pull request that finishes it, with that pull request's link. Nobody maintains this file by hand. The steps and what they need are in [PLAN.md](PLAN.md) section 5; if this file and PLAN.md disagree, PLAN.md wins.

Last updated: 8 November 2026

---

## Before the first feature round

Everything PLAN.md lists as a need of the first news feature (the board, step 2.1), and so of the round that starts the features. Round 2 runs most of it, in relays in parallel worktrees, attached to the GitHub milestone "Round 2", each moving its own rows here (CLAUDE.md, "Unattended sessions"). Each row is **not started**, **in progress**, or **done** with the pull request that finished it.

| Step | What | Needs | Who | Status |
|---|---|---|---|---|
| 1.5a | The speed check: performance budgets measured on every pull request | 0.6 | Round 2, relay 2 | in progress |
| 1.5b | Journey tests on the website and in the app, including the app's first Maestro test | 1.5a | Round 2, relay 2 | not started |
| 1.5c | The typed API (oRPC, contract first), with calls that aren't content (health, who am I); done when the website makes a real call through it | 1.5b | Round 2, relay 2 | not started |
| 1.5d | The empty app on the founder's Android phone, answering from the typed API on staging, with its own budget; staging becomes public | 1.5c | Round 2, relay 2; the founder installs it | not started |
| 1.7a | Manifold's maths with its tests, plus our own tests that money in equals money out | 0.6 | Round 2, relay 3 | done ([#38](https://github.com/Zugzwang-world/hrizzup/pull/38), [#43](https://github.com/Zugzwang-world/hrizzup/pull/43), [#44](https://github.com/Zugzwang-world/hrizzup/pull/44)) |
| 1.4, first pass | The design values, plus the board and a story page at phone size, on preview links | 1.5a, before its page merges; 0.7 (first half), for the board and the story page | Round 2, relay 4, with the founder | in progress |
| 0.7, first half: Sourcing's review | Run by a Claude Code session in the repository, working from Sourcing's brief | — | Round 2, relay 5 | done: the review [#37](https://github.com/Zugzwang-world/hrizzup/pull/37), its changes [#42](https://github.com/Zugzwang-world/hrizzup/pull/42) and [#45](https://github.com/Zugzwang-world/hrizzup/pull/45) |
| 0.7, first half: the founder's approval | In News Desk's place; then Agreed, in a change he asks for | Sourcing's review | The founder | not started |
| 1.8 | Parallel local development: three sessions run the website, the app's dev server and the local database side by side, and sign in and upload locally | 0.6 | Not yet given to a relay | not started |

- **Not needed before the first feature:** the rest of the markets track (below), which runs alongside Phase 2; 1.6a and 1.6b (sign-in), which posting (2.4) and the paid tier (2.7) need.
- **The rest of 1.4:** the market page, with placeholder questions, is the third and last core screen. Whether the remaining screens (the feed, the app frame and the rest) are designed up front or feature by feature is settled in the design chat (founder's decision, 8 November 2026).

## How a news feature is built (founder's decision, 8 November 2026)

The website and the app are built in parallel, with the website one stage ahead (PLAN.md sections 2 and 3). Every news feature reaches both surfaces through the same stages:

| Stage | What it is | Can start when |
|---|---|---|
| 1. Design | One phone-first design for both surfaces, built by Claude Code in the design chat, from the founder's references, on preview links | The design values and 1.4's three core screens are approved (step 1.4) |
| 2. Contract | The feature's part of the one typed API that both surfaces use, with example data drawn from the hand-over agreement. The design and engineering tracks meet here | The design is done, and the typed API exists (step 1.5c) |
| 3. Back end | The tables, rules and server code behind the contract, on staging | The contract is done, and the agreement's first half is Agreed (no tables for its shapes before then) |
| 4a. Website screen | The website's screens, built against the contract and its example data | The contract is done, and the website's checks exist (steps 1.5a and 1.5b) |
| 4b. App screen | The app's screens, built at the same time as 4a, in a separate worktree | The contract is done, and the app's checks exist (step 1.5b's Maestro test, step 1.5d's budget) |
| 5. Website join | The website's screens wired to the real back end, checked on the pull request's preview | The back end and the website screen are done |
| 6. App join | The app's screens wired to the same back end, checked on an Android phone | The website join and the app screen are done |

- **Two tracks** (founder's decision, 8 November 2026): design runs in a dedicated design chat, led by the founder with Claude Code; engineering (the maths, the back end, the database, deployment, and joining the front end to the back end) runs in each round's chat. They meet at the contract (stage 2).
- **Separate worktrees:** stages 4a and 4b each run in their own Claude Code session, branch and pull request, and never touch the same files. Code both need goes into `product/packages/` in the contract stage, before they split.
- **Website first:** the website joins first, so any change the real data forces on the contract is found there and the app joins a settled contract.
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

- **Posting (2.4)** joins the app only once the app's sign-in (1.6b) is done.
- **The paid tier (2.7)** starts with deciding what's free and what's paid, before its design.

## Markets track (founder's decision, 8 November 2026)

Website only. The markets product comes first and works the same for any question; the topics come once markets work end to end on staging (PLAN.md section 2, "Markets"). Until then, staging uses test markets with placeholder questions, and the perp is built against a stand-in price. Each row is **not started**, **in progress**, **parked**, or **done** with the pull request that finished it.

| Order | Step | What | Needs | Status |
|---|---|---|---|---|
| 1 | 1.7a | The engine maths: Manifold's maths with its tests, plus our own tests that money in equals money out | 0.6 | done (Round 2, relay 3: [#38](https://github.com/Zugzwang-world/hrizzup/pull/38), [#43](https://github.com/Zugzwang-world/hrizzup/pull/43), [#44](https://github.com/Zugzwang-world/hrizzup/pull/44)) |
| 2 | 1.7b | The ledger: play-money balances, trades and positions; each trade one database step; money in always equals money out | 0.6, 0.7 (first half), 1.7a | not started |
| 3 | 1.7c | Markets as data, created only by Hrizzup, with settlement by hand: admin only, every settlement logged | 0.7 (first half), 1.7b | not started |
| 4 | 1.7d | The engine's calls in the typed API: create, list, trade, positions, settle | 1.5c, 1.7c | not started |
| 5 | 3.1 | The market pages, on test markets with placeholder questions; a starting balance on signup | 1.4, 1.5c, 1.7d | not started |
| Alongside | 3.4a | The Bitcoin perp, built against a stand-in price | 1.7d, 3.1 | not started |
| Alongside | 3.3 | Markets linked to the website's news through shared categories | 1.5c, 2.1, 3.1 | not started |
| Then: the topics | 1.2 | Topics and data sources: the topics, many copied from Kalshi's market formats, and the source each settles from | Markets working end to end on staging (3.1) | **parked** until markets work end to end on staging |
| Then: the topics | 3.2a | Automatic resolvers: each reads the source named in a market's rules at its closing moment | 1.2, 1.7c | not started |
| Then: the topics | 3.2b | Series: templates for recurring questions | 3.2a | not started |
| Then: the topics | 3.4b | The perp's real price feed, replacing the stand-in | 1.2, 3.4a | not started |

- **Markets work end to end on staging** once 3.1 is done: a visitor signs in, bets on a test market in a few taps and sees the position, and an admin settles it by hand, with the payouts adding up.
- **1.7a** is also in "Before the first feature round", since Round 2 runs it; a pull request that moves it moves both rows.
- **The readiness check's market-data research** (`docs/research/round-2-readiness.md`, D2 to D4) is reference for step 1.2, not decisions.

## One surface only

These steps don't split into stages; they are tracked in PLAN.md section 5 and Product's status file ([docs/status/product.md](docs/status/product.md)).

| Surface | Step | What |
|---|---|---|
| Website | 1.6a | The website's sign-in: Google (working on staging), then email codes; passwords refused |
| App | 1.6b | The app's sign-in: native Google sign-in and email codes, on the same accounts |
| App | 2.5 | Notifications for breaking and developing stories |
| App | 2.6 | The Android store build and the Google Play closed test |
| App | 4.3 | The iPhone build: Sign in with Apple and Apple's review |
| App | 4.5 | Google Play production access |
| Website | 1.7a to 3.4b | The markets track, tracked step by step in "Markets track", above |
