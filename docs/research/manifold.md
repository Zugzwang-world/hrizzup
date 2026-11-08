# Manifold's code: what we can use

Research for PLAN.md step 1.7 (the market engine) and step 3.2 (markets that settle themselves), 8 November 2026. Research only: nothing was copied into this repository.

**Since then** (the founder's market model, 8 November 2026, PLAN.md section 2): markets are built first on test markets, settled by hand; the topics, with automatic resolvers (step 3.2a) and their data sources (step 1.2, parked), come once markets work end to end on staging. Section 5's sports flow and the data-source rows below are reference for that later step.

**What was read:** [github.com/manifoldmarkets/manifold](https://github.com/manifoldmarkets/manifold), commit `79997aafcf0d8d826eb51dad5c7712e63d35de65` (5 November 2026), cloned outside `~/hrizzup`. Every path below is a path in that repository.

**Licence:** MIT (`LICENSE.md`, "Copyright (c) 2022 Manifold Markets, Inc."). We may copy, change and use the code, including commercially, as long as the copyright and licence notice go with it. When step 1.7 copies code, the notice goes beside it and into `THIRD_PARTY_NOTICES.md`, as CLAUDE.md requires.

## In short

- **The market engine is easy to take.** The yes/no maths, limit orders, selling, fees and settlement payouts are plain TypeScript in `common/src/`, with no database or server code in them. Their tests run on their own: 19 test files, 539 tests, all passing in 23 seconds, in a separate folder with seven small libraries installed.
- **How Manifold keeps trades in order doesn't carry over.** Its trading server is one machine on Google Cloud, and trades wait in a queue held in that machine's memory. On Vercel, many copies of our API run at once, so the database has to do the ordering: one lock per market, inside each trade's transaction.
- **Perpetuals ("perps") are there, with many tests.** They are a large, separate system that is still being tuned after real losses to trading bots. The founder has since added one Bitcoin perp to the plan (step 3.4).
- **The sports bot is in the repository,** and it is a useful model for our cricket and football markets. It has no cricket competition switched on.
- **Everything around the engine is Manifold's own and gets replaced:** Firebase sign-in and file storage, a Google Cloud machine, its own live-update server, a scheduler on its own machine, and Mailgun for email. We already have Supabase Auth, Vercel, Supabase Realtime, R2 and Resend.

## 1. Perps

**Yes, the code is there, with tests.** Manifold calls them "ManiPerp perpetual futures". They are a separate market type (`outcomeType: 'PERP'`, `common/src/contract.ts:316`), kept apart so the feature can be removed (removal checklist: `backend/shared/src/perps/README.md:931`).

- **The maths:** `common/src/perps/` (`amm.ts` for positions, liquidation and auto-deleveraging; `funding.ts`; `fees.ts`; `orders.ts`; `pnl.ts`), each with a test file beside it.
- **The engine that changes balances:** `backend/shared/src/perps/engine.ts` (`openOrAddPosition`, `closePosition`, `runOracleUpdate`, `runFunding`, `resolvePerp`). It locks each market with `pg_advisory_xact_lock` on the market's id.
- **The trade endpoints:** `backend/api/src/place-perp-trade.ts`, `close-perp-position.ts`, `get-perp-positions.ts`, `get-perp-quote.ts`.
- **The database tables:** `backend/supabase/migrations/2026042201_add_perps.sql` and later migrations; `backend/supabase/perp_orders.sql`, `contract_perp_positions.sql`, `contract_perp_events.sql`, `contract_perp_funding_events.sql`, `oracle_prices.sql`.
- **The explanation:** `backend/shared/src/perps/README.md` (942 lines), `perps-launch-runbook.md`, `dev-docs/mnx-perps.md`.
- **Tests:** about 35 files in `common/src/perps/` and about 15 in `backend/shared/src/perps/`. `backend/shared/src/perps/orders.test.ts` runs a real Postgres in memory (PGlite). Seven of the `common/src/perps/` test files (amm, fees, funding, orders, pnl, close-amount and oracle) passed when run on their own (section 2).
- **Only Manifold's staff create perps:** `create-perp` refuses everyone except the official account (`backend/shared/src/perps/README.md:83`; `common/src/perps/no-user-created-perps.test.ts`).

**Where the price comes from.** A list of price feeds (`backend/shared/src/oracle-feeds.ts`), each with an adapter that reads an outside source:

- Bitcoin in US dollars: the median of the exchanges that agree, out of Coinbase, Kraken, Bitstamp and Gemini (`backend/shared/src/btc-price.ts`; feed entry `oracle-feeds.ts:146`);
- tokenised shares (xStocks), read from Solana trading pools (`xstocks-price.ts`, `common/src/perps/solana-pools.ts`);
- MNX's derivative prices (`mnx.ts`), Adjacent's misery index (`adjacent-msry.ts`), VoteHub polling averages (`votehub-feeds.ts`), the crypto Fear and Greed index (`fear-greed.ts`), and OpenRouter's AI model usage shares (`openrouter-tokens.ts`).

Every new price is saved in `oracle_prices`, with sanity limits and a "too old" limit per feed. If a price is too old, trading pauses (`getOracleFreshness`, `common/src/perps/oracle.ts`).

**How often.** "Fast" feeds update every 2 seconds (`ORACLE_TICK_PERIOD_MS = 2_000`, `backend/scheduler/src/jobs/update-oracle-feeds.ts:187`). Adjacent's index is read every 20 seconds because of its quota. The polling-average and Fear and Greed feeds are read every 5 minutes, OpenRouter's every hour, and the "daily" feeds are applied by the hourly job (`backend/scheduler/src/jobs/update-perps.ts`). The README's "Scheduler" section (line 799) lists them all.

**Orders wait for the next price.** A trade doesn't fill at the price on screen. It waits, with its money held aside, and fills at the first new price published after it was placed (`backend/shared/src/perps/README.md:13`, `backend/shared/src/perps/orders.ts`). Manifold added this after bots made about M$70,000 by trading on prices they could see were about to change (README line 186).

**Funding** is paid every funding period: one hour by default (`FUNDING_PERIOD_MS`, `common/src/perps/funding.ts:47`), or longer for slow feeds. The crowded side pays the other side. The rate grows with how lopsided the open positions are: `f = I(r) × f_max`, where `r` is the larger side's open positions divided by the smaller side's, and `I(r) = (r − 1) / (r − 1 + k)` (`imbalance` and `computeFundingRate`, `common/src/perps/amm.ts:150` and `:197`). `f_max` and `k` are set for each market. The hourly job runs it, and a check inside `runFunding`, under the market's lock, stops it paying twice.

**Liquidations** are checked on every new price, in the same transaction that saves it (`runOracleUpdate`). A position is closed when the price reaches the point where its margin is used up. For a buy ("long"), that point is entry price × (1 − 1/leverage); for a sell ("short"), entry price × (1 + 1/leverage) (`liquidationPrice` and `processLiquidations`, `common/src/perps/amm.ts:74` and `:334`). There is no extra safety margin. The lost margin stays in the market's pool. If the pool still can't pay the winners, winning positions are scaled down ("auto-deleveraging", `applyADL`, `amm.ts:353`). If even that fails, trading on the market halts until staff add money (README "Solvency halt", line 472). New positions are also capped at 10 times what the other side can back (`PERP_OPEN_INTEREST_COVER_MULTIPLE`, `amm.ts:912`).

**The fee on opening a position** (`common/src/perps/fees.ts`; README "Taker fee", line 186):

- **Opening only:** it's charged on the position's full size when it is opened or added to. Closing is free.
- **The rate:** a base of 10 basis points (0.1%), plus an optional extra for positions that are large next to the pool. The extra is `takerFeeImpact × s²`, where `s` is the position's share of the pool.
- **Higher for API keys:** opens made with an API key pay the higher of the normal rate and a separate API rate. The caps are 100 basis points for the normal rate and 300 for the API rate.
- **A limit:** an open is refused if its fee would be half its own margin or more.
- **Where it goes:** into the trader's own side of the pool, not to Manifold.

**For us** (updated 8 November 2026): the founder has added one Bitcoin perp to the plan as step 3.4, in play money. We take Manifold's perps maths (`common/src/perps/`) with its tests, and build our own engine on our trade transactions. Its starting rules are leverage capped at 10 times, filling at the next price, an opening fee and an off switch. A new price and a liquidation check run every few seconds through Supabase Cron. Every rule change goes in a log. Manifold changed its rules after several real incidents in the last three months; we start from the defences it ended up with. Manifold's Bitcoin price, the median of several exchanges that must agree, is the model for step 1.2's live price.

## 2. The market engine

The engine is in two layers. The maths is in `common/src/`, with no database, network or server code. The server code that runs it and saves the results is in `backend/`.

| Part | The maths (`common/src/`) | The server side (`backend/`) |
|---|---|---|
| Yes/no market maths | `calculate-cpmm.ts` (the pool maths, `calculateCpmmPurchase`, fees), `new-bet.ts` (`getBinaryCpmmBetInfo`), `calculate.ts`; markets with several answers: `calculate-cpmm-arbitrage.ts` (explained in `dev-docs/cpmm-multi-2.md`) | `api/src/place-bet.ts`, `api/src/place-multi-bet.ts`, `api/src/helpers/bets.ts` |
| Limit orders | `bet.ts` (`limitProb`, `isFilled`, `isCancelled`, `expiresAt`, line 63); matching against open orders: `computeFills`, `calculate-cpmm.ts:328` | placing: `api/src/place-bet.ts` (a bet with `limitProb`); cancelling: `api/src/cancel-bet.ts`; expiry: `shared/src/expire-limit-orders.ts`, run by the scheduler |
| Selling | `sell-bet.ts` (`getCpmmSellBetInfo`), `sell-preview.ts` | `api/src/sell-shares.ts`, `api/src/multi-sell.ts` |
| Yes and No cancelling out | `redeem.ts` (`getRedemptionBets`) | applied inside each bet (`place-bet.ts`) |
| Fees | `fees.ts`: `getTakerFee` = constant × p × (1 − p) × shares; `FLAT_TRADE_FEE` = 0 | — |
| Settlement | `payouts.ts` (`getPayouts`), `payouts-fixed.ts`, `calculate-fixed-payouts.ts` | `api/src/resolve-market.ts`, `shared/src/resolve-market-helpers.ts` (`resolveMarketHelper`), `api/src/unresolve.ts` |
| Liquidity | `liquidity-provision.ts`, `add-liquidity.ts` | `api/src/add-liquidity.ts` |
| Play-money accounting | `txn.ts` (every kind of transfer), `balance-change.ts`, `contract-metric.ts`, `calculate-metrics.ts` | `shared/src/txn/run-txn.ts` writes each transfer to the `txns` table and changes `users.balance` in the same transaction. Bets change balances directly, inside the bet's transaction (`place-bet.ts:458`) |
| Tables | — | `backend/supabase/contracts.sql`, `answers.sql`, `contract_bets.sql`, `txns.sql`, `users.sql`, `user_contract_metrics.sql`, `contract_liquidity.sql` |

**Can the tests run on their own? The maths tests can.** I copied `common/` to a separate folder and installed only Jest, ts-jest, TypeScript, lodash, zod, dayjs and `@tiptap/core` (needed for one type in `contract.ts`), with install scripts turned off. Then I ran:

- `calculate-cpmm`, `calculate-cpmm-arbitrage`, `sell-bet`, `sell-preview` and `answer`;
- the four `cpmm-multi-2-*` files, `conservation-grid` (a grid test that checks money is never created or lost), `liquidity-withdrawal` and `loans`;
- the seven perps files named in section 1, plus `sell-domain-probe`, which skipped itself.

Result: 19 test files passed, 539 tests passed, and one file (21 tests) skipped itself. It took 23 seconds. Our repository uses Vitest, not Jest. Jest-style tests move across with small changes, mainly `jest.fn` becoming `vi.fn`.

**The server-side tests don't run on their own.** They live in `backend/shared/src/` and `backend/api/src/` (for example `resolve-market-lifecycle.test.ts`, `place-multi-bet.test.ts`) and replace Manifold's database client and helpers with stand-ins. They need Manifold's whole workspace, and they test Manifold's server wiring, which we replace anyway (section 3).

## 3. Trades: the trading server on Google Cloud

**What it is.** There is no separate trading service. Trades go through Manifold's main API server, and all writes, trades included, go to one process:

- **One machine:** a Compute Engine virtual machine (`c2-standard-4`, `us-east4-a`), kept at exactly one copy (minimum and maximum one, `backend/api/update-scaling.sh`).
- **What runs on it:** one Docker container (`backend/api/Dockerfile`, `deploy-api.sh`) running four Node processes. One process handles every request that writes (`serve`, `instances: 1`), and three handle reads only (`serve-read`, `READ_ONLY`, `backend/api/ecosystem.config.js`).
- **The routing:** Google's load balancer sends the read addresses listed in `backend/api/url-map-config.yaml` to the read-only processes. Everything else, every trade included, goes to the single writer. `backend/api/knowledge.md:11` describes it.
- **The writer does more:** it also runs the live-update server (section 6).

**How it keeps trades in order: three layers.**

1. **A queue in memory** (`backend/shared/src/helpers/fn-queue.ts`). Each job lists what it touches: the trader, the market, and any limit orders its trade will fill. Jobs that share any of these run one after another, in arrival order; other jobs run side by side. A job that waits more than 10 seconds is refused with "High volume of requests" (error 503).
2. **How a bet uses it:** `place-bet.ts:80-130`. The bet is first simulated, in a second queue, to find whose limit orders it would fill. Then it waits in the trades queue behind everything touching the same trader, market or order owners. Selling (`sell-shares.ts:169`), cancelling (`cancel-bet.ts:26`, which jumps the queue), loans, transfers and market creation use the same queue.
3. **The database checks again.** Inside the queue, each trade is one database transaction at the strictest isolation level, retried if Postgres refuses it (`backend/shared/src/transact-with-retries.ts`). The transaction locks the market's row (`select … from contracts where id = $2 for update`, `lockContractAndGetBetData`, `backend/api/src/helpers/bets.ts:326`), reads the pool and open limit orders again, and checks the trader's balance again before writing.

The queue only works because there is exactly one writer process: it lives in that process's memory. Manifold's own perps don't rely on it. They use a per-market database lock (`pg_advisory_xact_lock`) and an order table.

**What it would take to run inside our API on Vercel with Supabase:**

- **Drop the memory queue; the database keeps the order.** Vercel runs many short-lived copies of our API at once, so a queue in one copy's memory orders nothing. Each trade becomes one database transaction that first takes the market's lock, then locks the trader's and the limit-order owners' balances, always in the same order so two trades can't wait on each other forever. Then it reads the pool and open orders, runs Manifold's maths, writes, and commits. Trades on one market then happen one at a time; trades on different markets run side by side.
- **This works with our connection settings.** `DATABASE_URL` uses Supabase's pooler in transaction mode, which keeps a whole transaction on one connection. Locks taken with `pg_advisory_xact_lock` or `FOR UPDATE` last until the commit. Locks that last a whole session don't work there and aren't needed.
- **Limits and retries:** lock waits and statements get time limits, so a busy market answers "try again" instead of hanging. A refused transaction is retried a few times, and every trade carries a request key so a retry never trades twice. Manifold's perps do this (`backend/supabase/migrations/2026072804_perp_trade_idempotency.sql`).
- **Work after the trade:** notifications, profit figures and streaks run after the reply, through Next.js `after()` or a background job, the way Manifold's `on-create-bet.ts` runs after its reply.
- **Prices on screen:** new prices reach browsers through Supabase Realtime instead of Manifold's live-update server.
- **Speed:** the API and the database are both in Mumbai (Vercel `bom1`, Supabase `ap-south-1`), so each trade's few database round trips stay short. Manifold runs its whole site through one writer process, and our early traffic will be far smaller.

## 4. The trading API that bots use

Every endpoint is declared once, with its inputs, in `common/src/api/schema.ts` (the `API` list, line 162). The handlers are listed in `backend/api/src/routes.ts`. Public endpoints get a `/v0/` prefix (`common/src/api/utils.ts:30`). There is no newer version. The guide for bot authors is `docs/docs/api.md`.

| Use | Call | Handler (`backend/api/src/`) |
|---|---|---|
| List or search markets | `GET /v0/markets`, `GET /v0/search-markets` | `markets.ts`, `search-contracts.ts` |
| One market, its probability | `GET /v0/market/:id`, `/v0/slug/:slug`, `/v0/market/:id/prob`, `/v0/market-probs` | `get-market.ts`, `get-market-prob.ts`, `get-market-probs.ts` |
| Trade or place a limit order | `POST /v0/bet` (`limitProb` makes it a limit order; `expiresAt` or `expiresMillisAfter` set its expiry; `dryRun` previews it) | `place-bet.ts` |
| Trade on several answers | `POST /v0/multi-bet`, `POST /v0/multi-sell` | `place-multi-bet.ts`, `multi-sell.ts` |
| Cancel a limit order | `POST /v0/bet/cancel/:betId` | `cancel-bet.ts` |
| Sell shares | `POST /v0/market/:contractId/sell` (no `shares` sells everything) | `sell-shares.ts` |
| Trades and open orders | `GET /v0/bets` (`kinds=open-limit` lists open orders; `excludeApi` hides API trades) | `get-bets.ts` |
| Positions | `GET /v0/market/:id/positions` | `get-positions.ts` |
| Own account and balance | `GET /v0/me` | `get-me.ts` |

There is also an AI agent connection at `/v0/mcp` (`backend/api/src/app.ts:174`).

**API keys.**

- **Getting one:** a user makes one on their profile page (`web/components/profile/settings.tsx:87`). The browser creates a random ID (`crypto.randomUUID()`, `web/lib/api/api-key.ts`) and saves it to the user's private record. Making a new key replaces the old one, so each account has one.
- **Storage: in plain text, not scrambled first,** in `private_users.data->>'apiKey'` (`common/src/user.ts:208`; index at `backend/supabase/private_users.sql:23`).
- **Sending it:** a bot sends `Authorization: Key <key>`. A signed-in browser sends `Authorization: Bearer <Firebase sign-in token>` instead (`parseCredentials`, `backend/api/src/helpers/endpoint.ts:41`).
- **Checking it:** the key is looked up directly in the database, and banned users are refused (`getUnbannedPrivateUserByKey`, `backend/shared/src/utils.ts:339`).

**Rate limits.**

- **What the guide says:** 500 requests a minute per IP address (`docs/docs/api.md:72`).
- **What the code does:** I found no code that enforces that limit. It may sit in Google Cloud settings that aren't in the repository.
- **The limits that are in the code** (`backend/api/src/helpers/rate-limit.ts`) are kept in each server process's memory and cover only a few endpoints: the AI agent connection at 60 a minute per IP (`app.ts:174`), the AI writing tools, and partial closes of perps at 60 an hour (`close-perp-position.ts:48`). **Ordinary trades have no rate limit.**

**How bots and API trades are marked.**

- **Bot accounts:** a `users.is_bot` column (`backend/supabase/migrations/2026040101_add_users_is_bot.sql`). A user can mark their own account as a bot, but can't undo it; moderators can switch it either way (`backend/api/src/set-bot-status.ts`). An older hard-coded list, `BOT_USERNAMES` (`common/src/envs/constants.ts:90`), is still used as a fallback.
- **What bots don't get:** places in leagues (`backend/shared/src/generate-leagues.ts:53`), counting towards a market's ranking (`importance-score.ts:356`), or the new-trader bonus (`backend/api/src/helpers/bets.ts:615`). Their names show a "Bot" badge.
- **API trades:** any trade made with an API key is marked `isApi` (`place-bet.ts:79`, `sell-shares.ts:188`). It's saved on the trade and copied into `contract_bets.is_api` (`backend/supabase/contract_bets.sql:10`).
- **What API trades don't get:** a place in feeds and site activity (`get-unified-feed.ts:374`, `get-site-activity.ts:117`), streaks, referral bonuses, or alerts to the market's creator (`on-create-bet.ts:179`). Market pages can hide them, and they show a robot icon.
- **Fees for API trades:** ordinary API trades pay no extra fee (`FLAT_TRADE_FEE = 0`, `common/src/fees.ts:18`). API comments cost M1. API opens on perps pay the higher API fee.

## 5. Markets that settle themselves (@ManifoldSports)

**Yes, the code is in the repository.** Creating, live scores, settling and the admin screens are all there; I found no private service. The overview is `dev-docs/sports-automation.md`.

**The account.** Every sports market is owned by @ManifoldSports, whatever admin starts the job. Its user ids are written into the code for each environment (`common/src/sports.ts:166`), and `sportsCreator()` loads it (`backend/shared/src/odds-markets.ts:104`).

**The data.**

- **The Odds API** (`THE_ODDS_API_KEY`) is the main source, for fixtures, bookmakers' odds and scores (`backend/shared/src/the-odds-api-client.ts`).
- **BALLDONTLIE** covers Formula 1 (`balldontlie-f1-client.ts`).
- **Older pipelines:** football-data.org runs an older football pipeline (`sports-markets.ts`). TheSportsDB is still in the code but nothing calls it (`resolve-sports-markets.ts` isn't imported anywhere).
- **Where the keys are named:** `common/src/secrets.ts:39`. Without a key, its jobs log once and skip.

**How often** (the scheduler's list, `backend/scheduler/src/jobs/index.ts:494-553`, Los Angeles time): new markets daily at 06:00; settling from scores every 10 seconds; Formula 1 creation daily and settling every 15 minutes; the older football pipeline daily, with live scores every 10 seconds.

**Creating** (`createOddsMarketsForCompetition`, `odds-markets.ts:123`):

- **What:** games in the next 14 days, for competitions switched on in the calendar (`common/src/sports-calendar.ts`, with switches in the `sports_competition_switches` table).
- **No duplicates:** each game gets one market, checked by the game's id under a lock.
- **The market:** home, away and, for football, a draw, opening at the bookmakers' odds with the bookmakers' margin taken out (`common/src/odds-markets.ts`).
- **Limits:** at most 25 new markets per competition per run, with a starting pool of 1,000 mana each.

**Settling** (`pollOddsScoresAndResolve`, `odds-markets.ts:564`):

- **Live scores:** it polls scores at speeds set on `/admin/sports` (`common/src/sports-score-polling.ts`) and writes them onto the market. Browsers get them through the live-update server (`publish-sports-live-score.ts`).
- **Settling:** on a final score, it settles with the ordinary `resolveMarketHelper` (`odds-markets.ts:994`).
- **Time limits:** a run stops after 3 minutes, and a market is no longer checked 3 days after it closes (`dev-docs/sports-odds-resolver-deadline.md`).
- **Left for an admin:** postponed games, level scores in sports that can't end level, and penalty shootouts. They wait in a "needs attention" list and are settled through `backend/api/src/admin-sports-resolve.ts`.
- **Cost tracking:** each call's cost in API credits is logged (`sports_odds_api_usage`).

**Tests:** `odds-markets.test.ts`, `odds-markets-review.test.ts`, `sports-odds-deadline.test.ts`, `the-odds-api-client.test.ts` and `f1-markets.test.ts` in `backend/shared/src/`, and about 16 `common/src/sports-*.test.ts` files.

**Cricket:** the sports schedule recognises cricket (`common/src/sports-schedule.ts:243`, `:372`), but no cricket competition is set up for creating markets. The competition calendar (`common/src/sports-calendar.ts`) has none, and a test makes sure the IPL is not among the extra feeds, which it describes as feeds with only odds or with settlement rules nobody has checked yet (`common/src/sports-feeds.test.ts:64-70`). Our cricket markets would be new work on top of the same flow.

## 6. What Manifold depends on that we'd replace

| Need | Manifold uses | Where | We use (already decided) |
|---|---|---|---|
| Sign-in | Firebase Auth (Google). The API checks Firebase tokens, then issues its own Supabase token for the browser | `web/lib/firebase/users.ts`; `backend/api/src/helpers/endpoint.ts:67`; `backend/api/src/get-supabase-token.ts` | Supabase Auth (PLAN.md, 3 November 2026) |
| Hosting the API | One Compute Engine virtual machine behind Google's load balancer, run by pm2 inside Docker | `backend/api/deploy-api.sh`, `Dockerfile`, `ecosystem.config.js`, `url-map-config.yaml` | Vercel functions in Mumbai |
| Hosting the website | Vercel (Next.js) | `README.md`, `web/README.md` | Vercel |
| Database | Supabase Postgres, reached directly through pg-promise on port 5432 | `backend/shared/src/supabase/init.ts` | Supabase Postgres through the pooler (`DATABASE_URL`) |
| Live updates | Its own WebSocket server on the writer process; Supabase Realtime isn't used | `backend/shared/src/websockets/server.ts`; `common/src/api/websocket-client.ts`; `client-common/src/hooks/use-api-subscription.ts` | Supabase Realtime (PLAN.md) |
| Scheduled jobs | A separate Express server with croner on its own virtual machines (main and perps), 66 jobs, some every 2 or 10 seconds | `backend/scheduler/src/index.ts`, `jobs/index.ts`, `deploy-scheduler.sh` | Not chosen yet (open question below). Vercel Cron can't run more often than once a minute |
| File storage | Firebase Storage | `storage.rules`, `private-storage.rules`, `web/lib/firebase/storage.ts` | Cloudflare R2 and Cloudflare's image resizing |
| Email | Mailgun | `backend/shared/src/send-email.ts` | Resend |
| Push notifications | Expo's push service | `backend/shared/src/create-push-notifications.ts` | Not decided; Expo's service suits our Expo app |
| Search | Postgres text search | `backend/shared/src/supabase/search-contracts.ts` | The same (PLAN.md) |
| Secrets, logs, metrics | Google Secret Manager, Cloud Logging, Cloud Monitoring | `common/src/secrets.ts:90`; `backend/shared/src/monitoring/` | Doppler; Vercel's and Supabase's logs |
| Cache | Redis (Google Memorystore), currently switched off | `backend/api/deploy-api.sh:56` | Upstash Redis |
| Payments | Stripe, Daimo, Apple in-app purchases (Manifold sells mana) | `backend/api/src/stripe-endpoints.ts` | Not taken: play money is never sold (recommended) |

## What we take, adapt or build

| Piece | Take as is, adapt, or build | Why |
|---|---|---|
| Yes/no market maths, limit-order matching, selling, Yes-and-No cancelling out, fees, settlement payouts (`common/src/calculate-cpmm.ts`, `new-bet.ts`, `sell-bet.ts`, `redeem.ts`, `fees.ts`, `payouts*.ts` and what they import) | **Take as is**, with their tests and the licence notice | Plain TypeScript with no database or server code; its tests pass on their own; Manifold has refined it for years. The only changes are mechanical: Vitest instead of Jest, our import paths, and dropping the `@tiptap` type |
| Markets with several answers (`calculate-cpmm-arbitrage.ts`) | **Take as is, kept switched off** | Not in our version one (one question per market), but it's tested and costs nothing to carry, and PLAN.md allows features built and switched off |
| Trade and settle steps (`place-bet.ts`, `sell-shares.ts`, `cancel-bet.ts`, `helpers/bets.ts`, `resolve-market-helpers.ts`) | **Adapt** | The order of steps is right: read under lock, recompute, check balance, write the trade and every balance in one transaction. But it is written for Firebase, pg-promise and Manifold's tables |
| Keeping trades in order (`fn-queue.ts`) | **Build ourselves** | It only works on one server. Ours is a per-market lock in each trade's transaction, with time limits, retries and a request key |
| Play-money accounting (`txns` ledger, `run-txn.ts`) | **Adapt** | The rule carries over: every movement of money is a ledger row, written in the same transaction as the balance change, so the books always add up. We write it in our own migrations, with row-level security |
| Tables | **Build ourselves**, from the agreement's market shape | Manifold's tables keep much of their data in JSON columns left over from Firebase's database. Its maths tests don't touch the database, so our tables needn't copy Manifold's to keep them passing |
| Expiring limit orders (`expire-limit-orders.ts`) | **Adapt** | A small job; once a minute is enough |
| Trading API for bots | **Adapt** | Similar calls and names help bot authors who already know Manifold's API. Two changes: store only a scrambled copy of each key (a hash), shown once when made, and enforce rate limits in Upstash, trades included |
| Marking bots and API trades (`users.is_bot`, `is_api` on trades) | **Adapt (the idea)** | Two columns and a few filters: simple and proven. We keep bots out of leaderboards, rankings and bonuses the same way |
| Self-settling sports markets | **Adapt** | The flow fits step 3.2: create markets daily from fixtures, one per game, poll the score, settle on the final score, and leave odd cases for an admin with time limits. The data sources come from step 1.2, cricket first, and our job runner isn't chosen yet |
| Bitcoin price from several exchanges (`btc-price.ts`) | **Adapt (the idea)** | Taking the median of exchanges that agree protects settlement from one bad source. The exchanges' terms are checked in step 1.2 |
| Perps (step 3.4, added by the founder on 8 November 2026) | **Take the maths as is; adapt the engine** | The maths in `common/src/perps/` is plain TypeScript and its tests pass on their own. Manifold's engine (`backend/shared/src/perps/engine.ts`) is tied to its own server and tables, so ours is built on our trade transactions, with a new price and a liquidation check every few seconds through Supabase Cron |
| Sign-in, hosting, live updates, scheduled jobs, storage, email | **Build ourselves** (already decided) | Supabase Auth, Vercel, Supabase Realtime, R2 and Resend. The job runner is the one still open |

## Open questions this raises

- **The job runner** (already open; the Sourcing project chooses it). Manifold settles sports from scores every 10 seconds, and Vercel Cron can't run more often than once a minute. Perps now need a job every few seconds, and PLAN.md runs it on Supabase Cron, which can run a job every 1 to 59 seconds (step 3.4). Recommendation: each run calls our own code, which fetches the price and checks liquidations, because the maths is TypeScript. Supabase Cron's run history isn't cleared automatically, so a small daily job clears it. Settling the other markets a minute or so after the result is fine for play money.
- **Bitcoin markets in time windows** (step 3.2). Manifold reads Bitcoin's price every 2 seconds, because its perps trade on the live price. Recommendation: our markets only need the price at each window's closing moment, so the data job reads that one price (the median of agreeing exchanges) when the window closes, with no constant polling.
