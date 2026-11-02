# Hrizzup: setup log

## 2 November 2026

### Repository created (runbook 1.2, by the founder)

Checked through GitHub's API.

| Setting | Value |
|---|---|
| Repository | `zugzwang-foundation/hrizzup` |
| Visibility | Private |
| Created | 2 November 2026, 13:25 UTC (18:55 India time) |
| Created with | No README, no .gitignore, no licence (the repository had no commits) |
| Default branch | `main` |
| Issues, Projects, Wiki | On, On, Off |
| Auto-merge; delete branch after merge | Off; Off |
| Branch protection, rulesets, secret scanning, push protection | None (not available on the organisation's plan, see below) |

### GitHub organisation `zugzwang-foundation` (as found)

Checked through GitHub's API.

| Setting | Value | Note |
|---|---|---|
| Plan | Free | Decided later the same day: stays on Free (see "Setup documents updated" below) |
| Two-factor authentication required for members | **Off** | To switch on: runbook 1.1 (founder) |
| Base permission for members | Read | |
| Members can create public repositories | Yes | |

### Repository foundation (runbook 1.4, Claude Code)

- **Files:** PLAN.md (with the name Hrizzup); `docs/setup/BLUEPRINT.md` and `docs/setup/RUNBOOK.md` (unchanged copies); this log; the three parts `sourcing/`, `news-desk/` and `product/`, each with a README; the status files in `docs/status/`; CLAUDE.md; LICENSE; THIRD_PARTY_NOTICES.md; .gitignore.
- **Licence:** proprietary, all rights reserved.
- **.gitignore:** every environment file (`.env*`, `*.env`), key and signing files, and local tool state are never committed.
- **Not chosen yet:** frameworks, package manager, app dependencies (decided in PLAN.md step 1.5).

### Claude Code connectors (project scope, in `.mcp.json`)

Shared through the repository, so every helper gets the same set. Each person approves them once on their own machine. All three were checked as connected on the founder's Mac.

| Connector | Address | Login |
|---|---|---|
| GitHub | `https://api.githubcopilot.com/mcp/` (GitHub's official server) | Each person's own GitHub command-line login (`gh`), read at connection time. No token is stored anywhere. |
| Context7 | `https://mcp.context7.com/mcp` | None (free tier) |
| Playwright | `npx -y @playwright/mcp@0.0.82` (runs locally) | None. Same pinned version as the founder's existing user-level setup |

### Claude Code plugins (project scope, in `.claude/settings.json`)

From Anthropic's official marketplace (`claude-plugins-official`). Shared through the repository; Claude Code offers them to each helper who opens it. All four were checked as enabled. They load from the next session onwards.

| Plugin | Version | Notes |
|---|---|---|
| security-guidance | 2.0.17 | Enabled. Warns on risky code as it is written, reviews each turn's changes and every commit with Claude, using the signed-in Claude account. On first start it sets up a Python helper in `~/.claude/security`. |
| code-review | 1.0.1 | Enabled |
| frontend-design | 1.1.1 | Enabled |
| feature-dev | 1.0.1 | Enabled |

### Tools on the founder's Mac (as found)

Claude Code 2.1.316; Node.js 24.21.0; pnpm 10.33.2; Python 3.9.6; GitHub CLI 2.91.0 (signed in as `Zugzwang-world`, git over SSH); Doppler CLI 3.76.0.

### Setup documents updated (founder's decisions)

- **GitHub plan:** the organisation stays on the free plan. No GitHub Team and no Secret Protection add-on.
- **Runbook:** step 1.5 (the paid-plan decision) removed. Step 1.6 rewritten: Dependabot alerts and security updates, plus an open-source secret scanner before every commit and in CI. Part 1's "Done when" line updated to match. Every Part (0 to 10) now opens with a "What we're doing" and a "Why" line. The founder's list covered Parts 1 to 10; Claude Code wrote Part 0's in the same style.
- **Blueprint:** section 2 (GitHub row), section 11 (GitHub) and section 13 (order of setup) updated to match. The GitHub **DECIDE** item is closed.
- **Lawyers and legal review:** both files were searched for lawyer, legal, counsel and attorney. There were no mentions, so nothing was removed.

### Dependabot and the secret scanner (runbook 1.6, Claude Code)

| Setting | Value | How it was checked |
|---|---|---|
| Dependabot alerts | On | GitHub's API: `GET /repos/zugzwang-foundation/hrizzup/vulnerability-alerts` returned 204 (on) |
| Dependabot security updates | On, not paused | GitHub's API: `GET .../automated-security-fixes` returned enabled, not paused |
| Secret scanner | gitleaks (MIT licence, used as a separate program, nothing copied into the repo). Version 8.30.1 on the founder's Mac (Homebrew) and in CI | — |
| Before every commit | `.githooks/pre-commit` scans the staged changes. It stops the commit if it finds a secret, if gitleaks fails, or if gitleaks isn't installed | In a throwaway copy of the repo: a fake GitHub token was blocked; a commit with gitleaks missing was blocked; a clean commit went through |
| Switching the hook on | `git config core.hooksPath .githooks`. A Claude Code session-start hook in `.claude/settings.json` runs this at the start of every session, on every machine | `git config core.hooksPath` shows `.githooks` on the founder's Mac |
| In CI | `.github/workflows/secret-scan.yml` ("Secret scan"): runs on every push and pull request, and by hand. It downloads gitleaks 8.30.1 and checks its SHA-256 before running it; `actions/checkout` is pinned to the commit for v7.0.1. It scans the whole history. Read-only permissions | The CI command failed on the throwaway copy once a fake token had been forced past the hook. First run on GitHub, for commit `f494681`: passed ([run 41459744390](https://github.com/zugzwang-foundation/hrizzup/actions/runs/41459744390)) |
| History so far | No leaks | `gitleaks git` over every commit |
| Limits of the free plan | GitHub can't block a push (no push protection, no required checks for private repos), so CI flags a secret after the push but can't stop it. The commit hook can be skipped on purpose with `git commit --no-verify`, and a machine that never opens Claude Code needs the one-line `git config` above | — |

**Still open in Part 1:** step 1.1 (founder). Checked again through GitHub's API on 2 November 2026: the organisation's two-factor requirement is still **off**.

### Screen sizes: every screen fits every device (founder's decision)

- **The rule:** every screen adjusts itself to any device, from a small phone to a large monitor, with nothing cut off, overlapping or scrolling sideways. Layouts use flexible rules (proportions, wrapping, Tailwind and shadcn/ui responsive classes), never fixed pixel widths tuned to one screen. Phone-first.
- **The automatic check,** run before the founder sees any screen change: a real browser (Playwright) at 320, 360, 390, 412, 768, 820, 1024, 1280, 1366, 1440, 1536, 1920 and 2560 pixels wide, plus phones and tablets turned sideways. It fails on anything that overflows, overlaps or needs sideways scrolling. Windows laptops at 125% and 150% scaling are covered by the 1280, 1366 and 1536 widths. Claude Code added Safari's engine (WebKit) next to Chrome's, because every iPhone uses it.
- **Screenshots for the founder:** 360 (phone), 768 (tablet), 1440 (laptop) and 1920 (monitor) pixels wide.
- **Where it is written:** CLAUDE.md (new section "Screens fit every device", replacing the old four-size line) and the runbook (new section "Every screen fits every device", after "How to use this runbook").
- **Not done:** the check against India's screen-size data (StatCounter). The founder dropped it, because testing this whole range replaces it.
- **Not built yet:** the check itself. It is built with the other automatic checks in PLAN.md step 0.6, and first runs on the holding page (runbook Part 9).

### Repository moved to the founder's personal account (Claude Code, founder's decision)

Moved so the founder's GitHub Pro plan covers it. Done through GitHub's API (`POST /repos/zugzwang-foundation/hrizzup/transfer`, new owner `Zugzwang-world`, same name).

| Setting | Value | How it was checked |
|---|---|---|
| Owner | `Zugzwang-world` (personal account, on GitHub Pro). Before: the `zugzwang-foundation` organisation | GitHub's API: owner `Zugzwang-world`, type User |
| Address | `https://github.com/Zugzwang-world/hrizzup` (SSH: `git@github.com:Zugzwang-world/hrizzup.git`) | GitHub's API |
| Visibility | Private | GitHub's API: private, visibility private |
| Old address | Redirects to the new one (until something else takes the old name) | GitHub's API: the old address answers as `Zugzwang-world/hrizzup` |
| This folder's git remote | `origin` now points at the new SSH address | `git remote -v`; a test push reached the new address, and the commit recording this move was pushed there |
| GitHub Pro covers the repo | Yes: repository protections (rulesets, branch protection, required checks) are available. **None is switched on yet** | GitHub's API: `GET .../branches/main/protection` answered "Branch not protected" (on the free plan it says to upgrade); `GET .../rulesets` returned an empty list |
| GitHub's own secret scanning and push protection | Not available: GitHub sells them only to organisation plans. gitleaks stays | GitHub's documentation; the repo shows no secret-scanning settings |
| Dependabot alerts | Still on | GitHub's API: `GET .../vulnerability-alerts` returned 204 |
| Dependabot security updates | Still on, not paused | GitHub's API: `GET .../automated-security-fixes` |
| GitHub Actions | On; the "Secret scan" workflow moved with the repo | GitHub's API: `GET .../actions/permissions` |
| Who has access | Only `Zugzwang-world`. The three other organisation members (`Titan00714`, `Anupamhodl`, `Zoro47007`) had read access through the organisation and lost it with the move. They were not re-added: on a personal account every collaborator can push, so adding them is the founder's call | GitHub's API: collaborators list, no pending invitations |
| Repo secrets, environments, webhooks | None existed, so nothing needed moving | GitHub's API, before the move |

- **Documents updated:** PLAN.md (step 0.1), CLAUDE.md (a new "Repository" line with the address), the blueprint (section 2's GitHub row, section 11, section 13) and the runbook (steps 1.1 and 1.2, the note under Part 1, Part 1's "Done when", and the production list under "Later, with the team"). The secret-scan workflow's comments were updated too.
- **Runbook step 1.1 changed:** it no longer asks for the organisation's two-factor requirement, which doesn't apply to a personal account. It now asks the founder to check two-step login on `Zugzwang-world` and save its recovery codes in Proton Pass. The note above saying the organisation's requirement was off no longer matters for Hrizzup.
- **"Turn on repository protections (included in GitHub Pro)":** the founder asked for this wording in a "Production hardening" section. No section with that name exists in any version of these files, so it went into the closest match, the production list under "Later, with the team" in the runbook.
- **Left unchanged on purpose:** the blueprint's section 1 lesson that mentions "the organisation's 2FA requirement". It describes what happened at Zugzwang World, not where Hrizzup lives. Earlier entries in this log are a record and stay as written.

### Staging stays free-flowing (founder's decision)

Safety layers are added at production, not during staging. Repository protections stay **off** at the founder's request.

| What | Change | How it was checked |
|---|---|---|
| Secret check before every commit | Removed: `.githooks/pre-commit` deleted, and `core.hooksPath` unset on the founder's Mac | `git config core.hooksPath` is empty; the `.githooks/` folder is gone |
| Secret check in CI | Removed: `.github/workflows/secret-scan.yml` deleted. The repo now has no CI workflows | The `.github/` folder is gone |
| Switching the hook on each session | Removed: it was a session-start setting in `.claude/settings.json` (not a line in CLAUDE.md). The file now holds only the four plugins | File contents |
| Lefthook | Never installed or used, so there was nothing to remove | No Lefthook file or mention anywhere in the repo |
| `.gitignore` | Unchanged | — |
| Dependabot alerts and security updates | Still on, not paused | GitHub's API: `GET .../vulnerability-alerts` returned 204; `GET .../automated-security-fixes` returned enabled |
| Repository protections | None | GitHub's API: `main` "Branch not protected"; no rulesets |
| How changes land | Straight to `main` during staging, with no pull-request requirement | Written in CLAUDE.md (new section "Committing during staging") and the runbook ("How to use this runbook") |

- **Runbook:** new section "Production hardening" at the end, listing what comes back before real users arrive: the secret check before every commit, pull requests before changes land, repository protections (included in GitHub Pro), and production keys held only by the founder. Claude Code added one detail to the first item: when the secret check comes back it first scans the whole history once, and any key it finds is replaced, because anything committed during staging stays in the history. The protections item moved there from the production list under "Later, with the team". Step 1.6 now covers Dependabot only, and Part 1's "Done when" line no longer mentions the scanner.
- **Blueprint:** updated to match. Section 1's security rule now reads "recorded truthfully and checked through the API", with the basics during staging and the full set before real users arrive. Section 2's GitHub row, section 11 and section 13 were updated too.
- **PLAN.md:** not changed. Its line "Claude merges a change once its checks pass" is read during staging as "Claude runs the checks before committing to `main`".

### Screen rule: large text (founder's decision)

The phone widths (320, 360, 390 and 412) are also tested with the phone's text size turned up to 200%, with the same pass-or-fail rule. Written into CLAUDE.md ("Screens fit every device") and the runbook ("Every screen fits every device").

### Runbook step 1.1 done (founder)

The founder confirmed on 2 November 2026 that they use two-step login on the `Zugzwang-world` GitHub account. GitHub's API doesn't show this setting with the current login's permissions, so it is recorded on the founder's word. **Runbook Part 1 is finished.**

### Helpers invited as collaborators (Claude Code)

Sent through GitHub's API on 2 November 2026 at 14:43 UTC (20:13 India time), with permission to make changes (on a personal account every collaborator can push).

| GitHub account | Invitation | Permission | State |
|---|---|---|---|
| `Titan00714` | 341071169 | Write | Waiting to be accepted |
| `Anupamhodl` | 341071174 | Write | Waiting to be accepted |
| `Zoro47007` | 341071175 | Write | Waiting to be accepted |

Checked through GitHub's API (`GET /repos/Zugzwang-world/hrizzup/invitations`): all three pending, none expired. GitHub cancels a repository invitation after 7 days if it hasn't been accepted.

### How changes land: a pull request for every change (runbook 1.7, Claude Code, founder's decision)

From now on, including staging, every change goes on its own branch and pull request. Claude Code opens it, the checks run, and it merges as soon as they pass, with no human approval. This replaces "straight to `main` during staging" from earlier the same day.

| Setting | Value | How it was checked |
|---|---|---|
| Secret check | `.github/workflows/secret-check.yml` ("Secret check"): gitleaks 8.30.1 (download checked against its SHA-256), `actions/checkout` pinned to the commit for v7.0.1, read-only permissions. Runs on every pull request, and by hand. Scans the whole history | First run, on this change's pull request: see the row "This change" |
| One-time scan of the whole history | 6 commits on every branch, no leaks (gitleaks 8.30.1 on the founder's Mac) | `gitleaks git --log-opts=--all` |
| Ruleset "main" (id 26375255) | Active on the default branch. A pull request is required, with **no** reviews; squash merges only; the "Secret check" from GitHub Actions must pass; force-pushes and deleting `main` are blocked; nobody bypasses it, including the founder | GitHub's API: `GET .../rulesets/26375255` and `GET .../rules/branches/main` list all four rules |
| "Require extra approval for unattributed changes" | **Off.** GitHub turned this new option on by itself when the ruleset was created; it was switched off so that no human review can be required | GitHub's API: the `pull_request` rule shows `false` |
| Branch must be up to date before merging | Off. With several sessions working in parallel it would force constant re-syncing, and GitHub's merge queue (which solves that) is only available to organisations | GitHub's API |
| Auto-merge | On | GitHub's API: `allow_auto_merge` true |
| Delete branches after merging | On | GitHub's API: `delete_branch_on_merge` true |
| Merge methods | Squash only. The commit title is the pull request title (with its size label), and the message is the branch's commit messages | GitHub's API |
| Preview links | Come automatically once Vercel is connected (runbook Part 9) | — |
| This change | Landed through [pull request #1](https://github.com/Zugzwang-world/hrizzup/pull/1), the first under the new rule, merged automatically once its checks passed | First Secret check on the pull request: passed in 9 seconds over the whole history ([run 41467071173](https://github.com/Zugzwang-world/hrizzup/actions/runs/41467071173)), reported by GitHub Actions (app id 15368, the one the ruleset requires) |

Claude Code also chose to block deleting `main` (standard practice) and to allow squash merges only. Neither was in the founder's list.

### Production runs on the same platforms as staging (founder's decision)

- **The plan:** production is Vercel plus Supabase, set up exactly like staging (same services, versions, region and settings), with its own data and keys. AWS is no longer the production plan; it comes later only if a concrete need appears, as its own project.
- **The production twin:** a new runbook Part 10, "Production twin", right after Hosting. It covers the Supabase project `hrizzup-production`, Vercel production, Doppler `prd`, R2 buckets `hrizzup-production-uploads` and `hrizzup-production-media` (public at `media.hrizzup.com`), the Upstash database `hrizzup-production`, the production Google sign-in client, and the Turnstile widget "Hrizzup production". It is created as soon as staging works, with nothing public until launch. The hand-over Part is now Part 11 (steps 11.1 to 11.4).
- **How a release works, and why:** Vercel's documentation says that promoting a preview build (and so a staging build) to production triggers a **new build with production keys**, while promoting a "staged" production build happens instantly, with no rebuild ([Promoting a preview deployment to production](https://vercel.com/docs/deployments/promote-preview-to-production), [Promoting deployments](https://vercel.com/docs/deployments/promoting-a-deployment)). So the exact build that passed staging can't be the artifact that goes live. Instead:
  - `main` is Vercel's production branch, with "Auto-assign Custom Production Domains" off;
  - every merge to `main` deploys the commit to staging and also makes a hidden production build (production keys and data, private address only);
  - once the commit has passed staging, the release is one command: `vercel promote <address of the hidden build> --yes`. It goes live instantly, with no rebuild. Going back is `vercel rollback`;
  - before launch, `hrizzup.com` shows the holding page, so the first promotion of an app build is the launch.
  The steps are in the runbook's new section "Releasing to production" and the blueprint's section 6.
- **Still to confirm in Part 9:** whether Vercel lets the `staging` environment follow `main` while `main` is also the production branch. If not, a small deploy workflow in the repo sends each merge to staging. Vercel Pro includes the one custom environment that staging needs.
- **DNS:** the app's names (staging and production) point at Vercel, DNS only, and are never proxied through Cloudflare (Vercel advises against a proxy in front of it). This replaces the old plan for Cloudflare's proxy with origin authentication in front of AWS. CAA records at launch now name Cloudflare's and Vercel's certificate authorities.
- **Production hardening** now holds only "production keys held only by the founder". Claude Code spelled out how: before real users arrive, the founder replaces every production key in Doppler `prd` and Claude Code's access to `prd` is removed.
- **Documents updated:**
  - PLAN.md: section 3 (how changes land, production, releasing, AWS), step 0.3 (the twin follows staging) and step 5.1 (go live by promotion).
  - CLAUDE.md: new "How changes land" section; production, releasing and region lines; the AWS line.
  - Blueprint: sections 1, 2, 3, 4, 5, 6 (with a new "Releasing" part), 7, 11, 12 and 13. No **DECIDE** items remain.
  - Runbook: title and introduction, "How to use", new step 1.7, the Part 8 note, Part 9 rewritten for hidden production builds, the new Part 10, the hand-over renumbered to Part 11, the new "Releasing to production", the "Later" list, and "Production hardening".
- **Nothing was created in Vercel, Supabase or anywhere else for production yet.** That happens in runbook Parts 9 and 10.

### Product decisions: how the app is built, images, and the Cloudflare plan (founder's decisions)

Recorded in PLAN.md (section 2, new parts "How it's built" and "Decided later"; step 1.5; section 7), the blueprint (sections 2, 4 and 14, and a new section 13, "App building blocks") and the runbook ("How to use", steps 2.1, 6.5, 6.6, Part 10, and "Later, with the team"). Nothing was set up in any service today.

| Area | Decision | Where it shows up in setup |
|---|---|---|
| Codebase | Expo (React Native) app and Next.js website in one codebase that shares code | PLAN.md step 1.5 now sets it up instead of deciding it. The package manager and how the code is split up are settled then |
| API | One typed API that both the app and the website use | Built in step 1.5 |
| Live updates | Supabase Realtime (market prices, new posts) | Which tables send updates is set in migrations, the same on staging and production |
| Search | From day one, starting with the database's own text search | Postgres full-text search, set up in migrations |
| Shared links | Open the app if it's installed (Android App Links, iOS Universal Links) | The website serves `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`, filled in from the Google Play and Apple Developer accounts |
| Tests | Core journeys tested automatically: Playwright (website), Maestro (app) | Each becomes a required check on `main` once built |
| Images | At upload: strip location data, fix rotation, cap the size, make a tiny blurred placeholder. One original in R2. Delivered through Cloudflare image transformations (`format=auto`, resized per screen, cached at the edge). Next.js images pointed at Cloudflare on the website; Expo's image component with the placeholder in the app. No conversion scripts | Runbook 6.5 (turn transformations on, only for our own images) and 6.6 (test), and 10.11 for production |
| Cloudflare plan | **Free** during staging; `hrizzup.com` upgraded to **Pro** in Part 10 | Runbook 2.1 now says Free; new step 10.1 does the upgrade. Blueprint section 2 updated |
| Decided later | Background jobs (Sourcing project); subscriptions with RevenueCat plus Razorpay (UPI) on the web, built when the app is built; PostHog and the admin page later; English only | PLAN.md "Decided later", blueprint section 13, runbook "Later, with the team" |

**Details Claude Code added, each following standard practice:**
- **Images are processed on the server,** because a phone can't be trusted to remove location data. The app also shrinks photos before uploading, to save mobile data. The raw upload in the private bucket is deleted after processing (lifecycle rule).
- **Transformations run on the media addresses** (`media-staging.hrizzup.com`, `media.hrizzup.com`), which go through Cloudflare. The app's own names point at Vercel, DNS only, so transformations can't run there.
- **Only our own images can be transformed** ("resize images from any origin" stays off), so nobody can use Hrizzup as a free image service.
- **A short fixed list of widths,** so Cloudflare's cache stays warm and the count of new sizes stays low.
- **The website's Next.js images use a custom loader** pointing at Cloudflare, so Vercel's own image optimisation is neither used nor billed.
- **Cloudflare Images' paid plan is turned on in Part 10.** Cloudflare's [pricing page](https://developers.cloudflare.com/images/pricing/) says the free allowance is 5,000 new sizes (unique transformations) a month. Past that, new sizes fail with an error until the paid plan is on ($0.50 per 1,000 more). The Pro zone plan doesn't change this.
- **RevenueCat and Razorpay need a link built by us.** RevenueCat's web payments run on Stripe ([RevenueCat Web Billing](https://www.revenuecat.com/docs/web/web-billing/configuring-overview.md)), and no Razorpay connection was found. When subscriptions are built, our server records Razorpay payments with RevenueCat, so the app and the website agree on who has paid.

**Raised as an open question:** PLAN.md section 2 lists the paid tier under "Not in version one", but subscriptions are to be built when the app is built. Is the paid tier in version one?

### Performance rules, paid tier and video (founder's decisions)

Documentation only; nothing was set up in any service.

- **Performance and caching, from day one:** a short version in CLAUDE.md ("Performance and caching") and in PLAN.md section 3 ("Fast from day one"); the full rules in a new blueprint section 14, "Production quality". "Order of setup" is now section 15.
  - **Caching in layers:** device, edge (Vercel and Cloudflare), server data caches, Upstash Redis (paid plan, closest region to Mumbai) and the database.
  - **Rules:** batching, no private data in shared caches, cache keys that include the environment, the media rules and the list rules.
  - **Starting performance budgets** (Claude Code's choice, using Google's "good" thresholds on a mid-range Android phone on slow 4G):
    - Website: largest content within 2.5 seconds, taps answered within 200 milliseconds, layout shift of 0.1 or less, and at most 200 KB of compressed code and 500 KB in total on first load.
    - App: first content within 2 seconds of a cold start, taps within 100 milliseconds, 60 frames a second, and under 100 KB of data for a screen's first view.
  - **How the budgets are checked:** automatically on every pull request once built, and on real users once live.
- **Working with the founder:** PLAN.md section 3 and CLAUDE.md now add: treat an example as one case of a general problem, solve the whole category, and write the general principle.
- **Paid tier: in version one.** PLAN.md's table, section 2 ("Paid tier (in version one)"), the "Social in the app" line and section 7 are consistent with it. A new step 2.7 builds it (RevenueCat in the app; Razorpay with UPI on the website, passed through our server). Claude Code placed it after step 2.6, so the Google Play closed test isn't held up by the paywall. What's free and what's paid is decided before the paywall is built. The open question is closed.
- **Video: Cloudflare Stream,** in the same Cloudflare account, with adaptive streaming. It is in the blueprint's media rules (section 13), the Cloudflare row in section 2, PLAN.md "How it's built", CLAUDE.md, and the runbook's "Later, with the team". Claude Code added standard practice: direct uploads from the app through one-time upload addresses, playback limited to our own sites, and separate API tokens per environment, with every video tagged by environment. The open question is closed.


### Doppler project `hrizzup` (runbook 4.2, Claude Code, brought forward)

Created with Doppler's command-line tool (version 3.76.0), logged in on the founder's Mac to the Doppler workplace `zugzwang-world`. Brought forward from Part 4 so the Cloudflare key (runbook 2.5) has a safe home.

| Config | Doppler environment | Kind | Used for |
|---|---|---|---|
| `dev` | Development | Root config | Local work, and the setup keys Claude Code uses |
| `stg` | Staging | Root config | Staging |
| `stg_preview` | Staging | **Branch of `stg`** | Previews. It copies every staging value automatically and holds only the values that must differ on previews |
| `prd` | Production | Root config | Production, kept fully separate |
| `dev_personal` | Development | Doppler's built-in personal config | Not used. Doppler refuses to delete it ("You cannot delete a personal config") |

- **How it was checked:** `doppler environments` lists Development, Staging and Production, and `doppler configs` lists the configs above. In `stg_preview`, Doppler's automatic labels read environment `stg` and config `stg_preview`.
- **Secrets:** none added. Each config holds only Doppler's three automatic labels (`DOPPLER_PROJECT`, `DOPPLER_ENVIRONMENT`, `DOPPLER_CONFIG`), checked by listing names only.
- **Changed the same day, at the founder's request:** previews first had their own `preview` environment. It was replaced by the branch config `stg_preview`, and the empty Preview environment was deleted (checked empty first).
- **Still to see in practice:** that `stg_preview` shows staging's values. That shows up as soon as the first staging value arrives, when runbook step 4.4 lists the names in each config.
- **Not checked:** the Doppler plan (runbook 4.1: the founder upgrades the workplace to Team). The command-line tool doesn't show the plan.
- **Left alone:** the workplace's other projects, `example-project` (Doppler's sample) and `zugzwang-experiment`.
- **Documents updated:** CLAUDE.md, the blueprint (sections 3, 6 and 7) and the runbook (step 4.2, now marked done, and step 9.3).


### Cloudflare zone check and clean-up (runbook 2.6, Claude Code)

Done through Cloudflare's API with the token in Doppler `dev` (`CLOUDFLARE_API_TOKEN`), used only through `doppler run` and never printed. Outside checks used `dig` and the public DNS lookup services of Google and Cloudflare.

**Zone**

| Setting | Value | How it was checked |
|---|---|---|
| Zone | `hrizzup.com`, zone ID `da46254f6736da51ef130e7bc927efd6`, account ID `4ddce98b4a4cbc9146d4269f36b03f68` (the founder's Cloudflare account) | Cloudflare's API |
| Status and plan | Active, Free plan | Cloudflare's API |
| Nameservers | `joyce.ns.cloudflare.com`, `kevin.ns.cloudflare.com` (before: GoDaddy's `ns19`/`ns20.domaincontrol.com`) | The .com registry's own server (`a.gtld-servers.net`) delegates to these two, and 1.1.1.1, 8.8.8.8 and 9.9.9.9 all answer with them |
| DNSSEC | Active. DS record: key tag 2371, algorithm 13, digest type 2, digest `AFDD16352D57069C67CB03F1B2AD38E2C15917F2A184EBA4DA9830D7B7A4A12B` | The DS at the .com registry (published by GoDaddy) matches Cloudflare's exactly. 1.1.1.1, 8.8.8.8 and 9.9.9.9 mark answers as validated (`ad`), and so do Google's and Cloudflare's JSON lookup services; with validation switched off (`+cd`) the mark disappears. Answers carry signatures (RRSIG), and still validate after the clean-up |

**DNS records removed** (imported by Cloudflare from GoDaddy, all created 2 November 2026)

| Type | Name | Content | Was |
|---|---|---|---|
| A | `hrizzup.com` | `15.197.148.33` | GoDaddy parking, proxied |
| A | `hrizzup.com` | `3.33.130.190` | GoDaddy parking, proxied |
| CNAME | `www.hrizzup.com` | `hrizzup.com` | Proxied |
| CNAME | `_domainconnect.hrizzup.com` | `_domainconnect.gd.domaincontrol.com` | GoDaddy's Domain Connect, proxied |
| TXT | `_dmarc.hrizzup.com` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | GoDaddy's DMARC, reports to GoDaddy |

- **Result:** the zone holds no records (Cloudflare's API: count 0), and Cloudflare's nameservers no longer answer for the apex, `www`, `_dmarc` or GoDaddy's `_domainconnect`.
- **Still answering, on purpose:** a TXT at `_domainconnect.hrizzup.com` pointing to `api.cloudflare.com/client/v4/dns/domainconnect`. This is Cloudflare's own Domain Connect pointer, published because Cloudflare is now the DNS provider. It isn't a record in the zone and can't be deleted through the records API.
- **Backup:** the zone file was exported before deleting. The table above is the lasting record.
- **Email and website records** come in later stages (runbook Parts 3 and 9).

**Zone settings**

| Setting | Before | After (read back from Cloudflare's API) |
|---|---|---|
| SSL/TLS mode | Full | **Full (strict)** |
| Always Use HTTPS | Off | **On** |
| Minimum TLS version | 1.0 | **1.2** |
| TLS 1.3 | On | On (unchanged) |
| Automatic HTTPS Rewrites | On | On (unchanged) |

These apply to names that run through Cloudflare (the media addresses). The app's own names will point at Vercel, DNS only, and Vercel handles their HTTPS.

**The API token's permissions**

The token is a user API token: active, **no expiry date**, and it can see only the `hrizzup.com` zone. Cloudflare doesn't let a token read its own permission list, so it was tested with read-only requests, plus two "create" requests with deliberately invalid input, so nothing could be created.

| Needed (step 2.5) | Result |
|---|---|
| DNS: edit | Works (read, and the five deletions above) |
| Zone settings: edit | Works (read, and the changes above) |
| R2: edit | Works (listing works; a create with an invalid name got a name error, not a permission error) |
| Turnstile: edit | Works (listing works; a create with no fields got a missing-field error, not a permission error) |

| Should not be allowed | Result |
|---|---|
| Account members, billing, API tokens, Workers KV, Images, Stream, Registrar, load balancers, WAF rules, IP access rules, SSL certificate packs | Refused |
| Zero Trust Access | No answer either way (Access isn't switched on in the account) |
| **Workers scripts (listing)** | **Allowed.** Cloudflare's API reference says this needs a Workers Scripts or Workers Tail permission |
| **Workers routes on the zone (listing)** | **Allowed.** Needs a Workers Routes permission |
| **Page Rules (listing)** | **Allowed.** Probably a Page Rules permission |
| **Email Routing settings (reading)** | **Allowed.** Possibly covered by zone settings; not confirmed |
| Account details (reading) | Allowed. Possibly an Account Settings permission; not confirmed |

**Open:** the token has more than it needs, at least Workers Scripts and Workers Routes access. The founder trims it to the five rows in runbook step 2.5; editing a token's permissions keeps its value, so nothing changes in Doppler. Claude Code then runs this check again.

**Documents updated:** runbook step 2.5 (the exact permission rows, saved straight into Doppler) and step 2.6 (what the check covers, marked done apart from the token clean-up), and Part 2's "Done when" line. Blueprint section 4 now covers the empty zone, the HTTPS settings and the token's scope.

---

## 3 November 2026

### Doppler stays on the free plan during staging (founder's decision)

- **Decision:** the Doppler workplace `zugzwang-world` stays on the free **Developer** plan during staging. The upgrade to **Team**, which was runbook step 4.1, is now step 10.1, the first step of Part 10, "Production twin". The founder's reason: the Team plan's roles let him keep production keys to himself once helpers use Doppler.
- **What the two plans include** (Doppler's [pricing page](https://www.doppler.com/pricing) and [project permissions](https://docs.doppler.com/docs/project-permissions) docs, read 3 November 2026):

  | | Developer (now) | Team (step 10.1) |
  |---|---|---|
  | Price | Free for 3 users, then $8 a month for each extra user | $21 per user a month |
  | Syncs to other platforms | 5 (staging needs 2: `stg` to Vercel staging, `stg_preview` to Vercel previews) | 100 |
  | Roles (who can open which environment) | None. Doppler's docs say role-based access needs the Team or Enterprise plan | Yes, including roles limited to chosen environments |

  The pricing page also shows "25" users for Developer in its comparison table, which disagrees with "Free for 3 users" on the same page. It doesn't matter yet: only the founder uses the workplace.
- **Added so the decision stays safe (Claude Code):** because the free plan has no roles, any member could open every config, including Claude Code's setup keys in `dev` and the workplace's other projects. So:
  - until the upgrade, only the founder and Claude Code use Doppler;
  - if a helper needs Doppler before Part 10, step 10.1 is done at that moment;
  - helpers get the Collaborator role on Development and Staging, and no access to Production;
  - before the first helper joins, Claude Code moves its own setup keys (such as `CLOUDFLARE_API_TOKEN`) out of `dev` into their own environment, which helpers can't open.
- **Not checked:** the workplace's current plan. The command-line tool doesn't show it; the founder's instruction says it stays on Developer. This replaces the "Not checked" note in the 2 November Doppler entry.
- **Renumbered:** Part 10's steps moved down by one. The old 10.1 (Cloudflare Pro) is now 10.2, and so on, up to the old 10.11 (side-by-side comparison), now 10.12. Entries above this one use the old numbers.

### Cloudflare key: reminder to trim it (Claude Code)

- **Reminder added** to runbook Part 2, just above its "Done when" line: the founder trims the key to the five permission rows in step 2.5, with step-by-step clicks. Step 2.6 now points to it.
- **Checked again today, with read-only requests through `doppler run`** (the key was never printed): the key is unchanged. The five needed areas work (DNS, zone settings, R2, Turnstile, plus checking the key itself), and these extra areas still answer: Workers scripts, Workers routes on the zone, Page Rules, Email Routing settings and account details.
- **Still open:** the founder trims the key; Claude Code then runs the full check from 2 November again and removes the reminder.

**Documents updated:**
- **Runbook:**
  - Part 2: the reminder;
  - Part 4: the free plan in "What we're doing", and step 4.1 marked as moved;
  - Part 10: the new step 10.1, the renumbering, and "What we're doing" and "Done when";
  - Production hardening: Claude Code's access to `prd` is removed through Doppler's roles.
- **Blueprint:** section 2 (the Doppler row, and Doppler joins Cloudflare as a free plan during staging), section 7 (plan and access), section 15 (order of setup) and the status line.
- **CLAUDE.md:** one line, so Claude Code keeps helpers out of Doppler until the Team plan is on.
- **Status:** `docs/status/product.md`.

### Proton verification record (runbook 3.2, first record, Claude Code)

Added through Cloudflare's API, using the Cloudflare key through `doppler run` (never printed). The zone was empty before.

| Type | Name | Value | Proxy | TTL | Cloudflare comment |
|---|---|---|---|---|---|
| TXT | `@` (`hrizzup.com`) | `protonmail-verification=2f53d9a65aef17a994867e4edd0bf55e0156725e` | DNS only | Auto | Proton domain verification (runbook 3.2) |

- **The value isn't secret:** it only proves to Proton that we control the domain.
- **How it was checked:**
  - Cloudflare's two nameservers (`joyce` and `kevin`) and the public resolvers 1.1.1.1, 8.8.8.8 and 9.9.9.9 all return the record, minutes after it was added;
  - the answers are DNSSEC-signed (the `ad` flag from 1.1.1.1 and 8.8.8.8, and `AD: true` from Google's DNS-over-HTTPS service).
- **Next (runbook 3.3):** the founder clicks verify in Proton. Proton's other records (two MX, SPF, three DKIM and DMARC) come next, in step 3.2.

**Documents updated:** runbook step 3.2 (marked as started) and `docs/status/product.md`.

### Resend sending domain `mail.hrizzup.com` (runbook 3.5 and 3.6)

**Step 3.5 (founder):** a full-access Resend key, "Claude Code setup – hrizzup", saved straight into Doppler `dev` as `RESEND_SETUP_API_KEY`.

**Step 3.6 (Claude Code):** all through Resend's API, using that key through `doppler run`. No key was ever printed. Done between about 03:28 and 03:33 India time (2 November, 21:58 to 22:03 UTC).

**The domain**

| Setting | Value |
|---|---|
| Domain | `mail.hrizzup.com` (Resend ID `22086da6-b151-4f79-97e6-848d24df774b`) |
| Region | `ap-northeast-1` (Tokyo). Resend offers four regions: `us-east-1`, `eu-west-1`, `sa-east-1` and `ap-northeast-1`. Tokyo is the closest to India, and also the fastest from the founder's Mac: about 0.14 s to connect to Tokyo's sending service, against 0.15 s for Ireland, 0.22 s for US East and 0.33 s for São Paulo |
| Sending / receiving | Sending on; receiving off |
| Open and click tracking | Off, so links in sign-in emails are never rewritten |
| Encryption to receiving servers | Opportunistic TLS (Resend's default: always tries an encrypted connection) |
| Bounce address | `send.mail.hrizzup.com` (Resend's default) |
| Status | **Verified**, about 20 seconds after verification started |

**DNS records added to Cloudflare** (all DNS only, TTL auto; each carries a Cloudflare comment naming runbook 3.6). The values are exactly as Resend returned them, and none is secret: the DKIM value is a public key.

| Resend's label | Type | Name | Value |
|---|---|---|---|
| DKIM | TXT | `resend._domainkey.mail` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD4VzM6mZAi3nwAVmpeirawdzJ7TkYkj3A29hp03PnBTXFbBLS3LcwXB2rvmlgDVFIwyMsZxw3/q4orWSU891wZexY6/4HA7xODsHEmw13CusQiB9w+qB+9Ls5qGhcVB9JJDr+T9Mmu242k31lWKIZ5dzQttNqTtHWDtsFeuzy7AwIDAQAB` |
| SPF (bounces) | MX | `send.mail` | `feedback-smtp.ap-northeast-1.amazonses.com`, priority 10 |
| SPF | TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` |
| SPF | CNAME | `rsend.mail` | `send.forge.rmta.net` |

- **The fourth record** (the CNAME) isn't in the example in Resend's documentation. It was added exactly as returned, and Resend verified it with the others.
- **How it was checked:**
  - Cloudflare's nameserver and the public resolvers 1.1.1.1, 8.8.8.8 and 9.9.9.9 return all four records;
  - the answers are DNSSEC-signed;
  - Resend shows all four records, and the domain, as verified.

**Staging key**

- **The key:** "Hrizzup staging (sending only, mail.hrizzup.com)", Resend ID `330e75e5-6d7e-4321-9765-44930086c1f0`. It can only send email, and only from `mail.hrizzup.com`.
- **Where it is:** Doppler `stg`, as `RESEND_API_KEY`. It was piped from Resend's answer straight into Doppler and never shown. `stg_preview` inherits it, because it's a branch of `stg`, so previews send with the staging key.
- **How it was checked:**
  - the name appears in `stg` and `stg_preview` (names only);
  - when asked to list domains with this key, Resend refuses with "This API key is restricted to only send emails", which shows the key is valid and sending-only;
  - no email was sent (that's step 3.7).
- **Production key:** not created. It comes in Part 10 (new steps 10.10 and 10.11).

**Setup key deleted**

- **Resend:** "Claude Code setup – hrizzup" (ID `5441aa15-b476-4228-aca3-850aee73f34b`, created 2 November 2026 at 21:55 UTC), identified by its name and creation time, then deleted through the API. Afterwards Resend answers "API key is invalid" to it.
- **Doppler:** `RESEND_SETUP_API_KEY` deleted from `dev`, after the key was dead in Resend, so any copy in Doppler's history is useless.
- **Doppler now holds:**
  - `dev`: `CLOUDFLARE_API_TOKEN`;
  - `stg`: `RESEND_API_KEY` (and `stg_preview` through inheritance);
  - `prd`: nothing.

**Left alone in the same Resend account** (from Zugzwang World): the domain `mail.zugzwangworld.com` (verified, `eu-west-1`) and an API key named "Onboarding" (created 14 May 2026, last used 26 October 2026). They aren't Hrizzup's; the founder decides whether to keep them.

**Next:** step 3.7, a test email from `no-reply@mail.hrizzup.com`, sent with the staging key. DMARC can only pass once the DMARC record from step 3.2 is in.

**Documents updated:**
- **Runbook:**
  - step 3.5 done, with the key going straight into Doppler;
  - step 3.6 done: the Tokyo region, tracking off, and one staging key, with the production key moved to Part 10;
  - step 3.7 now names the staging key and the DMARC dependency;
  - step 4.3 no longer mentions the Resend setup key;
  - Part 10: the new step 10.10 (a temporary setup key) and step 10.11 (it now also creates the production key). The old 10.10 to 10.12 are now 10.11 to 10.13.
- **Blueprint:** sections 4 and 8.
- **Status:** `docs/status/product.md`.

---

## Rules for this log

- It records every account, plan, region and setting configured for Hrizzup, on the day it is set. Add each new day above this section, newest day last.
- How each one *should* be set up is in [setup/BLUEPRINT.md](setup/BLUEPRINT.md); the steps are in [setup/RUNBOOK.md](setup/RUNBOOK.md).
- **No secrets, ever.** Record a secret's *name* and the Doppler config that holds it, never its value.
- Record DNS records both when they are added and when they are removed.
