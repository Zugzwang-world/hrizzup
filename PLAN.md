# Hrizzup: Plan and order of work

> This is the single plan for the whole product. Claude Code keeps it current: it turns the order of work below into GitHub milestones, and at the end of every session it updates the three status files and rewrites the thinking-project briefs. Nobody maintains this file by hand. Changes to the plan go through Claude Code, like any other change.

Last agreed: 5 November 2026

---

## 1. Why this exists

Most people now get their news first from creators on social media (posts, memes, videos), not from publishers or news aggregators. No news product is built around the creators you choose to follow. Hrizzup is a news app built around creators. Our AI finds news the moment it breaks on X and turns it into stories that develop over time. Each reader sees those stories through creators' takes, shaped by the stories and topics they choose. Alongside the app, a website runs simple play-money prediction markets on the biggest news subjects.

---

## 2. What we're building

### One name, one domain, two surfaces

| | News app | Website |
|---|---|---|
| What's on it | News and social | News and markets |
| Money | No bets and no play money | Play money only |
| Paid tier (version one) | Subscriptions through RevenueCat | Subscriptions through Razorpay (with UPI), passed through our server |
| Platforms | Android first, then iPhone (both prepared in parallel) | Web, designed to work well on phones |
| Login | One shared account across both | One shared account across both |
| Language | English | English |

### News: the hook, and most of the effort

- **Sourcing:** fully automated, run by Grok bots that read X on a schedule. Which Grok product and plan run them, and the route that brings their results to our pipeline, are decided in the Sourcing project (step 0.8). Our pipeline receives the results automatically, turns each result into our own update, groups updates into stories that develop over time (each with a timeline), and tags every story with a location and a category. Nobody copies anything by hand.
- **Categories:** a location (global; national, which means India; local, which means Indian cities) combined with a general category (crypto, finance, business, AI, sports and more).
- **Board:** a Pinterest-style discovery page with three tabs: Latest, Top and For You. For You is built from each user's favourite categories and bookmarks. It sorts and filters; it is not an algorithm.
- **Feed:** creators' takes on the stories each user picked, plus the creators they follow and their location. The detailed design is still to be worked out.
- **Ranking, version one:** based on the stories a user picks, what they view, the categories they choose and who they follow. No money signals.
- **Content:** our own content (from the News Desk project) plus creators who open creator accounts in the app. Users post text only. Images and video come from us and from invited creators. For the market subjects, we also embed existing creators' content.
- **Reactions:** likes and dislikes.
- **Social in the app:** a simple feed of users' posts. No bets and no play money anywhere in the app; the only payment in the app is the paid-tier subscription.
- **Launch:** the app launches in India. Global news is for everyone.

### Markets: the website, kept simple

- **Screens:** follow Kalshi's layout and structure, with our own colours, typeface, logo and icons.
- **Engine:** Manifold's market engine (the maths, trading, settlement and play-money accounting, with its tests) copied into our codebase. Everything else is ours. Confirm Manifold's licence before copying, and keep its licence notice.
- **Play money:** every new user gets a starting balance. If someone holds Yes and No in the same market, they cancel out, as on Manifold.
- **Markets:** a few global markets that run continuously and settle themselves from real-world data. Subjects: Bitcoin (many time windows), gold or oil, the best AI model, and cricket and football matches with live scores. The exact questions are still to be refined.
- **News:** shown alongside the markets, linked to them through shared categories.
- **Goal:** the fewest possible steps from arriving to placing a first bet. Extra features can be built now and kept switched off.

### How it's built (decided 2 November 2026)

