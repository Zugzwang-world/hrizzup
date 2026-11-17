"""Tests for api_breaking.py: the public API's breaking-change check (PLAN.md step 3.5a).

With oasdiff at hand ($OASDIFF, or on the PATH: Quick checks install it), they also prove the real
thing: renaming or removing a v1 field, or removing a call, fails; adding a call or an optional
field passes. Without it (this Mac, usually), those are skipped.

A call in beta (`x-stability-level: beta`; docs/social/build.md, D9 and 7.12) may change within v1:
the pure tests (`newly_beta`, `strip_beta` and the order of the check, with a stand-in for oasdiff)
run everywhere; the ones with the real oasdiff run on GitHub.
"""
import copy
import json
import os
import shutil
import stat
import subprocess
import sys
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


def small(paths, schemas=None):
    """A small OpenAPI document with these paths (and components, if any)."""
    return {"openapi": "3.1.0", "info": {"title": "T", "version": "1"}, "paths": paths,
            "components": {"schemas": schemas if schemas is not None else {"Shared": {"type": "string"}}}}


def operation(name, beta=False, level=None):
    """One operation, answering an object with its own name as a field."""
    answer = {"type": "object", "properties": {name: {"type": "string"}}, "required": [name]}
    one = {"operationId": name,
           "responses": {"200": {"description": "ok", "content": {"application/json": {"schema": answer}}}}}
    if beta:
        one["x-stability-level"] = "beta"
    elif level:
        one["x-stability-level"] = level
    return one


# A stand-in for oasdiff that says "nothing breaks" whatever it's asked (`true`): for the tests of
# what happens before oasdiff is asked, or of what it's given.
SAYS_FINE = shutil.which("true") or "/usr/bin/true"


