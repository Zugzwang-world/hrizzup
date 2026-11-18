# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 18 November 2026 by Round 6's relay R16, Scheduled jobs and records, in its M3 ([#166](https://github.com/Zugzwang-world/hrizzup/pull/166)), keeping R3's and R4's updates. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets: our AI finds news as it breaks on X and turns it into developing stories. **Product builds** the website and the app (the website a stage ahead), the markets, the public API for bots and AI tools, and now social, where AI agents post their takes on every story; it shows Sourcing's stories through the content store's tables, in the hand-over agreement's shapes (`agreement/README.md`, first half Agreed).

## Where things stand

- **Social's ground is laid** (Round 6, Phase 1): the technical design (`docs/social/build.md`), every table the beta needs on staging, posting keys beside the trading keys, and every social call's shape in the API, marked beta; only the console's three saves (test stories and invites) are live. Nothing of social is visible to readers yet: **R5 and R6 build the first pages and calls next, side by side**, then the founder's Review 1.
- **Round 6 is open** (milestone "Round 6"): social; R4's leftovers and faster checks are done; relays run as a role team (CLAUDE.md).
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API (`/api/v1`, its docs and MCP server) with read-only or trading keys and the example bot; the app's sign-in test (1.6b: two of the founder's tries open); the market engine, ledger and console with play money; the content store; the Bitcoin perp; the markets sandbox; social's ground.

## Round 6 progress

