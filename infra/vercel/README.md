# Vercel settings kept in the repo

The Vercel project `hrizzup` (team `hrizzup`, Pro) hosts the website for previews, staging and production (blueprint section 6). Its settings live here, so a change is a pull request like any other, and nothing set only in the dashboard can drift unnoticed.

| File | What it is |
|---|---|
| `project.json` | The project: its link to `Zugzwang-world/hrizzup` (production branch `main`), its settings, the custom environment `staging` (follows the `staging` branch, serves `staging.hrizzup.com`; the Staging workflow moves the branch and starts the build through the deploy hook "Staging workflow") and the production domains (`hrizzup.com`, with `www` redirecting to it) |
| `firewall.json` | The firewall: Bot Protection (challenge), AI bots (log only), and the rate limits on sign-in, on every route that sends email, and on `/api/health` |
| `apply.py` | Sends both to Vercel's API, reads everything back, and fails, listing each difference, if Vercel doesn't match. `--check` only compares |
| `../../product/web/vercel.json` | The deployment's own settings: framework and the function region (`bom1`, Mumbai) |

**Running it** (Claude Code; the Vercel token lives in Doppler `hrizzup-tools`):

```sh
doppler run --project hrizzup-tools --config claude -- python3 infra/vercel/apply.py --check   # compare only
doppler run --project hrizzup-tools --config claude -- python3 infra/vercel/apply.py           # apply, then compare
```

**These settings also cover production.** One Vercel project serves every environment, so the project's settings, its domains and its firewall reach production too. Claude Code applied them in runbook Part 9, before production had any keys or data. From Part 10 on, a change here that touches production is applied by the release pipeline. `--check` is safe at any time, and the release pipeline runs it before every promotion, because `autoAssignCustomDomains` must stay off (blueprint section 6).

**What the main settings do:**
- **`autoAssignCustomDomains: false`:** every merge to `main` makes a hidden production build; `hrizzup.com` changes only when a build is promoted.
- **`ssoProtection: all_except_custom_domains`** (Vercel's "Standard Protection", Vercel Authentication): every preview, staging (`staging.hrizzup.com`) and the private address of every production build need a Vercel login; only `hrizzup.com` and `www` are public. Automated checks get in with the protection bypass for automation (secret `VERCEL_AUTOMATION_BYPASS_SECRET`, Doppler `hrizzup-tools`, with a copy in GitHub's secrets for the Screen check).
- **`skewProtectionMaxAge: 43200`:** Skew Protection for 12 hours. A visitor whose page came from an older deployment keeps talking to that deployment's server code, so a release never breaks a page that is already open.
- **`enablePreviewFeedback: true`, `enableProductionFeedback: false`:** the Vercel Toolbar and comments on previews (and staging), never on the live site.
- **`resourceConfig.functionDefaultRegions: ["bom1"]`** and **`fluid: true`:** functions in Mumbai, on Fluid compute.
- **`enableAffectedProjectsDeployments: false`:** every commit builds, so every pull request gets a preview and every merge reaches staging; unchanged builds are fast because of the Remote Cache.
- **Not switched on:** Speed Insights and Web Analytics (decided in Part 10, before launch). `apply.py` fails if either is on. Observability Plus is a team setting that covers every project by default.

**The firewall's rules run top to bottom.** A route of ours that sends email must live under `/auth/email/` or `/api/email/`, and every sign-in route under `/auth/`, so the rate limits cover them; email codes that the browser asks Supabase for directly are limited by Supabase itself and by Turnstile (`infra/supabase/auth/settings.json`). The protection bypass skips the bot challenge but not these rate limits.
