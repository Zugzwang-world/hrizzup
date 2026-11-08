# Doppler settings kept in the repo

Doppler holds every secret; this folder holds only names, the rules for how configs relate, and the way Claude Code reaches Doppler.

| File | What it is |
|---|---|
| `run` | **How Claude Code runs anything that needs secrets:** `infra/doppler/run <config> -- <command>`, where the config is `dev`, `stg`, `stg_preview` or `tools` (`hrizzup-tools/claude`). Several combine, later ones on top: `infra/doppler/run tools stg -- <command>`. It fetches that config's service token from this Mac's keychain and gives it to the Doppler process alone; the command gets the secrets, never the token. |
| `check_access.py` | Proves what the tokens can open: each reads its own config, the read-only one can't write, and every one is refused for `hrizzup/prd` and `hrizzup/prd_release`. Also says whether a personal Doppler login is still saved on this Mac. Prints statuses and labels only. |
| `app-keys.txt` | **The app's keys, by name only:** whatever the website, its server code or the database needs to run, each with what uses it. The only names allowed in `hrizzup`'s `stg`, `stg_preview` and `dev`, besides Doppler's own three labels. Tool tokens are never listed: they live in `hrizzup-tools/claude` (runbook Part 4, "Where each kind of key lives"). |
| `app_keys.py` | The check that keeps every other name out. `check <config>` is for GitHub jobs: it reads the config's names, never a value, with the job's read-only token in `DOPPLER_TOKEN`, through Doppler's names endpoint, and fails on any name not in `app-keys.txt`. Python's standard library only. |
| `dev_follows_staging.py` | Keeps `hrizzup/dev` (running the app on this Mac) following staging: every app key in `stg` appears in `dev` as the reference `${stg.NAME}`, never a copy. `apply` fixes `dev`, then checks; `check` only reports. **`check` also fails on any name in `stg`, `stg_preview` or `dev` that isn't in `app-keys.txt`, on any name `hrizzup-tools` holds, and on a listed name `stg` doesn't hold; `apply` never gives `dev` a reference to a name that isn't listed.** Prints names only. Fails if anything in `dev` points at `prd` or at another project. |
| `dev-overrides.txt` | Names whose local value deliberately differs from staging's, each with its reason; each must be one of the app's keys. Today one: `REDIS_KEY_PREFIX`, which is `dev` on this Mac so local runs never mix their Redis keys with staging's (`stg`). Claude Code sets an override in `dev` once, with the `dev` token, and the script leaves it alone. |
| `test_app_keys.py` | The tests for both scripts, with made-up names and no Doppler: `python3 -m unittest discover -s infra/doppler`, in Quick checks and `pnpm check`. |
| `test_workflows.py` | Every GitHub job that loads one of `hrizzup`'s configs whole runs `app_keys.py check` first, with the same token and under the same condition. The release pipeline is the one exception: it loads production's `prd_release`, whose keys it checks itself (`infra/keys/check.py`). |

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

**Adding or removing an app key** (the order matters, because every check that reads `stg` fails on a name `app-keys.txt` doesn't list):
1. **Adding:** a pull request adds the name to `app-keys.txt`, with what uses it. Once it has merged, add the key to `stg` and run `dev_follows_staging.py apply`.
2. **Removing:** delete the key from `stg`, run `apply` (it removes `dev`'s reference), then remove the name from `app-keys.txt` in the next pull request.
3. **A tool token** (any token a tool uses to act on a service for Claude Code) never goes into `hrizzup` or `app-keys.txt`: it goes into `hrizzup-tools/claude`. If one is found in `hrizzup`, it's replaced in `hrizzup-tools` and deleted from `hrizzup` (runbook Part 4).

**Where the check runs:** on this Mac, in `dev_follows_staging.py check` (all three configs, plus the names `hrizzup-tools` holds). In GitHub, the Staging workflow and the Screen check run `app_keys.py check` before they load `stg` and `stg_preview`, so a stray name stops them before they hold it; `test_workflows.py` fails if any job loads one of `hrizzup`'s configs without checking its names first.

**The two projects** (blueprint section 7): `hrizzup` holds the app's keys only (`dev`, `stg`, `stg_preview`, `prd`, and from Part 10 the release pipeline's branch of `prd`, `prd_release`); `hrizzup-tools` holds Claude Code's own setup keys in its one config, `claude`, used only as `infra/doppler/run tools -- <command>`. The repo's `doppler.yaml` is for a person who later logs in with their own Doppler account: `doppler setup` then makes `hrizzup/dev` the default in this folder.
