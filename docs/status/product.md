# Product: status

Last updated: 2 November 2026. Plan: [PLAN.md](../../PLAN.md). Code: [product/](../../product/).

## Done

- **Repository foundation, first part (step 0.6), 2 November 2026:** PLAN.md, the setup blueprint and runbook, the setup log, the three parts with their READMEs, these status files, CLAUDE.md, the proprietary LICENSE, THIRD_PARTY_NOTICES.md, the .gitignore, and the plugins and connectors.
- **Runbook step 1.6, 2 November 2026:** GitHub stays on the free plan. Dependabot alerts and security updates are on (confirmed through GitHub's API). The gitleaks secret scanner runs before every commit (a git hook that Claude Code switches on each session) and in CI (the "Secret scan" workflow, the repo's first automatic check). The runbook and blueprint were updated to match, and every runbook Part now opens with "What we're doing" and "Why".
- **Screen-size rule, 2 November 2026:** every screen fits every device. Written into CLAUDE.md and the runbook: flexible layouts, phone-first, an automatic browser check at 13 widths (320 to 2560 pixels) plus sideways phones and tablets in Chrome's and Safari's engines, and screenshots at 360, 768, 1440 and 1920 pixels.

## Next

1. **Finish the repository foundation (step 0.6):** checks sized to the change (small, normal, risky) running on every pull request, next to the secret scan that already runs, plus the automatic screen check (CLAUDE.md, "Screens fit every device"), preview links and the daily summary routine. Needs staging (0.3). Done when a trivial change passes its checks and gets a preview link.
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
- **For the founder, runbook step 1.1:** the organisation still doesn't require two-factor login (checked 2 November 2026). Part 1 is finished once it does.
- **Pull requests without branch protection:** CLAUDE.md says changes go through a pull request "once `main` is protected", but a private repo on GitHub's free plan can never be protected, so today changes are pushed straight to `main`. Recommendation: once the checks sized to the change exist (step 0.6), send every change through a pull request anyway, so Claude merges only when its checks pass, as PLAN.md section 3 describes. GitHub won't enforce it; Claude Code would follow it as a rule.
