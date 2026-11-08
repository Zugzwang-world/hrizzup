#!/usr/bin/env python3
"""Which parts of the product a pull request touches, by Turborepo's own reckoning.

    python3 .github/scripts/affected.py

Writes `website=true|false` and `app=true|false` to $GITHUB_OUTPUT. It asks `turbo ls
--affected` (between TURBO_SCM_BASE and TURBO_SCM_HEAD), which counts a change to a shared
package, or to a file every package depends on, as touching every part that uses it. The
checks that test a part skip their work when it isn't touched. Prints no secrets.
"""
import json
import os
import subprocess

PARTS = {"website": "@hrizzup/web", "app": "@hrizzup/app"}


def main():
    listing = subprocess.run(
        ["pnpm", "exec", "turbo", "ls", "--affected", "--output=json"],
        check=True, capture_output=True, text=True,
    ).stdout
    touched = {p["name"] for p in json.loads(listing)["packages"]["items"]}
    with open(os.environ["GITHUB_OUTPUT"], "a") as out:
        for part, package in PARTS.items():
            affected = package in touched
            out.write(f"{part}={'true' if affected else 'false'}\n")
            print(f"The {part} is {'' if affected else 'not '}affected by this change.")


if __name__ == "__main__":
    main()
