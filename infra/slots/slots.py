#!/usr/bin/env python3
"""Slots: each worktree's own ports, local database and Redis prefix on this Mac.

Several Claude Code sessions run at once on this Mac, each in its own git worktree (PLAN.md
step 1.8). Before one runs the website, the app's dev server (Metro) or the local database,
it claims a slot: a website port, a Metro port, a local database of its own (a Supabase
project name and a block of ports) and a Redis key prefix, which no other worktree uses
while it holds them.

    infra/slots/slot claim            claim a free slot for this worktree (or show the one it holds)
    infra/slots/slot claim --wait     if none is free, check again every 10 minutes until one is
    infra/slots/slot claim --design   the design chat's own slot (the last one; relays never take it)
    infra/slots/slot status           every slot: who holds it and what runs in it
    infra/slots/slot web [--detach]   the website on this slot's port, with staging's keys (Doppler dev)
    infra/slots/slot app [--detach]   the app's dev server (Metro) on this slot's port
    infra/slots/slot db test          this slot's database, fresh from the migrations, then its tests
    infra/slots/slot db start|stop    start or stop this slot's database (Postgres only)
    infra/slots/slot stop web|app|db|all    stop what this slot runs
    infra/slots/slot run [--doppler CONFIG] -- COMMAND...    a command with this slot's settings
    infra/slots/slot env              this slot's settings, as shell `export` lines
    infra/slots/slot docker ARGS...   Docker's own command, from Docker Desktop wherever it is
    infra/slots/slot release          stop everything this slot runs, then free it

A slot whose worktree is gone counts as free again: the next claim stops whatever it left
running and takes it. The register of who holds what lives in this repository's shared git
folder (`.git/hrizzup-slots/`), which every worktree of the repository sees and nothing
commits. README.md has the slots, their addresses and how many this Mac holds.
"""
from __future__ import annotations

import datetime
import fcntl
import json
import os
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # the worktree this copy of the tool lives in

# How many slots this Mac holds side by side, each running the website, Metro and its
# database, with room left over for the design chat (which claims one the same way).
# Measured on 9 November 2026 (README.md, "How many slots"). Staging's sign-in and the
# staging buckets allow exactly these slots' addresses; test_slots.py keeps them in step.
COUNT = 4

WEB_PORT = 3100  # slot n's website answers on 3100 + n (3000 stays the default, unslotted)
METRO_PORT = 8100  # slot n's Metro on 8100 + n (8081 stays Metro's default)
DB_PORTS = 55320  # config.toml's block, used by the Database check; slot n's is 10n above it
WAIT_SECONDS = 600  # claim --wait checks again every 10 minutes (CLAUDE.md, "Parallel sessions")
DOCKER_DESKTOP = ("/Applications/Docker.app", os.path.expanduser("~/Applications/Docker.app"))


class Failed(Exception):
    """Stops the command with a plain message (no traceback)."""


