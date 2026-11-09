"""Tests for the check that keeps hrizzup's configs to the app's keys: offline, with made-up
lists of names, no token and no calls to Doppler or Vercel.

    python3 -m unittest discover -s infra/doppler

Any name that isn't one of the app's keys (app-keys.txt), such as a tool token, must fail the
check wherever it appears in stg, stg_preview or dev, and so must any name hrizzup-tools holds
(runbook Part 4, "Where each kind of key lives"). Production's prd_release may also hold the
release pipeline's own credentials (release-keys.txt), never an app key only staging uses; and
Vercel's production settings, which prd fills, hold the app's keys alone. Nothing may print a
value or a token.
"""
import contextlib
import http.client
import io
import json
import os
import tempfile
import unittest
import urllib.error
from unittest import mock

import app_keys
import dev_follows_staging

LABELS = sorted(app_keys.LABELS)
APP = frozenset({"DATABASE_URL", "REDIS_KEY_PREFIX", "SUPABASE_URL"})  # a made-up list of app keys
LOCAL = {"REDIS_KEY_PREFIX"}  # a made-up dev-overrides.txt
TOOLS = ["CLOUDFLARE_API_TOKEN", "EXPO_TOKEN", "VERCEL_TOKEN"] + LABELS  # made-up hrizzup-tools names
TOKEN = "dp.st.made-up-token"
RELEASE = frozenset({"CLOUDFLARE_API_TOKEN", "SUPABASE_ACCESS_TOKEN", "VERCEL_TOKEN"})  # a made-up release-keys.txt
STAGING = "AUTH_RELAY_SECRET"  # the made-up app keys' staging-only one, when a test adds it


def config(*extra):
    """A config's names: the made-up app keys, Doppler's labels, and any extra names."""
    return sorted(APP) + LABELS + list(extra)


