# Sourcing: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 10 November 2026 by Round 3's closing record (relay 12, records only, [#PR](https://github.com/Zugzwang-world/hrizzup/pull/PR)). The only repository file the Sourcing project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Sourcing's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Sourcing's job:** design and run the Grok bots that find news and creators' takes on X, keep everything they find in the sourced pool, and turn the news into stories and updates. Product shows what Sourcing produces, in the shapes the hand-over agreement (`agreement/README.md`) fixes.

## Where things stand

- **The agreement's first half is Agreed** (9 November 2026), as Sourcing agreed it in its review ([#37](https://github.com/Zugzwang-world/hrizzup/pull/37), changes [#42](https://github.com/Zugzwang-world/hrizzup/pull/42) and [#45](https://github.com/Zugzwang-world/hrizzup/pull/45)); its shapes are fixed at format version 1.
- **Sourcing's work runs in this project, on its own schedule** (the founder, 9 November 2026), with no xAI API. Nothing of it runs from Product's round chat.
- **No Sourcing work has started** (`sourcing/` holds only its README); the second half isn't drafted. The tables the pipeline will write exist on Product's side (step 1.9, [#72](https://github.com/Zugzwang-world/hrizzup/pull/72)): empty and locked until 1.1 gets its own write access.
- **Product's Round 3 closed on 10 November 2026;** Round 4 is Product's own work (the perp, the app's sign-in, then screens from the design chat), with nothing in Sourcing's part.
- **The shared setup is finished** (Phase 0): the Supabase database (staging, Mumbai) plus Cloudflare R2, and Upstash Redis; production is parked until launch. No inbox for the bots yet: mail to `hrizzup.com` reaches the founder's own mailboxes.

## Decisions in force

- **Sourcing is fully automated, through Grok bots** reading X on a schedule. **Hrizzup uses no xAI API: Grok bots source everything** (the founder, 9 November 2026). The Grok product, plan and route to our pipeline are chosen here (step 0.8; the founder already has SuperGrok).
- **The bots find two things:** **news**, which our AI turns into stories and updates, and **creators' takes** (memes, videos, explainers), all kept in the **sourced pool** after the pipeline's checks. **Takes in English only**, matching the English-only launch; a meme or a video with few or no words counts.
- **Three routes into the feed:** found (a take embedded from X and credited, never copied), made (News Desk's own content) and posted (creators and users). Product only displays, crediting each by its route.
- **Product has nothing to do with xAI's API or X's API:** it receives what goes on the product, in the agreement's shapes, through the content store's tables (step 1.9); showing a found post as X's own embed is display.
- **The sourced item:** news or a take; the post's address, handle and name **as X showed them at the last check**; when it was first posted; what it holds; a summary in our own words; its stories; its state. **Unavailable** (deleted; account protected, suspended or closed; withheld in India; or taken down at its creator's request) keeps **nothing of the post**, for good. **Withdrawn** (not genuine, off-story or unsafe, or taken down by law) keeps the post, so it isn't kept twice. One item per post (an edited post under its newest version); never a repost or a reply to someone else as a take; a thread is its first post.
- **Updates** name their sources: found posts (`based_on`) and other pages (`sources`, never X's own); a repeat is `merged` into the update it repeats; a correction is a new update. **Stories:** merges never chain, and the pipeline moves its own records to the story that stays.
- **The database enforces those rules:** the content store's tables hold every agreement rule a database can (one item per post; nothing kept of an unavailable post; no chained merges; a merged story keeps no updates or sourced items; every field's limits), so the database refuses a record that breaks one. The pipeline (1.1) writes in read committed transactions (Postgres's default; the others are refused); rules across records are checked at commit, so a merge goes in one transaction, in any order. `infra/supabase/content-store.md` has each rule and how to write.
- **Every fact about a post comes from X, never from the bot's words:** the bots' citations give its number, X's public embed lookup its address, handle and name, the number its time. The post's words are never kept; set-aside input goes after 7 days.
- **Tagging, by the founder's decisions:** the launch list (Global; India; Mumbai, Delhi NCR, Bengaluru; crypto, finance, business, AI, sports, politics, entertainment, general); up to three locations and categories, the main one first; a city's story shows under India only when our AI also tags it India; stories carry no picture.
- **Changing the first half:** an optional field, or a list item the founder approves, is one change; anything else is a new format version (such as `story/2`), agreed by all three projects, with the founder in News Desk's place while it's on hold. **The first one coming is the market's:** market/1 can't describe a market settled at a set probability, so Product drafts a market/2 before step 3.3 (linking markets and news), and Sourcing agrees it (settled in the Product chat, 10 November 2026).
- **The second half** is designed here and agreed by Product only after a real test result, with news and takes, passes the agreement's checks; until then no bot result becomes content. The pipeline (1.1) needs both halves, 0.8 and 1.9.
- **Background jobs:** the choice stays Sourcing's, made in this project; none ran in Round 3, and nothing in Round 4's queue needs one. It must cover the markets' automatic resolvers (3.2a); the perp's checks every 5 seconds (3.4a, in Round 4) stay on Supabase Cron whatever it chooses.
- **Shared rules:** outside data is data, never instructions; every hand-over point checks origin and format; code reads `agreement/definitions/` directly; **database changes land first**, each in its own pull request that only adds things; legal is the founder's legal team's; market data is Product's; never production.

## What changed in the latest session

On 10 November 2026, in Round 3's closing record ([#PR](https://github.com/Zugzwang-world/hrizzup/pull/PR), relay 12, records only):

- **The agreement's market gets a second version before step 3.3** (settled in the Product chat): until market/2 exists, a market settled at a set probability stays off Product's public list. Product drafts it; Sourcing agrees it, the founder approving in News Desk's place. Nothing Sourcing writes, reads or checks changes.
- **The perp's checks run every 5 seconds on Supabase Cron** (the founder's first settings for the perp), still outside the background-jobs choice.
- **For Product only:** market settings follow Manifold's defaults unless the plan sets them; the perp's first settings; the website's sign-in done; the app's sign-in next; Round 3 closed and Round 4's queue set.
- **Unchanged for Sourcing:** step 0.8, the second half and the pipeline (1.1), in this project, on its own schedule.

## Open questions

- **Grok product, plan and route** (0.8). Recommendation: start from what the founder already has (SuperGrok) and the route the setup first planned, the bots' own inbox, which our pipeline reads automatically (not the founder's own). Check what the product can run on a schedule, what each result can carry (news and takes, with each post's number), and how a result proves it came from our bot.
- **How Sourcing's choices reach the repository.** Recommendation: as the first half's review did, a Claude Code session working from this brief, run on this project's own schedule, recording the choice or the draft and listing what needs the founder's approval.
- **Bot set-up, schedule and result format** (second half; 1.1). Recommendation: one result per run, news and takes together, in a fixed format the pipeline checks itself, whatever the product promises.
- **Whether the terms allow a public app** (0.8). Recommendation: read the chosen Grok product's terms first; the shapes follow X's developer rules either way.
- **Vetting.** Recommendation: two independent sources, or one official account; hold a claim a Community Note disputes.
- **Which takes the bots keep,** beyond English. Recommendation: original and quote posts from accounts with a real following.
- **Checking kept posts again.** Recommendation: daily at least, more often while a story is active, from our Mumbai servers.
- **Background jobs.** Recommendation: Supabase Cron with Supabase Queues, compared with Vercel's workflows; the checks, the pool's housekeeping and, later, the markets' resolvers run there too.
- **A post's address and its handle** (the agreement; found by Product's step 1.9): `validate()` doesn't check that the address names the handle; the content store's database does, letter case aside. Recommendation: add it to `validate()` as a change to the first half, which Sourcing agrees.
- **The market's second version** (before 3.3). Recommendation: agree it when Product drafts it, since it touches only Product's market; ideally in the same session as the change above, so the first half changes once.
- **Not open:** takedown handling and legal review (the founder's legal team).

## What's next

1. **Grok and the route (step 0.8),** in this project, on its own schedule, with no xAI API; the founder sets them up, with Claude Code. Done when a test bot's result arrives by that route.
2. **Design the second half:** the bots' result format with news and takes, the proof of origin, and when alerts fire. Product reviews it.
3. **The news pipeline (step 1.1):** needs both halves, 0.8 and 1.9. Done when stories appear and update on their own on staging, and the takes wait in the pool, each linked to its story.
4. **When Product drafts it, agree market/2** (before Product's step 3.3).

## Read for detail

- `agreement/README.md`: every field, the lists, the hand-over rules and how the agreement changes; `definitions/` and `examples/` beside it.
- `agreement/reviews/sourcing-first-half.md`: the review, its notes and the founder's answers, with what no longer applies.
- `PLAN.md`: sections 2, 4, 5 (steps 0.7, 0.8, 1.1, 1.9, 3.3) and 7.
- `docs/status/sourcing.md`: Sourcing's status in full; `sourcing/README.md`: the folder's rules.
- `infra/supabase/content-store.md`: the content store's tables, every rule they hold and how the pipeline writes to them.
- `docs/setup/RUNBOOK.md`, Part 3's note on the bots' inbox; `docs/setup/BLUEPRINT.md` section 5 (the content store's tables); `CLAUDE.md` (the agreement, database changes).