class Slot:
    """Slot n's ports, names and settings. Every number derives from n, so two slots never share one."""

    def __init__(self, number: int):
        if not 1 <= number <= 9:
            raise ValueError("slots are numbered 1 to 9")
        self.number = number

    def __eq__(self, other):
        return isinstance(other, Slot) and other.number == self.number

    def __hash__(self):
        return hash(self.number)

    def __repr__(self):
        return f"Slot({self.number})"

    @property
    def web_port(self) -> int:
        return WEB_PORT + self.number

    @property
    def metro_port(self) -> int:
        return METRO_PORT + self.number

    @property
    def website(self) -> str:
        """The website's local address: staging's sign-in and uploads allow exactly this."""
        return f"http://localhost:{self.web_port}"

    @property
    def project_id(self) -> str:
        """The local database's Supabase project name: its containers, network and volume."""
        return f"hrizzup-slot{self.number}"

    @property
    def redis_prefix(self) -> str:
        """`dev` (this Mac), then the slot: `dev:slot2:cache:feed:home` (blueprint section 14)."""
        return f"dev:slot{self.number}"

    @property
    def db_ports(self) -> dict:
        """The Supabase CLI's settings for every port in config.toml, moved up 10n.

        The CLI reads any setting from SUPABASE_<SECTION>_<KEY>, so config.toml itself stays
        as the Database check uses it. Only the database (and its shadow, for `db diff`) is
        ever started in a slot; the rest are moved too, so nothing can land on another's port.
        """
        base = DB_PORTS + 10 * self.number
        return {
            "SUPABASE_DB_SHADOW_PORT": base,
            "SUPABASE_API_PORT": base + 1,
            "SUPABASE_DB_PORT": base + 2,
            "SUPABASE_STUDIO_PORT": base + 3,
            "SUPABASE_LOCAL_SMTP_PORT": base + 4,
            "SUPABASE_ANALYTICS_PORT": base + 7,
            "SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT": base + 8,
            "SUPABASE_DB_POOLER_PORT": base + 9,
        }

    @property
    def db_port(self) -> int:
        return self.db_ports["SUPABASE_DB_PORT"]

    def ports(self) -> list:
        """Every port this slot may listen on."""
        return [self.web_port, self.metro_port, *self.db_ports.values()]

    def env(self) -> dict:
        """The settings every command run in this slot gets."""
        settings = {
            "HRIZZUP_SLOT": str(self.number),
            "PORT": str(self.web_port),
            "BASE_URL": self.website,  # the website's checks (product/web/playwright.config.ts)
            "RCT_METRO_PORT": str(self.metro_port),  # React Native's name for Metro's port
            "REDIS_KEY_PREFIX": self.redis_prefix,
            "SUPABASE_PROJECT_ID": self.project_id,
        }
        settings.update({name: str(port) for name, port in self.db_ports.items()})
        return settings


def all_slots(count: int = COUNT) -> list:
    return [Slot(n) for n in range(1, count + 1)]


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def git(*args: str) -> str:
    out = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True)
    if out.returncode != 0:
        raise Failed(f"git {' '.join(args)} failed: {out.stderr.strip()}")
    return out.stdout.strip()


def worktree() -> str:
    """This worktree's own folder, the key it holds a slot under."""
    return os.path.realpath(ROOT)


def branch() -> str:
    try:
        return git("rev-parse", "--abbrev-ref", "HEAD")
    except Failed:
        return "?"


def worktree_exists(path: str) -> bool:
    """Whether a worktree is still there. It's gone once its folder is, and also once git has
    dropped it (`git worktree remove` unregisters it first, and running servers can keep
    leftover files in the folder): its `.git` file then points at a record git no longer has."""
    link = os.path.join(path, ".git")
    if os.path.isdir(link):
        return True  # the repository's main folder
    try:
        with open(link, encoding="utf-8") as f:
            first = f.readline().strip()
    except OSError:
        return False
    if not first.startswith("gitdir:"):
        return False
    record = first[len("gitdir:"):].strip()
    if not os.path.isabs(record):
        record = os.path.join(path, record)
    return os.path.isdir(record)


# ---- The register: one small file per held slot, changed only under one lock ----


def register_folder() -> str:
    override = os.environ.get("HRIZZUP_SLOTS_DIR")  # for the tests only
    if override:
        return override
    common = git("rev-parse", "--path-format=absolute", "--git-common-dir")
    return os.path.join(common, "hrizzup-slots")


