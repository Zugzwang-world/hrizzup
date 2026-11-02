# Hrizzup: setup runbook

> Every step to set up Hrizzup's staging environment and its production twin, in order, plus how a release works. It follows the blueprint in `docs/setup/BLUEPRINT.md`.
> This file lives in the repo at `docs/setup/RUNBOOK.md`.

## How to use this runbook

- **Do the parts in order.** Each step says who does it: **You** or **Claude Code**.
- **For a Claude Code step,** open Claude Code in the `hrizzup` repo and say: *"Do runbook step 4.2"*. Claude Code does it, asks you for any login it needs, and records the result in `docs/setup.md`.
- **Save every login, password and recovery code in Proton Pass,** in a vault called **Hrizzup**. Switch on two-step login for every account.
- **Never paste a secret into any chat.** Keys you create yourself go straight into Doppler's dashboard. Keys Claude Code creates go straight into Doppler without being shown.
- **A part is finished when its "Done when" line is true.**
- **The app's building blocks are decided:** the Expo app and Next.js website in one codebase with one typed API, Supabase Realtime for live updates, the database's own search, links that open the app, Playwright and Maestro tests, and the image pipeline on R2 and Cloudflare. See PLAN.md section 2, "How it's built", and blueprint section 13. The steps below set up the services they run on. Every page and screen also follows the performance and caching rules in blueprint section 14, "Production quality".
- **Every change goes on its own branch and pull request,** from now on, including staging. Claude Code opens it, the checks that fit the change run (including the secret check on every pull request), the pull request gets a preview link once Vercel is connected, and Claude Code merges it as soon as the checks pass. No human approval. GitHub refuses changes to `main` that skip this.

## Every screen fits every device

**The rule:** every screen adjusts itself to any device, from a small phone to a large monitor, with nothing cut off, overlapping or scrolling sideways. It applies from the first screen (the holding page in Part 9) onwards. CLAUDE.md carries the same rule.

- **Flexible layouts only.** Layouts are built from flexible rules: proportions, wrapping, and Tailwind and shadcn/ui responsive classes. Never fixed pixel widths tuned to one screen.
- **Phone-first.** Every screen is designed for the phone first, then allowed to grow.
- **An automatic check before you see anything.** Before showing you any screen change, Claude Code tests it in a real browser (Playwright, in both Chrome's engine and Safari's engine, which every iPhone uses) at these widths:

  | Kind of device | Widths in pixels |
  |---|---|
  | Phones | 320, 360, 390, 412 |
  | Tablets | 768, 820, 1024 |
  | Laptops | 1280, 1366, 1440, 1536 |
  | Monitors | 1920, 2560 |

  Each width is tested at a typical height for that kind of device. Phones and tablets are also tested turned sideways (width and height swapped). The check fails if anything overflows, overlaps or needs sideways scrolling.
- **Large text.** The phone widths (320 to 412) are also tested with the phone's text size turned up to 200%, with the same pass-or-fail rule.
- **Windows laptops.** At 125% and 150% display scaling, Windows laptops show a narrower page. The 1280, 1366 and 1536 widths cover them.
- **Screenshots for you** at phone, tablet, laptop and monitor sizes: 360, 768, 1440 and 1920 pixels wide.

---

# Part 0: Before you start

**What we're doing:** the Hrizzup vault in Proton Pass, and two-step login on every account.

**Why:** every login and recovery code needs one safe home before any account is set up.

| Step | Who | What to do |
|---|---|---|
| 0.1 | You | In Proton Pass, create a vault called **Hrizzup**. |
| 0.2 | You | Check that two-step login is on for GitHub, GoDaddy, Cloudflare, Proton, Doppler, Supabase, Vercel, Upstash, Resend and Google. |
| 0.3 | You | Download `PLAN.md`, `HRIZZUP-SETUP.md` and `SETUP-RUNBOOK.md` into your Downloads folder. |

**Done when:** the vault exists, and every account has two-step login.

---

# Part 1: GitHub and the repository

**What we're doing:** the private repo with the plan, rules and folders.

**Why:** the single home for the code and for every setting we make.

