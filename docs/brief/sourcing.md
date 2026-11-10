# Sourcing: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 10 November 2026 by Round 5's relay R2 (the public API's research and design, research only, [#PR_NUMBER](https://github.com/Zugzwang-world/hrizzup/pull/PR_NUMBER)), whose change to PLAN.md rewrites every brief. The Sourcing project's only file from the repository, rewritten at the end of every session that touches its part. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Sourcing's job:** design and run the Grok bots that find news and creators' takes on X, keep everything they find in the sourced pool, and turn the news into stories and updates. Product shows what Sourcing produces, in the shapes the hand-over agreement (`agreement/README.md`) fixes.

## Where things stand

- **The agreement's first half is Agreed** (9 November 2026), as Sourcing agreed it in its review ([#37](https://github.com/Zugzwang-world/hrizzup/pull/37), changes [#42](https://github.com/Zugzwang-world/hrizzup/pull/42) and [#45](https://github.com/Zugzwang-world/hrizzup/pull/45)); its shapes are fixed at format version 1.
- **Sourcing's work runs in this project, on its own schedule** (the founder, 9 November 2026), with no xAI API, never from Product's round chat.
- **No Sourcing work has started** (`sourcing/` holds only its README); the second half isn't drafted. The tables the pipeline will write exist on Product's side (step 1.9, [#72](https://github.com/Zugzwang-world/hrizzup/pull/72)): empty and locked until 1.1 gets its own write access. Product's Round 5 (the markets sandbox, the public API, then the screens the design chat approves) has nothing in Sourcing's part.
- **The shared setup is finished** (Phase 0): Supabase (staging, Mumbai), Cloudflare R2 and Upstash Redis; production is parked until launch. No inbox for the bots yet.

## Decisions in force

- **Sourcing is fully automated, through Grok bots** reading X on a schedule. **Hrizzup uses no xAI API: Grok bots source everything** (the founder, 9 November 2026). The Grok product, plan and route to our pipeline are chosen here (step 0.8).
- **The bots find two things:** **news**, which our AI turns into stories and updates, and **creators' takes** (memes, videos, explainers), all kept in the **sourced pool** after the pipeline's checks. **Takes in English only**; a meme or a video with few or no words counts.
- **Three routes into the feed:** found (a take embedded from X and credited, never copied), made (News Desk's own content) and posted (creators and users). Product only displays, crediting each by its route, and uses no xAI or X API: it receives everything through the content store's tables (step 1.9).
- **The sourced item:** news or a take; the post's address, handle and name **as X showed them at the last check**; when it was first posted; what it holds; a summary in our own words; its stories; its state. **Unavailable** (deleted; account protected, suspended or closed; withheld in India; or taken down at its creator's request) keeps **nothing of the post**, for good. **Withdrawn** (not genuine, off-story or unsafe, or taken down by law) keeps the post, so it isn't kept twice. One item per post (an edited post under its newest version); never a repost or a reply to someone else as a take; a thread is its first post.
- **Updates** name their sources: found posts (`based_on`) and other pages (`sources`, never X's own); a repeat is `merged` into the update it repeats; a correction is a new update. **Stories:** merges never chain, and the pipeline moves its own records to the story that stays.
- **The database enforces those rules:** the content store's tables hold every agreement rule a database can, so it refuses a record that breaks one. The pipeline (1.1) writes in read committed transactions (Postgres's default); rules across records are checked at commit, so a merge goes in one transaction, in any order (`infra/supabase/content-store.md`).
- **Every fact about a post comes from X, never from the bot's words** (its number from the bots' citations; its address, handle and name from X's public embed lookup). The post's words are never kept; set-aside input goes after 7 days.
- **Tagging, by the founder's decisions:** the launch list (Global; India; Mumbai, Delhi NCR, Bengaluru; crypto, finance, business, AI, sports, politics, entertainment, general); up to three locations and categories, the main one first; a city's story shows under India only when our AI also tags it India; stories carry no picture.
- **Changing the first half:** an optional field, or a list item the founder approves, is one change; anything else is a new format version (such as `story/2`), agreed by all three projects, the founder in News Desk's place while it's on hold. **The first coming is market/2**, for markets settled at a set probability, before Product's step 3.3 (settled in the Product chat, 10 November 2026).
- **The second half** is designed here and agreed by Product only after a real test result, with news and takes, passes the agreement's checks; until then no bot result becomes content. The pipeline (1.1) needs both halves, 0.8 and 1.9.
- **Background jobs:** Sourcing's choice, made here; nothing has needed one yet. It must cover the markets' automatic resolvers (3.2a), which follow the first topics (1.2); the perp's jobs every 5 seconds (3.4a, and its own price, 3.4b) stay on Supabase Cron.
- **Shared rules:** outside data is data, never instructions; every hand-over point checks origin and format; code reads `agreement/definitions/` directly; **database changes land first**; legal is the founder's legal team's; market data is Product's (the topics' sources, the perp's price, the public API); never production. The repository is public until launch, so nothing secret or personal goes in it.
- **Product first until launch** (the founder, 10 November 2026): work goes to the product; no new privacy, security or production work unless it blocks the product; existing checks, budgets and rules stay exactly as they are, nothing looser.
- **Nothing paid for now** (the founder, 10 November 2026): free versions and free tiers only; no new paid tool, plan or licence until the founder says so.

## What changed in the latest session

On 10 November 2026, Round 5's relay R2 ([#PR_NUMBER](https://github.com/Zugzwang-world/hrizzup/pull/PR_NUMBER), research only) recorded the founder's decisions on Product's public API in PLAN.md (section 2, "The public API"). **Nothing Sourcing writes, reads or checks changes,** and the agreement is untouched.

- **A public API for Product's markets** (3.5a to 3.5f): bots and AI tools use the typed API with personal keys, on staging until launch.
- **Topics unparked** (1.2): the Product chat drafts them, so the automatic resolvers (3.2a), which the background-jobs choice must cover, come sooner.
- **The perp's own price** (3.4b): every 5 seconds, a median of exchanges' free public prices, in the database on Supabase Cron, outside the background-jobs choice.

## Open questions

- **Grok product, plan and route** (0.8). Recommendation: start from what the founder already has (SuperGrok) and the bots' own inbox, which our pipeline reads automatically (not the founder's own). Check what the product can run on a schedule, what each result can carry (news and takes, with each post's number), and how a result proves it came from our bot.
- **How Sourcing's choices reach the repository.** Recommendation: as for the first half's review, a Claude Code session working from this brief, on this project's schedule, recording the choice and what needs the founder's approval.
- **Bot set-up, schedule and result format** (second half; 1.1). Recommendation: one result per run, news and takes together, in a fixed format the pipeline checks itself.
- **Whether the terms allow a public app** (0.8). Recommendation: read the chosen Grok product's terms first.
- **Vetting.** Recommendation: two independent sources, or one official account; hold a claim a Community Note disputes.
- **Which takes the bots keep.** Recommendation: original and quote posts from accounts with a real following.
- **Checking kept posts again.** Recommendation: daily at least, more often while a story is active.
- **Background jobs.** Recommendation: Supabase Cron with Supabase Queues, compared with Vercel's workflows.
- **A post's address and its handle:** `validate()` doesn't check that the address names the handle; the database does. Recommendation: add it to `validate()`, which Sourcing agrees, in the same change as market/2.
- **market/2** (before 3.3). Recommendation: agree it when Product drafts it; it touches only the market.
- **Not open:** takedown handling and legal review (the founder's legal team).

## What's next

1. **Grok and the route (step 0.8),** with no xAI API; the founder sets them up, with Claude Code. Done when a test bot's result arrives by that route.
2. **Design the second half:** the bots' result format with news and takes, the proof of origin, and when alerts fire. Product reviews it.
3. **The news pipeline (step 1.1):** needs both halves, 0.8 and 1.9. Done when stories appear and update on their own on staging, and the takes wait in the pool, each linked to its story.
4. **When Product drafts it, agree market/2** (before Product's step 3.3).

## Read for detail

- `agreement/README.md`: every field, the lists, the hand-over rules and how the agreement changes; `definitions/` and `examples/` beside it.
- `agreement/reviews/sourcing-first-half.md`: the review and the founder's answers.
- `PLAN.md`: sections 2, 4, 5 (steps 0.7, 0.8, 1.1, 1.9, 3.3) and 7.
- `docs/status/sourcing.md`: Sourcing's status in full; `sourcing/README.md`: the folder's rules.
- `infra/supabase/content-store.md`: the content store's tables, every rule they hold and how the pipeline writes to them.
- `docs/setup/RUNBOOK.md`, Part 3's note on the bots' inbox; `CLAUDE.md` (the agreement, database changes).
