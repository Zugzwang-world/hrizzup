# Product: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 8 November 2026. The only repository file the Product project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Product's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Product's job:** build the website and the app in parallel, the website one stage ahead (Android first, then iPhone from the same code), plus the markets and the data sources that settle them. It only displays content, which reaches it through the hand-over agreement (`agreement/README.md`), whose first half Product drafts.

## Where things stand

- **Setup is finished** (Phase 0). Staging works end to end at `staging.hrizzup.com`, a sandbox with no real users, in Mumbai. Production is a quiet twin showing the holding page; the rest is parked (runbook, pre-launch checklist).
- **The codebase is nearly empty:** the website (holding page, legal drafts, `/api/health`, a sign-in test page off production), an empty Expo app, shared packages and `@hrizzup/agreement`. Google sign-in works on the website on staging.
- **The agreement's first half is a Draft** (story, update, sourced item, creation, market, data reading; routes; lists; examples). It waits for Sourcing's review, then the founder's approval in News Desk's place. No tables exist for its shapes.
- **`TRACKER.md` is new:** each news feature's stages on the website and in the app. Every stage is not started.
- **Manifold's code has been studied** for the market engine and perps (`docs/research/manifold.md`); nothing is copied yet.
- **News Desk is on hold** until the founder sets it up.
- **Not built yet:** any screen, the typed API, the app on a phone, the step 1.5 checks, the market engine, perps, the data job.

## Decisions in force

- **Two surfaces, one account:** the news app (news and social; no bets or play money) and the website (news and play-money markets). English only; launch in India.
- **Built in parallel, the website one stage ahead** (the founder, 8 November 2026):
  - every news feature (board 2.1, story pages 2.2, feed 2.3, posting 2.4, and the paid tier 2.7) reaches both surfaces from one back end, one contract (the typed API) and one phone-first design;
  - its stages: design, contract, back end, then the website screen and the app screen at the same time in separate worktrees, then the join on the website, then in the app (`TRACKER.md`);
  - app only: notifications (2.5), the app's sign-in (1.6b), the store builds and the closed test (2.6, 4.3, 4.5). Website only: the markets track (3.1 to 3.4);
  - Android and iPhone come from the same app code; Android is released first, and the iPhone adds only Sign in with Apple (in the app and on the website) and Apple's review (4.3).
