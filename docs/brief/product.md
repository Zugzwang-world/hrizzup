# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 17 November 2026 by Round 6's relay R2, the role team and social's build plan ([#144](https://github.com/Zugzwang-world/hrizzup/pull/144)). PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories. **Product builds** the website and the app (the website a stage ahead), the markets, the public API for bots and AI tools, and now social, where AI agents post their takes on every story; it shows Sourcing's stories through the content store's tables, in the hand-over agreement's shapes (`agreement/README.md`, first half Agreed).

## Where things stand

- **Social is designed and planned** (the founder, 16 and 17 November 2026): the design is `docs/social/spec.md`; **its build plan** is PLAN.md step 2.8, "Social's build plan", and TRACKER.md's Round 6 queue: four phases, each ending with the founder's own review of the sandbox on staging. None of it is built yet; **Phase 1 starts next** (R3 and R4, side by side).
- **Relays now run as a role team** (the founder, 17 November 2026): each relay is a coordinator session with four roles in `.claude/agents/` (scout, expert, builder, reviewer), each with its own model and effort, and Fable 5.2 as the advisor (CLAUDE.md, "How relays run: the role team").
- **Round 6 is open** (milestone "Round 6"): social, plus Round 5's carried items, now R4's. The market page (3.1), the perp's page (3.4c) and the board (2.1) still wait for the design chat's designs.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API at `/api/v1` with its OpenAPI file, docs (`/docs`, `/llms.txt`) and MCP server (`/api/v1/mcp`); API keys, read-only or trading; the example bot (`examples/bot`); the app's sign-in test (1.6b: two of the founder's tries open); the market engine, ledger and console; play money on signup; the content store; the Bitcoin perp on our own price; the markets sandbox.

## Round 6 progress

- **R1, social's records:** done, [#143](https://github.com/Zugzwang-world/hrizzup/pull/143).
- **R2, the role team and social's build plan:** done, [#144](https://github.com/Zugzwang-world/hrizzup/pull/144): the four roles, the advisor and fork mode off, a quick check of the role files, the coordinator's playbook in CLAUDE.md; the build plan and the founder's eight answers recorded. Next: Phase 1. For the founder: nothing for R2.
- **R3 Ground and R4 Leftovers and faster checks:** not started; next, side by side.
- **R5 Board, stories and the console and R6 Join and first post:** not started; side by side after R3. Then Review 1, the founder's.
- **R7 to R15:** not started (Phases 2 to 4, the reviews, the closing record).
- **Carried, unnumbered:** the market page (3.1), then the perp's page (3.4c), and the board (2.1), each when the design chat approves its design; live updates for bots (3.5e), later.

## Decisions in force

- **Social's V1 beta** (the founder, 16 and 17 November 2026; `docs/social/spec.md`):
  - every story gets a **desk** where invited owners' AI agents post takes (text, image, video up to a minute, audio up to five) and reply; humans read; only agents upvote; agents join with one line, are claimed by signing in, and post with keys through MCP or the REST API;
  - an agent's **files live on Hrizzup** (three layers, the owner's chat, every version kept); it **pins** a story to get its cached **brief**;
  - **Top** is a setting; the board filters by category, place, and Top or Latest; readers need **no account**; a signed-in reader's **reader agent** (Workers AI's free allowance) edits a reading profile that plain code turns into For You;
  - a **marketplace** of skills and six starter agents; edge-cached; invite-only, with a report button before launch (P.22); **the agreement doesn't change, and markets stay separate.**
- **The founder's eight answers** (17 November 2026; spec, section 17): (1) categories and places are the agreement's launch list for the beta, the filters lists that can be filled in, reading profiles naming any place or topic as words, revisited with the first topics (1.2); (2) a reader sees the board first, Top across every category, from the edge; signed in, For You once their profile holds something; (3) R4 times every check and proposes cuts keeping every test and budget, for the founder's approval here; (4) his own story hooks and X embeds parked; X posts only as source links; (5) social's calls marked beta until R14 locks them into v1; existing v1 calls stay protected; (6) replies are text; media only in posts; (7) briefs without key numbers in the beta, the field joining the agreement, optional, with Sourcing's pipeline; (8) everything social writes on staging is sandbox data.
- **How the build runs:** four phases, each ending with the founder's review; his changes shape the next phase's relays, which this chat writes when each phase starts; **at most three relays run the website or the database at once.**
- **The role team** (17 November 2026): the coordinator owns decisions, merges and records; per milestone, scout, expert (hard parts only), builder, reviewer, fixes; one writer at a time; roles by name, never forks.
- **The public API** (10 November): one versioned API for the website, the app and bots; public market data keyless and edge-cached; staging the bots' demo until launch.
- **Product first, nothing paid** (10 November): free tiers only; checks, budgets and rules never looser.
- **How sessions work:** one watcher on checks; no questions to the founder; his tries are the record; records inside each milestone's pull request.
- **Two surfaces, one account,** the website a stage ahead; English; India first. **Design** only from the founder's references. **Database changes land first,** adding only. **Markets:** made only by Hrizzup, double-entry play money in exact decimals. **Content:** the agreement's shapes, no xAI or X API. **Budgets never move.** **Public until launch** (P.17).

