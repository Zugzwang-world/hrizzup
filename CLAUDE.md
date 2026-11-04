# Hrizzup

Hrizzup is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. Android first, then iPhone; the website is phone-first; one shared account.

**[PLAN.md](PLAN.md) is the single source of truth.** If anything disagrees with it, PLAN.md wins. The setup blueprint, the runbook and the Zugzwang World retirement list live in [docs/setup/](docs/setup/).

**Layout:** `sourcing/` (Grok bots, news pipeline, market data), `news-desk/` (our content, creators), `product/` (`web/` the Next.js website, `app/` the Expo app, `packages/` the code they share), `infra/` (service settings applied from the repo: the database's migrations in `infra/supabase/`, the sign-in settings, the storage rules, the Vercel project and firewall). Projects never copy code between each other; this repository is the only route.

**Codebase (decided 3 November 2026, PLAN.md step 1.5):** pnpm 11 workspaces with Turborepo (Vercel Remote Cache), Biome for formatting and lint, TypeScript 6, Vitest for unit tests, Playwright for screens, and the Supabase CLI for migrations. `pnpm check` runs the quick checks on this Mac. New packages wait 3 days after release before they can be installed (`pnpm-workspace.yaml`).

**Repository:** [github.com/Zugzwang-world/hrizzup](https://github.com/Zugzwang-world/hrizzup), private, in the founder's personal GitHub account on GitHub Pro.

## Working with the founder

**How to work with the founder:** the founder is non-technical. He describes problems, goals and preferences; you bring the solution. Always propose the best solution that top professional teams use today, explain it in plain language, and lead with your recommendation. If the founder suggests a specific fix and a better one exists, say so and recommend the better one. Show options only when there is a real trade-off, and say which you recommend. When the founder describes a problem through an example, treat the example as one case of a general problem: solve the whole category with the best professional approach, and write the general principle, never a rule about the single example.

- Start every reply with a short plain-English summary, and explain anything he must do in plain English, step by step.
- Ask only when a real decision is needed. Otherwise choose the sensible default and say what you chose.

## Runbook steps

When the founder says "do runbook step X.Y", follow that step in [docs/setup/RUNBOOK.md](docs/setup/RUNBOOK.md) exactly, then record the result in [docs/setup.md](docs/setup.md) the same day: what was set, where, and how it was checked. Never record a secret.

## End of every session

In that session's pull request:

- update the status file for each part you worked on in `docs/status/` (Done, Next, Open questions);
- rewrite that part's brief in `docs/brief/` ("Thinking-project briefs", below). A change to PLAN.md rewrites all three briefs.

## Thinking-project briefs

`docs/brief/product.md`, `docs/brief/sourcing.md` and `docs/brief/news-desk.md` are the only repository files the three Claude thinking projects keep in their knowledge (founder's decision, 4 November 2026). A thinking project sees nothing else from the repository unless it reads a file through the GitHub connector, so each brief stands on its own.

- **Rewritten, never appended:** write the whole file again from the repository as it is now. No history, no changelog, no "update" paragraphs. Under about 1,500 words.
- **Layout:** the title (`# Product: brief`), a short note with the date it was rewritten, two or three sentences on what Hrizzup is and the part's job, then five sections in this order: Where things stand; Decisions in force; Open questions; What's next; Read for detail (the repository files that hold the detail, each with what it holds).
- **Plain English for the founder.** A brief reports what PLAN.md and the repository say and never decides anything; PLAN.md wins if they disagree. Never a secret or a key's value. Anything parked until launch appears only as a pointer to the runbook's pre-launch checklist.
- **Scope:** a brief falls behind when a commit on `main` after the brief's own last change touched its scope:
  - `product.md`: everything except `sourcing/`, `news-desk/`, `docs/brief/`, `docs/status/sourcing.md` and `docs/status/news-desk.md`;
  - `sourcing.md`: `PLAN.md`, `sourcing/` and `docs/status/sourcing.md`;
  - `news-desk.md`: `PLAN.md`, `news-desk/` and `docs/status/news-desk.md`.

  A new document the projects share (such as the hand-over agreement) joins every brief's scope here, in the pull request that creates it.
- **No daily refresh for now** (founder's decision, 4 November 2026), so the end-of-session rewrite is what keeps the briefs current. A cloud routine that would rewrite any brief left behind is ready in `infra/claude/README.md`; Claude Code creates it only when the founder asks, once claude.ai/code lists `Zugzwang-world/hrizzup` (Claude's cloud refused it on 4 November 2026: no access to the repository).
- **The founder** clicks **Sync now** in each Claude project to load the newest brief: Claude projects don't refresh GitHub files by themselves.

## How changes land (from now on, including staging)

- **Every change goes on its own branch and pull request.** Never commit to `main` directly; GitHub refuses it anyway.
- **You open the pull request, the checks that fit the change run, and you merge it yourself as soon as they pass.** No human approval. Turn on auto-merge when you open it (`gh pr merge --auto --squash`), so it merges the moment the checks are green.
- **The secret check** (gitleaks, `.github/workflows/secret-check.yml`) runs automatically on every pull request over the whole history.
- **Preview link:** every pull request gets one from Vercel (behind a Vercel login). It is a complete working copy of the site: staging's data and keys (Doppler `stg_preview`), Google sign-in (through staging's relay), and Cloudflare's Turnstile test keys.
- **A change is checked on its preview, never by deploying it to staging.** The screen check and any manual check run against the pull request's preview. Staging only ever receives what has already merged into `main` (the "Staging" workflow: migrations first, then the code, then it waits until staging serves that commit).
- **GitHub enforces it:** the ruleset "main" requires the checks (Secret check, Quick checks, Database check, Screen check) to pass before merging, blocks force-pushes and deletion of `main`, and requires no reviews. Merges are squash-only, and the branch is deleted after merging. The ruleset "staging" lets only the Staging workflow's deploy key move the `staging` branch.
- **Risky changes wait for the AI review** before auto-merge is turned on: open the pull request as a draft, review it, then mark it ready with `gh pr merge --auto --squash`.

## Checks sized to the change (PLAN.md section 3)

Label every change with its size at the start of the commit message and the pull request title: `[small]`, `[normal]` or `[risky]`.

- **Small** (text, colours, spacing, simple fixes): quick checks, plus the screen check and screenshots (see "Screens fit every device") if a screen changed.
- **Normal:** quick checks, plus the tests for the parts the change touches.
- **Risky** (market maths, play money, login, database structure, the core of the news engine, payments): the full test suite plus AI review.
- **Production release:** everything, once.

## Production is off-limits to Claude Code

- **Claude Code never reads, holds or uses production keys.** It never opens Doppler `prd`, never connects to production's database or services, and never creates, copies or moves a production key, not even "without showing it".
- **Production is changed only by the release pipeline,** which gets its own production credentials in runbook Part 10. Claude Code builds and tests the pipeline in the repo and on staging. The founder starts each release; Claude Code starts the pipeline only when the founder says "release".
- **Tools that also reach production are never used on it:** the Cloudflare key (it covers the whole `hrizzup.com` zone and every R2 bucket), the Vercel token and login (one project for all environments) and the founder's own logins on this Mac. Claude Code checks production only from the outside (public addresses) and through the pipeline's reports.
- **Project-wide Vercel settings also cover production** (`infra/vercel/`: the project, its domains and the firewall). Claude Code applied them in Part 9, before production had keys or data, together with the one-time promotion of the holding page. From Part 10 on, a change there that touches production goes through the release pipeline; `apply.py --check` stays safe to run at any time.
- **Production's storage was the last such exception:** on the founder's instruction, Claude Code created production's R2 buckets (`hrizzup-uploads`, `hrizzup-media`), `media.hrizzup.com` and their rules on 3 November 2026, before production had keys or data. From then on, production's storage settings are applied only by the release pipeline (`infra/cloudflare/r2/apply.py production`), and Claude Code's Cloudflare key is never used on production names or buckets.
- **The founder's own command-line logins on this Mac** (Supabase, Vercel, Cloudflare's Wrangler) reach production too. Never use them: pass Claude Code's own tokens from `hrizzup-tools` explicitly (`infra/doppler/run tools`).
- If a task would need production access, stop and say so: the founder or the pipeline does it.

## Environments and secrets

- Staging is a sandbox: fully separate from production, no real user data, a spending cap on every paid service. The AI holds its keys.
- **Supabase project settings** (encrypted connections only, legacy keys off; region, compute, Data API off) live in `infra/supabase/project/` with each project's ID; `apply.py staging` for staging, the release pipeline for production.
- Secrets live only in Doppler, in two projects, so each place holds one kind of key:
  - **`hrizzup`, the app's keys only:** `dev` (running the app on this Mac: every staging value as a reference, `${stg.NAME}`, never a copy), `stg` (staging), `stg_preview` (previews: a branch of `stg` that copies every staging value automatically and holds only overrides), `prd` (production, synced to Vercel's production environment) and `prd_release` (the release pipeline's own: a branch of `prd` that adds the pipeline's credentials and is never synced, so they never reach a build). Whenever a key is added to or removed from `stg`, run `python3 infra/doppler/dev_follows_staging.py apply` in the same step; a value that must differ locally is listed in `infra/doppler/dev-overrides.txt`.
  - **`hrizzup-tools`, Claude Code's own setup keys** (the Cloudflare key, the Supabase access token, the Vercel token, the previews' protection bypass, and any future ones), in its one config, `claude`. Use them only as `infra/doppler/run tools -- <command>`, and never put one in `hrizzup`: `stg` and `stg_preview` are synced into Vercel's staging and previews, so anything there reaches every build.
