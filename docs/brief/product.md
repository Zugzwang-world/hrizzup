# Product: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 8 November 2026. The only repository file the Product project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Product's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Product's job:** build the website and the app in parallel, the website one stage ahead (Android first, then iPhone from the same code), plus the markets and the data sources that settle them. It only displays content, which reaches it through the hand-over agreement (`agreement/README.md`), whose first half Product drafts.

## Where things stand

- **Setup is finished** (Phase 0). Staging works end to end at `staging.hrizzup.com`, a sandbox in Mumbai, behind Vercel's login. Production is a quiet twin showing the holding page; the rest is parked (runbook, pre-launch checklist).
- **The codebase is nearly empty:** the website (holding page, legal drafts, `/api/health`, a sign-in test page off production), a one-screen Expo app (SDK 58), shared packages and `@hrizzup/agreement`. Google sign-in works on the website on staging.
- **The agreement's first half is a Draft:** Sourcing hasn't reviewed it, and the founder hasn't approved it in News Desk's place. No tables exist for its shapes.
- **Round 2 is ready to brief,** after a readiness check (`docs/research/round-2-readiness.md`): one session runs 1.5a to 1.5d (performance budget, journey tests, typed API, the app on the founder's phone); a second runs 1.7a (Manifold's maths) in its own worktree. Two things need the founder first (below).
- **Not built yet:** any screen, the typed API, the step 1.5 checks, the app on a phone, the market engine, perps, the data job. Every stage in `TRACKER.md` is not started.

## Decisions in force

