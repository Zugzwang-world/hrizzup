#!/usr/bin/env python3
"""The database-order check (PLAN.md step 1.8; CLAUDE.md, "Database changes").

Staging and production apply migrations in timestamp order, and `supabase db push` refuses
one older than the newest they have already applied. So a pull request may only add
migrations that come after the newest one on main. The Database check runs this on every
pull request, against main as it is at that moment:

    python3 infra/supabase/migration_order.py --main origin/main --head <the pull request's commit>

It fails, saying what to rename, when the pull request:
  - adds a migration whose timestamp isn't later than the newest one on main;
  - renames, changes or deletes a migration that's already on main;
  - adds a file to migrations/ not named `<UTC timestamp, 14 digits>_<name>.sql` (lower-case
    letters, digits and `_`), gives two migrations the same timestamp, or dates one more than
    a day ahead (so no migration can claim the future and keep everyone else's out);
  - leaves newest-migration.txt naming anything but its own newest migration.

**When main moves after the checks have passed:** newest-migration.txt holds one line, the
newest migration's name, and every pull request that adds a migration changes that line.
Once one of them merges, every other one changes the same line differently, so GitHub sees a
conflict and won't merge it, however green its checks were, until it's rebased on main; then
this check runs again, against main's new newest migration. Pull requests without migrations
never touch the line, so they never wait. (The same idea as the schema version line in Rails'
schema.rb, or Atlas's atlas.sum.)

Python's standard library and git only.
"""
from __future__ import annotations

import argparse
import datetime
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MIGRATIONS = "infra/supabase/migrations"
NEWEST_FILE = "infra/supabase/newest-migration.txt"
NAME = re.compile(r"^(\d{14})_[a-z0-9_]+\.sql$")
AHEAD = datetime.timedelta(days=1)  # a timestamp may run ahead of the clock by at most this


def timestamp(name: str):
    """The 14-digit UTC timestamp a migration's name starts with, or None."""
    match = NAME.match(name)
    if not match:
        return None
    try:
        datetime.datetime.strptime(match.group(1), "%Y%m%d%H%M%S")
    except ValueError:
        return None
    return match.group(1)


def newest(names) -> str | None:
    dated = sorted((timestamp(n), n) for n in names if timestamp(n))
    return dated[-1][1] if dated else None


def stamp(when: datetime.datetime) -> str:
    return when.strftime("%Y%m%d%H%M%S")


def suggested(name: str, after: str, now: datetime.datetime) -> str:
    """A name for the migration that comes after `after`: now, or a minute after it."""
    floor = datetime.datetime.strptime(after, "%Y%m%d%H%M%S") + datetime.timedelta(minutes=1)
    when = max(now.replace(tzinfo=None, microsecond=0), floor)
    rest = name.split("_", 1)[1] if "_" in name else name
    return f"{stamp(when)}_{rest}"


def lock_line(text: str) -> str:
    """newest-migration.txt's lock: its last line that isn't empty or a comment."""
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line and not line.startswith("#")]
    return lines[-1] if lines else ""


def problems(*, main: list, head: list, added: list, touched: list, lock: str,
             lock_changed: bool = False, now: datetime.datetime) -> list:
    """Everything wrong with a pull request's migrations, each with what to do about it.

    main: the migration files on main now; head: those on the pull request's commit;
    added: the ones the pull request adds; touched: migrations already on main that it
    renames, changes or deletes; lock: newest-migration.txt's line on the pull request;
    lock_changed: whether the pull request changes that file. A pull request that adds no
    migration and leaves the file alone isn't held to it.
    """
    found = []
    for name in sorted(touched):
        found.append(
            f"{name} is already on main, so staging and production may have applied it: never "
            "rename, change or delete it. Put the change in a new migration instead.")
    for name in sorted(added):
        if timestamp(name) is None:
            found.append(
                f"{name}: a migration's name is its UTC timestamp (14 digits, a real date and "
                "time), then `_` and lower-case letters, digits or `_`, ending .sql "
                "(`supabase migration new <name>` makes one).")
    stamps = {}
    for name in head:
        if timestamp(name):
            stamps.setdefault(timestamp(name), []).append(name)
    for ts, names in sorted(stamps.items()):
        if len(names) > 1 and set(names) & set(added):
            found.append(f"{', '.join(sorted(names))} share the timestamp {ts}: give each its own.")
    limit = stamp(now.replace(tzinfo=None) + AHEAD)
    for name in sorted(added):
        ts = timestamp(name)
        if ts and ts > limit:
            found.append(
                f"{name} is dated more than a day ahead ({ts}, it's {stamp(now)} UTC now): "
                "date it with the time it's written, in UTC.")
    main_newest = newest(main)
    if main_newest:
        for name in sorted(added):
            ts = timestamp(name)
            if ts and ts <= timestamp(main_newest):
                found.append(
                    f"{name} doesn't come after the newest migration on main, {main_newest}. "
                    f"Rebase on main and rename it to a later timestamp, for example "
                    f"{suggested(name, timestamp(main_newest), now)}, then put that name in "
                    f"{NEWEST_FILE}.")
    head_newest = newest(head)
    if (added or lock_changed) and head_newest and lock != head_newest:
        found.append(
            f"{NEWEST_FILE} says {lock or '(nothing)'}, but this pull request's newest migration is "
            f"{head_newest}: its last line must name it, so two pull requests that add migrations "
            "can't both merge without the second one coming after the first.")
    return found


# ---- Reading the two commits through git ----


def git(*args: str) -> str:
    out = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"FAILED: git {' '.join(args)}: {out.stderr.strip()}")
    return out.stdout


def files_at(ref: str) -> list:
    listing = git("ls-tree", "--name-only", f"{ref}:{MIGRATIONS}")
    return [line for line in listing.splitlines() if line]


def changes(base: str, head: str):
    """(added, touched): migrations the pull request adds, and those already at `base` that it
    renames (a rename counts as delete and add), changes or deletes."""
    added, touched = [], []
    out = git("diff", "--name-status", "--no-renames", base, head, "--", MIGRATIONS)
    for line in out.splitlines():
        status, _, path = line.partition("\t")
        name = os.path.basename(path)
        if status.startswith("A"):
            added.append(name)
        else:
            touched.append(name)
    return added, touched


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description="The database-order check (PLAN.md step 1.8).")
    parser.add_argument("--main", default="origin/main", help="main as it is now")
    parser.add_argument("--head", default="HEAD", help="the pull request's own commit")
    args = parser.parse_args(argv)
    base = git("merge-base", args.main, args.head).strip()
    added, touched = changes(base, args.head)
    try:
        lock = lock_line(git("show", f"{args.head}:{NEWEST_FILE}"))
    except SystemExit:
        lock = ""
    lock_changed = bool(git("diff", "--name-only", base, args.head, "--", NEWEST_FILE).strip())
    found = problems(main=files_at(args.main), head=files_at(args.head), added=added,
                     touched=touched, lock=lock, lock_changed=lock_changed,
                     now=datetime.datetime.now(datetime.timezone.utc))
    main_newest = newest(files_at(args.main))
    if found:
        print("The database-order check FAILED (CLAUDE.md, \"Database changes\"):")
        for problem in found:
            print(f"  - {problem}")
        return 1
    if added:
        print(f"Migrations in order: {', '.join(sorted(added))} come after main's newest, "
              f"{main_newest}, and {NEWEST_FILE} names the newest.")
    else:
        print(f"No new migrations; main's newest is still {main_newest}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