- **GitHub Actions holds only what its workflows need,** each piped in without being shown: read-only Doppler tokens for `stg` (environment `hrizzup-staging`, `main` only), `stg_preview`, and `prd_release` (environment `hrizzup-production`, `main` only, created by the founder), the staging deploy key and deploy hook, and a copy of the protection bypass. The Remote Cache signs in through OIDC, so no Vercel token is stored in GitHub.
- **Supabase Auth keeps its own copies** of `GOOGLE_OAUTH_CLIENT_SECRET`, `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY`. Its settings live in `infra/supabase/auth/`; whenever one of those keys changes in `stg`, or a setting there changes, run `infra/supabase/auth/apply.py staging` the same day (its README has the command).
- Never print, log or commit a secret value; refer to secrets by name only. Never ask the founder to paste a secret into chat. Production keys never go in this repository.
- **Claude Code's own Doppler access:** four Doppler service tokens in this Mac's keychain, each limited by Doppler to one config: `hrizzup/dev`, `hrizzup/stg` and `hrizzup-tools/claude` (read and write) and `hrizzup/stg_preview` (read only). None can open `prd`; `python3 infra/doppler/check_access.py` proves it. Run every command that needs secrets as `infra/doppler/run <config> -- <command>` (`dev`, `stg`, `stg_preview` or `tools`; several, such as `tools stg`, combine them). Never use a personal Doppler login, never ask for one, and never put a token on a command line or in a file.
- Doppler is on its free Developer plan during staging, which has no roles, so only the founder and Claude Code use it. Before any helper joins Doppler, it moves to the Team plan (runbook, "Later, with the team"), and helpers get no access to Production or to `hrizzup-tools`.
- Mumbai is the region everywhere (Vercel `bom1`; Supabase `ap-south-1`), and `/api/health` shows the region.
- **Production runs on the same platforms as staging:** Vercel plus Supabase, set up exactly like staging (same services, versions, region and settings), with its own data and keys. It is created as soon as staging works, with nothing public until launch (runbook Part 10, "Production twin").
- **Releasing** means the release pipeline (`.github/workflows/release.yml`, started by hand) checking production's keys, applying the commit's database changes and the sign-in and storage settings to production, then promoting the exact production build of that commit, which passed staging (`vercel promote`). No rebuild; going back (`vercel rollback`) also runs through the pipeline. Until launch it promotes only builds whose home page is the holding page. The runbook's "Releasing to production" has the details.
- **Production's values come straight from each service's dashboard,** never typed or built by hand: the founder copies them into Doppler with the service's own copy button. Code derives anything composite (the database addresses, below).

