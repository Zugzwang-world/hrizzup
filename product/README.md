# Product

**Its job:** build the app, the website and the markets, with the data sources that settle the markets.

**What it produces:** the app, the website and the market data.

## What lives here

- **The news app:** Android first, then iPhone. The board, story pages, feed, posting and notifications. Product only displays content: the board shows stories, and the feed shows takes from all three routes (found, made and posted), each credited by its route.
- **The website:** news and play-money markets, designed for phones first.
- **Accounts and login:** one account shared by the app and the website.
- **The market engine:** Manifold's maths copied with its tests (PLAN.md step 1.7a), then our own tables, trades and ledger around it (step 1.7b). Its licence notice is kept with the code and listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- **The market data:** the data sources for each market subject (step 1.2), and the data job that fills each subject's data slot with readings, from which markets settle themselves (step 3.2).
- **The hand-over agreement:** Product drafts its first half and reviews its second, which Sourcing designs, and makes any changes the first half's reviewers ask for (step 0.7 names who signs off each half). It lives in [agreement/](../agreement/README.md), outside any one project, and Product's code uses its definitions through `@hrizzup/agreement`.

## Rules

- One codebase for both (decided 3 November 2026, PLAN.md step 1.5): pnpm workspaces with Turborepo, the Next.js website in `web/`, the Expo app in `app/`, and the code they share in `packages/`. The tools are listed in CLAUDE.md, "Codebase".
- Projects never copy code between each other; this shared repository is the only route.

Status: [docs/status/product.md](../docs/status/product.md). Brief: [docs/brief/product.md](../docs/brief/product.md). Plan: [PLAN.md](../PLAN.md), section 4.
