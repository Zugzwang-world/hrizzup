# Sourcing: status

Last updated: 5 November 2026. Plan: [PLAN.md](../../PLAN.md). Brief: [docs/brief/sourcing.md](../brief/sourcing.md). Code: [sourcing/](../../sourcing/). Hand-over agreement: [agreement/README.md](../../agreement/README.md).

## Done

- The `sourcing/` folder exists, with a README saying what lives there (2 November 2026). No Sourcing work has started yet.
- The shared setup it builds on is finished (PLAN.md Phase 0, 4 November 2026): the content store on staging (the Supabase database and Cloudflare R2 storage), Redis, hosting in Mumbai, and the domain's email. See the setup close-out at the top of [docs/setup.md](../setup.md).
- **Plan changes, approved by the founder on 5 November 2026** ([#25](https://github.com/Zugzwang-world/hrizzup/pull/25)): step 0.8 no longer fixes the Grok plan or the route, so the Sourcing project chooses the Grok product and plan, and the route that brings the bots' results to the pipeline; step 1.1 receives them by that route; step 0.7 signs off in two halves, and 1.1 needs both; step 1.2 (data sources for the markets) is on hold until the founder confirms which project owns it.
- **The hand-over agreement's first half, first draft (status Draft), 5 November 2026** ([agreement/](../../agreement/README.md)): the shapes Sourcing writes (stories, updates and data readings); the shared lists it tags with (locations and categories, with the launch list proposed for the founder's approval; market subjects, each with a data slot that names no provider); example data; and the rules for every hand-over point (outside data is data, never instructions; proof of origin and a format check wherever input arrives; failures set aside, never published, and logged; alerts when failures pile up or no valid result arrives). Its second half, the bots' result format, waits for step 0.8's choice.

## Next

1. **Review and agree the agreement's first half** with Product and News Desk: above all the story, update and data-reading shapes, the launch list (the founder approves it) and the hand-over rules.
2. **Grok and the route (step 0.8):** choose the Grok product and plan that run the bots, and the route that brings their results to our pipeline; the founder sets them up, with Claude Code. Done when a test bot's result arrives by that route.
3. **The agreement's second half:** the bots' result format, the proof that a result came from our own bot by that route, and when alerts fire. Drafted after 0.8's choice; agreed only after a real result from the test bot passes the agreement's own checks.
4. **News pipeline, first version (step 1.1):** the bots read X on a schedule and send results in the agreed format; the pipeline receives them automatically, by 0.8's route, writes updates, groups them into stories with timelines, tags locations and categories, and saves them to the content store. Needs both halves and 0.8. Done when stories appear and update on their own on staging.
5. **On hold:** data sources for the markets (step 1.2), until the founder confirms its owner; then markets that run and settle themselves from them (step 3.2, with Product).

## Open questions

- Which Grok product and plan run the bots, and the route their results take to our pipeline? (step 0.8)
- How are the bots set up, how often do they run, and what is the fixed format of their results? (the agreement's second half, and step 1.1) Each run starts fresh, so matching new items to existing stories happens in our pipeline.
- Do the chosen Grok product's terms allow its results to feed a public app? (step 0.8)
- **Vetting: how is the bots' output checked before it goes live?** The agreement fixes the gate at the hand-over point (proof of origin and the format check; failures set aside, logged and alerted; our AI reads results as data and writes every update in our own words, and can correct, withdraw or merge) and leaves accuracy to our AI, with no human review. Still open: how the AI judges a result before it's published, for example how many independent sources it needs, and when it holds a claim back.
- Gold or oil for the commodity markets, and which source decides "the best AI model"? (step 1.2, on hold)
- What are the exact market questions? (step 3.2, with Product)
- **Background jobs, for the whole product:** which tool runs scheduled and queued work (the news pipeline, the data job, settling markets, processing uploaded images)? The founder put this decision with Sourcing on 2 November 2026 (PLAN.md, "Decided later"). Whatever it is, it's built from this repository, so it reads the agreement's definitions directly.
