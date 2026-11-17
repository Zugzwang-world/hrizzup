#!/usr/bin/env python3
"""The tools the checks download: each pinned, kept in GitHub's cache by its pin, and fetched
with retries when it must be downloaded.

    python3 .github/scripts/tools.py key <tool>...       # cache keys and paths, for $GITHUB_OUTPUT
    python3 .github/scripts/tools.py key --plain <tool>  # the same for one tool, without its name
    python3 .github/scripts/tools.py fetch <tool>...     # a pinned download, checksum checked
    python3 .github/scripts/tools.py retry -- <command>  # Playwright's browser download only
    python3 .github/scripts/tools.py libraries download  # the browsers' system libraries, for the cache
    python3 .github/scripts/tools.py libraries install   # ... installed from the cache, offline
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

The pinned files (`key`, `fetch`): gitleaks (the Secret check), oasdiff (Quick checks: the public
API's breaking-change check), Maestro, the Android emulator and its system image (App journeys).
Pinned by the lockfile instead (`key` only): Playwright's browsers (the Screen check) and the
database's Docker images (the Database check), which follow the Supabase CLI's version, and pnpm's
package store (every check that installs packages), by the lockfile's hash.

The browsers' system libraries (`key browser-libraries`, `libraries`; M7.1, 18 November 2026) are
the last download a check made from outside GitHub on every run: Playwright's `install-deps` asks
Ubuntu's mirrors for its packages (about 114 MB), which failed on 10 and 11 November. The Tool
cache workflow, on main, asks apt for the exact packages Playwright would install on its machine
image, downloads them, checks each against the SHA-256 in Ubuntu's signed package index
(`apt-cache show`; apt's own `--print-uris` line carries only an MD5 there), and keeps them in
GitHub's cache under Playwright's version and the machine image's (`ImageOS`, `ImageVersion`).
The Screen check installs them from there with no network and no repositories for apt
(`libraries install`: exit 3 and a reason when it can't, for another machine image, another
Playwright, or a missing or changed file; apt's own exit code when the set lacks a dependency) and
falls back to `install-deps`, the mirrors' way, as before.

Python's standard library only; prints no secrets.
"""
import dataclasses
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
    # oasdiff 1.35.0 (28 October 2026), pinned 11 November 2026; its checksum matched the
    # release's own checksums.txt.
    Tool("oasdiff", "1.35.0",
         "https://github.com/oasdiff/oasdiff/releases/download/v1.35.0/oasdiff_1.35.0_linux_amd64.tar.gz",
         "a8023002fcb2eaa7f5758148a9303cb63d33b939886df312268bc0fc7b939140",
         "Quick checks"),
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
LIBRARIES_FILE = f"{CACHE}/browser-libraries"  # a folder: the .deb files and manifest.json
MANIFEST = "manifest.json"
NOT_USABLE = 3  # `libraries install` exit code: the cache can't be used here, so use the mirrors
# apt with no repositories at all: it knows only the files it is given and what's installed, so it
# can't fetch anything, and a missing dependency is an error (exit 100), never a quiet download.
# (`--no-download` was tried first: apt 2.8 on Ubuntu 24.04 stops with "Internal Error, Pathname to
# install is not absolute" when it is given local .deb files.) `--no-remove` keeps apt from ever
# removing a package that's already installed to make the set fit: it exits 100 instead.
NO_REPOSITORIES = ["-o", "Dir::Etc::sourcelist=/dev/null", "-o", "Dir::Etc::sourceparts=/dev/null"]


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


def playwright_version():
    return package_version("product", "web", "node_modules", "@playwright", "test")


def machine_image(environ=os.environ):
    """(ImageOS, ImageVersion) of the runner, as GitHub sets them on its machines (`ubuntu24`,
    `20261110.1.0`); `unknown` when either is missing (this Mac, a self-made machine)."""
    return environ.get("ImageOS") or "unknown", environ.get("ImageVersion") or "unknown"


def browsers_key(environ=os.environ):
    """Playwright's browsers follow its version (each version names its own builds) and the
    runner's operating system."""
    version = playwright_version()
    image = environ.get("ImageOS") or "unknown-os"
    return outputs("browsers", f"playwright-{version}-chromium-webkit-{image}-v1", BROWSERS_FILE, version)


