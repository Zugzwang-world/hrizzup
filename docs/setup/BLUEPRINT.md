# Hrizzup: setup blueprint

> This blueprint says how every account and service is set up for Hrizzup. It is built from the Zugzwang World setup inventory (2 November 2026) and PLAN.md.
> Claude Code commits it to `docs/setup/BLUEPRINT.md`. On the day it sets each value, it also records that value in `docs/setup.md`.
> Secrets never go in either file.

Status: proposed, 2 November 2026, and updated the same day with the founder's decisions. No **DECIDE** items remain open.

---

## 1. Rules carried over from Zugzwang World

| Rule | What happened last time |
|---|---|
| Staging and production never share anything: keys, storage buckets, Redis databases, Sentry and PostHog projects, Google sign-in clients, Turnstile widgets, email keys or AI keys | Staging wrote to production storage with production keys for months. The Redis, Google, PostHog, Resend and OpenAI keys were still shared at the end. |
| Doppler is the only place a secret is created or changed, and every platform syncs from it | Platform variables edited by hand were silently overwritten. A variable set only in Vercel made the daily audit fail for five weeks. Sentry keys lived outside Doppler and were lost in the AWS move. |
| Every secret change is followed by a redeploy | Platforms copy the variables into each deployment, so a change does nothing until the next one. |
| The region is set in code and shown on the health page | Functions ran in Washington against a Mumbai database for three months before anyone noticed. |
| Plans are chosen before anything is sized | AWS's Free plan refused an instance type in the middle of a deploy. The databases sat on the smallest default sizes by accident. |
| Every setting made only in a dashboard is written into `docs/setup.md` on the day it is set | Most of the unknowns in the inventory were dashboard settings nobody recorded. |
| Security settings are on from day one, and checked through the API. Only the founder-held production keys wait until just before real users arrive (runbook, "Production hardening") | The repo claimed branch protection for 11 days when none existed. Secret scanning, push protection and the organisation's 2FA requirement were never switched on. |
| Previews never touch production data and are never public | Every preview address was public and connected to the production database. |
| No sign-in on preview deployments | Google sign-in on previews never worked. Testing used the fixed staging address instead. |
| A failing job is fixed or switched off the same day | Two scheduled jobs failed every day for weeks without anyone looking. |
| Teardown is planned as carefully as a launch | The experiment left DNS records pointing at deleted servers, syncs still running, AWS resources kept after deletion, and no record of any of it. |

---

## 2. Accounts and plans

Default to paid tiers. The exception is Cloudflare, which stays on its Free plan during staging.

| Service | Plan | Used for |
|---|---|---|
| GitHub | The founder's personal account `Zugzwang-world`, on **GitHub Pro**, with the **private** repo `hrizzup`. Pro covers the repository protections used on `main` (section 11), but not GitHub's own secret scanning or push protection for private repos: an open-source secret check runs on every pull request instead. | Code, pull requests, checks |
| Vercel | Pro (the existing team), with one project `hrizzup` for previews, staging and production. Pro includes the one custom environment that staging needs. | Previews, staging and production |
| Supabase | Pro (the existing organisation), with two projects set up the same way in Mumbai (ap-south-1): `hrizzup-staging` and `hrizzup-production` | Staging and production databases |
| Doppler | Team plan. It adds service accounts and audit features; the free tier forced the audit to be cut back last time. | All secrets |
| Cloudflare | A zone for `hrizzup.com` on the **Free** plan during staging, upgraded to **Pro** in the production twin (runbook Part 10). Image transformations are free up to 5,000 new sizes a month; the production twin also turns on Cloudflare Images' paid plan, so new sizes never fail (section 13). Its protection covers the names routed through Cloudflare, such as the public storage addresses; the app's own names point at Vercel, DNS only (section 4). Cloudflare Stream, for creator video, lives in the same account and is billed by minutes stored and watched; it is switched on when creator video is built. | DNS, file storage (R2), image delivery, video (Stream), Turnstile |
| Proton | Duo (existing) | Email on hrizzup.com, plus a Proton Pass vault named `Hrizzup` |
| Resend | Paid plan (existing). The free plan stops at 100 emails a day. | Sign-in and notification email |
| Upstash Redis | Paid plan (existing), with one database per environment, in the region closest to Mumbai | The shared fast layer: feeds, rankings, counters, sessions, rate limits, computed results, locks (section 14) |
| Sentry | Later, set up with the team: Team plan, one project per environment | Error reporting |
| PostHog | Later, set up with the team: one project per environment | Analytics and feature flags |
| RevenueCat | Set up with the app (version one, PLAN.md step 2.7) | Subscriptions in the app |
| Razorpay | Set up with the app (version one, PLAN.md step 2.7) | Subscriptions on the website, with UPI |
| Google Cloud | One project with separate sign-in (OAuth) clients for staging and production, and billing switched on | Google sign-in |
| Apple Developer | Individual account | The iPhone app and Sign in with Apple |
| Google Play | Personal account | The Android app |
| SuperGrok | Existing | The Grok bots that find news |
| AWS | Not the production plan. Later, only if a concrete need appears, as its own project (section 12) | — |

