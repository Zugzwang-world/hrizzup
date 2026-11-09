"""Tests for which parts a change touches (affected.py): offline, with made-up changes.

    python3 -m unittest discover -s .github/scripts

A change to the checks themselves (.github/workflows or .github/scripts) runs every part's
checks, so a pull request that changes how a check runs is checked by it.
"""
import subprocess
import unittest

import affected


class Diff:
    def __init__(self, names):
        self.names, self.calls = names, []

    def __call__(self, command, **kwargs):
        self.calls.append(command)
        return subprocess.CompletedProcess(command, 0, stdout="\n".join(self.names) + "\n")


class WhatAChangeTouches(unittest.TestCase):
    def test_turborepos_answer_stands_when_the_checks_dont_change(self):
        self.assertEqual(affected.parts({"@hrizzup/web"}, []), {"website": True, "app": False})
        self.assertEqual(affected.parts(set(), []), {"website": False, "app": False})

    def test_a_change_to_the_checks_touches_every_part(self):
        self.assertEqual(affected.parts(set(), [".github/workflows/checks.yml"]), {"website": True, "app": True})

    def test_only_the_checks_own_folders_are_asked_about(self):
        diff = Diff([".github/scripts/tools.py"])
        self.assertEqual(affected.checks_changed("base", "head", run=diff), [".github/scripts/tools.py"])
        self.assertEqual(diff.calls, [["git", "diff", "--name-only", "base...head", "--",
                                       ".github/workflows/", ".github/scripts/"]])

    def test_without_a_base_nothing_is_asked(self):
        diff = Diff([".github/workflows/checks.yml"])
        self.assertEqual(affected.checks_changed("", "head", run=diff), [])
        self.assertEqual(diff.calls, [])


if __name__ == "__main__":
    unittest.main()
