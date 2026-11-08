# Vercel settings kept in the repo

The Vercel project `hrizzup` (team `hrizzup`, Pro) hosts the website for previews, staging and production (blueprint section 6). Its settings live here, so a change is a pull request like any other, and nothing set only in the dashboard can drift unnoticed.

| File | What it is |
|---|---|
| `project.json` | The project: its link to `Zugzwang-world/hrizzup` (production branch `main`), its settings, the custom environment `staging` (follows the `staging` branch, serves `staging.hrizzup.com`; the Staging workflow moves the branch and starts the build through the deploy hook "Staging workflow"; Vercel's own build on a push to `staging` is off in `product/web/vercel.json`) and the production domains (`hrizzup.com`, with `www` redirecting to it) |
| `firewall.json` | The firewall: Bot Protection (challenge), AI bots (log only), and the rate limits on sign-in, on every route that sends email, on `/api/health` and on staging's typed API (`/api/v1/` on `staging.hrizzup.com`); `/api/health` and reads of staging's typed API skip the bot challenge |
| `apply.py` | Sends both to Vercel's API, reads everything back, and fails, listing each difference, if Vercel doesn't match. `--check` only compares; `--staging-only` applies only what is staging's own (below) |
| `../../product/web/vercel.json` | The deployment's own settings: framework and the function region (`bom1`, Mumbai) |

**Running it** (Claude Code; the Vercel token lives in Doppler `hrizzup-tools`):

```sh
infra/doppler/run tools -- python3 infra/vercel/apply.py --check   # compare only
infra/doppler/run tools -- python3 infra/vercel/apply.py           # apply, then compare
```

**These settings also cover production.** One Vercel project serves every environment, so the project's settings, its domains and its firewall reach production too. Claude Code applied them in runbook Part 9, before production had any keys or data. From Part 10 on, a change here that touches production is applied by the release pipeline. **`--staging-only`** applies only what is staging's own: its domain's protection exception, and the firewall rules limited to its domain (every condition group of the rule needs the host to be `staging.hrizzup.com`, and its action stays with the request it matches: no persistent action, which would block an address for the whole project, and no bypass of the DDoS mitigations). It runs only when everything else already matches the repo. It starts from Vercel's live firewall, so every setting and rule that reaches production goes back exactly as it is; it refuses if the repo's firewall changes anything that reaches production (the managed rules, or a rule not limited to staging), and if Vercel's answer then differs in such a part, it puts the config back. Its tests: `python3 -m unittest discover -s infra/vercel` (in Quick checks). `--check` is safe at any time, and the release pipeline runs it before every promotion, because `autoAssignCustomDomains` must stay off (blueprint section 6).

**What the main settings do:**
- **`autoAssignCustomDomains: false`:** every merge to `main` makes a hidden production build; `hrizzup.com` changes only when a build is promoted.
- **`ssoProtection: all_except_custom_domains`** (Vercel's "Standard Protection", Vercel Authentication): every preview, staging (`staging.hrizzup.com`) and the private address of every production build need a Vercel login; only `hrizzup.com` and `www` are public. Automated checks get in with the protection bypass for automation (secret `VERCEL_AUTOMATION_BYPASS_SECRET`, Doppler `hrizzup-tools`, with a copy in GitHub's secrets for the Screen check).
- **`skewProtectionMaxAge: 43200`:** Skew Protection for 12 hours. A visitor whose page came from an older deployment keeps talking to that deployment's server code, so a release never breaks a page that is already open.
- **`enablePreviewFeedback: true`, `enableProductionFeedback: false`:** the Vercel Toolbar and comments on previews (and staging), never on the live site.
- **`resourceConfig.functionDefaultRegions: ["bom1"]`** and **`fluid: true`:** functions in Mumbai, on Fluid compute.
- **`enableAffectedProjectsDeployments: false`:** every commit builds, so every pull request gets a preview and every merge reaches staging; unchanged builds are fast because of the Remote Cache.
- **Not switched on:** Speed Insights and Web Analytics (decided in Part 10, before launch). `apply.py` fails if either is on. Observability Plus is a team setting that covers every project by default.

**The firewall's rules run top to bottom.** A route of ours that sends email must live under `/auth/email/` or `/api/email/`, and every sign-in route under `/auth/`, so the rate limits cover them; email codes that the browser asks Supabase for directly are limited by Supabase itself and by Turnstile (`infra/supabase/auth/settings.json`). The protection bypass skips the bot challenge but not these rate limits. **Apps can't pass the bot challenge** (it needs a browser), so staging's typed API skips it for reads (`GET`), behind its own rate limit (PLAN.md step 1.5d); a call that writes gets its own decision, and the bypasses stay last, since a bypass skips every rule after it; production's `/api/v1/` waits for the same pair of rules through the release pipeline, before the app uses production.
