# Hrizzup: Plan and order of work

> This is the single plan for the whole product. Claude Code keeps it current: it turns the order of work below into GitHub milestones and updates the three status files at the end of every session. Nobody maintains this file by hand. Changes to the plan go through Claude Code, like any other change.

Last agreed: 2 November 2026

---

## 1. Why this exists

Most people now get their news first from creators on social media (posts, memes, videos), not from publishers or news aggregators. No news product is built around the creators you choose to follow. Hrizzup is a news app built around creators. Our AI finds news the moment it breaks on X and turns it into stories that develop over time. Each reader sees those stories through creators' takes, shaped by the stories and topics they choose. Alongside the app, a website runs simple play-money prediction markets on the biggest news subjects.

---

## 2. What we're building

### One name, one domain, two surfaces

| | News app | Website |
|---|---|---|
| What's on it | News and social | News and markets |
| Money | None | Play money only |
| Platforms | Android first, then iPhone (both prepared in parallel) | Web, designed to work well on phones |
| Login | One shared account across both | One shared account across both |
| Language | English | English |

### News: the hook, and most of the effort

- **Sourcing:** fully automated, run by Grok bots: automations on a Grok subscription (not an X or xAI API) that read X on a schedule and send their results by email to a dedicated inbox. Our pipeline reads that inbox automatically, turns each result into our own update, groups updates into stories that develop over time (each with a timeline), and tags every story with a location and a category. Nobody copies anything by hand.
- **Categories:** a location (global; national, which means India; local, which means Indian cities) combined with a general category (crypto, finance, business, AI, sports and more).
- **Board:** a Pinterest-style discovery page with three tabs: Latest, Top and For You. For You is built from each user's favourite categories and bookmarks. It sorts and filters; it is not an algorithm.
- **Feed:** creators' takes on the stories each user picked, plus the creators they follow and their location. The detailed design is still to be worked out.
- **Ranking, version one:** based on the stories a user picks, what they view, the categories they choose and who they follow. No money signals.
- **Content:** our own content (from the News Desk project) plus creators who open creator accounts in the app. Users post text only. Images and video come from us and from invited creators. For the market subjects, we also embed existing creators' content.
- **Reactions:** likes and dislikes.
- **Social in the app:** a simple feed of users' posts. No bets and no money anywhere in the app.
- **Launch:** the app launches in India. Global news is for everyone.

### Markets: the website, kept simple

- **Screens:** follow Kalshi's layout and structure, with our own colours, typeface, logo and icons.
- **Engine:** Manifold's market engine (the maths, trading, settlement and play-money accounting, with its tests) copied into our codebase. Everything else is ours. Confirm Manifold's licence before copying, and keep its licence notice.
- **Play money:** every new user gets a starting balance. If someone holds Yes and No in the same market, they cancel out, as on Manifold.
- **Markets:** a few global markets that run continuously and settle themselves from real-world data. Subjects: Bitcoin (many time windows), gold or oil, the best AI model, and cricket and football matches with live scores. The exact questions are still to be refined.
- **News:** shown alongside the markets, linked to them through shared categories.
- **Goal:** the fewest possible steps from arriving to placing a first bet. Extra features can be built now and kept switched off.

### Not in version one

- Bot network (a separate network just for AI agents; design later)
- Polls (one person, one vote; a later feature)
- Comment threads (text only; undecided)
- Paid tier (freemium or paywall; to decide)
- Social features for markets (bets shown, debate view, support and counter); website only, later
- Money signals in ranking, odds from other sites, a public API, more countries and cities, other languages

---

## 3. How we work

- The founder talks to Claude Code directly in the desktop app, with several sessions running in parallel. Helpers use their own accounts.
- **How to work with the founder:** the founder is non-technical. He describes problems, goals and preferences; you bring the solution. Always propose the best solution that top professional teams use today, explain it in plain language, and lead with your recommendation. If the founder suggests a specific fix and a better one exists, say so and recommend the better one. Show options only when there is a real trade-off, and say which you recommend.
- No fixed rituals. Use whichever Claude Code feature fits, when it fits (for example, Ultraplan for the algorithm or for the whole design in one go).
- **How changes land** (from now on, including staging): every change goes on its own branch and pull request. Claude opens it, the checks that fit the change run (including a secret check on every pull request), the pull request gets a preview link once Vercel is connected, and Claude merges it as soon as the checks pass. No human approval. GitHub enforces this on `main`: checks must pass before merging, no force-push, no required reviews.
- Checks are sized to the change:
  - **Small** (text, colours, spacing, simple fixes): quick checks, plus screenshots at four screen sizes if a screen changed.
  - **Normal:** quick checks, plus the tests for the parts the change touches.
  - **Risky** (market maths, play money, login, database structure, the core of the news engine, payments): the full test suite plus AI review.
  - **Production release:** everything, once.
  - Every change is labelled small, normal or risky.
- **Staging** is a sandbox. The AI holds all of its keys. It is fully separate from production, holds no real user data, and every paid service on it has a spending cap. Auto mode stays on.
- **Production** runs on the same platforms as staging: Vercel plus Supabase, set up exactly like staging (same services, versions, region and settings), with its own data and keys. This "production twin" is created as soon as staging works, with nothing public until launch, so going live is a promotion, not a migration. The founder holds the production keys, and production starts clean.
- **Releasing** means promoting the exact production build of a commit that passed staging, with one command (`vercel promote`). Nothing is rebuilt, and going back is one command too.
- **Phone first.** Every screen is checked at phone, tablet, laptop and large-monitor sizes.
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

