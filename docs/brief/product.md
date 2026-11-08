# Product: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 8 November 2026. The only repository file the Product project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Product's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Product's job:** build the website and the app in parallel, the website one stage ahead (Android first, then iPhone from the same code), plus the markets. It only displays content, which reaches it through the hand-over agreement (`agreement/README.md`), whose first half Product drafts.

## Where things stand

- **Setup is finished** (Phase 0): staging at `staging.hrizzup.com` (Mumbai), behind Vercel's login until 1.5d; production a quiet twin; the rest parked (runbook, pre-launch checklist).
- **The codebase is nearly empty:** a holding page, legal drafts, `/api/health`, a sign-in test page, a one-screen Expo app, shared packages and Manifold's yes/no maths (`product/packages/market-engine`); Google sign-in works on staging.
- **Round 2 is running:** unattended relays on the GitHub milestone "Round 2". `TRACKER.md` shows what comes before the first feature round, and the markets track.
- **The agreement's first half is reviewed by Sourcing and awaits the founder's approval** (in News Desk's place); still a Draft, so no tables for its shapes. For screens: a post gone from X shows nothing; credits use X's current names; updates name their sources; merges point onward.

## Round 2 progress

One line per relay; each relay keeps only its own line current.

1. **Relay 1, the round's records:** merged [#36](https://github.com/Zugzwang-world/hrizzup/pull/36). Next: nothing, relay 1 is done. For the founder: replace the Expo token.
2. **Relay 2, steps 1.5a to 1.5d:** merged [#49](https://github.com/Zugzwang-world/hrizzup/pull/49), 1.5d's first half: staging's public addresses reviewed (nothing needed closing), search engines asked to stay out by header too, staging's protection exception kept in `infra/vercel/`; the app linked to its Expo project (`@hrizzups-team/hrizzup`) with a preview and a development build, and its cold start timed against its budget. Before it: [#41](https://github.com/Zugzwang-world/hrizzup/pull/41) (1.5a), [#47](https://github.com/Zugzwang-world/hrizzup/pull/47) (1.5b) and 1.5c's typed API. Next: staging opens; the app answers from it; the install link.
3. **Relay 3, step 1.7a, Manifold's maths:** merged [#44](https://github.com/Zugzwang-world/hrizzup/pull/44), our money tests: no play money created or lost, over every trade and settlement and 41 random markets; 1.7a is done (201 tests pass, after [#38](https://github.com/Zugzwang-world/hrizzup/pull/38) and [#43](https://github.com/Zugzwang-world/hrizzup/pull/43)). Next: nothing, relay 3 is done. Three questions below.
4. **Relay 4, step 1.4's first pass:** first milestone [#39](https://github.com/Zugzwang-world/hrizzup/pull/39): the readable-text check and the design values package (three candidate directions, nothing on screen yet). Next: the three directions as working boards on preview links, for the founder to choose.
5. **Relay 5, Sourcing's review of the agreement's first half:** done: the review [#37](https://github.com/Zugzwang-world/hrizzup/pull/37), its changes [#42](https://github.com/Zugzwang-world/hrizzup/pull/42) and [#45](https://github.com/Zugzwang-world/hrizzup/pull/45); the first half awaits the founder's approval. For the founder: approve it; three questions.
6. **Relay 6, the market model and the two tracks (records):** merged [#40](https://github.com/Zugzwang-world/hrizzup/pull/40). Next: nothing, relay 6 is done. For the founder: the remaining screens, in the design chat; the market shape before approving the first half.

## Decisions in force

- **Two surfaces, one account:** the app (news and social, no play money) and the website (news and play-money markets); English; launch in India.
- **Built in parallel, the website one stage ahead** (`TRACKER.md`): design, contract, back end, both screens at once, the website's join, then the app's. App only: 1.6b, 2.5, 2.6, 4.3, 4.5. Website only: the markets.
- **Two tracks** (8 November): design in a dedicated design chat, led by the founder with Claude Code; engineering (maths, back end, database, deployment, joining the front end to the back end) in each round's chat. They meet at each feature's contract stage.
- **Unattended relays** (CLAUDE.md): never wait; founder-only items go under "For the founder"; checks never loosened; maths and architecture problems come here.
- **Markets, the product first** (8 November): a market is data, not code: question, outcomes, rules, open and close times, a named settlement source, a status (draft, open, closed, settled, cancelled); the engine works the same for any question. Only Hrizzup creates markets. They settle by hand (admin only, every settlement logged: who, when, the outcome, the evidence) or by our resolver reading the source in the market's rules at the closing moment; no outside oracle, no disputes. The perp prices itself from a live feed.
- **The markets' build order:** 1.7a the maths; 1.7b the ledger (one database step per trade; money in equals money out); 1.7c markets as data, settled by hand; 1.7d the engine's calls in the typed API (create, list, trade, positions, settle); 3.1 the market pages. 1.7b and 1.7c need the first half. Until markets work end to end on staging: test markets with placeholder questions, and the perp on a stand-in price (3.4a). Then the topics: 1.2 (parked; the research is reference only), resolvers (3.2a), series (3.2b), the perp's real feed (3.4b).
- **Step 1.5, split:** 1.5a the speed check; 1.5b journey tests; 1.5c the typed API (oRPC, contract first, 1.x); 1.5d the empty app on the founder's phone, answering from public staging. Then 1.8, parallel local development.
- **Design (1.4):** real code on previews, from the founder's references and the agreement's examples; shared values, light and dark, a design log; checks for speed, fit and readable text only. Core screens: the board, a story page, a market page with placeholder questions; the rest is the design chat's call.
- **Sign-in:** 1.6a the website's, no passwords (an access-token hook); 1.6b the app's; Apple with the iPhone (4.3). **Expo:** the founder's account, a robot token for Claude Code.
- **Content:** three credited routes (found, made, posted); no money in ranking. **Checks come first;** no tables before a half is Agreed; production only through the release pipeline.

## What changed in the latest session

On 8 November 2026, in [#40](https://github.com/Zugzwang-world/hrizzup/pull/40) (Round 2, relay 6, records only), the founder's decisions on the markets and on how Product works:

- **PLAN.md:** the market model and its build order (sections 2 and 5; 1.2 parked, needing 3.1; needs kept), the two tracks and 1.4's three core screens (sections 3 to 5), open questions (section 7).
- **`TRACKER.md`:** the markets track, with 1.2 parked.
- **Also:** the research marks its market data as reference; the blueprint names the engine's calls; the milestones follow.

## Open questions

- **Embedding found posts** (2.3): one X embed alone downloads about 330 KB of code and 440 KB in all (measured 8 November 2026), more than a page's whole budget, and the Speed check counts embeds. Recommendation: keep the founder's rule (the original post, embedded, never copied), loading each embed only as it nears the screen, with a placeholder holding its space and the creator's credit (Lighthouse's own advice for heavy embeds); the app does the same in its web view.
- **The agreement's market shape predates the market model:** its markets settle themselves from a subject's data slot, name no source or rules, and use other states. Recommendation: revise it in place (still version 1) before the founder approves the first half; data readings and market subjects leave it until 1.2.
- **Admins before the admin page** (1.7c, 1.7d). Recommendation: an admin flag on the account, set only by a reviewed migration and checked on every create and settle.
- **Which track builds each feature's screens** (stages 4a, 4b). Recommendation: the round's relays, from the design chat's approved design; the design chat reviews them on previews.
- **Sign-in for the board's favourites** (2.1): add 1.6a to 2.1's needs, 1.6b to its app join.
- **Vercel's bot challenge and the app** (1.5d): test first; if challenged, a staging-only firewall rule lets the API skip it.
- **oRPC 2.0 late:** start on 1.x. **Tool tokens:** the Doppler check fails on a `hrizzup-tools` name in `stg`. **Dependabot's three alerts:** one small change raising them; find out why it opened none.
- **Market fee** (1.7a): zero behind one setting, `TAKER_FEE_RATE`. Recommendation: zero at launch; a later fee must settle how a cancel refunds it.
- **A cancel takes back sale profits** (1.7b): a negative payout, which can leave a trader below zero. Recommendation: as Manifold, the balance shows what's owed; cancel only markets that can't be settled fairly.
- **The trade call must refuse** (1.7d) what the maths lets through: limits outside 1% to 99%, an expiry of 0, amounts not positive or above the balance.
- **Also open, with recommendations:** shared code (contract, data fetching, validation); X's own embed for found posts; perps' first settings (5-second prices, a 0.1% opening fee, hourly funding, a made-up stand-in price); Turnstile in a web view; background jobs on Supabase Cron and Queues.

## For the founder

- **Replace the Expo token** (runbook step 4.6, about 5 minutes).
- **1.4's first pass and the agreement:** the board and a story page need the first half Agreed. Recommendation: draw them on the Draft's examples now; approve them once it's Agreed.
- **Approve the agreement's first half** in News Desk's place (the review's "In short"). Recommendation: first let Product bring its market shape in line with the market model, so what you approve matches PLAN.md. Then Product may build its tables.
- **Sourcing's three questions** (the review's F1 to F3, none holding up the approval). Recommended: found takes in English only; takedown requests to you at a `hrizzup.com` address, handled within 24 hours; a lawyer's check before launch.
- **In the design chat, the remaining screens:** up front or feature by feature? Recommendation: feature by feature, each just ahead of its contract stage; the app frame with the board.
- **Install the app** on your Android phone when 1.5d shares its link.
- **Posting on the website** (2.4): both surfaces. **The closed test (2.6):** start without News Desk's content. **Free and paid** (2.7): reading and betting free; play money never sold.
- Alongside: the developer accounts (0.4), 12 or more Google Play testers, setting up News Desk. Market data needs nothing now: 1.2 is parked.

## What's next

1. **Round 2:** relays 2 to 4 (5 and 6 are done); the market shape's revision; the founder approves the first half.
2. **Parallel local development (1.8),** then sign-in: 1.6a with the hook, then 1.6b.
3. **The first feature round** through `TRACKER.md`; alongside, the markets track in its build order.

## Read for detail

- `PLAN.md` (sections 2, 3, 5, 7), `TRACKER.md` (the round, the features' stages, the markets track), `CLAUDE.md` ("Unattended sessions").
- `docs/setup/BLUEPRINT.md` (Expo 2, public staging 6, keys 7, sign-in 9, the typed API and the engine's calls 13, budgets 14) and `docs/setup/RUNBOOK.md` (keys, Part 4; the pre-launch checklist).
- `agreement/README.md`: sign-offs, decisions, fields, lists; `agreement/reviews/sourcing-first-half.md`: Sourcing's review, with notes for Product (N12 to N14).
- `docs/research/round-2-readiness.md`, `docs/research/manifold.md`: the research behind Round 2 and the engine (market data: reference only).
- `product/packages/market-engine/README.md`: the maths copied from Manifold, every change, the money tests.
- `docs/status/product.md`: Product's status in full, with each session's own answers.
