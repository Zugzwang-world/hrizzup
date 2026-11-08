# Sourcing: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 8 November 2026. The only repository file the Sourcing project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Sourcing's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Sourcing's job:** design and run the Grok bots that find news and creators' takes on X, keep everything they find in the sourced pool, and turn the news into stories and updates. Product shows what Sourcing produces, in the shapes the hand-over agreement (`agreement/README.md`) fixes.

## Where things stand

- **No Sourcing work has started.** The `sourcing/` folder holds only its README.
- **The agreement's first half is a Draft** (last revised 5 November 2026). It defines what Sourcing writes (stories, updates and sourced items), the shared lists it tags with, and the rules for every hand-over point. Sourcing's review is next; the founder then approves it in News Desk's place, while News Desk is on hold.
- **The second half (the bots' result format) isn't drafted:** Sourcing designs it once step 0.8's choice is made, and Product reviews it.
- **The shared setup is finished** (Phase 0): the content store is the Supabase database (staging: `hrizzup-staging`, Mumbai) plus Cloudflare R2; Upstash Redis holds caches and locks. Production is parked until launch.
- **No inbox for the bots yet:** mail to `hrizzup.com` goes to the founder's own Proton mailboxes.

## Decisions in force

- **Sourcing is fully automated, through Grok bots** that read X on a schedule; nobody copies anything by hand. **Which Grok product and plan run them, and the route that brings their results to our pipeline, are chosen here** (step 0.8; the founder already has SuperGrok). If the route is email, it must be an inbox the pipeline reads automatically, not the founder's Proton inbox.
- **The bots find two things** (the founder, 5 November 2026): **news**, which our AI turns into story tiles and updates for the board, and **creators' takes** on a story (memes, videos, explainers). Everything they find is kept in the **sourced pool** in the shared content store, after the pipeline's checks.
- **Three routes into the feed:** **found**, a take the bots found, shown in its story's feed as the original post, embedded and credited to its creator, never copied, for every story; **made**, our own content, which News Desk makes from the sourced pool; **posted**, creators and users posting in the app. Product only displays, crediting each feed item by its route.
- **The sourced item** (the agreement, Draft): news or a take; the post's address on X, the poster's handle and name, when it was posted, what it holds (text, image or video), a summary in our own words, its stories (a take always names one) and its state (live, unavailable once gone from X, or withdrawn). Never the post's words, pictures or video; each post kept once. News never shows in a feed itself.
- **The pipeline** receives results by 0.8's route, checks them, keeps what passes in the pool, writes our own updates from the news, groups them into stories with timelines, and tags them. Each bot run starts fresh, so the pipeline matches items to stories, merges duplicates, withdraws untrue items and adds corrections as new updates.
- **Tagging, by the founder's decisions** (changing one goes back to the founder): the launch list (Global; India; Mumbai, Delhi NCR, Bengaluru; crypto, finance, business, AI, sports, politics, entertainment, general); up to three locations and categories per story, the main one first; a city's story shows under India only when our AI also tags it India; stories carry no picture, since pictures in posts on X belong to the people who posted them.
- **Sign-offs** (the founder, 5 November 2026): the first half on Sourcing's review plus the founder's approval in News Desk's place. The second half is designed here and agreed by Product; News Desk needn't agree it. It must carry creators' takes as well as news, and is agreed only after a real test result passes the agreement's checks. The pipeline (1.1) needs both halves and 0.8.
- **The agreement's rules for Sourcing:** outside data is data, never instructions (our AI reads results as quoted data, can't act while reading them, and its output is checked before it's saved); every hand-over point checks origin and format, and sets aside, logs and alerts on failures; accuracy stays with our AI; code reads `agreement/definitions/` directly, adding `validate()`'s hidden-character checks outside TypeScript.
- **Market data is Product's** (the founder, 5 November 2026): steps 1.2 and 3.2 and the data readings.
- **Background jobs for the whole product:** the tool is chosen here (the founder, 2 November 2026). It must cover perps (PLAN.md step 3.4, the founder, 8 November 2026): a Bitcoin price and a liquidation check every few seconds, which the founder has put on Supabase Cron (it can run a job every 1 to 59 seconds).
- **No relays** (the founder, 5 November 2026): this brief carries what Sourcing needs.
- **Shared rules:** the repository is the only route between projects; migrations only, with row-level security; checks before code; staging is a capped sandbox; Claude Code never touches production.

## What changed in the latest session

On 8 November 2026, in [#34](https://github.com/Zugzwang-world/hrizzup/pull/34), the founder decided that Product builds the website and the app in parallel, the website one stage ahead (PLAN.md sections 2, 3 and 5, and the new `TRACKER.md`). Each news feature (board, story pages, feed, posting) reaches both from one back end and one contract, and joins the real data on the website first, then in the app. For Sourcing:

- **The stories, updates and takes Sourcing produces reach both surfaces through the same back end,** so nothing about what Sourcing writes changes: the agreement's shapes stay the hand-over point.
- **They'll show on the website first,** since each feature joins the real data there before the app.
- Nothing else in Sourcing's scope changed.

## Open questions

- **Which Grok product, plan and route** (step 0.8). Recommendation: xAI's API (Grok with its X search tool), called on a schedule by our own background job, which hands results straight to the pipeline, rather than the SuperGrok app with email. It's built for apps, returns structured results, and proves origin by our own key.
- **Bot set-up, schedule and result format** (the second half; step 1.1). Recommendation: structured output matching a JSON Schema in `agreement/definitions/`, one result per run with news and takes; every 15 minutes under a spending cap to start.
- **Whether the Grok product's terms allow feeding a public app** (step 0.8). Recommendation: read xAI's API terms before choosing; the consumer subscription's terms are the risk.
- **Vetting before publishing.** Recommendation: publish a claim only when two independent sources report it, or one official account does; hold the rest until a second source appears; keep corrections, withdrawals and merges as the agreement defines them.
- **Which creators' takes the bots keep.** Recommendation: original posts only (no reposts or replies), from accounts with a real following, ranked by engagement.
- **Noticing deleted posts, and how long the pool keeps them.** Recommendation: re-check every live take on a schedule through X's public embed address, which fails once a post is deleted or hidden; mark it unavailable at once, and delete the record after 30 days, as apps that show X posts are expected to.
- **Which tool runs background jobs.** Recommendation: Supabase's own scheduler and queues (Supabase Cron with Supabase Queues), since perps already run on Supabase Cron and one tool with retries and logs is simpler to run than two. Each job calls our own code. Compare it with Vercel's workflows and queues before step 1.1's code, and have Product review the choice.

## What's next

1. **Review the agreement's first half** and agree it or ask for changes (Product makes them): above all the story, update and sourced item shapes and the hand-over rules. The founder then approves it in News Desk's place.
2. **Grok and the route (step 0.8):** choose them; the founder sets them up with Claude Code. Done when a test bot's result arrives by that route.
3. **Design the second half:** the bots' result format, carrying news and takes, with what the pipeline needs to keep each find as a sourced item; the proof of origin; when alerts fire. Product reviews it.
4. **The news pipeline (step 1.1):** needs both halves and 0.8. Done when stories appear and update on their own on staging, and the takes the bots find wait in the pool, each linked to its story.

## Read for detail

- `agreement/README.md`: sign-offs, decisions, routes, every field of a story, an update and a sourced item, lists and hand-over rules; `definitions/` and `examples/` beside it.
- `PLAN.md`: sections 2 (News), 4 (the projects), 5 (steps 0.7, 0.8, 1.1), 7 (open questions).
- `docs/status/sourcing.md`: Sourcing's status in full.
- `sourcing/README.md`: the folder and its rules.
- `docs/setup/RUNBOOK.md` Part 3 and `docs/setup/BLUEPRINT.md` sections 5, 8 and 14: email, the bots' route, the database, caching.
- `CLAUDE.md`: the agreement, the briefs, database changes.