---

## 3. Environments

Production is a twin of staging: the same services, versions, region and settings, with its own data and keys.

| | Local | Preview | Staging | Production |
|---|---|---|---|---|
| Address | localhost | Vercel preview URLs | `staging.hrizzup.com` | `hrizzup.com` (holding page until launch) |
| Deployed from | Your machine | Each pull request | Every merge to `main` | Every merge to `main`, as a hidden build; it goes live only when promoted |
| Hosting | Your machine | Vercel | Vercel | Vercel |
| Doppler config | `dev` | `preview` | `stg` | `prd` |
| Database | Staging | Staging | Supabase `hrizzup-staging` | Supabase `hrizzup-production` |
| Sign-in | Test accounts only | None | Google (staging client) and email | Google (production client), email, Apple |
| Access | — | Vercel deployment protection | Protected until testers join | Holding page until launch, then public. Hidden builds stay private |

---

## 4. Domain and DNS (Cloudflare, hrizzup.com)

- **At GoDaddy:** transfer lock, two-step login and auto-renew all on.
- **Nameservers move to Cloudflare before any record is added.**
- **DNSSEC on.** Switch it on in Cloudflare, then add the DS record Cloudflare gives you at GoDaddy. Last time DNSSEC ended up off, with no record of why.
- **No CAA records during staging.** At launch, add a complete set naming every certificate authority that Cloudflare and Vercel use (check each provider's current list at the time). Last time a missing entry blocked an AWS certificate.
- **No certificate to buy.** Vercel and Cloudflare issue and renew certificates automatically.
- **A Cloudflare API token** limited to hrizzup.com's DNS and to R2, kept in Doppler. Claude Code uses it to add DNS records and record them itself, instead of anyone typing them into the dashboard.
- **Email records:**
  - Proton: verification, MX, SPF and the three DKIM records.
  - DMARC: `v=DMARC1; p=quarantine`, with alignment left at its relaxed default.
- **Resend:** a sending subdomain (for example `mail.hrizzup.com`), with the DKIM and bounce records exactly as Resend shows them.
- **`staging`:** points at Vercel, DNS only.
- **The bare `hrizzup.com` and `www`:** production's names, pointing at Vercel, DNS only. Until launch they show a holding page, which carries the privacy policy that Google sign-in and the app stores ask for.
- **The app's names are never proxied through Cloudflare,** on staging or production. Vercel advises against putting another proxy in front of it, and its own firewall and DDoS protection cover the app.
- **Storage (R2):**
  - two buckets per environment: staging, and production in the production twin;
  - public files are served from a single-level subdomain: `media-staging.hrizzup.com` for staging and `media.hrizzup.com` for production. Cloudflare's standard certificate covers only one level below the domain, and `r2.dev` addresses are rate-limited;
  - bucket CORS and lifecycle rules are written into the repo, and both environments use the same ones;
  - images are processed and delivered as described in section 13.
- **Logging:** every record added or removed is logged in `docs/setup.md`. When a service is removed, its records go with it, so nothing points at a server that no longer exists.

---

## 5. Database (Supabase, staging and production)

- **Projects:** `hrizzup-staging` and `hrizzup-production`, both in Mumbai (ap-south-1), on the same Postgres version, compute size and settings. Production starts empty.
- **Compute size:** chosen on purpose, not left at the default.
- **Connection:**
  - Connect through Supabase's pooler, because the direct address only works over IPv6.
  - From Vercel's serverless functions, use transaction mode (port 6543) with prepared statements off.
  - Keep each instance's connection pool small (last time it ended at `max: 2`), and set the idle and lifetime timeouts explicitly.
  - The connection mode is stated in configuration, never guessed.
- **Migrations:** the same migrations run on both, staging first. A release's database changes reach production before its build is promoted, written so the version that is live keeps working with them.
- **Backups:** point-in-time recovery on for both, plus one test restore before launch. No restore was ever tried last time.
- **Spending:** spend cap off, usage alerts on. A billing limit must never take the site offline.
- **Extensions:** only what the code needs, the same on both. Scheduled jobs inside the database run in the app's own database.

---

## 6. Hosting (Vercel: previews, staging and production)

- **Region:** Mumbai, set in `vercel.json`. `/api/health` shows the region and the commit it was built from.
- **One project, three environments:**
  - **Preview:** every pull request, Doppler `preview`, behind deployment protection.
  - **Staging:** a custom environment named `staging`, deployed on every merge to `main`, Doppler `stg`, at `staging.hrizzup.com`. It uses the staging environment's branch tracking if Vercel allows it on the production branch; otherwise a deploy workflow kept in the repo.
  - **Production:** Doppler `prd`, at `hrizzup.com`. The production branch is `main`, with **Auto-assign Custom Production Domains off**. Every merge to `main` makes a hidden ("staged") production build with production keys and data, reachable only at its private address. Nothing goes live until it is promoted.
- **Build-skip rule (Ignored Build Step):** written in the repo, not only in the dashboard.
- **Deployment protection:** Standard Protection, which keeps previews and the private addresses of hidden production builds behind Vercel's login.
- **Firewall:** rules set and recorded, for staging and production.
- **Environment variables:** only from Doppler syncs, marked Sensitive. None are created by hand. If an integration writes keys straight into Vercel (Sentry, for example), those keys are also added to Doppler.
- **Scheduled jobs:** declared in `vercel.json`.
- **`autoAssignCustomDomains` stays off,** checked before every release and recorded. Last time it switched itself back on twice; here that would put every merge live without a release.

### Releasing

- **Why the hidden production build:** Vercel puts each environment's keys into its build. Promoting a staging or preview build makes Vercel rebuild it with production keys, so it would no longer be the build that was checked. The build that goes live is therefore the hidden production build of the commit that passed staging: built once, checked, then promoted untouched.
- **How a release goes:**
  1. The commit has passed staging.
  2. Its database changes, if any, are applied to production first (section 5).
  3. Claude Code checks that the hidden build's private `/api/health` shows that commit and Mumbai.
  4. One command: `vercel promote <address of the hidden build> --yes`. It goes live instantly, with no rebuild.
  5. The release counts as done only when `hrizzup.com/api/health` shows that commit.
- **Going back:** `vercel rollback`, also instant, with no rebuild.
- **Before launch:** `hrizzup.com` shows the holding page, so the first promotion of an app build is the launch.

---

## 7. Secrets (Doppler)

- **Project:** `hrizzup`, with four configs: `dev`, `preview`, `stg` and `prd`.
- **Syncs:** `stg` goes to Vercel staging, `preview` to Vercel previews, and `prd` to Vercel production.
- **No variables made by hand on any platform**, and every change is followed by a redeploy.
- **Every secret exists separately for each environment** (rule 1).
- **Production keys:** before real users arrive, every production key is replaced with a new one that only the founder holds, and Claude Code's access to `prd` is removed (runbook, "Production hardening").
- **Pitfalls from last time:**
  - the configs are named `stg` and `prd`, not `staging` and `production`;
  - `doppler configure --json` prints the access token;
  - wrap commands so that variables are filled in inside Doppler, not in your own terminal.

---

## 8. Email

- **Proton:** the address you choose plus a contact address on hrizzup.com. DMARC reports go to one of them.
- **Resend Pro:**
  - a verified sending subdomain;
  - separate API keys for staging and production;
  - bounce notifications (webhooks) set up;
  - start sending real mail weeks before launch, so the domain builds a reputation.
- **Production refuses to start** if it's set to Resend's test sender.

---

## 9. Sign-in and abuse protection

- **Google:**
  - separate sign-in clients for staging and production, with only fixed addresses registered;
  - the consent screen published as "In production" before launch, and tested with an account that isn't on the test list.
- **Apple:** Sign in with Apple wherever Google sign-in appears on iPhone.
- **Turnstile:**
  - one widget per environment;
  - the real widget actually on the page;
  - production refuses test keys, and is proven to reject a fake token.
- **Every route that can send email** is rate-limited and protected by Turnstile.

---

## 10. Monitoring (later, set up with the team)

- **Sentry:**
  - projects `hrizzup-staging` and `hrizzup-production`;
  - keys in Doppler;
  - source maps uploaded, so errors point at real lines of code;
  - production performance tracing sampled rather than recording every request;
  - no email addresses in URLs.
- **PostHog:** separate staging and production projects.
- **Budget alerts** on every paid service.
- **Alerts reach a real inbox.** Last time, staging alarms went to no one.

---

## 11. GitHub

- **Where the repo lives:** the founder's personal GitHub account, `Zugzwang-world`, on GitHub Pro.
- **Account and access:**
  - two-step login on for the account, with recovery codes in Proton Pass;
  - every person on their own account, added to the repo one by one, with two-step login on;
  - on a personal account every collaborator can push (there is no read-only role), so only people who change the code are added;
  - unused collaborators removed.
- **Repo:** `hrizzup`, private, at `github.com/Zugzwang-world/hrizzup`.
- **How changes land (from now on, including staging):**
  - every change goes on its own branch and pull request;
  - Claude Code opens it, the checks that fit the change run, and it merges as soon as they pass (auto-merge). No human approval;
  - once Vercel is connected, every pull request gets a preview link.
- **Secret check:** gitleaks runs on every pull request over the whole history (`.github/workflows/secret-check.yml`), at a pinned version with its checksum checked. It was also run once over the whole history on 2 November 2026.
- **Ruleset "main":** a pull request is required (no reviews), the "Secret check" must pass, force-pushes and deleting `main` are blocked, and nobody bypasses it. More required checks are added as the checks sized to the change are built (PLAN.md step 0.6).
- **Merging:** squash merges only (the pull request title, with its size label, becomes the commit title), auto-merge on, and branches deleted after merging.
- **Dependabot:** alerts and security updates on.
- **Every setting above is confirmed through GitHub's API** and recorded in `docs/setup.md`.
- **What GitHub Pro doesn't include for a private repo:** GitHub's own secret scanning and push protection (only organisation plans can add them). So a secret pushed to a branch reaches GitHub before the secret check flags it; the check keeps it out of `main`. If it ever fires, the key is replaced, not just deleted from the file.
- **Environment names:** pick ones that don't collide with the names Vercel creates (`Production`, `Preview`), for example `hrizzup-staging` and `hrizzup-production`.

---

## 12. AWS

AWS is not the production plan. Production runs on the same platforms as staging (Vercel and Supabase). AWS comes later only if a concrete need appears, as its own project, planned at that time. The lessons from the experiment's AWS setup are in this file's history (version of 2 November 2026).

---

## 13. App building blocks (decided 2 November 2026)

- **Codebase:** one repo holds the Expo (React Native) app and the Next.js website, sharing code between them, with one typed API that both use. The package manager and how the code is split up are settled when the codebase is set up (PLAN.md step 1.5).
- **Live updates:** Supabase Realtime, for market prices and new posts. Which tables send live updates is set in migrations, so staging and production match.
- **Search:** the database's own text search (Postgres full-text search) from day one, set up in migrations.
- **Shared links open the app:** Android App Links and iOS Universal Links. The website serves `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` on `hrizzup.com` (and on staging, for the staging app). They need the app's signing fingerprint and Apple team ID from the Google Play and Apple Developer accounts.
- **Automatic tests of core journeys:** Playwright for the website and Maestro for the app. Each becomes a required check in the ruleset "main" once built.
- **Images:**
  - **Upload:** the app uploads to the private uploads bucket. Our server then strips location data, fixes rotation, caps the size and makes a tiny blurred placeholder, which is saved with the post. It writes one original to the public media bucket, and the raw upload is deleted (lifecycle rule). The work happens on the server because a phone can't be trusted to remove location data; the app also shrinks photos before uploading, to save mobile data.
  - **Delivery:** Cloudflare image transformations with `format=auto`, resized per screen from a short fixed list of widths, and cached at Cloudflare's edge. They are requested on the media addresses (`media-staging.hrizzup.com`, `media.hrizzup.com`), which run through Cloudflare. The app's own names point at Vercel, DNS only, so transformations can't run there.
  - **Only our own images** can be transformed ("resize images from any origin" stays off), so nobody can use Hrizzup as a free image service.
  - **Website:** Next.js images with a custom loader that points at Cloudflare, so Vercel's own image optimisation is neither used nor billed. **App:** Expo's image component (`expo-image`) with the placeholder.
  - **No conversion scripts,** and no stored copies at other sizes.
  - **Cost:** Cloudflare's free allowance is 5,000 new sizes (unique transformations) a month. Past that, sizes already made keep loading but new ones fail until Cloudflare Images' paid plan is on ($0.50 per 1,000 more). Staging stays within the free allowance; the production twin turns the paid plan on. The fixed list of widths keeps the count low.
- **Video:** creator videos are stored and played through Cloudflare Stream, in the same Cloudflare account.
  - **Upload:** the app uploads straight to Stream through a one-time upload address that our server creates, so large files never pass through our server.
  - **Playback:** adaptive streaming (HLS and DASH), so each viewer gets the quality their connection can carry, with Stream's thumbnails as the still image before playback.
  - **Only on our own sites:** each video's allowed origins are set to our addresses, so others can't embed it.
  - **Staging and production kept apart (rule 1):** one Stream library in the account, but separate API tokens per environment, and every video is tagged with its environment.
- **Paid tier (version one, PLAN.md step 2.7):** subscriptions are built together with the app: RevenueCat in the app, Razorpay (with UPI) on the website. RevenueCat's own web payments run on Stripe and have no Razorpay connection, so our server passes Razorpay payments to RevenueCat, and the app and the website agree on who has paid. What's free and what's paid is decided before the paywall is built.
- **Decided later:**
  - **Background jobs:** decided in the Sourcing project.
  - **PostHog and the admin page:** later.
  - **Language:** English only.

---

## 14. Production quality

Every page of the website and every screen of the app is built to load fast and stay fast, from day one. Performance is part of "done", never a later fix.

### Caching in layers

Caching is designed in for every page and every API from the start, not added afterwards.

| Layer | What it holds | How it stays correct |
|---|---|---|
| **The device** | Browser and app caches. Long-lived files (code, fonts, icons) get versioned names, so they can be cached for a year. The app keeps recent data and images on the phone | A new version means a new file name, so nothing stale is ever served. Data on the phone is shown at once and refreshed in the background |
| **The edge** | Public pages at Vercel's edge; images, video and other media at Cloudflare | Refreshed in the background ("stale-while-revalidate"), and cleared by tag the moment the page's data changes |
| **The server** | Data caches for the results pages and APIs build | Updated or cleared the moment the underlying data changes (tagged caches, cleared on write) |
| **Upstash Redis** (paid plan, closest region to Mumbai) | The shared fast layer for anything read often: feeds, rankings, counters, sessions, rate limits and computed results | Every entry has an explicit expiry, and is cleared or rewritten when its data changes |
| **The database** | The source of truth | An index for every search and sort, page-by-page loading (each page starts where the last one ended, not by counting rows), and no repeated small queries |

**Rules for every layer:**
- **Batch:** never make several separate trips to Redis or the database when one batched request will do (one multi-key read or pipeline for Redis; one query with a join or a list of IDs for the database).
- **Private data is never shared:** one user's private data never goes into a shared cache. Pages with private data are marked so the edge doesn't keep them. Cache keys always include the environment (for example `stg:` or `prd:`), and the user where needed.

### Media

- **Images** are always resized and served in modern formats through Cloudflare's image service (section 13).
- **Video** plays through adaptive streaming on Cloudflare Stream (section 13).
- **Anything below the visible screen loads later,** when the user scrolls near it.

### Lists and feeds

- **Draw only what's on screen:** long lists recycle their rows (a virtualised list) on the website and in the app.
- **Load the next page before the user reaches it,** so scrolling never stops to wait.

### Performance budgets

Every page and screen has a budget. The starting numbers below are Google's "good" thresholds, measured on a mid-range Android phone on a slow 4G connection, because that is the typical reader in India. Changing a budget is a decision recorded in `docs/setup.md`.

| What | Website (every page) | App (every screen) |
|---|---|---|
| **Load time** | Largest content on screen within 2.5 seconds | First content within 2 seconds of a cold start |
| **Responsiveness** | Every tap or click answered within 200 milliseconds | Every tap answered within 100 milliseconds; scrolling at 60 frames a second |
| **Layout stability** | Layout shift score of 0.1 or less (nothing jumps while loading) | Nothing jumps while loading (placeholders hold the space) |
| **Download size** | At most 200 KB of compressed code, and 500 KB in total, on first load, before images below the screen | The data for a screen's first view under 100 KB before images; the app's code size checked for unexplained growth |

- **On every pull request:** the budgets are checked automatically. On the website, a Lighthouse check runs against the pull request's preview link, alongside a download-size check. In the app, there are code-size checks and automatic performance tests. Each becomes a required check in the ruleset "main" once it is built (PLAN.md step 0.6).
- **Once live:** the same measures are taken from real users, at the 75th percentile: Vercel Speed Insights for the website, and the monitoring tool for the app (section 10). A budget broken for real users is treated like a failing check.

---

## 15. Order of setup

1. **Domain and DNS:** add the zone to Cloudflare (Free plan), set the nameservers at GoDaddy, turn on DNSSEC, and create the Cloudflare API token. At the same time: check two-step login on your GitHub account, create the repo in that account (GitHub Pro), run the first Claude Code session, so every setting has somewhere to be recorded, then turn on Dependabot, the secret check on every pull request and the rule for `main`.
2. **Email:** the Proton domain, addresses and DMARC record, then Resend's sending subdomain.
3. **Doppler:** the project and its four configs. Move every key saved so far into it.
4. **Supabase:** the staging project.
5. **Storage and bot protection:** the staging R2 buckets and their public subdomain, image transformations for the zone, and the staging Turnstile widget.
6. **Redis and sign-in:** the staging Upstash database and the staging Google sign-in client.
7. **Vercel:** the project, once the first app exists, synced from Doppler, with `staging.hrizzup.com`, hidden production builds and the holding page on `hrizzup.com`.
8. **Production twin:** as soon as staging works, the production copy of every staging service, with Doppler `prd` synced to Vercel production. `hrizzup.com` moves to Cloudflare Pro, and Cloudflare Images' paid plan is turned on. Nothing public until launch.
9. **Later, with the team:** Sentry, PostHog, the Apple and Google Play accounts. Before real users arrive: the production hardening in the runbook.
10. **Throughout:** Claude Code records every setting in `docs/setup.md`.