def browser_libraries_key(environ=os.environ):
    """The browsers' system libraries follow Playwright's version (which names the libraries it
    needs) and the machine image (which fixes what's already installed and which versions of the
    rest Ubuntu offers), so the key moves with every image update, about weekly."""
    version = playwright_version()
    image_os, image_version = machine_image(environ)
    key = f"browser-libraries-playwright-{version}-{image_os}-{image_version}-v1"
    return outputs("browser_libraries", key, LIBRARIES_FILE, version)


def store_path():
    """Where pnpm keeps its packages on this machine."""
    answer = subprocess.run(["pnpm", "store", "path", "--silent"], check=True, capture_output=True,
                            text=True, cwd=ROOT).stdout.strip()
    if not answer:
        raise SystemExit("pnpm store path printed nothing")
    return answer


def pnpm_store_key(environ=os.environ):
    """pnpm's package store follows the lockfile (by its hash) and the operating system. The prefix
    is for `restore-keys`: a pull request that changes the lockfile starts from main's newest
    store and downloads only the difference."""
    with open(os.path.join(ROOT, "pnpm-lock.yaml"), "rb") as f:
        lock = hashlib.sha256(f.read()).hexdigest()[:16]
    prefix = f"pnpm-store-{environ.get('ImageOS') or 'unknown'}-"
    path = store_path()
    return [f"pnpm_store_key={prefix}{lock}-v1", f"pnpm_store_file={path}", f"pnpm_store_path={path}",
            f"pnpm_store_prefix={prefix}"]


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
        elif name == "browser-libraries":
            lines += browser_libraries_key(environ)
        elif name == "pnpm-store":
            lines += pnpm_store_key(environ)
        elif name == "database-images":
            lines += database_images_key()
        else:
            raise SystemExit(f"Unknown tool: {name} (known: {', '.join(known())})")
    return lines


def known():
    return [*PINNED, "browsers", "browser-libraries", "database-images", "pnpm-store"]


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


# --- The browsers' system libraries ------------------------------------------------------

MISSING = re.compile(r"Missing system dependencies \((\d+)\):")
PACKAGE = re.compile(r"[a-z0-9][a-z0-9+.-]*")
VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9.+:~-]*")
# A mirror+file: address is how GitHub's Ubuntu images reach the archive: the sources name a list
# of mirrors (/etc/apt/apt-mirrors.txt), and apt picks one for each file.
URI = re.compile(r"'(?P<url>(?:https?://|mirror\+file:/)[^']+)'\s+(?P<file>\S+)\s+(?P<size>\d+)\s+\w+:[0-9A-Fa-f]+")
MIRROR_FILE = re.compile(r"mirror\+file:(/\S*)")
MIRROR_ADDRESS = re.compile(r"https?://\S+")
DEB_FILE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+%~-]*\.deb")


@dataclass(frozen=True)
class Listed:
    """One package file `apt-get install --print-uris` says it would download."""
    url: str
    file: str  # as apt would name it on disk: name_version_arch.deb, an epoch's colon written %3a
    size: int
    name: str
    version: str

    @property
    def pin(self):
        return f"{self.name}={self.version}"


@dataclass(frozen=True)
class Deb(Tool):
    """One package file from Ubuntu's mirrors, with the SHA-256 of Ubuntu's signed package index.
    It is fetched like any pinned file (`fetch`), and lives in the libraries' folder in the cache."""
    filename: str = ""
    size: int = 0

    @property
    def file(self):
        return f"{LIBRARIES_FILE}/{self.filename}"


def mirror_list(text):
    """[(address, metadata)] from apt's mirror list (apt-transport-mirror(1)): one mirror a line,
    its address first, then optional metadata separated from it by a tab and from each other by tabs
    or spaces (`priority:1`, `type:deb`, `arch:amd64`); blank lines and `#` lines are ignored. Only
    http(s) mirrors are kept: they are all this downloader can fetch from. It is data, never code."""
    mirrors = []
    for line in text.splitlines():
        words = line.split()
        if not words or words[0].startswith("#") or not MIRROR_ADDRESS.fullmatch(words[0]):
            continue
        meta = {}
        for word in words[1:]:
            key, _, value = word.partition(":")
            meta.setdefault(key, []).append(value)
        mirrors.append((words[0], meta))
    return mirrors


