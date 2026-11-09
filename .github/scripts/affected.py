#!/usr/bin/env python3
"""Which parts of the product a pull request touches, by Turborepo's own reckoning.

    python3 .github/scripts/affected.py

Writes `website=true|false` and `app=true|false` to $GITHUB_OUTPUT. It asks `turbo ls
--affected` (between TURBO_SCM_BASE and TURBO_SCM_HEAD), which counts a change to a shared
package, or to a file every package depends on, as touching every part that uses it. A change
to the checks themselves (.github/workflows or .github/scripts) counts as touching every part,
so a pull request that changes how a check runs is checked by it. The checks that test a part
skip their work when it isn't touched. Prints no secrets.
"""
import json
import os
import subprocess

PARTS = {"website": "@hrizzup/web", "app": "@hrizzup/app"}
CHECKS = (".github/workflows/", ".github/scripts/")  # the checks themselves


def checks_changed(base, head, run=subprocess.run):
    """The files of the checks themselves that this change touches (empty without a base)."""
    if not base or not head:
        return []
    return run(
        ["git", "diff", "--name-only", f"{base}...{head}", "--", *CHECKS],
        check=True, capture_output=True, text=True,
    ).stdout.split()


def parts(touched, checks):
    """{part: affected?} from the packages Turborepo counts as touched and the checks' files."""
    return {part: bool(checks) or package in touched for part, package in PARTS.items()}


def main():
    listing = subprocess.run(
        ["pnpm", "exec", "turbo", "ls", "--affected", "--output=json"],
        check=True, capture_output=True, text=True,
    ).stdout
    touched = {p["name"] for p in json.loads(listing)["packages"]["items"]}
    checks = checks_changed(os.environ.get("TURBO_SCM_BASE"), os.environ.get("TURBO_SCM_HEAD"))
    if checks:
        print(f"This change touches the checks themselves ({', '.join(checks)}), so every part counts as affected.")
    with open(os.environ["GITHUB_OUTPUT"], "a") as out:
        for part, affected in parts(touched, checks).items():
            out.write(f"{part}={'true' if affected else 'false'}\n")
            print(f"The {part} is {'' if affected else 'not '}affected by this change.")


if __name__ == "__main__":
    main()
