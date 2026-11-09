# Hrizzup: Plan and order of work

> This is the single plan for the whole product. Claude Code keeps it current: it turns the order of work below into GitHub milestones (one per phase, and one per round of parallel sessions), and at the end of every session it updates the three status files and rewrites the thinking-project briefs. Nobody maintains this file by hand. Changes to the plan go through Claude Code, like any other change.

Last agreed: 9 November 2026

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
| Platforms | Android and iPhone from the same app code; Android released first | Web, designed to work well on phones; built one stage ahead of the app |
| Login | One shared account across both | One shared account across both |
| Language | English | English |

### The website and the app, built in parallel (founder's decision, 8 November 2026)

The website and the app are built at the same time, with the website one stage ahead.

- **Every news feature reaches both surfaces** from one back end, one contract (the typed API that both use) and one phone-first design. Its screen stage splits in two, the website screen and the app screen, built at the same time in separate worktrees. The join (the screens wired to the real back end) happens on the website first, then in the app. [TRACKER.md](TRACKER.md) shows each news feature's stages.
- **App only:** notifications (step 2.5), the app's sign-in (step 1.6b), the store builds and the closed test (steps 2.6, 4.3 and 4.5).
- **Website only:** the markets track (steps 3.1 to 3.4).
- **Android and iPhone come from the same app code.** Android is released first; the iPhone adds only Sign in with Apple and Apple's review (step 4.3).

### News: the hook, and most of the effort