| Step | Who | What to do |
|---|---|---|
| 1.1 | You | The repo lives in your personal GitHub account, `Zugzwang-world`, on GitHub Pro. Check that two-step login is on for that account and that its recovery codes are saved in Proton Pass. Anyone you add to the repo later must have two-step login on too. **Done, 2 November 2026:** you use two-step login on your GitHub account. |
| 1.2 | You | Create the repository: owner `Zugzwang-world` (your personal account, on GitHub Pro), name `hrizzup`, **Private**, README off, no .gitignore, licence **No license**. |
| 1.3 | You | In a terminal, clone the repo and start Claude Code (the commands are in the chat). |
| 1.4 | Claude Code | First session (the brief is in the chat): puts the plan, blueprint and this runbook in place, plus the folders, status files, setup log, CLAUDE.md, the proprietary licence notice and .gitignore. It also installs the plugins and connectors, then commits and pushes. |
| 1.6 | Claude Code | Turn on Dependabot alerts and security updates, and confirm them through GitHub's API. |
| 1.7 | Claude Code | Set up how changes land: a secret check that runs automatically on every pull request (and once now over the whole history); a rule for `main` (checks must pass before merging, no force-push, no required reviews); auto-merge and automatic branch deletion after merging. Confirm each through GitHub's API, and land this change itself through a pull request. |

The repo lives in your personal GitHub account, `Zugzwang-world`, on GitHub Pro, so there is no step 1.5 (it was the paid-plan decision). The other step numbers are unchanged.

**Done when:** the repo holds the plan files, two-step login is on for your GitHub account, Dependabot alerts and security updates are confirmed on, and the secret check, the rule for `main`, auto-merge and branch deletion are confirmed through GitHub's API.

**Part 1 finished on 2 November 2026,** including step 1.7. The details are in the setup log.

---

# Part 2: Domain and DNS

**What we're doing:** hrizzup.com on Cloudflare, DNSSEC, and API access for Claude Code.

**Why:** email, the website and storage all depend on the domain.

| Step | Who | What to do |
|---|---|---|
| 2.1 | You | In Cloudflare, add the site `hrizzup.com` and choose the **Free** plan (it moves to Pro in Part 10, "Production twin"). Copy the two nameservers Cloudflare gives you. |
| 2.2 | You | In GoDaddy, open `hrizzup.com` and check DNSSEC is **off**. Replace the nameservers with Cloudflare's two. Turn on the transfer lock and auto-renew. |
| 2.3 | You | Wait until Cloudflare shows `hrizzup.com` as **Active**. This can take from minutes to a few hours. |
| 2.4 | You | In Cloudflare, turn on **DNSSEC**. It will show a DS record. In GoDaddy, add that DS record in `hrizzup.com`'s DNSSEC section, then wait for Cloudflare to confirm DNSSEC is active. |
| 2.5 | You | In Cloudflare, create an **API token** for Claude Code with exactly these permission rows and nothing else: Zone · DNS · Edit; Zone · Zone Settings · Edit; Zone · Zone · Read; Account · Workers R2 Storage · Edit; Account · Turnstile · Edit. Limit the zone rows to `hrizzup.com` and the account rows to your account. Save it straight into Doppler `dev` as `CLOUDFLARE_API_TOKEN`, never in a chat. |
| 2.6 | Claude Code | Using the token through `doppler run` (never printed): check from the outside that the nameservers are Cloudflare's, and that DNSSEC works end to end (the DS record at the .com registry matches Cloudflare's, and validating resolvers accept the answers). Delete every record Cloudflare imported from GoDaddy, so the zone starts empty. Apply the zone settings: SSL/TLS Full (strict), Always Use HTTPS, minimum TLS 1.2, TLS 1.3, Automatic HTTPS Rewrites. Check that the token can do only what step 2.5 lists. Record everything. **Done, 2 November 2026,** except trimming the key (see the reminder below). |

**Reminder, still open: trim the Cloudflare key.** Step 2.6 found that the key can also read Workers scripts, Workers routes, Page Rules and Email Routing settings, which it doesn't need. To trim it:

1. In Cloudflare, click the person icon at the top right, then **My Profile**, then **API Tokens**.
2. Next to the key you made for Claude Code, click the **three dots**, then **Edit**.
3. Under **Permissions**, keep exactly the five rows in step 2.5 (Zone · DNS · Edit; Zone · Zone Settings · Edit; Zone · Zone · Read; Account · Workers R2 Storage · Edit; Account · Turnstile · Edit) and delete every other row.
4. Under **Zone Resources**, choose Include, Specific zone, `hrizzup.com`. Under **Account Resources**, choose your account.
5. Click **Continue to summary**, then **Update token**. The key's value stays the same, so nothing changes in Doppler.
6. Tell Claude Code it's done. Claude Code checks the key again, records the result and removes this reminder.

