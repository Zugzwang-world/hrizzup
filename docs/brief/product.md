# Product: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 8 November 2026. The only repository file the Product project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Product's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Product's job:** build the app (Android first, then iPhone), the phone-first website and the markets, with the data sources that settle the markets. It only displays content, which reaches it through the hand-over agreement (`agreement/README.md`), whose first half Product drafts.

## Where things stand

- **Setup is finished** (Phase 0, 4 November 2026). Staging works end to end at `staging.hrizzup.com`, a sandbox with no real users: Vercel and Supabase in Mumbai, Upstash Redis, Cloudflare R2, Turnstile, Resend, every key in Doppler. Production is a quiet twin showing the holding page; the rest is parked (runbook, pre-launch checklist).
- **The codebase is nearly empty:** the website (holding page, legal drafts, `/api/health`, a sign-in test page off production), an empty Expo app, shared packages and `@hrizzup/agreement`. Google sign-in works on staging.
- **The agreement's first half is a Draft:** story, update, sourced item, creation, market and data reading; every feed item's route; the shared lists; example data. It waits for Sourcing's review, then the founder's approval in News Desk's place. No tables exist for its shapes.
- **Manifold's code has been studied** for the market engine (`docs/research/manifold.md`); nothing is copied yet.
- **News Desk is on hold** until the founder sets it up.
- **Not built yet:** any screen, the typed API, the app on a phone, the performance-budget check, the core-journey tests, the market engine, the data job.

## Decisions in force

- **Two surfaces, one account:** the news app (news and social; no bets or play money) and the website (news and play-money markets). English only; launch in India.
- **Three routes into the feed** (the founder, 5 November 2026): **found** (a creator's post the bots found on X, embedded and credited, never copied, for every story), **made** (our own content, which News Desk makes from the sourced pool) and **posted** (creators and users, in the app). Every feed item is credited by its route.
- **News surfaces:** a board (Latest, Top, For You: sorting, not an algorithm); story pages with timelines; ranking never by money; likes and dislikes.
- **The agreement's seven decisions** (the founder): the launch list (Global, India, Mumbai, Delhi NCR, Bengaluru; crypto, finance, business, AI, sports, politics, entertainment, general); up to three locations and categories per story; a city's story shows under India only if tagged India; card pictures from Hrizzup or creators, never found posts; users' posts need no category; prices in US dollars.
- **Market data is Product's** (the founder, 5 November 2026): steps 1.2 (data sources, with costs) and 3.2 (markets that settle themselves); Product's data job writes the data readings. Markets: Kalshi's layout, our look; Manifold's engine with its tests; a starting balance; the fewest steps to a first bet.
- **Sign-offs:** the first half on Sourcing's review plus the founder's approval in News Desk's place. The second half (the bots' result format) is designed by Sourcing, reviewed by Product, and agreed only after a real test result passes the agreement's checks. No tables before a half is agreed.
- **Build against the agreement,** not the other projects' output, through `@hrizzup/agreement`; every hand-over point runs `validate()`.
- **Checks come first:** step 1.5's performance-budget check and core-journey tests land before any screen is built in code.
- **Built with:** Expo and Next.js in one codebase, one typed API, Supabase Auth, Supabase Realtime, Cloudflare images and Stream; paid tier through RevenueCat and Razorpay with UPI.
- **How changes land:** a pull request each, sized small, normal or risky, merging once its checks pass; production only through the release pipeline; screens fit 320 to 2,560 pixels; row-level security on every table.

## What changed in the latest session

