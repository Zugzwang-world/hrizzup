# Hrizzup: the hand-over agreement

> Exactly what passes between Hrizzup's three projects (Sourcing, News Desk and Product), and what it looks like. This is PLAN.md step 0.7; if the two ever disagree, PLAN.md wins.

## Status

| Half | What it covers | Status | Sign-off record |
|---|---|---|---|
| First half | The shapes of a story, an update, a creation and a market, with the data readings that settle markets; the shared lists, including the launch list of locations and categories; the rules for every hand-over point | **Draft** (first draft, 5 November 2026) | Drafted by Product (Claude Code), 5 November 2026. Sourcing: not yet agreed. News Desk: not yet agreed. Product: not yet agreed. Founder: the launch list and the decisions below not yet approved. |
| Second half | The Grok bots' result format | **Not drafted** | Drafted only once the Sourcing project has chosen the Grok product and the route to our pipeline (step 0.8). See the last section. |

- **A half becomes Agreed only through a later change the founder asks for.** That change records here each project's agreement and the founder's approval, with dates. Changes to this folder merge themselves once their checks pass, so a merged draft is still only a draft.
- **Until the first half is Agreed,** no project creates database tables for its shapes or writes content in them, and nothing is loaded into any database. **Until the second half is Agreed,** no bot result becomes content.
- **Seven decisions wait for the founder:** "Decisions for the founder", below.

## What this is

Three projects make Hrizzup, and each hands things to the others:

- **Sourcing** turns the Grok bots' results into **stories** and their **updates**, and fills the **data slots** that settle markets with **data readings**.
- **News Desk** makes our own **creations** (text, images and videos) and brings in creators, whose posts are creations too.
- **Product** shows all of it in the app and on the website, and runs the **markets**.

This agreement fixes exactly what each of those looks like when it passes between projects. It lives in this folder, and nowhere else:

- **this page:** the agreement in plain language;
- **`definitions/`:** one precise definition of each shape and of the shared lists. Every project's code uses these files directly, never a copy. They're written in JSON Schema, a standard every programming language reads, so it doesn't matter which language or job runner Sourcing picks;
- **`examples/`:** example data for every shape, ready for previews, tests and staging to load later;
- **a check on every pull request** (inside Quick checks): every example passes its definition, every definition has examples, the definitions work the same in every language, and this page says exactly what the definitions say. The field tables, the lists and the worked examples below are written from the definitions and the examples, so they can't drift apart.

## Decisions for the founder

The draft needs these from you. Each has a recommendation, and the draft already follows it: approving changes nothing, and any other answer is one change.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Which Indian cities are in the launch list? | **Mumbai, Delhi NCR and Bengaluru** (reasons below) | Each has enough English-language local news on X, and enough readers, to keep a local feed full. More cities come after version one. |
| D2 | Which categories join crypto, finance, business, AI and sports? | **Politics, Entertainment and General** (reasons below) | Eight categories cover what readers look for without thinning any feed. |
| D3 | Can a story carry more than one location or category? | **Yes, up to three of each.** The first is its main one, shown on its card | Real news often spans two: a crypto rule is crypto and finance; a match in Mumbai is India and Mumbai. With only one, readers who follow the other would miss it. |
| D4 | Does a city's story also show under India (national)? | **Only when our AI also tags it India,** because it matters to the whole country. No automatic roll-up | Rolling every city story up would fill India's board with other cities' traffic and weather. Explicit tags keep each board about its own readers. |
| D5 | Where does a story card's picture come from? | **From the story's newest image or video by Hrizzup or a creator; otherwise a design in the category's own look.** Stories carry no picture of their own | Pictures in posts on X belong to the people who posted them, so our pipeline can't reuse them; ours and invited creators' can be used. |
| D6 | Must a user's post carry a category? | **No.** Posts by Hrizzup and creators must name a story or a category; a user's post may name neither | The fewest steps to post. A user's post still shows on the stories it's about, and in the social feed. |
| D7 | Market prices in US dollars or rupees? | **US dollars,** the world's reference price for Bitcoin, gold and oil; the website can show rupees alongside | The markets are global (PLAN.md section 2), and settlement must read one exact price. |

**The proposed launch list** (D1 and D2), one reason each:

