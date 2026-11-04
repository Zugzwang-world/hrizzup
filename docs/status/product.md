# Product: status

Last updated: 4 November 2026. Plan: [PLAN.md](../../PLAN.md). Brief: [docs/brief/product.md](../brief/product.md). Code: [product/](../../product/).

## Done

- **Setup (PLAN.md Phase 0), finished 4 November 2026.** What exists, where it lives, and what's parked until launch are in the setup close-out at the top of [docs/setup.md](../setup.md); the setup log below it has every detail, day by day. In short:
  - **the repository and how changes land:** a pull request for every change, sized small, normal or risky, with four required checks (Secret check, Quick checks, Database check, Screen check), a preview link that is a complete working copy on staging's data, and auto-merge once the checks pass;
  - **staging, working end to end** at `staging.hrizzup.com`: Vercel in Mumbai; Supabase `hrizzup-staging` for the database and sign-in (Google, plus email codes sent through Resend from `mail.hrizzup.com`); Upstash Redis; Cloudflare R2 storage with image resizing; Turnstile; Doppler for every key;
  - **production as a quiet twin:** `hrizzup.com` shows the holding page; every merge makes a hidden production build; production's storage exists; the release pipeline (`.github/workflows/release.yml`) is built and checked on staging. Production's own services and keys are parked until launch;
  - **the first slice of the codebase (step 1.5):** pnpm workspaces and Turborepo; the Next.js website (holding page, draft privacy and terms, `/api/health`, a sign-in test page that exists only off production); an empty Expo app; shared packages; the first migration, which locks every table;
  - **the rules and records:** CLAUDE.md, the blueprint, the runbook, the setup log, the status files, and the three thinking-project briefs in `docs/brief/`, rewritten at the end of every session (a daily routine to catch a missed one is ready in `infra/claude/`, off by the founder's decision);
  - **Claude Code's own access:** Doppler service tokens that can't open production; no personal login of the founder's is left on this Mac.
- **Decided 2 and 3 November 2026** (now in PLAN.md and the blueprint): how the app is built (Expo and Next.js in one codebase, one typed API, Supabase Realtime, database search, links that open the app, Playwright and Maestro); images through R2 and Cloudflare, creator video through Cloudflare Stream; Supabase Auth with Google first; the paid tier in version one; the performance, caching and screen-size rules; production off-limits to Claude Code.

## Next

1. **Hand-over agreement (step 0.7):** Product drafts what a story, an update, a creation and a market look like when they pass between projects, including the Grok bots' result format; all three projects agree it. No project writes content before this is done.
2. **Design (step 1.4):** references, then the design system (shadcn/ui, Claude Design), then the core screens (board, story page, feed, app frame, market page).
3. **The rest of step 1.5:** the one typed API; the empty app running on an Android phone; the performance-budget check on every pull request (Lighthouse and download size against each preview, blueprint section 14).
4. **Accounts and login (step 1.6):** email codes on the website (with the Turnstile widget), then Apple; the app's native sign-in with the app builds.
5. **Market engine (step 1.7),** then Phases 2 and 3 in the order in PLAN.md section 5.

## Open questions

- Feed design in depth (step 2.3).
- What are the exact market questions? (step 3.2, with Sourcing)
- Paid tier: what's free and what's paid? Decided before the paywall is built (step 2.7).
- Comment threads: in or out?
- **How the app shows the bot check on its email-code screen** (step 1.6): Turnstile is on in Supabase Auth, so the app needs the widget too, usually inside a small web view.
- **Blocking password sign-in** (step 1.6): Supabase can't switch passwords off while email codes are on. The plan is a small database function (Supabase's password hook) that refuses every password sign-in; check whether it needs a plan above Pro before building it. Strict password rules are on until then.

Parked until launch: the runbook's [pre-launch checklist](../setup/RUNBOOK.md#pre-launch-checklist).
