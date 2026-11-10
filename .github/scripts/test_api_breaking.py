"""Tests for api_breaking.py: the public API's breaking-change check (PLAN.md step 3.5a).

With oasdiff at hand ($OASDIFF, or on the PATH: Quick checks install it), they also prove the real
thing: renaming or removing a v1 field, or removing a call, fails; adding a call or an optional
field passes. Without it (this Mac, usually), those are skipped.
"""
import copy
import json
import os
import subprocess
import tempfile
import unittest

import api_breaking

ROOT = api_breaking.ROOT


def published():
    with open(os.path.join(ROOT, api_breaking.FILE), encoding="utf-8") as f:
        return json.load(f)


class Decisions(unittest.TestCase):
    def test_on_github_a_missing_oasdiff_fails(self):
        env = {"GITHUB_ACTIONS": "true", "PATH": ""}
        self.assertEqual(api_breaking.main([], environ=env), 1)

    def test_on_this_mac_a_missing_oasdiff_skips(self):
        self.assertEqual(api_breaking.main([], environ={"PATH": ""}), 0)

    def test_before_main_has_a_file_there_is_nothing_to_compare(self):
        env = {"OASDIFF": "/bin/false"}
        self.assertEqual(api_breaking.main(["--main", "no-such-ref-at-all"], environ=env), 0)


TOOL = api_breaking.oasdiff()


@unittest.skipUnless(TOOL, "oasdiff isn't here (Quick checks install it)")
class WithOasdiff(unittest.TestCase):
    def verdict(self, change):
        base = published()
        head = copy.deepcopy(base)
        change(head)
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "head.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(head, f)
            return api_breaking.breaking(TOOL, json.dumps(base), path)

    def market_list(self, doc):
        return doc["paths"]["/markets"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]

    def test_the_file_unchanged_passes(self):
        self.assertEqual(self.verdict(lambda doc: None)[0], 0)

    def test_renaming_an_answers_field_fails(self):
        def rename(doc):
            schema = self.market_list(doc)
            schema["properties"]["nextCursor"] = schema["properties"].pop("next")
            schema["required"] = ["nextCursor" if r == "next" else r for r in schema["required"]]
        code, said = self.verdict(rename)
        self.assertNotEqual(code, 0, said)

    def test_removing_an_input_fails(self):
        def remove(doc):
            doc["paths"]["/markets"]["get"]["parameters"] = [
                p for p in doc["paths"]["/markets"]["get"]["parameters"] if p["name"] != "cursor"]
        self.assertNotEqual(self.verdict(remove)[0], 0)

    def test_removing_a_call_fails(self):
        self.assertNotEqual(self.verdict(lambda doc: doc["paths"].pop("/perps"))[0], 0)

    def test_adding_a_call_or_an_answers_field_passes(self):
        def add(doc):
            doc["paths"]["/markets/{id}/history"] = copy.deepcopy(doc["paths"]["/perps/{id}"])
            self.market_list(doc)["properties"]["total"] = {"type": "integer"}
        code, said = self.verdict(add)
        self.assertEqual(code, 0, said)


class TheFileItself(unittest.TestCase):
    def test_it_holds_no_admin_sign_in_or_key_making_call(self):
        paths = published()["paths"]
        for path in paths:
            with self.subTest(path=path):
                self.assertFalse(path.startswith(("/admin", "/auth", "/me/keys")))

    def test_it_is_in_the_repository(self):
        tracked = subprocess.run(["git", "ls-files", "--error-unmatch", api_breaking.FILE],
                                 cwd=ROOT, capture_output=True)
        self.assertEqual(tracked.returncode, 0)


if __name__ == "__main__":
    unittest.main()
