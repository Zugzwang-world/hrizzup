"""The relays' role team stays as the founder set it: offline, reading the files only.

    python3 -m unittest discover -s .github/scripts

Every relay runs as a coordinator with four roles defined in `.claude/agents/` (the founder,
17 November 2026; CLAUDE.md, "How relays run: the role team"). Claude Code skips a field it
doesn't know, and drops a tool a background subagent can't use, without saying so, so a typo
would quietly change a role. This check keeps every role file readable and keeps what the
founder decided:

  - each file starts with a frontmatter block, one `key: value` per line, each value a plain
    YAML text (quoted when it holds `: ` or ` #`), naming the role (its file's name), a
    description, its model by full ID (never an alias such as `opus`, which moves with
    releases), its effort and its tools, each one a background subagent keeps;
  - the team is exactly the scout, the expert, the builder and the reviewer, each with the
    founder's model and effort; the scout can't write or run a shell, the reviewer can't
    write, and neither names an MCP server's tool, which no list can prove read-only; no role
    gets a worktree of its own (`isolation`, or the worktree tools), since a new worktree starts
    from `main` without the relay's work;
  - `.claude/settings.json` keeps the advisor (Fable 5.2, by full ID) and fork mode off, so a
    call to a role starts it fresh, never as a copy of the coordinator's conversation; leaves
    background tasks on, since the check watcher needs them; and sets nothing that overrides
    the roles' models or effort;
  - `.gitignore` keeps the sessions' worktrees out of the repository.

Python's standard library only.
"""
import json
import os
import re
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AGENTS = os.path.join(ROOT, ".claude", "agents")
SETTINGS = os.path.join(ROOT, ".claude", "settings.json")
GITIGNORE = os.path.join(ROOT, ".gitignore")

# Claude Code's subagent fields (code.claude.com/docs/en/sub-agents, "Supported frontmatter fields").
FIELDS = {
    "name", "description", "tools", "disallowedTools", "model", "effort", "permissionMode",
    "maxTurns", "autoCompactWindow", "skills", "mcpServers", "hooks", "memory", "background",
    "omitClaudeMd", "isolation", "initialPrompt", "color", "experimental",
}
REQUIRED = ("name", "description", "model", "effort", "tools")
EFFORTS = {"low", "medium", "high", "xhigh", "max"}
FULL_MODEL_ID = re.compile(r"^claude-(?:fable|opus|sonnet|haiku)-\d+(?:-\d+)*$")
# The built-in tools a background subagent keeps (the same page, "Run subagents in the
# foreground or background"); any other built-in is dropped silently. MCP tools are kept too.
KEPT_TOOLS = {
    "Read", "Grep", "Glob", "LSP", "Bash", "PowerShell", "Edit", "Write", "NotebookEdit",
    "WebFetch", "WebSearch", "TodoWrite", "Skill", "ToolSearch", "EnterWorktree",
    "ExitWorktree", "Monitor", "TaskStop", "SendMessage", "Artifact", "SubagentHandback",
}
MCP_TOOL = re.compile(r"^mcp__[\w-]+__[\w-]+$")
WRITERS = {"Edit", "Write", "NotebookEdit"}
SHELLS = {"Bash", "PowerShell"}
OWN_WORKTREE = {"EnterWorktree", "ExitWorktree"}

# The founder's team (17 November 2026): each role's model, its effort, and the tools it never
# has; the READ_ONLY roles name no MCP server's tool either, since none can be proven read-only.
READ_ONLY = {"scout", "reviewer"}
TEAM = {
    "scout": ("claude-sonnet-5-5", "xhigh", WRITERS | SHELLS),
    "expert": ("claude-opus-5-5", "max", set()),
    "builder": ("claude-sonnet-5-5", "xhigh", set()),
    "reviewer": ("claude-opus-5-5", "xhigh", WRITERS),
}
ADVISOR = "claude-fable-5-2"
# Settings that would override what the role files say, or stop the coordinator waiting.
FORBIDDEN_ENV = {
    "CLAUDE_CODE_SUBAGENT_MODEL_FORCE": "it makes every role ignore its own model",
    "CLAUDE_CODE_SUBAGENT_MODEL": "it replaces the model of a role that doesn't name one",
    "CLAUDE_CODE_EFFORT_LEVEL": "it overrides every role's effort",
    "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS": "the check watcher needs background tasks",
}
WORKTREES = ".claude/worktrees/"


