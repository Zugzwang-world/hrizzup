# Zugzwang World: retirement list

> Everything Zugzwang World still has in the accounts Hrizzup shares, and what happens to each item when Zugzwang World is retired. Blueprint rule 9: teardown is planned as carefully as a launch. When a service goes, its DNS records, syncs and keys go with it, and each removal is recorded in `docs/setup.md` on the day.
> Started 3 November 2026. Items are added as Hrizzup's setup comes across them; the Zugzwang World setup inventory (2 November 2026) is the starting point for anything not yet listed.

**When:** the founder decides when Zugzwang World is retired. Until then, nothing on this list is deleted unless it's marked as already gone.

| Where | What's left | State | At retirement |
|---|---|---|---|
| Doppler | Project `zugzwang-experiment` (created 18 May 2026), with configs `stg` (44 secrets) and `prd` (39). Both were last read on 2 November 2026 | **Kept until retirement** (founder, 3 November 2026) | Check that none of its configs still syncs to a platform, then delete the project |
| Doppler, inside `zugzwang-experiment` | `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, in both `stg` and `prd` | **Already dead.** The founder deleted the experiment's Upstash database on 3 November 2026. Checked the same day: the old staging address no longer exists in DNS | Nothing extra; they go with the project |
| Upstash | The experiment's Redis database | **Gone.** Deleted by the founder on 3 November 2026; the account now holds only `hrizzup-staging` | Nothing left to do |
| Resend | The domain `mail.zugzwangworld.com` and an API key named "Onboarding" (last used 26 October 2026), in the same account as Hrizzup's sending domain | Still there | Delete the key, then the domain, then the domain's DNS records wherever `zugzwangworld.com`'s DNS is hosted |
| Cloudflare R2 | Five buckets in the same account as Hrizzup's: `zugzwang-market-media`, `zugzwang-pfp`, `zugzwang-staging-pfp`, `zugzwang-staging-uploads` and `zugzwang-uploads` | Still there, left alone. Hrizzup's staging R2 key is limited to its own two buckets (it was refused for `zugzwang-uploads` in the 3 November 2026 test) | Once nothing needs their files: empty and delete them, with any custom domains and DNS records that point at them |

**Not Zugzwang World, for the record:** Doppler's own sample project, `example-project`, was deleted on 3 November 2026 (setup log).