## Database changes

- **Every change to the database's structure goes through migration files in the repo** (`infra/supabase/migrations/`, Supabase CLI, plain SQL, in timestamp order) and is applied the same way everywhere, so production receives exactly the same changes in the same order. Staging gets them from the Staging workflow on every merge to `main`. Each migration's tests go in `infra/supabase/tests/` and run on a fresh database in the Database check. Changing test data directly in staging is fine.
- **Production's database is changed only by the release pipeline,** which applies the same migration files with its own credentials. Claude Code never connects to it.
- Every table has row-level security on: the first migration switches it on for every new table and refuses any attempt to switch it off, and the Database check (every pull request) and the Staging workflow (every merge) fail if any table lacks it. To let people read or change rows, write a policy.
- The app connects through `DATABASE_URL` (pooler, transaction mode, port 6543) and migrations through `DATABASE_URL_SESSION` (session mode, port 5432). Both are Supabase's own shared-pooler strings, copied as they are from its Connect dialog with the `[YOUR-PASSWORD]` placeholder; the code fills in `SUPABASE_DB_PASSWORD` (`product/web/lib/db.ts`; workflows and scripts use `infra/supabase/database_url.py run session -- …`). Pool and timeout settings: blueprint section 5.

## Building

- Build on standard, portable pieces. AWS is not the production plan: it comes later only if a concrete need appears, as its own project.
- Media: images go through Cloudflare image transformations; creator videos are stored and played through Cloudflare Stream.