class Register:
    def __init__(self, folder: str):
        self.folder = folder

    @contextmanager
    def locked(self):
        os.makedirs(self.folder, exist_ok=True)
        with open(os.path.join(self.folder, "lock"), "a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield self
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def path(self, number: int) -> str:
        return os.path.join(self.folder, f"slot-{number}.json")

    def read(self, number: int):
        try:
            with open(self.path(number), encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return None
        except ValueError:
            return {"slot": number, "worktree": "(unreadable record)", "running": {}}

    def write(self, number: int, record: dict) -> None:
        temporary = self.path(number) + ".new"
        with open(temporary, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2)
            f.write("\n")
        os.replace(temporary, self.path(number))

    def remove(self, number: int) -> None:
        try:
            os.remove(self.path(number))
        except FileNotFoundError:
            pass

    def records(self, count: int = COUNT) -> dict:
        found = {}
        for number in range(1, 10):
            record = self.read(number)
            if record is not None:
                found[number] = record
        return found

    def held_by(self, path: str):
        """The slot number this worktree holds, or None."""
        for number, record in sorted(self.records().items()):
            if record.get("worktree") == path:
                return number
        return None


# ---- Ports, processes and Docker ----


def answers(port: int, timeout: float = 0.3) -> bool:
    """Whether anything is listening on this port, on IPv4 or IPv6."""
    for host in ("127.0.0.1", "::1"):
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            continue
    return False


def busy_ports(slot: Slot) -> list:
    return [port for port in slot.ports() if answers(port)]


def process_start(pid: int):
    """When a process started, as `ps` tells it: with the pid, its identity (pids are reused)."""
    out = subprocess.run(["ps", "-o", "lstart=", "-p", str(pid)], capture_output=True, text=True)
    return out.stdout.strip() or None


def alive(entry) -> bool:
    return bool(entry) and process_start(entry["pid"]) == entry.get("started")


def processes() -> dict:
    """Every process on this Mac: pid -> (parent pid, process group, command line)."""
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,pgid=,command="], capture_output=True, text=True)
    table = {}
    for line in out.stdout.splitlines():
        parts = line.split(None, 3)
        if len(parts) >= 3 and parts[0].isdigit():
            table[int(parts[0])] = (int(parts[1]), int(parts[2]), parts[3] if len(parts) > 3 else "")
    return table


def tree(root: int, table: dict) -> set:
    """The process and everything it started, however deep."""
    found, todo = {root}, [root]
    while todo:
        parent = todo.pop()
        for pid, (ppid, _group, _command) in table.items():
            if ppid == parent and pid not in found:
                found.add(pid)
                todo.append(pid)
    return found


def signal_tree(root: int, signum: int) -> None:
    """Sends a signal to a process, everything it started, and their process groups."""
    table = processes()
    pids = tree(root, table)
    groups = {table[pid][1] for pid in pids if pid in table} - {0, 1, os.getpgrp()}
    for group in groups:
        try:
            os.killpg(group, signum)
        except (ProcessLookupError, PermissionError):
            pass
    for pid in pids:
        try:
            os.kill(pid, signum)
        except (ProcessLookupError, PermissionError):
            pass


def listener(port: int):
    """The pid listening on a port, if any."""
    out = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], capture_output=True, text=True)
    pids = [int(p) for p in out.stdout.split() if p.isdigit()]
    return pids[0] if pids else None


def stop_tree(entry, grace: float = 15, *, folder: str = "") -> bool:
    """Stops a service this tool started: its first process and everything under it.

    Next.js and Expo each put their server in a process group of its own, so the whole tree
    is found from the first process, and each process and each of their groups is stopped.
    If that first process is already gone but the service still answers on its port, the
    listener is stopped only when its own command line, or its parent's, names the
    worktree the slot belonged to (`folder`), so another program on that port is never touched.
    """
    if not entry:
        return False
    table = processes()
    pids = tree(entry["pid"], table) if alive(entry) else set()
    port = entry.get("port")
    if not pids and port and folder and answers(port):
        pid = listener(port)
        if pid in table:
            parent = table[pid][0]
            lines = table[pid][2] + " " + table.get(parent, (0, 0, ""))[2]
            if folder in lines:
                pids = tree(table[pid][1], table) | {pid} if table[pid][1] > 1 else {pid}
    if not pids:
        return False
    own = os.getpgrp()
    groups = {table[pid][1] for pid in pids if pid in table} - {0, 1, own}
    for signum in (signal.SIGTERM, signal.SIGKILL):
        for group in groups:
            try:
                os.killpg(group, signum)
            except (ProcessLookupError, PermissionError):
                pass
        for pid in pids:
            try:
                os.kill(pid, signum)
            except (ProcessLookupError, PermissionError):
                pass
        deadline = time.monotonic() + (grace if signum == signal.SIGTERM else 5)
        while time.monotonic() < deadline:
            remaining = processes()
            if not any(pid in remaining for pid in pids) and not any(
                    group == g for (_p, g, _c) in remaining.values() for group in groups):
                return True
            time.sleep(0.25)
    return True


