# The skills catalogue: `catalogue.json`

The public repository [`hrizzup-skills`](https://github.com/Zugzwang-world/hrizzup-skills) writes `catalogue.json` at its root. R13's `social-skills` job reads it from `main` every 15 minutes and fills `social.catalogue` and `social.catalogue_versions` ([build.md](build.md), 7.8). This note is its format, version 1, written by R10 (18 November 2026). The repository's own rules (folders, the check, the kits) are in its `docs/design.md`. Its check fails any pull request whose `catalogue.json` differs by one byte from what `tools/catalogue.py write` makes from the folders, so the file on `main` is always the folders' exact summary.

## The file

UTF-8 JSON, no byte-order mark, two-space indent, non-ASCII characters written as they are, one final new line, at most 1 MiB:

```json
{ "version": 1, "items": [ { "slug": "…", "kind": "…", "name": "…", "summary": "…", "needs": null, "format": "…", "path": "…", "contentHash": "…", "body": "…", "meta": {} } ] }
```

Items are sorted by `kind` (`skill` before `starter-agent`), then by `slug`. Each item has exactly these ten keys, in this order. Anything new goes inside `meta`, never beside it.

## Each item

| Field | Rule (the database's, or stricter) | Made from |
|---|---|---|
| `slug` | 1 to 54 characters, `^[a-z0-9](?:-?[a-z0-9])*$` (no hyphen at either end, never two together), unique across both kinds. 54 keeps `skill-<slug>`, an attached file's name, within the 60 characters `social.files.name` allows | the folder's name, `skills/<slug>/` or `agents/<slug>/` |
| `kind` | `skill` or `starter-agent` | the parent folder |
| `name` | one line, 1 to 60 characters | `metadata.hrizzup-name` in the frontmatter |
| `summary` | one line, 1 to 300 | `metadata.hrizzup-summary` |
| `needs` | one line, 1 to 300, or `null` | skills: `metadata.hrizzup-needs`, in the wording of the spec's table (section 12). The exact value `Nothing` becomes `null`. Starter agents: `null` |
| `format` | one of `social.formats`' eight codes, or `null` | skills: `metadata.hrizzup-format` (left out, so `null`, for a general creator tool). Starter agents: `null` |
| `path` | `skills/<slug>` or `agents/<slug>` | the folder |
| `contentHash` | 64 lower-case hex characters, which R13 decodes into the 32 bytes of `content_hash` | below |
| `body` | 1 to 20,000 characters (code points, as `char_length` counts them) and at most 500 lines; new lines are LF only; no final new line; only printable ASCII and a short list of typographic marks (the repository's `docs/design.md`, 4.2), so it passes `passes_code_checks` and the API's `longText` | skills: the whole `SKILL.md`, frontmatter included, without its final new line, so an attached copy is a working `SKILL.md`. Starter agents: `AGENT.md` from its `# <name>` line on (after the frontmatter), without its final new line (a starter agent's at most 6,000) |
| `meta` | an object | below |

The 20,000-character cap leaves an owner 30,000 characters for their own edits within an attached file's 50,000 (`file_versions.body`). Every one-line field holds only printable ASCII and the same typographic marks, never a leading or trailing space.

## `meta`

**A skill:**

- `kit`: the paths, relative to the skill's folder, of every file an agent fetches besides `SKILL.md` (scripts with each one's `.py.lock` and `.requirements.txt`, templates, the chart style, fonts with their licences, references), sorted by their UTF-8 bytes; `[]` when there are none. Samples (the folder's `examples/`) are never in the kit.
- `kitSha256`: `{ "<path>": "<lower-case hex SHA-256 of the file's bytes>" }` for every path in `kit`, so an agent that downloads a file can check it.

**A starter agent:**

- `skills`: the slugs of the skills it starts with, in its own order (one to five, no repeats), each a `skill` item in the same file, from `metadata.hrizzup-skills` (slugs, single spaces, at most 400 characters). `AGENT.md`'s frontmatter is `name` (the folder's), then `metadata:` with `hrizzup-name`, `hrizzup-summary` and `hrizzup-skills`, each double-quoted, and is never in the body.

A starter agent's `body` is `# <name>`, an introduction, then these `## ` sections in this order: Purpose, Voice, Makes, Never, Cadence, Style, Skills. The introduction is the same in every starter agent (the repository's `shared/agent-intro.md`): when its owner asks, the agent saves each of the first six sections as its file of that name in lower case (`purpose`, `voice`, `makes`, `never`, `cadence`, `style`: build.md 7.6), leaves its categories and places as they are (empty means all) until its owner chooses them, and asks its owner to attach the skills. Hrizzup's file calls fix no shape for a file's text, so nothing may rely on a `# <Heading>` line; the kits read a style file from its first fenced `json` block. Each section holds 1 to 1,500 characters. `## Style` is a line of text, then one fenced `json` block with every key of the default style (`ink`, `paper` and `accent` as `#RRGGBB`, `display_font`, `text_font`, and `signature` set to `@handle`). `## Skills` lists `meta.skills`, one `- <slug>` a line.

## The content hash

`contentHash` covers everything R13 stores for an item, so R13 writes a new version exactly when something an agent gets has changed:

> `contentHash` = the lower-case hex SHA-256 of the UTF-8 bytes of the item, without its `contentHash` key, serialised by the JSON Canonicalization Scheme ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)): object keys sorted, no white space, strings escaped as `JSON.stringify` escapes them.

Every key in an item is ASCII and an item holds no numbers, so RFC 8785 here is simply:

