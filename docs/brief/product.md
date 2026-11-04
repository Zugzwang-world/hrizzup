# Product: brief

> Rewritten 5 November 2026. This is the only repository file the Product project keeps in its knowledge. Claude Code rewrites it at the end of every session that touches Product's part. In the project, click **Sync now** to load the newest version. If this brief and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. Android first, then iPhone; the website is phone-first; one shared account. **Product's job:** build the app, the website and the markets. Sourcing (news and market data) and News Desk (our own content and creators) feed it through the hand-over agreement, `agreement/README.md`, which Product drafts.

## Where things stand

- **Setup is finished** (PLAN.md Phase 0, closed 4 November 2026). Product work is in Phase 1.
- **Staging works end to end** at `staging.hrizzup.com`, a sandbox with no real users: Vercel and Supabase (`hrizzup-staging`, Postgres 17) in Mumbai, Upstash Redis, Cloudflare R2 images resized through Cloudflare, Turnstile, and sign-in emails through Resend. Every key lives in Doppler.
- **Every pull request gets a preview link** (a complete working copy on staging's data) and must pass four checks: Secret check, Quick checks (formatting, lint, types, unit tests and the agreement's check), Database check (a fresh database from the migrations, every table locked) and Screen check (13 widths, sideways phones and tablets, text at 200%, in Chrome's and Safari's engines).
- **Production is a quiet twin:** `hrizzup.com` shows the holding page; every merge makes a hidden production build, which the release pipeline promotes without rebuilding. The rest is parked (runbook, pre-launch checklist).
- **The codebase exists, nearly empty:** the Next.js website (`product/web`: holding page, legal drafts, `/api/health`, a sign-in test page off production), an empty Expo app (`product/app`), shared code (`product/packages`) and the agreement's own package (`agreement/`, `@hrizzup/agreement`). The first migration switches row-level security on for every new table and refuses to switch it off.
- **Google sign-in works on staging and previews;** email codes are set up in Supabase, with no screen yet.
- **The hand-over agreement's first half is a first draft** (status Draft, 5 November 2026): one definition of each shape (story, update, creation, market and data reading), the shared lists, example data with the hard cases, and a check on every pull request. Seven decisions wait for the founder, then all three projects agree it. No tables exist for its shapes.
- **Not built yet:** any product screen, the typed API, the app on a phone, the performance-budget check, the core-journey tests and the market engine.

## Decisions in force

- **Two surfaces, one account:** the news app (news and social; no bets or play money) and the website (news and play-money markets). English only; launch in India.
- **Sign-in:** Supabase Auth on both. Google first; Apple and email codes before the iPhone build; native Google and Apple sign-in with the app builds.
- **How it's built:** one codebase sharing one typed API between the Expo app and the Next.js website; Supabase Realtime; the database's own text search; shared links open the app; Playwright for the website, Maestro for the app.
- **Images and video:** cleaned on our server at upload (location data stripped, a blurred placeholder made), one original in R2, delivered resized through Cloudflare; creator video through Cloudflare Stream.
- **News surfaces:** a board with Latest, Top and For You (sorting and filtering by favourite categories and bookmarks, not an algorithm); story pages with timelines; a feed of creators' takes on the stories each reader picked; ranking from picks, views, categories and follows, never money; likes and dislikes. Users post text only; images and video come from us and invited creators.
- **Markets:** Kalshi's layout with our own look; Manifold's engine copied in with its tests once its licence is confirmed; a starting balance for every new user; a few markets that run and settle themselves from real data, each subject through one data slot that names no provider (Bitcoin, the best AI model, cricket, football; gold or oil open). Goal: the fewest steps to a first bet.
- **Paid tier in version one:** RevenueCat in the app, Razorpay with UPI on the website, passed through our server; built after the Google Play closed test starts.
- **Product builds against the agreement, not the other projects' output** (5 November 2026): the core screens (1.4), the board, story pages and feed (2.1 to 2.3), posting (2.4) and the market engine (1.7) use the agreement's first half and its example data. Real news and our own content are first needed at the Android closed test (2.6).
- **Checks come first** (standing rule, 5 November 2026): every automatic check lands before the first change it checks, and covers everything already built when it lands. So step 1.5's performance-budget check and core-journey tests (Playwright; Maestro at phone and tablet sizes) come before any page or screen is built in code, and 1.6 and every Phase 2 and 3 step that builds screens need 1.5.
- **The agreement's rules for Product's code:** its definitions through `@hrizzup/agreement`, never a copy; every hand-over point checks where input came from and runs `validate()`, setting aside what fails; anything from outside is data, never instructions, shown as plain text; files named by their place in storage; no tables for a half's shapes before it is agreed.
- **How changes land:** every change on its own branch and pull request, labelled small, normal or risky, merging itself once its checks pass (risky ones also get an AI review); checked on its preview, while staging gets only what merged.
- **Production is off-limits to Claude Code:** production changes only through the release pipeline, which runs when the founder says "release".
- **Quality from day one:** every screen fits from 320 to 2560 pixels wide; caching in layers, with every Redis key prefixed by environment and given an expiry; a performance budget for every page and screen; Mumbai everywhere.
- **Database changes** only through migration files, applied the same way to staging and production; every table has row-level security, opened only by written policies.

