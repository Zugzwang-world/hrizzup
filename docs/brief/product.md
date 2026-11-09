# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 9 November 2026 by Round 3's relay 1b, correcting the round's records about Sourcing. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** a holding page, legal drafts, a sign-in test page, the typed API (health, who am I), a one-screen app showing staging's answer (on the founder's phone) and Manifold's yes/no maths (1.7a). No tables yet; the first migration locks every table.
- **Required checks:** Secret, Quick, Database, Screen (with the website's journeys), Speed and App journeys.
- **Design** restarts in the design chat, from the founder's references and diagrams; no design values exist yet.
- **Round 3 has started** (the milestone "Round 3"): relays 1 to 12, with 1b, in waves; relays 4, 10 and 11 are cancelled (`TRACKER.md`).

## Round 3 progress

One line per relay; each relay keeps only its own line current.

1. **Relay 1, the round's records:** [#60](https://github.com/Zugzwang-world/hrizzup/pull/60) records the founder's decisions of 9 November and Round 3's queue. Next: nothing; relay 1 is done. Nothing for the founder.

1b. **Relay 1b, correcting the records about Sourcing:** [#61](https://github.com/Zugzwang-world/hrizzup/pull/61): no xAI API; Sourcing's work runs in its own project; relays 4, 10 and 11 cancelled. Next: nothing; relay 1b is done. Nothing for the founder.

2. **Relay 2, step 1.8 with the database-order check (wave 1):** in progress.

3. **Relay 3, hardening (wave 1):** in progress.

4. **Relay 4, Sourcing's research for step 0.8:** cancelled by the founder (9 November).

5. **Relay 5, step 1.6a, the website's sign-in (wave 2, after 1.8):** not started.

6. **Relay 6, step 1.7b, the ledger (wave 2):** not started.

7. **Relay 7, step 1.9, the content store's tables (wave 2, when a slot is free):** not started.

8. **Relay 8, step 1.7c, markets as data and the console (after wave 2):** not started.

9. **Relay 9, step 1.7d, list, trade and positions (after 1.7c):** not started.

10. **Relay 10, Sourcing's test bot run and the second half's draft:** cancelled by the founder (9 November).

11. **Relay 11, Product's review of that draft:** cancelled by the founder (9 November).

12. **Relay 12, the round's closing record (last):** not started.

## Decisions in force

- **Two surfaces, one account:** the app (news and social) and the website (news and play-money markets); English; India first.
- **In parallel, the website a stage ahead** (`TRACKER.md`), in **two tracks:** design in the founder's design chat, engineering in each round's chat, meeting at each feature's contract stage. Website only: the markets.
- **Design (1.4):** only from the founder's references and diagrams. **One exception:** internal tools only admins see (the market console), built from stock components with no look of their own. The real sign-in screen comes from the design chat; 1.6a proves the flows on the sign-in test page.
- **Database changes land first:** each in its own pull request, adding only, so staging keeps working; the code follows in the next. Previews share staging's database. A check keeps each pull request's changes after the newest on `main` (with 1.8).
- **The content store (1.9):** tables for story, update, sourced item and creation, plus the launch list, with the agreement's rules as database rules, tested against every agreement example; unused until the pipeline (1.1) and each feature's back end.
- **Sourcing and Product:** Hrizzup uses no xAI API; Grok bots source everything, and Sourcing's work runs in its own project, on its own schedule. **Product never uses xAI's API or X's API:** it receives what it shows through 1.9's tables, and X's own embed (2.3) is display. Product reviews the agreement's second half once Sourcing designs it.
- **Markets:** data, created only by Hrizzup, settled by hand or by our resolver at the close.
  - **The books (1.7b):** double-entry play money in exact decimals, always summing to zero, remainders to a house account; one transaction per trade, one at a time per market, a request ID per trade; never below zero but through a cancel; expiry checked inside each trade.
  - **Admins and the console (1.7c):** a table only reviewed migrations write, which no app role can write and the database checks on every create, open, close and settle (calls in the typed API); everyone but an admin gets "not found".
  - **1.7d:** list, trade and positions, refusing limits outside 1% to 99%, a zero expiry, and amounts not positive or over the balance.
  - **Money:** no fee at launch; cancelled only when it can't be settled fairly. **Order:** 1.7a (done), 1.7b, 1.7c, 1.7d, 3.1, the perp on a stand-in price (3.4a, on Supabase Cron); then 1.2 (parked), 3.2a, 3.2b, 3.4b.
- **Background jobs:** none in Round 3; the choice is Sourcing's, made in its own project.
- **Sign-in:** 1.6a the website's, passwordless; 1.6b the app's; Apple with the iPhone (4.3).
- **Content:** three credited routes; found takes in English only; no money in ranking. **Legal** is the founder's legal team's. Production only through the release pipeline.

## What changed in the latest session

On 9 November 2026, in [#61](https://github.com/Zugzwang-world/hrizzup/pull/61) (Round 3, relay 1b, records only), the founder's decision, replacing what relay 1 recorded about Sourcing:

- **No xAI API;** Sourcing's work runs in its own project, never from the Product round chat (PLAN.md sections 2 and 4, step 0.8).
- **Product never uses xAI's API or X's API,** a new CLAUDE.md rule; X's embed stays as decided.
- **Relays 4, 10 and 11 cancelled,** numbers kept; relay 4 had opened no pull request.
- **Background jobs:** Sourcing's choice, in its own project; Product's review of it went with the cancelled relays.
- **Sourcing's review** gained a dated note: its xAI notes no longer apply; its findings stand.

## Open questions

- **The app's database role** (1.7b, 1.7c): the app connects as Supabase's `postgres` user, which owns every table, so "no app role can write the admins table" can't hold yet. Recommendation: a least-privilege role of the app's own, switched to in every transaction (`SET LOCAL ROLE`) with the signed-in account set there; built in 1.7b, with a test.
- **Creators' X accounts** (2.4; the review's N13): linking one needs the creator's opt-in, and Product can't use X's sign-in. Recommendation: the link comes with the invitation, which News Desk checks outside the product.
- **Embedding found posts** (2.3): one X embed is about 330 KB of code, over a page's budget. Recommendation: load each only as it nears the screen, behind a placeholder holding its space and credit.
- **Also open, recommendations in the status file:** the Hermes rewrite; shared code; perps' first settings; Turnstile in a web view.

## For the founder

- **Design:** give your references and diagrams in the design chat. Recommendation: the board and a story page first, then the other screens feature by feature, the sign-in screen among them.
- **Spending, not now:** a speed check from India (Calibre, $75 a month) once the board exists; Expo's Maestro job (about $60 a month) only if the emulator check proves flaky; a database per pull request only if database-first slows features.
- **Three decisions, recommended:** posting on the website (2.4): both surfaces; the closed test (2.6): start without News Desk's content; free and paid (2.7): reading and betting free, play money never sold. **Alongside:** the developer accounts (0.4), 12 Google Play testers, News Desk.
- **Parked until launch:** the runbook's pre-launch checklist, with P.16 (your admin row on production).

## What's next

Round 3's queue (`TRACKER.md`): wave 1 now (relays 1, 1b, 2, 3); wave 2 after 1.8 (relays 5 to 7); then 1.7c (relay 8), 1.7d (relay 9) and the closing record (relay 12). Then the market pages (3.1), the app's sign-in (1.6b), and the board once 1.4's core screens are approved. Product reviews the second half whenever Sourcing designs it.

## Read for detail

- `PLAN.md` (sections 2 to 5, 7), `TRACKER.md` (Round 3's queue), `CLAUDE.md` ("Unattended sessions", "Database changes", "Design", "The hand-over agreement").
- `docs/setup/BLUEPRINT.md` (the database, the books and admins 5; staging 6; sign-in 9; the typed API and the console 13; budgets 14), `docs/setup/RUNBOOK.md` (the pre-launch checklist), `docs/setup.md` (the setup log).
- `product/packages/api` (the contract), `product/README.md` (the app's builds).
- `agreement/README.md`; `agreement/reviews/sourcing-first-half.md` (N12 to N14 are Product's).
- `product/packages/market-engine/README.md` (the maths); `docs/research/manifold.md` (Manifold's engine).
- `docs/status/product.md`: Product's status in full, with each session's own answers.