class Broken(ValueError):
    """A role file Claude Code wouldn't read as written, or one that would quietly lose a setting."""


def plain_text(value):
    """A frontmatter value as YAML reads it, or Broken if YAML would read it as something else."""
    if value[:1] in ('"', "'"):
        quote = value[0]
        inner = value[1:-1]
        if len(value) < 2 or value[-1] != quote or quote in inner or "\\" in inner:
            raise Broken(f"its quoted value {value!r} isn't closed cleanly")
        return inner
    if not value:
        raise Broken("a field has no value")
    if value[0] in "-?:,[]{}#&*!|>%@`" or ": " in value or " #" in value or value.endswith(":"):
        raise Broken(f"its value {value!r} isn't plain YAML text: quote it")
    return value


def frontmatter(text):
    """{field: value} from a role file: one `key: value` per line between two `---` lines."""
    lines = text.split("\n")
    if not lines or lines[0].rstrip() != "---":
        raise Broken("it doesn't start with a --- line")
    end = next((i for i in range(1, len(lines)) if lines[i].rstrip() == "---"), None)
    if end is None:
        raise Broken("its frontmatter never closes with a --- line")
    fields = {}
    for number, line in enumerate(lines[1:end], start=2):
        if not line.strip():
            continue
        match = re.match(r"^([A-Za-z]+):(?:[ \t]+(.*?))?[ \t]*$", line)
        if not match:
            raise Broken(f"line {number} isn't `key: value`: {line.strip()!r}")
        key, value = match.group(1), plain_text(match.group(2) or "")
        if key in fields:
            raise Broken(f"{key} is set twice")
        fields[key] = value
    if not "\n".join(lines[end + 1:]).strip():
        raise Broken("it has no instructions after the frontmatter")
    return fields


def tool_list(value):
    """The tools of a comma-separated list, each one a background subagent keeps."""
    names = [name.strip() for name in value.split(",")]
    if any(not name for name in names):
        raise Broken(f"its tool list {value!r} has an empty entry")
    if len(set(names)) != len(names):
        raise Broken(f"its tool list {value!r} names a tool twice")
    dropped = [name for name in names if name not in KEPT_TOOLS and not MCP_TOOL.match(name)]
    if dropped:
        raise Broken(f"Claude Code would drop {', '.join(dropped)}: not a tool a subagent keeps")
    return set(names)


def role(path):
    """The role a file defines, as {name, model, effort, tools}; Broken if anything's off."""
    with open(path, encoding="utf-8") as file:
        fields = frontmatter(file.read())
    unknown = sorted(set(fields) - FIELDS)
    if unknown:
        raise Broken(f"Claude Code would skip {', '.join(unknown)}: not a subagent field")
    missing = [field for field in REQUIRED if field not in fields]
    if missing:
        raise Broken(f"it doesn't name its {', '.join(missing)}")
    name = os.path.splitext(os.path.basename(path))[0]
    if fields["name"] != name:
        raise Broken(f"its name {fields['name']!r} isn't its file's name {name!r}")
    if not FULL_MODEL_ID.match(fields["model"]):
        raise Broken(f"its model {fields['model']!r} isn't pinned by full ID (such as claude-opus-5-5)")
    if fields["effort"] not in EFFORTS:
        raise Broken(f"its effort {fields['effort']!r} isn't one of {', '.join(sorted(EFFORTS))}")
    if "isolation" in fields:
        raise Broken("it runs in a worktree of its own, which starts from main without the relay's work")
    return {"name": name, "model": fields["model"], "effort": fields["effort"],
            "tools": tool_list(fields["tools"])}


def roles(folder=AGENTS):
    """Every role in the folder, {name: role}; Broken names the file that failed."""
    found = {}
    for entry in sorted(os.listdir(folder)):
        if entry.endswith(".md"):
            try:
                found[entry[:-3]] = role(os.path.join(folder, entry))
            except Broken as broken:
                raise Broken(f".claude/agents/{entry}: {broken}") from None
    return found


def team_problems(found):
    """What differs from the founder's team, one line each."""
    problems = []
    if set(found) != set(TEAM):
        problems.append(f"the roles are {sorted(found)}, not {sorted(TEAM)}")
    for name, (model, effort, never) in TEAM.items():
        if name not in found:
            continue
        have = found[name]
        if have["model"] != model:
            problems.append(f"{name} runs on {have['model']}, not {model}")
        if have["effort"] != effort:
            problems.append(f"{name} runs at effort {have['effort']}, not {effort}")
        barred = sorted(have["tools"] & (never | OWN_WORKTREE))
        if barred:
            problems.append(f"{name} has {', '.join(barred)}, which it must never have")
        mcp = sorted(tool for tool in have["tools"] if MCP_TOOL.match(tool))
        if name in READ_ONLY and mcp:
            problems.append(f"{name} has {', '.join(mcp)}: an MCP tool may write or run commands")
    return problems