def captured(run, *args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        code = run(*args)
    return code, out.getvalue()


class TheList(unittest.TestCase):
    def write(self, text):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = os.path.join(folder.name, "app-keys.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def test_the_repositorys_list_holds_names_only(self):
        app = app_keys.app_keys()
        self.assertTrue(app)
        for name in app:
            self.assertRegex(name, r"^[A-Z][A-Z0-9_]*$")
        self.assertFalse(app & app_keys.LABELS)

    def test_the_repositorys_dev_overrides_are_app_keys(self):
        app, local = dev_follows_staging.lists()
        self.assertTrue(local)
        self.assertLessEqual(local, app)

    def test_comments_and_blank_lines_are_left_out(self):
        path = self.write("# The app's keys\n\nDATABASE_URL   # the database\n  SUPABASE_URL\n")
        self.assertEqual(app_keys.app_keys(path), {"DATABASE_URL", "SUPABASE_URL"})

    def test_anything_but_a_name_is_refused_without_being_repeated(self):
        for text, error in [
            ("DATABASE_URL=postgres://app:hunter2@db.example/app\n", "line 1: not a key name"),
            ("DATABASE_URL\nhunter2\n", "line 2: not a key name"),
            ("database_url\n", "not a key name"),
            ("2FA_SECRET\n", "not a key name"),
            ("DATABASE URL\n", "not a key name"),
            ("DATABASE_URL\nDATABASE_URL\n", "DATABASE_URL is listed twice"),
            ("DATABASE_URL\nDOPPLER_CONFIG\n", "DOPPLER_CONFIG is Doppler's own label"),
            ("# nothing listed\n", "lists no names"),
        ]:
            with self.subTest(text=text):
                with self.assertRaises(ValueError) as caught:
                    app_keys.app_keys(self.write(text))
                self.assertIn(error, str(caught.exception))
                self.assertNotIn("hunter2", str(caught.exception))


class TheReleaseList(unittest.TestCase):
    def write(self, text):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = os.path.join(folder.name, "release-keys.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def test_the_repositorys_list_names_the_pipelines_three_credentials(self):
        self.assertEqual(app_keys.release_keys(), RELEASE)

    def test_a_credential_is_never_an_app_key_or_a_label(self):
        for text, error in [
            ("VERCEL_TOKEN\nDATABASE_URL\n", "DATABASE_URL is listed in app-keys.txt too"),
            ("VERCEL_TOKEN\nDOPPLER_PROJECT\n", "DOPPLER_PROJECT is Doppler's own label"),
            ("# nothing listed\n", "lists no names"),
            ("VERCEL_TOKEN=made-up-value\n", "not a key name"),
        ]:
            with self.subTest(text=text):
                with self.assertRaises(ValueError) as caught:
                    app_keys.release_keys(self.write(text), app=APP)
                self.assertIn(error, str(caught.exception))
                self.assertNotIn("made-up-value", str(caught.exception))

    def test_staging_only_keys_are_app_keys_whose_line_says_never_prd(self):
        app = app_keys.app_keys()
        self.assertLessEqual(app_keys.STAGING_ONLY, app)
        with open(app_keys.APP_KEYS, encoding="utf-8") as f:
            lines = {line.split()[0]: line for line in f if line.strip() and not line.startswith("#")}
        for name in app_keys.STAGING_ONLY:
            self.assertIn("never prd", lines[name])


class ProductionsRule(unittest.TestCase):
    def test_productions_app_keys_and_the_pipelines_credentials_pass(self):
        self.assertEqual(app_keys.production_problems(config(*RELEASE), APP | {STAGING}, RELEASE), [])

    def test_a_tool_token_in_production_fails(self):
        found = app_keys.production_problems(config("EXPO_TOKEN", *RELEASE), APP, RELEASE)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].startswith("EXPO_TOKEN, in prd_release: neither one of the app's keys"), found[0])
        self.assertIn("release-keys.txt", found[0])
        self.assertIn("hrizzup-tools/claude", found[0])

    def test_an_app_key_only_staging_uses_fails_in_production(self):
        found = app_keys.production_problems(config(STAGING), APP | {STAGING}, RELEASE)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].startswith("AUTH_RELAY_SECRET, in prd_release: one of the app's keys, "
                                            "but staging's and the previews' alone"), found[0])

    def test_the_pipelines_credentials_fail_in_vercels_production_settings(self):
        where = "Vercel's production settings"
        found = app_keys.production_problems(config("VERCEL_TOKEN"), APP, RELEASE, where, credentials_allowed=False)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].startswith(f"VERCEL_TOKEN, in {where}: one of the release pipeline's own "
                                            "credentials"), found[0])
        self.assertIn("prd_release alone", found[0])
        self.assertEqual(app_keys.production_problems(config(), APP, RELEASE, where, credentials_allowed=False), [])

    def test_dopplers_labels_pass_in_production_too(self):
        self.assertEqual(app_keys.production_problems(LABELS, APP, RELEASE), [])


