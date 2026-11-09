# Supabase Auth settings kept in the repo

Sign-in for the website and the app runs on Supabase Auth. Its settings live here, so staging and production get exactly the same ones, and a change is a pull request like any other.

| File | What it is |
|---|---|
| `settings.json` | Every setting this folder manages: shared ones, plus each environment's addresses and hourly email limit (each environment's project is in `../project/settings.json`). Secrets appear only as the names of the Doppler keys that supply them |
| `templates/sign-in-code.html` | The sign-in code email, used for the "confirm sign-up", "sign-in" and "reset password" emails, so every way of asking for a code gets the same email |
| `templates/email-change-code.html` | The code to confirm a change of email address (sent to both the old and the new address) |
| `apply.py` | Sends the settings to Supabase's Management API, reads them back and fails if anything differs. `--check` only compares |
| `test_apply.py` | Offline tests of the hook safeguard (below), in Quick checks and `pnpm check` |

**Staging** (Claude Code):

```sh
infra/doppler/run tools stg -- python3 infra/supabase/auth/apply.py staging   # or: ... staging --check
```

**Production:** only the release pipeline, with its own credentials (runbook Part 10, `.github/workflows/release.yml` step 5). Each environment's project ID lives in `infra/supabase/project/settings.json`; production's is filled in once `hrizzup-production` exists. Claude Code's Supabase token reaches only `hrizzup-staging`, so Supabase itself refuses it for production.

**Safeguards:**
- It refuses to run if `SUPABASE_URL` belongs to a different project than the chosen environment, so one environment's keys can't land in the other.
- It refuses Cloudflare's published Turnstile test keys (the previews' override in `stg_preview`).
- It checks that the email template's "expires in N minutes" matches `mailer_otp_exp`.
- It fails if any way to sign in is on in Supabase (any `external_…_enabled`, SAML, passkeys, custom OAuth or Supabase as an OAuth server) that `settings.json` doesn't switch on.
- **Before switching on a hook** (a database function Supabase Auth calls), it asks that environment's own database, read-only, whether the function exists and whether Supabase Auth's role may run it, and refuses if not: a hook that can't run stops every sign-in. The function comes from a migration, so migrations come first (the release pipeline applies them before these settings). Its offline tests also prove that every hook `settings.json` switches on is created by a migration and granted to Supabase Auth alone.

**Secrets:** Supabase keeps its own copies of `GOOGLE_OAUTH_CLIENT_SECRET`, `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY`. Whenever one of them changes in Doppler, run `apply.py` for that environment the same day (blueprint rule 3: a secret change does nothing until it's applied). Supabase returns secrets only as a keyed fingerprint (HMAC-SHA256 with the project ref as the key), which is how `apply.py` compares them. Nothing is ever printed but setting names and non-secret values.

**What's set** (blueprint section 9):
- site address and the only allowed redirect addresses (staging, `http://localhost:3000` and this Mac's slots, `http://localhost:3101` to `3104`, which `infra/slots/test_slots.py` keeps in step with the slots; production's two names, never a local one);
- Google on, with nonce checks on. The app's native client IDs (Android, iOS) go into `external_google_additional_client_ids` with the app builds;
- email codes: 8 digits, valid 10 minutes, sent through Resend's SMTP from `no-reply@mail.hrizzup.com`, at most one email a minute to the same address and 30 an hour in total (production's hourly limit is raised before launch). No email carries a link;
- passwords: Supabase can't switch them off on their own while email codes are on, so password rules are strict (at least 12 characters, and passwords known from data leaks refused), and **the Custom Access Token hook is on** (`hook_custom_access_token_enabled`, `hook_custom_access_token_uri`): `auth_hooks.refuse_password_sessions`, from `../migrations/…_refuse_password_sessions.sql`, refuses any session made with a password, or the refresh of one, and passes every other session unchanged. Supabase's password hook is on the Team plan only (founder's decision, 8 November 2026; blueprint section 9; built in PLAN.md step 1.6a). If a good sign-in ever fails because of it, switching it off is one setting (`hook_custom_access_token_enabled: false`), applied the same way;
- Turnstile on Supabase Auth's email routes (sign-up, sign-in codes, password reset). Google sign-in doesn't need it.
