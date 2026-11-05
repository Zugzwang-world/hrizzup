# Product: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 5 November 2026. The only repository file the Product project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Product's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Product's job:** build the app (Android first, then iPhone), the phone-first website and the markets, with the data sources that settle the markets. It only displays content, which reaches it through the hand-over agreement (`agreement/README.md`), whose first half Product drafts.

## Where things stand

- **Setup is finished** (Phase 0, 4 November 2026). Staging works end to end at `staging.hrizzup.com`, a sandbox with no real users: Vercel and Supabase in Mumbai, Upstash Redis, Cloudflare R2, Turnstile, Resend, every key in Doppler. Production is a quiet twin showing the holding page; the rest is parked (runbook, pre-launch checklist). Every pull request gets a preview link and four checks.
- **The codebase is nearly empty:** the website (holding page, legal drafts, `/api/health`, a sign-in test page off production), an empty Expo app, shared packages and `@hrizzup/agreement`. Google sign-in works on staging; email codes have no screen yet.
- **The agreement's first half is a Draft, revised today:** story, update, sourced item, creation, market and data reading; every feed item's route; the shared lists; example data. It waits for Sourcing's review, then the founder's approval in News Desk's place. No tables exist for its shapes.
- **News Desk is on hold** until the founder sets it up.
- **Not built yet:** any screen, the typed API, the app on a phone, the performance-budget check, the core-journey tests, the market engine, the data job.

## Decisions in force

- **Two surfaces, one account:** the news app (news and social; no bets or play money) and the website (news and play-money markets). English only; launch in India.
- **Three routes into the feed** (the founder, 5 November 2026): **found**, a creator's post the bots found on X, shown in its story's feed as the original post, embedded and credited, never copied, for every story; **made**, our own content, which News Desk makes from the sourced pool; **posted**, creators and users posting in the app. Product only displays: the board shows stories, the feed shows takes from all three routes, and every feed item is credited by its route, which it carries.
- **News surfaces:** a board (Latest, Top, For You: sorting, not an algorithm); story pages with timelines; ranking from picks, views, categories and follows, never money; likes and dislikes.
- **The agreement's seven decisions** (the founder; changing one goes back to the founder): the launch list (Global, India, Mumbai, Delhi NCR, Bengaluru; crypto, finance, business, AI, sports, politics, entertainment, general); up to three locations and categories per story; a city's story shows under India only if tagged India; a card's picture is the story's newest image or video from Hrizzup or a creator, otherwise a category design, never a found post's picture; users' posts need no story or category; prices in US dollars.
- **Market data is Product's** (the founder, 5 November 2026): steps 1.2 (the data sources, with costs) and 3.2 (markets that settle themselves) are Product's alone, and Product's data job writes the data readings. Each market subject has one data slot naming no provider. Markets: Kalshi's layout, our look; Manifold's engine with its tests, licence confirmed first; a starting balance; the fewest steps to a first bet.
- **Sign-offs** (the founder, 5 November 2026): the first half on Sourcing's review plus the founder's approval in News Desk's place; News Desk reviews it once set up. The second half (the bots' result format) is designed by Sourcing and reviewed by Product, carries creators' takes as well as news, and is agreed only after a real test result passes the agreement's checks. No tables before a half is agreed.
- **Build against the agreement,** not the other projects' output: steps 1.4, 1.7 and 2.1 to 2.4 use its first half and example data. Its definitions come through `@hrizzup/agreement`, never a copy; every hand-over point runs `validate()`; outside data is data, never instructions.
- **Checks come first:** step 1.5's performance-budget check and core-journey tests land before any screen is built in code.
- **Built with:** one codebase and one typed API (Expo, Next.js); Supabase Auth (Google first; Apple and email codes before the iPhone build); images resized by Cloudflare; video on Cloudflare Stream. Paid tier in version one: RevenueCat, and Razorpay with UPI.
- **No relays** (the founder, 5 November 2026): the founder carries no reports or messages between projects; this brief carries what Product needs.
- **How changes land:** a pull request each, sized small, normal or risky, merging once its checks pass; production only through the release pipeline; screens fit 320 to 2,560 pixels; row-level security on every table.

