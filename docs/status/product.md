# Product: status

Last updated: 2 November 2026. Plan: [PLAN.md](../../PLAN.md). Code: [product/](../../product/).

## Done

- **Repository foundation, first part (step 0.6), 2 November 2026:** PLAN.md, the setup blueprint and runbook, the setup log, the three parts with their READMEs, these status files, CLAUDE.md, the proprietary LICENSE, THIRD_PARTY_NOTICES.md, the .gitignore, and the plugins and connectors.

## Next

1. **Finish the repository foundation (step 0.6):** checks sized to the change (small, normal, risky) running on every pull request, preview links, and the daily summary routine. Needs staging (0.3). Done when a trivial change passes its checks and gets a preview link.
2. **Draft the hand-over agreement (step 0.7):** what a story, an update, a creation and a market look like when they pass between projects, including the Grok bots' result format. All three projects agree it. No project writes content before this is done.
3. **Design (step 1.4):** can start now. References (Mobbin and the founder's own), then the design system (shadcn/ui, Claude Design), then the core screens: board, story page, feed, app frame and market page.
4. **One codebase for the app and the website (step 1.5):** decide how they share code, and get a first empty app running on an Android phone. Needs 0.6.
5. **Accounts and login (step 1.6):** Google first. Needs 0.6.
6. **Market engine (step 1.7):** copy Manifold's engine with its tests. On 2 November 2026 GitHub reported Manifold's licence as MIT; confirm it again at the moment of copying and record the notice in THIRD_PARTY_NOTICES.md. Needs 0.6.
7. **Then** the news app (Phase 2) and the markets website (Phase 3), in the order in PLAN.md section 5.

## Open questions

- How do the app and the website share one codebase? (step 1.5) This also settles the frameworks and the package manager.
- Apple and email sign-in details (step 1.6). These must be settled before the iPhone build.
- Feed design in depth (step 2.3).
- What are the exact market questions? (step 3.2, with Sourcing)
- Paid tier: freemium or paywall?
- Comment threads: in or out?
- **For the founder, GitHub plan (runbook step 1.5):** the organisation is on GitHub Free, so this private repository has no branch protection, secret scanning or push protection until the organisation moves to GitHub Team with the Secret Protection add-on.
