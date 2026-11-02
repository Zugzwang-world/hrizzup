# Hrizzup: staging setup runbook

> Every step to set up Hrizzup's staging environment, in order. It follows the blueprint in `docs/setup/BLUEPRINT.md`.
> This file lives in the repo at `docs/setup/RUNBOOK.md`.

## How to use this runbook

- **Do the parts in order.** Each step says who does it: **You** or **Claude Code**.
- **For a Claude Code step,** open Claude Code in the `hrizzup` repo and say: *"Do runbook step 4.2"*. Claude Code does it, asks you for any login it needs, and records the result in `docs/setup.md`.
- **Save every login, password and recovery code in Proton Pass,** in a vault called **Hrizzup**. Switch on two-step login for every account.
- **Never paste a secret into any chat.** Keys you create yourself go straight into Doppler's dashboard. Keys Claude Code creates go straight into Doppler without being shown.
- **A part is finished when its "Done when" line is true.**

---

# Part 0: Before you start

| Step | Who | What to do |
|---|---|---|
| 0.1 | You | In Proton Pass, create a vault called **Hrizzup**. |
| 0.2 | You | Check that two-step login is on for GitHub, GoDaddy, Cloudflare, Proton, Doppler, Supabase, Vercel, Upstash, Resend and Google. |
| 0.3 | You | Download `PLAN.md`, `HRIZZUP-SETUP.md` and `SETUP-RUNBOOK.md` into your Downloads folder. |

**Done when:** the vault exists, and every account has two-step login.

---

# Part 1: GitHub and the repository

| Step | Who | What to do |
|---|---|---|
| 1.1 | You | In the `zugzwang-foundation` organisation's settings, require two-factor authentication for all members. **Check first:** GitHub removes any member who hasn't set up 2FA when you switch this on, so make sure your team has it. |
| 1.2 | You | Create the repository: owner `zugzwang-foundation`, name `hrizzup`, **Private**, README off, no .gitignore, licence **No license**. |
| 1.3 | You | In a terminal, clone the repo and start Claude Code (the commands are in the chat). |
| 1.4 | Claude Code | First session (the brief is in the chat): puts the plan, blueprint and this runbook in place, plus the folders, status files, setup log, CLAUDE.md, the proprietary licence notice and .gitignore. It also installs the plugins and connectors, then commits and pushes. |
| 1.5 | You | Decide the GitHub plan. A private repo only gets branch protection, rulesets, secret scanning and push protection if the **organisation** is on GitHub Team with the Secret Protection add-on (see the blueprint, section 2). If you go ahead, upgrade the organisation. |
| 1.6 | Claude Code | After 1.5: set rulesets on `main` and `staging` (changes only through pull requests, required checks green, no force-push); turn on secret scanning, push protection, Dependabot alerts and security updates; confirm each one through GitHub's API; record them. |

**Done when:** the repo holds the plan files, 2FA is required for every member, and (after 1.5) every protection is confirmed through the API.

---

# Part 2: Domain and DNS

| Step | Who | What to do |
|---|---|---|
| 2.1 | You | In Cloudflare, add the site `hrizzup.com` and choose the **Pro** plan. Copy the two nameservers Cloudflare gives you. |
| 2.2 | You | In GoDaddy, open `hrizzup.com` and check DNSSEC is **off**. Replace the nameservers with Cloudflare's two. Turn on the transfer lock and auto-renew. |
| 2.3 | You | Wait until Cloudflare shows `hrizzup.com` as **Active**. This can take from minutes to a few hours. |
| 2.4 | You | In Cloudflare, turn on **DNSSEC**. It will show a DS record. In GoDaddy, add that DS record in `hrizzup.com`'s DNSSEC section, then wait for Cloudflare to confirm DNSSEC is active. |
| 2.5 | You | In Cloudflare, create an **API token** for Claude Code that can edit `hrizzup.com`'s DNS, R2 storage and Turnstile, and nothing else. Save it in Proton Pass; it moves into Doppler in Part 4. |
| 2.6 | Claude Code | Check from the outside: the nameservers are Cloudflare's, DNSSEC is signed, and there are no stray records. Record the result. |