class TheRule(unittest.TestCase):
    def test_the_app_keys_and_dopplers_labels_pass(self):
        self.assertEqual(app_keys.problems({"stg": config(), "stg_preview": config(), "dev": config()},
                                           APP, TOOLS, LOCAL), [])

    def test_a_stray_name_in_stg_fails(self):
        found = app_keys.problems({"stg": config("EXPO_TOKEN"), "stg_preview": config(), "dev": config()}, APP)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].startswith("EXPO_TOKEN, in stg: not one of the app's keys"), found[0])
        self.assertIn("hrizzup-tools/claude", found[0])
        self.assertIn('"Where each kind of key lives"', found[0])

    def test_each_config_is_checked(self):
        for stray_in in ("stg", "stg_preview", "dev"):
            with self.subTest(config=stray_in):
                configs = {"stg": config(), "stg_preview": config(), "dev": config()}
                configs[stray_in] = config("SOME_SERVICE_TOKEN")
                found = app_keys.problems(configs, APP)
                self.assertEqual(len(found), 1)
                self.assertTrue(found[0].startswith(f"SOME_SERVICE_TOKEN, in {stray_in}:"), found[0])

    def test_one_line_names_every_config_holding_it(self):
        found = app_keys.problems({"stg": config("EXPO_TOKEN"), "stg_preview": config("EXPO_TOKEN"),
                                   "dev": config()}, APP)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].startswith("EXPO_TOKEN, in stg and stg_preview:"), found[0])

    def test_only_dopplers_three_labels_are_let_through(self):
        found = app_keys.problems({"stg": config("DOPPLER_TOKEN")}, APP)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].startswith("DOPPLER_TOKEN, in stg:"), found[0])

    def test_a_stray_that_hrizzup_tools_also_holds_says_so(self):
        found = app_keys.problems({"stg": config("EXPO_TOKEN")}, APP, TOOLS)
        self.assertEqual(len(found), 1)
        self.assertIn("not one of the app's keys (infra/doppler/app-keys.txt); hrizzup-tools holds the same name",
                      found[0])

    def test_a_name_hrizzup_tools_holds_fails_even_when_listed(self):
        found = app_keys.problems({"stg": config("VERCEL_TOKEN")}, APP | {"VERCEL_TOKEN"}, TOOLS)
        self.assertEqual(found, [
            "VERCEL_TOKEN, in stg: listed in app-keys.txt, yet hrizzup-tools holds the same name. "
            "A tool token is never one of the app's keys (runbook Part 4, \"Where each kind of key lives\")"])

    def test_the_list_may_not_name_a_tool_token_even_unused(self):
        found = app_keys.problems({"stg": config()}, APP | {"CLOUDFLARE_API_TOKEN"}, TOOLS)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].startswith("CLOUDFLARE_API_TOKEN: listed in app-keys.txt, yet hrizzup-tools"),
                        found[0])

    def test_a_dev_override_must_be_an_app_key(self):
        found = app_keys.problems({"dev": config()}, APP, TOOLS, LOCAL | {"EXPO_TOKEN"})
        self.assertEqual(found, ["EXPO_TOKEN: dev-overrides.txt lists it, but it isn't one of the app's keys"])


class TheJobsCheck(unittest.TestCase):
    """`app_keys.py check <config>`, as a GitHub job runs it before loading the config."""

    def run_check(self, fetch, environ=None, argv=("check", "stg")):
        environ = {"DOPPLER_TOKEN": TOKEN} if environ is None else environ
        with mock.patch.object(app_keys, "app_keys", return_value=APP):
            return captured(app_keys.main, list(argv), environ, fetch)

    def test_a_stray_name_stops_the_job(self):
        code, out = self.run_check(lambda token: config("EXPO_TOKEN"))
        self.assertEqual(code, 1)
        self.assertIn("FAILED: stg holds names that aren't the app's keys, so this job stops before loading it", out)
        self.assertIn("EXPO_TOKEN, in stg: not one of the app's keys", out)
        self.assertNotIn(TOKEN, out)

    def test_only_the_app_keys_let_the_job_go_on(self):
        seen = []
        code, out = self.run_check(lambda token: seen.append(token) or config())
        self.assertEqual(code, 0)
        self.assertEqual(seen, [TOKEN])
        self.assertIn("OK: stg holds only the app's keys (3 names, besides Doppler's own labels).", out)

    def test_no_token_fails(self):
        code, out = self.run_check(lambda token: config(), environ={})
        self.assertEqual(code, 1)
        self.assertIn("no DOPPLER_TOKEN", out)

    def test_doppler_failing_fails_the_job(self):
        def refused(token):
            raise RuntimeError("Doppler refused the names request (HTTP 401)")
        code, out = self.run_check(refused)
        self.assertEqual(code, 1)
        self.assertIn("FAILED: Doppler refused the names request (HTTP 401)", out)
        self.assertNotIn(TOKEN, out)

    def test_anything_but_check_and_a_config_is_refused(self):
        for argv in ((), ("check",), ("apply", "stg"), ("check", "stg", "dev")):
            with self.subTest(argv=argv):
                code, _ = self.run_check(lambda token: config(), argv=argv)
                self.assertEqual(code, 2)


