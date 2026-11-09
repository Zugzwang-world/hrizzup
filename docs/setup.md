# Hrizzup: setup log

## Setup close-out (4 November 2026)

**Setup is closed.** PLAN.md Phase 0 is complete, and runbook Parts 0 to 10 are finished; Part 11 leaves the founder one step (pointing each Claude project at its brief). Staging works end to end, production is a quiet twin with nothing public, and everything still open is parked in one place: the runbook's pre-launch checklist. The log of how each piece was set up follows, day by day.

### What exists, and where

| What | Where | Notes |
|---|---|---|
| Code, settings and records | [github.com/Zugzwang-world/hrizzup](https://github.com/Zugzwang-world/hrizzup), private, in the founder's account (GitHub Pro) | Ruleset `main`: four required checks (Secret check, Quick checks, Database check, Screen check), squash merges only, no force-push or deletion. Ruleset `staging`: only the Staging workflow moves `staging`. Milestones for Phases 0 (closed) to 5 |
| Website, staging | `staging.hrizzup.com`: Vercel project `hrizzup` (Pro team), functions in Mumbai (`bom1`) | Built once per merge, after that merge's migrations (Staging workflow); behind a Vercel login |
| Website, previews | A Vercel preview link on every pull request | Complete working copies: staging's data and keys (`stg_preview`), Turnstile's test keys, Google sign-in through staging's relay |
| Website, production | `hrizzup.com` (`www` redirects to it) | The holding page with draft privacy and terms, promoted once (3 November 2026). Every merge makes a hidden production build; only the release pipeline changes what's live |
| Database and sign-in, staging | Supabase `hrizzup-staging` (`mlccgqxtqmllwbyjfzzm`), Mumbai, Micro, Postgres 17, Pro organisation | Data API off, every table locked by row-level security, encrypted connections only, legacy keys off; Google sign-in and 8-digit email codes; settings in `infra/supabase/` |
| Redis, staging | Upstash `hrizzup-staging`, AWS Mumbai, Fixed 1GB | Eviction on, auto-upgrade off, encrypted connections only (`infra/upstash/check.py`) |
| Storage | Cloudflare R2, Asia-Pacific: `hrizzup-staging-uploads` and `hrizzup-staging-media` (`media-staging.hrizzup.com`); production's `hrizzup-uploads` and `hrizzup-media` (`media.hrizzup.com`) | `r2.dev` off; CORS and lifecycle rules in `infra/cloudflare/r2/`; image transformations for our own images only |
| Domain, DNS, bot protection | Cloudflare zone `hrizzup.com`, Free plan, DNSSEC end to end | Full (strict), TLS 1.2 minimum; Turnstile widget "Hrizzup staging" |
| Email | Proton on `hrizzup.com` (`hrishikesh@hrizzup.com`; DMARC reports to Cloudflare's DMARC Management); Resend's sending domain `mail.hrizzup.com`, Tokyo region | Sign-in codes come from `no-reply@mail.hrizzup.com` |
| Google sign-in | Google Cloud project `hrizzup` (`hrizzup-513610`), owned by the Hrizzup Google account; consent screen in Testing; client "Hrizzup staging" | Production's own project comes with P.0 |
| Secrets | Doppler, free Developer plan: project `hrizzup` (`dev`, `stg`, `stg_preview`, `prd`) and `hrizzup-tools` (`claude`) | `stg` syncs to Vercel's staging, `stg_preview` to previews. Claude Code uses four service tokens kept in this Mac's keychain, none of which can open `prd`; no personal login is saved on this Mac |
| Automation | GitHub Actions: Checks, Secret check, App journeys, Staging, Release (started by hand), Reminders (daily), Tool cache (after a merge that can change a pin, Mondays, by hand). Environments `hrizzup-staging` and `hrizzup-production` (`main` only) | The release pipeline's environment holds no token yet (P.0) |
| Codebase | `product/web` (Next.js website), `product/app` (empty Expo app), `product/packages` (shared code), `infra/` (migrations and service settings) | pnpm 11, Turborepo with Vercel's Remote Cache, Biome, TypeScript 6, Vitest, Playwright, Supabase CLI |
| Plan and rules | `PLAN.md`, `CLAUDE.md`, `docs/setup/` (blueprint, runbook, retirement list), `docs/status/`, `docs/brief/` | The three briefs are the thinking projects' only knowledge from the repo, rewritten at the end of every session. A daily routine to catch a missed one is ready in `infra/claude/` but off (founder's decision) |

**One known difference, by the founder's choice:** staging's Supabase project stays connected to the GitHub repo, with deploys and branching off, so it does nothing (blueprint section 5).

### Parked until launch

Everything still open is in the runbook's [pre-launch checklist](setup/RUNBOOK.md#pre-launch-checklist), started about 3 weeks before launch:

- **P.0, first: production's own values** (the founder's checklist in runbook Part 10, steps 0 to K), then the release pipeline's first run (step 10.5);
- **P.1 to P.11, the lean twin's extras and final decisions:** point-in-time recovery, Cloudflare Pro, Upstash's Fixed plan, Google publishing with the custom sign-in address, analytics, spending limits, trimming Claude Code's Cloudflare key, CAA records, the legal pages' gaps, link previews, and the AI-crawler decision;
- **P.12** two-step login on Upstash, and **P.13** the sign-in email inbox check (runbook step 3.7);
- also before launch: production's hourly email limit, a separate GitHub account for Claude Code, and the production hardening check.

### Outside setup

- **Moved into PLAN.md's Phase 1, numbers unchanged:** the developer accounts (step 0.4), the hand-over agreement (0.7), and the Grok subscription with the bots' inbox (0.8). The performance-budget check joined step 1.5.
- **Later, with the team** (runbook): the helpers' GitHub invitations, Doppler's Team plan, Sentry, PostHog, RevenueCat and Razorpay, Cloudflare Stream.
- **Automatic reminders** (`.github/reminders.json`): replace Claude Code's Supabase and Vercel tokens, due 15 January 2027.
- **Zugzwang World leftovers:** in the retirement list, [setup/RETIREMENT.md](setup/RETIREMENT.md).

---

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

### Proton's mail records and DMARC (runbook 3.2, Claude Code)

Added through Cloudflare's API, using the Cloudflare key through `doppler run` (never printed). The values are exactly as the founder pasted them from Proton; none is secret. All records are DNS only, TTL auto, and each carries a Cloudflare comment naming runbook 3.2.

| Type | Name | Value | Priority |
|---|---|---|---|
| MX | `@` | `mail.protonmail.ch` | 10 |
| MX | `@` | `mailsec.protonmail.ch` | 20 |
| TXT | `@` | `v=spf1 include:_spf.protonmail.ch ~all` | |
| CNAME | `protonmail._domainkey` | `protonmail.domainkey.dvaglryndy3a2l6vxccr2a4aeydxg4plxi7ivvdgjuenwai47zywa.domains.proton.ch` | |
| CNAME | `protonmail2._domainkey` | `protonmail2.domainkey.dvaglryndy3a2l6vxccr2a4aeydxg4plxi7ivvdgjuenwai47zywa.domains.proton.ch` | |
| CNAME | `protonmail3._domainkey` | `protonmail3.domainkey.dvaglryndy3a2l6vxccr2a4aeydxg4plxi7ivvdgjuenwai47zywa.domains.proton.ch` | |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine` | |

- **How it was checked:**
  - Cloudflare's nameserver `joyce` and the public resolvers 1.1.1.1, 8.8.8.8 and 9.9.9.9 all return every record, about 15 seconds after they were added;
  - the answers are DNSSEC-signed;
  - the first DKIM record follows through to Proton's public signing key.
- **Proton's second and third DKIM slots** currently hold no key on Proton's side (Proton answers with an empty result). That is expected: Proton keeps them for future key rotation. Our records point at them, so a rotation needs no change here.
- **The `@` TXT records:** `hrizzup.com` now has two, Proton's verification record and this SPF record. There's one SPF record per name: Resend's sits on `send.mail.hrizzup.com`, separately.
- **DMARC:**
  - the policy covers `hrizzup.com` and its subdomains, including Resend's `mail.hrizzup.com`. Resend's mail passes it through relaxed alignment, which is checked in step 3.7;
  - it has no reports address yet, because the Proton addresses don't exist yet. Step 3.3 now ends with the founder choosing one, and Claude Code adding it to the record.
- **The zone now holds 12 records:** these 7, Proton's verification TXT, and Resend's 4.

**Documents updated:**
- **Runbook:**
  - step 3.2 done;
  - step 3.3 now ends with choosing the DMARC reports address;
  - step 3.7 no longer waits for DMARC.
- **Blueprint:** section 4 (DMARC reports address).
- **Status:** `docs/status/product.md`.

### DMARC reports through Cloudflare's DMARC Management (founder's decision)

- **The founder turned on DMARC Management** for `hrizzup.com` in Cloudflare's dashboard. It collects the DMARC reports that receiving mail services send, and shows who sends mail in hrizzup.com's name. No personal reports address is needed.
- **What it changed:** Cloudflare edited our `_dmarc` record at 22:10 UTC on 2 November (03:40 India time on 3 November), adding its reports address. There is still exactly one DMARC record, as there must be:

  | Type | Name | Value |
  |---|---|---|
  | TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:19d28cf72d49415dbe619c22c3a8f4fc@dmarc-reports.cloudflare.net;` |

- **How it was checked:** Cloudflare's API shows one `_dmarc` record. Cloudflare's nameserver and 1.1.1.1, 8.8.8.8 and 9.9.9.9 all return the value above. There is no separate record for `mail.hrizzup.com`, so this policy covers Resend's mail too.
- **Side effect:** the edit removed the Cloudflare comment we had put on that record. The record itself is right, so it was left as Cloudflare set it.

### Test email (runbook 3.7, Claude Code): delivered, but into Spam

- **Sent:** through Resend's API with `RESEND_API_KEY` from Doppler `stg` (through `doppler run`, never printed).
  - **From and to:** `Hrizzup <no-reply@mail.hrizzup.com>` to `hrishikesh@hrizzup.com`.
  - **Subject:** "Hrizzup staging test email (runbook 3.7) 2026-11-03 03:41 IST".
  - **When:** 22:11 UTC on 2 November (03:41 India time on 3 November), a minute after the DMARC edit above.
  - **Resend's ID:** `01a19e50-ef85-7b01-ad66-3a8c508219cd`. Resend accepted it.
- **Result so far:** the founder reports it arrived, but in **Spam**, not the inbox. The step's goal (inbox, with DMARC passing) is **not met yet**.
- **Still to do:**
  - read the email's headers (the founder copies them from Proton) to see whether SPF, DKIM and DMARC passed and why Proton chose Spam;
  - fix the cause, send again, and record the result here.

**Documents updated:**
- **Runbook:**
  - step 3.3 now says DMARC reports go to Cloudflare's DMARC Management;
  - step 3.7 is marked as started, with the email delivered into Spam.
- **Blueprint:** sections 4 and 8.
- **Status:** `docs/status/product.md`.

### Supabase staging project `hrizzup-staging` (runbook Part 5)

**Created by the founder** in Supabase's dashboard (steps 5.1 and 5.3). **Checked and connected by Claude Code** (steps 5.4 and 5.5), using `SUPABASE_ACCESS_TOKEN` (Doppler `dev`) and the database password through `doppler run`.

**The project, as Supabase's API reports it**

| Setting | Founder's description | Found | Match |
|---|---|---|---|
| Name and reference | `hrizzup-staging` | `hrizzup-staging`, reference `mlccgqxtqmllwbyjfzzm`, created 07:04 UTC on 3 November 2026, healthy | Yes |
| Organisation | Pro | Organisation `ricebmnezbfuolqartfi`. The token can't read organisations, by design, so the plan isn't shown; Micro compute is the Pro plan's included size (the free plan uses Nano) | Yes, indirectly |
| Region | Mumbai | `ap-south-1`; pooler `aws-0-ap-south-1.pooler.supabase.com` | Yes |
| Compute | Micro | Micro (`ci_micro`: 2 shared cores, 1 GB memory, 60 direct and 200 pooler connections) | Yes |
| Postgres | Standard | Postgres 17.11 (`17.11.0.011`, engine `17`, GA channel); the OrioleDB engine isn't installed | Yes |
| Data API | Off | No schemas exposed. Requests get no data, even with the secret key ("Could not query the database for the schema cache") | Yes |
| Automatic row-level security | On | **Not in effect in the database.** No event trigger does it, and a test table created with SQL inside a transaction (then rolled back, so nothing was left behind) had row-level security off | **No**, see below |
| GitHub | Not linked | No branches. The GitHub connection itself isn't visible to this token | Yes, as far as visible |
| Point-in-time recovery | Production only | Off; one daily backup completed at 07:09 UTC | Yes |

**The token:** it sees only `hrizzup-staging`, and its organisation list is empty, which matches "full access to `hrizzup-staging` only, no account or organisation access". The founder says it expires in 90 days, so around **1 February 2027**. The runbook carries a reminder to replace it.

**Mistake, and how it was fixed**

- **What happened:** one check printed Supabase's full answer for the Data API settings. That answer includes the project's legacy signing secret (`jwt_secret`), so the secret appeared in the Claude Code session. It is not in any file or commit.
- **Fixed within minutes:**
  - the two legacy API keys (`anon` and `service_role`), which depend on that secret, were switched off;
  - the secret itself was revoked;
  - the project signs with its ES256 key pair, which was already in use, so nothing else changed.
- **Checked:**
  - a token forged with the exposed secret is refused ("token signature is invalid");
  - the old legacy key is refused;
  - the new secret key still works.
- **From now on:** checks print only fields chosen in advance, never a whole answer.

**Database password:** it was in Doppler `dev`, not `stg` as described. It was copied to `stg` as `SUPABASE_DB_PASSWORD` without being shown, checked to match exactly (by comparison, not by printing), and removed from `dev`.

**Stored in Doppler `stg`** (never shown; names only):

| Name | What it is |
|---|---|
| `DATABASE_URL` | Pooler, transaction mode, port 6543, user `postgres.mlccgqxtqmllwbyjfzzm`, database `postgres`. The password is percent-encoded, which it needed, and checked by parsing it back |
| `DATABASE_URL_SESSION` | The same, in session mode, port 5432, for migrations |
| `SUPABASE_URL` | `https://mlccgqxtqmllwbyjfzzm.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | The new-style publishable key (`default`), safe in the app and browser, for Realtime |
| `SUPABASE_SECRET_KEY` | The new-style secret key (`default`), for the server only |
| `SUPABASE_DB_PASSWORD` | Moved here from `dev` (above) |

`stg_preview` inherits all of them, so previews use the staging database. Doppler `dev` now holds `CLOUDFLARE_API_TOKEN` and `SUPABASE_ACCESS_TOKEN`.

**Connection tests** (from the founder's Mac, through `doppler run`, with the certificate checked in full against Supabase's certificate authority):

| | `DATABASE_URL` (6543) | `DATABASE_URL_SESSION` (5432) |
|---|---|---|
| Connects | Yes (0.42 s including the connection) | Yes (0.15 s) |
| Postgres version | 17.11 | 17.11 |
| User and database | `postgres` / `postgres` | `postgres` / `postgres` |
| Pooler mode, proven | **Transaction:** a second client got the same database worker while the first sat idle | **Session:** the second client got its own worker; the first kept its own |
| Unencrypted connection | Refused (after the change below) | Refused |

- **Region:** shown by Supabase's API (`ap-south-1`) and the pooler's name. A database connection doesn't report its region by itself.
- **Certificate authority:** "Supabase Root 2021 CA", valid until 26 April 2031, SHA-256 fingerprint `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

