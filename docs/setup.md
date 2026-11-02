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
| Plan | Free | Decision pending: runbook 1.5 (GitHub Team plus the Secret Protection add-on, or not) |
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

---

## Rules for this log

- It records every account, plan, region and setting configured for Hrizzup, on the day it is set. Add each new day above this section, newest day last.
- How each one *should* be set up is in [setup/BLUEPRINT.md](setup/BLUEPRINT.md); the steps are in [setup/RUNBOOK.md](setup/RUNBOOK.md).
- **No secrets, ever.** Record a secret's *name* and the Doppler config that holds it, never its value.
- Record DNS records both when they are added and when they are removed.
