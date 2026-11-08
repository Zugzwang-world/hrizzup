#!/usr/bin/env python3
"""Apply this folder's Vercel settings to the project, then read them back.

    python3 infra/vercel/apply.py                  # apply, then check
    python3 infra/vercel/apply.py --check          # check only, change nothing
    python3 infra/vercel/apply.py --staging-only   # apply only what is staging's own, then check

What it manages (project.json and firewall.json): the project itself and its link to the
GitHub repo, its settings (region, framework, staged production builds, Skew Protection,
deployment protection, toolbar), the custom environment "staging" and its branch, the
domains, the protection exceptions (only staging's domain is public, from PLAN.md step 1.5d)
and the firewall. It fails, listing every difference, if Vercel doesn't match.

`--staging-only` changes nothing that reaches production: only the protection exception of
staging's own domain, and the firewall rules limited to staging's own domain (every one of the
rule's condition groups needs the request's host to be that domain, and its action stays with
the request it matches). It runs only when everything else already matches the repo. Its
firewall change starts from Vercel's live config, so every other setting and rule goes back
exactly as it is; it refuses if the repo's firewall changes anything that reaches production
(the managed rules, or a rule not limited to staging), and puts the config back if Vercel's
answer differs in such a part afterwards. Then it checks everything, like `--check`.

Needs VERCEL_TOKEN (Doppler project hrizzup-tools, config claude):

    infra/doppler/run tools -- python3 infra/vercel/apply.py

The project and the firewall also cover production. Until Part 10 these settings are
applied by Claude Code, before production has any keys or data (runbook step 9.4); from
then on, changes that touch production are applied by the release pipeline. `--check` is
safe at any time. It prints setting names and values only, never the token.
"""
import copy
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


def protection_exceptions(v, cfg, apply):
    """Deployment Protection Exceptions: the domains Vercel's login doesn't cover.

    Only staging's own domain may be one (PLAN.md step 1.5d). An exception lives on the domain's
    alias, as a protection bypass of scope `alias-protection-override`, and stays with the
    domain as new deployments take it. Only the scope is read, never a bypass's own value.
    """
    wanted = set(cfg.get("protectionExceptions", []))
    staging = {d for e in cfg["customEnvironments"].values() for d in e.get("domains", [])}
    if not wanted <= staging:
        fail(f"protectionExceptions may name only staging's domains, not {sorted(wanted - staging)}")

    def has_exception(name):
        alias = must(v.call("GET", f"/v4/aliases/{name}"), f"read {name}")
        scopes = {(entry or {}).get("scope") for entry in (alias.get("protectionBypass") or {}).values()}
        return alias, "alias-protection-override" in scopes

    problems = []
    for name in sorted(staging):
        alias, has = has_exception(name)
        if apply and name in wanted and not has:
            must(v.call("PATCH", f"/aliases/{alias['uid']}/protection-bypass",
                        {"override": {"scope": "alias-protection-override", "action": "create"}}),
                 f"add {name}'s protection exception")
            print(f"added a protection exception for {name}: it is public now")
            alias, has = has_exception(name)
        if has != (name in wanted):
            problems.append(f"{name}: {'has' if has else 'lacks'} a protection exception; "
                            f"the repo says it {'should' if name in wanted else 'should not'}")
    return problems


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


# A firewall config's fields that Vercel accepts back, those it only reports, one rule's
# fields, and a managed rule's bookkeeping.
CONFIG_FIELDS = ("firewallEnabled", "managedRules", "crs", "ips", "rulesets", "botIdEnabled", "logHeaders")
REPORT_ONLY_FIELDS = ("id", "version", "changes", "projectKey", "ownerId", "updatedAt")
RULE_FIELDS = ("id", "name", "description", "active", "conditionGroup", "action")
MANAGED_RULE_BOOKKEEPING = ("updatedAt", "userId", "username")


def set_keys(d):
    """A dict's keys whose values are set (Vercel reports unset ones as null or false)."""
    return {k for k, val in d.items() if val not in (None, False)}


def contained_action(action):
    """True for an action whose effect stays with the request it matches: a bypass of the custom
    and managed rules (never of the DDoS mitigations), a plain rate limit, or a log, challenge or
    deny with no duration. A persistent action (a duration) blocks the client's address for the
    whole project, production included."""
    mitigate = action.get("mitigate") if isinstance(action, dict) and set_keys(action) == {"mitigate"} else None
    if not isinstance(mitigate, dict):
        return False
    kind, keys = mitigate.get("action"), set_keys(mitigate)
    if kind == "rate_limit":
        limit = mitigate.get("rateLimit")
        return (keys == {"action", "rateLimit"} and isinstance(limit, dict)
                and set_keys(limit) <= {"algo", "window", "limit", "keys", "action"}
                and (limit.get("action") or "rate_limit") in ("rate_limit", "log"))
    return kind in ("bypass", "log", "challenge", "deny") and keys == {"action"}


