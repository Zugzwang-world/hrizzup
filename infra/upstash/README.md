# Upstash Redis checks kept in the repo

Upstash's settings (plan, region, eviction, auto-upgrade) are made in its console; this folder holds the check that confirms them, so staging and production are checked the same way. The rules it enforces are in blueprint section 14, "Redis (Upstash)".

| File | What it is |
|---|---|
| `check.py` | Confirms that a database is in Mumbai with no copies elsewhere, is the expected size, has eviction on, and accepts only encrypted connections. Checks that every stored key starts with an allowed environment prefix and has an expiry. Reports the round-trip time. Prints chosen facts only, never the token, a value or a whole server answer. A key that breaks a rule is shown as an example on staging, but on production only as its environment label (or `?`) and a short fingerprint, because that output lands in the pipeline's logs. Exits 1 if anything differs from the blueprint. |

**How to run it:**

- **Staging, on this Mac:** `infra/doppler/run dev -- python3 infra/upstash/check.py staging`. `hrizzup/dev` refers to staging's keys. Allowed key prefixes: `stg`, `pre` (previews) and `dev` (this Mac), because all three share staging's database.
- **Production:** only the release pipeline runs `python3 infra/upstash/check.py production`, with its own credentials, on every release (`.github/workflows/release.yml`, step 5). Allowed prefix: `prd`. Production is on pay as you go until launch, so its size is reported, not checked; it moves to Fixed 1GB in the runbook's pre-launch checklist, and its size is then set in `check.py`. Claude Code never runs it against production.

**What it can't see:** auto-upgrade is a console setting with no Redis equivalent. Staging keeps it off (a limit blocks, never bills); production has none on pay as you go (its monthly budget is the cap until launch) and turns it on with the Fixed plan (a limit never takes the site offline). It's checked by eye in Upstash's console and recorded in `docs/setup.md`.
