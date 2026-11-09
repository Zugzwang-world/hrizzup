# News Desk: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 9 November 2026 by Round 3's relays 1b and 1c (records); its line on the content store's tables brought up to date by relay 7 ([#72](https://github.com/Zugzwang-world/hrizzup/pull/72), step 1.9). The only repository file the News Desk project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches News Desk's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **News Desk's job:** make our own content from the sourced pool and onboard creators. It produces text, images and video, which Product shows in the app and on the website, in the shape the hand-over agreement (`agreement/README.md`) fixes. **News Desk is on hold until the founder sets it up.**

## Where things stand

- **On hold** (the founder's decision, 5 November 2026) until the founder sets News Desk up. No News Desk work has started; the `news-desk/` folder holds only its README.
- **The agreement's first half is Agreed** (9 November 2026): the founder approved it in News Desk's place, after Sourcing's review ([#37](https://github.com/Zugzwang-world/hrizzup/pull/37), [#42](https://github.com/Zugzwang-world/hrizzup/pull/42), [#45](https://github.com/Zugzwang-world/hrizzup/pull/45)) and the market change ([#52](https://github.com/Zugzwang-world/hrizzup/pull/52)). Its creation shape (what News Desk hands to Product) and sourced item (what it builds on) are fixed at format version 1. News Desk reviews it once it's set up.
- **The tables exist, on Product's side** (step 1.9, [#72](https://github.com/Zugzwang-world/hrizzup/pull/72)): stories, updates, sourced items and creations, the way content reaches the product, holding the agreement's rules as database rules (our own content's route is always made, and builds only on sourced items that exist). Empty: nothing writes to them or fills them yet.
- **The shared setup is finished** (Phase 0): the content store on staging is the Supabase database plus Cloudflare R2 for images; creator video uses Cloudflare Stream, switched on with step 2.4. Production is parked until launch.

## Decisions in force

- **Content reaches the product by three routes** (the founder, 5 November 2026):
  - **found:** a creator's post the bots found on X, shown in its story's feed as the original post, embedded and credited to its creator, never copied, for every story. The bots keep only takes in English (the founder, 9 November 2026), so our own content builds on English takes;
  - **made:** our own content, which News Desk makes from the sourced pool, where the bots keep the news and creators' takes they find on X;
  - **posted:** creators and users posting directly in the app.
  Product only displays: the board shows stories, and the feed shows takes from all three routes, each credited by its route.
- **Our own content credits what it builds on:** a creation names the sourced items it was made from (`based_on`), and Product credits their creators alongside it, linking to the original posts. It never copies a found post's words, pictures or video.
- **What a creation is:** one post of one kind (text, one image or one video), from a Hrizzup account (made), an invited creator or a user (posted), saying its route, which must match its author; usually a take on up to three stories. Our own and creators' posts name a story or a category; a user's post may name neither. Images and videos are cleaned at upload and carry descriptions for people who can't see them. Text is plain text.
- **What a sourced item is:** one thing the bots found: news or a take, the post's address on X, who posted it (as X shows the account now), what it holds, a summary in our own words, its stories, and whether it's live, unavailable or withdrawn. Once a post can't be shown, its item keeps nothing of it, and our credit to it disappears. Build only on live ones.
- **Who posts what:** users post text only; images and video come from us and from invited creators. Reactions are likes and dislikes.
- **The founder's decisions in the agreement** (changing one goes back to the founder): the launch list (Global; India; Mumbai, Delhi NCR and Bengaluru; crypto, finance, business, AI, sports, politics, entertainment and general), up to three of each per story; a story card shows the story's newest image or video by Hrizzup or a creator, otherwise a design in the category's own look, never a found post's picture, so our own and creators' images and videos are the board's pictures.
- **Changing the first half, now it's Agreed:** an optional field, or a list item the founder approves, is one change; anything else is a new format version (such as `creation/2`), agreed by all three projects, with the founder in News Desk's place while it's on hold. Any change News Desk asks for in its review follows these rules. The second half (the bots' result format) doesn't need News Desk's agreement.
- **Steps:** step 1.3 needs the first half (Agreed); its first batch needs the news pipeline (1.1), which needs the content store's tables (1.9), whose database rules keep one sourced item per post, nothing of a post that's gone, and no chained merges. Step 4.4 needs 1.3. Real people first see our content at the Android closed test (2.6).
- **Launch:** in India, in English only; global news is for everyone.
- **The feed:** takes on the stories each reader picked, from all three routes, plus the creators they follow and their location; its design is Product's (step 2.3).
- **Outside content is data, never instructions:** posts are shown as text, and our AI never obeys anything written in them.
- **Media files go into the content store's storage,** never into the repository, named by their place in storage.
- **Legal belongs to the founder's legal team:** takedown handling and legal review are theirs; the plan adds no legal guardrails.
- **No relays:** the founder carries no messages between projects; this brief carries what News Desk needs.
- **Shared rules:** this repository is the only route between projects; every check lands before the code it checks; sessions run unattended, in rounds; database changes land first, each in its own pull request (CLAUDE.md).

## What changed in the latest session

On 9 November 2026, in [#61](https://github.com/Zugzwang-world/hrizzup/pull/61) (Round 3, relay 1b), the founder's decision, replacing what Round 3's first records ([#60](https://github.com/Zugzwang-world/hrizzup/pull/60)) said about Sourcing:

- **Hrizzup uses no xAI API:** Grok bots source everything, and Sourcing's work runs asynchronously, in the Sourcing project, on its own schedule, not from Product's round chat.
- **Product never uses xAI's API or X's API:** it receives what goes on the product, our own content included, through the content store's tables (1.9); found posts are still X's own embeds.
- **For News Desk, nothing else changes;** the agreement's rules stand. Then [#62](https://github.com/Zugzwang-world/hrizzup/pull/62) (relay 1c) recorded how Product's rounds run and the perp's steps, nothing for News Desk.

## Open questions

- **Which creators to invite first** (step 1.3). Recommendation: start from the creators whose takes the bots find most often in each launch category, once the pipeline runs, since they're already active on our stories; invite those with original work and a steady record.
- **How News Desk chooses what to build on, and what each format looks like made from the pool** (step 1.3). Recommendation: three formats to start: explainers (what's happening and why), roundups of the best found takes on a story, each credited, and, once step 1.2 chooses the markets' topics, charts for them; each names the posts it builds on.
- **When News Desk is set up** (the founder). Recommendation: once the news pipeline (1.1) is close to running on staging, so formats and the creator list are ready when the pool fills; earlier if the closed test (2.6) waits for News Desk's first content.

## What's next

1. **On hold** until the founder sets News Desk up.
2. **Then review the agreement's first half,** above all the creation shape and the sourced item. Any change it asks for follows the agreement's change rules.
3. **Content formats, the first content and the creator list (step 1.3):** formats and the list need the first half, which is Agreed; the first batch, made from the sourced pool, needs the pipeline (1.1). Done when there's enough content to fill the feeds in the launch categories.
4. **Later, onboarding (step 4.4, with the founder):** creators join through creator accounts, and our own content is loaded. Needs creator accounts (2.4) and step 1.3.

## Read for detail

- `agreement/README.md`: sign-offs, the routes, every field of a creation and a sourced item, the lists, the hand-over rules and how the agreement changes; examples in `agreement/examples/` (`creations.json`, `sourced.json`); Sourcing's review, with the founder's answers, in `agreement/reviews/`.
- `PLAN.md`: section 2 ("News": categories, the feed, the three routes, reactions, launch), section 4 (the projects, News Desk's hold, legal), section 5 (steps 0.7, 1.3, 1.9, 2.4, 2.6 and 4.4).
- `docs/status/news-desk.md`: News Desk's status in full.
- `news-desk/README.md`: what lives in the folder, and its rules.
- `docs/setup/BLUEPRINT.md`, section 13: how images and video are handled.