## What changed in the latest session

**R2 set up the role team and recorded social's build plan** ([#144](https://github.com/Zugzwang-world/hrizzup/pull/144); no product code, database, workflow, key or Doppler change):

- **The role team:** the four roles in `.claude/agents/`, each pinned by full model ID with its effort; in `.claude/settings.json`, the advisor (Fable 5.2 by full ID, which the desktop app's Claude Code, 2.1.325, recognises) and fork mode off, background tasks on, plugins unchanged; `.claude/worktrees/` ignored; a quick check of the role files (`.github/scripts/test_role_team.py`) with tests proving it fails on broken ones; the coordinator's playbook in CLAUDE.md, whose round references are now current ("Round <n>").
- **Social's build plan** in PLAN.md step 2.8 and TRACKER.md (R2 to R15, Round 5's three carried rows folded into R4), and **the eight answers** in the spec (sections 7, 8, 9, 11, 16, 17), PLAN.md (sections 2 and 7) and the status file.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, drafted together with briefs' key-numbers field if Sourcing's pipeline design is ready by then, so the first half changes once.
- **Faster checks** (R4 proposes, the founder approves). Recommendation: approve only cuts that skip work a change can't affect, cache more, or split the slowest tests, keeping every test and budget.
- **Also in the status file:** editing a request's existing forms within v1; the pipeline's write access; pg_net's grants; node-forge in the Expo tool only; Vercel Pro's function billing; Vercel's toolbar; sign-ups waiting for the house; the Hermes rewrite; shared code.

## For the founder

- **Create the public repository `hrizzup-skills` on GitHub before Phase 2** (R10 fills it). Recommendation: under your account, public, empty (no README), so R10's first pull request sets it up.
- **The Workers AI token before Phase 3** (R12, readers). Recommendation: a Cloudflare API token limited to Workers AI on the free allowance, added to Doppler `stg` once its name is listed in `infra/doppler/app-keys.txt`; Claude Code lists the name first and gives you the clicks when R12 nears.
- **Review 1, after R5 and R6:** look at the sandbox on staging (the board, a story's desk, an agent's first post) and tell this chat what to change; that shapes Phase 2.
- **Optionally, set up News Desk after Review 1,** so Hrizzup's own agents post when invited owners arrive.
- **Before launch:** a report button (P.22); the exchanges' terms (your legal team; P.19); the API's limits for each address (P.20).
- **The first topics (1.2):** approve or change them when this chat drafts them.
- **Your two phone tries for 1.6b** in the app's **Sign-in test**; tell this chat. **Designs:** your references in the design chat. **When you choose:** developer accounts (0.4), 12 testers. **Spending parked.**

## What's next

Phase 1 of social's build (step 2.8): R3 and R4 side by side, then R5 and R6 side by side, then Review 1. Then Phases 2 to 4, each from your review, and R15 closes the round. Carried: the screens (3.1, 3.4c, 2.1) once their designs are approved; Manifold's fuzz test split by the next relay that touches the engine; the topics (1.2) here. Before 3.3: market/2. Later: the stream (3.5e); production's API at launch (5.2), with P.21.

## Read for detail

- `docs/social/spec.md`: social's full design, the build (section 16) and the founder's answers (section 17).
- `PLAN.md` (section 2, "Social"; section 3; section 5, step 2.8 and "Social's build plan"), `TRACKER.md` (Round 6's queue), `CLAUDE.md` ("How relays run: the role team"); `.claude/agents/` (the four roles).
- `docs/research/public-api.md`; `docs/setup/BLUEPRINT.md` (database 5, checks 11, typed API 13, budgets 14); `docs/setup/RUNBOOK.md` (pre-launch checklist, P.17 to P.22).
- `product/packages/api/`, `product/web/app/api/v1/`, `product/web/lib/mcp/server.ts` (the API and the MCP server social's calls extend), `examples/bot/`; `docs/status/product.md` (Product's status in full).
