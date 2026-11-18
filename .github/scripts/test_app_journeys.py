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
import shutil
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


def sizes_function():
    """run.sh's own `run_sizes` function, as it is in the file."""
    with open(RUN, encoding="utf-8") as f:
        text = f.read()
    found = re.search(r"^run_sizes\(\) \{\n.*?^\}\n", text, re.S | re.M)
    if not found:
        raise AssertionError("run.sh has no run_sizes() function")
    return found.group(0)


# What the machine does at each size, as the calls the stubs record: today's `both` is the first line of each
# list, and the other two are the parts of it that each of two machines runs.
RESET = ["adb shell wm size reset", "adb shell wm density reset"]
TABLET = ["adb shell wm size 1600x2560", "adb shell wm density 320"]
BOTH = RESET + ["journeys phone"] + TABLET + ["journeys tablet"] + RESET + ["startup"]
PHONE = RESET + ["journeys phone"]
ONLY_TABLET = RESET + TABLET + ["journeys tablet"] + RESET + ["startup"]


def run_sizes(size, failing=None):
    """Runs run.sh's `run_sizes` with adb, the journeys and the cold start stood in for; (exit code, calls)."""
    with tempfile.TemporaryDirectory() as tmp:
        log = os.path.join(tmp, "calls")
        script = ("set -euo pipefail\nout=/nowhere\nflows=/flows\n"
                  'adb() { echo "adb $*" >> "$LOG"; }\n'
                  'journeys() { echo "journeys $1" >> "$LOG"; [ "$1" != "$FAILING" ]; }\n'
                  'bash() { echo startup >> "$LOG"; }\n'
                  + sizes_function() + f'run_sizes "{size}"\necho finished >> "$LOG"\n')
        done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30,
                              env={"PATH": "/usr/bin:/bin", "LOG": log, "FAILING": failing or "none"})
        with open(log, encoding="utf-8") as f:
            return done.returncode, f.read().splitlines()


def run_whole(args):
    """Runs run.sh itself, front to back, with adb, maestro, sleep and the cold start stood in for (no Doppler
    token: the signed-in journey is left out): (exit code, calls, stderr, whether the results folder was made)."""
    bash = shutil.which("bash")
    with tempfile.TemporaryDirectory() as tmp:
        log, bin_dir, out = os.path.join(tmp, "calls"), os.path.join(tmp, "bin"), os.path.join(tmp, "results")
        os.makedirs(bin_dir)
        stubs = {"adb": 'echo "adb $*" >> "$LOG"',
                 "maestro": 'for a in "$@"; do case "$a" in SIZE=*) echo "journeys ${a#SIZE=}" >> "$LOG";; esac; done',
                 "bash": 'echo startup >> "$LOG"', "sleep": ":"}
        for name, body in stubs.items():
            stub = os.path.join(bin_dir, name)
            with open(stub, "w", encoding="utf-8") as f:
                f.write(f"#!/bin/sh\n{body}\n")
            os.chmod(stub, 0o755)
        done = subprocess.run([bash, RUN, "app.apk", out, *args], capture_output=True, text=True, timeout=60,
                              env={"PATH": f"{bin_dir}:/usr/bin:/bin", "LOG": log})
        calls = []
        if os.path.exists(log):
            with open(log, encoding="utf-8") as f:
                calls = [line for line in f.read().splitlines() if not line.startswith("adb install")
                         and not line.startswith("adb shell settings") and not line.startswith("adb shell am")
                         and not line.startswith("adb shell pidof")]
        return done.returncode, calls, done.stderr, os.path.exists(out)


class TheSizeToRun(unittest.TestCase):
    """run.sh's third argument: which size's journeys this machine runs (App journeys on two machines)."""

    def test_both_is_todays_order_exactly_and_phone_and_tablet_are_its_two_halves(self):
        self.assertEqual(run_sizes("both"), (0, BOTH + ["finished"]))
        self.assertEqual(run_sizes("phone"), (0, PHONE + ["finished"]))
        self.assertEqual(run_sizes("tablet"), (0, ONLY_TABLET + ["finished"]))
        # The tablet's machine runs the tablet's journeys and then the cold start, as `both` does after them.
        self.assertEqual(PHONE + ONLY_TABLET[len(RESET):], BOTH)

    def test_the_phone_runs_no_tablet_journeys_and_no_cold_start(self):
        _, calls = run_sizes("phone")
        self.assertNotIn("startup", calls)
        self.assertNotIn("journeys tablet", calls)

    def test_a_failing_journey_stops_the_machine_before_the_next_size_and_the_cold_start(self):
        code, calls = run_sizes("both", failing="phone")
        self.assertNotEqual(code, 0)
        self.assertEqual(calls, RESET + ["journeys phone"])
        code, calls = run_sizes("both", failing="tablet")
        self.assertNotEqual(code, 0)
        self.assertEqual(calls, BOTH[:BOTH.index("startup") - 2])  # no reset, no cold start: today's
        code, calls = run_sizes("tablet", failing="tablet")
        self.assertNotEqual(code, 0)
        self.assertNotIn("startup", calls)
        self.assertNotIn("finished", calls)

    def test_run_sh_runs_each_size_front_to_back_and_without_a_size_it_runs_both(self):
        for args, wanted in (([], BOTH), (["both"], BOTH), (["phone"], PHONE), (["tablet"], ONLY_TABLET)):
            with self.subTest(args=args):
                code, calls, error, made = run_whole(args)
                self.assertEqual(code, 0, error)
                self.assertEqual(calls, wanted + RESET)  # and the exit trap's reset, as today
                self.assertTrue(made)

    def test_any_other_size_is_refused_with_exit_2_before_anything_is_made_or_started(self):
        for size in ("bogus", "", "Phone", "phone,tablet", "both ", "tablet2", "-h"):
            with self.subTest(size=size):
                code, calls, error, made = run_whole([size])
                self.assertEqual(code, 2, error)
                self.assertEqual(calls, [])  # no adb, no journeys, no account
                self.assertFalse(made)
                self.assertIn("phone, tablet or both", error)

    def test_the_size_is_checked_before_the_signed_in_journeys_account_is_made(self):
        with open(RUN, encoding="utf-8") as f:
            text = f.read()
        self.assertLess(text.index('size="${3-both}"'), text.index('email="$(account create)"'))
        self.assertLess(text.index("exit 2"), text.index("mkdir -p \"$out\""))
        self.assertTrue(text.rstrip().endswith('run_sizes "$size"'))


if __name__ == "__main__":
    unittest.main()
