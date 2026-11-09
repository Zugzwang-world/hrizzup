# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 10 November 2026 with relay 3's hardening, all four of its pull requests in. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** a holding page, legal drafts, the typed API, a one-screen app on the founder's phone, Manifold's maths (1.7a), the ledger (1.7b), the content store (1.9), the website's sign-in (1.6a) on its test page (Google and email codes; no passwords), markets as data with the admins' **market console** (1.7c, `staging.hrizzup.com/console`), and **list, trade and positions** in the typed API (1.7d), with no screens until the market pages (3.1).
- **Required checks:** Secret, Quick, Database, Screen (with the website's journeys), Speed and App journeys, free again since the repository went public on 10 November (GitHub's included minutes ran out on 9 November). Every tool they download is pinned and cached from `main`; a change to the checks runs every check.
- **Design** restarts in the design chat, from the founder's references and diagrams.

## Round 3 progress

One line per relay; each relay keeps only its own line current.

1. **Relay 1, the round's records:** [#60](https://github.com/Zugzwang-world/hrizzup/pull/60) records the founder's decisions of 9 November and Round 3's queue; [#62](https://github.com/Zugzwang-world/hrizzup/pull/62) (1c) records how rounds run and the perp in two steps. Next: nothing; relay 1 is done. For the founder: the perp's opening fee, before the next round.