def mirror_urls(url, arch, isfile=os.path.isfile):
    """The addresses to fetch one package file from, in the order apt would try them. A plain
    http(s) address is its own only one. `mirror+file:<list>/<pool path>` is the pool path under
    each mirror of the list file (found as the longest start of the path that is a file), the
    lowest `priority:` first and those with none last (ties in the list's order), leaving out a
    mirror whose `type:` doesn't include deb or whose `arch:` doesn't include this file's."""
    found = MIRROR_FILE.fullmatch(url)
    if not found:
        return [url]
    parts = found.group(1).split("/")
    for end in range(len(parts), 1, -1):
        listing = "/".join(parts[:end])
        if isfile(listing):
            break
    else:
        raise SystemExit(f"{url}: no mirror list file at any start of its path")
    rest = "/".join(parts[end:]).lstrip("/")
    with open(listing, encoding="utf-8") as f:
        mirrors = mirror_list(f.read())

    def rank(entry):
        number, (_, meta) = entry
        priority = next((int(v) for v in meta.get("priority", []) if v.isdigit()), None)
        return (priority is None, priority or 0, number)

    urls = []
    for _, (address, meta) in sorted(enumerate(mirrors), key=rank):
        if "type" in meta and "deb" not in meta["type"]:
            continue
        if "arch" in meta and arch not in meta["arch"]:
            continue
        candidate = f"{address.rstrip('/')}/{rest}"
        if candidate not in urls:
            urls.append(candidate)
    if not urls:
        raise SystemExit(f"{listing} lists no mirror for {rest}")
    return urls


def origin(url):
    """`scheme://host`, which is what a mirror that failed is remembered by."""
    parts = urllib.parse.urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def fetch_from_mirrors(deb, failed, **kwargs):
    """`fetch` for one package: from the first mirror that gives the file whole and with the right
    checksum (each through `fetch`, so retried after a pause and checked), the next mirror when one
    can't. A mirror that failed is tried last for every file after, so one outage costs one file's
    retries, not every file's."""
    arch = deb.filename[:-len(".deb")].rsplit("_", 1)[-1]
    urls = sorted(mirror_urls(deb.url, arch), key=lambda url: origin(url) in failed)
    problems = []
    for url in urls:
        try:
            return fetch(dataclasses.replace(deb, url=url), **kwargs)
        except DownloadError as e:
            failed.add(origin(url))
            problems.append(str(e))
            if url != urls[-1]:
                kwargs["log"](f"{deb.name} {deb.version}: that mirror failed; trying the next one.")
    raise DownloadError(problems[0] if len(problems) == 1 else
                        f"{deb.name} {deb.version}: no mirror gave the file: " + " | ".join(problems))


def elevated():
    """`sudo`, unless this already runs as root (a container), as Playwright's own installer does."""
    return [] if hasattr(os, "geteuid") and os.geteuid() == 0 else ["sudo"]


def missing_libraries(output):
    """The packages `playwright install-deps --dry-run` says are missing here, from its stdout.
    Playwright 1.64 simulates `apt-get install -s` and lists what apt would install (the
    libraries it needs that this image lacks, and their dependencies), then exits 1."""
    lines = output.splitlines()
    for i, line in enumerate(lines):
        found = MISSING.fullmatch(line.strip())
        if not found:
            continue
        names = []
        for following in lines[i + 1:]:
            if not following.startswith("  ") or not following.strip():
                break
            names.append(following.strip())
        if not names or len(names) != int(found.group(1)) or not all(PACKAGE.fullmatch(n) for n in names):
            raise SystemExit(f"Playwright's list of missing system dependencies can't be read: {line.strip()} "
                             f"followed by {len(names)} names")
        return names
    if "All system dependencies are installed" in output:
        raise SystemExit("Playwright finds every system dependency already installed on this machine, "
                         "so there is nothing to keep")
    raise SystemExit("`playwright install-deps --dry-run` printed no list of missing system dependencies; "
                     "it printed: " + " | ".join(output.strip().splitlines()[-3:])[:300])


