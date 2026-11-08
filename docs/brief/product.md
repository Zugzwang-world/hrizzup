# Product: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 8 November 2026. The only repository file the Product project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches Product's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **Product's job:** build the website and the app in parallel, the website one stage ahead (Android first, then iPhone from the same code), plus the markets and the data sources that settle them. It only displays content, which reaches it through the hand-over agreement (`agreement/README.md`), whose first half Product drafts.

## Where things stand

- **Setup is finished** (Phase 0). Staging works end to end at `staging.hrizzup.com` (Mumbai), behind Vercel's login until step 1.5d. Production is a quiet twin showing the holding page; the rest is parked (runbook, pre-launch checklist).
- **The codebase is nearly empty:** the website (holding page, legal drafts, `/api/health`, a sign-in test page off production), a one-screen Expo app, shared packages and `@hrizzup/agreement`. Google sign-in works on staging.
- **Round 2 is running:** five unattended relays in their own worktrees, on the GitHub milestone "Round 2". `TRACKER.md` lists what comes before the first feature round.
- **The agreement's first half is reviewed by Sourcing and awaits the founder's approval** (in News Desk's place). Its changes are made, and it's still a Draft, so no tables exist for its shapes.
- **Not built yet:** any screen, Round 2's checks and API, the app on a phone, the market engine, perps, the data job.

## Round 2 progress

One line per relay; each relay keeps only its own line current.

1. **Relay 1, the round's records:** merged [#36](https://github.com/Zugzwang-world/hrizzup/pull/36). Next: nothing, relay 1 is done. For the founder: replace the Expo token.
2. **Relay 2, steps 1.5a to 1.5d:** no milestone merged yet. Next: 1.5a, the speed check.
3. **Relay 3, step 1.7a, Manifold's maths:** merged [#43](https://github.com/Zugzwang-world/hrizzup/pull/43), our changes: the time passed in, no loans, the two error messages fixed, no logging, fees at zero behind one setting (after [#38](https://github.com/Zugzwang-world/hrizzup/pull/38), the maths with its 158 tests). Next: our money tests.
4. **Relay 4, step 1.4's first pass:** no milestone merged yet. Next: the design values.
5. **Relay 5, Sourcing's review of the agreement's first half:** merged [#42](https://github.com/Zugzwang-world/hrizzup/pull/42), the changes the review ([#37](https://github.com/Zugzwang-world/hrizzup/pull/37)) asked for: "reviewed by Sourcing, awaiting the founder's approval". Next: nothing, relay 5 is done. For the founder: approve the first half; three questions.

## Decisions in force

- **Two surfaces, one account:** the app (news and social, no play money) and the website (news and play-money markets); English; launch in India.
- **Built in parallel, the website one stage ahead** (`TRACKER.md`): design, contract, back end, both screens at once in separate worktrees, then the website's join, then the app's. App only: 1.6b, 2.5, 2.6, 4.3, 4.5. Website only: 3.1 to 3.4.
- **Unattended relays** (CLAUDE.md): never wait; production, spending, new accounts or keys and the founder's decisions go under "For the founder"; never his own login; one milestone per small pull request; checks, budgets and tests never loosened. Maths, back-end and architecture problems come here.
- **Step 1.5, split:** 1.5a the speed check; 1.5b journey tests, with the app's first Maestro test; 1.5c the typed API with calls that aren't content (health, who am I), done when the website makes a real call through it; 1.5d the empty app on the founder's Android phone, answering from staging, with its own budget. Each needs the one before.
- **Step 1.7, split:** 1.7a, Manifold's maths with its tests plus ours that money in equals money out, needs only 0.6; 1.7b, the rest of the engine, needs the agreement's first half.
- **Step 1.8, new:** parallel local development, before the first feature round.
- **The typed API:** oRPC, contract first, pinned to 1.x, in `product/packages/api`; 2.0 in its own change once stable, before the first feature's contract stage.
- **Design (1.4):** Claude Code builds it from the founder's references in real code, on a page only previews show, filled with the agreement's example data, refined with him: values (colours, sizes, spacing, radii, typefaces, icons) defined once for both surfaces, light and dark from day one, a design log, checks only for speed, fit and readable text. First pass: the values, the board and a story page at phone size.
- **Staging goes public in 1.5d** (a Vercel protection exception, after a review; search engines asked to stay out; previews stay private), or, if Vercel refuses, 1.5d narrows to the preview build on the phone and the development build answering from the Mac.
- **Sign-in:** 1.6a the website's, with no passwords (a Custom Access Token hook on Supabase Pro refuses any session made with one, tested; no Team plan); 1.6b the app's; Apple with the iPhone (4.3).
- **Expo:** the founder's own account owns the app; Claude Code uses a robot token (Developer role), never his; free plan until build waits hold up work, then Starter.
- **Content and markets:** three credited routes into the feed (found, made, posted); no money in ranking; Kalshi's layout on Manifold's engine; one Bitcoin perp.
- **Checks come first;** no tables before a half is Agreed; production only through the release pipeline.

## What changed in the latest session

On 8 November 2026, Round 2's relay 5 reviewed the agreement's first half as Sourcing ([#37](https://github.com/Zugzwang-world/hrizzup/pull/37)) and made the changes ([#42](https://github.com/Zugzwang-world/hrizzup/pull/42)), in place. For Product's contract and screens:

- **A found post gone from X** keeps no post and no summary: show nothing. Addresses, handles and names are X's current ones.
- **Updates name their sources:** posts in `based_on` (credit each while live), other pages in `sources`. A repeat is `merged` into the update it repeats.
- **A merged story** stands for the one it went into; `withdrawn` also covers legal takedowns. The examples changed (relays 2 and 4 use them).

## Open questions

- **The board's favourites and bookmarks need sign-in** (2.1), but 2.1 doesn't list 1.6a. Recommendation: add 1.6a to 2.1's needs, and 1.6b to its app join.
- **Vercel's bot challenge and the app** (1.5d): a phone app doesn't behave like a browser; only `/api/health` is exempt. Recommendation: test first; if challenged, a staging-only firewall rule lets the API skip the challenge, keeping rate limits; production's goes through the release pipeline.
- **oRPC 2.0 not stable in time:** recommendation: start the first contract on 1.x and move when it is.
- **A guard for tool tokens:** recommendation: the Doppler check fails when a `hrizzup-tools` name appears in `stg`.
- **Dependabot's three open alerts** (zod high; glob, minimatch moderate), with fixes released and no update pull request. Recommendation: one small change raising them, and find out why Dependabot opened none.
- **The markets' trading fee** (1.7a): the maths keeps it at zero behind one setting, `TAKER_FEE_RATE`, using Manifold's formula (rate × p × (1 − p) × shares). Recommendation: zero at launch, as Manifold runs today; if one is wanted later, decide with it how a cancelled market refunds: Manifold refunds the whole stake, fee included, without taking the fee back, which would create play money.
- **Also open, with recommendations:** what the surfaces share beyond design values (the contract, data fetching, validation); embedding found posts (X's own embed; a web view in the app); perps' first settings (a price every 5 seconds, a 0.1% opening fee, hourly funding); Turnstile in the app (a small web view); background jobs (Supabase Cron and Queues, reviewed by Product).

## For the founder

- **Replace the Expo token** (runbook step 4.6, about 5 minutes): a fresh robot token straight into Doppler `hrizzup-tools`, then delete `EXPO_TOKEN` from `stg` and the old token in Expo. Until then it reaches every staging and preview build.
- **1.4's first pass and the agreement:** the board and a story page are core screens, which need the first half Agreed. Recommendation: draw them now on the Draft's example data; approve them once it's Agreed.
- **Approve the agreement's first half** in News Desk's place: reviewed by Sourcing, its changes made (the review's "In short"). Then Product may build its tables.
- **Sourcing's three questions** (the review's F1 to F3), none holding up the approval. Recommended: found takes in English only; takedown requests to you at a `hrizzup.com` address, acted on within 24 hours; a lawyer's check before launch, in the pre-launch checklist.
- **Market data** (1.2): approve the recommended sources: Pyth for Bitcoin (free or $500 a month), GoldAPI.io for gold ($99), Arena's dataset for AI models (free), Sportmonks for cricket (about €75), API-Football (about $19). Nothing to pay in Round 2.
- **Install the app** on your Android phone when 1.5d shares its link.
- **Posting on the website** (2.4): recommendation: both surfaces. **The closed test (2.6):** start without News Desk's content. **Free and paid** (2.7): reading and betting free; play money never sold.
- Alongside: the developer accounts (0.4), 12 or more Google Play testers, and setting up News Desk.

## What's next

1. **Round 2:** relays 2 to 4 in parallel (relay 5 is done); the founder approves the first half.
2. **Parallel local development (1.8).**
3. **Sign-in:** 1.6a with the hook, then 1.6b.
4. **The first feature round** through `TRACKER.md`; alongside, 1.7b and the markets track (3.1 to 3.4).

## Read for detail

- `PLAN.md` (sections 2, 3, 5 and 7), `TRACKER.md` (before the first feature round; each feature's stages) and `CLAUDE.md` ("Unattended sessions").
- `docs/setup/BLUEPRINT.md`: Expo (2), public staging (6), keys (7), sign-in (9), the typed API (13), budgets (14).
- `docs/setup/RUNBOOK.md`: Part 4 (where keys live; step 4.6), the pre-launch checklist.
- `docs/research/round-2-readiness.md` and `docs/research/manifold.md`: the research behind Round 2 and the market engine.
- `agreement/README.md`: sign-offs, decisions, routes, fields, lists; `agreement/reviews/sourcing-first-half.md`: Sourcing's review, with notes for Product (N12 to N14: embeds, creators, the Latest tab).
- `docs/status/product.md`: Product's status in full, with this session's own answers.
