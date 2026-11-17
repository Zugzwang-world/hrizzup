# Faster checks: where the minutes go

> Round 6, relay R4, 17 November 2026, for the founder's answer 3 (`docs/social/spec.md`, section 17). Research only: no check, workflow or setting changed. The founder approves proposals in the Product chat; a later relay applies them. Numbers come from GitHub's record of the runs; estimates say "about". Outside pages were read as data.

**In short:** after each push, the six required checks take a median 19.1 minutes; 9 pushes in 10 finish within 21.7 (the "p90" used throughout). In 50 of 55 pushes the Screen check finishes last: about 165 tests, two at a time, on one machine. Almost none of that is waiting, so the cut is the same work on several machines at once. Six proposals keep every test and budget. Together they cut a push's median wait to about 7.5 minutes (p90 14.6, pushes that rebuild the app), a pull request's wait on checks from 31.7 to about 13.8 minutes on average (median 21.8 to 12.0), and the median wait from last push to merge from 19.9 to about 7.9. Four of the six touch one of the founder's rules and need his yes.

## 1. Method and data

- **Data:** the last 30 merged pull requests, #110 to #144 (merged 10 to 17 November 2026): 99 pushes, and every run, attempt, job and step on their branches with its times (GitHub's API). A job listed again under a later attempt without re-running counts once. Per-test times come from four Screen check logs (#129, #137, #138, #144); Lighthouse runs and app flows from #144; the app build from #137.
- **Required checks:** six, not the four CLAUDE.md lists: Secret check, Quick checks, Database check, Screen check, Speed check and App journeys, "up to date" off (GitHub's API, 17 November, as `docs/setup.md` records).
- **Critical path:** a push to the last of its six required jobs finishing (first attempt): what the founder waits for, on the 55 pushes whose six jobs all finished. **Machine minutes:** all jobs' minutes added up; free while the repository is public. Early exits (a check finding its part untouched passes in half a minute) are counted apart.
- **Estimates:** each push is replayed with the changed jobs rebuilt from its own measured steps: Screen tests at 0.39 of today's time (0.335 with proposal 6), Speed pages at a third plus 0.12 min, App journeys 3.1 min shorter, the browser step at most 0.4 min, 0.3 min per joining job. Shapes were steady (Quick checks gained seconds of steps at #128; App journeys one deciding step after #110's first runs).

## 2. Where the minutes go

**The six required checks** (runs on the 30 pull requests; minutes, median with p90 in brackets; 2,207 machine-minutes in all):

| Check | Runs doing the work | Runs that stopped early | Machine minutes |
|---|---|---|---|
| Screen check | 53: 19.2 (21.6) | 6: 0.5 | 1,028 |
| Speed check | 42 website: 9.9 (13.0); 21 website and app: 11.8 (12.9) | 5: 0.6 | 635 |
| App journeys | 11 building the app: 17.4 (18.2); 12 reusing it: 11.4 (12.2) | 49: 0.5 | 350 |
| Database check | 30 building a database: 3.2 (4.7) | 45 from Turbo's cache: 0.5 | 126 |
| Quick checks | 76: 0.7 (0.9) | | 55 |
| Secret check | 100: 0.1 (0.2) | | 13 |

**Inside the three long checks:**