class TheReleasePipelinesChecks(unittest.TestCase):
    """`check prd_release` before the pipeline loads production's keys, and `vercel production`
    before it changes production."""

    VERCEL = {"VERCEL_TOKEN": "made-up-vercel-token", "VERCEL_PROJECT_ID": "prj_madeup", "VERCEL_ORG_ID": "team_madeup"}
    LOADED = {**VERCEL, **{name: f"made-up-value-of-{name}" for name in APP},
              "DOPPLER_CONFIG": "prd_release"}  # prd_release, loaded by the pipeline

    def run_main(self, argv, environ, fetch=None, vercel=None):
        with mock.patch.object(app_keys, "app_keys", return_value=APP | {STAGING}), \
                mock.patch.object(app_keys, "release_keys", return_value=RELEASE):
            return captured(app_keys.main, list(argv), environ, fetch, vercel)

    def test_productions_keys_and_the_pipelines_let_the_release_go_on(self):
        code, out = self.run_main(("check", "prd_release"), {"DOPPLER_TOKEN": TOKEN},
                                  fetch=lambda token: config(*RELEASE))
        self.assertEqual(code, 0, out)
        self.assertIn("OK: prd_release holds only production's app keys and the release pipeline's own "
                      "credentials (6 names, besides Doppler's own labels).", out)

    def test_a_stray_name_stops_the_release_before_it_loads_the_keys(self):
        for stray in ("EXPO_TOKEN", STAGING):
            with self.subTest(stray=stray):
                code, out = self.run_main(("check", "prd_release"), {"DOPPLER_TOKEN": TOKEN},
                                          fetch=lambda token: config(stray, *RELEASE))
                self.assertEqual(code, 1)
                self.assertIn("FAILED: prd_release holds names production mustn't hold, so this job stops "
                              "before loading it", out)
                self.assertIn(f"{stray}, in prd_release:", out)
                self.assertNotIn(TOKEN, out)

    def test_vercels_production_settings_with_the_app_keys_alone_pass(self):
        asked = []

        def vercel(token, project, team, environment):
            asked.append((token, project, team, environment))
            return config()

        code, out = self.run_main(("vercel", "production"), dict(self.LOADED), vercel=vercel)
        self.assertEqual(code, 0, out)
        self.assertEqual(asked, [("made-up-vercel-token", "prj_madeup", "team_madeup", "production")])
        self.assertIn("OK: Vercel's production settings hold only production's app keys, all 3 that prd holds "
                      "(3 names).", out)
        self.assertNotIn("made-up-value", out)

    def test_a_credential_in_prd_stops_the_release_before_it_changes_production(self):
        code, out = self.run_main(("vercel", "production"), dict(self.LOADED),
                                  vercel=lambda *args: config("SUPABASE_ACCESS_TOKEN"))
        self.assertEqual(code, 1)
        self.assertIn("FAILED: Vercel's production settings don't hold exactly production's app keys, so "
                      "production isn't changed", out)
        self.assertIn("SUPABASE_ACCESS_TOKEN, in Vercel's production settings: one of the release pipeline's", out)
        self.assertNotIn("made-up-vercel-token", out)

    def test_an_empty_or_partial_answer_never_passes(self):
        for answer, missing in ((LABELS, sorted(APP)), (config()[1:], [sorted(APP)[0]])):
            with self.subTest(answer=answer):
                code, out = self.run_main(("vercel", "production"), dict(self.LOADED), vercel=lambda *args: answer)
                self.assertEqual(code, 1)
                for name in missing:
                    self.assertIn(f"{name}, which prd holds, is missing from Vercel's production settings", out)

    def test_it_runs_only_in_the_pipeline_with_prd_release_loaded_and_never_asks_vercel_otherwise(self):
        for environ in (dict(self.VERCEL), {**self.LOADED, "DOPPLER_CONFIG": "stg"},
                        {k: v for k, v in self.LOADED.items() if k != "DOPPLER_CONFIG"},
                        {**self.VERCEL, "DOPPLER_CONFIG": "prd_release"}):
            with self.subTest(environ=sorted(environ)):
                asked = []
                code, out = self.run_main(("vercel", "production"), environ,
                                          vercel=lambda *args: asked.append(args) or config())
                self.assertEqual(code, 1)
                self.assertIn("are read only by the release pipeline, with prd_release loaded", out)
                self.assertEqual(asked, [], "Vercel must not be contacted")

    def test_a_staging_only_key_loaded_in_production_isnt_asked_of_vercel(self):
        loaded = {**self.LOADED, STAGING: "made-up"}  # 1a refuses it before loading; here only Vercel's side
        code, out = self.run_main(("vercel", "production"), loaded, vercel=lambda *args: config())
        self.assertEqual(code, 0, out)

    def test_staging_keeps_staging_rule(self):
        code, out = self.run_main(("vercel", "staging"), dict(self.VERCEL), vercel=lambda *args: config(STAGING))
        self.assertEqual(code, 0, out)
        code, out = self.run_main(("vercel", "staging"), dict(self.VERCEL),
                                  vercel=lambda *args: config(STAGING, "VERCEL_TOKEN"))
        self.assertEqual(code, 1)
        self.assertIn("VERCEL_TOKEN, in Vercel's staging settings: not one of the app's keys", out)
        code, out = self.run_main(("vercel", "staging"), dict(self.VERCEL), vercel=lambda *args: config())
        self.assertEqual(code, 1)
        self.assertIn("AUTH_RELAY_SECRET, one of the app's keys, is missing from Vercel's staging settings", out)

    def test_the_vercel_check_needs_its_token_and_project(self):
        for missing in self.VERCEL:
            with self.subTest(missing=missing):
                environ = {k: v for k, v in self.VERCEL.items() if k != missing}
                code, out = self.run_main(("vercel", "production"), environ, vercel=lambda *args: config())
                self.assertEqual(code, 1)
                self.assertIn(f"FAILED: no {missing}", out)

    def test_only_production_and_staging_are_read_from_vercel(self):
        for argv in (("vercel", "preview"), ("vercel",), ("vercel", "production", "staging")):
            with self.subTest(argv=argv):
                code, _ = self.run_main(argv, dict(self.VERCEL), vercel=lambda *args: config())
                self.assertEqual(code, 2)


