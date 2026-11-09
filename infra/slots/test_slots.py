"""Tests for the slot tool: offline, in a made-up register, without Docker, servers or Doppler.

    python3 -m unittest discover -s infra/slots

Two worktrees must never get the same slot or share a port; a worktree keeps the slot it
holds; a slot whose worktree is gone counts as free again (after what it left running is
stopped); a slot whose port another program holds is passed over; and the last slot stays
for the design chat.
"""
import contextlib
import io
import json
import os
import socket
import tempfile
import threading
import unittest
from unittest import mock

import slots

CONFIG_TOML = os.path.join(slots.ROOT, "infra", "supabase", "config.toml")
AUTH_SETTINGS = os.path.join(slots.ROOT, "infra", "supabase", "auth", "settings.json")
R2_RULES = os.path.join(slots.ROOT, "infra", "cloudflare", "r2")
LOCAL = ("localhost", "127.0.0.1", "[::1]")


def register():
    folder = tempfile.TemporaryDirectory()
    return folder, slots.Register(folder.name)


def nothing_busy(_slot):
    return []


def no_tidying(_slot, _record):
    pass


class TheSlots(unittest.TestCase):
    def test_no_two_slots_share_a_port_or_a_name(self):
        seen = {}
        for slot in slots.all_slots(9):
            for port in slot.ports():
                self.assertNotIn(port, seen, f"port {port} of slot {slot.number} is slot {seen.get(port)}'s too")
                seen[port] = slot.number
        names = [s.project_id for s in slots.all_slots(9)] + [s.redis_prefix for s in slots.all_slots(9)]
        self.assertEqual(len(names), len(set(names)))

    def test_slots_keep_off_the_defaults_and_the_database_checks_ports(self):
        with open(CONFIG_TOML, encoding="utf-8") as f:
            text = f.read()
        defaults = {3000, 8081}
        for line in text.splitlines():
            if line.lstrip().startswith("#"):
                continue
            key, _, value = line.partition("=")
            if key.strip().endswith("port") and value.strip().isdigit():
                defaults.add(int(value.strip()))
        self.assertIn(55322, defaults)  # the Database check's own database
        for slot in slots.all_slots(9):
            self.assertFalse(set(slot.ports()) & defaults, f"slot {slot.number} uses a default port")

    def test_every_slot_moves_every_port_in_config_toml(self):
        """config.toml's ports all have a slot setting, so a new one can't be forgotten."""
        with open(CONFIG_TOML, encoding="utf-8") as f:
            lines = f.read().splitlines()
        section, configured = "", set()
        for line in lines:
            line = line.strip()
            if line.startswith("#"):
                continue
            if line.startswith("[") and line.endswith("]"):
                section = line.strip("[]")
            key, _, value = line.partition("=")
            if key.strip().endswith("port") and value.strip().isdigit():
                name = "SUPABASE_" + f"{section}.{key.strip()}".upper().replace(".", "_")
                configured.add(name)
        self.assertEqual(configured, set(slots.Slot(1).db_ports))

    def test_a_slots_settings(self):
        env = slots.Slot(2).env()
        self.assertEqual(env["BASE_URL"], "http://localhost:3102")
        self.assertEqual(env["PORT"], "3102")
        self.assertEqual(env["RCT_METRO_PORT"], "8102")
        self.assertEqual(env["REDIS_KEY_PREFIX"], "dev:slot2")
        self.assertEqual(env["SUPABASE_PROJECT_ID"], "hrizzup-slot2")
        self.assertEqual(env["SUPABASE_DB_PORT"], "55342")

    def test_the_redis_prefix_starts_with_this_macs_environment(self):
        for slot in slots.all_slots(9):
            environment, _, rest = slot.redis_prefix.partition(":")
            self.assertEqual(environment, "dev")
            self.assertRegex(rest, r"^[a-z0-9][a-z0-9_-]*$")


class StagingAllowsEverySlot(unittest.TestCase):
    """Every slot's website can sign in and upload against staging, and nothing else local can:
    staging's sign-in redirect list and both staging buckets' browser rules name exactly the
    slots' addresses (plus the unslotted default, http://localhost:3000). Production's never
    name a local address."""

    expected = {"http://localhost:3000"} | {slot.website for slot in slots.all_slots()}

    def test_staging_sign_in_returns_to_every_slot_and_production_to_none(self):
        with open(AUTH_SETTINGS, encoding="utf-8") as f:
            environments = json.load(f)["environments"]
        staging = environments["staging"]["settings"]["uri_allow_list"].split(",")
        local = {a[: -len("/**")] for a in staging if any(h in a for h in LOCAL)}
        self.assertEqual(local, self.expected)
        self.assertTrue(all(a.endswith("/**") for a in staging if any(h in a for h in LOCAL)))
        production = environments["production"]["settings"]["uri_allow_list"]
        self.assertFalse(any(h in production for h in LOCAL), production)

    def test_staging_buckets_take_uploads_and_reads_from_every_slot_and_production_none(self):
        for kind in ("uploads", "media"):
            with open(os.path.join(R2_RULES, f"{kind}.cors.staging.json"), encoding="utf-8") as f:
                origins = {o for rule in json.load(f)["rules"] for o in rule["allowed"]["origins"]}
            self.assertEqual({o for o in origins if any(h in o for h in LOCAL)}, self.expected, kind)
            with open(os.path.join(R2_RULES, f"{kind}.cors.production.json"), encoding="utf-8") as f:
                production = json.dumps(json.load(f))
            self.assertFalse(any(h in production for h in LOCAL), kind)


