# Product: status

Last updated: 5 November 2026. Plan: [PLAN.md](../../PLAN.md). Brief: [docs/brief/product.md](../brief/product.md). Code: [product/](../../product/). Hand-over agreement: [agreement/README.md](../../agreement/README.md).

## Done

- **Setup (PLAN.md Phase 0), finished 4 November 2026.** What exists, where it lives, and what's parked until launch are in the setup close-out at the top of [docs/setup.md](../setup.md); the setup log below it has every detail, day by day. In short:
  - **the repository and how changes land:** a pull request for every change, sized small, normal or risky, with four required checks (Secret check, Quick checks, Database check, Screen check), a preview link that is a complete working copy on staging's data, and auto-merge once the checks pass;
  - **staging, working end to end** at `staging.hrizzup.com`: Vercel in Mumbai; Supabase `hrizzup-staging` for the database and sign-in (Google, plus email codes sent through Resend from `mail.hrizzup.com`); Upstash Redis; Cloudflare R2 storage with image resizing; Turnstile; Doppler for every key;
  - **production as a quiet twin:** `hrizzup.com` shows the holding page; every merge makes a hidden production build; production's storage exists; the release pipeline (`.github/workflows/release.yml`) is built and checked on staging. Production's own services and keys are parked until launch;
  - **the first slice of the codebase (step 1.5):** pnpm workspaces and Turborepo; the Next.js website (holding page, draft privacy and terms, `/api/health`, a sign-in test page that exists only off production); an empty Expo app; shared packages; the first migration, which locks every table;
  - **the rules and records:** CLAUDE.md, the blueprint, the runbook, the setup log, the status files, and the three thinking-project briefs in `docs/brief/`, rewritten at the end of every session (a daily routine to catch a missed one is ready in `infra/claude/`, off by the founder's decision);
  - **Claude Code's own access:** Doppler service tokens that can't open production; no personal login of the founder's is left on this Mac.
- **Decided 2 and 3 November 2026** (now in PLAN.md and the blueprint): how the app is built (Expo and Next.js in one codebase, one typed API, Supabase Realtime, database search, links that open the app, Playwright and Maestro); images through R2 and Cloudflare, creator video through Cloudflare Stream; Supabase Auth with Google first; the paid tier in version one; the performance, caching and screen-size rules; production off-limits to Claude Code.
- **Plan changes, approved by the founder on 5 November 2026** ([#25](https://github.com/Zugzwang-world/hrizzup/pull/25)):
  - **checks come first:** every automatic check lands before the first change it checks, and covers everything already built when it lands. Step 1.5 now also adds the core-journey tests (Playwright; Maestro at phone and tablet sizes) next to the performance-budget check, before any page or screen is built in code; 1.6 and every Phase 2 and 3 step that builds screens need 1.5;
  - **step 0.7 signs off in two halves,** each Draft until Agreed;
  - **Product builds against the agreement, not the other projects' output:** 1.4's core screens, 2.1 to 2.4 and 1.7 need the agreement's first half instead of 1.1 or 1.3; the Android closed test (2.6) needs real news and our own content (1.1, 1.3);
  - GitHub's milestones for Phases 1 to 3 follow.
- **The hand-over agreement's first half, first draft (step 0.7, status Draft), 5 November 2026:** [agreement/](../../agreement/README.md) holds the plain-language agreement; one definition of each shape (story, update, creation, market and data reading) in JSON Schema; the shared lists (locations, categories, and market subjects with their data slots); example data with the hard cases (long titles, a story with many updates, a missing image, a merged story, a withdrawn update, a correction, a planted instruction); and a check inside Quick checks. TypeScript uses it through `@hrizzup/agreement` (`validate()`); the same files were checked with Python's own validator too. No tables exist for its shapes, and nothing is loaded.
- **Hidden characters refused by Unicode category** (after the automatic security review, 5 November 2026): the patterns cover every invisible and private-use character in Unicode's main range, and `validate()` refuses the rest: every default-ignorable character, assigned yet or not, and every format, private-use or broken-surrogate character, with stacked selectors and stray joiners; ordinary emoji still pass.
- **The founder approved the agreement's seven decisions, 5 November 2026,** each as recommended, so the draft didn't change: the launch list (Global; India; Mumbai, Delhi NCR and Bengaluru; crypto, finance, business, AI, sports, politics, entertainment and general); up to three locations and three categories per story, the first its main one, shown on its card; a city's story shows under India only when it's tagged India too; a story card's picture is the story's newest image or video by Hrizzup or a creator, otherwise a design in the category's own look; a user's post needs no story or category; market prices in US dollars, with rupees shown alongside if wanted. Sign-offs now go into the agreement's status table the day they arrive (CLAUDE.md).
- **The founder's sign-off rule for the first half, 5 November 2026:** it stays Draft, and is signed off only after Sourcing and News Desk have each reviewed and agreed it. Product drafted it, so it makes the changes they ask for rather than reviewing its own draft.

## Next

1. **Sign off the agreement's first half:** Sourcing and News Desk each review it ([agreement/README.md](../../agreement/README.md)) and agree it or ask for changes, which Product makes; a change to one of the founder's decisions goes back to the founder. It becomes Agreed only in a change the founder asks for.
2. **Design (step 1.4):** references and the design system (shadcn/ui, Claude Design) can start now; the core screens (board, story page, feed, app frame, market page) are drawn from the agreement's shapes and example data, so they need its first half.
3. **The rest of step 1.5, before any page or screen is built in code:** the performance-budget check (Lighthouse and download size against each preview; the app's code size and performance tests) and the core-journey tests (Playwright for the website; Maestro for the app, at phone and tablet sizes), covering today's pages and Google sign-in when they land; then the one typed API and the empty app running on an Android phone.
4. **Accounts and login (step 1.6, needs 1.5):** email codes on the website (with the Turnstile widget), then Apple; the app's native sign-in with the app builds.
5. **Market engine (step 1.7, needs the agreement's first half),** then Phases 2 and 3 in the order in PLAN.md section 5.

## Open questions

- Feed design in depth (step 2.3).
- What are the exact market questions? (step 3.2, with step 1.2's owner)
- How Manifold's own records for markets map onto the agreement's market shape, once the engine is copied (step 1.7).
- Paid tier: what's free and what's paid? Decided before the paywall is built (step 2.7).
- Comment threads: in or out?
- **How the app shows the bot check on its email-code screen** (step 1.6): Turnstile is on in Supabase Auth, so the app needs the widget too, usually inside a small web view.
- **Blocking password sign-in** (step 1.6): Supabase can't switch passwords off while email codes are on. The plan is a small database function (Supabase's password hook) that refuses every password sign-in; check whether it needs a plan above Pro before building it. Strict password rules are on until then.

Parked until launch: the runbook's [pre-launch checklist](../setup/RUNBOOK.md#pre-launch-checklist).