| Check | Where its time goes |
|---|---|
| Screen check (#144: 166 tests, two at a time, 20.0 min) | Screen sizes, 48 tests: 20.2 test-minutes (WebKit 12.2, Chromium 8.1). Journeys that never open a browser, 32 tests (16 per browser): 14.3. Journeys in a browser, 80 tests: 4.6. Longest test 84 s. Setup: median 1.4 min, 0.6 of it the browsers and their system libraries |
| Speed check (#144: 11.5 min) | 18 pages, each 5 Lighthouse runs (6 to 9 s) and a dark-scheme contrast run (5 to 7 s), after one uncounted warm-up; the self-test 0.4 min |
| App journeys (#144: 7.9 min of journeys) | Emulator from its snapshot 4 s; install and waiting for Play services 1.2 min; phone flows 3.2; tablet flows 3.1; cold start 0.25. Building the app (#137): 5.5 min, mostly native (C++) compiling, which Gradle's cache doesn't keep |

**Waiting versus working:**

| Waiting for | Measured |
|---|---|
| A free machine | Median 2 s, p99 5 s; at most 26 jobs at once (GitHub Pro runs 40) |
| Vercel's preview | Median 0 s inside the checks. Vercel reports a preview only once built (20 s to 1.5 min); it's ready about 0.6 min after a push, while the jobs are still setting up. Not on the critical path |
| Ubuntu's mirrors | Every Screen run downloads and installs 181 system packages (114 MB) for the browsers: under a minute normally, but 4 to 28 minutes in 8 of 54 runs on 10 and 11 November, and #140's push needed three more attempts |
| Nothing | The rest is work |

**Pushes per pull request:**

| Pushes | Count |
|---|---|
| Ran to the end | 55: 29 first runs, 6 after a failed check, 20 after a passing push |
| Replaced by a newer push and cancelled automatically | 43, 23 of them within a minute (usually the records commit that follows opening the pull request) |
| Cancelled in the mirror outage, then re-run | 1 (#140's last push) |
| Waiting on checks per pull request | 31.7 min on average, median 21.8 |
| Last push to merge | Median 19.9 min (27 of 30: #139 merged two hours after its checks, #140 needed re-runs, #144 merged 6 minutes after) |

**Also:** GitHub's cache holds 10.86 GB against its free 10 GB (beyond that it drops the least recently used); nine copies of the package store take 3.8 GB. After a merge, off every pull request's path: App journeys on main 15.7 min, Staging 1.4 min.

## 3. The proposals, biggest saving first

Minutes of critical path over the 30 pull requests (average per pull request in brackets); machine minutes from the same replay, both on top of the proposals above. Order matters: while the Screen check finishes last, cutting another saves nothing, so 3 and 4 count only after 1; applied third, the Speed check saves more than App journeys (53 against 37). 31 of proposal 5's 39 minutes come from the 10 November mirror outage; on a normal day it saves about 8, less than proposal 6.

| # | Proposal | Saves on its own | Saves on top of those above | A push's median wait (p90), with those above | Machine minutes, on top |
|---|---|---|---|---|---|
| 1 | The Screen check on four machines | 288 (9.6) | 288 (9.6) | 12.2 (18.2) | +592 |
| 2 | The preview checks skip a change that can't reach the website *(founder's rule)* | 127 (4.2) | 80 (2.7) | 11.4 (17.8) | −391 |
| 3 | The Speed check on three machines *(founder's rule)* | 0 | 53 (1.8) | 9.1 (17.8) | +168 |
| 4 | App journeys' two sizes on two machines *(founder's rule)* | 3 (0.1) | 55 (1.8) | 8.9 (14.7) | +228 |
| 5 | The browsers' system libraries from GitHub's cache | 95 (3.2), 82 from one outage | 39 (1.3), 31 from one outage | 8.4 (14.6) | −207 |
| 6 | Journeys that never open a browser run once *(founder's rule)* | 129 (4.3) | 22 (0.7) | 7.5 (14.6) | −147 |
| | **All six** | | **537 (17.9)** | **7.5 (14.6)** | **+243 (+11%)** |
| | Only 1 and 5 (no founder's rule) | | 357 (11.9) | 11.4 (17.7) | |
| | 1, 2 and 5 | | 395 (13.2) | 11.1 (17.7) | |
| | 1 balanced by test times (upgrade) | | 38 more | 5.5 (14.6) | |

| Kind of push (median wait) | Today | After all six |
|---|---|---|
| Website | 19.3 | 7.4 |
| Website and app, app rebuilt | 19.9 | 14.6 |
| Website and app, built app reused | 19.2 | 8.5 |
| Proposal 2's database pull requests | 16.7 | 3.9 |

**The required checks keep their names, so the ruleset doesn't change.** Where a check splits across machines, a short job with its exact name joins the parts. It runs with `always()` and fails unless every part's result is exactly `success`, so a skipped or cancelled part fails it: GitHub counts a skipped required job as passed, and a job that only waits for its parts is skipped when one fails (GitHub's docs, "Status checks"). Each part decides itself whether the change touches it, as today; a change to `.github/workflows` or `.github/scripts` still runs everything.

### 1. The Screen check on four machines

- **What:** four machines each run a quarter of the tests with Playwright's own split (`--shard`), each with today's setup: same preview, both browsers, two tests at a time, the names-only key check, its own run key and accounts. No test runs in serial mode, so any test can go to any machine. The joining job confirms the parts add up to the full test list and merges their screenshots into the one "screenshots" download.
- **Saves:** the Screen check from 19.2 to about 8.9 minutes (the slowest part takes 37 to 40% of today's test time in all four logs); the Speed check then finishes last. About 4 to 5 more machine-minutes a run (about 10 counting the outage): each machine repeats the setup.
- **Risk:** eight tests at once against one preview and staging's database, not two (each machine's own load is today's). If staging slows and a test passes only on retry, the check fails, so the first runs are watched.
- **Nothing looser:** every test runs exactly once, in the same browsers and widths, under the same retry rule.
- **Upgrade:** Playwright 1.64's documented `preprocess` hook (`skipSharding`, `exclude`) can pick each part's tests from a committed file of test times (a new test counts as the median): about 6.5 minutes on the same four machines.

### 2. The preview checks skip a change that can't reach the website (needs the founder's yes)

- **What:** a pull request that changes only the database runs today's full Screen and Speed checks against a preview that can't see its change. The cause: markets, perps and ledger list the database package in `devDependencies` for their own database tests, so Turbo counts the website as touched; nothing in the website or the app uses it (`git grep`). A part should count as touched only through what it ships (`dependencies`) or its own tests and tools (its own `devDependencies`): one change in `.github/scripts/affected.py`, once the applying relay confirms the cause with Turbo. The two checks then pass through today's early exit; the other four run as today.
- **Saves:** 9 pushes in 5 pull requests (#111, #116, #118, #124, #134) wait about 3.9 minutes instead of 16.7.
- **Risk:** replayed on all 30 pull requests' files, the rule changes the decision for these five only. #118 also changed staging's firewall settings, which Turbo already counts as touching no part. A package that one day uses database code at run time must list it under `dependencies`; a test pins that.
- **The founder's rule:** PLAN.md section 3 gives risky changes, "database structure" among them, "the full test suite", and all five are [risky]. But "a preview can't see a database change that hasn't merged" (CLAUDE.md), so on these pushes the two checks only re-test main's website. App journeys already stops early on the same pushes today, and the Database check still builds a fresh database and runs every test.

### 3. The Speed check on three machines (needs the founder's yes)

- **What:** each machine measures six of the 18 pages exactly as today, one page at a time: its own Chrome, an uncounted warm-up on the home page, each page's five runs, then the dark-scheme contrast runs. The joining job judges every page against its budget as today and posts the one table; the self-test and the app's code size run once.
- **Saves:** the Speed check from 10 to 12 minutes to about 4.7: nothing on its own, 53 minutes after 1 and 2.
- **Risk (the founder's rule):** which pages share a machine changes, which touches "its measuring never moves". So both ways run on the same previews for five pull requests first; it switches only if every page's median stays within its own run-to-run spread, otherwise it stays whole.

### 4. App journeys' two sizes on two machines (needs the founder's yes)

- **What:** the phone's flows on one emulator; the tablet's on another, then the cold start at the phone size, as today. Each machine reuses the built app or builds it, so neither waits; the joining job combines the results and the comment.
- **Saves:** 3.1 minutes on pushes that touch the app (17.4 → 14.3 with a build, 11.4 → 8.3 without), 55 minutes after 1 to 3. The second machine repeats the setup, and the build if the app changed.
- **Risk (the founder's rule):** the cold start keeps its seven runs, size, comparison with main's and the flows just before it, but the phone's flows no longer precede it on that emulator, which touches "its measuring never moves". So main records its baseline the new way before any pull request is compared with it, and a few runs prove it reads the same.

### 5. The browsers' system libraries from GitHub's cache

- **What:** the last download a check makes outside GitHub on every run. The Tool cache workflow, on main, fetches the exact packages with Ubuntu's own checksums into GitHub's cache, keyed by Playwright's version and the machine image's; the checks install them offline and fall back to the mirrors on a miss. That's `tools.py`'s rule (pinned, cached from main, checked, only read by the checks).
- **Saves:** about 10 to 20 seconds a run on a normal day (the installing stays). The rest is resilience: 82 of its 95 minutes on its own come from the 10 and 11 November mirror outage, and with proposal 1 every Screen check downloads four times.
- **Risk:** after a GitHub machine-image update (about weekly), runs miss the cache until the Tool cache workflow runs again, and fall back to the mirrors, no worse than today. It adds about 114 MB to a cache already over its free 10 GB, so the package store is then saved from main only (a pull request changing the lockfile downloads only the difference).

### 6. Journeys that never open a browser run once (needs the founder's yes)

- **What:** 16 journeys (the perp's jobs, trading, market closing, the MCP server, the example bot…) only call the API, yet each runs once per browser, making the same calls under different accounts. Tagged, they run once; a guard fails any tagged test that opens a page. Every test that opens a page still runs in both browsers at every width.
- **Saves:** 6.7 test-minutes a run (5.6 to 7.3 in the four logs) and half these journeys' load on staging: 22 minutes of critical path after the others, or one Screen machine fewer.
- **Risk (the founder's rule):** it drops the second browser's accounts and the second, simultaneous run of each journey; two copies running at once is how a race between two runs would show today. It changes how often these journeys run, not what they check.

## 4. Considered and rejected

| Option | Why not |
|---|---|
| Larger GitHub machines, paid test-splitting or caching services, more cache storage | Paid |
| Self-hosted machines | GitHub's own machines only |
| Four tests at a time per machine | It doubles the browsers on each machine (four at once on four processors), so timing-sensitive journeys could pass only on retry, which fails the check. Proposal 1 keeps each machine's load as today |
| Fewer widths, browsers, pages or Lighthouse runs; no 200% text pass or speed self-test | Each loosens a check |
| Skipping slow checks on draft pull requests | They now run during the AI review; skipped, they'd start after it |
| Reusing a passing result when a push changes no code | 3 cases in 30 pull requests, about 60 minutes (#138's records-only push; #127's and #128's, whose code was unchanged after main absorbed part of it); not worth new logic in a required check |
| Skipping the re-run after a push that only moves onto newer main | 6 pushes, about 110 minutes. The rebased branch holds main's newer code, which is what merges, so skipping would leave exactly that combination unchecked |
| A local build instead of the preview | The preview is where a change is checked, and it's ready within a minute |
| GitHub's merge queue | Offered to repositories an organisation owns; ours is in a personal account |
| Stopping at the first failure | Later failures would only show up a round later |
| Caching the app's native build | About 30 to 40 minutes on top of all six (p90 14.6 → about 10.5 to 11.5), but it needs a new pinned tool and about 0.5 GB more in a cache already over GitHub's free 10 GB. Later, if app work grows |
| Narrowing the rule that `.github/workflows` or `.github/scripts` changes run everything | Kept, as CLAUDE.md requires |

## 5. For the founder

- **Approve any subset,** best in table order. 2, 3, 4 and 6 each need an explicit yes (2: risky changes get the full test suite; 3 and 4: the measuring never moves; 6: both browsers). 1 and 5 change no rule of his and together save 11.9 minutes per pull request on average. Budgets, tests and the ruleset stay as they are.
- **Busy moments:** with all six, a push starts 15 jobs instead of 6, up to 12 at once. The busiest moment measured, 26 jobs, would need about 59 against GitHub Pro's 40; jobs beyond 40 wait for a free machine and never fail, and demand would have passed 40 for about 6 minutes in 8 days.
- **At P.17 (private again), machine time stops being free.** The last 7 days used about 2,240 machine-minutes, about 9,600 a month; GitHub Pro includes $18 a month, 3,000 minutes on the two-processor machines private repositories get. GitHub then rounds each job up to a whole minute, so these proposals add about 24% to the bill, not 11% (the joining jobs could run on GitHub's single-processor `ubuntu-slim`, a third of the price). And on two processors Playwright runs one test at a time instead of two, so the Screen check roughly doubles, while Lighthouse measures on different hardware. Nothing to decide now; it belongs with P.17.
