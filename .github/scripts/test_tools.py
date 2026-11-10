"""Tests for the checks' tool downloads (tools.py) and for how every workflow uses them: offline,
with made-up files, servers and tokens, and no real download.

    python3 -m unittest discover -s .github/scripts

A pinned tool is used only when its checksum matches; a failed download is retried after a
pause only when the network or the server failed, never when the pin is wrong; GitHub's files
are fetched signed in, without the token ever going anywhere but GitHub's API; only downloads
are retried, never a test or a build; and no workflow downloads a tool any other way.
"""
import contextlib
import email.message
import hashlib
import http.client
import io
import json
import os
import re
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
        for name in ("key browsers", "key database-images", "cache: pnpm"):
            self.assertIn(name, text)


if __name__ == "__main__":
    unittest.main()