class VercelsSettings(unittest.TestCase):
    """`vercel_names`, against a made-up Vercel: names only, never a value."""

    ENTRIES = [
        {"key": "DATABASE_URL", "target": ["production"], "type": "sensitive", "value": "made-up-value-1"},
        {"key": "SUPABASE_URL", "target": ["production", "preview"], "type": "encrypted", "value": "made-up-value-2"},
        {"key": "REDIS_KEY_PREFIX", "target": ["preview"], "type": "sensitive", "value": ""},
        {"key": "AUTH_RELAY_SECRET", "target": [], "customEnvironmentIds": ["env_staging"], "type": "sensitive",
         "value": ""},
    ]

    def call(self, environment, *answers):
        requests = []

        def urlopen(request, timeout):
            requests.append(request)
            answer = answers[len(requests) - 1]
            if isinstance(answer, Exception):
                raise answer
            return Answer(json.dumps(answer).encode())

        with mock.patch.object(app_keys.urllib.request, "urlopen", urlopen), \
                mock.patch.object(app_keys.time, "sleep"):
            try:
                return app_keys.vercel_names("made-up-vercel-token", "prj_madeup", "team_madeup", environment), requests
            except RuntimeError as e:
                return e, requests

    def test_production_is_read_from_its_own_entries_alone(self):
        names, requests = self.call("production", {"envs": self.ENTRIES})
        self.assertEqual(names, ["DATABASE_URL", "SUPABASE_URL"])
        self.assertEqual(requests[0].full_url, "https://api.vercel.com/v10/projects/prj_madeup/env?teamId=team_madeup")
        self.assertEqual(requests[0].get_header("Authorization"), "Bearer made-up-vercel-token")

    def test_staging_is_asked_for_alone(self):
        staging = [e for e in self.ENTRIES if e.get("customEnvironmentIds")]
        names, requests = self.call("staging", {"envs": staging, "hiddenProductionEnvCount": 2})
        self.assertIn("customEnvironmentSlug=staging", requests[0].full_url)
        self.assertEqual(names, ["AUTH_RELAY_SECRET"])

    def test_an_answer_for_staging_holding_productions_settings_fails(self):
        error, _ = self.call("staging", {"envs": self.ENTRIES})
        self.assertIsInstance(error, RuntimeError)
        self.assertIn("holds production's settings", str(error))
        self.assertNotIn("DATABASE_URL", str(error))

    def test_a_setting_whose_environments_cant_be_read_fails(self):
        for entry in ({"key": "VERCEL_TOKEN"}, {"key": "VERCEL_TOKEN", "target": None},
                      {"key": "VERCEL_TOKEN", "target": []}, {"key": "VERCEL_TOKEN", "target": [1]},
                      {"key": "VERCEL_TOKEN", "target": [], "customEnvironmentIds": "env_x"}):
            with self.subTest(entry=entry):
                error, _ = self.call("production", {"envs": self.ENTRIES + [entry]})
                self.assertIsInstance(error, RuntimeError)
                self.assertIn("can't be read", str(error))

    def test_a_target_given_as_one_word_counts(self):
        names, _ = self.call("production", {"envs": [{"key": "DATABASE_URL", "target": "production"}]})
        self.assertEqual(names, ["DATABASE_URL"])

    def test_production_settings_hidden_from_the_token_fail(self):
        for hidden in (1, 3):
            with self.subTest(hidden=hidden):
                error, _ = self.call("production", {"envs": self.ENTRIES, "hiddenProductionEnvCount": hidden})
                self.assertIsInstance(error, RuntimeError)
                self.assertIn("hides some of production's settings", str(error))
        names, _ = self.call("production", {"envs": self.ENTRIES, "hiddenProductionEnvCount": 0})
        self.assertEqual(names, ["DATABASE_URL", "SUPABASE_URL"])

    def test_vercel_is_never_asked_to_decrypt_and_no_value_is_returned(self):
        names, requests = self.call("production", {"envs": self.ENTRIES})
        self.assertNotIn("decrypt", requests[0].full_url)
        self.assertFalse(any("made-up-value" in name for name in names))

    def test_a_busy_vercel_is_asked_again_and_a_refusal_is_not(self):
        busy = urllib.error.HTTPError("https://api.vercel.com/", 503, "made up", {}, None)
        names, requests = self.call("production", busy, {"envs": self.ENTRIES})
        self.assertEqual(len(requests), 2)
        refused = urllib.error.HTTPError("https://api.vercel.com/", 403, "made up", {}, None)
        error, requests = self.call("production", refused)
        self.assertEqual(str(error), "Vercel refused the settings request (HTTP 403)")
        self.assertEqual(len(requests), 1)
        self.assertNotIn("made-up-vercel-token", str(error))

    def test_every_page_is_read(self):
        first = {"envs": self.ENTRIES[:1], "pagination": {"count": 1, "next": 1700000000000, "prev": None}}
        second = {"envs": [{"key": "EXPO_TOKEN", "target": ["production"], "type": "sensitive", "value": ""}],
                  "pagination": {"count": 1, "next": None, "prev": 1700000000000}}
        names, requests = self.call("production", first, second)
        self.assertEqual(names, ["DATABASE_URL", "EXPO_TOKEN"])
        self.assertIn("until=1700000000000", requests[1].full_url)

    def test_paging_vercel_doesnt_describe_fails_cleanly(self):
        for paging in ("next", ["a"], {"next": {"a": 1}}, {"next": True}):
            with self.subTest(paging=paging):
                error, _ = self.call("production", {"envs": self.ENTRIES[:1], "pagination": paging})
                self.assertIsInstance(error, RuntimeError)

    def test_a_broken_off_answer_is_asked_again_then_fails_cleanly(self):
        broken = http.client.IncompleteRead(b"{")
        names, requests = self.call("production", broken, {"envs": self.ENTRIES})
        self.assertEqual(len(requests), 2)
        error, requests = self.call("production", broken, broken, broken)
        self.assertEqual(str(error), "Vercel's settings request failed (IncompleteRead)")

    def test_paging_that_doesnt_move_on_fails_rather_than_missing_names(self):
        stuck = {"envs": self.ENTRIES[:1], "pagination": {"count": 1, "next": 1700000000000, "prev": None}}
        error, requests = self.call("production", stuck, stuck)
        self.assertIsInstance(error, RuntimeError)
        self.assertIn("doesn't move on", str(error))

    def test_an_answer_that_isnt_a_list_of_settings_fails(self):
        for answer in ({"envs": "x"}, {"envs": [{"value": "made-up"}]}, {"error": {}}, [{"key": "DATABASE_URL"}]):
            with self.subTest(answer=answer):
                error, _ = self.call("production", answer)
                self.assertIsInstance(error, RuntimeError)


class Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class DopplersNamesEndpoint(unittest.TestCase):
    """`doppler_names`, against a made-up Doppler: names only, through the token's own config."""

    def call(self, *answers):
        requests = []

        def urlopen(request, timeout):
            requests.append(request)
            answer = answers[len(requests) - 1]
            if isinstance(answer, Exception):
                raise answer
            return Answer(json.dumps(answer).encode())

        with mock.patch.object(app_keys.urllib.request, "urlopen", urlopen), \
                mock.patch.object(app_keys.time, "sleep"):
            try:
                return app_keys.doppler_names(TOKEN), requests
            except RuntimeError as e:
                return e, requests

    def busy(self, code):
        return urllib.error.HTTPError(app_keys.NAMES_ENDPOINT, code, "made up", {}, None)

    def test_it_asks_for_names_alone_with_the_token(self):
        names, requests = self.call({"names": config(), "success": True})
        self.assertEqual(sorted(names), sorted(config()))
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].full_url, "https://api.doppler.com/v3/configs/config/secrets/names")
        self.assertEqual(requests[0].get_method(), "GET")
        self.assertEqual(requests[0].get_header("Authorization"), f"Bearer {TOKEN}")

    def test_an_answer_that_isnt_a_whole_configs_names_fails(self):
        for answer in ({"names": []}, {"names": sorted(APP)}, {"success": True}, ["DATABASE_URL"],
                       {"names": [1, 2]}):
            with self.subTest(answer=answer):
                error, _ = self.call(answer)
                self.assertIsInstance(error, RuntimeError)

    def test_a_busy_doppler_is_asked_again(self):
        names, requests = self.call(self.busy(503), urllib.error.URLError("dropped"), {"names": config()})
        self.assertEqual(sorted(names), sorted(config()))
        self.assertEqual(len(requests), 3)

    def test_a_doppler_still_busy_after_three_tries_fails(self):
        error, requests = self.call(self.busy(503), self.busy(429), self.busy(502))
        self.assertEqual(str(error), "Doppler refused the names request (HTTP 502)")
        self.assertEqual(len(requests), 3)

    def test_a_refusal_is_not_asked_again(self):
        error, requests = self.call(self.busy(401))
        self.assertEqual(str(error), "Doppler refused the names request (HTTP 401)")
        self.assertEqual(len(requests), 1)
        self.assertNotIn(TOKEN, str(error))