def docker_bin() -> str:
    """The folder holding Docker's command and its credential helpers.

    Docker Desktop keeps them inside the app, and its installer may not have put `docker`
    on the PATH that sessions get. The repository's scripts find it here instead of
    changing this Mac's shell setup.
    """
    found = shutil.which("docker")
    if found:
        return os.path.dirname(os.path.realpath(found))
    for app in DOCKER_DESKTOP:
        folder = os.path.join(app, "Contents", "Resources", "bin")
        if os.path.isfile(os.path.join(folder, "docker")):
            return folder
    raise Failed("Docker isn't installed: no `docker` command and no Docker Desktop in Applications")


def with_docker(env: dict) -> dict:
    """The environment with Docker's folder first on PATH (images are pulled through
    `docker-credential-desktop`, which lives beside `docker`)."""
    env = dict(env)
    folder = docker_bin()
    path = env.get("PATH", "")
    if folder not in path.split(os.pathsep):
        env["PATH"] = folder + (os.pathsep + path if path else "")
    return env


def docker_ready(env: dict) -> bool:
    command = [os.path.join(docker_bin(), "docker"), "info", "--format", "{{.ServerVersion}}"]
    return subprocess.run(command, env=env, capture_output=True).returncode == 0


def ensure_docker(env: dict, wait: float = 180) -> None:
    if docker_ready(env):
        return
    app = next((a for a in DOCKER_DESKTOP if os.path.isdir(a)), None)
    if sys.platform != "darwin" or app is None:
        raise Failed("Docker isn't answering: start it, then try again")
    print("Docker Desktop isn't running; starting it…", flush=True)
    subprocess.run(["open", "-g", "-a", app], check=False)
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline:
        time.sleep(3)
        if docker_ready(env):
            return
    raise Failed("Docker Desktop didn't start within 3 minutes; open it, then try again")


def db_running(slot: Slot, env: dict) -> bool:
    name = f"supabase_db_{slot.project_id}"
    out = subprocess.run(
        [os.path.join(docker_bin(), "docker"), "ps", "--filter", f"name=^{name}$", "--format", "{{.Names}}"],
        env=env, capture_output=True, text=True,
    )
    return name in out.stdout.split()


def supabase_cli() -> list:
    path = os.path.join(ROOT, "infra", "supabase", "node_modules", ".bin", "supabase")
    if not os.access(path, os.X_OK):
        raise Failed("The Supabase CLI isn't installed in this worktree: run `pnpm install --frozen-lockfile` first")
    return [path, "--workdir", os.path.join(ROOT, "infra")]


def db_env(slot) -> dict:
    """The database commands' environment: none of a session's own SUPABASE_ settings (such
    as staging's, from Doppler) reach the CLI, only the slot's."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("SUPABASE_")}
    if slot is not None:
        env.update(slot.env())
    return with_docker(env)


def stop_db(slot: Slot, env=None) -> None:
    env = env or db_env(slot)
    if not docker_ready(env) or not db_running(slot, env):
        return
    subprocess.run(
        [*supabase_cli(), "stop", "--project-id", slot.project_id, "--no-backup"],
        env=env, check=False, stdout=subprocess.DEVNULL,
    )


def tidy(slot: Slot, record) -> None:
    """Stops whatever a slot's last holder left running: its website and Metro (only the
    processes this tool started, checked by start time) and its database."""
    for entry in ((record or {}).get("running") or {}).values():
        stop_tree(entry, folder=(record or {}).get("worktree", ""))
    try:
        stop_db(slot)
    except Failed:
        pass  # no Docker or no CLI here: nothing of this slot's can be running in Docker


# ---- Claiming and releasing ----


def claim(register: Register, path: str, branch_name: str, *, count: int = COUNT, design: bool = False,
          exists=worktree_exists, busy=busy_ports, tidy_up=tidy):
    """Gives this worktree a slot: the one it already holds, or the lowest one that's free
    (or whose worktree is gone) with all its ports free. The last slot is kept for the
    design chat (`design=True`), so a round's relays never leave it without one.
    Returns (number, new) or (None, [(number, why it was passed over)])."""
    with register.locked():
        held = register.held_by(path)
        if held is not None:
            return held, False
        records = register.records()
        passed_over = []
        candidates = all_slots(count)[-1:] if design else all_slots(count)[:-1]
        for slot in candidates:
            record = records.get(slot.number)
            if record is not None and exists(record.get("worktree", "")):
                passed_over.append((slot.number, f"held by {record.get('worktree')}"))
                continue
            in_use = busy(slot)
            if in_use:
                tidy_up(slot, record)  # its last holder's leftovers, if they are what's in the way
                in_use = busy(slot)
            if in_use:
                ports = ", ".join(str(p) for p in in_use)
                passed_over.append((slot.number, f"port {ports} in use by another program"))
                continue
            register.write(slot.number, {
                "slot": slot.number,
                "worktree": path,
                "branch": branch_name,
                "claimed": now(),
                "running": {},
            })
            return slot.number, True
        return None, passed_over


def release(register: Register, path: str, *, tidy_up=tidy):
    """Stops everything this worktree's slot runs, then frees it. Returns the number freed."""
    with register.locked():
        number = register.held_by(path)
        if number is None:
            return None
        tidy_up(Slot(number), register.read(number))
        register.remove(number)
        return number


