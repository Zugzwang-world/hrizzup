# R2 storage rules

The CORS and lifecycle rules for Hrizzup's R2 buckets, kept here so every environment gets exactly the rules in the repo (blueprint section 4).

| File | Applies to |
|---|---|
| `uploads.cors.staging.json` | `hrizzup-staging-uploads`: browser uploads (`PUT`) only from our own sites |
| `media.cors.staging.json` | `hrizzup-staging-media`: browser reads (`GET`, `HEAD`) only from our own sites |
| `uploads.lifecycle.json` | Both environments' uploads buckets: incomplete uploads aborted after 1 day, raw uploads deleted after 1 day |
| `media.lifecycle.json` | Both environments' media buckets: incomplete uploads aborted after 1 day; media never deleted by a rule |

The production CORS files (`*.cors.production.json`, origins `https://hrizzup.com` and `https://www.hrizzup.com`) are added in the production twin (runbook Part 10).

**Applying:** `apply.sh staging` or `apply.sh production`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment. It replaces each bucket's rules with these files, reads them back, and fails if Cloudflare's copy differs. Claude Code applies staging with `doppler run --project hrizzup-tools --config claude -- infra/cloudflare/r2/apply.sh staging` (that project holds its Cloudflare key and the account ID); production is applied only by the release pipeline, with its own credentials (CLAUDE.md, "Production is off-limits to Claude Code").