class FakeDoppler:
    """hrizzup's stg and dev with made-up values; stg_preview's and hrizzup-tools' names alone.
    Records every command that would change a config."""

    def __init__(self, stg_extra=(), dev_extra=None, tools=TOOLS):
        def secret(value):
            return {"raw": value, "computed": value}
        self.stg = {name: secret(f"made-up-value-of-{name}") for name in APP}
        self.stg.update({name: secret(f"made-up-value-of-{name}") for name in stg_extra})
        self.stg.update({label: secret("stg") for label in LABELS})
        self.dev = {name: {"raw": "${stg.%s}" % name, "computed": self.stg[name]["computed"]}
                    for name in APP - LOCAL}
        self.dev.update({name: secret("dev") for name in LOCAL | set(LABELS)})
        self.dev.update(dev_extra or {})
        self.tools, self.changes = tools, []

    def secrets(self, config):
        return {"stg": self.stg, "dev": self.dev}[config]

    def names(self, account):
        return {"hrizzup/stg_preview": list(self.stg), "hrizzup-tools/claude": list(self.tools)}[account]

    def doppler(self, config, *args):
        self.changes.append((config, *args))
        return ""

    def run(self, action, app=APP):
        with mock.patch.multiple(dev_follows_staging, secrets=self.secrets, names=self.names,
                                 doppler=self.doppler, lists=lambda: (app, set(LOCAL))):
            return captured(getattr(dev_follows_staging, action))


