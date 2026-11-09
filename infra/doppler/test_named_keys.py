"""Tests for running a command with a few of the app's keys, by name (named_keys.py): offline,
with made-up names, values and tokens, and no calls to Doppler.

    python3 -m unittest discover -s infra/doppler

Only the app's keys can be asked for; exactly those are given to the command, never the token;
in GitHub's runners each value is masked before the command starts; nothing prints a value.
"""
import contextlib
import io
import json
import unittest
import urllib.error
from unittest import mock

import named_keys

APP = frozenset({"SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL"})
TOKEN = "dp.st.made-up-token"
VALUES = {"SUPABASE_URL": "https://made-up.supabase.example", "SUPABASE_PUBLISHABLE_KEY": "made-up-publishable",
          "SUPABASE_SECRET_KEY": "made-up-secret"}
NAMES = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]
COMMAND = ["pnpm", "exec", "playwright", "test"]


class Runner:
    def __init__(self, values=VALUES):
        self.values, self.asked, self.ran = values, [], []

    def get(self, token, names):
        self.asked.append((token, list(names)))
        missing = [n for n in names if n not in self.values]
        if missing:
            raise RuntimeError(f"the config has no value for {', '.join(missing)}")
        return {n: self.values[n] for n in names}

    def run(self, file, args, env):
        self.ran.append((file, list(args), dict(env)))
        return 0

    def main(self, argv, environ=None):
        environ = {"DOPPLER_TOKEN": TOKEN, "PATH": "/usr/bin", "BASE_URL": "https://preview.example"} \
            if environ is None else environ
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(named_keys.app_keys, "app_keys", return_value=APP), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = named_keys.main(list(argv), environ, self.get, self.run)
        return code, out.getvalue(), err.getvalue()


class AskingByName(unittest.TestCase):
    def test_the_command_gets_exactly_the_named_keys_and_not_the_token(self):
        runner = Runner()
        code, out, err = runner.main([*NAMES, "--", *COMMAND])
        self.assertEqual(code, 0)
        self.assertEqual(runner.asked, [(TOKEN, NAMES)])
        (file, args, env), = runner.ran
        self.assertEqual((file, args), ("pnpm", COMMAND))
        self.assertNotIn("DOPPLER_TOKEN", env)
        self.assertEqual({k: env[k] for k in NAMES}, VALUES)
        self.assertEqual(env["BASE_URL"], "https://preview.example")  # the job's own variables stay
        self.assertNotIn("DATABASE_URL", env)
        self.assertIn("Running with 3 of the config's keys, by name: SUPABASE_URL,", err)
        for value in VALUES.values():
            self.assertNotIn(value, out + err)
        self.assertNotIn(TOKEN, out + err)

    def test_values_are_masked_in_githubs_runners_before_the_command_starts(self):
        runner = Runner()
        code, out, _ = runner.main([*NAMES, "--", *COMMAND], {"DOPPLER_TOKEN": TOKEN, "GITHUB_ACTIONS": "true"})
        self.assertEqual(code, 0)
        self.assertEqual(sorted(out.splitlines()), sorted(f"::add-mask::{v}" for v in VALUES.values()))

    def test_a_value_on_several_lines_is_masked_line_by_line(self):
        out = io.StringIO()
        named_keys.mask(["first line\nsecond line\n"], out)
        self.assertEqual(out.getvalue(), "::add-mask::first line\n::add-mask::second line\n")

    def test_anything_but_the_apps_keys_is_refused_before_doppler_is_asked(self):
        for names in (["EXPO_TOKEN"], ["SUPABASE_URL", "VERCEL_TOKEN"], ["SUPABASE_URL", "SUPABASE_URL"]):
            with self.subTest(names=names):
                runner = Runner()
                code, _, err = runner.main([*names, "--", *COMMAND])
                self.assertEqual(code, 2)
                self.assertEqual((runner.asked, runner.ran), ([], []))
                self.assertIn("only the app's keys", err)

    def test_no_token_or_no_command_fails_without_running_anything(self):
        for argv, environ, code in (
            ([*NAMES, "--", *COMMAND], {}, 1),
            ([*NAMES, "--"], None, 2),
            (["--", *COMMAND], None, 2),
            ([*NAMES, *COMMAND], None, 2),
        ):
            with self.subTest(argv=argv):
                runner = Runner()
                self.assertEqual(runner.main(argv, environ)[0], code)
                self.assertEqual(runner.ran, [])

    def test_a_key_the_config_lacks_fails_without_running_anything(self):
        runner = Runner(values={"SUPABASE_URL": "https://made-up.supabase.example"})
        code, _, err = runner.main([*NAMES, "--", *COMMAND])
        self.assertEqual(code, 1)
        self.assertEqual(runner.ran, [])
        self.assertIn("no value for SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY", err)


class Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class DopplersDownloadEndpoint(unittest.TestCase):
    def call(self, *answers):
        requests = []

        def urlopen(request, timeout):
            requests.append(request)
            answer = answers[len(requests) - 1]
            if isinstance(answer, Exception):
                raise answer
            return Answer(json.dumps(answer).encode())

        with mock.patch.object(named_keys.urllib.request, "urlopen", urlopen), \
                mock.patch.object(named_keys.time, "sleep"):
            try:
                return named_keys.fetch(TOKEN, NAMES), requests
            except RuntimeError as e:
                return e, requests

    def test_it_asks_for_the_named_keys_alone_and_keeps_only_those(self):
        keys, requests = self.call({**VALUES, "DATABASE_URL": "made-up-extra", "DOPPLER_CONFIG": "stg_preview"})
        self.assertEqual(keys, VALUES)
        self.assertIn("secrets=SUPABASE_URL%2CSUPABASE_PUBLISHABLE_KEY%2CSUPABASE_SECRET_KEY", requests[0].full_url)
        self.assertIn("format=json", requests[0].full_url)
        self.assertEqual(requests[0].get_header("Authorization"), f"Bearer {TOKEN}")

    def test_a_busy_doppler_is_asked_again_and_a_refusal_is_not(self):
        busy = urllib.error.HTTPError(named_keys.DOWNLOAD, 503, "made up", {}, None)
        keys, requests = self.call(busy, VALUES)
        self.assertEqual((keys, len(requests)), (VALUES, 2))
        refused = urllib.error.HTTPError(named_keys.DOWNLOAD, 401, "made up", {}, None)
        error, requests = self.call(refused)
        self.assertEqual(str(error), "Doppler refused the request for the keys (HTTP 401)")
        self.assertEqual(len(requests), 1)
        self.assertNotIn(TOKEN, str(error))

    def test_an_empty_or_missing_value_fails(self):
        error, _ = self.call({**VALUES, "SUPABASE_SECRET_KEY": ""})
        self.assertIn("no value for SUPABASE_SECRET_KEY", str(error))
        error, _ = self.call(["not", "a", "config"])
        self.assertIsInstance(error, RuntimeError)


if __name__ == "__main__":
    unittest.main()