**Done when:** Cloudflare shows Active with DNSSEC confirmed end to end, the zone is empty, the zone settings are on, and the token holds only the permissions in step 2.5.

---

# Part 3: Email

**What we're doing:** Proton addresses and Resend's sending domain.

**Why:** Hrizzup's own email, and sign-in emails that land in the inbox.

| Step | Who | What to do |
|---|---|---|
| 3.1 | You | In Proton, add `hrizzup.com` as a custom domain. Proton then shows the DNS records it needs. |
| 3.2 | Claude Code | Add Proton's records in Cloudflare, all **DNS only**: the verification TXT, two MX records, the SPF TXT and three DKIM CNAMEs. Paste the values Proton shows into Claude Code; they aren't secret. Then add the DMARC record `v=DMARC1; p=quarantine`, leaving alignment relaxed. **Done, 3 November 2026:** all eight records answer in public DNS (setup log). |
| 3.3 | You | In Proton, verify each record, then create your addresses (for example `founder@` and `hello@`; your choice). Then tell Claude Code which address should receive DMARC reports: Claude Code adds it to the DMARC record (`rua=mailto:…`), so you see who sends mail in hrizzup.com's name. |
| 3.4 | You | Send a test email to the new address and one from it, and check both arrive. |
| 3.5 | You | In Resend (paid plan), create a full-access API key for setup and save it straight into Doppler `dev` as `RESEND_SETUP_API_KEY`, never in a chat. **Done, 3 November 2026;** deleted again at the end of step 3.6. |
| 3.6 | Claude Code | Through Resend's API, with the setup key through `doppler run`: create the sending domain `mail.hrizzup.com` in the Tokyo region (`ap-northeast-1`, the closest of Resend's regions to India), with open and click tracking off. Add the records Resend returns to Cloudflare (DNS only) and start verification. Create one sending-only key for staging, limited to `mail.hrizzup.com`, and put it into Doppler `stg` as `RESEND_API_KEY` without showing it; the production key comes in Part 10 (step 10.11). Then delete the setup key from Resend and Doppler. **Done, 3 November 2026:** verified (setup log). |
| 3.7 | Claude Code | Send a test email from `no-reply@mail.hrizzup.com` to your address with the staging key, and check that it lands in the inbox and passes DMARC. |

**Note:** the inbox that receives the Grok bots' results is designed in the Sourcing project. It has to be an address our pipeline can read automatically, not your Proton inbox.

**Done when:** Proton is verified and mail works both ways, the Resend domain is verified, and the test email reaches the inbox with DMARC passing.

---

# Part 4: Secrets (Doppler)

**What we're doing:** the Doppler project and configs, on Doppler's free **Developer** plan during staging.

**Why:** one safe place for every key; hosting copies its keys from it.

| Step | Who | What to do |
|---|---|---|
| 4.1 | — | **Moved to Part 10, step 10.1:** the upgrade to Doppler's Team plan. Doppler stays on the free Developer plan during staging, and until the upgrade only you and Claude Code use it. |
| 4.2 | Claude Code | Using Doppler's command-line tool, create the project `hrizzup` with four configs: `dev` (local work and Claude Code's setup keys), `stg` (staging), `stg_preview` (previews: a branch of `stg` that copies every staging value and holds only overrides) and `prd` (production). Claude Code asks you to log in if it needs to. **Done, 2 November 2026,** brought forward so the Cloudflare key has a safe home. |
| 4.3 | You | Move any key still saved in Proton Pass into Doppler by typing or pasting it into Doppler's dashboard. (The Cloudflare key and the Resend setup key went straight into Doppler `dev`, and the Resend setup key has since been deleted.) From now on, Proton Pass holds only logins, recovery codes and the database password. |
| 4.4 | Claude Code | Check that each config contains the expected secret **names** (never the values), and record the result. |

**Done when:** the project and its four configs exist, and every key created so far is in Doppler.

---

# Part 5: Database (Supabase, staging)

**What we're doing:** Supabase staging in Mumbai.

**Why:** where the app's data lives.

