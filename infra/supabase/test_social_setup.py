"""Tests for social_setup.py: what staging's database holds for social that no migration can (whether test stories
are allowed; where the minute job calls, and its secret). Run by the quick checks
(`python3 -m unittest discover -s infra/supabase`)."""
import hashlib
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import social_setup  # noqa: E402

# Plainly not a key: the Secret check (gitleaks) scans every branch for anything key-like.
SECRET = "test-secret-only-for-the-social-tests-xx"
ADDRESS = "postgresql://postgres.abcdefghijklmnopqrst:p%40ss%3Aword@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"


class Targets(unittest.TestCase):
    def test_only_staging(self):
        for environment in ("production", "preview", "dev", "local", "prd", ""):
            for command in ("apply", "check"):
                with mock.patch.dict(os.environ, {"SOCIAL_JOBS_SECRET": SECRET, "DATABASE_ADDRESS": ADDRESS}), \
                        mock.patch("subprocess.run") as ran, \
                        self.assertRaises(SystemExit) as refused:
                    social_setup.main([command, environment])
                self.assertIn("release pipeline", str(refused.exception))
                # Refused before anything runs: no database is reached.
                ran.assert_not_called()

    def test_the_jobs_address_is_staging_s(self):
        with mock.patch.dict(os.environ, {"SOCIAL_JOBS_SECRET": SECRET}):
            self.assertEqual(social_setup.jobs_values("staging"),
                             ("https://staging.hrizzup.com/api/jobs/social", SECRET))

    def test_a_secret_the_website_accepts_read_trimmed(self):
        with mock.patch.dict(os.environ, {"SOCIAL_JOBS_SECRET": f"  {SECRET}\n"}):
            self.assertEqual(social_setup.jobs_values("staging")[1], SECRET)
        for secret in ("", "short", "x" * 31, "has a space in it and is long enough!!", "quote'quote" * 4):
            with mock.patch.dict(os.environ, {"SOCIAL_JOBS_SECRET": secret}), \
                    self.assertRaises(SystemExit) as refused:
                social_setup.jobs_values("staging")
            # The refusal never repeats what it was given.
            if secret:
                self.assertNotIn(secret, str(refused.exception))

    def test_usage(self):
        printed = io.StringIO()
        with redirect_stdout(printed):
            for argv in ([], ["apply"], ["delete", "staging"], ["apply", "staging", "extra"]):
                self.assertEqual(social_setup.main(argv), 2)
        self.assertIn("usage: social_setup.py apply|check staging [--jobs]", printed.getvalue())


