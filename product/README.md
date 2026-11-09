# Product

**Its job:** build the app, the website and the markets, with the data sources that settle the markets.

**What it produces:** the app, the website and the market data.

## What lives here

- **The news app:** Android first, then iPhone. The board, story pages, feed, posting and notifications. Product only displays content: the board shows stories, and the feed shows takes from all three routes (found, made and posted), each credited by its route.
- **The website:** news and play-money markets, designed for phones first.
- **Accounts and login:** one account shared by the app and the website.
- **The market engine:** Manifold's maths copied with its tests (PLAN.md step 1.7a), then, in the founder's build order, the ledger: our own double-entry books in exact decimals (1.7b); markets as data, settled by hand through a small admin-only market console whose calls (create, open, close and settle) join the typed API (1.7c); and the engine's other calls in the typed API: list, trade and positions (1.7d), before the market pages (3.1).
- **The content store's tables:** story, update, sourced item and creation, plus the launch list, with the agreement's rules as database rules (step 1.9). The news pipeline (1.1) writes them; every news feature's back end reads them. Its licence notice is kept with the code and listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- **The markets' topics and data sources:** chosen once markets work end to end on staging (step 1.2, parked until then), with the automatic resolvers that settle markets from the source each names (step 3.2a).
- **The hand-over agreement:** Product drafts its first half and reviews its second, which Sourcing designs, and makes any changes the first half's reviewers ask for (step 0.7 names who signs off each half). It lives in [agreement/](../agreement/README.md), outside any one project, and Product's code uses its definitions through `@hrizzup/agreement`. The first half was Agreed on 9 November 2026, so Product may build tables and content for its shapes.

## Rules

- One codebase for both (decided 3 November 2026, PLAN.md step 1.5): pnpm workspaces with Turborepo, the Next.js website in `web/`, the Expo app in `app/`, and the code they share in `packages/`. The tools are listed in CLAUDE.md, "Codebase".
- Projects never copy code between each other; this shared repository is the only route.

## The app's builds (PLAN.md step 1.5d)

Built in Expo's cloud (EAS Build, free plan) for the project `@hrizzups-team/hrizzup`, with Claude Code's robot token (`EXPO_TOKEN`, never shown; where it lives: runbook Part 4). Never Expo Go. Both builds call staging's typed API (`product/app/eas.json`).

- **Preview build** (an APK with its code inside, which opens on its own; what people install from its link):

  ```sh
  infra/doppler/run tools -- pnpm --dir product/app dlx eas-cli@27.4.1 build --platform android --profile preview --non-interactive
  ```
- **Development build** (Expo's development client, for sessions at the Mac): the same with `--profile development`, then `pnpm --filter @hrizzup/app start --dev-client` with the phone on the Mac's Wi-Fi.

Status: [docs/status/product.md](../docs/status/product.md). Brief: [docs/brief/product.md](../docs/brief/product.md). Plan: [PLAN.md](../PLAN.md), section 4.