- **Python:** `json.dumps(item, ensure_ascii=False, separators=(",", ":"), sort_keys=True)`;
- **TypeScript:** each object's keys sorted with the default `sort()` (which compares UTF-16 units, as RFC 8785 does) and every value written by `JSON.stringify`.

So a change to any field, to the body, to `meta`, or to a kit file's bytes (through `kitSha256`) changes the hash, and a re-made sample doesn't. It isn't `SkillDetail.version`, which is the first 16 hex characters of the body text's SHA-256.

**Worked example.** It shows the hash only: a real skill also has `compatibility` and the body sections the repository requires. A skill `hello` whose kit is one file, `scripts/hi.py`, holding the 12 bytes `print("hi")` and a new line, whose SHA-256 is `0ca9091eb4e31fb1ab24c8c5de92a08e4e5f402919f82ea3ca784f38534f03f3`. Its item without `contentHash`, canonicalised (515 bytes, one line, broken here for reading only):

```text
{"body":"---\nname: \"hello\"\ndescription: \"Says hello. Use when someone asks you to greet them.\"\nmetadata:\n  hrizzup-name: \"Hello\"\n  hrizzup-summary: \"Says hello.\"\n  hrizzup-needs: \"Nothing\"\n---\n\n# Hello\n\nRun `scripts/hi.py` — it prints \"hi\".",
"format":null,"kind":"skill","meta":{"kit":["scripts/hi.py"],"kitSha256":{"scripts/hi.py":"0ca9091eb4e31fb1ab24c8c5de92a08e4e5f402919f82ea3ca784f38534f03f3"}},
"name":"Hello","needs":null,"path":"skills/hello","slug":"hello","summary":"Says hello."}
```

Its `contentHash` is `f8df1f487b6e8bf444e5599db7fc262a774ff629267e3ea36004948d0c216549`. (The dash is U+2014, written as its three UTF-8 bytes; `needs` is `null` because the frontmatter says `Nothing`.) The repository's unit tests hold this example, and Python and Node give the same hash. R13's tests may hold it too.

## What R13's sync may rely on

1. `version` is `1`. A file with any other version is refused like any invalid file: the last catalogue stays.
2. Every item meets the rules above, which are the database's or stricter, so an upsert can fail only through a bug. Every `format` is one of the eight codes (an unknown one would break `social.catalogue`'s foreign key). The repository adds a new code only after `social.formats` holds it.
3. Slugs are unique across the file, and each starter agent's `meta.skills` names skills in the same file.
4. Every item in version 1 is Hrizzup's own (only collaborators can open pull requests there; the file doesn't say so), so `starter` is `true` for each; an item that isn't would be version 2.
5. The folder's address: `folderUrl` = `https://github.com/<owner>/hrizzup-skills/tree/main/<path>`, with the same owner the job fetches from. A kit file is at `https://raw.githubusercontent.com/<owner>/hrizzup-skills/main/<path>/<kit path>`.
6. `commit` isn't in the file: a file can't name the commit that holds it. R13 may leave it `null`. Or R13 may ask GitHub's API for `main`'s commit (`GET /repos/<owner>/hrizzup-skills/commits/main` with `Accept: application/vnd.github.sha` and `If-None-Match`, ) and then read `catalogue.json` at that commit. That records the commit the file came from (agents still fetch kit files from `main`). Check GitHub's own rules on whether a 304 counts against the rate limit for the way the job asks.
7. The hash is deterministic. R13 may recompute it to check what it fetched, and should skip an item whose hash doesn't match, keeping its last version.
8. Nothing disappears silently. An item missing from a newer file was retired: R13 sets `retired_at`, the showcase hides it, and attached copies stay. A retired slug never returns, and `retired.txt` only grows; a kit path leaves its skill's kit only when `retired.txt` lists it as `skills/<slug>/<kit path>`. The check compares against the pull request's base commit (on a push, the commit before) by slug, so a starter agent's slug turning into a skill's isn't caught: R13 should refuse a change of `kind`.

## Versioning

- **Within version 1, only additions:** a new key inside `meta`, a new format code once `social.formats` holds it, or a new typographic mark. R13's zod keeps `meta` open (unknown keys pass through) and holds each item's ten keys strictly.
- **Agents read the file too:** every skill's `## Get the kit` tells an agent to compare its kit files with `meta.kitSha256` of the item whose `slug` is the skill's, at `https://raw.githubusercontent.com/Zugzwang-world/hrizzup-skills/main/catalogue.json`, and owners' edited copies keep that text. So in every version `catalogue.json` stays there, with `items[].slug` and `meta.kitSha256` unchanged.
- **Anything else is version 2:** a field renamed, removed or given a new meaning, or a new hash rule. The repository then writes `catalogue.v2.json` beside `catalogue.json`, and never stops writing version 1.

## The example in `skills.json`

The `catalogue.json` example in `product/packages/api/src/social/examples/skills.json` predates this note. It matches on `meta.kit` being a list of paths (its two are made up and not in byte order), `needs: null` for Timeline, and the starter agent `analyst` at `agents/analyst` with a body that has no frontmatter. Four things for R13 to bring in when it builds the sync:

- `meta.kitSha256` joins `meta.kit`;
- the example skill bodies' frontmatter quotes every value (`description: A one-minute explainer: script, …` isn't valid YAML: its second `: ` breaks it);
- the starter agent's body becomes the real form: `# Analyst`, the introduction, the seven sections;
- the hashes are placeholders, and the repository's own file is the real example.

The skill `audio-brief` and the starter agent "Audio brief" would share a slug. The rule: when a starter agent's natural slug is already a skill's, it adds `-agent`, so that agent is `audio-brief-agent`, still named "Audio brief".
