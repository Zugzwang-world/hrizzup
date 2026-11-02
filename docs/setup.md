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

---

## Rules for this log

- It records every account, plan, region and setting configured for Hrizzup, on the day it is set. Add each new day above this section, newest day last.
- How each one *should* be set up is in [setup/BLUEPRINT.md](setup/BLUEPRINT.md); the steps are in [setup/RUNBOOK.md](setup/RUNBOOK.md).
- **No secrets, ever.** Record a secret's *name* and the Doppler config that holds it, never its value.
- Record DNS records both when they are added and when they are removed.
