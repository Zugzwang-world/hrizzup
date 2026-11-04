# News Desk: brief

> Rewritten 4 November 2026. This is the only repository file the News Desk project keeps in its knowledge. Claude Code rewrites it at the end of every session that touches News Desk's part. In the project, click **Sync now** to load the newest version. If this brief and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **News Desk's job:** create our own content and onboard creators. It produces text, images and video, which Product shows in the app and on the website, in the format the hand-over agreement fixes.

## Where things stand

- **No News Desk work has started.** The `news-desk/` folder holds only its README.
- **The shared setup is finished** (PLAN.md Phase 0, closed 4 November 2026): the shared content store exists on staging, as the Supabase database plus Cloudflare R2 storage for images, which Cloudflare resizes and delivers. Creator video will use Cloudflare Stream, switched on when creator video is built (step 2.4). Staging is a sandbox with no real users. Production is parked until launch.

## Decisions in force

- **Content comes from two places:** our own, made here, and creators who open creator accounts in the app. For the market subjects, we also embed existing creators' content.
- **Who posts what:** users post text only; images and video come from us and from invited creators. Reactions are likes and dislikes.
- **Categories:** a location (global; national, meaning India; local, meaning Indian cities) combined with a general category (crypto, finance, business, AI, sports and more).
- **Launch:** the app launches in India, in English only; global news is for everyone.
- **The feed** shows creators' takes on the stories each reader picked, plus the creators they follow and their location. Its detailed design is still open (Product, step 2.3).
- **The hand-over agreement comes first:** exactly what a creation (text, image, video) looks like when it passes to Product. No project writes content before it is agreed.
- **Media files go into the content store's storage, never into the repository.** Images are cleaned on our server at upload (location data stripped) and delivered resized; videos stream at the quality each connection can take.
- **Shared rules:** projects never copy code between each other; this repository is the only route.

## Open questions

- Which are the launch categories: which Indian cities, and which general categories beyond the five named?
- Which creators do we invite first (step 1.3)?
- Which existing creators' content do we embed for the market subjects, and how?

## What's next

1. **The hand-over agreement (step 0.7):** with Product, who drafts it, and Sourcing: what a creation looks like when it passes to Product.
2. **Content formats, the first content and the creator list (step 1.3):** done when there is enough content to fill the feeds in the launch categories. Needs step 0.7.
3. **Later, onboarding (step 4.4, with the founder):** creators join through creator accounts, and our own content is loaded. Needs creator accounts (step 2.4).

## Read for detail

- `PLAN.md`: section 2 ("News": categories, the feed, content, reactions and launch), section 4 (the three projects), section 5 (steps 0.7, 1.3, 2.4 and 4.4) and section 7 (open questions).
- `docs/status/news-desk.md`: News Desk's status in full.
- `news-desk/README.md`: what lives in the folder, and its rules.
- `docs/setup/BLUEPRINT.md`, section 13: how images and video are handled.
