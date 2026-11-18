"""Tests for scheduled_jobs.py: the reload of Supabase Cron's jobs after a push, and the check that it worked
(R16, M1; docs/research/cron-missed-jobs.md). Run by the quick checks
(`python3 -m unittest discover -s infra/supabase`), with a fake psql, sleep and clock: nothing waits and no
database is touched. The real database's own test is infra/supabase/tests/scheduled_jobs/reload.test.ts."""
import io
import json
import os
import re
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scheduled_jobs  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
WORKFLOWS = os.path.join(ROOT, ".github", "workflows")
ADDRESS = "postgresql://postgres:postgres@127.0.0.1:55332/postgres?sslmode=disable"
SINCE = "2026-11-18 09:00:00.123456+00"
NOTE = "docs/research/cron-missed-jobs.md"
RE_RUN = f" Re-run the workflow once; if the same job fails again, see 'If 2c or 4d fails' in {NOTE}."


def job(id, name, schedule="* * * * *", active=True, runs=0, current=0, failed=0):
    return {"id": id, "name": name, "schedule": schedule, "active": active,
            "runs": runs, "current": current, "failed": failed}


def answer(jobs, stale=()):
    return json.dumps({"jobs": list(jobs), "stale": list(stale)}) + "\n"


def opening(saved=3, role="postgres", others=(), since=SINCE, count=3):
    who = json.dumps({"role": role, "others": list(others)})
    return (f"{saved}\n" if count == 3 else "") + who + "\n" + since + "\n"


class Fake:
    """A psql that answers the opening call and each poll from `polls(seconds since the opening)`, a sleep and
    a clock that move together, and a log of what happened, in order."""

    def __init__(self, polls=None, first=None, saved=3, others=(), since=SINCE):
        self.now = 0.0
        self.log = []
        self.polls = polls or (lambda seconds: answer([]))
        self.first = first
        self.saved, self.others, self.since = saved, others, since
        self.opened_at = None

    def sleep(self, seconds):
        self.log.append(("sleep", seconds))
        self.now += seconds

    def clock(self):
        return self.now

    def run(self, argv, **kwargs):
        if argv == ["psql", "--version"]:
            return mock.Mock(returncode=0, stdout="psql (PostgreSQL) 16.4\n", stderr="")
        sql = kwargs["input"]
        self.log.append(("psql", sql))
        if "clock_timestamp" in sql:
            self.opened_at = self.now
            count = 3 if "alter_job" in sql else 2
            out = self.first if self.first is not None else opening(self.saved, others=self.others,
                                                                      since=self.since, count=count)
        else:
            out = self.polls(self.now - self.opened_at)
        return mock.Mock(returncode=0, stdout=out, stderr="")

    def go(self, *argv):
        printed = io.StringIO()
        with mock.patch.dict(os.environ, {"DATABASE_ADDRESS": ADDRESS}), redirect_stdout(printed):
            code = scheduled_jobs.main(list(argv), run=self.run, sleep=self.sleep, clock=self.clock)
        return code, printed.getvalue().splitlines()

    def psql_calls(self):
        return [what for kind, what in self.log if kind == "psql"]

    def polls_made(self):
        return [sql for sql in self.psql_calls() if "clock_timestamp" not in sql]


def squeeze(sql):
    return re.sub(r"\s+", " ", sql).strip()


class FastSeconds(unittest.TestCase):
    def test_what_runs_every_minute_or_faster(self):
        for schedule, seconds in (("* * * * *", 60), ("*/1 * * * *", 60), ("*/1 */1 */1 */1 */1", 60),
                                  ("5 seconds", 5), ("1 second", 1), (" 59 SECONDS ", 59), ("30 Seconds", 30),
                                  ("*  *\t* * *", 60)):
            with self.subTest(schedule=schedule):
                self.assertEqual(scheduled_jobs.fast_seconds(schedule), seconds)

    def test_what_does_not(self):
        for schedule in ("0 * * * *", "*/2 * * * *", "* * * * 1-5", "@hourly", "60 seconds", "0 seconds",
                         "23 3 * * *", "* * * *", "* * * * * *", "", "seconds", "5 minutes", "-5 seconds",
                         "5 seconds 5", "41 * * * *"):
            with self.subTest(schedule=schedule):
                self.assertIsNone(scheduled_jobs.fast_seconds(schedule))


