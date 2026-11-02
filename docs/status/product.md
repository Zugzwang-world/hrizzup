# Product: status

Last updated: 2 November 2026. Plan: [PLAN.md](../../PLAN.md). Code: [product/](../../product/).

## Done

- **Repository foundation, first part (step 0.6), 2 November 2026:** PLAN.md, the setup blueprint and runbook, the setup log, the three parts with their READMEs, these status files, CLAUDE.md, the proprietary LICENSE, THIRD_PARTY_NOTICES.md, the .gitignore, and the plugins and connectors.
- **Runbook step 1.6, 2 November 2026:** GitHub stays on the free plan. Dependabot alerts and security updates are on (confirmed through GitHub's API). A gitleaks secret check was added before every commit and in CI, then removed the same day so staging stays free-flowing (see below). The runbook and blueprint were updated to match, and every runbook Part now opens with "What we're doing" and "Why".
- **Repository moved, 2 November 2026:** now at [github.com/Zugzwang-world/hrizzup](https://github.com/Zugzwang-world/hrizzup), private, in the founder's personal account on GitHub Pro. Dependabot carried over; this folder pushes to the new address; PLAN.md, CLAUDE.md, the blueprint and the runbook all say where the repo lives.
- **Screen-size rule, 2 November 2026:** every screen fits every device. Written into CLAUDE.md and the runbook: flexible layouts, phone-first, an automatic browser check at 13 widths (320 to 2560 pixels) plus sideways phones and tablets in Chrome's and Safari's engines, phone widths again with the text size at 200%, and screenshots at 360, 768, 1440 and 1920 pixels.
- **Staging stays free-flowing, 2 November 2026:** the secret check before every commit, its CI workflow and the session-start setting that switched it on were removed, and changes went straight to `main`. Replaced later the same day by pull requests for every change (below).
- **How changes land, 2 November 2026 (runbook 1.7):** every change goes on its own branch and pull request, which Claude Code opens and merges itself (auto-merge) as soon as the checks pass, with no human approval. A gitleaks secret check runs on every pull request over the whole history; it was also run once by hand (no leaks). The ruleset "main" requires the check to pass, blocks force-pushes and deletion, requires no reviews, and allows squash merges only. Branches are deleted after merging. All confirmed through GitHub's API.
- **Production twin plan, 2 November 2026:** production runs on Vercel plus Supabase, set up exactly like staging with its own data and keys; AWS only later, if a concrete need appears, as its own project. Releasing promotes the hidden production build of a commit that passed staging with one command (`vercel promote`), with no rebuild. The new runbook Part 10, "Production twin", and "Releasing to production" document it. The hand-over is now Part 11. "Production hardening" holds only the founder-only production keys.
- **Runbook Part 1 finished, 2 November 2026:** step 1.1 is done (the founder uses two-step login on GitHub).
- **Helpers invited, 2 November 2026:** `Titan00714`, `Anupamhodl` and `Zoro47007` were invited as collaborators who can make changes. Each must accept within 7 days.

## Next

1. **Finish the repository foundation (step 0.6):** checks sized to the change (small, normal, risky) running on every pull request next to the secret check, each added to the ruleset "main" as a required check once it exists, plus the automatic screen check (CLAUDE.md, "Screens fit every device"), preview links and the daily summary routine. Needs staging (0.3). Done when a trivial change passes its checks and gets a preview link.
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
- **Helpers' invitations:** sent 2 November 2026 and still waiting to be accepted (checked again the same evening). GitHub cancels them after 7 days; Claude Code can resend them.
- **Staging following `main` (runbook 9.2):** confirm whether Vercel lets the `staging` environment track `main` while `main` is the production branch; if not, add a small deploy workflow that sends every merge to staging.