def staging_only_rule(rule, hosts):
    """True when the rule can only ever affect requests to staging's own domains: Vercel joins a
    rule's condition groups with OR, so every group must need the host to equal one of them, and
    its action must stay with the request it matches."""
    groups = rule.get("conditionGroup") or []
    return bool(groups) and contained_action(rule.get("action")) and all(
        isinstance(group, dict) and any(
            isinstance(c, dict) and c.get("type") == "host" and c.get("op") == "eq" and not c.get("neg")
            and c.get("value") in hosts
            for c in group.get("conditions") or [])
        for group in groups)


def same_rules(want_rules, live_rules):
    """The live rules are the repo's, in the same order (live ones carry extra fields, such as ids)."""
    if len(want_rules) != len(live_rules):
        return False
    for w, h in zip(want_rules, live_rules):
        want = normalise_rule(copy.deepcopy(w))
        have = subset(normalise_rule(copy.deepcopy(h)), want)
        if json.dumps(have, sort_keys=True) != json.dumps(want, sort_keys=True):
            return False
    return True


def config_body(live, rules):
    """A firewall config to send back: the live one's settings as they are, with these rules."""
    body = {k: copy.deepcopy(live[k]) for k in CONFIG_FIELDS if live.get(k) is not None}
    body["managedRules"] = {name: {k: copy.deepcopy(val) for k, val in rule.items() if k not in MANAGED_RULE_BOOKKEEPING}
                            for name, rule in (live.get("managedRules") or {}).items()}
    body["rules"] = [{k: copy.deepcopy(val) for k, val in r.items() if k in RULE_FIELDS} for r in rules]
    return body


def production_parts(config, hosts):
    """Everything in a firewall config that can reach production, for comparing before and after
    a change (unset values, ids and bookkeeping aside)."""
    parts = {k: (None if config.get(k) in (None, False, [], {}) else config.get(k))
             for k in CONFIG_FIELDS if k != "managedRules"}
    parts["managedRules"] = {name: {k: val for k, val in rule.items() if k not in MANAGED_RULE_BOOKKEEPING}
                             for name, rule in (config.get("managedRules") or {}).items()}
    parts["rules"] = [normalise_rule({k: copy.deepcopy(val) for k, val in r.items() if k in RULE_FIELDS and k != "id"})
                      for r in config.get("rules") or [] if not staging_only_rule(r, hosts)]
    return json.dumps(parts, sort_keys=True)


def staging_firewall(want, live, hosts):
    """The firewall config `--staging-only` sends, or None when staging's rules already match.

    It starts from Vercel's live config, so every setting and every rule that can reach
    production goes back exactly as it is (ids included); only the rules limited to staging's
    domains come from the repo. It fails if the repo's firewall changes anything else (its
    managed rules, or a rule not limited to staging): that waits for the release pipeline.
    """
    unknown = sorted(set(live) - set(CONFIG_FIELDS) - set(REPORT_ONLY_FIELDS) - {"rules"})
    if unknown:
        fail(f"--staging-only: Vercel's firewall has fields apply.py doesn't know ({', '.join(unknown)}); "
             "sending the config back could reset them, so apply.py needs updating first")
    if not all(isinstance(r, dict) for r in (live.get("managedRules") or {}).values()):
        fail("--staging-only: Vercel's managed rules aren't in the shape apply.py knows")
    want_rules, live_rules = want["rules"], live.get("rules") or []
    for where, names in (("firewall.json", [r.get("name") for r in want_rules]),
                         ("Vercel's staging rules", [r.get("name") for r in live_rules if staging_only_rule(r, hosts)])):
        twice = sorted({n for n in names if names.count(n) > 1})
        if twice:
            fail(f"--staging-only: {where} names more than one rule {', '.join(map(repr, twice))}")
    reaching = subset_differences(want["managedRules"], live.get("managedRules") or {}, "managed rules")
    if live.get("firewallEnabled") is not True:
        reaching.append("the firewall is off")
    want_others = [r for r in want_rules if not staging_only_rule(r, hosts)]
    live_others = [r for r in live_rules if not staging_only_rule(r, hosts)]
    if not same_rules(want_others, live_others):
        reaching.append("the rules that reach production differ (the repo's, in order: "
                        f"{[r.get('name') for r in want_others]}; Vercel's: {[r.get('name') for r in live_others]})")
    if reaching:
        fail("--staging-only applies only firewall rules limited to staging's domains, and this change "
             "also reaches production, so it waits for the release pipeline: " + "; ".join(reaching))
    if same_rules(want_rules, live_rules):
        return None
    kept = iter(live_others)
    live_staging = {r.get("name"): r for r in live_rules if staging_only_rule(r, hosts)}
    rules = []
    for r in want_rules:
        if staging_only_rule(r, hosts):
            rule = dict(r)
            if live_staging.get(r["name"], {}).get("id"):
                rule["id"] = live_staging[r["name"]]["id"]
        else:
            rule = next(kept)
        rules.append(rule)
    return config_body(live, rules)