def my_slot(register: Register) -> Slot:
    number = register.held_by(worktree())
    if number is None:
        raise Failed("This worktree holds no slot. Claim one first: infra/slots/slot claim")
    return Slot(number)


# ---- Running the website and Metro ----


def ready(service: str, slot: Slot) -> bool:
    if service == "web":
        url = f"{slot.website}/api/health"
    else:
        url = f"http://localhost:{slot.metro_port}/status"
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            body = response.read(200).decode(errors="replace")
            return service == "web" or "packager-status:running" in body
    except urllib.error.HTTPError:
        return service == "web"  # the website answered (a failing health check is still an answer)
    except (urllib.error.URLError, OSError):
        return False


def installed(folder: str, program: str) -> str:
    """A package's own command from its node_modules, run directly: through `pnpm exec`, two
    more Node processes (about 170 MB) would sit above every server."""
    path = os.path.join(folder, "node_modules", ".bin", program)
    if not os.access(path, os.X_OK):
        raise Failed(f"{program} isn't installed in this worktree: run `pnpm install --frozen-lockfile` first")
    return path


def service_command(service: str, slot: Slot):
    """The command, folder and environment for the website or Metro in this slot."""
    env = dict(os.environ)
    env.update(slot.env())
    if service == "web":
        # Staging's keys come from Doppler dev; the slot's own settings go on top of them
        # (REDIS_KEY_PREFIX among them), so they are set again inside Doppler's run.
        overrides = [f"{k}={v}" for k, v in slot.env().items()]
        folder = os.path.join(ROOT, "product", "web")
        command = [os.path.join(ROOT, "infra", "doppler", "run"), "dev", "--", "env", *overrides,
                   installed(folder, "next"), "dev", "--port", str(slot.web_port)]
        return command, folder, env
    # CI=1 would turn off Metro's file watching and Fast Refresh (expo start --help).
    env.pop("CI", None)
    folder = os.path.join(ROOT, "product", "app")
    return [installed(folder, "expo"), "start", "--port", str(slot.metro_port)], folder, env


def run_service(register: Register, service: str, detach: bool) -> int:
    slot = my_slot(register)
    port = slot.web_port if service == "web" else slot.metro_port
    name = "website" if service == "web" else "app's dev server (Metro)"
    command, folder, env = service_command(service, slot)
    log = os.path.join(register.folder, f"slot-{slot.number}-{service}.log") if detach else None
    with register.locked():
        record = register.read(slot.number)
        if alive(record["running"].get(service)):
            raise Failed(f"The {name} is already running in slot {slot.number} "
                         f"(port {port}); `infra/slots/slot stop {service}` stops it")
        if answers(port):
            raise Failed(f"Port {port} is in use by another program, so the {name} can't start")
        output = open(log, "ab") if log else None
        child = subprocess.Popen(
            command, cwd=folder, env=env, start_new_session=True,
            stdin=subprocess.DEVNULL if detach else None,
            stdout=output, stderr=subprocess.STDOUT if output else None,
        )
        if output:
            output.close()
        record["running"][service] = {"pid": child.pid, "started": process_start(child.pid),
                                      "port": port, "log": log}
        register.write(slot.number, record)
    print(f"Slot {slot.number}: starting the {name} on port {port}" + (f" (log: {log})" if log else ""),
          flush=True)

    if detach:
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            if child.poll() is not None:
                forget(register, slot, service, child.pid)
                raise Failed(f"The {name} stopped while starting; its log: {log}")
            if ready(service, slot):
                where = slot.website if service == "web" else f"http://localhost:{port}"
                print(f"Slot {slot.number}: the {name} answers on {where}")
                return 0
            time.sleep(2)
        raise Failed(f"The {name} didn't answer within 4 minutes; its log: {log}")

    entry = {"pid": child.pid, "started": process_start(child.pid), "port": port}

    def forward(signum, _frame):
        signal_tree(child.pid, signum)

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, forward)
    code = child.wait()
    stop_tree(entry, grace=10, folder=worktree())  # anything it left behind
    forget(register, slot, service, child.pid)
    return code


