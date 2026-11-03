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
- **Sign-in, 3 November 2026 (runbook Part 8):**
  - decided: Supabase Auth for the website and the app; Google first; Apple and email codes before the iPhone build; the app's native Google and Apple sign-in with the app builds (PLAN.md, blueprint section 9);
  - the founder's Google Cloud project `hrizzup` (`hrizzup-513610`, owned by the Hrizzup Google account) has its consent screen (Testing) and the staging web client, whose keys are in Doppler `stg`; checked from the outside to be valid, with staging's callback registered;
  - Google sign-in is on in `hrizzup-staging`, with the site address `https://staging.hrizzup.com` and redirects allowed only to staging and `localhost:3000` (proven: other addresses fall back to staging);
  - Supabase's emails now go through Resend from `no-reply@mail.hrizzup.com`, each as an 8-digit code valid for 10 minutes, with no links (sign-up, sign-in, password reset and email change); a test code went out through Resend;
  - Turnstile is on for Supabase Auth's email routes; a request without it is refused;
  - the settings live in `infra/supabase/auth/` and are applied and checked with `apply.py`, so production gets the same ones through the release pipeline;
  - `dev` follows staging (19 references).

- **Hosting and the first codebase, 3 November 2026 (runbook Part 9; the first slice of PLAN.md step 1.5):**
  - **one codebase:** pnpm 11 workspaces, Turborepo with Vercel's Remote Cache (GitHub's checks sign in through OIDC, so no Vercel token is stored in GitHub), Biome, TypeScript 6, Vitest, Playwright and the Supabase CLI. `product/web` is the Next.js website, `product/app` an empty Expo SDK 58 shell, and `product/packages` the code they share;
  - **the first migration locks every table:** row-level security switches on for every new table (including tables made inside `CREATE SCHEMA` and by extensions), switching it off is refused, and the Database check and the Staging workflow fail if any table lacks it. Proven to catch an unprotected table;
  - **the website:** the holding page, draft privacy and terms pages (with highlighted gaps for the founder), the sign-in test page (not on production) and `/api/health`;
  - **Vercel:** the project `hrizzup` with every setting kept in `infra/vercel/` (Mumbai, hidden production builds, Skew Protection, deployment protection, the toolbar on previews, the firewall); the custom environment `staging` follows the `staging` branch, which only the Staging workflow moves after each merge's migrations, then builds through a deploy hook and waits until staging serves the commit; domains and their Cloudflare records (DNS only);
  - **previews are complete working copies:** staging's data and keys through Doppler `stg_preview`, Turnstile's test keys, and Google sign-in through staging's signed relay, so Supabase never allows a `vercel.app` address. A change is checked on its preview, never by deploying it to staging (CLAUDE.md and the blueprint);
  - **checks on every pull request**, all required on `main`: Secret check, Quick checks, Database check and Screen check (13 widths, sideways, 200% text, Chromium and WebKit, signed out and signed in with two staging-only test accounts, screenshots for the founder);
  - **checked end to end (runbook 9.6):** the founder signed in with Google on staging and on a preview; Supabase has his Google identity, and signing out ended each session on the server. Both health pages report `bom1` with every service answering (Redis about 2 to 3 ms a command from Mumbai); the screen check passes 58 of 58 on a preview and on staging;
  - **found and fixed:** `VERCEL_TOKEN` was in the app's staging config, which Vercel syncs into builds; it moved to `hrizzup-tools` before the first sync. An open redirect in the sign-in's return path, and three points from the AI review, were fixed before merging.
- **Claude Code's own Doppler access, 3 November 2026 (runbook 10.1, founder's decision):** four Doppler service tokens, one per config (`dev`, `stg` and `hrizzup-tools/claude` read and write; `stg_preview` read only), kept in this Mac's keychain and used only through `infra/doppler/run`. `infra/doppler/check_access.py` proves that none can open `prd` and that the read-only one can't write. Claude Code no longer uses the founder's Doppler login; every script and README now uses the tokens.

## Next

