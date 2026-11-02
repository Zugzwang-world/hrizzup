# Hrizzup

Hrizzup is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. Android first, then iPhone; the website is phone-first; one shared account.

**[PLAN.md](PLAN.md) is the single source of truth.** If anything disagrees with it, PLAN.md wins. The setup blueprint and the runbook live in [docs/setup/](docs/setup/).

**Layout:** `sourcing/` (Grok bots, news pipeline, market data), `news-desk/` (our content, creators), `product/` (app, website, markets). Projects never copy code between each other; this repository is the only route.

**Repository:** [github.com/Zugzwang-world/hrizzup](https://github.com/Zugzwang-world/hrizzup), private, in the founder's personal GitHub account on GitHub Pro.

## Working with the founder

**How to work with the founder:** the founder is non-technical. He describes problems, goals and preferences; you bring the solution. Always propose the best solution that top professional teams use today, explain it in plain language, and lead with your recommendation. If the founder suggests a specific fix and a better one exists, say so and recommend the better one. Show options only when there is a real trade-off, and say which you recommend. When the founder describes a problem through an example, treat the example as one case of a general problem: solve the whole category with the best professional approach, and write the general principle, never a rule about the single example.

- Start every reply with a short plain-English summary, and explain anything he must do in plain English, step by step.
- Ask only when a real decision is needed. Otherwise choose the sensible default and say what you chose.

## Runbook steps

When the founder says "do runbook step X.Y", follow that step in [docs/setup/RUNBOOK.md](docs/setup/RUNBOOK.md) exactly, then record the result in [docs/setup.md](docs/setup.md) the same day: what was set, where, and how it was checked. Never record a secret.

## End of every session

Update the status file for the part you worked on in `docs/status/` (Done, Next, Open questions), as part of that session's pull request.

## How changes land (from now on, including staging)

- **Every change goes on its own branch and pull request.** Never commit to `main` directly; GitHub refuses it anyway.
- **You open the pull request, the checks that fit the change run, and you merge it yourself as soon as they pass.** No human approval. Turn on auto-merge when you open it (`gh pr merge --auto --squash`), so it merges the moment the checks are green.
- **The secret check** (gitleaks, `.github/workflows/secret-check.yml`) runs automatically on every pull request over the whole history.
- **Preview link:** once Vercel is connected, every pull request gets one.
- **GitHub enforces it:** the ruleset "main" requires the checks to pass before merging, blocks force-pushes and deletion of `main`, and requires no reviews. Merges are squash-only, and the branch is deleted after merging.

## Checks sized to the change (PLAN.md section 3)

Label every change with its size at the start of the commit message and the pull request title: `[small]`, `[normal]` or `[risky]`.

- **Small** (text, colours, spacing, simple fixes): quick checks, plus the screen check and screenshots (see "Screens fit every device") if a screen changed.
- **Normal:** quick checks, plus the tests for the parts the change touches.
- **Risky** (market maths, play money, login, database structure, the core of the news engine, payments): the full test suite plus AI review.
- **Production release:** everything, once.

## Environments and secrets

- Staging is a sandbox: fully separate from production, no real user data, a spending cap on every paid service. The AI holds its keys.
- Secrets live only in Doppler, project `hrizzup`: `dev` (local work and Claude Code's setup keys), `stg` (staging), `stg_preview` (previews: a branch of `stg` that copies every staging value automatically and holds only overrides) and `prd` (production). Never print, log or commit a secret value; refer to secrets by name only. Never ask the founder to paste a secret into chat. Production keys never go in this repository.
- Doppler is on its free Developer plan during staging, which has no roles, so only the founder and Claude Code use it. Before any helper joins Doppler, it moves to the Team plan (runbook step 10.1), and helpers get no access to Production.
- Mumbai is the region everywhere (Vercel `bom1`; Supabase `ap-south-1`), and `/api/health` shows the region.
- **Production runs on the same platforms as staging:** Vercel plus Supabase, set up exactly like staging (same services, versions, region and settings), with its own data and keys. It is created as soon as staging works, with nothing public until launch (runbook Part 10, "Production twin").
- **Releasing** means promoting the exact production build of a commit that passed staging, with one command: `vercel promote <deployment URL>`. No rebuild; `vercel rollback` goes back. The runbook's "Releasing to production" has the details.

## Building

- Build on standard, portable pieces. AWS is not the production plan: it comes later only if a concrete need appears, as its own project.
- Media: images go through Cloudflare image transformations; creator videos are stored and played through Cloudflare Stream.

## Performance and caching (full detail: [blueprint, "Production quality"](docs/setup/BLUEPRINT.md#14-production-quality))

Every page and every screen is built to load fast and stay fast. Performance is part of "done", never a later fix.

- **Cache in layers, designed in for every page and API from the start:** the device (browser and app caches, long-lived files with versioned names), the edge (Cloudflare and Vercel, refreshed in the background), server data caches (updated or cleared the moment the data changes), Upstash Redis (the shared fast layer; every entry has an expiry and is cleared when its data changes), and the database (indexes for every search and sort, page-by-page loading, no repeated small queries).
- **Batch:** one request to Redis or the database, never several separate trips when one will do.
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
