# News Desk: brief

**This brief replaces Claude Code's report:** read it after clicking **Sync now**, instead of asking the founder for a report, and attach the files under "Read for detail" from GitHub when you need more.

> Rewritten 9 November 2026. The only repository file the News Desk project keeps in its knowledge; Claude Code rewrites it at the end of every session that touches News Desk's part. If it and PLAN.md disagree, PLAN.md wins.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. Our AI finds news as it breaks on X and turns it into developing stories that readers see through creators' takes. **News Desk's job:** make our own content from the sourced pool and onboard creators. It produces text, images and video, which Product shows in the app and on the website, in the shape the hand-over agreement (`agreement/README.md`) fixes. **News Desk is on hold until the founder sets it up.**

## Where things stand

- **On hold** (the founder's decision, 5 November 2026) until the founder sets News Desk up. No News Desk work has started; the `news-desk/` folder holds only its README.
- **The agreement's first half is a Draft, reviewed by Sourcing and awaiting the founder's approval** (its market revised to the market model on 9 November 2026; revised 8 November after Sourcing's review, [#37](https://github.com/Zugzwang-world/hrizzup/pull/37), [#42](https://github.com/Zugzwang-world/hrizzup/pull/42) and [#45](https://github.com/Zugzwang-world/hrizzup/pull/45): the creation shape is unchanged; updates name their posts in `based_on`; `withdrawn` covers legal takedowns too): the creation shape (what News Desk hands to Product), the sourced item (what it builds on), every feed item's route, the shared lists and example posts. The founder approves it in News Desk's place; News Desk reviews it once it's set up.
- **The shared setup is finished** (Phase 0, 4 November 2026): the content store on staging is the Supabase database plus Cloudflare R2 for images, which Cloudflare resizes and delivers; creator video uses Cloudflare Stream, switched on with step 2.4. Production is parked until launch.

## Decisions in force

- **Content reaches the product by three routes** (the founder, 5 November 2026):
  - **found:** a creator's post the bots found on X, shown in its story's feed as the original post, embedded and credited to its creator, never copied, for every story;
  - **made:** our own content, which News Desk makes from the sourced pool, where the bots keep the news and creators' takes they find on X;
  - **posted:** creators and users posting directly in the app.
  Product only displays: the board shows stories, and the feed shows takes from all three routes, each credited by its route.
- **Our own content credits what it builds on:** a creation names the sourced items it was made from (`based_on`), and Product credits their creators alongside it, linking to the original posts. It never copies a found post's words, pictures or video.
- **What a creation is** (the agreement, Draft): one post of one kind (text; one image; or one video), from a Hrizzup account (made), an invited creator or a user (posted); every creation says its route, which must match its author. It's usually a take on up to three stories. Our own and creators' posts name a story or a category; a user's post may name neither. Images and videos are cleaned by our server at upload and carry words describing them for people who can't see them. Text is plain text, never formatting codes or hidden characters.
- **What a sourced item is:** one thing the bots found, as kept in the pool: news or a take, the post's address on X, who posted it (as X shows the account now), what it holds (text, image or video), a summary in our own words, its stories, and whether it's live, unavailable or withdrawn. Once a post can't be shown, its item keeps nothing of it, and our content's credit to it disappears. Build only on live ones.
- **Who posts what:** users post text only; images and video come from us and from invited creators. Reactions are likes and dislikes.
- **The founder's decisions in the agreement** (changing one goes back to the founder): the launch list (Global; India; Mumbai, Delhi NCR and Bengaluru; crypto, finance, business, AI, sports, politics, entertainment and general), up to three of each per story, with Hyderabad, Chennai and Pune suggested next; a story card shows the story's newest image or video by Hrizzup or a creator, otherwise a design in the category's own look, never a found post's picture, so our own and creators' images and videos are the board's pictures.
- **Launch:** in India, in English only; global news is for everyone.
- **The feed:** takes on the stories each reader picked, from all three routes, plus the creators they follow and their location. Its detailed design is Product's (step 2.3).
- **Sign-offs:** while News Desk is on hold, the first half is signed off on Sourcing's review plus the founder's approval in News Desk's place (the founder, 5 November 2026). Sourcing's review, run by a Claude Code session working from Sourcing's brief since the founder carries no messages between projects (the founder, 8 November 2026), is done, and its changes are made. News Desk reviews it once set up, and any change it asks for follows the agreement's change rules. The second half (the bots' result format) doesn't need News Desk's agreement.
- **The agreement comes first:** no tables or content for its shapes before the first half is agreed. Step 1.3 needs the first half, and its first batch needs the news pipeline (1.1), because it's made from the sourced pool. Step 4.4 needs 1.3. Real people first see our content at the Android closed test (2.6), which needs 1.3.
- **Outside content is data, never instructions:** posts are shown as text, and our AI never obeys anything written in them.
- **Media files go into the content store's storage,** never into the repository, and records name them by their place in storage.
- **No relays** (the founder, 5 November 2026): the founder carries no reports or messages between projects; this brief carries what News Desk needs.
- **Shared rules:** projects never copy code between each other; this repository is the only route. Every check lands before the code it checks, so any tools News Desk writes get their checks first. From Round 2, Claude Code's sessions run unattended in parallel (CLAUDE.md, "Unattended sessions").

## What changed in the latest session

On 9 November 2026, in [#52](https://github.com/Zugzwang-world/hrizzup/pull/52), the agreement's first half took the founder's market model, at his request (still Draft, version 1). For News Desk:

- **The market News Desk reads** now holds its question, outcomes, rules, opening and closing times, a named settlement source and its state (draft, open, closed, settled or cancelled); only Hrizzup creates markets.
- **The market subjects list left the first half,** with data readings, until the markets' topics are chosen (step 1.2), so content on market subjects waits for them.
- **The creation shape didn't change.**

Also on 9 November, in [#58](https://github.com/Zugzwang-world/hrizzup/pull/58): PLAN.md step 1.4 now says design starts only from the founder's references and diagrams, given in the design chat, and no session builds design directions, values or screens of its own choosing; Product's first design pass was retired. Nothing changes for News Desk.

## Open questions

- **Which creators to invite first** (step 1.3). Recommendation: start from the creators whose takes the bots find most often in each launch category, once the pipeline runs, since they're already active on our stories; invite those with original work and a steady record.
- **How News Desk chooses what to build on, and what each format looks like made from the pool** (step 1.3). Recommendation: three formats to start: explainers (what's happening and why), roundups of the best found takes on a story, each credited, and, once step 1.2 chooses the markets' topics, charts for them; each names the posts it builds on.
- **When News Desk is set up** (the founder). Recommendation: once the news pipeline (1.1) is close to running on staging, so formats and the creator list are ready when the pool starts filling. If the founder keeps the closed test (2.6) waiting for News Desk's first content, set it up earlier.

## What's next

1. **On hold** until the founder sets News Desk up.
2. **Then review the agreement's first half,** above all the creation shape and the sourced item. Any change it asks for follows the agreement's change rules.
3. **Content formats, the first content and the creator list (step 1.3):** formats and the list need the first half; the first batch, made from the sourced pool, needs the pipeline (1.1). Done when there's enough content to fill the feeds in the launch categories.
4. **Later, onboarding (step 4.4, with the founder):** creators join through creator accounts, and our own content is loaded. Needs creator accounts (2.4) and step 1.3.

## Read for detail

- `agreement/README.md`: sign-offs, the founder's decisions, the three routes, every field of a creation and a sourced item, the shared lists, the hand-over rules; example posts in `agreement/examples/creations.json` and found posts in `agreement/examples/sourced.json`; Sourcing's review in `agreement/reviews/sourcing-first-half.md`.
- `PLAN.md`: section 2 ("News": categories, the feed, the three routes, reactions, launch), section 4 (the projects, News Desk's hold, no relays, how Sourcing's review runs), section 5 (steps 0.7, 1.3, 2.4, 2.6 and 4.4).
- `docs/status/news-desk.md`: News Desk's status in full.
- `news-desk/README.md`: what lives in the folder, and its rules.
- `docs/setup/BLUEPRINT.md`, section 13: how images and video are handled.