class Usage(unittest.TestCase):
    def test_other_environments_are_refused_before_any_call(self):
        for environment in ("dev", "preview", "prd", "stg", "Staging", "", "production "):
            for command in ("reload", "check"):
                with self.subTest(environment=environment, command=command):
                    fake = Fake()
                    code, _ = fake.go(command, environment)
                    self.assertEqual(code, 2)
                    self.assertEqual(fake.log, [], "no sleep and no psql call before it's refused")

    def test_bad_arguments_exit_2_with_no_call(self):
        for argv in ([], ["reload"], ["restart", "staging"], ["reload", "staging", "now"],
                     ["reload", "staging", "--wait"], ["reload", "staging", "--wait", "4"],
                     ["reload", "staging", "--wait", "601"], ["check", "staging", "--wait", "abc"],
                     ["check", "staging", "--wait", "-5"], ["check", "staging", "--wait", "5.5"],
                     ["check", "staging", "--wait", "0"], ["check", "staging", "--wait=30"],
                     ["check", "--wait", "30", "staging"], ["reload", "staging", "--wait", "30", "extra"],
                     ["reload", "staging", "--wait", "٣٠"]):
            with self.subTest(argv=argv):
                fake = Fake()
                code, _ = fake.go(*argv)
                self.assertEqual(code, 2)
                self.assertEqual(fake.log, [])

    def test_the_wait_between_5_and_600_is_taken(self):
        self.assertEqual(scheduled_jobs.parse(["check", "staging"]), ("check", "staging", 180))
        for wait in (5, 8, 180, 600):
            self.assertEqual(scheduled_jobs.parse(["reload", "production", "--wait", str(wait)]),
                             ("reload", "production", wait))
        self.assertEqual(scheduled_jobs.parse(["check", "local", "--wait", "40"]), ("check", "local", 40))

    def test_it_connects_only_through_the_address_the_wrapper_sets(self):
        with mock.patch.dict(os.environ, {}, clear=True), self.assertRaises(SystemExit) as refused:
            scheduled_jobs.main(["check", "staging"], run=Fake().run, sleep=lambda s: None, clock=lambda: 0)
        self.assertIn("DATABASE_ADDRESS is not set", str(refused.exception))


class Order(unittest.TestCase):
    def test_reload_sleeps_5_s_then_sends_the_three_statements_in_order(self):
        fake = Fake(polls=lambda seconds: answer([job(1, "tick", "5 seconds", runs=9, current=9)]))
        fake.go("reload", "staging")
        self.assertEqual(fake.log[0], ("sleep", 5), "the first thing it does")
        first = fake.psql_calls()[0]
        self.assertEqual(squeeze(first), squeeze(
            "select count(*) from cron.job j, lateral (select cron.alter_job(j.jobid, active := j.active)) s "
            "where j.username = current_user; "
            "select json_build_object('role', current_user, 'others', coalesce((select json_agg(coalesce(o.jobname, "
            "'job ' || o.jobid) order by o.jobid) from cron.job o where o.username <> current_user), '[]'::json))::text; "
            "select clock_timestamp()::text;"))
        self.assertEqual(first.count(";"), 3)
        self.assertLess(first.index("alter_job"), first.index("json_build_object"))
        self.assertLess(first.index("json_build_object"), first.index("clock_timestamp"))

    def test_check_sends_only_the_last_two_and_never_saves_a_job(self):
        fake = Fake(polls=lambda seconds: answer([job(1, "tick", "5 seconds", runs=9, current=9)]))
        fake.go("check", "staging")
        self.assertEqual(fake.log[0][0], "psql", "no waiting before a check begins")
        first = fake.psql_calls()[0]
        self.assertEqual(first.count(";"), 2)
        self.assertNotIn("alter_job", first)
        self.assertIn("json_build_object('role'", first)
        self.assertTrue(first.strip().endswith("select clock_timestamp()::text;"))
        for sql in fake.psql_calls():
            self.assertNotIn("alter_job", sql)
        self.assertNotIn(("sleep", 5), fake.log[:1])

    def test_each_look_is_a_read_only_query_given_since_only_as_a_psql_variable(self):
        fake = Fake(polls=lambda seconds: answer([job(1, "tick", "5 seconds", runs=9, current=9)]))
        fake.go("reload", "staging")
        polls = fake.polls_made()
        self.assertTrue(polls)
        for sql in polls:
            self.assertTrue(sql.startswith(f"\\set since '{SINCE}'\n"))
            self.assertEqual(sql.count(SINCE), 1, "the time only once, in the variable's line")
            self.assertIn(":'since'::timestamptz", sql)
            self.assertNotRegex(sql.lower(), r"\b(insert|update|delete|alter_job|unschedule)\b|cron\.schedule")
        # The poll's own rules (the design's rule 5): the command, the database and the role must all match, a run
        # of any status counts, and stale means more than 10 s after.
        text = squeeze(scheduled_jobs.POLL_SQL)
        current = text[text.index("'current'"):text.index("'failed'")]
        self.assertIn("r.command = j.command and r.database = j.database and r.username = j.username", current)
        self.assertNotIn("status", current, "a run counts whatever its status: running, succeeded or failed")
        self.assertEqual(text.count("status"), 2)  # selected once, and counted once, for the failed runs
        self.assertIn("interval '10 seconds'", text)

    def test_the_polls_come_every_5_s_and_once_more_at_the_deadline(self):
        fake = Fake()
        fake.go("check", "staging", "--wait", "12")
        slept = [s for kind, s in fake.log if kind == "sleep"]
        self.assertEqual(slept, [5, 5, 2])
        self.assertEqual(len(fake.polls_made()), 4)  # at 0, 5, 10 and 12 s


