# Product: brief

**This brief replaces Claude Code's report:** read it after **Sync now** instead of asking the founder for one, and attach the files under "Read for detail" from GitHub for more.

> Rewritten 19 November 2026 by Round 6's relay R8, Media on the desk, at its close: its six milestones and the done-test on staging, [#202](https://github.com/Zugzwang-world/hrizzup/pull/202), keeping the other sessions' updates and trimmed to this brief's length. PLAN.md wins any disagreement.

**Hrizzup** is a news app built around creators, plus a website with play-money prediction markets. **Product builds** the website, the app, the markets, the public API for bots and AI tools, and social, where AI agents post takes on every story; it shows Sourcing's stories in the hand-over agreement's shapes (`agreement/README.md`, first half Agreed).

## Where things stand

- **Social on staging** (Round 6, Phases 1 and 2 done): the console makes invites and test stories with their updates; anyone reads the board, each story's timeline, desk and brief (API, MCP and plain sandbox pages, refreshed every minute); agents join with an invite, are claimed, check in, pin stories, post text, images, video up to a minute and audio up to five, reply to each other and upvote; each story's tile shows its newest picture; an admin posts as Hrizzup's own agent from the console. **Next: R17, the test cast, then your Review 2.**
- **Staging** (`staging.hrizzup.com`, Mumbai) is public; previews share its database; production is a quiet twin. **Also built:** the typed API (`/api/v1`, docs, MCP); the app's sign-in test (1.6b: two of your tries open); the markets, the Bitcoin perp and their sandbox; the content store.

## Round 6 progress

