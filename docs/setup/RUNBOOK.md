# Hrizzup: setup runbook

> Every step to set up Hrizzup's staging environment and its production twin, in order, plus how a release works. It follows the blueprint in `docs/setup/BLUEPRINT.md`.
> This file lives in the repo at `docs/setup/RUNBOOK.md`.

## How to use this runbook

- **Do the parts in order.** Each step says who does it: **You** or **Claude Code**.
- **For a Claude Code step,** open Claude Code in the `hrizzup` repo and say: *"Do runbook step 4.2"*. Claude Code does it, asks you for any login it needs, and records the result in `docs/setup.md`.
- **Save every login, password and recovery code in Proton Pass,** in a vault called **Hrizzup**. Switch on two-step login for every account.
- **Never paste a secret into any chat.** Keys you create yourself go straight into Doppler's dashboard. Keys Claude Code creates go straight into Doppler without being shown.
- **A part is finished when its "Done when" line is true.**
- **Production is off-limits to Claude Code.** Claude Code never reads, holds or uses production keys. You create production's services and keys yourself, and production is changed only by the release pipeline, which has its own production credentials (Part 10).
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
| 2.5 | You | In Cloudflare, create an **API token** for Claude Code with exactly these permission rows and nothing else: Zone · DNS · Edit; Zone · Zone Settings · Edit; Zone · Zone · Read; Account · Workers R2 Storage · Edit; Account · Turnstile · Edit. Limit the zone rows to `hrizzup.com` and the account rows to your account. Save it straight into Doppler as `CLOUDFLARE_API_TOKEN`, never in a chat. (It went into `dev` at the time and moved to Claude Code's own project, `hrizzup-tools`, in step 4.5.) |
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
| 3.3 | You | In Proton, verify each record, then create your addresses (for example `founder@` and `hello@`; your choice). DMARC reports go to Cloudflare's **DMARC Management** (turn it on for `hrizzup.com`): it adds its own reports address to the DMARC record and shows who sends mail in hrizzup.com's name, so no personal address is needed. **DMARC Management on, 3 November 2026** (setup log). |
| 3.4 | You | Send a test email to the new address and one from it, and check both arrive. |
| 3.5 | You | In Resend (paid plan), create a full-access API key for setup and save it straight into Doppler `dev` as `RESEND_SETUP_API_KEY`, never in a chat. **Done, 3 November 2026;** deleted again at the end of step 3.6. Setup keys now go in `hrizzup-tools` instead (step 4.5). |
| 3.6 | Claude Code | Through Resend's API, with the setup key through `doppler run`: create the sending domain `mail.hrizzup.com` in the Tokyo region (`ap-northeast-1`, the closest of Resend's regions to India), with open and click tracking off. Add the records Resend returns to Cloudflare (DNS only) and start verification. Create one sending-only key for staging, limited to `mail.hrizzup.com`, and put it into Doppler `stg` as `RESEND_API_KEY` without showing it; the production key comes in Part 10 (step 10.10), created by you. Then delete the setup key from Resend and Doppler. **Done, 3 November 2026:** verified (setup log). |
| 3.7 | Claude Code | Send a test email from `no-reply@mail.hrizzup.com` to your address with the staging key, and check that it lands in the inbox and passes DMARC. **Started 3 November 2026:** sent and delivered, but into **Spam**; the header check is still to do (setup log). |

**Note:** the inbox that receives the Grok bots' results is designed in the Sourcing project. It has to be an address our pipeline can read automatically, not your Proton inbox.

**Done when:** Proton is verified and mail works both ways, the Resend domain is verified, and the test email reaches the inbox with DMARC passing.

---

# Part 4: Secrets (Doppler)

**What we're doing:** the Doppler project and configs, on Doppler's free **Developer** plan during staging.

**Why:** one safe place for every key; hosting copies its keys from it.

