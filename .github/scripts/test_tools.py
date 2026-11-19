"""Tests for the checks' tool downloads (tools.py) and for how every workflow uses them: offline,
with made-up files, servers and tokens, and no real download.

    python3 -m unittest discover -s .github/scripts

A pinned tool is used only when its checksum matches; a failed download is retried after a
pause only when the network or the server failed, never when the pin is wrong; GitHub's files
are fetched signed in, without the token ever going anywhere but GitHub's API; only downloads
are retried, never a test or a build; and no workflow downloads a tool any other way. The
browsers' system libraries are installed from GitHub's cache only when it holds exactly the set
made for this Playwright and this machine image (otherwise the mirrors' way takes over), and the
checks read pnpm's package store and never save it.
"""
import contextlib
import email.message
import hashlib
import http.client
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import urllib.error
from unittest import mock

import tools

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKFLOWS = os.path.join(ROOT, ".github", "workflows")
TOKEN = "made-up-job-token"
BODY = b"a pinned tool, made up for the tests\n" * 100


def made_up_tool(url="https://downloads.example/tool-1.0.tar.gz", body=BODY):
    return tools.Tool("made-up", "1.0", url, hashlib.sha256(body).hexdigest(), "the tests")


class Answer(io.BytesIO):
    """A server's answer: a body and its headers."""

    def __init__(self, body, length=None):
        super().__init__(body)
        self.headers = email.message.Message()
        self.headers["Content-Length"] = str(len(body) if length is None else length)


def http_error(code, headers=None):
    message = email.message.Message()
    for name, value in (headers or {}).items():
        message[name] = value
    return urllib.error.HTTPError("https://downloads.example/", code, "made up", message, None)


class Server:
    """Answers each request with the next of `answers`: bytes, an Answer, or an exception."""

    def __init__(self, *answers):
        self.answers, self.requests = list(answers), []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        answer = self.answers.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        return answer if isinstance(answer, Answer) else Answer(answer)


class InACache(unittest.TestCase):
    """Each test gets its own home folder, so the tools' cache folder is a made-up one."""

    def setUp(self):
        home = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        patcher = mock.patch.dict(os.environ, {"HOME": home.name})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.pauses, self.lines = [], []

    def fetch(self, tool, server, token=None):
        return tools.fetch(tool, token=token, opener=server, sleep=self.pauses.append, log=self.lines.append)

    def leftovers(self, tool):
        folder = os.path.dirname(tool.path)
        return sorted(os.listdir(folder)) if os.path.isdir(folder) else []


class ThePins(unittest.TestCase):
    def test_each_pin_is_a_version_a_checksum_and_an_address_that_names_the_version(self):
        self.assertEqual(set(tools.PINNED), {"gitleaks", "oasdiff", "maestro", "android-emulator", "android-system-image"})
        for name, tool in tools.PINNED.items():
            with self.subTest(tool=name):
                self.assertEqual(tool.name, name)
                self.assertRegex(tool.sha256, r"^[0-9a-f]{64}$")
                self.assertTrue(tool.url.startswith("https://"), tool.url)
                self.assertTrue(tool.key.startswith(f"tool-{name}-{tool.version}-"), tool.key)
                self.assertIn(tool.sha256[:16], tool.key)
                self.assertTrue(tool.file.startswith(tools.CACHE + "/" + name + "/"), tool.file)
        self.assertIn("v8.30.1/gitleaks_8.30.1_", tools.PINNED["gitleaks"].url)
        self.assertIn("/cli-2.12.1/", tools.PINNED["maestro"].url)
        self.assertIn("-16740729.zip", tools.PINNED["android-emulator"].url)
        self.assertTrue(tools.PINNED["android-emulator"].version.endswith("-16740729"))
        self.assertIn("/sys-img/google_apis/x86_64-34_r14.zip", tools.PINNED["android-system-image"].url)
        self.assertEqual(tools.PINNED["android-system-image"].version, "34-google_apis-x86_64-r14")

    def test_the_keys_for_github_outputs_name_the_tool(self):
        lines = tools.keys(["gitleaks", "android-system-image"])
        self.assertIn(f"gitleaks_key={tools.PINNED['gitleaks'].key}", lines)
        self.assertIn(f"android_system_image_file={tools.PINNED['android-system-image'].file}", lines)
        self.assertTrue(any(line.startswith("android_system_image_path=/") for line in lines))
        self.assertIn("android_system_image_version=34-google_apis-x86_64-r14", lines)
        with self.assertRaises(SystemExit):
            tools.keys(["no-such-tool"])

    def test_plain_keys_drop_the_tools_name(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(tools.main(["key", "--plain", "android-emulator"]), 0)
        lines = out.getvalue().splitlines()
        self.assertIn(f"key={tools.PINNED['android-emulator'].key}", lines)
        self.assertIn(f"file={tools.PINNED['android-emulator'].file}", lines)
        self.assertEqual(len(lines), 4)

    def test_browsers_follow_playwrights_version_and_the_operating_system(self):
        with mock.patch.object(tools, "package_version", return_value="1.64.1"):
            lines = tools.browsers_key({"ImageOS": "ubuntu24"})
        self.assertIn("browsers_key=playwright-1.64.1-chromium-webkit-ubuntu24-v1", lines)
        self.assertIn("browsers_file=~/.cache/ms-playwright", lines)

    def test_the_database_images_follow_the_clis_version_and_the_local_settings(self):
        with mock.patch.object(tools, "package_version", return_value="2.122.0"):
            lines = tools.database_images_key()
        key = lines[0]
        self.assertRegex(key, r"^database_images_key=supabase-images-2\.122\.0-[0-9a-f]{16}-v1$")

    IMAGE = {"ImageOS": "ubuntu24", "ImageVersion": "20261110.1.0"}

    def libraries_key(self, environ, version="1.64.1"):
        with mock.patch.object(tools, "package_version", return_value=version):
            return tools.browser_libraries_key(environ)

    def test_the_system_libraries_follow_playwrights_version_and_the_machine_image(self):
        lines = self.libraries_key(self.IMAGE)
        self.assertEqual(lines[0], "browser_libraries_key=browser-libraries-playwright-1.64.1-ubuntu24-20261110.1.0-v1")
        self.assertEqual(lines[1], "browser_libraries_file=~/.cache/hrizzup-tools/browser-libraries")
        self.assertRegex(lines[2], r"^browser_libraries_path=/.+/\.cache/hrizzup-tools/browser-libraries$")
        self.assertEqual(lines[3], "browser_libraries_version=1.64.1")
        # Each of the three moves the key; any one alone is enough to miss the cache.
        keys = {lines[0], self.libraries_key({**self.IMAGE, "ImageVersion": "20261117.1.0"})[0],
                self.libraries_key({**self.IMAGE, "ImageOS": "ubuntu26"})[0],
                self.libraries_key(self.IMAGE, version="1.65.0")[0]}
        self.assertEqual(len(keys), 4)

    def test_the_system_libraries_key_says_unknown_off_githubs_machines(self):
        key = self.libraries_key({})[0]
        self.assertEqual(key, "browser_libraries_key=browser-libraries-playwright-1.64.1-unknown-unknown-v1")
        self.assertEqual(tools.machine_image({"ImageOS": "", "ImageVersion": ""}), ("unknown", "unknown"))

    def make_lockfile(self, text):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        with open(os.path.join(folder.name, "pnpm-lock.yaml"), "w", encoding="utf-8") as f:
            f.write(text)
        return mock.patch.object(tools, "ROOT", folder.name)

    def store_key(self, lockfile, environ=None):
        with self.make_lockfile(lockfile), mock.patch.object(tools, "store_path", return_value="/home/runner/.local/share/pnpm/store/v11"):
            return tools.pnpm_store_key({"ImageOS": "ubuntu24"} if environ is None else environ)

    def test_pnpms_store_follows_the_lockfiles_hash_and_the_operating_system(self):
        lock = "lockfileVersion: '9.0'\n"
        lines = self.store_key(lock)
        digest = hashlib.sha256(lock.encode()).hexdigest()[:16]
        self.assertEqual(lines[0], f"pnpm_store_key=pnpm-store-ubuntu24-{digest}-v1")
        self.assertEqual(lines[1], "pnpm_store_file=/home/runner/.local/share/pnpm/store/v11")
        self.assertEqual(lines[2], "pnpm_store_path=/home/runner/.local/share/pnpm/store/v11")
        self.assertEqual(lines[3], "pnpm_store_prefix=pnpm-store-ubuntu24-")

    def test_a_changed_lockfile_changes_the_key_but_not_the_prefix_a_pull_request_starts_from(self):
        before, after = self.store_key("a: 1\n"), self.store_key("a: 2\n")
        key_before, key_after = (line.split("=", 1)[1] for line in (before[0], after[0]))
        prefix = before[3].split("=", 1)[1]
        self.assertNotEqual(key_before, key_after)
        self.assertEqual(before[3], after[3])
        self.assertTrue(key_before.startswith(prefix) and key_after.startswith(prefix))
        self.assertEqual(self.store_key("a: 1\n", environ={})[3], "pnpm_store_prefix=pnpm-store-unknown-")

    def test_the_store_key_prints_only_key_lines_for_githubs_output(self):
        out = io.StringIO()
        with self.make_lockfile("a: 1\n"), mock.patch.object(tools, "store_path", return_value="/store"), \
                contextlib.redirect_stdout(out):
            self.assertEqual(tools.main(["key", "pnpm-store"], environ={"ImageOS": "ubuntu24"}), 0)
        for line in out.getvalue().splitlines():
            self.assertRegex(line, r"^pnpm_store_(key|file|path|prefix)=\S+$")

    def test_the_store_path_comes_from_pnpm_and_an_empty_answer_stops_the_key(self):
        done = subprocess.CompletedProcess([], 0, stdout="/store/v11\n")
        with mock.patch.object(subprocess, "run", return_value=done) as run:
            self.assertEqual(tools.store_path(), "/store/v11")
        self.assertEqual(run.call_args.args[0], ["pnpm", "store", "path", "--silent"])
        with mock.patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout="\n")):
            with self.assertRaises(SystemExit):
                tools.store_path()

    def test_every_new_tool_is_known(self):
        self.assertIn("browser-libraries", tools.known())
        self.assertIn("pnpm-store", tools.known())