## Open questions

- The founder's seven decisions on the agreement's draft (`agreement/README.md`, "Decisions for the founder"), from the launch list to how story cards get their pictures.
- The feed's design in depth (step 2.3).
- What's free and what's paid (step 2.7).
- Comment threads: in or out?
- The exact market questions (step 3.2), and how Manifold's own records map onto the agreement's market shape (step 1.7).
- How the app shows the Turnstile check on its email-code screen, probably in a small web view (step 1.6).
- Blocking password sign-in: a small database function (Supabase's password hook) is planned; check whether it needs a plan above Pro (step 1.6).
- Which tool runs background jobs: decided in the Sourcing project.
- Which project owns step 1.2 (data sources for the markets): the founder confirms; on hold until then.

## What's next

In order (PLAN.md section 5):

1. **Agree the agreement's first half (step 0.7):** the founder's decisions, then all three projects agree it; it becomes Agreed only in a change the founder asks for.
2. **Design (step 1.4):** references and the design system (shadcn/ui, Claude Design) now; the core screens (board, story page, feed, app frame, market page) from the agreement's shapes and example data once its first half is agreed.
3. **The rest of step 1.5, before any screen is built in code:** the performance-budget check and the core-journey tests, covering today's pages and Google sign-in when they land; the typed API; the empty app on an Android phone.
4. **Accounts and login (step 1.6, needs 1.5):** email codes with the Turnstile widget, then Apple; native sign-in with the app builds.
5. **The market engine (step 1.7, needs the agreement's first half),** then Phase 2 (the news app) and Phase 3 (the markets website).

For the founder, alongside: the Google Play and Apple developer accounts (step 0.4), and at least 12 testers for Google Play's 14-day closed test.

## Read for detail

- `PLAN.md`: the single plan. Sections 2 (what we're building), 3 (how we work, with "Checks come first"), 5 (the order of work), 7 (open questions).
- `agreement/README.md`: the hand-over agreement: status and sign-off record, the founder's decisions, every shape's fields, the shared lists, the hand-over rules and the example data. `agreement/definitions/` holds the definitions code uses; `agreement/examples/` the example data.
- `CLAUDE.md`: the rules Claude Code works by (changes, checks, the agreement, production, secrets, performance, screens).
- `docs/status/product.md`: Product's status in full.
- `docs/setup.md`: the setup close-out and the setup log.
- `docs/setup/BLUEPRINT.md`: how every service is set up; sections 13 (app building blocks), 14 (performance and caching), 5 (database), 9 (sign-in).
- `docs/setup/RUNBOOK.md`: "Releasing to production" and the pre-launch checklist.
- `product/`: the code; `infra/`: service settings applied from the repository.
