# Sourcing's review of the agreement's first half

> Written 8 November 2026 by Claude Code, reviewing as the Sourcing project: the project whose pipeline must write stories, updates and sourced items in these shapes (Round 2, relay 5). Product drafted the first half. Every finding is marked **blocking**, **change** or **note**, with the change proposed. The changes are made under the agreement's own rules in a second pull request; the founder then approves the first half in News Desk's place, through the Product chat. If anything here disagrees with PLAN.md, PLAN.md wins.
>
> **The changes were made the same day,** in [#42](https://github.com/Zugzwang-world/hrizzup/pull/42): every finding below, R1 to R11, is in the definitions, the examples, the check or the README.

## In short

- **Sourcing can fill every field the three shapes ask for,** in the format given, with Grok (xAI's API and its X search tool) plus our pipeline, as long as the pipeline takes every fact about a post from X itself, never from the bot's own words.
- **Two findings block agreement.** As written, the sourced pool would keep a post's details, and our summary of it, after the post is deleted, which X's developer rules forbid (R1). And a found creator's credit would freeze the handle they had when we found them; X frees a changed handle for anyone else to take (R2).
- **Nine changes** close gaps the pipeline would hit in its first week: updates naming their sources (R3), edited posts (R4), reposts, quotes, replies and threads (R5), merges (R6), repeated updates (R7), takedowns (R8), what a post holds (R9), account names (R10), and how long rejected input is kept (R11).
- **None of them touches the founder's decisions** (the launch list, the tagging rules, the routes, prices in US dollars). Three questions go to the founder; none holds up the approval.
- **Fourteen notes** guide the pipeline (step 1.1), the second half (the bots' result format) and Product, with no change to the shapes.

## How the review was done

Read as the writer: for each field, where its value comes from, and what happens to it when the post changes on X. The answers rest on xAI's documentation of its X search tool, X's developer policy and agreement, X's help centre, and a live test of X's public embed lookup, all on 8 November 2026 (sources at the end). The open questions in Sourcing's brief were inputs, not decisions.

**How the pipeline will fill a sourced item** (what the findings assume):

1. A bot run calls xAI's API with the X search tool. Grok answers in a fixed format (the second half) and lists the posts it read as citations, each written `https://x.com/i/status/<number>`: the post's number, with no handle.
2. For each post it keeps, the pipeline asks X's public embed lookup (`publish.x.com/oembed`) about that address. X answers "not found" for a post that doesn't exist; otherwise it gives the post's standard address with its account's current handle (`https://x.com/<handle>/status/<number>`) and the account's name. Tested with X's first post: `x.com/i/status/20` came back as `https://x.com/jack/status/20`, by "jack".
3. When it was posted comes from the post's number: X's post numbers carry the moment they were made, to the millisecond.
4. Our AI reads the post as quoted data and writes the summary in our own words. The post's words, which reach the pipeline in Grok's answer and in X's embed lookup, are used once and never kept.
5. `validate()` checks the record; only then is it saved.

## Findings

| #   | Finding                                                                     | Mark     | Change proposed                                                                                                                           |
| --- | --------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | When a post leaves X, the pool still keeps its details and our summary      | Blocking | An unavailable item keeps only our own fields; the definition refuses the post and the summary there                                      |
| R2  | A found creator's credit freezes the handle and name we first saw           | Blocking | The address, handle and name are X's current ones, refreshed at every check                                                               |
| R3  | An update may name no source, and names posts on X only by address          | Change   | Updates name the posts they report by their sourced items (`based_on`); `sources` holds other pages only; every update names at least one |
| R4  | An edited post can be kept twice, or shown and summarised as an old version | Change   | One item per post, pointing at its newest version                                                                                         |
| R5  | Nothing says what counts as one post: reposts, quotes, replies, threads     | Change   | Four rules in the sourced item's section                                                                                                  |
| R6  | A merge can leave records pointing at a merged story, or chains of merges   | Change   | `merged_into` never names a merged story; the pipeline moves its own records                                                              |
| R7  | An update that repeats another can only be hidden as "not true"             | Change   | Updates gain the state `merged`, as stories have                                                                                          |
| R8  | "Withdrawn" can't say "taken down because the law requires it"              | Change   | Withdrawn covers legal takedowns, which a person decides                                                                                  |
| R9  | `post.media` doesn't say what a post holding several things holds           | Change   | Video, then image, then text; the post's own media only                                                                                   |
| R10 | One hidden character drops a creator's whole name                           | Change   | Remove the characters the agreement refuses; keep the rest                                                                                |
| R11 | Nothing limits how long rejected outside text is kept                       | Change   | Set-aside input deleted after 7 days; logs never quote it                                                                                 |

**The marks.** **Blocking:** Sourcing can't agree the half until it changes, because as written the pipeline would break X's rules or credit the wrong person, and fixing it after the half is Agreed would take a new format version. **Change:** asked for before Agreed; it closes a gap the pipeline will hit, and costs little now. **Note:** no change to the shapes.

### R1. When a post leaves X, we keep nothing of it (blocking)

**What we found.** A sourced item always needs `post` (the post's address, its account's handle and name, when it was posted, what it holds) and `summary`, so an item whose post was deleted keeps all of them. X's developer policy says anyone who stores X content must delete or change it when it's deleted or changed on X, as soon as reasonably possible and within 24 hours of a request, and it counts a post made private or protected, suspended, withheld or removed as changed. Its developer agreement counts post numbers, profile information and anything derived from them as X content, which takes in our summary. A post shown on a site must also come down within 24 hours of a removal request from X or the account's owner. Whether Grok's terms pass these rules on to us is still open (step 0.8), but they're the standard every app that shows X posts is held to, and what a creator who deletes a post expects.

**Why it blocks.** Making required fields optional after the half is Agreed takes a new format version, and deleting the whole record instead would break the links our own content keeps to what it builds on (a creation's `based_on`).

**Change.**
- `unavailable` means the post can't be shown: deleted; its account protected, suspended or closed; withheld in India by a legal demand (X withholds posts country by country, and the app launches in India); or its creator asked us to take it down.
- An unavailable item holds only our own fields: `format`, `id`, `route`, `kind`, `story_ids`, `state`, `created_at` and `updated_at`. The write that marks it unavailable removes `post` and `summary`, and the definition refuses them there. References to it still resolve, so News Desk's credit to it simply disappears.
- Unavailable is final: if the post comes back, the pipeline keeps it again as a new item.
- A withdrawn item keeps its post, so the pipeline knows it has seen the post and doesn't keep it again, until the post leaves X; then it becomes unavailable too.
- The examples follow: the deleted take loses its details, and the posts behind the withdrawn Bitcoin claim join, as unavailable news.

### R2. The credit follows the account, not the day we found it (blocking)

**What we found.** `post.handle` and `post.name` are "as it was when found", and `post.url` holds the handle too. Handles change on X, and a changed handle is freed for other accounts at once, so a credit frozen when we found the post can, weeks later, name and link a stranger. Grok's citations carry no handle at all (step 1 above), so the handle has to come from X anyway.

**Why it blocks.** Credit is the found route's whole promise, and "as it was when found" can't become "as X shows it now" after Agreed without a new version.

**Change.** `post.url` is the post's standard address as X's embed lookup gives it (`https://x.com/<handle>/status/<number>`, never the handle-free form Grok cites); `post.handle` and `post.name` are as X showed them when the pipeline last checked; the pipeline refreshes all three at every check (N6). The number never changes, so the pool still keeps each post once by it.

We considered adding X's own number for the account, which stays the same when the handle changes. Neither Grok's citations of posts nor X's embed lookup gives it, so the pipeline couldn't fill it; refreshing the handle does the same job.

### R3. Every update names what it's based on (change)

**What we found.** `sources` is optional ("left out when the bots' result gives none"), and it mixes posts on X, by address, with other pages. An update with no source can't be checked by readers or re-checked by our AI; and when a post behind an update leaves X, its address stays in the update, so R1 would have to reach into every update.

**Change.**
- Updates gain `based_on`, like a creation's: the posts our bots found that the update reports, by their sourced items (1 to 10).
- `sources` holds other public pages only (news sites, official pages); the definition refuses X's own addresses there (`x.com`, `twitter.com`, `t.co`, and `twimg.com`, where X keeps posts' pictures), and the pipeline treats a link to a copy of a post on another site as the post itself.
- Every web address's host is written plainly (letters, digits, hyphens and dots; an international name in its `xn--` form), with no name or password before it, so the check reads exactly the host a browser would. Without that, `https://someone@x.com/…`, a trailing dot or full-width letters would slip a post on X past the rule (found by the automatic security review of this change).
- Every update names at least one of the two. The bots always say which posts they read, so the pipeline can always fill it, and an answer that names none isn't published.
- Product credits and links each found post while its item is live, and leaves it out once it isn't, with no change to the update. The vetting rule Sourcing will set (two independent sources, or one official account, as its brief recommends) can then be seen by readers.

### R4. An edited post is one post, shown as its newest version (change)

**What we found.** X lets a post be edited up to five times soon after posting (within 30 minutes in X's developer documentation, an hour in its help centre). Each edit gets a new number, and deleting any version deletes them all. An old version's address still shows the old words, with a pointer to the newest. As written, "one post is kept once, by the number" can keep one post twice, and our summary can describe words the creator has since changed.

**Change.** The pool keeps an edited post once: `post.url` names its newest version, which screens embed; `post.posted_at` is when its first version was posted; the summary describes the newest version. How the pipeline notices an edit is its own business (N1).

### R5. What counts as one post (change)

**What we found.** The agreement doesn't say what to keep when the bots find a repost, a quote, a reply or a thread. **Change:** four rules join the sourced item's section.

- **A repost is never kept:** it shows someone else's post. The pipeline keeps the original instead, if it qualifies, credited to its own creator.
- **A quote post is its quoter's own post:** kept under its own number, as a take or as news. The post it quotes is kept only on its own merits.
- **A reply to someone else is never a take:** X's embed shows it under the post it answers, out of our story's context. It can be news (a police account answering a question).
- **A thread is one take:** kept as its first post, its summary covering the whole thread.

They match the brief's recommendation on which takes to keep (original posts, no reposts or replies).

### R6. Merges leave nothing pointing at a merged story (change)

**What we found.** A merge moves the duplicate's updates, but the agreement doesn't say what happens to sourced items that name the duplicate, to posts and bookmarks that name it, or to the duplicate when the story it went into is merged later in turn.

**Change.**
- `merged_into` never names a story that is itself merged: when the story that stayed is merged in turn, the pipeline repoints every earlier duplicate, so readers follow one step, never a chain.
- On a merge, the pipeline moves its own records (updates and sourced items) to the story that stays, adding the duplicate's locations and categories when they still fit (three of each at most).
- Anything else that names a merged story (posts, bookmarks, notifications) is read as naming the story it went into.
- The examples are checked for all three.

### R7. An update that repeats another can say so (change)

**What we found.** Each run starts fresh, and a merge joins two timelines, so the same development will sometimes be written twice. Today the only way to hide one is `withdrawn`, which tells readers it wasn't true.

**Change.** Updates gain the state `merged`, with `merged_into` naming the update in the same story that it repeats, as stories have. It stops showing, and an old link to it (from a notification) leads to the one that stays. An example joins: an update that moved in with the merged duplicate story and repeats one already there.

### R8. Withdrawn also covers takedowns the law requires (change)

**What we found.** `withdrawn` means only "our AI found it wasn't true" (stories and updates) or "not genuine, not about its story, or not safe to show" (takes). A news product also has to take things down when the law requires it, such as a court order or a valid legal notice. That isn't the same as untrue, and a person decides it, not our AI.

**Change.** For stories, updates and sourced items, `withdrawn` covers both: our AI's judgement, or a takedown the law requires, which a person decides (the founder, until the team exists). The reason says which. The hand-over rules name this as the one step a person takes. A creator who asks us to take down their own post makes it unavailable instead (R1), since nothing of theirs should stay.

### R9. What a post holds, when it holds several things (change)

**What we found.** `post.media` is text, image or video, but a post can hold pictures and a video together, a link's preview card or a poll, and a quote post shows another post's media.

**Change.** The description says: `video` if the post itself holds any video or moving picture; otherwise `image` if it holds any picture; otherwise `text` (link cards and polls count as text). Only the post's own media count, never a quoted post's.

### R10. An account's name with a hidden character (change)

**What we found.** `post.name` is left out "when X shows none in plain text". Display names often hold characters the agreement refuses: the flags of England, Scotland and Wales are built from tag characters, and some names hide zero-width characters. As written, one such character drops the whole name.

**Change.** The pipeline removes the characters the agreement refuses (and any spaces left at either end) and keeps the rest; it leaves the name out only when nothing readable remains.

### R11. Rejected outside text is kept for a week at most (change)

**What we found.** Input that fails its checks is "set aside, never published, and logged". A bot's result holds the words of posts on X, which the pool never keeps, and a refused post in the app holds a person's own words; nothing says how long a set-aside copy lives.

**Change.** Set-aside input is deleted after 7 days, long enough to find out what went wrong. Logs name records by their IDs and problems by where they are, never by quoting the outside text.

## Sourcing's sign-off

**Sourcing agrees the first half once R1 to R11 are made,** in the second pull request, under the agreement's own rules: while the half is Draft, its shapes change in place and stay at format version 1, with the definitions, the examples, the check and the README changed together. Sourcing doesn't agree the first half as it was drafted. Its status then reads "reviewed by Sourcing, awaiting the founder's approval": the founder approves it in News Desk's place, through the Product chat, and only a change the founder asks for marks it Agreed.

## For the founder

None of these changes a decision of the founder's, and none holds up the approval of the first half; each needs an answer before the pipeline is built (step 1.1).

- **F1. Found takes in English.** PLAN.md says the product is English only. Recommendation: the bots keep takes whose words are in English (a meme or a video with few or no words counts), so the feeds read in one language; Hindi and other languages wait for "other languages", after version one.
- **F2. Who handles takedown requests.** Creators asking us to take their posts down, and legal requests, need a person and an address. Recommendation: they go to the founder at a `hrizzup.com` contact address until the team's tools exist, and the pipeline acts on each within 24 hours (R1, R8).
- **F3. A lawyer's check before launch.** Writing news in our own words, and showing creators' posts beside it, may bring Hrizzup under India's rules for digital news publishers and aggregators (the IT Rules 2021) and under defamation law. Recommendation: add a lawyer's check to the runbook's pre-launch checklist.

## Notes for the pipeline (step 1.1) and the second half

- **N1. Every fact about a post comes from X, never from the bot's words.** The post's number comes from Grok's citations; X's embed lookup confirms the post exists and gives its address, handle and name; the time comes from the number. A model can cite a post that doesn't say what it claims, so our AI checks each claim against the post it actually read. To notice edits (R4), the pipeline reads each new post again once its edit window has closed, and moves the item to the newest version if there is one (through Grok or X's own API: settled in step 1.1).
- **N2. Time zones.** Every time in the shapes is UTC. xAI's date filter takes whole UTC days (from midnight UTC on `from_date`, up to but not including `to_date`), and India's day (UTC+5:30) spans two UTC dates, so each run searches today and yesterday in UTC, and the pipeline keeps posts by their own time. Words like "Monday" or "this morning" in our text mean India time; a global story names the time zone ("6 pm India time").
- **N3. Tagging, inside the founder's rules.** The launch list works for Sourcing as it stands. Our AI reads each item's "what it covers" from `lists.schema.json` when it tags, never a copy. A story that matters only to a city not on the list (Chennai, Hyderabad, Pune) isn't written at launch unless it matters across India (then it's India); the pipeline counts what it skips, by city, so the founder can see which city to add next. General is used only when no other category fits, so it stands alone. On a city's story, the test for India is whether readers in other cities would care. Global already reaches every reader, so a world story is also India only when it has an Indian side of its own (US interest rates and the rupee). Takes and news items carry no tags of their own: they follow their stories.
- **N4. Matching and corrections.** The pipeline matches finds to stories by meaning, using our own summaries; a post already in the pool is never matched again. A correction names an earlier, live update in the same story, and a correction can itself be corrected.
- **N5. Writes that are safe to repeat.** The pipeline makes each record's ID once, when it first decides to write the record, and reuses it on every retry; a unique rule on the post's number keeps one item per post. A retried run then can't duplicate anything.
- **N6. Checks after keeping.** Every item that still holds its post (live or withdrawn) is checked again through X's embed lookup at least once a day, and more often while its story is active, from our servers in Mumbai, so a post withheld in India shows as gone. It's a scheduled job for the background-jobs tool (an open question in the brief).
- **N7. Housekeeping.** A news item that no update has used after 7 days is deleted outright (nothing refers to it), so the pool keeps only what we use.
- **N8. Cost (step 0.8 and the second half).** xAI bills X search at $5 per 1,000 posts fetched and $10 per 1,000 profiles, on top of tokens, counting every post each search returns. A run that reads 100 posts every 15 minutes costs about $48 a day, about $1,450 a month, before tokens. The number of bots, the schedule and each run's search limit (`max_turns`) set the bill, so the second half fixes them, under a spending cap.
- **N9. The bots' result format (second half).** xAI's structured output enforces types, lists of values, required fields, patterns (including `\u` escapes) and lengths up to 2,048 characters; `if`/`then`/`else`, `not` and combined `allOf` are best effort only. So the result format avoids conditional rules, and the pipeline validates every result itself, as the agreement already requires.
- **N10. Proof of origin (second half).** With xAI's API, our own job makes the call with our own key, so a result's origin is the call itself: nothing arrives from outside that needs authenticating. A route by email or webhook would need a signature instead.
- **N11. Vetting signals.** A Community Note on a news post holds it back until a second source confirms it; a post X marks as sensitive media isn't kept as a take.

## Notes for Product

- **N12. Embedding found posts.** Use X's own embed code only: X's developer agreement forbids putting X content in a frame any other way. The privacy policy (step 4.2) must tell people that X's embeds collect browsing data, and get consent where the law needs it. Screens embed `post.url`, fall back to the credit (`post.handle`, `post.name`) and a plain link when the embed can't load, and show nothing for an unavailable or withdrawn item. X asks a site with more than 10 million daily impressions of its embeds to contact it.
- **N13. Creators.** Linking a found creator's X account to a person, or to a Hrizzup account, needs their opt-in (X's rule on matching people off X), so an invited creator links their X account themselves.
- **N14. The board's Latest tab.** Sort by when a story last developed (its newest live update's `reported_at`), not by `updated_at`, which also moves when a title is tidied or a tag changes.

