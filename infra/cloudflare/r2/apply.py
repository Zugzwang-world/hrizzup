#!/usr/bin/env python3
"""Apply and check one environment's R2 storage settings (README.md).

    python3 infra/cloudflare/r2/apply.py staging            # apply, then check
    python3 infra/cloudflare/r2/apply.py production --check # check only, change nothing

For each of the environment's two buckets (staging: hrizzup-staging-uploads and
hrizzup-staging-media; production: hrizzup-uploads and hrizzup-media):
  - the bucket exists in Asia-Pacific, Standard storage (created if missing);
  - its r2.dev address is off;
  - the media bucket is public only through its own address (media-staging.hrizzup.com or
    media.hrizzup.com: connected, minimum TLS 1.2, certificate active), and the uploads
    bucket has no public address at all;
  - its CORS and lifecycle rules are exactly this folder's files.
Everything is read back and compared; it exits 1, listing each difference, if Cloudflare
doesn't match the repo.

Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (connecting a media address also needs
CLOUDFLARE_ZONE_ID and DNS rights on the zone). Staging, by Claude Code:

    infra/doppler/run tools -- python3 infra/cloudflare/r2/apply.py staging

Production is applied by the release pipeline, with its own key (runbook Part 10). Claude
Code created production's buckets and media address with it once, before production had
any keys or data (founder's decision, 3 November 2026). Never prints the token.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENVIRONMENTS = {
    "staging": {"prefix": "hrizzup-staging-", "media_domain": "media-staging.hrizzup.com"},
    "production": {"prefix": "hrizzup-", "media_domain": "media.hrizzup.com"},
}
LOCATION = "APAC"


def fail(message):
    sys.exit(f"FAILED: {message}")


class Cloudflare:
    def __init__(self):
        self.token = os.environ.get("CLOUDFLARE_API_TOKEN") or fail("CLOUDFLARE_API_TOKEN is not set")
        account = os.environ.get("CLOUDFLARE_ACCOUNT_ID") or fail("CLOUDFLARE_ACCOUNT_ID is not set")
        self.base = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets"

    def call(self, method, path, body=None, missing_ok=False):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
            "User-Agent": "hrizzup-infra-r2-apply",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r).get("result")
        except urllib.error.HTTPError as err:
            if missing_ok and err.code == 404:
                return None
            try:
                errors = [e.get("message") for e in json.load(err).get("errors", [])]
            except ValueError:
                errors = []
            fail(f"{method} {path or '/'}: HTTP {err.code} {str(errors)[:200].replace(self.token, '(token)')}")


def rules_file(name):
    with open(os.path.join(HERE, name)) as f:
        return json.load(f)


def norm(rules):
    """Rules compared as Cloudflare returns them: empty fields dropped, lists sorted."""
    out = []
    for r in rules or []:
        r = {k: v for k, v in r.items() if v not in (None, [], {})}
        if "allowed" in r:
            r["allowed"] = {k: sorted(v) for k, v in r["allowed"].items() if v}
        out.append(json.dumps(r, sort_keys=True))
    return sorted(out)


def bucket(cf, name, check_only, problems):
    b = cf.call("GET", f"/{name}", missing_ok=True)
    if b is None:
        if check_only:
            problems.append(f"{name}: doesn't exist")
            return False
        cf.call("POST", "", {"name": name, "locationHint": LOCATION.lower()})
        print(f"  created bucket {name} (Asia-Pacific)")
        b = cf.call("GET", f"/{name}")
    for field, want in (("location", LOCATION), ("storage_class", "Standard"), ("jurisdiction", "default")):
        if b.get(field) != want:
            problems.append(f"{name}: {field} is {b.get(field)!r}, the repo says {want!r}")
    return True


def r2_dev_off(cf, name, check_only, problems):
    managed = cf.call("GET", f"/{name}/domains/managed") or {}
    if managed.get("enabled") is not False and not check_only:
        cf.call("PUT", f"/{name}/domains/managed", {"enabled": False})
        managed = cf.call("GET", f"/{name}/domains/managed") or {}
    if managed.get("enabled") is not False:
        problems.append(f"{name}: its r2.dev address is on")


def public_addresses(cf, name, domain, check_only, problems):
    """`domain` is the bucket's one public address, or None for no public address."""
    def live():
        return {d.get("domain"): d for d in (cf.call("GET", f"/{name}/domains/custom") or {}).get("domains", [])}

    have = live()
    if domain and domain not in have and not check_only:
        zone = os.environ.get("CLOUDFLARE_ZONE_ID") or fail("CLOUDFLARE_ZONE_ID is needed to connect " + domain)
        cf.call("POST", f"/{name}/domains/custom", {"domain": domain, "zoneId": zone, "enabled": True, "minTLS": "1.2"})
        print(f"  connected {domain} to {name}; waiting for its certificate")
        for _ in range(36):  # up to 6 minutes
            have = live()
            status = (have.get(domain) or {}).get("status") or {}
            if status.get("ssl") == "active" and status.get("ownership") == "active":
                break
            time.sleep(10)
    extra = sorted(set(have) - ({domain} if domain else set()))
    if extra:
        problems.append(f"{name}: public addresses not in the repo: {', '.join(extra)}")
    if domain:
        d = have.get(domain)
        if not d:
            problems.append(f"{name}: {domain} isn't connected")
        else:
            status = d.get("status") or {}
            for label, got, want in (("enabled", d.get("enabled"), True), ("minimum TLS", d.get("minTLS"), "1.2"),
                                     ("ownership", status.get("ownership"), "active"),
                                     ("certificate", status.get("ssl"), "active")):
                if got != want:
                    problems.append(f"{name}: {domain} {label} is {got!r}, the repo says {want!r}")


def rules(cf, name, kind, what, path, filename, check_only, problems):
    want = rules_file(filename)
    if not check_only:
        cf.call("PUT", f"/{name}/{path}", want)
    have = (cf.call("GET", f"/{name}/{path}", missing_ok=True) or {}).get("rules") or []
    if norm(want["rules"]) != norm(have):
        problems.append(f"{name}: its {what} rules differ from {filename}")


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ENVIRONMENTS or args[1:] not in ([], ["--check"]):
        sys.exit(__doc__)
    env, check_only = args[0], args[1:] == ["--check"]
    spec = ENVIRONMENTS[env]
    cf = Cloudflare()
    problems = []
    for kind in ("uploads", "media"):
        name = spec["prefix"] + kind
        print(f"{name}")
        if not bucket(cf, name, check_only, problems):
            continue
        r2_dev_off(cf, name, check_only, problems)
        public_addresses(cf, name, spec["media_domain"] if kind == "media" else None, check_only, problems)
        rules(cf, name, kind, "CORS", "cors", f"{kind}.cors.{env}.json", check_only, problems)
        rules(cf, name, kind, "lifecycle", "lifecycle", f"{kind}.lifecycle.json", check_only, problems)
    if problems:
        print(f"{env}: storage does NOT match the repo:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"{env}: storage matches the repo (2 buckets in Asia-Pacific, r2.dev off, "
          f"{spec['media_domain']} on the media bucket only, CORS and lifecycle rules as in the repo)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