- **One codebase, two apps:** the app is built with Expo (React Native) and the website with Next.js, in one codebase that shares code between them.
- **One typed API** that both the app and the website use.
- **Live updates** (market prices, new posts) through Supabase Realtime.
- **Sign-in (decided 3 November 2026):** Supabase Auth for the website and the app, so one account works on both. Google first. Apple and email codes (a code sent by email, no passwords) come before the iPhone build. The app's own native Google and Apple sign-in, including its Android sign-in client and the app's signing fingerprint, come with the app builds.
- **Search from day one,** starting with the database's own text search.
- **Shared links open the app** if it's installed (Android App Links and iOS Universal Links).
- **Core journeys are tested automatically:** Playwright for the website, Maestro for the app.
- **Images, the professional way:**
  - At upload: strip location data, fix rotation, cap the size, and make a tiny blurred placeholder. This happens on our server, because a phone can't be trusted to remove location data. The app also shrinks photos before uploading, to save mobile data.
  - Store one original in R2.
  - Deliver through Cloudflare image transformations: `format=auto`, resized per screen from a short fixed list of widths, cached at the edge.
  - The website uses Next.js images pointed at Cloudflare; the app uses Expo's image component with the placeholder.
  - No conversion scripts.
- **Video:** creator videos are stored and played through Cloudflare Stream, which uses adaptive streaming and lives in the same Cloudflare account.

### Paid tier (in version one)

- **Subscriptions are built together with the app** (step 2.7): RevenueCat in the app, and Razorpay (with UPI) on the website, with Razorpay payments passed through our server to RevenueCat, so the app and the website agree on who has paid.
- **What's free and what's paid** is decided before the paywall is built.

### Decided later

- **Background jobs:** decided in the Sourcing project.
- **PostHog and the admin page:** later.
- **Language:** English only.

### Not in version one

- Bot network (a separate network just for AI agents; design later)
- Polls (one person, one vote; a later feature)
- Comment threads (text only; undecided)
- Social features for markets (bets shown, debate view, support and counter); website only, later
- Money signals in ranking, odds from other sites, a public API, more countries and cities, other languages

---

## 3. How we work

- The founder talks to Claude Code directly in the desktop app, with several sessions running in parallel. Helpers use their own accounts.
- **How to work with the founder:** the founder is non-technical. He describes problems, goals and preferences; you bring the solution. Always propose the best solution that top professional teams use today, explain it in plain language, and lead with your recommendation. If the founder suggests a specific fix and a better one exists, say so and recommend the better one. Show options only when there is a real trade-off, and say which you recommend. When the founder describes a problem through an example, treat the example as one case of a general problem: solve the whole category with the best professional approach, and write the general principle, never a rule about the single example.
- No fixed rituals. Use whichever Claude Code feature fits, when it fits (for example, Ultraplan for the algorithm or for the whole design in one go).
- **How changes land** (from now on, including staging): every change goes on its own branch and pull request. Claude opens it, the checks that fit the change run (including a secret check on every pull request), the pull request gets a preview link once Vercel is connected, and Claude merges it as soon as the checks pass. No human approval. GitHub enforces this on `main`: checks must pass before merging, no force-push, no required reviews.
- Checks are sized to the change:
  - **Small** (text, colours, spacing, simple fixes): quick checks, plus screenshots at four screen sizes if a screen changed.
  - **Normal:** quick checks, plus the tests for the parts the change touches.
  - **Risky** (market maths, play money, login, database structure, the core of the news engine, payments): the full test suite plus AI review.
  - **Production release:** everything, once.
  - Every change is labelled small, normal or risky.
