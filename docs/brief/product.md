# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 11 November 2026 by Round 5's relay R3 (the public API's ground rules, keys and docs, step 3.5a), with its last pull request, just after R4 (the perp's own price, 3.4b) closed. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app (the website a stage ahead), the markets, and the public API for bots and AI tools, showing content through the content store's tables in the hand-over agreement's shapes (`agreement/README.md`, first half Agreed).

## Where things stand

- **Round 5 is open** (milestone "Round 5"). **The public API is open on staging, the demo:** R3 built 3.5a (bots' keys, the ground rules, the OpenAPI file, the docs), its done-test passed; R4 put **staging's Bitcoin perp on our own price** (3.4b). The real market page (3.1), the perp's page (3.4c) and the board (2.1) wait for the design chat's designs.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API at `/api/v1`, with bots' keys, its OpenAPI file and its docs (`/docs`, `/llms.txt`); the app with its sign-in test (1.6b: the founder's email-code and close-and-reopen tries are still open); the market engine, ledger and console (1.7a to 1.7d); play money on signup; the content store (1.9); the website's sign-in test page (1.6a); the Bitcoin perp (3.4a), now on our own price; the markets sandbox (R1).
- **Checks:** Secret, Quick, Database, Screen, Speed and App journeys, all required. **Design** restarts in the design chat.

## Round 5 progress

