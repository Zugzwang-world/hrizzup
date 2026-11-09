#!/usr/bin/env python3
"""The tools the checks download: each pinned, kept in GitHub's cache by its pin, and fetched
with retries when it must be downloaded.

    python3 .github/scripts/tools.py key <tool>...       # cache keys and paths, for $GITHUB_OUTPUT
    python3 .github/scripts/tools.py key --plain <tool>  # the same for one tool, without its name
    python3 .github/scripts/tools.py fetch <tool>...     # a pinned download, checksum checked
    python3 .github/scripts/tools.py retry -- <command>  # Playwright's browser download only
    python3 .github/scripts/tools.py database will-run   # will the database tests run here?
    python3 .github/scripts/tools.py database save       # keep the database's images for the cache

Why: on 9 November 2026 GitHub answered anonymous requests, release downloads included, with
504 errors for about three hours (its incident "Increased timeouts due to surge in anonymous
users"; signed-in requests were unaffected). Five check runs failed while downloading gitleaks
or Maestro from GitHub's release pages, each passing unchanged when re-run. So, for every tool a
check downloads:
  - it is pinned: a version, and for a single file its SHA-256, so a run never uses anything else;
  - it is kept in GitHub's Actions cache under a key made from that pin. The "Tool cache"
    workflow fills the cache from main, which every pull request can read; the checks only read
    it, so pull requests never fill GitHub's 10 GB with copies;
  - when it isn't in the cache, it is downloaded: from GitHub through GitHub's API with the job's
    own short-lived token (signed-in requests, which GitHub's 504s spared), and retried after a
    pause (15, 30, 60, then 120 seconds) when the network or the server fails. Its checksum is
    checked whether it came from the cache or the network.
Only downloads are retried, never a test or a build: `retry` refuses any command but Playwright's
browser download.

The pinned files (`key`, `fetch`): gitleaks (the Secret check), Maestro, the Android emulator and
its system image (App journeys). Pinned by the lockfile instead (`key` only): Playwright's
browsers (the Screen check) and the database's Docker images (the Database check), which follow
the Supabase CLI's version. Python's standard library only; prints no secrets.
"""
import hashlib
import http.client
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = "~/.cache/hrizzup-tools"  # as GitHub's cache action is given it; ~ is the runner's home
PAUSES = (15, 30, 60, 120)  # seconds between attempts: five attempts over about four minutes
RETRYABLE = frozenset({408, 425, 429, 500, 502, 503, 504})  # a busy or failing server, not a wrong pin
GITHUB_RELEASE = re.compile(r"https://github\.com/([\w.-]+)/([\w.-]+)/releases/download/([^/]+)/([^/]+)")
USER_AGENT = "hrizzup-tools"
CHUNK = 1 << 20


@dataclass(frozen=True)
class Tool:
    """One pinned file: what it is, its version, where it comes from and its SHA-256."""
    name: str
    version: str
    url: str
    sha256: str
    used_by: str

    @property
    def file(self):
        """The file's place in the cache, as GitHub's cache action is given it."""
        return f"{CACHE}/{self.name}/{self.url.rsplit('/', 1)[1]}"

    @property
    def path(self):
        return os.path.expanduser(self.file)

    @property
    def key(self):
        return f"tool-{self.name}-{self.version}-{self.sha256[:16]}"


# Each pin's checksum was taken from the file itself on the day it was pinned. Google publishes
# SHA-1 sums for the Android files, which matched too: emulator f41f9e31eb5ca64926603c03265c50bbc0ff4172,
# system image e0f6c9a0691aa27bd597d0deb1bcfdc943ac8ca7 (repository2-3.xml and sys-img2-3.xml).
PINNED = {tool.name: tool for tool in (
    Tool("gitleaks", "8.30.1",
         "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz",
         "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
         "the Secret check"),
    Tool("maestro", "2.12.1",
         "https://github.com/mobile-dev-inc/maestro/releases/download/cli-2.12.1/maestro.zip",
         "54dbb0716425626604973cbb374c585ca30272375d9ce15177a1152765ddd9d7",
         "App journeys"),
    # Google's stable emulator, 37.2.13 (build 16740729), pinned 9 November 2026.
    Tool("android-emulator", "37.2.13-16740729",
         "https://dl.google.com/android/repository/emulator-linux_x64-16740729.zip",
         "cbc7c3cfb83220b8a0f9c513fdab557712e74d339ec19ddffa43f23350ae9bdd",
         "App journeys"),
    # Android 14 (API 34), Google APIs, x86_64, revision 14, pinned 9 November 2026. App
    # journeys' API_LEVEL and TARGET must match it (test_tools.py checks).
    Tool("android-system-image", "34-google_apis-x86_64-r14",
         "https://dl.google.com/android/repository/sys-img/google_apis/x86_64-34_r14.zip",
         "783a40134baf4f3012d4464fbe1571b1612a0dbd2e7a44d14bd8328923443833",
         "App journeys"),
)}

