# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 18 November 2026 by Round 6's relay R5, Board, stories and the console, at its end ([#181](https://github.com/Zugzwang-world/hrizzup/pull/181)), keeping R6's and R16's updates. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. **Product builds** the website, the app, the markets, the public API for bots and AI tools, and social, where AI agents post takes on every story; it shows Sourcing's stories in the hand-over agreement's shapes (`agreement/README.md`, first half Agreed).

## Where things stand

- **Social, Phase 1** (Round 6): on staging, the console makes invites with a ready message to copy, and test stories with their updates; anyone can read the board (category, place, Top or Latest) and each story's timeline, desk and brief, through the API, MCP and the sandbox's plain pages, refreshed every minute; agents join with an invite, are claimed, check in, pin stories and post (R6). **Next: your Review 1.**
- **Staging** (`staging.hrizzup.com`, Mumbai) is public, asking search engines to stay out; previews need Vercel's login and share staging's database; production is a quiet twin.
- **Built:** the typed API (`/api/v1`, docs, MCP) with read, trading and posting keys; the app's sign-in test (1.6b: two of your tries open); the markets with play money, the Bitcoin perp and their sandbox; the content store; social's Phase 1.

## Round 6 progress

- **R1 and R2:** done: social's records, [#143](https://github.com/Zugzwang-world/hrizzup/pull/143); the role team and social's build plan, [#144](https://github.com/Zugzwang-world/hrizzup/pull/144).
- **R3 Ground:** done: the technical design, social's database, the beta mark, the shared code, every call in the contract and the console's three saves ([#151](https://github.com/Zugzwang-world/hrizzup/pull/151), [#153](https://github.com/Zugzwang-world/hrizzup/pull/153), [#155](https://github.com/Zugzwang-world/hrizzup/pull/155), [#157](https://github.com/Zugzwang-world/hrizzup/pull/157), [#160](https://github.com/Zugzwang-world/hrizzup/pull/160), [#161](https://github.com/Zugzwang-world/hrizzup/pull/161)).
- **R4 Leftovers and faster checks:** done: closed markets in `/me/orders`, the Speed warnings, the stand-in seed retired, Next 16.4.6, two flaky tests and your six cuts ([#145](https://github.com/Zugzwang-world/hrizzup/pull/145) to [#165](https://github.com/Zugzwang-world/hrizzup/pull/165)).
- **R5 Board, stories and the console:** done, in ten pull requests ([#167](https://github.com/Zugzwang-world/hrizzup/pull/167) to [#188](https://github.com/Zugzwang-world/hrizzup/pull/188)): the board's reads and pages, the minute job, the console's calls and pages, social's times with three decimals; its done-test passed on staging. For the founder: Review 1's clicks (below).
- **R6 Join and first post:** done, no migration: posting keys in the API and MCP, [#168](https://github.com/Zugzwang-world/hrizzup/pull/168); the join, [#173](https://github.com/Zugzwang-world/hrizzup/pull/173); the check-in, pins, posts and profiles, [#180](https://github.com/Zugzwang-world/hrizzup/pull/180); the example agent and the proof on staging, [#182](https://github.com/Zugzwang-world/hrizzup/pull/182); two test-only changes, [#171](https://github.com/Zugzwang-world/hrizzup/pull/171), [#179](https://github.com/Zugzwang-world/hrizzup/pull/179); the fixture agent's clearer error, [#184](https://github.com/Zugzwang-world/hrizzup/pull/184). For the founder: Review 1's agent half, below.
- **R16 Scheduled jobs and records** (a side relay in Phase 1, beside R5, R6 and R10): done. M3, your three decisions recorded ([#166](https://github.com/Zugzwang-world/hrizzup/pull/166)); M2, every time the API prints has three decimals, social's beta calls aside ([#169](https://github.com/Zugzwang-world/hrizzup/pull/169), [#177](https://github.com/Zugzwang-world/hrizzup/pull/177)); M1, the scheduled jobs reloaded and checked after every database change ([#175](https://github.com/Zugzwang-world/hrizzup/pull/175)); and, as you added, M4: a package's tests re-run whenever a package it uses changes ([#186](https://github.com/Zugzwang-world/hrizzup/pull/186)); M6: the keys page's sign-in button gets its real style ([#187](https://github.com/Zugzwang-world/hrizzup/pull/187)). For the founder: one step (below).
- **R7 to R15:** not started (Phases 2 to 4, the reviews, the closing record).

## Decisions in force

- **Social's V1 beta** (the founder, 16 to 18 November 2026; `docs/social/spec.md`, section 17 his answers, the six small questions all yes): invited owners' agents post takes on every story's desk; humans read with no account; a reader agent on Workers AI's free allowance; Top a setting, Latest by newest update; calls beta until R14; staging is sandbox data; four phases, each ending with your review; at most three relays on the website or database at once.
- **Social's technical design** (`docs/social/build.md`; `r5-design.md`; the spec and PLAN.md win): posting and trading keys kept apart by the database; one checked save for stories, test stories on staging only; lists paged by key; public reads kept at the edge, refreshed each minute and by the console's saves at once; a call is published only when live, marked beta; one file per relay's area.
- **Checks** (18 November 2026): R4's six cuts; a test machine's Speed warning recorded, not fixed, unless the page holds it or it repeats; a database-only change skips the preview checks.
- **The advisor** (18 November 2026; CLAUDE.md): before any design, any risky pull request and each final report, and on a repeated failure.
- **Standing:** one versioned public API, staging the bots' demo until launch; free tiers only; checks and budgets never looser; no questions to you during relays; design only from your references; database changes first, adding only; public until launch (P.17).

## What changed in the latest session

**R16's M6, as you asked** ([#187](https://github.com/Zugzwang-world/hrizzup/pull/187)): the sandbox's keys page now gets its sign-in button's style from a module the server can read (it used to receive an error message where the style belonged), and a new test fails if any server page ever reads a value out of a browser-only module again.

**R16's M4, as you asked** ([#186](https://github.com/Zugzwang-world/hrizzup/pull/186)): a package's tests now re-run whenever a package it uses changes, not just its own files (`dependsOn: ["transit"]` on `test`, as `bundle-size` does), with a test proving a shared package's change moves its dependents' test runs. A database change now also re-runs four packages' quick tests (seconds each); nothing got looser.

**R5 finished:** its done-test walked your Review 1 path (R5's half) through the pages on staging itself and passed. In the console (`/console/social`) you can make an invite and copy its ready message; make a test story, add updates and withdraw it; change settings and agents' limits; revoke an invite or an agent's keys (a revoked key answered 401 at once). Anyone can read the board and every story through the API, MCP and the sandbox (`/sandbox/social`), at most a minute old (the minute job runs healthy on staging). Agents find the board's calls in `/skill.md`. As you decided, social's calls now print every time with three decimals, like every other call.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **The agreement's market/2** (before 3.3). Recommendation: an optional `result_probability`, drafted with briefs' key-numbers field, so the first half changes once.
- **Four from R5:** social's database tests into the Database check; the minute job's window capped, so a failed run can't snowball; a preview's revocation also marking staging's copy of the key; a create-only option for the console's update form.
- **Also in the status file:** a journey's failed request printing its headers (R6: one small pull request moves every journey to the quiet wrapper); editing a request's existing forms within v1; pg_net's grants; node-forge in the Expo tool only; Vercel Pro's function billing; Vercel's toolbar; sign-ups waiting for the house; the Hermes rewrite; shared code.

## For the founder

- **How to do Review 1, R5's half** (the agent's half follows), on staging in your browser:
  1. Open `https://staging.hrizzup.com/sign-in-test`, press **Continue with Google** and sign in with your own Google account (an admin on staging); then open `https://staging.hrizzup.com/console/social`.
  2. **Invites:** fill **Email** (the owner's) and, if you like, **Note**; tick **Hrizzup's own agent** only for our own agents; choose **Listed** (or **Unlisted** for a test: it can't change later); press **Make the invite**. The code shows once: press **Copy the message** and send it to the owner. A lost code is a new invite: first **Revoke…** the old one (**Why**, then **Revoke this invite**).
  3. **Stories:** fill **Title**, **Summary**, **Main category** and **Main place**, choose **Listed: it shows on the board.**, press **Save the story**. On its page, under **Add an update**, fill **Headline** (and **Detail** and **Sources**, one https address per line, if you like) and press **Add the update**; two or three times.
  4. Open **The sandbox's board** (`/sandbox/social`): your story is there. Try **Top** and **Latest**, its category, its place, and a tier (global, national, local).
  5. Open the story: its updates (newest first, or **This page, oldest first**), its desk (empty until an agent posts) and its brief.
  Type nothing private in the console: the checks' public screenshots can show story titles and the settings' reasons.
- **How to do Review 1, the agent's half (R6),** on staging:
  1. In the console, invite your own Google email (R5's half) and copy the ready message.
  2. Give a fresh Claude Code session only its one line: `Read https://staging.hrizzup.com/skill.md and join Hrizzup with invite code <your code>.` It joins and hands you a claim link.
  3. Open the link, sign in with Google, check your name and press "Claim this agent".
  4. Tell the session: "Check in on Hrizzup, pin one of my test stories and make a text post with sources."
  5. Find the post on that story's desk and on the agent's profile, then tell this chat what you saw.
- **After both halves:** open your listed test story in the console's **Stories** and press **Withdraw this story…**, so it leaves the board (an agent's pin and post need it live until then).
- **Before Phase 2:** in Terminal, `cd ~/hrizzup && git pull` (new sessions read the role files from it); and create the public repository `hrizzup-skills` under your account, empty, MIT licence (R10 fills it).
- **Before Phase 3:** a Cloudflare API token limited to Workers AI, into Doppler `stg` once Claude Code lists its name (R12); at launch, production's reader agent gets its own Cloudflare account.
- **For information:** if a release stops at re-saving production's jobs (R16's step 4d), production is unchanged: start it once more, and tell this chat if it stops again.
- **Optionally, News Desk after Review 1,** so Hrizzup's own agents post beside invited owners.
- **Before launch:** a report button (P.22); the exchanges' terms (P.19); the API's limits per address (P.20). **Also:** the first topics (1.2); your two phone tries for 1.6b; your design references. **Spending parked.**

## What's next

Your Review 1. Then Phases 2 to 4, each from your review; R15 closes the round. Carried: the screens once designed; the topics (1.2); market/2 before 3.3; the stream (3.5e) later.

## Read for detail

- `docs/social/spec.md`: social's full design and the founder's answers; `docs/social/build.md`: the technical design (tables, calls, caching, jobs, who builds what, the tests); `docs/social/r5-design.md`: R5's design (the board's reads, edge tags and purges, the minute job, the console); `product/packages/api/src/social/`: every call's shape and example data.
- `PLAN.md` (section 2, "Social"; step 2.8 and "Social's build plan"), `TRACKER.md` (Round 6's queue), `CLAUDE.md` ("How relays run: the role team").
- `docs/research/faster-checks.md`, `docs/research/cron-missed-jobs.md`; `docs/setup/BLUEPRINT.md`; `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/status/product.md` (Product's status in full).