class Psql(unittest.TestCase):
    def run_main(self, argv, answers=None, version="psql (PostgreSQL) 18.3\n", returncode=0, secret=SECRET):
        """Runs main with every psql call recorded. `answers` is what each call prints, in order."""
        calls = []
        replies = list(answers if answers is not None else [])

        def run(command, **kwargs):
            if command == ["psql", "--version"]:
                return mock.Mock(returncode=0, stdout=version, stderr="")
            calls.append((command, kwargs))
            out = replies.pop(0) if replies else ""
            return mock.Mock(returncode=returncode, stdout=out, stderr="psql: error: boom\n")

        with mock.patch.dict(os.environ, {"DATABASE_ADDRESS": ADDRESS, "SOCIAL_JOBS_SECRET": secret}):
            printed = io.StringIO()
            with redirect_stdout(printed):
                code = social_setup.main(argv, run=run)
        return code, calls, printed.getvalue()

    def test_apply_turns_test_stories_on_and_sends_no_secret(self):
        code, calls, printed = self.run_main(["apply", "staging"], answers=["", "true\n"])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 2)  # the update, then the read back
        self.assertIn("update social.environment set test_stories = true", calls[0][1]["input"])
        for command, kwargs in calls:
            self.assertEqual(command[0], "psql")
            self.assertFalse(any(SECRET in part or "p@ss" in part for part in command))
            self.assertNotIn(SECRET, kwargs["input"])
            self.assertNotIn("vault", kwargs["input"])
            self.assertNotIn("DATABASE_ADDRESS", kwargs["env"])
            self.assertEqual(kwargs["env"]["PGPASSWORD"], "p@ss:word")
            self.assertEqual(kwargs["env"]["PGSSLMODE"], "verify-full")
        self.assertIn("test stories are on", printed)

    def test_apply_needs_no_secret_without_jobs(self):
        code, _, _ = self.run_main(["apply", "staging"], answers=["", "true\n"], secret="")
        self.assertEqual(code, 0)

    def test_apply_with_jobs_binds_the_secret_and_never_prints_it(self):
        code, calls, printed = self.run_main(
            ["apply", "staging", "--jobs"], answers=["", "", "true\n", "true true\n0 0 -\n"])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 4)  # the flag, vault, the flag read back, vault read back
        vault_input = calls[1][1]["input"]
        self.assertIn(f"\\set secret '{SECRET}'", vault_input)
        # In the statements themselves, only $1: the value goes as a bound parameter.
        statements = [line for line in vault_input.splitlines() if not line.startswith("\\set")]
        self.assertTrue(all(SECRET not in line for line in statements))
        self.assertIn("\\bind :secret \\g", vault_input)
        self.assertIn("social_jobs_url", vault_input)
        self.assertIn("social_jobs_secret", vault_input)
        for command, _ in calls:
            self.assertFalse(any(SECRET in part for part in command))
        # The check never sends the secret at all: only its SHA-256.
        check_input = calls[3][1]["input"]
        self.assertNotIn(SECRET, check_input)
        self.assertIn(hashlib.sha256(SECRET.encode()).hexdigest(), check_input)
        self.assertNotIn(SECRET, printed)
        self.assertIn("both match", printed)

    def test_check_changes_nothing(self):
        code, calls, _ = self.run_main(["check", "staging"], answers=["true\n3 0\n"])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("update ", calls[0][1]["input"])
        self.assertNotIn("vault", calls[0][1]["input"])
        # Nothing is saved again by a check: that is apply's.
        self.assertNotIn("alter_job", calls[0][1]["input"])

    def test_check_says_when_test_stories_are_off(self):
        code, _, printed = self.run_main(["check", "staging"], answers=["false\n3 0\n"])
        self.assertEqual(code, 1)
        self.assertIn("test stories are off", printed)

    def test_check_with_jobs_changes_nothing_and_says_what_differs(self):
        code, calls, printed = self.run_main(["check", "staging", "--jobs"], answers=["true\n1 0\n", "true false\n3 0 -\n"])
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 2)
        self.assertTrue(all("vault.create_secret" not in call[1]["input"] for call in calls))
        self.assertIn("address matches, the secret is missing or differs", printed)

    def test_a_schedule_whose_calls_fail_fails_the_check(self):
        code, _, printed = self.run_main(["check", "staging", "--jobs"], answers=["true\n1 0\n", "true true\n10 4 404,429\n"])
        self.assertEqual(code, 1)
        self.assertIn("answered 200 10 times and otherwise 4 times (answered 404,429)", printed)

    def test_apply_ends_by_saving_every_social_job_again_with_its_own_schedule(self):
        # On staging the scheduler missed the migration's two jobs until they were saved again unchanged.
        code, calls, printed = self.run_main(["apply", "staging"], answers=["2\n", "true\n"])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 2)  # the flag and the re-save together, then the read back
        saved = calls[0][1]["input"]
        self.assertIn("cron.alter_job(j.jobid, schedule := j.schedule)", saved)
        self.assertIn("where j.jobname like 'social-%'", saved)
        # Its own schedule and nothing else: no other setting is named, no job is made or removed.
        for other in ("command :=", "active :=", "username :=", "cron.schedule", "cron.unschedule"):
            self.assertNotIn(other, saved)
        # The flag is set first and the re-save is the input's last statement.
        self.assertLess(saved.index("update social.environment"), saved.index("cron.alter_job"))
        self.assertTrue(saved.rstrip().endswith("where j.jobname like 'social-%';"))
        self.assertIn("saved 2 social jobs again", printed)

    def test_apply_with_jobs_saves_the_jobs_again_last_after_vault(self):
        code, calls, _ = self.run_main(
            ["apply", "staging", "--jobs"], answers=["", "2\n", "true\n", "true true\n0 0 -\n"])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 4)
        vault_input = calls[1][1]["input"]
        self.assertLess(vault_input.index("social_jobs_secret"), vault_input.index("cron.alter_job"))
        # The re-save is never sent with the secret in its text: only as the bound parameter before it.
        self.assertNotIn(SECRET, "\n".join(line for line in vault_input.splitlines() if not line.startswith("\\set")))

    def test_apply_fails_when_there_is_no_social_job_to_save_again(self):
        code, _, printed = self.run_main(["apply", "staging"], answers=["0\n", "true\n"])
        self.assertEqual(code, 1)
        self.assertIn("no social job was found", printed)

    def test_check_fails_unless_the_minute_job_ran_in_the_last_three_minutes(self):
        code, calls, printed = self.run_main(["check", "staging"], answers=["true\n0 0\n"])
        self.assertEqual(code, 1)
        self.assertIn("social-minute hasn't run in the last 3 minutes", printed)
        self.assertIn("apply staging", printed)
        asked = calls[0][1]["input"]
        self.assertIn("j.jobname = 'social-minute'", asked)
        self.assertIn("interval '3 minutes'", asked)
        self.assertIn("cron.job_run_details", asked)

    def test_check_passes_when_it_ran_and_fails_when_a_run_failed(self):
        code, _, printed = self.run_main(["check", "staging"], answers=["true\n3 0\n"])
        self.assertEqual(code, 0)
        self.assertIn("social-minute ran 3 times in the last 3 minutes, none failed", printed)
        code, _, printed = self.run_main(["check", "staging"], answers=["true\n3 1\n"])
        self.assertEqual(code, 1)
        self.assertIn("1 failed", printed)

    def test_check_with_a_missing_answer_for_the_runs_fails_rather_than_passes(self):
        code, _, printed = self.run_main(["check", "staging"], answers=["true\n"])
        self.assertEqual(code, 1)
        self.assertIn("hasn't run", printed)

    def test_a_failed_psql_fails_without_its_input(self):
        with self.assertRaises(SystemExit) as failed:
            self.run_main(["apply", "staging", "--jobs"], returncode=3)
        self.assertNotIn(SECRET, str(failed.exception))

    def test_needs_psql_16_for_bind(self):
        with self.assertRaises(SystemExit) as refused:
            self.run_main(["apply", "staging"], version="psql (PostgreSQL) 15.4\n")
        self.assertIn("psql 16", str(refused.exception))

    def test_needs_the_address(self):
        with mock.patch.dict(os.environ, {"SOCIAL_JOBS_SECRET": SECRET}, clear=True), \
                self.assertRaises(SystemExit) as refused:
            social_setup.main(["check", "staging"])
        self.assertIn("database_url.py", str(refused.exception))


if __name__ == "__main__":
    unittest.main()
