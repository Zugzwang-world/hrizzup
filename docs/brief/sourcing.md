# Sourcing: brief

> Rewritten 4 November 2026. This is the only repository file the Sourcing project keeps in its knowledge. Claude Code rewrites it at the end of every session that touches Sourcing's part. In the project, click **Sync now** to load the newest version. If this brief and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Sourcing's job:** design and run the Grok bots that find news on X, turn their results into stories and updates, and find the data sources that settle the markets. Product shows what Sourcing produces, in the format the hand-over agreement fixes.

## Where things stand

- **No Sourcing work has started.** The `sourcing/` folder holds only its README.
- **The shared setup is finished** (PLAN.md Phase 0, closed 4 November 2026), so the pipeline has somewhere to run and to save its work: the shared content store is the Supabase database (staging: `hrizzup-staging`, Mumbai) plus Cloudflare R2 for images; Upstash Redis holds caches and locks; the website runs on Vercel in Mumbai. Staging is a sandbox with no real users. Production is parked until launch.
- **The domain's email is in place, but not the bots' inbox:** mail to `hrizzup.com` goes to Proton (the founder's own mailboxes), and Resend sends our sign-in emails from `mail.hrizzup.com`. Neither is the inbox for the bots' results; that inbox is designed here.

## Decisions in force

- **Sourcing is fully automated, through Grok bots:** automations on a Grok subscription (SuperGrok), not an X or xAI API, that read X on a schedule and send their results by email to a dedicated inbox on our domain. Nobody copies anything by hand.
- **The bots' inbox must be one our pipeline reads automatically,** not the founder's Proton inbox.
- **Our pipeline** reads that inbox, turns each result into our own update, groups updates into stories that develop over time (each with a timeline), tags every story with a location (global; national, meaning India; local, meaning Indian cities) and a general category (crypto, finance, business, AI, sports and more), and saves everything to the shared content store.
- **Each bot run starts fresh,** so matching new items to existing stories happens in our pipeline.
- **Market data sources:** prices (Bitcoin, gold or oil), scores (cricket and football, with live scores) and an AI model ranking, each with its cost. The markets run continuously and settle themselves from this data (step 3.2, with Product).
- **Background jobs for the whole product** (the news pipeline, settling markets, processing uploaded images): which tool runs scheduled and queued work is decided here, in the Sourcing project (founder's decision, 2 November 2026).
- **The hand-over agreement comes first:** exactly what a story and an update look like, including the bots' fixed result format. No project writes content before it is agreed.
- **Shared rules:** projects never copy code between each other; this repository is the only route. Every database change is a migration file in the repository, and every table has row-level security. Staging is a sandbox, with a spending cap on every paid service; paid services such as data feeds are opened early, each with its own cap. Claude Code never touches production. Mumbai is the region everywhere.

## Open questions

- How the Grok bots are set up, how often they run, and the fixed format of their results (steps 0.7 and 1.1).
- Whether Grok's subscription terms allow its results to feed a public app (step 0.8).
- Where the bots' inbox lives, and how the pipeline reads it.
- Gold or oil for the commodity markets (step 1.2).
- Which source decides "the best AI model" (step 1.2).
- The exact market questions (step 3.2, with Product).
- Which tool runs background jobs (scheduled and queued work) for the whole product.

## What's next

1. **The hand-over agreement (step 0.7):** with Product, who drafts it, and News Desk: what a story and an update look like, and the bots' result format.
2. **The Grok subscription and the bots' inbox (step 0.8, the founder with Claude Code):** done when a test bot's result lands in the inbox.
3. **Data sources for the markets (step 1.2):** can start now. Done when every market subject has a named source, with its cost.
4. **The news pipeline, first version (step 1.1):** done when stories appear and update on their own on staging. Needs steps 0.7 and 0.8.
5. **Later:** markets that settle themselves from the data sources (step 3.2, with Product).

## Read for detail

- `PLAN.md`: section 2 ("News: the hook" and "Markets"), section 4 (the three projects), section 5 (steps 0.7, 0.8, 1.1, 1.2 and 3.2), section 6 (clocks we don't control) and section 7 (open questions).
- `docs/status/sourcing.md`: Sourcing's status in full.
- `sourcing/README.md`: what lives in the folder, and its rules.
- `docs/setup/RUNBOOK.md`, Part 3: how the domain's email is set up, and the note on the bots' inbox.
- `docs/setup/BLUEPRINT.md`: section 5 (the database), 8 (email) and 14 (caching and the Redis rules).
- `CLAUDE.md`: "Database changes" and "Performance and caching".
