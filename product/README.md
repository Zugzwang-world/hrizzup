# Product

**Its job:** build the app, the website and the markets.

**What it produces:** the app and the website.

## What lives here

- **The news app:** Android first, then iPhone. The board, story pages, feed, posting and notifications.
- **The website:** news and play-money markets, designed for phones first.
- **Accounts and login:** one account shared by the app and the website.
- **The market engine:** copied from Manifold with its tests (PLAN.md step 1.7). Its licence notice is kept with the code and listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- **The hand-over agreement:** Product drafts it, and all three projects agree it (step 0.7).

## Rules

- One codebase for both (decided 3 November 2026, PLAN.md step 1.5): pnpm workspaces with Turborepo, the Next.js website in `web/`, the Expo app in `app/`, and the code they share in `packages/`. The tools are listed in CLAUDE.md, "Codebase".
- Projects never copy code between each other; this shared repository is the only route.

Status: [docs/status/product.md](../docs/status/product.md). Brief: [docs/brief/product.md](../docs/brief/product.md). Plan: [PLAN.md](../PLAN.md), section 4.