## The brief's open questions, as inputs

| Open question (Sourcing's brief)                         | What this review found                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which Grok product, plan and route (0.8)                 | xAI's API with X search fits the shapes: its citations give each post's number, and its structured output can carry the second half's format. The recommendation stands |
| Bot set-up, schedule and result format                   | Cost (N8) and the structured output's limits (N9) shape it                                                                                                              |
| Whether the terms allow a public app (0.8)               | Still open; the shapes now follow X's developer rules whichever way it falls (R1, R2)                                                                                   |
| Vetting before publishing                                | R3 makes every update's sources visible to readers; Community Notes are a signal (N11)                                                                                  |
| Which creators' takes the bots keep                      | R5 matches the recommendation (original posts, no reposts or replies); language is F1                                                                                   |
| Noticing deleted posts, and how long the pool keeps them | R1 replaces "delete the record after 30 days" with "erase at once, keep only our own record"; the checks are N6                                                         |
| Which tool runs background jobs                          | The checks (N6) and the housekeeping (N7) are scheduled jobs too                                                                                                        |

## Sources

- xAI, X Search tool: <https://docs.x.ai/developers/tools/x-search> (parameters, the date range in whole UTC days, pricing, usage counts).
- xAI, Citations: <https://docs.x.ai/developers/tools/citations> (posts cited as `https://x.com/i/status/<number>`).
- xAI, Structured outputs: <https://docs.x.ai/developers/model-capabilities/text/structured-outputs> (what's enforced, and what's best effort).
- X, Developer Policy: <https://developer.x.com/en/developer-terms/policy> ("Content compliance", "Public display of Posts", "Off-X matching").
- X, Developer Agreement: <https://developer.x.com/en/developer-terms/agreement> (what counts as X content; no framing).
- X, Edit Posts: <https://docs.x.com/x-api/fundamentals/edit-posts>; X Help Center, About Edit post: <https://help.x.com/en/using-x/edit-post>.
- X Help Center, Help with common username issues: <https://help.x.com/en/managing-your-account/help-with-common-username-issues> (a changed username is freed for other accounts at once).
- X Help Center, About country withheld content: <https://help.x.com/en/rules-and-policies/post-withheld-by-country>.
- X's embed lookup, tested 8 November 2026: `https://publish.x.com/oembed?url=https://x.com/i/status/20` answered with the address `https://x.com/jack/status/20` and the author "jack"; numbers that aren't real posts (including the examples' numbers) answered 404.
