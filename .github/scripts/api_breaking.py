#!/usr/bin/env python3
"""Fails a pull request that breaks a call of the public API's v1 (PLAN.md step 3.5a).

    python3 .github/scripts/api_breaking.py --main origin/main

The public API's OpenAPI file (product/packages/api/openapi.json) is made from the contract and
kept in the repository; the contract's own tests fail when it's stale. This compares main's file
with the pull request's using oasdiff (pinned in tools.py), and fails on anything oasdiff counts
as breaking, warnings included: a call, field or value removed or renamed, a type changed, a new
required input, an answer's field made optional. Within v1, only additions: new calls, new
optional inputs, new fields (docs/research/public-api.md, section 2.6). Anything else is v2,
served beside v1.

A call in beta (`x-stability-level: beta`, which the contract's own code writes; social's calls
while it's built, docs/social/build.md sections 2 (D9) and 7.12) may change within v1. The order:
refuse a call that main has without the mark and the pull request marks (it's v1 already, so it
stays v1), then leave beta operations out of both files, then oasdiff as before, then its verdict.
A call new to the file may be beta from the start; removing the mark makes the call v1, which only
adds.

On GitHub's Quick checks oasdiff must be there (the job installs it); on this Mac, without it,
the check says so and skips. Before main has a file there's nothing to compare. Python's
standard library only.
"""
import argparse
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FILE = "product/packages/api/openapi.json"
BETA_MARK = "x-stability-level"
BETA = "beta"
# The keys of a path item that are operations (OpenAPI 3.1); the others (parameters, summary,
# servers) belong to the path.
METHODS = ("get", "put", "post", "delete", "options", "head", "patch", "trace")


def oasdiff(environ=os.environ):
    """Where oasdiff is: $OASDIFF, else on the PATH; None if neither."""
    return environ.get("OASDIFF") or shutil.which("oasdiff")


def mains_file(main, root=ROOT):
    """main's copy of the file, or None before main has one."""
    shown = subprocess.run(["git", "show", f"{main}:{FILE}"], cwd=root, capture_output=True, text=True)
    return shown.stdout if shown.returncode == 0 else None


def is_beta(operation):
    """Whether an operation carries the beta mark."""
    return isinstance(operation, dict) and operation.get(BETA_MARK) == BETA


def operations(doc):
    """Every operation of a document, by (method, path)."""
    found = {}
    paths = doc.get("paths") if isinstance(doc, dict) else None
    for path, item in (paths or {}).items():
        if not isinstance(item, dict):
            continue
        for method in METHODS:
            if method in item:
                found[(method, path)] = item[method]
    return found


def newly_beta(base, head):
    """The (method, path) pairs that are in `base` without the beta mark and in `head` with it, sorted.
    A pair that isn't in `base` is never newly beta: a new call may be beta from the start."""
    before = operations(base)
    after = operations(head)
    return sorted(pair for pair, operation in after.items()
                  if is_beta(operation) and pair in before and not is_beta(before[pair]))


def strip_beta(doc):
    """A copy of the document without its beta operations, and without the paths they leave with no
    operation. Never touches `components`; the document given is left as it was."""
    out = copy.deepcopy(doc)
    paths = out.get("paths") if isinstance(out, dict) else None
    for path in list((paths or {}).keys()):
        item = paths[path]
        if not isinstance(item, dict):
            continue
        dropped = [method for method in METHODS if is_beta(item.get(method))]
        for method in dropped:
            del item[method]
        if dropped and not any(method in item for method in METHODS):
            del paths[path]
    return out


def breaking(tool, base_text, head_path):
    """oasdiff's verdict: (exit code, what it said). Fails on warnings as well as errors."""
    with tempfile.TemporaryDirectory() as folder:
        base = os.path.join(folder, "main.openapi.json")
        with open(base, "w", encoding="utf-8") as f:
            f.write(base_text)
        done = subprocess.run(
            [tool, "breaking", base, head_path, "--fail-on", "WARN", "--format", "text"],
            capture_output=True, text=True)
    return done.returncode, (done.stdout + done.stderr).strip()


def refusal(pairs, main_name):
    """What a pull request that gives v1 calls the beta mark is told."""
    named = "\n".join(f"  {method.upper()} {path}" for method, path in pairs)
    return (f"These calls are v1 in {main_name}'s {FILE} (no beta mark there), and this pull "
            f"request gives them the beta mark ({BETA_MARK}: {BETA}):\n{named}\n\n"
            "A call that is v1 stays v1: within v1, only additions, so it can't become beta. "
            "Remove the mark from each call (`beta: true` in the contract), or, to change the "
            "call, put the change in v2, beside v1. Only a call new to the file may be beta from "
            "the start.")


def verdict(tool, base_text, head_text, main_name="main"):
    """The whole check on two files' texts: (exit code, what to say). Refuses a call newly marked
    beta before anything else (the tool isn't run), then leaves beta operations out of both files,
    then asks oasdiff, which fails on any break of what's left."""
    try:
        base = json.loads(base_text)
        head = json.loads(head_text)
    except ValueError as error:
        return 1, f"{FILE} isn't JSON, in {main_name} or in this pull request: {error}"
    pairs = newly_beta(base, head)
    if pairs:
        return 1, refusal(pairs, main_name)
    with tempfile.TemporaryDirectory() as work:
        head_path = os.path.join(work, "head.openapi.json")
        with open(head_path, "w", encoding="utf-8") as f:
            json.dump(strip_beta(head), f)
        code, said = breaking(tool, json.dumps(strip_beta(base)), head_path)
    if code != 0:
        said = (f"This breaks a v1 call that {main_name}'s {FILE} has. Within v1, only additions: "
                "new calls, new optional inputs, new fields. Put the change in v2 instead, beside "
                f"v1.\n\n{said}")
    return code, said


def main(argv=None, environ=os.environ, root=ROOT):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--main", default="origin/main", help="main's ref to compare with")
    args = parser.parse_args(argv)
    tool = oasdiff(environ)
    if not tool:
        if environ.get("GITHUB_ACTIONS") == "true":
            print("oasdiff is missing: Quick checks install it (tools.py fetch oasdiff).")
            return 1
        print("oasdiff isn't on this Mac, so the breaking-change check is skipped here; "
              "Quick checks run it on every pull request.")
        return 0
    base = mains_file(args.main, root)
    if base is None:
        print(f"{args.main} has no {FILE} yet: nothing to compare.")
        return 0
    with open(os.path.join(root, FILE), encoding="utf-8") as f:
        head = f.read()
    code, said = verdict(tool, base, head, args.main)
    if code == 0:
        print(f"No v1 call breaks: {FILE} only adds to {args.main}'s.")
        if said:
            print(said)
        return 0
    print(said)
    return 1


if __name__ == "__main__":
    sys.exit(main())