- **R1 to R6, R10 and R16:** done: [#143](https://github.com/Zugzwang-world/hrizzup/pull/143) to [#191](https://github.com/Zugzwang-world/hrizzup/pull/191), and [hrizzup-skills#1](https://github.com/Zugzwang-world/hrizzup-skills/pull/1) to [#5](https://github.com/Zugzwang-world/hrizzup-skills/pull/5).
- **R7, the desk in full:** done: replies, upvotes, the inbox, the post preview and the thread page ([#192](https://github.com/Zugzwang-world/hrizzup/pull/192), [#195](https://github.com/Zugzwang-world/hrizzup/pull/195), [#197](https://github.com/Zugzwang-world/hrizzup/pull/197)); its done-test passed on staging ([#199](https://github.com/Zugzwang-world/hrizzup/pull/199)).
- **R8, media on the desk:** done: the database ([#193](https://github.com/Zugzwang-world/hrizzup/pull/193)); each tile's picture ([#194](https://github.com/Zugzwang-world/hrizzup/pull/194)); agents' uploads checked on our server and the format guide ([#196](https://github.com/Zugzwang-world/hrizzup/pull/196)); the console's calls ([#198](https://github.com/Zugzwang-world/hrizzup/pull/198)); what readers see ([#200](https://github.com/Zugzwang-world/hrizzup/pull/200)); "Post as Hrizzup" ([#201](https://github.com/Zugzwang-world/hrizzup/pull/201)); the done-test passed on staging and the closing records ([#202](https://github.com/Zugzwang-world/hrizzup/pull/202)). For the founder: look at its story (below), and one delivery choice before launch.
- **R9, R11 to R15 and R17:** not started: R17, the test cast, then Review 2; Phase 3 is R11 and R12; R9 and R13 come later, with the skills track; R14 and R15 close the round. **S1,** the skills track's plan: when you start its chat.

## Decisions in force

- **Social's V1 beta** (the founder, 16 to 18 November 2026; `docs/social/spec.md`, section 17): invited owners' agents post takes on every story's desk; humans read with no account; a reader agent on Workers AI's free allowance; calls beta until R14; staging is sandbox data; four phases, each ending with your review.
- **Social's technical design** (`docs/social/build.md`): posting and trading keys kept apart by the database; public reads kept at the edge, refreshed each minute and at once by the console's saves; one file per relay's area.
- **Phase 2's choices** (18 November 2026): no asset library (the skills track); story tiles get a picture by the agreement's rule D5, otherwise a plain stand-in naming the category until design; "Post as Hrizzup" in the console; replies are text, media only in posts; nothing converted (Cloudflare Stream later).
- **Media as built** (R8; `docs/social/media-design.md`): every upload checked on our server before anything can use it (its real type, size and length; every image re-encoded with all its metadata, location included, removed); video and audio need a still image and a transcript and load only on a tap; Hrizzup's own agent has no owner and no key, and only the console posts as it, through the same checks and limits as any agent.
- **Checks** (18 November 2026): a test machine's Speed warning recorded, not fixed, unless the page holds it or it repeats; a database-only change skips the preview checks.
- **Standing:** one versioned public API, staging the bots' demo until launch; free tiers only; checks and budgets never looser; no questions to you during relays; design only from your references; database changes first, adding only; the advisor before designs, risky pull requests and final reports; public until launch (P.17).

## What changed in the latest session

**R8, media on the desk** (Round 6, Phase 2; done):

- **The database** ([#193](https://github.com/Zugzwang-world/hrizzup/pull/193)): uploads checked in two short steps, the format guide's data, the console's own agents ("Hrizzup"), each story's picture.
- **Uploads** ([#196](https://github.com/Zugzwang-world/hrizzup/pull/196), beta): an agent asks for a one-time link, sends the file straight to our storage and says it's done; our server checks it, cleans images, measures video and audio with our own readers (hardened in review against files that lie about their length), and only then moves it where readers get it. The format guide (`GET /social/formats`) and the skill file's media part.
- **The console's calls** ([#198](https://github.com/Zugzwang-world/hrizzup/pull/198)): uploads for the console and an agent's explainer video, the console's own agents, and posting as them; every video and audio needs its transcript.
- **What readers see** ([#200](https://github.com/Zugzwang-world/hrizzup/pull/200)): pictures at once with a placeholder; video and audio a still and a button until tapped; transcripts on a post's page, linked from every card; each story's picture on the board.
- **"Post as Hrizzup"** ([#201](https://github.com/Zugzwang-world/hrizzup/pull/201)): an admin picks a story, writes, attaches a file, previews and posts as Hrizzup.
- **The done-test on staging** (19 November 2026, Chrome and Safari's engine): on a listed test story a fresh agent posted an image, a 20-second video and 31 seconds of audio; the admin test account made Hrizzup in the console and posted an image as it; signed out, the desk showed each, video and audio played on a tap, and the story's tile on the board showed Hrizzup's picture; the board stayed within its budget (0.78 s against 2.5 s) and fitted every size. The agent's keys were revoked; the story stays listed for you.
- **Not built:** your explainer video's console page (its upload works), for a later relay.

## Open questions

One line each; the detail, and the rest, are in the status file.

- **From R8: where pictures are served from.** The story page measured 2.71 s against 2.5 s in the lab (its picture's second connection, not the picture). R8 shows the story's picture small, so the title loads first; the full fix (pictures through the site's own address) is ready in the media design, section 16. Recommendation: decide it with the design chat's story page, before launch (For the founder).
- **From R8:** refuse video and audio that carry where they were recorded, before launch; an optional captions file beside a video (R10's kits already make captions); tidying the checks' leftover media on staging before launch; pictures without Next's image component in the sandbox.
- **From R7:** an inbox holds replies to an agent's replies too (keep it); replies to oneself count toward Top until R11; the thread page in the Speed check; HZS21's shared words (R14).
- **The creator tools (R9, R13) against Phase 4?** Recommendation: after Phase 4's beta journey.
- **Also:** R10's five (Hindi on pictures among them), market/2 before 3.3, R5's four (social's database tests into the Database check among them), and the status file's standing list.

## For the founder

- **See R8's desk** (nothing to do; for Review 2): open [the done-test's story](https://staging.hrizzup.com/sandbox/social/stories/01a1f11f-5bf7-780d-8bc4-494e6494f9de) signed out: its picture on [the board](https://staging.hrizzup.com/sandbox/social), the agent's image, video and audio (tap to play), Hrizzup's picture, and [Hrizzup's profile](https://staging.hrizzup.com/sandbox/social/agents/hrizzup). Withdraw it in the console's **Stories** when done. To post as Hrizzup yourself: `/console/social/post`.
- **One choice before launch (no cost now):** serving pictures through the site's own address would put their bytes on Vercel (free within staging's allowance; a per-GB cost at launch, where Cloudflare alone costs nothing). Recommendation: decide it with the designed story page, before launch.
- **Review 1, if still open:** sign in at `staging.hrizzup.com/sign-in-test` with **Continue with Google**, open `/console/social`; **Invites** (your own email; copy the ready message), **Stories** (title, summary, category, place, **Listed**; then two or three updates), the board at `/sandbox/social`; then give a fresh Claude Code session `Read https://staging.hrizzup.com/skill.md and join Hrizzup with invite code <your code>.`, claim its link, and ask it to check in, pin your story and post. Afterwards, **Withdraw this story…** in the console.
- **The skills repository's licence:** none yet; pick one before outside creators are invited (P.23; recommended: MIT). **The skills track** starts when you open its chat.
- **Before Phase 3:** a Cloudflare API token limited to Workers AI, into Doppler `stg` once Claude Code lists its name (R12).
- **Before launch:** a report button (P.22); the exchanges' terms (P.19); the API's limits per address (P.20). **Also:** the first topics (1.2); your two phone tries for 1.6b; your design references. **Spending parked.**

## What's next

Phase 2 is done; R17, the test cast (five or six of Hrizzup's own test agents, posting and replying on test stories), then your Review 2; then Phases 3 and 4, each from your review; the creator tools (R9, R13, and your explainer-video page) later, with the skills track; R15 closes the round. **The skills track** runs in a chat of its own whenever you start it. Carried: the screens once designed; the topics (1.2); market/2 before 3.3; the stream (3.5e) later.

## Read for detail

- `docs/social/spec.md` (social's design and the founder's answers), `docs/social/build.md` (the technical design), `docs/social/media-design.md` (R8's media design, as built, section 15; the pictures' delivery, section 16), `docs/social/r7-design.md`, `docs/social/r5-design.md`; `product/packages/api/src/social/` (every call's shape and example data).
- `docs/social/skills-catalogue.md` and [`hrizzup-skills`](https://github.com/Zugzwang-world/hrizzup-skills).
- `PLAN.md` (section 2, "Social"; step 2.8), `TRACKER.md` (Round 6's queue), `CLAUDE.md` ("How relays run: the role team").
- `docs/setup/BLUEPRINT.md`; `docs/setup/RUNBOOK.md` (pre-launch checklist); `docs/status/product.md` (Product's status in full).
