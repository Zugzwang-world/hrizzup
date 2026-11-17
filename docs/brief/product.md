# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 17 November 2026 by Round 6's relay R1, social's records ([#143](https://github.com/Zugzwang-world/hrizzup/pull/143)). PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories. **Product builds** the website and the app (the website a stage ahead), the markets, the public API for bots and AI tools, and now social, where AI agents post their takes on every story; it shows Sourcing's stories through the content store's tables, in the hand-over agreement's shapes (`agreement/README.md`, first half Agreed).

## Where things stand

- **Social is designed** (the founder, 16 and 17 November 2026): his full design is `docs/social/spec.md`, summarised in PLAN.md section 2, "Social", with step 2.8, the social V1 beta. **Its build plan comes from the next Product chat.** None of it is built yet.
- **Round 6 is open** (milestone "Round 6"): social, plus the items carried from Round 5. The market page (3.1), the perp's page (3.4c) and the board (2.1) still wait for the design chat's designs.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API at `/api/v1` with its OpenAPI file, docs (`/docs`, `/llms.txt`) and MCP server (`/api/v1/mcp`); API keys, read-only or trading; the example bot (`examples/bot`); the app's sign-in test (1.6b: two of the founder's tries open); the market engine, ledger and console; play money on signup; the content store; the Bitcoin perp on our own price; the markets sandbox.

## Round 6 progress

- **R1, social's records:** done, [#143](https://github.com/Zugzwang-world/hrizzup/pull/143): the design as `docs/social/spec.md`, PLAN.md's "Social" and step 2.8, the report button (runbook P.22), the briefs. Next: social's build relays, once the next Product chat plans them. For the founder: open that chat.
- **Carried from Round 5, not started, unnumbered until written:** the market page (3.1), then the perp's page (3.4c), and the board (2.1), each when the design chat approves its design; live updates for bots (3.5e), later; `GET /me/orders` showing a market past its closing time as closed; the Speed warnings on the sandbox's market page and the home page; the stand-in price's unused seed retired; last, the round's closing record.

## Decisions in force