| Item | Kind | Why it's in |
|---|---|---|
| Mumbai | City | India's financial and film capital, with a steady flow of English-language local news on X: trains, the monsoon, civic politics and the markets. |
| Delhi NCR | City | The capital region (Delhi, Gurugram, Noida): national politics happens here, and air quality, traffic and civic news run every day. |
| Bengaluru | City | India's tech and start-up capital, with an English-first audience that's very active on X, close to our AI and business categories. |
| Politics | Category | Most of India's national news is political (elections, Parliament, policy); without it, the India board would miss the biggest stories. |
| Entertainment | Category | Films, streaming and celebrities draw the most creators and memes in India, the heart of a creator-led app. |
| General | Category | The home for news that fits nowhere else (weather, transport, civic issues, crime, education, health), so every story has a category and the city feeds stay full. |

Next in line for cities, after version one: Hyderabad, Chennai and Pune, each a large tech hub with plenty of local news.

## The shapes at a glance

| Shape | What it is | Written by | Read by |
|---|---|---|---|
| Story | A piece of news that develops over time | Sourcing's pipeline | Product (board, story pages, feed, notifications); News Desk (to make takes) |
| Update | One development in a story; a story's updates are its timeline | Sourcing's pipeline | Product; News Desk |
| Creation | A post: text, one image or one video | News Desk (our own); creators and users, through the app | Product (feed, story pages, story cards) |
| Market | A play-money question that settles itself from real data | Product's market engine | Product (website); Sourcing (which data to read); News Desk (content on market subjects) |
| Data reading | One reading of a market subject's data slot | The data job of step 1.2's owner (Sourcing, unless the founder decides otherwise) | Product (settlement, and prices and scores on market pages) |

## Rules for every record

