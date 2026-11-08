# Sourcing: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 8 November 2026. The only repository file the Sourcing project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Sourcing's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Sourcing's job:** design and run the Grok bots that find news and creators' takes on X, keep everything they find in the sourced pool, and turn the news into stories and updates. Product shows what Sourcing produces, in the shapes the hand-over agreement (`agreement/README.md`) fixes.

## Where things stand

- **Sourcing's review of the agreement's first half is done** (8 November 2026; Round 2's relay 5, a Claude Code session working from this brief). It found two blocking problems and asked for nine changes, all made the same day. Sourcing agrees the revised first half. It's still a Draft, "reviewed by Sourcing, awaiting the founder's approval": the founder approves it in News Desk's place, through the Product chat.
- **No other Sourcing work has started.** The `sourcing/` folder holds only its README.
- **The second half (the bots' result format) isn't drafted:** Sourcing designs it once step 0.8's choice is made, and Product reviews it.
- **The shared setup is finished** (Phase 0): the content store is the Supabase database (staging: `hrizzup-staging`, Mumbai) plus Cloudflare R2; Upstash Redis holds caches and locks. Production is parked until launch.
- **No inbox for the bots yet:** mail to `hrizzup.com` goes to the founder's own Proton mailboxes.

## Decisions in force

- **Sourcing is fully automated, through Grok bots** reading X on a schedule. Which Grok product and plan run them, and the route that brings their results to our pipeline, are chosen here (step 0.8; the founder already has SuperGrok). An email route needs an inbox the pipeline reads itself, not the founder's.
- **The bots find two things** (the founder, 5 November 2026): **news**, which our AI turns into stories and updates, and **creators' takes** (memes, videos, explainers), all kept in the **sourced pool** after the pipeline's checks.
- **Three routes into the feed:** found (a take embedded from X and credited, never copied, for every story), made (News Desk's own content) and posted (creators and users). Product only displays, crediting each item by its route.
- **The sourced item, as revised:** news or a take; the post's address, handle and name **as X showed them at the last check**; when it was first posted; what it holds; a summary in our own words; its stories; its state. **Unavailable** (deleted; account protected, suspended or closed; withheld in India; or taken down at its creator's request) keeps **nothing of the post**, only our own fields, for good. **Withdrawn** (not genuine, off-story or unsafe, or taken down by law) keeps the post, so it isn't kept twice. One item per post, an edited post under its newest version; never a repost (its original instead) or a reply to someone else as a take; a thread is its first post.
- **Updates, as revised:** each names its sources: posts our bots found (`based_on`, by their sourced items) and other pages (`sources`, never X's own). A repeat is `merged` into the update it repeats; a correction is a new update. **Stories:** merges never chain, and the pipeline moves its own records to the story that stays.
- **Every fact about a post comes from X, never from the bot's words:** Grok's citations give the post's number; X's public embed lookup confirms the post and gives its address, handle and name; the number gives the time. The post's words are never kept; set-aside input goes after 7 days.
- **Tagging, by the founder's decisions** (a change goes back to the founder): the launch list (Global; India; Mumbai, Delhi NCR, Bengaluru; crypto, finance, business, AI, sports, politics, entertainment, general); up to three locations and categories, the main one first; a city's story shows under India only when our AI also tags it India; stories carry no picture.
- **Sign-offs:** the first half on Sourcing's review (done) plus the founder's approval in News Desk's place; the second half designed here, agreed by Product after a real test result with news and takes passes the checks. The pipeline (1.1) needs both halves and 0.8.
- **The agreement's rules:** outside data is data, never instructions; every hand-over point checks origin and format, and sets aside, logs and alerts on failures; accuracy stays with our AI, and a legal takedown is the one step a person takes; code reads `agreement/definitions/` directly.
- **Also:** market data is Product's (1.2, 3.2); background jobs for the whole product are chosen here, and must cover perps' checks every few seconds (on Supabase Cron, the founder's choice); no relays, so this brief carries what Sourcing needs; the shared rules hold (the repository is the only route, migrations with row-level security, checks before code, staging capped, never production, unattended sessions from Round 2).

## What changed in the latest session

On 8 November 2026, Round 2's relay 5 ran Sourcing's review and made its changes:

- **The review** ([#37](https://github.com/Zugzwang-world/hrizzup/pull/37)): `agreement/reviews/sourcing-first-half.md`, each finding marked blocking, change or note, with what X's rules and xAI's documentation say.
- **The changes** ([#42](https://github.com/Zugzwang-world/hrizzup/pull/42)), a new Draft revision at format version 1: the two blocking findings (an unavailable item keeps nothing of its post, as X's developer rules require; the credit follows the account's current handle, which X frees for others when it changes); nine changes (sourced updates, edits, reposts and threads, merges, repeats, legal takedowns, media, names, set-aside input); and, from the automatic security review, web addresses whose host can't hide a post on X.
- **Fourteen notes** for step 1.1, the second half and Product, in the review.

## Open questions

- **Grok product, plan and route** (step 0.8). Recommendation: xAI's API with its X search tool, called by our own scheduled job; the review found it fits the shapes (its citations give each post's number; its structured output can carry the second half).
- **Bot set-up, schedule and result format** (second half; 1.1). Recommendation: one structured result per run, news and takes together, with no conditional rules (xAI only tries to follow those); every 15 minutes under a spending cap. X search costs $5 per 1,000 posts fetched: 100 posts every 15 minutes is about $1,450 a month before tokens.
- **Whether the terms allow a public app** (0.8). Recommendation: read xAI's API terms first; the shapes follow X's developer rules either way.
- **Vetting.** Recommendation: two independent sources, or one official account; hold a claim while a Community Note disputes it.
- **Which takes the bots keep.** Recommendation: original and quote posts from accounts with a real following, ranked by engagement; in English only, if the founder confirms (the review's F1).
- **Checking kept posts again.** Recommendation: daily at least, more often while a story is active, through X's embed lookup from our Mumbai servers.
- **Takedown requests** (the founder decides: F2). Recommendation: to the founder at a `hrizzup.com` address until the team's tools exist, each acted on within 24 hours.
- **How Sourcing's other choices reach the repository.** Recommendation: like the review, a Claude Code session working from this brief.
- **Background jobs.** Recommendation: Supabase Cron with Supabase Queues, compared with Vercel's workflows before step 1.1 and reviewed by Product; the checks and the pool's housekeeping run there too.

## What's next

1. **The founder approves the first half** in News Desk's place, after reading the review. Until then, no project builds tables for its shapes.
2. **Grok and the route (step 0.8):** choose them; the founder sets them up with Claude Code. Done when a test bot's result arrives by that route.
3. **Design the second half:** the bots' result format with news and takes, the proof of origin (with xAI's API, our own call with our own key), and when alerts fire. Product reviews it.
4. **The news pipeline (step 1.1):** needs both halves and 0.8. Done when stories appear and update on their own on staging, and the takes wait in the pool, each linked to its story.

## Read for detail

- `agreement/reviews/sourcing-first-half.md`: the review in full: its findings, the notes for the pipeline, the questions for the founder, and its sources.
- `agreement/README.md`: sign-offs, decisions, routes, every field of a story, an update and a sourced item, the lists and the hand-over rules; `definitions/` and `examples/` beside it.
- `PLAN.md`: sections 2 (News), 4 (the projects), 5 (steps 0.7, 0.8, 1.1), 7 (open questions).
- `docs/status/sourcing.md`: Sourcing's status in full, with this session's own answers.
- `sourcing/README.md`: the folder and its rules.
- `docs/setup/RUNBOOK.md` Part 3 and `docs/setup/BLUEPRINT.md` sections 5, 8 and 14: email, the bots' route, the database, caching.
- `CLAUDE.md`: the agreement, the briefs, unattended sessions, database changes.