def forget(register: Register, slot: Slot, service: str, pid: int) -> None:
    with register.locked():
        record = register.read(slot.number)
        if record and (record.get("running") or {}).get(service, {}).get("pid") == pid:
            del record["running"][service]
            register.write(slot.number, record)


def stop(register: Register, what: str) -> None:
    slot = my_slot(register)
    services = ["web", "app"] if what == "all" else [what] if what in ("web", "app") else []
    with register.locked():
        record = register.read(slot.number)
        for service in services:
            entry = record["running"].pop(service, None)
            stopped = stop_tree(entry, folder=worktree())
            print(f"Slot {slot.number}: {service} " + ("stopped" if stopped else "wasn't running"))
        register.write(slot.number, record)
    if what in ("db", "all"):
        stop_db(slot)
        print(f"Slot {slot.number}: database stopped (and its data deleted; it's rebuilt from the migrations)")


# ---- The database ----


def database(register, action: str) -> int:
    """This slot's database: Postgres alone (`supabase db start`), the only service the
    Database check's tests use. The website on this Mac uses staging's services (Doppler
    dev), so nothing else is ever started. In GitHub's runners there are no slots: the
    Database check uses config.toml as it is."""
    in_ci = register is None
    slot = None if in_ci else my_slot(register)
    env = db_env(slot)
    if not in_ci:
        ensure_docker(env)
    cli = supabase_cli()

    def step(*args: str) -> None:
        if subprocess.run([*cli, *args], env=env).returncode != 0:
            raise Failed(f"supabase {' '.join(args)} failed")

    if action == "stop":
        if slot is not None:
            stop_db(slot, env)
        return 0
    if action == "start":
        step("db", "start")
    elif action == "test":
        # As in the Database check: a fresh database from the migrations, then the tests.
        if slot is not None and db_running(slot, env):
            step("db", "reset")
        else:
            step("db", "start")
        step("test", "db")
    else:
        raise Failed("infra/slots/slot db start|test|stop")
    return 0


# ---- Showing slots ----


def describe(slot: Slot) -> str:
    return (f"website {slot.website}, Metro port {slot.metro_port}, "
            f"database {slot.project_id} on port {slot.db_port}, Redis prefix {slot.redis_prefix}")


def status(register: Register) -> None:
    records = register.records()
    docker_env = None
    try:
        docker_env = with_docker(dict(os.environ))
        if not docker_ready(docker_env):
            docker_env = None
    except Failed:
        pass
    me = worktree()
    print(f"{COUNT} slots on this Mac (infra/slots/README.md):")
    for slot in all_slots():
        record = records.get(slot.number)
        kept = " (kept for the design chat: claim --design)" if slot.number == COUNT else ""
        print(f"\nSlot {slot.number}{kept}: {describe(slot)}")
        if record is None:
            print("  free")
            continue
        holder = record.get("worktree", "?")
        mine = " (this worktree)" if holder == me else ""
        state = "held" if worktree_exists(holder) else "free again: its worktree is gone"
        print(f"  {state} by {os.path.basename(holder)}{mine}, branch {record.get('branch', '?')}, "
              f"since {record.get('claimed', '?')}")
        running = record.get("running") or {}
        parts = []
        for service, label in (("web", "website"), ("app", "Metro")):
            parts.append(f"{label} {'running' if alive(running.get(service)) else 'stopped'}")
        if docker_env is not None:
            parts.append(f"database {'running' if db_running(slot, docker_env) else 'stopped'}")
        print("  " + ", ".join(parts))
    extra = sorted(n for n in records if n > COUNT)
    if extra:
        print(f"\nAlso registered beyond the {COUNT} slots: {extra} (release them)")


