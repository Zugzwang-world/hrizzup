# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 9 November 2026 with relay 1's two more records (1c): how rounds run, and the perp in two steps. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** a holding page, legal drafts, a sign-in test page, the typed API (health, who am I), a one-screen app on the founder's phone and Manifold's yes/no maths (1.7a). No tables yet.
- **Required checks:** Secret, Quick, Database, Screen (with the website's journeys), Speed and App journeys.
- **Design** restarts in the design chat, from the founder's references and diagrams; no design values exist yet.
- **Round 3 has started** (the milestone "Round 3"): relays 1 to 12, with 1b, in waves; relays 4, 10 and 11 are cancelled (`TRACKER.md`).

## Round 3 progress

One line per relay; each relay keeps only its own line current.

1. **Relay 1, the round's records:** [#60](https://github.com/Zugzwang-world/hrizzup/pull/60) records the founder's decisions of 9 November and Round 3's queue; [#62](https://github.com/Zugzwang-world/hrizzup/pull/62) (1c) records how rounds run and the perp in two steps. Next: nothing; relay 1 is done. For the founder: the perp's opening fee, before the next round.

1b. **Relay 1b, correcting the records about Sourcing:** [#61](https://github.com/Zugzwang-world/hrizzup/pull/61). Done; nothing for the founder.

2. **Relay 2, step 1.8 with the database-order check (wave 1):** done. [#64](https://github.com/Zugzwang-world/hrizzup/pull/64) gives each session a slot on this Mac (its own website and Metro ports, database and Redis prefix; `infra/slots/slot claim`, CLAUDE.md "Parallel sessions"). **This Mac holds four slots: three for a round's relays at once, one kept for the design chat**, so wave 2's three relays fit. [#68](https://github.com/Zugzwang-world/hrizzup/pull/68) lets every slot sign in and upload against staging (applied to staging; proven from three slots side by side, 18 of 18). [#66](https://github.com/Zugzwang-world/hrizzup/pull/66) adds the database-order check to the required Database check: a pull request's new migrations must come after main's newest, and a one-line lock makes a second migration pull request rebase once the first merges. Next: nothing; relay 2 is done. Nothing for the founder.

3. **Relay 3, hardening (wave 1):** [#63](https://github.com/Zugzwang-world/hrizzup/pull/63): every tool the checks download is pinned, kept in GitHub's cache by its pin and fetched signed in, with retries (the 504s were GitHub's incident with anonymous downloads). Next: the release pipeline's key check, then the Screen check's keys and Dependabot's three alerts. Nothing for the founder.

4. **Relay 4, Sourcing's research for step 0.8:** cancelled by the founder (9 November).

5. **Relay 5, step 1.6a, the website's sign-in (wave 2, after 1.8):** [#70](https://github.com/Zugzwang-world/hrizzup/pull/70) adds the access-token hook that refuses password sessions, switched off; the Database check's tests prove both sides (email codes, Google, the test accounts' tokens and refreshes pass; passwords are refused). Next: email codes on the sign-in test page, then the hook switched on for staging. Nothing for the founder yet.

6. **Relay 6, step 1.7b, the ledger (wave 2):** the tables, [#69](https://github.com/Zugzwang-world/hrizzup/pull/69): the double-entry books and the markets in exact decimals, the app's own database role, and the database's own checks of every trade, arriving on staging empty. Next: the trade code with its tests (milestone 2). Nothing for the founder yet.

7. **Relay 7, step 1.9, the content store's tables (wave 2, when a slot is free):** not started.

8. **Relay 8, step 1.7c, markets as data and the console (after wave 2):** not started.

9. **Relay 9, step 1.7d, list, trade and positions (after 1.7c):** not started.

10. **Relay 10, Sourcing's test bot run and the second half's draft:** cancelled by the founder (9 November).

11. **Relay 11, Product's review of that draft:** cancelled by the founder (9 November).

12. **Relay 12, the round's closing record (last):** not started.

## Decisions in force

- **Two surfaces, one account:** the app (news and social) and the website (news and play-money markets); English; India first.
- **In parallel, the website a stage ahead** (`TRACKER.md`), in **two tracks:** design in the founder's design chat, engineering in each round's chat, meeting at each feature's contract stage. Website only: the markets.
- **How rounds run:** relays run side by side only when their work is independent; work that builds on other work runs after it.
- **Design (1.4):** only from the founder's references and diagrams, the real sign-in screen included (1.6a proves the flows on the test page). **One exception:** internal tools only admins see (the market console): stock components, no look of their own.
- **Database changes land first:** each in its own pull request, adding only, the code following in the next, since previews share staging's database; a check keeps them in order (with 1.8).
- **The content store (1.9):** tables for the agreement's shapes and the launch list, its rules as database rules, tested against every agreement example; unused until the pipeline (1.1) and each feature's back end.
- **Sourcing and Product:** no xAI API; Grok bots source everything, and Sourcing works in its own project. **Product never uses xAI's or X's API:** content arrives through 1.9's tables; X's own embed (2.3) is display. Product reviews the second half once Sourcing designs it.
- **Markets:** data, created only by Hrizzup, settled by hand or by our resolver at the close.
  - **The books (1.7b):** double-entry play money in exact decimals, summing to zero, remainders to a house account; one transaction per trade, one at a time per market, a request ID each; never below zero but through a cancel.
  - **Admins and the console (1.7c):** a table only reviewed migrations write, checked by the database on every create, open, close and settle (typed-API calls); others get "not found".
  - **1.7d:** list, trade and positions, refusing limits outside 1% to 99%, a zero expiry, and amounts not positive or over the balance.
  - **The perp,** on a stand-in price: its back end (3.4a: Manifold's perps maths with our money tests, its books, Supabase Cron checks, typed-API calls) needs only 1.7d, and its maths its first settings; its page (3.4c) follows 3.1.
  - **Money:** no fee at launch; cancelled only when it can't be settled fairly. **Order:** 1.7a (done), 1.7b, 1.7c, 1.7d, then 3.4a and 3.1, then 3.4c; then 1.2 (parked), 3.2a, 3.2b, 3.4b.
- **Background jobs:** none in Round 3; the choice is Sourcing's, made in its own project.
- **Sign-in:** 1.6a the website's, passwordless; 1.6b the app's; Apple with the iPhone (4.3).
- **Content:** three credited routes; found takes in English only; no money in ranking. **Legal** is the founder's legal team's. Production only through the release pipeline.

## What changed in the latest session

On 9 November 2026, in [#62](https://github.com/Zugzwang-world/hrizzup/pull/62) (Round 3, relay 1c, records only), what the Product chat settled at the founder's request:

- **How rounds run:** side by side only when independent (PLAN.md, CLAUDE.md).
- **3.4a split:** the perp's back end (3.4a, needing 1.7d, not 3.1) and its page (new 3.4c, needing 3.1 and 3.4a); 3.4b unchanged.
- **Nothing added to Round 3:** the perp starts the next round.

Just before, [#61](https://github.com/Zugzwang-world/hrizzup/pull/61) (relay 1b): no xAI API; Sourcing works in its own project; relays 4, 10 and 11 cancelled.

## Open questions

- **The app's database role** (1.7b, 1.7c): the app connects as Supabase's `postgres` user, which owns every table, so the admins table can't yet refuse it. Recommendation: the app's own least-privilege role, switched to in every transaction (`SET LOCAL ROLE`); built in 1.7b, with a test.
- **Creators' X accounts** (2.4; the review's N13): linking one needs the creator's opt-in, and Product can't use X's sign-in. Recommendation: the link comes with the invitation, which News Desk checks outside the product.
- **The perp's first settings** (3.4a's maths waits for them). Recommendation, from Manifold's perps: a price every 5 seconds; a 0.1% opening fee, closing free; hourly funding by its formula; a seeded stand-in price; a log table of rule changes.
- **Embedding found posts** (2.3): one X embed is about 330 KB of code, over a page's budget. Recommendation: load each only as it nears the screen, behind a placeholder holding its space and credit.
- **Also open, recommendations in the status file:** the Hermes rewrite; shared code; Turnstile in a web view.

## For the founder

- **The perp's opening fee** (a money rule), before the next round. Recommendation: 0.1% of the position on opening, closing free (Manifold's base rate).
- **Design:** give your references and diagrams in the design chat. Recommendation: the board and a story page first, then the rest feature by feature (the sign-in screen and the perp's page among them).
- **Spending, not now:** a speed check from India (Calibre, $75 a month) once the board exists; Expo's Maestro job (about $60 a month) only if the emulator proves flaky; a database per pull request only if database-first slows features.
- **Three decisions, recommended:** posting on the website (2.4): both surfaces; the closed test (2.6): start without News Desk's content; free and paid (2.7): reading and betting free, play money never sold. **Alongside:** the developer accounts (0.4), 12 Google Play testers, News Desk.
- **Parked until launch:** the runbook's pre-launch checklist, with P.16 (your admin row on production).

## What's next

Round 3's queue, with nothing added (`TRACKER.md`): wave 1 (relays 1, 1b, 2, 3); wave 2 after 1.8 (5 to 7); then 1.7c (8), 1.7d (9) and the closing record (12). The next round starts with the perp's back end (3.4a); then 3.1 and 3.4c, the app's sign-in (1.6b), and the board once 1.4's core screens are approved. Product reviews the second half whenever Sourcing designs it.

## Read for detail

- `PLAN.md` (sections 2 to 5, 7), `TRACKER.md` (Round 3's queue), `CLAUDE.md` ("Unattended sessions", "Database changes", "Design", "The hand-over agreement").
- `docs/setup/BLUEPRINT.md` (database, books, admins 5; staging 6; sign-in 9; typed API, console 13; budgets 14), `docs/setup/RUNBOOK.md` (pre-launch checklist).
- `product/packages/api` (the contract), `product/README.md` (the app's builds).
- `agreement/README.md`; `agreement/reviews/sourcing-first-half.md` (N12 to N14 are Product's).
- `product/packages/market-engine/README.md` (the maths); `docs/research/manifold.md` (Manifold's engine and perps).
- `docs/status/product.md`: Product's status in full.