class FetchingAPinnedFile(InACache):
    def test_a_cached_copy_with_the_right_checksum_needs_no_download(self):
        tool = made_up_tool()
        os.makedirs(os.path.dirname(tool.path))
        with open(tool.path, "wb") as f:
            f.write(BODY)
        server = Server()
        self.assertEqual(self.fetch(tool, server), tool.path)
        self.assertEqual(server.requests, [])
        self.assertIn("from GitHub's cache", self.lines[-1])

    def test_a_cached_copy_with_the_wrong_checksum_is_downloaded_again(self):
        tool = made_up_tool()
        os.makedirs(os.path.dirname(tool.path))
        with open(tool.path, "wb") as f:
            f.write(b"something else")
        self.fetch(tool, Server(BODY))
        with open(tool.path, "rb") as f:
            self.assertEqual(f.read(), BODY)

    def test_a_busy_server_is_tried_again_after_a_pause(self):
        tool = made_up_tool()
        server = Server(http_error(504), http_error(503), BODY)
        self.assertEqual(self.fetch(tool, server), tool.path)
        self.assertEqual(self.pauses, [15, 30])
        self.assertEqual(len(server.requests), 3)
        self.assertEqual(self.leftovers(tool), [os.path.basename(tool.path)])

    def test_no_answer_or_a_broken_off_download_is_tried_again(self):
        tool = made_up_tool()
        server = Server(urllib.error.URLError("no route"), TimeoutError(), Answer(BODY[:10], length=len(BODY)),
                        http.client.RemoteDisconnected(), BODY)
        self.fetch(tool, server)
        self.assertEqual(self.pauses, [15, 30, 60, 120])

    def test_it_gives_up_after_five_attempts(self):
        tool = made_up_tool()
        server = Server(*[http_error(504)] * 5)
        with self.assertRaises(tools.DownloadError) as caught:
            self.fetch(tool, server)
        self.assertIn("every attempt failed", str(caught.exception))
        self.assertEqual(self.pauses, [15, 30, 60, 120])
        self.assertEqual(self.leftovers(tool), [])

    def test_a_wrong_address_is_not_retried(self):
        for code in (404, 401, 410):
            with self.subTest(code=code):
                self.pauses.clear()
                with self.assertRaises(tools.DownloadError):
                    self.fetch(made_up_tool(), Server(http_error(code)))
                self.assertEqual(self.pauses, [])

    def test_githubs_rate_limit_is_waited_out(self):
        server = Server(http_error(403, {"X-RateLimit-Remaining": "0"}), BODY)
        self.fetch(made_up_tool(), server)
        self.assertEqual(self.pauses, [15])

    def test_a_download_with_the_wrong_checksum_is_never_used_or_retried(self):
        tool = made_up_tool()
        with self.assertRaises(tools.DownloadError) as caught:
            self.fetch(tool, Server(b"not the pinned file"))
        self.assertIn("isn't used", str(caught.exception))
        self.assertEqual(self.pauses, [])
        self.assertEqual(self.leftovers(tool), [])
        self.assertFalse(os.path.exists(tool.path))


class SignedInFromGitHub(InACache):
    URL = "https://github.com/someone/tool/releases/download/v1.0/tool-1.0.tar.gz"
    ASSET = "https://api.github.com/repos/someone/tool/releases/assets/42"

    def release(self, *names):
        return json.dumps({"assets": [{"name": n, "url": self.ASSET} for n in names]}).encode()

    def test_a_release_file_is_fetched_through_githubs_api_with_the_jobs_token(self):
        tool = made_up_tool(self.URL)
        server = Server(self.release("other.zip", "tool-1.0.tar.gz"), BODY)
        self.fetch(tool, server, token=TOKEN)
        api, asset = server.requests
        self.assertEqual(api.full_url, "https://api.github.com/repos/someone/tool/releases/tags/v1.0")
        self.assertEqual(asset.full_url, self.ASSET)
        self.assertEqual(asset.get_header("Accept"), "application/octet-stream")
        for request in server.requests:
            # The token goes to GitHub's API only: never in a header a redirect would carry on.
            self.assertEqual(request.unredirected_hdrs.get("Authorization"), f"Bearer {TOKEN}")
            self.assertNotIn("Authorization", request.headers)

    def test_without_a_token_it_downloads_the_address_itself(self):
        tool = made_up_tool(self.URL)
        server = Server(BODY)
        self.fetch(tool, server)
        self.assertEqual(server.requests[0].full_url, self.URL)
        self.assertNotIn("Authorization", server.requests[0].unredirected_hdrs)

    def test_githubs_api_failing_is_retried_and_a_missing_file_is_not(self):
        tool = made_up_tool(self.URL)
        self.fetch(tool, Server(http_error(504), self.release("tool-1.0.tar.gz"), BODY), token=TOKEN)
        self.assertEqual(self.pauses, [15])
        os.remove(tool.path)
        self.pauses.clear()
        with self.assertRaises(tools.DownloadError) as caught:
            self.fetch(tool, Server(self.release("other.zip")), token=TOKEN)
        self.assertIn("has no file named tool-1.0.tar.gz", str(caught.exception))
        self.assertEqual(self.pauses, [])

    def test_nothing_printed_holds_the_token(self):
        tool = made_up_tool(self.URL)
        with self.assertRaises(tools.DownloadError):
            self.fetch(tool, Server(*[http_error(502)] * 5), token=TOKEN)
        self.assertFalse(any(TOKEN in line for line in self.lines))


class RetryingOnlyDownloads(unittest.TestCase):
    DOWNLOAD = ["pnpm", "exec", "playwright", "install", "chromium", "webkit"]

    def run_retry(self, command, codes):
        runs, pauses, lines = [], [], []
        codes = list(codes)

        def run(cmd):
            runs.append(cmd)
            return codes.pop(0)

        code = tools.retry(command, run=run, sleep=pauses.append, log=lines.append)
        return code, runs, pauses, lines

    def test_a_failed_browser_download_is_run_again_after_a_pause(self):
        code, runs, pauses, _ = self.run_retry(self.DOWNLOAD, [1, 1, 0])
        self.assertEqual((code, len(runs), pauses), (0, 3, [15, 30]))

    def test_it_gives_up_with_the_last_exit_code(self):
        code, runs, pauses, _ = self.run_retry(self.DOWNLOAD, [1, 1, 1, 1, 7])
        self.assertEqual((code, len(runs), pauses), (7, 5, [15, 30, 60, 120]))

    def test_tests_builds_and_anything_else_are_refused(self):
        for command in (
            ["pnpm", "exec", "playwright", "test"],
            ["pnpm", "exec", "playwright", "install", "--with-deps", "chromium"],
            ["pnpm", "exec", "playwright", "install"],
            ["pnpm", "exec", "playwright", "install", "chromium;", "rm"],
            ["pnpm", "test"],
            ["pnpm", "exec", "turbo", "run", "test:db"],
            ["bash", "product/app/journeys/run.sh"],
            ["docker", "pull", "postgres"],
        ):
            with self.subTest(command=command):
                code, runs, _, lines = self.run_retry(command, [])
                self.assertEqual(code, 2)
                self.assertEqual(runs, [])
                self.assertIn("never a test or a build", lines[0])


class TheDatabasesImages(unittest.TestCase):
    def plan(self, status):
        return json.dumps({"tasks": [
            {"taskId": "@hrizzup/web#test:db", "cache": {"status": "MISS"}},
            {"taskId": "@hrizzup/database#test:db", "cache": {"status": status}},
        ]})

    def test_they_are_loaded_only_when_the_tests_will_run_here(self):
        self.assertFalse(tools.will_run(self.plan("HIT")))
        self.assertTrue(tools.will_run(self.plan("MISS")))
        with self.assertRaises(SystemExit):
            tools.will_run(json.dumps({"tasks": []}))

    def test_without_turborepos_plan_the_images_are_loaded_and_the_check_goes_on(self):
        def failing(command, **kwargs):
            raise subprocess.CalledProcessError(1, command)

        lines = []
        self.assertEqual(tools.database("will-run", run=failing, log=lines.append), ["run=true"])
        self.assertIn("loading the images anyway", lines[0])
        plan = subprocess.CompletedProcess([], 0, stdout=self.plan("HIT"))
        self.assertEqual(tools.database("will-run", run=lambda *a, **k: plan, log=lines.append), ["run=false"])

    def test_only_supabases_images_are_kept(self):
        listing = "\n".join([
            "public.ecr.aws/supabase/postgres:17.11.0.006",
            "public.ecr.aws/supabase/pg_prove:3.36",
            "supabase/gotrue:v2.197.0",
            "ghcr.io/supabase/realtime:v2.147.1",
            "postgres:16",
            "public.ecr.aws/supabase/postgres:<none>",
            "someone/supabase-lookalike:1",
        ])
        self.assertEqual(tools.database_images(listing), [
            "ghcr.io/supabase/realtime:v2.147.1",
            "public.ecr.aws/supabase/pg_prove:3.36",
            "public.ecr.aws/supabase/postgres:17.11.0.006",
            "supabase/gotrue:v2.197.0",
        ])


# --- The browsers' system libraries ----------------------------------------------------------

