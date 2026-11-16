# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 16 November 2026 by Round 5's relay R6, the round's closing record ([#PRNUM](https://github.com/Zugzwang-world/hrizzup/pull/PRNUM)). PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories seen through creators' takes. **Product builds** the website and the app (the website a stage ahead), the markets, and the public API for bots and AI tools, showing content through the content store's tables in the hand-over agreement's shapes (`agreement/README.md`, first half Agreed).

## Where things stand

- **Round 5 closed on 16 November 2026** ([#PRNUM](https://github.com/Zugzwang-world/hrizzup/pull/PRNUM)): the markets sandbox and the public API for bots are done on staging, the demo, all but the API's stream (3.5e, later).
- **Round 6 is open** (milestone "Round 6"). **It's social:** the founder lays it out in the Product chat, and its relays join the queue once the Product chat settles them. The market page (3.1), the perp's page (3.4c) and the board (2.1) still wait for the design chat's designs.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API at `/api/v1` with its OpenAPI file, docs (`/docs`, `/llms.txt`) and MCP server (`/api/v1/mcp`); the example bot (`examples/bot`); the app's sign-in test (1.6b: two of the founder's tries open); the market engine, ledger and console; play money on signup; the content store; the Bitcoin perp on our own price; the markets sandbox.

## Round 6 progress

- **Social's relays:** none yet. They come once the Product chat settles Round 6; its first relay records what's settled, inside its own first pull request, and numbers the relays here.
- **Carried from Round 5, not started, unnumbered until written:** the market page (3.1), then the perp's page (3.4c), and the board (2.1), each when the design chat approves its design; live updates for bots (3.5e), later; `GET /me/orders` showing a market past its closing time as closed; the Speed warnings on the sandbox's market page and the home page; the stand-in price's unused seed retired; last, the round's closing record. For the founder: nothing new.

## Decisions in force

- **Round 6 is social** (the founder, 16 November 2026): he lays it out in the Product chat; nothing about it is recorded until Round 6's first relay records what's settled. The markets' next steps (1.2, 3.2a, 3.2b) stay in the markets track as they are.
- **The public API** (the founder, 10 November; PLAN.md section 2): one versioned API (`/api/v1`) for the website, the app and bots; public market data keyless and edge-cached, personal and trading calls keyed (read-only or trading keys); staging the bots' demo until launch; an OpenAPI file, docs, llms.txt and an MCP server. Its sixteen details as recommended (`docs/research/public-api.md`, section 4).
- **Settled in the Product chat, 11 November** (now in PLAN.md too): the held price stays for the demo, and before production's API opens perp orders fill only at a fresh price (runbook P.21); the docs keep the site's plain look until the design chat styles them; the stream (3.5e) waits: bots ask for prices again and again.
- **The perp's own price** (10 November): every 5 seconds, in the database, the median of Coinbase, Kraken and Bitstamp (Gemini the spare); orders fill at the next price; held 30 seconds when prices stop; exchanges' own answers never shown. An account holds one position per side.
- **Product first, nothing paid** (the founder, 10 November): no new privacy, security or production work unless it blocks the product; free tiers only; checks, budgets and rules never looser.
- **How sessions work** (the founder, 10 November): one watcher on checks; no questions to the founder, one short final report; his tries are the record; records inside each milestone's pull request.
- **Two surfaces, one account,** the website a stage ahead; English; India first. **Design** only from the founder's references and diagrams. **Database changes land first,** adding only.
- **Markets:** made only by Hrizzup, double-entry play money in exact decimals, Manifold's defaults. **Content:** the agreement's shapes, no xAI or X API.
- **How checks behave:** each run owns what it changes; no check asks an exchange; a failed check is re-run only for an outage outside our code. **Budgets never move.** **Public until launch** (P.17).

## What changed in the latest session

**R6 closed Round 5 and opened Round 6** ([#PRNUM](https://github.com/Zugzwang-world/hrizzup/pull/PRNUM), records only: no code, database, settings or checks changed):

- **`TRACKER.md`:** Round 5's queue final (R1 to R5 done; 3.5b cancelled, built in 3.5a; 3.5e moved to Round 6's queue, later; 3.1, 3.4c and 2.1 moved, each still waiting for its design); Round 6's queue, with every open item carried and no social rows yet.
- **`PLAN.md`:** the Product chat's three settlements of 11 November hadn't reached it, so they're added (section 2, "The public API", and step 3.5e). The Sourcing and News Desk briefs are rewritten for it; nothing in their parts changes.
- **The founder's bot tests, by his report (12 November):** the example bot ran on staging with every number exact; the price check found our Bitcoin price live: 180 prices in 15 minutes, 147 distinct values, the longest unchanged stretch about 15 seconds.
- **GitHub:** the milestone "Round 6" opened and "Round 5" closed; nothing was left open in "Round 5".

## Open questions

One line each; the detail, and the rest, are in the status file.

- **`GET /me/orders` still shows a market past its closing time as open** ([#139](https://github.com/Zugzwang-world/hrizzup/pull/139)): its database read lacks the closing time. Recommendation: add it in a small database change first, then show the state as every other read does (carried in Round 6's queue).
- **Changing a request's existing forms within v1:** the breaking-change check reads any edit inside a request's existing choice as a removal. Recommendation: always add a new choice, never edit one; keep the check as it is.
- **Speed warnings on pages R5 didn't touch:** the sandbox's market page and the home page each crossed 200 ms once, in a first run. Recommendation: measure each alone, as #110 did (carried in Round 6's queue).
- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, so the first half changes once.
- **The pipeline's write access** (1.1). Recommendation: a role that inserts and updates, never deletes.
- **Also in the status file:** pg_net's grants; node-forge in the Expo tool only; Vercel Pro's function billing; Vercel's toolbar; sign-ups waiting for the house; the ledger's next steps; embedding found posts; the Hermes rewrite; shared code; the stand-in's seed, unused now.

## For the founder

- **Your bot tests are done** (your report, 12 November): the example bot on staging, every number exact, and our Bitcoin price live. Nothing more needed. **Claude Code through the MCP server** stays there to try whenever you like (the steps R5 gave you, 11 November: a **Trading** key from `staging.hrizzup.com/sandbox/keys` in your Mac's Keychain, `claude mcp add-json` with a Keychain helper, then a new Code session).
- **Round 6, social:** lay it out in the Product chat; its first relay records what's settled.
- **Before launch:** the exchanges' terms (your legal team; P.19); the API's limits for each address (P.20); nothing to do now.
- **The first topics (1.2):** approve or change them when the Product chat drafts them.
- **Try the sandbox** at `staging.hrizzup.com/sandbox`, and **your two phone tries for 1.6b** in the app's **Sign-in test**; tell the Product chat.
- **Designs:** your references in the design chat; the market page (3.1), the perp's page (3.4c) and the board (2.1) wait on them. **When you choose:** developer accounts (0.4), 12 testers, News Desk. **Spending parked.**

## What's next

Round 6 (`TRACKER.md`, "Round 6's queue"): social, once the Product chat settles it. Carried: the screens (3.1, 3.4c, 2.1) once their designs are approved, the market page on 3.5c's reads; `/me/orders`' closing time; the Speed warnings; the stand-in's seed retired; Manifold's fuzz test split by the next relay that touches the engine. The topics (1.2) in the Product chat. Before 3.3: market/2. Later: the stream (3.5e); production's API at launch (5.2), with P.21.

## Read for detail

- `PLAN.md`, `TRACKER.md`, `CLAUDE.md`; `docs/research/public-api.md` (the public API's design); `docs/setup/BLUEPRINT.md` (database 5, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist, P.19 to P.21).
- `product/packages/api/` (the contract; `market-data.ts`; `openapi.json`), `product/web/lib/api/` and `product/web/app/api/v1/` (where it's served), `product/web/lib/mcp/server.ts` (the MCP server), `product/web/lib/api-docs/guide.ts` (the docs' guides), `examples/bot/` (the example bot), `infra/supabase/migrations/20261111090000_market_data.sql`, `product/packages/ledger/src/quote.ts` (exact quotes); `docs/status/product.md` (Product's status in full).