- **Two surfaces, one account:** the news app (news and social; no bets or play money) and the website (news and play-money markets). English only; launch in India.
- **Built in parallel, the website one stage ahead** (the founder, 8 November 2026): each news feature (2.1 to 2.4, and 2.7) goes through design, contract, back end, then the website and app screens at the same time in separate worktrees, then the join on the website, then in the app (`TRACKER.md`). App only: 1.6b, 2.5, 2.6, 4.3, 4.5. Website only: 3.1 to 3.4.
- **Sign-in:** 1.6a, the website's (Google, then email codes with Turnstile); 1.6b, the app's (native Google and email codes, same accounts). Supabase Auth throughout; Sign in with Apple with the iPhone (4.3).
- **Three routes into the feed:** found (embedded and credited, never copied), made (News Desk's) and posted (creators and users).
- **News surfaces:** a board (Latest, Top, For You: sorting, not an algorithm); story pages with timelines; ranking never by money; likes and dislikes.
- **The agreement's seven decisions** (the founder, 5 November): among them the launch list (Global, India, Mumbai, Delhi NCR, Bengaluru; eight categories) and prices in US dollars.
- **Markets:** Kalshi's layout, our look; Manifold's engine with its tests; a starting balance; the fewest steps to a first bet. Market data is Product's (1.2, 3.2).
- **Perps** (3.4): one Bitcoin perp in play money on Manifold's perps maths; at most 10 times leverage, filling at the next price, an opening fee, an off switch; a price and liquidation check every few seconds (Supabase Cron); a rule-change log.
- **Checks come first:** step 1.5's checks land before any screen is built in code. Every hand-over point runs `validate()`. No tables before a half is agreed.
- **How changes land:** a pull request each, sized and checked; production only through the release pipeline; screens fit 320 to 2,560 pixels.

## What changed in the latest session

On 8 November 2026, in [#35](https://github.com/Zugzwang-world/hrizzup/pull/35), a research-only readiness check for Round 2 (nothing changed in code, settings or services):

- **Where we stand:** the 8 November decisions (#32 to #34) agree everywhere. Versions are current or a patch behind; Node 26 (LTS since 28 October), TypeScript 7, pnpm 12 and Supabase CLI 3 are later, separate changes. Pull requests use about 10 to 22 GitHub minutes each, of 3,000 a month.
- **Parallel sessions:** two worktrees can install, build and test side by side. Only one should run the dev servers and the local database: sign-in and uploads accept only `localhost:3000`, and the database containers share one name.
- **1.5a:** Lighthouse CI on GitHub's runner against each preview, through the bypass header the Screen check already uses; download sizes as hard limits, timings as the median of 5 runs. A check from Mumbai (Calibre, $75 a month) waits for real pages.
- **1.5b:** Maestro on GitHub Actions with an Android emulator, at phone and tablet sizes; practically free. Expo's own Maestro job (about $60 a month) is the fallback.
- **1.5c:** the plan names no approach. Recommended: oRPC, contract first, in `product/packages/api`: plain GET addresses the edge can cache, our JSON Schemas as validators, an OpenAPI document for free. tRPC is the alternative.
- **1.5d:** no Expo account exists. Expo's build service makes the app; the founder installs a preview build from a link. Google's developer verification isn't enforced in India until 2027.
- **1.7a:** 22 Manifold files at commit `79997aa`; their 158 tests pass under our Vitest. Manifold has no direct tests for yes/no buying, selling, redeeming or payouts, so we add conservation tests. Perps: 14 files, 391 tests.

## Open questions

- **D1, blocking password sign-in** (1.6a). Supabase's password hook is Team-only ($599 a month). Recommendation: a Custom Access Token hook on Pro that refuses any session made with a password, as a migration with tests; no password field anywhere. Don't upgrade.
- **D2 to D4, market data** (1.2). Recommendations, each with a backup:
  - **Bitcoin:** Pyth (free if Pyth Core's key is free for a public app; otherwise Pyth Pro Starter, $500 a month); backup CoinMarketCap. Exchanges' free feeds forbid public use.
  - **Gold, not oil:** GoldAPI.io ($99). Oil's free official price (EIA) comes only weekly; gold's official price costs $10,000 a year or more.
  - **Best AI model:** Arena's leaderboard dataset (free, CC BY 4.0); question: the leader in the month's last snapshot.
  - **Cricket:** Sportmonks Cricket World (about €75). **Football:** API-Football (about $19).
  - About $205 to $705 a month at launch; nothing during Round 2 (free tiers and trials). Each vendor confirms in writing that a free-to-play game may show and settle on its data.
- **Step 1.7 needs the agreement's first half,** still Draft, but Round 2 runs 1.7a. Recommendation: split 1.7 in PLAN.md so 1.7a (the maths, no tables) needs only 0.6.
- **Staging behind Vercel's login:** the app can't call staging's API. Recommendation: before the first app join, make `staging.hrizzup.com` public with a protection exception (if free on Pro); previews stay private. Never put the bypass secret in the app.
- **Posting on the website** (2.4). Recommendation: post on both; the website becomes "news, posts and markets". The founder decides.
- **What the two surfaces share in code.** Recommendation: the contract, data fetching, validation and design tokens in `product/packages/`; screens built natively on each.
- **Embedding found posts** (2.3). Recommendation: X's own embed behind a placeholder, loaded just before it scrolls into view; a web view in the app.
- **Market questions** (3.2). Recommendation: one recurring question per subject.
- **Perps' first settings** (3.4). Recommendation: a price every 5 seconds, a 0.1% opening fee, hourly funding, the rule-change log as a table.
- **Free and paid** (2.7). Recommendation: reading and betting stay free; play money is never sold.
- **Turnstile in the app** (1.6b). Recommendation: a small web view showing Cloudflare's widget.
- **Background jobs** (Sourcing chooses). Recommendation: Supabase Cron and Queues; Product reviews the choice.
- **The closed test (2.6) needs News Desk's content.** Recommendation: start without it. The founder decides.

## What's next

1. **The founder:** create an Expo account with a token for Claude Code (needed by 1.5d); approve splitting step 1.7; decide D1 to D4.
2. **Round 2:** 1.5a, 1.5b, 1.5c, 1.5d in one session; 1.7a alongside in its own worktree.
3. **Sign off the agreement's first half:** Sourcing reviews it, then the founder approves it in News Desk's place.
4. **Design (1.4):** references and the design system now; then the core screens.
5. **Sign-in:** the website's email codes (1.6a, with D1's hook), then the app's (1.6b).
6. **Then** each news feature through `TRACKER.md`, and the markets track (3.1 to 3.4) alongside.

For the founder, alongside: the developer accounts (0.4), 12 or more Google Play testers, and setting up News Desk.

## Read for detail

- `docs/research/round-2-readiness.md`: the readiness check in full, every fact with its source, ending with what's ready, what blocks and what only the founder can do.
- `PLAN.md`: sections 2 (the surfaces, the parallel build, perps), 3 (how a feature is built), 5 (the order of work), 7 (open questions).
- `TRACKER.md`: each news feature's stages.
- `agreement/README.md`: sign-offs, decisions, routes, fields, lists.
- `docs/research/manifold.md`: Manifold's code and what we take, adapt or build.
- `docs/status/product.md`: Product's status in full.
- `docs/setup/BLUEPRINT.md`: services, sign-in (section 9), building blocks (13), performance budgets (14).
- `CLAUDE.md`: the rules Claude Code works by.