# Kept in the cache by a version the lockfile pins, not by a file of ours.
BROWSERS_FILE = "~/.cache/ms-playwright"  # where Playwright keeps its browsers on Linux
DATABASE_IMAGES_FILE = f"{CACHE}/database-images/images.tar"
DATABASE_TASK = "@hrizzup/database#test:db"


def say(message):
    """A line for the job's log, shown at once (a pipe would otherwise hold it until the end)."""
    print(message, flush=True)


class DownloadError(Exception):
    """A download that can't succeed: a wrong pin, a missing file, or every attempt failed."""


class Transient(Exception):
    """A failure worth another try after a pause: the network or a busy server."""


# --- Keys ---------------------------------------------------------------------------------

def outputs(prefix, key, file, version):
    """Lines for $GITHUB_OUTPUT: the cache key, the path as the cache action takes it, the path
    for a shell, and the version, each named after the tool (`maestro_key`, ...)."""
    return [f"{prefix}_key={key}", f"{prefix}_file={file}",
            f"{prefix}_path={os.path.expanduser(file)}", f"{prefix}_version={version}"]


def package_version(*parts):
    with open(os.path.join(ROOT, *parts, "package.json"), encoding="utf-8") as f:
        return json.load(f)["version"]


def browsers_key(environ=os.environ):
    """Playwright's browsers follow its version (each version names its own builds) and the
    runner's operating system."""
    version = package_version("product", "web", "node_modules", "@playwright", "test")
    image = environ.get("ImageOS") or "unknown-os"
    return outputs("browsers", f"playwright-{version}-chromium-webkit-{image}-v1", BROWSERS_FILE, version)


def database_images_key():
    """The database's Docker images follow the Supabase CLI's version (each version pins its
    images) and the local database's settings (which services start)."""
    version = package_version("infra", "supabase", "node_modules", "supabase")
    with open(os.path.join(ROOT, "infra", "supabase", "config.toml"), "rb") as f:
        settings = hashlib.sha256(f.read()).hexdigest()[:16]
    return outputs("database_images", f"supabase-images-{version}-{settings}-v1", DATABASE_IMAGES_FILE, version)


def keys(names, environ=os.environ):
    lines = []
    for name in names:
        if name in PINNED:
            tool = PINNED[name]
            lines += outputs(name.replace("-", "_"), tool.key, tool.file, tool.version)
        elif name == "browsers":
            lines += browsers_key(environ)
        elif name == "database-images":
            lines += database_images_key()
        else:
            raise SystemExit(f"Unknown tool: {name} (known: {', '.join(known())})")
    return lines


def known():
    return [*PINNED, "browsers", "database-images"]


# --- Fetching a pinned file ---------------------------------------------------------------

def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def request_for(url, token, opener):
    """The request that downloads `url`. A file on GitHub's release pages goes through GitHub's
    API with the job's token, so it's a signed-in request; the token goes to GitHub's API only,
    never to the storage address GitHub redirects to (an unredirected header)."""
    release = GITHUB_RELEASE.fullmatch(url)
    if not (release and token):
        return urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    owner, repo, tag, name = release.groups()
    api = f"https://api.github.com/repos/{owner}/{repo}/releases/tags/{urllib.parse.quote(tag, safe='')}"
    with opened(signed(api, token, "application/vnd.github+json"), opener) as answer:
        assets = json.load(answer).get("assets") or []
    found = [a for a in assets if a.get("name") == name]
    if not found:
        raise DownloadError(f"GitHub's release {owner}/{repo} {tag} has no file named {name}")
    return signed(found[0]["url"], token, "application/octet-stream")


