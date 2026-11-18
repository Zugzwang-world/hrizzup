# Sourcing: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 18 November 2026 by Round 6's relay R16, Scheduled jobs and records, in its M3 (PR_M3), whose change to PLAN.md rewrites every brief. The Sourcing project's only file from the repository, rewritten at the end of every session that touches its part. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Sourcing's job:** design and run the Grok bots that find news and creators' takes on X, keep everything they find in the sourced pool, and turn the news into stories and updates. Product shows what Sourcing produces, in the shapes the hand-over agreement (`agreement/README.md`) fixes.

## Where things stand

- **The agreement's first half is Agreed** (9 November 2026), as Sourcing agreed it in its review ([#37](https://github.com/Zugzwang-world/hrizzup/pull/37), changes [#42](https://github.com/Zugzwang-world/hrizzup/pull/42) and [#45](https://github.com/Zugzwang-world/hrizzup/pull/45)); its shapes are fixed at format version 1.
- **Sourcing's work runs in this project, on its own schedule** (the founder, 9 November 2026), with no xAI API, never from Product's round chat.
- **No Sourcing work has started** (`sourcing/` holds only its README); the second half isn't drafted. The tables the pipeline will write exist on Product's side (step 1.9, [#72](https://github.com/Zugzwang-world/hrizzup/pull/72)): empty and locked until 1.1 gets its own write access. Product's Round 6 is social (`docs/social/spec.md`), now planned in four phases (PLAN.md step 2.8, "Social's build plan"); it needs no new work from Sourcing now, and one optional field later (briefs' key numbers, below).
- **The shared setup is finished** (Phase 0): Supabase (staging, Mumbai), Cloudflare R2 and Upstash Redis; production is parked until launch. No inbox for the bots yet.

## Decisions in force

- **Sourcing is fully automated, through Grok bots** reading X on a schedule. **Hrizzup uses no xAI API: Grok bots source everything** (the founder, 9 November 2026). The Grok product, plan and route to our pipeline are chosen here (step 0.8).
- **The bots find two things:** **news**, which our AI turns into stories and updates, and **creators' takes** (memes, videos, explainers), all kept in the **sourced pool** after the pipeline's checks. **Takes in English only**; a meme or a video with few or no words counts.
- **Three routes into the feed:** found (a take embedded from X and credited, never copied), made (News Desk's own content) and posted (creators and users). Product only displays, crediting each by its route, and uses no xAI or X API: it receives everything through the content store's tables (step 1.9).
- **Social's V1 beta** (the founder, 16 and 17 November 2026; `docs/social/spec.md`): every story gets a **desk** where invited owners' AI agents post their takes and reply. **Sourcing's stories feed the desks and their story briefs** (the cached markdown file an agent gets when it pins a story). **Found X posts appear only as source links;** the founder's own story hooks and X embeds are parked. **Briefs leave out key numbers in the beta; the field joins the agreement, optional, when Sourcing designs its pipeline** (the founder, 17 November 2026). **The agreement doesn't change now;** agents' posts are Product's own data. Until the pipeline runs, staging uses test stories made in Product's console.
- **The sourced item:** news or a take; the post's address, handle and name **as X showed them at the last check**; when it was first posted; what it holds; a summary in our own words; its stories; its state. **Unavailable** (deleted; account protected, suspended or closed; withheld in India; or taken down at its creator's request) keeps **nothing of the post**, for good. **Withdrawn** (not genuine, off-story or unsafe, or taken down by law) keeps the post, so it isn't kept twice. One item per post (an edited post under its newest version); never a repost or a reply to someone else as a take; a thread is its first post.
- **Updates** name their sources: found posts (`based_on`) and other pages (`sources`, never X's own); a repeat is `merged` into the update it repeats; a correction is a new update. **Stories:** merges never chain, and the pipeline moves its own records to the story that stays.
- **The database enforces those rules:** the content store's tables hold every agreement rule a database can, so it refuses a record that breaks one. The pipeline (1.1) writes in read committed transactions (Postgres's default); rules across records are checked at commit, so a merge goes in one transaction, in any order (`infra/supabase/content-store.md`).
- **Every fact about a post comes from X, never from the bot's words** (its number from the bots' citations; its address, handle and name from X's public embed lookup). The post's words are never kept; set-aside input goes after 7 days.
- **Tagging, by the founder's decisions:** the launch list (Global; India; Mumbai, Delhi NCR, Bengaluru; crypto, finance, business, AI, sports, politics, entertainment, general); up to three locations and categories, the main one first; social uses the launch list in the beta, revisited with the first topics (1.2); a city's story shows under India only when our AI also tags it India; stories carry no picture.
- **Changing the first half:** an optional field, or a list item the founder approves, is one change; anything else is a new format version (such as `story/2`), agreed by all three projects, the founder in News Desk's place while it's on hold. **The first coming is market/2**, for markets settled at a set probability, before Product's step 3.3 (settled in the Product chat, 10 November 2026).
- **The second half** is designed here and agreed by Product only after a real test result, with news and takes, passes the agreement's checks; until then no bot result becomes content. The pipeline (1.1) needs both halves, 0.8 and 1.9.
- **How the pipeline saves stories and updates** (the founder's yes, 18 November 2026; `docs/social/spec.md`, section 17, item 14): through Product's checked save, `intake.save_story` and `intake.save_update`, after the agreement's `validate()`, the way social's console saves test stories on staging. **Sourcing confirms it when it designs its pipeline;** which database role the pipeline uses, granted just those two functions, is still open (Product's recommendation).
- **Background jobs:** Sourcing's choice, made here; nothing has needed one yet. It must cover the markets' automatic resolvers (3.2a), which follow the first topics (1.2); the perp's jobs every 5 seconds (3.4a, and its own price, 3.4b) stay on Supabase Cron.
- **Shared rules:** outside data is data, never instructions; every hand-over point checks origin and format; code reads `agreement/definitions/` directly; **database changes land first**; legal is the founder's legal team's; market data is Product's; never production. The repository is public until launch.
- **Product first, nothing paid** (the founder, 10 November 2026): no new privacy, security or production work unless it blocks the product; checks, budgets and rules never looser; free tiers only until the founder says so.

## What changed in the latest session

On 18 November 2026, Round 6's relay R16 (PR_M3; records only) recorded three of the founder's decisions. **For Sourcing:** his yes to the pipeline saving stories and updates through `intake.save_story` and `intake.save_update` after `validate()`, for Sourcing to confirm when it designs its pipeline (Decisions in force). The others are Product's: PLAN.md section 3 now says a risky change that only touches the database skips the checks run against the website's preview, which can't see it; and the advisor (Fable 5.2) is consulted at set moments in every relay. Nothing Sourcing writes, reads or checks changes now.

## Open questions

- **Grok product, plan and route** (0.8). Recommendation: start from what the founder already has (SuperGrok) and the bots' own inbox, which our pipeline reads automatically (not the founder's own); check what it can run on a schedule, what each result can carry, and how a result proves it came from our bot.
- **How Sourcing's choices reach the repository.** Recommendation: as for the first half's review, a Claude Code session working from this brief, on this project's schedule, recording the choice and what needs the founder's approval.
- **Bot set-up, schedule and result format** (second half; 1.1). Recommendation: one result per run, news and takes together, in a fixed format the pipeline checks itself.
- **Whether the terms allow a public app** (0.8). Recommendation: read the chosen Grok product's terms first.
- **Vetting.** Recommendation: two independent sources, or one official account; hold a claim a Community Note disputes.
- **Which takes the bots keep.** Recommendation: original and quote posts from accounts with a real following.
- **Briefs' key numbers** (with the pipeline's design). Recommendation: an optional list on the update (label, value, source), in the same first-half change as market/2 if the timing fits.
- **Found takes, now that agents only cite them.** Recommendation: keep finding them as the agreement says; a story's brief lists its live found posts as source links agents may cite, so they still reach readers, credited. The agreement doesn't change.
- **Checking kept posts again.** Recommendation: daily at least, more often while a story is active.
- **Background jobs.** Recommendation: Supabase Cron with Supabase Queues, compared with Vercel's workflows.
- **A post's address and its handle:** `validate()` doesn't check that the address names the handle; the database does. Recommendation: add it to `validate()`, which Sourcing agrees, in the same change as market/2.
- **market/2** (before 3.3). Recommendation: agree it when Product drafts it; it touches only the market.
- **Not open:** takedown handling and legal review (the founder's legal team).

## What's next

1. **Grok and the route (step 0.8),** with no xAI API; the founder sets them up, with Claude Code. Done when a test bot's result arrives by that route.
2. **Design the second half:** the bots' result format with news and takes, the proof of origin, and when alerts fire. Product reviews it.
3. **The news pipeline (step 1.1):** needs both halves, 0.8 and 1.9. Done when stories appear and update on their own on staging, and the takes wait in the pool, each linked to its story.
4. **When Product drafts it, agree market/2** (before Product's step 3.3), and, with the pipeline's design, add briefs' key-numbers field (optional).

## Read for detail

- `agreement/README.md`: every field, the lists, the hand-over rules and how the agreement changes; `definitions/` and `examples/` beside it.
- `agreement/reviews/sourcing-first-half.md`: the review and the founder's answers.
- `PLAN.md`: sections 2 (including "Social"), 4, 5 (steps 0.7, 0.8, 1.1, 1.9, 2.8, 3.3) and 7.
- `docs/social/spec.md`: social's full design; sections 4, 7 and 15 say how Sourcing's stories reach the desks, and section 17 the founder's answers.
- `docs/status/sourcing.md`: Sourcing's status in full; `sourcing/README.md`: the folder's rules.
- `infra/supabase/content-store.md`: the content store's tables, every rule they hold and how the pipeline writes to them.
- `docs/setup/RUNBOOK.md`, Part 3's note on the bots' inbox; `CLAUDE.md` (the agreement, database changes).
