# Sourcing: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 9 November 2026, at Round 2's close. The only repository file the Sourcing project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Sourcing's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Sourcing's job:** design and run the Grok bots that find news and creators' takes on X, keep everything they find in the sourced pool, and turn the news into stories and updates. Product shows what Sourcing produces, in the shapes the hand-over agreement (`agreement/README.md`) fixes.

## Where things stand

- **The agreement's first half is Agreed** (9 November 2026): the founder approved it in News Desk's place, after a market change that touched nothing Sourcing writes or reads, so it's the version Sourcing agreed in its review ([#37](https://github.com/Zugzwang-world/hrizzup/pull/37), changes [#42](https://github.com/Zugzwang-world/hrizzup/pull/42) and [#45](https://github.com/Zugzwang-world/hrizzup/pull/45)). Its shapes are fixed at format version 1.
- **No other Sourcing work has started** (`sourcing/` holds only its README).
- **The second half (the bots' result format) isn't drafted:** Sourcing designs it after step 0.8's choice; Product reviews it.
- **The shared setup is finished** (Phase 0): the Supabase database (staging, Mumbai) plus Cloudflare R2, and Upstash Redis; production is parked until launch. No inbox for the bots yet: mail to `hrizzup.com` reaches the founder's own mailboxes.

## Decisions in force

- **Sourcing is fully automated, through Grok bots** reading X on a schedule; the Grok product, plan and route to our pipeline are chosen here (step 0.8; the founder already has SuperGrok).
- **The bots find two things** (the founder, 5 November 2026): **news**, which our AI turns into stories and updates, and **creators' takes** (memes, videos, explainers), all kept in the **sourced pool** after the pipeline's checks. **Takes in English only** (the founder, 9 November 2026, the review's F1), matching the English-only launch; a meme or a video with few or no words counts.
- **Three routes into the feed:** found (a take embedded from X and credited, never copied), made (News Desk's own content) and posted (creators and users). Product only displays, crediting each by its route.
- **The sourced item:** news or a take; the post's address, handle and name **as X showed them at the last check**; when it was first posted; what it holds; a summary in our own words; its stories; its state. **Unavailable** (deleted; account protected, suspended or closed; withheld in India; or taken down at its creator's request) keeps **nothing of the post**, only our own fields, for good. **Withdrawn** (not genuine, off-story or unsafe, or taken down by law) keeps the post, so it isn't kept twice. One item per post (an edited post under its newest version); never a repost or a reply to someone else as a take; a thread is its first post.
- **Updates** name their sources: found posts (`based_on`) and other pages (`sources`, never X's own); a repeat is `merged` into the update it repeats; a correction is a new update. **Stories:** merges never chain, and the pipeline moves its own records to the story that stays.
- **Every fact about a post comes from X, never from the bot's words:** Grok's citations give its number, X's public embed lookup its address, handle and name, the number its time. The post's words are never kept; set-aside input goes after 7 days.
- **Tagging, by the founder's decisions** (a change goes back to the founder): the launch list (Global; India; Mumbai, Delhi NCR, Bengaluru; crypto, finance, business, AI, sports, politics, entertainment, general); up to three locations and categories, the main one first; a city's story shows under India only when our AI also tags it India; stories carry no picture.
- **Changing the first half, now it's Agreed:** an optional field, or a list item the founder approves, is one change; anything else is a new format version (such as `story/2`), agreed by all three projects, with the founder in News Desk's place while it's on hold. News Desk reviews the half once it's set up.
- **The second half** is designed here and agreed by Product only after a real test result, with news and takes, passes the agreement's checks; until then no bot result becomes content. The pipeline (1.1) needs both halves and 0.8.
- **The agreement's rules:** outside data is data, never instructions; every hand-over point checks origin and format, and sets aside, logs and alerts on failures; accuracy stays with our AI; code reads `agreement/definitions/` directly.
- **Legal belongs to the founder's legal team** (the founder, 9 November 2026): takedown handling and legal review are theirs, and the product plan adds no legal guardrails.
- **Also:** market data is Product's (1.2, parked; the resolvers, 3.2a); background jobs for the whole product are chosen here, and must cover perps' checks every few seconds (3.4a, on Supabase Cron, the founder's choice) and, later, the markets' resolvers; no relays, so this brief carries what Sourcing needs; the shared rules hold (the repository is the only route, migrations with row-level security, checks before code, never production, unattended sessions in rounds).

## What changed in the latest session

On 9 November 2026, in [#59](https://github.com/Zugzwang-world/hrizzup/pull/59) (Round 2's closing record), the founder's decisions:

- **The first half is Agreed,** approved by the founder in News Desk's place. Product may now build tables and content for its shapes; for Sourcing, the pipeline still waits for the second half and step 0.8.
- **F1:** the bots keep only found takes in English.
- **F2 and F3** (takedown requests, a lawyer's check before launch) left the open questions: they belong to the founder's legal team, and the plan adds no legal guardrails.
- **For Product only:** the market console, admins, the markets' money rules, the board's sign-in and Round 3's queue.

Also on 9 November, in [#58](https://github.com/Zugzwang-world/hrizzup/pull/58): Product's first design pass was retired, and design starts only from the founder's references and diagrams, in the design chat. Nothing changes for Sourcing.

## Open questions

- **Grok product, plan and route** (step 0.8). Recommendation: xAI's API with its X search tool, called by our own scheduled job; the review found it fits the shapes (its citations give each post's number; its structured output can carry the second half).
- **Bot set-up, schedule and result format** (second half; 1.1). Recommendation: one structured result per run, news and takes together, with no conditional rules (xAI only tries to follow those); every 15 minutes under a spending cap (X search: about $1,450 a month at 100 posts every 15 minutes, before tokens).
- **Whether the terms allow a public app** (0.8). Recommendation: read xAI's API terms first; the shapes follow X's developer rules either way.
- **Vetting.** Recommendation: two independent sources, or one official account; hold a claim a Community Note disputes.
- **Which takes the bots keep,** beyond English. Recommendation: original and quote posts from accounts with a real following.
- **Checking kept posts again.** Recommendation: daily at least, more often while a story is active, from our Mumbai servers.
- **How Sourcing's other choices reach the repository.** Recommendation: like the review, a Claude Code session working from this brief.
- **Background jobs.** Recommendation: Supabase Cron with Supabase Queues, compared with Vercel's workflows before step 1.1 and reviewed by Product; the checks, the pool's housekeeping and, later, the markets' resolvers run there too.
- **Not open:** takedown handling and legal review belong to the founder's legal team (the founder, 9 November 2026).

## What's next

1. **Grok and the route (step 0.8):** choose them; the founder sets them up with Claude Code. Done when a test bot's result arrives by that route.
2. **Design the second half:** the bots' result format with news and takes, the proof of origin (with xAI's API, our own call with our own key), and when alerts fire. Product reviews it.
3. **The news pipeline (step 1.1):** needs both halves and 0.8. Done when stories appear and update on their own on staging, and the takes wait in the pool, each linked to its story.

## Read for detail

- `agreement/README.md`: sign-offs, every field, the lists, the hand-over rules and how the agreement changes; `definitions/` and `examples/` beside it.
- `agreement/reviews/sourcing-first-half.md`: the review in full: its findings, the notes for the pipeline, the founder's answers and its sources.
- `PLAN.md`: sections 2 (News), 4 (the projects, legal), 5 (steps 0.7, 0.8, 1.1), 7 (open questions).
- `docs/status/sourcing.md`: Sourcing's status in full, with each session's own answers.
- `sourcing/README.md`: the folder and its rules.
- `docs/setup/BLUEPRINT.md` sections 5, 8 and 14 (the database, the bots' route, caching); `CLAUDE.md` (the agreement, unattended sessions, database changes).
