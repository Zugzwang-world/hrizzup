# Hrizzup: setup blueprint

> This blueprint says how every account and service is set up for Hrizzup. It is built from the Zugzwang World setup inventory (2 November 2026) and PLAN.md.
> Claude Code commits it to `docs/setup/BLUEPRINT.md`. On the day it sets each value, it also records that value in `docs/setup.md`.
> Secrets never go in either file.

Status: proposed, 2 November 2026. Items marked **DECIDE** are still open.

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
| Security settings are on from day one, and checked through the API | The repo claimed branch protection for 11 days when none existed. Secret scanning, push protection and the organisation's 2FA requirement were never switched on. |
| Previews never touch production data and are never public | Every preview address was public and connected to the production database. |
| No sign-in on preview deployments | Google sign-in on previews never worked. Testing used the fixed staging address instead. |
| A failing job is fixed or switched off the same day | Two scheduled jobs failed every day for weeks without anyone looking. |
| Teardown is planned as carefully as a launch | The experiment left DNS records pointing at deleted servers, syncs still running, AWS resources kept after deletion, and no record of any of it. |

---

## 2. Accounts and plans

Default to paid tiers.

| Service | Plan | Used for |
|---|---|---|
| GitHub | The existing `zugzwang-foundation` organisation, staying on GitHub's **Free** plan, with the **private** repo `hrizzup`. No GitHub Team and no Secret Protection add-on: an open-source secret scanner does that job instead (section 11). | Code, checks, deploys |
| Vercel | Pro (the existing team), with a new project `hrizzup` | Staging and previews |
| Supabase | Pro (the existing organisation), with a new project `hrizzup-staging` in Mumbai (ap-south-1) | Staging database |
| Doppler | Team plan. It adds service accounts and audit features; the free tier forced the audit to be cut back last time. | All secrets |
| Cloudflare | A zone for `hrizzup.com` on a paid plan, bought per domain. Its protection covers names routed through Cloudflare: the public storage address now, and the app once it moves to production. | DNS, file storage (R2), Turnstile |
| Proton | Duo (existing) | Email on hrizzup.com, plus a Proton Pass vault named `Hrizzup` |
| Resend | Paid plan (existing). The free plan stops at 100 emails a day. | Sign-in and notification email |
| Upstash Redis | Paid plan (existing), with one database per environment, in Mumbai | Rate limits, caches, locks |
| Sentry | Later, set up with the team: Team plan, one project per environment | Error reporting |
| PostHog | Later, set up with the team: one project per environment | Analytics and feature flags |
| Google Cloud | One project with separate sign-in (OAuth) clients for staging and production, and billing switched on | Google sign-in |
| Apple Developer | Individual account | The iPhone app and Sign in with Apple |
| Google Play | Personal account | The Android app |
| SuperGrok | Existing | The Grok bots that find news |
| AWS (production, later) | **DECIDE:** a new account for Hrizzup on a paid plan (recommended), or the experiment's account | Production |

---

## 3. Environments

| | Local | Preview | Staging | Production (later) |
|---|---|---|---|---|
| Address | localhost | Vercel preview URLs | `staging.hrizzup.com` | `hrizzup.com` |
| Hosting | Your machine | Vercel | Vercel | AWS |
| Doppler config | `dev` | `preview` | `stg` | `prd` |
| Database | Staging | Staging | Supabase `hrizzup-staging` | AWS RDS |
| Sign-in | Test accounts only | None | Google (staging client) and email | Google (production client), email, Apple |
| Access | — | Vercel deployment protection | Protected until testers join | Public |

---

## 4. Domain and DNS (Cloudflare, hrizzup.com)

