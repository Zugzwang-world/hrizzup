# Key check

`check.py` confirms that one environment's keys are the right ones without using any of them for real, so a slip while copying a key shows up straight away, not at launch. The health page (`/api/health`) already proves the database, Redis, storage and Supabase's sign-in service answer; this covers the rest:

- the Google sign-in client's ID and secret (Google's token service is sent a made-up code), and that Google accepts Supabase's callback for it;
- the Resend key is valid and sending-only;
- the Turnstile keys are the environment's own widget (not Cloudflare's test keys) and the secret is accepted;
- Supabase's secret key reaches the server-only admin address, and the public sign-in settings show exactly Google and email codes;
- the R2 key lists this environment's two buckets and is refused for the other environment's.

It prints one word per check, never a key or an answer's contents.

- **Staging** (Claude Code): `infra/doppler/run stg -- python3 infra/keys/check.py staging`. With the previews' config it fails on purpose: previews use Cloudflare's Turnstile test keys.
- **Production:** only the release pipeline, before it changes anything (`.github/workflows/release.yml`, step 2).