## Performance and caching (full detail: [blueprint, "Production quality"](docs/setup/BLUEPRINT.md#14-production-quality))

Every page and every screen is built to load fast and stay fast. Performance is part of "done", never a later fix.

- **Cache in layers, designed in for every page and API from the start:** the device (browser and app caches, long-lived files with versioned names), the edge (Cloudflare and Vercel, refreshed in the background), server data caches (updated or cleared the moment the data changes), Upstash Redis (the shared fast layer; every entry has an expiry and is cleared when its data changes), and the database (indexes for every search and sort, page-by-page loading, no repeated small queries).
- **Batch:** one request to Redis or the database, never several separate trips when one will do.
- **Redis (Upstash; full rules in [blueprint section 14, "Redis (Upstash)"](docs/setup/BLUEPRINT.md#redis-upstash)):**
  - **every key name starts with the environment,** from `REDIS_KEY_PREFIX` (`prd`, `stg`, `pre` for previews, `dev` for this Mac), then what the key is for: `stg:cache:feed:home`. Never personal data in a key name;
  - **every key has an expiry:** caches, rate limits, locks and counters alike. When a cached shape changes, its key name gets a new version (`v2`);
  - **batch:** a pipeline or a multi-key command instead of several separate trips, and a transaction or script when commands must apply together. Keep the client's auto-pipelining on;
  - **never the only copy:** eviction is on, so Redis may drop keys when full. Anything that matters lives in the database;
  - **staging uses Upstash's Fixed plan** (Fixed 1GB), which has no per-command charges, so load tests can't run up a bill by command count, with auto-upgrade off (a test that hits a limit is blocked, not billed). **Production is on pay as you go until launch** (no users, a $10 monthly budget), then moves to Fixed 1GB with auto-upgrade on (runbook, pre-launch checklist). `infra/upstash/check.py` checks the settings and the stored keys.
- **Never put one user's private data in a shared cache.** Cache keys always include the environment, and the user where needed.
- **Media:** images resized and in modern formats through the image service; video through adaptive streaming; anything below the visible screen loads later.
- **Lists and feeds:** draw only what's on screen, and load the next page before the user reaches it.
- **Performance budget for every page and screen** (load time, responsiveness, layout stability, download size), checked automatically on every pull request and measured on real users once live.
- Open-source code copied in keeps its licence notice and is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Screens fit every device

Every screen adjusts itself to any device, from a small phone to a large monitor, with nothing cut off, overlapping or scrolling sideways.

- **Phone-first:** design for the phone first, then let the layout grow.
- **Flexible layouts:** build from flexible rules (proportions, wrapping, Tailwind and shadcn/ui responsive classes). Never use fixed pixel widths tuned to one screen.
- **Automatic check before the founder sees any screen change:** test it in a real browser with Playwright, in both Chromium and WebKit (Safari's engine, which every iPhone uses), at 320, 360, 390, 412, 768, 820, 1024, 1280, 1366, 1440, 1536, 1920 and 2560 pixels wide, each at a typical height for that kind of device, and with phones and tablets turned sideways (width and height swapped). The check fails if anything overflows, overlaps or needs sideways scrolling.
- **Large text:** also test the phone widths (320, 360, 390 and 412) with the phone's text size turned up to 200%. The same pass-or-fail rule applies.
- **Windows laptops** at 125% and 150% display scaling show a narrower page; the 1280, 1366 and 1536 widths cover them.
- **Screenshots for the founder** at phone, tablet, laptop and monitor sizes: 360, 768, 1440 and 1920 pixels wide.