- **Checks come first** (standing rule, 5 November 2026): every automatic check lands before the first change it checks, and when a check lands it also covers everything already built. In section 5, each check is a need of the steps it would check, so none of them can start without it. Code that starts somewhere the checks don't reach yet (a new folder or a new language) gets its checks first.
- **Staging** is a sandbox. The AI holds all of its keys. It is fully separate from production, holds no real user data, and every paid service on it has a spending cap. Auto mode stays on.
- **Production** runs on the same platforms as staging: Vercel plus Supabase, set up exactly like staging (same services, versions, region and settings), with its own data and keys. This "production twin" is created as soon as staging works, with nothing public until launch, so going live is a promotion, not a migration. The founder holds the production keys, and production starts clean.
- **Releasing** means promoting the exact production build of a commit that passed staging (`vercel promote`), through the release pipeline. Nothing is rebuilt, and going back is one step too.
- **Production is off-limits to the AI:** Claude Code never reads, holds or uses production keys. Production is changed only by the release pipeline, which gets its own production credentials in the production twin (runbook Part 10).
- **Phone first.** Every screen is checked at phone, tablet, laptop and large-monitor sizes.
- **Fast from day one.** Every page and screen is built to load fast and stay fast: caching in layers (device, edge, server, Upstash Redis, database), and a performance budget checked automatically on every pull request and measured on real users once live. Performance is part of "done", never a later fix. The full rules are in the blueprint, "Production quality".
- **Design** starts from references (Mobbin and the founder's own) and is built with shadcn/ui and Claude Design.
- **Build on standard, portable pieces.** AWS is not the production plan: it comes later only if a concrete need appears, as its own project.
- **Plugins:** security-guidance, code-review, frontend-design, feature-dev. **Connectors:** GitHub, Context7, Playwright.
- Nothing is maintained by hand.

---

## 4. Three projects, one codebase

| Project | Its job | What it produces |
|---|---|---|
| Sourcing | Design and run the Grok bots that find news on X, turn their results into stories and updates, and find data sources for the markets | Stories, updates, market data sources |
| News Desk | Create our own content and onboard creators | Text, images, video |
| Product | Build the app, the website and the markets | The app and the website |

- There is one repository, one shared content store (a database plus storage for images and video), and one written hand-over agreement that defines exactly what each project passes to the others. It is signed off in two halves (step 0.7).
- Finding data sources for the markets (step 1.2) is on hold until the founder confirms which project owns it.
- Projects never copy code between each other; the shared repository is the only route.
- Each thinking project keeps only its brief in its knowledge: `docs/brief/sourcing.md`, `docs/brief/news-desk.md` or `docs/brief/product.md` (decided 4 November 2026). A brief stands on its own: where things stand, the decisions in force, open questions, what's next, and which repository files hold the detail. It stays under about 1,500 words and is rewritten, never appended. The project uses the live GitHub connection when it needs that detail.
- Claude Code updates the relevant status file and rewrites the relevant brief at the end of every session. A daily routine that would catch a brief left behind is ready but off for now (founder's decision, 4 November 2026).

---

## 5. Order of work

No time estimates, only order. **Needs** means it must be finished first.

### Phase 0: Set up (complete)

**Finished on 4 November 2026.** Staging works end to end, and its production twin is built with nothing public. Production's own services and keys (the founder's checklist in runbook Part 10) are parked until launch, in the runbook's pre-launch checklist. Steps 0.4, 0.7 and 0.8 are the projects' own first work rather than setup, so they moved to Phase 1 with their numbers unchanged.

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 0.1 | Create the new repository in the founder's personal GitHub account (`Zugzwang-world`, on GitHub Pro). Helpers get their own logins. | Founder | — | The repository exists |
| 0.2 | Choose the name and buy the domain (one name for everything) | Founder | — | The domain points at staging |
| 0.3 | Set up staging on Vercel Pro and Supabase Pro, separate from production, with spending caps on every paid service. As soon as staging works, create its production twin: the same setup with its own data and keys, nothing public until launch | Founder, with AI | 0.2 | Preview links work, and the production twin matches staging |
| 0.5 | Create the three Claude projects, each with its instructions, its brief from GitHub (`docs/brief/`), and the GitHub connector | Founder | 0.1 | Each project keeps its brief in its knowledge |
| 0.6 | Repository foundation: CLAUDE.md, this plan, the status files and the briefs, checks sized to the change, preview links, plugins, connectors (the daily brief refresh is ready but off for now, founder's decision) | Claude Code | 0.1, 0.3 | A trivial change passes its checks and gets a preview link |

### Phase 1: Foundations (three projects working in parallel)

Steps 0.4, 0.7 and 0.8 moved here from Phase 0 on 4 November 2026, keeping their numbers. Step 0.7 signs off in two halves, each with its own status, Draft and then Agreed (decided 5 November 2026). Product builds against the agreement's first half (its shapes and example data), not against the other projects' output.

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 0.4 | Register individual developer accounts: Google Play Console and the Apple Developer Program | Founder | — | Both accounts are active |
| 0.7, first half | The hand-over agreement's first half: exactly what a story, an update, a creation and a market look like when they pass between projects (their shapes, with example data and a check on every pull request that keeps the two in step), and the launch list of locations and categories | Product drafts it; all three projects agree; the founder approves the launch list | 0.6 | Agreed and saved in the repository. **No project creates tables for these shapes or writes content in them before this half is agreed.** |
| 0.7, second half | The hand-over agreement's second half: the Grok bots' result format. Drafted only once the Sourcing project has chosen the Grok product and how the results reach our pipeline (0.8) | Product drafts it; all three projects agree | 0.8's choice of Grok product and route | Agreed only after a real result from 0.8's test bot passes the agreement's own checks. **No bot result becomes content before this half is agreed.** |
| 0.8 | Choose the Grok product and plan that run the bots, and the route that brings their results to our pipeline (both decided in the Sourcing project), then set them up | Sourcing decides; the founder sets it up, with AI | 0.2 | A test bot's result arrives by that route |
| 1.1 | News pipeline, first version: Grok bots read X on a schedule and send results in the agreed format; our pipeline receives them automatically, by the route 0.8 chose, writes updates, groups them into stories with timelines, tags location and category, and saves them to the content store | Sourcing | 0.7 (both halves), 0.8 | Stories appear and update on their own on staging |
| 1.2 | Data sources for the markets: prices (Bitcoin, gold or oil), scores (cricket, football), an AI model ranking, with their costs. **On hold** until the founder confirms which project owns it | To be confirmed by the founder | — | Every market subject has a named source |
| 1.3 | Content formats and the first batch of our own content for the launch categories; a list of creators to invite | News Desk | 0.7 (first half) | Enough content to fill the feeds in the launch categories |
| 1.4 | Design: references, then the design system, then the core screens (board, story page, feed, app frame, market page), drawn from the agreement's shapes and example data | Product, in Claude Design | 0.7 (first half), for the core screens | Design system approved and screens handed to Claude Code |
| 1.5 | Set up the one codebase (Expo app and Next.js website sharing code, with one typed API) and get a first empty app running on an Android phone. Before any page or screen is built in code, add the checks every pull request runs on them: the performance budget (blueprint section 14) and the core-journey tests (Playwright for the website; Maestro for the app, at phone and tablet sizes). The first database migration locks every new table (row-level security on automatically), and a check on every pull request fails if any table is unprotected (approved 3 November 2026) | Product | 0.6 | The website runs on staging, the app opens on a phone, and every pull request checks the performance budget and the core journeys of every page and screen that exists |
| 1.6 | Accounts and login with Supabase Auth: Google first; Apple and email codes before the iPhone build; the app's native Google and Apple sign-in with the app builds | Product | 0.6, 1.5 | Sign-in works on the web and on Android |
| 1.7 | Copy the market engine from Manifold, with its tests (licence confirmed first) | Product | 0.6, 0.7 (first half) | A market can be created, traded and settled on staging |

### Phase 2: The news app (most of the effort)

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 2.1 | Board: Latest, Top and For You; location and general categories; favourites and bookmarks | Product | 0.7 (first half), 1.4, 1.5 | A reader can browse and shape their board |
| 2.2 | Story pages with timelines | Product | 0.7 (first half), 1.4, 1.5 | Every story shows how it developed |
| 2.3 | Feed and ranking, version one: picks, views, categories, follows; likes and dislikes; following creators | Product | 0.7 (first half), 1.5, 2.1 | The feed shows creators' takes on the stories a reader chose |
| 2.4 | Posting: text for everyone; creator accounts with image and video uploads; reporting posts and blocking users | Product | 0.7 (first half), 1.5, 1.6 | Users post text, creators post media, and any post can be reported |
| 2.5 | Notifications for breaking and developing stories | Product | 1.5, 2.2 | Alerts arrive on an Android phone |
| 2.6 | Android build of everything above; start the Google Play closed test as soon as the build is usable. This is where real people first see real news, so it needs the news pipeline and our own content | Product, Founder | 1.1, 1.3, 2.1–2.5 | A closed test is running with 12 or more real testers |
| 2.7 | Paid tier: decide what's free and what's paid, then build subscriptions (RevenueCat in the app; Razorpay with UPI on the website, passed through our server). It follows the closed test's start, so the Google Play clock isn't held up | Product, Founder | 1.5, 1.6 | A tester can subscribe in the Android app and on the website, and both show the same paid status |

### Phase 3: The markets website (runs alongside the second half of Phase 2)

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 3.1 | Market pages in Kalshi's layout with our own look; a starting balance on signup | Product | 1.4, 1.5, 1.7 | A new visitor can sign in and place a bet in a few taps |
| 3.2 | Markets that run continuously and settle themselves from the data sources; questions refined | Product, with step 1.2's owner | 1.2, 1.7 | Markets open, run and settle with no one touching them |
| 3.3 | News on the website, linked to markets through shared categories | Product | 1.5, 2.1, 3.1 | A visitor can move between a market and its news |

### Phase 4: Polish and launch preparation

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 4.1 | Every screen checked at four sizes; full test suite on risky areas; security review | Product | Phases 2 and 3 | Nothing blocking launch |
| 4.2 | Privacy policy and terms of use; reporting and blocking confirmed (both required by the app stores) | Founder, Product | 2.4 | Both published and linked inside the app |
| 4.3 | iPhone build with Sign in with Apple; testing through TestFlight; App Store review | Product, Founder | 1.6, Phase 2 | iPhone app approved |
| 4.4 | Creators onboarded through creator accounts; our own content loaded | News Desk, Founder | 2.4 | Feeds are full in every launch category |
| 4.5 | Google Play: finish the closed test, then apply for production access | Founder | 2.6 | Production access granted |

### Phase 5: Production

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 5.1 | Go live on the production twin (Vercel, Supabase): final checks, then promote the build that passed staging. The founder holds the production keys, and production starts clean. | Founder, with AI | Phase 4 | Production is running |
| 5.2 | Release: Android, then iPhone; the website goes live | Founder | 4.3, 4.5, 5.1 | Live in both app stores and on the web |

---

## 6. Start early: clocks we don't control

- **Google Play, personal account:** before you can apply for production access, the app must run a closed test with at least 12 testers who have been opted in continuously for 14 days. Google then reviews the application. Line up 12 or more real testers who will actually use the app, and start the closed test as soon as a usable Android build exists (step 2.6).
- **Apple:** an iPhone app that offers Google sign-in must also offer an equally private option, such as Sign in with Apple.
- **Domain:** needed before login and email will work.
- **Grok:** choose the product and plan, and set them up early (step 0.8), so the Grok bots can be tested before the pipeline is built around them.
- **Paid services** (video hosting, data feeds): open the accounts early, each with a spending cap.

---

## 7. Open: to settle inside the projects

- Which Grok product and plan run the bots, and the route that brings their results to our pipeline (step 0.8, decided in the Sourcing project)
- How the Grok bots are set up, how often they run, and the fixed format of their results (step 0.7's second half, and 1.1). Each run starts fresh, so matching new items to existing stories happens in our pipeline.
- Confirm that the chosen Grok product's terms allow its results to feed a public app (step 0.8)
- Which project owns step 1.2, the data sources for the markets (the founder confirms; on hold until then)
- Background jobs: which tool runs scheduled and queued work (decided in the Sourcing project)
- How the app shows the bot check (Turnstile) on its email-code screen (step 1.6)
- Feed design in depth (step 2.3)
- Exact market questions (step 3.2)
- Paid tier: what's free and what's paid (decided before the paywall is built, step 2.7)
- Comment threads