class Decisions(unittest.TestCase):
    def test_it_passes_on_the_poll_where_current_reaches_1_and_never_before_20_s(self):
        # The job's first run counts only from 10 s: the first polls see none.
        fake = Fake(polls=lambda s: answer([job(6, "social-minute", runs=int(s >= 10), current=int(s >= 10))]))
        code, lines = fake.go("reload", "staging")
        self.assertEqual(code, 0)
        self.assertEqual(lines, [
            "staging: saved 3 scheduled jobs of postgres again, so Supabase Cron reloads them all",
            "staging: every job that runs every minute or faster has run since the re-save, as cron.job has it: "
            "social-minute (20 s)"])
        self.assertEqual(sum(s for kind, s in fake.log if kind == "sleep"), 5 + 20)
        # Already running at the first poll: still not before 20 s.
        fake = Fake(polls=lambda s: answer([job(6, "social-minute", runs=2, current=2)]))
        code, lines = fake.go("check", "staging")
        self.assertEqual(code, 0)
        self.assertEqual(lines, ["staging: every job that runs every minute or faster has run since this check began, "
                                 "as cron.job has it: social-minute (20 s)"])
        self.assertEqual(len(fake.polls_made()), 5)  # 0, 5, 10, 15 and 20 s

    def test_with_a_shorter_wait_it_passes_at_the_wait(self):
        fake = Fake(polls=lambda s: answer([job(6, "social-minute", runs=1, current=1)]))
        code, lines = fake.go("check", "local", "--wait", "8")
        self.assertEqual(code, 0)
        self.assertEqual(lines[-1], "local: every job that runs every minute or faster has run since this check began, "
                                    "as cron.job has it: social-minute (8 s)")

    def test_it_names_every_fast_active_job_and_no_other(self):
        jobs = [job(1, "tick", "5 seconds", runs=9, current=9), job(2, "funding", runs=1, current=1),
                job(3, "tidy", "41 * * * *"), job(4, "paused", "1 seconds", active=False)]
        code, lines = Fake(polls=lambda s: answer(jobs)).go("check", "production")
        self.assertEqual(code, 0)
        self.assertEqual(lines, ["production: every job that runs every minute or faster has run since this check "
                                 "began, as cron.job has it: tick, funding (20 s)"])

    def test_a_job_that_never_ran(self):
        fake = Fake(polls=lambda s: answer([job(1, "tick", "5 seconds", runs=9, current=9),
                                            job(6, "social-minute", runs=0, current=0)]))
        code, lines = fake.go("reload", "staging")
        self.assertEqual(code, 1)
        self.assertEqual(lines, [
            "staging: saved 3 scheduled jobs of postgres again, so Supabase Cron reloads them all",
            f"FAILED: staging: social-minute (* * * * *) hasn't run in the 180 s since the re-save: Supabase Cron "
            f"hasn't loaded it ({NOTE}){RE_RUN}"])
        self.assertEqual(sum(s for kind, s in fake.log if kind == "sleep"), 5 + 180)
        self.assertEqual(len(fake.polls_made()), 37)  # every 5 s from 0 to 175, and the deadline

    def test_in_a_check_every_failure_adds_what_to_run(self):
        fake = Fake(polls=lambda s: answer([job(6, "social-minute")], [{"id": 9, "name": None, "gone": True, "runs": 2}]))
        code, lines = fake.go("check", "staging", "--wait", "30")
        self.assertEqual(code, 1)
        self.assertEqual(lines, [
            f"FAILED: staging: social-minute (* * * * *) hasn't run in the 30 s since this check began: Supabase Cron "
            f"hasn't loaded it ({NOTE}) Run scheduled_jobs.py reload staging.",
            f"FAILED: staging: job 9 (no longer scheduled) started 2 runs more than 10 s after this check began: "
            f"Supabase Cron is still using an old copy ({NOTE}) Run scheduled_jobs.py reload staging."])

    def test_every_failure_of_a_reload_says_what_to_do_next_and_no_other_line_does(self):
        # Step 2c and 4d run `reload`: its failures say to re-run once, and where to read if it fails again.
        stale = [{"id": 7, "name": None, "gone": True, "runs": 3}]
        jobs = [job(1, "tick", "5 seconds", runs=9, current=9, failed=1), job(6, "social-minute", runs=3, current=0),
                job(8, "never")]
        code, lines = Fake(polls=lambda s: answer(jobs, stale)).go("reload", "production", "--wait", "10")
        self.assertEqual(code, 1)
        failed = [line for line in lines if line.startswith("FAILED")]
        self.assertEqual(len(failed), 3)  # an old copy, a job that never ran, and a stale run
        for line in failed:
            self.assertTrue(line.endswith(RE_RUN), line)
            self.assertEqual(line.count("If 2c or 4d fails"), 1)
        for line in lines:
            if not line.startswith("FAILED"):
                self.assertNotIn("If 2c or 4d fails", line)
        # A check's failures keep their own next step, and a pass has none.
        code, lines = Fake(polls=lambda s: answer(jobs, stale)).go("check", "production", "--wait", "10")
        for line in lines:
            if line.startswith("FAILED"):
                self.assertTrue(line.endswith(" Run scheduled_jobs.py reload production."), line)
                self.assertNotIn("Re-run the workflow", line)
        code, lines = Fake(polls=lambda s: answer(jobs[:1])).go("reload", "production")
        self.assertEqual(code, 0)
        self.assertFalse([line for line in lines if "If 2c or 4d fails" in line])

    def test_a_job_that_ran_only_from_an_old_copy(self):
        fake = Fake(polls=lambda s: answer([job(6, "social-minute", runs=3, current=0)]))
        code, lines = fake.go("check", "staging", "--wait", "60")
        self.assertEqual(code, 1)
        self.assertEqual(lines, [
            f"FAILED: staging: social-minute (* * * * *) ran 3 times since this check began, never as cron.job has it "
            f"now: Supabase Cron is still using an old copy ({NOTE}) Run scheduled_jobs.py reload staging."])

    def test_a_job_no_longer_scheduled_or_switched_off_that_still_ran(self):
        stale = [{"id": 7, "name": None, "gone": True, "runs": 3},
                 {"id": 8, "name": "old-job", "gone": False, "runs": 2},
                 {"id": 9, "name": None, "gone": False, "runs": 1}]
        fake = Fake(polls=lambda s: answer([job(1, "tick", "5 seconds", runs=9, current=9)], stale))
        code, lines = fake.go("reload", "staging", "--wait", "30")
        self.assertEqual(code, 1)
        self.assertEqual(lines[1:], [
            f"FAILED: staging: job 7 (no longer scheduled) started 3 runs more than 10 s after the re-save: Supabase "
            f"Cron is still using an old copy ({NOTE}){RE_RUN}",
            f"FAILED: staging: job 8 (old-job, switched off) started 2 runs more than 10 s after the re-save: Supabase "
            f"Cron is still using an old copy ({NOTE}){RE_RUN}",
            f"FAILED: staging: job 9 (switched off) started 1 runs more than 10 s after the re-save: Supabase "
            f"Cron is still using an old copy ({NOTE}){RE_RUN}"])

    def test_a_stale_run_stops_a_pass_even_when_every_fast_job_has_run(self):
        fake = Fake(polls=lambda s: answer([job(1, "tick", "5 seconds", runs=9, current=9)],
                                           [{"id": 7, "name": None, "gone": True, "runs": 1}] if s >= 10 else []))
        code, lines = fake.go("check", "staging", "--wait", "30")
        self.assertEqual(code, 1)
        self.assertEqual(len(lines), 1)
        self.assertEqual(sum(s for kind, s in fake.log if kind == "sleep"), 30, "it waits for the deadline")

    def test_no_active_job_runs_every_minute_or_faster(self):
        jobs = [job(3, "tidy", "41 * * * *"), job(4, "paused", "5 seconds", active=False)]
        fake = Fake(polls=lambda s: answer(jobs))
        code, lines = fake.go("check", "staging")
        self.assertEqual(code, 0)
        self.assertEqual(lines, ["staging: no active job runs every minute or faster, so there was no run to wait for"])
        self.assertEqual(sum(s for kind, s in fake.log if kind == "sleep"), 20, "the 20 s the stale runs need")

    def test_no_job_at_all(self):
        fake = Fake(saved=0)
        code, lines = fake.go("reload", "staging")
        self.assertEqual((code, lines), (0, ["staging: no scheduled jobs"]))
        self.assertEqual(fake.polls_made(), [], "nothing to wait for")
        code, lines = Fake().go("check", "staging")
        self.assertEqual((code, lines), (0, ["staging: no scheduled jobs"]))

    def test_only_other_roles_jobs_cant_trigger_a_reload(self):
        fake = Fake(saved=0, others=["social-minute", "job 12"])
        code, lines = fake.go("reload", "staging")
        self.assertEqual(code, 1)
        self.assertEqual(lines, [
            "staging: 2 jobs belong to other roles and weren't saved again (they reload with the rest): "
            "social-minute, job 12",
            "FAILED: staging: no scheduled job belongs to postgres, so none could be saved again to make Supabase Cron "
            f"reload. See 'If 2c or 4d fails' in {NOTE}."])
        self.assertEqual(fake.polls_made(), [])

    def test_other_roles_jobs_alongside_its_own_are_named_and_the_check_goes_on(self):
        fake = Fake(saved=3, others=["theirs"], polls=lambda s: answer([job(1, "tick", "5 seconds", runs=9, current=9)]))
        code, lines = fake.go("reload", "staging")
        self.assertEqual(code, 0)
        self.assertEqual(lines[:2], [
            "staging: saved 3 scheduled jobs of postgres again, so Supabase Cron reloads them all",
            "staging: 1 jobs belong to other roles and weren't saved again (they reload with the rest): theirs"])

    def test_failed_runs_are_reported_by_job_but_never_fail_the_check(self):
        # Every run of social-minute failed, and so did one of the tick's: they ran, so the scheduler loaded them.
        jobs = [job(1, "tick", "5 seconds", runs=9, current=9, failed=1),
                job(6, "social-minute", runs=2, current=2, failed=2), job(7, "tidy", "41 * * * *")]
        for command, when in (("reload", "the re-save"), ("check", "this check began")):
            with self.subTest(command=command):
                code, lines = Fake(polls=lambda s: answer(jobs)).go(command, "staging")
                self.assertEqual(code, 0)
                self.assertIn(f"staging: tick: 1 of its 9 runs since {when} failed", lines)
                self.assertIn(f"staging: social-minute: 2 of its 2 runs since {when} failed", lines)
                self.assertFalse([line for line in lines if line.startswith("FAILED")])
                self.assertIn("tick, social-minute (20 s)", lines[-1])
                self.assertEqual(len([line for line in lines if "failed" in line]), 2, "each job named once")

    def test_failed_runs_never_hide_a_job_that_didnt_run(self):
        jobs = [job(1, "tick", "5 seconds", runs=9, current=9, failed=9), job(6, "social-minute")]
        code, lines = Fake(polls=lambda s: answer(jobs)).go("check", "staging", "--wait", "10")
        self.assertEqual(code, 1)
        self.assertIn("staging: tick: 9 of its 9 runs since this check began failed", lines)
        self.assertEqual(len([line for line in lines if line.startswith("FAILED")]), 1)


