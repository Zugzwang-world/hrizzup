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

---

## Rules for this log

- It records every account, plan, region and setting configured for Hrizzup, on the day it is set. Add each new day above this section, newest day last.
- How each one *should* be set up is in [setup/BLUEPRINT.md](setup/BLUEPRINT.md); the steps are in [setup/RUNBOOK.md](setup/RUNBOOK.md).
- **No secrets, ever.** Record a secret's *name* and the Doppler config that holds it, never its value.
- Record DNS records both when they are added and when they are removed.