**Done when:** Cloudflare shows Active with DNSSEC confirmed, the token is saved, and Claude Code's check passes.

---

# Part 3: Email

| Step | Who | What to do |
|---|---|---|
| 3.1 | You | In Proton, add `hrizzup.com` as a custom domain. Proton then shows the DNS records it needs. |
| 3.2 | Claude Code | Add Proton's records in Cloudflare, all **DNS only**: the verification TXT, two MX records, the SPF TXT and three DKIM CNAMEs. Paste the values Proton shows into Claude Code; they aren't secret. Then add the DMARC record `v=DMARC1; p=quarantine; rua=mailto:<your address>`, leaving alignment relaxed. |
| 3.3 | You | In Proton, verify each record, then create your addresses (for example `founder@` and `hello@`; your choice). |
| 3.4 | You | Send a test email to the new address and one from it, and check both arrive. |
| 3.5 | You | In Resend (paid plan), create a full-access API key for setup and put it into Doppler's `dev` config once Part 4 exists. Until then, keep it in Proton Pass. |
| 3.6 | Claude Code | Through Resend's API: create the sending domain `mail.hrizzup.com`, add the records Resend returns to Cloudflare (DNS only), and start verification. Create two sending-only keys, one for staging and one for production, and put them into Doppler. Then delete the setup key. |
| 3.7 | Claude Code | Send a test email from `no-reply@mail.hrizzup.com` to your address, and check that it lands in the inbox and passes DMARC. |

**Note:** the inbox that receives the Grok bots' results is designed in the Sourcing project. It has to be an address our pipeline can read automatically, not your Proton inbox.

**Done when:** Proton is verified and mail works both ways, the Resend domain is verified, and the test email reaches the inbox with DMARC passing.

---

# Part 4: Secrets (Doppler)

| Step | Who | What to do |
|---|---|---|
| 4.1 | You | Upgrade the Doppler workplace to the **Team** plan. |
| 4.2 | Claude Code | Using Doppler's command-line tool, create the project `hrizzup` with four configs: `dev`, `preview`, `stg` and `prd`. Claude Code asks you to log in if it needs to. |
| 4.3 | You | Move every key saved so far from Proton Pass into Doppler by typing or pasting it into Doppler's dashboard: the Cloudflare token into `dev`, and the Resend setup key into `dev` if it's still there. From now on, Proton Pass holds only logins, recovery codes and the database password. |
| 4.4 | Claude Code | Check that each config contains the expected secret **names** (never the values), and record the result. |

**Done when:** the project and its four configs exist, and every key created so far is in Doppler.

---

# Part 5: Database (Supabase, staging)

| Step | Who | What to do |
|---|---|---|
| 5.1 | You | In the Supabase Pro organisation, create the project **`hrizzup-staging`**: region **Mumbai**, compute size **Small or larger** (not Micro or Nano), and a generated database password saved in Proton Pass. |
| 5.2 | You | Turn on point-in-time recovery. Turn the spend cap off and usage alerts on. |
| 5.3 | You | Claude Code gives you the exact secret names. Copy the two connection addresses Supabase shows for its **connection pooler** (transaction mode, port 6543, and session mode, port 5432) into Doppler `stg` under those names. |
| 5.4 | Claude Code | Connect once through each address. Confirm the region is Mumbai, the Postgres version, and the pooler mode. Write the connection settings into code: a small pool, prepared statements off, and explicit idle and lifetime timeouts. Record everything. |

**Done when:** the project is in Mumbai, point-in-time recovery is on, Claude Code connects through both addresses, and the settings are recorded.

---

# Part 6: Storage and bot protection (Cloudflare R2 and Turnstile)

| Step | Who | What to do |
|---|---|---|
| 6.1 | Claude Code | Create two staging buckets with location Asia-Pacific: **`hrizzup-staging-uploads`** (private) and **`hrizzup-staging-media`** (public). |
| 6.2 | Claude Code | Connect the public bucket to **`media-staging.hrizzup.com`**. Apply the CORS and lifecycle rules kept in the repo, and record them. |
| 6.3 | You | In Cloudflare R2, create an access key (object read and write) for each bucket, and paste each one into Doppler `stg` under the names Claude Code gives you. |
| 6.4 | Claude Code | Create the Turnstile widget **"Hrizzup staging"**: Managed mode, hostnames `staging.hrizzup.com` and `localhost`. Put its keys into Doppler `stg` without showing them. |

