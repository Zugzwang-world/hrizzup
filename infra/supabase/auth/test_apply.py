"""Offline tests of apply.py's hook safeguard (no token, no calls): run by Quick checks and
`pnpm check` with `python3 -m unittest discover -s infra/supabase/auth`."""
import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apply  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS = os.path.join(HERE, "..", "migrations")
URI = "pg-functions://postgres/auth_hooks/refuse_password_sessions"


def settings():
    with open(os.path.join(HERE, "settings.json")) as f:
        return json.load(f)


class HookAddress(unittest.TestCase):
    def test_a_database_hook_names_its_schema_and_function(self):
        self.assertEqual(apply.hook_function(URI), ("auth_hooks", "refuse_password_sessions"))

    def test_anything_else_is_refused(self):
        for bad in [None, "", "https://example.com/hook",
                    "pg-functions://postgres/auth_hooks",
                    "pg-functions://other/auth_hooks/refuse_password_sessions",
                    "pg-functions://postgres/auth_hooks/refuse'; drop table x; --",
                    "pg-functions://postgres/Auth/Hook",
                    "pg-functions://postgres/auth_hooks/refuse_password_sessions/extra"]:
            self.assertIsNone(apply.hook_function(bad), bad)


class HookSafeguard(unittest.TestCase):
    def plain(self, enabled=True, uri=URI):
        return {"hook_custom_access_token_enabled": enabled,
                "hook_custom_access_token_uri": uri, "site_url": "x"}

    def test_only_switched_on_hooks_are_checked(self):
        asked = []
        problems = apply.hook_problems("staging", self.plain(enabled=False),
                                       lambda sql: asked.append(sql) or [])
        self.assertEqual(problems, [])
        self.assertEqual(asked, [])

    def test_a_hook_the_database_can_run_passes(self):
        asked = []
        problems = apply.hook_problems("staging", self.plain(),
                                       lambda sql: asked.append(sql) or [{"ready": True}])
        self.assertEqual(problems, [])
        self.assertEqual(len(asked), 1)
        self.assertIn("to_regprocedure('auth_hooks.refuse_password_sessions(jsonb)')", asked[0])
        self.assertIn("'supabase_auth_admin'", asked[0])

    def test_a_missing_or_unrunnable_function_is_refused(self):
        for rows in ([], [{"ready": False}], [{"ready": None}], [{}]):
            problems = apply.hook_problems("staging", self.plain(), lambda sql, r=rows: r)
            self.assertEqual(len(problems), 1, rows)
            self.assertIn("stop every sign-in", problems[0])

    def test_a_hook_without_a_database_address_is_refused_without_asking(self):
        asked = []
        problems = apply.hook_problems("staging", self.plain(uri="https://example.com/hook"),
                                       lambda sql: asked.append(sql) or [{"ready": True}])
        self.assertEqual(len(problems), 1)
        self.assertEqual(asked, [])


class LiveHooks(unittest.TestCase):
    def test_a_hook_on_in_supabase_but_not_in_the_repo_is_reported(self):
        live = {"hook_custom_access_token_enabled": True, "hook_send_email_enabled": False}
        problems = apply.compare("ref", live, {}, {})
        self.assertEqual(len(problems), 1)
        self.assertIn("hook_custom_access_token_enabled: a hook that is on in Supabase", problems[0])

    def test_a_hook_on_in_both_is_not_reported_twice(self):
        live = {"hook_custom_access_token_enabled": True}
        plain = {"hook_custom_access_token_enabled": True}
        self.assertEqual(apply.compare("ref", live, plain, {}), [])

    def test_the_readiness_question_asks_for_the_schema_too(self):
        sql = apply.hook_ready_sql("auth_hooks", "refuse_password_sessions")
        self.assertIn("has_schema_privilege('supabase_auth_admin', 'auth_hooks', 'usage')", sql)
        self.assertIn("has_function_privilege('supabase_auth_admin'", sql)


class RepoSettings(unittest.TestCase):
    def test_every_switched_on_hook_is_created_by_a_migration(self):
        """A hook settings.json switches on must be a function some migration creates, taking
        the event as jsonb, and granted to Supabase Auth alone."""
        plain = dict(settings()["shared"])
        sql = ""
        for name in sorted(os.listdir(MIGRATIONS)):
            with open(os.path.join(MIGRATIONS, name)) as f:
                sql += f.read()
        for hook in apply.hooks_switched_on(plain):
            schema, function = apply.hook_function(plain[f"hook_{hook}_uri"])
            qualified = re.escape(f"{schema}.{function}")
            self.assertRegex(sql, rf"create (or replace )?function {qualified}\(event jsonb\)")
            self.assertRegex(sql, rf"grant execute on function {qualified}\(jsonb\) to supabase_auth_admin;")


if __name__ == "__main__":
    unittest.main()


class Addresses(unittest.TestCase):
    """Where Supabase may send a visitor back to: only our own addresses, never a pattern anyone
    else could match (blueprint section 9)."""

    def lists(self):
        environments = settings()["environments"]
        return {name: env["settings"]["uri_allow_list"].split(",") for name, env in environments.items()}

    def test_no_vercel_app_address_anywhere(self):
        for name, addresses in self.lists().items():
            self.assertFalse([a for a in addresses if "vercel.app" in a], name)

    def test_the_apps_way_back_from_google_is_exactly_its_own_address_on_staging(self):
        # PLAN.md step 1.6b: the phone's browser comes back to the app's own address, exactly; a
        # pattern on the app's scheme would let any address under it carry a sign-in.
        staging = self.lists()["staging"]
        self.assertIn("hrizzup://auth/callback", staging)
        apps = [a for a in staging if not a.startswith(("https://", "http://localhost:"))]
        self.assertEqual(apps, ["hrizzup://auth/callback"])

    def test_every_web_address_is_ours_and_secure_or_this_macs(self):
        for name, addresses in self.lists().items():
            for address in addresses:
                if address.startswith("hrizzup://"):
                    continue
                self.assertRegex(
                    address,
                    r"^(https://([a-z]+\.)?hrizzup\.com/\*\*|http://localhost:(3000|310[1-9])/\*\*)$",
                    f"{name}: {address}",
                )