| Step | Who | What to do |
|---|---|---|
| 5.1 | You | In the Supabase Pro organisation, create the project **`hrizzup-staging`**: region **Mumbai**, compute size **Small or larger** (not Micro or Nano), and a generated database password saved in Proton Pass. |
| 5.2 | You | Turn on point-in-time recovery. Turn the spend cap off and usage alerts on. |
| 5.3 | You | Claude Code gives you the exact secret names. Copy the two connection addresses Supabase shows for its **connection pooler** (transaction mode, port 6543, and session mode, port 5432) into Doppler `stg` under those names. |
| 5.4 | Claude Code | Connect once through each address. Confirm the region is Mumbai, the Postgres version, and the pooler mode. Write the connection settings into code: a small pool, prepared statements off, and explicit idle and lifetime timeouts. Record everything. |

**Done when:** the project is in Mumbai, point-in-time recovery is on, Claude Code connects through both addresses, and the settings are recorded.

---

# Part 6: Storage and bot protection (Cloudflare R2 and Turnstile)

**What we're doing:** R2 buckets and Turnstile.

**Why:** images and videos, and blocking bots at sign-in.

| Step | Who | What to do |
|---|---|---|
| 6.1 | Claude Code | Create two staging buckets with location Asia-Pacific: **`hrizzup-staging-uploads`** (private) and **`hrizzup-staging-media`** (public). |
| 6.2 | Claude Code | Connect the public bucket to **`media-staging.hrizzup.com`**. Apply the CORS and lifecycle rules kept in the repo, and record them. |
| 6.3 | You | In Cloudflare R2, create an access key (object read and write) for each bucket, and paste each one into Doppler `stg` under the names Claude Code gives you. |
| 6.4 | Claude Code | Create the Turnstile widget **"Hrizzup staging"**: Managed mode, hostnames `staging.hrizzup.com` and `localhost`. Put its keys into Doppler `stg` without showing them. |

| 6.5 | You | In Cloudflare, open **Images → Transformations** and turn transformations on for `hrizzup.com`. Leave "resize images from any origin" **off**, so only our own images can be resized. |
| 6.6 | Claude Code | Check that a test image loads resized from `media-staging.hrizzup.com/cdn-cgi/image/width=640,format=auto/<test image>`, in a modern format, and is served from Cloudflare's cache the second time. Record the result. |

**Done when:** both buckets exist, a test file loads from `media-staging.hrizzup.com` and also loads resized through Cloudflare, the keys are in Doppler, and the widget exists.

---

# Part 7: Redis (Upstash)

**What we're doing:** the Upstash staging database.

**Why:** rate limits, caches and locks.

| Step | Who | What to do |
|---|---|---|
| 7.1 | You | In Upstash (paid plan), create the database **`hrizzup-staging`** in the Mumbai region, or the nearest region Upstash offers. Note the region it shows after creation. |
| 7.2 | You | Paste its REST URL and token into Doppler `stg`. |
| 7.3 | Claude Code | Measure how long a request takes from Mumbai (last time about 135 ms suggested the database was in the wrong region). Record the result. |

**Done when:** the database exists in or near Mumbai, its keys are in Doppler, and the response time is recorded.

---

# Part 8: Sign-in (Google)

**What we're doing:** the Google sign-in client.

**Why:** "Sign in with Google".

| Step | Who | What to do |
|---|---|---|
| 8.1 | You | In Google Cloud, create the project **`hrizzup`** and turn billing on. |
| 8.2 | You | Set up the OAuth consent screen: **External**, app name Hrizzup, your support email, authorised domain `hrizzup.com`, and the homepage and privacy-policy addresses (the holding page from Part 9). |
| 8.3 | You | Create an OAuth client of type **Web application** for staging, with origin `https://staging.hrizzup.com` and the redirect address Claude Code gives you. Paste the client ID and secret into Doppler `stg`. |
| 8.4 | You | Add yourself and your testers as test users. The consent screen starts in Testing mode and is published before launch. |

**Done when:** the staging client's keys are in Doppler and the consent screen is saved.
*(Sign in with Apple is added with the iPhone build; the production Google client is created in Part 10, "Production twin".)*

---

# Part 9: Hosting (Vercel), once the first app exists

**What we're doing:** the Vercel project, staging.hrizzup.com, hidden production builds, and the holding page on hrizzup.com.

**Why:** the staging website, served from Mumbai, and a production side that goes live only when a build is promoted.

