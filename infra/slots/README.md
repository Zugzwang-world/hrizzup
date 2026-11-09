# Slots: parallel sessions on this Mac

Several Claude Code sessions work on this Mac at once, each in its own git worktree (PLAN.md step 1.8). A **slot** is one session's own place to run the website, the app's dev server (Metro) and the local database: its own ports, its own database containers and its own Redis key prefix. A session claims one before running any of them and releases it when done (CLAUDE.md, "Parallel sessions"), so two sessions never share a port or a container.

| Slot | Website | Metro | Local database (Supabase project, port) | Redis prefix | For |
|---|---|---|---|---|---|
| 1 | `http://localhost:3101` | 8101 | `hrizzup-slot1`, 55332 (its block 55330–55339) | `dev:slot1` | relays |
| 2 | `http://localhost:3102` | 8102 | `hrizzup-slot2`, 55342 (55340–55349) | `dev:slot2` | relays |
| 3 | `http://localhost:3103` | 8103 | `hrizzup-slot3`, 55352 (55350–55359) | `dev:slot3` | relays |
| 4 | `http://localhost:3104` | 8104 | `hrizzup-slot4`, 55362 (55360–55369) | `dev:slot4` | the design chat (`claim --design`) |

- **Every number follows from the slot's own:** website 3100 + n, Metro 8100 + n, the database's ports 10n above `config.toml`'s block (55320–55329, which the Database check uses in GitHub). The defaults (3000, 8081, 55322) are never a slot's, so a stray unslotted server can't land on one.
- **Signing in and uploading from a slot** needs its website address in staging's sign-in redirect list and the staging buckets' browser rules; until they're added, only `http://localhost:3000` is allowed there.

## Commands

| Command | What it does |
|---|---|
| `infra/slots/slot claim` | Claims a free slot for this worktree, or shows the one it holds. Exits 3, saying why each slot was passed over, if none is free |
| `infra/slots/slot claim --wait` | The same, checking again every 10 minutes until one is free |
| `infra/slots/slot claim --design` | The design chat's own slot (the last one); relays never take it |
| `infra/slots/slot web` | The website on the slot's port, with staging's keys (Doppler `dev`) and the slot's Redis prefix. Add `--detach` to start it in the background (its log goes beside the register) and return once it answers |
| `infra/slots/slot app` | The app's dev server (Metro) on the slot's port, with file watching and Fast Refresh on (`--detach` as above) |
| `infra/slots/slot db test` | The slot's database, fresh from `infra/supabase/migrations/`, then the Database check's tests (`infra/supabase/tests/`). `pnpm test:db` runs the same here |
| `infra/slots/slot db start`, `db stop` | Starts or stops the slot's database (stopping deletes its data; it's rebuilt from the migrations) |
| `infra/slots/slot stop web\|app\|db\|all` | Stops what the slot runs |
| `infra/slots/slot status` | Every slot: who holds it, since when, and what runs in it |
| `infra/slots/slot run [--doppler dev] -- COMMAND…` | Any command with the slot's settings (for example `BASE_URL` for the website's checks: `infra/slots/slot run --doppler dev -- pnpm --filter @hrizzup/web exec playwright test`) |
| `infra/slots/slot env` | The slot's settings as `export` lines |
| `infra/slots/slot docker ARGS…` | Docker's own command, wherever Docker Desktop keeps it |
| `infra/slots/slot release` | Stops the slot's website, Metro and database, then frees the slot |

## How it works

- **The register** is one small file per held slot in the repository's shared git folder (`.git/hrizzup-slots/`), which every worktree sees and nothing commits. Claims take a lock first, so two sessions claiming at the same moment never get the same slot.
- **A slot whose worktree is gone counts as free again.** A worktree is gone once its folder is, or once git has dropped it (`git worktree remove` unregisters it first, and a server still running in it can leave files behind). The next claim stops whatever that worktree left running in the slot (its website and Metro, recognised by their start times; its database) and takes it. A port held by any other program puts the slot out of reach until it's freed; that program is never stopped.
- **Stopping a service** stops its whole process tree: Next.js and Expo each start their server in a process group of its own.
- **Docker** isn't on the PATH sessions get (Docker Desktop keeps `docker` and its credential helpers inside the app). The tool finds them there and puts them on the PATH of everything it runs, so nothing in this Mac's shell setup changes; it starts Docker Desktop if it isn't running.
- **The database is Postgres alone** (`supabase db start`), about 70 MB, the only service the Database check's tests use. The website on this Mac uses staging's services through Doppler `dev`, so no other local service (sign-in, storage, Studio…) is ever started. The Supabase CLI takes the slot's project name and ports from `SUPABASE_PROJECT_ID` and `SUPABASE_<SECTION>_<KEY>`, so `config.toml` stays as the Database check uses it; none of a session's own `SUPABASE_` settings (staging's, from Doppler) reach the CLI.
- **Redis:** the website's keys start `dev:slot<n>:`, so sessions side by side never share a key in staging's Redis (`redisKey()` in `@hrizzup/core`; blueprint section 14).
- **In GitHub's runners** there are no slots: `pnpm test:db` uses `config.toml` as it is (`GITHUB_ACTIONS`).

## How many slots

**This Mac holds four: three for a round's relays and one kept for the design chat.** Measured on 9 November 2026 (Apple M4, 10 cores, 24 GB; Docker Desktop's VM 8 GB), with about 18 Claude Code processes, Chrome and another project's Supabase stack already running, and macOS already at its "warn" memory level with 12 GB in swap before any slot started:

| Running | macOS memory level | Free memory (macOS) | Pages, once compiled |
|---|---|---|---|
| Before any slot | warn | 44% | — |
| 1 slot | warn | 44% | 0.07–0.46 s |
| 3 slots | warn | 33% | 0.1–0.5 s (first page of a new slot 2.2 s) |
| 4 slots (one as the design chat) | warn | 34% | 0.1–0.6 s |
| 4 slots, plus type checks and unit tests in two worktrees at once (24 tasks, none cached) | normal or warn, never critical | lowest 32% | under 0.25 s during the run |

- **One active slot costs about 1.3–1.5 GB:** the website about 0.6–0.8 GB once its pages are compiled, Metro about 0.6–0.8 GB once it has built the Android bundle (1.1 GB just after), the database about 70 MB inside Docker's VM, whose memory is already set aside. An idle slot shrinks to about 0.7 GB as macOS compresses it.
- **A fifth slot wasn't tried**, to keep the founder's Mac, and the relays running on it, away from critical memory: swap had grown to about 16 GB. More slots need more free memory first (fewer idle sessions, or Docker Desktop's VM made smaller); `COUNT` in `slots.py`, the two allow-lists and this table change together.