def listed_files(output):
    """The files `apt-get install --print-uris -qq` would download: `'URL' file size HASH:hex`.
    The hash on the line is ignored: apt 2.8 on Ubuntu 24.04 prints MD5 there, which proves nothing
    here (the SHA-256 comes from the signed index, `index_checksums`). Anything else that looks like
    a package line but isn't one stops the download."""
    listed = []
    for line in output.splitlines():
        line = line.strip()
        if not line.startswith("'"):
            continue
        found = URI.fullmatch(line)
        if not found or not DEB_FILE.fullmatch(found["file"]):
            raise SystemExit(f"apt printed a line that is not a package URL, size and plain file name: {line[:200]}")
        name, _, rest = found["file"].partition("_")
        version = urllib.parse.unquote(rest.rsplit("_", 1)[0]) if "_" in rest else ""
        if not PACKAGE.fullmatch(name) or not VERSION.fullmatch(version):
            raise SystemExit(f"apt printed a package file named {found['file']}, which isn't name_version_arch.deb")
        listed.append(Listed(found["url"], found["file"], int(found["size"]), name, version))
    if not listed:
        raise SystemExit("apt printed no packages to download")
    return listed


def index_checksums(output):
    """{pool path: (SHA-256, size)} from `apt-cache show name=version ...`: the stanzas of Ubuntu's
    package index, which `apt-get update` verified against the signed Release file."""
    found = {}
    for stanza in re.split(r"\n\s*\n", output.strip()):
        fields = dict(re.findall(r"^(Filename|SHA256|Size): (\S+)$", stanza, re.M))
        if len(fields) == 3 and re.fullmatch(r"[0-9a-f]{64}", fields["SHA256"]) and fields["Size"].isdigit():
            found[fields["Filename"]] = (fields["SHA256"], int(fields["Size"]))
    return found


def package_files(listed, checksums):
    """Each listed file with the SHA-256 and size Ubuntu's index holds for it, found by the pool
    path at the end of the file's URL. A file the index doesn't know, or whose size differs, stops
    the download: nothing here is kept unchecked."""
    debs = []
    for item in listed:
        path = urllib.parse.unquote(urllib.parse.urlsplit(item.url).path)
        pool = path[path.index("/pool/") + 1:] if "/pool/" in path else path
        if pool not in checksums:
            raise SystemExit(f"Ubuntu's package index has no SHA-256 for {item.file} ({pool})")
        digest, size = checksums[pool]
        if size != item.size:
            raise SystemExit(f"{item.file}: apt says {item.size} bytes, Ubuntu's package index says {size}")
        debs.append(Deb(item.name, item.version, item.url, digest, "the Screen check", item.file, item.size))
    return debs


