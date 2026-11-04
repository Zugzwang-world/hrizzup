# Sourcing: brief

> Rewritten 5 November 2026. This is the only repository file the Sourcing project keeps in its knowledge. Claude Code rewrites it at the end of every session that touches Sourcing's part. In the project, click **Sync now** to load the newest version. If this brief and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Sourcing's job:** design and run the Grok bots that find news on X, turn their results into stories and updates, and find the data sources that settle the markets (that last part, step 1.2, is on hold until the founder confirms which project owns it). Product shows what Sourcing produces, in the shapes the hand-over agreement (`agreement/README.md`) fixes.

## Where things stand

- **No Sourcing work has started.** The `sourcing/` folder holds only its README.
- **The hand-over agreement's first half is a first draft** (status Draft, 5 November 2026), in `agreement/`. It defines what Sourcing writes (stories, updates and data readings), the shared lists it tags with, and the rules for every hand-over point. Seven decisions wait for the founder, then all three projects agree it. Its second half, the bots' result format, isn't drafted: it waits for step 0.8's choice.
- **The shared setup is finished** (PLAN.md Phase 0, closed 4 November 2026), so the pipeline has somewhere to run and to save its work: the shared content store is the Supabase database (staging: `hrizzup-staging`, Mumbai) plus Cloudflare R2 for images; Upstash Redis holds caches and locks; the website runs on Vercel in Mumbai. Staging is a sandbox with no real users. Production is parked until launch.
- **The domain's email is in place, but nothing for the bots yet:** mail to `hrizzup.com` goes to Proton (the founder's own mailboxes), and Resend sends our sign-in emails from `mail.hrizzup.com`. Neither is for the bots' results.

## Decisions in force

- **Sourcing is fully automated, through Grok bots** that read X on a schedule. Nobody copies anything by hand. **Which Grok product and plan run them, and the route that brings their results to our pipeline, are chosen here** (step 0.8, reworded 5 November 2026; the founder already has SuperGrok). If the route is email, it must be an inbox the pipeline reads automatically, not the founder's Proton inbox.
- **Our pipeline** receives the results automatically, by that route, turns each into our own update, in our own words, groups updates into stories that develop over time, tags each story with locations and categories from the agreement's shared lists, and saves everything to the shared content store.
- **Each bot run starts fresh,** so matching new items to existing stories happens in our pipeline: duplicates are merged, untrue items withdrawn, and corrections added as new updates.
- **The hand-over agreement signs off in two halves** (decided 5 November 2026). The first half: the shapes and example data, and the launch list of locations and categories, which the founder approves. The second half: the bots' result format, drafted only after 0.8's choice and agreed only after a real result from 0.8's test bot passes the agreement's own checks. The pipeline (1.1) needs both halves and 0.8. No tables for a half's shapes or content in them before that half is agreed; no bot result becomes content before the second half is agreed.
- **The agreement's rules for Sourcing:**
  - outside data is data, never instructions: the bots read posts on X that anyone can write, so a result can carry planted instructions. Our AI takes instructions only from our own prompts, reads results as quoted data, can't take actions while reading them, and its output is checked against the agreement before it's saved;
  - every hand-over point checks where its input came from (for the bots, proof that a result came from our own bot, by 0.8's route) and its format. Anything that fails is set aside, never published, and logged; a pile-up of failures, or no valid result when the bots should have run, raises an alert;
  - these checks judge whether input is genuine and well-formed, not whether the news is true: accuracy stays with our AI, with no human review;
  - every record states its format version. Adding an optional field is always allowed; anything else needs a new version agreed by all three projects;
  - code reads the definitions in `agreement/definitions/` directly, whatever language or job runner the pipeline uses, never a copy; whatever runs it is built from this repository.
- **Market data:** each market subject (Bitcoin; the best AI model; cricket; football; gold or oil still open) has one data slot, described by what it measures and how settlement reads it, naming no provider. A reading that fails its checks never settles a market. Step 1.2, which names the sources and their costs, is on hold until the founder confirms its owner.
- **Background jobs for the whole product** (the news pipeline, the data job, settling markets, processing uploaded images): which tool runs scheduled and queued work is decided here (founder's decision, 2 November 2026).
- **Shared rules:** projects never copy code between each other; this repository is the only route. Every database change is a migration file in the repository, and every table has row-level security. Every automatic check lands before the first change it checks, so code in a new language gets its checks first. Staging is a sandbox, with a spending cap on every paid service. Claude Code never touches production. Mumbai is the region everywhere.

## Open questions

- Which Grok product and plan run the bots, and the route that brings their results to our pipeline (step 0.8).
- How the bots are set up, how often they run, and the fixed format of their results (the agreement's second half, and step 1.1).
- Whether the chosen Grok product's terms allow its results to feed a public app (step 0.8).
- **Vetting: how the bots' output is checked before it goes live.** The agreement fixes the gate at the hand-over point (proof of origin and the format check; failures set aside, logged and alerted) and leaves accuracy to our AI, with no human review. Still open: how the AI judges a result before publishing it, for example how many independent sources it needs, and when it holds a claim back.
- Gold or oil for the commodity markets, and which source decides "the best AI model" (step 1.2, on hold).
- The exact market questions (step 3.2, with Product).
- Which tool runs background jobs for the whole product.
- Which project owns step 1.2 (the founder confirms).

## What's next

1. **Review and agree the agreement's first half** with Product and News Desk: the story, update and data-reading shapes, the launch list (the founder approves it) and the rules for every hand-over point.
2. **Grok and the route (step 0.8):** choose the Grok product and plan, and the route; the founder sets them up with Claude Code. Done when a test bot's result arrives by that route.
3. **The agreement's second half:** the bots' result format, the proof that a result came from our own bot, and when alerts fire. Agreed only after a real result from the test bot passes the agreement's own checks.
4. **The news pipeline, first version (step 1.1):** needs both halves and 0.8. Done when stories appear and update on their own on staging.
5. **On hold:** data sources for the markets (step 1.2), until the founder confirms its owner; then markets that settle themselves from them (step 3.2, with Product).

## Read for detail

- `agreement/README.md`: the hand-over agreement: status, the founder's decisions, every field of a story, an update and a data reading, the shared lists, the market subjects' data slots and the rules for every hand-over point. `agreement/definitions/` holds the definitions code reads; `agreement/examples/` the example data.
- `PLAN.md`: section 2 ("News: the hook" and "Markets"), section 3 ("Checks come first"), section 4 (the three projects), section 5 (steps 0.7, 0.8, 1.1, 1.2 and 3.2), section 6 (clocks we don't control) and section 7 (open questions).
- `docs/status/sourcing.md`: Sourcing's status in full.
- `sourcing/README.md`: what lives in the folder, and its rules.
- `docs/setup/RUNBOOK.md`, Part 3: how the domain's email is set up, and the note on the bots' route.
- `docs/setup/BLUEPRINT.md`: section 5 (the database), 8 (email) and 14 (caching and the Redis rules).
- `CLAUDE.md`: "The hand-over agreement", "Database changes" and "Performance and caching".