class BetaPure(unittest.TestCase):
    """The beta rule's pure parts: no oasdiff needed."""

    def test_a_v1_call_that_gains_the_mark_is_newly_beta(self):
        base = small({"/a": {"get": operation("a")}, "/b": {"get": operation("b")}})
        head = small({"/a": {"get": operation("a", beta=True)}, "/b": {"get": operation("b")}})
        self.assertEqual(api_breaking.newly_beta(base, head), [("get", "/a")])

    def test_it_is_each_method_and_path_pair_and_is_sorted(self):
        base = small({"/b": {"get": operation("b"), "post": operation("bp")},
                      "/a": {"get": operation("a")}})
        head = small({"/b": {"get": operation("b"), "post": operation("bp", beta=True)},
                      "/a": {"get": operation("a", beta=True)}})
        self.assertEqual(api_breaking.newly_beta(base, head), [("get", "/a"), ("post", "/b")])

    def test_a_new_beta_call_that_main_does_not_have_is_never_newly_beta(self):
        base = small({"/a": {"get": operation("a")}})
        head = small({"/a": {"get": operation("a")}, "/s": {"get": operation("s", beta=True)}})
        self.assertEqual(api_breaking.newly_beta(base, head), [])
        # Nor is a second method on a path that main has: that pair is new too.
        head = small({"/a": {"get": operation("a"), "post": operation("ap", beta=True)}})
        self.assertEqual(api_breaking.newly_beta(base, head), [])

    def test_a_call_that_was_beta_and_stays_beta_or_loses_the_mark_is_not_newly_beta(self):
        base = small({"/s": {"get": operation("s", beta=True)}})
        self.assertEqual(api_breaking.newly_beta(base, base), [])
        self.assertEqual(api_breaking.newly_beta(base, small({"/s": {"get": operation("s")}})), [])
        self.assertEqual(api_breaking.newly_beta(base, small({})), [])

    def test_only_beta_is_the_mark_and_only_operations_count(self):
        base = small({"/a": {"get": operation("a")}})
        head = small({"/a": {"get": operation("a", level="stable")}})
        self.assertEqual(api_breaking.newly_beta(base, head), [])
        base = small({"/a": {"parameters": [], "get": operation("a")}})
        head = small({"/a": {"parameters": [{"x-stability-level": "beta"}], "get": operation("a")}})
        self.assertEqual(api_breaking.newly_beta(base, head), [])

    def test_the_check_refuses_a_v1_call_newly_marked_before_it_asks_oasdiff(self):
        base = small({"/a": {"get": operation("a")}})
        head = small({"/a": {"get": operation("a", beta=True)}})
        # `true` would say "fine" if it were asked: the refusal comes first.
        code, said = api_breaking.verdict(SAYS_FINE, json.dumps(base), json.dumps(head))
        self.assertEqual(code, 1)
        self.assertIn("GET /a", said)
        self.assertIn("v1", said)
        self.assertIn("v2", said)

    def test_the_refusal_names_every_call(self):
        base = small({"/a": {"get": operation("a")}, "/b": {"post": operation("b")}})
        head = small({"/a": {"get": operation("a", beta=True)}, "/b": {"post": operation("b", beta=True)}})
        code, said = api_breaking.verdict(SAYS_FINE, json.dumps(base), json.dumps(head))
        self.assertEqual(code, 1)
        self.assertIn("GET /a", said)
        self.assertIn("POST /b", said)

    def test_a_new_beta_call_passes_the_whole_check(self):
        base = small({"/a": {"get": operation("a")}})
        head = small({"/a": {"get": operation("a")}, "/s": {"get": operation("s", beta=True)}})
        code, said = api_breaking.verdict(SAYS_FINE, json.dumps(base), json.dumps(head))
        self.assertEqual((code, said), (0, ""))

    def test_any_other_stability_level_is_refused_before_oasdiff_is_asked(self):
        base = small({"/a": {"get": operation("a")}})
        for level in ("draft", "alpha", "stable", "Beta"):
            # On a v1 call, and on a call new to the file: oasdiff skips the changes to a draft or
            # alpha call, so either would change unchecked.
            heads = {"/a": small({"/a": {"get": operation("a", level=level)}}),
                     "/s": small({"/a": {"get": operation("a")}, "/s": {"get": operation("s", level=level)}})}
            for path, head in heads.items():
                with self.subTest(level=level, path=path):
                    code, said = api_breaking.verdict(SAYS_FINE, json.dumps(base), json.dumps(head))
                    self.assertEqual(code, 1, said)
                    self.assertIn(f"GET {path}: {json.dumps(level)}", said)
                    self.assertIn("x-stability-level", said)

    def test_other_levels_are_found_by_method_and_path_with_the_level(self):
        head = small({"/b": {"get": operation("b", level="draft"), "post": operation("bp", beta=True)},
                      "/a": {"get": operation("a", level="alpha")},
                      "/c": {"get": operation("c")}})
        self.assertEqual(api_breaking.other_levels(head),
                         [("get", "/a", "alpha"), ("get", "/b", "draft")])
        self.assertEqual(api_breaking.other_levels(small({"/a": {"get": operation("a", beta=True)}})), [])

    def test_a_value_that_is_not_text_is_another_level_too(self):
        head = small({"/a": {"get": operation("a")}})
        head["paths"]["/a"]["get"]["x-stability-level"] = None
        self.assertEqual(api_breaking.other_levels(head), [("get", "/a", None)])
        code, said = api_breaking.verdict(SAYS_FINE, json.dumps(small({"/a": {"get": operation("a")}})),
                                          json.dumps(head))
        self.assertEqual(code, 1, said)

    def test_a_newly_marked_call_and_another_level_are_both_said(self):
        base = small({"/a": {"get": operation("a")}, "/b": {"get": operation("b")}})
        head = small({"/a": {"get": operation("a", beta=True)}, "/b": {"get": operation("b", level="draft")}})
        code, said = api_breaking.verdict(SAYS_FINE, json.dumps(base), json.dumps(head))
        self.assertEqual(code, 1)
        self.assertIn("GET /a", said)
        self.assertIn('GET /b: "draft"', said)

    def test_a_file_that_is_not_json_fails(self):
        code, said = api_breaking.verdict(SAYS_FINE, "{", "{}")
        self.assertEqual(code, 1)
        self.assertIn("JSON", said)

    def test_strip_beta_removes_beta_operations_and_paths_left_with_none(self):
        doc = small({
            "/a": {"get": operation("a")},
            "/s": {"get": operation("s", beta=True)},
            "/m": {"get": operation("mg", beta=True), "post": operation("mp")},
            "/p": {"parameters": [{"name": "id"}], "get": operation("pg", beta=True)},
            "/q": {"parameters": [{"name": "id"}], "get": operation("qg"), "post": operation("qp", beta=True)},
        })
        stripped = api_breaking.strip_beta(doc)
        self.assertEqual(sorted(stripped["paths"]), ["/a", "/m", "/q"])
        self.assertEqual(list(stripped["paths"]["/m"]), ["post"])
        self.assertEqual(list(stripped["paths"]["/q"]), ["parameters", "get"])
        self.assertEqual(stripped["paths"]["/a"], doc["paths"]["/a"])
        self.assertNotIn("x-stability-level", json.dumps(stripped))

    def test_strip_beta_keeps_components_whatever_they_hold(self):
        schemas = {"Story": {"type": "object", "properties": {"id": {"type": "string"}}},
                   "Only": {"$ref": "#/components/schemas/Story"}}
        doc = small({"/s": {"get": operation("s", beta=True)}}, schemas)
        stripped = api_breaking.strip_beta(doc)
        self.assertEqual(stripped["paths"], {})
        self.assertEqual(stripped["components"], {"schemas": schemas})
        # Components may even hold a mark: they aren't operations, so they stay.
        doc = small({}, {"X": {"x-stability-level": "beta"}})
        self.assertEqual(api_breaking.strip_beta(doc)["components"], doc["components"])

    def test_strip_beta_leaves_the_document_it_was_given_as_it_was(self):
        doc = small({"/s": {"get": operation("s", beta=True)}, "/a": {"get": operation("a")}})
        before = copy.deepcopy(doc)
        api_breaking.strip_beta(doc)
        self.assertEqual(doc, before)

    def test_what_oasdiff_is_given_has_no_beta_operation_in_either_file(self):
        base = small({"/a": {"get": operation("a")}, "/s": {"get": operation("s", beta=True)},
                      "/gone": {"get": operation("gone", beta=True)}})
        head = small({"/a": {"get": operation("a")}, "/s": {"get": operation("s2", beta=True)},
                      "/new": {"get": operation("new", beta=True)}})
        with tempfile.TemporaryDirectory() as folder:
            tool = os.path.join(folder, "stand-in-oasdiff")
            with open(tool, "w", encoding="utf-8") as f:
                f.write(f"#!{sys.executable}\n"
                        "import json, sys\n"
                        "files = [json.load(open(path)) for path in sys.argv[2:4]]\n"
                        "print(json.dumps({'args': sys.argv[1:2] + sys.argv[4:],"
                        " 'paths': [sorted(f['paths']) for f in files],"
                        " 'marked': any('x-stability-level' in json.dumps(f['paths']) for f in files)}))\n")
            os.chmod(tool, os.stat(tool).st_mode | stat.S_IXUSR)
            code, said = api_breaking.verdict(tool, json.dumps(base), json.dumps(head))
        self.assertEqual(code, 0, said)
        given = json.loads(said)
        self.assertEqual(given["paths"], [["/a"], ["/a"]])
        self.assertFalse(given["marked"])
        # And oasdiff is asked exactly as before: to fail on warnings too.
        self.assertEqual(given["args"], ["breaking", "--fail-on", "WARN", "--format", "text"])

    def test_the_whole_run_over_a_repository_refuses_a_newly_marked_call_and_lets_a_new_one_pass(self):
        base = small({"/a": {"get": operation("a")}})
        refused = small({"/a": {"get": operation("a", beta=True)}})
        allowed = small({"/a": {"get": operation("a")}, "/s": {"get": operation("s", beta=True)}})
        with tempfile.TemporaryDirectory() as root:
            git = ["git", "-c", "user.name=Test", "-c", "user.email=test@example.test",
                   "-c", "commit.gpgsign=false"]
            target = os.path.join(root, api_breaking.FILE)
            os.makedirs(os.path.dirname(target))
            with open(target, "w", encoding="utf-8") as f:
                json.dump(base, f)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "add", "-A"], cwd=root, check=True)
            subprocess.run(git + ["commit", "-q", "-m", "base"], cwd=root, check=True)
            env = {"OASDIFF": SAYS_FINE}
            for head, want in ((refused, 1), (allowed, 0), (base, 0)):
                with open(target, "w", encoding="utf-8") as f:
                    json.dump(head, f)
                self.assertEqual(api_breaking.main(["--main", "HEAD"], environ=env, root=root), want)


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
            # A call v1 doesn't have (a market's comments): an addition, never a change.
            self.assertNotIn("/markets/{id}/comments", doc["paths"])
            doc["paths"]["/markets/{id}/comments"] = copy.deepcopy(doc["paths"]["/perps/{id}"])
            self.market_list(doc)["properties"]["total"] = {"type": "integer"}
        code, said = self.verdict(add)
        self.assertEqual(code, 0, said)