def signed(url, token, accept):
    request = urllib.request.Request(url, headers={
        "Accept": accept, "User-Agent": USER_AGENT, "X-GitHub-Api-Version": "2022-11-28"})
    request.add_unredirected_header("Authorization", f"Bearer {token}")
    return request


class opened:
    """Opens a request, turning the ways a download can fail into Transient (try again) or
    DownloadError (don't)."""

    def __init__(self, request, opener):
        self.request, self.opener, self.answer = request, opener, None

    def __enter__(self):
        try:
            self.answer = self.opener(self.request, timeout=60)
        except urllib.error.HTTPError as e:
            host = urllib.parse.urlsplit(self.request.full_url).hostname
            limited = e.code == 403 and (e.headers or {}).get("x-ratelimit-remaining") == "0"
            if e.code in RETRYABLE or limited:
                raise Transient(f"{host} answered HTTP {e.code}") from None
            raise DownloadError(f"{host} answered HTTP {e.code}") from None
        except (urllib.error.URLError, http.client.HTTPException, OSError) as e:
            raise Transient(f"no answer ({type(e).__name__})") from None
        return self.answer

    def __exit__(self, *exc):
        if self.answer is not None:
            self.answer.close()
        return False


def download(url, part, token, opener):
    """One attempt: the whole file into `part`, or Transient/DownloadError."""
    with opened(request_for(url, token, opener), opener) as answer:
        expected = answer.headers.get("Content-Length") if answer.headers else None
        received = 0
        try:
            with open(part, "wb") as out:
                for chunk in iter(lambda: answer.read(CHUNK), b""):
                    out.write(chunk)
                    received += len(chunk)
        except (http.client.HTTPException, OSError) as e:
            raise Transient(f"the download broke off ({type(e).__name__})") from None
    if expected is not None and expected.isdigit() and received != int(expected):
        raise Transient(f"the download stopped at {received} of {expected} bytes")