class Claiming(unittest.TestCase):
    def setUp(self):
        folder, self.register = register()
        self.addCleanup(folder.cleanup)

    def claim(self, path, **kwargs):
        kwargs.setdefault("exists", lambda p: True)
        kwargs.setdefault("busy", nothing_busy)
        kwargs.setdefault("tidy_up", no_tidying)
        kwargs.setdefault("count", 4)
        return slots.claim(self.register, path, "branch", **kwargs)

    def test_each_worktree_gets_its_own_slot_and_keeps_it(self):
        self.assertEqual(self.claim("/w/a"), (1, True))
        self.assertEqual(self.claim("/w/b"), (2, True))
        self.assertEqual(self.claim("/w/a"), (1, False))
        self.assertEqual(self.register.held_by("/w/b"), 2)

    def test_relays_leave_the_last_slot_for_the_design_chat(self):
        for path in ("/w/a", "/w/b", "/w/c"):
            self.claim(path)
        number, passed_over = self.claim("/w/d")
        self.assertIsNone(number)
        self.assertEqual([n for n, _ in passed_over], [1, 2, 3])
        self.assertEqual(self.claim("/w/design", design=True), (4, True))

    def test_the_design_chat_waits_like_anyone_if_its_slot_is_held(self):
        self.claim("/w/design", design=True)
        number, passed_over = self.claim("/w/other-design", design=True)
        self.assertIsNone(number)
        self.assertEqual([n for n, _ in passed_over], [4])

    def test_a_slot_whose_worktree_is_gone_is_free_again_once_tidied(self):
        self.claim("/w/a")
        self.claim("/w/b")
        tidied = []
        number, new = self.claim(
            "/w/c", exists=lambda p: p != "/w/a",
            busy=lambda slot: [slot.web_port] if slot.number == 1 and not tidied else [],
            tidy_up=lambda slot, record: tidied.append((slot.number, record["worktree"])),
        )
        self.assertEqual((number, new), (1, True))
        self.assertEqual(tidied, [(1, "/w/a")])
        self.assertEqual(self.register.held_by("/w/c"), 1)
        self.assertIsNone(self.register.held_by("/w/a"))

    def test_a_slot_another_program_holds_a_port_of_is_passed_over(self):
        number, _ = self.claim("/w/a", busy=lambda slot: [slot.web_port] if slot.number == 1 else [])
        self.assertEqual(number, 2)

    def test_none_free_says_why(self):
        number, passed_over = self.claim("/w/a", busy=lambda slot: [slot.metro_port])
        self.assertIsNone(number)
        self.assertIn("8101", passed_over[0][1])

    def test_release_frees_the_slot_after_tidying_it(self):
        self.claim("/w/a")
        tidied = []
        self.assertEqual(slots.release(self.register, "/w/a",
                                       tidy_up=lambda slot, record: tidied.append(slot.number)), 1)
        self.assertEqual(tidied, [1])
        self.assertIsNone(self.register.held_by("/w/a"))
        self.assertIsNone(slots.release(self.register, "/w/a", tidy_up=no_tidying))

    def test_claims_at_the_same_moment_never_share_a_slot(self):
        results, threads = {}, []
        for i in range(3):
            path = f"/w/{i}"
            thread = threading.Thread(target=lambda p=path: results.__setitem__(p, self.claim(p)[0]))
            threads.append(thread)
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(results.values()), [1, 2, 3])


