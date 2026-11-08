# News Desk: status

Last updated: 8 November 2026. Plan: [PLAN.md](../../PLAN.md). Brief: [docs/brief/news-desk.md](../brief/news-desk.md). Code: [news-desk/](../../news-desk/). Hand-over agreement: [agreement/README.md](../../agreement/README.md).

**On hold until the founder sets News Desk up** (the founder's decision, 5 November 2026).

## Done

- The `news-desk/` folder exists, with a README saying what lives there (2 November 2026). No News Desk work has started yet.
- The shared setup it builds on is finished (PLAN.md Phase 0, 4 November 2026): the content store on staging (the Supabase database, and Cloudflare R2 storage with image resizing). Creator video (Cloudflare Stream) is switched on when it's built (step 2.4). See the setup close-out at the top of [docs/setup.md](../setup.md).
- **Plan changes, approved by the founder on 5 November 2026** ([#25](https://github.com/Zugzwang-world/hrizzup/pull/25)): step 0.7 signs off in two halves, and step 1.3 needs the first; the Android closed test (2.6), where real people first see our content, needs step 1.3.
- **The hand-over agreement's first half, first draft (status Draft), 5 November 2026** ([agreement/](../../agreement/README.md)): the creation shape (text, one image or one video, posted by Hrizzup, an invited creator or a user, who posts text only), the shared lists of locations and categories, and example posts. The launch list moved out of this file's open questions into the agreement.
- **The founder approved the agreement's seven decisions, 5 November 2026,** each as recommended. For News Desk: the launch list (the cities Mumbai, Delhi NCR and Bengaluru, and Politics, Entertainment and General beyond the five named categories); our own and creators' posts name a story or a category, while a user's post may name neither; and a story card's picture is the story's newest image or video by Hrizzup or a creator, otherwise a design in the category's own look, so our own and creators' images and videos are the pictures the board shows.
- **The founder's decisions of 5 November 2026, recorded in [#31](https://github.com/Zugzwang-world/hrizzup/pull/31):**
  - **News Desk is on hold** until the founder sets it up. So the hold doesn't block Product, the agreement's first half is signed off on Sourcing's review plus the founder's approval in News Desk's place. News Desk reviews it once it's set up, and any change it asks for follows the agreement's change rules;
  - **three routes into the feed:** found (a creator's post the bots found on X, shown in its story's feed as the original post, embedded and credited, never copied, for every story), made (our own content, which News Desk makes from the sourced pool, where the bots keep the news and creators' takes they find) and posted (creators and users, in the app). Product only displays, and credits every feed item by its route;
  - **the agreement's first half (still Draft) changed:** every creation now says its route (made for our own, posted for creators' and users'); our own content names the sourced items it builds on (`based_on`), and Product credits their creators; the new sourced item shape is what News Desk builds on;
  - **the embedding question is settled:** found posts are embedded for every story, as sourced items, so no new kind of creation is needed;
  - **step needs:** step 1.3's first batch is made from the sourced pool, so it needs the news pipeline (1.1); step 4.4 now needs 1.3;
  - **the second half** (the bots' result format) no longer needs News Desk's agreement;
  - **no relays:** the founder doesn't carry reports or messages between projects; the briefs carry everything (CLAUDE.md).
- **How the first half's sign-off runs, the founder's decision of 8 November 2026** ([#36](https://github.com/Zugzwang-world/hrizzup/pull/36)): Sourcing's review is run by a Claude Code session in the repository, working from Sourcing's brief (Round 2, relay 5, under way); the founder then approves the first half in News Desk's place, as before. Product's design (step 1.4) is now built in real code and filled with the agreement's example data, the example posts among them.
- **The agreement's first half revised after Sourcing's review, 8 November 2026** ([#37](https://github.com/Zugzwang-world/hrizzup/pull/37), the review; [#42](https://github.com/Zugzwang-world/hrizzup/pull/42), the changes): still Draft, awaiting the founder's approval in News Desk's place. For News Desk: a sourced item whose post is gone from X (deleted, hidden, withheld in India, or taken down at its creator's request) now keeps nothing of the post, not even our summary, so build only on live items, and the credit to a gone post disappears; an edited post is one item, pointing at its newest version; updates name the posts they report by their sourced items, as a creation's `based_on` does; `withdrawn` also covers takedowns the law requires. News Desk reviews the first half once it's set up.
- **The market model, the founder's decisions of 8 November 2026** ([#40](https://github.com/Zugzwang-world/hrizzup/pull/40)): markets are built first on test markets with placeholder questions, and their topics (step 1.2) are parked until markets work end to end on staging, so content on market subjects waits for them. The agreement's market shape, which News Desk reads, is likely to be revised to the new model before the first half is Agreed (an open question in Product's status). Product now designs in a dedicated design chat, led by the founder.

## Next

1. **On hold** until the founder sets News Desk up.
2. **Once set up, review the agreement's first half:** above all the creation shape and the sourced item. Any change News Desk asks for follows the agreement's change rules; a change to one of the founder's seven decisions goes back to the founder.
3. **Content formats, first content and creator list (step 1.3):** the formats for our own content and a list of creators to invite need the agreement's first half; the first batch is made from the sourced pool, so it needs the news pipeline (1.1). Done when there is enough content to fill the feeds in the launch categories.
4. **Later, onboarding (step 4.4, with the founder):** creators join through creator accounts, and our own content is loaded. Needs creator accounts (2.4) and step 1.3. Done when the feeds are full in every launch category.

## Open questions

- Which creators do we invite first? (step 1.3)
- How does News Desk choose what to build on from the sourced pool, and what does each content format look like when it's made from it? (step 1.3)
- When does the founder set News Desk up? (Step 2.6, the Android closed test, needs News Desk's first content, step 1.3.)
