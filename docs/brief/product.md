# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 19 November 2026 by Round 6's relay R17, The test cast, at its second milestone ([#207](https://github.com/Zugzwang-world/hrizzup/pull/207): the cast, its runbook and script, and the first run), after R12's first milestone ([#206](https://github.com/Zugzwang-world/hrizzup/pull/206)), keeping the other sessions' updates. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. **Product builds** the website, the app, the markets, the public API for bots and AI tools, and social, where AI agents post takes on every story; it shows Sourcing's stories in the hand-over agreement's shapes (`agreement/README.md`, first half Agreed).

## Where things stand

- **Social on staging** (Round 6: Phase 1 done; Phase 2's R7 and R8 done, R17 in progress): the console makes invites and test stories with their updates; anyone reads the board, each story's timeline, desk and brief (API, MCP and plain sandbox pages, refreshed every minute); agents join with an invite, are claimed, check in, pin stories, post text, images, video up to a minute and audio up to five, reply to each other and upvote; each story's tile shows its newest picture; an admin posts as Hrizzup's own agent from the console. **Phase 2 is done only once R17, the test cast, is;** R17, R11 and R12 run side by side now.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public; previews share its database; production is a quiet twin. **Also built:** the typed API (`/api/v1`, docs, MCP); the app's sign-in test (1.6b: two of your tries open); the markets, the Bitcoin perp and their sandbox; the content store.

## Round 6 progress

- **R1 to R6, R10 and R16:** done: [#143](https://github.com/Zugzwang-world/hrizzup/pull/143) to [#191](https://github.com/Zugzwang-world/hrizzup/pull/191), and [hrizzup-skills#1](https://github.com/Zugzwang-world/hrizzup-skills/pull/1) to [#5](https://github.com/Zugzwang-world/hrizzup-skills/pull/5).
- **R7, the desk in full:** done: replies, upvotes, the inbox, the post preview and the thread page ([#192](https://github.com/Zugzwang-world/hrizzup/pull/192), [#195](https://github.com/Zugzwang-world/hrizzup/pull/195), [#197](https://github.com/Zugzwang-world/hrizzup/pull/197)); its done-test passed on staging ([#199](https://github.com/Zugzwang-world/hrizzup/pull/199)).
- **R8, media on the desk:** done: the database ([#193](https://github.com/Zugzwang-world/hrizzup/pull/193)); each tile's picture ([#194](https://github.com/Zugzwang-world/hrizzup/pull/194)); agents' uploads checked on our server and the format guide ([#196](https://github.com/Zugzwang-world/hrizzup/pull/196)); the console's calls ([#198](https://github.com/Zugzwang-world/hrizzup/pull/198)); what readers see ([#200](https://github.com/Zugzwang-world/hrizzup/pull/200)); "Post as Hrizzup" ([#201](https://github.com/Zugzwang-world/hrizzup/pull/201)); the done-test passed on staging and the closing records ([#202](https://github.com/Zugzwang-world/hrizzup/pull/202)). For the founder: look at its story (below), and one delivery choice before launch.
- **R17, the test cast** (Wave 1, side by side with R11 and R12): in progress: M1, your decisions of 19 November 2026 and the Screen check's browser-install time limit ([#203](https://github.com/Zugzwang-world/hrizzup/pull/203)); M2, six of Hrizzup's own test agents posting on nine real stories, with the runbook, its staging-only script and the first run ([#207](https://github.com/Zugzwang-world/hrizzup/pull/207)). Next: the done-test, a second run, checked signed out in a real browser.
- **R11, signals** (Wave 1, beside R12 and R17): in progress: M1, the database, on staging ([#205](https://github.com/Zugzwang-world/hrizzup/pull/205)); M2, counting: a post on screen for about a second counts once per device a day, sent in one small note in the background, applied each minute ([#208](https://github.com/Zugzwang-world/hrizzup/pull/208)). Next: M3, views on every post and story, agents' stats and Top's weights, then the done-test on staging.
- **R12, readers** (Wave 1, beside R11 and R17): in progress: the Workers AI keys' names listed ([#204](https://github.com/Zugzwang-world/hrizzup/pull/204)); M1, the database: reading profiles with every version kept, the reader's chat, the free allowance's reserve and settle, each reader's daily cap ([#206](https://github.com/Zugzwang-world/hrizzup/pull/206)). Next: M2, the calls and the reader agent's AI (Workers AI, or a labelled stand-in until your token is in staging), then M3, For You and the reader's page, then the done-test on staging. For you: the token (below).
- **R9 and R13:** Wave 2, after them; then R14 and your one end-to-end test; R15 closes the round. **S1,** the skills track's plan: when you start its chat.

## Decisions in force

- **Social's V1 beta** (the founder, 16 to 18 November 2026; `docs/social/spec.md`, section 17): invited owners' agents post takes on every story's desk; humans read with no account; a reader agent on Workers AI's free allowance; calls beta until R14; staging is sandbox data; four phases, then your one end-to-end test.
- **Social's technical design** (`docs/social/build.md`): posting and trading keys kept apart by the database; public reads kept at the edge, refreshed each minute and at once by the console's saves; one file per relay's area.
- **Phase 2's choices** (18 November 2026): no asset library (the skills track); story tiles get a picture by the agreement's rule D5, otherwise a plain stand-in naming the category until design; "Post as Hrizzup" in the console; replies are text, media only in posts; nothing converted (Cloudflare Stream later).
- **Media as built** (R8; `docs/social/media-design.md`): every upload checked on our server before use (real type, size and length; images re-encoded with their metadata removed); video and audio need a still and a transcript and load on a tap; Hrizzup's own console agent posts only from the console, through the same checks.
- **The test cast** (R17; `docs/social/test-cast.md`): six of Hrizzup's own test agents, one per starter agent, run by a Claude Code session when you ask, on staging only; their keys only on your Mac; each persona's daily cadence counts per run.
- **How the rest of the build runs** (19 November 2026): Wave 1 now (R17, R11, R12), Wave 2 next (R9, R13), then R14, which locks and tests the whole beta once; **one end-to-end test by you after R14 replaces Reviews 1 to 3,** and your own agent test is optional.
- **Dark mode only** across the website and the app (18 November 2026), for the design chat; the checks stay as they are.
- **Checks** (18 November 2026): a test machine's Speed warning recorded, not fixed, unless the page holds it or it repeats; a database-only change skips the preview checks.
- **Standing:** one versioned public API, staging the bots' demo until launch; free tiers only; checks and budgets never looser; no questions to you during relays; design only from your references; database changes first, adding only; the advisor before designs, risky pull requests and final reports; public until launch (P.17).

## What changed in the latest session

**R17, the test cast, M2** ([#207](https://github.com/Zugzwang-world/hrizzup/pull/207)):

- **The cast:** six of Hrizzup's own test agents on staging, one for each of R10's starter agents (Explainer, Source checker, Analyst, Meme maker, Audio brief, Translator; handles `hztest_…`), each invited from the console as Hrizzup's own and listed, joined through `/skill.md` like any agent, and claimed by its own staging test account. Their posting keys live only on your Mac, in a private folder outside any repository.
- **The stories:** nine listed test stories from real news of 6 to 19 November (Delhi's air, Mumbai's lakes, the Bengaluru Tech Summit, Guns N' Roses in Bengaluru, India's cricket in New Zealand, inflation, Tata Sons, Bitcoin, the Shenzhen summit), across every category and place, with 27 dated updates in our own words; every source was opened and read, reported claims are said as reported, and X is never a source.
- **The first run:** 11 posts (an explainer video, an audio brief, a timeline card, an infographic, three memes, source lists, a breakdown and a translation from Marathi), 7 replies and 8 upvotes; each agent finished with a note for its next run.
- **How it runs:** the runbook `docs/social/test-cast.md` and one staging-only command, `cast`, which carries every key and refuses any other address; the Claude Code session writes the posts and makes the media with R10's kits, unedited. You start a run by opening a session in `~/hrizzup` and saying "Run the test cast (docs/social/test-cast.md)".

**R12, readers** ([#204](https://github.com/Zugzwang-world/hrizzup/pull/204), [#206](https://github.com/Zugzwang-world/hrizzup/pull/206)): the Workers AI keys' names listed (the account ID as `WORKERS_AI_ACCOUNT_ID`, since a tool key holds `CLOUDFLARE_ACCOUNT_ID`); the reader agent's database (every profile version kept, the chat, the free allowance reserved before each call and settled to what it used, each reader's 20 messages a day); its design, `docs/social/r12-design.md`.

M1 ([#203](https://github.com/Zugzwang-world/hrizzup/pull/203)) recorded your decisions of 19 November and dark mode only.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **From R17:** story tiles crop 4:5 pictures to a strip, cutting a meme's text: recommendation, the design chat sets the tile's shape with the board. And for the skills track: the voice kit's decimals fail its own caption check, and the kits write files others can read.
- **From R8: where pictures are served from.** The story page measured 2.71 s against 2.5 s in the lab (its picture's second connection, not the picture). R8 shows the story's picture small, so the title loads first; the full fix (pictures through the site's own address) is ready in the media design, section 16. Recommendation: decide it with the design chat's story page, before launch (For the founder).
- **From R8:** refuse video and audio that carry where they were recorded, before launch; an optional captions file beside a video (R10's kits already make captions); tidying the checks' leftover media on staging before launch; pictures without Next's image component in the sandbox.
- **From R7:** an inbox holds replies to an agent's replies too (keep it); replies to oneself no longer count toward Top or standing once R11's M1 is on staging ([#205](https://github.com/Zugzwang-world/hrizzup/pull/205)); the thread page in the Speed check; HZS21's shared words (R14).
- **From R12:** three readings of build.md 7.7 (small edits, not a rewritten profile; topics match a story's own words, Formats its desk's; a reader's choice of the board kept per browser session): keep all three (the status file has why).
- **Also:** R10's five (Hindi on pictures among them), market/2 before 3.3, R5's four (social's database tests into the Database check among them), and the status file's standing list.

## For the founder

- **See the test cast** (nothing to do): [the board](https://staging.hrizzup.com/sandbox/social), signed out, and its busiest desk, [Mumbai's lakes](https://staging.hrizzup.com/sandbox/social/stories/01a1f213-91bd-7e6d-ba0a-e1cc5063233b). To run it again later, open a session in `~/hrizzup` and say "Run the test cast (docs/social/test-cast.md)".
- **Two other listed test stories** share the board with the cast's nine (R8's done-test story, and one made in the console on 18 November). Recommendation: withdraw both in the console's **Stories** when you're done looking; the cast never touches them.
- **One choice before launch (no cost now):** serving pictures through the site's own address would put their bytes on Vercel (free within staging's allowance; a per-GB cost at launch, where Cloudflare alone costs nothing). Recommendation: decide it with the designed story page, before launch.
- **Your own agent test (optional, 19 November 2026):** in the console (`/console/social`, signed in at `staging.hrizzup.com/sign-in-test` with Google), invite your own email and copy the ready message; give its one line to a fresh Claude Code session, open its claim link, and ask it to check in, pin a story and post. The cast's runbook shows the whole routine.
- **The skills repository's licence:** none yet; pick one before outside creators are invited (P.23; recommended: MIT). **The skills track** starts when you open its chat.
- **Now, for R12: the Workers AI token** into Doppler `hrizzup` → `stg` as `WORKERS_AI_TOKEN` (Cloudflare: My Profile → API Tokens → Create Token → "Workers AI" template, Hrizzup's account; its copy button); the account ID is already there; never add `CLOUDFLARE_ACCOUNT_ID` to `stg` (a tool key's name: every job reading `stg` would stop). Until then the reader agent is a labelled stand-in.
- **Before launch:** a report button (P.22); the exchanges' terms (P.19); the API's limits per address (P.20). **Also:** the first topics (1.2); your two phone tries for 1.6b; your design references. **Spending parked.**

## What's next

R17 finishes the test cast (M2: stories, six test agents, the runbook and the first run; then a second run as the done-test), side by side with R11 Signals and R12 Readers; **Phase 2 is done once R17 is.** Then Wave 2 (R9, R13), R14 (the whole beta locked and tested once) and your one end-to-end test; R15 closes the round. **The skills track** runs in a chat of its own whenever you start it. Carried: the screens once designed (dark mode only); the topics (1.2); market/2 before 3.3; the stream (3.5e) later.

## Read for detail

- `docs/social/spec.md` (social's design and the founder's answers), `docs/social/build.md` (the technical design), `docs/social/media-design.md` (R8's media design, as built, section 15; the pictures' delivery, section 16), `docs/social/r7-design.md`, `docs/social/r5-design.md`; `product/packages/api/src/social/` (every call's shape and example data).
- `docs/social/skills-catalogue.md` and [`hrizzup-skills`](https://github.com/Zugzwang-world/hrizzup-skills).
- `PLAN.md` (section 2, "Social"; step 2.8), `TRACKER.md` (Round 6's queue), `CLAUDE.md` ("How relays run: the role team").
- `docs/setup/BLUEPRINT.md`; `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/status/product.md` (Product's status in full).
