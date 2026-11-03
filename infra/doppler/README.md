# Doppler settings kept in the repo

Doppler holds every secret; this folder holds only names, the rules for how configs relate, and the way Claude Code reaches Doppler.

| File | What it is |
|---|---|
| `run` | **How Claude Code runs anything that needs secrets:** `infra/doppler/run <config> -- <command>`, where the config is `dev`, `stg`, `stg_preview` or `tools` (`hrizzup-tools/claude`). Several combine, later ones on top: `infra/doppler/run tools stg -- <command>`. It fetches that config's service token from this Mac's keychain and gives it to the Doppler process alone; the command gets the secrets, never the token. |
| `check_access.py` | Proves what the tokens can open: each reads its own config, the read-only one can't write, and every one is refused for `hrizzup/prd` and `hrizzup/prd_release`. Also says whether a personal Doppler login is still saved on this Mac. Prints statuses and labels only. |
| `dev_follows_staging.py` | Keeps `hrizzup/dev` (running the app on this Mac) following staging: every app secret in `stg` appears in `dev` as the reference `${stg.NAME}`, never a copy. `apply` fixes `dev`, then checks; `check` only reports. Prints names only. Fails if anything in `dev` points at `prd` or at another project. |
| `dev-overrides.txt` | Names whose local value deliberately differs from staging's, each with its reason. Today one: `REDIS_KEY_PREFIX`, which is `dev` on this Mac so local runs never mix their Redis keys with staging's (`stg`). Claude Code sets an override in `dev` once, with the `dev` token, and the script leaves it alone. |

**Claude Code's own access (runbook step 10.1, since 3 November 2026).** Four Doppler service tokens, named `claude-code-mac`, each limited by Doppler to one config. Nothing else on this Mac gives Claude Code Doppler access, and it never uses a personal login.

| Config | Access | Why |
|---|---|---|
| `hrizzup/dev` | Read and write | `dev_follows_staging.py` writes `dev`'s references |
| `hrizzup/stg` | Read and write | Claude Code creates and replaces staging's keys |
| `hrizzup/stg_preview` | Read only | The previews' few overrides rarely change; ask the founder for a write token if one must |
| `hrizzup-tools/claude` | Read and write | Claude Code stores setup values it creates (such as a deploy hook) |

- **Where they live:** this Mac's login keychain, service `hrizzup-doppler`, one item per config (account `hrizzup/dev`, `hrizzup/stg`, `hrizzup/stg_preview`, `hrizzup-tools/claude`). Encrypted by macOS, readable only by this user, never in a file, the repo, a command line or the screen.
- **How they are used:** only through `run` and the two scripts here. Doppler runs with its own empty settings folder (`~/.config/hrizzup/doppler-cli`), so a personal login saved in `~/.doppler` is never used, and with `--no-fallback`, so no copy of any secret is left on disk.
- **Replacing one** (they don't expire; revoking works at once): in Doppler's dashboard, open the config, then **Access**, and delete `claude-code-mac`. Click **Generate**, name it `claude-code-mac`, choose the same access, and copy the token. In Terminal, run `security add-generic-password -U -s hrizzup-doppler -a <project>/<config> -w` and paste the token when it asks (never into a chat). Then run `python3 infra/doppler/check_access.py`.
- **Production:** no token for `prd` or `prd_release` exists on this Mac. The release pipeline's own read-only token for `prd_release` lives only in the GitHub environment `hrizzup-production` (runbook Part 10).

**When to run `dev_follows_staging.py`:** whenever a key is added to or removed from `stg`, run `python3 infra/doppler/dev_follows_staging.py apply` in the same step (CLAUDE.md, "Environments and secrets"). Run it directly, not inside `infra/doppler/run`.

**The two projects** (blueprint section 7): `hrizzup` holds the app's keys only (`dev`, `stg`, `stg_preview`, `prd`, and from Part 10 the release pipeline's branch of `prd`, `prd_release`); `hrizzup-tools` holds Claude Code's own setup keys in its one config, `claude`, used only as `infra/doppler/run tools -- <command>`. The repo's `doppler.yaml` is for a person who later logs in with their own Doppler account: `doppler setup` then makes `hrizzup/dev` the default in this folder.