# What `playwright install-deps --dry-run chromium webkit` prints on Playwright 1.64.1 when
# packages are missing (checked in an Ubuntu 24.04 container on 18 November 2026: stdout holds
# "Missing system dependencies (N):" and N indented names, the exit code is 1).
DRY_RUN = """Missing system dependencies (3):
  libasound2t64
  libargon2-1
  libx11-6
"""
MIRROR = "http://ports.ubuntu.com/ubuntu-ports"
# (the file as apt names it on disk, its place in Ubuntu's pool, its content). apt writes an
# epoch's colon as %3a in the file name but the pool's name has no epoch; the URL writes ~ and +
# as %7e and %2b.
PACKAGES = [
    ("libasound2t64_1.2.11-1build2_amd64.deb", "pool/main/a/alsa-lib/libasound2t64_1.2.11-1build2_amd64.deb",
     b"the first package, made up for the tests\n" * 50),
    ("libargon2-1_0~20190702+dfsg-4build1_amd64.deb", "pool/main/a/argon2/libargon2-1_0~20190702+dfsg-4build1_amd64.deb",
     b"the second package, made up for the tests\n" * 50),
    ("libx11-6_2%3a1.8.7-1build1_amd64.deb", "pool/main/libx/libx11/libx11-6_1.8.7-1build1_amd64.deb",
     b"the third package, with an epoch, made up\n" * 50),
]
FILES = [file for file, _, _ in PACKAGES]
BODIES = [body for _, _, body in PACKAGES]


def uri_line(file, pool, body, kind="MD5Sum", base=MIRROR):
    """One line of `apt-get install --print-uris -qq`: 'URL' file size KIND:digest. On Ubuntu 24.04
    (apt 2.8.4) the digest is an MD5, as the container showed."""
    url = f"{base}/{pool.replace('~', '%7e').replace('+', '%2b')}"
    return f"'{url}' {file} {len(body)} {kind}:{hashlib.md5(body).hexdigest()}"


def print_uris(packages=PACKAGES, base=MIRROR):
    return "\n".join(uri_line(*package, base=base) for package in packages) + "\n"


def apt_cache_show(packages=PACKAGES, sizes=None):
    """`apt-cache show name=version ...`: one stanza of Ubuntu's package index per package."""
    stanzas = []
    for i, (file, pool, body) in enumerate(packages):
        name, version = tools.listed_files(print_uris([packages[i]]))[0].name, "1.0"
        stanzas.append("\n".join([
            f"Package: {name}", f"Version: {version}", "Architecture: amd64", f"Filename: {pool}",
            f"Size: {len(body) if sizes is None else sizes[i]}", f"MD5sum: {hashlib.md5(body).hexdigest()}",
            f"SHA1: {hashlib.sha1(body).hexdigest()}", f"SHA256: {hashlib.sha256(body).hexdigest()}",
            f"SHA512: {hashlib.sha512(body).hexdigest()}", "Description: made up", " and continued here"]))
    return "\n\n".join(stanzas) + "\n"


# --- What apt and Playwright really printed -------------------------------------------------
# Captured on 18 November 2026 in an Ubuntu 24.04.5 container (arm64, as this Mac's Docker runs it;
# GitHub's machines are amd64, which only changes the architecture and the mirror): Playwright
# 1.64.1's `install-deps --dry-run chromium webkit` on a bare image (stdout, exit code 1), then apt
# 2.8.4's `apt-get install --print-uris -qq -y --no-install-recommends` for those names (381 lines,
# every one ending in an MD5) and `apt-cache show name=version` for each file apt listed.
REAL_NAMES = """
adduser adwaita-icon-theme at-spi2-common dbus dbus-bin dbus-daemon dbus-session-bus-common
dbus-system-bus-common dbus-user-session dconf-gsettings-backend dconf-service dictionaries-common
emacsen-common fontconfig fontconfig-config fonts-freefont-ttf fonts-ipafont-gothic fonts-liberation
fonts-noto-color-emoji fonts-tlwg-loma-otf fonts-unifont fonts-wqy-zenhei glib-networking
glib-networking-common glib-networking-services gsettings-desktop-schemas gstreamer1.0-libav
gstreamer1.0-plugins-bad gstreamer1.0-plugins-base gstreamer1.0-plugins-good gtk-update-icon-cache
hicolor-icon-theme humanity-icon-theme hunspell-en-us iso-codes libaa1 libabsl20220623t64 libaom3
libapparmor1 libargon2-1 libasound2-data libasound2t64 libaspell15 libass9 libasyncns0
libatk-bridge2.0-0t64 libatk1.0-0t64 libatomic1 libatspi2.0-0t64 libavahi-client3
libavahi-common-data libavahi-common3 libavc1394-0 libavcodec60 libavfilter9 libavformat60 libavif16
libavtp0 libavutil58 libblas3 libbluray2 libbrotli1 libbs2b0 libbsd0 libcaca0 libcairo-gobject2
libcairo-script-interpreter2 libcairo2 libcap2-bin libcdparanoia0 libchromaprint1 libcjson1
libcodec2-1.2 libcolord2 libcryptsetup12 libcups2t64 libcurl3t64-gnutls libdatrie1 libdav1d7
libdbus-1-3 libdc1394-25 libdca0 libdconf1 libde265-0 libdecor-0-0 libdeflate0 libdevmapper1.02.1
libdirectfb-1.7-7t64 libdrm-amdgpu1 libdrm-common libdrm2 libduktape207 libdv4t64 libdvdnav4
libdvdread8t64 libdw1t64 libedit2 libegl-mesa0 libegl1 libelf1t64 libenchant-2-2 libepoxy0 libevdev2
libevent-2.1-7t64 libexpat1 libfaad2 libfdisk1 libfftw3-double3 libflac12t64 libflite1
libfluidsynth3 libfontconfig1 libfontenc1 libfreeaptx0 libfreetype6 libfribidi0 libgav1-1 libgbm1
libgdk-pixbuf-2.0-0 libgdk-pixbuf2.0-common libgfortran5 libgl1 libgl1-mesa-dri libgles2
libglib2.0-0t64 libglvnd0 libglx-mesa0 libglx0 libgme0 libgomp1 libgpm2 libgraphene-1.0-0
libgraphite2-3 libgsm1 libgssapi-krb5-2 libgssdp-1.6-0 libgstreamer-gl1.0-0
libgstreamer-plugins-bad1.0-0 libgstreamer-plugins-base1.0-0 libgstreamer-plugins-good1.0-0
libgstreamer1.0-0 libgtk-3-0t64 libgtk-3-common libgtk-4-1 libgtk-4-common libgudev-1.0-0
libgupnp-1.6-0 libgupnp-igd-1.6-0 libharfbuzz-icu0 libharfbuzz0b libhunspell-1.7-0 libhwy1t64
libhyphen0 libice6 libicu74 libiec61883-0 libimath-3-1-29t64 libinstpatch-1.0-2 libjack-jackd2-0
libjbig0 libjpeg-turbo8 libjpeg8 libjson-c5 libjson-glib-1.0-0 libjson-glib-1.0-common libjxl0.7
libk5crypto3 libkeyutils1 libkmod2 libkrb5-3 libkrb5support0 liblapack3 liblc3-1 liblcms2-2
libldacbt-enc2 libldap2 liblerc4 liblilv-0-0 libllvm20 liblrdf0 libltc11 liblzo2-2 libmanette-0.2-0
libmbedcrypto7t64 libmjpegutils-2.1-0t64 libmodplug1 libmp3lame0 libmpcdec6 libmpeg2encpp-2.1-0t64
libmpg123-0t64 libmplex2-2.1-0t64 libmysofa1 libncurses6 libneon27t64 libnghttp2-14 libnice10
libnorm1t64 libnspr4 libnss3 libnuma1 libogg0 libopenal-data libopenal1 libopenexr-3-1-30
libopenh264-7 libopenjp2-7 libopenmpt0t64 libopenni2-0 libopus0 liborc-0.4-0t64 libpam-systemd
libpango-1.0-0 libpangocairo-1.0-0 libpangoft2-1.0-0 libpgm-5.3-0t64 libpipewire-0.3-0t64
libpixman-1-0 libplacebo338 libpng16-16t64 libpocketsphinx3 libpostproc57 libproxy1v5 libpsl5t64
libpulse0 libqrencode4 librabbitmq4 libraptor2-0 librav1e0 libraw1394-11 libreadline8t64 librist4
librsvg2-2 librtmp1 librubberband2 libsamplerate0 libsasl2-2 libsasl2-modules-db libsbc1
libsdl2-2.0-0 libsecret-1-0 libsecret-common libsensors-config libsensors5 libserd-0-0 libsharpyuv0
libshine3 libshout3 libslang2 libsm6 libsnappy1v5 libsndfile1 libsndio7.0 libsodium23 libsord-0-0
libsoundtouch1 libsoup-3.0-0 libsoup-3.0-common libsoxr0 libspa-0.2-modules libspandsp2t64 libspeex1
libsphinxbase3t64 libsqlite3-0 libsratom-0-0 libsrt1.5-gnutls libsrtp2-1 libssh-4 libssh-gcrypt-4
libsvtav1enc1d1 libswresample4 libswscale7 libsystemd-shared libtag1v5 libtag1v5-vanilla
libtext-iconv-perl libthai-data libthai0 libtheora0 libtiff6 libtwolame0 libudfread0 libunibreak5
libunwind8 libusb-1.0-0 libv4l-0t64 libv4lconvert0t64 libva-drm2 libva-x11-2 libva2 libvdpau1
libvidstab1.1 libvisual-0.4-0 libvo-aacenc0 libvo-amrwbenc0 libvorbis0a libvorbisenc2 libvorbisfile3
libvpx9 libvulkan1 libwavpack1 libwayland-client0 libwayland-cursor0 libwayland-egl1
libwayland-server0 libwebp7 libwebpdemux2 libwebpmux3 libwebrtc-audio-processing1 libwildmidi2
libwoff1 libx11-6 libx11-data libx11-xcb1 libx264-164 libx265-199 libxau6 libxaw7 libxcb-dri3-0
libxcb-glx0 libxcb-present0 libxcb-randr0 libxcb-render0 libxcb-shm0 libxcb-sync1 libxcb-xfixes0
libxcb-xkb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxdmcp6 libxext6 libxfixes3 libxfont2
libxi6 libxinerama1 libxkbcommon-x11-0 libxkbcommon0 libxkbfile1 libxml2 libxmu6 libxmuu1 libxpm4
libxrandr2 libxrender1 libxshmfence1 libxslt1.1 libxss1 libxt6t64 libxtst6 libxvidcore4 libxxf86vm1
libyajl2 libyuv0 libzbar0t64 libzimg2 libzix-0-0 libzmq5 libzvbi-common libzvbi0t64 libzxing3
mesa-libgallium ocl-icd-libopencl1 readline-common session-migration shared-mime-info systemd
systemd-dev systemd-sysv timgm6mb-soundfont ubuntu-mono x11-common x11-xkb-utils xauth
xfonts-cyrillic xfonts-encodings xfonts-scalable xfonts-utils xkb-data xserver-common xvfb
""".split()
REAL_DRY_RUN = f"Missing system dependencies ({len(REAL_NAMES)}):\n" + "".join(f"  {name}\n" for name in REAL_NAMES)
REAL_URIS = """'http://ports.ubuntu.com/ubuntu-ports/pool/main/a/argon2/libargon2-1_0%7e20190702%2bdfsg-4build1_arm64.deb' libargon2-1_0~20190702+dfsg-4build1_arm64.deb 20456 MD5Sum:db333d3ab4294afc909a59b3f0f0c160
'http://ports.ubuntu.com/ubuntu-ports/pool/main/l/lvm2/libdevmapper1.02.1_1.02.185-3ubuntu3.2_arm64.deb' libdevmapper1.02.1_2%3a1.02.185-3ubuntu3.2_arm64.deb 128226 MD5Sum:ae499b51d18786fb4aa619da1d65cda8
"""
REAL_SHOW = """Package: libargon2-1
Architecture: arm64
Version: 0~20190702+dfsg-4build1
Multi-Arch: same
Priority: important
Section: libs
Source: argon2
Origin: Ubuntu
Maintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>
Original-Maintainer: Debian Security Tools <team+pkg-security@tracker.debian.org>
Bugs: https://bugs.launchpad.net/ubuntu/+filebug
Installed-Size: 88
Depends: libc6 (>= 2.34)
Breaks: cryptsetup-initramfs (<< 2:2.6.1-2)
Filename: pool/main/a/argon2/libargon2-1_0~20190702+dfsg-4build1_arm64.deb
Size: 20456
MD5sum: db333d3ab4294afc909a59b3f0f0c160
SHA1: 32cb88787ff998e4ab81e1d1705b545b9d1836a1
SHA256: 3914bb94008149aae3874d14185f9a2e0e3a87cdb284702a85818fd6c33b8685
SHA512: 1e64d25deb73013c3237fdd87940af062db4d4a3a35888f2e0f1546e44023912b5dbd0b605a497cf93a51a3b21decf0eca9dc2cc7c3a3d490124a482ddb9e9d1
Homepage: https://github.com/P-H-C/phc-winner-argon2
Description: memory-hard hashing function - runtime library
Description-md5: ba6f90a8ea69fe69c76dcab5eb045ea6
Task: cloud-minimal, minimal, server-minimal

Package: libdevmapper1.02.1
Source: lvm2 (2.03.16-3ubuntu3.2)
Priority: important
Section: libs
Installed-Size: 504
Maintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>
Architecture: arm64
Version: 2:1.02.185-3ubuntu3.2
Recommends: dmsetup (>= 2:1.02.185-3ubuntu3.2~)
Depends: libc6 (>= 2.38), libselinux1 (>= 3.1~), libudev1 (>= 183)
Filename: pool/main/l/lvm2/libdevmapper1.02.1_1.02.185-3ubuntu3.2_arm64.deb
Size: 128226
MD5sum: ae499b51d18786fb4aa619da1d65cda8
SHA1: 5d78f760763a1719924fb8e852f4ac9a2a33f75b
SHA256: fb2c1c7f78fac39eb3191cfd30093d57a8ce2ae6b0942972f117706877f17d92
SHA512: 8b4d5955bfac54e9641f3f0cf4f4537d60197a44ac9ea2e8360d4df571d2e7b5194f2cc9c7314c96ebe0a188dd5ecf134a7b7e13a1295ec719e0848a364906ef
Homepage: https://sourceware.org/lvm2/
Description: Linux Kernel Device Mapper userspace library
Description-md5: 20966f6bb804eef3609ec2e2db69378f
Multi-Arch: same
Original-Maintainer: Debian LVM Team <team+lvm@tracker.debian.org>
Origin: Ubuntu
Bugs: https://bugs.launchpad.net/ubuntu/+filebug
Task: cloud-minimal, minimal, server-minimal
"""


