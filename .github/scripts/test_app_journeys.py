"""The App journeys' run.sh (product/app/journeys/run.sh): offline, with the key request stood in for.

    python3 -m unittest discover -s .github/scripts

The signed-in journey's account helper (`account`) asks infra/doppler/named_keys.py to run the
account script with three keys. In GitHub's runners named_keys.py first prints a line per key
telling the runner to hide its value (`::add-mask::…`), on the same output the helper reads, so
the helper must send those lines to the job's log and hand back only the script's answer: a
mangled address once failed every run before it was caught in review (10 November 2026).
"""
import os
import re
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RUN = os.path.join(ROOT, "product", "app", "journeys", "run.sh")
ADDRESS = "delivered+run-gh1a1-0a1b2c3d-app-android@resend.dev"
MASKS = ["::add-mask::https://project.supabase.co", "::add-mask::sb_publishable_x", "::add-mask::sb_secret_y"]


def account_function():
    """run.sh's own `account` function, as it is in the file."""
    with open(RUN, encoding="utf-8") as f:
        text = f.read()
    found = re.search(r"^account\(\) \{\n.*?^\}\n", text, re.S | re.M)
    if not found:
        raise AssertionError("run.sh has no account() function")
    return found.group(0)


def run_account(printed, fails=False):
    """Runs `account create` with python3 stood in for, printing `printed` (and failing if asked)."""
    with tempfile.TemporaryDirectory() as tmp:
        stub = os.path.join(tmp, "python3")
        with open(stub, "w", encoding="utf-8") as f:
            f.write('#!/bin/sh\nprintf "%s" "$STUB_OUTPUT"\n' + ("exit 3\n" if fails else ""))
        os.chmod(stub, 0o755)
        script = ("set -euo pipefail\nroot=/nowhere\ndoppler_token=token-for-this-test\nexec 3>&1\n"
                  + account_function()
                  + 'answer="$(account create)"\nprintf "ANSWER=%s\\n" "$answer"\n')
        env = {"PATH": f"{tmp}:/usr/bin:/bin", "STUB_OUTPUT": printed}
        return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=30)


class TheAccountHelper(unittest.TestCase):
    def test_hands_back_only_the_answer_and_sends_the_mask_lines_to_the_log(self):
        done = run_account("\n".join(MASKS + [ADDRESS]) + "\n")
        self.assertEqual(done.returncode, 0, done.stderr)
        lines = done.stdout.splitlines()
        self.assertIn(f"ANSWER={ADDRESS}", lines)
        self.assertEqual([line for line in lines if line.startswith("::add-mask::")], MASKS)

    def test_hands_back_an_answer_with_no_mask_lines_as_it_is(self):
        done = run_account(ADDRESS + "\n")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout.splitlines(), [f"ANSWER={ADDRESS}"])

    def test_a_failed_key_request_stops_the_journeys(self):
        done = run_account("\n".join(MASKS) + "\n", fails=True)
        self.assertNotEqual(done.returncode, 0)
        self.assertNotIn("ANSWER=", done.stdout)

    def test_the_token_reaches_the_key_request_alone(self):
        with open(RUN, encoding="utf-8") as f:
            text = f.read()
        self.assertIn('doppler_token="${DOPPLER_TOKEN:-}"\nunset DOPPLER_TOKEN\n', text)
        self.assertRegex(account_function(), r'DOPPLER_TOKEN="\$doppler_token" python3 ')
        with open(os.path.join(ROOT, "product", "app", "journeys", "emulator.sh"), encoding="utf-8") as f:
            emulator = f.read()
        run_branch = emulator[emulator.index("  run)"):]
        self.assertLess(run_branch.index("unset DOPPLER_TOKEN"), run_branch.index("boot -no-snapshot-save"))


if __name__ == "__main__":
    unittest.main()