def print_slot(slot: Slot, new: bool) -> None:
    verb = "is yours" if new else "is already this worktree's"
    print(f"Slot {slot.number} {verb}:")
    print(f"  website          {slot.website}            infra/slots/slot web")
    print(f"  app dev server   port {slot.metro_port} (Metro)        infra/slots/slot app")
    print(f"  database         {slot.project_id}, port {slot.db_port}   infra/slots/slot db test")
    print(f"  Redis prefix     {slot.redis_prefix}")
    print("Release it when you're done: infra/slots/slot release")


# ---- The command line ----


def main(argv: list) -> int:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0 if argv else 2
    command, args = argv[0], argv[1:]
    try:
        if command == "docker":
            env = with_docker(dict(os.environ))
            binary = os.path.join(docker_bin(), "docker")
            os.execve(binary, ["docker", *args], env)
        if command == "db" and os.environ.get("GITHUB_ACTIONS") == "true":
            if len(args) != 1:
                raise Failed("infra/slots/slot db start|test|stop")
            return database(None, args[0])  # GitHub's runners hold no slots (database())
        register = Register(register_folder())
        if command == "claim":
            wait, design = "--wait" in args, "--design" in args
            if set(args) - {"--wait", "--design"} or len(set(args)) != len(args):
                raise Failed("infra/slots/slot claim [--design] [--wait]")
            while True:
                number, detail = claim(register, worktree(), branch(), design=design)
                if number is not None:
                    print_slot(Slot(number), detail)
                    return 0
                print(f"No slot is free ({now()}):")
                for n, why in detail:
                    print(f"  slot {n}: {why}")
                if not wait:
                    print("Check again in 10 minutes (or run `infra/slots/slot claim --wait`).")
                    return 3
                print("Checking again in 10 minutes…", flush=True)
                time.sleep(WAIT_SECONDS)
        if command == "release":
            number = release(register, worktree())
            print(f"Slot {number} is free again." if number else "This worktree holds no slot.")
            return 0
        if command == "status":
            status(register)
            return 0
        if command in ("web", "app"):
            if args not in ([], ["--detach"]):
                raise Failed(f"infra/slots/slot {command} [--detach]")
            return run_service(register, command, detach=bool(args))
        if command == "stop":
            if args not in (["web"], ["app"], ["db"], ["all"]):
                raise Failed("infra/slots/slot stop web|app|db|all")
            stop(register, args[0])
            return 0
        if command == "db":
            if len(args) != 1:
                raise Failed("infra/slots/slot db start|test|stop")
            return database(register, args[0])
        if command == "env":
            for name, value in my_slot(register).env().items():
                print(f"export {name}={shlex.quote(value)}")
            return 0
        if command == "run":
            doppler = None
            if args[:1] == ["--doppler"]:
                if len(args) < 2:
                    raise Failed("infra/slots/slot run --doppler CONFIG -- COMMAND...")
                doppler, args = args[1], args[2:]
            if args[:1] != ["--"] or len(args) < 2:
                raise Failed("infra/slots/slot run [--doppler CONFIG] -- COMMAND...")
            slot = my_slot(register)
            env = with_docker(dict(os.environ))
            env.update(slot.env())
            command_line = args[1:]
            if doppler:
                # Doppler's values first, then the slot's on top (REDIS_KEY_PREFIX among them).
                overrides = [f"{k}={v}" for k, v in slot.env().items()]
                command_line = [os.path.join(ROOT, "infra", "doppler", "run"), doppler, "--",
                                "env", *overrides, *command_line]
            os.execvpe(command_line[0], command_line, env)
        raise Failed(f"Unknown command {command!r}; infra/slots/slot --help lists them")
    except Failed as problem:
        print(f"infra/slots/slot: {problem}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
