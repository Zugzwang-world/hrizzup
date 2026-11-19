# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 19 November 2026 by Round 6's relay R12, Readers, at its closing pull request ([#215](https://github.com/Zugzwang-world/hrizzup/pull/215): R12's done-test and closing records; R9 and R13 on hold), keeping the other sessions' updates. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. **Product builds** the website, the app, the markets, the public API for bots and AI tools, and social, where AI agents post takes on every story; it shows Sourcing's stories in the hand-over agreement's shapes (`agreement/README.md`, first half Agreed).

## Where things stand

- **Social on staging** (Round 6: Phases 1 and 2 done, Wave 1 done): the console makes invites and test stories; anyone reads the board, each story's timeline, desk and brief (API, MCP and plain sandbox pages, refreshed every minute); agents join, are claimed, check in, pin stories, post text, images, video and audio, reply and upvote; six of Hrizzup's own test agents post on nine real stories; views are counted and shown, and Top ranks replies, views and upvotes; **every signed-in reader has a reader agent** that tunes their For You from a short reading profile.
- **Staging** (`staging.hrizzup.com`, Mumbai) is public; previews share its database; production is a quiet twin. **Also built:** the typed API (`/api/v1`, docs, MCP); the app's sign-in test (1.6b: two of your tries open); the markets, the Bitcoin perp and their sandbox; the content store.

## Round 6 progress

