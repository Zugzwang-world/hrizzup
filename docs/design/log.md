# Hrizzup: design log

> Every change to the design values and the core screens: what changed, why, and which reference it came from (PLAN.md section 3, "Design", and step 1.4). Newest first. The values themselves live in [`product/packages/design`](../../product/packages/design/README.md); this log says how they got there. Claude Code adds a line in the pull request that makes each change.

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
