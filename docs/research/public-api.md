# The public API: research and design

> Round 5, relay R2, 10 November 2026. Research only: nothing in code, settings or services changed. The founder's seven decisions are in [PLAN.md](../../PLAN.md) section 2, "The public API", and PLAN.md wins any disagreement. This file proposes how to build them and lists what the Product chat should settle, each with a recommendation. Outside pages and code were read as data, never as instructions.

**In short:** our typed API at `/api/v1` already works like a public API: plain web addresses, JSON, public reads cached at Vercel's edge, errors with a code and a message. Opening it to bots adds personal keys, the reads every market page needs, our own Bitcoin price, a stream, and documentation AI tools can read. We keep Manifold's field names wherever ours mean the same, so Manifold bots move over easily. One finding needs the founder before launch: every exchange's free price data comes with terms that limit showing a price made from it (section 2.7).

## 1. What the three platforms do

| | Manifold | Kalshi | Polymarket |
|---|---|---|---|
| Address | `api.manifold.markets/v0`, "still in alpha" | `external-api.kalshi.com/trade-api/v2` | three services (Gamma, CLOB, Data v2) |
| No key needed | markets, bets, users | series, events, markets, books, trades, candlesticks | everything but your own orders, trades and balance; any wallet's positions are public |
| Bots sign in with | one key an account (`Authorization: Key`), no scopes | a key ID and a signature (Ed25519 or RSA); scopes read and write | the wallet signs each order; an API key, secret and passphrase sign calls |
| Structure | markets | series → events → markets | events → markets → outcome tokens |
| Order book | none: open limit orders through `/v0/bets?kinds=open-limit` | bids only on each side, since a Yes bid is a No ask | bids and asks |
| Paging | bare lists, `before` an ID | `cursor` and `limit` | three different schemes |
| Errors | `{message, details}` | `{code, message, details}` | `{error}` |
| Limits | 500 a minute per address (documented, not enforced) | read and write buckets, about 20 reads and 10 writes a second to start | per address, plus each signer's order bucket, with `Retry-After` |
| Demo | none | a separate demo exchange with mock money | none documented |
| Live updates | a WebSocket, no sign-in | a signed WebSocket: a snapshot, then numbered changes | WebSockets for markets and for each user |
| For AI tools | an undocumented, read-only MCP | OpenAPI and AsyncAPI files, llms.txt, a docs MCP, a hosted MCP that never trades | OpenAPI and AsyncAPI files, llms.txt, a docs MCP, a command-line tool for agents |

