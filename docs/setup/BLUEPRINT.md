# Hrizzup: setup blueprint

> This blueprint says how every account and service is set up for Hrizzup. It is built from the Zugzwang World setup inventory (2 November 2026) and PLAN.md.
> Claude Code commits it to `docs/setup/BLUEPRINT.md`. On the day it sets each value, it also records that value in `docs/setup.md`.
> Secrets never go in either file.

Status: proposed, 2 November 2026, and updated with the founder's decisions and the setup as built since (latest 3 November 2026, runbook Part 9). No **DECIDE** items remain open.

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
| Previews are complete working copies, sign-in included, and a change is checked on its preview, never by putting it on staging | Google sign-in on previews never worked, so testing used the fixed staging address instead, and unfinished work had to go onto staging to be checked. |
| A failing job is fixed or switched off the same day | Two scheduled jobs failed every day for weeks without anyone looking. |
| Teardown is planned as carefully as a launch. What Zugzwang World still has in shared accounts is in the retirement list, `docs/setup/RETIREMENT.md` | The experiment left DNS records pointing at deleted servers, syncs still running, AWS resources kept after deletion, and no record of any of it. |

---

## 2. Accounts and plans

Default to paid tiers. The exceptions are Cloudflare and Doppler, which stay on their free plans: Cloudflare until the pre-launch checklist (runbook), Doppler until a helper joins it. The production twin adds no paid extras until launch (founder's decision, 3 November 2026).

| Service | Plan | Used for |
|---|---|---|
| GitHub | The founder's personal account `Zugzwang-world`, on **GitHub Pro**, with the **private** repo `hrizzup`. Pro covers the repository protections used on `main` (section 11), but not GitHub's own secret scanning or push protection for private repos: an open-source secret check runs on every pull request instead. | Code, pull requests, checks |
| Vercel | Pro (the existing team), with one project `hrizzup` for previews, staging and production. Pro includes the one custom environment that staging needs. | Previews, staging and production |
| Supabase | Pro (the existing organisation), with two projects set up the same way in Mumbai (ap-south-1): `hrizzup-staging` and `hrizzup-production` | Staging and production databases, and sign-in (Supabase Auth, section 9) |
| Doppler | The free **Developer** plan during staging: free for 3 users (then $8 a month each) and up to 5 syncs, of which staging uses 2, and 10 projects. Secret references, which `dev` uses to follow staging, are included. Only the founder and Claude Code use it until the upgrade; Claude Code through its own service tokens, one per config, which can't open `prd` (section 7). Upgraded to **Team** ($21 per user a month) before a helper first needs Doppler: the Team plan's roles let the founder keep production keys to himself once helpers use Doppler (section 7). Team also adds service accounts and audit features; the free tier forced the audit to be cut back last time, so until the upgrade the daily audit stays within what the free plan offers. | All secrets |
| Cloudflare | A zone for `hrizzup.com` on the **Free** plan, upgraded to **Pro** before launch (runbook, pre-launch checklist). Image transformations are free up to 5,000 new sizes a month; the pre-launch checklist also turns on Cloudflare Images' paid plan, so new sizes never fail (section 13). Its protection covers the names routed through Cloudflare, such as the public storage addresses; the app's own names point at Vercel, DNS only (section 4). Cloudflare Stream, for creator video, lives in the same account and is billed by minutes stored and watched; it is switched on when creator video is built. | DNS, file storage (R2), image delivery, video (Stream), Turnstile |
| Proton | Duo (existing) | Email on hrizzup.com, plus a Proton Pass vault named `Hrizzup` |
| Resend | Paid plan (existing). The free plan stops at 100 emails a day. | Sign-in and notification email |
| Upstash Redis | One database per environment in AWS Mumbai (`ap-south-1`): `hrizzup-staging` on **Fixed 1GB** ($20 a month), a fixed price with **no per-command charges**, so load tests can't run up a bill by the number of commands; `hrizzup-production` on **pay as you go** until launch (no users, so next to nothing), moved to Fixed 1GB with auto-upgrade on in the pre-launch checklist (section 14, "Redis (Upstash)") | The shared fast layer: feeds, rankings, counters, sessions, rate limits, computed results, locks (section 14) |
| Sentry | Later, set up with the team: Team plan, one project per environment | Error reporting |
| PostHog | Later, set up with the team: one project per environment | Analytics and feature flags |
| RevenueCat | Set up with the app (version one, PLAN.md step 2.7) | Subscriptions in the app |
| Razorpay | Set up with the app (version one, PLAN.md step 2.7) | Subscriptions on the website, with UPI |
| Google Cloud | Two projects, both owned by the **Hrizzup Google account** (`hrishikesh@hrizzup.com`), not the Zugzwang World one: **`hrizzup`** (ID `hrizzup-513610`) for staging's sign-in client, with billing on, and **`hrizzup-production`** for production's (founder's decision, 3 November 2026). Each has its own consent screen, so publishing production's never opens staging to every Google account, and staging's Supabase address never blocks production's branding. Both stay in Testing until the pre-launch checklist | Google sign-in |
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
| Deployed from | Your machine | Each pull request | Every merge to `main`, after its migrations (the Staging workflow moves the `staging` branch, which Vercel's `staging` environment follows, and asks Vercel to build it) | Every merge to `main`, as a hidden build; it goes live only when promoted |
| Hosting | Your machine | Vercel | Vercel | Vercel |
| Doppler config | `dev` (refers to `stg`'s values) | `stg_preview` (a branch of `stg`) | `stg` | `prd` |
| Database | Staging | Staging | Supabase `hrizzup-staging` | Supabase `hrizzup-production` |
| Redis | Staging's, keys starting `dev:` | Staging's, keys starting `pre:` | Upstash `hrizzup-staging`, keys starting `stg:` | Upstash `hrizzup-production`, keys starting `prd:` |
| Sign-in (Supabase Auth, section 9) | Staging's: Google test users and email codes, returning to `http://localhost:3000` | Staging's: Google test users, returning through staging's signed relay; Turnstile's test keys | Google (staging client) and email codes | Google (production client), email codes, Apple |
| Access | — | Vercel login (deployment protection); checks use the protection bypass | Vercel login until testers join | Holding page until launch, then public. Hidden builds stay private |
| Changed by | You and Claude Code | Claude Code | Claude Code | **The release pipeline only**, with its own production credentials |

### Production is off-limits to Claude Code

- **The rule:** Claude Code never reads, holds or uses production keys. Production is changed only by the release pipeline, which gets its own production credentials in the production twin (runbook Part 10, your checklist).
- **Who does what:**
  - the founder creates every production service and key, following Claude Code's exact clicks, and saves the keys straight into Doppler `prd`;
  - Claude Code builds and tests the pipeline in the repo and on staging, and checks production only from the outside (public addresses) and through the pipeline's reports;
  - the founder starts each release, and Claude Code starts the pipeline only when the founder says "release".
- **The one exception:** the holding page on `hrizzup.com` (runbook step 9.4), deployed before production has any keys or data.
- **Where Claude Code's tools could still reach production, and how each is closed:**

  | Tool | Why it reaches production | How it's closed |
  |---|---|---|
  | Doppler | Until 3 November 2026, Claude Code used the founder's own Doppler login on this Mac, which can open `prd` | **Closed, 3 November 2026, before the first production key went in:** Claude Code uses only its own service tokens, one per config (`dev`, `stg`, `stg_preview`, `hrizzup-tools/claude`), which Doppler refuses for `prd` (`infra/doppler/check_access.py`), and the founder signs his own login out of this Mac (`doppler logout --yes`, runbook step 10.1). Nothing in `dev` may point at `prd` (`dev_follows_staging.py` fails if it does) |
  | Vercel | One project for every environment, so the same login can promote or roll back production | Production's variables are synced from Doppler as Sensitive, so they can't be read back. Promotion and rollback run only through the pipeline, with its own token (`VERCEL_TOKEN` in `prd_release`, runbook Part 10) |
  | Cloudflare | Claude Code's key covers the whole `hrizzup.com` zone and every R2 bucket in the account | The founder creates production's keys and Turnstile widget. Claude Code created production's two buckets, `media.hrizzup.com` and their rules once, on 3 November 2026, before production had any keys or data (founder's decision, like the holding page). From then on the pipeline applies production's storage settings with its own key, and Claude Code's key is never used on production names or buckets. Removing its R2 and Turnstile rights is in the pre-launch checklist |
  | GitHub | Claude Code works through the founder's account and merges its own pull requests, so it could change the pipeline | Production's one credential (the Doppler token for `prd_release`) lives only in the GitHub environment `hrizzup-production`, which only `main` can use and whose secrets can't be read back. **Open, in the pre-launch checklist:** a separate GitHub account for Claude Code, with the founder's approval needed for changes to the pipeline's files |
  | The founder's other logins on this Mac | The Supabase, Vercel and Cloudflare (Wrangler) command-line tools are logged in with the founder's own accounts (found 3 November 2026; Supabase's is a full-access token that never expires), which will reach production | Claude Code never uses them: it passes its own staging-scoped tokens. **Recommended to the founder, 3 November 2026:** log all three out of this Mac and delete the Supabase one in its dashboard (runbook step 10.1) |

  Before real users arrive, the founder confirms each row (runbook, "Production hardening").

---

## 4. Domain and DNS (Cloudflare, hrizzup.com)

- **At GoDaddy:** transfer lock, two-step login and auto-renew all on.
- **Nameservers move to Cloudflare before any record is added.** Records Cloudflare imports from the old provider are deleted, so the zone starts empty and every record in it is one we added on purpose.
- **DNSSEC on.** Switch it on in Cloudflare, then add the DS record Cloudflare gives you at GoDaddy. Last time DNSSEC ended up off, with no record of why.
- **No CAA records during staging.** Before launch (runbook, pre-launch checklist), add a complete set naming every certificate authority that Cloudflare and Vercel use (check each provider's current list at the time). Last time a missing entry blocked an AWS certificate.
- **No certificate to buy.** Vercel and Cloudflare issue and renew certificates automatically.
- **HTTPS settings for the zone:** SSL/TLS Full (strict), Always Use HTTPS, minimum TLS 1.2, TLS 1.3 and Automatic HTTPS Rewrites. They apply to the names that run through Cloudflare (the media addresses). The app's own names point at Vercel, DNS only, and Vercel handles their HTTPS.
- **A Cloudflare API token** with only what Claude Code needs: hrizzup.com's DNS and zone settings, plus R2 and Turnstile on the account (the exact permission rows are in runbook step 2.5). It is kept in Doppler's separate project for Claude Code's setup keys, `hrizzup-tools` (config `claude`), as `CLOUDFLARE_API_TOKEN`, and used only through `infra/doppler/run tools`. Claude Code uses it to add DNS records and record them itself, instead of anyone typing them into the dashboard.
- **Email records:**
  - Proton: verification, MX, SPF and the three DKIM records.
  - DMARC: `v=DMARC1; p=quarantine`, with alignment left at its relaxed default. Reports go to Cloudflare's DMARC Management, which adds its own reports address (`rua`) to the record.
- **Resend:** the sending subdomain `mail.hrizzup.com`, with its DKIM, SPF and bounce records exactly as Resend returns them, all DNS only (runbook step 3.6).
- **`staging`:** points at Vercel, DNS only (a CNAME to the project's own Vercel address, added 3 November 2026).
- **The bare `hrizzup.com` and `www`:** production's names, pointing at Vercel, DNS only (two A records for the bare name and a CNAME for `www`, as Vercel recommends; `www` redirects to `hrizzup.com`). Until launch they show a holding page, with the privacy policy and terms that Google sign-in and the app stores ask for.
- **The app's names are never proxied through Cloudflare,** on staging or production. Vercel advises against putting another proxy in front of it, and its own firewall and DDoS protection cover the app.
- **Storage (R2):**
  - two buckets per environment: staging, and production in the production twin;
  - public files are served from a single-level subdomain: `media-staging.hrizzup.com` for staging and `media.hrizzup.com` for production. Cloudflare's standard certificate covers only one level below the domain, and `r2.dev` addresses are rate-limited;
  - production's buckets are **`hrizzup-uploads`** (private) and **`hrizzup-media`** (public at `media.hrizzup.com`), staging's `hrizzup-staging-uploads` and `hrizzup-staging-media`, all in Asia-Pacific. The buckets, their public address, `r2.dev` off, and the CORS and lifecycle rules are written into the repo (`infra/cloudflare/r2/`) and applied by `apply.py`, which reads everything back and fails if Cloudflare's copy differs. Staging is applied by Claude Code, production by the release pipeline (Claude Code created production's once, before it had keys or data):
    - **uploads bucket:** browsers may only `PUT` (with a `content-type` header), and only from our own sites: staging, local (`http://localhost:3000`), and previews of our project (`https://hrizzup-*-hrizzup.vercel.app`, added 3 November 2026) on staging; `hrizzup.com` and `www` on production. A pattern is acceptable here, unlike in sign-in, because every upload also needs a short-lived signed address that only our server makes;
    - **media bucket:** browser reads (`GET`, `HEAD`) from the same sites; everyone else can still load the images normally;
    - **lifecycle:** incomplete uploads are aborted after a day on both buckets, and raw uploads are deleted a day after upload, once the server has made the clean copy (section 13). Media is never deleted by a rule;
  - the uploads bucket has no public address; the media bucket's only public address is its own subdomain, with its `r2.dev` address off;
  - the app's storage key (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) is an account token with Object Read & Write on that environment's two buckets only; it can't list or open any other bucket. Browsers upload through short-lived signed addresses that the server makes with it. Tested on staging, 3 November 2026 (runbook 6.6);
  - Cloudflare keeps one cached copy of each resized image per format, because browsers that accept AVIF get AVIF and others get WebP;
  - images are processed and delivered as described in section 13.
- **Logging:** every record added or removed is logged in `docs/setup.md`. When a service is removed, its records go with it, so nothing points at a server that no longer exists.

---

## 5. Database (Supabase, staging and production)

- **Projects:** `hrizzup-staging` (created 3 November 2026) and `hrizzup-production` (Part 10), both in Mumbai (ap-south-1), on the same Postgres version and settings. Production starts empty. Each project's ID and the project-level settings below live in `infra/supabase/project/settings.json`; `infra/supabase/project/apply.py` applies them (encrypted connections only, legacy keys off, legacy signing secret revoked) and checks the rest (name, region, health, Postgres, compute, point-in-time recovery, Data API off, open network, no branches): Claude Code on staging, the release pipeline on production.
- **Settings on both:**
  - standard Postgres (17 on staging);
  - Data API off;
  - row-level security on every table (below);
  - not linked to GitHub (found on 3 November 2026: staging's project *is* connected to the repo in Supabase's Integrations settings, with deploys and branching both off, so it does nothing; the founder decides whether to disconnect it, runbook Part 10);
  - encrypted connections enforced;
  - Supabase's new API keys only, with the old ("legacy") keys switched off;
  - user sign-in tokens signed with an ES256 key pair, with the old shared signing secret revoked.
- **Compute size:** chosen on purpose, never left at a default by accident (rule 5).
  - Staging runs on **Micro** while it's a sandbox.
  - Before any load test, staging is enlarged to production's size, then shrunk again afterwards.
  - Production starts on **Micro** too (lean, founder's decision, 3 November 2026), and is sized for launch in the runbook's pre-launch checklist.
- **Why the Data API is off:** the app reaches the database only through our own typed API on the server (section 13). Supabase's automatic public data API isn't needed, so it's off: one fewer way into the data, and a missing access rule can't leak anything through it. Realtime doesn't use it.
- **Row-level security on every table:** a table shows each user only the rows its rules allow, and nothing until rules exist, so no table can be created open by mistake.
  - On 3 November 2026 the project's own "automatic" option was found not to reach tables made in code: a test table came out unprotected.
  - So the **first migration** (`infra/supabase/migrations/20261103120000_lock_every_table.sql`) adds an event trigger that switches row-level security on for every new table in every schema of ours (everything except Postgres's and Supabase's own), and refuses any `ALTER TABLE` that would switch it off. It follows Supabase's documented example, widened from `public` to all of our schemas.
  - `private.unprotected_tables()` lists any table of ours without it, and must always be empty. The Database check (every pull request, on a fresh database built from the migrations) and the Staging workflow (every merge, on staging itself, `infra/supabase/checks/every_table_locked.sql`) both fail if it isn't.
  - To let people read or change rows, write a policy; never switch row-level security off.
- **Connection** (through Supabase's shared pooler, Supavisor, at `aws-0-ap-south-1.pooler.supabase.com`, because the direct address and the dedicated pooler only work over IPv6). The mode is stated in configuration, never guessed.
- **Nobody builds a connection string by hand** (founder's rule, 3 November 2026). `DATABASE_URL` and `DATABASE_URL_SESSION` are copied as they are from Supabase's Connect dialog (Direct, then Transaction pooler or Session pooler, with "Use IPv4 connection" on, which shows the shared pooler), with Supabase's `[YOUR-PASSWORD]` placeholder still in them; the password is `SUPABASE_DB_PASSWORD`, copied when the project is made. The code fills it in, percent-encoded, in memory: the website in `product/web/lib/db.ts`, the workflows and scripts through `infra/supabase/database_url.py`, which also refuses a string that isn't the shared pooler for the project in `SUPABASE_URL`, in the right mode. A complete address with no placeholder still works as it is. Changing the password then means changing one value.

  | Setting | App: `DATABASE_URL` | Migrations: `DATABASE_URL_SESSION` |
  |---|---|---|
  | Pooler mode and port | Transaction mode, port 6543 | Session mode, port 5432 |
  | Pool size | **2** per running server instance to start (where the last project settled); raised only after measuring | 1 |
  | Prepared statements | **Off** (transaction mode can't keep them) | Allowed |
  | Idle timeout | **20 seconds**, so idle connections close before an instance goes to sleep | Default |
  | Lifetime | **30 minutes**, then the connection is replaced | Default |
  | Connect timeout | 10 seconds | 10 seconds |
  | Encryption | Required, with the server's certificate checked against Supabase's own certificate authority (`verify-full`). The certificate file goes into the repo with the code | Same |
  | On Vercel | The pool is registered with `attachDatabasePool` from `@vercel/functions`, so connections are released before an instance is suspended | — |

  - **Limits on Micro:** 200 client connections to the pooler and 60 direct database connections. Total app connections (instances × pool size) stay well under the pooler limit.
  - **Supabase's certificate authority:** "Supabase Root 2021 CA", valid until 26 April 2031, SHA-256 fingerprint `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
- **Migrations:**
  - **Every change to the database's structure goes through migration files in the repo**, and is applied the same way everywhere, so production receives exactly the same changes in the same order.
  - They run in order, over `DATABASE_URL_SESSION`: staging first; then production at release, by the release pipeline only.
  - A release's database changes reach production before its build is promoted, written so the version that is live keeps working with them.
  - Changing test data directly in staging is fine.
  - **Tool: the Supabase CLI** (decided 3 November 2026), with plain SQL files in `infra/supabase/migrations/`, named by timestamp and applied strictly in that order (`supabase db push`, never `--include-all`). Plain SQL covers everything Supabase needs (row-level security policies, triggers, Realtime publications, the password hook), and the CLI keeps the history in the database's own `supabase_migrations` schema.
  - **Tests** for each migration go in `infra/supabase/tests/` (pgTAP). The Database check builds a throwaway database from the migrations with the CLI's local Supabase Postgres and runs them; Turborepo's cache skips it when neither changed.
  - **Staging** gets new migrations from the Staging workflow on every merge to `main`, before the code (the same order as a release). `infra/supabase/config.toml` is for that throwaway database only; it is never pushed to a real project.
- **Claude Code never connects to production's database** and never holds its keys (section 3). Production's database is changed only by the release pipeline, with its own credentials.
- **Keys** (in Doppler; names only here):
  - `stg` and `prd`: `SUPABASE_DB_PASSWORD`, `DATABASE_URL`, `DATABASE_URL_SESSION`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. The publishable key is safe in the app and browser, for Realtime. The secret key is for the server only.
  - `prd_release` (the release pipeline's own, section 7): `SUPABASE_ACCESS_TOKEN`, a token with full access to `hrizzup-production` only, created by the founder.
  - `dev` refers to the same `stg` values (section 7).
  - `hrizzup-tools` (config `claude`): `SUPABASE_ACCESS_TOKEN`, Claude Code's token for Supabase's API. Full access to `hrizzup-staging` only, with no account or organisation access. It expires around **1 February 2027** and is replaced before then (runbook Part 5).
- **Network:** open to the internet, because Vercel has no fixed addresses. Protected by the password and enforced encryption.
- **Backups:**
  - point-in-time recovery for **production only**, switched on in the runbook's pre-launch checklist (production has no data until then);
  - staging keeps Supabase's daily backups;
  - one test restore before launch, because no restore was ever tried last time.
- **Spending:**
  - **During staging,** the organisation's spend cap stays **on**. Staging has no users, so a limit can't hurt anyone; it blocks surprise bills and doesn't stop the database being enlarged.
  - **Until launch it stays on** with production in the organisation too (production has no users either); it goes **off** in the runbook's pre-launch checklist, because then a billing limit must never take the site offline.
  - Usage alerts are on throughout.
- **Extensions:** only what the code needs, the same on both. Staging starts with Supabase's defaults: `pg_stat_statements`, `pgcrypto`, `supabase_vault` and `uuid-ossp`. Scheduled jobs inside the database run in the app's own database.

---

## 6. Hosting (Vercel: previews, staging and production)

**Set up 3 November 2026 (runbook Part 9).** Every setting below lives in the repo (`infra/vercel/project.json` and `firewall.json`, applied and read back by `infra/vercel/apply.py`; the region in `product/web/vercel.json`), never only in the dashboard.

- **The project:** `hrizzup` in the Pro team `hrizzup`, linked to `Zugzwang-world/hrizzup`, root directory `product/web` (the website), Next.js, Node 24, Fluid compute.
- **Region:** Mumbai (`bom1`), set in `vercel.json` and as the project's function region. `/api/health` shows the environment, the region, the commit it was built from, and whether the database, Redis, storage and sign-in answer.
- **One project, three environments:**
  - **Preview:** every pull request and every branch push, Doppler `stg_preview`, behind a Vercel login. A preview is a complete working copy of the site: staging's data and keys, Google sign-in (through staging's relay, section 9) and Turnstile's test keys. **A change is checked on its preview, never by deploying it to staging** (rule 1): the Screen check runs against it, and the founder looks at it there.
  - **Staging:** the custom environment `staging` (Pro includes one), Doppler `stg`, at `staging.hrizzup.com`. It follows the branch `staging`, which only the Staging workflow (`.github/workflows/staging.yml`) moves, after every merge to `main`: first the new migrations go to staging's database and every table is checked, then the branch moves, the workflow asks Vercel to build it through the deploy hook "Staging workflow" (the only way staging is built: Vercel's own build on a push to `staging` is off, `git.deploymentEnabled` in `product/web/vercel.json`, so each merge builds once), and the workflow passes only once `staging.hrizzup.com/api/health` reports that commit, from `bom1`, with every service answering. That is the same order as a release (database first, then code), which branch tracking on `main` itself couldn't guarantee. The ruleset "staging" lets only the workflow's deploy key move the branch, so staging only ever runs what reached `main`.
  - **Production:** Doppler `prd`, at `hrizzup.com` (`www` redirects to it, 308). The production branch is `main`, with **Auto-assign Custom Production Domains off**. Every merge to `main` makes a hidden ("staged") production build with production keys and data, reachable only at its private address. Nothing goes live until it is promoted.
- **Builds:** every commit builds (no Ignored Build Step, and Vercel's "skip unaffected projects" is off), so every pull request gets a preview and every merge reaches staging. Turborepo's Remote Cache makes unchanged builds fast. Vercel reports each deployment to GitHub (`createDeployments`), which is how the Screen check finds the preview.
- **Deployment protection:** Standard Protection with Vercel Authentication (`all_except_custom_domains`): previews, staging and the private addresses of hidden production builds all need a Vercel login; only the production domains are public. Automated checks get in with the **protection bypass for automation**, whose secret is in Doppler `hrizzup-tools` (with a copy in GitHub's secrets for the Screen check). It also skips the bot challenge, but not the rate limits.
- **Skew Protection:** on, for 12 hours, so a page that is already open keeps talking to the deployment that served it.
- **Vercel Toolbar and comments:** on for previews (and staging), off on production.
- **Firewall (all environments):** Bot Protection challenges clients that don't behave like browsers (verified search engines pass); the AI bots ruleset only logs, for now. Custom rules, top to bottom: every route that sends email (`/auth/email/`, `/api/email/`) at most 5 requests a minute per IP; sign-in (`/auth/`) 20 a minute; `/api/health` 60 a minute, and exempt from the bot challenge so uptime monitors and the release pipeline can read it. Vercel doesn't bill for blocked requests.
- **Not on until launch:** Speed Insights and Web Analytics (decided in Part 10). Observability Plus covers the project (a team setting, on for all projects).
- **Environment variables:** only from Doppler syncs, marked Sensitive (Doppler's "Secret" type). None are created by hand. If an integration writes keys straight into Vercel (Sentry, for example), those keys are also added to Doppler. Claude Code's own setup keys (`hrizzup-tools`) are never synced.
- **Scheduled jobs:** declared in `vercel.json`.
- **`autoAssignCustomDomains` stays off,** checked before every release (`apply.py --check`) and recorded. Last time it switched itself back on twice; here that would put every merge live without a release.
- **Project-wide settings reach production too.** Claude Code applied them in Part 9, before production had keys or data; from Part 10 on, a change that touches production goes through the release pipeline.

### Releasing

- **Why the hidden production build:** Vercel puts each environment's keys into its build. Promoting a staging or preview build makes Vercel rebuild it with production keys, so it would no longer be the build that was checked. The build that goes live is therefore the hidden production build of the commit that passed staging: built once, checked, then promoted untouched.
- **The release pipeline** is `.github/workflows/release.yml` ("Release"), started by hand only (the founder, or Claude Code when he says "release"). Its job runs in the GitHub environment `hrizzup-production`, which only `main` can use and which holds its one secret: a read-only Doppler token for `prd_release` (section 7). In order, stopping at the first failure:
  1. The commit is on `main` and its Staging workflow run succeeded.
  2. Production's values are production's own and valid: the database addresses are the shared pooler for production's project (`infra/supabase/database_url.py check`), and every key checks out without being used for real (`infra/keys/check.py production`: Google client and callback, sending-only Resend key, Turnstile secret, Supabase secret key and sign-in settings, R2 key limited to production's buckets).
  3. Production's Supabase project settings applied and checked (section 5).
  4. The commit's database changes (`supabase db push` over the session pooler), then every table checked locked.
  5. Sign-in settings (`infra/supabase/auth/apply.py production`) and storage settings (`infra/cloudflare/r2/apply.py production`) applied and read back; Redis checked (`infra/upstash/check.py production`); the Vercel project checked against the repo, `autoAssignCustomDomains` still off (`infra/vercel/apply.py --check`).
  6. The commit's hidden production build, found through GitHub's deployment record: its private `/api/health` must show production, `bom1`, that commit and every service answering (a build made before `prd` reached Vercel shows `not_configured` and is refused), and until launch its home page must be the holding page (`data-page="holding"`).
  7. `vercel promote <address of the hidden build> --yes` (Vercel's command-line tool, pinned): live instantly, with no rebuild.
  8. It waits until `hrizzup.com/api/health` shows that commit with every service answering. Claude Code then confirms the same from the outside and records the release.
- **Going back:** the same workflow with action "rollback" and the commit to return to: it checks that commit's build, runs `vercel rollback`, and waits for `hrizzup.com` to serve it. Instant, no rebuild; the database stays as it is.
- **Before launch:** `hrizzup.com` shows the holding page, and the pipeline refuses any build whose home page isn't it. The first promotion of an app build is the launch (the workflow's "launch" box).

---

## 7. Secrets (Doppler)

- **Two projects, so each place holds one kind of key:**
  - **`hrizzup`: the app's keys only,** in four configs:
    - `dev`: running the app on this Mac. Every staging value appears here as a Doppler reference (`${stg.NAME}`), never a copy, so local runs and browser tests use staging's services and follow any change to staging at once. `infra/doppler/dev_follows_staging.py` keeps it complete: `apply` after every change to `stg`, `check` to report. A value that must differ locally (for example the site's own address) is listed in `infra/doppler/dev-overrides.txt` and gets its own value. `dev` never points at `prd` or at another project, and the script fails if it does;
    - `stg`: staging;
    - `stg_preview`: previews. It is a **branch of `stg`**: it copies every staging value automatically and holds only the values that must differ on previews;
    - `prd`: production, kept fully separate (rule 1), synced to Vercel's production environment;
    - `prd_release`: the release pipeline's own config, a **branch of `prd`**: it sees every production value and adds the pipeline's three credentials (`VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`). It has no sync, so those never reach a build: a production function can't promote, roll back or reconfigure anything. Only the pipeline reads it, through a read-only service token kept in GitHub (below).
    Doppler also gives each person a built-in `dev_personal`, a branch of `dev`; it can't be deleted, and it isn't used.
  - **`hrizzup-tools`: Claude Code's own setup keys,** in one config, `claude`: `CLOUDFLARE_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN` (team `hrizzup` only, expires around 1 February 2027), `VERCEL_AUTOMATION_BYPASS_SECRET` (the previews' protection bypass) and the Cloudflare account and zone IDs, plus any future setup key. They are used only as `infra/doppler/run tools -- <command>`, and never synced anywhere. Helpers are never given this project.
  - **Never a setup key in `hrizzup`:** `stg` and `stg_preview` are synced into Vercel, so a key there reaches every staging and preview build. (`VERCEL_TOKEN` was found in `stg` on 3 November 2026, before the first sync, and moved.)
- **GitHub Actions' own credentials** (GitHub secrets, each piped in without being shown; recreated, never copied back): read-only Doppler service tokens `github-actions-staging` (`stg`, as `DOPPLER_TOKEN` in the GitHub environment `hrizzup-staging`, which only `main` can use), `github-actions-preview` (`stg_preview`, as `DOPPLER_TOKEN_PREVIEW`) and `github-actions-release` (`prd_release`, as `DOPPLER_TOKEN` in the GitHub environment `hrizzup-production`, which only `main` can use; created and saved by the founder), the Staging workflow's deploy key and deploy hook (`STAGING_DEPLOY_KEY` and `VERCEL_STAGING_DEPLOY_HOOK`, same environment; the hook's address also in `hrizzup-tools`; it can only start a staging build), and a copy of the protection bypass. The Remote Cache signs in through OIDC (Vercel's Turborepo CLI policy "hrizzup checks", limited to `Zugzwang-world/hrizzup`), so no Vercel token is stored in GitHub. Values fetched from Doppler in a workflow are masked in its logs.
- **Missing keys:** Doppler's "Action Required" list flags a key that exists in one environment but not another. Because `dev` follows `stg`, both their lists stay empty. `prd` holds every app key except `AUTH_RELAY_SECRET`, which only staging and previews use (the previews' sign-in relay), so `prd`'s list keeps that one warning on purpose.
- **Syncs:** `stg` goes to Vercel staging (the custom environment) and `stg_preview` to Vercel previews, both as Sensitive variables, set up by the founder on 3 November 2026; `prd` goes to Vercel production, also Sensitive, set up by the founder in Part 10 (3 of the free plan's 5 syncs). `prd_release` is never synced.
- **Production's values come straight from each service's dashboard** (founder's rule, 3 November 2026): every value in `prd` and `prd_release` is copied with the service's own copy button, or is one of four fixed names given in the runbook. Nothing is typed or assembled by hand; the code fills the database password into Supabase's own connection strings (section 5).
- **Plan and access:** the free Developer plan during staging, when only the founder and Claude Code use Doppler. That plan has no roles, so any member could open every config. The Team plan comes before the first helper joins (runbook, "Later, with the team"). With it:
  - helpers get the Collaborator role on `hrizzup`'s Development and Staging, no access to Production, and no access to `hrizzup-tools`;
  - before a helper first gets access, any key they shouldn't see that ever sat in the configs they'll open is replaced: today, the Cloudflare key and the Supabase access token, which were in `dev` until 3 November 2026 and may show in its history;
  - Claude Code keeps its service tokens (below); a service account is needed only if Doppler ever stops offering them.
- **Claude Code's own access (since 3 November 2026):** four service tokens, each limited by Doppler to one config, so the free plan needs no roles: `hrizzup/dev`, `hrizzup/stg` and `hrizzup-tools/claude` read and write (`dev_follows_staging.py` writes `dev`'s references; Claude Code creates staging keys and setup values), `hrizzup/stg_preview` read only (its overrides rarely change). None can open `prd` or its branches: Doppler answers "This token does not have access to requested config" (`infra/doppler/check_access.py`, which also proves the read-only one can't write). They live in the Mac's login keychain (service `hrizzup-doppler`) and are used only through `infra/doppler/run <config> -- <command>`, which hands a token to the Doppler process alone and removes it before the command starts, uses its own empty Doppler settings folder (so no personal login is ever used) and keeps no copy of secrets on disk. The founder signs his personal Doppler login out of that Mac (`doppler logout --yes`) and uses Doppler's website for production.
- **No variables made by hand on any platform**, and every change is followed by a redeploy.
- **Copies held by Supabase Auth:** it keeps its own copies of `GOOGLE_OAUTH_CLIENT_SECRET`, `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` (section 9). Whenever one changes in Doppler, `infra/supabase/auth/apply.py` is run for that environment the same day; that is its redeploy.
- **Every secret exists separately for each environment** (rule 1).
- **Production keys:** the founder creates them and saves them straight into `prd` and `prd_release` (runbook Part 10). Only production itself and the release pipeline use them; Claude Code never reads, holds or uses them (section 3).
- **Pitfalls from last time:**
  - the configs are named `stg` and `prd`, not `staging` and `production`;
  - `doppler configure --json` prints the access token;
  - wrap commands so that variables are filled in inside Doppler, not in your own terminal.

---

## 8. Email

- **Proton:** the address you choose plus a contact address on hrizzup.com. DMARC reports go to Cloudflare's DMARC Management, not to a personal address.
- **Resend Pro:**
  - the verified sending subdomain `mail.hrizzup.com`, in Resend's Tokyo region (`ap-northeast-1`), the closest of its four regions to India;
  - open and click tracking off, so links in sign-in emails are never rewritten;
  - separate sending-only API keys for staging and production, each limited to `mail.hrizzup.com` and kept as `RESEND_API_KEY` in Doppler `stg` and `prd` (previews use the staging key through `stg_preview`);
  - full-access setup keys exist only while Claude Code needs one (kept in `hrizzup-tools`), and are deleted straight after;
  - bounce notifications (webhooks) set up;
  - **Supabase Auth sends its sign-in codes through Resend's SMTP** (`smtp.resend.com`, port 465, user `resend`) from `Hrizzup <no-reply@mail.hrizzup.com>`, with the environment's own `RESEND_API_KEY`, not Supabase's built-in sender (which only reaches the project's own team);
  - start sending real mail weeks before launch, so the domain builds a reputation.
- **Production refuses to start** if it's set to Resend's test sender.

---

## 9. Sign-in and abuse protection

**Decided 3 November 2026:** sign-in for the website and the app runs on **Supabase Auth**, so one account works on both (PLAN.md section 2).

- **Order:**
  - **Google first.**
  - **Apple and email codes before the iPhone build.** Email codes are a code sent by email, with no passwords and no links to click, so they work the same in the browser and in the app.
  - **The app's native Google and Apple sign-in come with the app builds:** an Android sign-in client in Google Cloud with the app's signing fingerprint (SHA-1, for the test and the release builds), and an iOS client. Their client IDs join the web client in Supabase (`external_google_additional_client_ids`).
- **Settings kept in the repo:** `infra/supabase/auth/` holds every Supabase Auth setting and the email template. `apply.py` applies them and reads them back: staging by Claude Code, production only by the release pipeline (runbook Part 10). Only the addresses and the keys differ between the two.
- **Addresses:** each environment has one site address, and redirects are allowed only to its own addresses. Any other address falls back to the site address.

  | | Site address | Redirects allowed |
  |---|---|---|
  | Staging | `https://staging.hrizzup.com` | `https://staging.hrizzup.com/**` and `http://localhost:3000/**` (this Mac) |
  | Production | `https://hrizzup.com` | `https://hrizzup.com/**` and `https://www.hrizzup.com/**`; the app's own links join with the app builds |

  **No `vercel.app` address is ever allowed,** because anyone can create a `vercel.app` site, so even a narrow pattern could match a stranger's. Previews sign in through **staging's relay** instead (`/auth/relay`, `product/web/lib/auth-relay.ts`): a preview asks Supabase to return the visitor to staging with a note naming the preview, signed with `AUTH_RELAY_SECRET` (Doppler `stg`, which previews inherit) and valid for 15 minutes; staging forwards the one-time code only to a correctly signed preview of our project. The code is then exchanged on that preview, which alone holds the matching code verifier (PKCE).
- **Return paths** (`next`) are always a path on the same site, checked as given and after the browser's own clean-up (`/..//x` would become `//x`, another site); anything else falls back to the sign-in test page.
- **The sign-in test page** (`/sign-in-test`) exists on staging, previews and this Mac only; production answers 404 for it and for every `/auth/` route until launch.
- **Test accounts for the automatic checks:** `delivered+screen-check-chromium@resend.dev` and `delivered+screen-check-webkit@resend.dev`, one per browser engine, marked `test_account` in their app data. They exist only in staging's project (which previews share), have no password and no Google identity, so nobody can sign in to them; a check gets a session only by asking staging's server key for a one-time token that no email carries (`product/web/e2e/support/test-accounts.ts`, which refuses any project but staging's). Production is a separate project, so they can't exist there. Resend's `resend.dev` test inboxes accept and drop any email sent to them by mistake.
- **Google:**
  - **two Google Cloud projects,** both owned by the Hrizzup Google account, `hrishikesh@hrizzup.com`, not the Zugzwang World one: `hrizzup` (ID `hrizzup-513610`) for staging and `hrizzup-production` for production (founder's decision, 3 November 2026). Each has its own consent screen, so publishing production's never lets every Google account into staging, and staging's Supabase address never holds up production's branding;
  - **consent screens:** External, in **Testing** (only listed test users can sign in); production's is published before launch, staging's stays in Testing. Basic information only (`openid`, `email`, `profile`), so no Google review of sensitive data access is needed. Authorised domains: `hrizzup.com` and that environment's Supabase project domain;
  - **one web client per environment,** with only fixed addresses registered. Staging's is "Hrizzup staging", returning to `https://mlccgqxtqmllwbyjfzzm.supabase.co/auth/v1/callback`; production's is "Hrizzup production", with origins `https://hrizzup.com` and `https://www.hrizzup.com`, returning to production's Supabase callback (copied from Supabase's Google provider panel). Their IDs and secrets are in Doppler `stg` and `prd` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. `infra/keys/check.py` confirms each pair and its callback without signing anyone in;
  - **the Supabase domain shows on Google's sign-in screen** until a custom domain (`auth.hrizzup.com`) replaces it. Google can only verify the branding (Hrizzup's name and logo on that screen) once every authorised domain is verified as ours, which the Supabase domain can't be. It is in the runbook's pre-launch checklist (Google publishing and branding, with the custom sign-in address);
  - **before publishing:** the home page and privacy-policy links on Google's Branding page, and `hrizzup.com` verified in Google Search Console (runbook, pre-launch checklist). Then the consent screen is published as "In production" and tested with an account that isn't on the test list.
- **Email codes:**
  - 8 digits (Supabase's default; harder to guess than 6), valid for 10 minutes;
  - the email (`infra/supabase/auth/templates/sign-in-code.html`) shows only the code: no links, images or tracking. Sign-up, sign-in and password reset all send this same email; a change of email address sends its own code to the old and the new address. No email Supabase sends carries a link;
  - sent through Resend from `no-reply@mail.hrizzup.com` (section 8);
  - limits: at most one email a minute to the same address, and 30 emails an hour for the whole project (Supabase's starting limit for custom email). Production's hourly limit is raised before launch, to fit expected sign-ups (it's set per environment in `settings.json`);
  - **no passwords:** Supabase can't switch passwords off while email codes are on, so its password rules are strict (at least 12 characters, leaked passwords refused), and password sign-in is blocked with Supabase's password hook, a small database function, once migrations exist (PLAN.md step 1.5).
- **Apple:** Sign in with Apple wherever Google sign-in appears on iPhone.
- **Turnstile:**
  - one widget per environment: "Hrizzup staging" (Managed mode, `staging.hrizzup.com` and `localhost`) and "Hrizzup production" (`hrizzup.com` and `www`, no `localhost`);
  - keys in Doppler as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Previews use Cloudflare's official test keys, as overrides of the same names in `stg_preview`, because preview addresses change with every pull request;
  - **on in Supabase Auth** for every route that sends email or takes a password: sign-up, sign-in codes and password reset. A request without a valid Turnstile answer is refused. Google sign-in doesn't need it. The website's and the app's email-code screens show the widget;
  - the real widget actually on the page;
  - production refuses test keys (`apply.py` refuses them too), and is proven to reject a fake token.
- **Every route that can send email** is rate-limited and protected by Turnstile.
- **Supabase keeps copies of three keys** (section 7): when one changes in Doppler, `apply.py` is run the same day.

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
- **Ruleset "main":** a pull request is required (no reviews); the "Secret check", "Quick checks", "Database check" and "Screen check" must pass (`.github/workflows/checks.yml`); force-pushes and deleting `main` are blocked, and nobody bypasses it. More required checks are added as the checks sized to the change are built (PLAN.md step 0.6).
- **Ruleset "staging":** only a deploy key may create, move or delete the branch `staging`, and never by force. The one deploy key with write access belongs to the Staging workflow (secret in the environment `hrizzup-staging`, `main` only). GitHub doesn't allow its own Actions app as an exception on a personal account's repository, which is why a deploy key does this job.
- **Environment `hrizzup-staging`:** only `main` can use it; it holds the Staging workflow's Doppler token, deploy key and deploy hook.
- **Merging:** squash merges only (the pull request title, with its size label, becomes the commit title), auto-merge on, and branches deleted after merging.
- **Dependabot:** alerts and security updates on.
- **Every setting above is confirmed through GitHub's API** and recorded in `docs/setup.md`.
- **What GitHub Pro doesn't include for a private repo:** GitHub's own secret scanning and push protection (only organisation plans can add them). So a secret pushed to a branch reaches GitHub before the secret check flags it; the check keeps it out of `main`. If it ever fires, the key is replaced, not just deleted from the file.
- **Environment names:** pick ones that don't collide with the names Vercel creates (`Production`, `Preview`), for example `hrizzup-staging` and `hrizzup-production`. The release pipeline's one production credential lives in `hrizzup-production` (runbook Part 10).
- **Reminders:** `.github/workflows/reminders.yml` runs every day at 10:00 India time. For each entry in `.github/reminders.json` whose date has arrived, it opens a GitHub issue once, which GitHub notifies the founder about. Dated chores, such as replacing an expiring token, go in that file.

---

## 12. AWS

AWS is not the production plan. Production runs on the same platforms as staging (Vercel and Supabase). AWS comes later only if a concrete need appears, as its own project, planned at that time. The lessons from the experiment's AWS setup are in this file's history (version of 2 November 2026).

---

## 13. App building blocks (decided 2 November 2026)

- **Codebase (set up 3 November 2026, PLAN.md step 1.5):** one repo holds the Expo (React Native) app and the Next.js website, sharing code between them, with one typed API that both use (built next).
  - **Layout:** `product/web` (Next.js 16, `@hrizzup/web`), `product/app` (Expo SDK 58, `@hrizzup/app`), `product/packages/*` (code they share: `@hrizzup/core`, `@hrizzup/tsconfig`), `infra/supabase` (the database's migrations and tests, `@hrizzup/database`).
  - **Tools:** pnpm 11 workspaces (strict and fast; a new version waits 3 days after release before it can be installed, and install scripts run only for packages listed in `pnpm-workspace.yaml`), Turborepo (runs each task only when its inputs change, sharing results through Vercel's Remote Cache with Vercel's builds and GitHub's checks), Biome (formatting and lint in one fast tool), TypeScript 6 (TypeScript 7's faster compiler once Expo's tools support it), Vitest (unit tests), Playwright (screens) and the Supabase CLI (migrations). Shared packages are TypeScript source compiled by each app, with no build step of their own.
  - **Styling:** Tailwind CSS 4; shadcn/ui arrives with the design system (PLAN.md step 1.4).
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
| **Upstash Redis** (Fixed plan, Mumbai; rules below) | The shared fast layer for anything read often: feeds, rankings, counters, sessions, rate limits and computed results | Every entry has an explicit expiry, and is cleared or rewritten when its data changes |
| **The database** | The source of truth | An index for every search and sort, page-by-page loading (each page starts where the last one ended, not by counting rows), and no repeated small queries |

**Rules for every layer:**
- **Batch:** never make several separate trips to Redis or the database when one batched request will do (one multi-key read or pipeline for Redis; one query with a join or a list of IDs for the database).
- **Private data is never shared:** one user's private data never goes into a shared cache. Pages with private data are marked so the edge doesn't keep them. Cache keys always include the environment (for example `stg:` or `prd:`), and the user where needed.

### Redis (Upstash)

**Set up the same way on staging and production** (production in the production twin, runbook Part 10), except the plan until launch:

| Setting | Value | Why |
|---|---|---|
| Plan | Staging: **Fixed 1GB**, $20 a month: up to 1 GB of data, 100 GB of traffic a month and 10,000 commands a second. Production: **pay as you go** until launch ($0.20 per 100,000 commands, up to 100 GB, with a monthly budget as its cap), then Fixed 1GB in the pre-launch checklist | A fixed price with **no per-command charges**, so a load test can't run up a bill by the number of commands; production has no traffic until launch, so pay as you go costs next to nothing there |
| Region | AWS Mumbai (`ap-south-1`), no read regions. Upstash keeps a standby copy in the same region | Next to the app's functions (Vercel's `bom1` is AWS `ap-south-1`) and the main database |
| Connections | Encrypted only (TLS 1.2 or 1.3). Plain-text Redis and plain HTTP get no answer. Open to all addresses, protected by the token | Upstash can't switch encryption off. Vercel has no fixed addresses, so an address list isn't possible |
| How the app connects | Upstash's REST interface, through Upstash's own client (`@upstash/redis`), with `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` | HTTPS requests suit serverless functions: no connections to hold open or run out of |
| Eviction | **On** (Upstash's only policy, "optimistic-volatile") | Below |
| Auto-upgrade | Staging **off**; production **on** once it is on the Fixed plan (pay as you go has no tiers) | On staging, a test that hits a limit is blocked, never billed: its spending cap. On production, a limit never takes the site offline; the database moves up a tier instead |
| Prod Pack ($200 a month per database: uptime SLA, multi-zone failover, encryption at rest) | Not used | Redis never holds the only copy of anything, so an outage costs speed, not data |
| Checked by | `infra/upstash/check.py`: staging by Claude Code, production only by the release pipeline | Settings and stored keys are checked the same way on both |

**Why eviction is on:** Upstash has one eviction behaviour. When the database is full, it removes keys at random, taking keys that have an expiry first. With eviction off, a full database refuses every write, so caches, rate limits and locks would all stop at once, and the site with them. With it on, a full database drops some entries, which are rebuilt from the main database. The rules below make that safe. The usual alternative at larger scale, a second database with eviction off for locks and counters, costs a second plan per environment; it's worth revisiting only if the database ever nears its size limit.

**Rules for every use of Redis:**
1. **Every key name starts with its environment,** taken from `REDIS_KEY_PREFIX` in Doppler: `prd` (production), `stg` (staging), `pre` (previews) or `dev` (this Mac). Previews and local runs share staging's database, so the prefix keeps their keys apart from staging's. Next comes what the key is for, then its name: `stg:cache:feed:home`, `stg:rate:signin-email:<id>`, `stg:lock:settle-market:<id>`, `stg:count:views:<post-id>`. Key names hold IDs, never email addresses or other personal data.
2. **Every key has an expiry:** caches, rate limits, locks and counters alike, so nothing piles up. Cache entries are also cleared or rewritten the moment their data changes. When the shape of cached data changes, the key name gets a new version (`stg:cache:feed:v2:home`), so a new release never reads entries written by the old one.
3. **Batch:** one request per need, never several separate trips. Use a multi-key command (`MGET`, `MSET`) or a pipeline; a transaction (`MULTI`/`EXEC`) when the commands must apply together; a script (`EVAL`) for read-then-write logic such as a rate limit. Upstash's client gathers commands issued together into one request automatically (auto-pipelining, on by default); keep it on. Measured from the founder's Mac on 3 November 2026: 10 separate trips took 72 to 125 ms, and the same 10 commands in one pipeline took 7 ms.
4. **Redis is never the only copy of anything that matters.** The main database is the source of truth: play money, market maths, and anything a user would miss. Locks expire, and only stop duplicate work; correctness comes from the database (unique rules, writes that are safe to repeat). Counters that matter are copied into the database regularly.

`infra/upstash/check.py` also checks rules 1 and 2 on the keys actually stored.

**Keys in Doppler** (names only here):
- `stg`: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `REDIS_KEY_PREFIX` (`stg`);
- `stg_preview`: inherits them, with its own `REDIS_KEY_PREFIX` (`pre`);
- `dev`: refers to staging's two keys, with its own `REDIS_KEY_PREFIX` (`dev`, listed in `infra/doppler/dev-overrides.txt`);
- `prd`: the same three, created by the founder (runbook Part 10).

**Round trip:**
- **From the founder's Mac** (its internet exits in Mumbai), 3 November 2026: about 8 ms per command on an open connection, and about 41 to 50 ms for the first command on a new connection, which also sets up encryption. The old database took about 135 ms, because it was in the wrong region.
- **From Vercel's Mumbai functions:** they run in the same AWS region, so the network part shrinks to about a millisecond. Expected: about 1 to 3 ms per command, and a few more for a fresh instance's first command. Measured in runbook step 9.6.

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
3. **Doppler:** the project and its four configs, on the free Developer plan. Move every key saved so far into it.
4. **Supabase:** the staging project.
5. **Storage and bot protection:** the staging R2 buckets and their public subdomain, image transformations for the zone, and the staging Turnstile widget.
6. **Redis and sign-in:** the staging Upstash database and the staging Google sign-in client.
7. **Vercel:** the project, once the first app exists, synced from Doppler, with `staging.hrizzup.com`, hidden production builds and the holding page on `hrizzup.com`.
8. **Production twin (lean):** as soon as staging works, Claude Code's own Doppler tokens first, then the production copy of every staging service: keys created by the founder and copied straight from each dashboard (Claude Code never holds production keys), storage buckets created by Claude Code, Doppler `prd` synced to Vercel production, and the release pipeline with its own credentials. No paid extras and nothing public until launch.
9. **Pre-launch checklist** (runbook): point-in-time recovery, Cloudflare Pro, Upstash's Fixed plan, Google publishing and branding, analytics, spending limits, the Cloudflare key's rights, CAA records, the legal pages, link previews and the AI-crawler decision.
10. **Later, with the team:** Sentry, PostHog, the Apple and Google Play accounts, Doppler's Team plan. Before real users arrive: the production hardening in the runbook.
11. **Throughout:** Claude Code records every setting in `docs/setup.md`.
