#!/usr/bin/env python3
"""Check an Upstash Redis database against the blueprint (section 14, "Redis (Upstash)").

    infra/doppler/run dev -- python3 infra/upstash/check.py staging   # this Mac: dev refers to staging
    python3 infra/upstash/check.py production                  # release pipeline only (runbook 10.14)

Reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from the environment and prints
only facts chosen in advance: never the token, never a whole server answer, never a value.
Key names that break a rule are shown as examples on staging; on production only their
first part and a short fingerprint are shown, because the output lands in the pipeline's
logs. Checks:

  - the database is in Mumbai (ap-south-1) with no copies elsewhere, its size, and
    eviction on (Upstash's only policy, "optimistic-volatile");
  - it accepts only encrypted connections: plain-text Redis gets no answer, plain HTTP
    isn't served, and TLS older than 1.2 is refused;
  - every stored key starts with an allowed environment prefix and has an expiry;
  - round-trip time (reported; a slow median from Mumbai means the wrong region).

Exits 1 if anything differs from the blueprint. Auto-upgrade can't be read through Redis;
it is checked in Upstash's console (staging off, production on). Claude Code never runs
this against production: the release pipeline does, with its own credentials.
"""
import hashlib
import http.client
import json
import os
import socket
import ssl
import statistics
import sys
import time
from urllib.parse import urlparse

REGION = "ap-south-1"
MAX_DATA_SIZE = 1024 ** 3          # Fixed 1GB, staging and production alike
POLICY = "optimistic-volatile"     # what Upstash reports when eviction is on
PREFIXES = {
    "staging": ("stg", "pre", "dev"),   # staging, previews and this Mac share staging's database
    "production": ("prd",),
}
SLOW_MS = 30                       # from Mumbai a warm command takes a few ms; the old database took ~135
MAX_KEYS_SCANNED = 20000

env = sys.argv[1] if len(sys.argv) > 1 else ""
if env not in PREFIXES:
    sys.exit(__doc__)
url = urlparse(os.environ.get("UPSTASH_REDIS_REST_URL", ""))
token = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")
if not url.hostname or not token:
    sys.exit("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set (run it through infra/doppler/run)")
HOST = url.hostname
problems, notes = [], []


