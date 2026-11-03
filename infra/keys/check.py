#!/usr/bin/env python3
"""Checks that one environment's keys are the right ones, without using any of them for real.

    infra/doppler/run stg -- python3 infra/keys/check.py staging   # Claude Code, on this Mac
    python3 infra/keys/check.py production                         # the release pipeline only

The health page (/api/health) already proves the database, Redis, storage and Supabase's
sign-in service answer. This covers the keys it doesn't use, so a slip while copying a key
shows up here rather than at launch:

  - Google sign-in client: Google's token service is sent a made-up code. With the right ID
    and secret it answers "invalid_grant" (client accepted, code refused); a wrong pair gets
    "invalid_client". Google's sign-in page must also accept Supabase's callback address
    (SUPABASE_URL + /auth/v1/callback) as a redirect for this client.
  - Resend: the key must be valid and sending-only (Resend refuses it anything but sending).
  - Turnstile: Cloudflare's check is sent a made-up answer. The real secret gets
    "invalid-input-response"; a wrong one gets "invalid-input-secret". Cloudflare's published
    test keys are refused (they belong to previews only).
  - Supabase: the secret key can use the server-only admin address, and the publishable key
    reads the public sign-in settings, which show no way to sign in but Google and email
    codes (Google may still be off on a new project: infra/supabase/auth/apply.py turns it
    on, and checks every switch exactly).
  - R2: the app's key lists both of this environment's buckets, and is refused for the other
    environment's buckets.

Prints a word for each check, never a key, a token or an answer's contents.
"""
import datetime
import hashlib
import hmac
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BUCKETS = {
    "staging": ("hrizzup-staging-uploads", "hrizzup-staging-media"),
    "production": ("hrizzup-uploads", "hrizzup-media"),
}
TURNSTILE_TEST_KEYS = {
    "1x00000000000000000000AA", "2x00000000000000000000AB", "1x00000000000000000000BB",
    "2x00000000000000000000BB", "3x00000000000000000000FF",
    "1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA",
    "3x0000000000000000000000000000000AA",
}
REF = re.compile(r"^https://([a-z0-9]{20})\.supabase\.co/?$")

problems = []


def env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        problems.append(f"{name} is not set")
    return value


def result(ok, label, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{': ' + detail if detail else ''}")
    if not ok:
        problems.append(label)


def http(method, url, data=None, headers=None, follow=True):
    """(status, headers, parsed JSON or None). Bodies are never printed."""
    req = urllib.request.Request(url, data=data, method=method, headers={
        "User-Agent": "hrizzup-keys-check", **(headers or {})})
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=30) as r:
            body = r.read()
            return r.status, {k.lower(): v for k, v in r.headers.items()}, parse(body)
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, parse(e.read())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def parse(body):
    try:
        return json.loads(body)
    except (ValueError, TypeError):
        return None


def google(supabase_url):
    client_id, secret = env("GOOGLE_OAUTH_CLIENT_ID"), env("GOOGLE_OAUTH_CLIENT_SECRET")
    if not (client_id and secret and supabase_url):
        return
    callback = supabase_url.rstrip("/") + "/auth/v1/callback"
    form = urllib.parse.urlencode({"code": "hrizzup-keys-check", "client_id": client_id,
                                   "client_secret": secret, "redirect_uri": callback,
                                   "grant_type": "authorization_code"}).encode()
    status, _, body = http("POST", "https://oauth2.googleapis.com/token", form,
                           {"Content-Type": "application/x-www-form-urlencoded"})
    error = (body or {}).get("error")
    result(error == "invalid_grant", "Google client ID and secret accepted",
           "yes" if error == "invalid_grant" else f"Google answered {error or status}")
    query = urllib.parse.urlencode({"client_id": client_id, "redirect_uri": callback,
                                    "response_type": "code", "scope": "openid email profile"})
    status, headers, _ = http("GET", f"https://accounts.google.com/o/oauth2/v2/auth?{query}", follow=False)
    location = headers.get("location", "")
    refused = "/signin/oauth/error" in location or status == 400
    result(not refused and status in (302, 303), "Google accepts Supabase's callback for this client",
           "yes" if not refused else "no: add the callback address to the client's redirect URIs")


def resend():
    key = env("RESEND_API_KEY")
    if not key:
        return
    status, _, body = http("GET", "https://api.resend.com/domains", headers={"Authorization": f"Bearer {key}"})
    name = (body or {}).get("name", "")
    if status == 200:
        result(False, "Resend key is sending-only", "no: it has full access; make a sending-only key")
    else:
        result(status == 401 and name == "restricted_api_key", "Resend key valid and sending-only",
               "yes" if name == "restricted_api_key" else f"Resend answered {status} {name}")