class Unreadable(unittest.TestCase):
    def test_an_answer_it_cannot_read_fails_and_never_passes(self):
        for poll in ("", "\n", "not json\n", "[]\n", "{}\n", '{"jobs": []}\n', '{"jobs": {}, "stale": []}\n',
                     '{"jobs": [], "stale": {}}\n', '{"jobs": [{"id": 1}], "stale": []}\n',
                     answer([job(1, "x", runs=True)]), answer([job(1, "x", active="yes")]),
                     answer([job(1, "x", schedule=5)]), answer([], [{"id": 1, "gone": True, "runs": 1.5}]),
                     answer([]) + answer([])):
            with self.subTest(poll=poll):
                fake = Fake(polls=lambda s, poll=poll: poll)
                code, lines = fake.go("check", "staging")
                self.assertEqual(code, 1)
                self.assertEqual(lines, ["FAILED: staging: the look at cron.job_run_details gave no answer it could read"])
                self.assertEqual(len(fake.polls_made()), 1, "no second look")

    def test_an_opening_it_cannot_read_fails(self):
        for first in ("", "3\n", "x\n{\"role\": \"postgres\", \"others\": []}\n" + SINCE + "\n",
                      "3\nnot json\n" + SINCE + "\n", "3\n[]\n" + SINCE + "\n",
                      '3\n{"role": "postgres"}\n' + SINCE + "\n", '3\n{"role": 1, "others": []}\n' + SINCE + "\n",
                      '3\n{"role": "postgres", "others": [1]}\n' + SINCE + "\n",
                      "3\n" + json.dumps({"role": "postgres", "others": []}) + "\n" + SINCE + "\nextra\n"):
            with self.subTest(first=first):
                fake = Fake(first=first)
                code, lines = fake.go("reload", "staging")
                self.assertEqual((code, lines), (1, ["FAILED: staging: the re-save gave no answer it could read"]))
                self.assertEqual(fake.polls_made(), [])

    def test_a_bad_since_fails_and_is_never_sent_on(self):
        for since in ("", "2026-11-18", "now", "2026-11-18 09:00:00", "2026-11-18 09:00:00+00; drop table x",
                      "2026-11-18 09:00:00.1+00'; drop table x; --", "2026-11-18T09:00:00+00",
                      "٢٠٢٦-11-18 09:00:00+00"):
            for command, what in (("reload", "the re-save"), ("check", "the clock")):
                with self.subTest(since=since, command=command):
                    fake = Fake(first=opening(since=since, count=3 if command == "reload" else 2))
                    code, lines = fake.go(command, "staging")
                    self.assertEqual((code, lines), (1, [f"FAILED: staging: {what} gave no answer it could read"]))
                    self.assertEqual(fake.polls_made(), [])
        for since in ("2026-11-18 09:00:00+00", "2026-11-18 09:00:00.5-05:30", "2026-11-18 09:00:00.123456+05:30"):
            with self.subTest(since=since):
                self.assertEqual(Fake(first=opening(since=since), polls=lambda s: answer([])).go("reload", "staging")[0], 0)

    def test_a_failing_psql_fails_the_step(self):
        def run(argv, **kwargs):
            if argv == ["psql", "--version"]:
                return mock.Mock(returncode=0, stdout="psql (PostgreSQL) 16.4\n", stderr="")
            return mock.Mock(returncode=3, stdout="", stderr="ERROR: relation \"cron.job\" does not exist\n")

        with mock.patch.dict(os.environ, {"DATABASE_ADDRESS": ADDRESS}), self.assertRaises(SystemExit) as failed:
            scheduled_jobs.main(["reload", "staging"], run=run, sleep=lambda s: None, clock=lambda: 0)
        self.assertIn("psql failed", str(failed.exception))