- **At GoDaddy:** transfer lock, two-step login and auto-renew all on.
- **Nameservers move to Cloudflare before any record is added.**
- **DNSSEC on.** Switch it on in Cloudflare, then add the DS record Cloudflare gives you at GoDaddy. Last time DNSSEC ended up off, with no record of why.
- **No CAA records during staging.** At production, add a complete set naming every certificate authority that Cloudflare, Vercel and AWS use (check each provider's current list at the time). Last time a missing entry blocked an AWS certificate.
- **No certificate to buy.** Vercel and Cloudflare issue and renew certificates automatically.
- **A Cloudflare API token** limited to hrizzup.com's DNS and to R2, kept in Doppler. Claude Code uses it to add DNS records and record them itself, instead of anyone typing them into the dashboard.
- **Email records:**
  - Proton: verification, MX, SPF and the three DKIM records.
  - DMARC: `v=DMARC1; p=quarantine`, with alignment left at its relaxed default.
- **Resend:** a sending subdomain (for example `mail.hrizzup.com`), with the DKIM and bounce records exactly as Resend shows them.
- **`staging`:** points at Vercel, DNS only.
- **The bare `hrizzup.com` and `www`:** show a holding page from Vercel until production. The page carries the privacy policy that Google sign-in and the app stores ask for.
- **Storage (R2):**
  - two buckets per environment: staging now, production later;
  - public files are served from a single-level subdomain such as `media-staging.hrizzup.com`. Cloudflare's standard certificate covers only one level below the domain, and `r2.dev` addresses are rate-limited;
  - bucket CORS and lifecycle rules are written into the repo.
- **Production:** Cloudflare's proxy is switched on only together with two things:
  - origin authentication: Cloudflare adds a secret header, and AWS rejects any request without it;
  - correct handling of visitors' IP addresses.
- **Logging:** every record added or removed is logged in `docs/setup.md`. When a service is removed, its records go with it, so nothing points at a server that no longer exists.

---

## 5. Database (Supabase staging)

- **Project:** `hrizzup-staging`, in Mumbai (ap-south-1), on the current Postgres version.
- **Compute size:** chosen on purpose, not left at the default.
- **Connection:**
  - Connect through Supabase's pooler, because the direct address only works over IPv6.
  - From Vercel's serverless functions, use transaction mode (port 6543) with prepared statements off.
  - Keep each instance's connection pool small (last time it ended at `max: 2`), and set the idle and lifetime timeouts explicitly.
  - The connection mode is stated in configuration, never guessed.
- **Backups:** point-in-time recovery on, plus one test restore before launch. No restore was ever tried last time.
- **Spending:** spend cap off, usage alerts on. A billing limit must never take the site offline.
- **Extensions:** only what the code needs. Scheduled jobs inside the database run in the app's own database.

---

## 6. Hosting (Vercel staging)

- **Region:** Mumbai, set in `vercel.json` and shown on `/api/health`.
- **Staging:** a custom environment named `staging`, built from the `staging` branch. Production moves to AWS later.
- **Build-skip rule (Ignored Build Step):** written in the repo, not only in the dashboard.
- **Previews:** deployment protection on.
- **Firewall:** rules set and recorded.
- **Environment variables:** only from Doppler syncs, marked Sensitive. None are created by hand. If an integration writes keys straight into Vercel (Sentry, for example), those keys are also added to Doppler.
- **Scheduled jobs:** declared in `vercel.json`.
- **Before any merge that changes the database:** check the `autoAssignCustomDomains` setting. Last time it switched itself back on twice.

---

## 7. Secrets (Doppler)

- **Project:** `hrizzup`, with four configs: `dev`, `preview`, `stg` and `prd`.
- **Syncs:** `stg` goes to Vercel staging, `preview` to Vercel previews, and `prd` to AWS when production goes live.
- **No variables made by hand on any platform**, and every change is followed by a redeploy.
- **Every secret exists separately for each environment** (rule 1).
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

- **Plan:** the organisation stays on GitHub's free plan. No GitHub Team and no Secret Protection add-on.
- **Organisation:**
  - 2FA required for every member;
  - every person on their own account;
  - unused members removed.
- **Repo:** `hrizzup`, private.
- **Security:**
  - Dependabot alerts and security updates on, confirmed through GitHub's API;
  - an open-source secret scanner (gitleaks) runs before every commit and in CI, so a secret can never be committed.
- **How the secret scanner works:**
  - Before every commit, a git hook in `.githooks/` scans the staged changes and stops the commit if it finds a secret, or if gitleaks isn't installed. Claude Code switches the hook on at the start of every session.
  - In CI, a workflow scans the whole history on every push and pull request.
  - The free plan has no push protection and no required checks for private repos, so CI can flag a secret but cannot block the push. The commit hook is the real gate.
- **What the free plan doesn't have for a private repo:** rulesets, branch protection, GitHub's own secret scanning and push protection. GitHub itself cannot block a direct push to `main` or `staging`, so no file may claim that it does (rule 1).
- **Environment names:** pick ones that don't collide with the names Vercel creates (`Production`, `Preview`), for example `hrizzup-staging` and `hrizzup-production`.

---

## 12. AWS (production, later)

- **DECIDE:** a separate AWS account for Hrizzup (recommended).
- **Paid plan from the start.** The Free plan closes the account when its credits run out.
- **Access:**
  - MFA on the root login;
  - no long-lived admin keys;
  - deploys use GitHub's short-lived credentials (OIDC).
- **Budget and billing alarms** set up.
- **Region:** Mumbai, fixed in code.
- **Lessons kept from the experiment's AWS setup:**
  - give app servers a NAT gateway or VPC endpoints, so they can reach outside services;
  - keep the app's connection keep-alive longer than the load balancer's idle timeout;
  - cap the app's memory;
  - keep the health check separate from the readiness check;
  - only count a deploy as successful when the health page shows the version that was just deployed.

---

## 13. Order of setup

1. **Domain and DNS:** add the zone to Cloudflare, set the nameservers at GoDaddy, turn on DNSSEC, and create the Cloudflare API token. At the same time: require 2FA across the GitHub organisation, create the repo, run the first Claude Code session, so every setting has somewhere to be recorded, then turn on Dependabot and the secret scanner.
2. **Email:** the Proton domain, addresses and DMARC record, then Resend's sending subdomain.
3. **Doppler:** the project and its four configs. Move every key saved so far into it.
4. **Supabase:** the staging project.
5. **Storage and bot protection:** the staging R2 buckets and their public subdomain, and the staging Turnstile widget.
6. **Redis and sign-in:** the staging Upstash database and the staging Google sign-in client.
7. **Vercel:** the project, once the first app exists, synced from Doppler, with `staging.hrizzup.com` and the holding page.
8. **Later, with the team:** Sentry, PostHog, the Apple and Google Play accounts, then AWS for production.
9. **Throughout:** Claude Code records every setting in `docs/setup.md`.