| Step | Who | What to do |
|---|---|---|
| 9.1 | Claude Code | Create the Vercel project **`hrizzup`** in your Pro team, connected to the repo. Set the region to Mumbai (`bom1`) in `vercel.json`, and show the region and the commit on `/api/health`. |
| 9.2 | Claude Code | Set the production branch to `main` and turn **off** "Auto-assign Custom Production Domains", so every merge to `main` makes a hidden production build that isn't live. Create a custom environment **`staging`** that deploys every merge to `main` (through its branch tracking if Vercel allows it on the production branch; otherwise through a deploy workflow kept in the repo). |
| 9.3 | You | In Doppler, connect to Vercel: sync `stg` to Vercel's staging environment and `stg_preview` to Vercel's previews, both marked Sensitive. |
| 9.4 | Claude Code | Add the domains: `staging.hrizzup.com` for staging, and `hrizzup.com` and `www` for production. Add the records Vercel asks for in Cloudflare, **DNS only**. Make the first production deployment the holding page with its privacy policy, and promote it once; it stays live until launch. |
| 9.5 | You | In Vercel, turn on deployment protection (Standard Protection), which covers previews and the private addresses of hidden production builds. Keep staging protected until testers join. |
| 9.6 | Claude Code | Confirm `autoAssignCustomDomains` is off, set and record the firewall rules, confirm `/api/health` reports `bom1`, run a test deploy to `staging.hrizzup.com`, and check that a pull request gets a preview link. |

**Done when:** `staging.hrizzup.com` loads securely from Mumbai, `hrizzup.com` shows the holding page with its privacy policy, merges to `main` make hidden production builds, pull requests get preview links, and previews are protected.

---

# Part 10: Production twin

**What we're doing:** a production copy of the staging setup (Supabase project, Vercel production, Doppler `prd`, R2 buckets, Redis database, Google sign-in client, Turnstile widget), created as soon as staging works, with nothing public until launch. Doppler moves to its Team plan and Cloudflare to Pro first.

**Why:** going live becomes a promotion, not a migration.

Everything matches staging (the same services, versions, region and settings) except the names, the data and the keys. Production starts empty.

| Step | Who | What to do |
|---|---|---|
| 10.1 | You | Upgrade the Doppler workplace to the **Team** plan ($21 per user a month). Do it before any helper joins Doppler, even if that's before Part 10. **Why:** the Team plan's roles let you keep production keys to yourself once helpers use Doppler; on the free plan, Doppler can't limit what a member opens. Give each helper the **Collaborator** role on Development and Staging, and no access to Production. Before the first helper joins, Claude Code moves its own setup keys (such as the Cloudflare key) out of `dev` into their own environment, which helpers can't open. |
| 10.2 | You | In Cloudflare, upgrade `hrizzup.com` to the **Pro** plan, and turn on Cloudflare Images' paid plan, so new image sizes never fail once the free 5,000 a month are used up. |
| 10.3 | You | In the Supabase Pro organisation, create **`hrizzup-production`**: region **Mumbai**, the same compute size as staging, and a generated database password saved in Proton Pass. Turn on point-in-time recovery; turn the spend cap off and usage alerts on. |
| 10.4 | You | Copy its two connection-pooler addresses (transaction mode, port 6543, and session mode, port 5432) into Doppler `prd`, under the names Claude Code gives you. |
| 10.5 | Claude Code | Connect through each address. Confirm the region, Postgres version, compute size, pooler mode and extensions match staging, and run the same migrations. Record the comparison. |
| 10.6 | Claude Code | Create the production buckets with the same location as staging: **`hrizzup-production-uploads`** (private) and **`hrizzup-production-media`** (public). Connect the public one to **`media.hrizzup.com`**, and apply the same CORS and lifecycle rules from the repo. Image transformations (step 6.5) already cover it, because they are switched on for the whole zone. |
| 10.7 | You | In Cloudflare R2, create an access key (object read and write) for each production bucket, and paste each one into Doppler `prd` under the names Claude Code gives you. |
| 10.8 | You | In Upstash, create **`hrizzup-production`** on the same plan and in the same region as staging, and paste its REST URL and token into Doppler `prd`. |
| 10.9 | You | In the Google Cloud project `hrizzup`, create an OAuth client of type **Web application** for production, with origins `https://hrizzup.com` and `https://www.hrizzup.com` and the redirect address Claude Code gives you. Paste the client ID and secret into Doppler `prd`. |
| 10.10 | You | In Resend, create a temporary full-access API key named "Claude Code setup – hrizzup production", and save it straight into Doppler `dev` as `RESEND_SETUP_API_KEY`, never in a chat. |
| 10.11 | Claude Code | Create the Turnstile widget **"Hrizzup production"**: Managed mode, hostnames `hrizzup.com` and `www.hrizzup.com`. Put its keys into Doppler `prd` without showing them. Create Resend's production key the same way as the staging one (step 3.6): sending only, limited to `mail.hrizzup.com`, stored in Doppler `prd` as `RESEND_API_KEY` without showing it. Then delete the temporary setup key from Resend and Doppler. |
| 10.12 | You | In Doppler, sync `prd` to Vercel's production environment, marked Sensitive. |
| 10.13 | Claude Code | Compare staging and production side by side: every service, version, region and setting must match, and only names, data and keys may differ. Confirm a hidden production build's private `/api/health` reports `bom1` and the production setup, that a test image loads resized from `media.hrizzup.com`, and that `hrizzup.com` still shows the holding page. Record the comparison. |

