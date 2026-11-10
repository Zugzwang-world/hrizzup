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

On GitHub's Quick checks oasdiff must be there (the job installs it); on this Mac, without it,
the check says so and skips. Before main has a file there's nothing to compare. Python's
standard library only.
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FILE = "product/packages/api/openapi.json"


def oasdiff(environ=os.environ):
    """Where oasdiff is: $OASDIFF, else on the PATH; None if neither."""
    return environ.get("OASDIFF") or shutil.which("oasdiff")


def mains_file(main, root=ROOT):
    """main's copy of the file, or None before main has one."""
    shown = subprocess.run(["git", "show", f"{main}:{FILE}"], cwd=root, capture_output=True, text=True)
    return shown.stdout if shown.returncode == 0 else None


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
    code, said = breaking(tool, base, os.path.join(root, FILE))
    if code == 0:
        print(f"No v1 call breaks: {FILE} only adds to {args.main}'s.")
        if said:
            print(said)
        return 0
    print(f"This breaks a v1 call that {args.main}'s {FILE} has. Within v1, only additions: new "
          "calls, new optional inputs, new fields. Put the change in v2 instead, beside v1.\n")
    print(said)
    return 1


if __name__ == "__main__":
    sys.exit(main())
