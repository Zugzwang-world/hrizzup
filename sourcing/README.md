# Sourcing

**Its job:** design and run the Grok bots that find news on X, turn their results into stories and updates, and find data sources for the markets.

**What it produces:** stories, updates and market data sources.

## What lives here

- **The Grok bots:** their instructions, and the fixed format of their results, as set in the hand-over agreement (PLAN.md step 0.7).
- **The news pipeline:** it reads the bots' inbox automatically, turns each result into our own update, groups updates into stories that develop over time (each with a timeline), tags every story with a location and a category, and saves everything to the shared content store (step 1.1).
- **Market data sources:** prices (Bitcoin, gold or oil), scores (cricket, football) and an AI model ranking, used to settle the markets (steps 1.2 and 3.2).

## Rules

- What passes to News Desk and Product is defined by the hand-over agreement. No content is written before it is agreed.
- Projects never copy code between each other; this shared repository is the only route.
- Frameworks and dependencies aren't chosen yet.

Status: [docs/status/sourcing.md](../docs/status/sourcing.md). Brief: [docs/brief/sourcing.md](../docs/brief/sourcing.md). Plan: [PLAN.md](../PLAN.md), section 4.