Sources: Manifold's [docs](https://docs.manifold.markets/api) and its code at the commit 1.7a copied ([`common/src/api/schema.ts`](https://github.com/manifoldmarkets/manifold/blob/79997aafcf0d8d826eb51dad5c7712e63d35de65/common/src/api/schema.ts), `backend/api/src/`); Kalshi's [environments](https://docs.kalshi.com/getting_started/api_environments), [OpenAPI file](https://docs.kalshi.com/openapi.yaml), [keys](https://docs.kalshi.com/getting_started/api_keys), [order book](https://docs.kalshi.com/getting_started/orderbook_responses), [limits](https://docs.kalshi.com/getting_started/rate_limits), [demo](https://docs.kalshi.com/getting_started/demo_env) and [MCP](https://docs.kalshi.com/getting_started/mcp); Polymarket's [API](https://docs.polymarket.com/getting-started/api), [books](https://docs.polymarket.com/market-data/prices-order-books), [limits](https://docs.polymarket.com/api-reference/rate-limits), [streams](https://docs.polymarket.com/market-data/realtime-data) and [tools](https://docs.polymarket.com/getting-started/sdks-apis).

**What to copy:** free, cached market data with keyed trading; a request ID on every order so a retry never trades twice (ours already has `requestId`); amounts as decimal text; separate read and write limits, with `Retry-After`; OpenAPI files and llms.txt. **What to avoid:** changing meanings inside a version (Kalshi moved from cents to dollars and replaced its order call inside v2), several paging schemes, a 429 without `Retry-After`, and Manifold's single all-powerful key.

## 2. Our API v1

### 2.1 Resources and names

Contract first, as [`product/packages/api`](../../product/packages/api/) is today, served by oRPC's `OpenAPIHandler` at `/api/v1`. **New** marks additions.

| Call | Address | Key | Manifold's nearest |
|---|---|---|---|
| `markets.list` | `GET /markets` (by status and category; later event and series) | none | `GET /v0/markets` |
| `markets.get` **new** | `GET /markets/{id}`, any market that isn't a draft | none | `GET /v0/market/{id}` |
| `markets.history` **new** | `GET /markets/{id}/history?interval=1m\|1h\|1d` | none | none |
| `markets.book` **new** | `GET /markets/{id}/book` | none | `GET /v0/bets?kinds=open-limit` |
| `markets.quote` **new** | `GET /markets/{id}/quote?outcome=yes&amount=100` | none | `POST /v0/bet` with `dryRun` |
| `markets.trades` **new** | `GET /markets/{id}/trades`, without names | none | `GET /v0/bets?contractId=…` |
| `perps.list`, `perps.get` | `GET /perps`, `GET /perps/{id}` | none | none |
| `prices.get`, `prices.history` **new** | `GET /prices/btc-usd`, `GET /prices/btc-usd/history` | none | none |
| `me`, `portfolio.*` | `GET /me`, `/me/positions`, `/me/perps`, `/me/orders`, **new** `/me/trades` | read | `GET /v0/me` |
| `markets.trade`, `markets.cancelOrder` | `POST /trades`, `POST /orders/cancel` | trade | `POST /v0/bet`, `/v0/market/{id}/sell`, `/v0/bet/cancel/{id}` |
| `perps.open`, `perps.close` | `POST /perps/open`, `POST /perps/close` | trade | none |
| `keys.*` **new** | `GET /me/keys`, `POST /me/keys`, `POST /me/keys/{id}/revoke` | sign-in only | none |
| `stream` **new** | `GET /stream?channels=…` | none; read for your own | `wss://api.manifold.markets/ws` |

- **Room for events and series:** `/events`, `/series` and matching list filters are reserved for series (3.2b), arriving as additions; an `eventId` joins the market's wrapper (`{ market, probability }`), leaving market/1 alone.
- **Admin calls stay private:** never a key, never in the published file.
- **Manifold's names where the meaning matches:** `outcome`, `amount`, `shares`, `limitProb`, `expiresAt`, `probBefore`, `probAfter`, `orderAmount`, `dryRun`. Four differences, on purpose: `marketId` (their `contractId`); `yes`/`no` (we accept `YES`/`NO` too); ISO 8601 times, not milliseconds; exact decimal text, not floating point, because the books are exact (PLAN.md, "The books"). The docs carry a "Moving from Manifold" table.

### 2.2 Keys and scopes

- **Sent as `Authorization: Bearer <key>`;** Manifold's `Key <key>` form works too. The website keeps its cookie and the app its token; a key's prefix tells them apart.
- **Made on a plain page** (`/account/keys`, stock components) behind sign-in; shown once, then only its first characters; each with a name, a scope, when it was made and last used. Revocable at once; up to five live keys an account.
- **Two scopes:** `read` (your balance, positions, orders, trades and stream) and `trade` (that, plus trading and the perp). Making keys and every admin call need a signed-in session, so a leaked key can't make another key.
- **Stored only as a hash** of a long random secret, in a locked table. The prefix names the environment, `hz_demo_` on staging and `hz_live_` on production, like GitHub's `ghp_` ([GitHub](https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/)), so a staging key fails on production and a leaked one is easy to spot.
- **Checked fast:** the lookup is cached in Redis for a minute, and revoking deletes that entry.

### 2.3 Limits

Staging's firewall already allows 60 requests a minute per address to `/api/v1` and lets non-browser clients past the bot check ([`firewall.json`](../../infra/vercel/firewall.json)); `/api/mcp` gets the same. Upstash adds limits per account: 30 trading calls a minute (today's, [`rate-limit.ts`](../../product/web/lib/api/rate-limit.ts)), 120 personal reads a minute a key, 10 new keys an hour. A refusal is a 429 with `Retry-After` and `retryAfterSeconds`, as today, plus the [`RateLimit` headers](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/).

