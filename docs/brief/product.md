# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 11 November 2026 by Round 5's relay R5 (the public API for bots: 3.5c, 3.5d, 3.5f and 3.4b's last parts), with its last pull request. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app (the website a stage ahead), the markets, and the public API for bots and AI tools, showing content through the content store's tables in the hand-over agreement's shapes (`agreement/README.md`, first half Agreed).

## Where things stand

- **Round 5 is open** (milestone "Round 5"). **The public API is done on staging, the demo,** but its stream (3.5e, later): keys and ground rules (3.5a), our own Bitcoin price (3.4b), the market reads (3.5c), trading for bots with an example bot (3.5d) and the MCP server (3.5f), each done-test passed. The market page (3.1), the perp's page (3.4c) and the board (2.1) wait for the design chat's designs.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API at `/api/v1` with its OpenAPI file, docs (`/docs`, `/llms.txt`) and MCP server (`/api/v1/mcp`); the example bot (`examples/bot`); the app's sign-in test (1.6b: two of the founder's tries open); the market engine, ledger and console; play money on signup; the content store; the Bitcoin perp on our own price; the markets sandbox.

## Round 5 progress

- **R1, the markets sandbox:** done, [#121](https://github.com/Zugzwang-world/hrizzup/pull/121). Next: nothing. For the founder: try it (below).
- **R2, the public API's research and design:** done, [#122](https://github.com/Zugzwang-world/hrizzup/pull/122). Next: nothing. For the founder: the exchanges' terms, before launch.
- **R3, ground rules, keys and docs (3.5a):** done ([#123](https://github.com/Zugzwang-world/hrizzup/pull/123), [#125](https://github.com/Zugzwang-world/hrizzup/pull/125), [#127](https://github.com/Zugzwang-world/hrizzup/pull/127), [#128](https://github.com/Zugzwang-world/hrizzup/pull/128), [#129](https://github.com/Zugzwang-world/hrizzup/pull/129), [#131](https://github.com/Zugzwang-world/hrizzup/pull/131)). Next: nothing. For the founder: nothing new.
- **R4, the perp's own price (3.4b):** staging's perp on it ([#124](https://github.com/Zugzwang-world/hrizzup/pull/124), [#126](https://github.com/Zugzwang-world/hrizzup/pull/126), [#130](https://github.com/Zugzwang-world/hrizzup/pull/130), [#133](https://github.com/Zugzwang-world/hrizzup/pull/133)); R5 finished 3.4b. Next: nothing. For the founder: nothing new.
- **R5, the public API for bots (3.5c, 3.5d, 3.5f, 3.4b's last parts):** done: its database change, [#134](https://github.com/Zugzwang-world/hrizzup/pull/134); the reads, [#135](https://github.com/Zugzwang-world/hrizzup/pull/135); trading for bots and the example bot, [#136](https://github.com/Zugzwang-world/hrizzup/pull/136); the MCP server, [#137](https://github.com/Zugzwang-world/hrizzup/pull/137); a market past its closing time reads as closed, [#139](https://github.com/Zugzwang-world/hrizzup/pull/139); the bot never trades the account's own perp position, [#140](https://github.com/Zugzwang-world/hrizzup/pull/140); the done-tests and 3.4b's day, [#138](https://github.com/Zugzwang-world/hrizzup/pull/138). Next: nothing. For the founder: a bot and Claude Code on staging (below).

## Decisions in force

- **The public API** (the founder, 10 November; PLAN.md section 2): one versioned API (`/api/v1`) for the website, the app and bots; public market data keyless and edge-cached, personal and trading calls keyed (read-only or trading keys); staging the bots' demo until launch; an OpenAPI file, docs, llms.txt and an MCP server. Its sixteen details as recommended (`docs/research/public-api.md`, section 4).
- **Settled in the Product chat, 11 November:** the held price stays for the demo, and before production's API opens perp orders fill only at a fresh price (runbook P.21); the docs keep the site's plain look until the design chat styles them; the stream (3.5e) waits: bots ask for prices again and again.
- **The perp's own price** (10 November): every 5 seconds, in the database, the median of Coinbase, Kraken and Bitstamp (Gemini the spare); orders fill at the next price; held 30 seconds when prices stop; exchanges' own answers never shown. An account holds one position per side.
- **Product first, nothing paid** (the founder, 10 November): no new privacy, security or production work unless it blocks the product; free tiers only; checks, budgets and rules never looser.
- **How sessions work** (the founder, 10 November): one watcher on checks; no questions to the founder, one short final report; his tries are the record; records inside each milestone's pull request.
- **Two surfaces, one account,** the website a stage ahead; English; India first. **Design** only from the founder's references and diagrams. **Database changes land first,** adding only.
- **Markets:** made only by Hrizzup, double-entry play money in exact decimals, Manifold's defaults. **Content:** the agreement's shapes, no xAI or X API.
- **How checks behave:** each run owns what it changes; no check asks an exchange; a failed check is re-run only for an outage outside our code. **Budgets never move.** **Public until launch** (P.17).

## What changed in the latest session

**R5 built the rest of the public API for bots**, each risky pull request AI-reviewed and every real defect found fixed before merging:

- **Database first** ([#134](https://github.com/Zugzwang-world/hrizzup/pull/134)): read-only functions for the market data, naming nobody, and a bot's own trades.
- **The reads** ([#135](https://github.com/Zugzwang-world/hrizzup/pull/135)): one market, its history, its resting orders by price, its latest trades, a quote for any size, the perp's quote, our Bitcoin price and its history; keyless and edge-cached. **A quote matches the trade that follows to the exact decimal** (300 random trades on a real database).
- **Trading for bots** ([#136](https://github.com/Zugzwang-world/hrizzup/pull/136)): Manifold's `dryRun` (the real trade, rolled back), `YES`/`NO`, `GET /me/trades`; **the example bot**, its key from the environment, run by a journey on every pull request.
- **The MCP server** ([#137](https://github.com/Zugzwang-world/hrizzup/pull/137)) at `/api/v1/mcp`: tools from the contract, the key deciding which (read-only keys get only reading tools).
- **From the founder's own runs:** a market past its closing time now reads as closed everywhere ([#139](https://github.com/Zugzwang-world/hrizzup/pull/139), another session's); the bot trades the perp only when the account holds no position there and closes only what it opened, and the docs say an account holds one position per side ([#140](https://github.com/Zugzwang-world/hrizzup/pull/140)).
- **Done-tests on staging** ([#138](https://github.com/Zugzwang-world/hrizzup/pull/138)): the example bot on the real Bitcoin perp and an MCP client trading, every balance exact, staging's books balanced; Claude Code connected. **3.4b's day:** no price missed: 17,240 in 24 hours, one every 5.01 seconds, the longest gap 5.18; every one from three exchanges, Gemini standing in the 12 times one failed.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **`GET /me/orders` still shows a market past its closing time as open** ([#139](https://github.com/Zugzwang-world/hrizzup/pull/139)): its database read lacks the closing time. Recommendation: add it in a small database change first, then show the state as every other read does.
- **Changing a request's existing forms within v1:** the breaking-change check reads any edit inside a request's existing choice as a removal. Recommendation: always add a new choice, never edit one; keep the check as it is.
- **Speed warnings on pages R5 didn't touch:** the sandbox's market page and the home page each crossed 200 ms once, in a first run. Recommendation: measure each alone, as #110 did.
- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, so the first half changes once.
- **The pipeline's write access** (1.1). Recommendation: a role that inserts and updates, never deletes.
- **Also in the status file:** pg_net's grants; node-forge in the Expo tool only; Vercel Pro's function billing; Vercel's toolbar; sign-ups waiting for the house; the ledger's next steps; embedding found posts; the Hermes rewrite; shared code; the stand-in's seed, unused now.

## For the founder

- **Your bot and Claude Code on staging** (the steps R5 gave you, 11 November): a **Trading** key from `staging.hrizzup.com/sandbox/keys`, kept in your Mac's Keychain (`security add-generic-password -U -a "$USER" -s hrizzup-api-key -w`); the bot with `node ~/hrizzup-bot.ts`; Claude Code through `claude mcp add-json` with a Keychain helper, then a new Code session.
- **Before launch:** the exchanges' terms (your legal team; P.19); the API's limits for each address (P.20); nothing to do now.
- **The first topics (1.2):** approve or change them when the Product chat drafts them.
- **Try the sandbox** at `staging.hrizzup.com/sandbox`, and **your two phone tries for 1.6b** in the app's **Sign-in test**; tell the Product chat.
- **Designs:** your references in the design chat; the market page (3.1) and the perp's page (3.4c) wait on them. **When you choose:** developer accounts (0.4), 12 testers, News Desk. **Spending parked.**

## What's next

Round 5 (`TRACKER.md`): the public API is done on staging but its stream (3.5e, later). The screens (3.1, 3.4c, 2.1) once their designs are approved; the market page builds on 3.5c's reads. The topics (1.2) in the Product chat. Before 3.3: market/2. Later: `/me/orders`' closing time; the Speed warnings; Manifold's fuzz test split; the stand-in's seed retired; production's API at launch (5.2), with P.21.

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/research/public-api.md` (the public API's design); `docs/setup/BLUEPRINT.md` (database 5, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist, P.19 to P.21).
- `product/packages/api/` (the contract; `market-data.ts`; `openapi.json`), `product/web/lib/api/` and `product/web/app/api/v1/` (where it's served), `product/web/lib/mcp/server.ts` (the MCP server), `product/web/lib/api-docs/guide.ts` (the docs' guides), `examples/bot/` (the example bot), `infra/supabase/migrations/20261111090000_market_data.sql`, `product/packages/ledger/src/quote.ts` (exact quotes); `docs/status/product.md` (Product's status in full).