- **Sign-in, split in two:** 1.6a, the website's (Google, then email codes with Turnstile); 1.6b, the app's (native Google sign-in and email codes, on the same accounts). Supabase Auth throughout.
- **Three routes into the feed** (the founder, 5 November 2026): **found** (a creator's post the bots found on X, embedded and credited, never copied), **made** (News Desk's, from the sourced pool) and **posted** (creators and users), each credited.
- **News surfaces:** a board (Latest, Top, For You: sorting, not an algorithm); story pages with timelines; ranking never by money; likes and dislikes.
- **The agreement's seven decisions** (the founder), among them the launch list (Global, India, Mumbai, Delhi NCR, Bengaluru; eight categories), up to three locations and categories per story, card pictures never from found posts, and prices in US dollars.
- **Market data is Product's** (steps 1.2 and 3.2). Markets: Kalshi's layout, our look; Manifold's engine with its tests; a starting balance; the fewest steps to a first bet.
- **Perps** (the founder, 8 November 2026; step 3.4): one Bitcoin perp in play money on the website, on Manifold's perps maths; at most 10 times leverage, filling at the next price, an opening fee, an off switch; a price and liquidation check every few seconds (Supabase Cron); a rule-change log.
- **Sign-offs:** the second half (the bots' result format) is designed by Sourcing and reviewed by Product. No tables before a half is agreed.
- **Build against the agreement** through `@hrizzup/agreement`; every hand-over point runs `validate()`. **Checks come first:** step 1.5's performance-budget check and core-journey tests land before any screen is built in code.
- **Built with:** Expo and Next.js in one codebase, Supabase Auth and Realtime, Cloudflare images and Stream; RevenueCat and Razorpay with UPI.
- **How changes land:** a pull request each, sized and checked; production only through the release pipeline; screens fit 320 to 2,560 pixels.

## What changed in the latest session

On 8 November 2026, in [#34](https://github.com/Zugzwang-world/hrizzup/pull/34), the founder decided that the website and the app are built in parallel, the website one stage ahead:

- **PLAN.md sections 2 and 3** gain the decision (as under "Decisions in force") and how a news feature is built, stage by stage.
- **PLAN.md section 5:** step 1.6 splits into 1.6a and 1.6b; Phase 2 covers both surfaces, with 2.5 and 2.6 app only; Phase 3 is website only, and 3.3 now only links markets to the news the website already has; 4.3 needs 1.6b and adds only Sign in with Apple and Apple's review.
- **`TRACKER.md`** (new): the stages, what each needs, and a row per news feature. The blueprint's sign-in order follows.

## Open questions

- **Posting on the website** (step 2.4). The decision's app-only list leaves posting out, so the plan builds it on both, yet section 2 still calls the website "news and markets" and the app "news and social". Recommendation: post on both, since the website's feed shows posted takes anyway and creators upload more easily from a computer; then the website's description becomes "news, posts and markets". The founder decides.
- **What the two surfaces share in code.** Recommendation: share the contract, the data-fetching and its caching, the validation and the design's tokens (colours, type, spacing) through `product/packages/`; build the screens natively on each (shadcn/ui on the website, Expo's own components in the app), as the decision's separate screen stage implies.
- **Embedding found posts** (step 2.3). Recommendation: X's own embed, loaded just before it scrolls into view behind a placeholder; in the app, a web view.
- **Gold or oil, and the AI-model source** (step 1.2). Recommendation: gold, in US dollars; LMArena's leaderboard, if its terms allow it.
- **The exact market questions** (step 3.2). Recommendation: one recurring question per subject (Bitcoin and gold against a round price at 6 pm India time daily; the leading model at month's end; each big match's winner).
- **Our market tables** (step 1.7). Recommendation: our own, from the agreement's market shape.
- **Perps' first settings** (step 3.4). Recommendation: a price every 5 seconds; a 0.1% opening fee; hourly funding; the rule-change log as a table.
- **Free and paid** (step 2.7). Recommendation: reading and betting stay free, and play money is never sold (India's 2025 law on real-money gaming).
- **Comment threads.** Recommendation: out of version one.
- **Turnstile in the app** (step 1.6b). Recommendation: a small web view showing Cloudflare's widget.
- **Blocking password sign-in** (step 1.6a). Recommendation: the password hook, if Pro allows it; otherwise strict password rules and no password screen.
- **Background jobs** (Sourcing chooses). Recommendation: Supabase Cron and Queues for everything; Product reviews the choice.
- **The closed test (2.6) needs News Desk's content (1.3),** which could delay Google Play's 14-day clock. Recommendation: start without it. The founder decides.

## What's next

1. **Sign off the agreement's first half:** Sourcing reviews it, Product makes any changes, the founder approves it in News Desk's place.
2. **Market data sources (step 1.2, needs nothing):** a named source, cost and licence for each subject, and a live Bitcoin price every few seconds.
3. **Design (step 1.4):** references and the design system now; then one phone-first design of the core screens for both surfaces, from the agreement's shapes and examples.
4. **The rest of step 1.5:** the performance-budget check and the core-journey tests (Playwright for the website, Maestro for the app), then the typed API and the empty app on an Android phone.
5. **Sign-in:** the website's email codes (1.6a), then the app's sign-in (1.6b).
6. **Review the second half** once Sourcing designs it (after step 0.8).
7. **The market engine (1.7),** then each news feature through its stages in `TRACKER.md`, and the markets track (3.1 to 3.4) alongside.

For the founder, alongside: the developer accounts (step 0.4), 12 or more testers for Google Play, and setting up News Desk.

## Read for detail

- `PLAN.md`: sections 2 (the surfaces, building in parallel, the routes), 3 (how a feature is built), 4 (the projects), 5 (the order of work), 7 (open questions).
- `TRACKER.md`: each news feature's stages on the website and in the app.
- `agreement/README.md`: sign-offs, decisions, routes, every field, lists, hand-over rules; `definitions/` and `examples/` beside it.
- `docs/research/manifold.md`: Manifold's code and what we take, adapt or build.
- `docs/status/product.md`: Product's status in full.
- `CLAUDE.md`: the rules Claude Code works by.
- `docs/setup/BLUEPRINT.md` and `docs/setup/RUNBOOK.md`: services, sign-in (blueprint section 9), releasing, the pre-launch checklist.