def settings_problems(settings):
    """What in .claude/settings.json differs from the founder's set-up, one line each."""
    problems = []
    if settings.get("advisorModel") != ADVISOR:
        problems.append(f"the advisor is {settings.get('advisorModel')!r}, not {ADVISOR!r}")
    env = settings.get("env") or {}
    if env.get("CLAUDE_CODE_FORK_SUBAGENT") != "0":
        problems.append("fork mode isn't off (env CLAUDE_CODE_FORK_SUBAGENT must be \"0\")")
    for name, why in FORBIDDEN_ENV.items():
        if name in env:
            problems.append(f"env sets {name}: {why}")
    return problems


def gitignore_problems(text):
    lines = {line.strip() for line in text.splitlines()}
    return [] if WORKTREES in lines else [f".gitignore doesn't list {WORKTREES}"]


class TheTeam(unittest.TestCase):
    """The repository's own files."""

    def test_every_role_file_reads(self):
        self.assertTrue(roles(), "no role files in .claude/agents/")

    def test_the_team_is_the_founders(self):
        self.assertEqual(team_problems(roles()), [])

    def test_the_settings_keep_the_advisor_and_fork_mode_off(self):
        with open(SETTINGS, encoding="utf-8") as file:
            self.assertEqual(settings_problems(json.load(file)), [])

    def test_worktrees_stay_out_of_the_repository(self):
        with open(GITIGNORE, encoding="utf-8") as file:
            self.assertEqual(gitignore_problems(file.read()), [])


GOOD = {
    "name": "scout",
    "description": "Read-only mapper, called by name.",
    "model": "claude-sonnet-5-5",
    "effort": "xhigh",
    "tools": "Read, Grep, Glob, WebFetch, WebSearch",
}


def role_file(fields=GOOD, body="You are the scout.\n", name="scout", raw=None):
    """A role file's text from fields (or raw frontmatter lines), written to a new folder."""
    folder = tempfile.mkdtemp()
    lines = raw if raw is not None else [f"{key}: {value}" for key, value in fields.items()]
    text = "---\n" + "\n".join(lines) + "\n---\n\n" + body
    path = os.path.join(folder, f"{name}.md")
    with open(path, "w", encoding="utf-8") as file:
        file.write(text)
    return path


