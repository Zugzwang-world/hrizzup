# Product: brief

> Rewritten 4 November 2026. This is the only repository file the Product project keeps in its knowledge. Claude Code rewrites it at the end of every session that touches Product's part. In the project, click **Sync now** to load the newest version. If this brief and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. Android first, then iPhone; the website is phone-first; one shared account. **Product's job:** build the app, the website and the markets. Sourcing (news and market data) and News Desk (our own content and creators) feed it through a written hand-over agreement.

## Where things stand

- **Setup is finished** (PLAN.md Phase 0, closed 4 November 2026). Product work starts with Phase 1.
- **Staging works end to end** at `staging.hrizzup.com`, a sandbox with no real users: the website on Vercel in Mumbai; the database and sign-in on Supabase (`hrizzup-staging`, Mumbai, Postgres 17); Redis on Upstash (Mumbai); image storage on Cloudflare R2, resized and delivered through Cloudflare; Turnstile bot protection; sign-in emails from `no-reply@mail.hrizzup.com` through Resend. Every key lives in Doppler.
- **Every pull request gets a preview link:** a complete working copy of the site on staging's data, behind a Vercel login. Four checks must pass before anything merges: Secret check, Quick checks (formatting, lint, types, unit tests), Database check (a fresh database built from the migrations, with every table locked) and Screen check (13 screen widths, sideways phones and tablets, text at 200%, in Chrome's and Safari's engines).
- **Production is a quiet twin:** `hrizzup.com` shows the holding page, with draft privacy and terms pages. Every merge also makes a hidden production build, and the release pipeline promotes one without rebuilding it. Production's storage exists; its other services and keys are parked until launch (runbook, pre-launch checklist).
- **The codebase exists, nearly empty:** pnpm workspaces with Turborepo; the Next.js website in `product/web` (holding page, privacy and terms drafts, `/api/health`, and a sign-in test page that exists only off production); an empty Expo app in `product/app`; shared code in `product/packages`. The first database migration switches row-level security on for every new table and refuses to switch it off.
- **Google sign-in works on staging and on previews** (the founder signed in end to end). Email codes (8 digits, valid 10 minutes) are set up in Supabase, but the website has no email-code screen yet.
- **Not built yet:** any product screen, the typed API, the app on a phone, the performance-budget check and the market engine.

## Decisions in force

- **Two surfaces, one account:** the news app (news and social; no bets and no play money) and the website (news and play-money markets). English only; the app launches in India, and global news is for everyone.
- **Sign-in:** Supabase Auth on both surfaces. Google first; Apple and email codes before the iPhone build; the app's own native Google and Apple sign-in come with the app builds.
- **How it's built:** one codebase, with the Expo (React Native) app and the Next.js website sharing code through one typed API; Supabase Realtime for live updates; the database's own text search from day one; shared links open the app if it's installed; Playwright tests for the website and Maestro for the app.
- **Images and video:** cleaned on our server at upload (location data stripped, rotation fixed, size capped, a tiny blurred placeholder made), one original stored in R2, and delivered resized through Cloudflare image transformations. Creator video goes through Cloudflare Stream.
- **News surfaces:** a board with Latest, Top and For You (For You is built from favourite categories and bookmarks: it sorts and filters, it is not an algorithm); story pages with timelines; a feed of creators' takes on the stories each reader picked; ranking version one from picks, views, categories and follows, never money signals; likes and dislikes. Users post text only; images and video come from us and from invited creators.
- **Markets:** Kalshi's layout with our own colours, typeface, logo and icons; Manifold's market engine copied in with its tests, once its licence is confirmed; a starting balance of play money for every new user; a few markets that run continuously and settle themselves from real data (Bitcoin, gold or oil, the best AI model, cricket and football). Goal: the fewest steps from arriving to a first bet.
- **Paid tier in version one:** RevenueCat in the app and Razorpay with UPI on the website, passed through our server so both agree on who has paid. Built after the Google Play closed test starts.
- **How changes land:** every change goes on its own branch and pull request, labelled small, normal or risky, and merges itself once its checks pass. Risky changes (market maths, play money, login, database structure, the core of the news engine, payments) also get an AI review. A change is checked on its preview; staging receives only what has merged.
- **Production is off-limits to Claude Code:** it never reads or holds production keys. Production changes only through the release pipeline, which runs when the founder says "release". Until launch, the pipeline promotes only builds that still show the holding page.
- **Quality from day one:** every screen fits every device, from 320 to 2560 pixels wide; caching in layers (device, edge, server, Redis, database), and every Redis key carries the environment's prefix and an expiry; a performance budget for every page and screen; Mumbai is the region everywhere.
- **Database changes** happen only through migration files in the repository, applied the same way to staging and production. Every table has row-level security; access is granted only through written policies.

## Open questions

- The feed's design in depth (step 2.3).
- What's free and what's paid (decided before the paywall is built, step 2.7).
- Comment threads: in or out?
- The exact market questions (step 3.2, with Sourcing).
- How the app shows the Turnstile bot check on its email-code screen, probably inside a small web view (step 1.6).
- Blocking password sign-in: Supabase can't switch passwords off while email codes are on, so a small database function (Supabase's password hook) is planned to refuse them. Check whether it needs a plan above Pro before building email codes (step 1.6).
- Which tool runs background jobs (processing uploaded images, settling markets, the news pipeline): decided in the Sourcing project.

## What's next

In order (PLAN.md section 5):

1. **The hand-over agreement (step 0.7):** Product drafts exactly what a story, an update, a creation and a market look like when they pass between projects, including the Grok bots' result format; all three projects agree it. No project writes content before then.
2. **Design (step 1.4):** references (Mobbin and the founder's own), then the design system (shadcn/ui, Claude Design), then the core screens: board, story page, feed, app frame and market page.
3. **The rest of step 1.5:** the one typed API, the empty app running on an Android phone, and the performance-budget check on every pull request.
4. **Accounts and login (step 1.6):** email codes on the website with the Turnstile widget, then Apple; the app's native sign-in with the app builds.
5. **The market engine (step 1.7),** then Phase 2 (the news app) and Phase 3 (the markets website).

For the founder, alongside: register the Google Play and Apple developer accounts (step 0.4). Google Play's closed test needs at least 12 testers for 14 days before the app can go public, so line them up early.

## Read for detail

- `PLAN.md`: the single plan. Section 2 (what we're building), 3 (how we work), 5 (the order of work), 7 (open questions).
- `CLAUDE.md`: the rules Claude Code works by (changes, checks, production, secrets, performance, screens).
- `docs/status/product.md`: Product's status in full: done, next, open questions.
- `docs/setup.md`: the setup close-out (what exists, where, and what's parked), then the setup log, day by day.
- `docs/setup/BLUEPRINT.md`: how every service is set up. Section 13 (app building blocks), 14 (performance, caching and Redis), 5 (database), 9 (sign-in).
- `docs/setup/RUNBOOK.md`: "Releasing to production" and the pre-launch checklist.
- `product/web`, `product/app`, `product/packages`: the code. `infra/`: the service settings applied from the repository (migrations, sign-in, storage, Vercel).
