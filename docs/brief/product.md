# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 11 November 2026 by Round 5's relay R3 (the public API's ground rules, keys and docs, step 3.5a), after its first pull request. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app in parallel (the website a stage ahead; Android, then iPhone from the same code), the markets, and now the public API that outside bots and AI tools use. It shows the content it receives through the content store's tables, in the shapes of the hand-over agreement (`agreement/README.md`), whose first half is Agreed.

## Where things stand

- **Round 5 is open** (milestone "Round 5"). **The founder decided the public API** (10 November): it needs no design, so it runs now, after R2's research; the Product chat settled its sixteen details, all as recommended, and moved the keys into 3.5a, which R3 is building. The real market page (3.1), the perp's page (3.4c) and the board (2.1) wait for the design chat's designs.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API at `/api/v1`; the app with its sign-in test (1.6b: the founder's email-code and close-and-reopen tries are still open); the market engine, ledger and console (1.7a to 1.7d); play money on signup; the content store (1.9); the website's sign-in test page (1.6a); the Bitcoin perp on its stand-in price (3.4a); the markets sandbox (R1).
- **Checks:** Secret, Quick, Database, Screen, Speed and App journeys, all required: each run on its own, no real email, no pass on retry, every page inside its speed budget. **Design** restarts in the design chat.

## Round 5 progress