class TheCheckItself(unittest.TestCase):
    """The check fails on a broken role file, a changed team and changed settings."""

    def broken(self, path):
        with self.assertRaises(Broken):
            role(path)

    def test_a_good_file_reads(self):
        self.assertEqual(role(role_file())["tools"], {"Read", "Grep", "Glob", "WebFetch", "WebSearch"})

    def test_quoted_values_read(self):
        quoted = dict(GOOD, description='"Maps one area: files, readers and rules."')
        self.assertEqual(role(role_file(quoted))["name"], "scout")

    def test_no_frontmatter(self):
        path = role_file()
        with open(path, "w", encoding="utf-8") as file:
            file.write("You are the scout.\n")
        self.broken(path)

    def test_frontmatter_never_closes(self):
        path = role_file()
        with open(path, "w", encoding="utf-8") as file:
            file.write("---\nname: scout\nmodel: claude-sonnet-5-5\n\nYou are the scout.\n")
        self.broken(path)

    def test_no_instructions(self):
        self.broken(role_file(body=""))

    def test_a_line_that_isnt_key_value(self):
        lines = [f"{key}: {value}" for key, value in GOOD.items() if key != "tools"]
        self.broken(role_file(raw=lines + ["tools:", "  - Read"]))

    def test_a_value_yaml_would_misread(self):
        self.broken(role_file(dict(GOOD, description="Maps one area: files and readers.")))
        self.broken(role_file(dict(GOOD, description="Maps one area # and more")))
        self.broken(role_file(dict(GOOD, description='"Maps one area')))

    def test_each_required_field_missing(self):
        for field in REQUIRED:
            with self.subTest(field=field):
                self.broken(role_file({k: v for k, v in GOOD.items() if k != field}))

    def test_a_field_set_twice(self):
        lines = [f"{key}: {value}" for key, value in GOOD.items()]
        self.broken(role_file(raw=lines + ["effort: max"]))

    def test_a_misspelt_field(self):
        fields = {("modle" if k == "model" else k): v for k, v in GOOD.items()}
        self.broken(role_file(fields))

    def test_a_name_that_isnt_the_files(self):
        self.broken(role_file(dict(GOOD, name="scouts")))

    def test_a_model_alias_or_a_typo(self):
        for model in ("sonnet", "opus", "inherit", "claude-sonet-5-5", "claude-sonnet"):
            with self.subTest(model=model):
                self.broken(role_file(dict(GOOD, model=model)))

    def test_an_effort_that_isnt_a_level(self):
        for effort in ("extreme", "XHIGH", "auto"):
            with self.subTest(effort=effort):
                self.broken(role_file(dict(GOOD, effort=effort)))

    def test_a_tool_list_claude_code_would_cut(self):
        for tools in ("Read, Reed", "Read,, Grep", "Read, Read", "Read, Agent", "Read, mcp__x"):
            with self.subTest(tools=tools):
                self.broken(role_file(dict(GOOD, tools=tools)))

    def test_a_tool_from_an_mcp_server_reads(self):
        self.assertIn("mcp__context7__query-docs",
                      role(role_file(dict(GOOD, tools="Read, mcp__context7__query-docs")))["tools"])

    def test_a_worktree_of_its_own(self):
        self.broken(role_file(dict(GOOD, isolation="worktree")))

    def test_roles_names_the_broken_file(self):
        folder = os.path.dirname(role_file(dict(GOOD, effort="extreme")))
        with self.assertRaisesRegex(Broken, r"\.claude/agents/scout\.md"):
            roles(folder)

    def team(self, **changes):
        found = {name: {"name": name, "model": model, "effort": effort, "tools": {"Read"}}
                 for name, (model, effort, _) in TEAM.items()}
        for name, change in changes.items():
            if change is None:
                del found[name]
            else:
                found[name] = dict(found[name], **change)
        return team_problems(found)

    def test_the_founders_team_passes(self):
        self.assertEqual(self.team(), [])

    def test_a_changed_team_fails(self):
        cases = {
            "a role missing": {"reviewer": None},
            "a model changed": {"builder": {"model": "claude-opus-5-5"}},
            "an effort changed": {"expert": {"effort": "xhigh"}},
            "a scout that writes": {"scout": {"tools": {"Read", "Edit"}}},
            "a scout with a shell": {"scout": {"tools": {"Read", "Bash"}}},
            "a reviewer that writes": {"reviewer": {"tools": {"Read", "Bash", "Write"}}},
            "a scout with an MCP tool": {"scout": {"tools": {"Read", "mcp__terminal__run_in_terminal"}}},
            "a reviewer with an MCP tool": {"reviewer": {"tools": {"Read", "mcp__github__push_files"}}},
            "a builder with its own worktree": {"builder": {"tools": {"Read", "EnterWorktree"}}},
        }
        for case, changes in cases.items():
            with self.subTest(case=case):
                self.assertNotEqual(self.team(**changes), [])
        extra = {name: {"name": name, "model": m, "effort": e, "tools": {"Read"}}
                 for name, (m, e, _) in TEAM.items()}
        extra["planner"] = dict(extra["scout"], name="planner")
        self.assertNotEqual(team_problems(extra), [])

    def test_changed_settings_fail(self):
        good = {"advisorModel": ADVISOR, "env": {"CLAUDE_CODE_FORK_SUBAGENT": "0"}}
        self.assertEqual(settings_problems(good), [])
        cases = {
            "no advisor": {"env": good["env"]},
            "an advisor alias": dict(good, advisorModel="fable"),
            "fork mode on": dict(good, env={}),
            "fork mode on, said another way": dict(good, env={"CLAUDE_CODE_FORK_SUBAGENT": "1"}),
        }
        for name in FORBIDDEN_ENV:
            cases[name] = dict(good, env=dict(good["env"], **{name: "1"}))
        for case, settings in cases.items():
            with self.subTest(case=case):
                self.assertNotEqual(settings_problems(settings), [])

    def test_a_gitignore_without_the_worktrees_fails(self):
        self.assertEqual(gitignore_problems(".env\n.claude/worktrees/\n"), [])
        self.assertNotEqual(gitignore_problems(".env\n.claude/settings.local.json\n"), [])


if __name__ == "__main__":
    unittest.main()