def result(ok, label, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{': ' + detail if detail else ''}")
    if not ok:
        problems.append(label)


class Rest:
    """One kept-alive HTTPS connection to the REST API. Returns results, never prints them."""

    def __init__(self):
        self.c = http.client.HTTPSConnection(HOST, 443, timeout=10, context=ssl.create_default_context())

    def _post(self, path, payload):
        self.c.request("POST", path, body=json.dumps(payload),
                       headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        r = self.c.getresponse()
        body = r.read()
        if r.status != 200:
            sys.exit(f"REST {path} answered HTTP {r.status}")
        return json.loads(body)

    def cmd(self, *args):
        return self._post("/", list(args))["result"]

    def pipeline(self, cmds):
        return [x.get("result") for x in self._post("/pipeline", cmds)]


def plain_redis_refused():
    try:
        with socket.create_connection((HOST, 6379), timeout=5) as s:
            s.sendall(b"PING\r\n")
            s.settimeout(5)
            return not s.recv(64)
    except (socket.timeout, ConnectionError, OSError):
        return True


def plain_http_refused():
    try:
        c = http.client.HTTPConnection(HOST, 80, timeout=4)
        c.request("GET", "/")
        r = c.getresponse()
        return 300 <= r.status < 400 and (r.getheader("Location") or "").startswith("https://")
    except (socket.timeout, ConnectionError, OSError):
        return True


def old_tls(port):
    """'refused', 'ACCEPTED <version>' or 'untestable' (this machine can't offer TLS 1.0/1.1)."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    try:
        ctx.minimum_version, ctx.maximum_version = ssl.TLSVersion.TLSv1, ssl.TLSVersion.TLSv1_1
        try:
            ctx.set_ciphers("DEFAULT:@SECLEVEL=0")   # OpenSSL 3 hides TLS 1.0/1.1 otherwise
        except ssl.SSLError:
            pass                                     # LibreSSL has no security levels
        with socket.create_connection((HOST, port), timeout=5) as raw:
            with ctx.wrap_socket(raw, server_hostname=HOST) as s:
                return f"ACCEPTED {s.version()}"
    except ssl.SSLError as e:
        reason = (e.reason or str(e)).upper()
        if "NO_PROTOCOLS_AVAILABLE" in reason or "NO CIPHER" in reason:
            return "untestable"
        if any(k in reason for k in ("PROTOCOL_VERSION", "WRONG_VERSION", "UNSUPPORTED_PROTOCOL", "HANDSHAKE_FAILURE")):
            return "refused"
        return f"untestable ({reason[:60]})"
    except (ValueError, OSError):
        return "untestable"


def example(key):
    """How a problem key is shown. Staging has no real users, so its keys are shown (shortened).
    Production's output lands in the pipeline's logs, and a key that breaks the rules may hold
    an ID or worse, so only its first part and a short fingerprint are shown there."""
    if env == "production":
        first = key.split(":", 1)[0]
        label = first if ":" in key and first.isalnum() and len(first) <= 8 else "?"
        return f"{label}:…#{hashlib.sha256(key.encode()).hexdigest()[:8]}"
    return key if len(key) <= 60 else key[:57] + "..."


def show_ms(xs):
    xs = sorted(xs)
    return f"median {statistics.median(xs):.1f} ms, fastest {xs[0]:.1f}, slowest {xs[-1]:.1f} (n={len(xs)})"


print(f"Upstash Redis check, {env}, {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}")

print("Address")
result(url.scheme == "https", "REST address uses HTTPS")
result(HOST.endswith(".upstash.io"), "REST address is an Upstash name", HOST)

print("Database (Upstash's INFO, chosen fields only)")
rest = Rest()
info = {}
for line in rest.cmd("INFO").splitlines():
    if ":" in line and not line.startswith("#"):
        k, v = line.split(":", 1)
        info[k] = v.strip()
members = [m for m in info.get("all_members", "").split(",") if m]
result(bool(members) and all(m.startswith(REGION + "-") for m in members), "every copy in Mumbai",
       f"{', '.join(members)}; primary {info.get('primary_member')}")
result(int(info.get("max_data_size", 0)) == MAX_DATA_SIZE, "size", info.get("max_data_size_human", "?"))
result(info.get("maxmemory_policy") == POLICY, "eviction on", info.get("maxmemory_policy", "?"))
print(f"       Redis {info.get('redis_version')}, Upstash {info.get('upstash_version')}, "
      f"up to {info.get('max_ops_per_sec')} commands a second, "
      f"{info.get('total_keys')} keys, {info.get('used_memory_human')} used")

print("Encrypted connections only")
result(plain_redis_refused(), "plain-text Redis (port 6379) gets no answer")
result(plain_http_refused(), "plain HTTP (port 80) not served")
for port in (443, 6379):
    r = old_tls(port)
    if r.startswith("untestable"):
        notes.append(f"TLS older than 1.2 on port {port} not testable from this machine")
        print(f"  skip TLS older than 1.2 on port {port}: this machine can't offer it")
    else:
        result(r == "refused", f"TLS older than 1.2 refused on port {port}", r)

print("Keys (names and expiries only, never values)")
allowed = tuple(p + ":" for p in PREFIXES[env])
cursor, keys = "0", []
while True:
    cursor, batch = rest.cmd("SCAN", cursor, "COUNT", "1000")
    cursor = str(cursor)
    keys += batch
    if cursor == "0" or len(keys) >= MAX_KEYS_SCANNED:
        break
bad_prefix = [k for k in keys if not k.startswith(allowed)]
no_expiry = []
for i in range(0, len(keys), 500):
    chunk = keys[i:i + 500]
    no_expiry += [k for k, ttl in zip(chunk, rest.pipeline([["TTL", k] for k in chunk])) if ttl == -1]
scanned = f"{len(keys)} keys looked at" + (" (stopped early)" if cursor != "0" else "")
result(not bad_prefix, f"every key starts with an allowed environment ({', '.join(PREFIXES[env])})",
       scanned + (f"; {len(bad_prefix)} don't, e.g. {[example(k) for k in bad_prefix[:3]]}" if bad_prefix else ""))
result(not no_expiry, "every key has an expiry",
       f"{len(no_expiry)} without, e.g. {[example(k) for k in no_expiry[:3]]}" if no_expiry else "")

print("Round trip from here")
tcp = []
for _ in range(10):
    t = time.perf_counter()
    socket.create_connection((HOST, 443), timeout=10).close()
    tcp.append((time.perf_counter() - t) * 1000)
cold = []
for _ in range(5):
    t = time.perf_counter()
    Rest().cmd("PING")
    cold.append((time.perf_counter() - t) * 1000)
warm = []
for _ in range(30):
    t = time.perf_counter()
    rest.cmd("PING")
    warm.append((time.perf_counter() - t) * 1000)
print(f"       network (connection opened): {show_ms(tcp)}")
print(f"       first command on a new connection: {show_ms(cold)}")
print(f"       command on an open connection: {show_ms(warm)}")
if statistics.median(warm) > SLOW_MS:
    notes.append(f"median above {SLOW_MS} ms: this machine is far from Mumbai, or the database is not in {REGION}")

for n in notes:
    print(f"note: {n}")
print("Auto-upgrade isn't visible through Redis: check it in Upstash's console (staging off, production on).")
if problems:
    print(f"NOT as the blueprint says: {', '.join(problems)}")
    sys.exit(1)
print("OK: as the blueprint says.")
