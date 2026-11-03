# Product: status

Last updated: 3 November 2026. Plan: [PLAN.md](../../PLAN.md). Code: [product/](../../product/).

## Done

- **Repository foundation, first part (step 0.6), 2 November 2026:** PLAN.md, the setup blueprint and runbook, the setup log, the three parts with their READMEs, these status files, CLAUDE.md, the proprietary LICENSE, THIRD_PARTY_NOTICES.md, the .gitignore, and the plugins and connectors.
- **Runbook step 1.6, 2 November 2026:** GitHub stays on the free plan. Dependabot alerts and security updates are on (confirmed through GitHub's API). A gitleaks secret check was added before every commit and in CI, then removed the same day so staging stays free-flowing (see below). The runbook and blueprint were updated to match, and every runbook Part now opens with "What we're doing" and "Why".
- **Repository moved, 2 November 2026:** now at [github.com/Zugzwang-world/hrizzup](https://github.com/Zugzwang-world/hrizzup), private, in the founder's personal account on GitHub Pro. Dependabot carried over; this folder pushes to the new address; PLAN.md, CLAUDE.md, the blueprint and the runbook all say where the repo lives.
- **Screen-size rule, 2 November 2026:** every screen fits every device. Written into CLAUDE.md and the runbook: flexible layouts, phone-first, an automatic browser check at 13 widths (320 to 2560 pixels) plus sideways phones and tablets in Chrome's and Safari's engines, phone widths again with the text size at 200%, and screenshots at 360, 768, 1440 and 1920 pixels.
- **Staging stays free-flowing, 2 November 2026:** the secret check before every commit, its CI workflow and the session-start setting that switched it on were removed, and changes went straight to `main`. Replaced later the same day by pull requests for every change (below).
- **How changes land, 2 November 2026 (runbook 1.7):** every change goes on its own branch and pull request, which Claude Code opens and merges itself (auto-merge) as soon as the checks pass, with no human approval. A gitleaks secret check runs on every pull request over the whole history; it was also run once by hand (no leaks). The ruleset "main" requires the check to pass, blocks force-pushes and deletion, requires no reviews, and allows squash merges only. Branches are deleted after merging. All confirmed through GitHub's API.
- **Production twin plan, 2 November 2026:** production runs on Vercel plus Supabase, set up exactly like staging with its own data and keys; AWS only later, if a concrete need appears, as its own project. Releasing promotes the hidden production build of a commit that passed staging with one command (`vercel promote`), with no rebuild. The new runbook Part 10, "Production twin", and "Releasing to production" document it. The hand-over is now Part 11. "Production hardening" holds only the founder-only production keys.
- **Runbook Part 1 finished, 2 November 2026:** step 1.1 is done (the founder uses two-step login on GitHub).
- **Helpers invited, 2 November 2026:** `Titan00714`, `Anupamhodl` and `Zoro47007` were invited as collaborators who can make changes. Each must accept within 7 days.
- **How the app is built, decided 2 November 2026:** Expo app and Next.js website in one codebase, one typed API, Supabase Realtime for live updates, database text search from day one, shared links that open the app, and automatic tests of core journeys (Playwright for the website, Maestro for the app). Images are cleaned and capped at upload, stored once in R2 and delivered through Cloudflare image transformations. Cloudflare stays on Free during staging and moves to Pro (with Images' paid plan) in the production twin. Recorded in PLAN.md, the blueprint (new section 13) and the runbook (steps 2.1, 6.5, 6.6 and 10.2, numbered 10.1 at the time).
- **Performance, paid tier and video, decided 2 November 2026:** performance and caching rules, from day one, are in CLAUDE.md (short) and blueprint section 14, "Production quality" (full): caching in layers, batching, no private data in shared caches, media and list rules, and a performance budget for every page and screen. The paid tier is in version one (new PLAN.md step 2.7, after the Google Play closed test starts); what's free and what's paid is decided before the paywall is built. Creator videos are stored and played through Cloudflare Stream. The founder's working rule now also says: solve the whole category behind an example, never just the example.
- **Doppler project created, 2 November 2026 (runbook 4.2, brought forward):** project `hrizzup` with `dev` (local work; since 3 November it follows staging, see below), `stg` (staging), `stg_preview` (previews, a branch of `stg` that copies staging's values and holds only overrides) and `prd` (production). No secrets added yet.
- **Cloudflare zone checked and cleaned, 2 November 2026 (runbook 2.6):** `hrizzup.com` is active on Cloudflare's nameservers, and DNSSEC validates end to end (the registry's DS matches). The five records imported from GoDaddy were deleted, so the zone is empty. Full (strict), Always Use HTTPS, minimum TLS 1.2, TLS 1.3 and Automatic HTTPS Rewrites are on.
- **Doppler plan, decided 3 November 2026:** Doppler stays on the free Developer plan during staging. The Team-plan upgrade moved from runbook step 4.1 to step 10.1, the first step of the production twin, because its roles let the founder keep production keys to himself once helpers use Doppler. Until then only the founder and Claude Code use Doppler; if a helper needs it sooner, the upgrade happens then. Runbook Part 2 now also carries a reminder to trim the Cloudflare key.
- **Proton verification record, 3 November 2026 (runbook 3.2, first record):** the TXT record `protonmail-verification=…` is on `hrizzup.com`, DNS only, and every public resolver checked returns it, signed. Next: the founder verifies in Proton, then Proton's other records go in.
- **Resend sending domain, 3 November 2026 (runbook 3.5 and 3.6):** `mail.hrizzup.com` is verified in Resend's Tokyo region (the closest to India), with open and click tracking off and its four records in Cloudflare (DNS only). A sending-only staging key, limited to that domain, is in Doppler `stg` as `RESEND_API_KEY`. The production key comes in Part 10. The setup key was deleted from Resend and Doppler.
- **Proton's mail records and DMARC, 3 November 2026 (runbook 3.2 done):** two MX, SPF, three DKIM and DMARC `v=DMARC1; p=quarantine` are on `hrizzup.com`, DNS only, and every public resolver checked returns them, signed. The founder then created `hrishikesh@hrizzup.com` (step 3.3) and turned on Cloudflare's DMARC Management, which receives the DMARC reports; its reports address is in the `_dmarc` record.
- **Supabase staging, 3 November 2026 (runbook Part 5):** `hrizzup-staging` is checked:
  - Mumbai, Micro, Postgres 17.11, Data API off, not linked to GitHub;
  - both pooler addresses connect with full certificate checks, and their modes are proven (transaction on 6543, session on 5432);
  - the connection details and the new-style API keys are in Doppler `stg`;
  - encrypted connections are now enforced, and the legacy keys and signing secret are switched off;
  - the connection settings, the migrations rule and the reasons behind each setting are in the blueprint and CLAUDE.md.
- **Production off-limits to Claude Code, decided 3 November 2026:** Claude Code never reads, holds or uses production keys, and production is changed only by the release pipeline, which gets its own credentials in Part 10. Written into CLAUDE.md, PLAN.md, the blueprint (section 3) and the runbook (Part 10, Releasing and Production hardening).
- **Supabase spend cap on during staging,** off from Part 10 (decided 3 November 2026).
- **Reminders, 3 November 2026:** a daily GitHub workflow opens an issue for each dated reminder in `.github/reminders.json`. The first one is to replace the Supabase token, due 15 January 2027.
- **Storage and bot protection, 3 November 2026 (runbook Part 6, apart from the founder's key and the tests):**
  - the two staging R2 buckets are in Asia-Pacific;
  - `media-staging.hrizzup.com` is live, with its certificate active;
  - image transformations are on, limited to our own images;
  - the CORS and lifecycle rules are in `infra/cloudflare/r2/`, applied and checked;
  - the "Hrizzup staging" Turnstile widget exists, with its keys in Doppler `stg`, and previews use Cloudflare's test keys.
- **Storage tests passed, 3 November 2026 (runbook 6.3 and 6.6):** the founder's R2 key is in Doppler `stg` and reaches only the two staging buckets. A test image uploaded through a signed address from the staging site, downloaded publicly from `media-staging.hrizzup.com`, and came back resized to 640 pixels wide: as AVIF (2.2 KB, from a 137 KB original) or WebP, from Cloudflare's Mumbai cache on the second request. The test files were deleted. Part 6 is done, apart from Stream, which waits for creator video.
- **Doppler tidied, 3 November 2026 (runbook 4.5):**
  - Claude Code's setup keys (the Cloudflare key and the Supabase access token) moved to their own project, `hrizzup-tools`, config `claude`, so `hrizzup` holds only the app's keys;
  - `hrizzup/dev` is now for running the app on this Mac: all 15 staging values are references (`${stg.NAME}`), not copies, kept in step by `infra/doppler/dev_follows_staging.py`;
  - a local run through `dev` reaches staging's database, sign-in service, storage and Turnstile;
  - Doppler's Action Required lists for `dev` and `stg` are empty.
- **Redis, 3 November 2026 (runbook Part 7):**
  - the founder's Upstash database `hrizzup-staging` is checked: Fixed 1GB, AWS Mumbai (`ap-south-1`) with every copy in Mumbai, encrypted connections only (TLS 1.2 and 1.3; plain text and old TLS refused);
  - eviction is now **on** and auto-upgrade **off** (staging's spending cap; production keeps it on);
  - a command takes about 8 ms from the founder's Mac, against about 135 ms for the old database; from Vercel's Mumbai functions, about 1 to 3 ms is expected, measured in step 9.6;
  - `dev` refers to the two Upstash keys, and the new `REDIS_KEY_PREFIX` (`stg`, `pre` for previews, `dev` on this Mac) keeps each place's keys apart in the shared database;
  - the Redis rules (environment prefix on every key, an expiry on every key, batching, Redis never the only copy, Fixed plan on staging and production) are in CLAUDE.md and blueprint section 14;
  - `infra/upstash/check.py` checks the settings and the stored keys, and is proven to catch bad keys;
  - Doppler's `example-project` was already deleted. `zugzwang-experiment` is kept, and its dead Upstash keys are noted in the new retirement list, `docs/setup/RETIREMENT.md`.

## Next

1. **Finish the repository foundation (step 0.6):** checks sized to the change (small, normal, risky) running on every pull request next to the secret check, each added to the ruleset "main" as a required check once it exists, plus the automatic screen check (CLAUDE.md, "Screens fit every device"), the performance-budget checks (blueprint section 14), preview links and the daily summary routine. Needs staging (0.3). Done when a trivial change passes its checks and gets a preview link.
2. **Draft the hand-over agreement (step 0.7):** what a story, an update, a creation and a market look like when they pass between projects, including the Grok bots' result format. All three projects agree it. No project writes content before this is done.
3. **Design (step 1.4):** can start now. References (Mobbin and the founder's own), then the design system (shadcn/ui, Claude Design), then the core screens: board, story page, feed, app frame and market page.
4. **One codebase for the app and the website (step 1.5):** set up the Expo app and the Next.js website in one codebase that shares code, with one typed API, and get a first empty app running on an Android phone. Settle the package manager and how the code is split up at the same time. Needs 0.6.
5. **Accounts and login (step 1.6):** Google first. Needs 0.6.
6. **Market engine (step 1.7):** copy Manifold's engine with its tests. On 2 November 2026 GitHub reported Manifold's licence as MIT; confirm it again at the moment of copying and record the notice in THIRD_PARTY_NOTICES.md. Needs 0.6.
7. **Then** the news app (Phase 2) and the markets website (Phase 3), in the order in PLAN.md section 5.

## Open questions

- **For the founder: trim the Cloudflare API token** to the five permission rows in runbook step 2.5 (the step-by-step reminder is in runbook Part 2). Checked again on 3 November 2026: it can still also list Workers scripts, Workers routes, Page Rules and Email Routing settings. Claude Code re-checks afterwards.

- Which package manager and monorepo tools, which database migration tool, and how is the shared code split up? (step 1.5; the frameworks are decided: Expo and Next.js)
- Apple and email sign-in details (step 1.6). These must be settled before the iPhone build.
- Feed design in depth (step 2.3).
- What are the exact market questions? (step 3.2, with Sourcing)
- Paid tier: what's free and what's paid? Decided before the paywall is built (step 2.7).
- Comment threads: in or out?
- **Automatic row-level security isn't in effect** in `hrizzup-staging`. The founder approved the fix for step 1.5: a first migration that locks every new table, and a check on every pull request.
- **Before Part 10: Claude Code's GitHub identity.** Claude Code works through the founder's GitHub account and merges its own pull requests, so it could in principle change the release pipeline. Recommended: a separate GitHub account for Claude Code, with the founder's approval needed for changes to the pipeline's files.
- **Previews in the upload rule:** added in runbook step 9.6, once Vercel gives previews their addresses.
- **For the founder: Supabase spend cap on and usage alerts on** (runbook 5.2). These are organisation settings, which Claude Code's token can't see.
- **Supabase token expires around 1 February 2027.** Replace it before then, in Doppler `hrizzup-tools` (config `claude`); a GitHub issue opens on 15 January 2027 as a reminder.
- **Test email in Spam (runbook 3.7):** the staging test email from `no-reply@mail.hrizzup.com` reached `hrishikesh@hrizzup.com`, but in Spam. Waiting for its headers from the founder, to see whether SPF, DKIM and DMARC passed and why.
- **Zugzwang World leftovers:** now kept in the retirement list, `docs/setup/RETIREMENT.md`: the Doppler project `zugzwang-experiment` (kept until retirement; its Upstash keys are already dead), the Resend domain `mail.zugzwangworld.com` and its "Onboarding" key, and five R2 buckets. They are removed when the founder retires Zugzwang World.
- **For the founder: Upstash two-step login.** Upstash's database page lists "MFA Requirement" among its recommended security steps, unticked. Confirm two-step login is on for your Upstash account (runbook step 0.2).
- **Helpers' invitations:** sent 2 November 2026 and still waiting to be accepted (checked again the same evening). GitHub cancels them after 7 days; Claude Code can resend them.
- **Staging following `main` (runbook 9.2):** confirm whether Vercel lets the `staging` environment track `main` while `main` is the production branch; if not, add a small deploy workflow that sends every merge to staging.