def turnstile():
    secret = env("TURNSTILE_SECRET_KEY")
    site = env("TURNSTILE_SITE_KEY")
    if not secret:
        return
    result(secret not in TURNSTILE_TEST_KEYS and site not in TURNSTILE_TEST_KEYS,
           "Turnstile keys are the environment's own widget, not Cloudflare's test keys")
    form = urllib.parse.urlencode({"secret": secret, "response": "hrizzup-keys-check"}).encode()
    status, _, body = http("POST", "https://challenges.cloudflare.com/turnstile/v0/siteverify", form,
                           {"Content-Type": "application/x-www-form-urlencoded"})
    codes = (body or {}).get("error-codes") or []
    result("invalid-input-response" in codes and "invalid-input-secret" not in codes,
           "Turnstile secret accepted", "yes" if "invalid-input-response" in codes else f"Cloudflare answered {codes or status}")


def supabase(url):
    secret, publishable = env("SUPABASE_SECRET_KEY"), env("SUPABASE_PUBLISHABLE_KEY")
    if not url:
        return
    if secret:
        status, _, _ = http("GET", f"{url}/auth/v1/admin/users?page=1&per_page=1", headers={"apikey": secret})
        result(status == 200, "Supabase secret key reaches the server-only admin address", f"HTTP {status}")
    if publishable:
        status, _, body = http("GET", f"{url}/auth/v1/settings", headers={"apikey": publishable})
        external = (body or {}).get("external") or {}
        on = sorted(k for k, v in external.items() if v is True)
        result(status == 200 and set(on) <= {"email", "google"},
               "publishable key works; no sign-in methods but Google and email codes",
               ", ".join(on) if status == 200 else f"HTTP {status}")


def sigv4_list(endpoint, bucket, key_id, secret):
    """A one-item S3 listing of `bucket`, signed with AWS Signature Version 4 (R2: region auto)."""
    host = urllib.parse.urlparse(endpoint).netloc
    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    query = "list-type=2&max-keys=1"
    payload = hashlib.sha256(b"").hexdigest()
    headers = f"host:{host}\nx-amz-content-sha256:{payload}\nx-amz-date:{amz_date}\n"
    signed = "host;x-amz-content-sha256;x-amz-date"
    canonical = f"GET\n/{bucket}\n{query}\n{headers}\n{signed}\n{payload}"
    scope = f"{day}/auto/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    k = ("AWS4" + secret).encode()
    for part in (day, "auto", "s3", "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    status, _, _ = http("GET", f"{endpoint}/{bucket}?{query}", headers={
        "x-amz-date": amz_date, "x-amz-content-sha256": payload,
        "Authorization": f"AWS4-HMAC-SHA256 Credential={key_id}/{scope}, SignedHeaders={signed}, Signature={signature}",
    })
    return status


def r2(name):
    endpoint, key_id, secret = env("R2_ENDPOINT").rstrip("/"), env("R2_ACCESS_KEY_ID"), env("R2_SECRET_ACCESS_KEY")
    if not (endpoint and key_id and secret):
        return
    own = BUCKETS[name]
    configured = (os.environ.get("R2_BUCKET_UPLOADS"), os.environ.get("R2_BUCKET_MEDIA"))
    result(configured == own, "R2 bucket names are this environment's", ", ".join(own))
    statuses = [sigv4_list(endpoint, b, key_id, secret) for b in own]
    result(statuses == [200, 200], "R2 key lists both of this environment's buckets", str(statuses))
    other = BUCKETS["staging" if name == "production" else "production"]
    statuses = [sigv4_list(endpoint, b, key_id, secret) for b in other]
    result(all(s == 403 for s in statuses), "R2 key is refused for the other environment's buckets", str(statuses))


def main():
    name = sys.argv[1] if len(sys.argv) == 2 else ""
    if name not in BUCKETS:
        sys.exit(__doc__)
    url = env("SUPABASE_URL").rstrip("/")
    if url and not REF.match(url):
        problems.append("SUPABASE_URL is not a Supabase project address")
        url = ""
    print(f"Keys check, {name}")
    google(url)
    resend()
    turnstile()
    supabase(url)
    r2(name)
    if problems:
        print(f"NOT right: {', '.join(problems)}")
        return 1
    print("OK: every key checked is valid and is this environment's own.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
