# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 9 November 2026, at Round 2's close (relay 7). PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It displays content that arrives through the hand-over agreement (`agreement/README.md`), whose first half Product drafted.

## Where things stand

- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login; production is a quiet twin.
- **Built:** a holding page, legal drafts, a sign-in test page, the typed API (health, who am I), a one-screen app showing staging's answer (on the founder's phone) and Manifold's yes/no maths.
- **Required checks:** Secret, Quick, Database, Screen (with the website's journeys), Speed and App journeys.
- **The agreement's first half is Agreed** (9 November 2026, the founder approving it in News Desk's place), so Product may build tables and content for its shapes: the ledger (1.7b), markets (1.7c) and every feature's back end no longer wait.
- **Design** restarts in the design chat, from the founder's references and diagrams; no design values exist yet.

## Round 2 progress

One line per relay; each relay keeps only its own line current. Round 2 closes with relay 7.

1. **Relay 1, the round's records:** merged [#36](https://github.com/Zugzwang-world/hrizzup/pull/36), its follow-up [#53](https://github.com/Zugzwang-world/hrizzup/pull/53) (the Doppler names check), [#57](https://github.com/Zugzwang-world/hrizzup/pull/57) (the Expo token checked in its right place) and [#54](https://github.com/Zugzwang-world/hrizzup/pull/54) (the names check in the Staging workflow and the Screen check). Next: nothing, relay 1 is done. Nothing for the founder.
2. **Relay 2, steps 1.5a to 1.5d:** done: [#41](https://github.com/Zugzwang-world/hrizzup/pull/41) (the Speed check), [#47](https://github.com/Zugzwang-world/hrizzup/pull/47) (journey tests), [#48](https://github.com/Zugzwang-world/hrizzup/pull/48) (the typed API), [#49](https://github.com/Zugzwang-world/hrizzup/pull/49), [#51](https://github.com/Zugzwang-world/hrizzup/pull/51), [#55](https://github.com/Zugzwang-world/hrizzup/pull/55) and [#50](https://github.com/Zugzwang-world/hrizzup/pull/50) (staging public; the app answering from it). Next: nothing, relay 2 is done; the app is on the founder's phone.
3. **Relay 3, step 1.7a, Manifold's maths:** merged [#44](https://github.com/Zugzwang-world/hrizzup/pull/44), our money tests: no play money created or lost, over every trade and settlement and 41 random markets; 1.7a is done (201 tests pass, after [#38](https://github.com/Zugzwang-world/hrizzup/pull/38) and [#43](https://github.com/Zugzwang-world/hrizzup/pull/43)). Next: nothing, relay 3 is done. Three questions below.
4. **Relay 4, step 1.4's first pass:** retired by the founder (9 November): [#46](https://github.com/Zugzwang-world/hrizzup/pull/46) closed unmerged; [#58](https://github.com/Zugzwang-world/hrizzup/pull/58) removes [#39](https://github.com/Zugzwang-world/hrizzup/pull/39)'s design values and keeps its readable-text check (`@hrizzup/core`). Next: nothing, relay 4 is done; 1.4 restarts in the design chat, from the founder's references and diagrams.
5. **Relay 5, Sourcing's review of the agreement's first half:** done: the review [#37](https://github.com/Zugzwang-world/hrizzup/pull/37), its changes [#42](https://github.com/Zugzwang-world/hrizzup/pull/42) and [#45](https://github.com/Zugzwang-world/hrizzup/pull/45); the first half awaits the founder's approval. For the founder: approve it; three questions.
6. **Relay 6, the market model and the two tracks:** merged [#40](https://github.com/Zugzwang-world/hrizzup/pull/40) (the records) and [#52](https://github.com/Zugzwang-world/hrizzup/pull/52) (the agreement's market, as the founder asked). Next: nothing, relay 6 is done. For the founder: approve the first half; the remaining screens, in the design chat.
7. **Relay 7, the closing record:** [#59](https://github.com/Zugzwang-world/hrizzup/pull/59) records the founder's decisions of 9 November, settling relays 3's, 5's and 6's questions for him, and Round 3's queue. Next: close the "Round 2" milestone and open "Round 3"; then relay 7 is done. Nothing for the founder.

## Decisions in force

- **Two surfaces, one account:** the app (news and social) and the website (news and play-money markets); English; India first.
- **In parallel, the website a stage ahead** (`TRACKER.md`): design, contract, back end, both screens, the website's join, the app's. Website only: the markets.
- **Two tracks:** design in the founder's design chat, engineering in each round's chat, meeting at each feature's contract stage. Each feature's screens are built by the round's relays from the design chat's approved design.
- **Design (1.4):** only from the founder's references and diagrams, given in the design chat, never a session's own choices; real code on previews, on the agreement's examples; first the board, a story page and a market page.
- **Markets:** data (question, outcomes, rules, times, a named settlement source, a status), created only by Hrizzup, settled by hand or by our resolver at the close; the perp prices itself from a live feed. **Admins:** a flag on the founder's account, set only by a reviewed migration, checked on every create and settle; they work in the **market console** (with 1.7c), creating markets and settling by hand the ones that don't settle automatically, every settlement logged. **Money:** no fee at launch; a market is cancelled only when it can't be settled fairly, taking back sale profits (the balance shows what's owed); the trade call refuses limits outside 1% to 99%, an expiry of zero, and amounts not positive or over the balance. **Order:** 1.7a (done), 1.7b, 1.7c, 1.7d, 3.1 on test markets, the perp on a stand-in price (3.4a); then 1.2 (parked), resolvers (3.2a), series (3.2b), the perp's feed (3.4b).
- **Sign-in:** 1.6a the website's, passwordless (an access-token hook), needed by the board (2.1) and the console (1.7c); 1.6b the app's, needed by the board's and posting's app joins; Apple with the iPhone (4.3).
- **Content:** three credited routes (found, made, posted); found takes in English only; no money in ranking. **Legal:** takedowns and legal review belong to the founder's legal team; the plan adds no legal guardrails. Production only through the release pipeline.

## What changed in the latest session

On 9 November 2026, in [#59](https://github.com/Zugzwang-world/hrizzup/pull/59) (Round 2, relay 7, records only), the founder's decisions:

- **The agreement's first half is Agreed,** wherever its status shows; News Desk reviews it once set up; any later change other than an optional field or an approved list item is a new format version.
- **Sourcing's questions:** found takes in English only (F1); takedowns and legal review belong to the founder's legal team (F2, F3).
- **Markets:** the console with 1.7c (which now needs 1.6a), admins and the money rules above.
- **Features:** the board needs 1.6a, its app join 1.6b; screens by the round's relays. The design pass's retirement ([#58](https://github.com/Zugzwang-world/hrizzup/pull/58)) holds in every record.
- **Pre-launch checklist:** production's firewall rules for the app's API, through the release pipeline (P.14); the app's cold start on a real phone (P.15).
- **Round 3's queue** (below); CLAUDE.md names the "Round 3" milestone.

## Open questions

- **Embedding found posts** (2.3): one X embed is about 330 KB of code, over a page's budget. Recommendation: load each only as it nears the screen, behind a placeholder holding its space and credit.
- **The admin migration** (1.7c): an account's ID differs between staging and production. Recommendation: a table of admins filled only by reviewed migrations naming the account's ID, staging's now and production's once his account exists there.
- **Also open, recommendations in the status file:** the Hermes rewrite (keep it until oRPC 2.0); shared code; our market tables; perps' first settings; Turnstile in a web view; background jobs on Supabase Cron and Queues.

## For the founder

- **Design:** give your references and diagrams in the design chat; step 1.4 starts from them. Recommendation: the board and a story page first; the other screens feature by feature, just ahead of each contract stage.
- **Spending, not now:** a speed check from India (Calibre, $75 a month) once the board exists; Expo's Maestro job (about $60 a month) only if the emulator check proves flaky.
- **Three decisions, recommended:** posting on the website (2.4): both surfaces; the closed test (2.6): start without News Desk's content; free and paid (2.7): reading and betting free, play money never sold. **Alongside:** the developer accounts (0.4), 12 Google Play testers, News Desk.
- **Parked until launch:** the runbook's pre-launch checklist, now with P.14 and P.15.

## What's next

**Round 3's queue** (the founder's order; `TRACKER.md`; the GitHub milestone "Round 3"):

1. **Parallel local development (1.8).**
2. **Side by side:** the website's sign-in, with the access-token hook (1.6a), and the ledger (1.7b).
3. **Markets as data, settled by hand (1.7c),** with the market console.
4. **Hardening** ([#54](https://github.com/Zugzwang-world/hrizzup/pull/54) has merged): the release pipeline refuses to release when production's keys include a name that isn't an app key; the Screen check loads only the keys its tests use; Dependabot's three open alerts get fixed.

Then 1.7d, the market pages (3.1), the app's sign-in (1.6b), and the board once the three core screens are approved.

## Read for detail

- `PLAN.md` (sections 2, 3, 4, 5, 7), `TRACKER.md` (Round 3's queue first), `CLAUDE.md` ("Unattended sessions", "Design").
- `docs/setup/BLUEPRINT.md` (staging 6, keys 7, sign-in 9, the typed API 13, budgets 14), `docs/setup/RUNBOOK.md` (the pre-launch checklist), `docs/setup.md` (the setup log).
- `product/packages/api` (the contract), `product/README.md` (the app's builds).
- `agreement/README.md`; `agreement/reviews/sourcing-first-half.md` (Sourcing's review and the founder's answers; N12 to N14 are Product's).
- `product/packages/market-engine/README.md` (the maths).
- `docs/status/product.md`: Product's status in full, with each session's own answers.
