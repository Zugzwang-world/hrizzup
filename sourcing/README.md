# Sourcing

**Its job:** design and run the Grok bots that find news and creators' takes on X, keep everything they find in the sourced pool, and turn the news into stories and updates.

**What it produces:** stories, updates and the sourced pool.

## What lives here

- **The Grok bots:** their instructions, and the fixed format of their results, which Sourcing designs as the hand-over agreement's second half and Product reviews (PLAN.md step 0.7).
- **The news pipeline:** it receives the bots' results automatically, by the route chosen in step 0.8, checks them, and keeps what passes in the sourced pool: news, and creators' takes on stories (memes, videos, explainers). It turns the news into our own updates, groups updates into stories that develop over time (each with a timeline), tags every story with locations and categories, and saves everything to the shared content store's tables (steps 1.1 and 1.9), through which Product receives what it shows.

## Rules

- **No xAI API** (the founder's decision, 9 November 2026): Grok bots source everything, and Sourcing's work runs asynchronously, in the Sourcing project, on its own schedule.
- What passes to News Desk and Product is defined by the hand-over agreement, [agreement/README.md](../agreement/README.md): stories, updates and sourced items, and (in its second half) the bots' result format. No content is written before its half is agreed.
- Found posts are never copied: the pool keeps a link to each post, who posted it and a summary in our own words.
- Code reads the agreement's definitions in `agreement/definitions/` directly, whatever language or job runner the pipeline uses: never a copy. Whatever runs it is built from this repository.
- Projects never copy code between each other; this shared repository is the only route.
- Frameworks and dependencies aren't chosen yet.

Status: [docs/status/sourcing.md](../docs/status/sourcing.md). Brief: [docs/brief/sourcing.md](../docs/brief/sourcing.md). Plan: [PLAN.md](../PLAN.md), section 4.
