# Upstash Redis checks kept in the repo

Upstash's settings (plan, region, eviction, auto-upgrade) are made in its console; this folder holds the check that confirms them, so staging and production are checked the same way. The rules it enforces are in blueprint section 14, "Redis (Upstash)".

| File | What it is |
|---|---|
| `check.py` | Confirms that a database is in Mumbai with no copies elsewhere, is the expected size, has eviction on, and accepts only encrypted connections. Checks that every stored key starts with an allowed environment prefix and has an expiry. Reports the round-trip time. Prints chosen facts only, never the token or a whole server answer. Exits 1 if anything differs from the blueprint. |

**How to run it:**

- **Staging, on this Mac:** `doppler run -- python3 infra/upstash/check.py staging`. A plain `doppler run` here uses `hrizzup/dev`, which refers to staging's keys. Allowed key prefixes: `stg`, `pre` (previews) and `dev` (this Mac), because all three share staging's database.
- **Production:** only the release pipeline runs `python3 infra/upstash/check.py production`, with its own credentials, as part of its production check (runbook step 10.14). Allowed prefix: `prd`. Claude Code never runs it against production.

**What it can't see:** auto-upgrade is a console setting with no Redis equivalent. Staging keeps it off (a limit blocks, never bills) and production keeps it on (a limit never takes the site offline). It's checked by eye in Upstash's console and recorded in `docs/setup.md`.