**Changed by Claude Code** (security settings on from day one, blueprint rule 7):
- **Encrypted connections enforced** (`ssl-enforcement`: database on). Before, unencrypted connections were allowed. Encrypted ones still work through both addresses; unencrypted ones are refused.
- **Legacy API keys off, and the legacy signing secret revoked** (above).

**Seen and left as they are:**
- Network access open to all addresses (Vercel has no fixed addresses).
- Extensions: `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault` and `uuid-ossp` (Supabase's defaults).
- `max_connections` 60, `statement_timeout` 2 minutes for `postgres`, `wal_level` logical (needed by Realtime), time zone UTC.

**Automatic row-level security, what happens next:** the database doesn't switch it on by itself, so the **first migration** in the repo will add an event trigger that does, with a check on every pull request that no table lacks it. That migration comes with the codebase and its migration tool (PLAN.md step 1.5), before any table exists. Until then the database has no tables of ours, and the Data API is off, so nothing is exposed.

**Not checked:** the spend cap and usage alerts (step 5.2) are organisation settings, which the token can't read. The founder confirms them.

**Decisions recorded (founder's):**
- staging stays on Micro and is enlarged before any load test;
- point-in-time recovery is for production only;
- the reasons for Data API off and automatic row-level security on;
- the token's 90-day life, with a reminder;
- the migrations rule, and never using the Supabase token or any database key against production.

**Documents updated:**
- **Runbook:**
  - Part 5 rewritten as it was done: steps 5.1 to 5.5, the reasons, the load-test rule, the token reminder and "Done when";
  - Part 10's introduction and step 10.3: production sized for launch, point-in-time recovery there only, and the password straight into Doppler `prd`.
- **Blueprint:** section 5 rewritten: settings, compute, the reasons, row-level security, the connection settings table, migrations, keys, network and backups.
- **CLAUDE.md:** a new "Database changes" section.
- **Status:** `docs/status/product.md`.

### Founder's answers on the Supabase report (founder's decisions)

1. **Production is off-limits to Claude Code**, stricter than the rule recorded earlier today. Claude Code never reads, holds or uses production keys, and production is changed only by the release pipeline, which gets its own production credentials in Part 10. Written into CLAUDE.md (new section), PLAN.md section 3, blueprint section 3 (a new subsection, with a table of where Claude Code's tools could still reach production and how each is closed), and sections 5, 6, 7 and 15. The runbook changes are:
   - "How to use";
   - Part 10, rewritten: the founder creates every production service and key, the release pipeline does the connecting, migrating and promoting, and a new step 10.12 gives the pipeline its own credentials;
   - "Releasing to production" and "Production hardening".
   Two consequences were written in too:
   - **Doppler:** Claude Code uses the founder's own Doppler login on this Mac, which can open `prd`. So step 10.1 gives Claude Code its own service account with no access to Production, and signs the founder's login out of this Mac, before the first production key goes in. `prd` is empty until then.
   - **The holding page** on `hrizzup.com` (step 9.4) is the one change Claude Code makes on the production side, and it's made before production has any keys or data. This is marked as the single exception.
   Still open, for before Part 10: Claude Code works through the founder's GitHub account and merges its own pull requests. The recommended fix is a separate GitHub account for Claude Code, with the founder's approval needed for changes to the pipeline's files.
2. **Supabase spend cap stays on during staging,** and is turned off in step 10.3, when production joins the organisation. Runbook step 5.2 and blueprint section 5 changed to match.
3. **Reminder to replace the Supabase token:** a cloud routine was tried first and refused, because Anthropic's cloud has no access to this private repo. Set up instead inside the repo, which needs no extra access:
   - `.github/workflows/reminders.yml` runs daily at 10:00 India time;
   - `.github/reminders.json` holds the reminders;
   - `.github/scripts/reminders.py` opens a GitHub issue once for each reminder whose date has arrived, and GitHub notifies the founder.
   The first reminder is "Replace the Supabase access token before 1 February 2027", due **15 January 2027**. Tested locally: it lists the reminder as not yet due.
4. **Locking tables approved** for PLAN.md step 1.5: a first migration that switches row-level security on for every new table, plus a check on every pull request that fails if any table is unprotected. Written into PLAN.md step 1.5 and CLAUDE.md.

### Storage and bot protection (runbook Part 6, Claude Code)

All through Cloudflare's API with `CLOUDFLARE_API_TOKEN` (Doppler `dev`, through `doppler run`, never printed). **The key had every permission these steps needed**, so nothing had to be worked around.

**Buckets** (account `4ddce98b4a4cbc9146d4269f36b03f68`):

| Bucket | Location | Storage class | Public access | Created (UTC) |
|---|---|---|---|---|
| `hrizzup-staging-uploads` | Asia-Pacific (`apac`) | Standard | None: no custom domain, `r2.dev` address off | 3 November 2026, 07:31 |
| `hrizzup-staging-media` | Asia-Pacific (`apac`) | Standard | Only through `media-staging.hrizzup.com`; `r2.dev` address off | 3 November 2026, 07:31 |

The account also holds five buckets from Zugzwang World (`zugzwang-market-media`, `zugzwang-pfp`, `zugzwang-staging-pfp`, `zugzwang-staging-uploads` and `zugzwang-uploads`), left alone.

**Public address:**
- `media-staging.hrizzup.com` is connected to the media bucket, with minimum TLS 1.2.
- Cloudflare created the DNS record itself: CNAME `media-staging` to `public.r2.dev`, **proxied**, marked read-only and managed by R2. It has to be proxied, because the media addresses are the ones that run through Cloudflare (blueprint section 4).
- Ownership and certificate are both active. The certificate is from Google Trust Services, valid until 1 February 2027, and Cloudflare renews it automatically.
- A missing file answers 404, served from Cloudflare's Mumbai edge.

**Image transformations:** zone setting `transformations` changed from off to **on** (it also shows as `image_resizing: on`, not `open`). Requests to resize an image from another site are refused: HTTP 403, with Cloudflare's `cf-not-resized` header. So only our own images can be resized.

**Rules kept in the repo and applied** (`infra/cloudflare/r2/`, applied with `apply.sh staging`, which reads each rule back and checks it matches the repo exactly):

| Bucket | CORS (browsers) | Lifecycle |
|---|---|---|
| `hrizzup-staging-uploads` | `PUT` only, `content-type` header, `ETag` exposed, from `https://staging.hrizzup.com` and `http://localhost:3000`; preflight cached for an hour | Incomplete uploads aborted after 1 day; raw uploads deleted 1 day after upload |
| `hrizzup-staging-media` | `GET` and `HEAD` from the same two sites; cached for a day | Incomplete uploads aborted after 1 day; media never deleted by a rule |

- **Checked from the outside:**
  - an upload preflight from staging and from localhost is allowed, and from any other site is refused (403);
  - a read preflight on the uploads bucket is refused;
  - an anonymous read of the uploads bucket is refused;
  - a read preflight on media from staging is allowed, and from any other site is refused.
- **Previews:** not in the upload rule yet, because preview addresses only exist once Vercel is connected. Runbook step 9.6 now adds them.
- **Why raw uploads are deleted after a day:** our server makes the clean copy (location data removed) straight after an upload and writes it to the media bucket (blueprint section 13). One day is a safety net if that ever fails, and it keeps photos with location data from piling up. These rules replace R2's default, which aborts incomplete uploads after 7 days.

**Turnstile:** widget "Hrizzup staging" created at 07:33 UTC:
- Managed mode, hostnames `staging.hrizzup.com` and `localhost`, region world, no pre-clearance.
- Its keys are in Doppler `stg` as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, never shown.
- `stg_preview` overrides both with Cloudflare's official test keys: site key `1x00000000000000000000AA` (always passes, visible) and secret `1x0000000000000000000000000000000AA` (always passes). These are published by Cloudflare and aren't secrets.
- **Checked:** with Cloudflare's dummy token, the staging secret answers "invalid-input-response" (the secret is real, and the fake token is rightly refused), and the preview secret answers "success".

**Non-secret storage settings, stored in Doppler `stg`** (previews inherit them):

| Name | Value |
|---|---|
| `R2_ENDPOINT` | `https://4ddce98b4a4cbc9146d4269f36b03f68.r2.cloudflarestorage.com` |
| `R2_BUCKET_UPLOADS` | `hrizzup-staging-uploads` |
| `R2_BUCKET_MEDIA` | `hrizzup-staging-media` |
| `MEDIA_BASE_URL` | `https://media-staging.hrizzup.com` |

**Waiting for the founder (step 6.3):** one R2 access key, Object Read & Write, limited to the two staging buckets, saved in Doppler `stg` as `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Then Claude Code tests an upload, a public download and a resized image (step 6.6).

**Not done, as agreed:** Cloudflare Stream is switched on when video is built.

**Documents updated:**
- **Runbook:**
  - Part 6 rewritten as it was done, with the click-by-click steps for the R2 key;
  - step 9.4 (the holding-page exception) and step 9.6 (previews join the upload rule);
  - Parts 3, 5 and 10, "How to use", "Releasing to production" and "Production hardening", for the decisions above.
- **Blueprint:** sections 3, 4, 5, 6, 7, 9, 11 and 15.
- **CLAUDE.md:** the production section, the database section, the layout line (`infra/`) and the releasing line.
- **PLAN.md:** section 3 and step 1.5.
- **New files:** `infra/cloudflare/r2/` (four rule files and `apply.sh`), plus the reminders workflow, script and file.
- **Status:** `docs/status/product.md`.

### Storage tests (runbook 6.3 and 6.6)

**The founder's R2 key (step 6.3):** an account token for both staging buckets, saved in Doppler `stg` as `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (previews inherit it through `stg_preview`). Claude Code used it only through `doppler run` and never printed it, a signature or a signed address.

**Tests (step 6.6), about 09:00 UTC,** with a generated 1600×1000 PNG (137 KB) under a random name in `_selftest/`:

| Test | Result |
|---|---|
| Browser-style upload: a signed upload address valid for 5 minutes, `PUT` from `https://staging.hrizzup.com` | 200. Cloudflare answered `Access-Control-Allow-Origin: https://staging.hrizzup.com` and exposed `ETag` |
| The server reads the raw upload back (as the cleaning step will) | 200, identical byte for byte |
| The server writes the copy to the media bucket | 200 |
| Public download from `media-staging.hrizzup.com` | 200, identical bytes. First a cache miss, then a cache hit |
| Resized copy from `/cdn-cgi/image/width=640,format=auto/…` | 640×400. AVIF, 2.2 KB, for browsers that accept AVIF; WebP, 3.5 KB, for the others. First request a cache miss (1.75 s), then cache hits from Mumbai (0.11 s and 0.08 s, `Age` 3 s and 6 s). Cloudflare keeps one cached copy per format (`Vary: accept`) |
| The key reaches only our two buckets | It lists the staging buckets (200). It is refused for a bucket outside its scope (`zugzwang-uploads`, 403 AccessDenied) and for listing all buckets (403) |
| Raw uploads have no public address | `uploads-staging.hrizzup.com` doesn't exist |
| Clean-up | The test files were deleted from both buckets (204, then 404). Cached copies under their random names are linked from nowhere and drop out of Cloudflare's cache by themselves. Claude Code's Cloudflare key has no cache-purge permission, by design |

**Correction:** in the first run, the resized-image cache check looked for Cloudflare's cache header with the wrong capitalisation and saw nothing. A second, focused run read it correctly (the results above).

Part 6 is now done, apart from Cloudflare Stream, which waits for creator video.

### Doppler tidied: setup keys in their own project, `dev` follows staging (runbook 4.5, Claude Code)

**Founder's request:** each place holds one kind of key. Claude Code's setup keys leave the app's project, and `dev` becomes the place for running the app on this Mac, with staging's values by reference, not by copy.

**New project `hrizzup-tools`** for Claude Code's setup keys:
- One environment, "Claude Code", with one config, `claude`. Doppler's empty default environments in the new project (`dev`, `stg`, `prd`) were deleted, so there's nothing else to confuse. The `hrizzup` project's configs were not touched, apart from `dev` below.
- **Moved from `hrizzup/dev`:** `CLOUDFLARE_API_TOKEN` and `SUPABASE_ACCESS_TOKEN`:
  - copied through stdin, never shown, and checked identical by comparing fingerprints in memory;
  - both tested from the new place: the Cloudflare key sees `hrizzup.com` as active, and the Supabase token sees only `hrizzup-staging`, healthy;
  - the repo's storage rules were re-applied through it (`apply.sh staging`: all four match);
  - only then deleted from `dev`.
- **Added:** `CLOUDFLARE_ACCOUNT_ID` (`4ddce98b4a4cbc9146d4269f36b03f68`) and `CLOUDFLARE_ZONE_ID` (`da46254f6736da51ef130e7bc927efd6`). These are identifiers, not secrets; having them there lets `apply.sh` run with nothing typed by hand.
- **Used only as** `doppler run --project hrizzup-tools --config claude -- <command>`.
- **Old copies:** `dev`'s history may still show the two keys. The free plan keeps 3 days of activity logs, and only the founder and Claude Code can open Doppler. Runbook step 10.1 now replaces both keys before the first helper joins.

**`hrizzup/dev` now follows staging:**
- **References first tested** with a value that isn't secret (`MEDIA_BASE_URL`): the reference `${stg.MEDIA_BASE_URL}` resolved on the free plan, and the test value was deleted. Doppler's docs say references between configs need a paid plan, but its pricing page lists secret references on the free Developer plan, and they work. References between projects aren't used.
- `dev` holds 15 references, one per staging value, each exactly `${stg.NAME}`: `DATABASE_URL`, `DATABASE_URL_SESSION`, `MEDIA_BASE_URL`, `R2_ACCESS_KEY_ID`, `R2_BUCKET_MEDIA`, `R2_BUCKET_UPLOADS`, `R2_ENDPOINT`, `R2_SECRET_ACCESS_KEY`, `RESEND_API_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_URL`, `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY`. No copied values and no setup keys.
- **Kept in step by** `infra/doppler/dev_follows_staging.py`:
  - `apply` adds missing references, turns any other value back into a reference and deletes stale ones;
  - `check` reports;
  - both print names only;
  - local-only values are listed in `infra/doppler/dev-overrides.txt`, which is empty for now;
  - the script fails if anything in `dev` points at `prd` or at another project.
- **`doppler.yaml`** in the repo makes `hrizzup/dev` the default here, and this folder was set up with it (`doppler setup`). A plain `doppler run` in the repo now injects `hrizzup/dev`, with no setup keys.

**Checked:**
- `dev_follows_staging.py check`: OK (15 references, no overrides, nothing stale, nothing pointing at production).
- **A local run through `dev`** receives all 15 values, resolved and identical to staging's (compared by fingerprint), and neither setup key. With them it:
  - connects to the staging database through both pooler addresses with full certificate checks (Postgres 17.11);
  - gets 200 from Supabase's sign-in service with the publishable key;
  - has its Turnstile secret accepted by Cloudflare;
  - gets 401 from Resend when listing domains, as a sending-only key should;
  - lists both staging buckets with the R2 key.
- **Action Required:** the `dev` and `stg` pages in Doppler's dashboard, viewed after the tidy-up, each show "Active (15)" and no Action Required section. `prd` was not opened.

**Doppler workplace:** 4 of the free plan's 10 projects are in use: `hrizzup`, `hrizzup-tools`, and two from May 2026, `example-project` and `zugzwang-experiment`.

**Documents updated:**
- **CLAUDE.md:** "Environments and secrets".
- **Runbook:**
  - new step 4.5 and "How `dev` keeps following staging";
  - steps 2.5, 3.5, 4.2, 4.3, 5.3 and 10.1, and the Supabase token reminder;
  - steps 6.3 and 6.6 marked done.
- **Blueprint:** sections 2 (Doppler), 3 (environments table and the Doppler row), 4 (the Cloudflare key, the R2 key, resized-image caching), 5 (keys), 7 (rewritten for the two projects) and 8.
- **Reminder** in `.github/reminders.json`: points at `hrizzup-tools`.
- **`infra/cloudflare/r2/`:** `apply.sh` and `README.md` say how staging is applied.
- **New files:** `infra/doppler/` (the script, the overrides list and a README) and `doppler.yaml`.
- **Status:** `docs/status/product.md`.

### Redis: Upstash staging database `hrizzup-staging` (runbook Part 7)

**Created by the founder** (steps 7.1 and 7.2): Fixed plan, AWS Mumbai, with its keys saved in Doppler `stg` as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (09:30 UTC, per Doppler's activity log). The founder also deleted Zugzwang World's Upstash database, so the Upstash account now holds only `hrizzup-staging`.

**Checked by Claude Code, about 09:35 to 09:45 UTC,** in three ways:
- through the database itself, with the REST keys through `doppler run` (never printed). Only fields chosen in advance were printed, after listing the field names first;
- from the outside, without the token;
- in Upstash's console, through the founder's browser login, on the staging database only. The page was read from screenshots, and the password and token were never revealed.

| Setting | Found | How it was checked |
|---|---|---|
| Name and address | `hrizzup-staging`, at `rare-sole-111677.upstash.io` | Console; REST address |
| Plan and size | **Fixed 1GB**: 1 GB of data (1,073,741,824 bytes), up to 10,000 commands a second and 30,000 connections. Upstash's price list: $20 a month, with 100 GB of traffic a month and no per-command charges | Console; `INFO` (`max_data_size`, `max_ops_per_sec`, `maxclients`) |
| Region | AWS Mumbai, `ap-south-1`. Primary copy `ap-south-1-r4`, standby copy `ap-south-1-r2`, both in Mumbai. No read regions elsewhere. Database type "Global" (Upstash's current type, here with one region) | Console; `INFO` (`all_members`, `primary_member`); all four of the address's IPs are in AWS's published ranges for `ap-south-1` (EC2) |
| Software | Compatible with Redis 8.4.0; Upstash 1.19.4; standalone (no cluster) | `INFO` |
| Encrypted connections only | **Yes.** Plain-text Redis on port 6379 gets no answer (the server closes the connection). Port 80 (plain HTTP) isn't open. HTTPS without the token gets 401. TLS 1.0 and 1.1 are refused on ports 443 and 6379 (a "protocol version" alert); TLS 1.2 and 1.3 work. Certificate `*.upstash.io` from Let's Encrypt, valid until 11 January 2027, renewed by Upstash. Upstash's docs say TLS is always on and can't be switched off | From the outside, without the token |
| Address list | Open to all addresses (the default) | Console. Vercel has no fixed addresses |
| Eviction | Was **off** (`noeviction`). **Turned on** by Claude Code; `INFO` now reports `optimistic-volatile` | Console switch, then `INFO` read again |
| Auto-upgrade | Was **on**. **Turned off** by Claude Code (below) | Console switch, then the page reloaded |
| Prod Pack | Not active | Console |
| Stored keys | None | `INFO`, `DBSIZE` |

**Eviction, the recommendation applied:** Upstash offers a single eviction behaviour, "optimistic-volatile": when the database is full, it removes keys at random, taking keys with an expiry first. With eviction off, a full database refuses every write, so caches, rate limits and locks would all fail together, and the site with them. With it on, a full database only loses entries that are rebuilt from the main database. That's safe under the new rules: every key has an expiry, and Redis never holds the only copy of anything that matters (blueprint section 14). The other professional option, a second database with eviction off for locks and counters, costs a second plan per environment; it's worth revisiting only if the database ever nears 1 GB.

**Auto-upgrade, turned off on staging:** on the Fixed plan, auto-upgrade moves the database to the next tier (Fixed 5GB, $100 a month) when a limit is reached. With it off, Upstash blocks traffic once the month's 100 GB is used, and blocks writes when storage is full (which eviction now prevents). For staging that's the spending cap CLAUDE.md asks of every paid service: a runaway load test is stopped, not billed. Production keeps it on (runbook step 10.8), so a limit never takes the live site offline. Supabase's spend cap is split the same way.

**Round trip from the founder's Mac.** This Mac's internet exits in Mumbai (Cloudflare's `colo=BOM`, `loc=IN`). Upstash doesn't answer ICMP ping, so the timing was done over HTTPS:

| Measured | First run (n=60) | Second run, 09:40 UTC (n=100) |
|---|---|---|
| Network round trip (opening a connection) | median 8.1 ms (6.7 to 37.3) | median 7.5 ms (6.5 to 46.6) |
| One command on an open connection | median **7.6 ms**, 95% under 12.3 ms | median **7.2 ms**, 95% under 20.7 ms |
| First command on a new connection (connection, encryption, command) | median 40.9 ms | median 40.8 ms |
| 10 commands as 10 separate trips, against one pipeline | 72 ms against 7.2 ms | 125 ms against 7.1 ms |

- The old database took about 135 ms, because it was in the wrong region; this one takes about 8.
- Batching is the biggest single saving: one trip instead of ten.

**From Vercel's Mumbai servers (explained, not yet measured):** Vercel's `bom1` runs in AWS `ap-south-1` (Vercel's region list), the same AWS region as the database. The network part of each trip drops from about 7 ms to about a millisecond, so a command should take about 1 to 3 ms, plus a few more for a fresh server instance's first command, which also sets up encryption. Runbook step 9.6 now measures it once staging runs on Vercel.

**Write test:** one pipeline request wrote a test key under `stg:selftest:` with a 60-second expiry, read it back, read its expiry (60), deleted it and confirmed it was gone. The database was empty again afterwards.

**Doppler (project `hrizzup`):**
- **`dev` references:** `dev_follows_staging.py apply` added `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as `${stg.NAME}`. A local run through `dev` reached the database with them.
- **New: `REDIS_KEY_PREFIX`,** the environment that starts every Redis key (not a secret). Previews and local runs share staging's database, so each place gets its own value:
  - `stg`: `stg`;
  - `stg_preview`: `pre` (an override);
  - `dev`: `dev`, its own value, listed in `infra/doppler/dev-overrides.txt` (its first entry);
  - `prd`: `prd`, added by the founder in runbook step 10.8.
- **Checked:** `dev_follows_staging.py check` reports OK: 17 references to `stg`, 1 local override, nothing stale, nothing pointing at production.
- **The `hrizzup` project's description** still said "all secrets (configs dev, preview, stg, prd)". It now says it holds the app's keys only, and that Claude Code's setup keys are in `hrizzup-tools`.

**Doppler workplace:**
- **`example-project`** (Doppler's sample) was **already deleted** when this step started: the activity log shows it deleted at 09:18 UTC through the founder's account (Claude Code uses the same login, so the log can't say which of the two). Nothing was left to delete. The workplace now uses 3 of the free plan's 10 projects: `hrizzup`, `hrizzup-tools` and `zugzwang-experiment`.
- **`zugzwang-experiment`** is kept until Zugzwang World is retired:
  - its configs `stg` (44 secrets) and `prd` (39) each hold `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Only names were read, nothing was changed, and nothing from its `prd` was used;
  - **the keys are dead:** run through its `stg` config, a check printing only the outcome found that the old address no longer exists in DNS;
  - recorded in the new retirement list, `docs/setup/RETIREMENT.md`. There wasn't a list before, only a note in the product status file. The new list also carries the Resend and R2 leftovers.

**New check in the repo: `infra/upstash/check.py`.** It does by script what was done by hand above, so staging can be re-checked at any time, and the release pipeline can check production the same way (runbook step 10.14) without Claude Code holding production's keys. It covers:
- region, size and eviction;
- encrypted-only connections;
- that every stored key starts with an allowed environment and has an expiry;
- round-trip time.

It prints chosen facts only, never the token. Run on staging at 09:44 UTC: **all checks pass.**
- **Proven to catch problems:** two deliberately wrong keys were planted, one without an environment prefix and one without an expiry. The check failed and named both. They were then deleted, and the database was empty again.
- **Key names kept out of production's logs** (after an automatic security review of the pull request): on production, a key that breaks a rule is shown only as its environment label (or `?`) and a short fingerprint, never its name, because a bad key might hold an ID and the pipeline's output is logged. Tested by running the check in production mode against staging's database with the two planted keys: they showed as `?:…#6ca42ac3` and `stg:…#2ee890c3`. Staging still shows the names, since it has no real users.

**Correction:** the first check of old TLS versions used the `openssl` command and reported TLS 1.0 and 1.1 as refused. A control test against a server that does accept TLS 1.1 then showed that this Mac's `openssl` command can't offer TLS 1.1 at all, so that first result proved nothing. Redone in Python, which can offer it (the control server accepted): Upstash refused TLS 1.0 and 1.1 with a "protocol version" alert on both ports. That method is the one in `check.py`.

**Seen, for the founder:** Upstash's database page lists recommended security steps, including "MFA Requirement", all unticked. Two-step login on the Upstash account is the founder's check in runbook step 0.2.

**Documents updated:**
- **Runbook:**
  - Part 7 rewritten as it was done (steps 7.1 to 7.5), with why eviction is on, why auto-upgrade is off on staging, and what to check before a big load test;
  - step 9.6: measure the Redis round trip from Vercel's Mumbai functions;
  - Part 10: the introduction (billing limits differ on purpose), step 10.8 (production's Redis settings and `REDIS_KEY_PREFIX`) and step 10.14 (the pipeline runs `check.py production`).
- **Blueprint:**
  - rule 9 points at the retirement list;
  - section 2: Upstash is on Fixed 1GB for staging and production;
  - section 3: a Redis row in the environments table;
  - section 14: a new subsection, "Redis (Upstash)", with the settings, why eviction is on, the four rules, the keys and the round-trip times.
- **CLAUDE.md:** the Redis rules under "Performance and caching", and where the retirement list lives.
- **New files:** `infra/upstash/check.py` and its README, and `docs/setup/RETIREMENT.md`.
- **Changed:** `infra/doppler/dev-overrides.txt` and the README in that folder.
- **Status:** `docs/status/product.md`.

### Sign-in: Google on Supabase Auth, and Supabase's emails through Resend (runbook Part 8)

**Decided by the founder:** sign-in for the website and the app runs on Supabase Auth. Google first; Apple and email codes before the iPhone build; the app's native Google and Apple sign-in, including the Android client and its fingerprint, come with the app builds. Written into PLAN.md (section 2, step 1.6, section 7) and blueprint section 9.

**The founder's steps (8.1 to 8.4),** as reported:

| Setting | Value |
|---|---|
| Google Cloud project | `hrizzup`, ID `hrizzup-513610`, owned by the **Hrizzup Google account** (`hrishikesh@hrizzup.com`), not the Zugzwang World one |
| Billing | Not reported. Google sign-in works without it |
| Consent screen | External, Testing, test users added; authorised domains `hrizzup.com` and `mlccgqxtqmllwbyjfzzm.supabase.co`; the three basic scopes (`openid`, `email`, `profile`). No home page or privacy-policy link yet (they wait for the holding page; step 10.16) |
| Web client | "Hrizzup staging", Web application, with the origins and redirect address Claude Code gave |
| Keys | Doppler `stg`: `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. `stg_preview` inherits them. *(Updated in Part 9, 3 November 2026: previews now have Google sign-in, through staging's signed relay; no preview address is in Supabase's allow list. See "Hosting" below.)* |

**The Google client, checked from the outside** (no Google login, nothing printed):
- **ID and secret:** Google's token service was sent a deliberately fake code. With the real ID and secret it answered `invalid_grant` (client accepted, only the code is wrong); a control with a wrong secret got `invalid_client`.
- **Redirect address:** with our client and staging's callback (`https://mlccgqxtqmllwbyjfzzm.supabase.co/auth/v1/callback`), Google opens its normal sign-in page (`/v3/signin/identifier`). Controls: a wrong callback and an unknown client both land on Google's error page (`/signin/oauth/error`).
- **Not visible from outside:** the client's JavaScript origins and the consent screen itself; recorded on the founder's word.

**Supabase Auth on `hrizzup-staging` (8.5 and 8.6, Claude Code):** applied through Supabase's Management API with the Supabase token from `hrizzup-tools` and the app's keys from `hrizzup/stg`, both through `doppler run`, never printed. The settings now live in the repo, in the new folder `infra/supabase/auth/` (`settings.json`, the email template, and `apply.py`, which applies them and reads them back).

| Setting | Before | After |
|---|---|---|
| Site address | `http://localhost:3000` | `https://staging.hrizzup.com` |
| Redirects allowed | None | `https://staging.hrizzup.com/**` and `http://localhost:3000/**` only |
| Google | Off | **On**, with the client from Doppler `stg`; nonce check on; an email address required |
| Email sign-in | On (Supabase's default) | On, for email codes |
| Email sender | Supabase's built-in sender (only reaches the project's team; 2 emails an hour) | **Resend's SMTP:** `smtp.resend.com`, port 465 (encrypted from the start), user `resend`, password `RESEND_API_KEY` from `stg`, from `Hrizzup <no-reply@mail.hrizzup.com>` |
| Emails an hour, whole project | 2 | 30 (Supabase's starting limit for custom email) |
| Emails to the same address | At most one a minute | Unchanged, now written in the repo |
| Code-request and verification limits | 30 each (Supabase's defaults) | Unchanged, now written in the repo |
| Code | 8 digits, valid 1 hour | 8 digits, valid **10 minutes** |
| Sign-up, sign-in and password-reset emails | A link to click; subjects "Confirm your email address", "Your sign-in link" and "Reset your password" | **The code only,** with no links, images or tracking; subject "Your Hrizzup sign-in code" for all three, so every way of asking for a code gets the same email |
| Email-change email (sent to the old and the new address) | A link to click | The code only; subject "Confirm your Hrizzup email change" |
| Password rules | At least 6 characters; leaked-password check off | At least **12** characters, and passwords known from data leaks refused (see "Passwords" below) |
| Turnstile in Supabase Auth | Off (hCaptcha selected, no key) | **On:** Turnstile, with the staging widget's secret (`TURNSTILE_SECRET_KEY` from `stg`) |
| Sign-in methods on | Email only | Email and Google only (`apply.py` fails if anything else is ever on) |

- **Read back:** `apply.py staging --check` reports that Supabase matches the repo: 32 settings, plus the 4 secrets.
- **Found:** Supabase doesn't return secrets as stored. It returns an HMAC-SHA256 fingerprint keyed with the project ID (found by trying common methods in memory; the Google client ID comes back as stored). `apply.py` compares secrets that way, so it can confirm them without printing anything.
- **The script's safeguards, each tested:**
  - a deliberately wrong Google secret is caught;
  - the previews' config (Cloudflare's Turnstile test keys) is refused;
  - another project's address in `SUPABASE_URL` is refused, so one environment's keys can't land in the other;
  - production is refused until its project exists;
  - any other way to sign in left on in Supabase (another provider, SAML, passkeys, custom OAuth, Supabase as an OAuth server) fails the check;
  - an email whose stated expiry doesn't match the code's life is refused.
- **Claude Code's Supabase token can't reach production:** it lists only `hrizzup-staging` and no organisations, and another project's sign-in settings answer 404.

**Checked from the outside:**
- **Public sign-in settings:** email and Google on, nothing else; sign-ups allowed.
- **"Sign in with Google":** Supabase sends the browser to Google with our client, staging's callback, the scopes `email profile`, and the code flow.
- **Allowed redirects** (through Supabase's verify address, which uses the same check, with a fake code): addresses on staging and `localhost:3000` are honoured. `https://evil.example`, the look-alike `https://staging.hrizzup.com.evil.example`, `http://localhost:4000` and `https://hrizzup.com` all fall back to `https://staging.hrizzup.com`.
- **Bot check:** a code request with the public (publishable) key and no Turnstile answer is refused: 400, `captcha_failed`, "no captcha_token found".
- **An email through Resend:** a code request made with the server key, which Supabase lets past the bot check, for Resend's test address `delivered@resend.dev` (it accepts mail without affecting our sending reputation): 200 in 2.8 seconds, and Supabase recorded the email as sent. Supabase's built-in sender only delivers to the project's team, so this send could only have gone through Resend. The test user was then deleted; staging has no users.
- **Not checked:** the email in a real inbox, and Supabase's own logs of the send. The old logs endpoint now answers "410 Gone", and the new one's query format isn't documented. The email shows in Resend's dashboard (Emails), and Claude Code can send a test code to the founder's address on request.
- **Signing in end to end** waits for the website on Vercel: added to runbook step 9.6.

**AI review (the change is labelled risky, because it touches login):** a review of the change found ten points. Fixed:
- the password-reset and email-change emails still carried links (above);
- production's hourly email limit is now set per environment, so it can be raised before launch;
- the script's error messages, its check for other sign-in methods, the expiry check, and the order of its checks were tightened.

Not a problem: the worry that Claude Code could run the script on production. Its token can't reach any project but staging (above), and production's settings are applied only by the release pipeline.

**Passwords:** Supabase has no switch that turns passwords off while email codes are on, so someone who controls an email address could also give it a password. It can't be used to take over anyone else's account, because an account needs its emailed code confirmed first. So the password rules are strict for now, and password sign-in is blocked fully with Supabase's password hook (a small database function) once migrations exist (PLAN.md step 1.5; status file).

**Doppler (8.7):** `dev_follows_staging.py apply` added `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` to `dev` as references. `check`: OK, 19 references to `stg`, 1 local override, nothing stale, nothing pointing at production.

**Choices Claude Code made:**
- **Settings in the repo,** like the storage rules, so production gets exactly the same ones through the release pipeline. Only the addresses and keys differ.
- **Codes, not links,** in the emails: the founder chose email codes; a code works the same in the browser and in the app, and an email with no links is harder to fake and is never rewritten.
- **10 minutes,** the usual life of a sign-in code, instead of Supabase's hour. The 8 digits are Supabase's default and harder to guess than 6.
- **Turnstile on now:** the blueprint already says every route that can send email is protected by Turnstile, and Supabase's own advice for custom email says the same. Google sign-in isn't affected. The website's email-code screen will show the widget.
- **Supabase keeps copies** of the Google secret, the Resend key and the Turnstile secret. Whenever one changes in Doppler, `apply.py` is run the same day (CLAUDE.md and blueprint section 7).

**Checked for Part 10:**
- **Supabase's Custom Domain add-on:** $10 a month per project ($0.0137 an hour, billed by the hour), on a paid plan ([Supabase: Manage Custom Domain usage](https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains)).
- **Google's branding:** Google verifies the branding only once every authorised domain is verified in Search Console ([Google: brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)). A `supabase.co` address can't be verified by us, which is why the custom domain matters.
- Both points are in the new steps 10.15 and 10.16.

**Documents updated:**
- **PLAN.md:** section 2 ("Sign-in"), step 1.6, section 7, and "Last agreed".
- **Blueprint:**
  - section 2: the Google Cloud and Supabase rows;
  - section 3: the sign-in row;
  - section 7: Supabase's copies of keys;
  - section 8: emails through Resend's SMTP;
  - section 9: rewritten for Supabase Auth.
- **Runbook:**
  - Part 8 rewritten as it was done (steps 8.1 to 8.7);
  - step 9.6: sign-in end to end;
  - Part 10: steps 10.9, 10.12 and 10.14, plus the new 10.15 (the custom-domain decision) and 10.16 (branding links before publishing).
- **CLAUDE.md:** the layout line, and re-applying the sign-in settings when a copied key changes.
- **New files:** `infra/supabase/auth/` (`settings.json`, `templates/sign-in-code.html`, `templates/email-change-code.html`, `apply.py`, `README.md`).
- **Status:** `docs/status/product.md`.

### Hosting: one codebase, the Vercel project, staging, previews and the holding page (runbook Part 9, PLAN.md step 1.5)

**Asked by the founder:** do Part 9 on the Vercel Pro team "Hrizzup" (`hrizzup`), choose the technical pieces the way top teams do today, and say each choice in one line. Done through pull request [#16](https://github.com/Zugzwang-world/hrizzup/pull/16) (merged as `17c17ee`) and the records pull request after it. Vercel was changed with `VERCEL_TOKEN` from Doppler `hrizzup-tools` (config `claude`) through `doppler run`, never printed.

**Choices Claude Code made (one line each):**

| Choice | Why |
|---|---|
| **pnpm 11 workspaces** (`pnpm@11.28.9`) | Strict about undeclared packages, fast, the usual choice for TypeScript monorepos. New releases wait 3 days before they can be installed (against hijacked packages); only `supabase` and `esbuild` may run install scripts |
| **Turborepo 2.11 with Vercel's Remote Cache** | Runs only what a change affects and shares results between this Mac, GitHub's checks and Vercel's builds. GitHub signs in through OIDC, so no Vercel token is stored there |
| **Biome 2.6** | One fast tool for formatting and lint instead of ESLint plus Prettier; its recommended rules plus the Next.js and React ones |
| **TypeScript 6.0, Vitest 5, Playwright 1.64** | Current versions of the standard tools for types, unit tests and real-browser screen checks (Chromium and WebKit) |
| **Supabase CLI migrations** (plain SQL in `infra/supabase/migrations/`, timestamp order) | The same tool runs a local database, the tests (pgTAP) and the pushes to staging and, later, production. No second migration layer that could drift from the database |
| **Layout** | `product/web` (website), `product/app` (Expo app), `product/packages/core` and `tsconfig` (shared code and settings), `infra/supabase` as the package `@hrizzup/database` |
| **Next.js 16.4 (App Router), React 19.3, Tailwind 4.3; Expo SDK 58 with expo-router** | Current stable versions of the frameworks already decided (PLAN.md). The app is an empty shell (`com.hrizzup.app`) |
| **Node 24 everywhere** (`.node-version`) | Vercel's current default and an LTS version; the Mac, the checks and Vercel all use the same one |
| **Previews sign in through staging's signed relay** instead of a `vercel.app` pattern in Supabase's allow list | Anyone can create a `vercel.app` address, so a wildcard there would let a stranger's site receive sign-in codes. Google sends the browser back to staging, which forwards it only to one of our previews, with a signature that expires in 15 minutes. **This differs from the founder's instruction** (he asked for the narrowest preview pattern), for that reason |
| **Staging follows a `staging` branch**, moved only by the Staging workflow after each merge's migrations | The same order as a release: database first, then code. Vercel's staging environment can't wait for a migration when it tracks `main` itself |
| **Database connections from the website** | A small pool per function instance (2 connections, idle 20 seconds, 30-minute lifetime), with Supabase's certificate checked in full (blueprint section 5) |
| **Firewall rules in the repo** (`infra/vercel/firewall.json`) | Bot Protection challenges suspected bots; AI crawlers are logged only; per-address limits: 5 a minute on routes that send email, 20 a minute on sign-in, 60 a minute on the health page, which skips the bot challenge so checks can reach it |
| **`/api/health`** | Environment, region, commit and whether the database, Redis, storage and sign-in answer; no addresses, keys or error text |

**The founder's steps,** as reported:

| Step | Setting |
|---|---|
| 9.3 | Doppler syncs to Vercel: `stg` → Vercel's `staging` environment, `stg_preview` → Preview, as Sensitive. Production's sync waits for step 10.13 |
| 9.7 | Remote Caching on; Turborepo CLI OIDC policy **"hrizzup checks"**: provider GitHub Actions, `Zugzwang-world/hrizzup` only, any workflow and branch, audience `https://github.com/Zugzwang-world` |
| For the record | Google Cloud billing is on (free trial with prepayment; sign-in doesn't need it). Not used now: Password Protection, Preview Deployment Suffix, extra custom environments, Flat Rate CDN and Flags Explorer. Web Analytics Plus switched off; Observability Plus kept. Vercel's spending limit is **$50 a month, pausing if reached**, revisited before launch |

**The Vercel project** `hrizzup` (`prj_HKlwGJVxgagU9pAmqcmAxwupNjuD`), every setting kept in `infra/vercel/project.json` and applied with `apply.py`:

| Setting | Value |
|---|---|
| Repository | `Zugzwang-world/hrizzup`, production branch `main`, root folder `product/web` (with the files outside it included), Next.js, Node 24 |
| Functions | Mumbai (`bom1`) only, Fluid Compute |
| Production | **Auto-assign Custom Production Domains off:** every merge makes a hidden production build; it goes live only with `vercel promote` (rollback: `vercel rollback`, through the release pipeline from Part 10) |
| Staging | Custom environment `staging` (`env_1Yebj1JLZTJkWRnNoUanTgpADGwF`), follows the branch `staging`, served on `staging.hrizzup.com` |
| Skew Protection | On, 12 hours |
| Deployment protection | Standard Protection (Vercel Authentication): every preview, staging and every hidden production build's private address need a Vercel login; only `hrizzup.com` and `www` are public. Fork protection on |
| Toolbar and comments | On for previews (and staging), off on production |
| Speed Insights and Web Analytics | Off until launch (Part 10); `apply.py` fails if either is switched on |
| GitHub deployments | On, so each preview is reported to GitHub and the Screen check can find it |
| Other | Directory listing off, Vercel support can't see the source, every commit builds |
| Firewall | As in the choices above, read back after applying |

- **`apply.py --check`** (read-only, safe at any time): "matches the repo: 15 settings, git Zugzwang-world/hrizzup (production branch main), environments staging, 3 domains, firewall with 4 rules; autoAssignCustomDomains is False".

**Domains and DNS** (Cloudflare zone `hrizzup.com`, every record **DNS only**, comment "Vercel project hrizzup, DNS only (runbook 9.4)"; the zone now has 17 records):

| Record | Points to | Serves |
|---|---|---|
| `A hrizzup.com` | `216.150.1.1` and `216.150.16.1` (Vercel) | Production, the holding page |
| `CNAME www` | `7c52ddc7ea7c6215.vercel-dns-016.com` | Redirects to `hrizzup.com` (308) |
| `CNAME staging` | `7c52ddc7ea7c6215.vercel-dns-016.com` | Staging |

- Certificates: Let's Encrypt, issued by Vercel, valid to 1 February 2027 and renewed by Vercel.

**Keys and credentials** (names only):
- **`VERCEL_TOKEN`** (token "Claude Code – hrizzup", team `hrizzup` only, expires 1 February 2027) was found in Doppler `hrizzup/stg`, which syncs into every staging build. It was copied to `hrizzup-tools` (checked identical by fingerprint, in memory), tested, and deleted from `stg` **before the first sync**. Reminder issue on 15 January 2027.
- **`VERCEL_AUTOMATION_BYPASS_SECRET`** (the protection bypass for automation): Doppler `hrizzup-tools`, with a copy as a GitHub repository secret for the Screen check.
- **`AUTH_RELAY_SECRET`** (signs the previews' sign-in relay): generated straight into Doppler `stg`, so staging and every preview have it; `dev` references it (20 references).
- **`VERCEL_STAGING_DEPLOY_HOOK`:** the address of the deploy hook "Staging workflow" (builds the branch `staging`; it can't do anything else). Doppler `hrizzup-tools` and the GitHub environment `hrizzup-staging`.
- **Doppler service tokens, read-only:** `github-actions-staging` (`stg`, as `DOPPLER_TOKEN` in the environment `hrizzup-staging`) and `github-actions-preview` (`stg_preview`, as the repository secret `DOPPLER_TOKEN_PREVIEW`).
- **Deploy key** "Staging workflow" (write access, fingerprint `SHA256:nOQcLeu7UxDmfECHFxlz1v6DGBKrqrawzG6Sr48Z+1s`): the private half exists only as `STAGING_DEPLOY_KEY` in the environment `hrizzup-staging`; the local copy was deleted.
- **Repository variable** `TURBO_TEAM=hrizzup`.
- **The syncs, checked:** Vercel's staging environment and Preview each hold 21 Sensitive keys from Doppler plus Doppler's own 3 labels, and no `VERCEL_TOKEN`.

**GitHub:**
- **Ruleset "main"** now requires Secret check, Quick checks, Database check and Screen check.
- **Ruleset "staging"** lets only a deploy key create or move the branch `staging`, never by force. GitHub doesn't let a personal account's ruleset make an exception for the GitHub Actions app, hence the deploy key.
- **Environment `hrizzup-staging`** can be used only by `main`.
- **Workflows:** `checks.yml` (Quick checks, Database check, Screen check against the pull request's preview, with screenshots kept 30 days) and `staging.yml` (the Staging workflow).

**The Staging workflow** (every merge to `main`): applies new migrations to staging's database and checks that every table is locked, moves the branch `staging`, asks Vercel to build it through the deploy hook, then waits until `staging.hrizzup.com/api/health` reports that commit from `bom1` with every service answering.
- **Found:** Vercel didn't build the push that created the branch `staging`, so staging got no build. The deploy hook builds it. Triggered by hand once, it built `dpl_CVQMCn4oHF2cLY26rr6g9xLbzboi` (environment `staging`, Ready); from then on the workflow calls it.
- **Corrected the same day:** the first merge through the new workflow (`7249cb9`) built staging **twice**, 6 seconds apart: once from the push (`dpl_a3BQAGTjoVh53F3JUr4R5x8LUwts`) and once from the hook (`dpl_Bci8rLAToLV6PHVDFWBv8SRBJEga`). So Vercel does build later pushes, and the first explanation ("Vercel skips commits it already built for production") was wrong. Pushes alone can't be relied on, and both together build twice, so Vercel's own build on a push to `staging` is now **off** (`git.deploymentEnabled` in `product/web/vercel.json`) and the hook is the one way staging is built: exactly one build per merge, after its migrations.
- **Tested before relying on it,** on a temporary branch with the same setting and a temporary hook: the push built nothing in 60 seconds, and the hook built it (Ready). The branch and the temporary hook were then deleted; "Staging workflow" is the only hook.
- **Confirmed on the next merge** (`702ddb3`, pull request #18): one staging build, from the hook (`dpl_yPaSn9VaYdfN8QX4dNRzr2Ya4Bwd`, built in 16 seconds), and the workflow confirmed that staging serves it from `bom1` with every service answering. `hrizzup.com` still serves the promoted holding page (`17c17ee`) after three more merges, so production builds stay hidden until promoted.
- **First run:** applied `20261103120000_lock_every_table.sql` to staging (after a dry run), and the lock check passed.
- **The wait step, tried from this Mac:** it passes at once for the commit staging serves and fails after its time limit for one it doesn't.

**The first migration** (`20261103120000_lock_every_table.sql`): every new table in our schemas gets row-level security the moment it is created (also tables made by `CREATE TABLE AS`, `SELECT INTO`, inside `CREATE SCHEMA` and by extensions); switching it off is refused; `private.unprotected_tables()` lists any table without it.
- **Database check:** 8 tests on a fresh database, passing locally and on GitHub.
- **Staging check:** proven to fail on an unprotected table (exit 3, naming the table).

**The holding page on `hrizzup.com` (9.4),** the one production change Claude Code makes:
- the hidden production build `dpl_CCPXNJ99w2xyZC1w6E33gnCxwvhN` (commit `17c17ee`) was checked on its private address first: environment `production`, `bom1`, every service `not_configured` (production has no keys), the sign-in test page 404, no staging banner, and the private address asking for a Vercel login;
- then promoted once. `hrizzup.com/api/health` answers publicly: `production`, `bom1`, `17c17ee`. Chrome shows the holding page with the draft privacy policy and terms.
- **Bot Protection at work:** `curl` on `hrizzup.com`'s pages gets a challenge (HTTP 429, `x-vercel-mitigated: challenge`) while a real browser loads them, and the health page answers.

**The checks (9.6):**

| Check | Result |
|---|---|
| `autoAssignCustomDomains` off | Yes (`apply.py --check`, above) |
| `/api/health` on a preview | `preview`, `bom1`; database, Redis, storage and sign-in all `ok` |
| `/api/health` on staging | `staging`, `bom1`, commit `17c17ee`; all four `ok`. Without a Vercel login, staging answers 302 (to Vercel's login) |
| Redis round trip from Vercel's Mumbai functions | Warm: **2.0 to 3.3 ms** median per command on staging, 2.2 to 2.9 ms on previews (first command 3.9 to 5.9 ms). Cold start: 20 to 72 ms for the first command. From this Mac: 7.5 ms |
| Other services from Mumbai, warm | Database 5 to 8 ms; sign-in 19 to 52 ms; storage (both buckets) 180 to 245 ms |
| Google sign-in on staging | The founder signed in with his Google account on `staging.hrizzup.com/sign-in-test`; the page showed his name, email and "Google". Supabase has the user with a Google identity (email verified by Google), not a test account |
| Google sign-in on a preview | The same on `hrizzup-n6rrhosh4-hrizzup.vercel.app/sign-in-test`, through staging's relay; Supabase recorded a second session 46 seconds later |
| Signing out | Claude Code signed out on both; both stayed signed out after reloading, the other site's session was untouched until its own sign-out, and staging's database then had **no sessions left** for the user (refresh tokens gone too) |
| A sign-in return address outside our sites | Falls back to staging (Supabase's allow list) or to the sign-in test page (the website's own check, which also stops `/..//evil`-style tricks) |
| Previews in the storage upload rule | `https://hrizzup-*-hrizzup.vercel.app` added to both staging buckets' CORS rules and applied. A preview's preflight answers 204; a look-alike address is refused (403) |
| Screen check on the holding page | **58 of 58** on a pull request's preview (on GitHub) and **58 of 58** on staging (from this Mac): home, privacy, terms, not-found and the sign-in test page signed out and signed in, at 13 widths, sideways and 200% text, in Chromium and WebKit |

**Test accounts** for the screen check (staging only, so also previews): `delivered+screen-check-chromium@resend.dev` and `delivered+screen-check-webkit@resend.dev`, marked `test_account` in Supabase. Nobody can sign in to them: the check makes a session with staging's server key, and refuses any Supabase project but staging's.

**Found and fixed on the way:**
- **An open redirect:** a return path like `/..//evil.example` could have sent someone off our site after signing in. The website now checks the path after it is resolved.
- **The AI review** (the change is risky: login and database structure) found three points, all fixed before merging:
  - a dropped idle database connection could have crashed the server;
  - tables made inside `CREATE SCHEMA` or by an extension escaped the lock;
  - an unknown error code on the sign-in test page could have read a built-in property.
- **The Screen check caught a real bug on GitHub:** on a 320-pixel phone with 200% text, the Google button stuck out by 2 pixels. Fixed: its text now wraps.
- **Smaller ones:**
  - pnpm 12 couldn't be installed here, so pnpm 11;
  - a 7-day release wait blocked the current Expo and Biome releases, so the wait is 3 days;
  - Biome's migration had silently switched its recommended rules off; switched back on;
  - the local Supabase ports clashed with another project on this Mac, so ours moved to 55xxx;
  - Vercel doesn't report previews to GitHub by default; switched on;
  - Vercel's bypass-cookie request answers with redirects that a plain script can't follow, so the checks send only the bypass header.

**Not checked, or for the founder:**
- **A Google account that isn't a test user** should be refused while the consent screen is in Testing. That needs a second Google account; the founder can try it once on `staging.hrizzup.com/sign-in-test`.
- **Link previews** (WhatsApp, X, Slack): Bot Protection may challenge them. Check before launch.
- **AI crawlers** are only logged; decide before launch whether to block them.
- **The draft privacy policy and terms** have highlighted gaps for the founder (legal entity, address, contact email, Grievance Officer, retention days, courts' city).

**Documents updated:**
- **CLAUDE.md:** layout, the new "Codebase" paragraph, the preview rule ("a change is checked on its preview, never by deploying it to staging"), the rulesets, `hrizzup-tools` and GitHub's credentials, database changes, and the production rules for the Vercel token and project-wide settings.
- **Blueprint:** sections 1, 3, 4, 5, 6 (hosting, rewritten), 7, 9 (the relay, the sign-in test page, test accounts), 11 and 13 (codebase).
- **Runbook:**
  - Part 9 rewritten as done (9.1 to 9.7);
  - 6.2 (previews in the upload rule);
  - 8.1 (billing on);
  - 10.12 (the Vercel token also applies `infra/vercel/`);
  - R.3 (`apply.py --check`).
- **This log:** the Part 8 keys row (previews now have sign-in).
- **Reminders:** "Replace the Vercel token before 1 February 2027" (due 15 January 2027).
- **New folders:** `product/`, `infra/vercel/`, `infra/supabase/` (migrations, tests, checks), `.github/workflows/checks.yml` and `staging.yml`, `.github/scripts/`.
- **Status:** `docs/status/product.md`.

### Claude Code's own Doppler access: service tokens, no personal login (runbook 10.1, founder's decision)

**Asked by the founder:** stop using his personal Doppler login; use service tokens limited to `hrizzup`'s `dev`, `stg` and `stg_preview` and to `hrizzup-tools`, with write access only where needed, stored so only Claude Code's commands use them; prove `prd` can't be read; then give him the command to log his own login out of this Mac. This replaces the Team plan's service account in the old step 10.1; the Team plan now waits until a helper joins Doppler (runbook, "Later, with the team").

**The tokens** (Doppler service tokens, each named `claude-code-mac`, no expiry, created at 15:24 UTC with the founder's login; Claude Code last used that login at 15:28 UTC, to read back the tokens' creation time):

| Config | Access | Why |
|---|---|---|
| `hrizzup/dev` | Read and write | `dev_follows_staging.py` writes `dev`'s references |
| `hrizzup/stg` | Read and write | Claude Code creates and replaces staging's keys |
| `hrizzup/stg_preview` | Read only | The previews' overrides rarely change |
| `hrizzup-tools/claude` | Read and write | Claude Code stores setup values it creates |

- **Stored:** each went from Doppler's answer straight into this Mac's login keychain (service `hrizzup-doppler`, one item per config), through a pipe, never shown, never on a command line or in a file.
- **Used only through** `infra/doppler/run <config> -- <command>` (new), which gives the token to the Doppler process alone and removes it before the command starts, runs Doppler with its own empty settings folder (`~/.config/hrizzup/doppler-cli`, checked: no token in it) so no personal login is ever used, and keeps no copy of secrets on disk. `dev_follows_staging.py` reads `stg` and writes `dev` with their own tokens.

**Proof that `prd` can't be read** (`python3 infra/doppler/check_access.py`, new, run at about 15:26 UTC):

| Token | Its own config | `hrizzup/prd` and `hrizzup/prd_release` (one secret, and a full download) | Writes |
|---|---|---|---|
| `hrizzup/dev` | Reads it | Refused: HTTP 400, "This token does not have access to requested config 'prd'" (and `'prd_release'`) | — |
| `hrizzup/stg` | Reads it | Refused, the same | — |
| `hrizzup/stg_preview` | Reads it | Refused, the same | Refused: HTTP 403, "You do not have write access to this config's secrets" (an empty write, which changes nothing) |
| `hrizzup-tools/claude` | Reads it | Refused: "This token does not have access to requested project 'hrizzup'" | — |

- `prd_release` doesn't exist yet; it is the release pipeline's branch of `prd` (Part 10). The check covers it so it stays covered.
- `dev`'s references (`${stg.NAME}`) resolve with the `dev` token: `SUPABASE_URL` read through `dev` matches `stg` (compared by fingerprint).

**Everything still works through the tokens:**
- `dev_follows_staging.py check` and `apply`: OK, 20 references to `stg`, 1 local override, nothing to change;
- `infra/supabase/auth/apply.py staging --check` (tools and stg together): matches the repo, 32 settings and 4 secrets;
- `infra/vercel/apply.py --check`: matches the repo, `autoAssignCustomDomains` is False;
- `infra/upstash/check.py staging` (through dev): OK.

**The founder's login:** still saved on this Mac until he runs `doppler logout --yes` (the access check reports it). Claude Code's commands don't use it.

**Documents updated:** CLAUDE.md ("Environments and secrets"), the blueprint (section 3's Doppler row, section 7), the runbook (steps 4.1, 4.5, the note under Part 4, step 10.1, and the Team plan moved to "Later, with the team"), `doppler.yaml`, and every command line in `infra/` (READMEs and script help). **New files:** `infra/doppler/run` and `infra/doppler/check_access.py`.

### Production twin, lean: storage, the release pipeline, and the founder's checklist (runbook Part 10, founder's decisions)

**Asked by the founder ("Stage 10, lean"):** production is a quiet copy of staging, nothing public until launch, no paid extras now. Claude Code creates the pieces that hold no secret; production's secrets never pass through it; every production value is copied straight from a dashboard, with no hand-built connection strings; the release pipeline applies the database changes and the sign-in and storage settings, reading production through a Doppler token the founder saves in GitHub; one checklist for the founder; a pre-launch checklist in the runbook.

**Decided by the founder, written into the runbook, blueprint and CLAUDE.md:**

| What | Now | Before launch (runbook, pre-launch checklist) |
|---|---|---|
| Supabase `hrizzup-production` | Mumbai, Micro, Data API off, automatic row-level security on, not linked to GitHub, no point-in-time recovery; organisation spend cap stays on | Point-in-time recovery, compute sized for launch, spend cap off |
| Upstash `hrizzup-production` | Mumbai, **pay as you go**, eviction on, $10 monthly budget | Fixed 1GB with auto-upgrade on |
| Cloudflare | Free | Pro, plus Images' paid plan |
| Google sign-in | A **separate Google Cloud project**, `hrizzup-production`, in Testing, with its own web client (this settles old step 10.15's question: staging's project stays in Testing for good) | Publishing and brand verification, with the custom sign-in address (`auth.hrizzup.com`), started 3 weeks before launch |
| Doppler | Free plan; Claude Code on its own service tokens (entry above) | Team plan before any helper joins |

**Production's storage, created by Claude Code** (the founder's instruction; the one-time exception, like the holding page, before production had any keys or data), about 15:35 to 15:45 UTC, with Claude Code's Cloudflare key through `infra/doppler/run tools`:

| Setting | Value | How it was checked |
|---|---|---|
| Buckets | `hrizzup-uploads` (private) and `hrizzup-media`, Asia-Pacific (`APAC`), Standard storage, created 3 November 2026 | `apply.py production` read both back |
| `r2.dev` addresses | Off on both | Read back |
| Public address | `media.hrizzup.com` on `hrizzup-media` only, minimum TLS 1.2, ownership and certificate active about a minute after connecting; `hrizzup-uploads` has none | Read back; anonymous listing of the uploads bucket refused (400) |
| DNS record (added by R2) | CNAME `media` → `public.r2.dev`, **proxied**, read-only, managed by R2 for `hrizzup-media`. The zone now has 18 records | Cloudflare's API; public resolvers answer, DNSSEC-signed (`ad`) |
| CORS | Uploads: `PUT` with `content-type`, `ETag` exposed, from `https://hrizzup.com` and `https://www.hrizzup.com`, cached an hour. Media: `GET` and `HEAD` from the same two, cached a day (new files `uploads.cors.production.json`, `media.cors.production.json`) | Upload preflight from `hrizzup.com` and `www` 204; from `staging.hrizzup.com` and another site 403. Media preflight from `hrizzup.com` 204, another site 403 |
| Lifecycle | The same files as staging: incomplete uploads aborted after a day on both; raw uploads deleted after a day | Read back |
| Image test (one-time, before any data) | A generated 1600×1000 PNG (3.1 MB) under a random name in `_selftest/`: public download identical; resized through `/cdn-cgi/image/width=640,format=auto/` to AVIF (26.6 KB) or WebP (22.0 KB) by the browser's `Accept`; second requests served from Cloudflare's cache (`HIT`) | Then deleted (200); a fresh download answers 404 |

- **New script:** `infra/cloudflare/r2/apply.py` replaces `apply.sh`. Besides the CORS and lifecycle rules, it checks (and creates if missing) both buckets, `r2.dev` off and each bucket's public address, with `--check` to change nothing. Staging was checked with it first: matches the repo.
- **From now on** production's storage settings change only through the release pipeline, with its own R2-only Cloudflare key.

**Database addresses from the dashboard, with no hand-built strings** (new): `DATABASE_URL` and `DATABASE_URL_SESSION` are Supabase's own shared-pooler strings, copied with the `[YOUR-PASSWORD]` placeholder still in them; the code fills in `SUPABASE_DB_PASSWORD`, percent-encoded, in memory:
- the website: `product/web/lib/db.ts` (`databaseAddress`, 8 unit tests: the dashboard string, special characters round-trip, spaces and TLS options dropped, a complete address used as it is, missing values, the placeholder twice). A wrongly set address shows on the health page as `misconfigured`, never its text;
- workflows and scripts: `infra/supabase/database_url.py` (`check`, and `run session|transaction -- <command>`, which masks the address in GitHub's logs). It refuses a string that isn't Supabase's shared pooler (`*.pooler.supabase.com`), has the wrong port for its mode, or belongs to another project than `SUPABASE_URL`: each tried and refused;
- **checked on staging:** the exact strings staging's Connect dialog shows (looked at in the founder's browser: Direct → Transaction or Session pooler → "Use IPv4 connection", labelled "Shared pooler"; without that switch the dialog shows the IPv6-only dedicated pooler, which the script refuses) connected through both addresses with full certificate checks (Postgres 17.11), and `supabase db push --dry-run` through the helper answered "Remote database is up to date" without calling Supabase's API;
- the Staging workflow now uses the helper;
- **staging switched to the dashboard form, after the change merged (pull request #21, `db33a59`):** at about 16:23 UTC, Doppler `stg`'s `DATABASE_URL` and `DATABASE_URL_SESSION` were set to staging's own shared-pooler strings with `[YOUR-PASSWORD]` (values that hold no secret; the password stays only in `SUPABASE_DB_PASSWORD`), with Claude Code's `stg` token. `database_url.py check` confirms both; `dev` still follows staging (20 references). The Staging workflow, run once more by hand ([run 41673790052](https://github.com/Zugzwang-world/hrizzup/actions/runs/41673790052)), applied migrations and checked the table locks through the new values, and the staging build it made after the switch (`dpl_FNk1NSF5p8mRdGiU6KJ8KY1npgte`, which `staging.hrizzup.com` now points at) reports `bom1`, `db33a59`, and database, Redis, storage and sign-in all `ok`. Staging and production now run the same code path; changing staging's database password is now one value.

**Supabase project settings in the repo** (new `infra/supabase/project/`): each project's ID (moved here from `auth/settings.json`; `auth/apply.py` and the Screen check's test-account guard read it from here) and the settings that must match. `apply.py staging --check` on staging: name, `ap-south-1`, healthy, Postgres 17 (`17.11.0.011`), GA channel, `ci_micro`, point-in-time recovery off, no Data API schemas, network open, no branches, encrypted connections only, legacy API keys off, legacy JWT secret revoked, ES256 in use: matches the repo (15 settings). Its guards (another project's `SUPABASE_URL`; production with no ID yet) were tried and refuse.

**Key check** (new `infra/keys/check.py`): proves every key the health page doesn't use is right, without using it for real. On staging: Google client accepted and staging's callback registered; Resend key valid and sending-only; Turnstile secret accepted and not a test key; Supabase secret key reaches the admin address; public sign-in settings show only Google and email; R2 key lists staging's buckets and is refused for production's (403). Proven to catch: the previews' config fails (Cloudflare's test keys), and an unregistered callback fails.

**The release pipeline** (new `.github/workflows/release.yml`, started by hand only; runbook "Releasing to production"): reads Doppler `prd_release` through a read-only token in the GitHub environment `hrizzup-production`; checks the commit passed staging; checks production's values and keys; applies Supabase's project settings, the commit's migrations (then the lock check), the sign-in and storage settings; checks Redis and the Vercel project; finds the commit's hidden production build through Vercel's own API (with the pipeline's token, and only at an address of our project's) and requires its private health page to show production, `bom1`, the commit and every service answering, and (until launch) the holding page; then sends Vercel's promote request itself (`.github/scripts/promote.py`, the same request `vercel promote` makes, read from Vercel's command-line tool), so no downloaded tool runs next to production's keys; and waits until `hrizzup.com/api/health` shows the commit. Rollback is the same workflow with action `rollback`, only to a commit older than the live one.
- **The holding page carries `data-page="holding"`** so the pipeline can tell it apart; a build without it is refused until the "launch" box is ticked.
- **AI review (the change is risky), two findings, both fixed before merging:** a rollback with no commit named would have promoted the newest commit while skipping its database changes (now a rollback needs a commit older than the live one); and running Vercel's tool through `npx` would have downloaded unpinned packages with every production key in reach (now the pipeline sends Vercel's two requests itself). The automatic security review also flagged that GitHub's deployment records can be written by anyone with write access, so the pipeline could have sent the bypass secret to a faked address; the build is now looked up through Vercel's API and its address checked. A second review of the fixes found two more, also fixed: the rollback check read the live commit from the health page and so would have refused a rollback while production was down (it now asks Vercel which build `hrizzup.com` points at, with the health page as a fallback); and the build lookup only looked at the newest 100 production builds (Vercel now filters by commit). Both lookups were tried on staging and previews first. Smaller fixes from the same reviews: the bypass header never follows a redirect; the live-site wait allows 2 minutes for every service to answer; the key check no longer expects Google on before the sign-in settings are applied; a project with no branching passes the branches check.
- **Tried before relying on it:** the build finder's choice of build, its address guard and its holding-page check with canned answers (it picks the newest ready production build of our repo, and refuses a foreign address, an app page without "launch", previews and unfinished builds); the Vercel lookup itself on this pull request's preview; and an earlier version of the build finder against `main`'s current hidden build (`1c83e61`, `https://hrizzup-kym8ntdpm-hrizzup.vercel.app`) refused it, as it must: no production keys (every service `not_configured`) and no holding-page marker yet. Promotion itself can't be tried anywhere but production; it runs for the first time when the founder says "done".
- **GitHub environment `hrizzup-production`:** created, deployment branches `main` only, no secrets yet (the founder adds `DOPPLER_TOKEN`).
- **Why `prd_release`:** if the pipeline's Vercel, Supabase and Cloudflare tokens sat in `prd`, its sync would copy them into every production build, so any production server bug could leak the power to promote or reconfigure production. A branch of `prd` sees every production value and adds the three tokens, and has no sync.

**Found while checking the dashboards** (the founder's browser, staging only; nothing changed):
- **Staging's Supabase project is connected to the GitHub repo** (Project Settings → Integrations → GitHub: `Zugzwang-world/hrizzup`, working directory `.`), with **Deploy to production off** and **Automatic branching off**, so it does nothing today. The earlier record said "not linked (as far as visible)": the API doesn't show it. Left for the founder to decide: disconnecting matches the plan.
- **This Mac holds the founder's own command-line logins** for Supabase (a LEGACY full-access token, "cli_hrishikesh@…", that never expires; Supabase showed it last used at about 15:44 UTC. Re-run with debug output, this session's migration dry run made no calls to Supabase's API, so the use wasn't that; what it was isn't known), Vercel and Cloudflare's Wrangler. Each would reach production. Claude Code doesn't use them; the founder is advised to log them out (runbook step 10.1).

**Reminders added** (`.github/reminders.json`): check the pipeline's Supabase token (15 January 2027); replace the pipeline's Vercel and Cloudflare tokens (15 October 2027).

**Documents updated:** runbook (Part 10 rewritten with the founder's checklist; "Releasing to production"; new "Pre-launch checklist"; steps 2.1, 3.6, 4.5, 5.2, 6.2, 7's auto-upgrade note, 8.2, 8.6, 9.3 and Part 9's notes; "Production hardening"), blueprint (sections 2, 3, 4, 5, 6, 7, 9, 14 and 15), CLAUDE.md (production exceptions, `prd_release`, releasing, dashboard values, Redis, database addresses, Supabase project settings), the READMEs in `infra/cloudflare/r2/`, `infra/supabase/auth/`, `infra/upstash/`, and the new ones in `infra/supabase/project/` and `infra/keys/`.

## 4 November 2026

### Setup closed (founder's decisions)

**Decided by the founder:**
- Production's own values (runbook Part 10, his checklist, steps 0 to K) are parked as the pre-launch checklist's first item, P.0; the release pipeline's key check confirms them at launch. Some may already be in `prd`; Claude Code doesn't read `prd`.
- Also parked there: trimming Claude Code's Cloudflare key (P.7), two-step login on Upstash (P.12) and the step 3.7 inbox check (P.13).
- He deleted the LEGACY Supabase token (`cli_hrishikesh@…`).
- Staging's Supabase link to GitHub stays as it is ("not of much importance"): connected to the repo, with deploys and branching off, so it does nothing. Supabase's Management API can't change it (its published specification, 115 endpoints, has none for the GitHub connection), so it can only be switched off in the dashboard (blueprint section 5 has the clicks).
- Setup closes now: runbook Parts 1 to 9 complete, Part 10 complete except the parked values, PLAN.md Phase 0 complete, and nothing in progress in the status files.

**Checked by Claude Code:**
- **None of the founder's own logins is left on this Mac:** `python3 infra/doppler/check_access.py` reports "Personal Doppler login: none saved on this Mac", with every token still working for its own config only and none able to open `prd` or `prd_release`. No Supabase, Vercel or Wrangler login is left either: their login files and keychain entries are absent (checked by name only; nothing was read).
- **Runbook step 4.4, the names in each config** (names only, read through `infra/doppler/run`, never a value): `dev`, `stg` and `stg_preview` each hold the same 21 names (`AUTH_RELAY_SECRET`, `DATABASE_URL`, `DATABASE_URL_SESSION`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `MEDIA_BASE_URL`, `R2_ACCESS_KEY_ID`, `R2_BUCKET_MEDIA`, `R2_BUCKET_UPLOADS`, `R2_ENDPOINT`, `R2_SECRET_ACCESS_KEY`, `REDIS_KEY_PREFIX`, `RESEND_API_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_URL`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_REST_URL`): the 20 production names in runbook Part 10, plus `AUTH_RELAY_SECRET`, which only staging and previews use. `hrizzup-tools/claude` holds Claude Code's 7 setup keys (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `SUPABASE_ACCESS_TOKEN`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `VERCEL_STAGING_DEPLOY_HOOK`, `VERCEL_TOKEN`) and nothing else; none of them is in `hrizzup`.

**Moved out of setup:**
- **PLAN.md:** Phase 0 marked complete. Steps 0.4 (developer accounts), 0.7 (hand-over agreement) and 0.8 (Grok subscription and the bots' inbox) are the projects' own first work, so they moved to Phase 1 with their numbers. The performance-budget check (blueprint section 14) joined step 1.5, since it needs real pages to measure; step 0.6's daily summary routine became the daily brief refresh.
- **Runbook:** every Part marked finished. Part 2's reminder to trim the key, step 3.7, step 9.6's second-account check (now in P.4), Part 0's Upstash two-step login and Part 10's checklist moved into the pre-launch checklist (P.0, P.12 and P.13 added). The helpers' invitations (still not accepted; GitHub cancels them on 9 November 2026) moved to "Later, with the team".
- **Status files:** rewritten, so each lists only what's done, the product work next, and open product questions.
- **Reminders:** the two for the release pipeline's own tokens were removed from `.github/reminders.json`, because those tokens don't exist yet; P.0 adds them back once they do.
- **GitHub milestones** "Phase 0: Set up" (closed) to "Phase 5: Production" (open), as PLAN.md's opening note says; each points to PLAN.md section 5.

### Thinking-project briefs (founder's decision)

**Asked by the founder:** three briefs, `docs/brief/product.md`, `docs/brief/sourcing.md` and `docs/brief/news-desk.md`, each under about 1,500 words and rewritten, never appended, covering where things stand, the decisions in force, open questions, what's next, and which repository files to read for detail. They are the only repository files the Claude projects keep in their knowledge. A CLAUDE.md rule refreshes the relevant brief at the end of every session, plus a daily scheduled refresh.

- **Written:** Product (1,399 words), Sourcing (881) and News Desk (601).
- **Rules** in CLAUDE.md ("End of every session" and the new "Thinking-project briefs"): the layout, what each brief covers (so anyone can tell when one has fallen behind), and that a change to PLAN.md rewrites all three. PLAN.md section 4, step 0.5 and runbook Part 11 now point the projects at their brief instead of PLAN.md and the status files.
- **Claude projects don't refresh GitHub files by themselves:** the founder clicks **Sync now** in a project to load its newest brief (Claude's help centre, "Using the GitHub integration").
- **The daily refresh:** off for now (next entry).

### Daily brief refresh: ready, but off (founder's decision)

- **Designed** as a Claude Code cloud routine, "Hrizzup brief refresh": every day at 06:00 India time, on Sonnet 5.5, in Anthropic's Default cloud environment, with no connectors (the founder's choice, so nothing personal is in its reach) and no keys of any kind. It rewrites only the briefs that have fallen behind (CLAUDE.md's scope rule), opens one `[small]` pull request through GitHub's REST API, waits for the four required checks and merges it, and does nothing on days when every brief is current. It uses REST because the GitHub proxy of Claude's cloud refuses GitHub's GraphQL API, which `gh pr create` and auto-merge need (Claude Code documentation, "Cloud environments").
- **Not created:** Claude's cloud refused it once before and twice after the founder connected GitHub for claude.ai/code and installed the Claude GitHub App ("You don't have access to a repository this routine uses", `repo_access_denied`). The founder chose to skip it for now. The briefs are rewritten at the end of every session (CLAUDE.md).
- **Ready to switch on:** its settings and instructions are in `infra/claude/README.md`. First, claude.ai/code must list `Zugzwang-world/hrizzup` in its repository picker; then Claude Code creates the routine and records it here.
- **The Claude GitHub App** that the founder installed for it isn't used while the routine is off. Keep it for when the routine is switched on, or remove it in GitHub (Settings → Applications → Installed GitHub Apps → Claude).

---

## 8 November 2026

### Round 2: its milestone and its records (Claude Code, founder's decisions)

- **GitHub milestone "Round 2"** (number 7, open), created through GitHub's API: five relays in parallel worktrees (1: rules, decisions and tracking; 2: steps 1.5a to 1.5d; 3: step 1.7a; 4: step 1.4's first pass; 5: Sourcing's review of the agreement's first half). Every Round 2 pull request is attached to it. The phase milestones (0 closed, 1 to 5 open) are unchanged.
- **Where the founder's decisions of 8 November 2026 went:** the rules for unattended sessions (CLAUDE.md, "Unattended sessions"); steps 1.4, 1.5a to 1.5d, 1.7a and 1.7b, the new 1.8, and Sourcing's review run in the repository (PLAN.md sections 3 to 5, CLAUDE.md, `agreement/README.md`); the typed API (blueprint section 13); public staging (blueprint sections 3 and 6); no passwords (blueprint section 9, `infra/supabase/auth/README.md`); Expo and its robot token (blueprint sections 2 and 7); what comes before the first feature round (`TRACKER.md`); the Product brief's "Round 2 progress" and "For the founder" sections (CLAUDE.md, "Thinking-project briefs").

### Speed check (PLAN.md step 1.5a, Claude Code)

- **What:** a new job, **Speed check**, in `.github/workflows/checks.yml`, on every pull request. It does real work only when `turbo ls --affected` says the website or the app is touched (`.github/scripts/affected.py`, which the Screen check now uses too), and posts its numbers in one comment on the pull request, kept up to date (`.github/scripts/speed_comment.py`, `pull-requests: write`).
- **Website:** Lighthouse 13.6 (pnpm, `product/web` dev dependency, with `puppeteer-core`), mobile preset, 5 runs a page on GitHub's runner against Vercel's preview, the median of each number against the page's budget in `product/web/e2e/pages.ts`; contrast once more in the dark scheme. The budgets are blueprint section 14's, unchanged. Tolerances for timings only (load +0.25 s, busy time +50 ms, layout shift +0.01) are in `product/web/e2e/speed.ts`; sizes have none.
- **The bypass:** the job sends `VERCEL_AUTOMATION_BYPASS_SECRET` (the copy in GitHub's secrets) once, to the preview's own address, and gets Vercel's bypass cookie (`_vercel_jwt`, host-only, `HttpOnly`, `Secure`); Lighthouse runs with that cookie alone. Lighthouse 13.6 keeps cookies between runs (it clears only file systems, shader cache, service workers and cache storage: `core/config/constants.js`). Checked against staging from this Mac and on the pull request's preview: every page measured at its own address, none at Vercel's login.
- **App:** `product/app/scripts/bundle-size.ts`, through the Turborepo task `bundle-size` (cached, so main's size usually comes from the Remote Cache), compares the Android code bundle with main's checkout; the limit and its reason are in `product/app/bundle-limit.json` (2,700 KB; 2,424 KB measured).
- **Required:** not yet; it joins the "main" ruleset once it has passed steadily (recorded here when it does).

### Journey tests (PLAN.md step 1.5b, Claude Code)

- **Website:** `product/web/e2e/journeys/` runs inside the Screen check (`checks.yml`, job "Screen check"), in Chromium and WebKit. The screen check and the journeys now trade `VERCEL_AUTOMATION_BYPASS_SECRET` for Vercel's bypass cookie in `e2e/global-setup.ts` (`e2e/support/bypass.ts`); the browsers carry only the cookie. Sign-in states live in a fresh folder outside the repository and are deleted when the run ends (`e2e/support/states.ts`, `e2e/global-teardown.ts`).
- **App:** a new workflow, **App journeys** (`.github/workflows/app-journeys.yml`, job "App journeys"): on every pull request (work only when the app is affected), and on main after a merge that changes `product/app/`, `product/packages/`, the lockfile or the workflow. Maestro 2.12.1 (downloaded from its GitHub release, SHA-256 checked); Java 17 (Temurin); Gradle through `gradle/actions/setup-gradle` 6.4.1 (cache written from main only); `reactivecircus/android-emulator-runner` 2.38.0 (API 34, `google_apis`, x86_64, Pixel 7), with its booted snapshot cached; the built app cached under the hash of the app's tracked files. Every action pinned to its commit. Results and screenshots: the job's artifact `app-journeys`.
- **Required:** not yet; each joins the "main" ruleset once it has passed steadily (recorded here when it does).

### The typed API (PLAN.md step 1.5c, Claude Code)

- **Packages:** `@orpc/contract`, `@orpc/server`, `@orpc/openapi`, `@orpc/client`, `@orpc/openapi-client`, `@orpc/tanstack-query`, all exactly 1.16.1; `zod` 4.6.7; `@tanstack/react-query` 5.106.1 (the app); `json-schema-to-typescript` 16 and `@standard-schema/spec` 1.1 (the agreement); `@babel/plugin-transform-parameters` and `babel-preset-expo` (the app's Babel settings, for oRPC's client on Hermes).
- **Served at** `/api/v1/*` by `product/web/app/api/v1/[[...rest]]/route.ts` (Node, `bom1` from `vercel.json`). Headers: public reads `Cache-Control: public, max-age=0, must-revalidate`, `Vercel-CDN-Cache-Control: max-age=30, stale-while-revalidate=300`, `Vercel-Cache-Tag: health`; everything else `private, no-store`. Checked on this Mac (200, 400 for a stray input, 401 signed out, 200 with the test account's token, 404 for an unknown call) and on the pull request's preview by the API journeys.
- **Ruleset "main":** "Speed check" added to its required checks through GitHub's API on 9 November 2026 (now Secret check, Quick checks, Database check, Screen check, Speed check).

### The app's builds and staging's opening, first half (PLAN.md step 1.5d, Claude Code)

- **Expo (EAS):** the robot user `claude-code` (role Developer) in the account `hrizzups-team`, through `EXPO_TOKEN` (read from Doppler `stg` until runbook step 4.6 moves it; never shown). The app is linked to the project Expo's sign-up had made, `@hrizzups-team/hrizzup` (its ID in `product/app/app.json`, `extra.eas.projectId`, with `owner`). Build profiles in `product/app/eas.json`: `preview` (internal distribution, APK) and `development` (`expo-dev-client`, internal distribution, APK), both with `EXPO_PUBLIC_API_URL` set to staging's typed API, Node 24.21.0 and pnpm 11.28.9 on Expo's builders. Expo generated the Android signing key on the first build ("Build Credentials", kept on Expo's servers); no key passed through this Mac. Builds started with `eas-cli` 27.4.1 (`eas build --platform android --profile preview|development --non-interactive`), on the free plan.
- **Staging's protection exception, prepared:** `infra/vercel/project.json` names `staging.hrizzup.com` in `protectionExceptions`; `infra/vercel/apply.py` checks it (`--check`) and applies only it (`--staging-only`, a protection bypass of scope `alias-protection-override` on the domain's alias, through `PATCH /aliases/{id}/protection-bypass`). Applied after this merges (next entry).
- **Search engines:** `X-Robots-Tag: noindex, nofollow` on every response outside production (`product/web/next.config.ts`), on top of `robots.txt`'s refusal.
- **Ruleset "main":** "App journeys" added to its required checks through GitHub's API on 9 November 2026 (now Secret check, Quick checks, Database check, Screen check, Speed check, App journeys).

### Staging public, and the app's builds (PLAN.md step 1.5d, Claude Code)

- **Deployment Protection Exception** for `staging.hrizzup.com`, added at 02:08 on 9 November 2026, India time (20:38 UTC on 8 November), through Vercel's API with Claude Code's token (`infra/doppler/run tools -- python3 infra/vercel/apply.py --staging-only`), then `--check`: the project matches the repo, with only staging's domain public. Checked from outside with no login: staging's pages open in a browser with `X-Robots-Tag: noindex, nofollow` (Vercel's bot challenge, which browsers pass, stays on for them); a preview's address still sends a stranger to Vercel's login.
- **Firewall rules for staging's typed API** ([#51](https://github.com/Zugzwang-world/hrizzup/pull/51), [#55](https://github.com/Zugzwang-world/hrizzup/pull/55)): "Rate limit: staging's typed API" (60 requests a minute per IP) and "Staging's typed API: no bot challenge", both limited to the host `staging.hrizzup.com` and paths starting `/api/v1/`, applied at 04:27 on 9 November 2026, India time (22:57 UTC on 8 November) with `infra/doppler/run tools -- python3 infra/vercel/apply.py --staging-only`, then `--check` (the project matches the repo; the firewall has 6 rules). Checked from outside with Android's network client: staging's `GET /api/v1/health` answers 200 with its JSON (`x-vercel-cache: HIT`) and `/api/v1/me` 401 (not signed in), while a `POST` still gets the challenge (429); production's `hrizzup.com/api/v1/health` and every page still answer non-browsers with the challenge, unchanged. The first try, at 04:24, was refused by Vercel (a rule's description over its 256-character limit) and changed nothing; [#55](https://github.com/Zugzwang-world/hrizzup/pull/55) shortened it, with a test of the limit. Why: the first check after staging opened found no bot challenge on its typed API, but by the time App journeys ran, Bot Protection challenged the app's calls (429), so the app showed "can't be reached".
- **Expo builds** (free plan, internal distribution, from commit `960332d`, whose shipped app code is unchanged since): preview `eff51a2d-ce2e-47d0-acf1-8c4a32f9dc4d` (https://expo.dev/accounts/hrizzups-team/projects/hrizzup/builds/eff51a2d-ce2e-47d0-acf1-8c4a32f9dc4d), development `0be215e0-3d9f-4526-8958-1aea4a9f6773` (https://expo.dev/accounts/hrizzups-team/projects/hrizzup/builds/0be215e0-3d9f-4526-8958-1aea4a9f6773). The Android signing key ("Build Credentials", default) was generated by Expo on the first build and stays on Expo's servers. The founder installed the preview build on his Android phone and confirmed it on 9 November 2026.

### `EXPO_TOKEN` found in Doppler `stg` (checked by Claude Code)

**Found:** the founder saved Expo's robot token as `EXPO_TOKEN` in `hrizzup/stg`. It's a tool token, so its place is `hrizzup-tools/claude` (runbook Part 4, "Where each kind of key lives", now written out). Checked by name only, through Claude Code's own access; the value was never read, shown or copied:

| Where | Holds it? | How it was checked |
|---|---|---|
| Doppler `stg` | Yes | `infra/doppler/run stg`: the name reaches the command's environment, so any session can read it there |
| Doppler `stg_preview` | Yes, inherited from `stg` | `infra/doppler/run stg_preview` |
| Doppler `dev` | No | `dev_follows_staging.py check` now reports "`EXPO_TOKEN`: missing from dev". `apply` was deliberately not run, so `dev` doesn't take a reference to a key that's leaving `stg` |
| Doppler `hrizzup-tools/claude` | No | `infra/doppler/run tools` |
| Vercel's staging and preview settings | Yes: Doppler's two syncs added it as a Sensitive variable at 22:28 India time | Vercel's API through `infra/doppler/run tools`, names, targets and types only; production's entries were dropped unread |
| GitHub's secrets | No | Names of the repository's and `hrizzup-staging`'s secrets |
| GitHub check jobs | Not yet, but next: the Staging workflow (every merge to `main`) and the Screen check (every pull request that changes the website) load all of `stg` and `stg_preview` into their job's environment, masked in logs | `.github/workflows/staging.yml` and `checks.yml` (`inject-env-vars: true`); no workflow had run since 22:28 |

- **Why it matters:** the next push to any branch builds a preview with the token in its server environment, and every staging build has it too, so a token meant only for Claude Code's own commands reaches builds and check jobs.
- **Decided (Claude Code, following the runbook):** tool tokens live in `hrizzup-tools`, never in `hrizzup`; one that Doppler has already synced anywhere is replaced, not moved. The founder's clicks are runbook step 4.6: a fresh robot token straight into `hrizzup-tools`, then `EXPO_TOKEN` deleted from `stg` and the old token deleted in Expo. Afterwards Claude Code checks the names again (removing any copy Doppler's sync leaves in Vercel's staging or preview settings) and that the token is the robot's.
- **Doppler's other tokens are unchanged:** `check_access.py` reports every token working for its own config only, none able to open `prd` or `prd_release`, and no personal Doppler login on this Mac.

---

## 9 November 2026

### Runbook step 4.6 done: the Expo token in `hrizzup-tools` (the founder; checked by Claude Code)

**Done by the founder:** the Expo robot token saved as `EXPO_TOKEN` in `hrizzup-tools/claude`, and deleted from `hrizzup/stg`. A first check at 03:58 India time found nothing saved yet, since Doppler keeps edits as a draft until **Save**; the founder saved both, and the check below passed.

**Checked by Claude Code at 12:56 India time,** by name only through its own access; the token's value was never read, shown or copied:

| Where | Holds `EXPO_TOKEN`? | How it was checked |
|---|---|---|
| Doppler `hrizzup-tools/claude` | Yes | `infra/doppler/run tools` |
| Doppler `stg`, `stg_preview`, `dev` | No, and no other name with "EXPO" or "EAS" | `infra/doppler/run stg`, `stg_preview` and `dev` |
| Vercel's staging and preview settings | No: Doppler's two syncs removed their copies by themselves, so nothing was removed by hand | Vercel's API through `infra/doppler/run tools`, names only; production's entries dropped unread |
| Whose token it is | A robot (Expo's `Robot` type), role Developer, on the account `hrizzups-team`: not a person's | Expo's API asked who the token is, as `eas whoami` does; only the type, the role and the account's name printed |

- **The names check passes:** `python3 infra/doppler/dev_follows_staging.py check` reports `stg`, `stg_preview` and `dev` holding only the 21 app keys and none of `hrizzup-tools`' names, and `dev` following staging (20 references, 1 override).
- **Not checked by Claude Code:** step 5, the old token deleted in Expo, since the old value is gone from Doppler. Staging and preview builds made between 22:28 on 8 November and this morning still carry the old value in their settings; once Expo has deleted it, those copies no longer work.
- **Changed:** the app's build command reads the token from `hrizzup-tools` (`infra/doppler/run tools`, `product/README.md`). The runbook's step 4.6 now names Doppler's rows as the dashboard shows them ("Claude Code" in `hrizzup-tools`, "Staging" in `hrizzup`).
- **Then:** the Doppler names check went into the Staging workflow (its step 0) and the Screen check, which now run it before they load `stg` or `stg_preview` ([#54](https://github.com/Zugzwang-world/hrizzup/pull/54)), since `stg` holds only the app's keys.

### Round 2 closes: the agreement's first half Agreed, and the round's milestones (Claude Code, founder's decisions)

- **The hand-over agreement's first half: Agreed,** the founder approving it in News Desk's place, as it stood on `main` after [#52](https://github.com/Zugzwang-world/hrizzup/pull/52); marked in [#59](https://github.com/Zugzwang-world/hrizzup/pull/59) wherever its status shows. Product may build tables and content for its shapes from now on. Nothing was loaded into any database by this change.
- **GitHub milestones:** "Round 2" (number 7) closes once #59 merges, holding Round 2's pull requests; any still open move to "Round 3", created then for Round 3's pull requests (CLAUDE.md, "Unattended sessions", names it).
- **Pre-launch checklist:** two items from Round 2 joined it, P.14 (production's firewall rules for the app's API, through the release pipeline) and P.15 (the app's cold start timed on a real phone). Nothing was set on production.
- **Where the founder's decisions of 9 November 2026 went:** the agreement's status (`agreement/README.md`, its review's opening note); found takes in English only, and legal with the founder's legal team (PLAN.md sections 2 and 4); the market console, admins, the fee, cancels and the trade call's limits (PLAN.md section 2, steps 1.7b to 1.7d; blueprint section 13); the board's sign-in and who builds screens (PLAN.md sections 3 and 5, `TRACKER.md`); Round 3's queue (`TRACKER.md`, the Product brief).

### Round 3 opens: the founder's decisions of 9 November 2026 (Claude Code, records only)

- **Previews share staging's database, checked:** Supabase branching is off (`infra/supabase/project/settings.json` expects no branches, and `apply.py` checks it), and Doppler `stg_preview` overrides only the Turnstile keys and `REDIS_KEY_PREFIX`, so every preview reads and writes staging's database. So the founder's rule that database changes land first, each in its own pull request, applies as written (CLAUDE.md, "Database changes").
- **Pre-launch checklist:** one item joined it, P.16 (the founder's admin row on production, after his first sign-in there). Nothing was set on production or on any service.
- **GitHub:** [#60](https://github.com/Zugzwang-world/hrizzup/pull/60) is in the milestone "Round 3" (number 8), which existed already.
- **Where the decisions went:** database changes first, admins' migrations and the console's place in the design rule (CLAUDE.md); the order of work, with new step 1.9 and the changed steps 0.8, 1.1, 1.6a, 1.7b to 1.7d, 1.8 and 3.1 (PLAN.md); the markets' books, admins, the content store's tables, the console and background jobs (blueprint sections 5, 6, 9 and 13); Round 3's queue (`TRACKER.md`, the Product brief).

### The checks' downloads: pinned, cached and retried (Round 3, relay 3, Claude Code)

- **Why:** GitHub's incident on 9 November 2026, "Increased timeouts due to surge in anonymous users" (05:59 to 09:09 UTC), answered anonymous release downloads with 504 errors; signed-in requests were unaffected. Five check attempts failed downloading gitleaks or Maestro anonymously between 07:40 and 08:14 UTC ([#63](https://github.com/Zugzwang-world/hrizzup/pull/63) lists them).
- **Set:** `.github/scripts/tools.py` pins every downloaded file (gitleaks 8.30.1, Maestro 2.12.1, the Android emulator 37.2.13 build 16740729, its system image API 34 Google APIs x86_64 r14), each with its SHA-256; the Android files' SHA-1 sums match Google's published ones, gitleaks' and Maestro's SHA-256 their publishers' checksum files. New workflow **Tool cache** (`.github/workflows/tools.yml`) keeps them, Playwright's browsers, the database's Docker images and pnpm's store in GitHub's Actions cache from `main`; the checks only read it. Downloads go through GitHub's API with the job's own token and are retried after a pause.
- **Changed in App journeys:** the `android-emulator-runner` action is gone; `product/app/journeys/emulator.sh` boots the pinned emulator. Its snapshot cache key is now `emulator-snapshot-pixel_7-<emulator>-<system image>-v2`.
- **Checked:** [#63](https://github.com/Zugzwang-world/hrizzup/pull/63)'s own checks, and the Tool cache workflow's first run on `main`.

### Parallel local development: slots (PLAN.md step 1.8, part 1 of 3; Claude Code)

**What:** sessions on this Mac each claim a **slot** before running the website, the app's dev server (Metro) or the local database, so two worktrees never share a port, a container or a Redis key (`infra/slots/`, with its README; CLAUDE.md, "Parallel sessions"). Python's standard library only, like the other infrastructure tools; its tests run in Quick checks and `pnpm check`.

| Slot | Website | Metro | Database (Supabase project, port) | Redis prefix | For |
|---|---|---|---|---|---|
| 1 to 3 | `http://localhost:3101` to `3103` | 8101 to 8103 | `hrizzup-slot1` to `3`, ports 55332, 55342, 55352 (blocks 55330–55359) | `dev:slot1` to `3` | a round's relays |
| 4 | `http://localhost:3104` | 8104 | `hrizzup-slot4`, 55362 (55360–55369) | `dev:slot4` | the design chat (`claim --design`) |

**Choices made (Claude Code, unattended):**
- **Ports:** website 3100 + n, Metro 8100 + n, the database's whole block 10n above `config.toml`'s (55320–55329, still the Database check's in GitHub): no slot uses a default (3000, 8081, 55322), so an unslotted server can't land on one.
- **The register:** one file per held slot in `.git/hrizzup-slots/`, the repository's shared git folder, which every worktree sees and nothing commits; claims and releases take a lock first.
- **A gone worktree frees its slot:** gone means its folder is gone or git has dropped it (`git worktree remove` unregisters first; servers still running can leave files behind). The next claim stops what it left running (processes recognised by their start times; its database) and takes the slot. A port held by any other program puts the slot out of reach; that program is never stopped.
- **The design chat's slot:** the last one is kept for it (`claim --design`), so a round's relays can't leave it without one.
- **Docker:** Docker Desktop keeps `docker` and `docker-credential-desktop` inside the app, off the sessions' PATH (and the Supabase CLI runs `docker` itself for some commands: `supabase status` failed with "docker: command not found"). The tool puts that folder first on the PATH of everything it runs, and starts Docker Desktop if it isn't running; this Mac's shell setup is unchanged.
- **A light database:** Postgres alone (`supabase db start`, about 70 MB), the only service the Database check's tests use. The website on this Mac uses staging's services through Doppler `dev`, so nothing else is started. The slot's project name and ports reach the Supabase CLI as `SUPABASE_PROJECT_ID` and `SUPABASE_<SECTION>_<KEY>` (each name checked against the CLI 2.122.0: a bad value is refused by name, or the setting is one of its own fields), so `config.toml` is unchanged; a session's own `SUPABASE_` values (staging's, from Doppler) are kept from the CLI.
- **`pnpm test:db`** goes through the slot tool (`infra/supabase/package.json`): on this Mac it uses the worktree's slot and refuses to run without one; in GitHub (`GITHUB_ACTIONS`, passed through by Turborepo) it uses `config.toml` as before.
- **Redis:** each slot's prefix is `dev:slot<n>`, so keys stay under this Mac's `dev`; `redisKey()` in `@hrizzup/core` accepts it, and the Upstash check's prefix rule (`dev:`) holds unchanged.
- **Servers run directly** (`node_modules/.bin/next`, `…/expo`), not through `pnpm exec`, which adds two Node processes (about 170 MB) above each; Metro runs without `CI`, which would turn off its file watching and Fast Refresh.
- **Expo's own `.gitignore`** (`product/app/.gitignore`, for the `expo-env.d.ts` it writes on every start) is committed, so starting Metro leaves no stray file.

**Checked on this Mac (Apple M4, 10 cores, 24 GB; Docker Desktop's VM 8 GB):**
- **Three worktrees side by side** (this relay's, plus two scratch worktrees at the same commit, removed afterwards), each claiming its own slot, then running the website, Metro and its database: every database ran the Database check's tests (8 of 8 passed in each), every website answered on its own port with staging's services all "ok" (`/api/health`), and every Metro built the Android bundle (6.4 MB).
- **Claims:** a fourth relay claim was refused (exit 3, naming each slot's holder) while `claim --design` got slot 4; claims at the same moment never share a slot (unit test).
- **A gone worktree:** a scratch worktree removed while its slot ran (`git worktree remove --force`, which left files behind because its servers were writing) was taken by the next claim, which first stopped its website, Metro and database: nothing was left on its ports or in Docker.
- **Unslotted:** `pnpm test:db` in a worktree without a slot refused, naming `infra/slots/slot claim`; with `GITHUB_ACTIONS=true` it used `config.toml`'s project and port 55322 and passed.

**How many slots: four (three for relays, one kept for the design chat).** Measured with about 18 Claude Code processes, Chrome and another project's Supabase stack ("experiment", left alone) already running, macOS already at its "warn" memory level with 12 GB in swap before any slot started:

| Running | macOS memory level | Free memory (macOS) |
|---|---|---|
| Before any slot | warn | 44% |
| 3 slots, each with the website, Metro and its database | warn | 33% |
| 4 slots (one as the design chat) | warn | 34% |
| 4 slots, plus type checks and unit tests in two worktrees at once (24 tasks, none cached) | normal or warn, never critical | lowest 32%; every website answered within 0.25 s meanwhile |

- **An active slot costs about 1.3–1.5 GB:** the website about 0.6–0.8 GB once its pages are compiled, Metro about 0.6–0.8 GB once it has built the Android bundle (1.1 GB just after), the database about 70 MB inside Docker's VM, whose memory is set aside already. Idle, a slot shrinks to about 0.7 GB.
- **A fifth wasn't tried,** to keep the founder's Mac, and the relays running on it, away from critical memory: swap had grown to about 16 GB. Relays 5 to 9 can rely on three slots at once (wave 2's three relays fit), with the design chat's slot kept apart.

### Sign-in and uploads from every slot (PLAN.md step 1.8, part 2 of 3; Claude Code)

**Applied to staging at 16:10 India time (10:40 UTC),** with Claude Code's own keys (`infra/doppler/run tools stg -- python3 infra/supabase/auth/apply.py staging`; `infra/doppler/run tools -- python3 infra/cloudflare/r2/apply.py staging`). Both were checked first (`--check`): the only differences were these, and both read back matching the repo afterwards. Production's lists are unchanged and hold no local address.

| Where | Added |
|---|---|
| Staging's sign-in redirect list (`uri_allow_list`, `infra/supabase/auth/settings.json`) | `http://localhost:3101/**` to `http://localhost:3104/**`, beside `https://staging.hrizzup.com/**` and `http://localhost:3000/**` |
| `hrizzup-staging-uploads`' browser rule (`uploads.cors.staging.json`) and `hrizzup-staging-media`'s (`media.cors.staging.json`) | `http://localhost:3101` to `http://localhost:3104`, beside staging, `http://localhost:3000` and the previews |

**Choices made (Claude Code, unattended):**
- **Exact addresses, no pattern:** each slot's address is listed, not `http://localhost:*`, so nothing else on this Mac can be a sign-in's way back. `infra/slots/test_slots.py` fails if the two lists and the slot table drift apart, or if production's lists ever hold a local address.
- **`http://localhost:3000` stays** (the unslotted default, and Playwright's when no address is given).
- **The media bucket's reads too,** so a slot's pages can read media the way staging's do.
- **How sign-in is proven without Google:** the sign-in journey now also asks Supabase whether it will send a visitor back the way our server asked (its verify step, given a code that's no good, returns the browser to that address only if the redirect list allows it, and to staging's home otherwise). No account, key or email is involved. On a preview the way back is staging's relay, which the list already allows.
- **A new journey, uploads:** `product/web/e2e/journeys/upload.spec.ts` signs a five-minute upload address the way our server will, has the browser on one of the site's pages send a small file to staging's uploads bucket, reads the answer (the ETag the rule exposes), reads the file back and deletes it. It refuses any bucket but staging's and doesn't run against production. It also runs in the Screen check on every preview, which loads Doppler `stg_preview`'s storage keys; if the Screen check is later limited to the keys its tests use, it needs `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_UPLOADS`.
- **The website starts from a clean development build** (`slot web` removes `product/web/.next/dev` first), and servers stop as Ctrl-C would, by force only after 30 seconds. Why: in the first three-slot run, two slots' websites rebuilt on every page load, so their pages reloaded themselves hundreds of times a second (346 in 8 seconds) and four of six journeys failed in those slots. Only Next.js 16's Turbopack build cache, kept between runs (`turbopackFileSystemCacheForDev`, on by default), was to blame: switching it off cured the loop with everything else unchanged, and so did deleting `.next/dev`. A first compile from nothing takes a few seconds for this site.

**Checked on this Mac:**
- **Before applying,** from slot 1 (`http://localhost:3101`), in Chromium and WebKit: Supabase sent the visitor to staging's home instead of the slot, and the browser's upload was refused ("Failed to fetch", "Load failed"). The test account's own sign-in, which needs no redirect, passed.
- **After applying, three worktrees side by side,** each claiming its own slot at the same moment (they got 1, 2 and 3), each running the website (staging's database, Redis, storage and sign-in all "ok"), Metro (the Android bundle built) and its database (8 of 8 tests passed in each), with no page reloading itself: from every slot, in Chromium and WebKit, the test account signed in and out on the sign-in test page, Supabase returned the visitor to the slot's own address, and a browser upload reached the staging bucket and was read back (18 of 18 passed).
- **Memory meanwhile:** each slot about 1.15–1.23 GB (website and Metro) plus 69 MB for its database; macOS reported 46% free.

### The database-order check (PLAN.md step 1.8, part 3 of 3; the founder's decision of 9 November 2026; Claude Code)

**What:** the Database check's first step (`infra/supabase/migration_order.py`, Python's standard library and git) compares each pull request with `main` as it is at that moment, and fails, saying what to rename, when the pull request adds a migration whose timestamp isn't later than the newest one on `main`; renames, changes or deletes one already on `main`; adds a badly named migration, two with one timestamp or one dated more than a day ahead; or adds a migration but leaves `infra/supabase/newest-migration.txt` naming another. Its 14 tests run in Quick checks and `pnpm check`.

**Choices made (Claude Code, unattended):**
- **How it holds when `main` gains a migration after a pull request's checks have passed:** `infra/supabase/newest-migration.txt` names the newest migration on one line, and every pull request that adds a migration changes it. Once one merges, every other one changes the same line differently, so GitHub sees a conflict and won't merge it, however green its checks, until it's rebased; then the check runs again against `main`'s new newest. Pull requests without migrations never touch the line, so they never wait. The same idea as Rails' schema version line and Atlas's `atlas.sum`. A test in a real git repository shows it: the second of two migration pull requests conflicts once the first merges (`git merge-tree`), fails the check once rebased, and passes and merges cleanly once renamed.
- **Not chosen:** the ruleset's "require branches to be up to date before merging", which would hold back every pull request after every merge and re-run all its checks (the Screen and Speed checks take up to 40 minutes), and GitHub's merge queue, which would need every required check to run on its merge groups too (a larger change to the workflows), and whose availability for a repository in a personal account wasn't confirmed.
- **Required:** it's a step of "Database check", which the ruleset "main" already requires (checked through GitHub's API: Secret check, Quick checks, Database check, Screen check, Speed check and App journeys; "up to date" off), so the ruleset is unchanged.
- **A pull request branched before the lock file existed** isn't held to it unless it adds a migration (it then has to rebase anyway).
- **No migration may be dated more than a day ahead,** so none can claim the future and keep everyone else's out.

**Checked:**
- Locally against `main`: no new migrations, `20261103120000_lock_every_table.sql` the newest; a migration dated 1 November failed with "doesn't come after the newest migration on main … rename it to a later timestamp, for example …".
- **On GitHub:** a throwaway draft pull request, never merged, added `20261101000000_out_of_order_proof.sql` ([#67](https://github.com/Zugzwang-world/hrizzup/pull/67)): its Database check failed at "The database-order check (rename your migration if main has moved past it)" and skipped the rest; then it was closed and its branch deleted.

---

## Rules for this log

- It records every account, plan, region and setting configured for Hrizzup, on the day it is set. Add each new day above this section, newest day last.
- How each one *should* be set up is in [setup/BLUEPRINT.md](setup/BLUEPRINT.md); the steps are in [setup/RUNBOOK.md](setup/RUNBOOK.md).
- **No secrets, ever.** Record a secret's *name* and the Doppler config that holds it, never its value.
- Record DNS records both when they are added and when they are removed.
