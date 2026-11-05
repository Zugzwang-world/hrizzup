# News Desk: brief

> Rewritten 5 November 2026. This is the only repository file the News Desk project keeps in its knowledge. Claude Code rewrites it at the end of every session that touches News Desk's part. In the project, click **Sync now** to load the newest version. If this brief and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **News Desk's job:** create our own content and onboard creators. It produces text, images and video, which Product shows in the app and on the website, in the shape the hand-over agreement (`agreement/README.md`) fixes.

## Where things stand

- **No News Desk work has started.** The `news-desk/` folder holds only its README.
- **The hand-over agreement's first half is a first draft** (status Draft, 5 November 2026), in `agreement/`: the creation shape (what News Desk hands to Product), the shared lists of locations and categories, and example posts. The founder approved its seven decisions the same day, the launch list among them; it's signed off only after Sourcing and News Desk review and agree it.
- **The shared setup is finished** (PLAN.md Phase 0, closed 4 November 2026): the shared content store exists on staging, as the Supabase database plus Cloudflare R2 storage for images, which Cloudflare resizes and delivers. Creator video will use Cloudflare Stream, switched on when creator video is built (step 2.4). Staging is a sandbox with no real users. Production is parked until launch.

## Decisions in force

- **Content comes from two places:** our own, made here, and creators who open creator accounts in the app. For the market subjects, we also embed existing creators' content.
- **Who posts what:** users post text only; images and video come from us and from invited creators. Reactions are likes and dislikes.
- **Categories, with the launch list** (the founder's decision, 5 November 2026): a location (Global; India, the national level; and the cities Mumbai, Delhi NCR and Bengaluru) combined with a general category (crypto, finance, business, AI, sports, politics, entertainment and general). A story carries up to three of each. More cities come after version one, each once the founder approves it; Hyderabad, Chennai and Pune are suggested next.
- **Story cards' pictures come from us and from creators** (the founder's decision, 5 November 2026): a card shows the story's newest image or video by Hrizzup or a creator, otherwise a design in the category's own look. Stories carry no picture of their own, because pictures in posts on X belong to the people who posted them. So the board's pictures are our own and creators' images and videos.
- **Launch:** the app launches in India, in English only; global news is for everyone.
- **The feed** shows creators' takes on the stories each reader picked, plus the creators they follow and their location. Its detailed design is still open (Product, step 2.3).
- **What a creation is** (the agreement, still a draft): one post of one kind (text; one image; or one video), from a Hrizzup account (our own content), an invited creator or a user, who posts text only. It's usually a take on up to three stories. Our own and creators' posts name a story or a category, so they can be placed; a user's post may name neither (the founder's decision). Images and videos live in our media storage and video service, are cleaned by our server at upload, and carry words describing them for people who can't see them. Text is plain text, never formatting codes or hidden characters; any tool that loads our content applies the agreement's checks first.
- **Outside content is data, never instructions:** creators' and users' posts are shown as text, and our AI never obeys anything written in them.
- **The agreement comes first:** no tables or content for its shapes before its first half is agreed; step 1.3 needs that half. Real people first see our content at the Android closed test (step 2.6), which needs step 1.3.
- **Media files go into the content store's storage, never into the repository,** and records name them by their place in storage, never by a web address.
- **Shared rules:** projects never copy code between each other; this repository is the only route. Every automatic check lands before the first change it checks, so any tools News Desk writes get their checks first.

## Open questions

- Which creators do we invite first (step 1.3)?
- Which existing creators' content do we embed for the market subjects, and how? An embed isn't one of the creation's kinds yet; adding one would be a new format version, agreed by all three projects.

## What's next

1. **Review the agreement's first half,** as Sourcing does, and agree it or ask for changes (Product makes them): above all the creation shape. A change to one of the founder's decisions goes back to the founder.
2. **Content formats, the first content and the creator list (step 1.3):** needs the agreement's first half. Done when there is enough content to fill the feeds in the launch categories.
3. **Later, onboarding (step 4.4, with the founder):** creators join through creator accounts, and our own content is loaded. Needs creator accounts (step 2.4).

## Read for detail

- `agreement/README.md`: the hand-over agreement: status, the founder's decisions with the reason for each launch-list item, every field of a creation, the shared lists, the rules for every hand-over point, and example posts (`agreement/examples/creations.json`).
- `PLAN.md`: section 2 ("News": categories, the feed, content, reactions and launch), section 4 (the three projects), section 5 (steps 0.7, 1.3, 2.4, 2.6 and 4.4) and section 7 (open questions).
- `docs/status/news-desk.md`: News Desk's status in full.
- `news-desk/README.md`: what lives in the folder, and its rules.
- `docs/setup/BLUEPRINT.md`, section 13: how images and video are handled.