1. **Finish the repository foundation (step 0.6):** the checks sized to the change are partly built (Quick checks, Database check, Screen check, all required). Still to add: the performance-budget checks (Lighthouse and download size against each preview, blueprint section 14) and the daily summary routine.
2. **The founder reviews the draft privacy policy and terms** on `hrizzup.com/privacy` and `/terms` and fills the highlighted gaps (legal entity, address, contact email, Grievance Officer, retention days, courts' city). Putting the final versions live on `hrizzup.com` is a production change, so it goes through the release pipeline once it exists (Part 10), or as one more agreed promotion.
3. **Draft the hand-over agreement (step 0.7):** what a story, an update, a creation and a market look like when they pass between projects, including the Grok bots' result format. All three projects agree it. No project writes content before this is done.
4. **Design (step 1.4):** references, then the design system (shadcn/ui, Claude Design), then the core screens.
5. **The rest of step 1.5:** the one typed API, and the empty app running on an Android phone.
6. **Accounts and login (step 1.6):** email codes on the website (with the Turnstile widget), then Apple; the app's native sign-in with the app builds.
7. **Production twin (runbook Part 10).**
8. **Market engine (step 1.7),** then Phases 2 and 3 in the order in PLAN.md section 5.

## Open questions

- **For the founder: sign your Doppler login out of this Mac.** In Terminal (or in Claude Code, starting the line with `!`), run `doppler logout --yes`. Claude Code then runs `python3 infra/doppler/check_access.py`, which should report "Personal Doppler login: none saved on this Mac". From then on, use Doppler's website for production.
- **Vercel token expires around 1 February 2027.** Replace it before then, in Doppler `hrizzup-tools` (config `claude`); a GitHub issue opens on 15 January 2027 as a reminder.
- **Google sign-in refused for accounts that aren't test users** (runbook 9.6): needs a second Google account that isn't on the consent screen's test list, which Claude Code doesn't have. The founder can try it once on `staging.hrizzup.com/sign-in-test`.
- **AI crawlers** (firewall): the AI bots ruleset only logs for now. Decide before launch whether to block them.
- **Link previews** (WhatsApp, X, Slack) on `hrizzup.com`: Bot Protection challenges `curl`-like clients, so check before launch that shared links still show their preview.
- **Password sign-in:** Supabase's password hook (planned with the first migrations) may need a plan above Pro; check before building it with email codes (step 1.6).
- **For the founder: trim the Cloudflare API token** to the five permission rows in runbook step 2.5 (the step-by-step reminder is in runbook Part 2). Checked again on 3 November 2026: it can still also list Workers scripts, Workers routes, Page Rules and Email Routing settings. Claude Code re-checks afterwards.

- **How the app shows the bot check on its email-code screen** (step 1.6): Turnstile is on in Supabase Auth, so the app needs the widget too (usually inside a small web view). Settled with the app's sign-in, before the iPhone build.
- **Block password sign-in** (with the first migrations, step 1.5): Supabase can't switch passwords off while email codes are on. Strict password rules are on for now; a small database function (Supabase's password hook) then refuses every password sign-in.
- **Part 10, sign-in (steps 10.15 and 10.16):** decide on Supabase's Custom Domain add-on (`auth.hrizzup.com`, `auth-staging.hrizzup.com`; $10 a month each, checked 3 November 2026), and with it whether production gets its own Google Cloud project, because both clients share one consent screen. Before publishing: the home page and privacy-policy links on Google's Branding page, and `hrizzup.com` verified in Search Console.
- Feed design in depth (step 2.3).
- What are the exact market questions? (step 3.2, with Sourcing)
- Paid tier: what's free and what's paid? Decided before the paywall is built (step 2.7).
- Comment threads: in or out?
- **Before Part 10: Claude Code's GitHub identity.** Claude Code works through the founder's GitHub account and merges its own pull requests, so it could in principle change the release pipeline. Recommended: a separate GitHub account for Claude Code, with the founder's approval needed for changes to the pipeline's files.
- **For the founder: Supabase spend cap on and usage alerts on** (runbook 5.2). These are organisation settings, which Claude Code's token can't see.
- **Supabase token expires around 1 February 2027.** Replace it before then, in Doppler `hrizzup-tools` (config `claude`); a GitHub issue opens on 15 January 2027 as a reminder.
- **Test email in Spam (runbook 3.7):** the staging test email from `no-reply@mail.hrizzup.com` reached `hrishikesh@hrizzup.com`, but in Spam. Waiting for its headers from the founder, to see whether SPF, DKIM and DMARC passed and why.
- **Zugzwang World leftovers:** now kept in the retirement list, `docs/setup/RETIREMENT.md`: the Doppler project `zugzwang-experiment` (kept until retirement; its Upstash keys are already dead), the Resend domain `mail.zugzwangworld.com` and its "Onboarding" key, and five R2 buckets. They are removed when the founder retires Zugzwang World.
- **For the founder: Upstash two-step login.** Upstash's database page lists "MFA Requirement" among its recommended security steps, unticked. Confirm two-step login is on for your Upstash account (runbook step 0.2).
- **Helpers' invitations:** sent 2 November 2026 and still waiting to be accepted (checked again the same evening). GitHub cancels them after 7 days; Claude Code can resend them.
