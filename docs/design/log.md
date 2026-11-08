# Hrizzup: design log

> Every change to the design values and the core screens: what changed, why, and which reference it came from (PLAN.md section 3, "Design", and step 1.4). Newest first. The values themselves live in [`product/packages/design`](../../product/packages/design/README.md); this log says how they got there. Claude Code adds a line in the pull request that makes each change.

## 8 November 2026: Claude Code's pick, Bazaar, carried on: the values page and the story page

**Bazaar is the active direction** while the founder looks (Claude Code's pick, not yet his choice): most stories won't have a creator's picture at first, and Bazaar's category posters make those stories the most eye-catching thing on the board; it also suits a creator-led app better than a classic newspaper look. Switching direction changes only `activeDirection` in `src/values.ts` and which typeface `lib/fonts.ts` preloads.

- **The values page** (`/design/directions/<direction>/values`): every colour in light and dark with its value, each category's own look, the typefaces with their licences, every text style with its size, line, weight and width, the spacing and corners, every icon, and the core components: buttons, badges, the board's choices, story cards, a timeline with a correction, and takes from each route.
- **The story page** (`/design/directions/<direction>/story/<id>`, one for each of the agreement's example stories): the story's picture or its category's look, its categories and places, the headline in full, its summary, then "How it developed" (the timeline, newest first, grouped by day in India time, a correction badged and tied to what it corrects, merged and withdrawn updates left out, sources and the posts it reports credited and linked, earlier updates folded away after six) and "Takes" (found posts credited to their creator on X with our summary standing in for X's embed until step 2.3, our own content crediting what it builds on, creators' and readers' posts as plain text; likes and dislikes). A merged story's old page says where it went.
- **shadcn/ui's Button and Badge**, set in the design values (MIT; notice in `THIRD_PARTY_NOTICES.md`).
- **The design samples' accounts** (names for the example account IDs) are made up, like the eight sample stories: the agreement carries account IDs only.

## 8 November 2026: the three directions as working boards

**What:** each direction's board at phone size, on the design pages (`/design`, previews and this Mac only), built from the same components with the direction's own values, and filled with the agreement's example stories plus eight design samples.

- **The story card:** the story's picture (its newest image or video by Hrizzup or a creator, decision D5), or its category's own look when it has none; the category and the main place; the headline in full, never cut short; the latest update; then when it last changed, its updates and its takes. A missing image shows its blurred placeholder, as a real screen does.
- **Each direction's one bold thing, on the card:** Neel's ink-printed panel with the category's mark; Bazaar's poster, the whole card in the category's colour with a big cut of its mark; Pulse's colour field with the day's update count, and its pulse strip (a tick for each update in the last day) on every card.
- **The board:** Latest, Top and For you; a place (Everywhere, then the agreement's locations); a category. Each choice works on CSS alone, so the board ships no script. Top is a stand-in until ranking exists (updates in the last day, then takes); For you is a sample reader who follows Sports and AI and bookmarked the smog story.
- **The masonry** (Pinterest-style, PLAN.md section 2): a grid of thin rows, each card spanning the rows it's expected to need and stretching to fill them, so nothing overlaps or is cut off and cards stay in order for screen readers; Safari's native masonry (grid lanes) takes over where it exists.
- **Design samples:** eight more stories in the agreement's story shape (checked by the agreement's own `validate()`), so the board is full and every category's look shows. The agreement's five examples stay the main cast. The pages read time as 10:30 pm India time on 4 November, when the examples happened, so "35 min ago" never drifts.
- **The existing pages** (the holding page, the legal drafts, the 404 and the sign-in test) now read the design values too, so they follow whichever direction is active; the holding page's own colours are gone.
- **Why these choices:** the repository's screen check refuses anything cut off, overlapping or scrolling sideways, so headlines show in full, the category chips wrap rather than scroll, and nothing sits on top of a picture except on a placeholder.

## 8 November 2026: step 1.4's first pass begins

**The founder hasn't given references yet**, so the first pass starts from Claude Code's own picks among today's best news and markets products, and adopts his references whenever he gives them.

**Three directions, each a full set of values** (`src/directions/`), built on the same components so they differ only in their values:

| Direction | The idea | Typefaces | Its one bold thing | References |
|---|---|---|---|---|
| **Neel** (indigo ink) | The calm, credible newsroom: indigo ink on cool paper | Eczar (Rosetta, designed in India) for headlines; the phone's own typeface for text | Headlines set in Eczar; a story with no picture shows its category as an ink-printed panel | Apple News (headline-led tiles), The Economist app (restraint), Indian indigo block printing (Bagru, dabu) |
| **Bazaar** (poster pop) | Loud, joyful, made for sharing: a wall of posters | Anek Latin (Ek Type, designed in India), condensed for headlines | Each category has its own street colour, and a story with no picture becomes a poster in it | Pinterest (the board), Amul's topical hoardings (news with wit, in bold colour), Indian hand-painted signs and market colours |
| **Pulse** (live heat) | Precise, numeric and fast, the bridge to the markets | Archivo (Omnibus-Type), semi-condensed for headlines | Every card's pulse strip: a tick for each update in its last day, so the board shows what's moving | Particle (stories from many sources), market terminals (exact numbers), Apple Weather (data as colour), Kalshi and Polymarket |

**Choices made for all three, and why:**

- **Every category has its own look** in each direction (a colour, a text colour on it, a quiet tint and a mark), because the agreement's decision D5 makes "a design in the category's own look" the picture of every story without a creator's image or video, which at launch is most stories.
- **Colours are six-digit hex**, the one format both the website and the app read. Light and dark versions of each, following the device's setting.
- **Text sizes are pixels at the default text size;** the website writes them as rem, so text grows with the reader's text-size setting.
- **Icons from Lucide** (ISC licence; shadcn/ui's own set), copied in for only the icons used, so the app carries no unused ones. Line thickness is a value per direction.
- **Typefaces from Google Fonts under the SIL Open Font License** (free); two of the three directions use typefaces designed in India, with Indian scripts available for later.
- **Politics never wears a party's colour:** each direction gives it a neutral colour (Bazaar's is the violet of the ink on voters' fingers).
- **The readable-text check** (`src/contrast.ts`): every text colour on every background the screens use, in both settings, reaches WCAG's 4.5 to 1. It lands before any design page does (PLAN.md section 3, "Checks come first").
