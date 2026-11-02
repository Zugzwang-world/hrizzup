# Sourcing: status

Last updated: 2 November 2026. Plan: [PLAN.md](../../PLAN.md). Code: [sourcing/](../../sourcing/).

## Done

- The `sourcing/` folder exists, with a README saying what lives there (2 November 2026). No sourcing work has started yet.

## Next

1. **Hand-over agreement (step 0.7):** agree with Product (who drafts it) and News Desk exactly what a story and an update look like, including the fixed format the Grok bots use for their results. Needs 0.6. No project writes content before this is done.
2. **Grok subscription and the bots' inbox (step 0.8, founder with AI):** SuperGrok, plus a dedicated inbox on our domain that receives the bots' results. It must be an address our pipeline can read automatically, not the founder's Proton inbox. Needs the domain (0.2). Done when a test bot's result lands in the inbox.
3. **Data sources for the markets (step 1.2):** can start now. Prices (Bitcoin, gold or oil), scores (cricket, football) and an AI model ranking, each with its cost. Done when every market subject has a named source.
4. **News pipeline, first version (step 1.1):** the bots read X on a schedule and send results in the agreed format; the pipeline reads the inbox, writes updates, groups them into stories with timelines, tags location and category, and saves them to the content store. Needs 0.7 and 0.8. Done when stories appear and update on their own on staging.
5. **Later:** markets that run continuously and settle themselves from the data sources (step 3.2, with Product).

## Open questions

- How are the Grok bots set up, how often do they run, and what is the fixed format of their results? (steps 0.7 and 1.1) Each run starts fresh, so matching new items to existing stories happens in our pipeline.
- Do Grok's subscription terms allow its results to feed a public app? (step 0.8)
- Gold or oil for the commodity markets? (step 1.2)
- Which source decides "the best AI model"? (step 1.2)
- What are the exact market questions? (step 3.2, with Product)
- **Background jobs, for the whole product:** which tool runs scheduled and queued work (the news pipeline, settling markets, processing uploaded images)? The founder put this decision with Sourcing on 2 November 2026 (PLAN.md, "Decided later").
