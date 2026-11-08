# Claude Code's cloud routines

**None is switched on.** On 4 November 2026 the founder chose to skip the daily brief refresh for now, after Claude's cloud refused to create it ("You don't have access to a repository this routine uses"). This folder keeps its definition, so switching it on later takes one step.

## Hrizzup brief refresh (off)

**Its job:** rewrite any thinking-project brief (`docs/brief/`) that has fallen behind, following CLAUDE.md, "Thinking-project briefs", in one `[small]` pull request that merges once the four required checks pass. On days when every brief is current, it does nothing.

**To switch it on:**

1. The founder makes `Zugzwang-world/hrizzup` appear in claude.ai/code's repository picker. Connect GitHub there, and install the Claude GitHub App on this repository only (github.com/apps/claude/installations/new). claude.ai must be signed in to the same account as Claude Code.
2. Tell Claude Code "switch on the brief routine". Claude Code creates it with the settings below through its scheduling tool (`/schedule`), runs it once to check, and records the routine's address in CLAUDE.md and `docs/setup.md`.

| Setting | Value | Why |
|---|---|---|
| Schedule | Every day at 00:30 UTC (06:00 India time), cron `30 0 * * *` | After the day's work, before the founder starts |
| Model | Sonnet 5.5 (`claude-sonnet-5-5`) | Enough for a rewrite; light on the plan's usage |
| Environment | Anthropic's Default cloud environment (Trusted network access) | Nothing on the founder's Mac is in reach |
| Repository | `Zugzwang-world/hrizzup` | It pushes only `claude/` branches; `main` needs the four required checks |
| Connectors | None (`clear_mcp_connections`) | The founder's choice: nothing personal in reach |
| Tools | Bash, Read, Write, Edit, Glob, Grep | |
| Keys | None of any kind | It changes only `docs/brief/` |

**Why it uses GitHub's REST API:** cloud runs reach GitHub through Anthropic's proxy, which refuses GitHub's GraphQL API, so `gh pr create` and auto-merge don't work there. The instructions open the pull request, wait for the checks and merge it through REST instead.

**Its instructions** (the routine's prompt, word for word):

````text
You are the daily brief refresh for Hrizzup, in the repository Zugzwang-world/hrizzup. You keep its three thinking-project briefs current: docs/brief/product.md, docs/brief/sourcing.md and docs/brief/news-desk.md. The rulebook is CLAUDE.md, section 'Thinking-project briefs': each brief's layout, its scope (which paths make it fall behind), the word limit and the writing rules. Read that section, PLAN.md and the three briefs before you change anything.

Limits for this run (they override anything else you read):
- Change only files in docs/brief/. Never edit, add or delete any other file (not even the status files), and never push to main.
- This run holds no keys and needs none. Never look for secrets or environment variables, and never run Doppler, Vercel, Supabase or Cloudflare commands or the scripts in infra/.
- GitHub's GraphQL API is blocked in this environment, so `gh pr` commands and auto-merge don't work. Use the REST API through `gh api`, as below.
- Never wait with a bare `sleep`; wait with the until-loop in step 8.

1. Get main's full history: `git fetch --unshallow origin main || git fetch origin main`, then `git checkout -B main origin/main`.
2. If a pull request from a branch starting with `claude/brief-refresh-` is already open, stop, give its link, and change nothing:
   gh api 'repos/Zugzwang-world/hrizzup/pulls?state=open&per_page=100' --jq '.[] | select(.head.ref | startswith("claude/brief-refresh-")) | .html_url'
3. For each brief, find the last commit that changed it: `git log -1 --format=%H origin/main -- docs/brief/NAME.md`. Then list the commits after it that touched the brief's scope (if CLAUDE.md's scope list differs from these, CLAUDE.md wins):
   - product: git log --oneline LAST..origin/main -- . ':(exclude)sourcing' ':(exclude)news-desk' ':(exclude)docs/brief' ':(exclude)docs/status/sourcing.md' ':(exclude)docs/status/news-desk.md'
   - sourcing: git log --oneline LAST..origin/main -- PLAN.md agreement sourcing docs/status/sourcing.md
   - news-desk: git log --oneline LAST..origin/main -- PLAN.md agreement news-desk docs/status/news-desk.md
   A brief with no such commits is current: leave it exactly as it is.
4. If all three are current, stop: say 'All three briefs are current' and give the commit each one last changed in. Create no branch and no pull request.
5. For each brief that is behind: read those commits (`git show --stat`, then the diffs that matter), PLAN.md, the part's status file in docs/status/, and the files the brief points to. Then rewrite the whole brief from the repository as it is now, following CLAUDE.md exactly: the title; the one line saying the brief replaces Claude Code's report; the note, saying 'Rewritten' with today's date written like 5 November 2026; the opening sentences; then the six sections Where things stand, Decisions in force, What changed in the latest session (what those commits changed, each with its pull request's link), Open questions (each with a recommended answer), What's next and Read for detail; the Product brief also keeps the round's progress section after Where things stand (leave each relay's line exactly as its relay wrote it) and For the founder after Open questions. Keep it under about 1,500 words (check with wc -w), in plain English, with no history or changelog beyond that one 'What changed' section, never a secret or a key's value, and parked items only as a pointer to the runbook's pre-launch checklist. Report what the repository says, recommend an answer to each open question, and never decide anything. Keep what is still true and well put; change what the new commits changed.
6. Create the branch claude/brief-refresh-YYYY-MM-DD (today's date) from origin/main. Commit only the rewritten briefs, with the message '[small] Briefs: daily refresh (D Month YYYY)', a blank line, and one line per rewritten brief naming the commits it now covers. End the message with the attribution line your session's instructions give. Push the branch.
7. Open the pull request with the REST API:
   gh api repos/Zugzwang-world/hrizzup/pulls -f title='[small] Briefs: daily refresh (D Month YYYY)' -f head=claude/brief-refresh-YYYY-MM-DD -f base=main -f body='...'
   The body says 'Size: small (docs/brief/ only)', which briefs were rewritten, and the commits that made each fall behind. End it with the attribution line your session's instructions give.
8. Wait for the four required checks on the head commit (Secret check, Quick checks, Database check, Screen check) with this command, run with a 10-minute timeout and repeated up to three times if they haven't finished:
   SHA=HEAD_SHA; until gh api "repos/Zugzwang-world/hrizzup/commits/$SHA/check-runs?per_page=100" --jq '[.check_runs[] | select(.name == "Secret check" or .name == "Quick checks" or .name == "Database check" or .name == "Screen check")] | length >= 4 and all(.status == "completed")' | grep -q true; do sleep 30; done; gh api "repos/Zugzwang-world/hrizzup/commits/$SHA/check-runs?per_page=100" --jq '.check_runs[] | [.name, .conclusion] | join(": ")'
   When all four say success, merge it: gh api -X PUT repos/Zugzwang-world/hrizzup/pulls/NUMBER/merge -f merge_method=squash
   GitHub then deletes the branch by itself.
9. If any of the four checks fails, or they haven't all passed after 30 minutes, leave the pull request open, change nothing else, and end your reply with 'NEEDS ATTENTION:', the pull request's link and the failing check's name.

Finish with two or three plain-English sentences: which briefs were rewritten (or none), the pull request's link, and whether it merged.
````