| Step | Who | What to do |
|---|---|---|
| 4.1 | — | **Moved to "Later, with the team":** the upgrade to Doppler's Team plan, before any helper joins Doppler. Doppler stays on the free Developer plan, and until the upgrade only you and Claude Code use it. |
| 4.2 | Claude Code | Using Doppler's command-line tool, create the project `hrizzup` with four configs: `dev` (running the app on this Mac; see step 4.5), `stg` (staging), `stg_preview` (previews: a branch of `stg` that copies every staging value and holds only overrides) and `prd` (production). Claude Code asks you to log in if it needs to. **Done, 2 November 2026,** brought forward so the Cloudflare key has a safe home. |
| 4.3 | You | Move any key still saved in Proton Pass into Doppler by typing or pasting it into Doppler's dashboard. (The Cloudflare key and the Resend setup key went straight into Doppler. The Resend setup key has since been deleted, and the Cloudflare key now lives in `hrizzup-tools`, step 4.5.) From now on, Proton Pass holds only logins, recovery codes and the database password. |
| 4.4 | Claude Code | Check that each config contains the expected secret **names** (never the values), and record the result. |
| 4.5 | Claude Code | Keep each kind of key in its own place. **Claude Code's setup keys** (the Cloudflare key, the Supabase access token, and any future ones) live in a separate project, **`hrizzup-tools`**, with one config, `claude`, used only as `infra/doppler/run tools -- <command>`. **The app's project `hrizzup`** holds only the app's keys, so helpers can later be given it without seeing Claude Code's tools. Its `dev` config is for running the app on this Mac: every staging value appears there as a Doppler reference (`${stg.NAME}`), not a copy, so local runs and browser tests work against the staging services. Then confirm that Doppler's Action Required lists for `dev` and `stg` are empty. **Done, 3 November 2026.** |

