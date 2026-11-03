"""Opens a GitHub issue for every reminder in .github/reminders.json whose date has arrived.

Runs daily from .github/workflows/reminders.yml. A reminder is opened once: if an issue
(open or closed) already has its exact title, it is skipped. Needs the GitHub CLI and
GH_TOKEN. Reminders never contain secrets.
"""
import datetime
import json
import pathlib
import subprocess
import sys
import tempfile

reminders = json.loads(pathlib.Path(".github/reminders.json").read_text())
today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30))).date()  # India time
existing = set(json.loads(subprocess.run(
    ["gh", "issue", "list", "--state", "all", "--limit", "1000", "--json", "title", "-q", "[.[].title]"],
    check=True, capture_output=True, text=True).stdout))

failed = False
for r in reminders:
    due = datetime.date.fromisoformat(r["due"])
    if due > today:
        print(f"not yet due ({due}): {r['title']}")
        continue
    if r["title"] in existing:
        print(f"already opened: {r['title']}")
        continue
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(r["body"] + f"\n\n_Opened automatically on {today} by the Reminders workflow (due {due})._\n")
    res = subprocess.run(["gh", "issue", "create", "--title", r["title"], "--body-file", f.name], capture_output=True, text=True)
    print(res.stdout.strip() or res.stderr.strip())
    failed |= res.returncode != 0
sys.exit(1 if failed else 0)
