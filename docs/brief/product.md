# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 9 November 2026, after Round 2's relays 1, 2 and 6. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It displays content that arrives through the hand-over agreement (`agreement/README.md`), whose first half Product drafts.

## Where things stand

- **Staging** (`staging.hrizzup.com`, Mumbai) is public since 1.5d, asking search engines to stay out; previews still need Vercel's login; production is a quiet twin; the rest is parked (runbook, pre-launch checklist).
- **Built:** a holding page, legal drafts, a sign-in test page, `/api/health`, the typed API (`/api/v1`: health, who am I), a one-screen app showing staging's answer (on the founder's phone), shared packages and Manifold's yes/no maths (`product/packages/market-engine`).
- **Required checks:** Secret, Quick, Database, Screen (with the website's journeys), Speed and App journeys.
- **The agreement's first half,** reviewed by Sourcing, is a Draft awaiting the founder's approval, so no tables for its shapes. Its market now follows the market model ([#52](https://github.com/Zugzwang-world/hrizzup/pull/52)). For screens: a post gone from X shows nothing; credits use X's current names; updates name their sources; merges point onward.

## Round 2 progress

One line per relay; each relay keeps only its own line current.

1. **Relay 1, the round's records:** merged [#36](https://github.com/Zugzwang-world/hrizzup/pull/36), its follow-up [#53](https://github.com/Zugzwang-world/hrizzup/pull/53) (the Doppler names check) and [#57](https://github.com/Zugzwang-world/hrizzup/pull/57) (the Expo token checked in its right place). Next: the names check's jobs' half, [#54](https://github.com/Zugzwang-world/hrizzup/pull/54), now unblocked. Nothing for the founder.
2. **Relay 2, steps 1.5a to 1.5d:** done: [#41](https://github.com/Zugzwang-world/hrizzup/pull/41) (the Speed check), [#47](https://github.com/Zugzwang-world/hrizzup/pull/47) (journey tests), [#48](https://github.com/Zugzwang-world/hrizzup/pull/48) (the typed API), [#49](https://github.com/Zugzwang-world/hrizzup/pull/49), [#51](https://github.com/Zugzwang-world/hrizzup/pull/51), [#55](https://github.com/Zugzwang-world/hrizzup/pull/55) and [#50](https://github.com/Zugzwang-world/hrizzup/pull/50) (staging public; the app answering from it). Next: nothing, relay 2 is done; the app is on the founder's phone.
3. **Relay 3, step 1.7a, Manifold's maths:** merged [#44](https://github.com/Zugzwang-world/hrizzup/pull/44), our money tests: no play money created or lost, over every trade and settlement and 41 random markets; 1.7a is done (201 tests pass, after [#38](https://github.com/Zugzwang-world/hrizzup/pull/38) and [#43](https://github.com/Zugzwang-world/hrizzup/pull/43)). Next: nothing, relay 3 is done. Three questions below.
4. **Relay 4, step 1.4's first pass:** first milestone [#39](https://github.com/Zugzwang-world/hrizzup/pull/39): the readable-text check and the design values package (three candidate directions, nothing on screen yet). Next: the three directions as working boards on preview links, for the founder to choose.
5. **Relay 5, Sourcing's review of the agreement's first half:** done: the review [#37](https://github.com/Zugzwang-world/hrizzup/pull/37), its changes [#42](https://github.com/Zugzwang-world/hrizzup/pull/42) and [#45](https://github.com/Zugzwang-world/hrizzup/pull/45); the first half awaits the founder's approval. For the founder: approve it; three questions.
6. **Relay 6, the market model and the two tracks:** merged [#40](https://github.com/Zugzwang-world/hrizzup/pull/40) (the records) and [#52](https://github.com/Zugzwang-world/hrizzup/pull/52) (the agreement's market, as the founder asked). Next: nothing, relay 6 is done. For the founder: approve the first half; the remaining screens, in the design chat.

## Decisions in force

- **Two surfaces, one account:** the app (news and social, no play money) and the website (news and play-money markets); English; India first.
- **In parallel, the website a stage ahead** (`TRACKER.md`): design, contract, back end, both screens, the website's join, the app's. App only: 1.6b, 2.5, 2.6, 4.3, 4.5; website only: the markets.
- **Two tracks:** design in the founder's design chat, engineering in each round's chat; they meet at each feature's contract stage.
- **Markets:** data (question, outcomes, rules, open and close times, a named settlement source, a status), created only by Hrizzup, settled by hand (admin only, logged) or by our resolver at the close; no outside oracle or disputes; the perp prices itself from a live feed. **Order:** 1.7a maths (done), 1.7b ledger, 1.7c hand-settled markets, 1.7d market calls in the typed API, 3.1 market pages (1.7b and 1.7c need the first half), on test markets and a stand-in perp price (3.4a) until they work on staging; then 1.2 (parked), resolvers (3.2a), series (3.2b), the perp's feed (3.4b).
- **Design (1.4):** real code on previews, from the founder's references and the agreement's examples; shared values, light and dark, a design log; first the board, a story page and a market page.
- **Sign-in:** 1.6a the website's, passwordless (an access-token hook); 1.6b the app's; Apple with the iPhone (4.3). **Expo:** the founder's account (`hrizzups-team`), a robot token for Claude Code.
- **Content:** three credited routes (found, made, posted); no money in ranking. Production only through the release pipeline.

## What changed in the latest session

On 9 November 2026, in [#52](https://github.com/Zugzwang-world/hrizzup/pull/52) (Round 2, relay 6), the agreement's first half took the founder's market model, at his request (still Draft, version 1):

- **The market** now holds its rules, a named settlement source (a name, and a link when public) and how it settles (`by_hand` or `automatic`), in five states (draft, open, closed, settled, cancelled). The topic-only fields are gone; a resolver's fields can join later as optional ones.
- **Data readings and the market subjects list left the first half,** to return with the topics (1.2), so approving it fixes no topic the founder parked.
- **The example markets are placeholder test markets** in every state, both kinds, settled both ways.
- **Nothing Sourcing writes, reads or checks changed;** the founder's seven decisions stand.

Also on 9 November: relay 2 finished step 1.5 ([#41](https://github.com/Zugzwang-world/hrizzup/pull/41), [#47](https://github.com/Zugzwang-world/hrizzup/pull/47), [#48](https://github.com/Zugzwang-world/hrizzup/pull/48), [#49](https://github.com/Zugzwang-world/hrizzup/pull/49), [#51](https://github.com/Zugzwang-world/hrizzup/pull/51), [#55](https://github.com/Zugzwang-world/hrizzup/pull/55), [#50](https://github.com/Zugzwang-world/hrizzup/pull/50); the founder installed the app on his phone), and relay 1 added the Doppler names check ([#53](https://github.com/Zugzwang-world/hrizzup/pull/53)) and checked the Expo token in `hrizzup-tools`, a robot's ([#57](https://github.com/Zugzwang-world/hrizzup/pull/57)); their lines above and `docs/status/product.md` have the detail.

## Open questions

- **The typed API in production:** production's bot challenge would block the app's `/api/v1` calls (staging's skip it, behind a rate limit). Recommendation: the same two rules for production through the release pipeline, which first needs a step that applies Vercel settings (today it only checks them).
- **Cold start on a real phone:** the CI emulator takes 3 to 4 s for the empty app against a phone's 2 s budget, so its check catches only clear regressions. Recommendation: time a real mid-range Android phone before launch (Firebase Test Lab's free quota, or the founder's).
- **Embedding found posts** (2.3): one X embed is about 330 KB of code, over a page's whole budget. Recommendation: keep the original post embedded, loading each only as it nears the screen, behind a placeholder holding its space and credit.
- **Admins before the admin page** (1.7c, 1.7d). Recommendation: an account flag set only by a reviewed migration, checked on every create and settle.
- **Who builds each feature's screens** (4a, 4b). Recommendation: the round's relays, from the design chat's approved design, reviewed there on previews.
- **Sign-in for the board's favourites** (2.1). Recommendation: 1.6a joins 2.1's needs, and 1.6b its app join.
- **The markets' maths** (relay 3), recommended: a zero fee behind `TAKER_FEE_RATE`, a later fee settling how cancels refund it (1.7a); a cancel takes back sale profits, as Manifold's does, the balance showing what's owed (1.7b); the trade call refuses limits outside 1% to 99%, an expiry of 0, and amounts not positive or over the balance (1.7d).
- **Also open, recommendations in the status file:** the app's Hermes rewrite of oRPC's code (keep it until oRPC 2.0, its own change); Dependabot's three alerts; shared code (contract, data fetching, validation); perps' first settings (5-second prices, a 0.1% opening fee, hourly funding); Turnstile in a web view; background jobs on Supabase Cron and Queues.

## For the founder

- **Approve the agreement's first half** in News Desk's place: its market now follows your model ([#52](https://github.com/Zugzwang-world/hrizzup/pull/52)); Sourcing agreed it before that change, which touches nothing Sourcing writes or reads. **Sourcing's three questions** (F1 to F3), recommended: found takes in English only; takedown requests to a `hrizzup.com` address, answered within 24 hours; a lawyer's check before launch.
- **Design:** the board and a story page on the Draft's examples now, approved once it's Agreed; the other screens feature by feature in the design chat, just ahead of each contract stage.
- **Spending, not now:** a speed check from India (Calibre Starter, $75 a month, Mumbai) once the board (2.1) exists; Expo's Maestro job (about $60 a month) only if the emulator check proves flaky.
- **Three decisions, recommended:** posting on the website (2.4): both surfaces; the closed test (2.6): start without News Desk's content; free and paid (2.7): reading and betting free, play money never sold. **Alongside:** the developer accounts (0.4), 12 or more Google Play testers, setting up News Desk.

## What's next

1. **Round 2:** relay 4's design pass; the founder's approval of the first half.
2. **Parallel local development (1.8),** then sign-in: 1.6a with the hook, then 1.6b.
3. **The first feature round** through `TRACKER.md`, with the markets track alongside in its order.

## Read for detail

- `PLAN.md` (sections 2, 3, 5, 7), `TRACKER.md`, `CLAUDE.md` ("Unattended sessions").
- `docs/setup/BLUEPRINT.md` (Expo 2, public staging 6, keys 7, sign-in 9, the typed API 13, budgets 14), `docs/setup/RUNBOOK.md` (keys, Part 4; the pre-launch checklist), `docs/setup.md` (what was set, day by day).
- `product/web/e2e/pages.ts` (pages and budgets), `product/packages/api` (the contract), `product/README.md` (the app's builds).
- `agreement/README.md`; `agreement/reviews/sourcing-first-half.md` (Sourcing's review; N12 to N14 are Product's).
- `docs/research/round-2-readiness.md`, `docs/research/manifold.md`, `product/packages/market-engine/README.md`.
- `docs/status/product.md`: Product's status in full, with each session's own answers.