**How `dev` keeps following staging:**
- Whenever a key is added to or removed from `stg`, Claude Code runs `python3 infra/doppler/dev_follows_staging.py apply` in the same step. `check` reports without changing anything. Both print names only, never values.
- A value that must differ on this Mac (for example the site's own address, `http://localhost:3000`) is listed in `infra/doppler/dev-overrides.txt` with its reason, and `dev` gets its own value for it.
- `dev` never points at `prd` or at another project; the script fails if it does.
- Claude Code runs commands with `dev`'s values as `infra/doppler/run dev -- <command>`, through its own service token (step 10.1).
- **Action Required:** Doppler flags a key that exists in one environment but not another. The lists for `dev` and `stg` stay empty. `prd`'s list shows the app's keys until Part 10 fills it: leave those warnings in place, because they are Part 10's checklist.

**Done when:** the project and its four configs exist, Claude Code's setup keys are in `hrizzup-tools`, `dev` follows staging, and every key created so far is in Doppler.

---

# Part 5: Database (Supabase, staging)

**What we're doing:** Supabase staging in Mumbai.

**Why:** where the app's data lives.

| Step | Who | What to do |
|---|---|---|
| 5.1 | You | In the Supabase Pro organisation, create the project **`hrizzup-staging`**: region **Mumbai**, compute size **Micro** to start, standard Postgres, Data API **off**, automatic row-level security **on**, not linked to GitHub. Save the generated database password straight into Doppler `stg` as `SUPABASE_DB_PASSWORD`. **Done, 3 November 2026.** |
| 5.2 | You | Keep the organisation's spend cap **on** during staging, and turn usage alerts on. Staging has no users, so a limit can't hurt anyone; it blocks surprise bills and doesn't stop the database being enlarged. The spend cap is turned off in step 10.3, when production joins the organisation. Point-in-time recovery is for production only (step 10.3); staging keeps Supabase's daily backups. |
| 5.3 | You | Create a Supabase access token for Claude Code with full access to `hrizzup-staging` only, no account or organisation access, expiring in 90 days. Save it straight into Doppler as `SUPABASE_ACCESS_TOKEN` (project `hrizzup-tools`, config `claude`, since step 4.5). **Done, 3 November 2026; it expires around 1 February 2027** (see the reminder below). |
| 5.4 | Claude Code | Using the token and password through `doppler run` (never printed): confirm the project's settings through Supabase's API. Put the connection details into Doppler `stg` without showing them: `DATABASE_URL` (the pooler in transaction mode, port 6543, for the app), `DATABASE_URL_SESSION` (the pooler in session mode, port 5432, for migrations), both with the password percent-encoded, plus `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` for Realtime. **Done, 3 November 2026** (setup log). |
| 5.5 | Claude Code | Connect once through each address. Confirm the region, the Postgres version and the pooler mode, and write the connection settings into blueprint section 5: a small pool, prepared statements off, and explicit idle and lifetime timeouts. **Done, 3 November 2026.** |

**Why the Data API is off:** the app reaches the database only through our own typed API on the server. Supabase's automatic public data API isn't needed, so it's switched off: one fewer way into the data, and a missing access rule can't leak anything through it. Realtime keeps working; it doesn't use the Data API.

**Why automatic row-level security:** row-level security means a table shows each user only the rows its rules allow, and nothing at all until rules are written. Switching it on automatically for every new table means no table can ever be created open by mistake. **Found on 3 November 2026:** the option chosen when the project was created doesn't reach tables made in code, and a test table came out unprotected. So the first migration in the repo adds the safeguard (blueprint section 5), and production gets it the same way.

**Before any load test:** enlarge staging's compute to production's size first, so the results mean something, and shrink it again afterwards.

**Reminder: the Supabase token expires around 1 February 2027.** Before then, create a new one with the same scope, save it in Doppler project `hrizzup-tools`, config `claude`, under the same name, and delete the old one in Supabase. Claude Code checks the new one.

**Done when:** the project is in Mumbai with the settings in step 5.1, the connection details are in Doppler `stg`, Claude Code connects through both addresses, and the settings are recorded.

---

# Part 6: Storage and bot protection (Cloudflare R2 and Turnstile)

**What we're doing:** R2 buckets, image transformations and Turnstile.

**Why:** images and videos, and blocking bots at sign-in.

| Step | Who | What to do |
|---|---|---|
| 6.1 | Claude Code | Create two staging buckets with location Asia-Pacific: **`hrizzup-staging-uploads`** (private) and **`hrizzup-staging-media`** (public). **Done, 3 November 2026.** |
| 6.2 | Claude Code | Connect the media bucket to **`media-staging.hrizzup.com`**, with its `r2.dev` address left off. Apply the CORS and lifecycle rules kept in the repo (`infra/cloudflare/r2/`, applied with `apply.sh staging`): uploads only from our own sites, incomplete uploads aborted after a day, and raw uploads deleted after a day. **Done, 3 November 2026.** The previews' addresses joined the upload rule in Part 9 (3 November 2026). |
| 6.3 | You | Create one R2 access key for both staging buckets, and save it in Doppler `stg` (the exact clicks are below). **Done, 3 November 2026.** |
| 6.4 | Claude Code | Create the Turnstile widget **"Hrizzup staging"**: Managed mode, hostnames `staging.hrizzup.com` and `localhost`. Put its keys into Doppler `stg` as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` without showing them. Previews use Cloudflare's official test keys instead, as overrides of the same names in `stg_preview`. **Done, 3 November 2026.** |
| 6.5 | Claude Code | Turn on Cloudflare image transformations for `hrizzup.com`, limited to our own images (images from any other site are refused). **Done, 3 November 2026.** |
| 6.6 | Claude Code | Once step 6.3 is done: upload a test image with the new key, download it publicly through `media-staging.hrizzup.com`, and check that it loads resized from `media-staging.hrizzup.com/cdn-cgi/image/width=640,format=auto/<test image>` in a modern format, served from Cloudflare's cache the second time. Record the result. **Done, 3 November 2026:** all passed (setup log). The key reaches only the two staging buckets. |

**Step 6.3, click by click:**
1. In Cloudflare, open **R2 Object Storage**, then **Overview**.
2. Under **Account Details**, click **Manage** next to **API Tokens**, then **Create Account API token**. An account token keeps working even if a person's login is later removed.
3. **Token name:** `hrizzup-staging-app`. **Permissions:** **Object Read & Write**. Under the buckets option, choose **Apply to specific buckets only** and select `hrizzup-staging-uploads` and `hrizzup-staging-media`. **TTL:** Forever. Leave IP filtering empty (Vercel has no fixed addresses).
4. Click **Create Account API token**. The next page shows an **Access Key ID** and a **Secret Access Key**, once only. Ignore the other values on that page.
5. In Doppler, open project `hrizzup`, config `stg`, and add two secrets: `R2_ACCESS_KEY_ID` with the Access Key ID, and `R2_SECRET_ACCESS_KEY` with the Secret Access Key. Save, then close the Cloudflare page. Never paste either value into a chat.
6. Tell Claude Code it's done. The other storage settings (`R2_ENDPOINT`, `R2_BUCKET_UPLOADS`, `R2_BUCKET_MEDIA` and `MEDIA_BASE_URL`) are already in `stg`.

**Done when:** both buckets exist with the repo's rules applied, the key is in Doppler, a test file uploads with it and downloads from `media-staging.hrizzup.com`, a resized copy loads through Cloudflare, and the widget exists with its keys in Doppler.

---

# Part 7: Redis (Upstash)

**What we're doing:** the Upstash staging database, its settings, and the rules for using it.

**Why:** caches, rate limits, locks and counters, shared by every server instance.

| Step | Who | What to do |
|---|---|---|
| 7.1 | You | In Upstash, create the database **`hrizzup-staging`**: **Fixed** plan, size **1GB** ($20 a month), AWS **Mumbai (`ap-south-1`)**, no read regions. **Done, 3 November 2026.** |
| 7.2 | You | Save its REST URL and token into Doppler `stg` as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. **Done, 3 November 2026.** |
| 7.3 | Claude Code | Add the matching references to `dev` (`dev_follows_staging.py apply`), and the key prefix `REDIS_KEY_PREFIX`: `stg` in `stg`, `pre` for previews (in `stg_preview`) and `dev` on this Mac (listed in `infra/doppler/dev-overrides.txt`). **Done, 3 November 2026.** |
| 7.4 | Claude Code | Confirm the region, plan and size, and that only encrypted connections are accepted. In Upstash's console, turn **eviction on** and **auto-upgrade off**. Check everything with `infra/upstash/check.py staging`. **Done, 3 November 2026.** |
| 7.5 | Claude Code | Measure the round trip from this Mac and record it (last time, about 135 ms showed the database was in the wrong region). **Done, 3 November 2026:** about 8 ms. The time from Vercel's Mumbai servers is measured in step 9.6. |

**Why eviction is on:** with eviction off, a full database refuses every write, so caches, rate limits and locks would all stop at once, and the site with them. With it on, a full database drops some entries, keys with an expiry first, and they're rebuilt from the main database. That's safe because every key has an expiry and Redis never holds the only copy of anything that matters (blueprint section 14, "Redis (Upstash)").

**Why auto-upgrade is off on staging:** the Fixed plan has no per-command charges, so a load test can't run up a bill by the number of commands. Its limits are 1 GB of data, 100 GB of traffic a month and 10,000 commands a second. With auto-upgrade on, a test that used up the traffic would move staging to the next tier (Fixed 5GB, $100 a month). With it off, staging's Redis is blocked instead: the spending cap every staging service has. Production keeps auto-upgrade on (step 10.8), so a limit never takes the live site offline.

**Before a big load test:** check this month's traffic on the database's **Usage** tab in Upstash. A long test at full speed can use the month's 100 GB (10,000 commands a second with 1 KB answers is about 36 GB an hour), after which staging's Redis stays blocked until the month ends. A test that needs more is planned with you before it runs.

**Done when:** the database exists in Mumbai on the Fixed plan, its keys and the key prefix are in Doppler with `dev` following staging, eviction is on and auto-upgrade off, encrypted-only connections are confirmed, and the round-trip time is recorded.

**Part 7 finished on 3 November 2026.** The details are in the setup log.

---

# Part 8: Sign-in (Google)

**What we're doing:** Google sign-in on Supabase Auth for staging, and Supabase's emails sent through Resend.

**Why:** "Sign in with Google" on the website and the app, with one account across both, and sign-in codes that come from our own domain.

**Decided 3 November 2026:** Supabase Auth for the website and the app. Google first; Apple and email codes before the iPhone build; the app's native Google and Apple sign-in (with the Android client and its fingerprint) come with the app builds. See PLAN.md section 2 and blueprint section 9.

| Step | Who | What to do |
|---|---|---|
| 8.1 | You | In Google Cloud, create the project **`hrizzup`** and turn billing on. It belongs to the **Hrizzup Google account** (`hrishikesh@hrizzup.com`), not the Zugzwang World one. **Done, 3 November 2026:** project `hrizzup`, ID `hrizzup-513610`. Billing is on (a free trial with a prepayment), confirmed by the founder on 3 November 2026; Google sign-in doesn't need it. |
| 8.2 | You | Set up the OAuth consent screen: **External**, **Testing**, app name Hrizzup, your support email, authorised domains `hrizzup.com` and `mlccgqxtqmllwbyjfzzm.supabase.co` (staging's Supabase project), and the three basic scopes (`openid`, `email`, `profile`). The home page and privacy-policy links wait for the holding page (Part 9); they're added before publishing (step 10.16). **Done, 3 November 2026.** |
| 8.3 | You | Create the OAuth client **"Hrizzup staging"**, type **Web application**, with the origins and the redirect address Claude Code gives you (`https://mlccgqxtqmllwbyjfzzm.supabase.co/auth/v1/callback`). Save its ID and secret into Doppler `stg` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. **Done, 3 November 2026.** |
| 8.4 | You | Add yourself and your testers as test users. The consent screen stays in Testing mode until it's published before launch. **Done, 3 November 2026.** |
| 8.5 | Claude Code | Switch on Google sign-in in `hrizzup-staging` with the client from Doppler. Set the site address to `https://staging.hrizzup.com`, and allow redirects only to staging and this Mac (`http://localhost:3000`). Kept in the repo as `infra/supabase/auth/` and applied with `apply.py staging`. **Done, 3 November 2026** (setup log). |
| 8.6 | Claude Code | Send Supabase Auth's emails (sign-in codes) through Resend's SMTP from `no-reply@mail.hrizzup.com`, with the staging key `RESEND_API_KEY`, instead of Supabase's built-in sender. Turn on Turnstile in Supabase Auth for the routes that send email. Production gets its own keys in Part 10. **Done, 3 November 2026:** a test code went out through Resend (setup log). |
| 8.7 | Claude Code | Add the matching `dev` references (`dev_follows_staging.py apply`). **Done, 3 November 2026.** |

**When a key changes:** Supabase keeps its own copies of the Google secret, the Resend key and the Turnstile secret. Whenever one changes in Doppler `stg`, Claude Code runs `infra/supabase/auth/apply.py staging` the same day.

**Done when:** the staging client's keys are in Doppler (with `dev` following), the consent screen is saved, Google sign-in is on in `hrizzup-staging` with only staging's and this Mac's addresses allowed, and Supabase's emails go through Resend. Signing in end to end is checked in step 9.6, once the website runs on Vercel.

**Part 8 finished on 3 November 2026,** apart from the end-to-end check in step 9.6. The details are in the setup log.
*(The production Google client is created in Part 10, step 10.9.)*

---

# Part 9: Hosting (Vercel)

**What we're doing:** the first slice of the codebase (PLAN.md step 1.5), the Vercel project, `staging.hrizzup.com`, hidden production builds, previews that are complete working copies, and the holding page on `hrizzup.com`.

**Why:** the staging website, served from Mumbai; a preview of every pull request where each change gets checked; and a production side that goes live only when a build is promoted.

| Step | Who | What to do |
|---|---|---|
| 9.1 | Claude Code | **The codebase:** one repo for the Next.js website (`product/web`) and the Expo app (`product/app`, an empty shell for now), with shared packages (`product/packages`): pnpm workspaces, Turborepo with Vercel's Remote Cache, Biome, TypeScript, Vitest, Playwright, and the Supabase CLI for migrations (CLAUDE.md, "Codebase"; blueprint section 13). The **first migration** locks every table (row-level security), and the **Database check** fails any pull request that leaves a table unprotected. The website has the holding page, draft privacy and terms pages, the sign-in test page (not on production) and `/api/health` (environment, region, commit, and whether the database, Redis, storage and sign-in answer). **Done, 3 November 2026.** |
| 9.2 | Claude Code | **The Vercel project `hrizzup`** in the Pro team, linked to the repo, with every setting kept in `infra/vercel/` and applied with `apply.py`: functions in Mumbai (`bom1`), production branch `main` with **Auto-assign Custom Production Domains off** (every merge makes a hidden production build), Skew Protection, the Vercel Toolbar and comments on previews, and the firewall. The custom environment **`staging`** follows the branch `staging`, which only the Staging workflow moves, after each merge's migrations have reached staging's database (branch tracking on `main` itself couldn't put the database first); the workflow then starts the build through a deploy hook and waits until staging serves the commit. **Done, 3 November 2026.** |
| 9.3 | You | In Doppler, connect to Vercel: `stg` to Vercel's `staging` environment and `stg_preview` to Vercel's Preview, variable type **Secret** (Vercel's "Sensitive"). **Done, 3 November 2026.** Production's sync is step 10.13. Claude Code's setup keys (`hrizzup-tools`) are never synced. |
| 9.4 | Claude Code | Add the domains (`staging.hrizzup.com` for staging; `hrizzup.com` for production, with `www` redirecting to it) and their records in Cloudflare, **DNS only**. Make the first production deployment the holding page with its draft privacy policy and terms, and promote it once; it stays live until launch. This holding page is the one change Claude Code makes on the production side, made before production has any keys or data. From Part 10 on, production changes only through the release pipeline. **Done, 3 November 2026** (promoted once). |
| 9.5 | Claude Code | **Deployment protection:** Standard Protection with Vercel Authentication, so every preview, staging and the private address of every hidden production build need a Vercel login, and only `hrizzup.com` and `www` are public. Create the **protection bypass for automation** and keep it in Doppler `hrizzup-tools` (with a copy in GitHub's secrets for the Screen check). **Done, 3 November 2026.** |
| 9.6 | Claude Code | The checks: `autoAssignCustomDomains` is off (`apply.py --check`); `/api/health` reports `bom1` and every service answers, on a preview and on staging; the Redis round trip measured from Vercel's Mumbai functions; Google sign-in end to end on staging and on a preview; the previews' addresses in the storage upload rule; the screen check passes on the holding page. Results are in the setup log. **Done, 3 November 2026**, except one check that needs a second Google account: an account that isn't a test user is refused (for the founder; status file). |
| 9.7 | You | Let GitHub's checks use Vercel's Remote Cache without a stored key: in Vercel, team **Settings → Build and Deployment → OIDC Policies for CLI Access → Turborepo CLI Policies → Add**, provider **GitHub Actions**, account `Zugzwang-world`, repository `hrizzup`, audience `https://github.com/Zugzwang-world`. **Done, 3 November 2026** (policy "hrizzup checks"). |

**Previews are complete working copies, and that is where a change is checked.** A preview uses staging's data and keys (`stg_preview`), Cloudflare's Turnstile test keys, and Google sign-in through staging's signed relay. Supabase never allows a `vercel.app` address, because anyone can create one. Checking a change never requires deploying it to staging: staging only receives what has merged into `main`.

**Test accounts** for the automatic checks exist only on staging (which previews share): `delivered+screen-check-chromium@resend.dev` and `delivered+screen-check-webkit@resend.dev`. Nobody can sign in to them; a check gets a session only through staging's own server key. Production is a separate project, so they can't exist there.

**Not used now** (founder's decision, 3 November 2026): Password Protection, Preview Deployment Suffix, extra custom environments, Flat Rate CDN and Flags Explorer. Speed Insights and Web Analytics stay off until launch (decided in Part 10). Observability Plus is on and covers the project. Vercel's spending limit is $50 a month, pausing if reached, and is revisited before launch.

**Reminder: the Vercel token expires around 1 February 2027.** Before then, create a new one with the same scope (team `hrizzup` only), save it in Doppler `hrizzup-tools`, config `claude`, as `VERCEL_TOKEN`, and delete the old one in Vercel. A GitHub issue opens on 15 January 2027 as a reminder.

**Done when:** `staging.hrizzup.com` loads securely from Mumbai, `hrizzup.com` shows the holding page with its privacy policy and terms, merges to `main` make hidden production builds and reach staging after their migrations, pull requests get complete preview links behind a Vercel login, the checks in step 9.6 pass, and Google sign-in works end to end on staging and on a preview.

---

# Part 10: Production twin

**What we're doing:** a production copy of the staging setup (Supabase project, Vercel production, Doppler `prd`, R2 buckets, Redis database, Google sign-in client, Turnstile widget), created as soon as staging works, with nothing public until launch. Doppler moves to its Team plan and Cloudflare to Pro first.

**Why:** going live becomes a promotion, not a migration.

**Claude Code never reads, holds or uses production keys.** You create each production service and key yourself, following Claude Code's exact clicks, and save the keys straight into Doppler `prd`. The release pipeline, which Claude Code builds in the repo and tests on staging, is the only thing that uses them, with its own credentials (step 10.12). Claude Code checks production only from the outside and through the pipeline's reports.

Everything matches staging (the same services, versions, region and settings) except the names, the data and the keys, plus two deliberate differences: production's database is sized for launch, and only production has point-in-time recovery. Billing limits also differ on purpose: on staging they stop surprise bills (Supabase's spend cap on, Upstash's auto-upgrade off); on production they never take the site offline (Supabase's spend cap off, Upstash's auto-upgrade on). Production starts empty.

| Step | Who | What to do |
|---|---|---|
| 10.1 | Claude Code, then you | **Claude Code's own Doppler access, before the first production key goes in** (founder's decision, 3 November 2026: service tokens on the free plan instead of the Team plan's service account). Claude Code creates four Doppler service tokens, each limited to one config: `hrizzup/dev`, `hrizzup/stg` and `hrizzup-tools/claude` read and write, `hrizzup/stg_preview` read only. They go straight into this Mac's keychain, unseen, and are used only through `infra/doppler/run`. `python3 infra/doppler/check_access.py` proves that none can open `prd`. Then **you** sign your own Doppler login out of this Mac: in Terminal (or in Claude Code, starting the line with `!`), run `doppler logout --yes`. From then on you use Doppler's website, and Claude Code never uses a personal login. **Done, 3 November 2026** (setup log). |
| 10.2 | You | In Cloudflare, upgrade `hrizzup.com` to the **Pro** plan, and turn on Cloudflare Images' paid plan, so new image sizes never fail once the free 5,000 a month are used up. |
| 10.3 | You | In the Supabase Pro organisation, create **`hrizzup-production`** with the same settings as staging (step 5.1: Mumbai, standard Postgres, Data API off, not linked to GitHub), a compute size chosen for launch, and a generated database password of **letters and numbers only**, saved straight into Doppler `prd` as `SUPABASE_DB_PASSWORD`. Turn on point-in-time recovery (production only). Turn the organisation's spend cap **off** (it stayed on during staging) and keep usage alerts on. |
| 10.4 | You | In Doppler `prd`, add `DATABASE_URL` and `DATABASE_URL_SESSION` exactly as Claude Code writes them out for you. They point at the pooler (transaction mode, port 6543, and session mode, port 5432) and refer to `${SUPABASE_DB_PASSWORD}` instead of containing the password, so you never copy it. |
| 10.5 | Release pipeline | Its production check (you start it from GitHub's Actions tab, or Claude Code starts it when you say so) connects through both addresses with production's own credentials. It reports the region, Postgres version, compute size, pooler mode and extensions, and applies the same migrations as staging. Claude Code compares the report with staging and records it. |
| 10.6 | You, then the release pipeline | In Cloudflare R2, create **`hrizzup-production-uploads`** (private) and **`hrizzup-production-media`** (public), both with location Asia-Pacific. Connect the media bucket to **`media.hrizzup.com`** (bucket **Settings**, **Custom Domains**, **Connect Domain**), and leave its `r2.dev` address off. The pipeline then applies the repo's production CORS and lifecycle rules (`infra/cloudflare/r2/apply.sh production`). Image transformations (step 6.5) already cover the bucket, because they are on for the whole zone. |
| 10.7 | You | Create one R2 access key for both production buckets, the same way as step 6.3 (named `hrizzup-production-app`), and save it in Doppler `prd` as `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. |
| 10.8 | You | In Upstash, create **`hrizzup-production`** on the same plan, size and region as staging (Fixed 1GB, AWS Mumbai `ap-south-1`, no read regions). On its **Settings** tab, turn **Eviction** on and leave **Auto Upgrade** on (staging has it off as a spending cap; production must never be blocked by a limit). Save its REST URL and token into Doppler `prd` as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, and add `REDIS_KEY_PREFIX` with the value `prd`. |
| 10.9 | You | After the decision in step 10.15 (it sets production's redirect address): in the Google Cloud project `hrizzup`, create an OAuth client of type **Web application** for production, with origins `https://hrizzup.com` and `https://www.hrizzup.com` and the redirect address Claude Code gives you, and add production's sign-in domain to the consent screen's authorised domains. Save the client ID and secret into Doppler `prd` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. The release pipeline then applies production's sign-in settings from the repo, the same as staging's (`infra/supabase/auth/apply.py production`, once Claude Code has added production's project ID to `settings.json`). |
| 10.10 | You | In Resend, create an API key named "Hrizzup production" with **Sending access**, limited to the domain `mail.hrizzup.com`, and save it straight into Doppler `prd` as `RESEND_API_KEY`. |
| 10.11 | You | In Cloudflare **Turnstile**, add the widget **"Hrizzup production"**: Managed mode, hostnames `hrizzup.com` and `www.hrizzup.com` (no `localhost`). Save its keys into Doppler `prd` as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. |
| 10.12 | You | Give the release pipeline its own production credentials, following Claude Code's clicks: a read-only Doppler service token for `prd`, saved as a secret of the GitHub environment `hrizzup-production`; a Vercel token, for promoting builds and for applying the Vercel settings that reach production (`infra/vercel/apply.py`); a Cloudflare token limited to R2 settings, for applying the storage rules; and a Supabase access token limited to `hrizzup-production`, for applying the sign-in settings. The last three go into Doppler `prd`. |
| 10.13 | You | In Doppler, sync `prd` to Vercel's production environment, marked Sensitive. |
| 10.14 | Release pipeline, then Claude Code | The pipeline's production check confirms that a hidden production build's private `/api/health` reports `bom1` and the production setup, that a test image loads resized from `media.hrizzup.com`, that production's Redis passes `infra/upstash/check.py production`, and that production's sign-in settings pass `infra/supabase/auth/apply.py production --check`. Claude Code compares staging and production side by side from the pipeline's report and the public addresses: every service, version, region and setting must match, and only names, data and keys may differ. It also confirms that `hrizzup.com` still shows the holding page, then records the comparison. |
| 10.15 | You, with Claude Code | **Decide on Supabase's Custom Domain add-on,** before step 10.9. It puts sign-in on our own name: `auth.hrizzup.com` for production and `auth-staging.hrizzup.com` for staging, instead of the project's `….supabase.co` address. **Price, checked 3 November 2026:** $10 a month per project ($0.0137 an hour, billed by the hour), so $20 a month for both; it needs a paid plan, which we have. **Why it matters:** Google's sign-in screen shows the Supabase address until then, and Google only verifies the branding (Hrizzup's name and logo on that screen) once every authorised domain is verified as ours, which a `supabase.co` address can't be. **Also part of the decision:** both clients share the Google project's one consent screen, so staging's Supabase address would also block production's branding, and once the screen is published, anyone with a Google account could sign in to staging. Either staging also gets its custom domain and stays behind Vercel's protection, or production gets its own Google Cloud project, so staging's stays in Testing with test users only. Claude Code checks the price again, recommends one way, and gives you the clicks. If you add it: a CNAME and a TXT record in Cloudflare (DNS only), each new callback address added to the Google client before the domain is switched on, and the old one kept. |
| 10.16 | You | **Before publishing the consent screen** (before launch): on Google's **Branding** page, add the home page (`https://hrizzup.com`) and the privacy-policy link (on the holding page from step 9.4), and verify `hrizzup.com` in Google Search Console with the Hrizzup Google account (Claude Code adds the TXT record in Cloudflare). Then publish, and test with an account that isn't on the test list. |

**To decide before Part 10:** Claude Code works through your own GitHub account and merges its own pull requests, so in principle it could change the release pipeline itself. The recommended fix is a separate GitHub account for Claude Code with write access, plus your approval for changes to the pipeline's files (status file, open questions).

**Done when:**
- Doppler is on the Team plan, and Claude Code's own Doppler access can't open `prd`;
- `hrizzup.com` is on Cloudflare Pro with Images' paid plan on;
- every production service exists with the same settings as staging, created by you, with its keys in Doppler `prd` and synced to Vercel production;
- the release pipeline has its own credentials;
- the side-by-side comparison passes;
- nothing public has changed.

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
| R.1 | Claude Code | Pick the commit that passed staging and find its hidden production build. Check that the commit's database changes, if it has any, are written so the version that is live keeps working with them. |
| R.2 | You | Say "release". You or Claude Code then start the **Release** workflow in GitHub for that commit. |
| R.3 | Release pipeline | With its own production credentials, it does three things in order. It applies the commit's database changes to production. It checks that `autoAssignCustomDomains` is still off and that the Vercel project still matches the repo (`infra/vercel/apply.py --check`) and that the hidden build's private `/api/health` shows that commit and `bom1`. Then it runs `vercel promote <address of the hidden build> --yes`, which goes live instantly, with no rebuild. |
| R.4 | Claude Code | Confirm from the outside that `hrizzup.com/api/health` shows that commit, and record the release in `docs/setup.md`. |

**Going back:** the pipeline's rollback (`vercel rollback`), started the same way. It's also instant, with no rebuild.

**Before launch:** `hrizzup.com` shows the holding page, so the first promotion of an app build is the launch.

---

# Later, with the team

- **Doppler's Team plan** ($21 per user a month) before any helper joins Doppler: its roles let you keep production keys to yourself (on the free plan, Doppler can't limit what a member opens). Give each helper the Collaborator role on `hrizzup`'s Development and Staging, no access to Production, and no access to `hrizzup-tools`. Before the first helper joins, replace the Cloudflare key and the Supabase access token with new ones in `hrizzup-tools` (Claude Code gives you the clicks), because both sat in `dev` until 3 November 2026 and old copies may show in its history.
- **Sentry and PostHog:** one project per environment, with keys in Doppler.
- **Apple Developer and Google Play accounts.** Start Google Play early: a personal account needs a closed test with at least 12 testers for 14 days before the app can go public. Their app IDs and signing fingerprints go into the two files the website serves so that shared links open the app (`/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`).
- **RevenueCat and Razorpay:** set up with the app, for the paid tier, which is in version one (PLAN.md step 2.7). Razorpay with UPI on the website.
- **Cloudflare Stream:** switched on in the same Cloudflare account when creator video is built (PLAN.md step 2.4), with separate API tokens for staging and production, a budget alert, and the tokens kept in Doppler.
- **At launch:** CAA records naming every certificate authority that Cloudflare and Vercel use.
- **AWS:** later, only if a concrete need appears, as its own project.

---

# Production hardening

**What we're doing:** a last check before real users arrive.

**Why:** real users' data must sit behind keys that only you and the release pipeline hold.

- **Production keys held only by you and the pipeline.** Since Part 10, Claude Code never reads, holds or uses production keys, so there are none to take back. Before real users arrive, check that every route by which Claude Code's tools could still reach production is closed or covered (blueprint section 3, "Production is off-limits to Claude Code"), and that you created every key in `prd`. If a production key was ever exposed, replace it. Production keys never go in this repository.

**Done when:** that check is recorded in the setup log, before the first real user signs in.

*(The secret check, pull requests and repository protections used to be listed here. They have been on since 2 November 2026; see Part 1, step 1.7.)*