**Done when:** both buckets exist, a test file loads from `media-staging.hrizzup.com`, the keys are in Doppler, and the widget exists.

---

# Part 7: Redis (Upstash)

| Step | Who | What to do |
|---|---|---|
| 7.1 | You | In Upstash (paid plan), create the database **`hrizzup-staging`** in the Mumbai region, or the nearest region Upstash offers. Note the region it shows after creation. |
| 7.2 | You | Paste its REST URL and token into Doppler `stg`. |
| 7.3 | Claude Code | Measure how long a request takes from Mumbai (last time about 135 ms suggested the database was in the wrong region). Record the result. |

**Done when:** the database exists in or near Mumbai, its keys are in Doppler, and the response time is recorded.

---

# Part 8: Sign-in (Google)

| Step | Who | What to do |
|---|---|---|
| 8.1 | You | In Google Cloud, create the project **`hrizzup`** and turn billing on. |
| 8.2 | You | Set up the OAuth consent screen: **External**, app name Hrizzup, your support email, authorised domain `hrizzup.com`, and the homepage and privacy-policy addresses (the holding page from Part 9). |
| 8.3 | You | Create an OAuth client of type **Web application** for staging, with origin `https://staging.hrizzup.com` and the redirect address Claude Code gives you. Paste the client ID and secret into Doppler `stg`. |
| 8.4 | You | Add yourself and your testers as test users. The consent screen starts in Testing mode and is published before launch. |

**Done when:** the staging client's keys are in Doppler and the consent screen is saved.
*(Sign in with Apple is added with the iPhone build; the production Google client is added at production.)*

---

# Part 9: Hosting (Vercel), once the first app exists

| Step | Who | What to do |
|---|---|---|
| 9.1 | Claude Code | Create the Vercel project **`hrizzup`** in your Pro team, connected to the repo. Set the region to Mumbai (`bom1`) in `vercel.json`, and show the region on `/api/health`. |
| 9.2 | Claude Code | Create a custom environment **`staging`** tied to the `staging` branch. |
| 9.3 | You | In Doppler, connect to Vercel: sync `stg` to Vercel's staging environment and `preview` to Vercel's previews, both marked Sensitive. |
| 9.4 | Claude Code | Add the domains: `staging.hrizzup.com` for staging, and `hrizzup.com` and `www` for the holding page. Add the records Vercel asks for in Cloudflare, **DNS only**. |
| 9.5 | You | In Vercel, turn on deployment protection for previews. Keep staging protected until testers join. |
| 9.6 | Claude Code | Check the `autoAssignCustomDomains` setting, set and record the firewall rules, confirm `/api/health` reports `bom1`, and run a test deploy to `staging.hrizzup.com`. |

**Done when:** `staging.hrizzup.com` loads securely from Mumbai, `hrizzup.com` shows the holding page with its privacy policy, and previews are protected.

---

# Part 10: Hand over to the three projects

| Step | Who | What to do |
|---|---|---|
| 10.1 | Claude Code | Check that `docs/setup.md` lists every account, plan, region and setting (with no secrets), and update the status files. |
| 10.2 | You | In each Claude project (Sourcing, News Desk, Product), add `PLAN.md`, `docs/setup/` and `docs/status/` from GitHub, then click "Sync now". |
| 10.3 | You | Ask each project for one review of the setup. |
| 10.4 | — | Product work starts (PLAN.md, Phase 1). |

**Done when:** all three projects have reviewed the setup.

---

# Later, with the team

- **Sentry and PostHog:** one project per environment, with keys in Doppler.
- **Apple Developer and Google Play accounts.** Start Google Play early: a personal account needs a closed test with at least 12 testers for 14 days before the app can go public.
- **Production:**
  - an AWS account;
  - the Doppler `prd` config;
  - production storage buckets, Redis, Google client and Turnstile widget;
  - CAA records;
  - Cloudflare's proxy with origin authentication.