1b. **Relay 1b, correcting the records about Sourcing:** [#61](https://github.com/Zugzwang-world/hrizzup/pull/61). Done; nothing for the founder.

2. **Relay 2, step 1.8 with the database-order check (wave 1):** done. [#64](https://github.com/Zugzwang-world/hrizzup/pull/64) gives each session a slot on this Mac (its own website and Metro ports, database and Redis prefix; `infra/slots/slot claim`, CLAUDE.md "Parallel sessions"). **This Mac holds four slots: three for a round's relays at once, one kept for the design chat**, so wave 2's three relays fit. [#68](https://github.com/Zugzwang-world/hrizzup/pull/68) lets every slot sign in and upload against staging (applied to staging; proven from three slots side by side, 18 of 18). [#66](https://github.com/Zugzwang-world/hrizzup/pull/66) adds the database-order check to the required Database check: a pull request's new migrations must come after main's newest, and a one-line lock makes a second migration pull request rebase once the first merges. Next: nothing; relay 2 is done. Nothing for the founder.

3. **Relay 3, hardening (wave 1):** done: [#63](https://github.com/Zugzwang-world/hrizzup/pull/63) the checks' downloads pinned, cached and retried (the 504s of 9 November were GitHub's incident with anonymous downloads); [#65](https://github.com/Zugzwang-world/hrizzup/pull/65) the release pipeline refuses production keys that aren't app keys, by name, before loading them, and a pipeline credential in `prd`; [#84](https://github.com/Zugzwang-world/hrizzup/pull/84) the Screen check asks for the ten keys its tests read, by name; [#85](https://github.com/Zugzwang-world/hrizzup/pull/85) Dependabot's three alerts fixed. Nothing for the founder.

4. **Relay 4, Sourcing's research for step 0.8:** cancelled by the founder (9 November).

5. **Relay 5, step 1.6a, the website's sign-in (wave 2):** done: the hook that refuses password sessions ([#70](https://github.com/Zugzwang-world/hrizzup/pull/70)), email codes beside Google on the sign-in test page ([#71](https://github.com/Zugzwang-world/hrizzup/pull/71)), and the hook switched on for staging ([#74](https://github.com/Zugzwang-world/hrizzup/pull/74); production at its next release). For the founder: one Google sign-in on staging (below).

6. **Relay 6, step 1.7b, the ledger (wave 2):** done: [#69](https://github.com/Zugzwang-world/hrizzup/pull/69) the tables (on staging, empty), [#73](https://github.com/Zugzwang-world/hrizzup/pull/73) the trade, each one transaction through the app's own database role. For the founder: the app's own database login, before launch (below).

7. **Relay 7, step 1.9, the content store's tables (wave 2):** done: [#72](https://github.com/Zugzwang-world/hrizzup/pull/72), the tables (on staging, empty), every agreement rule a database can hold as a database rule (`infra/supabase/content-store.md`), and 249 tests in the Database check. Nothing for the founder.

8. **Relay 8, step 1.7c, markets as data and the console:** done ([#75](https://github.com/Zugzwang-world/hrizzup/pull/75), [#76](https://github.com/Zugzwang-world/hrizzup/pull/76), [#77](https://github.com/Zugzwang-world/hrizzup/pull/77), [#78](https://github.com/Zugzwang-world/hrizzup/pull/78); the done-test on staging, [#79](https://github.com/Zugzwang-world/hrizzup/pull/79)). Nothing for the founder: you're an admin on staging (below).

9. **Relay 9, step 1.7d, list, trade and positions:** done: [#80](https://github.com/Zugzwang-world/hrizzup/pull/80) and [#82](https://github.com/Zugzwang-world/hrizzup/pull/82), the database's reads (#82 makes a retried trade always get its first answer, the AI review's finding); [#81](https://github.com/Zugzwang-world/hrizzup/pull/81), the calls; the done-test passed on #81's preview and on staging itself ([#83](https://github.com/Zugzwang-world/hrizzup/pull/83)). Nothing for the founder.

10. **Relay 10, Sourcing's test bot run and the second half's draft:** cancelled by the founder (9 November).

11. **Relay 11, Product's review of that draft:** cancelled by the founder (9 November).

12. **Relay 12, the round's closing record (last):** not started.

13. **Relay 13, the repository public until launch:** done, [#86](https://github.com/Zugzwang-world/hrizzup/pull/86) and [#88](https://github.com/Zugzwang-world/hrizzup/pull/88) (what the switch turned up): no key in any ref's history; past check logs and artifacts deleted; workflows safe for it; only collaborators open pull requests and issues or comment; secret scanning with push protection on; the checks run again. Nothing for the founder (your personal details: in the session).

## Decisions in force

- **Two surfaces, one account,** in parallel, the website a stage ahead: the app (news and social), the website (news and play-money markets); English; India first. Design in the founder's design chat, engineering in each round's chat, meeting at each feature's contract; relays side by side only when independent.
- **Design (1.4):** only from the founder's references and diagrams, the sign-in screen included; admin-only tools use stock components.
- **Database changes land first,** each in its own pull request, adding only, in order (1.8's check).
- **The content store (1.9):** the agreement's shapes as tables, its rules as database rules.
- **No xAI or X API in Product:** content arrives through 1.9's tables; X's own embed (2.3) is display. Sourcing works in its own project.
- **Markets:** created only by Hrizzup, settled by hand or by our resolver; double-entry play money in exact decimals, one transaction per trade; admins in a table only reviewed migrations write; every refusal before the books, a retry always given its first answer; no fee at launch. **Order:** 3.4a and 3.1, then 3.4c; then 1.2 (parked), 3.2a, 3.2b, 3.4b.
- **Sign-in:** no passwords; email codes through our server, behind the bot check. Next, the app's (1.6b); Apple with the iPhone (4.3).
- **The repository is public until launch** (checks free); private again before the launch release (P.17).
- **Checks and keys:** downloads, never tests, are retried; each job gets only the keys it uses; production's keys are read only by the release pipeline, and only the founder can start it.
- **Content:** three credited routes; no money in ranking. **Legal** is the founder's legal team's. No background jobs in Round 3. Production only through the release pipeline.

## What changed in the latest session

On 9 and 10 November 2026, relay 3 (hardening), four pull requests:

- **The checks' downloads** ([#63](https://github.com/Zugzwang-world/hrizzup/pull/63)): the 504s were GitHub's incident with anonymous traffic, which hit release downloads while signed-in requests worked. Every tool a check downloads is now pinned (`.github/scripts/tools.py`), kept in GitHub's cache by its pin (a new "Tool cache" workflow fills it from `main`), fetched signed in and retried after a pause; tests are never retried. App journeys boots the pinned emulator itself.
- **The release pipeline's key check** ([#65](https://github.com/Zugzwang-world/hrizzup/pull/65), risky, reviewed in two rounds): before loading `prd_release`, its names must be production's app keys or the pipeline's three credentials; before a release changes production, Vercel's production settings must hold exactly production's app keys. Claude Code never reads production: tested with fixtures and against staging's names.
- **The Screen check's keys** ([#84](https://github.com/Zugzwang-world/hrizzup/pull/84)): the ten its tests read, by name, for the tests alone, instead of all 21 of `stg_preview`; a test keeps the list equal to what the tests read, following their imports.
- **Dependabot's three alerts** ([#85](https://github.com/Zugzwang-world/hrizzup/pull/85)): zod through its parent (`@vercel/functions` 3.11.0); glob and minimatch through overrides, since Expo SDK 58 still asks for the old lines. None was inside pnpm's 3-day wait.
- **Measured for P.17:** the checks used about 2,700 Actions minutes from 1 to 9 November (1,575 on the 9th).

## Open questions

- **The Screen check retries a failed test once** (since 3 November), which "never retry a test" may not want. Recommendation: fail the check when a test passed only on its retry (Playwright's `failOnFlakyTests`).
- **Staging's and the release's keys** load as whole configs, which Doppler's action would show if a value were marked "unmasked" (none is). Recommendation: move both to named keys, as the Screen check does since [#84](https://github.com/Zugzwang-world/hrizzup/pull/84).
- **Two Screen checks at once share the test accounts' play money** (relay 13): the trading journeys fail when two pull requests' runs overlap (four did on 10 November; each passed alone). Recommendation: each run trades with a fresh test account of its own; until then, re-run a failed one alone.
- **Dependabot under "collaborators only":** it has never opened a pull request here. Recommendation: leave it; if one is refused, open pull requests to everyone again.
- **The app's writes:** staging's firewall lets only browsers write. Recommendation: when the app first writes, let them skip it behind the per-visitor limit, as reads do.
- **A market settled at a set probability** (1.7c): market/1 can't describe it. Recommendation: a market/2 before anything hands markets over.
- **The ledger's next steps.** Recommendation: an admin's "cancel a resting order" when first needed; yes/no only for now; lock fewer accounts per trade as markets grow.
- **Live prices** (3.1). Recommendation: Supabase Realtime on the market pages.
- **The console's create page** measures 65 to 285 ms against its 200 ms budget. Recommendation: trim its work on load, not the budget.
- **The pipeline's write access** (1.1). Recommendation: a role of its own that inserts and updates, never deletes.
- **A post's address and handle:** `validate()` doesn't check they match. Recommendation: add it, with Sourcing's agreement.
- **Supabase's per-visitor limits count our servers** (1.6a). Recommendation: pass each visitor's address (`Sb-Forwarded-For`) before launch.
- **The perp's first settings** (3.4a). Recommendation, from Manifold: a price every 5 seconds; 0.1% to open; hourly funding; a seeded stand-in price; a log of rule changes.
- **Also open, recommendations in the status file:** the app's bot check; creators' X accounts; embedding found posts; a deleted account's posts; the Hermes rewrite; shared code; the test accounts' play money.

## For the founder

- **Your personal details in the repository:** relay 13 listed them for you in its session; nothing changes unless you ask.
- **You're an admin on staging (nothing to do):** sign in with Google on the sign-in test page, then open `staging.hrizzup.com/console`.
- **One Google sign-in on staging (a minute):** `https://staging.hrizzup.com/sign-in-test`, Continue with Google, then sign out.
- **The perp's opening fee,** before the next round. Recommendation: 0.1% on opening, closing free.
- **Design:** your references and diagrams in the design chat; the board and a story page first.
- **The app's own database login, before launch.** Recommendation: you make its password in Supabase and keep it in Doppler; Claude Code switches to it.
- **Three decisions, recommended:** posting on both surfaces (2.4); the closed test without News Desk's content (2.6); reading and betting free, play money never sold (2.7). **Alongside:** the developer accounts (0.4), 12 Google Play testers, News Desk.
- **Spending, not now:** Calibre ($75 a month) once the board exists; Expo's Maestro job (about $60 a month) only if the emulator proves flaky; a database per pull request only if needed.
- **Parked until launch:** the runbook's pre-launch checklist, with P.16 and P.17 (the repository private again, and the checks' minutes decided).

## What's next

Round 3's queue (`TRACKER.md`): the closing record (relay 12). The next round starts with the perp's back end (3.4a, whose need on 1.7d is met); then the market pages (3.1, on 1.7d's calls, with signup's starting balance) and the perp's page (3.4c), the app's sign-in (1.6b), and the board once 1.4's core screens are approved.

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/setup/BLUEPRINT.md` (database 5, staging 6, sign-in 9, typed API 13, budgets 14), `docs/setup/RUNBOOK.md` (pre-launch checklist), `docs/setup.md` (9 November: the hook switched on; 10 November: the repository made ready to go public).
- `infra/supabase/auth/README.md` (sign-in settings and the hook); `infra/supabase/content-store.md`; `.github/scripts/test_public_repo.py` (the workflows' rules for a public repository); `.github/scripts/tools.py` (the checks' pinned tools); `infra/doppler/README.md` (the key checks: `app_keys.py`, `release-keys.txt`, `named_keys.py`).
- `product/packages/` (the contract, ledger, db, markets and market-engine); `product/packages/markets/README.md` (the console's calls and everyone's: list, trade, positions); `infra/supabase/migrations/*_market_console.sql` and `*_trading_*.sql`; `docs/research/manifold.md`; `agreement/README.md`.
- `docs/status/product.md`: Product's status in full.
