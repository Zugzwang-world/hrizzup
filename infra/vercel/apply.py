#!/usr/bin/env python3
"""Apply this folder's Vercel settings to the project, then read them back.

    python3 infra/vercel/apply.py            # apply, then check
    python3 infra/vercel/apply.py --check    # check only, change nothing

What it manages (project.json and firewall.json): the project itself and its link to the
GitHub repo, its settings (region, framework, staged production builds, Skew Protection,
deployment protection, toolbar), the custom environment "staging" and its branch, the
domains, and the firewall. It fails, listing every difference, if Vercel doesn't match.

Needs VERCEL_TOKEN (Doppler project hrizzup-tools, config claude):

    infra/doppler/run tools -- python3 infra/vercel/apply.py

The project and the firewall also cover production. Until Part 10 these settings are
applied by Claude Code, before production has any keys or data (runbook step 9.4); from
then on, changes that touch production are applied by the release pipeline. `--check` is
safe at any time. It prints setting names and values only, never the token.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://api.vercel.com"


def fail(message):
    sys.exit(f"FAILED: {message}")


def load(name):
    with open(os.path.join(HERE, name)) as f:
        data = json.load(f)
    data.pop("_about", None)
    return data


class Vercel:
    def __init__(self, team):
        self.token = os.environ.get("VERCEL_TOKEN") or fail("VERCEL_TOKEN is not set")
        self.team = team

    def call(self, method, path, body=None, query=None, ok=(200, 201, 204)):
        q = dict(query or {})
        q["slug"] = self.team
        url = f"{API}{path}?{urllib.parse.urlencode(q)}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
            "User-Agent": "hrizzup-infra-vercel-apply",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode()
                return r.status, (json.loads(text) if text else {})
        except urllib.error.HTTPError as err:
            text = err.read().decode(errors="replace")
            try:
                parsed = json.loads(text)
            except ValueError:
                parsed = {}
            if err.code in ok:
                return err.code, parsed
            e = parsed.get("error", {}) if isinstance(parsed, dict) else {}
            message = str(e.get("message", ""))[:300].replace(self.token, "(token)")
            return err.code, {"_error": f"HTTP {err.code} {e.get('code', '')}: {message}"}


def must(result, what):
    status, data = result
    if "_error" in data:
        fail(f"{what}: {data['_error']}")
    return data


def subset_differences(want, have, where):
    """Every value in `want` must be present and equal in `have` (dicts compared by key)."""
    problems = []
    if isinstance(want, dict):
        if not isinstance(have, dict):
            return [f"{where}: Vercel has {have!r}, the repo says {want!r}"]
        for key, value in want.items():
            problems += subset_differences(value, have.get(key), f"{where}.{key}" if where else key)
        return problems
    if isinstance(want, list) and all(not isinstance(x, (dict, list)) for x in want):
        if sorted(want) != sorted(have or []):
            return [f"{where}: Vercel has {have!r}, the repo says {want!r}"]
        return []
    if want != have:
        return [f"{where}: Vercel has {have!r}, the repo says {want!r}"]
    return []


def project(v, cfg, check_only):
    status, data = v.call("GET", f"/v9/projects/{cfg['project']}", ok=(200, 404))
    if status == 404:
        if check_only:
            fail(f"project {cfg['project']} doesn't exist")
        owner, repo = cfg["git"]["repo"].split("/")
        must(v.call("POST", "/v11/projects", {
            "name": cfg["project"],
            "framework": cfg["settings"]["framework"],
            "rootDirectory": cfg["settings"]["rootDirectory"],
            "gitRepository": {"type": "github", "repo": cfg["git"]["repo"]},
        }), "create the project")
        print(f"created project {cfg['project']}, linked to {owner}/{repo}")
        data = must(v.call("GET", f"/v9/projects/{cfg['project']}"), "read the project")
    elif "_error" in data:
        fail(f"read the project: {data['_error']}")
    return data


def settings(v, cfg, proj, check_only):
    if not check_only:
        must(v.call("PATCH", f"/v9/projects/{proj['id']}", cfg["settings"]), "update the settings")
    live = must(v.call("GET", f"/v9/projects/{proj['id']}"), "read the project")
    problems = subset_differences(cfg["settings"], live, "")
    link = live.get("link") or {}
    if f"{link.get('org')}/{link.get('repo')}" != cfg["git"]["repo"] or link.get("type") != "github":
        problems.append(f"git: linked to {link.get('type')} {link.get('org')}/{link.get('repo')}, "
                        f"the repo says github {cfg['git']['repo']}")
    if link.get("productionBranch") != cfg["git"]["productionBranch"]:
        problems.append(f"production branch: {link.get('productionBranch')!r}, "
                        f"the repo says {cfg['git']['productionBranch']!r}")
    for name in ("webAnalytics", "speedInsights"):
        state = live.get(name) or {}
        if state.get("enabledAt") and not state.get("disabledAt"):
            problems.append(f"{name}: on; it stays off until launch (decided in Part 10)")
    return live, problems


def environments(v, cfg, proj, check_only):
    path = f"/v9/projects/{proj['id']}/custom-environments"
    live = {e["slug"]: e for e in must(v.call("GET", path), "list environments").get("environments", [])}
    problems = []
    for slug, want in cfg["customEnvironments"].items():
        body = {"description": want["description"], "branchMatcher": want["branchMatcher"]}
        if not check_only:
            if slug in live:
                must(v.call("PATCH", f"{path}/{live[slug]['id']}", body), f"update environment {slug}")
            else:
                must(v.call("POST", path, {"slug": slug, **body}), f"create environment {slug}")
                print(f"created custom environment {slug}")
    live = {e["slug"]: e for e in must(v.call("GET", path), "list environments").get("environments", [])}
    for slug, want in cfg["customEnvironments"].items():
        if slug not in live:
            problems.append(f"custom environment {slug}: missing")
            continue
        problems += subset_differences(want["branchMatcher"], live[slug].get("branchMatcher"),
                                       f"custom environment {slug}.branchMatcher")
    extra = sorted(set(live) - set(cfg["customEnvironments"]))
    if extra:
        problems.append(f"custom environments not in the repo: {', '.join(extra)}")
    return live, problems


def domains(v, cfg, proj, envs, check_only):
    path = f"/v9/projects/{proj['id']}/domains"
    wanted = {}
    for name, spec in cfg["domains"].items():
        wanted[name] = {"redirect": spec.get("redirect"), "redirectStatusCode": spec.get("redirectStatusCode"),
                        "customEnvironmentId": None}
    for slug, spec in cfg["customEnvironments"].items():
        for name in spec.get("domains", []):
            env_id = (envs.get(slug) or {}).get("id")
            wanted[name] = {"redirect": None, "redirectStatusCode": None, "customEnvironmentId": env_id}

    def live_domains():
        return {d["name"]: d for d in must(v.call("GET", path), "list domains").get("domains", [])}

    live = live_domains()
    if not check_only:
        for name, want in wanted.items():
            body = {k: val for k, val in want.items() if val is not None}
            if name not in live:
                must(v.call("POST", f"/v10/projects/{proj['id']}/domains", {"name": name, **body}),
                     f"add {name}")
                print(f"added domain {name}")
            elif any(live[name].get(k) != val for k, val in want.items()):
                must(v.call("PATCH", f"{path}/{name}", want), f"update {name}")
        live = live_domains()
    problems = []
    for name, want in wanted.items():
        d = live.get(name)
        if not d:
            problems.append(f"domain {name}: missing")
            continue
        for k, val in want.items():
            if d.get(k) != val:
                problems.append(f"domain {name}.{k}: Vercel has {d.get(k)!r}, the repo says {val!r}")
    vercel_app = {n for n in live if n.endswith(".vercel.app")}
    extra = sorted(set(live) - set(wanted) - vercel_app)
    if extra:
        problems.append(f"domains not in the repo: {', '.join(extra)}")
    return live, problems


def normalise_rule(rule):
    keep = {k: rule.get(k) for k in ("name", "description", "active", "conditionGroup", "action")}
    for group in keep.get("conditionGroup") or []:
        for c in group.get("conditions", []):
            c.setdefault("neg", False)
            for k in [k for k, val in c.items() if val is None]:
                del c[k]
    mitigate = (keep.get("action") or {}).get("mitigate") or {}
    for k in [k for k, val in mitigate.items() if val in (None, False) and k != "action"]:
        del mitigate[k]
    return keep


def firewall(v, proj, check_only):
    want = load("firewall.json")
    q = {"projectId": proj["id"]}
    if not check_only:
        must(v.call("PUT", "/v1/security/firewall/config", want, q), "apply the firewall")
    live = must(v.call("GET", "/v1/security/firewall/config/active", query=q), "read the firewall")
    problems = []
    if live.get("firewallEnabled") is not True:
        problems.append("firewall: not enabled")
    problems += subset_differences(want["managedRules"], live.get("managedRules") or {}, "firewall.managedRules")
    want_rules = [json.dumps(normalise_rule(r), sort_keys=True) for r in want["rules"]]
    have_rules = [json.dumps(subset(normalise_rule(r), json.loads(w)), sort_keys=True)
                  for r, w in zip(live.get("rules") or [], want_rules)]
    if len(live.get("rules") or []) != len(want["rules"]) or want_rules != have_rules:
        names = [r.get("name") for r in live.get("rules") or []]
        problems.append(f"firewall rules differ from the repo (live, in order: {names})")
    return problems


def subset(have, want):
    """`have` reduced to the keys present in `want`, recursively, for comparing."""
    if isinstance(want, dict) and isinstance(have, dict):
        return {k: subset(have.get(k), w) for k, w in want.items()}
    if isinstance(want, list) and isinstance(have, list) and len(want) == len(have):
        return [subset(h, w) for h, w in zip(have, want)]
    return have


def main():
    args = sys.argv[1:]
    if args not in ([], ["--check"]):
        sys.exit(__doc__)
    check_only = args == ["--check"]
    cfg = load("project.json")
    v = Vercel(cfg["team"])
    proj = project(v, cfg, check_only)
    problems = []
    live, p = settings(v, cfg, proj, check_only)
    problems += p
    envs, p = environments(v, cfg, proj, check_only)
    problems += p
    _, p = domains(v, cfg, proj, envs, check_only)
    problems += p
    problems += firewall(v, proj, check_only)
    if problems:
        print(f"Vercel project {cfg['project']} does NOT match the repo:")
        for line in problems:
            print(f"  - {line}")
        return 1
    print(f"Vercel project {cfg['project']} ({proj['id']}) matches the repo: "
          f"{len(cfg['settings'])} settings, git {cfg['git']['repo']} (production branch "
          f"{cfg['git']['productionBranch']}), environments {', '.join(cfg['customEnvironments'])}, "
          f"{len(cfg['domains']) + sum(len(e.get('domains', [])) for e in cfg['customEnvironments'].values())} "
          f"domains, firewall with {len(load('firewall.json')['rules'])} rules; "
          f"autoAssignCustomDomains is {live.get('autoAssignCustomDomains')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