def firewall(v, proj, check_only, staging_hosts=None):
    want = load("firewall.json")
    q = {"projectId": proj["id"]}
    if staging_hosts is not None:
        before = must(v.call("GET", "/v1/security/firewall/config/active", query=q), "read the firewall")
        body = staging_firewall(want, before, staging_hosts)
        if body is not None:
            must(v.call("PUT", "/v1/security/firewall/config", body, q), "apply staging's firewall rules")
            after = must(v.call("GET", "/v1/security/firewall/config/active", query=q), "read the firewall")
            if production_parts(after, staging_hosts) != production_parts(before, staging_hosts):
                must(v.call("PUT", "/v1/security/firewall/config", config_body(before, before.get("rules") or []), q),
                     "put the firewall back as it was")
                fail("--staging-only: after the change, Vercel's firewall differed in a part that reaches "
                     "production, so the config was put back as it was; nothing is changed")
            names = [r["name"] for r in want["rules"] if staging_only_rule(r, staging_hosts)]
            print(f"applied the firewall rules limited to staging's domains: {', '.join(names)}")
    elif not check_only:
        must(v.call("PUT", "/v1/security/firewall/config", want, q), "apply the firewall")
    live = must(v.call("GET", "/v1/security/firewall/config/active", query=q), "read the firewall")
    problems = []
    if live.get("firewallEnabled") is not True:
        problems.append("firewall: not enabled")
    problems += subset_differences(want["managedRules"], live.get("managedRules") or {}, "firewall.managedRules")
    if not same_rules(want["rules"], live.get("rules") or []):
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
    if args not in ([], ["--check"], ["--staging-only"]):
        sys.exit(__doc__)
    staging_only = args == ["--staging-only"]
    check_only = args == ["--check"] or staging_only
    cfg = load("project.json")
    staging = {d for e in cfg["customEnvironments"].values() for d in e.get("domains", [])}
    if staging & set(cfg["domains"]):
        fail(f"staging's domains may not be production's: {sorted(staging & set(cfg['domains']))}")
    v = Vercel(cfg["team"])
    proj = project(v, cfg, check_only)
    problems = []
    live, p = settings(v, cfg, proj, check_only)
    problems += p
    envs, p = environments(v, cfg, proj, check_only)
    problems += p
    _, p = domains(v, cfg, proj, envs, check_only)
    problems += p
    if staging_only and problems:
        fail("--staging-only changes staging's own settings only when everything else matches the repo "
             "(which also proves staging's domain is attached to staging): " + "; ".join(problems))
    problems += protection_exceptions(v, cfg, apply=not args or staging_only)
    problems += firewall(v, proj, check_only, staging_hosts=staging if staging_only else None)
    if problems:
        print(f"Vercel project {cfg['project']} does NOT match the repo:")
        for line in problems:
            print(f"  - {line}")
        return 1
    print(f"Vercel project {cfg['project']} ({proj['id']}) matches the repo: "
          f"{len(cfg['settings'])} settings, git {cfg['git']['repo']} (production branch "
          f"{cfg['git']['productionBranch']}), environments {', '.join(cfg['customEnvironments'])}, "
          f"{len(cfg['domains']) + sum(len(e.get('domains', [])) for e in cfg['customEnvironments'].values())} "
          f"domains, public without Vercel's login: {', '.join(cfg.get('protectionExceptions', [])) or 'none'}, "
          f"firewall with {len(load('firewall.json')['rules'])} rules; "
          f"autoAssignCustomDomains is {live.get('autoAssignCustomDomains')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
