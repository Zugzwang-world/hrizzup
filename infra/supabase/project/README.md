# Supabase project settings kept in the repo

Each environment's Supabase project (its name and project ID) and the project-level settings that must be the same on staging and production (blueprint section 5).

| File | What it is |
|---|---|
| `settings.json` | Each environment's project name and ID (not secret; `infra/supabase/auth/apply.py` reads the IDs from here too), what is applied, and what is checked |
| `apply.py` | Applies the settings that can drift (encrypted database connections only, the legacy API keys off, the legacy JWT secret revoked), then checks everything: name, region, health, Postgres engine and release channel, compute size, point-in-time recovery, the Data API off, network open, no branches, and a signing key pair in use. `--check` only compares. Prints chosen fields only, because some of Supabase's answers carry secrets |

**Staging** (Claude Code): `infra/doppler/run tools -- python3 infra/supabase/project/apply.py staging` (or `... staging --check`).

**Production:** only the release pipeline, with its own token (`SUPABASE_ACCESS_TOKEN` in Doppler `prd_release`, limited to `hrizzup-production`). Claude Code's token reaches only `hrizzup-staging`, so Supabase refuses it for production. Production's project ID is filled in here once the founder has created the project (runbook Part 10).

**Before launch** (runbook, pre-launch checklist): production's compute is sized for launch and point-in-time recovery is switched on; both are then set under `environments.production.checked`, so the pipeline keeps checking them.

**Not visible to the check:** whether the project is connected to GitHub in Supabase's Integrations settings (the API doesn't show it). Production is created without it. Staging's project was found connected on 3 November 2026, with deploys and branching off.
