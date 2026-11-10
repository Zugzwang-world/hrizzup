"""Tests for perps_jobs.py: where each environment's database calls for the perp's jobs, and the
secret it carries. Run by the quick checks (`python3 -m unittest discover -s infra/supabase`)."""
import hashlib
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import perps_jobs  # noqa: E402

# Plainly not a key: the Secret check (gitleaks) scans every branch for anything key-like.
SECRET = "test-secret-only-for-the-jobs-tests-x"
ADDRESS = "postgresql://postgres.abcdefghijklmnopqrst:p%40ss%3Aword@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"


class Values(unittest.TestCase):
    def test_staging_only(self):
        with mock.patch.dict(os.environ, {"PERP_JOBS_SECRET": SECRET}):
            self.assertEqual(perps_jobs.values("staging"),
                             ("https://staging.hrizzup.com/api/jobs/perps", SECRET))
            for environment in ("production", "preview", "dev"):
                with self.assertRaises(SystemExit) as refused:
                    perps_jobs.values(environment)
                self.assertIn("release pipeline", str(refused.exception))

    def test_a_secret_the_website_accepts_read_trimmed(self):
        with mock.patch.dict(os.environ, {"PERP_JOBS_SECRET": f"  {SECRET}\n"}):
            self.assertEqual(perps_jobs.values("staging")[1], SECRET)
        for secret in ("", "short", "x" * 31, "has a space in it and is long enough!!", "quote'quote" * 4):
            with mock.patch.dict(os.environ, {"PERP_JOBS_SECRET": secret}), \
                    self.assertRaises(SystemExit) as refused:
                perps_jobs.values("staging")
            # The refusal never repeats what it was given.
            if secret:
                self.assertNotIn(secret, str(refused.exception))


class Connection(unittest.TestCase):
    def test_the_address_as_libpq_variables(self):
        env = perps_jobs.connection(ADDRESS + "?sslmode=require")
        self.assertEqual(env, {
            "PGHOST": "aws-0-ap-south-1.pooler.supabase.com",
            "PGPORT": "5432",
            "PGUSER": "postgres.abcdefghijklmnopqrst",
            "PGPASSWORD": "p@ss:word",
            "PGDATABASE": "postgres",
            "PGSSLMODE": "require",
        })

    def test_refuses_what_is_not_an_address(self):
        for address in ("", "mysql://a:b@c/d", "postgres:///nohost"):
            with self.assertRaises(SystemExit):
                perps_jobs.connection(address)


class Psql(unittest.TestCase):
    def run_main(self, command="apply", answers=("true true\n0 0 -\n",), version="psql (PostgreSQL) 18.3\n",
                 returncode=0):
        calls = []
        replies = list(answers)

        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            if argv == ["psql", "--version"]:
                return mock.Mock(returncode=0, stdout=version, stderr="")
            out = replies.pop(0) if "secret_sha256" in kwargs["input"] and replies else ""
            return mock.Mock(returncode=returncode, stdout=out, stderr="psql: error: boom\n")

        with mock.patch.dict(os.environ, {"DATABASE_ADDRESS": ADDRESS, "PERP_JOBS_SECRET": SECRET}):
            printed = io.StringIO()
            with redirect_stdout(printed):
                code = perps_jobs.main([command, "staging"], run=run)
        return code, [c for c in calls if c[0] != ["psql", "--version"]], printed.getvalue()

    def test_the_secret_only_bound_never_in_a_statement_a_command_line_or_the_output(self):
        code, calls, printed = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 2)  # apply, then check
        for argv, kwargs in calls:
            self.assertEqual(argv[0], "psql")
            self.assertFalse(any(SECRET in part or "p@ss" in part for part in argv))
            self.assertNotIn("DATABASE_ADDRESS", kwargs["env"])
            self.assertEqual(kwargs["env"]["PGPASSWORD"], "p@ss:word")
            self.assertEqual(kwargs["env"]["PGSSLMODE"], "verify-full")
        apply_input = calls[0][1]["input"]
        self.assertIn(f"\\set secret '{SECRET}'", apply_input)
        # In the statements themselves, only $1: the value goes as a bound parameter.
        statements = [line for line in apply_input.splitlines() if not line.startswith("\\set")]
        self.assertTrue(all(SECRET not in line for line in statements))
        self.assertIn("\\bind :secret \\g", apply_input)
        # The check never sends the secret at all: only its SHA-256.
        check_input = calls[1][1]["input"]
        self.assertNotIn(SECRET, check_input)
        self.assertIn(hashlib.sha256(SECRET.encode()).hexdigest(), check_input)
        self.assertNotIn(SECRET, printed)
        self.assertIn("both match", printed)

    def test_check_sends_nothing_to_apply(self):
        code, calls, _ = self.run_main(command="check")
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("vault.create_secret", calls[0][1]["input"])

    def test_says_what_differs(self):
        code, _, printed = self.run_main(answers=("true false\n3 0 -\n",))
        self.assertEqual(code, 1)
        self.assertIn("address matches, the secret is missing or differs", printed)

    def test_a_schedule_whose_calls_fail_fails_the_check(self):
        code, _, printed = self.run_main(command="check", answers=("true true\n10 4 404,429\n",))
        self.assertEqual(code, 1)
        self.assertIn("answered 200 10 times and otherwise 4 times (answered 404,429)", printed)

    def test_a_failed_psql_fails_without_its_input(self):
        with self.assertRaises(SystemExit) as failed:
            self.run_main(returncode=3)
        self.assertNotIn(SECRET, str(failed.exception))

    def test_needs_psql_16_for_bind(self):
        with self.assertRaises(SystemExit) as refused:
            self.run_main(version="psql (PostgreSQL) 15.4\n")
        self.assertIn("psql 16", str(refused.exception))

    def test_needs_the_address(self):
        with mock.patch.dict(os.environ, {"PERP_JOBS_SECRET": SECRET}, clear=True), \
                self.assertRaises(SystemExit) as refused:
            perps_jobs.main(["check", "staging"])
        self.assertIn("database_url.py", str(refused.exception))


if __name__ == "__main__":
    unittest.main()
