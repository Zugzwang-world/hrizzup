"""Tests for apply.py's `--staging-only` firewall guard: offline, with no token and no calls.

    python3 -m unittest discover -s infra/vercel

The guard may change only firewall rules limited to staging's own domains, and nothing that
reaches production (CLAUDE.md, "Production is off-limits to Claude Code").
"""
import contextlib
import copy
import io
import sys
import unittest
from unittest import mock

import apply

HOSTS = {"staging.hrizzup.com"}
WANT = apply.load("firewall.json")


def is_staging(rule):
    return apply.staging_only_rule(rule, HOSTS)


def live_config(with_staging=False):
    """Vercel's live firewall as its API reports it: the repo's production rules with ids, and
    the fields Vercel adds."""
    rules = [dict(copy.deepcopy(r), id=f"rule_{i}", valid=True, validationErrors=None)
             for i, r in enumerate(WANT["rules"]) if with_staging or not is_staging(r)]
    return {
        "id": "waf_1", "version": 7, "changes": [], "projectKey": "key", "ownerId": "team", "updatedAt": "then",
        "firewallEnabled": True,
        "ips": [],
        "managedRules": {name: dict(copy.deepcopy(rule), ruleGroups={}, updatedAt="then")
                         for name, rule in WANT["managedRules"].items()},
        "crs": {"sd": {"active": False, "action": "log"}, "xss": {"active": False, "action": "log"}},
        "rules": rules,
    }


def want(change=None):
    w = copy.deepcopy(WANT)
    if change:
        change(w)
    return w


def staging_rule(w, name="Staging's typed API: no bot challenge"):
    return next(r for r in w["rules"] if r["name"] == name)


class FakeVercel:
    """Answers GETs from a list, in order, records each PUT, and answers PUTs from a list
    (an empty answer is a success)."""

    def __init__(self, gets, put_answers=()):
        self.gets, self.puts, self.put_answers = list(gets), [], list(put_answers)

    def call(self, method, path, body=None, query=None, ok=(200, 201, 204)):
        if method == "GET":
            return 200, self.gets.pop(0)
        if method == "PUT":
            self.puts.append(body)
            return 200, (self.put_answers.pop(0) if self.put_answers else {})
        raise AssertionError(f"unexpected {method} {path}")


class TheRepoRules(unittest.TestCase):
    def test_staging_rules_are_limited_to_staging(self):
        names = [r["name"] for r in WANT["rules"] if is_staging(r)]
        self.assertEqual(names, ["Rate limit: staging's typed API", "Staging's typed API: no bot challenge"])

    def test_the_bypasses_come_last_and_after_their_rate_limits(self):
        actions = [r["action"]["mitigate"]["action"] for r in WANT["rules"]]
        self.assertEqual(actions, ["rate_limit", "rate_limit", "rate_limit", "bypass", "rate_limit", "bypass"])

    def test_every_description_fits_vercels_limit(self):
        # Vercel refuses a rule whose description is longer than 256 characters (HTTP 400).
        for r in WANT["rules"]:
            self.assertLessEqual(len(r.get("description", "")), 256, r["name"])

    def test_the_staging_bypass_covers_reads_only(self):
        conditions = staging_rule(WANT)["conditionGroup"][0]["conditions"]
        self.assertIn({"type": "method", "op": "eq", "value": "GET"}, conditions)


