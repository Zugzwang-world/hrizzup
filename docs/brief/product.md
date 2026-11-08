# Product: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 8 November 2026. The only repository file the Product project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Product's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Product's job:** build the app (Android first, then iPhone), the phone-first website and the markets, with the data sources that settle the markets. It only displays content, which reaches it through the hand-over agreement (`agreement/README.md`), whose first half Product drafts.

## Where things stand

- **Setup is finished** (Phase 0, 4 November 2026). Staging works end to end at `staging.hrizzup.com`, a sandbox with no real users: Vercel and Supabase in Mumbai, Upstash Redis, Cloudflare R2, Turnstile, Resend, every key in Doppler. Production is a quiet twin showing the holding page; the rest is parked (runbook, pre-launch checklist).
- **The codebase is nearly empty:** the website (holding page, legal drafts, `/api/health`, a sign-in test page off production), an empty Expo app, shared packages and `@hrizzup/agreement`. Google sign-in works on staging.
- **The agreement's first half is a Draft** (last revised 5 November 2026): story, update, sourced item, creation, market and data reading; every feed item's route; the shared lists; example data. It waits for Sourcing's review, then the founder's approval in News Desk's place. No tables exist for its shapes.
- **Manifold's code has been studied** for the market engine and perps (`docs/research/manifold.md`); nothing is copied yet.
- **News Desk is on hold** until the founder sets it up.
- **Not built yet:** any screen, the typed API, the app on a phone, the step 1.5 checks, the market engine, perps, the data job.

## Decisions in force

- **Two surfaces, one account:** the news app (news and social; no bets or play money) and the website (news and play-money markets). English only; launch in India.
- **Three routes into the feed** (the founder, 5 November 2026): **found** (a creator's post the bots found on X, embedded and credited, never copied), **made** (News Desk's, from the sourced pool) and **posted** (creators and users, in the app), each credited.
- **News surfaces:** a board (Latest, Top, For You: sorting, not an algorithm); story pages with timelines; ranking never by money; likes and dislikes.
- **The agreement's seven decisions** (the founder): the launch list (Global, India, Mumbai, Delhi NCR, Bengaluru; crypto, finance, business, AI, sports, politics, entertainment, general); up to three locations and categories per story; a city's story shows under India only if tagged India; card pictures from Hrizzup or creators, never found posts; users' posts need no category; prices in US dollars.
- **Market data is Product's** (the founder, 5 November 2026): steps 1.2 (data sources, with costs) and 3.2 (markets that settle themselves); Product's data job writes the data readings. Markets: Kalshi's layout, our look; Manifold's engine with its tests; a starting balance; the fewest steps to a first bet.
- **Perps** (the founder, 8 November 2026; step 3.4): one Bitcoin perp in play money on the website, to show investors we brought in a proven financial product, tested it with users and improved it. Manifold's perps maths with its tests, run by our own engine. Starting rules: at most 10 times leverage, filling at the next new price, an opening fee, an off switch. A new price and a liquidation check every few seconds through Supabase Cron. A rule-change log from day one; the dashboard waits for the admin page, and invites are decided later. No second perp yet.
- **Sign-offs:** the first half on Sourcing's review plus the founder's approval in News Desk's place; the second half (the bots' result format) designed by Sourcing, reviewed by Product. No tables before a half is agreed.
- **Build against the agreement,** not the other projects' output, through `@hrizzup/agreement`; every hand-over point runs `validate()`.
- **Checks come first:** step 1.5's performance-budget check and core-journey tests land before any screen is built in code.
- **Built with:** Expo and Next.js in one codebase, one typed API, Supabase Auth, Supabase Realtime, Cloudflare images and Stream; paid tier through RevenueCat and Razorpay with UPI.
- **How changes land:** a pull request each, sized small, normal or risky, merging once its checks pass; production only through the release pipeline; screens fit 320 to 2,560 pixels; row-level security on every table.

## What changed in the latest session

On 8 November 2026:

