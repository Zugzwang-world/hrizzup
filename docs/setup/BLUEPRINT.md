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

Default to paid tiers.

| Service | Plan | Used for |
|---|---|---|
| GitHub | The founder's personal account `Zugzwang-world`, on **GitHub Pro**, with the **private** repo `hrizzup`. Pro covers the repository protections used on `main` (section 11), but not GitHub's own secret scanning or push protection for private repos: an open-source secret check runs on every pull request instead. | Code, pull requests, checks |
| Vercel | Pro (the existing team), with one project `hrizzup` for previews, staging and production. Pro includes the one custom environment that staging needs. | Previews, staging and production |
| Supabase | Pro (the existing organisation), with two projects set up the same way in Mumbai (ap-south-1): `hrizzup-staging` and `hrizzup-production` | Staging and production databases |
| Doppler | Team plan. It adds service accounts and audit features; the free tier forced the audit to be cut back last time. | All secrets |
| Cloudflare | A zone for `hrizzup.com` on a paid plan, bought per domain. Its protection covers the names routed through Cloudflare, such as the public storage addresses; the app's own names point at Vercel, DNS only (section 4). | DNS, file storage (R2), Turnstile |
| Proton | Duo (existing) | Email on hrizzup.com, plus a Proton Pass vault named `Hrizzup` |
| Resend | Paid plan (existing). The free plan stops at 100 emails a day. | Sign-in and notification email |
| Upstash Redis | Paid plan (existing), with one database per environment, in Mumbai | Rate limits, caches, locks |
| Sentry | Later, set up with the team: Team plan, one project per environment | Error reporting |
| PostHog | Later, set up with the team: one project per environment | Analytics and feature flags |
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
  - bucket CORS and lifecycle rules are written into the repo, and both environments use the same ones.
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

## 13. Order of setup

1. **Domain and DNS:** add the zone to Cloudflare, set the nameservers at GoDaddy, turn on DNSSEC, and create the Cloudflare API token. At the same time: check two-step login on your GitHub account, create the repo in that account (GitHub Pro), run the first Claude Code session, so every setting has somewhere to be recorded, then turn on Dependabot, the secret check on every pull request and the rule for `main`.
2. **Email:** the Proton domain, addresses and DMARC record, then Resend's sending subdomain.
3. **Doppler:** the project and its four configs. Move every key saved so far into it.
4. **Supabase:** the staging project.
5. **Storage and bot protection:** the staging R2 buckets and their public subdomain, and the staging Turnstile widget.
6. **Redis and sign-in:** the staging Upstash database and the staging Google sign-in client.
7. **Vercel:** the project, once the first app exists, synced from Doppler, with `staging.hrizzup.com`, hidden production builds and the holding page on `hrizzup.com`.
8. **Production twin:** as soon as staging works, the production copy of every staging service, with Doppler `prd` synced to Vercel production. Nothing public until launch.
9. **Later, with the team:** Sentry, PostHog, the Apple and Google Play accounts. Before real users arrive: the production hardening in the runbook.
10. **Throughout:** Claude Code records every setting in `docs/setup.md`.