class TheChange(unittest.TestCase):
    def test_keeps_everything_that_reaches_production_as_it_is(self):
        live = live_config()
        body = apply.staging_firewall(want(), live, HOSTS)
        self.assertEqual([r["name"] for r in body["rules"]], [r["name"] for r in WANT["rules"]])
        for sent, kept in zip(body["rules"], live["rules"]):
            self.assertEqual(sent, {k: v for k, v in kept.items() if k in apply.RULE_FIELDS})
        self.assertNotIn("id", body["rules"][4])
        self.assertEqual(body["crs"], live["crs"])
        self.assertEqual(body["ips"], live["ips"])
        self.assertIs(body["firewallEnabled"], True)
        self.assertEqual(body["managedRules"], {n: {"active": r["active"], "action": r["action"], "ruleGroups": {}}
                                                for n, r in live["managedRules"].items()})
        self.assertEqual(set(body), {"firewallEnabled", "managedRules", "crs", "ips", "rules"})

    def test_sends_nothing_when_already_applied(self):
        self.assertIsNone(apply.staging_firewall(want(), live_config(with_staging=True), HOSTS))

    def test_empty_fields_in_vercels_report_still_count_as_staging(self):
        live = live_config(with_staging=True)
        live["rules"][5]["action"]["mitigate"].update(redirect={}, actionDuration="", bypassSystem=None)
        live["rules"][4]["action"]["mitigate"]["rateLimit"]["action"] = None
        self.assertEqual([r["name"] for r in live["rules"] if is_staging(r)],
                         ["Rate limit: staging's typed API", "Staging's typed API: no bot challenge"])

    def test_empty_fields_in_vercels_report_are_not_a_change(self):
        live = live_config(with_staging=True)
        live["rules"][5]["action"]["mitigate"].update(redirect={}, actionDuration="", bypassSystem=None)
        self.assertIsNone(apply.staging_firewall(want(), live, HOSTS))

    def test_an_updated_staging_rule_keeps_its_id(self):
        def raise_limit(w):
            w["rules"][4]["action"]["mitigate"]["rateLimit"]["limit"] = 90
        body = apply.staging_firewall(want(raise_limit), live_config(with_staging=True), HOSTS)
        self.assertEqual(body["rules"][4]["id"], "rule_4")
        self.assertEqual(body["rules"][4]["action"]["mitigate"]["rateLimit"]["limit"], 90)


class RefusedBecauseItReachesProduction(unittest.TestCase):
    def refused(self, w, live=None):
        with self.assertRaises(SystemExit) as caught:
            apply.staging_firewall(w, live or live_config(), HOSTS)
        return str(caught.exception.code)

    def test_a_production_rule_changed(self):
        def change(w):
            w["rules"][2]["action"]["mitigate"]["rateLimit"]["limit"] = 61
        self.assertIn("reaches production", self.refused(want(change)))

    def test_a_production_rule_removed(self):
        self.refused(want(lambda w: w["rules"].pop(3)))

    def test_production_rules_reordered(self):
        def swap(w):
            w["rules"][2], w["rules"][3] = w["rules"][3], w["rules"][2]
        self.refused(want(swap))

    def test_a_managed_rule_changed(self):
        def change(w):
            w["managedRules"]["bot_protection"]["action"] = "log"
        self.refused(want(change))

    def test_a_condition_group_without_staging_host(self):
        def change(w):
            staging_rule(w)["conditionGroup"].append({"conditions": [{"type": "path", "op": "pre", "value": "/api/v1/"}]})
        self.refused(want(change))

    def test_a_negated_host(self):
        self.refused(want(lambda w: staging_rule(w)["conditionGroup"][0]["conditions"][0].update(neg=True)))

    def test_productions_host(self):
        self.refused(want(lambda w: staging_rule(w)["conditionGroup"][0]["conditions"][0].update(value="hrizzup.com")))

    def test_a_host_matched_by_prefix(self):
        self.refused(want(lambda w: staging_rule(w)["conditionGroup"][0]["conditions"][0].update(op="pre")))

    def test_a_persistent_action(self):
        self.refused(want(lambda w: staging_rule(w)["action"]["mitigate"].update(action="deny", actionDuration="1h")))

    def test_a_bypass_of_the_ddos_mitigations(self):
        self.refused(want(lambda w: staging_rule(w)["action"]["mitigate"].update(bypassSystem=True)))

    def test_a_redirect(self):
        def change(w):
            staging_rule(w)["action"]["mitigate"] = {"action": "redirect", "redirect": {"location": "/", "permanent": False}}
        self.refused(want(change))

    def test_the_firewall_off(self):
        live = live_config()
        live["firewallEnabled"] = False
        self.refused(want(), live)

    def test_a_field_apply_py_does_not_know(self):
        live = live_config()
        live["newSetting"] = True
        self.assertIn("newSetting", self.refused(want(), live))

    def test_a_rule_without_a_name(self):
        self.assertIn("without a name", self.refused(want(lambda w: w["rules"][5].pop("name"))))

    def test_two_rules_with_one_name(self):
        def change(w):
            w["rules"][4]["name"] = w["rules"][5]["name"]
        self.assertIn("more than one rule", self.refused(want(change)))