class Worktrees(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.base = folder.name

    def make(self, name, record=True):
        path = os.path.join(self.base, name)
        os.makedirs(path)
        admin = os.path.join(self.base, "repo.git", "worktrees", name)
        if record:
            os.makedirs(admin)
        with open(os.path.join(path, ".git"), "w") as f:
            f.write(f"gitdir: {admin}\n")
        return path

    def test_a_live_worktree_exists(self):
        self.assertTrue(slots.worktree_exists(self.make("live")))

    def test_the_main_folder_exists(self):
        path = os.path.join(self.base, "main")
        os.makedirs(os.path.join(path, ".git"))
        self.assertTrue(slots.worktree_exists(path))

    def test_a_deleted_worktree_is_gone(self):
        self.assertFalse(slots.worktree_exists(os.path.join(self.base, "never-there")))

    def test_a_half_removed_worktree_is_gone(self):
        """git unregisters a worktree before deleting its files; servers still running in it
        can leave files behind, but the slot is free once git has dropped it."""
        self.assertFalse(slots.worktree_exists(self.make("half-removed", record=False)))


class Processes(unittest.TestCase):
    def test_a_process_tree_is_found_from_its_first_process(self):
        table = {10: (1, 10, "doppler"), 11: (10, 10, "node next"), 12: (11, 12, "next-server"),
                 13: (12, 12, "worker"), 20: (1, 20, "something else")}
        self.assertEqual(slots.tree(10, table), {10, 11, 12, 13})

    def test_a_dead_service_is_not_alive(self):
        self.assertFalse(slots.alive({"pid": 999999, "started": "never"}))
        self.assertFalse(slots.alive(None))

    def test_answers_sees_a_listening_port(self):
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen()
        self.addCleanup(server.close)
        self.assertTrue(slots.answers(server.getsockname()[1]))

    def test_a_listener_is_stopped_only_when_it_belongs_to_the_slots_worktree(self):
        """When a service's first process is gone, a program on its port is stopped only if
        it, or its parent, names the slot's worktree."""
        table = {50: (1, 50, "/usr/bin/some-other-program --port 3101")}
        with mock.patch.object(slots, "processes", return_value=table), \
                mock.patch.object(slots, "answers", return_value=True), \
                mock.patch.object(slots, "listener", return_value=50), \
                mock.patch.object(slots.os, "killpg") as killpg, \
                mock.patch.object(slots.os, "kill") as kill:
            stopped = slots.stop_tree({"pid": 999999, "started": "never", "port": 3101},
                                      folder="/w/gone")
        self.assertFalse(stopped)
        killpg.assert_not_called()
        kill.assert_not_called()


class Website(unittest.TestCase):
    def test_the_website_starts_from_a_clean_development_build(self):
        """Turbopack's build cache from an earlier run can leave the website reloading every
        page in a loop, so each start removes the development build, and nothing else."""
        with tempfile.TemporaryDirectory() as web:
            os.makedirs(os.path.join(web, ".next", "dev", "cache"))
            os.makedirs(os.path.join(web, ".next", "types"))
            slots.fresh_dev_build(web)
            self.assertFalse(os.path.exists(os.path.join(web, ".next", "dev")))
            self.assertTrue(os.path.isdir(os.path.join(web, ".next", "types")))
            slots.fresh_dev_build(web)  # nothing to remove is fine too


class Docker(unittest.TestCase):
    def test_docker_is_found_inside_docker_desktop_when_not_on_path(self):
        with tempfile.TemporaryDirectory() as app:
            folder = os.path.join(app, "Contents", "Resources", "bin")
            os.makedirs(folder)
            open(os.path.join(folder, "docker"), "w").close()
            with mock.patch.object(slots.shutil, "which", return_value=None), \
                    mock.patch.object(slots, "DOCKER_DESKTOP", (app,)):
                env = slots.with_docker({"PATH": "/usr/bin:/bin"})
        self.assertEqual(env["PATH"].split(os.pathsep)[0], folder)

    def test_the_database_commands_never_see_a_sessions_own_supabase_settings(self):
        with mock.patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co",
                                          "SUPABASE_DB_PASSWORD": "not-for-the-cli"}), \
                mock.patch.object(slots, "docker_bin", return_value="/docker/bin"):
            env = slots.db_env(slots.Slot(3))
        self.assertNotIn("SUPABASE_URL", env)
        self.assertNotIn("SUPABASE_DB_PASSWORD", env)
        self.assertEqual(env["SUPABASE_PROJECT_ID"], "hrizzup-slot3")


class CommandLine(unittest.TestCase):
    def run_main(self, *argv, held=None):
        folder, register = register_and_hold(held)
        self.addCleanup(folder.cleanup)
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"HRIZZUP_SLOTS_DIR": register.folder}), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = slots.main(list(argv))
        return code, out.getvalue()

    def test_env_needs_a_claimed_slot(self):
        code, text = self.run_main("env")
        self.assertEqual(code, 1)
        self.assertIn("infra/slots/slot claim", text)

    def test_env_prints_the_slots_settings(self):
        code, text = self.run_main("env", held=2)
        self.assertEqual(code, 0)
        self.assertIn("export BASE_URL=http://localhost:3102", text)
        self.assertIn("export REDIS_KEY_PREFIX=dev:slot2", text)

    def test_unknown_commands_are_refused(self):
        code, text = self.run_main("launch")
        self.assertEqual(code, 1)
        self.assertIn("Unknown command", text)


def register_and_hold(number):
    folder, reg = register()
    if number is not None:
        reg.write(number, {"slot": number, "worktree": slots.worktree(), "branch": "b",
                           "claimed": "now", "running": {}})
    return folder, reg


if __name__ == "__main__":
    unittest.main()