- **Sourcing:** fully automated, run by Grok bots that read X on a schedule. They find two things: news, which our AI turns into story tiles and updates for the board, and creators' takes on a story (memes, videos, explainers). Everything they find is kept in a sourced pool in the shared content store. Which Grok product and plan run the bots, and the route that brings their results to our pipeline, are decided in the Sourcing project (step 0.8). Our pipeline receives the results automatically, keeps what passes its checks in the sourced pool, turns the news into our own updates, groups updates into stories that develop over time (each with a timeline), and tags every story with one or more locations and categories. Nobody copies anything by hand.
- **Categories:** a location (global; national, which means India; local, which means Indian cities) combined with a general category (crypto, finance, business, AI, sports and more). The launch list, approved by the founder on 5 November 2026, is kept once, in the hand-over agreement's shared lists ([agreement/README.md](agreement/README.md)); a city or category added later is one change there, with the founder's approval.
- **Board:** a Pinterest-style discovery page with three tabs: Latest, Top and For You. For You is built from each user's favourite categories and bookmarks. It sorts and filters; it is not an algorithm.
- **Feed:** takes on the stories each user picked, from all three routes below, plus the creators they follow and their location. The detailed design is still to be worked out.
- **Ranking, version one:** based on the stories a user picks, what they view, the categories they choose and who they follow. No money signals.
- **Content reaches the product by three routes** (founder's decision, 5 November 2026):
  - **Found:** a creator's post the bots found is shown in a story's feed as the original post, embedded and credited to its creator, never copied. This applies to every story. Only takes in English are kept, matching the English-only launch; a meme or a video with few or no words counts (founder's decision, 9 November 2026).
  - **Made:** News Desk makes our own content from the sourced pool.
  - **Posted:** creators and users post directly in the app. Users post text only; images and video come from us and from invited creators.
- **Product only displays:** the board shows stories, and the feed shows takes from all three routes, each credited by its route.
- **Reactions:** likes and dislikes.
- **Social in the app:** a simple feed of users' posts. No bets and no play money anywhere in the app; the only payment in the app is the paid-tier subscription.
- **Launch:** the app launches in India. Global news is for everyone.

### Markets: the website, kept simple

- **Screens:** follow Kalshi's layout and structure, with our own colours, typeface, logo and icons.
- **Engine:** Manifold's market engine (the maths, trading, settlement and play-money accounting, with its tests) copied into our codebase. Everything else is ours. Confirm Manifold's licence before copying, and keep its licence notice.
- **Play money:** every new user gets a starting balance. If someone holds Yes and No in the same market, they cancel out, as on Manifold.
- **The product first, the topics later** (founder's decision, 8 November 2026):
  - **A market is data, not code.** Each market holds its question, its outcomes, its rules, its open and close times, its named settlement source and its status: draft, open, closed, settled or cancelled. The engine, trading, balances and settlement work the same for any question. Series (templates for recurring questions) come later.
  - **Only Hrizzup creates markets.** Users never do.
  - **A market settles in one of two ways:** by us, by hand, an admin-only action with every settlement logged (who, when, the outcome and the evidence); or automatically, by a resolver we choose, which reads the source named in the market's rules at the closing moment. There is no outside oracle and no dispute process. The Bitcoin perp is different: it prices itself continuously from a live feed.
  - **Admins** (founder's decisions, 9 November 2026): an admin is an account listed in the admins table, which is linked to accounts and written only by reviewed database migrations naming the account's ID. Every migration also runs on production, so each one adds its row only where that account exists. Staging's row (the founder's account) comes with step 1.7c; production's comes after the founder's first sign-in there (runbook, pre-launch checklist). No role the app uses can write the table, and the database checks it on every create, open, close and settle.
  - **The market console** (founder's decisions, 9 November 2026): a small, admin-only console to create, open and close markets and to settle by hand the ones that don't settle automatically, with every settlement logged. It's a plain internal tool: stock components, with no colours, type or layout of its own, picking up the design values once they exist; everyone but an admin gets "not found". Its calls (create, open, close and settle) are in the typed API, so every market write has one path. It comes with step 1.7c; the rest of the admin page stays later.
  - **Money rules** (founder's decisions, 9 November 2026): the market fee is zero at launch, behind one setting (`TAKER_FEE_RATE`); if a fee comes later, how a cancel refunds it is decided then. A market is cancelled only when it can't be settled fairly, and a cancelled market takes back sale profits, as Manifold's do, with the balance showing what's owed. The trade call (step 1.7d) refuses limit prices outside 1% to 99%, an expiry of zero, and amounts that aren't positive or that exceed the balance.
  - **The books** (founder's decisions, 9 November 2026): our own market tables, not Manifold's database design. Every move of play money is two matching lines, out of one account and into another (each person, each market's pool, and a house account that gives out starting balances and seeds new markets), so the books always sum to zero; lines are never edited or deleted, and a correction is a new line. Amounts are exact decimals, never floating point: the engine's results are rounded once, any remainder going to the house account, so every trade and settlement balances exactly. A trade is one database transaction; trades on the same market run strictly one after another; each trade request carries its own ID, so a retry never trades twice. A trade never takes a balance below zero; only a cancelled market can, and the balance then shows what's owed. Closing times and limit-order expiry are checked inside each trade, so money never depends on a scheduled job. The detail is in the blueprint (section 5).
  - **Build order:** (1) the engine maths (step 1.7a); (2) the ledger: the books above, with play-money balances, trades and positions (1.7b); (3) markets as data, settled by hand in the market console, whose calls (create, open, close and settle) join the typed API (1.7c); (4) the engine's other calls in the typed API: list, trade and positions, with the trade call's refusals (1.7d); (5) the market pages (3.1), whose reads shaped by the page's design (its price chart, for example) join the typed API at its contract stage. Once markets work end to end on staging (3.1's done test), the topics follow: choosing them and their data sources (1.2), automatic resolvers (3.2a), series (3.2b) and the perp's real price feed (3.4b).
  - **Until then,** staging uses test markets with placeholder questions, and the perp is built against a stand-in price (3.4a).
  - **Topics wait** (step 1.2, parked): choosing the topics, many copied from Kalshi's market formats, and their data sources waits until markets work end to end on staging. The subjects named so far (a few global markets: Bitcoin over many time windows, gold or oil, the best AI model, and cricket and football with live scores) and the readiness check's research on their sources (`docs/research/round-2-readiness.md`, D2 to D4) are reference, not decisions.
- **News:** shown alongside the markets, linked to them through shared categories.
- **Goal:** the fewest possible steps from arriving to placing a first bet. Extra features can be built now and kept switched off.
- **Perps (founder's decision, 8 November 2026):** one perpetual future on Bitcoin, in play money, on the website (steps 3.4a and 3.4b). No second perp in the plan yet. It shows we can bring a proven financial product into Hrizzup, test it with users and improve it.
  - **Built on Manifold's perps maths** (open source, MIT licence, with its tests; [docs/research/manifold.md](docs/research/manifold.md)), run by our own trading engine, the same one the markets use.
  - **A stand-in price first:** the perp is built against a stand-in price (step 3.4a); its real price feed comes with the topics, once markets work end to end on staging (3.4b).
  - **Starting rules:** leverage capped at 10 times; orders fill at the next new price, never the one on screen; a fee when a position is opened (closing is free); an off switch that stops trading at once.
  - **A new price and a liquidation check every few seconds,** run by Supabase's scheduler (Supabase Cron, which can run a job every 1 to 59 seconds), so orders fill within seconds.
  - **A rule-change log from the first day:** every change to the rules, with its date and its reason, so the improvements can be shown. A dashboard of perps' results waits for the admin page (section 2, "Decided later").

### How it's built (decided 2 November 2026)

- **One codebase, two apps:** the app is built with Expo (React Native) and the website with Next.js, in one codebase that shares code between them.
- **One typed API** that both the app and the website use: oRPC, contract first (founder's decision, 8 November 2026; blueprint section 13).
- **Live updates** (market prices, new posts) through Supabase Realtime.
- **Sign-in (decided 3 November 2026):** Supabase Auth for the website and the app, so one account works on both. Google first. The website's sign-in (step 1.6a): Google, then email codes (a code sent by email, no passwords), built and proven on the existing sign-in test page; the website's real sign-in screen comes from the design chat, like any screen readers see (founder's decision, 9 November 2026). Passwords are never accepted: there's no password field anywhere, and a Custom Access Token hook on Supabase Pro refuses any session made with one (founder's decision, 8 November 2026; blueprint section 9). The app's sign-in (step 1.6b): its own native Google sign-in, including its Android sign-in client and the app's signing fingerprint, and the same email codes. Sign in with Apple comes with the iPhone (step 4.3), in the app and on the website, so an account made with Apple works on both.
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

- **Background jobs** (founder's decision, 9 November 2026): none in Round 3. The choice stays the Sourcing project's, made in its research for step 0.8 (Round 3's relay 4) and reviewed by Product before its first user, the news pipeline (step 1.1). It must cover the automatic resolvers, which settle markets at their closing moments (step 3.2a); the perp's job every few seconds (step 3.4a) stays on Supabase Cron. No market's money waits for a job: closing times and limit-order expiry are checked inside each trade ("Markets", above).
- **A database per pull request** (Supabase branching; founder's decision, 9 November 2026): only if the rule that database changes land first (section 3) starts slowing features. It's a paid extra, so it's the founder's call then.
- **Invites:** how people are invited to try something before launch (for example, a test group for perps) is decided later.
- **PostHog and the admin page:** later. Only the market console comes earlier, with step 1.7c (section 2, "Markets"; founder's decision, 9 November 2026).
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
- **Rounds and relays** (founder's decision, 8 November 2026): work runs in rounds of parallel Claude Code sessions ("relays"), each in its own worktree, unattended, in small pull requests of one milestone each, attached to the round's GitHub milestone and tracked in [TRACKER.md](TRACKER.md) and the Product brief's progress section. A relay never waits for the founder: what only he can do goes under "For the founder" in the Product brief. The rules are in CLAUDE.md, "Unattended sessions". Round 2 closed on 9 November 2026; Round 3's twelve relays, in the founder's order, are in [TRACKER.md](TRACKER.md) ("Round 3's queue").
- **How to work with the founder:** the founder is non-technical. He describes problems, goals and preferences; you bring the solution. Always propose the best solution that top professional teams use today, explain it in plain language, and lead with your recommendation. If the founder suggests a specific fix and a better one exists, say so and recommend the better one. Show options only when there is a real trade-off, and say which you recommend. When the founder describes a problem through an example, treat the example as one case of a general problem: solve the whole category with the best professional approach, and write the general principle, never a rule about the single example.
- No fixed rituals. Use whichever Claude Code feature fits, when it fits (for example, Ultraplan for the algorithm or for the whole design in one go).
- **How changes land** (from now on, including staging): every change goes on its own branch and pull request. Claude opens it, the checks that fit the change run (including a secret check on every pull request), the pull request gets a preview link once Vercel is connected, and Claude merges it as soon as the checks pass. No human approval. GitHub enforces this on `main`: checks must pass before merging, no force-push, no required reviews.
- **Database changes land first** (founder's decision, 9 November 2026): each database change merges in its own pull request and only adds things, so whatever is on staging keeps working; the code and screens that use it follow in the next pull request. The reason: previews use staging's database, which gets a change only when its pull request merges. A check keeps every pull request's database changes after the newest one on `main` (built with step 1.8). A database per pull request comes only if this rule starts slowing features (section 2, "Decided later"). The rules sessions follow are in CLAUDE.md, "Database changes".
- Checks are sized to the change:
  - **Small** (text, colours, spacing, simple fixes): quick checks, plus screenshots at four screen sizes if a screen changed.
  - **Normal:** quick checks, plus the tests for the parts the change touches.
  - **Risky** (market maths, play money, login, database structure, the core of the news engine, payments): the full test suite plus AI review.
  - **Production release:** everything, once.
  - Every change is labelled small, normal or risky.
- **Checks come first** (standing rule, 5 November 2026): every automatic check lands before the first change it checks, and when a check lands it also covers everything already built. In section 5, each check is a need of the steps it would check, so none of them can start without it. Code that starts somewhere the checks don't reach yet (a new folder or a new language) gets its checks first.
- **Staging** is a sandbox. The AI holds all of its keys. It is fully separate from production, holds no real user data, and every paid service on it has a spending cap. Auto mode stays on. From step 1.5d it's public at `staging.hrizzup.com`, so the app on a phone can reach it, and asks search engines to stay out; previews stay behind Vercel's login (founder's decision, 8 November 2026; blueprint section 6).
- **Production** runs on the same platforms as staging: Vercel plus Supabase, set up exactly like staging (same services, versions, region and settings), with its own data and keys. This "production twin" is created as soon as staging works, with nothing public until launch, so going live is a promotion, not a migration. The founder holds the production keys, and production starts clean.
- **Releasing** means promoting the exact production build of a commit that passed staging (`vercel promote`), through the release pipeline. Nothing is rebuilt, and going back is one step too.
- **Production is off-limits to the AI:** Claude Code never reads, holds or uses production keys. Production is changed only by the release pipeline, which gets its own production credentials in the production twin (runbook Part 10).
- **How a news feature is built** (founder's decision, 8 November 2026): in stages, tracked in [TRACKER.md](TRACKER.md). One phone-first design, then one contract (the typed API), then the back end. Then the screen stage splits in two: the website screen and the app screen, built at the same time in separate worktrees (each its own Claude Code session, branch and pull request) by the round's relays, from the design chat's approved design (founder's decision, 9 November 2026), both against the contract and its example data. The join comes next, on the website first, then in the app, so the website stays one stage ahead. A feature is done when it works on both. Claude Code moves each feature's stages in TRACKER.md in the pull request that finishes them.
- **Two tracks** (founder's decision, 8 November 2026): **design** runs in a dedicated design chat, led by the founder with Claude Code; **engineering** (the maths, the back end, the database, deployment, and joining the front end to the back end) runs in each round's chat. The two tracks meet at each feature's contract stage ([TRACKER.md](TRACKER.md), stage 2).
- **Phone first.** Every screen is checked at phone, tablet, laptop and large-monitor sizes.
- **Fast from day one.** Every page and screen is built to load fast and stay fast: caching in layers (device, edge, server, Upstash Redis, database), and a performance budget checked automatically on every pull request and measured on real users once live. Performance is part of "done", never a later fix. The full rules are in the blueprint, "Production quality".
- **Design** (founder's decision, 8 November 2026): Claude Code builds it from the founder's references (Mobbin and his own) and diagrams, on preview links, and refines it in conversation with him, in the design chat (step 1.4). It starts only from what he gives there: no session builds design directions, values or screens of its own choosing (founder's decision, 9 November 2026).
  - **The one exception: internal tools only admins see,** such as the market console (step 1.7c). They're plain: stock components, with no colours, type or layout of their own, picking up the design values once they exist (founder's decision, 9 November 2026).
  - **The core screens** are the board, a story page and a market page with placeholder questions. Whether the remaining screens are designed up front or feature by feature is settled in the design chat.
  - **Real code:** shared design values and real components (shadcn/ui on the website), on a page only previews show, filled with the agreement's example data. Approved screens become the start of the real screens.
  - **Values, not rules:** each colour, size, spacing, radius, typeface and icon is defined once in shared code (`product/packages/`) and used on both surfaces.
  - **Light and dark** versions from day one, following the device's setting.
  - **A design log** in the repository records every change.
  - **Checks** cover only speed, fit on every screen size and readable text. Taste is never a rule unless the founder makes one.
- **Build on standard, portable pieces.** AWS is not the production plan: it comes later only if a concrete need appears, as its own project.
- **Plugins:** security-guidance, code-review, frontend-design, feature-dev. **Connectors:** GitHub, Context7, Playwright.
- Nothing is maintained by hand.

---

## 4. Three projects, one codebase

| Project | Its job | What it produces |
|---|---|---|
| Sourcing | Design and run the Grok bots that find news and creators' takes on X; keep everything they find in the sourced pool; turn the news into stories and updates. The takes reach the feed by the found route | Stories, updates, the sourced pool |
| News Desk | Make our own content from the sourced pool (the made route) and onboard creators, who post in the app (the posted route) | Text, images, video |
| Product | Build the app, the website and the markets, with the data sources that settle the markets (step 1.2). It only displays content: the board shows stories, and the feed shows takes from all three routes, each credited by its route | The app, the website, the market data |

- There is one repository, one shared content store (a database plus storage for images and video, which also holds the sourced pool), and one written hand-over agreement ([agreement/README.md](agreement/README.md)) that defines exactly what each project passes to the others. It is signed off in two halves (step 0.7): the first was Agreed on 9 November 2026; the second isn't drafted yet.
- **Sourcing's review of the agreement's first half runs in the repository** (founder's decision, 8 November 2026): the founder carries no messages between projects, so a Claude Code session runs the review, working from Sourcing's brief, and records Sourcing's agreement or the changes it asks for. The founder then approved the first half in News Desk's place, and it was Agreed on 9 November 2026.
- **Sourcing's step 0.8 runs from the Product round chat** (founder's decision, 9 November 2026), as Round 3's relays, each working from Sourcing's brief: first the research (relay 4); then, once the founder has opened the xAI account with a low spending cap, a test bot run and the second half's draft (relay 10); then Product's review of that draft, in a separate session working from Product's brief (relay 11). The full schedule's spending is decided at step 1.1.
- Product owns the markets alone (founder's decisions, 5 and 8 November 2026): only Hrizzup creates them; Product settles them, by hand or through its own resolvers (steps 1.7c and 3.2a), and chooses their topics and data sources (step 1.2, parked until markets work end to end on staging).
- **Product works in two tracks** (founder's decision, 8 November 2026): design, in a dedicated design chat led by the founder with Claude Code; engineering (the maths, the back end, the database, deployment, and joining the front end to the back end), in each round's chat. They meet at each feature's contract stage (section 3).
- **News Desk is on hold** until the founder sets it up (founder's decision, 5 November 2026). Its steps (1.3 and 4.4) wait for it. So the hold doesn't block Product, the founder approved the agreement's first half in News Desk's place (9 November 2026); News Desk reviews it once it's set up, and any change it asks for follows the agreement's change rules.
- **Legal belongs to the founder's legal team** (founder's decision, 9 November 2026): takedown handling and legal review are theirs, and the product plan adds no legal guardrails.
- Projects never copy code between each other; the shared repository is the only route.
- **No relays** (founder's decision, 5 November 2026): the founder doesn't carry reports or messages between projects. Everything a thinking project needs goes into its brief.
- Each thinking project keeps only its brief in its knowledge: `docs/brief/sourcing.md`, `docs/brief/news-desk.md` or `docs/brief/product.md` (decided 4 November 2026). A brief stands on its own and replaces Claude Code's report: where things stand, the decisions in force, what changed in the latest session (with its pull request links), open questions (each with Claude Code's recommendation), what's next, and which repository files hold the detail. It stays under about 1,500 words and is rewritten, never appended. The project reads it after Sync now, instead of asking the founder for a report, and attaches repository files from GitHub when it needs detail.
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

Steps 0.4, 0.7 and 0.8 moved here from Phase 0 on 4 November 2026, keeping their numbers. Step 0.7 signs off in two halves, each with its own status, Draft and then Agreed (decided 5 November 2026). **The first half was Agreed on 9 November 2026,** the founder approving it in News Desk's place, so no step waits for it any longer, and Product may build tables and content for its shapes. Product builds against the agreement's first half (its shapes and example data), not against the other projects' output. Step 1.6 split into 1.6a (the website's sign-in) and 1.6b (the app's) on 8 November 2026, and Sign in with Apple moved to the iPhone build (4.3). Also on 8 November 2026 (founder's decisions): the rest of step 1.5 split into 1.5a to 1.5d, each needing the one before (the codebase itself, its first migration, which locks every table, and the Database check were set up on 3 November 2026, in runbook Part 9); step 1.7 split into 1.7a, the maths, which needs only 0.6, and the rest, now 1.7b to 1.7d in the markets' build order (section 2, "Markets"); step 1.2 is parked until markets work end to end on staging; Claude Code now builds the design (1.4) in real code, in the design chat, and its core screens are the board, a story page and a market page; and step 1.8, parallel local development, joined before the first feature round. On 9 November 2026 (founder's decisions): step 1.9, the content store's tables, joined Phase 1, and the news pipeline (1.1) and every news feature's back end build on it; step 1.8 gained the check that keeps database changes in order; 1.6a proves the sign-in flows on the sign-in test page, and the real sign-in screen comes from the design chat; 1.7c gained the market console's calls in the typed API (create, open, close and settle), leaving list, trade and positions to 1.7d; and step 0.8 runs as relays from the Product round chat (section 4). [TRACKER.md](TRACKER.md) shows everything that comes before the first feature round, and Round 3's queue.

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 0.4 | Register individual developer accounts: Google Play Console and the Apple Developer Program | Founder | — | Both accounts are active |
| 0.7, first half | The hand-over agreement's first half: exactly what a story, an update, a sourced item (one thing the bots found, as kept in the sourced pool), a creation and a market look like when they pass between projects, and how every feed item names its route (their shapes, with example data and a check on every pull request that keeps the two in step), and the launch list of locations and categories | Product drafts it; Sourcing reviews and agrees it, through a Claude Code session in the repository working from Sourcing's brief (founder's decision, 8 November 2026), and the founder approves it in News Desk's place while News Desk is on hold; News Desk reviews it once it's set up (founder's decisions, 5 November 2026); the founder approves the launch list | 0.6 | Agreed and saved in the repository (`agreement/`). **Done: Agreed on 9 November 2026,** the founder approving it in News Desk's place; from then on, Product may build tables and content for its shapes. (Until then, no project created tables for these shapes or wrote content in them.) |
| 0.7, second half | The hand-over agreement's second half: the Grok bots' result format, which is how the bots deliver their results to our pipeline. It carries creators' takes as well as news, and is kept separate from the sourced item, which is what the pipeline keeps after its checks. Designed only once the Sourcing project has chosen the Grok product and how the results reach our pipeline (0.8) | Sourcing designs it, through a relay working from Sourcing's brief (Round 3, relay 10); Product reviews and agrees it, in a separate session working from Product's brief (relay 11); News Desk doesn't need to agree it (founder's decisions, 5 and 9 November 2026) | 0.8's choice of Grok product and route | Agreed only after a real result from 0.8's test bot, carrying news and creators' takes, passes the agreement's own checks. **No bot result becomes content before this half is agreed.** |
| 0.8 | Choose the Grok product and plan that run the bots, and the route that brings their results to our pipeline (both decided in the Sourcing project), then set them up. The same research chooses the background-jobs tool (section 2, "Decided later") | Sourcing decides, through Round 3's relays working from Sourcing's brief (founder's decision, 9 November 2026): the research (relay 4); then, once the founder has opened the xAI account with a low spending cap, a test bot run (relay 10) | 0.2 | A test bot's result arrives by that route |
| 1.1 | News pipeline, first version: Grok bots read X on a schedule, find news and creators' takes on stories, and send results in the agreed format; our pipeline receives them automatically, by the route 0.8 chose, keeps what passes its checks in the sourced pool, writes updates from the news, groups them into stories with timelines, tags location and category, and saves them to the content store's tables (step 1.9). It runs on the background-jobs tool Sourcing's research chose, once Product has reviewed it, and the full schedule's spending is decided here (founder's decisions, 9 November 2026) | Sourcing | 0.7 (both halves), 0.8, 1.9 | Stories appear and update on their own on staging, and the takes the bots find wait in the sourced pool, each linked to its story |
| 1.2 | **Parked until markets work end to end on staging** (founder's decision, 8 November 2026). Topics and data sources: choose the topics, many copied from Kalshi's market formats, and the source each settles from, with its cost, including the perp's live Bitcoin price every few seconds. The readiness check's research (D2 to D4) is reference, not decisions | Product (founder's decision, 5 November 2026) | Markets working end to end on staging (3.1) | Every topic has a named settlement source, with its cost |
| 1.3 | Content formats, then the first batch of our own content for the launch categories, made from the sourced pool; a list of creators to invite | News Desk (on hold until the founder sets it up) | 0.7 (first half, Agreed); 1.1, for the first batch | Enough content to fill the feeds in the launch categories |
| 1.4 | Design: one phone-first design for the website and the app, built by Claude Code from the founder's references on preview links, in the design chat (section 3, "Two tracks" and "Design"). **Design starts only from the founder's references and diagrams, given in the design chat: no session builds design directions, values or screens of its own choosing** (founder's decision, 9 November 2026, after a first pass built from Claude Code's own picks was retired). It goes in passes: first the design values with the board and a story page at phone size; next the market page, with placeholder questions. These are the three core screens, all drawn from the agreement's shapes and example data; whether the remaining screens (the feed, the app frame and the rest) are designed up front or feature by feature is settled in the design chat (founder's decision, 8 November 2026). Its checks: speed (1.5a), fit on every screen size (the Screen check) and readable text in light and dark (the Speed check audits the text on every page, and the readable-text check in `@hrizzup/core` tests the design values' text colours once they exist) | Product's design track (the founder, with Claude Code) | 1.5a, before its page merges (checks come first); 0.7 (first half, Agreed), for the core screens | The founder approves the design values and the three core screens on preview links; approved screens become the start of the real screens |
| 1.5a | The speed check: performance budgets (blueprint section 14) measured on every pull request, starting with the website's pages; the app's own budget joins in 1.5d | Product | 0.6 | Every pull request that changes the website measures each page that exists against its budget on the preview, and fails when one is over |
| 1.5b | Journey tests on the website (Playwright) and in the app, including the app's first Maestro test (at phone and tablet sizes), on every pull request that changes them | Product | 1.5a | Every pull request runs the journeys of the pages and screens that exist, on the preview and on an Android emulator, and fails when one breaks |
| 1.5c | The typed API (oRPC, contract first, in `product/packages/api`: blueprint section 13), starting with calls that aren't content (health, who am I) | Product | 1.5b | The website makes a real call through it |
| 1.5d | The empty app on the founder's Android phone, answering from the typed API on staging, with its own budget (blueprint section 14, the app's column). Staging becomes public for it; if Vercel refuses, 1.5d narrows (blueprint section 6) | Product; the founder installs it | 1.5c | The app opens on the founder's phone and shows an answer from staging |
| 1.6a | The website's sign-in with Supabase Auth: Google first (working on staging), then email codes with the bot check (Turnstile); passwords refused by a Custom Access Token hook (blueprint section 9). It builds the sign-in flows and proves them on the existing sign-in test page; the website's real sign-in screen comes from the design chat, like any screen readers see (founder's decision, 9 November 2026) | Product | 0.6, 1.5c | Google and email-code sign-in work on staging's sign-in test page, a session made with a password is refused, and tests prove that email codes, Google and token refresh still work |
| 1.6b | The app's sign-in (app only): native Google sign-in, with its Android sign-in client and the app's signing fingerprint, and email codes with the bot check, on the same accounts as the website | Product | 1.5d, 1.6a | Sign-in works in the Android app, and the same account works on the website |
| 1.7a | Manifold's market maths, copied with its tests (MIT licence, its notice kept), plus our own tests that money in equals money out: buying, limit orders, selling, Yes and No cancelling out, and every kind of settlement. Code only, no tables | Product | 0.6 | Its tests run in our checks and pass |
| 1.7b | The ledger, around 1.7a's maths, in our own tables, not Manifold's database design: double-entry books in exact decimals (each person, each market's pool, and a house account that gives out starting balances and seeds new markets), with play-money balances, trades and positions. Each trade is one database transaction; trades on one market run strictly one after another; each trade request carries its own ID, so a retry never trades twice. The engine's results are rounded once, any remainder going to the house account; closing times and limit-order expiry are checked inside each trade. A trade never takes a balance below zero; only a cancelled market can, taking back sale profits, with the balance showing what's owed (section 2, "Markets"; founder's decisions, 9 November 2026) | Product | 0.6, 0.7 (first half, Agreed), 1.7a | On staging, each trade on a test market changes balances and positions in one step, and tests prove that money in equals money out (the books always sum to zero), that trades on one market never overlap, that a retried request never trades twice, and that no trade takes a balance below zero |
| 1.7c | Markets as data: each market's question, outcomes, rules, open and close times, named settlement source and status (draft, open, closed, settled or cancelled), created only by Hrizzup; settlement by hand, an admin-only action, with every settlement logged (who, when, the outcome and the evidence); the admins table, written only by reviewed migrations naming an account's ID, with staging's row (the founder's account); the market console, a plain internal tool where admins create, open, close and settle markets; and the console's calls in the typed API (create, open, close and settle), so every market write has one path, each checked by the database against the admins table (founder's decisions, 9 November 2026) | Product | 0.7 (first half, Agreed), 1.6a (the console's sign-in), 1.7b; 1.9 for the categories markets share | On staging, an admin creates, opens, closes and settles a test market by hand in the console, through the typed API; the payouts add up, and the log shows the settlement; everyone else gets "not found" for the console, and the database refuses them every create, open, close and settle |
| 1.7d | The engine's other calls in the typed API: list, trade and positions (create, open, close and settle came with 1.7c); the trade call refuses limit prices outside 1% to 99%, an expiry of zero, and amounts that aren't positive or that exceed the balance. Reads shaped by the market page's design (its price chart, for example) wait for 3.1's contract stage (founder's decisions, 9 November 2026) | Product | 1.5c, 1.7c | On staging, list, trade and positions work through the typed API on a test market, and the trade call refuses each of those inputs |
| 1.8 | Parallel local development: any number of sessions, each in its own worktree, can run the website, the app's dev server and the local database at once, without sharing ports or containers, and can sign in and upload locally; and a check that each pull request's database changes come after the newest one on `main`, so they reach staging and production in order (founder's decision, 9 November 2026; section 3) | Product | 0.6 | Three sessions do so side by side, and a pull request whose database changes don't come after the newest one on `main` fails its checks |
| 1.9 | The content store's tables: story, update, sourced item and creation, plus the launch list of locations and categories, with the agreement's rules as database rules: one item per post; an unavailable item keeps nothing of the post; merges never chain. Locked like every table. One test loads every example in the agreement and reads it back unchanged; another fails when the database's lists drift from `agreement/definitions/`. Nothing writes to them, reads them or fills them yet. The news pipeline (1.1) and every news feature's back end build on them, and the markets share their categories (founder's decision, 9 November 2026) | Product | 0.6, 0.7 (first half, Agreed), 1.8 | The tables are on staging, empty and locked; the Database check loads every agreement example and reads it back unchanged, refuses records that break those three rules, and fails when a list drifts from the agreement |

### Phase 2: News, on the website and in the app (most of the effort)

Steps 2.1 to 2.4 and 2.7 reach both surfaces, each through the stages in [TRACKER.md](TRACKER.md): design, contract, back end, then the website screen and the app screen at the same time, then the join on the website, then in the app (section 3). Steps 2.5 and 2.6 are app only (founder's decision, 8 November 2026). Every feature's back end builds on the content store's tables (step 1.9), and its database changes land in their own pull request before the code that uses them (section 3; founder's decisions, 9 November 2026).

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 2.1 | Board: Latest, Top and For You; location and general categories; favourites and bookmarks, for signed-in readers | Product | 0.7 (first half, Agreed), 1.4, 1.5d, 1.6a, 1.8; 1.9 for the back end; 1.6b for the app join (founder's decisions, 9 November 2026) | A reader can browse and shape their board, on the website and in the app |
| 2.2 | Story pages with timelines | Product | 0.7 (first half, Agreed), 1.4, 1.5d, 1.8; 1.9 for the back end | Every story shows how it developed, on the website and in the app |
| 2.3 | Feed and ranking, version one: takes from all three routes, each credited by its route (found posts embedded from X); picks, views, categories, follows; likes and dislikes; following creators | Product | 0.7 (first half, Agreed), 1.5d, 1.8, 2.1; 1.9 for the back end | The feed shows takes from all three routes on the stories a reader chose, each credited by its route, on the website and in the app |
| 2.4 | Posting (the posted route): text for everyone; creator accounts with image and video uploads; reporting posts and blocking users | Product | 0.7 (first half, Agreed), 1.5d, 1.6a, 1.8; 1.9 for the back end; 1.6b for the app | Users post text, creators post media, and any post can be reported, on the website and in the app |
| 2.5 | Notifications for breaking and developing stories (app only) | Product | 1.5d, 2.2 | Alerts arrive on an Android phone |
| 2.6 | The Android store build of everything above (app only: the app's screens are built with each feature); start the Google Play closed test as soon as the build is usable. This is where real people first see real news, so it needs the news pipeline and our own content | Product, Founder | 1.1, 1.3, 2.1–2.5 | A closed test is running with 12 or more real testers |
| 2.7 | Paid tier: decide what's free and what's paid, then build subscriptions (RevenueCat in the app; Razorpay with UPI on the website, passed through our server). It follows the closed test's start, so the Google Play clock isn't held up | Product, Founder | 1.5d, 1.6a, 1.6b, 1.8 | A tester can subscribe in the Android app and on the website, and both show the same paid status |

### Phase 3: The markets website (website only; runs alongside the second half of Phase 2)

The markets follow the founder's build order (section 2, "Markets"; 8 November 2026): the engine (1.7a to 1.7d), then the market pages (3.1), on test markets with placeholder questions, with the perp built alongside against a stand-in price (3.4a). Once markets work end to end on staging (3.1's done test), the topics come: step 1.2 (parked until then), automatic resolvers (3.2a), series (3.2b) and the perp's real price feed (3.4b). Steps 3.2 and 3.4 split on 8 November 2026, keeping their needs. [TRACKER.md](TRACKER.md) shows the markets track step by step.

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 3.1 | Market pages in Kalshi's layout with our own look, on test markets with placeholder questions; a starting balance on signup, from the house account. Reads shaped by the page's design (its price chart, for example) join the typed API at its contract stage (founder's decision, 9 November 2026) | Product | 1.4, 1.5c, 1.7d | On staging, a new visitor can sign in, place a bet in a few taps and see the position, and an admin settles the market by hand, with the payouts adding up: markets work end to end |
| 3.2a | Automatic resolvers: for each topic, a resolver we choose reads the source named in the market's rules at the closing moment and settles the market, logged like a settlement by hand | Product | 1.2, 1.7c | A market settles itself at its closing moment from the source its rules name, and the settlement is in the log |
| 3.2b | Series: templates for recurring questions, so a new market opens as each one closes | Product | 3.2a | Markets open, run and settle with no one touching them |
| 3.3 | Link markets and the website's news (built in Phase 2) through shared categories | Product | 1.5c, 2.1, 3.1 | A visitor can move between a market and its news |
| 3.4a | Perps: one Bitcoin perp in play money, built against a stand-in price: Manifold's perps maths with its tests, a new price and a liquidation check every few seconds through Supabase Cron, the starting rules (10 times leverage at most, filling at the next price, an opening fee, an off switch) and the rule-change log (founder's decisions, 8 November 2026) | Product | 1.7d, 3.1 | On staging, a visitor can open and close the perp against the stand-in price; orders fill within seconds; liquidations and funding run with no one touching them; every rule change is in the log |
| 3.4b | The perp's real price feed: the live Bitcoin price from the source step 1.2 chooses replaces the stand-in, so the perp prices itself continuously | Product | 1.2, 3.4a | The perp prices itself from the live feed on staging, and orders still fill within seconds |

### Phase 4: Polish and launch preparation

| # | Activity | Who | Needs | Done when |
|---|---|---|---|---|
| 4.1 | Every screen checked at four sizes; full test suite on risky areas; security review | Product | Phases 2 and 3 | Nothing blocking launch |
| 4.2 | Privacy policy and terms of use; reporting and blocking confirmed (both required by the app stores) | Founder, Product | 2.4 | Both published and linked inside the app |
| 4.3 | iPhone build from the same app code: it adds only Sign in with Apple (in the app, and on the website so the same account works there) and Apple's review, through TestFlight and the App Store (founder's decision, 8 November 2026) | Product, Founder | 0.4, 1.6b, Phase 2 | iPhone app approved |
| 4.4 | Creators onboarded through creator accounts; our own content loaded | News Desk (on hold until the founder sets it up), Founder | 1.3, 2.4 | Feeds are full in every launch category |
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
- **Paid services** (video hosting; the data feeds, once step 1.2 chooses them): open the accounts early, each with a spending cap.

---

## 7. Open: to settle inside the projects

- Which Grok product and plan run the bots, and the route that brings their results to our pipeline (step 0.8, decided in the Sourcing project, through Round 3's relay 4)
- How the Grok bots are set up, how often they run, and the fixed format of their results (step 0.7's second half, drafted for the Sourcing project by Round 3's relay 10 and reviewed for Product by relay 11, and 1.1). Each run starts fresh, so matching new items to existing stories happens in our pipeline. The full schedule's spending is decided at step 1.1.
- Confirm that the chosen Grok product's terms allow its results to feed a public app (step 0.8)
- The topics and their data sources (step 1.2, decided in the Product project; parked until markets work end to end on staging): which markets we run and their exact questions, many copied from Kalshi's market formats, and the source each settles from, with its cost, including the perp's live Bitcoin price. The readiness check's research is reference, not decisions
- Background jobs: which tool runs scheduled and queued work (decided in the Sourcing project's research for step 0.8, Round 3's relay 4, and reviewed by Product before the news pipeline, step 1.1, uses it); it must cover the automatic resolvers (step 3.2a), while the perp (step 3.4a) stays on Supabase Cron. None run in Round 3
- Whether the screens beyond 1.4's three core screens are designed up front or feature by feature (settled in the design chat)
- How the app shows the bot check (Turnstile) on its email-code screen (step 1.6b)
- Feed design in depth, including how found posts are embedded from X and how each route is credited (step 2.3)
- Paid tier: what's free and what's paid (decided before the paywall is built, step 2.7)
- Comment threads