def steps_of(workflow):
    """{step name: its text} for the one job a workflow file has, in order."""
    with open(os.path.join(WORKFLOWS, workflow), encoding="utf-8") as f:
        text = f.read()
    body = text.split("\n    steps:\n")[-1]
    found = []
    for chunk in re.split(r"\n      - ", "\n" + body):
        named = re.match(r"name: (.+)", chunk)
        if named:
            found.append((named.group(1).strip(), chunk))
    return found, text


class Workflows(unittest.TestCase):
    def test_staging_reloads_after_the_books_check_and_before_staging_moves(self):
        found, text = steps_of("staging.yml")
        names = [name for name, _ in found]
        two_b = next(i for i, name in enumerate(names) if name.startswith("2b. "))
        self.assertTrue(names[two_b + 1].startswith("2c. Reload the scheduled jobs"), names[two_b + 1])
        self.assertTrue(names[two_b + 2].startswith("3. "))
        step = found[two_b + 1][1]
        self.assertIn("PGSSLMODE: verify-full", step)
        self.assertIn("PGSSLROOTCERT: infra/supabase/supabase-root-2021-ca.crt", step)
        self.assertIn("run: python3 infra/supabase/database_url.py run session -- "
                      "python3 infra/supabase/scheduled_jobs.py reload staging", step)
        self.assertNotIn("if:", step)
        self.assertNotIn("continue-on-error", step)
        self.assertIn("#   2c.", text.split("name: Staging")[0])

    def test_the_release_pipeline_reloads_from_its_own_commits_copy_after_the_books_check(self):
        found, text = steps_of("release.yml")
        names = [name for name, _ in found]
        four_c = next(i for i, name in enumerate(names) if name.startswith("4c. "))
        self.assertTrue(names[four_c + 1].startswith("4d. Reload the scheduled jobs"), names[four_c + 1])
        self.assertTrue(names[four_c + 2].startswith("5. "))
        step = found[four_c + 1][1]
        self.assertIn("if: inputs.action == 'release'", step, "a rollback leaves the database as it was")
        self.assertIn("PGSSLMODE: verify-full", step)
        self.assertIn("PGSSLROOTCERT: infra/supabase/supabase-root-2021-ca.crt", step)
        self.assertIn('run: python3 infra/supabase/database_url.py run session -- python3 '
                      '"$RUNNER_TEMP/job-checks/infra/supabase/scheduled_jobs.py" reload production', step)
        self.assertNotIn("continue-on-error", step)
        header = text.split("name: Release")[0]
        self.assertIn("4d.", header)

    def test_the_two_scripts_are_taken_from_the_workflows_own_commit_before_the_released_ones_are_used(self):
        found, text = steps_of("release.yml")
        names = [name for name, _ in found]
        extract = [i for i, (name, step) in enumerate(found) if "git archive" in step and "job-checks" in step]
        self.assertEqual(len(extract), 1)
        step = found[extract[0]][1]
        self.assertIn("WORKFLOW_COMMIT: ${{ github.sha }}", step)
        self.assertIn("set -euo pipefail", step)
        self.assertIn('git archive "$WORKFLOW_COMMIT" infra/supabase/scheduled_jobs.py infra/supabase/perps_jobs.py '
                      '| tar -x -C "$RUNNER_TEMP/job-checks"', step)
        self.assertIn('mkdir -p "$RUNNER_TEMP/job-checks"', step)
        self.assertNotIn("persist-credentials", step)
        # Into a folder of its own: never over the released commit's tree.
        self.assertNotIn("-C .", step)
        # `git archive` needs this workflow's own commit among the objects: the checkout before it fetches every
        # commit (fetch-depth 0), as the key checks' step relies on too, and a shallow one would fail it loudly.
        steps = re.split(r"\n      - ", "\n" + text.split("\n    steps:\n")[-1])
        checkout = [i for i, chunk in enumerate(steps) if chunk.startswith("uses: actions/checkout@")]
        self.assertEqual(len(checkout), 1)
        self.assertIn("fetch-depth: 0", steps[checkout[0]])
        self.assertLess(checkout[0], next(i for i, chunk in enumerate(steps) if "git archive" in chunk))
        four_d = next(i for i, name in enumerate(names) if name.startswith("4d. "))
        self.assertLess(extract[0], four_d)
        # Unnumbered, so the pinned test counts only the steps that change production.
        self.assertNotRegex(names[extract[0]], r"^[0-9]")
        # The released commit's own copy is never what runs: every use is the extracted one.
        for i, (name, other) in enumerate(found):
            if "scheduled_jobs.py" in other and i != extract[0]:
                self.assertIn("$RUNNER_TEMP/job-checks/infra/supabase/scheduled_jobs.py", other, name)
                self.assertNotRegex(other, r"python3 infra/supabase/scheduled_jobs\.py")


if __name__ == "__main__":
    unittest.main()
