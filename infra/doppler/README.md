# Doppler settings kept in the repo

Doppler holds every secret; this folder holds only names and the rules for how configs relate.

| File | What it is |
|---|---|
| `dev_follows_staging.py` | Keeps `hrizzup/dev` (running the app on this Mac) following staging: every app secret in `stg` appears in `dev` as the reference `${stg.NAME}`, never a copy. `apply` fixes `dev`, then checks; `check` only reports. Prints names only. Fails if anything in `dev` points at `prd` or at another project. |
| `dev-overrides.txt` | Names whose local value deliberately differs from staging's, each with its reason. Empty for now. |

**When to run it:** whenever a key is added to or removed from `stg`, run `python3 infra/doppler/dev_follows_staging.py apply` in the same step (CLAUDE.md, "Environments and secrets"). Run it with a normal Doppler login, not inside `doppler run`.

**The two projects** (blueprint section 7): `hrizzup` holds the app's keys only (`dev`, `stg`, `stg_preview`, `prd`); `hrizzup-tools` holds Claude Code's own setup keys in its one config, `claude`, used only as `doppler run --project hrizzup-tools --config claude -- <command>`. The repo's `doppler.yaml` makes `hrizzup/dev` the default for a plain `doppler run` here.
