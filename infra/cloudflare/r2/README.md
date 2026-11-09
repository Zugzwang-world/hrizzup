# R2 storage settings

Each environment's two R2 buckets and their rules, kept here so every environment gets exactly the settings in the repo (blueprint section 4).

| File | Applies to |
|---|---|
| `apply.py` | Applies and checks one environment: both buckets exist in Asia-Pacific (Standard storage), their `r2.dev` addresses are off, the media bucket's only public address is its own (minimum TLS 1.2, certificate active) and the uploads bucket has none, and the CORS and lifecycle rules match these files. `--check` only compares |
| `uploads.cors.staging.json` | `hrizzup-staging-uploads`: browser uploads (`PUT`) only from staging, `http://localhost:3000`, this Mac's slots (`http://localhost:3101` to `3104`; `infra/slots/test_slots.py` keeps them in step) and our previews. The website's upload journey proves it from each (`product/web/e2e/journeys/upload.spec.ts`) |
| `media.cors.staging.json` | `hrizzup-staging-media`: browser reads (`GET`, `HEAD`) from the same sites |
| `uploads.cors.production.json` | `hrizzup-uploads`: browser uploads only from `https://hrizzup.com` and `https://www.hrizzup.com` |
| `media.cors.production.json` | `hrizzup-media`: browser reads from the same two |
| `uploads.lifecycle.json` | Both environments' uploads buckets: incomplete uploads aborted after 1 day, raw uploads deleted after 1 day |
| `media.lifecycle.json` | Both environments' media buckets: incomplete uploads aborted after 1 day; media never deleted by a rule |

| Environment | Buckets | Public address |
|---|---|---|
| Staging | `hrizzup-staging-uploads`, `hrizzup-staging-media` | `media-staging.hrizzup.com` |
| Production | `hrizzup-uploads`, `hrizzup-media` | `media.hrizzup.com` |

**Applying:** `apply.py staging` or `apply.py production` (add `--check` to change nothing), with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment (and `CLOUDFLARE_ZONE_ID` if a public address still has to be connected). It creates a missing bucket, turns `r2.dev` off, replaces each bucket's rules with these files, reads everything back, and fails if Cloudflare's copy differs.
- **Staging:** Claude Code, with `infra/doppler/run tools -- python3 infra/cloudflare/r2/apply.py staging` (that project holds its Cloudflare key and the account and zone IDs).
- **Production:** only the release pipeline, with its own key (`CLOUDFLARE_API_TOKEN` in Doppler `prd_release`, limited to R2). Claude Code created production's buckets, `media.hrizzup.com` and their rules once, on 3 November 2026, before production had any keys or data (founder's decision); its key is never used on production's buckets again (CLAUDE.md, "Production is off-limits to Claude Code").