- There is one repository, one shared content store (a database plus storage for images and video), and one written hand-over agreement that defines exactly what each project passes to the others.
- Projects never copy code between each other; the shared repository is the only route.
- Each thinking project syncs only this plan and the three status files: `docs/status/sourcing.md`, `docs/status/news-desk.md` and `docs/status/product.md`. It uses the live GitHub connection when it needs detail.
- Claude Code updates the relevant status file at the end of every session. A daily routine writes a short summary of what shipped, what's in progress and what's stuck.

---

## 5. Order of work

No time estimates, only order. **Needs** means it must be finished first.

### Phase 0: Set up

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 0.1 | Create the new repository in the founder's personal GitHub account (`Zugzwang-world`, on GitHub Pro). Helpers get their own logins. | Founder | — | The repository exists |
| 0.2 | Choose the name and buy the domain (one name for everything) | Founder | — | The domain points at staging |
| 0.3 | Set up staging on Vercel Pro and Supabase Pro, separate from production, with spending caps on every paid service. As soon as staging works, create its production twin: the same setup with its own data and keys, nothing public until launch | Founder, with AI | 0.2 | Preview links work, and the production twin matches staging |
| 0.4 | Register individual developer accounts: Google Play Console and the Apple Developer Program | Founder | — | Both accounts are active |
| 0.5 | Create the three Claude projects, each with its instructions, a GitHub link to this plan and the status files, and the GitHub connector | Founder | 0.1 | Each project can read this plan |
| 0.6 | Repository foundation: CLAUDE.md, this plan, the status files, checks sized to the change, preview links, plugins, connectors, the daily summary routine | Claude Code | 0.1, 0.3 | A trivial change passes its checks and gets a preview link |
| 0.7 | The hand-over agreement: exactly what a story, an update, a creation and a market look like when they pass between projects, including the fixed format the Grok bots use for their results | Product drafts it; all three projects agree | 0.6 | Agreed and saved in the repository. **No project writes content before this is done.** |
| 0.8 | Get the Grok subscription (SuperGrok) and set up a dedicated inbox on our domain that receives the Grok bots' results | Founder, with AI | 0.2 | A test bot's result lands in the inbox |

### Phase 1: Foundations (three projects working in parallel)

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 1.1 | News pipeline, first version: Grok bots read X on a schedule and send results in the agreed format; our pipeline reads the inbox automatically, writes updates, groups them into stories with timelines, tags location and category, and saves them to the content store | Sourcing | 0.7, 0.8 | Stories appear and update on their own on staging |
| 1.2 | Data sources for the markets: prices (Bitcoin, gold or oil), scores (cricket, football), an AI model ranking, with their costs | Sourcing | — | Every market subject has a named source |
| 1.3 | Content formats and the first batch of our own content for the launch categories; a list of creators to invite | News Desk | 0.7 | Enough content to fill the feeds in the launch categories |
| 1.4 | Design: references, then the design system, then the core screens (board, story page, feed, app frame, market page) | Product, in Claude Design | — | Design system approved and screens handed to Claude Code |
| 1.5 | Decide how the app and the website share one codebase; get a first empty app running on an Android phone | Product | 0.6 | Decided, and the app opens on a phone |
| 1.6 | Accounts and login: Google first; Apple and email sign-in decided before the iPhone build | Product | 0.6 | Sign-in works on the web and on Android |
| 1.7 | Copy the market engine from Manifold, with its tests (licence confirmed first) | Product | 0.6 | A market can be created, traded and settled on staging |

### Phase 2: The news app (most of the effort)

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 2.1 | Board: Latest, Top and For You; location and general categories; favourites and bookmarks | Product | 1.1, 1.4 | A reader can browse and shape their board |
| 2.2 | Story pages with timelines | Product | 1.1, 1.4 | Every story shows how it developed |
| 2.3 | Feed and ranking, version one: picks, views, categories, follows; likes and dislikes; following creators | Product | 1.3, 2.1 | The feed shows creators' takes on the stories a reader chose |
| 2.4 | Posting: text for everyone; creator accounts with image and video uploads; reporting posts and blocking users | Product | 1.6 | Users post text, creators post media, and any post can be reported |
| 2.5 | Notifications for breaking and developing stories | Product | 2.2 | Alerts arrive on an Android phone |
| 2.6 | Android build of everything above; start the Google Play closed test as soon as the build is usable | Product, Founder | 2.1–2.5 | A closed test is running with 12 or more real testers |

### Phase 3: The markets website (runs alongside the second half of Phase 2)

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 3.1 | Market pages in Kalshi's layout with our own look; a starting balance on signup | Product | 1.4, 1.7 | A new visitor can sign in and place a bet in a few taps |
| 3.2 | Markets that run continuously and settle themselves from the data sources; questions refined | Product, Sourcing | 1.2, 1.7 | Markets open, run and settle with no one touching them |
| 3.3 | News on the website, linked to markets through shared categories | Product | 2.1, 3.1 | A visitor can move between a market and its news |

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
- **Grok subscription:** set up early, so the Grok bots can be tested before the pipeline is built around them.
- **Paid services** (video hosting, data feeds): open the accounts early, each with a spending cap.

---

## 7. Open: to settle inside the projects

- How the Grok bots are set up, how often they run, and the fixed format of their results (steps 0.7 and 1.1). Each run starts fresh, so matching new items to existing stories happens in our pipeline.
- Confirm that Grok's subscription terms allow its results to feed a public app (step 0.8)
- How the app and the website share one codebase (step 1.5)
- Apple and email sign-in details (step 1.6)
- Feed design in depth (step 2.3)
- Exact market questions (step 3.2)
- Paid tier
- Comment threads