- **[#32](https://github.com/Zugzwang-world/hrizzup/pull/32), research only:** Manifold's code, read for steps 1.7 and 3.2, in `docs/research/manifold.md`. Its licence is MIT, so we may copy it with its notice.
  - **The engine:** the yes/no maths, limit orders, selling, Yes-and-No cancelling out, fees and settlement are plain TypeScript, and their tests pass on their own (539 tests).
  - **Keeping trades in order:** Manifold queues trades in the memory of its one trading server. On Vercel, each trade becomes one database transaction that locks its market.
  - **The bot API:** stores keys in plain text and has no rate limit on trades. Ours hashes keys and limits requests in Upstash.
  - **@ManifoldSports's code** is there, without cricket; Firebase, Google Cloud and Mailgun are replaced by what we chose.
  - **The verdict:** take the maths with its tests; adapt the trade steps, the ledger, the bot API and the sports flow; build trade ordering and the tables ourselves.
- **[#33](https://github.com/Zugzwang-world/hrizzup/pull/33), the founder's decision:** perps joined the plan as step 3.4 (needs 1.2, 1.7 and 3.1), described under "Decisions in force".
  - **Step 1.2** now includes a live Bitcoin price every few seconds.
  - **The background-jobs choice** (Sourcing's) must cover perps' jobs.

## Open questions

- **Embedding found posts** (step 2.3). Recommendation: X's own embed, loaded just before it scrolls into view behind a placeholder; in the app, a web view.
- **Gold or oil** (step 1.2). Recommendation: gold, in US dollars, which Indian readers follow far more.
- **The source for "the best AI model"** (step 1.2). Recommendation: LMArena's leaderboard, if its terms allow it.
- **The exact market questions** (step 3.2). Recommendation: one recurring question per subject (Bitcoin and gold above or below a round price at 6 pm India time daily; which model leads at month's end; who wins each big match), each settled from one reading at its closing moment.
- **Our market tables** (step 1.7). Recommendation: our own, from the agreement's market shape, holding what Manifold's maths needs; its tests don't touch the database.
- **Perps' first settings** (step 3.4). Recommendation: a new price every 5 seconds; Manifold's opening fee of 0.1% (10 basis points); funding every hour; the rule-change log kept as a table. Each Supabase Cron run calls our own code, because the maths is TypeScript, and a daily job clears Supabase Cron's run history, which it doesn't clear itself.
- **Free and paid** (step 2.7). Recommendation: reading and betting stay free, and play money is never sold (India's 2025 law on real-money gaming).
- **Comment threads.** Recommendation: out of version one.
- **Turnstile in the app** (step 1.6). Recommendation: a small web view showing Cloudflare's widget.
- **Blocking password sign-in** (step 1.6). Recommendation: check which Supabase plan the password hook needs; if above Pro, keep strict password rules and no password screen until launch.
- **Background jobs,** chosen in the Sourcing project. Recommendation: Supabase Cron and Supabase Queues for everything, since perps already run on Supabase Cron. Product reviews the choice, because its data job, settlement and perps run on it. The founder decides.
- **The Android closed test (2.6) needs News Desk's content (1.3),** so the hold could delay Google Play's 14-day clock. Recommendation: start with news, found takes and testers' posts (1.1, not 1.3). The founder decides.

## What's next

1. **Sign off the agreement's first half:** Sourcing reviews it, Product makes any changes, the founder approves it in News Desk's place.
2. **Market data sources (step 1.2, needs nothing):** a named source, cost and licence for each subject, cricket included, and a live Bitcoin price every few seconds for perps.
3. **Design (step 1.4):** references and the design system now; the core screens from the agreement's shapes and examples.
4. **The rest of step 1.5:** the performance-budget check and core-journey tests, then the typed API and the empty app on an Android phone.
5. **Review the second half** once Sourcing designs it (after step 0.8).
6. **Login (1.6), then the market engine (1.7)**, as the research sets out, then Phases 2 and 3, perps (3.4) among them.

For the founder, alongside: the developer accounts (step 0.4), 12 or more testers for Google Play, and setting up News Desk.

## Read for detail

- `PLAN.md`: sections 2 (the routes), 4 (the projects), 5 (the order of work), 7 (open questions).
- `agreement/README.md`: sign-offs, decisions, routes, every field, lists, hand-over rules; `definitions/` and `examples/` beside it.
- `docs/research/manifold.md`: Manifold's code (engine, perps, trades, bot API, sports), with file paths, and the take, adapt or build table.
- `CLAUDE.md`: the rules Claude Code works by.
- `docs/status/product.md`: Product's status in full.
- `docs/setup.md`, `docs/setup/BLUEPRINT.md` and `docs/setup/RUNBOOK.md`: setup, services, releasing, the pre-launch checklist.
