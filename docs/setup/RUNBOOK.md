# Hrizzup: setup runbook

> Every step to set up Hrizzup's staging environment and its production twin, in order, plus how a release works. It follows the blueprint in `docs/setup/BLUEPRINT.md`.
> This file lives in the repo at `docs/setup/RUNBOOK.md`.
>
> **Setup closed on 4 November 2026.** Parts 0 to 10 are finished, apart from the items parked in the [pre-launch checklist](#pre-launch-checklist), which starts with production's own values (P.0). Part 11 leaves you one step. From now on, "Releasing to production" and the pre-launch checklist are the parts in use.

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

**Part 0 finished on 4 November 2026,** apart from two-step login on Upstash, parked in the pre-launch checklist (P.12, founder's decision).

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
| 2.1 | You | In Cloudflare, add the site `hrizzup.com` and choose the **Free** plan (it moves to Pro in the pre-launch checklist). Copy the two nameservers Cloudflare gives you. |
| 2.2 | You | In GoDaddy, open `hrizzup.com` and check DNSSEC is **off**. Replace the nameservers with Cloudflare's two. Turn on the transfer lock and auto-renew. |
| 2.3 | You | Wait until Cloudflare shows `hrizzup.com` as **Active**. This can take from minutes to a few hours. |
| 2.4 | You | In Cloudflare, turn on **DNSSEC**. It will show a DS record. In GoDaddy, add that DS record in `hrizzup.com`'s DNSSEC section, then wait for Cloudflare to confirm DNSSEC is active. |
| 2.5 | You | In Cloudflare, create an **API token** for Claude Code with exactly these permission rows and nothing else: Zone · DNS · Edit; Zone · Zone Settings · Edit; Zone · Zone · Read; Account · Workers R2 Storage · Edit; Account · Turnstile · Edit. Limit the zone rows to `hrizzup.com` and the account rows to your account. Save it straight into Doppler as `CLOUDFLARE_API_TOKEN`, never in a chat. (It went into `dev` at the time and moved to Claude Code's own project, `hrizzup-tools`, in step 4.5.) |
| 2.6 | Claude Code | Using the token through `doppler run` (never printed): check from the outside that the nameservers are Cloudflare's, and that DNSSEC works end to end (the DS record at the .com registry matches Cloudflare's, and validating resolvers accept the answers). Delete every record Cloudflare imported from GoDaddy, so the zone starts empty. Apply the zone settings: SSL/TLS Full (strict), Always Use HTTPS, minimum TLS 1.2, TLS 1.3, Automatic HTTPS Rewrites. Check that the token can do only what step 2.5 lists. Record everything. **Done, 2 November 2026.** The key can also read Workers scripts, Workers routes, Page Rules and Email Routing settings, which it doesn't need; trimming it is parked in the pre-launch checklist (P.7). |

**Done when:** Cloudflare shows Active with DNSSEC confirmed end to end, the zone is empty, the zone settings are on, and the token holds only the permissions in step 2.5.

**Part 2 finished on 2 November 2026,** apart from trimming the key, parked in the pre-launch checklist (P.7, founder's decision, 4 November 2026).

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
| 3.6 | Claude Code | Through Resend's API, with the setup key through `doppler run`: create the sending domain `mail.hrizzup.com` in the Tokyo region (`ap-northeast-1`, the closest of Resend's regions to India), with open and click tracking off. Add the records Resend returns to Cloudflare (DNS only) and start verification. Create one sending-only key for staging, limited to `mail.hrizzup.com`, and put it into Doppler `stg` as `RESEND_API_KEY` without showing it; the production key comes in Part 10 (your checklist, step G), created by you. Then delete the setup key from Resend and Doppler. **Done, 3 November 2026:** verified (setup log). |
| 3.7 | Claude Code | Send a test email from `no-reply@mail.hrizzup.com` to your address with the staging key, and check that it lands in the inbox and passes DMARC. **Sent 3 November 2026:** delivered, but into **Spam**. The header check and a new test are parked in the pre-launch checklist (P.13, founder's decision, 4 November 2026). |

**Note:** the route that brings the Grok bots' results to our pipeline is chosen in the Sourcing project (PLAN.md step 0.8). If it is email, it has to be an inbox our pipeline can read automatically, not your Proton inbox.

**Done when:** Proton is verified and mail works both ways, the Resend domain is verified, and the test email reaches the inbox with DMARC passing.

**Part 3 finished on 4 November 2026** (founder's decision), apart from the inbox check in step 3.7, parked in the pre-launch checklist (P.13).

---

# Part 4: Secrets (Doppler)

**What we're doing:** the Doppler project and configs, on Doppler's free **Developer** plan during staging.

**Why:** one safe place for every key; hosting copies its keys from it.

| Step | Who | What to do |
|---|---|---|
| 4.1 | — | **Moved to "Later, with the team":** the upgrade to Doppler's Team plan, before any helper joins Doppler. Doppler stays on the free Developer plan, and until the upgrade only you and Claude Code use it. |
| 4.2 | Claude Code | Using Doppler's command-line tool, create the project `hrizzup` with four configs: `dev` (running the app on this Mac; see step 4.5), `stg` (staging), `stg_preview` (previews: a branch of `stg` that copies every staging value and holds only overrides) and `prd` (production). Claude Code asks you to log in if it needs to. **Done, 2 November 2026,** brought forward so the Cloudflare key has a safe home. |
| 4.3 | You | Move any key still saved in Proton Pass into Doppler by typing or pasting it into Doppler's dashboard. (The Cloudflare key and the Resend setup key went straight into Doppler. The Resend setup key has since been deleted, and the Cloudflare key now lives in `hrizzup-tools`, step 4.5.) From now on, Proton Pass holds only logins, recovery codes and the database password. |
| 4.4 | Claude Code | Check that each config contains the expected secret **names** (never the values), and record the result. **Done, 4 November 2026:** `dev`, `stg` and `stg_preview` each hold the same 21 names, and `hrizzup-tools` holds Claude Code's 7 setup keys and nothing else (setup log). The release pipeline checks `prd` and `prd_release` itself. |
| 4.5 | Claude Code | Keep each kind of key in its own place. **Claude Code's setup keys** (the Cloudflare key, the Supabase access token, and any future ones) live in a separate project, **`hrizzup-tools`**, with one config, `claude`, used only as `infra/doppler/run tools -- <command>`. **The app's project `hrizzup`** holds only the app's keys, so helpers can later be given it without seeing Claude Code's tools. Its `dev` config is for running the app on this Mac: every staging value appears there as a Doppler reference (`${stg.NAME}`), not a copy, so local runs and browser tests work against the staging services. Then confirm that Doppler's Action Required lists for `dev` and `stg` are empty. **Done, 3 November 2026.** |
| 4.6 | You | **The Expo robot token in its right place** (added 8 November 2026). `EXPO_TOKEN` is a tool token, so it belongs in `hrizzup-tools` ("Where each kind of key lives", below). It went into `stg`, and Doppler had already synced it into Vercel's staging and preview settings, so it's replaced with a fresh token rather than moved: the clicks are below, about 5 minutes. Then tell Claude Code "Expo token moved". **Done, 9 November 2026:** the token is in `hrizzup-tools`, gone from `stg`, the previews and Vercel, and belongs to the robot (setup log). |

**How `dev` keeps following staging:**
- Whenever a key is added to or removed from `stg`, Claude Code runs `python3 infra/doppler/dev_follows_staging.py apply` in the same step. `check` reports without changing anything. Both print names only, never values.
- A value that must differ on this Mac (for example the site's own address, `http://localhost:3000`) is listed in `infra/doppler/dev-overrides.txt` with its reason, and `dev` gets its own value for it.
- `dev` never points at `prd` or at another project; the script fails if it does.
- `dev` follows only the app's keys, listed in `infra/doppler/app-keys.txt` (below): `apply` never gives `dev` a reference to another name, and deletes any it finds.
- Claude Code runs commands with `dev`'s values as `infra/doppler/run dev -- <command>`, through its own service token (step 10.1).
- **Action Required:** Doppler flags a key that exists in one environment but not another. The lists for `dev` and `stg` stay empty. `prd`'s list shows only `AUTH_RELAY_SECRET` once Part 10 fills it: staging and previews alone use that one, so the warning stays.

**Where each kind of key lives** (the rule since step 4.5, written out on 8 November 2026 after `EXPO_TOKEN` was found in `stg`):

| Kind of key | Where it lives | Why |
|---|---|---|
| **The app's keys:** whatever the website, its server code or the database needs to run | `hrizzup`: `stg` for staging (previews inherit it through `stg_preview`; this Mac follows it through `dev`), `prd` for production | `stg` and `stg_preview` sync into Vercel's staging and previews, and `prd` into production; the Staging workflow reads `stg` whole; the Screen check asks `stg_preview` for the eight keys its tests use, by name |
| **Tool tokens:** any token a tool uses to act on a service for Claude Code (Cloudflare, Supabase's API, Vercel, Expo, and any future one), and Claude Code's other setup values | `hrizzup-tools`, config `claude`, used only as `infra/doppler/run tools -- <command>` | Never synced anywhere, so no build and no check job ever holds one |
| **A tool token a GitHub workflow needs** | A copy in GitHub's secrets, piped in without being shown (as the protection bypass is); where the service allows, a token of its own, so each can be revoked alone | A workflow reads only what it's given |
| **The release pipeline's credentials** | `prd_release` (Part 10), never synced | Production's, held by the founder and the pipeline alone |

A tool token found in `hrizzup` is replaced, not moved, if Doppler has already synced it anywhere (as with a leaked key, blueprint section 11), and then deleted from `hrizzup`.

**The app's keys, listed by name** (since 9 November 2026, after the second slip): `infra/doppler/app-keys.txt` names every app key, with what uses it, and only those names may be in `stg`, `stg_preview` and `dev` (Doppler's own three labels aside). It holds names only, never a value.
- **Checked:** Claude Code's `python3 infra/doppler/dev_follows_staging.py check` fails on any other name there, on any name `hrizzup-tools` holds, and on a listed name `stg` doesn't hold. Since step 4.6 (done 9 November 2026), the Staging workflow and the Screen check also run the same check (`infra/doppler/app_keys.py`) before they load `stg` or `stg_preview`, so a stray key stops them before they hold it ([#54](https://github.com/Zugzwang-world/hrizzup/pull/54)). The release pipeline does the same for production, inside the pipeline: before it loads `prd_release`, whose names must be production's app keys (all but `AUTH_RELAY_SECRET`) or the pipeline's own credentials (`infra/doppler/release-keys.txt`), and on Vercel's production settings, which must hold every production key `prd` holds and nothing else, before a release changes production (a rollback skips that one: it only returns production to an earlier build, which today's settings don't change).
- **A new app key:** its name goes into the list in a pull request that merges before the key is added to `stg`. A key deleted from `stg` leaves the list in the next pull request.
- **If you add a key to Doppler yourself,** tell Claude Code its name and where you put it, so it lands in the list first; tool tokens go into `hrizzup-tools` only.

**Step 4.6, click by click** (about 5 minutes; never paste the token into a chat):
1. On expo.dev, sign in, choose the account that owns Hrizzup in the account switcher (top left), then open **Settings → Access tokens**.
2. Under **Robot users**, find the robot you made for Claude Code (role **Developer**) and create a new token for it, named `claude-code-mac`. Copy it with its copy button: Expo shows it once.
3. In Doppler: **Projects → hrizzup-tools → Claude Code** (its one row, the config `claude`) → **+** (top right of the secrets list) → name `EXPO_TOKEN` → paste → **Save**.
4. Still in Doppler: **Projects → hrizzup → Staging (`stg`)** → the `EXPO_TOKEN` row → delete it → **Save**.
5. Back on Expo's **Access tokens** page, delete the robot's older token (the one made before today's), so the copy that reached Vercel stops working.
6. Tell Claude Code "Expo token moved". It then checks, by name only, that `EXPO_TOKEN` is in `hrizzup-tools` and gone from `stg`, `stg_preview` and Vercel's staging and preview settings (removing any copy Doppler's sync left there), and that the token belongs to the robot, not to you. `dev_follows_staging.py check` then passes, and Claude Code merges the pull request that makes the Staging workflow and the Screen check refuse a config holding a name that isn't one of the app's keys ([#54](https://github.com/Zugzwang-world/hrizzup/pull/54)). Done on 9 November 2026: sessions now read the token only through `infra/doppler/run tools`.

If you'd rather keep the existing token: in step 3, copy its value from `stg` with Doppler's copy button, and skip steps 1, 2 and 5. It then joins the keys to replace before a helper first gets Doppler access ("Later, with the team").

**Done when:** the project and its four configs exist, Claude Code's setup keys are in `hrizzup-tools`, `dev` follows staging, and every key created so far is in Doppler.

**Part 4 finished on 4 November 2026.** Step 4.6 (yours) was added on 8 November 2026 and done on 9 November 2026.

---

# Part 5: Database (Supabase, staging)

**What we're doing:** Supabase staging in Mumbai.

**Why:** where the app's data lives.

| Step | Who | What to do |
|---|---|---|
| 5.1 | You | In the Supabase Pro organisation, create the project **`hrizzup-staging`**: region **Mumbai**, compute size **Micro** to start, standard Postgres, Data API **off**, automatic row-level security **on**, not linked to GitHub. Save the generated database password straight into Doppler `stg` as `SUPABASE_DB_PASSWORD`. **Done, 3 November 2026.** |
| 5.2 | You | Keep the organisation's spend cap **on** during staging, and turn usage alerts on. Staging has no users, so a limit can't hurt anyone; it blocks surprise bills and doesn't stop the database being enlarged. The spend cap stays on while production has no users either, and is turned off in the pre-launch checklist. Point-in-time recovery is for production only (pre-launch checklist); staging keeps Supabase's daily backups. |
| 5.3 | You | Create a Supabase access token for Claude Code with full access to `hrizzup-staging` only, no account or organisation access, expiring in 90 days. Save it straight into Doppler as `SUPABASE_ACCESS_TOKEN` (project `hrizzup-tools`, config `claude`, since step 4.5). **Done, 3 November 2026; it expires around 1 February 2027** (see the reminder below). |
| 5.4 | Claude Code | Using the token and password through `doppler run` (never printed): confirm the project's settings through Supabase's API. Put the connection details into Doppler `stg` without showing them: `DATABASE_URL` (the pooler in transaction mode, port 6543, for the app), `DATABASE_URL_SESSION` (the pooler in session mode, port 5432, for migrations), both with the password percent-encoded, plus `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` for Realtime. **Done, 3 November 2026** (setup log). |
| 5.5 | Claude Code | Connect once through each address. Confirm the region, the Postgres version and the pooler mode, and write the connection settings into blueprint section 5: a small pool, prepared statements off, and explicit idle and lifetime timeouts. **Done, 3 November 2026.** |

**Why the Data API is off:** the app reaches the database only through our own typed API on the server. Supabase's automatic public data API isn't needed, so it's switched off: one fewer way into the data, and a missing access rule can't leak anything through it. Realtime keeps working; it doesn't use the Data API.

**Why automatic row-level security:** row-level security means a table shows each user only the rows its rules allow, and nothing at all until rules are written. Switching it on automatically for every new table means no table can ever be created open by mistake. **Found on 3 November 2026:** the option chosen when the project was created doesn't reach tables made in code, and a test table came out unprotected. So the first migration in the repo adds the safeguard (blueprint section 5), and production gets it the same way.

**Before any load test:** enlarge staging's compute to production's size first, so the results mean something, and shrink it again afterwards.

**Reminder: the Supabase token expires around 1 February 2027.** Before then, create a new one with the same scope, save it in Doppler project `hrizzup-tools`, config `claude`, under the same name, and delete the old one in Supabase. Claude Code checks the new one.

**Done when:** the project is in Mumbai with the settings in step 5.1, the connection details are in Doppler `stg`, Claude Code connects through both addresses, and the settings are recorded.

**Part 5 finished on 3 November 2026,** closed by the founder on 4 November 2026 (step 5.2's organisation settings are yours; Claude Code's token can't see them). One difference from step 5.1, by your choice: `hrizzup-staging` stays connected to the GitHub repo, with deploys and branching off, so it does nothing. To disconnect it any time: Project Settings → Integrations → GitHub → **Disable integration** (Supabase's API can't).

---

# Part 6: Storage and bot protection (Cloudflare R2 and Turnstile)

**What we're doing:** R2 buckets, image transformations and Turnstile.

**Why:** images and videos, and blocking bots at sign-in.

| Step | Who | What to do |
|---|---|---|
| 6.1 | Claude Code | Create two staging buckets with location Asia-Pacific: **`hrizzup-staging-uploads`** (private) and **`hrizzup-staging-media`** (public). **Done, 3 November 2026.** |
| 6.2 | Claude Code | Connect the media bucket to **`media-staging.hrizzup.com`**, with its `r2.dev` address left off. Apply the CORS and lifecycle rules kept in the repo (`infra/cloudflare/r2/`, applied with `apply.py staging`, which since Part 10 also checks the buckets, `r2.dev` and the public address): uploads only from our own sites, incomplete uploads aborted after a day, and raw uploads deleted after a day. **Done, 3 November 2026.** The previews' addresses joined the upload rule in Part 9 (3 November 2026). |
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

**Part 6 finished on 3 November 2026.** Cloudflare Stream is switched on when creator video is built (PLAN.md step 2.4; "Later, with the team").

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

**Why auto-upgrade is off on staging:** the Fixed plan has no per-command charges, so a load test can't run up a bill by the number of commands. Its limits are 1 GB of data, 100 GB of traffic a month and 10,000 commands a second. With auto-upgrade on, a test that used up the traffic would move staging to the next tier (Fixed 5GB, $100 a month). With it off, staging's Redis is blocked instead: the spending cap every staging service has. Production is on pay as you go until launch, then moves to the Fixed plan with auto-upgrade on (pre-launch checklist), so a limit never takes the live site offline.

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
| 8.2 | You | Set up the OAuth consent screen: **External**, **Testing**, app name Hrizzup, your support email, authorised domains `hrizzup.com` and `mlccgqxtqmllwbyjfzzm.supabase.co` (staging's Supabase project), and the three basic scopes (`openid`, `email`, `profile`). The home page and privacy-policy links wait for the holding page (Part 9); they're added before publishing (pre-launch checklist). **Done, 3 November 2026.** |
| 8.3 | You | Create the OAuth client **"Hrizzup staging"**, type **Web application**, with the origins and the redirect address Claude Code gives you (`https://mlccgqxtqmllwbyjfzzm.supabase.co/auth/v1/callback`). Save its ID and secret into Doppler `stg` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. **Done, 3 November 2026.** |
| 8.4 | You | Add yourself and your testers as test users. The consent screen stays in Testing mode until it's published before launch. **Done, 3 November 2026.** |
| 8.5 | Claude Code | Switch on Google sign-in in `hrizzup-staging` with the client from Doppler. Set the site address to `https://staging.hrizzup.com`, and allow redirects only to staging and this Mac (`http://localhost:3000`). Kept in the repo as `infra/supabase/auth/` and applied with `apply.py staging`. **Done, 3 November 2026** (setup log). |
| 8.6 | Claude Code | Send Supabase Auth's emails (sign-in codes) through Resend's SMTP from `no-reply@mail.hrizzup.com`, with the staging key `RESEND_API_KEY`, instead of Supabase's built-in sender. Turn on Turnstile in Supabase Auth for the routes that send email. Production gets its own keys in Part 10. **Done, 3 November 2026:** a test code went out through Resend (setup log). |
| 8.7 | Claude Code | Add the matching `dev` references (`dev_follows_staging.py apply`). **Done, 3 November 2026.** |

**When a key changes:** Supabase keeps its own copies of the Google secret, the Resend key and the Turnstile secret. Whenever one changes in Doppler `stg`, Claude Code runs `infra/supabase/auth/apply.py staging` the same day.

**Done when:** the staging client's keys are in Doppler (with `dev` following), the consent screen is saved, Google sign-in is on in `hrizzup-staging` with only staging's and this Mac's addresses allowed, and Supabase's emails go through Resend. Signing in end to end is checked in step 9.6, once the website runs on Vercel.

**Part 8 finished on 3 November 2026;** its end-to-end check passed in step 9.6. The details are in the setup log.
*(Production's Google client is in its own Google Cloud project, created in Part 10, your checklist, step F.)*

---

# Part 9: Hosting (Vercel)

**What we're doing:** the first slice of the codebase (PLAN.md step 1.5), the Vercel project, `staging.hrizzup.com`, hidden production builds, previews that are complete working copies, and the holding page on `hrizzup.com`.

**Why:** the staging website, served from Mumbai; a preview of every pull request where each change gets checked; and a production side that goes live only when a build is promoted.

| Step | Who | What to do |
|---|---|---|
| 9.1 | Claude Code | **The codebase:** one repo for the Next.js website (`product/web`) and the Expo app (`product/app`, an empty shell for now), with shared packages (`product/packages`): pnpm workspaces, Turborepo with Vercel's Remote Cache, Biome, TypeScript, Vitest, Playwright, and the Supabase CLI for migrations (CLAUDE.md, "Codebase"; blueprint section 13). The **first migration** locks every table (row-level security), and the **Database check** fails any pull request that leaves a table unprotected. The website has the holding page, draft privacy and terms pages, the sign-in test page (not on production) and `/api/health` (environment, region, commit, and whether the database, Redis, storage and sign-in answer). **Done, 3 November 2026.** |
| 9.2 | Claude Code | **The Vercel project `hrizzup`** in the Pro team, linked to the repo, with every setting kept in `infra/vercel/` and applied with `apply.py`: functions in Mumbai (`bom1`), production branch `main` with **Auto-assign Custom Production Domains off** (every merge makes a hidden production build), Skew Protection, the Vercel Toolbar and comments on previews, and the firewall. The custom environment **`staging`** follows the branch `staging`, which only the Staging workflow moves, after each merge's migrations have reached staging's database (branch tracking on `main` itself couldn't put the database first); the workflow then starts the build through a deploy hook and waits until staging serves the commit. **Done, 3 November 2026.** |
| 9.3 | You | In Doppler, connect to Vercel: `stg` to Vercel's `staging` environment and `stg_preview` to Vercel's Preview, variable type **Secret** (Vercel's "Sensitive"). **Done, 3 November 2026.** Production's sync is Part 10, your checklist, step J. Claude Code's setup keys (`hrizzup-tools`) are never synced. |
| 9.4 | Claude Code | Add the domains (`staging.hrizzup.com` for staging; `hrizzup.com` for production, with `www` redirecting to it) and their records in Cloudflare, **DNS only**. Make the first production deployment the holding page with its draft privacy policy and terms, and promote it once; it stays live until launch. This holding page is the one change Claude Code makes on the production side, made before production has any keys or data. From Part 10 on, production changes only through the release pipeline. **Done, 3 November 2026** (promoted once). |
| 9.5 | Claude Code | **Deployment protection:** Standard Protection with Vercel Authentication, so every preview, staging and the private address of every hidden production build need a Vercel login, and only `hrizzup.com` and `www` are public. Create the **protection bypass for automation** and keep it in Doppler `hrizzup-tools` (with a copy in GitHub's secrets for the Screen check). **Done, 3 November 2026.** |
| 9.6 | Claude Code | The checks: `autoAssignCustomDomains` is off (`apply.py --check`); `/api/health` reports `bom1` and every service answers, on a preview and on staging; the Redis round trip measured from Vercel's Mumbai functions; Google sign-in end to end on staging and on a preview; the previews' addresses in the storage upload rule; the screen check passes on the holding page. Results are in the setup log. **Done, 3 November 2026.** The one check that needs a second Google account (an account that isn't a test user is refused) moved to the pre-launch checklist (P.4), where production's consent screen is tested before and after publishing. |
| 9.7 | You | Let GitHub's checks use Vercel's Remote Cache without a stored key: in Vercel, team **Settings → Build and Deployment → OIDC Policies for CLI Access → Turborepo CLI Policies → Add**, provider **GitHub Actions**, account `Zugzwang-world`, repository `hrizzup`, audience `https://github.com/Zugzwang-world`. **Done, 3 November 2026** (policy "hrizzup checks"). |

**Previews are complete working copies, and that is where a change is checked.** A preview uses staging's data and keys (`stg_preview`), Cloudflare's Turnstile test keys, and Google sign-in through staging's signed relay. Supabase never allows a `vercel.app` address, because anyone can create one. Checking a change never requires deploying it to staging: staging only receives what has merged into `main`.

**Test accounts** for the automatic checks exist only on staging (which previews share): `delivered+screen-check-chromium@resend.dev` and `delivered+screen-check-webkit@resend.dev`. Nobody can sign in to them; a check gets a session only through staging's own server key. Production is a separate project, so they can't exist there.

**Not used now** (founder's decision, 3 November 2026): Password Protection, Preview Deployment Suffix, extra custom environments, Flat Rate CDN and Flags Explorer. Speed Insights and Web Analytics stay off until launch (pre-launch checklist). Observability Plus is on and covers the project. Vercel's spending limit is $50 a month, pausing if reached, and is revisited before launch (pre-launch checklist).

**Reminder: the Vercel token expires around 1 February 2027.** Before then, create a new one with the same scope (team `hrizzup` only), save it in Doppler `hrizzup-tools`, config `claude`, as `VERCEL_TOKEN`, and delete the old one in Vercel. A GitHub issue opens on 15 January 2027 as a reminder.

**Done when:** `staging.hrizzup.com` loads securely from Mumbai, `hrizzup.com` shows the holding page with its privacy policy and terms, merges to `main` make hidden production builds and reach staging after their migrations, pull requests get complete preview links behind a Vercel login, the checks in step 9.6 pass, and Google sign-in works end to end on staging and on a preview.

**Part 9 finished on 3 November 2026.** The details are in the setup log.

---

# Part 10: Production twin

**What we're doing:** a quiet copy of staging for production: the same services, settings, versions and region, with its own data and keys, and nothing public until launch. Lean, by the founder's decision (3 November 2026): no paid extras now; they wait for the pre-launch checklist below.

**Why:** going live becomes a promotion, not a migration.

**Claude Code never reads, holds or uses production keys.** You create each production key yourself and copy it straight from that service's dashboard into Doppler, with the service's own copy button: nothing is typed or built by hand (the code fills the database password into Supabase's own connection strings). Claude Code creates only what holds no secret (the storage buckets and `media.hrizzup.com`, the GitHub environment) and checks production only through the release pipeline's report and from the outside.

**Two Doppler configs for production:**
- **`prd`:** the website's production keys, synced to Vercel's production environment.
- **`prd_release`:** the release pipeline's own config, a branch of `prd` (like `stg_preview` is of `stg`). It sees every `prd` value and adds the pipeline's three credentials. It is never synced, so those credentials never reach the website.

**Different from staging on purpose, until launch:** Upstash is pay as you go (staging: Fixed 1GB); the Supabase organisation's spend cap stays on (production has no users either); no point-in-time recovery. The pre-launch checklist changes each one.

| Step | Who | What to do |
|---|---|---|
| 10.1 | Claude Code, then you | **Claude Code's own Doppler access, before the first production key goes in** (founder's decision, 3 November 2026: service tokens on the free plan instead of the Team plan's service account). Claude Code creates four Doppler service tokens, each limited to one config: `hrizzup/dev`, `hrizzup/stg` and `hrizzup-tools/claude` read and write, `hrizzup/stg_preview` read only. They go straight into this Mac's keychain, unseen, and are used only through `infra/doppler/run`. `python3 infra/doppler/check_access.py` proves that none can open `prd` or `prd_release`. Then **you** sign your own Doppler login out of this Mac: in Terminal (or in Claude Code, starting the line with `!`), run `doppler logout --yes`. From then on you use Doppler's website, and Claude Code never uses a personal login. **Also recommended** (they hold your own logins, which reach production too): `supabase logout`, `vercel logout` and `npx wrangler logout`, then in Supabase, **Account → Access Tokens**, delete the token named `cli_hrishikesh@…` (marked LEGACY, full access, never expires). Claude Code doesn't need any of them. **Claude Code's part done, 3 November 2026** (setup log). **Your part done, 4 November 2026:** the access check reports no Doppler login saved on this Mac, the Supabase, Vercel and Wrangler logins are gone from it too, and you deleted the LEGACY Supabase token. |
| 10.2 | Claude Code | **Production's storage:** the buckets **`hrizzup-uploads`** (private) and **`hrizzup-media`** (public only at **`media.hrizzup.com`**, its `r2.dev` address off), both in Asia-Pacific, with the same rules as staging (origins `https://hrizzup.com` and `https://www.hrizzup.com`), kept in `infra/cloudflare/r2/` and applied with `apply.py production`. Tested once with an image: public download, a resized copy (AVIF and WebP, from Cloudflare's cache the second time) and the CORS rules. **Done, 3 November 2026:** the one-time exception, like the holding page, made before production had any keys or data. From now on only the release pipeline changes production's storage settings. |
| 10.3 | Claude Code | **The release pipeline** (`.github/workflows/release.yml`, see "Releasing to production") and the GitHub environment **`hrizzup-production`**, which only `main` can use. Every production check it runs is first run on staging by Claude Code. **Done, 3 November 2026.** |
| 10.4 | You | **Your checklist, below,** in order, about 45 minutes. **Parked until launch** (founder's decision, 4 November 2026): it is the pre-launch checklist's first item, P.0. |
| 10.5 | Claude Code | When you say "done" (with production's project ID): it records the project ID in the repo (a pull request), then runs the release pipeline once and confirms that `hrizzup.com` still shows the holding page and that its health page reports every production service answering. It compares staging and production side by side from the pipeline's report, then records everything. **Parked** with step 10.4 (P.0). |

**Done when:** Claude Code's Doppler access can't open production and your login is signed out of this Mac; every production service exists with staging's settings and its keys in Doppler; the release pipeline has run once; `hrizzup.com` still shows the holding page, with every production service answering on its health page.

**Part 10 finished on 4 November 2026, apart from production's own values** (steps 10.4 and 10.5), parked in the pre-launch checklist (P.0, founder's decision). Some of them may already be in `prd`; Claude Code never looks, and the release pipeline's key check confirms every one at launch.

## Your checklist, click by click

**How to copy each value:** keep two browser tabs open, Doppler and the service you're in. Click the service's copy button, then in Doppler click **+** (top right of the secrets list), type the **name** shown here, paste the value, and click **Save** (top right). Never paste a value into a chat, and never change a copied value.

**0. Doppler: the pipeline's config** (2 minutes)
1. Doppler → **Projects** → **hrizzup**.
2. On the **Production** row, click **+** (right side), type `release` after `prd_`, click **Create Branch Config**. You now have `prd` and `prd_release`.

**A. Supabase: the production project** (10 minutes)
1. Supabase → **New project** (in Zugzwang-world's Org, Pro).
2. **GitHub (optional):** leave it empty. **Project name:** `hrizzup-production`. **Compute size:** MICRO.
3. **Database password:** click **Generate a password**, copy it, and save it in Doppler `prd` as `SUPABASE_DB_PASSWORD`.
4. **Region:** open the list; under "Specific regions" choose **South Asia (Mumbai)** (`ap-south-1`).
5. **Security:** untick **Enable Data API**; tick **Enable automatic RLS**. Leave **Advanced configuration** at **Postgres** (the default).
6. Click **Create new project** (it shows $10 a month). Wait until the project page says **Healthy**.
7. On the project's home page, next to its address (`https://….supabase.co`), click **Copy** → `prd` as `SUPABASE_URL`.
8. Click **Connect** (top bar) → **Direct** → **Transaction pooler** → switch on **Use IPv4 connection** (the box above the string then says **Shared pooler**) → copy the `postgresql://…:6543/postgres` line → `prd` as `DATABASE_URL`. Leave `[YOUR-PASSWORD]` in it exactly as it is.
9. Same panel: **Session pooler** → copy the `…:5432/postgres` line (Shared pooler) → `prd` as `DATABASE_URL_SESSION`.
10. **Project Settings → API Keys:** the **Publishable key** → `prd` as `SUPABASE_PUBLISHABLE_KEY`; under **Secret keys**, the `default` key (click the eye, then copy) → `prd` as `SUPABASE_SECRET_KEY`.
11. **Authentication → Sign In / Providers → Google:** copy **Callback URL (for OAuth)** and keep it for step F6. Close the panel **without saving** (the pipeline switches Google on).
12. **Project Settings → General:** copy the **Project ID**. It isn't secret; you'll give it to Claude Code at the end.

**B. Supabase: the pipeline's own access token** (2 minutes)
1. Supabase → your picture (top right) → **Account preferences** → **Access Tokens** → **Generate new token**.
2. Name `Hrizzup release pipeline`; access to the project **`hrizzup-production` only**, full access, no account or organisation access (the same scope as Claude Code's staging token); the longest expiry offered.
3. Copy → Doppler **`prd_release`** as `SUPABASE_ACCESS_TOKEN`.

**C. Upstash: the production database** (3 minutes)
1. Upstash → **Redis** → **Create Database**. **Name:** `hrizzup-production`. **Primary Region:** Amazon Web Services → **Mumbai, India** (`ap-south-1`). **Read Regions:** none. **Eviction:** on. **Next**.
2. Plan: **Pay as You Go**. **Max budget:** $10 a month (production has no users; this is its spending cap until launch). Finish creating it.
3. On the database's page, in the **REST API** section, copy `UPSTASH_REDIS_REST_URL` → `prd` under that name, and `UPSTASH_REDIS_REST_TOKEN` → `prd` under that name.

**D. Cloudflare R2: the website's storage key** (3 minutes; the buckets already exist)
1. Cloudflare → **R2 Object Storage** → **Overview** → next to **API Tokens**, **Manage** → **Create Account API token**.
2. **Token name:** `hrizzup-production-app`. **Permissions:** **Object Read & Write**. **Apply to specific buckets only:** `hrizzup-uploads` and `hrizzup-media`. **TTL:** Forever. No IP filtering. **Create Account API token**.
3. Copy **Access Key ID** → `prd` as `R2_ACCESS_KEY_ID`, and **Secret Access Key** → `prd` as `R2_SECRET_ACCESS_KEY`. Ignore the other values on that page.

**E. Cloudflare Turnstile: the production widget** (2 minutes)
1. Cloudflare → **Turnstile** → **Add widget**. **Widget name:** `Hrizzup production`. **Hostnames:** `hrizzup.com` and `www.hrizzup.com` (no `localhost`). **Widget mode:** Managed. **Pre-clearance:** No. **Create**.
2. Copy **Site Key** → `prd` as `TURNSTILE_SITE_KEY`; **Secret Key** → `prd` as `TURNSTILE_SECRET_KEY`.

**F. Google: a separate Cloud project for production sign-in** (10 minutes, signed in as `hrishikesh@hrizzup.com`)
1. console.cloud.google.com → the project picker (top left) → **New project** → **Project name** `hrizzup-production` → **Create**, then select it.
2. **☰ → Google Auth Platform → Get started.** **App name** `Hrizzup`; **User support email** yours → **Next**; **Audience** External → **Next**; **Contact information** your email → **Next**; agree → **Continue** → **Create**.
3. **Audience:** leave it in **Testing**; under **Test users**, **Add users**: your own Google address and your testers' → **Save**.
4. **Data Access → Add or remove scopes:** tick `…/auth/userinfo.email`, `…/auth/userinfo.profile` and `openid` → **Update** → **Save**.
5. **Branding → Authorized domains → Add domain:** `hrizzup.com`, then production's Supabase address without `https://` (from step A7: `<project id>.supabase.co`) → **Save**. Leave the home page and privacy links empty for now (pre-launch).
6. **Clients → Create client:** **Application type** Web application; **Name** `Hrizzup production`; **Authorized JavaScript origins** `https://hrizzup.com` and `https://www.hrizzup.com`; **Authorized redirect URIs**: the Callback URL from step A11 → **Create**.
7. The dialog shows the **Client ID** and **Client secret** (the secret only now): copy each → `prd` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

**G. Resend: the production sending key** (1 minute)
1. Resend → **API Keys** → **Create API Key**. **Name** `Hrizzup production`; **Permission** Sending access; **Domain** `mail.hrizzup.com` → **Add**.
2. Copy → `prd` as `RESEND_API_KEY`.

**H. The pipeline's Vercel and Cloudflare tokens** (4 minutes)
1. Vercel → your picture → **Account Settings → Tokens** → create: **Name** `Hrizzup release pipeline`; **Scope** Hrizzup; **Expiration** 1 year → **Create** → copy → Doppler **`prd_release`** as `VERCEL_TOKEN`. (It promotes builds and checks the project's settings.) The pipeline's three credentials (`SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`) go into **`prd_release`** only: the release pipeline refuses to run while any of them is in `prd`, which syncs to Vercel's production settings.
2. Cloudflare → the person icon → **My Profile → API Tokens → Create Token → Create Custom Token**. **Name** `Hrizzup release pipeline (R2 settings)`; **Permissions:** one row, **Account · Workers R2 Storage · Edit**; **Account Resources:** Include your account; no IP filtering; **TTL** 1 year → **Continue to summary → Create Token** → copy → Doppler **`prd_release`** as `CLOUDFLARE_API_TOKEN`. (It applies production's storage rules.)

**I. Doppler: five fixed values** (1 minute; names and addresses, not secrets)
1. Doppler → **hrizzup** → **prd** → the small arrow next to **+** → **Import Secrets** → paste these five lines exactly → import → **Save**:
   ```
   R2_ENDPOINT=https://4ddce98b4a4cbc9146d4269f36b03f68.r2.cloudflarestorage.com
   R2_BUCKET_UPLOADS=hrizzup-uploads
   R2_BUCKET_MEDIA=hrizzup-media
   MEDIA_BASE_URL=https://media.hrizzup.com
   REDIS_KEY_PREFIX=prd
   ```
2. `prd` now holds 20 secrets. Doppler's **Action Required** list will still name one, `AUTH_RELAY_SECRET`: leave it, staging and previews alone use it.

**J. Doppler → Vercel: the production sync** (2 minutes)
1. Doppler → **hrizzup** → **prd** → **Config Syncs** → add a sync → **Vercel** → the **Hrizzup** connection → project **hrizzup**, environment **Production**, type **Sensitive**, and don't import anything from Vercel → set it up. (The same way as staging's sync in step 9.3.)

**K. Doppler → GitHub: the pipeline's one secret** (2 minutes)
1. Doppler → **hrizzup** → **prd_release** → **Access** → the **+** button next to **Service Tokens**. **Name** `github-actions-release`; **Access:** Read only (leave Write unticked); no expiry → **Generate Service Token** → copy.
2. github.com/Zugzwang-world/hrizzup → **Settings → Environments → hrizzup-production → Add environment secret**. **Name** `DOPPLER_TOKEN`; paste → **Add secret**.

**L. Tell Claude Code: "done"**, with the **Project ID** from step A12. Claude Code then does step 10.5.

**If anything is unclear on a page,** stop and tell Claude Code which step and what the page shows; never paste a key to explain.

---

# Part 11: Hand over to the three projects

**What we're doing:** each Claude project gets its brief.

**Why:** the thinking projects start from the real setup and stay current without holding the whole repository.

| Step | Who | What to do |
|---|---|---|
| 11.1 | Claude Code | Check that `docs/setup.md` lists every account, plan, region and setting (with no secrets), write the setup close-out at its top, and update the status files. **Done, 4 November 2026.** |
| 11.2 | Claude Code | Write the three briefs, `docs/brief/product.md`, `docs/brief/sourcing.md` and `docs/brief/news-desk.md`: the only repository files the projects keep (founder's decision, 4 November 2026). Claude Code rewrites the relevant one at the end of every session (CLAUDE.md, "Thinking-project briefs"). A daily routine that would catch one left behind is ready in `infra/claude/` but off for now (founder's decision). **Done, 4 November 2026.** |
| 11.3 | You | In each Claude project (Product, Sourcing, News Desk), open **Project knowledge** and remove any files added from GitHub before (`PLAN.md`, `docs/setup/`, `docs/status/`). Then click **+** → **GitHub** → `Zugzwang-world/hrizzup`, tick only that project's brief in `docs/brief/`, and add it. Before each thinking session, click **Sync now**: Claude projects don't refresh GitHub files by themselves. If you like, ask each project what its brief leaves unclear, and pass that to Claude Code. |
| 11.4 | — | Product work starts (PLAN.md, Phase 1). |

**Done when:** each project keeps only its brief.

**Claude Code's part finished on 4 November 2026;** step 11.3 is yours, about a minute per project.

---

# Releasing to production

**What we're doing:** putting the exact production build of a commit that passed staging live, with one command.

**Why:** nothing is rebuilt between the check and going live, and going back is one command too.

**Why it works this way:** Vercel puts each environment's keys into its build. If a staging build is promoted, Vercel rebuilds it with production keys, so it would no longer be the build that was checked. So every merge to `main` builds the same commit twice: once for staging, and once as a hidden production build (production keys and data, private address only). That hidden build is what gets promoted, untouched.

| Step | Who | What to do |
|---|---|---|
| R.1 | Claude Code | Pick the commit that passed staging (normally the newest). Check that its database changes, if it has any, are written so the version that is live keeps working with them. |
| R.2 | You | Say "release". You or Claude Code then start the **Release** workflow: in GitHub, **Actions → Release → Run workflow** (leave "commit" empty for the newest commit that passed staging), or Claude Code runs `gh workflow run release.yml`. |
| R.3 | Release pipeline | With its own production credentials (Doppler `prd_release`), in order, stopping at the first failure: (1) the commit is on `main` and passed staging; (1a) before loading production's keys, their names alone: each is one of the app's keys production holds or one of the pipeline's own credentials; (2) production's values are production's own and valid (Vercel's production settings hold every production key `prd` holds and nothing else, the database addresses, every key); (3) Supabase's project settings; (4) the commit's database changes, then every table checked locked; (5) the sign-in and storage settings, Redis, and the Vercel project (`autoAssignCustomDomains` still off); (6) the hidden build's private `/api/health` shows that commit, `bom1` and every service answering, and until launch its home page is the holding page; (7) Vercel's promote (the same request `vercel promote` makes, sent by the repo's own script), live instantly with no rebuild; (8) it waits until `hrizzup.com/api/health` shows that commit with every service answering. |
| R.4 | Claude Code | Confirm from the outside that `hrizzup.com/api/health` shows that commit, and record the release in `docs/setup.md`. |

**A build made before a production key changed** has the old keys (Vercel puts keys into each build). The pipeline refuses one that is missing keys; after any change in `prd`, merge a change (or redeploy that commit in Vercel) and release the new build.

**Going back:** **Run workflow** again with **action** `rollback` and the commit to go back to (it must be older than the live one). It checks that commit's build and makes Vercel's rollback: instant, no rebuild. The database stays as it is, which is why every database change is written so the version before it keeps working.

**Only you can release** (founder's decision, 10 November 2026): the workflow's first job, "Only the founder", stops any run, or re-run, that your own account didn't start, before the release job comes near production's keys. Claude Code works through your account, so it can still start one when you say "release"; nobody else with the right to run workflows can, person or app.

**Before launch:** `hrizzup.com` shows the holding page, and the pipeline refuses any build whose home page isn't it. The first promotion of an app build is the launch: tick **launch** when starting that one; Claude Code then switches the holding-page check off in the repo (`HOLDING_PAGE_UNTIL_LAUNCH` in `release.yml`).

---

# Pre-launch checklist

**What we're doing:** production's own values, then the paid extras and final decisions that the lean production twin left for later (founder's decisions, 3 and 4 November 2026). Everything still open when setup closed on 4 November 2026 is parked here, and only here; later items join with the founder's decision (P.14 to P.16, 9 November 2026; P.17, 10 November 2026).

**Why:** production costs almost nothing until real users arrive; each item here is switched on once it matters, and before the first real user signs in.

**Not for now.** Start it about **3 weeks before launch**, because Google's publishing and brand verification take time, and do P.0 first: most other items need production's services. Claude Code gives the exact clicks for each item when you start it, and records each one in `docs/setup.md`.

| # | Item | What it means |
|---|---|---|
| P.0 | **Production's own values, first** (Part 10, parked by the founder on 4 November 2026) | Your checklist in Part 10, steps 0 to K, in order; some values may already be in `prd`, and Claude Code never looks. Then say "done" with production's project ID: Claude Code records it and does step 10.5, the release pipeline's first run, whose key check confirms every value. Once the pipeline's own Supabase, Vercel and Cloudflare tokens exist, Claude Code adds their renewal reminders to `.github/reminders.json`. |
| P.1 | **Point-in-time recovery** | Supabase → `hrizzup-production` → **Add-ons**: turn on point-in-time recovery (production only; staging keeps daily backups). At the same time, size production's compute for launch (it starts on Micro), then Claude Code sets both in `infra/supabase/project/settings.json` so the pipeline checks them. One test restore before launch. |
| P.2 | **Cloudflare Pro** | Upgrade `hrizzup.com` to the **Pro** plan, and turn on Cloudflare Images' paid plan, so new image sizes never fail once the free 5,000 a month are used up. |
| P.3 | **Upstash's Fixed plan with auto-upgrade** | Move `hrizzup-production` from pay as you go to **Fixed 1GB** (the same as staging), with **Auto Upgrade on**, so a limit never takes the live site offline (eviction stays on). Claude Code then sets its size in `infra/upstash/check.py`. |
| P.4 | **Google publishing and brand verification, with the custom sign-in address** (start 3 weeks before launch) | Supabase's **Custom Domain** add-on for production ($10 a month), so Google's sign-in screen shows `auth.hrizzup.com` instead of the `….supabase.co` address. Claude Code adds its two records in Cloudflare (DNS only), and the new callback goes into the production Google client before the domain is switched on. Then on the production project's **Branding** page: the home page (`https://hrizzup.com`), the privacy-policy link, the logo, and `hrizzup.com` verified in Google Search Console (Claude Code adds the TXT record). Then, with a Google account that isn't a test user: check that it's refused before publishing (the check left over from step 9.6), publish the consent screen, and check that it's let in. Staging's Google project stays in Testing. |
| P.5 | **Analytics** | Decide what to measure on real users (Vercel's Web Analytics and Speed Insights for the performance budget, PostHog later). They are off until then; Claude Code switches them on in `infra/vercel/project.json`, where they are now checked off. |
| P.6 | **Spending limits, revisited** | Vercel's limit ($50 a month, pausing if reached) raised to fit launch traffic; Supabase's organisation spend cap **off** (usage alerts stay on); Upstash's budget replaced by the Fixed plan (P.3); Resend's plan and Google Cloud's billing checked. On production, a billing limit must never take the site offline. |
| P.7 | **Trim Claude Code's Cloudflare key** (parked by the founder, 4 November 2026) | Remove its **R2** and **Turnstile** rights (they reach production's buckets and widget too), and the extras it never needed: it can also read Workers scripts, Workers routes, Page Rules and Email Routing settings (found in step 2.6, checked again on 3 November 2026). In Cloudflare: the person icon → **My Profile → API Tokens** → the key's **three dots → Edit** → delete every permission row that is no longer needed → **Continue to summary → Update token**. The key's value stays the same, so nothing changes in Doppler. Staging's storage rules and widget then change through you or the release pipeline, or staging moves to its own Cloudflare account; Claude Code recommends one when you start, and checks the key afterwards. |
| P.8 | **CAA records** | Claude Code adds CAA records naming every certificate authority that Cloudflare and Vercel use (checked against each provider's current list at the time), so no other authority can issue a certificate for `hrizzup.com`. |
| P.9 | **The legal pages' open gaps** | Fill the highlighted gaps on `/privacy` and `/terms`: the legal entity, its address, the contact email, the Grievance Officer, the retention days and the courts' city. The final versions go live through the release pipeline. |
| P.10 | **Link previews in WhatsApp and X** | Share a link to `hrizzup.com` in WhatsApp and X and check that the preview (title, image) shows. Bot Protection may challenge their link fetchers; if so, Claude Code allows them in the firewall (`infra/vercel/firewall.json`). |
| P.11 | **The AI-crawler decision** | Decide whether AI crawlers may read the site. The firewall's AI bots rule only logs them now; Claude Code switches it to block (and updates `robots.txt`) if you choose that. |
| P.12 | **Two-step login on Upstash** (Part 0, step 0.2; parked by the founder, 4 November 2026) | Turn on two-step login for your Upstash account and save its recovery codes in Proton Pass. Upstash's database page lists "MFA Requirement" among its recommended security steps, still unticked. |
| P.13 | **Sign-in emails land in the inbox** (Part 3, step 3.7; parked by the founder, 4 November 2026) | Staging's test email from `no-reply@mail.hrizzup.com` was delivered on 3 November 2026, but into Spam. Check its headers (SPF, DKIM and DMARC) and fix what they show, then check that production's first sign-in code reaches a real inbox with DMARC passing. |
| P.14 | **The app's API through production's firewall** (from Round 2; the founder's decision, 9 November 2026) | Production's bot challenge would block the app's calls to the typed API (`/api/v1/`), as staging's did until 9 November 2026: an app can't pass a challenge built for browsers. Production gets the same two rules as staging (the app's API skips the bot challenge, behind a limit of 60 requests a minute per IP, on production's domain only), applied by the release pipeline, never by Claude Code: Claude Code first adds a pipeline step that applies the Vercel settings in `infra/vercel/` (today the pipeline only checks them) and tests it on staging; the rules then go out with a release, and Claude Code checks from outside that the app's calls reach production while a browser-less write still gets the challenge. |
| P.15 | **The app's cold start, timed on a real phone** (from Round 2; the founder's decision, 9 November 2026) | The app's budget is first content within 2 seconds of a cold start on a mid-range Android phone (blueprint section 14). The check on every pull request runs on an emulator, which is no phone (the empty app takes about 3 to 4 seconds there), so it only catches clear slowdowns. Before launch, time the store build's cold start on a real mid-range Android phone: yours, or a cloud phone (Firebase Test Lab's free daily quota, in a Firebase project you create). Claude Code gives the steps and records the numbers in the setup log; anything over budget is fixed before launch. |
| P.16 | **Your admin row on production** (from Round 3; the founder's decision, 9 November 2026) | Admins are listed in a table that only reviewed migrations write, each naming an account's ID and adding its row only where that account exists (blueprint section 5, "Admins"). Staging's row came with step 1.7c; production's comes after your first sign-in there, so it's the last item: production's sign-in answers "not found" until the launch release. Then sign in on `hrizzup.com` once, copy your account's ID from Supabase (`hrizzup-production` → **Authentication → Users**, your row's **User UID**) and give it to Claude Code: it's an ID, not a secret. Claude Code writes the migration that adds your row, sized risky so it waits for the AI review; the next release applies it. Then check that the market console opens for you on `hrizzup.com`; Claude Code checks from outside that everyone else gets "not found". |
| P.17 | **The repository private again, and the checks' minutes** (from Round 3; the founder's decision, 10 November 2026) | The repository went public in November 2026 so its checks run free: GitHub's included Actions minutes ran out on 9 November 2026. Before the launch release (so before P.16): in GitHub, the repository's **Settings → General → Danger Zone → Change visibility → Make private**. Decide the checks' minutes at the same time, since a private repository's checks are billed again: Claude Code first makes the checks leaner and measures what a month of them uses, then recommends a monthly Actions budget that stops at its limit, which you set in **Settings → Billing and licensing**. Going private ends what GitHub gives only public repositories: its secret scanning and push protection (the secret check still runs on every pull request), the interaction limit and the approval for forks' pull requests (outsiders can no longer see the repository). Claude Code then removes the interaction limit's reminder from `.github/reminders.json` and records it all in `docs/setup.md`. |

**Also before launch** (Claude Code's additions, from earlier decisions):
- **Production's hourly email limit** (`rate_limit_email_sent` in `infra/supabase/auth/settings.json`) raised to fit expected sign-ups.
- **Claude Code's GitHub identity:** a separate GitHub account for Claude Code, with your approval needed for changes to the release pipeline's files (it merges its own pull requests today).
- **Production hardening** (below), before the first real user signs in.

**Done when:** every item is done or decided, and recorded in the setup log.

---

# Later, with the team

- **Helpers' GitHub invitations:** `Titan00714`, `Anupamhodl` and `Zoro47007` were invited on 2 November 2026 and haven't accepted yet; GitHub cancels the invitations on 9 November 2026. Claude Code sends new ones when a helper is ready to start.
- **Doppler's Team plan** ($21 per user a month) before any helper joins Doppler: its roles let you keep production keys to yourself (on the free plan, Doppler can't limit what a member opens). Give each helper the Collaborator role on `hrizzup`'s Development and Staging, no access to Production, and no access to `hrizzup-tools`. Before the first helper joins, replace the Cloudflare key and the Supabase access token with new ones in `hrizzup-tools` (Claude Code gives you the clicks), because both sat in `dev` until 3 November 2026 and old copies may show in its history; the same goes for the Expo token if step 4.6 moved it rather than replacing it (it sat in `stg` on 8 November 2026).
- **Sentry and PostHog:** one project per environment, with keys in Doppler.
- **Apple Developer and Google Play accounts.** Start Google Play early: a personal account needs a closed test with at least 12 testers for 14 days before the app can go public. Their app IDs and signing fingerprints go into the two files the website serves so that shared links open the app (`/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`).
- **RevenueCat and Razorpay:** set up with the app, for the paid tier, which is in version one (PLAN.md step 2.7). Razorpay with UPI on the website.
- **Cloudflare Stream:** switched on in the same Cloudflare account when creator video is built (PLAN.md step 2.4), with separate API tokens for staging and production, a budget alert, and the tokens kept in Doppler.
- **AWS:** later, only if a concrete need appears, as its own project.

---

# Production hardening

**What we're doing:** a last check before real users arrive.

**Why:** real users' data must sit behind keys that only you and the release pipeline hold.

- **Production keys held only by you and the pipeline.** Since Part 10, Claude Code never reads, holds or uses production keys, so there are none to take back. Before real users arrive, check that every route by which Claude Code's tools could still reach production is closed or covered (blueprint section 3, "Production is off-limits to Claude Code"), and that you created every key in `prd` and `prd_release`. If a production key was ever exposed, replace it. Production keys never go in this repository.

**Done when:** that check is recorded in the setup log, before the first real user signs in.

*(The secret check, pull requests and repository protections used to be listed here. They have been on since 2 November 2026; see Part 1, step 1.7.)*