- **R1, the markets sandbox:** done, [#121](https://github.com/Zugzwang-world/hrizzup/pull/121). Next: nothing; the founder tries it. For the founder: the sandbox steps below.
- **R2, the public API's research and design:** done, [#122](https://github.com/Zugzwang-world/hrizzup/pull/122) (research only). Next: nothing; 3.5a and 3.4b build on it. For the founder: the exchanges' terms, before launch (below).
- **R3, the public API's ground rules, keys and docs (3.5a):** first milestone, the keys' database change, [#123](https://github.com/Zugzwang-world/hrizzup/pull/123). Next: keys in the API with the keys page in the sandbox; then paging, errors and limits across every call; then the OpenAPI file with its check, the docs page and llms.txt. For the founder: nothing.

## Decisions in force

- **The public API** (the founder, 10 November; PLAN.md section 2): one versioned API (`/api/v1`) for the website, the app and bots, public market data keyless and edge-cached, trading and personal calls keyed; personal keys from a plain page, shown once, revocable, read-only or trading; staging is the bots' demo until production's API opens at launch; markets show the pool's price, a quote for any size and the resting limit orders by price; AI tools through an OpenAPI file, a docs page and llms.txt, then an MCP server on the same keys. **The perp's own price:** every 5 seconds the median of a few big exchanges' free prices, stored once, every order filling at the next. **Topics (1.2) unparked:** drafted in the Product chat for the founder's approval; the market page's reads are built in the public API. **Its sixteen details** (the Product chat, 10 November, all as recommended; `docs/research/public-api.md`, section 4): Manifold's names with exact decimals; `read` and `trade` keys, five live an account; 60 requests a minute an address, 120 personal reads a key, 30 trades an account; `limit` and `cursor`; no names in public data; each trade recording its key. The keys moved into 3.5a.
- **Product first, nothing paid** (the founder, 10 November): no new privacy, security or production work unless it blocks the product; free tiers only; checks, budgets and rules never looser.
- **How sessions work** (the founder, 10 November): one watcher on checks, never polling; no questions to the founder, one short final report; his own tries are the record; records inside each milestone's pull request.
- **Two surfaces, one account,** the website a stage ahead; English; India first. **Design** only from the founder's references and diagrams. **Database changes land first,** adding only, in order.
- **Content:** the agreement's shapes as tables, no xAI or X API in Product. **Markets:** created only by Hrizzup, double-entry play money in exact decimals, Manifold's defaults unless the plan sets them. **The perp:** Manifold's defaults with the 10-times cap; fills at the next 5-second price; jobs defined in migrations; the stand-in price's seed secret, until its own price replaces it (3.4b).
- **Sign-in:** no passwords; email codes through our server, behind the bot check; the app's Google through the phone's browser.
- **How checks behave:** each run owns what it changes; a failed check is re-run only for an outage outside our code. **Budgets never move.** **Public until launch** (P.17): nothing secret or personal in the repository.

## What changed in the latest session

On 11 November 2026, R3's first milestone, **the keys' database change** ([#123](https://github.com/Zugzwang-world/hrizzup/pull/123), risky; nothing calls it yet):

- **Keys in the database:** read-only or trading, stored only as a hash with their first few characters; made and revoked only from a signed-in session, never with a key, so a leaked key can't make another; five live an account, ten new an hour; a revoked key never comes back.
- **Every trade records its key:** the database stamps each trade request (markets and the perp) with its key, refusing it unless the key is live, the account's own and trading.
- **Recorded:** the sixteen decisions settled and the keys moved into 3.5a (PLAN.md, `TRACKER.md`, the status file, all three briefs); two pre-launch items, the exchanges' terms (P.19) and a second look at the limits for each address (P.20), since mobile networks in India share addresses.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, with the address-and-handle check, so the first half changes once.
- **The pipeline's write access** (1.1). Recommendation: its own role that inserts and updates, never deletes.
- **pg_net is open to every database role** (Supabase's grants). Recommendation: leave it until launch; the Data API is off.
- **Also in the status file:** Vercel Pro's function billing; Vercel's toolbar over the app's bot check; sign-ups waiting for the house; the ledger's next steps; embedding found posts; the Hermes rewrite; shared code.

## For the founder

- **Before launch, the exchanges' terms** (for your legal team; nothing to do now; pre-launch checklist P.19): each exchange's terms limit a price made from its free data; Bitstamp offers a signed licence. Recommended: run the price on staging, the demo, as decided; before production's API opens, get the three exchanges' permission (or Bitstamp's licence), or move to a licensed price behind the same calls.
- **Before launch, the API's limits for each address** (P.20; nothing to do now): Claude Code measures staging's busiest addresses and recommends whether 60 requests a minute should rise, since mobile networks in India share addresses; you decide.
- **The first topics (1.2):** approve or change them when the Product chat drafts them.
- **Try the sandbox, about 10 minutes, at `staging.hrizzup.com/sandbox`:** (1) **Sign in** with Google. (2) On a market, **Buy Yes**, then **Sell** 50%. (3) A limit order (**Limit**, 20 at 10), then **Cancel** it. (4) **Perps**: **Up**, 100, **Open Up** (it fills within 5 seconds), then **Close**. (5) **Console**: **Close**, then **Settle** the market closing within a day; the payout shows in your balance.
- **Your two phone tries for 1.6b, about 3 minutes.** In the app's **Sign-in test**: **Sign out**; then **Email me a code** (your email, the bot check, the 8-digit code, **Sign in**); then close and reopen the app: still signed in. Tell the Product chat how it went.
- **Designs:** your references and diagrams in the design chat; the market page (3.1) and the perp's page (3.4c) wait on them.
- **Three decisions, recommended:** posting on both surfaces (2.4); the closed test without News Desk's content (2.6); reading and betting free (2.7). **When you choose:** the developer accounts (0.4), 12 testers, News Desk. **Spending, parked;** **launch items** in the runbook's pre-launch checklist (the perp on production is P.18).

## What's next

Round 5 (`TRACKER.md`): the public API: now 3.5a (R3: keys, ground rules and docs) beside 3.4b (the perp's own price); then 3.5c (the market reads); then 3.5d (trading for bots) beside 3.5e (the stream); 3.5f (the MCP server) last. The screens (3.1, 3.4c, 2.1) once the design chat approves them, 3.1 on 3.5c's reads. The Product chat drafts the first topics (1.2). Before 3.3: market/2. The next relay that touches the engine splits Manifold's fuzz test.

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/research/public-api.md` (the public API: the three platforms, our v1, the price test, the build plan, the decisions); `docs/setup/BLUEPRINT.md` (database 5, staging 6, sign-in 9, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/setup.md` (the setup log, newest last).
- `product/packages/api/` (the contract), `product/web/app/api/v1/` (where it's served), `product/web/app/sandbox/` (the sandbox), `product/packages/perps/`, `product/packages/market-engine/`; `product/app/`; `agreement/README.md`; `docs/status/product.md` (Product's status in full).