def libraries_download(environ=os.environ, run=subprocess.run, opener=urllib.request.urlopen,
                       sleep=time.sleep, log=say, pauses=PAUSES):
    """The Tool cache workflow's step, on main: the exact packages Playwright's `install-deps`
    would install on this machine image, each downloaded (retried after a pause) and checked against
    the SHA-256 in Ubuntu's signed package index, kept in the libraries' folder with a manifest."""
    sudo = elevated()
    # Fresh package lists first: Playwright's own installer starts with `apt-get update` too.
    run([*sudo, "apt-get", "update", "-o", "Acquire::Retries=3"], check=True)
    dry = run(["pnpm", "exec", "playwright", "install-deps", "--dry-run", "chromium", "webkit"],
              capture_output=True, text=True, cwd=os.path.join(ROOT, "product", "web"))
    names = missing_libraries(dry.stdout)
    log(f"Playwright would install {len(names)} packages on this machine image.")
    plan = run([*sudo, "apt-get", "install", "--print-uris", "-qq", "-y", "--no-install-recommends", *names],
               check=True, capture_output=True, text=True).stdout
    listed = listed_files(plan)
    # apt leaves out a file it already holds in its archive folder; a set short of one of
    # Playwright's packages would only fail later, offline, so it stops here.
    if {item.name for item in listed} != set(names):
        differing = sorted({item.name for item in listed} ^ set(names))
        raise SystemExit("apt would download a different set than Playwright needs (apt may already hold "
                         f"some files in its archive folder): {', '.join(differing)[:300]}")
    index = run(["apt-cache", "show", *(item.pin for item in listed)], check=True, capture_output=True,
                text=True).stdout
    debs = package_files(listed, index_checksums(index))
    failed = set()  # mirrors that failed, to be tried last from then on
    for deb in debs:
        fetch_from_mirrors(deb, failed, opener=opener, sleep=sleep, log=log, pauses=pauses)
    image_os, image_version = machine_image(environ)
    manifest = {"playwright": playwright_version(), "imageOS": image_os, "imageVersion": image_version,
                "packages": [{"file": d.filename, "sha256": d.sha256, "size": d.size} for d in debs]}
    folder = os.path.expanduser(LIBRARIES_FILE)
    with open(os.path.join(folder, MANIFEST), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    log(f"Kept {len(debs)} packages for the cache (machine image {image_version}).")


def libraries_install(environ=os.environ, run=subprocess.call, log=say):
    """The Screen check's step: the cached packages installed with no network (apt is given no
    repositories, so it can't fetch anything), or exit 3 (NOT_USABLE) and one line saying why, so the
    mirrors' way (`install-deps`) takes over. Anything unexpected in the cache is a reason to
    refuse, never something to install anyway; if apt itself fails (a package the set lacks), its
    exit code is the answer, and nothing is half installed."""
    def refuse(reason):
        log(f"The browsers' system libraries aren't taken from GitHub's cache: {reason}.")
        return NOT_USABLE

    folder = os.path.expanduser(LIBRARIES_FILE)
    try:
        with open(os.path.join(folder, MANIFEST), encoding="utf-8") as f:
            manifest = json.load(f)
        packages = [(p["file"], p["sha256"]) for p in manifest["packages"]]
        expected = (manifest["playwright"], manifest["imageOS"], manifest["imageVersion"])
    except FileNotFoundError:
        return refuse("it holds no manifest")
    except (OSError, ValueError, KeyError, TypeError):
        return refuse("its manifest can't be read")
    try:
        here = (playwright_version(), *machine_image(environ))
    except (OSError, ValueError, KeyError):
        return refuse("Playwright's version can't be read here")
    if here[2] == "unknown":
        return refuse("this machine's image version isn't known")
    if expected[0] != here[0]:
        return refuse(f"it was made for Playwright {expected[0]}, not {here[0]}")
    if expected[1:] != here[1:]:
        return refuse(f"it was made for machine image {expected[1]} {expected[2]}, not {here[1]} {here[2]}")
    if not packages:
        return refuse("its manifest lists no packages")
    paths = []
    for name, digest in packages:
        if not isinstance(name, str) or not DEB_FILE.fullmatch(name):
            return refuse("its manifest names a file that isn't a plain package file")
        path = os.path.join(folder, name)
        if not os.path.isfile(path):
            return refuse(f"{name} is missing")
        if sha256_of(path) != digest:
            return refuse(f"{name} doesn't match its checksum")
        paths.append(path)
    code = run([*elevated(), "apt-get", "install", "-y", "--no-install-recommends", "--no-remove",
                *NO_REPOSITORIES, *paths])
    if code == 0:
        log(f"installed {len(paths)} packages from GitHub's cache (machine image {here[2]})")
    else:
        log(f"apt couldn't install them without the network (exit {code}).")
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
        if command == "libraries" and rest == ["download"]:
            libraries_download(environ=environ)
            return 0
        if command == "libraries" and rest == ["install"]:
            return libraries_install(environ=environ)
        if command == "database" and len(rest) == 1:
            for line in database(rest[0]):
                print(line)
            return 0
    except DownloadError as e:
        print(f"FAILED: {e}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as e:
        print(f"FAILED: {' '.join(map(str, e.cmd))} exited with {e.returncode}", file=sys.stderr)
        return 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