class DevFollowsStaging(unittest.TestCase):
    """`dev_follows_staging.py check` and `apply`, against a made-up Doppler."""

    def test_check_passes_when_hrizzup_holds_only_the_app_keys(self):
        code, out = FakeDoppler().run("check")
        self.assertEqual(code, 0, out)
        self.assertIn("OK: stg, stg_preview and dev hold only the app's keys (3 listed in app-keys.txt)", out)
        self.assertIn("OK: dev follows staging: 2 references to stg, 1 local overrides", out)

    def test_check_fails_on_a_tool_token_in_stg_and_shows_no_value(self):
        code, out = FakeDoppler(stg_extra=["EXPO_TOKEN"]).run("check")
        self.assertEqual(code, 1)
        self.assertIn("EXPO_TOKEN, in stg and stg_preview: not one of the app's keys", out)
        self.assertNotIn("EXPO_TOKEN: missing from dev", out)  # dev never follows a stray
        self.assertNotIn("made-up-value", out)

    def test_check_fails_on_a_name_hrizzup_tools_holds(self):
        code, out = FakeDoppler(stg_extra=["VERCEL_TOKEN"]).run("check", app=APP | {"VERCEL_TOKEN"})
        self.assertEqual(code, 1)
        self.assertIn("VERCEL_TOKEN, in stg and stg_preview: listed in app-keys.txt, yet hrizzup-tools holds", out)

    def test_check_fails_on_a_listed_name_stg_doesnt_hold(self):
        code, out = FakeDoppler().run("check", app=APP | {"TURNSTILE_SITE_KEY"})
        self.assertEqual(code, 1)
        self.assertIn("TURNSTILE_SITE_KEY: listed in app-keys.txt, but stg doesn't hold it", out)

    def test_apply_never_gives_dev_a_reference_to_a_stray(self):
        fake = FakeDoppler(stg_extra=["EXPO_TOKEN"], dev_extra={"SUPABASE_URL": {"raw": "copied", "computed": "copied"}})
        code, out = fake.run("apply")
        self.assertEqual(code, 1)  # its check still fails on the stray in stg
        self.assertEqual(fake.changes, [("dev", "secrets", "set", "SUPABASE_URL=${stg.SUPABASE_URL}",
                                         "--no-interactive", "--silent")])
        self.assertIn("left out of dev (in stg, but not the app's keys): EXPO_TOKEN", out)
        self.assertNotIn("made-up-value", out)

    def test_apply_deletes_a_stray_reference_from_dev(self):
        fake = FakeDoppler(stg_extra=["EXPO_TOKEN"],
                           dev_extra={"EXPO_TOKEN": {"raw": "${stg.EXPO_TOKEN}", "computed": "made-up-value"}})
        fake.run("apply")
        self.assertEqual(fake.changes, [("dev", "secrets", "delete", "EXPO_TOKEN", "--yes", "--silent")])

    def test_apply_changes_dev_alone(self):
        fake = FakeDoppler(stg_extra=["EXPO_TOKEN"], dev_extra={
            "OLD_KEY": {"raw": "${stg.OLD_KEY}", "computed": "${stg.OLD_KEY}"}})
        fake.dev.pop("DATABASE_URL")
        fake.run("apply", app=APP | {"OLD_KEY"})
        self.assertEqual([change[0] for change in fake.changes], ["dev", "dev"])
        self.assertEqual(fake.changes[0][1:4], ("secrets", "set", "DATABASE_URL=${stg.DATABASE_URL}"))
        self.assertEqual(fake.changes[1][1:4], ("secrets", "delete", "OLD_KEY"))


if __name__ == "__main__":
    unittest.main()
