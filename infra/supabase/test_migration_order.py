"""Tests for the database-order check: offline, with made-up names and throwaway git repositories.

    python3 -m unittest discover -s infra/supabase

A pull request may only add migrations after the newest one on main, never touch one that's
on main, and must name its newest in newest-migration.txt; once one pull request with a
migration merges, any other one conflicts with main until it's rebased (and, if needed,
renamed).
"""
import contextlib
import datetime
import io
import os
import subprocess
import tempfile
import unittest
from unittest import mock

import migration_order as order

NOW = datetime.datetime(2026, 11, 9, 12, 0, 0, tzinfo=datetime.timezone.utc)
LOCK = "20261103120000_lock_every_table.sql"


def check(**kwargs):
    kwargs.setdefault("main", [LOCK])
    kwargs.setdefault("touched", [])
    kwargs.setdefault("now", NOW)
    added = kwargs.setdefault("added", [])
    kwargs.setdefault("head", kwargs["main"] + added)
    kwargs.setdefault("lock", order.newest(kwargs["head"]))
    return order.problems(**kwargs)


class TheRules(unittest.TestCase):
    def test_the_repositorys_own_migrations_and_lock_agree(self):
        folder = os.path.join(order.ROOT, order.MIGRATIONS)
        names = sorted(n for n in os.listdir(folder) if not n.startswith("."))
        for name in names:
            self.assertIsNotNone(order.timestamp(name), name)
        with open(os.path.join(order.ROOT, order.NEWEST_FILE), encoding="utf-8") as f:
            self.assertEqual(order.lock_line(f.read()), order.newest(names))

    def test_a_migration_after_mains_newest_passes(self):
        self.assertEqual(check(added=["20261109113000_ledger.sql"]), [])

    def test_a_migration_not_after_mains_newest_is_told_to_rename(self):
        for ts in ("20261103120000", "20261102090000"):
            found = check(main=[LOCK, "20261109110000_content.sql"], added=[f"{ts}_ledger.sql"])
            told = [p for p in found if "doesn't come after the newest migration on main" in p]
            self.assertEqual(len(told), 1, found)
            self.assertIn("20261109110000_content.sql", told[0])
            self.assertIn("rename it", told[0])
            self.assertIn("20261109120000_ledger.sql", told[0])  # now, which is later

    def test_the_suggested_name_is_always_after_mains_newest(self):
        late = "20261109130000_content.sql"  # main's newest is an hour ahead of the clock
        found = check(main=[LOCK, late], added=["20261109100000_ledger.sql"])
        self.assertIn("20261109130100_ledger.sql", found[0])

    def test_a_migration_already_on_main_is_never_renamed_changed_or_deleted(self):
        found = check(touched=[LOCK], added=["20261109113000_lock_every_table.sql"])
        self.assertTrue(any("already on main" in p and LOCK in p for p in found), found)

    def test_names_must_be_a_real_utc_timestamp_and_a_plain_name(self):
        for bad in ("ledger.sql", "2026110911_ledger.sql", "20261309113000_ledger.sql",
                    "20261109113000_Ledger.sql", "20261109113000-ledger.sql", "20261109113000_ledger.txt"):
            found = check(added=[bad], lock=LOCK)
            self.assertTrue(any("a migration's name is its UTC timestamp" in p for p in found), bad)

    def test_two_migrations_never_share_a_timestamp(self):
        found = check(main=[LOCK, "20261109110000_content.sql"],
                      added=["20261109113000_ledger.sql", "20261109113000_markets.sql"])
        self.assertTrue(any("share the timestamp 20261109113000" in p for p in found), found)

    def test_no_migration_may_claim_the_future(self):
        self.assertEqual(check(added=["20261110110000_ledger.sql"]), [])  # 23 hours ahead
        found = check(added=["20261111120000_ledger.sql"])
        self.assertTrue(any("more than a day ahead" in p for p in found), found)

    def test_the_lock_names_the_newest_migration_when_one_is_added(self):
        found = check(added=["20261109113000_ledger.sql"], lock=LOCK)
        self.assertTrue(any(order.NEWEST_FILE in p for p in found), found)

    def test_a_pull_request_without_migrations_isnt_held_to_the_lock(self):
        self.assertEqual(check(lock=""), [])  # e.g. branched before the lock existed
        found = check(lock="something else", lock_changed=True)
        self.assertTrue(any(order.NEWEST_FILE in p for p in found), found)

    def test_the_lock_is_the_last_line_that_isnt_a_comment(self):
        self.assertEqual(order.lock_line("# a comment\n\n# another\nX.sql\n\n"), "X.sql")
        self.assertEqual(order.lock_line("# only comments\n"), "")


