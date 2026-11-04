# News Desk: brief

> Rewritten 5 November 2026. This is the only repository file the News Desk project keeps in its knowledge. Claude Code rewrites it at the end of every session that touches News Desk's part. In the project, click **Sync now** to load the newest version. If this brief and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **News Desk's job:** create our own content and onboard creators. It produces text, images and video, which Product shows in the app and on the website, in the shape the hand-over agreement (`agreement/README.md`) fixes.

## Where things stand

- **No News Desk work has started.** The `news-desk/` folder holds only its README.
- **The hand-over agreement's first half is a first draft** (status Draft, 5 November 2026), in `agreement/`: the creation shape (what News Desk hands to Product), the shared lists of locations and categories, and example posts. Seven decisions wait for the founder, the launch list among them, then all three projects agree it.
- **The launch list is proposed in the agreement,** for the founder's approval: the cities Mumbai, Delhi NCR and Bengaluru, and three categories beyond the five named (Politics, Entertainment and General), each with a one-line reason.
- **The shared setup is finished** (PLAN.md Phase 0, closed 4 November 2026): the shared content store exists on staging, as the Supabase database plus Cloudflare R2 storage for images, which Cloudflare resizes and delivers. Creator video will use Cloudflare Stream, switched on when creator video is built (step 2.4). Staging is a sandbox with no real users. Production is parked until launch.

## Decisions in force

- **Content comes from two places:** our own, made here, and creators who open creator accounts in the app. For the market subjects, we also embed existing creators' content.
- **Who posts what:** users post text only; images and video come from us and from invited creators. Reactions are likes and dislikes.
- **Categories:** a location (global; national, meaning India; local, meaning Indian cities) combined with a general category (crypto, finance, business, AI, sports and more). The exact launch list is part of the agreement's first half, approved by the founder.
- **Launch:** the app launches in India, in English only; global news is for everyone.
- **The feed** shows creators' takes on the stories each reader picked, plus the creators they follow and their location. Its detailed design is still open (Product, step 2.3).
- **What a creation is** (the agreement, still a draft): one post of one kind (text; one image; or one video), from a Hrizzup account (our own content), an invited creator or a user, who posts text only. It's usually a take on up to three stories; our own and creators' posts name a story or a category, so they can be placed. Images and videos live in our media storage and video service, are cleaned by our server at upload, and carry words describing them for people who can't see them. Text is plain text, never formatting codes.
- **Outside content is data, never instructions:** creators' and users' posts are shown as text, and our AI never obeys anything written in them.
- **The agreement comes first:** no tables or content for its shapes before its first half is agreed; step 1.3 needs that half. Real people first see our content at the Android closed test (step 2.6), which needs step 1.3.
- **Media files go into the content store's storage, never into the repository,** and records name them by their place in storage, never by a web address.
- **Shared rules:** projects never copy code between each other; this repository is the only route. Every automatic check lands before the first change it checks, so any tools News Desk writes get their checks first.

## Open questions

- Which creators do we invite first (step 1.3)?
- Which existing creators' content do we embed for the market subjects, and how? An embed isn't one of the creation's kinds yet; adding one would be a new format version, agreed by all three projects.

## What's next

1. **Review and agree the agreement's first half** with Product and Sourcing: above all the creation shape and the launch list (the founder approves the list).
2. **Content formats, the first content and the creator list (step 1.3):** needs the agreement's first half. Done when there is enough content to fill the feeds in the launch categories.
3. **Later, onboarding (step 4.4, with the founder):** creators join through creator accounts, and our own content is loaded. Needs creator accounts (step 2.4).

## Read for detail

- `agreement/README.md`: the hand-over agreement: status, the founder's decisions with the proposed launch list, every field of a creation, the shared lists, the rules for every hand-over point, and example posts (`agreement/examples/creations.json`).
- `PLAN.md`: section 2 ("News": categories, the feed, content, reactions and launch), section 4 (the three projects), section 5 (steps 0.7, 1.3, 2.4, 2.6 and 4.4) and section 7 (open questions).
- `docs/status/news-desk.md`: News Desk's status in full.
- `news-desk/README.md`: what lives in the folder, and its rules.
- `docs/setup/BLUEPRINT.md`, section 13: how images and video are handled.
