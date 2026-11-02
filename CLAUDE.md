# Hrizzup

Hrizzup is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. Android first, then iPhone; the website is phone-first; one shared account.

**[PLAN.md](PLAN.md) is the single source of truth.** If anything disagrees with it, PLAN.md wins. The setup blueprint and the runbook live in [docs/setup/](docs/setup/).

**Layout:** `sourcing/` (Grok bots, news pipeline, market data), `news-desk/` (our content, creators), `product/` (app, website, markets). Projects never copy code between each other; this repository is the only route.

## Working with the founder

- The founder is non-technical. Start every reply with a short plain-English summary, and explain anything they must do in plain English, step by step.
- Ask only when a real decision is needed. Otherwise choose the sensible default and say what you chose.

## Runbook steps

When the founder says "do runbook step X.Y", follow that step in [docs/setup/RUNBOOK.md](docs/setup/RUNBOOK.md) exactly, then record the result in [docs/setup.md](docs/setup.md) the same day: what was set, where, and how it was checked. Never record a secret.

## End of every session

Update the status file for the part you worked on in `docs/status/` (Done, Next, Open questions) and commit it (through a pull request once `main` is protected).

## Checks sized to the change (PLAN.md section 3)

Label every change with its size at the start of the commit message and pull request title: `[small]`, `[normal]` or `[risky]`.

- **Small** (text, colours, spacing, simple fixes): quick checks, plus screenshots at the four screen sizes if a screen changed.
- **Normal:** quick checks, plus the tests for the parts the change touches.
- **Risky** (market maths, play money, login, database structure, the core of the news engine, payments): the full test suite plus AI review.
- **Production release:** everything, once.

## Environments and secrets

- Staging is a sandbox: fully separate from production, no real user data, a spending cap on every paid service. The AI holds its keys.
- Secrets live only in Doppler (configs `dev`, `preview`, `stg`, `prd`). Never print, log or commit a secret value; refer to secrets by name only. Never ask the founder to paste a secret into chat. Production keys never go in this repository.
- Mumbai is the region everywhere (Vercel `bom1`; Supabase and AWS `ap-south-1`), and `/api/health` shows the region.

## Building

- Build on standard, portable pieces, so the later move from Vercel and Supabase to AWS is a copy, not a rebuild.
- Design for phones first. Check every screen at phone, tablet, laptop and large-monitor sizes (360, 768, 1440 and 1920 pixels wide).
- Open-source code copied in keeps its licence notice and is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