- **R1 to R8, R10 and R16:** done ([#143](https://github.com/Zugzwang-world/hrizzup/pull/143) to [#202](https://github.com/Zugzwang-world/hrizzup/pull/202); [hrizzup-skills#1](https://github.com/Zugzwang-world/hrizzup-skills/pull/1) to [#5](https://github.com/Zugzwang-world/hrizzup-skills/pull/5)).
- **R17, the test cast:** done ([#203](https://github.com/Zugzwang-world/hrizzup/pull/203), [#207](https://github.com/Zugzwang-world/hrizzup/pull/207), [#209](https://github.com/Zugzwang-world/hrizzup/pull/209)). For you: look at the board and desks (below).
- **R11, signals:** done ([#205](https://github.com/Zugzwang-world/hrizzup/pull/205), [#208](https://github.com/Zugzwang-world/hrizzup/pull/208), [#211](https://github.com/Zugzwang-world/hrizzup/pull/211), [#212](https://github.com/Zugzwang-world/hrizzup/pull/212), [#213](https://github.com/Zugzwang-world/hrizzup/pull/213)).
- **R12, readers:** done: the keys' names ([#204](https://github.com/Zugzwang-world/hrizzup/pull/204)); the database ([#206](https://github.com/Zugzwang-world/hrizzup/pull/206)); the reader's calls and its AI ([#210](https://github.com/Zugzwang-world/hrizzup/pull/210)); For You, opening on it, the reader agent's page ([#214](https://github.com/Zugzwang-world/hrizzup/pull/214)); the live Workers AI call and the done-test passed on staging with the real model, a format word always lands in Formats, and the closing records ([#215](https://github.com/Zugzwang-world/hrizzup/pull/215)). For you: try your own reader agent (below).
- **R9 and R13:** on hold (your decision, 19 November 2026): they start once you set the next phases, and the Product chat writes their relays then; R14 and your one end-to-end test still follow them; R15 closes the round. **S1,** the skills track's plan: when you start its chat.

## Decisions in force

- **Social's V1 beta** (16 to 18 November 2026; `docs/social/spec.md`, section 17): invited owners' agents post takes on every story's desk; humans read with no account; a reader agent on Workers AI's free allowance; calls beta until R14; staging is sandbox data.
- **Media and signals** (R8, R11): every upload checked on our server; a view is a post on screen for about a second, once per device a UTC day, nothing about a reader kept past the day, at most 20 devices per address per post a day (until P.20); Top's weights are console settings.
- **Readers** (R12; `docs/social/r12-design.md`): the reader agent never posts; chats and profiles are private from other users; it answers small edits, never a rewritten profile; For You is plain code over a cached build, never AI; Hrizzup's own cap (9,000 neurons) sits below Workers AI's free 10,000, and each reader has 20 messages a day; past the cap chat pauses until 05:30 IST and feeds keep working; this Mac never calls Workers AI.
- **How the rest of the build runs** (19 November 2026): R9 and R13 on hold until you set the next phases; then R14, which locks and tests the whole beta once; **one end-to-end test by you after R14 replaces Reviews 1 to 3,** your own agent test optional.
- **Dark mode only** (18 November 2026), for the design chat; the checks stay as they are.
- **Never your own browser** (the Product chat, 19 November 2026; CLAUDE.md): Claude Code reads pages with WebFetch or Playwright's own fresh browsers, never with a tool driving your Chrome.
- **Standing:** one versioned public API; free tiers only; checks and budgets never looser; no questions to you during relays; design only from your references; database changes first, adding only; the advisor before designs, risky pull requests and final reports; public until launch (P.17).

## What changed in the latest session

**R12, readers** ([#204](https://github.com/Zugzwang-world/hrizzup/pull/204), [#206](https://github.com/Zugzwang-world/hrizzup/pull/206), [#210](https://github.com/Zugzwang-world/hrizzup/pull/210), [#214](https://github.com/Zugzwang-world/hrizzup/pull/214), [#215](https://github.com/Zugzwang-world/hrizzup/pull/215); done):

- **The reader agent:** every signed-in reader on staging chats what they want at `/sandbox/social/reader`; the agent (Workers AI, Llama 3.2 3B) makes small edits to their reading profile, three lists (More of, Less of, Formats) they can also edit by hand; every version is kept.
- **For You:** built from that profile in plain code over the board's top 300 stories ("Less of" hides, "More of" and liked formats lift), cached five minutes per reader; a signed-in reader whose profile holds something opens on it, and **Board** switches back for that browser session.
- **The allowance's books:** each message reserves its most before the AI call and settles to what it used; a crashed or slow call can never spend twice or slip past a cap (two automated reviews' findings, fixed before merge).
- **The live call and the done-test passed on staging with the real model:** "AI and crypto news, mostly timelines, no politics" became More of AI, crypto, timelines and Less of politics; For You listed matching stories and none about politics; the board opened on For You; a hand edit changed it; a replay answered with no second call. **Found and fixed:** the model put "timelines" under More of, where it lifts nothing, so a format word now always lands in Formats, in plain code.
- **The allowance at the done-test:** 18.09 of 9,000 neurons used that day, four real calls (3.5 to 5.5 neurons each).
- **Also:** the account ID is `WORKERS_AI_ACCOUNT_ID` in Doppler; R9 and R13 recorded on hold; CLAUDE.md's browser rule.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **From R12:** four readings of build.md 7.7 (small edits; topics match a story's own words, Formats its desk's; the board choice kept per browser session; the stand-in's simple edits): keep all four. **The 3B model** misses some asks ("no crypto" in the first live call): watch your own tries; a bigger model is one console setting, at more neurons a message.
- **From R17:** a Screen check part on GitHub's newer machine image can stop at 10 minutes installing libraries (an outage: comment, re-run once; it hit R12 three times on 19 November); tiles crop 4:5 pictures (the design chat sets the tile); the skills track: the voice kit's caption check and the kits' file rights.
- **From R11:** R6's other per-address limits should count an IPv6 block (P.20 or R14); the privacy page says how views are counted, at launch.
- **From R8:** where pictures are served from (the story page's 2.71 s against 2.5 s in the lab; recommendation: decide it with the designed story page, before launch); refuse media that carry where they were recorded, before launch.
- **From R7:** an inbox holds replies to an agent's replies too (keep it); the thread page in the Speed check.
- **Also:** R10's five, market/2 before 3.3, R5's four, and the status file's standing list.

## For the founder

- **Try your own reader agent** (nothing to set up): sign in at `staging.hrizzup.com/sign-in-test` (**Continue with Google**), open `/sandbox/social/reader`, type what you want ("AI news from the Philippines, mostly timelines and memes, no crypto"), and watch the reply and your reading profile change; edit the profile by hand and **Save**; then open `/sandbox/social`, which now opens on your For You. Each reply shows what it used; the page shows Hrizzup's day. **Never add `CLOUDFLARE_ACCOUNT_ID` to Doppler `stg`** (a tool key's name: every job reading `stg` would stop).
- **See the test cast and signals** (nothing to do), signed out: [the board](https://staging.hrizzup.com/sandbox/social) and its desks (views on every post; Top's weights in the console's **Settings**). To run the cast again: open a session in `~/hrizzup` and say "Run the test cast (docs/social/test-cast.md)". Withdraw the two older listed test stories in the console's **Stories** when you're done looking.
- **Your own agent test (optional):** in `/console/social`, invite your own email and give the ready message's one line to a fresh Claude Code session (the cast's runbook shows the routine).
- **The next phases:** R9 (files and owner chat) and R13 (marketplace) wait for you to set them; R14 follows.
- **The skills repository's licence:** none yet (P.23; recommended: MIT). **The skills track** starts when you open its chat.
- **Before launch:** pictures' delivery (no cost now); a report button (P.22); the exchanges' terms (P.19); the API's limits per address (P.20). **Also:** the first topics (1.2); your two phone tries for 1.6b; your design references. **Spending parked.**

## What's next

**Wave 1 is done** (R17, R11, R12). R9 and R13 wait for you to set the next phases; then R14 (the whole beta locked and tested once), your one end-to-end test, and R15 to close the round. The test cast runs again whenever you ask; **the skills track** runs in a chat of its own whenever you start it. Carried: the screens once designed (dark mode only); the topics (1.2); market/2 before 3.3; the stream (3.5e) later.

## Read for detail

- `docs/social/spec.md` (social's design and the founder's answers), `docs/social/build.md` (the technical design), `docs/social/r12-design.md` (readers, as built), `docs/social/r11-design.md` (signals), `docs/social/media-design.md` (media; pictures' delivery, section 16), `docs/social/r7-design.md`, `docs/social/r5-design.md`; `product/packages/api/src/social/` (every call's shape and example data).
- `docs/social/test-cast.md`, `docs/social/skills-catalogue.md` and [`hrizzup-skills`](https://github.com/Zugzwang-world/hrizzup-skills).
- `PLAN.md` (section 2, "Social"; step 2.8), `TRACKER.md` (Round 6's queue), `CLAUDE.md` ("How relays run: the role team").
- `docs/setup/BLUEPRINT.md`; `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/status/product.md` (Product's status in full).
