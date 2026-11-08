# Hrizzup: the hand-over agreement

> Exactly what passes between Hrizzup's three projects (Sourcing, News Desk and Product), and what it looks like. This is PLAN.md step 0.7; if the two ever disagree, PLAN.md wins.

## Status

| Half | What it covers | Status | Sign-off record |
|---|---|---|---|
| First half | The shapes of a story, an update, a sourced item, a creation and a market, with the data readings that settle markets; every feed item's route; the shared lists, including the launch list of locations and categories; the rules for every hand-over point | **Draft:** reviewed by Sourcing, awaiting the founder's approval (revised 8 November 2026) | Drafted by Product (Claude Code), 5 November 2026. Founder: the launch list and the other decisions below approved, each as recommended, 5 November 2026. **Changed after those seven decisions,** on the founder's decisions later that day: the sourced item shape and every feed item's route (found, made or posted) were added, and data readings are now written by Product. **Sourcing: reviewed 8 November 2026** ([its review](reviews/sourcing-first-half.md), [#37](https://github.com/Zugzwang-world/hrizzup/pull/37)), by a Claude Code session working from Sourcing's brief: two blocking findings and nine changes, all made the same day ([#42](https://github.com/Zugzwang-world/hrizzup/pull/42)), leaving the founder's seven decisions as they were. **Sourcing agrees this version.** News Desk: on hold until the founder sets it up, so the founder approves in its place (the founder's decision, 5 November 2026): **not yet approved.** News Desk reviews it once it's set up. These sign-offs are for this version. |
| Second half | The Grok bots' result format | **Not drafted** | Designed in the Sourcing project and reviewed by Product; News Desk doesn't need to agree it (the founder's decision, 5 November 2026). Drafted only once Sourcing has chosen the Grok product and the route to our pipeline (step 0.8). See the last section. |

- **Each sign-off is recorded here, with its date, as it arrives. A half becomes Agreed only through a later change the founder asks for.** The first half is signed off once Sourcing has reviewed and agreed it and the founder has approved it in News Desk's place, while News Desk is on hold; Product drafted it. The founder carries no messages between projects, so Sourcing's review is run by a Claude Code session in this repository, working from Sourcing's brief (`docs/brief/sourcing.md`; the founder's decision, 8 November 2026). News Desk reviews it once the founder sets it up, and any change it asks for follows "Changing the agreement", below. The second half is signed off once Product has reviewed and agreed Sourcing's design. (All the founder's decisions, 5 November 2026.) Changes to this folder merge themselves once their checks pass, so a merged draft is still only a draft.
- **Until the first half is Agreed,** no project creates database tables for its shapes or writes content in them, and nothing is loaded into any database. **Until the second half is Agreed,** no bot result becomes content.
- **Next for the first half:** the founder reads Sourcing's review (`reviews/sourcing-first-half.md`) and approves this version in News Desk's place, through the Product chat; it becomes Agreed only in a change the founder asks for. A change to one of the founder's decisions ("The founder's decisions", below) goes back to the founder.

## What this is

Three projects make Hrizzup, and each hands things to the others:

- **Sourcing** runs the Grok bots, which find news and creators' takes on X. Its pipeline keeps everything they find, once it passes the checks, as **sourced items** in the **sourced pool**, and turns the news into **stories** and their **updates**.
- **News Desk** makes our own **creations** (text, images and videos) from the sourced pool, and brings in creators, whose posts in the app are creations too. It's on hold until the founder sets it up.
- **Product** shows all of it in the app and on the website, crediting every feed item by its **route**, and runs the **markets**, filling the **data slots** that settle them with **data readings**.

This agreement fixes exactly what each of those looks like when it passes between projects. It lives in this folder, and nowhere else:

- **this page:** the agreement in plain language;
- **`definitions/`:** one precise definition of each shape and of the shared lists. Every project's code uses these files directly, never a copy. They're written in JSON Schema, a standard every programming language reads, so it doesn't matter which language or job runner Sourcing picks;
- **`examples/`:** example data for every shape, ready for previews, tests and staging to load later;
- **a check on every pull request** (inside Quick checks): every example passes its definition, every definition has examples, the definitions work the same in every language, and this page says exactly what the definitions say. The field tables, the lists and the worked examples below are written from the definitions and the examples, so they can't drift apart.

## The founder's decisions

The founder approved all seven on 5 November 2026, each as recommended, and they stand: the changes made since (the sourced item, the routes, data readings moving to Product, and the changes Sourcing's review asked for on 8 November) leave every one of them as it was. Revisiting one is a change to this agreement, approved by the founder.

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Which Indian cities are in the launch list? | **Mumbai, Delhi NCR and Bengaluru** (reasons below) | Each has enough English-language local news on X, and enough readers, to keep a local feed full. More cities come after version one. |
| D2 | Which categories join crypto, finance, business, AI and sports? | **Politics, Entertainment and General** (reasons below) | Eight categories cover what readers look for without thinning any feed. |
| D3 | Can a story carry more than one location or category? | **Yes, up to three of each.** The first is its main one, shown on its card | Real news often spans two: a crypto rule is crypto and finance; a match in Mumbai is India and Mumbai. With only one, readers who follow the other would miss it. |
| D4 | Does a city's story also show under India (national)? | **Only when our AI also tags it India,** because it matters to the whole country. No automatic roll-up | Rolling every city story up would fill India's board with other cities' traffic and weather. Explicit tags keep each board about its own readers. |
| D5 | Where does a story card's picture come from? | **From the story's newest image or video by Hrizzup or a creator; otherwise a design in the category's own look.** Stories carry no picture of their own | Pictures in posts on X belong to the people who posted them, so our pipeline can't reuse them; ours and invited creators' can be used. |
| D6 | Must a user's post carry a category? | **No.** Posts by Hrizzup and creators must name a story or a category; a user's post may name neither | The fewest steps to post. A user's post still shows on the stories it's about, and in the social feed. |
| D7 | Market prices in US dollars or rupees? | **US dollars,** the world's reference price for Bitcoin, gold and oil; the website can show rupees alongside | The markets are global (PLAN.md section 2), and settlement must read one exact price. |

**The launch list** (D1 and D2), one reason each:

| Item | Kind | Why it's in |
|---|---|---|
| Mumbai | City | India's financial and film capital, with a steady flow of English-language local news on X: trains, the monsoon, civic politics and the markets. |
| Delhi NCR | City | The capital region (Delhi, Gurugram, Noida): national politics happens here, and air quality, traffic and civic news run every day. |
| Bengaluru | City | India's tech and start-up capital, with an English-first audience that's very active on X, close to our AI and business categories. |
| Politics | Category | Most of India's national news is political (elections, Parliament, policy); without it, the India board would miss the biggest stories. |
| Entertainment | Category | Films, streaming and celebrities draw the most creators and memes in India, the heart of a creator-led app. |
| General | Category | The home for news that fits nowhere else (weather, transport, civic issues, crime, education, health), so every story has a category and the city feeds stay full. |

Suggested next, after version one: Hyderabad, Chennai and Pune, each a large tech hub with plenty of local news. Each joins the list only when the founder approves it.

## The shapes at a glance

| Shape | What it is | Written by | Read by |
|---|---|---|---|
| Story | A piece of news that develops over time | Sourcing's pipeline | Product (board, story pages, feed, notifications); News Desk (to make takes) |
| Update | One development in a story; a story's updates are its timeline | Sourcing's pipeline | Product; News Desk |
| Sourced item | One thing the bots found on X (news, or a creator's take on a story), as kept in the sourced pool | Sourcing's pipeline | Product (found takes, in their stories' feeds); News Desk (to build our own content on) |
| Creation | A post: text, one image or one video | News Desk (our own: made); creators and users, through the app (posted) | Product (feed, story pages, story cards) |
| Market | A play-money question that settles itself from real data | Product's market engine | Product (the website, and its data job: which matches and slots to read); News Desk (content on market subjects) |
| Data reading | One reading of a market subject's data slot | Product's data job, from the sources chosen in step 1.2 | Product (settlement, and prices and scores on market pages) |

Data readings are written and read by Product alone since the founder moved the market data to Product (5 November 2026), but they stay here: they're outside data entering at a hand-over point, and their market subjects are a shared list.

## Three routes into the feed

Content reaches the product by three routes (the founder's decision, 5 November 2026). Product only displays it: the board shows stories, and the feed shows takes on each story from all three routes. Every feed item says its route in `route`, from this shared list, so Product can credit it without working it out:

<!-- generated: list route -->
| Code | Name | How it reaches the product, and how it's credited |
|---|---|---|
| `found` | Found | A creator's post that our bots found on X, shown in a story's feed as the original post: embedded from X and credited to its creator, never copied. |
| `made` | Made | Our own content, made by News Desk from the sourced pool and credited to Hrizzup, together with the creators of any found posts it builds on. |
| `posted` | Posted | Posted directly in the app by a creator or a user, and credited to the account that posted it. |
<!-- end generated -->

- **Found posts are never copied.** A sourced item holds a link to the original post on X, who posted it and a summary in our own words; screens embed the original from X and credit its creator. Its pictures are never a story card's picture (D5): they belong to the person who posted them.
- **News found on X never shows in a feed itself.** Our AI turns it into stories and updates, in our own words, which link to the posts as sources.
- **These routes are how content reaches readers.** Step 0.8's route is something else: how the bots' results reach our pipeline.

## Rules for every record

- **Every record says its shape and format version,** in `format` (such as `story/1`). Hand-over points use it to pick the right definition.
- **Our own words, and nothing copied.** Stories and updates are written by our AI in our own words, never copied from the posts they're based on; those posts are linked as sources. A found post is never copied either: it's kept as a link, and shown by embedding the original.
- **Plain text only.** Every text field holds plain text, shown as text: no formatting codes, no web-page code, and no hidden characters (control, direction, tag or other invisible characters), which can hide planted text. The one exception is the zero-width joiner that builds some emoji. New lines appear only where a field allows them.
- **Times are in UTC,** written like `2026-11-05T09:30:00Z`. Screens show them in India time.
- **IDs are UUIDs, version 7,** made once by whoever writes the record, so a retried write can't create a duplicate. Accounts keep the IDs our sign-in service gives them.
- **Files are named by their place in our storage, never by a web address,** so the same record works on staging and production. Images live in our media storage (R2, delivered through Cloudflare); videos in our video service (Cloudflare Stream). A found post isn't ours, so it's named by its address on X.
- **Optional fields are left out when they have nothing to say:** never empty, never null.
- **Values come from the shared lists,** by their codes.
- **Limits are outer bounds.** Every reader handles anything within them; a writer may set tighter limits of its own (the app might cap a user's post well below 2,000 characters).
- **Writers write only the fields defined here, and readers ignore fields they don't use.** Hand-over points refuse unknown fields, so a misspelt or planted field can't slip through, and adding an optional field never breaks a reader.

## Shared lists

Any list of values that more than one project writes or reads is defined once, in `definitions/lists.schema.json`, and every project reads it from there. Each item has:

- a **code**, which records carry and which never changes;
- a **name**, which people see and which can be improved at any time;
- **what it covers**, which our AI reads when it tags a story, so it must be precise.

Adding an item is one change in that one file ("Changing the agreement", below). Readers must cope with an item they haven't met before, for example by showing it in a plain default style. The routes are listed under "Three routes into the feed", above.

### Locations (launch list: D1)

<!-- generated: list location -->
| Code | Name | Level | What it covers |
|---|---|---|---|
| `global` | Global | Global | News that matters around the world, not just in India: world affairs, global markets, international sport. Every reader sees it. |
| `india` | India | National | News that matters across India: national politics, the economy, national teams, and anything that affects people in every city. |
| `mumbai` | Mumbai | Local | Mumbai and its metropolitan region, including Thane and Navi Mumbai. |
| `delhi-ncr` | Delhi NCR | Local | Delhi and the National Capital Region, including Gurugram, Noida, Ghaziabad and Faridabad. |
| `bengaluru` | Bengaluru | Local | Bengaluru and its surrounding urban district. |

| Level | Who sees it |
|---|---|
| Global | News for every reader, wherever they are. |
| National | News for readers anywhere in India. |
| Local | News for readers in one Indian city. More cities come after version one. |
<!-- end generated -->

### Categories (launch list: D2)

<!-- generated: list category -->
| Code | Name | What it covers |
|---|---|---|
| `crypto` | Crypto | Bitcoin and other cryptocurrencies: prices, exchanges, regulation and new projects. |
| `finance` | Finance | Money and markets: shares, the rupee, interest rates, banks, taxes and personal finance. |
| `business` | Business | Companies and the economy: results, deals, start-ups, jobs and whole industries. |
| `ai` | AI | Artificial intelligence: new models, the companies building them, how people use them, and the rules around them. |
| `sports` | Sports | Cricket, football and every other sport: matches, players, teams and tournaments. |
| `politics` | Politics | Government and elections: Parliament, state governments, policies and political parties. |
| `entertainment` | Entertainment | Films, streaming, music and celebrities, from Bollywood and regional cinema to global stars. |
| `general` | General | News that fits no other category: weather, transport, civic issues, crime, education and health. |
<!-- end generated -->

### Market subjects and their data slots

Each market subject has one **data slot**: what it measures, and how settlement reads it. A slot names no provider: Product chooses each source (step 1.2), and its data job fills the slot with data readings in the shape below. The exact market questions are settled in step 3.2.

<!-- generated: list market_subject -->
| Code | Name | Kind | What its data slot measures |
|---|---|---|---|
| `bitcoin` | Bitcoin | Price | The price of one bitcoin in US dollars: a reference price combined from several large exchanges, so no single exchange decides a market. |
| `ai-models` | The best AI model | Ranking | A public ranking of AI models, from the source chosen in step 1.2: the models in order, with the leader first. |
| `cricket` | Cricket | Match | Professional cricket matches: who plays, the live score, and the result. |
| `football` | Football | Match | Professional football matches: who plays, the live score, and the result. |

| Kind | How settlement reads it |
|---|---|
| Price | Settlement reads the average of the valid readings measured in the 60 seconds before the market closes. If there are none, the market waits for them; if none arrive within 24 hours, it is cancelled and every bet is returned. |
| Ranking | Settlement reads the first valid reading measured when the market closes or after: the outcome naming the model ranked first wins. If it ranks more than one model first, the market is cancelled; so it is if no reading arrives within 7 days. |
| Match | Settlement reads the match's first valid reading that says finished or abandoned: the outcome for its result wins (no_result when abandoned). If the market has no outcome for that result, or no such reading arrives within 3 days of the start, it is cancelled. |

Note: Gold or oil joins this list once PLAN.md step 1.2 decides which.
<!-- end generated -->

## Story

**What it is:** a piece of news that develops over time, such as a cricket match, a court case or a city's smog. **Written by** Sourcing's pipeline, from the bots' results: it creates the story when the news first breaks, keeps its title and summary current, adds updates to its timeline, and tags it with locations and categories from the shared lists. **Read by** Product (the board, story pages, the feed and notifications) and News Desk (to choose stories to cover).

- **Each run of the bots starts fresh,** so the pipeline matches new items to existing stories. When two stories turn out to be the same news, it merges one into the other: the duplicate's updates and sourced items move to the story that stays (which gains the duplicate's locations and categories where they still fit, three of each at most), and the duplicate says where it went.
- **A merge is never a chain:** `merged_into` always names a story that isn't merged. When the story that stayed is merged in turn, the pipeline repoints every earlier duplicate. Anything else that names a merged story (a post, a bookmark, a notification) is read as naming the story it went into.
- **When our AI finds a story wasn't true,** it withdraws it. Readers stop seeing it, and an old link shows the reason. A story is also withdrawn when the law requires it to come down (a court order or a valid legal notice): a person decides that, never our AI ("Rules for every hand-over point", below).

<!-- generated: fields story/1 -->
| Field | Required | What it means | What it holds |
|---|---|---|---|
| `format` | Yes | Says this record is a story, in format version 1. | Always `story/1` |
| `id` | Yes | The story's ID. Updates, posts and links refer to the story by it. | Record ID (UUID version 7, lower case) |
| `title` | Yes | The story's headline, in our own words. Rewritten as the story develops, so it always says where things stand. | One line of plain text, up to 120 characters |
| `summary` | Yes | What is happening, in one or two sentences of our own words. | Plain text, new lines allowed, up to 300 characters |
| `locations` | Yes | Where the story matters, the main one first. The story shows under each of them, and under no other. | 1 to 3, each a location from the shared list, no repeats |
| `categories` | Yes | What the story is about, the main one first. The story shows under each of them. | 1 to 3, each a category from the shared list, no repeats |
| `state` | Yes | live: readers see it. merged: it turned out to be the same news as another story, which readers see instead. withdrawn: taken down, because our AI found it wasn't true or because the law requires it; readers no longer see it. | `live`, `merged` or `withdrawn` |
| `merged_into` | Depends | The story this one was merged into, which is never itself merged: its updates and sourced items have moved there, and anything else that names this story is read as naming that one. Only when the state is merged. | Record ID (UUID version 7, lower case) |
| `withdrawn_reason` | Depends | Why the story was withdrawn, in our own words (our AI's reason, or the takedown the law required), shown to anyone who opens an old link. Only when the state is withdrawn. | One line of plain text, up to 200 characters |
| `created_at` | Yes | When our pipeline first wrote the story. | Time in UTC, like 2026-11-05T09:30:00Z |
| `updated_at` | Yes | When anything about the story last changed, including a new update in its timeline. | Time in UTC, like 2026-11-05T09:30:00Z |
<!-- end generated -->

**Worked example:** the smog story, whose timeline has several updates, one of them a correction.

<!-- generated: example stories.json 01a199e9-d180-75ec-8a81-134dd403419a -->
```json
{
  "format": "story/1",
  "id": "01a199e9-d180-75ec-8a81-134dd403419a",
  "title": "Delhi NCR's air turns 'severe' as pollution readings pass 450 and primary schools move online",
  "summary": "Thick smog has covered Delhi NCR since Monday morning. Air-quality readings passed 450, the 'severe' level, and the city's emergency pollution rules are in force.",
  "locations": [
    "delhi-ncr"
  ],
  "categories": [
    "general"
  ],
  "state": "live",
  "created_at": "2026-11-02T01:40:00Z",
  "updated_at": "2026-11-03T04:05:00Z"
}
```
<!-- end generated -->

## Update

**What it is:** one development in a story, in our own words. A story's updates, in the order they were first reported, are its timeline. **Written by** Sourcing's pipeline, one for each piece of news in the bots' results. **Read by** Product (story timelines and notifications) and News Desk.

- **Every update names what it's based on:** the posts our bots found on X, in `based_on`, by their sourced items; and any other public pages, in `sources`. At least one of the two, always: an update the pipeline can't source isn't published. A post on X is never named by its address here, so once it can't be shown it drops out of every update without the update changing.
- **A correction is a new update** that names the update it corrects; readers see the earlier one marked as corrected. Nothing is quietly edited out of a timeline.
- **An update that repeats another is merged into it:** it names the update in the same story that it repeats, stops showing, and a link to it leads to the one that stays. Each run starts fresh and merges join timelines, so the same development is sometimes written twice.
- **An update found to be untrue is withdrawn:** it stops showing, and the reason is kept. So is one the law requires to come down.

<!-- generated: fields update/1 -->
| Field | Required | What it means | What it holds |
|---|---|---|---|
| `format` | Yes | Says this record is an update, in format version 1. | Always `update/1` |
| `id` | Yes | The update's ID. | Record ID (UUID version 7, lower case) |
| `story_id` | Yes | The story whose timeline this update belongs to. When a story is merged, its updates move to the story that stays. | Record ID (UUID version 7, lower case) |
| `headline` | Yes | What happened, in one line of our own words. | One line of plain text, up to 120 characters |
| `body` | No | More detail, in our own words. Left out when the headline says it all. | Plain text, new lines allowed, up to 1,000 characters |
| `reported_at` | Yes | When this news was first reported, as near as our pipeline can tell (the earliest source's time). The timeline runs in this order. | Time in UTC, like 2026-11-05T09:30:00Z |
| `based_on` | Depends | The posts our bots found on X that this update reports, by their sourced items. Product credits and links each one while it can be shown. An update names at least one of these or of its sources. | 1 to 10, each a record ID (UUID version 7, lower case), no repeats |
| `sources` | Depends | The other public pages this update is based on (news sites, official pages), as links. Never a post on X or anything else at X's own addresses (x.com, twitter.com, t.co, twimg.com): posts are named in based_on, by their sourced items, so they disappear from every update once they can't be shown. | 1 to 10, each a web address starting https://, not on X, up to 2,048 characters, no repeats |
| `corrects` | No | An earlier, live update in the same story that this one corrects. Readers see that earlier update marked as corrected. | Record ID (UUID version 7, lower case) |
| `state` | Yes | live: it shows in the timeline. merged: it repeats another update in the same story, which readers see instead. withdrawn: taken out of the timeline, because our AI found it wasn't true or because the law requires it; it no longer shows. | `live`, `merged` or `withdrawn` |
| `merged_into` | Depends | The update in the same story that this one repeats, which is never itself merged; a link to this update leads there. Only when the state is merged. | Record ID (UUID version 7, lower case) |
| `withdrawn_reason` | Depends | Why the update was withdrawn, in our own words: our AI's reason, or the takedown the law required. Only when the state is withdrawn. | One line of plain text, up to 200 characters |
| `created_at` | Yes | When our pipeline wrote the update. | Time in UTC, like 2026-11-05T09:30:00Z |
| `updated_at` | Yes | When the update last changed. | Time in UTC, like 2026-11-05T09:30:00Z |
<!-- end generated -->

**Worked example:** the correction in the smog story's timeline.

<!-- generated: example updates.json 01a19f94-ede0-724c-8617-706149fba27c -->
```json
{
  "format": "update/1",
  "id": "01a19f94-ede0-724c-8617-706149fba27c",
  "story_id": "01a199e9-d180-75ec-8a81-134dd403419a",
  "headline": "Correction: only Delhi's primary schools moved online; schools in Noida and Gurugram stay open",
  "body": "An earlier update said schools across Delhi NCR had moved online. Only Delhi's primary schools have; schools in Noida and Gurugram remain open.",
  "reported_at": "2026-11-03T03:50:00Z",
  "sources": [
    "https://example.com/sources/delhi-schools-clarification"
  ],
  "corrects": "01a19ae2-d780-7a89-96fb-aeeefeab4196",
  "state": "live",
  "created_at": "2026-11-03T04:05:00Z",
  "updated_at": "2026-11-03T04:05:00Z"
}
```
<!-- end generated -->

## Sourced item

**What it is:** one thing the Grok bots found on X, as our pipeline keeps it in the sourced pool once it has passed the checks. It's either **news** (a post reporting what happened), which our AI turns into stories and updates, or a **take** (a creator's meme, video, explainer or opinion on a story), which shows in that story's feed. **Written by** Sourcing's pipeline. **Read by** Product, which shows takes in their stories' feeds (the found route), and News Desk, which builds our own content on the pool (the made route).

- **A link, never a copy.** It keeps the post's address on X, who posted it, what the post holds, and a summary in our own words: never the post's words, pictures or video. Screens embed the original from X and credit its creator.
- **Every fact about the post comes from X itself,** never from the bots' own words: the post's number from the bots' citations, then its address, its account's handle and its name from X's public embed lookup, which also confirms the post exists. The pipeline checks each kept post again on a schedule and refreshes them, because a handle can change and then pass to another account: the credit must name the account as it is now.
- **One post is kept once,** by its number, however often the bots find it. An edited post is still one post: X gives each edit a new number (and deleting any version deletes them all), so the item names the newest version, which screens embed, and its summary describes that version.
- **What counts as one post:**
  - **a repost is never kept:** it shows someone else's post, so the pipeline keeps the original instead, if it qualifies, credited to its own creator;
  - **a quote post is its quoter's own post,** kept under its own number, as news or a take; the post it quotes is kept only on its own merits;
  - **a reply to someone else is never a take,** because X shows it under the post it answers, out of our story's context; it can be news (a police account answering a question);
  - **a thread is one post:** kept as its first post, with a summary of the whole thread.
- **When a post can no longer be shown,** the pipeline marks the item unavailable and, in the same write, erases everything it kept about the post: its address, its account, when it was posted, what it held, and our summary of it. That covers a post deleted on X, an account made protected, suspended or closed, a post withheld in India (X withholds posts country by country), and a creator asking us to take their post down. X's developer rules require anyone who keeps X content to delete it when it's deleted or hidden on X, and it's what a creator who deletes a post expects. The item keeps only our own fields, so what refers to it still resolves: News Desk stops building on it, and the credit it gave our own content disappears. Unavailable is final; if the post comes back, the pipeline keeps it again as a new item. Until the pipeline catches up, screens leave out any post X can't show.
- **Our AI can withdraw a take** that isn't genuine, isn't about its story, or isn't safe to show, giving its reason; a person withdraws one the law requires to come down. A withdrawn item keeps its post, so the pipeline doesn't keep the same post again, until the post leaves X and the item becomes unavailable.
- **Names are kept as X shows them, less any hidden characters:** the pipeline removes the characters the agreement refuses (some flags are built from them) and keeps the rest of the name, leaving it out only when nothing readable remains.
- **It's separate from the second half.** The bots' result format (the second half) is how results reach our pipeline; a sourced item is what the pipeline keeps after its checks, so this shape stays the same whatever format the bots use.

<!-- generated: fields sourced/1 -->
| Field | Required | What it means | What it holds |
|---|---|---|---|
| `format` | Yes | Says this record is a sourced item, in format version 1. | Always `sourced/1` |
| `id` | Yes | The sourced item's ID, made by our pipeline when it first keeps the post. Our own content and our updates name it when they build on the post. | Record ID (UUID version 7, lower case) |
| `route` | Yes | How it reached the product: our bots found it. A take shows in the feed by this route, credited to its creator. | Always `found` |
| `kind` | Yes | news: a post reporting what happened, which our AI turns into stories and updates in our own words; it never shows in a feed itself. take: a creator's take on a story (a meme, a video, an explainer or an opinion), shown in that story's feed as the original post. | `news` or `take` |
| `post` | Depends | The original post on X. Only these facts about it are kept, never its words, pictures or video, and only while the post can be shown: an unavailable item has none. | The fields below |
| `post.url` | Yes | The post's standard address on X, as X's own embed lookup gives it: the account's handle when last checked, then the post's number, never the handle-free form (x.com/i/status/…) that Grok cites. For an edited post, its newest version. Screens embed it and link to it, and the pool keeps each post once, by its number. | Address of a post on X |
| `post.handle` | Yes | The handle of the account that posted it, as X showed it when our pipeline last checked: refreshed at every check, since a handle can change and then pass to another account. The credit names it. | Handle on X (letters, digits and underscores, without the @) |
| `post.name` | No | The account's name, as X showed it when last checked, with any characters the agreement refuses taken out. Left out when nothing readable remains; the handle alone is enough to credit it. | One line of plain text, up to 80 characters |
| `post.posted_at` | Yes | When it was first posted on X: for an edited post, when its first version was. | Time in UTC, like 2026-11-05T09:30:00Z |
| `post.media` | Yes | What the post itself holds, so screens can hold room for it and News Desk can find what to build on: video if it holds any video or moving picture; otherwise image if it holds any picture (memes among them); otherwise text (words only, perhaps with a link's preview card or a poll). A quoted post's media don't count. | `text`, `image` or `video` |
| `summary` | Depends | What the post says or shows, in one or two sentences of our own words, never copied from it: for an edited post, its newest version; for a thread, the whole thread. News Desk reads it to choose what to build on. An unavailable item has none. | Plain text, new lines allowed, up to 300 characters |
| `story_ids` | Depends | The stories it belongs to, never a merged one (a merge moves it to the story that stays). A take shows in their feeds, and always names at least one; news names the stories our AI used it in, once it has. | 1 to 3, each a record ID (UUID version 7, lower case), no repeats |
| `state` | Yes | live: in use. unavailable: the post can't be shown any more (deleted; its account protected, suspended or closed; withheld in India; or its creator asked us to take it down), so its post and summary are erased and nobody sees it; this is final, and a post that comes back is kept again as a new item. withdrawn: taken out, but still held so the same post isn't kept again: our AI found it wasn't genuine, wasn't about its story or wasn't safe to show, or the law requires it to come down. Readers no longer see it. | `live`, `unavailable` or `withdrawn` |
| `withdrawn_reason` | Depends | Why it was withdrawn, in our own words, kept for the record: our AI's reason, or the takedown the law required. Only when the state is withdrawn. | One line of plain text, up to 200 characters |
| `created_at` | Yes | When our pipeline first kept it. | Time in UTC, like 2026-11-05T09:30:00Z |
| `updated_at` | Yes | When it last changed. | Time in UTC, like 2026-11-05T09:30:00Z |
<!-- end generated -->

**Worked example:** a creator's meme on the smog story, shown in its feed.

<!-- generated: example sourced.json 01a19a80-e160-7f8f-b502-968e31834978 -->
```json
{
  "format": "sourced/1",
  "id": "01a19a80-e160-7f8f-b502-968e31834978",
  "route": "found",
  "kind": "take",
  "post": {
    "url": "https://x.com/example_memes/status/9900000000000000102",
    "handle": "example_memes",
    "name": "Example Memes",
    "posted_at": "2026-11-02T04:10:00Z",
    "media": "image"
  },
  "summary": "A meme that sets a clear-day photo of Delhi's skyline beside this week's grey haze, captioned as the city's 'before and after'.",
  "story_ids": [
    "01a199e9-d180-75ec-8a81-134dd403419a"
  ],
  "state": "live",
  "created_at": "2026-11-02T04:25:00Z",
  "updated_at": "2026-11-02T04:25:00Z"
}
```
<!-- end generated -->

## Creation

**What it is:** a post: text, one image or one video, usually a take on one or more stories. Our own content, invited creators' posts and users' posts all have this shape, so the feed and the ranking treat them alike. **Written by** News Desk (our own content, made from the sourced pool and posted from Hrizzup accounts: the made route) and by the app for creators and users (the posted route; the author is always the account that posted it). **Read by** Product (the feed, story pages and the pictures on story cards).

- **Its route follows from its author:** made for our own content, posted for creators' and users' posts. The check refuses any other pairing.
- **Our own content credits what it builds on:** `based_on` names the sourced items it was made from, and Product credits their creators alongside it, linking to the original posts. It never copies their words, pictures or video. Only made content has it.
- **Users post text only;** images and video come from us and from invited creators (PLAN.md section 2).
- **Our own and creators' posts name a story or a category,** so they can be placed; a user's post may name neither (D6).
- **Images and videos are cleaned by our server at upload** (location data removed, rotation fixed, size capped, a blurred preview made) before a creation can use them.

<!-- generated: fields creation/1 -->
| Field | Required | What it means | What it holds |
|---|---|---|---|
| `format` | Yes | Says this record is a creation, in format version 1. | Always `creation/1` |
| `id` | Yes | The creation's ID. | Record ID (UUID version 7, lower case) |
| `route` | Yes | How it reached the product, which follows from its author: made for our own content, posted for creators' and users' posts. Product credits it by its route. | Route from the shared list |
| `kind` | Yes | text: words only. image: one image, with words if wanted. video: one video, with words if wanted. | `text`, `image` or `video` |
| `author` | Yes | Who made it. Set by our own software from the account that posted it, never taken from the post itself. | The fields below |
| `author.kind` | Yes | hrizzup: our own content, made by News Desk and posted from a Hrizzup account. creator: an invited creator, from their creator account. user: anyone else with an account, who posts text only. | `hrizzup`, `creator` or `user` |
| `author.account_id` | Yes | The account it was posted from. | Account ID (UUID, lower case) |
| `text` | Depends | The words. Required for text; for an image or a video, an optional caption. | Plain text, new lines allowed, up to 2,000 characters |
| `image` | Depends | The image. Required for an image, and only there. | The fields below |
| `image.key` | Yes | The image's file in our media storage. | File name in our media storage, up to 300 characters |
| `image.width` | Yes | Its width, so screens can hold its space before it loads. | Whole number of pixels, from 1 to 10,000 |
| `image.height` | Yes | Its height, for the same reason. | Whole number of pixels, from 1 to 10,000 |
| `image.alt` | Yes | What the image shows, in words, for people who can't see it. | One line of plain text, up to 300 characters |
| `image.placeholder` | Yes | The blurred preview shown while the image loads, or if it never does. | ThumbHash, in base64, 16 to 100 characters |
| `video` | Depends | The video. Required for a video, and only there. | The fields below |
| `video.stream_id` | Yes | The video's ID in our video service. | Video ID (32 lower-case hexadecimal characters) |
| `video.width` | Yes | Its width, so screens can hold its space before it plays. | Whole number of pixels, from 1 to 10,000 |
| `video.height` | Yes | Its height, for the same reason. | Whole number of pixels, from 1 to 10,000 |
| `video.duration_seconds` | Yes | How long it runs, in seconds. | Number, more than 0 and up to 3,600 |
| `video.alt` | No | What the video shows, in words, for people who can't see it. | One line of plain text, up to 300 characters |
| `video.placeholder` | No | The blurred preview shown before it plays. | ThumbHash, in base64, 16 to 100 characters |
| `story_ids` | Depends | The stories it is a take on. It shows on those stories, and wherever they show. | 1 to 3, each a record ID (UUID version 7, lower case), no repeats |
| `categories` | Depends | What it is about: needed when it isn't a take on a story, and adds to its stories' categories when it is. | 1 to 3, each a category from the shared list, no repeats |
| `locations` | No | Where it matters, for local content. | 1 to 3, each a location from the shared list, no repeats |
| `based_on` | No | The sourced items (posts our bots found) it builds on. Product credits their creators alongside it, linking to the original posts while they're live. Only for made content. | 1 to 10, each a record ID (UUID version 7, lower case), no repeats |
| `created_at` | Yes | When it was posted. | Time in UTC, like 2026-11-05T09:30:00Z |
| `updated_at` | Yes | When it last changed. | Time in UTC, like 2026-11-05T09:30:00Z |
<!-- end generated -->

**Worked example:** our own image, a chart, on the Bitcoin story.

<!-- generated: example creations.json 01a19a69-fe00-7ece-a8e7-1dee39c8c5cf -->
```json
{
  "format": "creation/1",
  "id": "01a19a69-fe00-7ece-a8e7-1dee39c8c5cf",
  "route": "made",
  "kind": "image",
  "author": {
    "kind": "hrizzup",
    "account_id": "ea644a46-e968-4af3-833d-998f3b34ac39"
  },
  "text": "Bitcoin's week, in one chart.",
  "image": {
    "key": "examples/bitcoin-week-chart.webp",
    "width": 1200,
    "height": 675,
    "alt": "Line chart of Bitcoin's price over the past week: down to about $93,000 on Wednesday, back above $100,000 by Sunday night.",
    "placeholder": "1QcSHQRnh493V4dIh4eXh1h4kJUI"
  },
  "story_ids": [
    "01a19849-40e0-7f5f-8c4f-d23d4351e7aa"
  ],
  "created_at": "2026-11-02T04:00:00Z",
  "updated_at": "2026-11-02T04:00:00Z"
}
```
<!-- end generated -->

## Market

**What it is:** a play-money question about the future that runs and settles itself from real data (PLAN.md section 2). When it closes, settlement reads its subject's data slot, as the market subjects list describes, and pays out; nobody touches it. A **yes-or-no market** asks about a price ("Will Bitcoin be above $100,000 at 6 pm on Friday?"). A **multiple-choice market** has several outcomes, exactly one of which wins: which AI model ranks first, or who wins a match. Markets run continuously: the engine opens new ones as old ones settle, over many time windows. **Written by** Product's market engine (step 1.7). **Read by** Product (the website, and its data job: which matches and slots to read) and News Desk (content on the market subjects).

- **A market settles only from valid readings.** If the data never comes, it's cancelled and every bet returned; it's never settled on a guess.
- **Each outcome names the value that makes it win** (`reading_value`), because a source's names don't always match how we show them: "Atlas-2 (preview)" on a leaderboard, "Atlas 2" on our page. One outcome may be the catch-all ("Another model").
- **The exact questions stay open** until step 3.2.

<!-- generated: fields market/1 -->
| Field | Required | What it means | What it holds |
|---|---|---|---|
| `format` | Yes | Says this record is a market, in format version 1. | Always `market/1` |
| `id` | Yes | The market's ID. | Record ID (UUID version 7, lower case) |
| `question` | Yes | The question people bet on, as shown. | One line of plain text, up to 120 characters |
| `subject` | Yes | What the market is about. Its data slot settles the market, in the way the shared list describes. | Market subject from the shared list |
| `categories` | Yes | The categories whose news shows alongside the market. | 1 to 3, each a category from the shared list, no repeats |
| `kind` | Yes | yes_no: people buy Yes or No (a price subject). multiple_choice: several outcomes, exactly one of which wins (a ranking or match subject). | `yes_no` or `multiple_choice` |
| `outcomes` | Depends | The possible outcomes. Required for multiple_choice, and only there. At most one is the catch-all. | 2 to 20, each with the fields below |
| `outcomes[].code` | Yes | The outcome's code, which the result names if it wins. Unique within the market. | Short code (lower-case letters, digits and hyphens), up to 40 characters |
| `outcomes[].label` | Yes | The outcome, as shown. | One line of plain text, up to 60 characters |
| `outcomes[].reading_value` | Depends | What the subject's data says when this outcome wins: a model's name as the ranking gives it, or a match result (home, away, draw or no_result). | One line of plain text, up to 80 characters |
| `outcomes[].otherwise` | Depends | Marks the catch-all outcome (such as "Another model"), which wins when no other outcome's reading_value matches. | Always `true` |
| `threshold` | Depends | For a price subject: Yes wins if the settlement price is above this, in US dollars. Required there, and only there. | Decimal number, written as text, like 100000 or 97250.5, up to 24 characters |
| `match_ref` | Depends | For a match subject: which match, by the code its readings use. Required there, and only there. | Short code (lower-case letters, digits and hyphens), up to 40 characters |
| `opens_at` | Yes | When betting opens. | Time in UTC, like 2026-11-05T09:30:00Z |
| `closes_at` | Yes | When betting stops. Settlement reads the data slot from this time. | Time in UTC, like 2026-11-05T09:30:00Z |
| `state` | Yes | upcoming: not open yet. open: taking bets. closed: betting has stopped and settlement waits for the data. settled: paid out. void: cancelled, with every bet returned. | `upcoming`, `open`, `closed`, `settled` or `void` |
| `result` | Depends | What won: yes or no, or the winning outcome's code. Only when the state is settled. | Short code (lower-case letters, digits and hyphens), up to 40 characters |
| `void_reason` | Depends | Why the market was cancelled, in our own words. Only when the state is void. | One line of plain text, up to 200 characters |
| `settled_at` | Depends | When it was settled or cancelled. Only when the state is settled or void. | Time in UTC, like 2026-11-05T09:30:00Z |
| `created_at` | Yes | When the market was created. | Time in UTC, like 2026-11-05T09:30:00Z |
| `updated_at` | Yes | When anything about the market last changed. | Time in UTC, like 2026-11-05T09:30:00Z |
<!-- end generated -->

**Worked example:** a yes-or-no market on Bitcoin's price.

<!-- generated: example markets.json 01a1ab94-8600-7b23-ba8b-9e3174889404 -->
```json
{
  "format": "market/1",
  "id": "01a1ab94-8600-7b23-ba8b-9e3174889404",
  "question": "Will Bitcoin be above $100,000 at 6 pm India time on Friday 6 November?",
  "subject": "bitcoin",
  "categories": [
    "crypto"
  ],
  "kind": "yes_no",
  "threshold": "100000",
  "opens_at": "2026-11-05T12:30:00Z",
  "closes_at": "2026-11-06T12:30:00Z",
  "state": "open",
  "created_at": "2026-11-05T12:00:00Z",
  "updated_at": "2026-11-05T12:30:00Z"
}
```
<!-- end generated -->

## Data reading

**What it is:** one reading of a market subject's data slot: a price, a ranking, or a match's state and score. **Written by** Product's data job, from the source step 1.2 chooses for the slot (the founder moved the market data from Sourcing to Product on 5 November 2026). **Read by** Product: settlement, and the live prices and scores on market pages.

- **Readings are outside data,** so each one passes the hand-over checks before anything uses it. A reading that fails never settles a market.
- **Prices are exact decimal text** (`"101245.37"`), so no rounding creeps in.

<!-- generated: fields reading/1 -->
| Field | Required | What it means | What it holds |
|---|---|---|---|
| `format` | Yes | Says this record is a data reading, in format version 1. | Always `reading/1` |
| `id` | Yes | The reading's ID. | Record ID (UUID version 7, lower case) |
| `subject` | Yes | Whose data slot this reading fills. | Market subject from the shared list |
| `measured_at` | Yes | When the value was true, by the source's clock. | Time in UTC, like 2026-11-05T09:30:00Z |
| `received_at` | Yes | When our data job received it. | Time in UTC, like 2026-11-05T09:30:00Z |
| `price` | Depends | For a price subject: the price. Required there, and only there. | The fields below |
| `price.amount` | Yes | The price. | Decimal number, written as text, like 100000 or 97250.5, up to 24 characters |
| `price.currency` | Yes | The currency: US dollars. | Always `USD` |
| `ranking` | Depends | For a ranking subject: the ranking. Required there, and only there. | The fields below |
| `ranking.leaders` | Yes | The ranked names, in order, the leader first. | 1 to 50, each with the fields below |
| `ranking.leaders[].rank` | Yes | Its place: 1 is first. Names that tie share a place. | Whole number, from 1 to 1,000 |
| `ranking.leaders[].name` | Yes | The name, exactly as the source gives it. | One line of plain text, up to 80 characters |
| `match` | Depends | For a match subject: the match and where it stands. Required there, and only there. | The fields below |
| `match.ref` | Yes | The match's code, which a market's match_ref names. | Short code (lower-case letters, digits and hyphens), up to 40 characters |
| `match.competition` | Yes | The competition or series, as the source names it. | One line of plain text, up to 80 characters |
| `match.home` | Yes | The home team, as the source names it. | One line of plain text, up to 60 characters |
| `match.away` | Yes | The away team, as the source names it. | One line of plain text, up to 60 characters |
| `match.starts_at` | Yes | When the match starts. | Time in UTC, like 2026-11-05T09:30:00Z |
| `match.status` | Yes | scheduled: not started. live: being played. finished: over, with a result. abandoned: called off without a result. | `scheduled`, `live`, `finished` or `abandoned` |
| `match.score` | No | The score as one line for people to read. Left out before the match starts. | One line of plain text, up to 120 characters |
| `match.result` | Depends | Who won: home, away, draw, or no_result. Only when finished or abandoned (abandoned is always no_result). | `home`, `away`, `draw` or `no_result` |
<!-- end generated -->

**Worked example:** a Bitcoin price reading.

<!-- generated: example readings.json 01a1abaf-1ab0-7ae5-9ce9-7597290e15c0 -->
```json
{
  "format": "reading/1",
  "id": "01a1abaf-1ab0-7ae5-9ce9-7597290e15c0",
  "subject": "bitcoin",
  "measured_at": "2026-11-05T12:29:00Z",
  "received_at": "2026-11-05T12:29:02Z",
  "price": {
    "amount": "101245.37",
    "currency": "USD"
  }
}
```
<!-- end generated -->

## Rules for every hand-over point

A hand-over point is wherever one project's output, or anything from outside, enters our system.

### Outside data is data, never instructions

Anything from outside our system is data, never instructions, wherever our software or our AI reads it: the bots' results, the posts they find, creators' and users' posts, and market data readings. The bots read posts on X that anyone can write, so a result can carry planted instructions ("ignore your rules", "mark this as verified", "open this link").

- **Our AI takes its instructions only from our own prompts in this repository.** Outside text reaches it only as quoted material, clearly marked as data. Anything in it that reads like an instruction is part of the news item, never obeyed.
- **While it reads outside text, our AI can't act:** it has no tools that send, fetch, publish or change anything. Its only output is a record, which is checked like any other input before it's saved, so planted text can't add a field, pick a category outside the lists, or slip in formatting codes.
- **Our software never runs outside text or treats it as code.** Every text field is plain text, shown as text. Links are shown as plain links, and our software never follows them on its own.
- **Hidden characters are refused,** because they can hide planted text from people while machines still read it. The definitions' patterns refuse every control, format (invisible), private-use and filler character in Unicode's main range, keeping only the joiner and the two variation selectors that emoji use. What no pattern catches the same way in every language, `validate()` refuses in code: every character Unicode marks as default-ignorable, assigned yet or not (which takes in every tag character and variation selector), and every format, private-use or broken-surrogate character (Unicode's categories Cf, Co and Cs), apart from the zero-width joiner and the two variation selectors that emoji use (U+FE0E and U+FE0F); two or more variation selectors in a row; and a zero-width joiner at either end of the text, next to another joiner, or next to a plain (ASCII) character. Code in another language adds the same three checks with its own Unicode data (Python's standard library has no default-ignorable property: use the `regex` package, or the ranges in Unicode's DerivedCoreProperties.txt), **and a fourth: no text may end in a new line.** Every pattern refuses that in JavaScript, but in Python, Java and .NET a pattern's `$` also matches just before a final new line, so their validators would let it through; `validate()` makes the same check, so all four are the same everywhere. Other unassigned characters aren't refused: which ones are unassigned depends on each language's Unicode version, so new emoji would be refused on older systems.

### Every hand-over point checks where its input came from, and its format

| Hand-over point | Proof of where it came from | Format check | When a check fails |
|---|---|---|---|
| The Grok bots' results reach our pipeline | Proof the result came from our own bot, by the route step 0.8 chooses (second half) | The bots' result format (second half) | Set aside, never published, and logged |
| The pipeline keeps sourced items | Only the pipeline's own credentials can write the sourced pool, and only from results that passed the row above | Each sourced item passes its definition | Not kept, and logged |
| The pipeline saves stories and updates | Only the pipeline's own credentials can write them | Each record passes its definition before it's saved | Not saved, and logged |
| News Desk saves our own creations | Only News Desk's credentials can post from Hrizzup accounts | Each creation passes its definition | Not saved, and logged |
| A creator or a user posts through the app | The author is the signed-in account, set by our server, never read from the post | Each creation passes its definition | Refused, and the person is told what to fix |
| The market engine saves markets | Only the engine's own credentials can write them | Each market passes its definition | Not saved, and logged |
| Product's data job saves readings | Fetched from the slot's chosen source over an encrypted, authenticated connection; only the data job can write readings | Each reading passes its definition | Set aside and logged; never settles a market |

- **Anything that fails is set aside automatically, never published, and logged** with the problems found. Nothing waits for a person.
- **Set-aside input is deleted after 7 days,** long enough to find out what went wrong: a bot's result holds the words of posts on X, which the pool never keeps, and a refused post holds a person's own words. Logs name records by their IDs and problems by where they are, never by quoting the outside text.
- **Alerts:** a pile-up of failures, or no valid result arriving when the bots should have run, raises an alert, so a change on Grok's side can't silently stop the news. So does a data slot with no valid reading when one is due. Alerts go to the founder until the team's monitoring exists; the exact thresholds come with the bots' schedule, in the second half.
- **These checks judge whether input is genuine and well-formed, not whether the news is true.** Accuracy stays with our AI, with no human review: it can correct an update, withdraw an update, a story or a take, and merge duplicates.
- **One step is a person's: a takedown the law requires.** A court order or a valid legal notice is decided by a person (the founder, until the team exists), who withdraws the story, update or take with a reason that says so. A creator who asks us to take down their own post makes its item unavailable instead, which erases what we kept of it. Either is done within 24 hours of the request, or sooner where the law requires.

## Example data

`examples/` holds a small, consistent world of example data: every record passes its definition, and every reference points to another example. It's ready for previews, tests and staging to load once the tables exist (after this half is Agreed); nothing is loaded anywhere now.

| File | What's in it |
|---|---|
| `stories.json` | Smog in Delhi NCR (a timeline with several updates, one a correction); a cricket match (a story with many updates); a Bengaluru AI start-up (a title at the longest allowed, and no picture anywhere on the story); Bitcoin (one update withdrawn as untrue); and a duplicate story merged into the smog story |
| `updates.json` | Every update on those stories, each naming what it's based on: the smog story's first update builds on a post our bots found as well as a page; the update that moved in with the merged duplicate repeats one already there, so it's merged into it; the withdrawn Bitcoin update builds on two posts since deleted on X |
| `sourced.json` | What the bots found on X: news about the smog, which its first update builds on; news that no story uses yet; creators' takes of every kind (a meme on the smog, a video on the cricket match, an explainer thread on Bitcoin); a take whose post was then deleted on X, and the two posts behind the withdrawn Bitcoin claim, all three erased down to our own fields; a take our AI withdrew (a doctored notice, posted by an account with no name) |
| `creations.json` | Posted: a creator's text take; a creator's video; a creator's image whose file is missing from storage; a user's post that tries to give our AI instructions (shown as text, nothing more). Made: our own image (a chart); our own explainer, which names a category instead of a story and builds on a creator's explainer found on X |
| `markets.json` | Bitcoin (yes or no, open); the best AI model (multiple choice with a catch-all, open); the cricket match (multiple choice, settled) |
| `readings.json` | Bitcoin prices, an AI ranking, and the cricket match before, during and after play |

The check keeps the hard cases in: long titles, a story with many updates, a missing image, a merged story, a withdrawn update, a correction and an update that repeats another; every route, a found take of every kind, news and a take whose posts are gone from X, a withdrawn take, our own content built on a found post, and updates built on posts our bots found. It also checks that no merge is a chain, that nothing our pipeline writes names a merged story, and that a correction or a repeat names a live update in its own story.

**Example posts can never point at a real post on X:** their handles start with `example`, and their numbers are larger than any number X gives a post, so a preview that embeds one can never show a stranger's post. The check enforces it.

## For developers: using the definitions

- **TypeScript** (the website, the app's server code, and any project code written in TypeScript): depend on the workspace package `@hrizzup/agreement`. `validate(record)` returns the problems it finds; an empty list means the record matches. `shapes` holds each definition by its format.
- **Any other language:** load the files in `agreement/definitions/` with a JSON Schema 2020-12 validator, straight from this repository, at build or run time. In Python:

  Install the validator with its format add-ons (`pip install "jsonschema[format-nongpl]"`): without them, Python skips the `date-time` and `uri` checks that the TypeScript check makes, so a time such as `2026-13-45T25:61:61Z` would pass.

  ```python
  import json, pathlib
  from jsonschema import Draft202012Validator
  from referencing import Registry, Resource

  folder = pathlib.Path("agreement/definitions")
  schemas = [json.loads(p.read_text()) for p in folder.glob("*.schema.json")]
  registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas)
  story = registry.contents("https://hrizzup.com/agreement/definitions/story.v1.schema.json")
  validator = Draft202012Validator(story, registry=registry, format_checker=Draft202012Validator.FORMAT_CHECKER)
  problems = list(validator.iter_errors(record))
  ```

  Then add `validate()`'s four code checks: the three for hidden text, and no text ending in a new line ("Rules for every hand-over point", above).
- **Never copy a definition** into another file or language. Whatever runs the pipeline and the data job (the background-jobs tool chosen in the Sourcing project) is built from this repository, so it reads these files directly.
- **The definitions use only portable features.** Their patterns spell characters out, as four-digit `\u` escapes (the form JSON Schema's standard uses), instead of using `\d`, `\w`, `\s`, `\p{…}`, look-arounds or named groups, which differ between languages; the check enforces it. The one difference no pattern can avoid, what `$` means before a final new line, is the fourth code check.
- **After changing a definition, a list or an example,** run `pnpm --filter @hrizzup/agreement readme` to rewrite this page's generated parts, then `pnpm check`.

## Changing the agreement

- **Always allowed, as one change, with no new version:**
  - adding an optional field to a shape;
  - adding an item to a shared list, once the founder approves it (as with the launch list);
  - improving a description, or the name people see for a list item.
- **Anything else needs a new format version, agreed by the projects that sign off its half** (PLAN.md step 0.7: for the first half, all three projects, with the founder standing in for News Desk while it's on hold; for the second half, Sourcing and Product): removing or renaming a field, making an optional field required, changing what a field means or the values it accepts, or changing or removing a list item's code. The new version gets its own definition file (such as `story.v2.schema.json`), and the old one stays until every writer has moved over.
- **While a half is Draft,** its shapes change in place and keep format version 1: nothing has been written in them yet. Versions count from the day it's Agreed.
- **News Desk reviews the first half once it's set up.** Any change it asks for follows these rules, like any other change.
- **A half's status changes to Agreed** only in a change the founder asks for.

## Second half: the Grok bots' result format

**Status: not drafted.** The Sourcing project designs it, once it has chosen the Grok product and plan, and the route that brings the bots' results to our pipeline (PLAN.md step 0.8). Product reviews and agrees it; News Desk doesn't need to (the founder's decision, 5 November 2026). It's how the bots deliver their results to our pipeline, kept separate from the sourced item (first half), which is what the pipeline keeps after its checks. It will define:

- the format of a bot's result, with its format version, carrying creators' takes as well as news, and for each find what the pipeline needs to keep it as a sourced item;
- the proof that a result came from our own bot, by the chosen route;
- when an alert fires: how many failures, and how long without a valid result, given the bots' schedule.

It becomes Agreed only after a real result from step 0.8's test bot, carrying news and creators' takes, passes this agreement's own checks (proof of origin and format), and only through a change the founder asks for. Until then, no bot result becomes content.
