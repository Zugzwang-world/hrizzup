# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 9 November 2026 with relay 5's sign-in (1.6a). PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** a holding page, legal drafts, the typed API (health, who am I), a one-screen app on the founder's phone, Manifold's maths (1.7a), the ledger (1.7b) and the content store (1.9), both empty, and the website's sign-in (1.6a) on its test page: Google and email codes; passwords refused.
- **Required checks:** Secret, Quick, Database, Screen (with the website's journeys), Speed and App journeys.
- **Design** restarts in the design chat, from the founder's references and diagrams.

## Round 3 progress

One line per relay; each relay keeps only its own line current.

1. **Relay 1, the round's records:** [#60](https://github.com/Zugzwang-world/hrizzup/pull/60) records the founder's decisions of 9 November and Round 3's queue; [#62](https://github.com/Zugzwang-world/hrizzup/pull/62) (1c) records how rounds run and the perp in two steps. Next: nothing; relay 1 is done. For the founder: the perp's opening fee, before the next round.

1b. **Relay 1b, correcting the records about Sourcing:** [#61](https://github.com/Zugzwang-world/hrizzup/pull/61). Done; nothing for the founder.

2. **Relay 2, step 1.8 with the database-order check (wave 1):** done. [#64](https://github.com/Zugzwang-world/hrizzup/pull/64) gives each session a slot on this Mac (its own website and Metro ports, database and Redis prefix; `infra/slots/slot claim`, CLAUDE.md "Parallel sessions"). **This Mac holds four slots: three for a round's relays at once, one kept for the design chat**, so wave 2's three relays fit. [#68](https://github.com/Zugzwang-world/hrizzup/pull/68) lets every slot sign in and upload against staging (applied to staging; proven from three slots side by side, 18 of 18). [#66](https://github.com/Zugzwang-world/hrizzup/pull/66) adds the database-order check to the required Database check: a pull request's new migrations must come after main's newest, and a one-line lock makes a second migration pull request rebase once the first merges. Next: nothing; relay 2 is done. Nothing for the founder.

3. **Relay 3, hardening (wave 1):** [#63](https://github.com/Zugzwang-world/hrizzup/pull/63): every tool the checks download is pinned, kept in GitHub's cache by its pin and fetched signed in, with retries (the 504s were GitHub's incident with anonymous downloads). Next: the release pipeline's key check, then the Screen check's keys and Dependabot's three alerts. Nothing for the founder.

4. **Relay 4, Sourcing's research for step 0.8:** cancelled by the founder (9 November).

5. **Relay 5, step 1.6a, the website's sign-in (wave 2):** done: the hook that refuses password sessions ([#70](https://github.com/Zugzwang-world/hrizzup/pull/70)), email codes beside Google on the sign-in test page ([#71](https://github.com/Zugzwang-world/hrizzup/pull/71)), and the hook switched on for staging ([#74](https://github.com/Zugzwang-world/hrizzup/pull/74); production at its next release). For the founder: one Google sign-in on staging (below).

6. **Relay 6, step 1.7b, the ledger (wave 2):** done: [#69](https://github.com/Zugzwang-world/hrizzup/pull/69) the tables (on staging, empty), [#73](https://github.com/Zugzwang-world/hrizzup/pull/73) the trade, each one transaction through the app's own database role. For the founder: the app's own database login, before launch (below).

7. **Relay 7, step 1.9, the content store's tables (wave 2):** done: [#72](https://github.com/Zugzwang-world/hrizzup/pull/72), the tables (on staging, empty), every agreement rule a database can hold as a database rule (`infra/supabase/content-store.md`), and 249 tests in the Database check. Nothing for the founder.

8. **Relay 8, step 1.7c, markets as data and the console:** in progress. Merged: [#75](https://github.com/Zugzwang-world/hrizzup/pull/75), the database change (the admins table, markets as data beside the ledger's markets, the market log, and the console's calls, each checking the admins table first), and [#76](https://github.com/Zugzwang-world/hrizzup/pull/76), staging's admins (the founder's account, from his Google sign-in of 3 November, and the console's test account), both read back on staging. [#77](https://github.com/Zugzwang-world/hrizzup/pull/77): the calls in the typed API, admins only; to anyone else they answer exactly as an unknown address. Next: the console itself. Nothing for the founder yet.

9. **Relay 9, step 1.7d, list, trade and positions (after 1.7c):** not started.

10. **Relay 10, Sourcing's test bot run and the second half's draft:** cancelled by the founder (9 November).

11. **Relay 11, Product's review of that draft:** cancelled by the founder (9 November).

12. **Relay 12, the round's closing record (last):** not started.

## Decisions in force

- **Two surfaces, one account,** in parallel, the website a stage ahead: the app (news and social), the website (news and play-money markets); English; India first. Design in the founder's design chat, engineering in each round's chat, meeting at each feature's contract; relays side by side only when independent.
- **Design (1.4):** only from the founder's references and diagrams, the real sign-in screen included; admin-only tools use stock components.
- **Database changes land first,** each in its own pull request, adding only, in order (1.8's check).
- **The content store (1.9):** the agreement's shapes as tables, its rules as database rules; a change to them brings its migration with it.
- **No xAI or X API in Product:** content arrives through 1.9's tables; X's own embed (2.3) is display. Sourcing works in its own project.
- **Markets:** created only by Hrizzup, settled by hand or by our resolver; double-entry play money in exact decimals, one transaction per trade (1.7b); admins in a table only reviewed migrations write, everyone else getting "not found" (1.7c); list, trade, positions (1.7d); no fee at launch; cancelled only when it can't be settled fairly. **Order:** 1.7c, 1.7d, then 3.4a and 3.1, then 3.4c; then 1.2 (parked), 3.2a, 3.2b, 3.4b.
- **Sign-in:** no passwords anywhere; the access-token hook refuses any session made with one. Email codes go through our server, which checks the bot check first. Next, the app's (1.6b); Apple with the iPhone (4.3).
- **Content:** three credited routes; no money in ranking. **Legal** is the founder's legal team's. No background jobs in Round 3. Production only through the release pipeline.

## What changed in the latest session

On 9 November 2026, relay 5 (1.6a, sign-in):

- **[#70](https://github.com/Zugzwang-world/hrizzup/pull/70), the hook, switched off:** a tiny database function refusing any session made with a password. Found first: email codes, sign-ups and the test accounts' tokens arrive as `otp`, Google as `oauth`, refreshes as `token_refresh`.
- **[#71](https://github.com/Zugzwang-world/hrizzup/pull/71), email codes:** our server checks the bot check, then asks Supabase for the code, within its email limits; journeys on every preview.
- **[#74](https://github.com/Zugzwang-world/hrizzup/pull/74), switched on for staging:** at once, 16 of 16 sign-in journeys passed against staging itself, a password refused. `apply.py` now refuses a hook the database can't run.

## Open questions

- **The ledger's next steps** (1.7b, 1.7c). Recommendations: an admin "cancel a resting order"; yes/no markets only for now; lock fewer accounts per trade as markets grow.
- **The pipeline's write access** (1.1). Recommendation: a role of its own that inserts and updates content, never deletes.
- **A post's address and handle** (the agreement): `validate()` doesn't check they match. Recommendation: add it, with Sourcing's agreement.
- **A deleted account's posts** (2.4). Recommendation: they go with the account; Hrizzup's own never do.
- **Supabase's per-visitor limits count our servers** (1.6a). Recommendation, before launch: pass each visitor's address to Supabase (`Sb-Forwarded-For`), once confirmed safe; meanwhile the firewall limits each visitor.
- **The app's bot check** (1.6b). Recommendation: the website's server path, the widget in a small web view.
- **Creators' X accounts** (2.4). Recommendation: the link comes with News Desk's invitation.
- **The perp's first settings** (3.4a). Recommendation, from Manifold: a price every 5 seconds; 0.1% to open; hourly funding; a seeded stand-in price; a log of rule changes.
- **Embedding found posts** (2.3): an X embed is about 330 KB. Recommendation: load each near the screen, behind a placeholder.
- **In the status file:** the Hermes rewrite; shared code.

## For the founder

- **One Google sign-in on staging (a minute):** `https://staging.hrizzup.com/sign-in-test`, Continue with Google, then sign out. A test can't sign in to Google; this confirms it with the hook on.
- **The perp's opening fee,** before the next round. Recommendation: 0.1% on opening, closing free.
- **Design:** your references and diagrams in the design chat; the board and a story page first.
- **The app's own database login, before launch.** Recommendation: you make its password in Supabase and keep it in Doppler; Claude Code switches to it.
- **Three decisions, recommended:** posting on both surfaces (2.4); the closed test without News Desk's content (2.6); reading and betting free, play money never sold (2.7). **Alongside:** the developer accounts (0.4), 12 Google Play testers, News Desk.
- **Spending, not now:** Calibre ($75 a month) once the board exists; Expo's Maestro job (about $60 a month) only if the emulator proves flaky; a database per pull request only if needed.
- **Parked until launch:** the runbook's pre-launch checklist, with P.16.

## What's next

Round 3's queue (`TRACKER.md`): relay 3's hardening; then 1.7c (relay 8), 1.7d (9) and the closing record (12). The next round starts with the perp's back end (3.4a); then 3.1 and 3.4c, the app's sign-in (1.6b), and the board once 1.4's core screens are approved.

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/setup/BLUEPRINT.md` (database 5, staging 6, sign-in 9, typed API 13, budgets 14), `docs/setup/RUNBOOK.md` (pre-launch checklist), `docs/setup.md` (9 November: the hook switched on).
- `infra/supabase/auth/README.md` (sign-in settings and the hook); `infra/supabase/content-store.md`.
- `product/packages/` (the contract, ledger, db and market-engine READMEs); `docs/research/manifold.md`; `agreement/README.md`.
- `docs/status/product.md`: Product's status in full.
