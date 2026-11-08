# Hrizzup: news features, stage by stage

> Where each news feature stands on the website and in the app. Claude Code keeps it current: each stage moves in the pull request that finishes it, with that pull request's link. Nobody maintains this file by hand. The steps and what they need are in [PLAN.md](PLAN.md) section 5; if this file and PLAN.md disagree, PLAN.md wins.

Last updated: 8 November 2026

---

## How a news feature is built (founder's decision, 8 November 2026)

The website and the app are built in parallel, with the website one stage ahead (PLAN.md sections 2 and 3). Every news feature reaches both surfaces through the same stages:

| Stage | What it is | Can start when |
|---|---|---|
| 1. Design | One phone-first design for both surfaces, in Claude Design | The design system and the feature's core screens are approved (step 1.4) |
| 2. Contract | The feature's part of the one typed API that both surfaces use, with example data drawn from the hand-over agreement | The design is done |
| 3. Back end | The tables, rules and server code behind the contract, on staging | The contract is done, and the agreement's first half is Agreed (no tables for its shapes before then) |
| 4a. Website screen | The website's screens, built against the contract and its example data | The contract is done, and step 1.5's checks exist |
| 4b. App screen | The app's screens, built at the same time as 4a, in a separate worktree | As 4a |
| 5. Website join | The website's screens wired to the real back end, checked on the pull request's preview | The back end and the website screen are done |
| 6. App join | The app's screens wired to the same back end, checked on an Android phone | The website join and the app screen are done |

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

## One surface only

These steps don't split into stages; they are tracked in PLAN.md section 5 and Product's status file ([docs/status/product.md](docs/status/product.md)).

| Surface | Step | What |
|---|---|---|
| Website | 1.6a | The website's sign-in: Google (working on staging), then email codes |
| App | 1.6b | The app's sign-in: native Google sign-in and email codes, on the same accounts |
| App | 2.5 | Notifications for breaking and developing stories |
| App | 2.6 | The Android store build and the Google Play closed test |
| App | 4.3 | The iPhone build: Sign in with Apple and Apple's review |
| App | 4.5 | Google Play production access |
| Website | 3.1 to 3.4 | The markets track: market pages, self-settling markets, markets linked to news, the Bitcoin perp |