- **Every record says its shape and format version,** in `format` (such as `story/1`). Hand-over points use it to pick the right definition.
- **Our own words.** Stories and updates are written by our AI in our own words, never copied from the posts they're based on; those posts are linked as sources.
- **Plain text only.** Every text field holds plain text, shown as text: no formatting codes, no web-page code, and no hidden characters (control, direction, tag or other invisible characters), which can hide planted text. The one exception is the zero-width joiner that builds some emoji. New lines appear only where a field allows them.
- **Times are in UTC,** written like `2026-11-05T09:30:00Z`. Screens show them in India time.
- **IDs are UUIDs, version 7,** made once by whoever writes the record, so a retried write can't create a duplicate. Accounts keep the IDs our sign-in service gives them.
- **Files are named by their place in our storage, never by a web address,** so the same record works on staging and production. Images live in our media storage (R2, delivered through Cloudflare); videos in our video service (Cloudflare Stream).
- **Optional fields are left out when they have nothing to say:** never empty, never null.
- **Values come from the shared lists,** by their codes.
- **Limits are outer bounds.** Every reader handles anything within them; a writer may set tighter limits of its own (the app might cap a user's post well below 2,000 characters).
- **Writers write only the fields defined here, and readers ignore fields they don't use.** Hand-over points refuse unknown fields, so a misspelt or planted field can't slip through, and adding an optional field never breaks a reader.

## Shared lists

Any list of values that more than one project writes or reads is defined once, in `definitions/lists.schema.json`, and every project reads it from there. Each item has:

- a **code**, which records carry and which never changes;
- a **name**, which people see and which can be improved at any time;
- **what it covers**, which our AI reads when it tags a story, so it must be precise.

Adding an item is one change in that one file ("Changing the agreement", below). Readers must cope with an item they haven't met before, for example by showing it in a plain default style.

### Locations (launch list proposed: D1)

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

### Categories (launch list proposed: D2)

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

Each market subject has one **data slot**: what it measures, and how settlement reads it. A slot names no provider: the owner of step 1.2 chooses each source, and fills the slot with data readings in the shape below. The exact market questions are settled in step 3.2.

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

Note: Gold or oil joins this list once PLAN.md step 1.2 decides which (on hold until the founder confirms its owner).
<!-- end generated -->

## Story

**What it is:** a piece of news that develops over time, such as a cricket match, a court case or a city's smog. **Written by** Sourcing's pipeline, from the bots' results: it creates the story when the news first breaks, keeps its title and summary current, adds updates to its timeline, and tags it with locations and categories from the shared lists. **Read by** Product (the board, story pages, the feed and notifications) and News Desk (to choose stories to cover).

- **Each run of the bots starts fresh,** so the pipeline matches new items to existing stories. When two stories turn out to be the same news, it merges one into the other: the duplicate's updates move to the story that stays, and the duplicate says where it went.
- **When our AI finds a story wasn't true,** it withdraws it. Readers stop seeing it, and an old link shows the reason.

<!-- generated: fields story/1 -->
| Field | Required | What it means | What it holds |
|---|---|---|---|
| `format` | Yes | Says this record is a story, in format version 1. | Always `story/1` |
| `id` | Yes | The story's ID. Updates, posts and links refer to the story by it. | Record ID (UUID version 7, lower case) |
| `title` | Yes | The story's headline, in our own words. Rewritten as the story develops, so it always says where things stand. | One line of plain text, up to 120 characters |
| `summary` | Yes | What is happening, in one or two sentences of our own words. | Plain text, new lines allowed, up to 300 characters |
| `locations` | Yes | Where the story matters, the main one first. The story shows under each of them, and under no other. | 1 to 3, each a location from the shared list, no repeats |
| `categories` | Yes | What the story is about, the main one first. The story shows under each of them. | 1 to 3, each a category from the shared list, no repeats |
| `state` | Yes | live: readers see it. merged: it turned out to be the same news as another story, which readers see instead. withdrawn: our AI found it wasn't true, and readers no longer see it. | `live`, `merged` or `withdrawn` |
| `merged_into` | Depends | The story this one was merged into; its updates have moved there. Only when the state is merged. | Record ID (UUID version 7, lower case) |
| `withdrawn_reason` | Depends | Why the story was withdrawn, in our own words, shown to anyone who opens an old link. Only when the state is withdrawn. | One line of plain text, up to 200 characters |
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

- **A correction is a new update** that names the update it corrects; readers see the earlier one marked as corrected. Nothing is quietly edited out of a timeline.
- **An update found to be untrue is withdrawn:** it stops showing, and the reason is kept.

<!-- generated: fields update/1 -->
| Field | Required | What it means | What it holds |
|---|---|---|---|
| `format` | Yes | Says this record is an update, in format version 1. | Always `update/1` |
| `id` | Yes | The update's ID. | Record ID (UUID version 7, lower case) |
| `story_id` | Yes | The story whose timeline this update belongs to. | Record ID (UUID version 7, lower case) |
| `headline` | Yes | What happened, in one line of our own words. | One line of plain text, up to 120 characters |
| `body` | No | More detail, in our own words. Left out when the headline says it all. | Plain text, new lines allowed, up to 1,000 characters |
| `reported_at` | Yes | When this news was first reported, as near as our pipeline can tell (the earliest source's time). The timeline runs in this order. | Time in UTC, like 2026-11-05T09:30:00Z |
| `sources` | No | The public posts and pages this update is based on, as links. Left out when the bots' result gives none. | 1 to 10, each a web address starting https://, up to 2,048 characters, no repeats |
| `corrects` | No | An earlier update in the same story that this one corrects. Readers see that earlier update marked as corrected. | Record ID (UUID version 7, lower case) |
| `state` | Yes | live: it shows in the timeline. withdrawn: our AI found it wasn't true, and it no longer shows. | `live` or `withdrawn` |
| `withdrawn_reason` | Depends | Why the update was withdrawn, in our own words. Only when the state is withdrawn. | One line of plain text, up to 200 characters |
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
  "corrects": "01a19ae2-d780-7a89-96fb-aeeefeab4196",
  "state": "live",
  "created_at": "2026-11-03T04:05:00Z",
  "updated_at": "2026-11-03T04:05:00Z"
}
```
<!-- end generated -->

## Creation

**What it is:** a post: text, one image or one video, usually a take on one or more stories. Our own content, invited creators' posts and users' posts all have this shape, so the feed and the ranking treat them alike. **Written by** News Desk (our own content, posted from Hrizzup accounts) and by the app for creators and users (the author is always the account that posted it). **Read by** Product (the feed, story pages and the pictures on story cards).

- **Users post text only;** images and video come from us and from invited creators (PLAN.md section 2).
- **Our own and creators' posts name a story or a category,** so they can be placed; a user's post may name neither (D6).
- **Images and videos are cleaned by our server at upload** (location data removed, rotation fixed, size capped, a blurred preview made) before a creation can use them.

<!-- generated: fields creation/1 -->
| Field | Required | What it means | What it holds |
|---|---|---|---|
| `format` | Yes | Says this record is a creation, in format version 1. | Always `creation/1` |
| `id` | Yes | The creation's ID. | Record ID (UUID version 7, lower case) |
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
| `created_at` | Yes | When it was posted. | Time in UTC, like 2026-11-05T09:30:00Z |
| `updated_at` | Yes | When it last changed. | Time in UTC, like 2026-11-05T09:30:00Z |
<!-- end generated -->

**Worked example:** our own image, a chart, on the Bitcoin story.

<!-- generated: example creations.json 01a19a69-fe00-7ece-a8e7-1dee39c8c5cf -->
```json
{
  "format": "creation/1",
  "id": "01a19a69-fe00-7ece-a8e7-1dee39c8c5cf",
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

**What it is:** a play-money question about the future that runs and settles itself from real data (PLAN.md section 2). When it closes, settlement reads its subject's data slot, as the market subjects list describes, and pays out; nobody touches it. A **yes-or-no market** asks about a price ("Will Bitcoin be above $100,000 at 6 pm on Friday?"). A **multiple-choice market** has several outcomes, exactly one of which wins: which AI model ranks first, or who wins a match. Markets run continuously: the engine opens new ones as old ones settle, over many time windows. **Written by** Product's market engine (step 1.7). **Read by** Product (the website), Sourcing (which matches and slots to read) and News Desk (content on the market subjects).

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

**What it is:** one reading of a market subject's data slot: a price, a ranking, or a match's state and score. **Written by** the data job of step 1.2's owner (Sourcing, unless the founder decides otherwise), from the slot's chosen source. **Read by** Product: settlement, and the live prices and scores on market pages.

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

Anything from outside our system is data, never instructions, wherever our software or our AI reads it: the bots' results, creators' and users' posts, and market data readings. The bots read posts on X that anyone can write, so a result can carry planted instructions ("ignore your rules", "mark this as verified", "open this link").

- **Our AI takes its instructions only from our own prompts in this repository.** Outside text reaches it only as quoted material, clearly marked as data. Anything in it that reads like an instruction is part of the news item, never obeyed.
- **While it reads outside text, our AI can't act:** it has no tools that send, fetch, publish or change anything. Its only output is a record, which is checked like any other input before it's saved, so planted text can't add a field, pick a category outside the lists, or slip in formatting codes.
- **Our software never runs outside text or treats it as code.** Every text field is plain text, shown as text. Links are shown as plain links, and our software never follows them on its own.
- **Hidden characters are refused,** because they can hide planted text from people while machines still read it. The definitions refuse every single hidden character: control, direction, zero-width and other invisible ones, keeping only the joiner and the two variation selectors that emoji use. What no pattern catches the same way in every language, `validate()` refuses in code: tag characters (U+E0000 to U+E007F) and the extra variation selectors (U+E0100 to U+E01EF); two or more variation selectors in a row; and a zero-width joiner at either end of the text, next to another joiner, or next to a plain (ASCII) character. Code in another language adds the same three checks.

### Every hand-over point checks where its input came from, and its format

| Hand-over point | Proof of where it came from | Format check | When a check fails |
|---|---|---|---|
| The Grok bots' results reach our pipeline | Proof the result came from our own bot, by the route step 0.8 chooses (second half) | The bots' result format (second half) | Set aside, never published, and logged |
| The pipeline saves stories and updates | Only the pipeline's own credentials can write them | Each record passes its definition before it's saved | Not saved, and logged |
| News Desk saves our own creations | Only News Desk's credentials can post from Hrizzup accounts | Each creation passes its definition | Not saved, and logged |
| A creator or a user posts through the app | The author is the signed-in account, set by our server, never read from the post | Each creation passes its definition | Refused, and the person is told what to fix |
| The market engine saves markets | Only the engine's own credentials can write them | Each market passes its definition | Not saved, and logged |
| The data job saves readings | Fetched from the slot's chosen source over an encrypted, authenticated connection; only the data job can write readings | Each reading passes its definition | Set aside and logged; never settles a market |

- **Anything that fails is set aside automatically, never published, and logged** with the problems found. Nothing waits for a person.
- **Alerts:** a pile-up of failures, or no valid result arriving when the bots should have run, raises an alert, so a change on Grok's side can't silently stop the news. So does a data slot with no valid reading when one is due. Alerts go to the founder until the team's monitoring exists; the exact thresholds come with the bots' schedule, in the second half.
- **These checks judge whether input is genuine and well-formed, not whether the news is true.** Accuracy stays with our AI, with no human review: it can correct an update, withdraw an update or a story, and merge duplicates.

## Example data

`examples/` holds a small, consistent world of example data: every record passes its definition, and every reference points to another example. It's ready for previews, tests and staging to load once the tables exist (after this half is Agreed); nothing is loaded anywhere now.

| File | What's in it |
|---|---|
| `stories.json` | Smog in Delhi NCR (a timeline with several updates, one a correction); a cricket match (a story with many updates); a Bengaluru AI start-up (a title at the longest allowed, and no picture anywhere on the story); Bitcoin (one update withdrawn as untrue); and a duplicate story merged into the smog story |
| `updates.json` | Every update on those stories |
| `creations.json` | A creator's text take; our own image (a chart); a creator's video; a creator's image whose file is missing from storage; a user's post that tries to give our AI instructions (shown as text, nothing more); our own explainer, which names a category instead of a story |
| `markets.json` | Bitcoin (yes or no, open); the best AI model (multiple choice with a catch-all, open); the cricket match (multiple choice, settled) |
| `readings.json` | Bitcoin prices, an AI ranking, and the cricket match before, during and after play |

The check keeps the hard cases in: long titles, a story with many updates, a missing image, a merged story, a withdrawn update and a correction.

## For developers: using the definitions

- **TypeScript** (the website, the app's server code, and any project code written in TypeScript): depend on the workspace package `@hrizzup/agreement`. `validate(record)` returns the problems it finds; an empty list means the record matches. `shapes` holds each definition by its format.
- **Any other language:** load the files in `agreement/definitions/` with a JSON Schema 2020-12 validator, straight from this repository, at build or run time. In Python:

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

  Then add `validate()`'s three code checks for hidden text ("Rules for every hand-over point", above).
- **Never copy a definition** into another file or language. Whatever runs the pipeline and the data job (the background-jobs tool chosen in the Sourcing project) is built from this repository, so it reads these files directly.
- **The definitions use only portable features.** Their patterns spell characters out, as four-digit `\u` escapes (the form JSON Schema's standard uses), instead of using `\d`, `\w`, `\s`, `\p{…}`, look-arounds or named groups, which differ between languages; the check enforces it.
- **After changing a definition, a list or an example,** run `pnpm --filter @hrizzup/agreement readme` to rewrite this page's generated parts, then `pnpm check`.

## Changing the agreement

- **Always allowed, as one change, with no new version:**
  - adding an optional field to a shape;
  - adding an item to a shared list, once the founder approves it (as with the launch list);
  - improving a description, or the name people see for a list item.
- **Anything else needs a new format version, agreed by all three projects:** removing or renaming a field, making an optional field required, changing what a field means or the values it accepts, or changing or removing a list item's code. The new version gets its own definition file (such as `story.v2.schema.json`), and the old one stays until every writer has moved over.
- **A half's status changes to Agreed** only in a change the founder asks for.

## Second half: the Grok bots' result format

**Status: not drafted.** It will be drafted only once the Sourcing project has chosen the Grok product and plan, and the route that brings the bots' results to our pipeline (PLAN.md step 0.8). It will define:

- the format of a bot's result, with its format version;
- the proof that a result came from our own bot, by the chosen route;
- when an alert fires: how many failures, and how long without a valid result, given the bots' schedule.

It becomes Agreed only after a real result from step 0.8's test bot passes this agreement's own checks (proof of origin and format), and only through a change the founder asks for. Until then, no bot result becomes content.
