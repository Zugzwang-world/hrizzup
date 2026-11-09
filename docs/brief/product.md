# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 10 November 2026 at Round 3's close (relay 12, records only): the founder's decisions of 10 November, the Product chat's settlements and Round 4's queue. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code) and the markets. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Round 3 closed on 10 November 2026** ([#89](https://github.com/Zugzwang-world/hrizzup/pull/89)): relays 1 (with 1c), 1b, 2, 3, 5 to 9 and 13 done, 4, 10 and 11 cancelled, every row final in `TRACKER.md`. Round 4's queue is set.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API, a one-screen app on the founder's phone, Manifold's maths (1.7a), the ledger (1.7b), the content store (1.9), the website's sign-in on its test page (1.6a: Google, confirmed by the founder with the access-token hook on, and email codes), the admins' **market console** (1.7c, `staging.hrizzup.com/console`) and **list, trade and positions** in the typed API (1.7d), with no screens until 3.1.
- **Checks:** Secret, Quick, Database, Screen (with the website's journeys), Speed and App journeys, all required and free again since the repository went public (relay 13). Their tools are pinned and cached, each job gets only the keys it uses, and the release pipeline refuses production keys that aren't app keys (relay 3).
- **Design** restarts in the design chat, from the founder's references and diagrams.

## Round 4 progress

Round 4 progress: not started. Round 4's own records relay sets its relays' lines here.

## Decisions in force

- **Two surfaces, one account,** in parallel, the website a stage ahead: the app (news and social), the website (news and play-money markets); English; India first. Design in the founder's design chat, engineering in each round's chat, meeting at each feature's contract; relays side by side only when independent.
- **Design (1.4):** only from the founder's references and diagrams, the sign-in screens included; admin-only tools use stock components.
- **Database changes land first,** each in its own pull request, adding only, in order (1.8's check).
- **The content store (1.9):** the agreement's shapes as tables, its rules as database rules.
- **No xAI or X API in Product:** content arrives through 1.9's tables; X's own embed (2.3) is display. Sourcing works in its own project.
- **Markets:** created only by Hrizzup, settled by hand or by our resolver; double-entry play money in exact decimals, one transaction per trade; admins in a table only reviewed migrations write; every refusal before the books, a retry always given its first answer; no fee at launch on yes/no markets.
- **Settings follow Manifold's defaults** (the founder, 10 November): fees, funding, price updates and the like, unless the plan sets them; features, the yes/no zero fee and the perp's 10 times cap stay. **The perp's first settings:** Manifold's opening fee (10 basis points by default, with its cap) and hourly funding; a seeded stand-in price every 5 seconds; the 10 times cap; every rule change logged.
- **A market settled at a set probability** stays off the public list until the agreement's market/2, which 3.3 needs (Product chat, 10 November).
- **Sign-in:** no passwords; email codes through our server, behind the bot check. The app's (1.6b): a test screen, the bot check in a small web view; staging's firewall lets the app's writes through behind the per-visitor limit, as its reads (Product chat, 10 November; production's in P.14). Apple with the iPhone (4.3).
- **Budgets never move:** a page that misses one is fixed. Until the console's create page is, a Speed check failing only on `/console/markets/new` is re-run, that job alone.
- **The repository is public until launch,** then private again (P.17): nothing secret or personal in any file, pull request, comment or check log; only collaborators open pull requests and issues. Production's keys are read only by the release pipeline, which only the founder can start.
- **Content:** three credited routes; no money in ranking. **Legal** is the founder's legal team's. No background jobs in Round 3; the perp's checks run on Supabase Cron.

## What changed in the latest session

On 10 November 2026, Round 3's closing record ([#89](https://github.com/Zugzwang-world/hrizzup/pull/89), relay 12, records only):

- **The founder's decisions, in PLAN.md:** market settings follow Manifold's defaults; the perp's first settings, so 3.4a starts; 1.6a done; the repository public until launch.
- **The Product chat's settlements:** the app's writes through staging's firewall (1.6b; production's in P.14); the app's bot check in a small web view; set-probability markets off the list until market/2, now a need of 3.3; the console's create page fixed to its budget.
- **Round 3 closed:** every row final in `TRACKER.md`, relay 13's included; the milestone "Round 3" closed and "Round 4" opened; Round 4's queue leads `TRACKER.md`. Sourcing's and News Desk's briefs say market/2 is coming.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, drafted by Product when 3.3 nears, together with the address-and-handle check below, so the first half changes once.
- **A post's address and handle:** `validate()` doesn't check they match. Recommendation: add it, with Sourcing's agreement.
- **Two Screen checks at once share the test accounts' play money** (relay 13). Recommendation: each run trades with a fresh test account of its own; until then, re-run a failed one alone.
- **Staging's and the release's keys** load as whole configs. Recommendation: move both to named keys, as the Screen check does since [#84](https://github.com/Zugzwang-world/hrizzup/pull/84).
- **The ledger's next steps.** Recommendation: an admin's "cancel a resting order" when first needed; yes/no only for now; lock fewer accounts per trade as markets grow.
- **The pipeline's write access** (1.1). Recommendation: a role of its own that inserts and updates, never deletes.
- **Supabase's per-visitor limits count our servers** (1.6a). Recommendation: pass each visitor's address (`Sb-Forwarded-For`) before launch.
- **Also in the status file:** the Screen check's one retry; Dependabot; live prices (3.1); creators' X accounts; embedding found posts; a deleted account's posts; the Hermes rewrite; shared code; the journeys' test markets.

## For the founder

- **Nothing blocks Round 4.**
- **Coming in Round 4:** a new build of the app for your phone (1.6b); its relay sends the link.
- **Design:** your references and diagrams in the design chat: the board and a story page, then the market page and the perp's page.
- **You're an admin on staging (nothing to do):** sign in with Google on the sign-in test page, then open `staging.hrizzup.com/console`.
- **Your personal details in the repository:** relay 13 listed them for you in its session; nothing changes unless you ask.
- **The app's own database login, before launch.** Recommendation: you make its password in Supabase and keep it in Doppler; Claude Code switches to it.
- **Three decisions, recommended:** posting on both surfaces (2.4); the closed test without News Desk's content (2.6); reading and betting free, play money never sold (2.7). **Alongside:** the developer accounts (0.4), 12 Google Play testers, News Desk.
- **Spending, not now:** Calibre ($75 a month) once the board exists; Expo's Maestro job (about $60 a month) only if the emulator proves flaky; a database per pull request only if needed.
- **Parked until launch:** the runbook's pre-launch checklist, with P.14 (now the app's writes too), P.16 and P.17.

## What's next

Round 4 (`TRACKER.md`, "Round 4's queue"): first, side by side, the perp's maths (3.4a), the app's sign-in (1.6b) and the console's speed fix; then the perp's back end (the rest of 3.4a), database changes first; once the design chat's designs are approved, the market page (3.1), the perp's page (3.4c) and the board (2.1). Before 3.3: the agreement's market/2.

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/setup/BLUEPRINT.md` (database 5, staging 6, sign-in 9, typed API 13, budgets 14), `docs/setup/RUNBOOK.md` (pre-launch checklist), `docs/setup.md` (10 November: the repository made public; Round 3's close).
- `infra/supabase/auth/README.md` (sign-in and the hook); `infra/supabase/content-store.md`; `.github/scripts/test_public_repo.py` (the workflows' rules while public); `.github/scripts/tools.py` (the checks' pinned tools); `infra/doppler/README.md` (the key checks).
- `product/packages/` (the contract, ledger, db, markets and market-engine); `product/packages/markets/README.md` (the console's calls and everyone's); `docs/research/manifold.md` (the perps maths, section 1); `agreement/README.md`.
- `docs/status/product.md`: Product's status in full.
