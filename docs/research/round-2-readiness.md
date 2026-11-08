# Round 2: readiness check

> Research only, 8 November 2026, for the Product thinking project. Nothing was changed in code, settings or services. Every fact has its source (a repository file, a command's output, or a web page); "not confirmed" marks what couldn't be confirmed. No secret was printed or copied: access was checked, never contents. Staging and the repository only. If anything here disagrees with PLAN.md, PLAN.md wins.

**Round 2, as the request describes it:** one session runs 1.5a to 1.5d in order (the performance budget, journey tests, the typed API, the app on the founder's Android phone); a second runs 1.7a (Manifold's maths) alongside; the Product chat settles D1 to D4 (D1: blocking password sign-in; D2 to D4: market data).

**Labels:** PLAN.md has no steps called 1.5a to 1.5d or 1.7a, and no decisions D1 to D4 (it has steps 1.5 and 1.7; the agreement's D1 to D7 are other, already-settled decisions). The labels come from the Product chat. This file uses them as the request does. Source: `grep` over every `.md` file in the repository, 8 November 2026.

---

## A. Where we stand

### A1. The 8 November decisions: merged, and do they agree?

All three are merged on `main` (`git log origin/main`, 8 November 2026):

| Pull request | What | Merged |
|---|---|---|
| [#32](https://github.com/Zugzwang-world/hrizzup/pull/32) | Research: what Manifold's code offers the market engine (`docs/research/manifold.md`) | Yes (`76e4885`) |
| [#33](https://github.com/Zugzwang-world/hrizzup/pull/33) | Perps: one Bitcoin perp in play money (PLAN.md section 2, step 3.4) | Yes (`67b5422`) |
| [#34](https://github.com/Zugzwang-world/hrizzup/pull/34) | The website and the app built in parallel, the website one stage ahead; `TRACKER.md` (new) | Yes (`618c836`) |

**They agree with each other** on what matters: PLAN.md sections 2, 3 and 5, `TRACKER.md`, `docs/status/product.md` and all three briefs describe the same stages (design, contract, back end, website screen and app screen in separate worktrees, website join, app join), the same app-only and website-only lists, and the same perps rules. The Sourcing brief carries the perps job need (a job every few seconds on Supabase Cron) into its background-jobs question (`docs/brief/sourcing.md`, "Decisions in force").

**What is missing or out of step** (none blocks Round 2, except the first):

1. **Step 1.7 needs the agreement's first half, which is still Draft.** PLAN.md section 5 lists 1.7's needs as "0.6, 0.7 (first half)", and "Needs means it must be finished first". 1.7a (Manifold's maths, as pure code with no tables) doesn't break the agreement's own rule (no tables or content for its shapes before Agreed: `agreement/README.md`, Status), but it does start before a listed need is finished. **The thinking partner should either split 1.7 in PLAN.md (1.7a, the maths package with its tests, needs only 0.6; the rest of 1.7 keeps needing the first half), or wait for the sign-off.** Recommendation: split it; the maths touches none of the agreement's shapes.
2. **The password hook in the blueprint needs a plan we don't have.** Blueprint section 9 says password sign-in "is blocked with Supabase's password hook ... once migrations exist". Supabase offers that hook (Password Verification Attempt) on Team and Enterprise only; we're on Pro (D1 below). The blueprint and the status file's open question need the D1 answer.
3. **CLAUDE.md doesn't mention `TRACKER.md`.** PLAN.md section 3 says Claude Code moves each feature's stages in `TRACKER.md` in the pull request that finishes them, but CLAUDE.md's "End of every session" lists only the status files and briefs. Recommendation: add one line there, so sessions in Round 2 and after don't miss it. (`TRACKER.md` is already inside the Product brief's scope, which covers everything outside `sourcing/` and `news-desk/`.)
4. **Two things allow only `localhost:3000`:** staging's sign-in redirects (`infra/supabase/auth/settings.json`, `uri_allow_list`) and the staging uploads bucket's CORS (`docs/setup.md`, R2 table). A second session's website on another port can't sign in or upload (B4 below).
5. **#30's title reads "signed off", but its content keeps the first half Draft** ("is signed off only after ... reviewed": `git show d178622`). Nothing to fix; just don't read the title as a sign-off.

**Where the agreement's first half stands:** **Draft**, last revised 5 November 2026. The founder approved the seven decisions (D1 to D7: launch list and so on) on 5 November; the sourced item and the routes were added after them that day. **Sourcing: not yet reviewed. The founder's approval in News Desk's place: not yet given.** It becomes Agreed only in a change the founder asks for. Until then: no tables for its shapes, no content written in them, nothing loaded. The second half isn't drafted (waits for step 0.8). Source: `agreement/README.md`, Status table; `docs/brief/sourcing.md` ("Sourcing's review is next").

### A2. The codebase as it is

**Folders and packages** (`pnpm-workspace.yaml`; each `package.json`):

| Folder | Package | What's in it |
|---|---|---|
| `product/web` | `@hrizzup/web` | The Next.js website |
| `product/app` | `@hrizzup/app` | The Expo app: one screen (`app/index.tsx`) showing the brand's words; `app/_layout.tsx` |
| `product/packages/core` | `@hrizzup/core` | Shared code: `brand.ts`, `environments.ts` (with a test) |
| `product/packages/tsconfig` | `@hrizzup/tsconfig` | Shared TypeScript settings (`base`, `library`, `nextjs`) |
| `agreement` | `@hrizzup/agreement` | The hand-over agreement: JSON Schema definitions, examples, `validate()` (Ajv), its check and README generator |
| `infra/supabase` | `@hrizzup/database` | The one migration (`20261103120000_lock_every_table.sql`), its pgTAP test, the CLI's `config.toml` |
| `sourcing/`, `news-desk/` | none | A README each, no code |

There is no typed API package, no market-engine package, no `eas.json`, and no Maestro or performance tooling yet (file listing, 8 November 2026).

**The website's pages and routes** (`product/web/app/`):

| Address | Kind | Notes |
|---|---|---|
| `/` | Page | The holding page |
| `/privacy`, `/terms` | Pages | Draft legal pages |
| `/sign-in-test` | Page | Staging, previews and this Mac only; 404 on production. The proxy (`proxy.ts`) refreshes the session only here |
| (any unknown address) | `not-found.tsx` | 404 page |
| `/robots.txt`, `/icon.svg` | Files | `robots.ts`, `icon.svg` |
| `/api/health` | API | Environment, region, commit, and whether the database, Redis, storage and sign-in answer |
| `/auth/google`, `/auth/callback`, `/auth/relay`, `/auth/sign-out` | API | Google sign-in, the code exchange, staging's relay for previews, sign-out. Every `/auth/` route answers 404 on production until launch (blueprint section 9) |

**Versions** (installed: `pnpm-lock.yaml` and `node -v`/`pnpm -v` on this Mac; current: the npm registry's `latest` tag, read 8 November 2026 with `npm view`, and nodejs.org's release index):

| Tool | Ours | Current stable | Behind? |
|---|---|---|---|
| Node.js | 24 (`.node-version`; `engines` `>=24 <25`; Vercel `nodeVersion` `24.x` in `infra/vercel/project.json`); this Mac runs 24.21.0 | **26.13.0, LTS since 28 October 2026**; the newest 24.x is 24.22.2 (LTS, maintained) ([nodejs.org/dist/index.json](https://nodejs.org/dist/index.json)) | One major behind the newest LTS; still a supported LTS. Vercel made Node 26 generally available and the default for new projects ([Vercel changelog](https://vercel.com/changelog/node-js-26-lts-is-now-generally-available-on-vercel)). Expo's support for Node 26: not confirmed. Recommendation: stay on 24 for Round 2; move to 26 in its own change once Expo's tools list it |
| pnpm | 11.28.9 (`packageManager`) | 12.18.0 (12.0.0 came out 26 August 2026); the newest 11.x is 11.28.11 | One major behind; two patches behind on 11 |
| TypeScript | 6.0.3 | **7.0.2** (8 July 2026), the native (Go) compiler | One major behind, on purpose: blueprint section 13 waits for Expo's tools to support 7. 6.0.3 is the newest 6.x |
| Next.js | 16.4.3 (`~16.4.3`) | 16.4.5 (3 November 2026) | Two patches |
| React | 19.3.0 (pinned exactly) | 19.3.1 | One patch |
| Expo SDK | 58.0.22 (`~58.0.0`) | 58.0.23; SDK 58 is the newest SDK (58.0.0 on 29 September 2026) | One patch |
| React Native | 0.88.1 (`~0.88.0`) | 0.88.1 (0.89 is a release candidate) | Current |
| expo-router | 58.0.29 | (SDK 58 line) | Current with the SDK |
| Vitest | 5.0.5 (`^5.0.0`) | 5.1.0 (2 November 2026) | One minor |
| Playwright | 1.64.1 | 1.65.0 | One minor |
| Biome | 2.6.3 (pinned) | 2.6.6 | Three patches |
| Turborepo | 2.11.10 | 2.11.10 | Current |
| Supabase CLI | 2.122.0 (`^2.90.0`) | 3.0.0 (2 November 2026) | One major behind |
| supabase-js | 2.118.0 | 2.119.0 (3.0 is in pre-release) | One minor |

Patch and minor updates arrive through Dependabot (blueprint section 15) and the 3-day wait (`pnpm-workspace.yaml`, `minimumReleaseAge: 4320`). None of the gaps blocks Round 2. TypeScript 7, pnpm 12, Node 26 and Supabase CLI 3 are each their own change, later.

### A3. The checks as they are

All run on GitHub's hosted Linux machines (`ubuntu-24.04`); workflow files in `.github/workflows/`.

| Check | Workflow, job | Runs when | What it runs | Typical time |
|---|---|---|---|---|
| **Secret check** (required) | `secret-check.yml` | Every pull request push | gitleaks over the whole history | about 0.1 minutes |
| **Quick checks** (required) | `checks.yml`, `quick` | Every pull request push | `pnpm install`, `biome ci .`, then `turbo run typecheck test` (Vitest, including the agreement's check), with Vercel's Remote Cache | median 0.7, at most 0.9 minutes |
| **Database check** (required) | `checks.yml`, `database` | Every pull request push | `turbo run test:db`: the Supabase CLI starts a throwaway Postgres in Docker, applies the migrations, runs the pgTAP tests (including "every table is locked"). Turborepo skips it when nothing changed | median 0.6, at most 2.5 minutes |
| **Screen check** (required) | `checks.yml`, `screens` | Every pull request push; does real work only when `turbo ls --affected` says the website is affected | Waits for Vercel's preview, fetches staging's test-account keys (Doppler `stg_preview`), installs Chromium and WebKit, runs Playwright against the preview with the bypass header at 13 widths, sideways and at 200% text, signed out and in; uploads screenshots | median 0.6 (skipped), at most 6.5 minutes (full run) |
| **Staging** | `staging.yml` | Every merge to `main` | Migrations to staging, the table check, moves `staging`, calls the deploy hook, waits for `/api/health` to report the commit | about 1.1 minutes |
| **Release** | `release.yml` | By hand, only when the founder says "release" | Production's migrations and settings, then `vercel promote` | not measured (production) |
| **Reminders** | `reminders.yml` | Daily schedule | `.github/scripts/reminders.py` | under a minute |

Times are from the GitHub API, over all 29 runs of `checks.yml` so far and recent runs of the others (`gh api .../actions/runs/{id}/jobs`, 8 November 2026).

**Minutes per pull request:** GitHub bills each job rounded up to a whole minute. Averaged over the 29 runs, one push of a pull request bills about 1.0 (Quick) + 1.1 (Database) + 2.1 (Screen) + 1 (Secret) ≈ **5 minutes**, and about **10 minutes** when the website changes. A pull request usually has two pushes, and its merge adds about 2 minutes for Staging, so **roughly 10 to 22 minutes per pull request today.** Round 2 adds the performance check, the Maestro test (C6: about 15 to 25 minutes on an Android emulator) and more Playwright tests, so expect **about 20 to 50 minutes per pull request** once they land, with the Maestro job running only when the app changes.

**Our allowance:** GitHub Pro includes 3,000 minutes a month for private repositories (C5 confirms the source). This month's use couldn't be read: GitHub's billing API needs a `user` permission Claude Code's GitHub login doesn't have (HTTP 404 with "needs the user scope"). **Not confirmed**; the founder can see it under GitHub → Settings → Billing and plans → Usage.

---

## B. Ready for parallel sessions

### B4. Two sessions in separate worktrees at the same time

Checked from this worktree (`.claude/worktrees/round-2-readiness-check-72d747`), 8 November 2026:

| Shared thing | Works in parallel? | Evidence | What to do |
|---|---|---|---|
| **Install** | Yes | Each worktree has its own `node_modules`; pnpm's store is shared and safe to share | Each session runs `pnpm install --frozen-lockfile` once when it starts |
| **Doppler** | Yes | `infra/doppler/run dev -- …` worked from this worktree (staging's values reached the command; none shown). `python3 infra/doppler/check_access.py`: every token works for its own config only, none opens production, no personal login. The tokens are in the Mac's keychain, not in the folder, so every worktree reaches them | Nothing |
| **Build and unit tests** | Yes | Turborepo's local cache is per worktree; the Remote Cache is shared and keyed by inputs, which is what it's for | Nothing |
| **Website dev server** | **Partly** | `next dev` uses port 3000 and moves to 3001 if it's taken. Staging's sign-in only returns to `http://localhost:3000/**` (`infra/supabase/auth/settings.json`), and the staging uploads bucket accepts only `http://localhost:3000` (`docs/setup.md`, R2 CORS) | Only the website session runs `next dev`; the 1.7a session needs no server (pure maths and Vitest). If two website servers are ever needed, allow `http://localhost:3001/**` in staging's redirect list and the uploads CORS (one small change through `infra/supabase/auth/apply.py staging` and `infra/cloudflare/r2/apply.py`) |
| **App dev server (Metro)** | Yes, one at a time | Expo's Metro uses port 8081 and offers another if it's taken (not confirmed in non-interactive mode) | Only the 1.5 session runs it |
| **Local database** | **One at a time** | Docker Desktop is installed and running, but the `docker` command isn't on Claude Code's path (`zsh: command not found: docker`; it lives inside `/Applications/Docker.app`). Another project's Supabase stack ("experiment") is already running on ports 54321 to 54327. Ours uses 55320 to 55329 and the project name `hrizzup` (`infra/supabase/config.toml`), so two worktrees running `test:db` at once would use the same containers and ports | The 1.7a session needs no database. If both need it, run `test:db` one after the other, or leave it to the Database check on the pull request. Whether `supabase db start` works without `docker` on the path: not confirmed (it talks to Docker directly; not run here, to change nothing) |
| **Redis** | Yes, with care | Local runs share staging's Redis with the prefix `dev` (`infra/doppler/dev-overrides.txt`), so two sessions' local runs share `dev:` keys | Harmless today (no Redis keys are written by any code yet). Later, tests that write keys add the worktree's name after `dev:` |
| **Staging's test accounts** | Yes | One account per browser engine; each check gets its own one-time session (`product/web/e2e/support/test-accounts.ts`) | Nothing |
| **Git** | Yes, with the known rule | The stash stack is shared across worktrees (Claude Code's environment note) | Never use bare `git stash` |
| **Expo, Android tools** | Not set up | No Expo login on this Mac (`~/.expo` absent), no `eas` command, no Android SDK, `adb` or emulator, no Maestro | C8: the 1.5 session uses Expo's build service, not a local Android build |

**Verdict:** ready, as long as only the 1.5 session runs the website's and the app's dev servers and the local database. The 1.7a session needs only `pnpm install`, Vitest and Biome, so the two can't collide.

---

## C. Round 2's tasks

### C5. 1.5a, the performance budget

**What blueprint section 14 sets** ("Performance budgets"): Google's "good" thresholds, measured as a mid-range Android phone on slow 4G.

| What | Website (every page) | App (every screen) |
|---|---|---|
| Load time | Largest content within 2.5 s | First content within 2 s of a cold start |
| Responsiveness | Every tap answered within 200 ms | Within 100 ms; scrolling at 60 frames a second |
| Layout stability | Layout shift 0.1 or less | Nothing jumps (placeholders hold the space) |
| Download size | At most 200 KB compressed code and 500 KB in total on first load | A screen's first data under 100 KB; code size checked for unexplained growth |

On every pull request: Lighthouse against the preview plus a download-size check on the website; code-size checks and automatic performance tests in the app. Each becomes a required check in the ruleset "main" once built. Once live: real users at the 75th percentile (Vercel Speed Insights; the monitoring tool for the app). Changing a budget is a decision recorded in `docs/setup.md`.

**Previews sit behind Vercel's login: yes.** Every preview, staging and the hidden production builds need a Vercel login (`infra/vercel/project.json`: `ssoProtection` `all_except_custom_domains`; blueprint section 6; staging checked with `curl`, C8).

**The supported way past it** ([Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)): on every plan, the header `x-vercel-protection-bypass` with the secret, plus `x-vercel-set-bypass-cookie: true` for a browser that follows links. **We already use it:** the Screen check sends both (`product/web/playwright.config.ts`), with the secret in GitHub's secrets and Doppler `hrizzup-tools`. It also skips the firewall's bot challenge, but not attack-time limits (same page; blueprint section 6). Avoid the query-string form: the secret would land in logs. **The newer way with no stored secret** is Trusted Sources: a GitHub job sends its own short-lived OIDC token in `x-vercel-trusted-oidc-idp-token` ([Trusted Sources](https://vercel.com/docs/security/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources)). It works only for callers that can issue such tokens (our CI, not an outside service or a phone). Recommendation: use the existing bypass now for Lighthouse, and move both checks to Trusted Sources in a later small change.

**Measuring as a mid-range Android phone in India** (GitHub's machines are in the US and Europe):

| Option | Where it runs | Cost | Notes |
|---|---|---|---|
| **Lighthouse CI on GitHub's runner** | US/Europe | GitHub minutes only (about 2 to 4 minutes a pull request, estimate) | Default mobile profile is a Moto G Power at slow 4G (150 ms, 1.6 Mbps) with 4× CPU slowdown ([constants](https://app.unpkg.com/lighthouse@13.0.3/files/core/config/constants.js), [throttling](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md)). Shared runners are noisy: take the median of 5 runs, "twice as stable as 1" ([variability](https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md)). The simulation replays the network, but the server's distance from the runner still leaks into the first byte (how much: not confirmed) |
| WebPageTest (now LogicMonitor) | **Mumbai location** (`BOM_IN_01`, [locations](https://www.webpagetest.org/getLocations.php?f=json)) | Free plan 150 runs a month, no API; Pro from $180 a year with the API ([pricing](https://www.logicmonitor.com/pricing/web-performance-optimization)) | Mobile emulation, not real phones in India (not confirmed). Custom headers on HTTPS: not confirmed, so protected previews may not work |
| **Calibre** | **Mumbai** among 17 locations ([agents](https://calibreapp.com/agents.json)) | Starter $75 a month, 5,000 tests; 15-day trial ([pricing](https://calibreapp.com/pricing)) | Custom headers and pull-request reviews ([docs](https://calibreapp.com/docs/site/agent-locations)) |
| DebugBear | Mumbai ([locations](https://www.debugbear.com/docs/server-locations)) | Not confirmed (third parties say $79 to $125 a month) | Custom headers ([docs](https://www.debugbear.com/docs/custom-request-headers)); Vercel preview integration |
| SpeedCurve, Treo | Mumbai not confirmed | From $90 ([SpeedCurve](https://www.speedcurve.com/pricing/)); $75 ([Treo](https://treo.sh/pricing)) a month | — |
| PageSpeed Insights API | A Google data centre (North America, Europe or Asia; not choosable) ([about](https://developers.google.com/speed/docs/insights/v5/about)) | Free | Can't send headers, so can't test previews |
| Our own runner in India | AWS Mumbai or DigitalOcean Bangalore | About $42 to $78 a month ([DigitalOcean](https://www.digitalocean.com/pricing/droplets); AWS figure third-party) | Self-hosted GitHub runners carry no GitHub fee today: the announced $0.002-a-minute charge was postponed with no new date ([GitHub changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/), [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)) |
| Real users (after launch) | Real phones | Speed Insights Plus $10 a project a month plus $0.65 per 10,000 events ([pricing](https://vercel.com/docs/speed-insights/limits-and-pricing)); Chrome's real-user data free, India via BigQuery ([CrUX](https://developer.chrome.com/docs/crux/bigquery)) | The blueprint's "once live" measure |

**Recommendation for 1.5a:** what top teams do is gate every pull request on the numbers that don't wobble (download sizes) and treat lab timings as regression signals with some tolerance, then measure absolute numbers from the users' region and from real users. So:

1. **Per pull request:** Lighthouse CI on GitHub's runner against the preview, with the existing bypass headers, mobile preset, median of 5 runs. **Hard fail** on the download sizes (200 KB code, 500 KB total); fail on load time, layout shift and blocking time (Lighthouse's stand-in for responsiveness in a lab) beyond the budget plus a small tolerance written in the check. Runs only when the website is affected, like the Screen check. Cost: GitHub minutes only.
2. **App:** a code-size check (the size of the built JavaScript bundle against the last `main`) in the same check; the app's timing tests come with the Maestro job (C6).
3. **From India, later:** a weekly or nightly run from Mumbai once there are real pages: Calibre Starter ($75 a month), or WebPageTest Pro ($15 a month) against staging if staging becomes public (C8a). Not needed for the empty pages in Round 2; a founder's spending decision when the first news page lands.
4. **After launch:** Speed Insights (already planned for Part 10) plus Chrome's India data.

### C6. 1.5b, journey tests

**The Playwright setup that exists** (`product/web/playwright.config.ts`, `product/web/e2e/`): one config, tests in `e2e/*.spec.ts`, Chromium and WebKit, against `BASE_URL` (the preview in CI, `localhost:3000` here), with the bypass headers; traces, screenshots and video off (they would record the header); one retry in CI. `screens.spec.ts` opens each page (home, privacy, terms, a 404, and the sign-in test page signed out and signed in) at every size in `viewports.ts` (13 widths, sideways, 200% text) and fails on any overflow or overlap (`layout.ts`); `layout-check.spec.ts` tests the checker itself. `global-setup.ts` and `support/test-accounts.ts` give each browser engine a staging test account, signed in through a one-time token that no email carries (blueprint section 9). It runs as the Screen check (A3). **What's missing for 1.5b:** journey tests (a user doing something, step by step), as opposed to the layout check. The first journey on the website is Google sign-in on the test page, which the signed-in screen pass already half-covers. Recommendation: a `journeys/` folder beside the screen check, run in the same job (one browser install).

**Maestro for the app's first test, run automatically:**

| Option | How | Cost for about 60 pull requests a month | Notes |
|---|---|---|---|
| **GitHub Actions with an Android emulator** | `reactivecircus/android-emulator-runner` on standard Linux runners, which have hardware acceleration ([GitHub changelog](https://github.blog/changelog/2024-04-02-github-actions-hardware-accelerated-android-virtualization-now-available/), [action](https://github.com/ReactiveCircus/android-emulator-runner)); the APK from Gradle after `expo prebuild`, or an EAS local build | About 15 to 25 minutes a run (third-party estimate: 10 to 15 minutes cold build, 1 to 3 cached, 2 to 5 to start the emulator, [source](https://helpmetest.com/blog/mobile-e2e-ci-pipeline/)); at $0.006 a minute about $7 a month, or inside GitHub Pro's 3,000 included minutes ([runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing), [plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)) | Tablet size: pick a tablet device profile (exact name not confirmed). Some report Linux emulators are less steady for Maestro (community, [repo](https://github.com/retyui/Using-GitHub-Actions-to-run-your-Maestro-Flows)) |
| Expo's own CI (EAS Workflows, `type: maestro`) | Runs on Expo's emulators; in alpha ([jobs](https://docs.expo.dev/eas/workflows/pre-packaged-jobs/), [example](https://docs.expo.dev/eas/workflows/examples/e2e-tests/)) | Not on the free plan; Starter $19 a month plus about $1.45 a run (estimate: $1 build, $0.05 a job, about $0.04 a minute), so about $60 a month ([pricing](https://expo.dev/pricing)) | Least setup; needs a paid plan and an Expo token in GitHub |
| Maestro Cloud | Maestro's own devices | $250 a device a month ([pricing](https://maestro.dev/pricing)) | Plus building the APK somewhere |
| BrowserStack App Automate | Real devices with Maestro ([docs](https://www.browserstack.com/docs/app-automate/maestro/get-started/execute-tests)) | About $199 a parallel device a month (third-party) | — |
| Firebase Test Lab | — | — | Doesn't list Maestro (not confirmed it never will) |

**Recommendation for 1.5b:** Maestro on GitHub Actions with the emulator action, with the Gradle build and the emulator snapshot cached, one phone and one tablet profile, run only when the app (or a package it uses) changes. Practically free. If the Linux emulator proves flaky after a week, switch to Expo's Maestro job (about $60 a month on Starter), a founder's spending decision. Each test becomes a required check once it's steady.

**Minutes:** with this, an app pull request adds about 15 to 25 minutes, which keeps a typical month (say 60 pull requests, a third touching the app) around 1,500 to 2,000 minutes, inside the 3,000 allowance (A3).

### C7. 1.5c, the typed API

**Neither BLUEPRINT.md nor PLAN.md picks an approach.** Both say only "one typed API that both the app and the website use" (PLAN.md section 2, "How it's built"; blueprint section 13, "built next"). Blueprint section 5 adds that the app reaches the database only through our own typed API on the server, with Supabase's Data API off. `TRACKER.md` makes the contract its own stage, before the back end, with example data from the agreement. So the choice is open, and it is 1.5c's to make.

**What exists to build on:** `@hrizzup/agreement` exports `validate()` (Ajv, JSON Schema 2020-12, plus the hidden-character check), but **no TypeScript types for the shapes** yet (`agreement/src/index.ts`); `product/web/lib/supabase/route.ts` already sets session cookies and Supabase's no-cache headers on route responses; the proxy runs only on `/sign-in-test`, which keeps public addresses cacheable (`product/web/proxy.ts`). Staging signs sign-in tokens with an ES256 key pair (blueprint section 5), so Supabase's `getClaims()` can check a token locally without a call to Supabase ([getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims)).

**The three approaches top teams use** (versions from `npm view`, 8 November 2026; ts-rest is left out: its last release was June 2025 and its repository is archived, `gh api repos/ts-rest/ts-rest`):

| Need | tRPC 11.25 | **oRPC 1.16 (recommended)** | Hono 4.13 with zod-openapi |
|---|---|---|---|
| Maturity | The most used (about 8 million downloads a week, [npm](https://api.npmjs.org/downloads/point/last-week/@trpc/server)); the Expo plus Next.js template [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo) uses it | Younger (about 5,800 stars, `gh api repos/middleapi/orpc`), weekly releases; version 2 in beta ([release notes](https://github.com/middleapi/orpc/releases/tag/v2.0.0-beta.49)) | Very mature as a server; its typed client is the smaller part |
| A contract stage before the back end | No: the server code is the contract; the closest is stub handlers | **Yes:** `@orpc/contract` defines it in its own package and `implement(contract)` builds against it ([define contract](https://orpc.dev/docs/contract-first/define-contract), [monorepo setup](https://github.com/middleapi/orpc/blob/v1.16.2/apps/content/docs/best-practices/monorepo-setup.md)) | Partly: route objects come first |
| Caching public reads at the edge | Reads are GET, but batching mixes public and private reads in one response, so the docs say to send public reads unbatched ([caching](https://github.com/trpc/trpc/blob/main/www/v11/docs/server/caching.md)); addresses carry `?input=<JSON>` | Clean GET addresses (`/stories/{id}`) ([routing](https://github.com/middleapi/orpc/blob/v1.16.2/apps/content/docs/openapi/routing.md)); each procedure sets its own cache headers ([response headers](https://github.com/middleapi/orpc/blob/v1.14.6/apps/content/docs/plugins/response-headers.md)); no batching unless added | Plain HTTP: full control |
| Caching on the device | TanStack Query integration | TanStack Query integration ([docs](https://github.com/middleapi/orpc/blob/v1.16.2/apps/content/docs/integrations/tanstack-query.md)) | No official one (not confirmed) |
| The Supabase session on both | Context built from the request (cookie or bearer) | Same ([handler](https://orpc.dev/docs/openapi/openapi-handler), [link headers](https://github.com/middleapi/orpc/blob/v1.14.6/apps/content/docs/client/rpc-link.md)) | Middleware |
| Every input checked | Any Standard Schema validator ([list](https://standardschema.dev/schema)) | Any Standard Schema validator, so our JSON Schemas can be wrapped | zod-openapi is Zod only |
| Mumbai functions | A route handler | A route handler ([Next.js adapter](https://github.com/middleapi/orpc/blob/v1.16.2/apps/content/docs/adapters/next.md)) | A route handler ([guide](https://hono.dev/docs/getting-started/nextjs)) |
| OpenAPI document (later) | Alpha only ([docs](https://trpc.io/docs/openapi)) | Generated from the contract ([spec](https://github.com/middleapi/orpc/blob/v1.14.6/apps/content/docs/openapi/openapi-specification.md)) | Yes, Zod only |
| Website server components, no HTTP trip | Yes (server caller) | Yes, `createRouterClient` ([SSR](https://github.com/middleapi/orpc/blob/v1.16.2/apps/content/docs/best-practices/optimize-ssr.md)) | In process, but still builds a request |
| Code added to the app (compressed, [bundlephobia](https://bundlephobia.com)) | about 16 KB | about 9 KB | about 8 KB |
| Pitfalls | Batching defeats the edge cache; superjson breaks other clients | GET query values arrive as text, so inputs must convert them ([limits](https://github.com/middleapi/orpc/blob/v1.16.2/apps/content/docs/openapi/client/openapi-link.md)); version 2 will need a migration | Hono 5 is coming; client types slow down as routes grow |

**Recommendation: oRPC 1.16, contract first,** because it's the only one whose contract is a separate thing, which is exactly how `TRACKER.md` works (stage 2 before stage 3, and both screens built against the contract and its example data). It also gives plain GET addresses the edge can cache, and an OpenAPI document for free. tRPC is the alternative if maturity matters more than a separate contract. Key settings for the 1.5c instructions:

1. **`product/packages/api` (`@hrizzup/api`)** holds the contract only, plus example responses built from `agreement/examples/` and a stand-in implementation that returns them. The real implementation lives in the website's server code; the app never imports it.
2. **Served at `/api/v1/…`** through oRPC's OpenAPI handler, in a route handler on Node in `bom1`. Public reads are GET with a path; writes are POST. No batching, no superjson (our shapes are plain JSON). Pin 1.16.x and read the version 1 docs (the website's docs already show version 2).
3. **Edge caching:** each public read sets `Vercel-CDN-Cache-Control` (`s-maxage` with `stale-while-revalidate`), a short browser cache, and a cache tag; writes purge by tag ([purge](https://vercel.com/docs/caching/cdn-cache/purge)). Anything personal is `private, no-store`. **Vercel's edge never caches a request with an `Authorization` header or a response that sets a cookie** ([CDN cache](https://vercel.com/docs/caching/cdn-cache)), so the app sends its token only on personal calls, and the session proxy stays off public addresses.
4. **Sign-in:** one context function reads a bearer token (the app) or the session cookie (the website) and checks it with `getClaims()`. The app keeps its session the way Supabase's Expo guide does (an encryption key in SecureStore, the session encrypted in AsyncStorage) ([guide](https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native)).
5. **Validation from our own definitions:** a small wrapper in `@hrizzup/agreement` turns each JSON Schema into a Standard Schema validator that calls the existing `validate()`, so the hidden-character checks come along. The same files feed the OpenAPI document (whether their cross-file references need bundling first: not confirmed). Types for the shapes are generated from the definitions, and the agreement's check fails if they're stale. Small request inputs (IDs, page cursors, filters) use Zod 4.
6. **The website's pages** call the API in process, wrap public reads in Next.js's `"use cache"` with the same tags as the edge, and hand the data to TanStack Query. The app keeps TanStack Query's cache on the phone (AsyncStorage persister).

Done when: the contract package exists with one example read (for instance `/api/v1/health` or a story read against example data), both surfaces call it with types, the edge caches the public read (checked by its `x-vercel-cache` header on the preview), and an invalid input is refused.

### C8. 1.5d, the app on the founder's Android phone

**The app's current setup** (`product/app/`): Expo SDK 58.0.22 with expo-router, React Native 0.88.1, one screen; `app.json` names it Hrizzup, package `com.hrizzup.app`, scheme `hrizzup`. **Nothing links it to an Expo account:** no `eas.json`, no `extra.eas.projectId` or `owner` in `app.json`, no `expo-dev-client` dependency, no Expo login on this Mac (`~/.expo` absent), no `eas` command, and no Expo token in Doppler (`hrizzup-tools` and `stg`: no secret name containing EXPO or EAS; names only were listed). No Android SDK, emulator or `adb` on this Mac either.

**The simplest professional way:** Expo's build service (EAS Build) makes the build in the cloud, and the founder installs it from a link or QR code.

- A **development build** (`developmentClient: true`, `distribution: "internal"`, with `android.buildType: "apk"` set explicitly) is what EAS documents ([create a build](https://docs.expo.dev/develop/development-builds/create-a-build/), [eas.json](https://docs.expo.dev/build/eas-json/), [internal distribution](https://docs.expo.dev/build/internal-distribution/)). It needs a running dev server to load the app's code: on the same Wi-Fi as the Mac, or through `expo start --tunnel` ([use development builds](https://docs.expo.dev/develop/development-builds/use-development-builds/), [Expo CLI](https://docs.expo.dev/more/expo-cli/)).
- **The founder can't run a dev server himself,** so 1.5d should also make a **preview build** (internal distribution, APK, its code inside the build), which opens on its own anywhere. Recommendation: the preview build is what the founder installs; the development build is for Claude Code's sessions when he is at the Mac.
- **No device registration on Android** (only iPhones need it), and the link works for anyone holding it unless "Unauthenticated access to internal builds" is turned off ([internal distribution](https://docs.expo.dev/build/internal-distribution/)). **No Google Play Console account is needed** for this: the internal-distribution flow never involves Play (inference from Expo's pages; no page says so in words).
- **Not Expo Go:** Expo calls it a playground, without custom native modules ([Expo Go](https://docs.expo.dev/workflow/expo-go/)), and its store copies lagged several SDKs behind in 2026 ([changelog, May 2026](https://expo.dev/changelog/expo-go-and-app-store-may-2026)).
- **EAS Update** later sends code-only changes to builds already installed ([EAS Update](https://docs.expo.dev/eas-update/introduction/)).

**Cost** ([expo.dev/pricing](https://expo.dev/pricing)): the free plan gives 15 Android builds a month, low-priority queue (waits of 90 minutes or more at peak), 45-minute build limit. Starter is $19 a month plus usage (high priority, $45 of build credit; about $1 per Android build). Recommendation: start free; move to Starter if the queue holds up work.

**What the founder does** (once, after Claude Code shares the link):

1. Create a free Expo account (expo.dev), or approve the one Claude Code proposes, and create an access token for Claude Code ("robot" token) to store in Doppler `hrizzup-tools`. Claude Code can't create accounts itself.
2. On the phone, open the link (or scan the QR code) and download the app.
3. When Android asks, allow the browser to "install unknown apps" (exact wording of the menu: not confirmed; it varies by phone maker).
4. If Play Protect offers to scan the app, either choice works ([Google Play Help](https://support.google.com/googleplay/answer/2812853)).
5. Open Hrizzup.

**Google's developer verification** ([developer.android.com/developer-verification](https://developer.android.com/developer-verification), [FAQ](https://developer.android.com/developer-verification/guides/faq)): enforced from 30 September 2026 only in Brazil, Indonesia, Singapore and Thailand, and only for apps from participating stores; "expanded globally" in 2027 (month not given). **India isn't named, so it isn't enforced there today** (not confirmed beyond Google's own lists). A downloaded APK isn't covered "yet", and installs over ADB never need verification. **So nothing affects 1.5d now.** Before the 2027 rollout, the founder's verified identity (the Play Console account he needs anyway, step 0.4) must register every package name testers install, with its signing key, including any separate preview or development package. Recommendation: add that to the runbook's pre-launch checklist.

**Can the app reach staging's API? Not today.** Staging sits behind Vercel's login: `https://staging.hrizzup.com/` and `/api/health` both answer **302 to `vercel.com/sso-api`**, whatever the client (checked with `curl`, browser and Android app user agents, 8 November 2026). The project's protection is `all_except_custom_domains` (`infra/vercel/project.json`), which leaves only production's domains public (blueprint section 6). An app can't sign in to Vercel, and shipping the automation bypass secret inside an APK would hand anyone who unpacks it the key to every preview and to staging. **This needs a decision before 1.5d's preview build can show staging's data** (the empty first app doesn't need data, so it doesn't block the first install). The options, with Vercel's terms, are in C8a below.

#### C8a. Letting the app reach staging

| Option | How | Cost | Trade-off |
|---|---|---|---|
| **A protection exception for `staging.hrizzup.com`** | Vercel's Deployment Protection Exceptions make one domain public, for existing and future deployments ([exceptions](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions)) | **Conflicting sources:** Vercel's pricing page lists exceptions at no charge on every plan ([usage and pricing](https://vercel.com/docs/deployment-protection/usage-and-pricing)), while the exceptions page has said they need Enterprise or the Advanced Deployment Protection add-on, no longer sold. Whether it accepts a custom-environment domain: not confirmed | Staging becomes a public site. It holds no real user data, every email route already has Turnstile and rate limits, and our own sign-in guards anything private. Previews stay behind login |
| Change the protection scope | — | — | No scope makes staging public while keeping previews private ([deployment protection](https://vercel.com/docs/deployment-protection)); it's project-wide, so it also reaches production and must go through the release pipeline (CLAUDE.md). Not recommended |
| Ship the bypass secret in the app | — | — | **No:** one secret opens every deployment and skips the bot challenge ([bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)), and anything built into an app is readable in plain text ([Expo env vars](https://docs.expo.dev/guides/environment-variables/)) |
| A separate public staging API host | A second address (or Vercel project) for the API only | Possibly a second project to run | More moving parts |
| Development build talks to the Mac | Same Wi-Fi as the Mac's `next dev` (which uses staging's data through Doppler `dev`); or `--tunnel` | Free | Works only while the Mac is running; Android refuses plain `http://` to a local network address unless allowed for that address ([network security config](https://developer.android.com/privacy-and-security/security-config)) |

**Recommendation:** for 1.5d itself, no change is needed (the first app shows no data; day-to-day work uses the Mac over Wi-Fi). Before the first app join (TRACKER stage 6), **make staging's domain public with a protection exception**, if Vercel accepts it on Pro at no charge (a two-minute check in the dashboard or API), with `robots` set to refuse search engines on staging. This is a founder's decision: staging stops being private. Fallback: a separate public API host.

### C9. 1.7a, Manifold's maths

**Source:** [github.com/manifoldmarkets/manifold](https://github.com/manifoldmarkets/manifold) at commit `79997aafcf0d8d826eb51dad5c7712e63d35de65` (5 November 2026, the same commit as `docs/research/manifold.md`). All paths below are under `common/src/`; line counts from `wc -l`. A helper copied the files into a scratch folder outside the repository and ran them; Claude Code spot-checked the commit, the licence, the fee constants, the line counts, a bug quoted below, and re-ran the trimmed set's tests itself (**11 files, 158 tests, all passing under Vitest 5.0.5**, the version in our lockfile).

**The maths to bring** (the only outside package is `lodash`):

| File | Lines | What it does |
|---|---|---|
| `calculate-cpmm.ts` | 1,734 | The pool maths (Manifold's CPMM): probability, shares for a stake, fees, buying, limit-order matching (`computeFills`), selling, amount to reach a probability, adding and removing liquidity; `MINIMUM_LIQUIDITY = 100` |
| `new-bet.ts` | 470 | `getBinaryCpmmBetInfo`: a yes/no buy or limit order |
| `sell-bet.ts`, `sell-preview.ts` | 382, 20 | Selling, and the sell panel's numbers |
| `redeem.ts` | 64 | Yes and No held together cancel out |
| `payouts.ts`, `payouts-fixed.ts`, `calculate-fixed-payouts.ts` | 208, 275, 70 | Settlement: Yes, No, a set probability ("MKT"), cancel (everyone gets back what they put in, minus what they sold) |
| `fees.ts` | 45 | The taker fee `k·p·(1−p)·shares` and how it splits |
| `calculate.ts`, `calculate-metrics.ts`, `contract-metric.ts` | 532, 691, 62 | Probabilities after a bet, profit, and each user's position, which payouts read |
| `bet.ts`, `liquidity-provision.ts` | 107, 20 | Types |

**Brought only because they're imported:** `calculate-cpmm-arbitrage.ts` (2,454 lines, for markets with several answers: keep it unchanged and unused, so it stays easy to compare with Manifold), `answer.ts` (168), `util/math.ts`, `util/algos.ts`, `util/object.ts`, `util/time.ts`. **Trim or replace:** `contract.ts` (802 lines; untrimmed it pulls in about 100 files, including a rich-text editor; better, a slim `Market` type of our own with the 14 fields the maths reads); `api/utils.ts` (only for an error class, which chains into a 5,436-line schema file: replace with a 10-line local class); `util/random.ts` (don't take it: part cites a Stack Overflow answer under CC BY-SA; use database IDs or `crypto.randomUUID()`). About 22 files and one stub, roughly 8,600 lines.

**Tests:** Manifold uses Jest 29 with ts-jest (`common/jest.config.js`), with `describe`, `it` and `expect` as globals; no snapshots, mocks or fake timers. Under Vitest they run unchanged with `globals: true`, or with an explicit `import { describe, expect, it } from 'vitest'` (our `agreement/` tests' style; recommended). Two optional probes use `jest.setTimeout`, which becomes `vi.setConfig({ testTimeout })`. The 158 that pass in the trimmed set: `calculate-cpmm.test.ts` 41, `calculate-cpmm-arbitrage.test.ts` 35, `sell-preview.test.ts` 16, `sell-bet.test.ts` 2, `liquidity-withdrawal.test.ts` 6, `util/algos.test.ts` 6, two answer tests 10, two multi-answer guard tests 16, and `conservation-grid.test.ts` 26 (money is never created or lost; needs `new-contract.ts`, or our own small market-creation helper). **The gap:** no Manifold test covers the yes/no buy, sell, redeem or payout functions directly, so 1.7a should add our own conservation tests: buy, limit order, sell, redeem, then settle Yes, No, a set probability and cancel, checking money in equals money out.

**Manifold-specific things to replace:**

- **Fees are zero at Manifold today** (`TAKER_FEE_CONSTANT = 0`, `FLAT_TRADE_FEE = 0` in `fees.ts`; spot-checked). Our own fee goes here; the rate is a decision (none is in PLAN.md for markets; perps have one).
- **Loans** (Manifold lends against positions): `loanAmount`, `loan`, `marginLoan`, `getLoanPayouts`. Set to zero or remove.
- **Other Manifold features** to leave switched off: "STONK" and pseudo-numeric markets, a second currency for sweepstakes, leagues and ranked profit, subsidy pools, bonuses and antes.
- **The clock:** the maths calls `Date.now()` itself (`calculate-cpmm.ts:344`, `:456`). Pass the time in, so a trade inside one database transaction uses one time and tests repeat exactly.
- **Logging:** a few `console.log` calls to remove.
- **A real Manifold bug** to fix as we copy: two error messages use `'…${betAmount}'` in single quotes, so they print the placeholder instead of the number (`calculate-cpmm.ts:339`, `:342`; spot-checked).

**Fitting our rules** (measured with our TypeScript 6.0.3, Biome 2.6.3 and `product/packages/tsconfig/library.json`):

- **ESM:** named imports from `lodash` fail under plain Node ESM; use `lodash-es` (the same code as ES modules). Rewrite `common/x` imports to relative `./x.ts`.
- **Type imports:** 85 need `import type`; Biome fixes 84 automatically.
- **"Possibly undefined" checks** (`noUncheckedIndexedAccess`): about 145 errors in the source and 168 in the tests. Recommendation: switch that one setting off in this package's own `tsconfig`, with a comment that it's upstream code kept close to Manifold's; rewriting about 300 lines of proven maths is the riskier choice.
- **Biome:** formatting rewrites itself; then 13 lint errors (fix them) and about 50 warnings (a Biome override for the copied folder that softens style-only rules).

**Where it goes:** a new package, for example `product/packages/market-engine` (`@hrizzup/market-engine`), with Manifold's `LICENSE` beside the code and an entry in `THIRD_PARTY_NOTICES.md` naming the commit. This is "market maths", so the change is **risky**-sized: full tests plus AI review, opened as a draft (CLAUDE.md).

**Licence:** the only licence file is `LICENSE.md` at Manifold's root: MIT, "Copyright (c) 2022 Manifold Markets, Inc." (spot-checked). Keep the full text, with the permission paragraph and the warranty disclaimer.

**Perps maths, for step 3.4 later** (`common/src/perps/`, about 3,650 lines in 14 files, no lodash; `zod` only through `oracle-health.ts`): `amm.ts` (1,409 lines: leverage, liquidation price, funding rate from the long-short imbalance, liquidations, scaling winners down when the pool runs short, open and close, a 10× open-interest cap, solvency checks), `funding.ts` (funding every hour), `fees.ts` (opening fee 10 basis points by default, capped), `pnl.ts`, `orders.ts` (fill at the next price), `oracle.ts` and `oracle-health.ts` (price freshness, median of several feeds), `close-amount.ts`, `escrow.ts`, `trading-mode.ts` (on, reduce-only, halted: our off switch), `format.ts`, `position.ts`. Leverage is stored per market (`Perp.maxLeverage`), not as a constant, which suits our 10× cap. There's no separate "mark price": positions are valued at the outside feed's last price. **Tests:** 12 matching files, 391 tests, all passing under Vitest unchanged (helper's run; not re-run by Claude Code). Under our strict settings: 88 type errors and 1 Biome error. Design notes: `backend/shared/src/perps/README.md`.

---

## D. Decisions for Round 2

### D1. Keeping sign-in to email codes (and Google) only

**Supabase's password hook isn't on our plan.** The Password Verification Attempt hook is "Teams and Enterprise" only; Pro gets the Custom Access Token and Send Email hooks ([Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks), [pricing](https://supabase.com/pricing); spot-checked). Our organisation is on Pro (blueprint section 2). The blueprint's plan (section 9: block passwords "with Supabase's password hook") therefore needs replacing.

**There's no switch** that turns passwords off while email codes stay on: codes live inside the Email provider, and turning off email sign-ups switches codes off too ([passwords](https://supabase.com/docs/guides/auth/passwords), [CLI settings](https://supabase.com/docs/guides/local-development/cli/config), [issue 40582](https://github.com/supabase/supabase/issues/40582)). Putting Auth behind our own server doesn't help either: the project's `/auth/v1` address stays reachable directly with the publishable key ([community write-up](https://www.guardlayer.io/blog/supabase-signups-not-allowed-for-otp); the reasoning is structural).

**What works on Pro:**

| Way | What it does | On Pro? |
|---|---|---|
| **Custom Access Token hook** | Runs before every session is issued and receives `authentication_method` (`password`, `otp`, `oauth`, `email/signup`, `token_refresh` and others). Returning an error refuses the session ([hook docs](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook); spot-checked) | Yes |
| Refuse stored passwords (a trigger on `auth.users`) | Raises an error whenever a password is set, so nobody can ever have one | Possible; no official source, and whether Supabase allows it: not confirmed |
| Before User Created hook | Can refuse a sign-up, but can't see whether it carries a password ([docs](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)) | The hooks page says yes, the pricing page doesn't list it: not confirmed. Doesn't solve this anyway |
| Strict password rules (in place) | At least 12 characters, leaked passwords refused (`infra/supabase/auth/settings.json`) | Yes; a fallback, not a block |
| Upgrade to Team ($599 a month, [pricing](https://supabase.com/pricing)) for the password hook | Adds nothing the Custom Access Token hook doesn't | Not needed |

**Recommendation for D1:** block passwords in layers, all on Pro: (1) no password field anywhere on the website or in the app; (2) **a Custom Access Token hook, written as a migration, that refuses any session whose `authentication_method` is `password`**; (3) Database-check tests proving a password sign-in fails while email codes, Google and token refresh still work (check what new email-code sign-ups arrive as, `email/signup` or `otp`, before refusing anything else). Keep the hook tiny: if it errors, every sign-in fails. Optionally later, the trigger that refuses stored passwords, after a staging test. The change is risky-sized (login and database structure), so it goes through AI review; it belongs to 1.6a.

### D2 to D4. Market data

PLAN.md step 1.2 asks for a named source for every market subject, with its cost, including a live Bitcoin price every few seconds for perps; the markets settle in US dollars (agreement, decision D7). Which subjects D2, D3 and D4 each cover is the Product chat's labelling; this section goes subject by subject. Prices and terms were read on the providers' own pages on 8 November 2026 by a helper; Claude Code spot-checked Pyth and EIA. Where a provider's page refused the helper, the term is marked "not confirmed".

**The big finding:** the free feeds straight from exchanges (Coinbase, Kraken) limit their data to your own use, so a public page that shows and settles on their prices needs a licensed source instead. Every sports provider either restricts "betting" use or leaves the rights-holder question to us. Our markets are play money that can't be cashed out, which India's 2025 gaming law treats as an "online social game", not a money game ([Mondaq summary](https://www.mondaq.com/india/social-media/1785870/the-promotion-and-regulation-of-online-gaming-act-2025-and-the-promotion-and-regulation-of-online-gaming-rules-2026)); still, each vendor should confirm in writing that a free-to-play forecasting game is allowed before launch.

#### Bitcoin (a price every 5 seconds is about 518,000 calls a month)

| Source | Price | Updates | Public display and settlement | URLs |
|---|---|---|---|---|
| **Pyth** | Pyth Pro Starter $500 a month (1 s, display rights, no redistribution); Pro from $2,500. Pyth Core through the public Hermes service: free, 10 requests every 10 seconds per address, "not recommended for production", and an API key needed from 18 August 2026 (whether the key is free: not confirmed) | Up to every 50 ms | Built to settle financial contracts; Kalshi uses Pyth for its commodity markets | [plans](https://app.pyth.com/plans), [Hermes](https://docs.pyth.network/price-feeds/core/api-instances-and-providers/hermes), [Kalshi](https://crypto.news/pyth-plugs-into-kalshis-new-commodities-hub-as-oracle-backbone/) |
| **CoinMarketCap** | Free Basic; Builder $29 (15 s); Startup $79 (real time, 450,000 credits); Growth $299 (2 million) | Real time from Startup | Commercial use on every plan, inside one product, no resale; settlement wording not confirmed | [pricing](https://coinmarketcap.com/api/pricing/) |
| CoinGecko | Demo free; Basic $35; Analyst $129 | 10 to 60 s | Commercial licence on paid plans, credit required; **its terms bar use "for or to promote gambling"** | [pricing](https://www.coingecko.com/en/api/pricing), [terms](https://www.coingecko.com/en/api_terms) |
| Coinbase, Kraken | Free | Live | Own use only; no showing to third parties (Coinbase's page refused the helper: not confirmed in full) | [Kraken terms](https://www.kraken.com/legal/global-terms), [Coinbase terms](https://www.coinbase.com/legal/market_data) |
| Binance | Free | Live | Refuses some cloud addresses (a report from Vercel); AWS Mumbai not confirmed | [report](https://community.vercel.com/t/binance-api-calls-on-vercel/29895) |
| Chainlink Data Streams | Through sales | Under 1 s | Polymarket settles its Bitcoin markets on it | [docs](https://docs.chain.link/data-streams) |

For comparison, Kalshi settles Bitcoin on a 60-second average of the CF Benchmarks index ([Kalshi help](https://help.kalshi.com/markets/popular-markets/crypto-markets)).

#### Gold or oil

| Source | Subject | Price | Updates | Terms | URLs |
|---|---|---|---|---|---|
| **US EIA open data** | Brent (RBRTE), WTI (RWTC) | Free (free key) | **Daily prices, published once a week** | US government, free to reuse with credit | [docs](https://www.eia.gov/opendata/documentation.php), [reuse](https://www.eia.gov/about/copyrights_reuse.php) |
| FRED | The same EIA series | Free | Daily, a day behind | Public domain, citation requested; apps must say FRED doesn't endorse them | [series](https://fred.stlouisfed.org/series/DCOILBRENTEU), [terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html) |
| LBMA Gold Price (ICE) | Gold, official | Licence from $10,000 a year; settling products on it from $20,000 a year | Twice a day; free only 4 hours late | Licence needed to settle on it or show it live | [licensing](https://www.ice.com/iba/licensing) |
| **GoldAPI.io** | Gold | Pro $99, Business $169 a month | Real time | Showing it to users allowed, no resale; prices "indicative", no service promise | [plans](https://www.goldapi.io/), [terms](https://www.goldapi.io/blog/terms-of-service) |
| Metals.dev | Gold | $1.79 to $99.99 a month | 60 s | Terms not confirmed | [pricing](https://www.metals.dev/pricing) |
| Alpha Vantage, Twelve Data | Both | From $49.99, $79 | — | Personal use only, or no external display without permission | [Alpha Vantage](https://www.alphavantage.co/documentation/), [Twelve Data terms](https://twelvedata.com/terms) |

**Gold or oil:** oil has the cleaner, cheaper, official settlement price (EIA, free), but it arrives once a week, so oil questions could only be "Brent's price on a date, settled after the next weekly release", and a live oil price on the page would still need a paid vendor. Gold's official price costs at least $10,000 to $20,000 a year; its affordable sources are vendors' own quotes. **Recommendation: gold**, as the brief already suggests, settled on one named vendor's quote at a fixed time each day (GoldAPI.io), because the markets are meant to run continuously with daily windows; a weekly-lagged oil market can be added later at no data cost.

#### The best AI model

| Source | Price | Updates | Terms | URLs |
|---|---|---|---|---|
| **LMArena ("Arena") leaderboard dataset** on Hugging Face | Free | Dated snapshots (latest 4 November 2026): rank, rating, confidence, votes | **CC BY 4.0**: reuse, including commercial, with credit. Don't scrape arena.ai itself: its site terms forbid it | [dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset), [announcement](https://arena.ai/blog/arena-leaderboard-dataset/), [site terms](https://help.arena.ai/articles/5629909088-terms-of-use) |
| Artificial Analysis | Free, 100 requests a day | Not confirmed | Credit required; commercial rights not confirmed | [docs](https://artificialanalysis.ai/data-api/docs) |
| OpenRouter rankings | Free | Continuous | CC BY 4.0, but measures **use**, not quality | [docs](https://openrouter.ai/docs/cookbook/administration/data-api) |
| Hugging Face Open LLM Leaderboard | — | Retired March 2025 | — | [post](https://huggingface.co/posts/burtenshaw/596060753193040) |

#### Cricket

| Source | Price | Coverage and updates | Terms | URLs |
|---|---|---|---|---|
| **Sportmonks Cricket** | Major €29 a month (IPL and big T20 leagues); World €75 (adds Tests, ODIs, ICC events); 14-day trial | 2,000 calls an hour per endpoint; live refresh speed not stated; no service promise | No resale; licensed per domain; a "personal and non-commercial" clause on site material to confirm | [pricing](https://www.sportmonks.com/cricket-api/plans-pricing/), [terms](https://www.sportmonks.com/terms-of-service/) |
| EntitySport (Indian) | $150 (internationals), $250 (adds T20 leagues), plus 18% GST | 0.5 to 4 million calls a month | Not confirmed; built for fantasy apps | [pricing](https://www.entitysport.com/pricing/) |
| CricketData.org (CricAPI) | Free to $64.99 | Minutes behind on free | **Personal, non-commercial; no public display without permission; no gambling content.** Ruled out | [terms](https://cricketdata.org/terms-of-use/) |
| Roanuz | Not confirmed | Live push | Not confirmed | — |

The ICC's official betting data is sold only through Stats Perform for 2024 to 2027 ([Sportcal](https://www.sportcal.com/betting/icc-in-four-year-betting-data-rights-tie-up-with-stats-perform/)): another reason to get the vendor's written yes.

#### Football

| Source | Price | Coverage and updates | Terms | URLs |
|---|---|---|---|---|
| **API-Football (API-SPORTS)** | Free 100 requests a day; Pro about $19 (not confirmed; page refused the helper) | **Live every 15 seconds on every plan**; one call returns every live match | Betting or mass-media use "may require additional licences" from rights holders (search excerpt) | [site](https://api-football.com), [pricing](https://www.api-football.com/pricing) |
| football-data.org | Free (12 competitions, delayed); €12 with live scores; €49; €199 | 10 to 120 calls a minute | Credit required | [pricing](https://www.football-data.org/pricing) |
| Sportmonks Football | €29 (5 leagues), €99, €249 | 2,000 to 5,000 calls an hour | As cricket | [pricing](https://www.sportmonks.com/football-api/plans-pricing/) |

#### Recommendation for D2 to D4

| Subject | Primary | Backup | Monthly cost (primary) | Why |
|---|---|---|---|---|
| Bitcoin | **Pyth**: first ask whether Pyth Core's key is free for a public app (one feed every 5 s fits its public limit); otherwise **Pyth Pro Starter** | CoinMarketCap Builder ($29), used only if Pyth fails | $0 if Core is free, else $500 | Settlement-grade, every second, display rights. Cheaper licensed alternative: CoinMarketCap Growth at $299 (or Startup at $79 if we poll every 6 seconds, which stays under 450,000 credits) |
| Gold (not oil) | **GoldAPI.io Pro** (or Pyth's gold feed, if Pyth's plan covers it: not confirmed) | Metals.dev ($20) | $99 | Allows showing to users; real time. The official price is uneconomic |
| Oil (if ever) | EIA (free) | FRED (free) | $0 | Official; weekly settlement only |
| Best AI model | **Arena's leaderboard dataset** (free, CC BY 4.0) | Artificial Analysis (free; commercial rights to confirm) | $0 | Open licence, dated snapshots, no scraping. Question: "Which model leads Arena's text leaderboard in its last snapshot of the month?" |
| Cricket | **Sportmonks Cricket World** | EntitySport Pro ($250 + GST) | about €75 ($87) | IPL and internationals, clear prices, no gambling ban |
| Football | **API-Football Pro** | football-data.org live (€12) | about $19 | Live every 15 seconds, all leagues |

**Cost:** about **$205 a month** for the primaries if Pyth Core is free (gold $99, cricket about $87, football about $19), about **$705** with Pyth Pro Starter; about $1,020 with every backup. **Nothing needs paying during Round 2:** every recommended source has a free tier or trial for building on staging (Pyth's public service, GoldAPI.io's free 150 requests, Sportmonks' trial, API-Football's free tier, the free datasets). Recommendation: build the data job against them, sign the paid plans before the markets open to visitors, and before signing send each vendor one written question ("a free-to-play forecasting game, no stakes, prices shown publicly and used to settle: allowed?"). The founder opens each paid account with a spending cap (PLAN.md section 6).

---

## Summary: ready, blocking, founder only

| | Item | Detail |
|---|---|---|
| **Ready** | The 8 November decisions | #32, #33 and #34 merged; PLAN.md, TRACKER.md, the status file and the briefs agree (A1) |
| **Ready** | Parallel worktrees | Install, Doppler, builds and unit tests work side by side; only the 1.5 session runs dev servers and the local database (B4) |
| **Ready** | Previews for automated checks | The bypass header already works for the Screen check; Lighthouse uses the same (C5) |
| **Ready** | 1.5a | Budgets set (blueprint section 14); recommended: Lighthouse CI on GitHub's runner, hard fail on sizes, median of 5 for timings; no new account (C5) |
| **Ready** | 1.5b | Playwright in place; Maestro on GitHub Actions with an emulator, practically free (C6) |
| **Ready** | 1.5c | Nothing decided in the plan, so 1.5c chooses; recommended: oRPC 1.16, contract first, in `product/packages/api` (C7) |
| **Ready** | 1.7a, as code | 22 Manifold files plus a stub at commit `79997aa`; 158 tests pass under our Vitest; known edits listed (C9) |
| **Ready** | Versions | Current or a patch behind; Node 26, TypeScript 7, pnpm 12 and Supabase CLI 3 are later, separate changes (A2) |
| **Blocks Round 2** | 1.7a starts before a listed need | PLAN.md says 1.7 needs the agreement's first half, which is Draft. Split 1.7 (1.7a, the maths, needs only 0.6) in a PLAN.md change the founder asks for, or wait for the sign-off (A1) |
| **Blocks 1.5d** | An Expo account | None exists; 1.5d's build needs one, and a token for Claude Code in Doppler `hrizzup-tools` (C8) |
| **Blocks a later step, not Round 2** | Staging behind Vercel's login | The app can't reach staging's API; needed by the first app join (TRACKER stage 6), not by the empty first app (C8a) |
| **Blocks 1.6a, not Round 2** | The password hook | Team plan only; D1's replacement (an access-token hook) goes into the blueprint and 1.6a (D1) |
| **Founder only** | Create the Expo account | And an access token for Claude Code, stored in Doppler `hrizzup-tools` (Claude Code can't create accounts) (C8) |
| **Founder only** | Install the app on his phone | Open the link, allow "install unknown apps" for the browser, open Hrizzup (C8) |
| **Founder only** | Approve splitting step 1.7 | A PLAN.md change (A1) |
| **Founder only** | D1 | Approve blocking passwords with the access-token hook on Pro instead of upgrading to Team ($599 a month) (D1) |
| **Founder only** | D2 to D4 | Approve the sources; open paid accounts with spending caps before markets open to visitors (about $205 to $705 a month); nothing to pay during Round 2 (D2 to D4) |
| **Founder only** | Staging public or not | Whether `staging.hrizzup.com` becomes public (a protection exception), before the first app join (C8a) |
| **Founder only** | Spending on India-located checks | Calibre ($75 a month) or WebPageTest Pro ($15) once real pages exist; Expo's Maestro job (about $60) only if GitHub's emulator is flaky (C5, C6) |
| **Founder only** | GitHub's usage this month | Readable only in his GitHub billing page (A3) |
| **Founder only, 2027** | Google's developer verification | Register the app's package names with his verified identity before the global rollout (C8; for the runbook's pre-launch checklist) |