- **R1, social's records:** done, [#143](https://github.com/Zugzwang-world/hrizzup/pull/143). **R2, the role team and social's build plan:** done, [#144](https://github.com/Zugzwang-world/hrizzup/pull/144).
- **R3 Ground:** done, in six pull requests: the technical design, [#151](https://github.com/Zugzwang-world/hrizzup/pull/151); social's database (schema `social`, posting keys in `keys.agent_keys`, the checked save `intake`, 1,173 database tests), [#153](https://github.com/Zugzwang-world/hrizzup/pull/153); the beta mark and its breaking-change rule, [#155](https://github.com/Zugzwang-world/hrizzup/pull/155); the shared code (`@hrizzup/social`, `@hrizzup/content`, `uuidv7`), [#157](https://github.com/Zugzwang-world/hrizzup/pull/157); all 74 social calls in the contract, beta and not yet live (but for the console's three saves), [#160](https://github.com/Zugzwang-world/hrizzup/pull/160); the console's three live calls, the website's skeletons, the jobs secret's name and staging's firewall rules, [#161](https://github.com/Zugzwang-world/hrizzup/pull/161).
- **R4 Leftovers and faster checks:** done. `GET /me/orders` shows closed markets ([#145](https://github.com/Zugzwang-world/hrizzup/pull/145), [#147](https://github.com/Zugzwang-world/hrizzup/pull/147)); the market page's first-run Speed warning fixed ([#149](https://github.com/Zugzwang-world/hrizzup/pull/149)); the stand-in seed retired ([#146](https://github.com/Zugzwang-world/hrizzup/pull/146), [#148](https://github.com/Zugzwang-world/hrizzup/pull/148)); the faster-checks research ([#150](https://github.com/Zugzwang-world/hrizzup/pull/150)); Next 16.4.6 ([#152](https://github.com/Zugzwang-world/hrizzup/pull/152)); the two flaky database tests ([#154](https://github.com/Zugzwang-world/hrizzup/pull/154)); your six cuts ([#156](https://github.com/Zugzwang-world/hrizzup/pull/156), [#158](https://github.com/Zugzwang-world/hrizzup/pull/158), [#159](https://github.com/Zugzwang-world/hrizzup/pull/159), [#162](https://github.com/Zugzwang-world/hrizzup/pull/162), [#164](https://github.com/Zugzwang-world/hrizzup/pull/164), [#165](https://github.com/Zugzwang-world/hrizzup/pull/165)). For the founder: nothing to decide.
- **R5 Board, stories and the console:** in progress. M0: social's published calls and MCP tools follow each call's live mark, so R5's and R6's first live calls pass, [#167](https://github.com/Zugzwang-world/hrizzup/pull/167). Next: the board's six reads (M1), the minute job (M2), the console's calls and pages, the sandbox's board and story pages. For the founder: nothing yet.
- **R6 Join and first post:** ready to start, side by side with R5: each fills only its own files (build.md, section 8.2), and neither needs a migration. Then Review 1, the founder's.
- **R16 Scheduled jobs and records** (a side relay in Phase 1, beside R5, R6 and R10): in progress. M3, your three decisions recorded ([#166](https://github.com/Zugzwang-world/hrizzup/pull/166)); M2, every time the API prints has three decimals ([#169](https://github.com/Zugzwang-world/hrizzup/pull/169)); next M1 (scheduled jobs re-saved and checked after every database change; the cause found). For the founder: one step (below).
- **R7 to R15:** not started (Phases 2 to 4, the reviews, the closing record).
- **Carried, unnumbered:** the market page (3.1), then the perp's page (3.4c), and the board (2.1), each when the design chat approves its design; live updates for bots (3.5e), later.

## Decisions in force

- **Social's V1 beta** (the founder, 16 to 18 November 2026; `docs/social/spec.md`, with his answers in section 17): invited owners' agents post takes on every story's desk and reply; humans read with no account; files, owner chats and briefs live on Hrizzup; a reader agent on Workers AI's free allowance; Top a setting; social's calls beta until R14; everything on staging is sandbox data; built in four phases, each ending with the founder's review; at most three relays on the website or the database at once.
- **Social's technical design** (R3, `docs/social/build.md`; the spec and PLAN.md win): a posting key never trades and a trading key never posts, refused by the database itself; one checked save for stories, test stories on staging only; lists paged by key; one job a minute recounts and refreshes the edge; a call joins the OpenAPI file, docs and MCP only when live, marked beta; one file per relay's area.
- **Faster checks** (the founder, 18 November 2026): all six cuts approved (R4's M7); a test machine's Speed warning is recorded, not fixed, unless the page holds it or it repeats. A database-only risky change skips the preview checks, which can't see it (PLAN.md section 3).
- **The advisor's moments** (the founder, 18 November 2026; CLAUDE.md's playbook has the full list): the expert before handing back any design; the coordinator before a risky pull request and its final report, among others; any role on a repeated failure; "Advisor: …" in the pull request.
- **Social's six small questions, all yes** (the founder, 18 November 2026; spec, section 17): tasks private; Latest by newest update; upvotes on posts only; a still image for video and audio; the owner's typed name; Sourcing saves through `intake`, for Sourcing to confirm.
- **Standing:** one versioned public API, staging the bots' demo until launch; free tiers only, checks and budgets never looser; one watcher on checks, no questions to the founder, records in each milestone's pull request; design only from the founder's references; database changes first, adding only; public until launch (P.17).

## What changed in the latest session

**R16 recorded your three decisions of 18 November** ([#166](https://github.com/Zugzwang-world/hrizzup/pull/166)): the database-only skip, the advisor's moments, and your yes to social's six questions; the role files changed (For the founder). **Then every time the API prints got exactly three decimals** ([#169](https://github.com/Zugzwang-world/hrizzup/pull/169)): one printer in the API's output layer, finding times only by each call's declared shape, so free text never changes; HTTP and MCP alike; the database, the contract and every call's shape unchanged. Social's beta calls print as before until they're locked into v1 (open question).

## Open questions

One line each; the detail, and the rest, are in the status file.

- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, drafted together with briefs' key-numbers field if Sourcing's pipeline design is ready by then, so the first half changes once.
- **Social's times, three decimals too** (R16, M2): social's beta calls still print the database's form, since two relays are building them now. Recommendation: R14 adds them to the printer when it locks social into v1 (and says so in the MCP instructions); no database change.
- **A package's tests don't re-run when a package it uses changes** (R16's review): Turbo replays them from cache. Recommendation: `dependsOn: ["transit"]` on `test`, as `bundle-size` does.
- **Supabase Cron can miss a migration's new schedules** (R3): social's new jobs didn't run on staging until re-saved; cause unknown; R3's setup script heals and detects it for social. Recommendation: as R16's M1 is doing, re-save every job after migrations and check the every-minute ones run.
- **Also in the status file:** editing a request's existing forms within v1; pg_net's grants; node-forge in the Expo tool only; Vercel Pro's function billing; Vercel's toolbar; sign-ups waiting for the house; the Hermes rewrite; shared code.

## For the founder

- **Update `~/hrizzup` before Phase 2's sessions start** (R16 changed the role files, which new sessions read from it): in Terminal, `cd ~/hrizzup && git pull`, once R16's M3 has merged. Nothing else.
- **For information:** a red "Screen check" on a commit a newer push replaced is expected; only the newest commit merges.
- **Create the public repository `hrizzup-skills` on GitHub before Phase 2** (R10 fills it). Recommendation: under your account, public, empty (no README), MIT licence, so R10's first pull request sets it up.
- **The Workers AI token before Phase 3** (R12). Recommendation: a Cloudflare API token limited to Workers AI, into Doppler `stg` once Claude Code has listed its name; it gives you the clicks when R12 nears. The free 10,000 neurons a day are per Cloudflare account, so at launch production's reader agent should use an account of its own.
- **Review 1, after R5 and R6:** look at the sandbox on staging (the board, a story's desk, an agent's first post) and tell this chat what to change; that shapes Phase 2.
- **Optionally, News Desk after Review 1,** so Hrizzup's own agents post beside invited owners.
- **Before launch:** a report button (P.22); the exchanges' terms (your legal team; P.19); the API's limits for each address (P.20).
- **The first topics (1.2):** approve or change them when this chat drafts them. **Your two phone tries for 1.6b** in the app's Sign-in test. **Designs:** your references in the design chat. **Spending parked.**

## What's next

R5 and R6 side by side, with R16 beside them (M1 and M2), then Review 1 (R4 is done; the Speed check and App journeys move to more machines when their tallies reach five clean comparisons, TRACKER's queue rows). Then Phases 2 to 4, each from your review; R15 closes the round. Carried: the screens (3.1, 3.4c, 2.1) once designed; the topics (1.2); market/2 before 3.3; the stream (3.5e) later.

## Read for detail

- `docs/social/spec.md`: social's full design and the founder's answers; `docs/social/build.md`: the technical design (tables, calls, caching, jobs, who builds what, the tests); `product/packages/api/src/social/`: every call's shape and example data.
- `PLAN.md` (section 2, "Social"; step 2.8 and "Social's build plan"), `TRACKER.md` (Round 6's queue), `CLAUDE.md` ("How relays run: the role team").
- `docs/research/faster-checks.md`; `docs/setup/BLUEPRINT.md`; `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/status/product.md` (Product's status in full).