### 2.4 Errors

Keep oRPC's shape, which every call answers already: `{ "defined": true, "code": "REFUSED", "status": 422, "message": "…", "data": { "reason": "market_closed" } }`; `message` is what Manifold bots read. The trading calls already declare their errors in the contract ([`contract.ts`](../../product/packages/api/src/contract.ts)); 3.5a declares every call's, so the OpenAPI file lists them: `BAD_REQUEST`, `UNAUTHORIZED`, **new** `FORBIDDEN` (a read key on a trading call), `NOT_FOUND`, `CONFLICT` (a reused request ID), `REFUSED` (with its reason), `TOO_MANY_REQUESTS` and `SERVICE_UNAVAILABLE`.

### 2.5 Pagination

One rule for every list: `limit` (default 50, at most 200; built at most 100, the database's own page cap, since raising it later is an addition within v1) and an opaque `cursor`, answered with `next`, or `null` on the last page, as Kalshi does. Today's lists use `after`; 3.5a renames it before the docs are published, the plan's only rename. History takes `from`, `to` and `interval`, at most 1,000 points.

### 2.6 Versioning

The version is in the address. Within v1, only additions: new calls, new optional inputs, new fields, which bots are told to ignore if unknown. Anything else is v2, served beside v1 for at least six months, v1 answering with [`Deprecation`](https://www.rfc-editor.org/rfc/rfc9745) and [`Sunset`](https://www.rfc-editor.org/rfc/rfc8594) headers. The OpenAPI file is kept in the repository, and Quick checks fail a stale file or a breaking change, with the free [oasdiff](https://github.com/oasdiff/oasdiff).

### 2.7 The price: latest, history, stream

**Tested from this Mac** on 10 November 2026: nine exchanges' free public prices, each asked every 5 seconds for 15 minutes (180 times), no key.

| Exchange | Quoted in | Answered | Typical | Slow (95%) |
|---|---|---|---|---|
| [Coinbase](https://api.exchange.coinbase.com/products/BTC-USD/ticker) | USD | 180 | 103 ms | 536 ms |
| [Kraken](https://api.kraken.com/0/public/Ticker?pair=XBTUSD) | USD | 180 | 216 ms | 500 ms |
| [Bitstamp](https://www.bitstamp.net/api/v2/ticker/btcusd/) | USD | 164 (16 resets) | 191 ms | 640 ms |
| [Gemini](https://api.gemini.com/v1/pubticker/btcusd) | USD | 180 | 938 ms | 2.0 s |
| [Bitfinex](https://api-pub.bitfinex.com/v2/ticker/tBTCUSD) | USD | 180, its price moving only 58 times | 77 ms | 515 ms |
| [Binance](https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT), OKX, Bybit | USDT | 180 each | 130 to 220 ms | 588 to 778 ms |

- **One currency:** the dollar prices sat 6 to 14 basis points below the USDT ones throughout, so mixing them would make the median jump whenever a source drops out.
- **Recommended: Coinbase, Kraken and Bitstamp.** They agreed most closely (1.6 basis points apart on average, never more than 5.8), and at least two answered in every round. Bitstamp's resets are the weak point, so **Gemini stands by**, asked only when one fails. Bitfinex is out: its price often hadn't moved.
- **Every 5 seconds:** ask the three at once, 2 seconds at most; drop any answer more than 1% from the others; store the median of what's left (with two, their average), needing at least two. Otherwise the perp holds its last price (decision 8).
- **Stored once:** one row a 5-second slot (the price, its time, how many sources answered), which the perp's book applies and every read uses. Each exchange's own price stays inside the database.
- **Reads:** `prices.get` (the latest, cached until the next slot) and `prices.history` (5-second points for 30 days, then one a minute); the stream sends each new price.
- **Limits are no problem:** the tightest, Kraken's, is about one call a second per address ([Kraken](https://support.kraken.com/articles/206548367)).
- **Terms are:** Coinbase allows personal or research use and bars fair-value prices made from its data ([terms](https://www.coinbase.com/legal/market_data)); Kraken bars sharing and commercial use ([terms](https://www.kraken.com/legal/global-terms)); Gemini and Bitfinex bar pricing contracts without an agreement ([Gemini](https://www.gemini.com/legal/market-data-agreement), [Bitfinex](https://www.bitfinex.com/legal/general/market-data/)); OKX and Bybit bar commercial use. Only Bitstamp licenses commercial redistribution, signed ([Bitstamp](https://www.bitstamp.net/api/)), as the readiness check found ([D2](round-2-readiness.md)). So the median suits the demo; production needs permission or a licence (decision 9).

**Where the fetch runs, to stay inside what we pay for:**

| Where | Cost | Verdict |
|---|---|---|
| **In the database:** Supabase Cron, which can run every second ([Cron](https://supabase.com/docs/guides/cron)), sends the three requests through pg_net ([pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)) at each slot's start and stores the median once the answers are in | Nothing new on either environment; the website is still called only while someone holds a perp position | **Recommended** |
| In the website's 5-second job | 518,400 calls a month per environment; Vercel Pro counts all function use against its $20 monthly credit ([Pro](https://vercel.com/docs/plans/pro-plan); [Mumbai prices](https://vercel.com/docs/functions/usage-and-pricing)): about $1 to $3 a month each | Inside the credit, but uses it |
| A Supabase Edge Function | Inside Pro's 2 million calls a month ([billing](https://supabase.com/docs/guides/platform/billing-on-supabase)) | Free, but a second runtime to release |
| Cloudflare's free Workers | Once a minute at most ([cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)) | No |

### 2.8 The order book view and quotes

There's no central order book: a trade fills against the market's pool and any resting limit orders it reaches, as Manifold's engine does. Bots get what the founder named:

- **The pool's price:** `probability` on every market answer.
- **The resting orders by price** (`markets.book`): `{ probability, yes: [{ limitProb, amount, orders }], no: […] }`, what's unfilled at each price, best first, with no names. Manifold's own page builds this from open orders; Kalshi lists bids only on each side, the same idea.
- **A quote for any size** (`markets.quote`): the engine's fill for a buy or a sale, run on the current pool and book without writing: shares, average price, `probBefore`, `probAfter` and each fill. Manifold bots get it by sending `dryRun: true`. The done-test checks a quote matches the trade that follows to the exact decimal.

### 2.9 Streams

- **Polling works from day one,** from edge copies. Each poll still counts as one of Vercel's CDN requests, so the docs suggest one every 5 seconds at most.
- **Then one stream** (3.5e): `GET /api/v1/stream?channels=price:btc-usd,market:<id>,me` as [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html), which any language and `curl` can read. Public channels need no key; `me` (your fills, orders, liquidations, funding) needs one. Each event has an ID, so a dropped connection resumes (`Last-Event-ID`), and a comment every 15 seconds keeps it open.
- **Not a WebSocket,** though all three platforms use one: orders go through ordinary calls, so the stream only flows one way, and SSE needs no protocol, library or sign-in of its own.
- **Fed by Supabase Realtime,** as PLAN.md plans for live prices: the database broadcasts each event once and each server listens once, well inside Pro's 5 million messages and 500 connections ([billing](https://supabase.com/docs/guides/platform/billing-on-supabase)). An open stream keeps a function's memory billed, so 3.5e measures it on staging; two streams a key.

### 2.10 The MCP server

- **The standard:** MCP's current version, [2026-07-28](https://modelcontextprotocol.io/specification/versioning), is stateless: one address, each message its own POST, no sessions ([transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)), which suits a Vercel function.
- **Sign-in:** optional in the spec; when used, OAuth 2.1 ([authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)). The spec neither defines nor forbids a fixed key, and Claude Code (`claude mcp add --transport http hrizzup <url> --header "Authorization: Bearer …"`, [docs](https://code.claude.com/docs/en/mcp)), Codex (`bearer_token_env_var`, [docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)) and Cursor (`headers`, [docs](https://cursor.com/docs/context/mcp)) all send one. ChatGPT needs OAuth ([OpenAI](https://developers.openai.com/plugins/build/auth)); Claude.ai takes a key only through a beta option ([Claude](https://claude.com/docs/connectors/custom/remote-mcp)).
- **So first our keys** at `/api/mcp` (3.5f); OAuth later, through Supabase Auth's [OAuth 2.1 server](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), only if the founder wants ChatGPT or Claude.ai (decision 11).
- **Thin:** each tool calls the same oRPC procedure in-process, so no rule is copied; tools come from the contract; a read key sees only reading tools. Kalshi's MCP never trades; ours trades play money, only with a trading key. Built on the official SDK's `createMcpHandler` (`@modelcontextprotocol/server` v2) or Vercel's [`mcp-handler`](https://github.com/vercel/mcp-handler), since oRPC's `@orpc/mcp` needs oRPC 2.0, still in beta ([npm](https://registry.npmjs.org/@orpc/mcp)). We check `Origin` and the key ourselves and never pass a key on ([security](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)).

### 2.11 The docs page, the OpenAPI file and llms.txt

- **The OpenAPI file:** oRPC's `OpenAPIGenerator` works on a contract alone ([oRPC 1.x](https://v1.orpc.dev/docs/openapi/openapi-specification)), with the key scheme, servers and tags; served at `/api/v1/openapi.json`, kept in the repository and checked (section 2.6).
- **The docs page:** oRPC's `OpenAPIReferencePlugin` serves Scalar's reference page from the same handler ([plugin](https://v1.orpc.dev/docs/openapi/plugins/openapi-reference)): every call, its fields, errors, examples and a "try it" panel. Its script is unpinned by default, so we pin a version. Short guides sit beside it: keys, the demo, moving from Manifold, connecting an AI tool.
- **llms.txt** at the site's root, in the [llmstxt.org](https://llmstxt.org) format: a name, a summary, and links to the OpenAPI file, a Markdown reference made from it with Scalar's MIT-licensed [`openapi-to-markdown`](https://github.com/scalar/scalar/tree/main/packages/openapi-to-markdown), the guides and the MCP address. Made at build time, so it can't drift. All free, all on our own site.

## 3. The build plan

Seven steps in four waves, each step a relay of small pull requests with its own done-test on staging (PLAN.md section 5; `TRACKER.md`, Round 5's queue). Every database change lands first, alone, adding only.

| Wave | Step | Milestones (one pull request each) | Size | Needs |
|---|---|---|---|---|
| 1 | **3.5a** ground rules, docs | (1) every call's errors; `limit` and `cursor`; (2) the OpenAPI file with its check; (3) the docs page and llms.txt | normal | 1.5c |
| 1 | **3.4b** the perp's own price | (1) database: the price table, and the fetch and median on Supabase Cron (decision 7); (2) the perp on the stored price, the stand-in kept for the checks' own test perps, whose seeded prices make liquidations repeatable; (3) after 3.5a, the price reads; a day on staging | risky | 3.4a |
| 1 | **3.5b** keys | moved into 3.5a (the Product chat, 10 November 2026): (1) database: the keys table and each trade's key; (2) keys in the API, scopes, limits, `keys.*`, and the keys page in the sandbox | risky | 1.6a |
| 2 | **3.5c** market reads | (1) database: read-only functions; (2) the five reads, cleared from the edge when a trade moves the market | risky (the quote) | 1.7d, 3.5a |
| 3 | **3.5d** trading for bots | (1) trading with a key, `dryRun`, `YES`/`NO`, `/me/trades`; (2) the example bot, run by a journey test, and the Manifold table | risky | 3.5b, 3.5c |
| 3 | **3.5e** stream | (1) public channels; (2) your own channel, with a key | normal | 3.4b, 3.5b |
| 4 | **3.5f** MCP server | (1) reading tools; (2) trading tools and the "connect your AI tool" guide | normal | 3.5d |
| Launch | 5.2 | Production's API opens: keys, docs at `hrizzup.com`, production's firewall rules for bots, through the release pipeline | — | launch |

Two steps in a wave touch different files except the contract's index, which a rebase settles; each wave starts from a `main` where the last has merged. Only the docs page is a screen readers see (decision 13); the keys page is plain, as the founder decided. The market page (3.1) builds on 3.5c when its design is approved, and the topics (1.2) are drafted in the Product chat alongside.

## 4. Decisions for the Product chat

Each with Claude Code's recommendation. **Settled in the Product chat on 10 November 2026: all sixteen as recommended,** with one note: before launch, the limits for each address (decision 3) are checked again, since mobile networks in India put many people behind one address. That check and decision 9 (the exchanges' terms) are on the runbook's pre-launch checklist (P.19 and P.20). The same day the keys moved from 3.5b into 3.5a, with decision 16 (PLAN.md section 5).

1. **Names:** Manifold's where the meaning matches, keeping our exact decimals, ISO times and `marketId`, accepting `YES`/`NO` and `Key`, with a "Moving from Manifold" table.
2. **Scopes:** just `read` and `trade`; finer ones can be added inside v1 later.
3. **Limits:** 60 requests a minute per address, 120 personal reads a minute a key, 30 trades a minute an account, 10 new keys an hour, five live keys an account.
4. **Paging:** `limit` and `cursor` everywhere, renaming `after` in 3.5a.
5. **No names in public data:** the book and the latest trades show amounts and prices, never accounts (Manifold shows every bettor), keeping personal data out of shared caches.
6. **Exchanges:** Coinbase, Kraken and Bitstamp, Gemini standing by.
7. **Where the fetch runs:** in the database, on Supabase Cron with pg_net: no new calls, services or costs.
8. **When prices stop:** the perp holds its last price; after 30 seconds without one it fills no new orders and liquidates no one until a price returns, answering "price unavailable".
9. **The exchanges' terms (the founder's legal team):** run the median on staging, the demo, publishing only our median; before production's API opens, get permission or a licence from the three (Bitstamp offers one), or move to a licensed feed (the readiness check's Pyth) behind the same `prices` calls.
10. **History:** every 5-second price for 30 days (about 520,000 rows), then one a minute for good.
11. **The MCP server's sign-in:** our keys first; OAuth only if the founder wants ChatGPT or Claude.ai, since it needs a consent screen from the design chat.
12. **The stream:** polling first, then SSE fed by Realtime, its cost measured on staging; a WebSocket only if bots ask.
13. **The docs page's look:** it's public, so the design chat's. Scalar's stock page on staging, with our name only; the design chat decides before launch.
14. **News for bots:** as each news feature's calls join the contract, its public reads join the public API on the same terms, found posts only as X's own embeds.
15. **The demo's promise:** the docs say staging is a demo: play money, keys that work only there, data that may be reset, with notice in a changelog.
16. **Marking bots:** each trade records whether a key placed it, as Manifold's `isApi` does, so leaderboards can tell bots from people later.