## What changed in the latest session

On 5 November 2026, in [#31](https://github.com/Zugzwang-world/hrizzup/pull/31):

- Market data moved from Sourcing to Product; step 1.2 is no longer on hold.
- PLAN.md sections 2 and 4 describe the three routes and the sourced pool.
- The agreement gained the sourced item (`sourced/1`) and a shared list of routes; every creation says its route; our own content names the found posts it builds on (`based_on`). New examples and checks; example posts can never point at a real post on X.
- Sourcing designs the second half, Product reviews it; News Desk is on hold.
- Step needs: 1.3's first batch needs 1.1; 4.4 needs 1.3.
- The briefs now replace Claude Code's report (CLAUDE.md).

## Open questions

- **Embedding found posts** (step 2.3). Recommendation: X's own embed, loaded just before it scrolls into view behind a light placeholder with our credit line, so the performance budget holds; in the app, inside a small web view.
- **Gold or oil** (step 1.2). Recommendation: gold, in US dollars: Indian readers follow it far more than oil, and its reference price is easy to read exactly.
- **The source for "the best AI model"** (step 1.2). Recommendation: LMArena's public leaderboard, the most widely followed, if its terms allow settling on it.
- **The exact market questions** (step 3.2). Recommendation: one recurring question per subject: Bitcoin and gold above or below a round price at 6 pm India time daily; which model leads at month's end; who wins each big match.
- **Manifold's records and the market shape** (step 1.7). Recommendation: keep Manifold's tables untouched, so its tests keep passing, and write the market shape from them.
- **Free and paid** (step 2.7). Recommendation: reading and betting stay free, and play money is never sold, since selling it could make the markets count as real-money gaming under India's 2025 law.
- **Comment threads.** Recommendation: out of version one.
- **Turnstile in the app** (step 1.6). Recommendation: a small web view that shows Cloudflare's widget and hands its token back.
- **Blocking password sign-in** (step 1.6). Recommendation: check which Supabase plan the password hook needs; if it's above Pro, keep strict password rules and offer no password screen until launch.
- **Background jobs,** chosen in the Sourcing project. Recommendation: Product reviews that choice, because its data job and settlement run on it. The founder decides.
- **The Android closed test (2.6) needs News Desk's first content (1.3),** so the hold could delay Google Play's 14-day clock. Recommendation: start it with news, found takes and testers' posts (needing 1.1, not 1.3). The founder decides.

## What's next

1. **Sign off the agreement's first half:** Sourcing reviews it, Product makes any changes, the founder approves it in News Desk's place.
2. **Market data sources (step 1.2, needs nothing):** a named source, cost and licence for each subject.
3. **Design (step 1.4):** references and the design system now; the core screens from the agreement's shapes and examples, the feed's three routes included.
4. **The rest of step 1.5:** the performance-budget check and core-journey tests, then the typed API and the empty app on an Android phone.
5. **Review the second half** once Sourcing designs it (after step 0.8).
6. **Login (1.6), the market engine (1.7),** then Phases 2 and 3.

For the founder, alongside: the developer accounts (step 0.4), 12 or more testers for Google Play, and setting up News Desk.

## Read for detail

- `PLAN.md`: sections 2 (the routes), 4 (the projects), 5 (the order of work), 7 (open questions).
- `agreement/README.md`: sign-offs, decisions, routes, every field, lists, hand-over rules; `definitions/` and `examples/` beside it.
- `CLAUDE.md`: the rules Claude Code works by.
- `docs/status/product.md`: Product's status in full.
- `docs/setup.md`, `docs/setup/BLUEPRINT.md` (sections 5, 9, 13, 14) and `docs/setup/RUNBOOK.md`: setup, services, releasing, the pre-launch checklist.