def fetch(tool, token=None, opener=urllib.request.urlopen, sleep=time.sleep, log=say, pauses=PAUSES):
    """The pinned file at its place in the cache: the cached copy if its checksum matches,
    otherwise a fresh download, retried after a pause. Returns its path."""
    path = tool.path
    if os.path.exists(path):
        if sha256_of(path) == tool.sha256:
            log(f"{tool.name} {tool.version}: from GitHub's cache; its checksum matches the pin.")
            return path
        log(f"{tool.name} {tool.version}: the cached copy doesn't match the pin; downloading it again.")
        os.remove(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    part = path + ".part"
    if token and GITHUB_RELEASE.fullmatch(tool.url):
        how = "through GitHub's API, signed in with the job's token"
    else:
        how = "from " + urllib.parse.urlsplit(tool.url).hostname
    try:
        for attempt in range(1, len(pauses) + 2):
            try:
                log(f"{tool.name} {tool.version}: downloading {how} (attempt {attempt}).")
                download(tool.url, part, token, opener)
                break
            except Transient as e:
                if attempt > len(pauses):
                    raise DownloadError(f"{tool.name} {tool.version}: every attempt failed; the last: {e}") from None
                log(f"{tool.name} {tool.version}: attempt {attempt} failed ({e}); trying again in {pauses[attempt - 1]}s.")
                sleep(pauses[attempt - 1])
        digest = sha256_of(part)
        if digest != tool.sha256:
            raise DownloadError(f"{tool.name} {tool.version}: the download's SHA-256 is {digest}, "
                                f"not the pinned {tool.sha256}, so it isn't used")
        os.replace(part, path)
    finally:
        if os.path.exists(part):
            os.remove(part)
    log(f"{tool.name} {tool.version}: downloaded; its checksum matches the pin.")
    return path


# --- Retrying another tool's download -----------------------------------------------------

BROWSER = re.compile(r"[a-z][a-z-]*")


def is_download(command):
    """Only Playwright's browser download (`pnpm exec playwright install <browser>...`), without
    the operating system's packages (--with-deps), which apt fetches with its own retries."""
    return (len(command) > 4 and command[:4] == ["pnpm", "exec", "playwright", "install"]
            and all(BROWSER.fullmatch(arg) for arg in command[4:]))


def retry(command, run=subprocess.call, sleep=time.sleep, log=say, pauses=PAUSES):
    """Runs a download command, and again after a pause if it fails. Never a test or a build."""
    if not is_download(command):
        log(f"Refused: only downloads are retried, never a test or a build: {' '.join(command)}")
        return 2
    for attempt in range(1, len(pauses) + 2):
        code = run(command)
        if code == 0:
            return 0
        if attempt > len(pauses):
            log(f"The download failed {attempt} times; giving up.")
            return code
        log(f"The download failed (exit {code}); trying again in {pauses[attempt - 1]}s.")
        sleep(pauses[attempt - 1])
    return code


# --- The database's images ----------------------------------------------------------------

def will_run(dry_run_json):
    """Whether Turborepo will run the database tests (they aren't in its Remote Cache), from
    `turbo run test:db --dry=json`. Only then are the database's images worth loading."""
    for task in json.loads(dry_run_json).get("tasks", []):
        if task.get("taskId") == DATABASE_TASK:
            return (task.get("cache") or {}).get("status") != "HIT"
    raise SystemExit(f"Turborepo's plan has no {DATABASE_TASK}")


def database_images(listing):
    """The Supabase images Docker holds, from `docker image ls --format '{{.Repository}}:{{.Tag}}'`."""
    images = []
    for line in listing.splitlines():
        line = line.strip()
        repository = line.rsplit(":", 1)[0]
        if re.search(r"(^|/)supabase/[\w.-]+$", repository) and not line.endswith(":<none>"):
            images.append(line)
    return sorted(set(images))


def note(message):
    """A line for the job's log that must stay out of $GITHUB_OUTPUT."""
    print(message, file=sys.stderr, flush=True)


def database(action, run=subprocess.run, log=note):
    """`will-run`: the line `run=true|false` for $GITHUB_OUTPUT. `save`: the Supabase images
    Docker holds, written to the file the cache keeps."""
    if action == "will-run":
        try:
            plan = run(["pnpm", "exec", "turbo", "run", "test:db", "--dry=json"],
                       check=True, capture_output=True, text=True, cwd=ROOT).stdout
            going = will_run(plan)
        except (OSError, ValueError, KeyError, subprocess.CalledProcessError, SystemExit) as e:
            # Only an optimisation: without an answer, load the images as if the tests run.
            log(f"Turborepo's plan couldn't be read ({type(e).__name__}); loading the images anyway.")
            going = True
        log("The database tests run here." if going else "The database tests come from the Remote Cache.")
        return [f"run={'true' if going else 'false'}"]
    if action == "save":
        listing = run(["docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}"],
                      check=True, capture_output=True, text=True).stdout
        images = database_images(listing)
        if not images:
            raise SystemExit("Docker holds no Supabase images to keep")
        path = os.path.expanduser(DATABASE_IMAGES_FILE)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        run(["docker", "save", "-o", path, *images], check=True)
        log(f"Kept {len(images)} images for the cache: {', '.join(images)}")
        return []
    raise SystemExit("database: will-run or save")


# --- Command line -------------------------------------------------------------------------

def main(argv=None, environ=None):
    argv = sys.argv[1:] if argv is None else argv
    environ = os.environ if environ is None else environ
    command, rest = (argv[0], argv[1:]) if argv else ("", [])
    try:
        if command == "key" and rest[:1] == ["--plain"] and len(rest) == 2:
            name = rest[1].replace("-", "_") + "_"
            print("\n".join(line[len(name):] for line in keys(rest[1:], environ)))
            return 0
        if command == "key" and rest:
            print("\n".join(keys(rest, environ)))
            return 0
        if command == "fetch" and rest:
            token = environ.get("GITHUB_TOKEN") or None
            for name in rest:
                if name not in PINNED:
                    raise SystemExit(f"Not a pinned file: {name} (pinned: {', '.join(PINNED)})")
                fetch(PINNED[name], token=token)
            return 0
        if command == "retry" and rest[:1] == ["--"]:
            return retry(rest[1:])
        if command == "database" and len(rest) == 1:
            for line in database(rest[0]):
                print(line)
            return 0
    except DownloadError as e:
        print(f"FAILED: {e}", file=sys.stderr)
        return 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