class WhatAptReallyPrinted(unittest.TestCase):
    def test_playwrights_real_list_is_read(self):
        names = tools.missing_libraries(REAL_DRY_RUN)
        self.assertEqual((len(names), names[0], names[-1]), (381, "adduser", "xvfb"))
        self.assertTrue(REAL_DRY_RUN.startswith("Missing system dependencies (381):\n  adduser\n"))

    def test_the_real_print_uris_lines_name_the_files_and_the_versions_apt_will_be_asked_about(self):
        listed = tools.listed_files(REAL_URIS)
        self.assertEqual([(i.name, i.version, i.size) for i in listed], [
            ("libargon2-1", "0~20190702+dfsg-4build1", 20456), ("libdevmapper1.02.1", "2:1.02.185-3ubuntu3.2", 128226)])
        self.assertEqual([i.pin for i in listed], ["libargon2-1=0~20190702+dfsg-4build1",
                                                    "libdevmapper1.02.1=2:1.02.185-3ubuntu3.2"])
        self.assertEqual(listed[1].file, "libdevmapper1.02.1_2%3a1.02.185-3ubuntu3.2_arm64.deb")
        self.assertTrue(listed[1].url.endswith("/pool/main/l/lvm2/libdevmapper1.02.1_1.02.185-3ubuntu3.2_arm64.deb"))

    def test_the_real_index_gives_each_file_its_sha256_and_apts_md5_is_not_used(self):
        debs = tools.package_files(tools.listed_files(REAL_URIS), tools.index_checksums(REAL_SHOW))
        self.assertEqual([d.sha256 for d in debs], [
            "3914bb94008149aae3874d14185f9a2e0e3a87cdb284702a85818fd6c33b8685",
            "fb2c1c7f78fac39eb3191cfd30093d57a8ce2ae6b0942972f117706877f17d92"])
        self.assertNotIn("db333d3ab4294afc909a59b3f0f0c160", [d.sha256 for d in debs])  # the MD5 on apt's line
        self.assertEqual([d.size for d in debs], [20456, 128226])


# Captured the same day in an Ubuntu 24.04.5 container (arm64) whose apt source is GitHub's kind:
# `URIs: mirror+file:/etc/apt/apt-mirrors.txt` (made as actions/runner-images' configure-apt-sources.sh
# does), listing a mirror that answers 404 to everything first and ports.ubuntu.com second. apt
# 2.8.4's `apt-get install --print-uris -qq -y --no-install-recommends libxkbcommon0 libargon2-1`
# printed these lines, and `apt-get update` went on to the second mirror in 3 seconds.
REAL_MIRROR_LIST = "# mirrors, as GitHub's images write them\nhttp://127.0.0.1:8080/ubuntu-ports/\tpriority:1\nhttp://ports.ubuntu.com/ubuntu-ports/\tpriority:2\n"
REAL_MIRROR_URIS = """'mirror+file:/etc/apt/apt-mirrors.txt/pool/main/a/argon2/libargon2-1_0%7e20190702%2bdfsg-4build1_arm64.deb' libargon2-1_0~20190702+dfsg-4build1_arm64.deb 20456 MD5Sum:db333d3ab4294afc909a59b3f0f0c160
'mirror+file:/etc/apt/apt-mirrors.txt/pool/main/x/xkeyboard-config/xkb-data_2.41-2ubuntu1.1_all.deb' xkb-data_2.41-2ubuntu1.1_all.deb 397328 MD5Sum:ad9383d9cb442e80edf0076d4f8d351f
'mirror+file:/etc/apt/apt-mirrors.txt/pool/main/libx/libxkbcommon/libxkbcommon0_1.6.0-1build1_arm64.deb' libxkbcommon0_1.6.0-1build1_arm64.deb 122198 MD5Sum:7ada1b3f7eb806dc16dd3bf35ec9b604
"""