class TheReadBack(unittest.TestCase):
    def test_ids_and_bookkeeping_do_not_count_as_changes(self):
        before, after = live_config(), live_config(with_staging=True)
        for r in after["rules"]:
            r["id"] = "new_" + r["id"]
            for group in r["conditionGroup"]:
                for c in group["conditions"]:
                    c["neg"] = False
        for r in after["managedRules"].values():
            r["updatedAt"] = "now"
        self.assertEqual(apply.production_parts(after, HOSTS), apply.production_parts(before, HOSTS))

    def test_a_null_neg_and_nested_bookkeeping_do_not_count_as_changes(self):
        before, after = live_config(), live_config(with_staging=True)
        for config, when in ((before, "then"), (after, "now")):
            for r in config["managedRules"].values():
                r["ruleGroups"] = {"group": {"active": True, "updatedAt": when}}
        for r in after["rules"]:
            for group in r["conditionGroup"]:
                for c in group["conditions"]:
                    c["neg"] = None
        self.assertEqual(apply.production_parts(after, HOSTS), apply.production_parts(before, HOSTS))

    def test_a_changed_setting_counts(self):
        after = live_config(with_staging=True)
        after["crs"]["sd"]["active"] = True
        self.assertNotEqual(apply.production_parts(after, HOSTS), apply.production_parts(live_config(), HOSTS))

    def test_the_change_applies_then_checks(self):
        v = FakeVercel([live_config(), live_config(with_staging=True), live_config(with_staging=True)])
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertEqual(apply.firewall(v, {"id": "prj"}, check_only=True, staging_hosts=HOSTS), [])
        self.assertEqual(len(v.puts), 1)
        self.assertIn("applied the firewall rules limited to staging's domains", printed.getvalue())

    def test_a_production_part_changed_by_vercel_is_put_back(self):
        before, after = live_config(), live_config(with_staging=True)
        after["crs"]["sd"]["active"] = True
        v = FakeVercel([before, after, live_config()])
        with self.assertRaises(SystemExit) as caught:
            apply.firewall(v, {"id": "prj"}, check_only=True, staging_hosts=HOSTS)
        self.assertIn("put back as it was, and reads back so", str(caught.exception.code))
        self.assertEqual(len(v.puts), 2)
        self.assertEqual(v.puts[1]["crs"], before["crs"])
        self.assertEqual([r["name"] for r in v.puts[1]["rules"]], [r["name"] for r in before["rules"]])
        self.assertEqual([r["id"] for r in v.puts[1]["rules"]], [r["id"] for r in before["rules"]])

    def test_a_put_back_that_fails_says_so(self):
        after = live_config(with_staging=True)
        after["crs"]["sd"]["active"] = True
        v = FakeVercel([live_config(), after, after], put_answers=[{}, {"_error": "HTTP 500"}])
        with self.assertRaises(SystemExit) as caught:
            apply.firewall(v, {"id": "prj"}, check_only=True, staging_hosts=HOSTS)
        self.assertIn("did NOT work (HTTP 500)", str(caught.exception.code))

    def test_a_put_back_that_reads_back_wrong_says_so(self):
        after = live_config(with_staging=True)
        after["crs"]["sd"]["active"] = True
        v = FakeVercel([live_config(), after, after])
        with self.assertRaises(SystemExit) as caught:
            apply.firewall(v, {"id": "prj"}, check_only=True, staging_hosts=HOSTS)
        self.assertIn("did NOT work (it reads back differently)", str(caught.exception.code))


class TheDomains(unittest.TestCase):
    def test_a_staging_domain_that_is_productions_stops_before_any_call(self):
        real = apply.load

        def load(name):
            data = real(name)
            if name == "project.json":
                data["customEnvironments"]["staging"]["domains"].append("hrizzup.com")
            return data

        with mock.patch.object(apply, "load", load), \
                mock.patch.object(apply, "Vercel", side_effect=AssertionError("no call may be made")), \
                mock.patch.object(sys, "argv", ["apply.py", "--staging-only"]):
            with self.assertRaises(SystemExit) as caught:
                apply.main()
        self.assertIn("may not be production's", str(caught.exception.code))


if __name__ == "__main__":
    unittest.main()