On 8 November 2026, in [#32](https://github.com/Zugzwang-world/hrizzup/pull/32), research only (nothing copied): Manifold's repository read for steps 1.7 and 3.2, in `docs/research/manifold.md`.

- **Licence:** MIT. We may copy the code, keeping its notice.
- **The engine is easy to take.** The yes/no maths, limit orders, selling, Yes-and-No cancelling out, fees and settlement payouts are plain TypeScript with no database code, and their tests ran on their own (539 tests, all passing).
- **Trade ordering doesn't carry over.** Manifold queues every trade in the memory of its one trading server. On Vercel many copies run at once, so each trade becomes one database transaction that locks its market, re-checks and writes, with retries and a request key.
- **Perps** are there, with tests: prices from outside sources every 2 seconds, orders filled at the next price, hourly funding paid by the crowded side, liquidation when margin is gone, and a 0.1% fee on opening (higher for API keys). Their rules are still changing after losses to bots, and PLAN.md doesn't include them.
- **The bot API:** `/v0/` calls for markets, trades, limit orders and positions; keys stored in plain text; no rate limit on trades in the code. Bots are marked `is_bot`, API trades `is_api`, both kept out of rankings and bonuses.
- **@ManifoldSports is in the repository:** markets made daily from The Odds API's fixtures, settled from scores polled every 10 seconds, odd cases left to an admin. No cricket.
- **Replaced by what we chose:** Firebase sign-in and storage, the Google Cloud machine, its live-update server, Mailgun. Its scheduler runs jobs every few seconds, which Vercel Cron can't.
- **The verdict:** take the maths as is, with its tests; adapt the trade and settle steps, the ledger, the bot API (hashed keys, Upstash rate limits), the bot markers and the sports flow; build trade ordering and the tables ourselves; leave perps out.

## Open questions

- **Embedding found posts** (step 2.3). Recommendation: X's own embed, loaded just before it scrolls into view behind a placeholder with our credit line; in the app, a small web view.
- **Gold or oil** (step 1.2). Recommendation: gold, in US dollars, which Indian readers follow far more.
- **The source for "the best AI model"** (step 1.2). Recommendation: LMArena's public leaderboard, if its terms allow settling on it.
- **The exact market questions** (step 3.2). Recommendation: one recurring question per subject (Bitcoin and gold above or below a round price at 6 pm India time daily; which model leads at month's end; who wins each big match), each settled from one reading at its closing moment.
- **Our market tables** (step 1.7). Recommendation: write our own, from the agreement's market shape, holding what Manifold's maths needs. Its maths tests don't touch the database, so copying Manifold's tables gains nothing.
- **Perps.** Recommendation: leave them out of version one; adding them would be a plan change for the founder.
- **Free and paid** (step 2.7). Recommendation: reading and betting stay free, and play money is never sold (India's 2025 law on real-money gaming).
- **Comment threads.** Recommendation: out of version one.
- **Turnstile in the app** (step 1.6). Recommendation: a small web view that shows Cloudflare's widget and hands its token back.
- **Blocking password sign-in** (step 1.6). Recommendation: check which Supabase plan the password hook needs; if above Pro, keep strict password rules and no password screen until launch.
- **Background jobs,** chosen in the Sourcing project. Recommendation: Product reviews that choice, because its data job and settlement run on it; a once-a-minute job is enough to settle markets, and live scores on screen come from the score provider through Supabase Realtime. The founder decides.
- **The Android closed test (2.6) needs News Desk's content (1.3),** so the hold could delay Google Play's 14-day clock. Recommendation: start with news, found takes and testers' posts (1.1, not 1.3). The founder decides.

## What's next

1. **Sign off the agreement's first half:** Sourcing reviews it, Product makes any changes, the founder approves it in News Desk's place.
2. **Market data sources (step 1.2, needs nothing):** a named source, cost and licence for each subject, cricket included.
3. **Design (step 1.4):** references and the design system now; the core screens from the agreement's shapes and examples.
4. **The rest of step 1.5:** the performance-budget check and core-journey tests, then the typed API and the empty app on an Android phone.
5. **Review the second half** once Sourcing designs it (after step 0.8).
6. **Login (1.6), then the market engine (1.7)**, as the research sets out, then Phases 2 and 3.

For the founder, alongside: the developer accounts (step 0.4), 12 or more testers for Google Play, and setting up News Desk.

## Read for detail

- `PLAN.md`: sections 2 (the routes), 4 (the projects), 5 (the order of work), 7 (open questions).
- `agreement/README.md`: sign-offs, decisions, routes, every field, lists, hand-over rules; `definitions/` and `examples/` beside it.
- `docs/research/manifold.md`: Manifold's code, with file paths, and the take, adapt or build table.
- `CLAUDE.md`: the rules Claude Code works by.
- `docs/status/product.md`: Product's status in full.
- `docs/setup.md`, `docs/setup/BLUEPRINT.md` and `docs/setup/RUNBOOK.md`: setup, services, releasing, the pre-launch checklist.