class WhatAptReallyPrintedThroughAMirrorList(unittest.TestCase):
    def test_the_real_mirror_lines_are_read(self):
        listed = tools.listed_files(REAL_MIRROR_URIS)
        self.assertEqual([(i.name, i.version, i.size) for i in listed], [
            ("libargon2-1", "0~20190702+dfsg-4build1", 20456), ("xkb-data", "2.41-2ubuntu1.1", 397328),
            ("libxkbcommon0", "1.6.0-1build1", 122198)])
        self.assertEqual(listed[1].url, "mirror+file:/etc/apt/apt-mirrors.txt/pool/main/x/xkeyboard-config/"
                                        "xkb-data_2.41-2ubuntu1.1_all.deb")

    def test_the_real_lines_resolve_to_the_pool_path_under_each_mirror_of_the_real_list(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = os.path.join(folder.name, "apt-mirrors.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(REAL_MIRROR_LIST)
        for item, arch in zip(tools.listed_files(REAL_MIRROR_URIS), ("arm64", "all", "arm64")):
            url = item.url.replace("/etc/apt/apt-mirrors.txt", path)
            pool = url.split(path + "/", 1)[1]
            with self.subTest(file=item.file):
                self.assertEqual(tools.mirror_urls(url, arch), [f"http://127.0.0.1:8080/ubuntu-ports/{pool}",
                                                                 f"http://ports.ubuntu.com/ubuntu-ports/{pool}"])
                # ... and the checksum lookup finds the same pool path the index names.
                self.assertTrue(pool.startswith("pool/main/"))


class ReadingWhatAptSays(unittest.TestCase):
    def test_the_missing_packages_are_read_from_playwrights_list(self):
        self.assertEqual(tools.missing_libraries(DRY_RUN), ["libasound2t64", "libargon2-1", "libx11-6"])

    def test_a_list_that_cant_be_read_stops_the_download(self):
        for output in (
            "All system dependencies are installed.\n",
            "Failed to install browser dependencies\nError: apt-get install -s exited with code 100\n",
            "",
            DRY_RUN.replace("(3)", "(4)"),                      # the count must match the names
            "Missing system dependencies (0):\n",
            "Missing system dependencies (1):\n  libfoo; rm -rf /\n",  # a name is a package name only
        ):
            with self.subTest(output=output[:50]):
                with self.assertRaises(SystemExit):
                    tools.missing_libraries(output)

    def test_every_line_apt_prints_names_a_url_a_file_a_size_and_the_package(self):
        listed = tools.listed_files(print_uris())
        self.assertEqual([item.file for item in listed], FILES)
        self.assertEqual([item.size for item in listed], [len(body) for body in BODIES])
        self.assertEqual([item.pin for item in listed], [
            "libasound2t64=1.2.11-1build2", "libargon2-1=0~20190702+dfsg-4build1", "libx11-6=2:1.8.7-1build1"])
        self.assertEqual(listed[1].url, f"{MIRROR}/pool/main/a/argon2/libargon2-1_0%7e20190702%2bdfsg-4build1_amd64.deb")

    def test_the_hash_on_apts_line_is_not_trusted_for_anything(self):
        # Ubuntu 24.04's apt prints an MD5 there; any kind is read and none is used.
        for kind in ("MD5Sum", "SHA256", "SHA512"):
            with self.subTest(kind=kind):
                self.assertEqual(len(tools.listed_files(print_uris([PACKAGES[0]]).replace("MD5Sum", kind))), 1)

    def test_a_line_that_isnt_a_package_stops_the_download_and_apts_notes_are_ignored(self):
        good = uri_line(*PACKAGES[0])
        for line in (
            good.replace("MD5Sum:", ""),                                           # no hash field at all
            good.replace(PACKAGES[0][0], "../libfoo.deb"),                         # not a plain file name
            "'ftp://mirror/pool/libfoo_1.0_amd64.deb' libfoo_1.0_amd64.deb 1 MD5Sum:" + "0" * 32,
            good.replace("libasound2t64_1.2.11-1build2_amd64.deb ", "libfoo.deb "),  # no name_version_arch
            good.replace("1.2.11-1build2", "1.2;rm"),                              # not a version
        ):
            with self.subTest(line=line[:70]):
                with self.assertRaises(SystemExit):
                    tools.listed_files(line)
        with self.assertRaises(SystemExit):
            tools.listed_files("Reading package lists...\n")
        self.assertEqual(len(tools.listed_files("Reading package lists...\n" + good + "\n")), 1)

    def test_the_checksums_come_from_the_package_index_by_pool_path(self):
        index = tools.index_checksums(apt_cache_show())
        self.assertEqual(index[PACKAGES[2][1]], (hashlib.sha256(PACKAGES[2][2]).hexdigest(), len(PACKAGES[2][2])))
        self.assertEqual(len(index), 3)
        broken = "Package: a\nFilename: pool/a.deb\nSize: 1\nSHA256: nothex\n\nPackage: b\nFilename: pool/b.deb\nSize: 1\n"
        self.assertEqual(tools.index_checksums(broken), {})

    def test_each_file_gets_the_sha256_ubuntus_index_holds_for_its_pool_path(self):
        debs = tools.package_files(tools.listed_files(print_uris()), tools.index_checksums(apt_cache_show()))
        for deb, (file, pool, body) in zip(debs, PACKAGES):
            self.assertEqual((deb.filename, deb.sha256, deb.size), (file, hashlib.sha256(body).hexdigest(), len(body)))
            self.assertTrue(deb.file.startswith(tools.LIBRARIES_FILE + "/"))
        self.assertEqual((debs[2].name, debs[2].version), ("libx11-6", "2:1.8.7-1build1"))

    def test_a_file_the_index_doesnt_know_or_whose_size_differs_stops_the_download(self):
        listed = tools.listed_files(print_uris())
        index = tools.index_checksums(apt_cache_show(PACKAGES[:2]))
        with self.assertRaises(SystemExit) as caught:
            tools.package_files(listed, index)
        self.assertIn("has no SHA-256", str(caught.exception))
        wrong = tools.index_checksums(apt_cache_show(sizes=[1, 2, 3]))
        with self.assertRaises(SystemExit) as caught:
            tools.package_files(listed, wrong)
        self.assertIn("bytes", str(caught.exception))


# --- Mirror lists ------------------------------------------------------------------------------

# /etc/apt/apt-mirrors.txt as GitHub's Ubuntu images write it (actions/runner-images,
# configure-apt-sources.sh): the address, a tab, a priority.
GITHUBS_MIRRORS = ("http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n"
                   "https://archive.ubuntu.com/ubuntu/\tpriority:2\n"
                   "https://security.ubuntu.com/ubuntu/\tpriority:3\n")
POOL = "pool/main/libs/libsoup3/libsoup3_3.4.4-5ubuntu0.4_amd64.deb"


class MirrorLists(unittest.TestCase):
    """apt-transport-mirror(1): one mirror a line, the address first, then optional metadata
    separated from it by a tab and from each other by tabs or spaces; lowest priority first,
    those with none last; blank lines and # lines ignored."""

    def listing(self, text):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = os.path.join(folder.name, "apt-mirrors.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def urls(self, text, pool=POOL, arch="amd64"):
        path = self.listing(text)
        return tools.mirror_urls(f"mirror+file:{path}/{pool}", arch)

    def test_githubs_list_gives_the_pool_path_under_each_mirror_in_priority_order(self):
        self.assertEqual(self.urls(GITHUBS_MIRRORS), [
            f"http://azure.archive.ubuntu.com/ubuntu/{POOL}", f"https://archive.ubuntu.com/ubuntu/{POOL}",
            f"https://security.ubuntu.com/ubuntu/{POOL}"])

    def test_the_lowest_priority_comes_first_whatever_the_order_of_the_lines(self):
        text = ("http://c.example/ubuntu\tpriority:3\nhttp://a.example/ubuntu/\tpriority:1\n"
                "http://none.example/ubuntu/\nhttp://b.example/ubuntu/\tpriority:2\n")
        self.assertEqual([url.split("/")[2] for url in self.urls(text)],
                         ["a.example", "b.example", "c.example", "none.example"])

    def test_equal_priorities_and_mirrors_with_none_keep_the_lists_order(self):
        text = "http://x.example/u/\tpriority:1\nhttp://y.example/u/\tpriority:1\nhttp://z.example/u/\nhttp://w.example/u/\n"
        self.assertEqual([url.split("/")[2] for url in self.urls(text)], ["x.example", "y.example", "z.example", "w.example"])

    def test_comments_blank_lines_other_transports_and_unknown_metadata_are_ignored(self):
        text = ("# the mirrors\n\n   \nftp://old.example/ubuntu/\tpriority:1\nfile:/srv/mirror/\tpriority:1\n"
                "http://a.example/ubuntu/ \tpriority:2  codename:noble component:main\n")
        self.assertEqual(self.urls(text), [f"http://a.example/ubuntu/{POOL}"])

    def test_metadata_may_be_separated_by_tabs_or_spaces(self):
        text = "http://a.example/u/\tpriority:2\ttype:deb arch:amd64\thttp://not-a-mirror-metadata\n"
        self.assertEqual(self.urls(text), [f"http://a.example/u/{POOL}"])

    def test_a_mirror_that_serves_only_indexes_or_other_architectures_is_left_out_for_a_package(self):
        text = ("http://index.example/u/\tpriority:1 type:index\n"
                "http://arm.example/u/\tpriority:2 arch:arm64 type:deb\n"
                "http://amd.example/u/\tpriority:3 arch:amd64 arch:all type:deb\n"
                "http://any.example/u/\tpriority:4\n")
        self.assertEqual([url.split("/")[2] for url in self.urls(text)], ["amd.example", "any.example"])
        self.assertEqual([url.split("/")[2] for url in self.urls(text, arch="arm64")], ["arm.example", "any.example"])

    def test_the_pool_path_is_kept_exactly_as_apt_printed_it(self):
        pool = "pool/main/a/argon2/libargon2-1_0%7e20190702%2bdfsg-4build1_amd64.deb"
        self.assertEqual(self.urls("http://a.example/ubuntu\n", pool=pool), [f"http://a.example/ubuntu/{pool}"])

    def test_the_list_file_is_the_longest_start_of_the_path_that_is_a_file(self):
        path = self.listing("http://a.example/u/\n")
        self.assertEqual(tools.mirror_urls(f"mirror+file:{path}/pool/x/y.deb", "amd64"), ["http://a.example/u/pool/x/y.deb"])
        with self.assertRaises(SystemExit) as caught:
            tools.mirror_urls(f"mirror+file:{path}.missing/pool/x/y.deb", "amd64")
        self.assertIn("no mirror list file", str(caught.exception))

    def test_a_list_with_no_mirror_for_the_file_stops_the_download(self):
        with self.assertRaises(SystemExit) as caught:
            self.urls("# nothing here\nftp://old.example/ubuntu/\nhttp://index.example/u/ type:index\n")
        self.assertIn("lists no mirror", str(caught.exception))

    def test_a_plain_address_is_its_own_only_mirror(self):
        for url in ("http://ports.ubuntu.com/ubuntu-ports/pool/x.deb", "https://mirror.example/pool/x.deb"):
            self.assertEqual(tools.mirror_urls(url, "amd64"), [url])

    def test_apts_mirror_lines_are_read_by_the_print_uris_parser(self):
        line = f"'mirror+file:/etc/apt/apt-mirrors.txt/{POOL}' libsoup3_3.4.4-5ubuntu0.4_amd64.deb 100 MD5Sum:{'0' * 32}"
        (item,) = tools.listed_files(line)
        self.assertEqual((item.url, item.name, item.version), (f"mirror+file:/etc/apt/apt-mirrors.txt/{POOL}",
                                                              "libsoup3", "3.4.4-5ubuntu0.4"))
        for bad in (line.replace("mirror+file:/", "mirror+file:etc/"), line.replace("mirror+file", "mirror+ftp"),
                    line.replace("mirror+file:/", "mirror:/")):
            with self.subTest(bad=bad[:40]), self.assertRaises(SystemExit):
                tools.listed_files(bad)


class Plan:
    """The commands the download runs, answered as apt and Playwright would."""

    def __init__(self, dry_run=DRY_RUN, uris=None, show=None):
        self.commands, self.dry_run = [], dry_run
        self.uris = print_uris() if uris is None else uris
        self.show = apt_cache_show() if show is None else show

    def __call__(self, command, **kwargs):
        self.commands.append((command, kwargs))
        out = ""
        if "--dry-run" in command:
            return subprocess.CompletedProcess(command, 1, stdout=self.dry_run, stderr="")
        if "--print-uris" in command:
            out = self.uris
        elif "apt-cache" in command:
            out = self.show
        return subprocess.CompletedProcess(command, 0, stdout=out, stderr="")


IMAGE = {"ImageOS": "ubuntu24", "ImageVersion": "20261110.1.0"}


class KeepingTheLibraries(InACache):
    def setUp(self):
        super().setUp()
        for name, value in (("playwright_version", "1.64.1"), ("elevated", ["sudo"])):
            patcher = mock.patch.object(tools, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.folder = os.path.expanduser(tools.LIBRARIES_FILE)

    def download(self, server, plan=None, environ=IMAGE):
        plan = plan or Plan()
        with mock.patch.object(tools, "fetch", wraps=tools.fetch) as fetch:
            tools.libraries_download(environ=environ, run=plan, opener=server, sleep=self.pauses.append,
                                     log=self.lines.append)
        self.fetched = fetch.call_count
        return plan

    def manifest(self):
        with open(os.path.join(self.folder, tools.MANIFEST), encoding="utf-8") as f:
            return json.load(f)

    def test_it_keeps_exactly_the_packages_apt_lists_with_a_manifest(self):
        plan = self.download(Server(*BODIES))
        self.assertEqual(sorted(os.listdir(self.folder)), sorted([*FILES, tools.MANIFEST]))
        for file, _, body in PACKAGES:
            with open(os.path.join(self.folder, file), "rb") as f:
                self.assertEqual(f.read(), body)
        self.assertEqual(self.manifest(), {
            "playwright": "1.64.1", "imageOS": "ubuntu24", "imageVersion": "20261110.1.0",
            "packages": [{"file": file, "sha256": hashlib.sha256(body).hexdigest(), "size": len(body)}
                         for file, _, body in PACKAGES]})
        self.assertEqual(self.fetched, 3)
        update, dry, uris, show = (command for command, _ in plan.commands)
        # The package lists are fresh before Playwright is asked what's missing; apt is asked about
        # exactly the names Playwright gave; the checksums come from the index, for exactly the
        # versions apt listed.
        self.assertEqual(update[:3], ["sudo", "apt-get", "update"])
        self.assertEqual(dry, ["pnpm", "exec", "playwright", "install-deps", "--dry-run", "chromium", "webkit"])
        self.assertEqual(uris, ["sudo", "apt-get", "install", "--print-uris", "-qq", "-y", "--no-install-recommends",
                                "libasound2t64", "libargon2-1", "libx11-6"])
        self.assertEqual(show, ["apt-cache", "show", "libasound2t64=1.2.11-1build2",
                                "libargon2-1=0~20190702+dfsg-4build1", "libx11-6=2:1.8.7-1build1"])
        self.assertTrue(plan.commands[1][1]["cwd"].endswith(os.path.join("product", "web")))

    def test_each_download_is_retried_after_a_pause_and_checked_by_the_downloader(self):
        self.download(Server(http_error(504), *BODIES))
        self.assertEqual(self.pauses, [15])
        self.assertEqual(sorted(os.listdir(self.folder)), sorted([*FILES, tools.MANIFEST]))

    def test_a_package_that_doesnt_match_ubuntus_sha256_is_never_kept_and_no_manifest_is_written(self):
        with self.assertRaises(tools.DownloadError) as caught:
            self.download(Server(BODIES[0], b"not the package apt named", BODIES[2]))
        self.assertIn("isn't used", str(caught.exception))
        self.assertFalse(os.path.exists(os.path.join(self.folder, tools.MANIFEST)))
        self.assertFalse(os.path.exists(os.path.join(self.folder, FILES[1])))

    def test_nothing_is_downloaded_when_apt_playwright_or_the_index_gives_nothing_usable(self):
        for plan in (Plan(dry_run="All system dependencies are installed.\n"), Plan(uris=""),
                     Plan(show=""), Plan(show=apt_cache_show(PACKAGES[:2])), Plan(show=apt_cache_show(sizes=[1, 2, 3])),
                     # apt leaves out a file it already holds in its archive folder: a short set
                     Plan(uris=print_uris(PACKAGES[:2])),
                     # ... and the set must be exactly Playwright's, not more
                     Plan(dry_run=DRY_RUN.replace("(3)", "(2)").replace("  libx11-6\n", ""))):
            server = Server()
            with self.subTest(show=plan.show[:20]), self.assertRaises(SystemExit):
                self.download(server, plan=plan)
            self.assertEqual(server.requests, [])
            self.assertFalse(os.path.exists(os.path.join(self.folder, tools.MANIFEST)))

    def test_a_set_short_of_one_of_playwrights_packages_names_it(self):
        with self.assertRaises(SystemExit) as caught:
            self.download(Server(), plan=Plan(uris=print_uris(PACKAGES[:2])))
        self.assertIn("libx11-6", str(caught.exception))
        self.assertIn("archive folder", str(caught.exception))

    def test_a_failing_apt_command_is_a_clean_failure_on_the_command_line(self):
        err = io.StringIO()
        with mock.patch.object(tools, "libraries_download", side_effect=subprocess.CalledProcessError(100, ["apt-get", "update"])), \
                contextlib.redirect_stderr(err):
            self.assertEqual(tools.main(["libraries", "download"], environ=IMAGE), 1)
        self.assertIn("apt-get update exited with 100", err.getvalue())

    def test_what_the_download_keeps_is_what_the_install_accepts(self):
        self.download(Server(*BODIES))
        runs = []
        code = tools.libraries_install(IMAGE, run=lambda command: runs.append(command) or 0, log=self.lines.append)
        self.assertEqual(code, 0)
        self.assertEqual(len(runs), 1)


class DownloadingThroughAMirrorList(KeepingTheLibraries):
    """GitHub's Ubuntu images reach the archive through `mirror+file:/etc/apt/apt-mirrors.txt`,
    so `apt-get install --print-uris` prints addresses under that list, not under a mirror."""

    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.list = os.path.join(folder.name, "apt-mirrors.txt")
        with open(self.list, "w", encoding="utf-8") as f:
            f.write("http://one.example/ubuntu/\tpriority:1\nhttps://two.example/ubuntu/\tpriority:2\n")
        self.uris = print_uris(base=f"mirror+file:{self.list}")

    def get(self, server):
        self.download(server, plan=Plan(uris=self.uris))
        return [(request.full_url.split("/")[2], request.full_url.rsplit("/", 1)[1]) for request in server.requests]

    def test_every_file_comes_from_the_first_mirror_of_the_list_when_it_works(self):
        got = self.get(Server(*BODIES))
        self.assertEqual({host for host, _ in got}, {"one.example"})
        self.assertEqual(sorted(os.listdir(self.folder)), sorted([*FILES, tools.MANIFEST]))
        self.assertEqual(self.manifest()["packages"][2]["sha256"], hashlib.sha256(BODIES[2]).hexdigest())

    def test_the_next_mirror_is_tried_when_one_has_not_got_the_file_and_is_tried_last_from_then_on(self):
        got = self.get(Server(http_error(404), *BODIES))
        self.assertEqual([host for host, _ in got], ["one.example", "two.example", "two.example", "two.example"])
        self.assertEqual(self.pauses, [])  # a missing file isn't retried
        self.assertTrue(any("trying the next one" in line for line in self.lines))
        self.assertEqual(sorted(os.listdir(self.folder)), sorted([*FILES, tools.MANIFEST]))

    def test_a_mirror_that_keeps_failing_is_retried_after_pauses_before_the_next_is_tried(self):
        got = self.get(Server(*[http_error(504)] * 5, *BODIES))
        self.assertEqual([host for host, _ in got], ["one.example"] * 5 + ["two.example"] * 3)
        self.assertEqual(self.pauses, [15, 30, 60, 120])

    def test_a_download_that_doesnt_match_the_checksum_comes_from_the_next_mirror_instead(self):
        self.get(Server(b"corrupt on the first mirror", *BODIES))
        with open(os.path.join(self.folder, FILES[0]), "rb") as f:
            self.assertEqual(f.read(), BODIES[0])

    def test_a_mirror_that_failed_is_still_the_fallback_when_the_others_fail_too(self):
        got = self.get(Server(http_error(404), BODIES[0], http_error(404), BODIES[1], BODIES[2]))
        self.assertEqual([host for host, _ in got], ["one.example", "two.example", "two.example", "one.example", "one.example"])

    def test_when_no_mirror_has_the_file_nothing_is_kept_and_every_mirror_is_named(self):
        with self.assertRaises(tools.DownloadError) as caught:
            self.get(Server(http_error(404), http_error(410)))
        self.assertIn("no mirror gave the file", str(caught.exception))
        self.assertIn("HTTP 404", str(caught.exception))
        self.assertIn("HTTP 410", str(caught.exception))
        self.assertFalse(os.path.exists(os.path.join(self.folder, tools.MANIFEST)))

    def test_a_plain_mirror_address_still_works_beside_the_list(self):
        server = Server(*BODIES)
        self.download(server)  # the default plan: plain http addresses
        self.assertEqual({request.full_url.split("/")[2] for request in server.requests}, {"ports.ubuntu.com"})


class InstallingFromTheCache(KeepingTheLibraries):
    def stock(self, manifest=None):
        os.makedirs(self.folder, exist_ok=True)
        for file, _, body in PACKAGES:
            with open(os.path.join(self.folder, file), "wb") as f:
                f.write(body)
        made = {"playwright": "1.64.1", "imageOS": "ubuntu24", "imageVersion": "20261110.1.0",
                "packages": [{"file": file, "sha256": hashlib.sha256(body).hexdigest(), "size": len(body)}
                             for file, _, body in PACKAGES]}
        made.update(manifest or {})
        with open(os.path.join(self.folder, tools.MANIFEST), "w", encoding="utf-8") as f:
            json.dump(made, f)

    def install(self, environ=IMAGE, code=0):
        self.runs = []
        return tools.libraries_install(environ, run=lambda command: self.runs.append(command) or code,
                                       log=self.lines.append)

    def refused(self, reason, **kwargs):
        self.assertEqual(self.install(**kwargs), 3)
        self.assertEqual(self.runs, [], "apt must not be run when the cache can't be used")
        self.assertEqual(len(self.lines), 1, "one line of reason")
        self.assertIn(reason, self.lines[0])

    def test_the_cached_files_are_installed_by_apt_with_no_repositories_and_only_those_files(self):
        # Checked in Ubuntu 24.04 containers (18 November 2026): with no network and a folder _apt
        # can't read, these arguments install all 381 packages Playwright needed; with a dependency
        # left out, apt exits 100 and installs nothing, even with the network on. `--no-download`,
        # the first choice, fails there ("Pathname to install is not absolute").
        self.stock()
        self.assertEqual(self.install(), 0)
        # `--no-remove`: apt may never remove a package that's already installed to make the set fit
        # (it exits 100 and the mirrors take over instead).
        self.assertEqual(self.runs, [["sudo", "apt-get", "install", "-y", "--no-install-recommends", "--no-remove",
                                      "-o", "Dir::Etc::sourcelist=/dev/null", "-o", "Dir::Etc::sourceparts=/dev/null",
                                      *(os.path.join(self.folder, file) for file in FILES)]])
        self.assertNotIn("--no-download", self.runs[0])
        self.assertEqual(self.lines, ["installed 3 packages from GitHub's cache (machine image 20261110.1.0)"])

    def test_apts_own_exit_code_is_the_answer_so_the_mirrors_take_over_when_it_fails(self):
        self.stock()
        self.assertEqual(self.install(code=100), 100)
        self.assertNotIn("installed", " ".join(self.lines))
        self.assertIn("exit 100", self.lines[0])

    def test_no_manifest_means_the_cache_is_not_used(self):
        self.refused("no manifest")
        os.makedirs(self.folder)
        self.lines.clear()
        self.refused("no manifest")

    def test_an_unreadable_manifest_means_the_cache_is_not_used(self):
        os.makedirs(self.folder)
        for text in ("not json", "[]", '{"playwright": "1.64.1"}', '{"packages": 1, "playwright": 1, "imageOS": 1, "imageVersion": 1}'):
            with self.subTest(text=text):
                self.lines.clear()
                with open(os.path.join(self.folder, tools.MANIFEST), "w", encoding="utf-8") as f:
                    f.write(text)
                self.refused("manifest can't be read")

    def test_another_machine_image_means_the_cache_is_not_used(self):
        self.stock()
        self.refused("machine image ubuntu24 20261110.1.0, not ubuntu24 20261117.1.0",
                     environ={**IMAGE, "ImageVersion": "20261117.1.0"})
        self.lines.clear()
        self.refused("machine image", environ={**IMAGE, "ImageOS": "ubuntu26"})

    def test_a_machine_that_cant_say_its_image_never_uses_the_cache(self):
        self.stock(manifest={"imageVersion": "unknown", "imageOS": "unknown"})
        self.refused("image version isn't known", environ={})

    def test_another_playwright_means_the_cache_is_not_used(self):
        self.stock(manifest={"playwright": "1.63.0"})
        self.refused("made for Playwright 1.63.0, not 1.64.1")

    def test_a_missing_or_changed_file_means_the_cache_is_not_used(self):
        self.stock()
        first = FILES[0]
        with open(os.path.join(self.folder, first), "ab") as f:
            f.write(b"changed")
        self.refused(f"{first} doesn't match its checksum")
        os.remove(os.path.join(self.folder, first))
        self.lines.clear()
        self.refused(f"{first} is missing")

    def test_an_empty_set_is_never_installed(self):
        self.stock(manifest={"packages": []})
        self.refused("lists no packages")

    def test_a_name_that_isnt_a_plain_package_file_is_never_installed(self):
        for name in ("../evil.deb", "/etc/passwd", "sub/dir.deb", "libfoo.deb; rm -rf /", "libfoo", 7):
            with self.subTest(name=name):
                self.lines.clear()
                self.stock(manifest={"packages": [{"file": name, "sha256": "0" * 64, "size": 1}]})
                self.refused("plain package file")

    def test_the_command_line_exits_3_for_the_cache_and_2_for_a_typo(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(tools.main(["libraries", "install"], environ=IMAGE), 3)
            self.assertEqual(tools.main(["libraries"], environ=IMAGE), 2)
            self.assertEqual(tools.main(["libraries", "instal"], environ=IMAGE), 2)
            self.assertEqual(tools.main(["libraries", "download", "install"], environ=IMAGE), 2)
        self.assertIn("no manifest", out.getvalue())


# --- Every workflow ---------------------------------------------------------------------------

def workflow_files():
    return sorted(f for f in os.listdir(WORKFLOWS) if f.endswith((".yml", ".yaml")))


def read(file):
    with open(os.path.join(WORKFLOWS, file), encoding="utf-8") as f:
        return f.read()


def jobs(text):
    """{job id: [step text, ...]} for one workflow file, by its indentation."""
    found, job, step = {}, None, None
    body = text.split("\njobs:\n", 1)[1] if "\njobs:\n" in text else ""
    for line in body.splitlines():
        start = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if start:
            job, step = start.group(1), None
            found[job] = []
        elif job and re.match(r"^      - ", line):
            found[job].append(line + "\n")
            step = len(found[job]) - 1
        elif job and step is not None and (line.startswith("        ") or not line.strip()):
            found[job][step] += line + "\n"
        elif job and line.strip() and not line.startswith("      "):
            step = None
    return found


class EveryWorkflow(unittest.TestCase):
    def test_no_tool_is_downloaded_around_tools_py(self):
        download = re.compile(r"\bwget\b|\bcurl\b[^\n]*(\s-[a-zA-Z]*[oO]\b(?!\s+/dev/null)|--output\b|--remote-name)")
        for file in workflow_files():
            for number, line in enumerate(read(file).splitlines(), 1):
                with self.subTest(workflow=file, line=number):
                    self.assertIsNone(download.search(line), f"{file}:{number} downloads a file itself; "
                                      "use .github/scripts/tools.py, which pins, caches and retries")

    def test_each_fetch_reads_githubs_cache_first(self):
        fetches = 0
        fetch = re.compile(r"tools\.py fetch ([^\n|&;]+)")
        for file in workflow_files():
            for job, steps in jobs(read(file)).items():
                for i, step in enumerate(steps):
                    for found in fetch.finditer(step):
                        for name in found.group(1).split():
                            if name.startswith('"$'):
                                continue  # the Tool cache workflow's matrix, checked below
                            fetches += 1
                            with self.subTest(workflow=file, job=job, tool=name):
                                self.assertIn(name, tools.PINNED)
                                key = name.replace("-", "_") + "_key"
                                restored = [s for s in steps[:i] if "actions/cache/restore@" in s and key in s]
                                self.assertTrue(restored, f"{file}, job {job}: fetches {name} without "
                                                f"first reading GitHub's cache under {key}")
        self.assertGreaterEqual(fetches, 5)  # gitleaks, oasdiff, Maestro, the emulator and its image

    def test_the_checks_only_read_githubs_cache_for_tools(self):
        for file in ("checks.yml", "secret-check.yml", "staging.yml", "release.yml"):
            text = read(file)
            with self.subTest(workflow=file):
                self.assertNotIn("actions/cache/save@", text)
                self.assertNotRegex(text, r"uses: actions/cache@", "the combined cache action saves too")

    def test_playwrights_browsers_are_downloaded_only_through_retry(self):
        for file in workflow_files():
            for number, line in enumerate(read(file).splitlines(), 1):
                if re.search(r"playwright install(?!-deps)", line):
                    with self.subTest(workflow=file, line=number):
                        self.assertIn("tools.py retry -- pnpm exec playwright install chromium webkit", line)

    def test_no_job_uses_an_emulator_action_that_cant_keep_a_pin(self):
        for file in workflow_files():
            with self.subTest(workflow=file):
                self.assertNotIn("android-emulator-runner", read(file))

    def test_app_journeys_boot_the_pinned_system_image(self):
        text = read("app-journeys.yml")
        api = re.search(r"^  API_LEVEL: (\S+)$", text, re.M).group(1)
        target = re.search(r"^  TARGET: (\S+)$", text, re.M).group(1)
        self.assertEqual(f"{api}-{target}-x86_64-r", tools.PINNED["android-system-image"].version[:-2])
        self.assertIn(f"/sys-img/{target}/x86_64-{api}_", tools.PINNED["android-system-image"].url)

    def test_the_tool_cache_workflow_fills_every_pinned_file(self):
        text = read("tools.yml")
        matrix = re.search(r"tool: \[([^\]]+)\]", text).group(1)
        self.assertEqual({t.strip() for t in matrix.split(",")}, set(tools.PINNED))
        for name in ("key browsers", "key database-images", "key browser-libraries", "key pnpm-store",
                     "tools.py libraries download"):
            self.assertIn(name, text)
        packages = "".join(jobs(text)["packages"])
        self.assertIn("pnpm install --frozen-lockfile", packages)
        saves = [step for step in jobs(text)["packages"] if "actions/cache/save@" in step]
        self.assertEqual(len(saves), 1)
        self.assertIn("pnpm_store_key", saves[0])

    def test_pnpms_store_is_saved_by_the_tool_cache_workflow_alone(self):
        for file in workflow_files():
            for job, steps in jobs(read(file)).items():
                for step in steps:
                    if "actions/cache/save@" in step and "pnpm_store" in step:
                        with self.subTest(workflow=file, job=job):
                            self.assertEqual((file, job), ("tools.yml", "packages"))

    def test_no_workflow_asks_setup_node_to_cache_pnpm(self):
        for file in workflow_files():
            for number, line in enumerate(read(file).splitlines(), 1):
                if not line.lstrip().startswith("#"):
                    with self.subTest(workflow=file, line=number):
                        self.assertNotRegex(line, r"cache:\s*pnpm", f"{file}:{number}: setup-node's cache would save "
                                            "pnpm's store from a pull request; the Tool cache workflow saves it")

    def test_every_workflow_that_installs_packages_reads_pnpms_store_the_same_way_and_never_saves_it(self):
        counted = 0
        for file in ("checks.yml", "app-journeys.yml", "staging.yml", "release.yml"):
            for job, steps in jobs(read(file)).items():
                install = next((i for i, step in enumerate(steps) if "pnpm install --frozen-lockfile" in step), None)
                if install is None:
                    continue
                counted += 1
                with self.subTest(workflow=file, job=job):
                    node = [i for i, step in enumerate(steps) if "actions/setup-node@" in step]
                    key = [i for i, step in enumerate(steps) if "tools.py key pnpm-store" in step]
                    restore = [i for i, step in enumerate(steps)
                               if "actions/cache/restore@" in step and "pnpm_store_key" in step]
                    self.assertEqual((len(node), len(key), len(restore)), (1, 1, 1))
                    self.assertTrue(node[0] < key[0] < restore[0] < install, "order: setup-node, key, restore, install")
                    self.assertIn('run: python3 .github/scripts/tools.py key pnpm-store >> "$GITHUB_OUTPUT"', steps[key[0]])
                    self.assertIn("path: ${{ steps.store.outputs.pnpm_store_file }}", steps[restore[0]])
                    self.assertIn("key: ${{ steps.store.outputs.pnpm_store_key }}", steps[restore[0]])
                    self.assertIn("restore-keys: ${{ steps.store.outputs.pnpm_store_prefix }}", steps[restore[0]])
                    # The release pipeline's pnpm steps only run for a release, never a rollback.
                    for step in (steps[key[0]], steps[restore[0]], steps[install]):
                        self.assertEqual("if: inputs.action == 'release'" in step, file == "release.yml")
                    if file in ("staging.yml", "release.yml"):
                        # A cache never stops a deploy or a release: the key step may fail (the commit
                        # may predate it), and then the restore is skipped and npm serves the packages.
                        self.assertIn("continue-on-error: true", steps[key[0]])
                        self.assertIn("steps.store.outcome == 'success'", steps[restore[0]])
                        self.assertNotIn("continue-on-error", steps[install])
                    else:
                        self.assertNotIn("continue-on-error", steps[key[0]],
                                         "a check's own broken key step must fail the check")
                        self.assertIn("package-manager-cache: false", steps[node[0]])
                    self.assertFalse([step for step in steps if "actions/cache/save@" in step and "pnpm_store" in step])
        # Quick checks, Database, Screen, Speed, the Speed trial's parts and its comparison, App journeys and
        # its two-machine trial's sizes (the trial's comparison installs nothing), Staging, Release: each new
        # job is held to every rule above.
        self.assertEqual(counted, 10)

    def test_nothing_reads_the_old_setup_node_key_any_more(self):
        for file in workflow_files():
            with self.subTest(workflow=file):
                self.assertNotIn("node-cache-", read(file), "nothing saves that key since pnpm's store moved to the "
                                 "Tool cache workflow's own (tools.py key pnpm-store)")

    def test_the_system_libraries_are_installed_from_a_restore_and_never_without_the_mirrors_as_the_fallback(self):
        fallback = ("python3 ../../.github/scripts/tools.py libraries install "
                    "|| pnpm exec playwright install-deps chromium webkit")
        found = []
        for file in workflow_files():
            for job, steps in jobs(read(file)).items():
                for i, step in enumerate(steps):
                    if "tools.py libraries install" not in step:
                        continue
                    found.append((file, job))
                    with self.subTest(workflow=file, job=job):
                        key = [j for j, earlier in enumerate(steps[:i]) if "tools.py key browser-libraries" in earlier]
                        restored = [j for j, earlier in enumerate(steps[:i])
                                    if "actions/cache/restore@" in earlier and "browser_libraries_key" in earlier]
                        self.assertTrue(key and restored and key[0] < restored[0],
                                        f"{file}, job {job}: installs the libraries without first reading "
                                        "GitHub's cache under browser_libraries_key")
                        if file == "checks.yml":
                            # The exact command: `||` swallows every failure, a typo included, so the
                            # text is pinned. Every step of it only runs when the website is touched.
                            self.assertIn(fallback, step)
                            for earlier in (steps[key[0]], steps[restored[0]], step):
                                self.assertIn("if: steps.affected.outputs.website == 'true'", earlier)
                        else:
                            # The Tool cache workflow's proof that the set is complete: no fallback.
                            self.assertRegex(step, r"run: python3 \.github/scripts/tools\.py libraries install\n")
                            self.assertNotIn("||", step)
        # The Screen check's four parts (one matrix job, "screen-part") install them; its joining job ("screens") doesn't.
        self.assertEqual(sorted(found), [("checks.yml", "screen-part"), ("tools.yml", "browser-libraries")])

    def test_the_browser_installs_fail_fast_when_they_hang(self):
        # R7's finding (18 November 2026): a Screen check part stalled 22 to 37 minutes installing its
        # browsers' libraries until the job's 40-minute limit (each time the mirrors' fallback on a new
        # machine image, at 58 to 70 kB/s). Each install has its own 10-minute limit; healthy, they take
        # seconds, and the fallback a minute or two.
        steps = jobs(read("checks.yml"))["screen-part"]
        browsers = [s for s in steps if "playwright install chromium webkit" in s]
        libraries = [s for s in steps if "tools.py libraries install" in s]
        self.assertEqual((len(browsers), len(libraries)), (1, 1))
        for step in (browsers[0], libraries[0]):
            self.assertIn("\n        timeout-minutes: 10\n", step)
        self.assertNotIn("libraries install", browsers[0], "one install, one limit")

    def test_the_tool_cache_has_time_to_save_a_new_images_libraries(self):
        # On a new machine image the set comes from Ubuntu's mirrors, which gave 60 kB/s on
        # 19 November 2026: the 126 MB then takes about 35 minutes, so the job has 45.
        header = read("tools.yml").split("\n  browser-libraries:\n", 1)[1].split("    steps:\n", 1)[0]
        self.assertIn("\n    timeout-minutes: 45\n", header)

    def test_install_deps_is_only_ever_the_fallback_after_the_cached_libraries(self):
        fallbacks = dry_runs = 0
        for file in workflow_files():
            for number, line in enumerate(read(file).splitlines(), 1):
                if "install-deps" in line and not line.lstrip().startswith("#"):
                    with self.subTest(workflow=file, line=number):
                        if "--dry-run" in line:  # Playwright's own check in the Tool cache workflow: no install
                            dry_runs += 1
                            self.assertEqual((file, line.strip()),
                                             ("tools.yml", "run: pnpm exec playwright install-deps --dry-run chromium webkit"))
                        else:
                            fallbacks += 1
                            self.assertIn("tools.py libraries install || pnpm exec playwright install-deps", line)
        self.assertEqual((fallbacks, dry_runs), (1, 1))

    def test_the_tool_cache_workflow_checks_its_libraries_on_the_same_image_before_saving(self):
        steps = jobs(read("tools.yml"))["browser-libraries"]
        # Playwright's own simulated install must find nothing still missing before anything is saved.
        order = [next(i for i, step in enumerate(steps) if marker in step) for marker in (
            "lookup-only: true", "libraries download", "libraries install",
            "playwright install-deps --dry-run chromium webkit", "actions/cache/save@")]
        self.assertEqual(order, sorted(order))
        for step in steps[order[1]:]:
            self.assertIn("if: steps.cached.outputs.cache-hit != 'true'", step)


if __name__ == "__main__":
    unittest.main()