@unittest.skipUnless(TOOL, "oasdiff isn't here (Quick checks install it)")
class BetaWithOasdiff(unittest.TestCase):
    """The beta rule through the whole check, with the real oasdiff: the file as it is, plus a call
    in beta made from a real operation of it."""

    STORY = "/social/stories/{id}"

    def story(self, mark=True):
        one = copy.deepcopy(published()["paths"]["/perps/{id}"]["get"])
        one["operationId"] = "social.stories.get"
        if mark:
            one["x-stability-level"] = "beta"
        return one

    def with_story(self, mark=True, change=None):
        """The published file plus the beta call, which `change` may then change."""
        doc = published()
        doc["paths"][self.STORY] = {"get": self.story(mark)}
        if change:
            change(doc)
        return doc

    def verdict(self, base, head):
        return api_breaking.verdict(TOOL, json.dumps(base), json.dumps(head))

    def test_a_new_beta_call_passes(self):
        code, said = self.verdict(published(), self.with_story())
        self.assertEqual(code, 0, said)

    def test_a_beta_calls_change_passes(self):
        def change(doc):
            one = doc["paths"][self.STORY]["get"]
            one["parameters"] = []
            schema = one["responses"]["200"]["content"]["application/json"]["schema"]
            schema["properties"].pop(next(iter(schema["properties"])))
            one["responses"].pop("503", None)
        code, said = self.verdict(self.with_story(), self.with_story(change=change))
        self.assertEqual(code, 0, said)

    def test_a_beta_calls_removal_passes(self):
        code, said = self.verdict(self.with_story(), published())
        self.assertEqual(code, 0, said)

    def test_unmarking_a_beta_call_passes(self):
        code, said = self.verdict(self.with_story(), self.with_story(mark=False))
        self.assertEqual(code, 0, said)

    def test_a_v1_call_newly_marked_fails_and_names_it(self):
        head = published()
        head["paths"]["/perps"]["get"]["x-stability-level"] = "beta"
        code, said = self.verdict(published(), head)
        self.assertEqual(code, 1)
        self.assertIn("GET /perps", said)

    def test_a_v1_change_still_fails_with_a_beta_call_in_both_files(self):
        def rename(doc):
            schema = doc["paths"]["/markets"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
            schema["properties"]["nextCursor"] = schema["properties"].pop("next")
            schema["required"] = ["nextCursor" if r == "next" else r for r in schema["required"]]
        code, said = self.verdict(self.with_story(), self.with_story(change=rename))
        self.assertNotEqual(code, 0, said)
        self.assertIn("v1", said)
        self.assertNotIn("social/stories", said)

    def test_a_v1_call_removed_still_fails_with_a_beta_call_in_both_files(self):
        code, said = self.verdict(self.with_story(), self.with_story(change=lambda doc: doc["paths"].pop("/perps")))
        self.assertNotEqual(code, 0, said)

    def test_a_v1_call_cannot_hide_behind_the_mark_by_being_marked_and_changed(self):
        def mark_and_change(doc):
            one = doc["paths"]["/perps"]["get"]
            one["x-stability-level"] = "beta"
            one["parameters"] = []
        code, said = self.verdict(published(), self.with_story(change=mark_and_change))
        self.assertEqual(code, 1)
        self.assertIn("GET /perps", said)

    # Components: a schema both a v1 call and a beta call use is v1's; one only a beta call uses is
    # the beta call's own. oasdiff 1.35.0 reports a change to a component only through a call that
    # uses it, so what's left of a beta call's own schemas is never looked at.
    SCHEMA = {"type": "object",
             "properties": {"id": {"type": "string"}, "title": {"type": "string"}, "note": {"type": "string"}},
             "required": ["id", "title", "note"]}

    def without_note(self):
        less = copy.deepcopy(self.SCHEMA)
        del less["properties"]["note"]
        less["required"] = ["id", "title"]
        return less

    def with_component(self, v1=False, beta=False, story=None):
        """The published file with a `Story` component, answered by a v1 call and/or a beta one."""
        doc = published()
        doc["components"]["schemas"]["Story"] = copy.deepcopy(story or self.SCHEMA)
        for used, path, name, mark in ((v1, "/stories/{id}", "stories.get", False),
                                       (beta, self.STORY, "social.stories.get", True)):
            if used:
                one = copy.deepcopy(published()["paths"]["/perps/{id}"]["get"])
                one["operationId"] = name
                one["responses"]["200"]["content"]["application/json"]["schema"] = {
                    "$ref": "#/components/schemas/Story"}
                if mark:
                    one["x-stability-level"] = "beta"
                doc["paths"][path] = {"get": one}
        return doc

    def test_a_component_a_v1_call_and_a_beta_call_share_is_the_v1_calls_so_losing_a_property_fails(self):
        base = self.with_component(v1=True, beta=True)
        head = self.with_component(v1=True, beta=True, story=self.without_note())
        code, said = self.verdict(base, head)
        self.assertEqual(code, 1, said)
        self.assertIn("/stories/{id}", said)
        self.assertNotIn(self.STORY, said)

    def test_a_component_only_a_beta_call_uses_may_change(self):
        base = self.with_component(beta=True)
        for name, story in (("a property gone", self.without_note()),
                            ("a type changed", {**self.SCHEMA, "properties": {
                                **self.SCHEMA["properties"], "title": {"type": "integer"}}}),
                            ("a value gone", {**self.SCHEMA, "properties": {
                                **self.SCHEMA["properties"], "id": {"enum": ["a"]}}})):
            with self.subTest(name):
                code, said = self.verdict(base, self.with_component(beta=True, story=story))
                self.assertEqual(code, 0, said)

    def test_a_component_only_a_beta_call_uses_may_go_with_it(self):
        head = published()
        self.assertNotIn("Story", head["components"]["schemas"])
        code, said = self.verdict(self.with_component(beta=True), head)
        self.assertEqual(code, 0, said)
        # And the beta call going while its component stays.
        head = self.with_component(beta=True)
        del head["paths"][self.STORY]
        code, said = self.verdict(self.with_component(beta=True), head)
        self.assertEqual(code, 0, said)

    def test_a_v1_call_that_gains_draft_or_alpha_fails_whatever_else_it_changes(self):
        for level in ("draft", "alpha"):
            with self.subTest(level=level):
                head = published()
                head["paths"]["/perps"]["get"]["x-stability-level"] = level
                head["paths"]["/perps"]["get"]["parameters"] = []
                code, said = self.verdict(published(), head)
                self.assertEqual(code, 1, said)
                self.assertIn(f"GET /perps: {json.dumps(level)}", said)

    def test_the_whole_run_over_a_repository_with_a_real_oasdiff(self):
        with tempfile.TemporaryDirectory() as root:
            git = ["git", "-c", "user.name=Test", "-c", "user.email=test@example.test",
                   "-c", "commit.gpgsign=false"]
            target = os.path.join(root, api_breaking.FILE)
            os.makedirs(os.path.dirname(target))
            with open(target, "w", encoding="utf-8") as f:
                json.dump(self.with_story(), f)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "add", "-A"], cwd=root, check=True)
            subprocess.run(git + ["commit", "-q", "-m", "base"], cwd=root, check=True)
            env = {"OASDIFF": TOOL}
            removed = self.with_story()
            del removed["paths"]["/perps"]
            marked = self.with_story()
            marked["paths"]["/perps"]["get"]["x-stability-level"] = "beta"
            for head, want in ((published(), 0), (self.with_story(mark=False), 0), (self.with_story(), 0),
                               (removed, 1), (marked, 1)):
                with open(target, "w", encoding="utf-8") as f:
                    json.dump(head, f)
                self.assertEqual(api_breaking.main(["--main", "HEAD"], environ=env, root=root), want)


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