- **R1, the markets sandbox:** done, [#121](https://github.com/Zugzwang-world/hrizzup/pull/121). Next: nothing; the founder tries it. For the founder: the sandbox steps below.
- **R2, the public API's research and design:** done, [#122](https://github.com/Zugzwang-world/hrizzup/pull/122) (research only). Next: nothing; 3.5a and 3.4b build on it. For the founder: the exchanges' terms, before launch (below).
- **R3, the public API's ground rules, keys and docs (3.5a):** done in six pull requests ([#123](https://github.com/Zugzwang-world/hrizzup/pull/123), [#125](https://github.com/Zugzwang-world/hrizzup/pull/125), [#127](https://github.com/Zugzwang-world/hrizzup/pull/127), [#128](https://github.com/Zugzwang-world/hrizzup/pull/128), [#129](https://github.com/Zugzwang-world/hrizzup/pull/129), [#131](https://github.com/Zugzwang-world/hrizzup/pull/131)); its done-test passed on staging. Next: nothing; 3.4b's price reads and 3.5c build on it. For the founder: nothing new.
- **R4, the perp's own price (3.4b):** staging's perp on it: its database, [#124](https://github.com/Zugzwang-world/hrizzup/pull/124); the website on it, [#126](https://github.com/Zugzwang-world/hrizzup/pull/126); the perp moved onto it, [#130](https://github.com/Zugzwang-world/hrizzup/pull/130); checked on staging, [#133](https://github.com/Zugzwang-world/hrizzup/pull/133). Next (a later relay): 3.4b's public price reads and its done-test, a day on staging, after 3.5a. For the founder: nothing new (the exchanges' terms before launch, below).
- **R5, the public API for bots (3.5c, 3.5d, 3.5f and 3.4b's last parts):** in progress: its database change, [#134](https://github.com/Zugzwang-world/hrizzup/pull/134) (1 of 5); the market and price reads, [#135](https://github.com/Zugzwang-world/hrizzup/pull/135) (2 of 5); trading for bots and the example bot, [#136](https://github.com/Zugzwang-world/hrizzup/pull/136) (3 of 5); the MCP server, [#137](https://github.com/Zugzwang-world/hrizzup/pull/137) (4 of 5). Next: the done-tests and 3.4b's day on staging. For the founder: nothing yet (your steps come in R5's final report).

## Decisions in force

- **The public API** (the founder, 10 November; PLAN.md section 2): one versioned API (`/api/v1`) for the website, the app and bots; public market data keyless and edge-cached, trading and personal calls keyed (read-only or trading keys); staging the bots' demo until launch; an OpenAPI file, a docs page and llms.txt, then an MCP server. Its sixteen details as recommended (the Product chat; `docs/research/public-api.md`, section 4).
- **The perp's own price** (the founder and the Product chat, 10 November): every 5 seconds, in the database, the median of Coinbase, Kraken and Bitstamp (Gemini the spare); orders fill at the next price; when prices stop, the last is held 30 seconds, then nothing fills or liquidates; exchanges' own answers never shown.
- **Product first, nothing paid** (the founder, 10 November): no new privacy, security or production work unless it blocks the product; free tiers only; checks, budgets and rules never looser.
- **How sessions work** (the founder, 10 November): one watcher on checks; no questions to the founder, one short final report; his tries are the record; records inside each milestone's pull request.
- **Two surfaces, one account,** the website a stage ahead; English; India first. **Design** only from the founder's references and diagrams. **Database changes land first,** adding only, in order.
- **Content:** the agreement's shapes as tables, no xAI or X API. **Markets:** made only by Hrizzup, double-entry play money in exact decimals, Manifold's defaults. **The perp:** Manifold's defaults, 10 times at most; jobs in migrations; check runs' test perps on seeded stand-in prices.
- **Sign-in:** no passwords; email codes through our server, behind the bot check; the app's Google through the phone's browser.
- **How checks behave:** each run owns what it changes, and no check ever asks an exchange; a failed check is re-run only for an outage outside our code. **Budgets never move.** **Public until launch** (P.17): nothing secret or personal in the repository.

## What changed in the latest session

Two relays closed together on 11 November 2026.

**R3 built 3.5a**, the public API's keys, ground rules and docs, in six pull requests (the two risky ones AI-reviewed: no high-confidence issues):

- **Keys** ([#123](https://github.com/Zugzwang-world/hrizzup/pull/123), [#125](https://github.com/Zugzwang-world/hrizzup/pull/125)): read-only or trading, stored as a hash, shown once, made on the sandbox's keys page while signed in, never with a key; staging only; each trade records its key.
- **The ground rules** ([#127](https://github.com/Zugzwang-world/hrizzup/pull/127)): `limit` and `cursor` on every list (`after` renamed once); every call's errors in the contract; one error format; the standard `RateLimit` headers.
- **The OpenAPI file** ([#128](https://github.com/Zugzwang-world/hrizzup/pull/128)): made from the contract, kept in the repository; Quick checks fail a pull request that renames or removes a v1 field or call (oasdiff).
- **The docs** ([#129](https://github.com/Zugzwang-world/hrizzup/pull/129)): `staging.hrizzup.com/docs`, `/llms.txt`, `/llms-full.txt`, readable by AI tools without a browser.
- **Done-test on staging** ([#131](https://github.com/Zugzwang-world/hrizzup/pull/131)): passed (read-only key refused a trade, trading key traded, revoked key refused within seconds, docs read by a bot, books added up).

**R4 built the perp's own price** (3.4b), each risky milestone AI-reviewed (no serious defect): the price store and its 5-second fetch in the database ([#124](https://github.com/Zugzwang-world/hrizzup/pull/124)); the perp on the stored price, an order filling at the next one or refused after 15 seconds as `stale_price` ([#126](https://github.com/Zugzwang-world/hrizzup/pull/126)); the listed perp moved onto it, logged ([#130](https://github.com/Zugzwang-world/hrizzup/pull/130)); checked on staging, a price every 5.01 seconds ([#133](https://github.com/Zugzwang-world/hrizzup/pull/133)).

## Open questions

One line each; the detail, and the rest, are in the status file.

- **Orders fill at a held price for up to 30 seconds** (decision 8 as settled; the automated security check flags it). Recommendation: keep it for the demo; before production's perp opens (P.18), fill only at a real price and keep the held one for display and liquidations.
- **The perp's ticks share pg_net with the price,** so a slow website can delay a price. Recommendation: watch it during 3.4b's day; if prices are missed, shorten the tick's call.
- **The docs page's look** (decision 13 said Scalar's stock page): Scalar is about 1 MB of code against the 200 KB budget, so the page is ours, server-rendered in the stock look. Recommendation: keep it server-rendered; the design chat designs it before launch.
- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, with the address-and-handle check, so the first half changes once.
- **The pipeline's write access** (1.1). Recommendation: a role that inserts and updates, never deletes.
- **Also in the status file:** pg_net's grants; node-forge, flagged by GitHub in the Expo tool only; Vercel Pro's function billing; Vercel's toolbar over the app's bot check; sign-ups waiting for the house; the ledger's next steps; embedding found posts; the Hermes rewrite; shared code.

## For the founder

- **Before launch, the exchanges' terms** (your legal team; nothing to do now; P.19): each exchange's terms limit a price made from its free data. Recommended: the price stays on staging, the demo; before production's API opens, the three exchanges' permission (Bitstamp offers a licence), or a licensed price behind the same calls.
- **Before launch, the API's limits for each address** (P.20; nothing to do now): Claude Code measures staging and recommends; you decide.
- **The first topics (1.2):** approve or change them when the Product chat drafts them.
- **Try the sandbox, about 10 minutes, at `staging.hrizzup.com/sandbox`:** **Sign in** with Google; on a market **Buy Yes**, then **Sell** 50%; a **Limit** order, then **Cancel**; **Perps** (Bitcoin's real price now): **Up**, 100, **Open Up**, then **Close**; **Console**: **Close**, then **Settle** a market. Optional: **Keys**, make a read-only key, then **Revoke** it.
- **Your two phone tries for 1.6b, about 3 minutes,** in the app's **Sign-in test**: **Sign out**; **Email me a code**, then sign in with it; close and reopen the app: still signed in. Tell the Product chat.
- **Designs:** your references in the design chat; the market page (3.1) and the perp's page (3.4c) wait on them.
- **Three decisions, recommended:** 2.4, 2.6 and 2.7 (the status file). **When you choose:** developer accounts (0.4), 12 testers, News Desk. **Spending parked;** launch items in the pre-launch checklist (the perp on production is P.18).

## What's next

Round 5 (`TRACKER.md`): 3.5a is done (R3); next 3.4b's price reads, on 3.5a's rules, and its day on staging; then 3.5c (market reads); then 3.5d (trading for bots) beside 3.5e (the stream); 3.5f (MCP) last. The screens (3.1, 3.4c, 2.1) once their designs are approved. The Product chat drafts the topics (1.2). Before 3.3: market/2. Later: Manifold's fuzz test split; the stand-in's seed retired from Doppler.

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/research/public-api.md` (the public API's design and the price test); `docs/setup/BLUEPRINT.md` (database 5, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/setup.md` (the setup log).
- `infra/supabase/migrations/20261110191500_bitcoin_price.sql` (our own price: the fetch, the median, the hold, the perp's rules), `product/packages/perps/` (the perp on it), `product/packages/api/` (the contract), `product/web/app/api/v1/` (where it's served), `product/web/app/sandbox/` (the sandbox), `product/packages/market-engine/`; `product/app/`; `agreement/README.md`; `docs/status/product.md` (Product's status in full).