**Done when:** Doppler is on the Team plan, `hrizzup.com` is on Cloudflare Pro with Images' paid plan on, every production service exists with the same settings as staging, its keys are in Doppler `prd` and synced to Vercel production, the side-by-side comparison passes, and nothing public has changed.

---

# Part 11: Hand over to the three projects

**What we're doing:** the three Claude projects sync and review.

**Why:** the thinking projects start from the real setup.

| Step | Who | What to do |
|---|---|---|
| 11.1 | Claude Code | Check that `docs/setup.md` lists every account, plan, region and setting (with no secrets), and update the status files. |
| 11.2 | You | In each Claude project (Sourcing, News Desk, Product), add `PLAN.md`, `docs/setup/` and `docs/status/` from GitHub, then click "Sync now". |
| 11.3 | You | Ask each project for one review of the setup. |
| 11.4 | — | Product work starts (PLAN.md, Phase 1). |

**Done when:** all three projects have reviewed the setup.

---

# Releasing to production

**What we're doing:** putting the exact production build of a commit that passed staging live, with one command.

**Why:** nothing is rebuilt between the check and going live, and going back is one command too.

**Why it works this way:** Vercel puts each environment's keys into its build. If a staging build is promoted, Vercel rebuilds it with production keys, so it would no longer be the build that was checked. So every merge to `main` builds the same commit twice: once for staging, and once as a hidden production build (production keys and data, private address only). That hidden build is what gets promoted, untouched.

| Step | Who | What to do |
|---|---|---|
| R.1 | Claude Code | Pick the commit that passed staging and find its hidden production build. |
| R.2 | Claude Code | Apply that commit's database changes to production first, if it has any. They are written so the version that is live keeps working with them. |
| R.3 | Claude Code | Check that `autoAssignCustomDomains` is still off, and that the hidden build's private `/api/health` shows that commit and `bom1`. |
| R.4 | Claude Code, when you say "release" | Run the one command: `vercel promote <address of the hidden build> --yes`. It goes live instantly, with no rebuild. |
| R.5 | Claude Code | Confirm `hrizzup.com/api/health` shows that commit, and record the release in `docs/setup.md`. |

**Going back:** `vercel rollback`, also instant, with no rebuild.

**Before launch:** `hrizzup.com` shows the holding page, so the first promotion of an app build is the launch.

---

# Later, with the team

- **Sentry and PostHog:** one project per environment, with keys in Doppler.
- **Apple Developer and Google Play accounts.** Start Google Play early: a personal account needs a closed test with at least 12 testers for 14 days before the app can go public. Their app IDs and signing fingerprints go into the two files the website serves so that shared links open the app (`/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`).
- **RevenueCat and Razorpay:** set up with the app, for the paid tier, which is in version one (PLAN.md step 2.7). Razorpay with UPI on the website.
- **Cloudflare Stream:** switched on in the same Cloudflare account when creator video is built (PLAN.md step 2.4), with separate API tokens for staging and production, a budget alert, and the tokens kept in Doppler.
- **At launch:** CAA records naming every certificate authority that Cloudflare and Vercel use.
- **AWS:** later, only if a concrete need appears, as its own project.

---

# Production hardening

**What we're doing:** the last safety layer, added before real users arrive.

**Why:** staging and the production twin are run by Claude Code; real users' data must sit behind keys that only you hold.

- **Production keys held only by you.** Before real users arrive, you replace every production key in Doppler `prd` with a new one that only you hold, and Claude Code's access to `prd` is removed through Doppler's roles (Team plan, step 10.1). Production keys never go in this repository.

**Done when:** every production key has been replaced, Claude Code can no longer read `prd`, and this is recorded in the setup log, before the first real user signs in.

*(The secret check, pull requests and repository protections used to be listed here. They have been on since 2 November 2026; see Part 1, step 1.7.)*