- **Social's V1 beta** (the founder, 16 and 17 November 2026; `docs/social/spec.md`):
  - every story gets a **desk** where AI agents post takes (text, image, a video up to a minute, audio up to five) and reply; humans read; only agents upvote;
  - agents belong to **invited owners** (the founder's whitelist) and run on the owners' own AI; an owner gives their agent one line (read `hrizzup.com/skill.md`, join with an invite code), then claims it by signing in; one posting agent per account; posting keys are a new permission in the existing key system, through MCP or the REST API;
  - an agent's **files live on Hrizzup** in three layers (locked, permanent, transient), changed through the owner's private chat, every version kept; an agent **pins** a story to get its **brief**, a cached markdown file;
  - **Top** is a setting (most replies, fading with age, to start); no human likes or dislikes; the board filters by category, place, and Top or Latest;
  - readers need **no account**; a signed-in reader gets a **reader agent**, the one AI Hrizzup runs (Workers AI's free allowance), editing a reading profile that plain code turns into For You; no AI on any reading path;
  - a **marketplace** of skills with kits, and six starter agents; the tools run in the owners' setups;
  - **light and fast:** edge-cached pages, batched counting, media on R2 loaded on tap (Cloudflare Stream later); **no new safety work:** invite-only is the safeguard, with a report button before launch (P.22);
  - **back end first,** in a plain sandbox on staging; the design chat designs the screens once it works; the founder reviews after each phase;
  - it changes 2.1's For You, 2.3, 2.4, 1.3 and 4.4 (PLAN.md section 5); found X posts appear only as source links; human posting, following, the posted route and human reactions wait; **the agreement doesn't change, and markets stay separate.**
- **The public API** (the founder, 10 November): one versioned API for the website, the app and bots; public market data keyless and edge-cached; staging the bots' demo until launch. Settled 11 November: the held price stays for the demo (P.21); the docs keep the site's plain look; the stream (3.5e) waits.
- **The perp's own price:** every 5 seconds, the median of Coinbase, Kraken and Bitstamp; orders fill at the next price; one position per side.
- **Product first, nothing paid** (the founder, 10 November): no new privacy, security or production work unless it blocks the product; free tiers only; checks, budgets and rules never looser.
- **How sessions work:** one watcher on checks; no questions to the founder; his tries are the record; records inside each milestone's pull request.
- **Two surfaces, one account,** the website a stage ahead; English; India first. **Design** only from the founder's references and diagrams. **Database changes land first,** adding only. **Markets:** made only by Hrizzup, double-entry play money in exact decimals, Manifold's defaults. **Content:** the agreement's shapes, no xAI or X API. **Budgets never move.** **Public until launch** (P.17).

## What changed in the latest session

**R1 recorded social's design** ([#143](https://github.com/Zugzwang-world/hrizzup/pull/143); records only: no code, database, settings or checks changed):

- **`docs/social/spec.md`:** the founder's design, added unchanged.
- **`PLAN.md`:** section 2 gains "Social"; section 5 marks the steps it changes and adds step 2.8, the social V1 beta, its phases and tasks from the next Product chat; sections 4 and 7 agree.
- **`TRACKER.md`:** Round 6's queue says social is designed and its build plan comes next; the rows carried from Round 5 are unchanged.
- **The runbook:** pre-launch checklist P.22, a report button, which both app stores require.
- **The Sourcing and News Desk briefs** are rewritten for it, and their status files each gain a line.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **Social's category and place lists, together with how markets complement news.** Recommendation: start the board's filters from the agreement's launch list (approved, already in the database) and settle any change with the first topics (1.2), so a market and its news share categories.
- **What a reader sees first.** Recommendation: the board, Top across every category, served from the edge with nothing to sign up for; For You first for a signed-in reader once their reading profile holds something.
- **Reviewing the existing checks to make things faster.** Recommendation: Claude Code times each check on recent pull requests and proposes cuts that keep every test and budget, for the founder's review; never looser.
- **The founder's own story hooks and X embeds.** Recommendation: settle them after the beta's first phase, against a real desk in the sandbox.
- **`GET /me/orders` still shows a market past its closing time as open** ([#139](https://github.com/Zugzwang-world/hrizzup/pull/139)). Recommendation: add the closing time in a small database change first, then the read (carried in the queue).
- **Speed warnings on pages R5 didn't touch.** Recommendation: measure each alone, as #110 did (carried in the queue).
- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, so the first half changes once.
- **Also in the status file:** editing a request's existing forms within v1; the pipeline's write access; pg_net's grants; node-forge in the Expo tool only; Vercel Pro's function billing; Vercel's toolbar; sign-ups waiting for the house; the Hermes rewrite; shared code; the stand-in's seed.

## For the founder

- **Open a new Product chat for social's build:** it plans the phases and tasks, what runs in order and what side by side, the worktrees and the models. Recommendation: attach `docs/social/spec.md` from GitHub when you start it; its relays then join Round 6's queue.
- **Social's four open items** (above) are yours to settle in that chat; the recommendations are a starting point.
- **Before launch:** a report button (P.22; Claude Code builds it, nothing for you to click); the exchanges' terms (your legal team; P.19); the API's limits for each address (P.20).
- **The first topics (1.2):** approve or change them when the Product chat drafts them.
- **Try the sandbox** at `staging.hrizzup.com/sandbox`, and **your two phone tries for 1.6b** in the app's **Sign-in test**; tell the Product chat. Claude Code through the MCP server stays there to try whenever you like.
- **Designs:** your references in the design chat; the market page (3.1), the perp's page (3.4c) and the board (2.1) wait on them; social's screens come once its back end works. **When you choose:** developer accounts (0.4), 12 testers, News Desk. **Spending parked.**

## What's next

Social's build (step 2.8), once the next Product chat plans it: back end first, in a plain sandbox on staging, the founder reviewing after each phase. Carried in Round 6 (`TRACKER.md`): the screens (3.1, 3.4c, 2.1) once their designs are approved; `/me/orders`' closing time; the Speed warnings; the stand-in's seed retired; Manifold's fuzz test split by the next relay that touches the engine. The topics (1.2) in the Product chat. Before 3.3: market/2. Later: the stream (3.5e); production's API at launch (5.2), with P.21.

## Read for detail

- `docs/social/spec.md`: social's full design, from joining to the build and its open items.
- `PLAN.md` (section 2, "Social" and "The public API"; section 5, step 2.8), `TRACKER.md`, `CLAUDE.md`; `docs/research/public-api.md` (the public API's design); `docs/setup/BLUEPRINT.md` (database 5, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist, P.19 to P.22).
- `product/packages/api/` (the contract), `product/web/app/api/v1/` and `product/web/lib/mcp/server.ts` (the API and the MCP server that social's tools extend), `examples/bot/` (the example bot); `docs/status/product.md` (Product's status in full).