class InARepository(unittest.TestCase):
    """The whole check, through git, as the Database check runs it, in a throwaway repository
    shaped like ours: main, and pull requests branched from it."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = folder.name
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "Test")
        self.git("config", "commit.gpgsign", "false")
        self.add_migration(LOCK, lock=True)
        self.git("commit", "-q", "-m", "main")

    def git(self, *args):
        out = subprocess.run(["git", "-C", self.root, *args], capture_output=True, text=True)
        if out.returncode != 0 and args[0] not in ("merge-tree",):
            raise AssertionError(f"git {' '.join(args)}: {out.stderr}")
        return out

    def add_migration(self, name, lock=True):
        folder = os.path.join(self.root, order.MIGRATIONS)
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, name), "w") as f:
            f.write("select 1;\n")
        if lock:
            path = os.path.join(self.root, order.NEWEST_FILE)
            with open(path, "w") as f:
                f.write(f"# the newest migration\n{name}\n")
        self.git("add", "-A")

    def branch_with(self, branch, name):
        self.git("checkout", "-q", "-b", branch, "main")
        self.add_migration(name)
        self.git("commit", "-q", "-m", branch)
        self.git("checkout", "-q", "main")

    def run_check(self, head):
        out = io.StringIO()
        with mock.patch.object(order, "ROOT", self.root), contextlib.redirect_stdout(out):
            code = order.main(["--main", "main", "--head", head])
        return code, out.getvalue()

    def squash_merge(self, branch):
        self.git("merge", "-q", "--squash", branch)
        self.git("commit", "-q", "-m", f"{branch} (squashed)")

    def test_main_gaining_a_migration_stops_the_other_pull_request_until_it_is_renamed(self):
        self.branch_with("ledger", "20261109100000_ledger.sql")
        self.branch_with("content", "20261109090000_content.sql")
        # Both pass while main's newest is the first migration.
        self.assertEqual(self.run_check("ledger")[0], 0)
        self.assertEqual(self.run_check("content")[0], 0)

        self.squash_merge("ledger")
        # The other pull request's checks passed, but it now conflicts with main on the lock's
        # line, so GitHub can't merge it as it is.
        merge = self.git("merge-tree", "--write-tree", "main", "content")
        self.assertNotEqual(merge.returncode, 0)
        self.assertIn(order.NEWEST_FILE, merge.stdout)
        # And once rebased onto main, its migration is older than main's newest: rename it.
        self.git("checkout", "-q", "-b", "content-rebased", "main")
        self.git("checkout", "content", "--", f"{order.MIGRATIONS}/20261109090000_content.sql")
        with open(os.path.join(self.root, order.NEWEST_FILE), "w") as f:
            f.write("# the newest migration\n20261109090000_content.sql\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "content, rebased")
        code, text = self.run_check("content-rebased")
        self.assertEqual(code, 1)
        self.assertIn("doesn't come after the newest migration on main, 20261109100000_ledger.sql", text)
        # Renamed after main's newest, with the lock updated: it passes, and merges cleanly.
        self.git("checkout", "-q", "content-rebased")
        self.git("mv", f"{order.MIGRATIONS}/20261109090000_content.sql",
                 f"{order.MIGRATIONS}/20261109101500_content.sql")
        with open(os.path.join(self.root, order.NEWEST_FILE), "w") as f:
            f.write("# the newest migration\n20261109101500_content.sql\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "content, renamed")
        self.git("checkout", "-q", "main")
        self.assertEqual(self.run_check("content-rebased")[0], 0)
        self.assertEqual(self.git("merge-tree", "--write-tree", "main", "content-rebased").returncode, 0)

    def test_a_pull_request_without_migrations_never_waits(self):
        self.branch_with("ledger", "20261109100000_ledger.sql")
        self.git("checkout", "-q", "-b", "words", "main")
        with open(os.path.join(self.root, "README.md"), "w") as f:
            f.write("words\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "words")
        self.git("checkout", "-q", "main")
        self.squash_merge("ledger")
        self.assertEqual(self.git("merge-tree", "--write-tree", "main", "words").returncode, 0)
        self.assertEqual(self.run_check("words")[0], 0)

    def test_renaming_a_migration_already_on_main_fails(self):
        self.git("checkout", "-q", "-b", "rename", "main")
        self.git("mv", f"{order.MIGRATIONS}/{LOCK}", f"{order.MIGRATIONS}/20261109100000_lock_every_table.sql")
        with open(os.path.join(self.root, order.NEWEST_FILE), "w") as f:
            f.write("20261109100000_lock_every_table.sql\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "rename")
        code, text = self.run_check("rename")
        self.assertEqual(code, 1)
        self.assertIn(f"{LOCK} is already on main", text)


if __name__ == "__main__":
    unittest.main()
