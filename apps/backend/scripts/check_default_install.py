"""Fail when the default backend install would pull in PyTorch (US-94.2, ADR-0077).

The published CPU image installs ``asterism-core`` without extras, so its
dependency graph, direct or transitive, must not contain torch, torchvision,
diffusers or accelerate: those belong to the ``local-image`` extra. Reads
``uv.lock``, follows every default dependency (and the extras it requests) on any
platform, and names the chain that pulls a forbidden package in:

    uv run --no-project python scripts/check_default_install.py [path/to/uv.lock]

Standard library only, so it runs without syncing the project.
"""

import sys
import tomllib
from collections import deque
from pathlib import Path

ROOT = "asterism-core"
FORBIDDEN = frozenset({"torch", "torchvision", "diffusers", "accelerate"})


def _edges(package: dict, extras: frozenset[str]) -> list[tuple[str, frozenset[str]]]:
    """A package's dependencies, with the extras of it that were requested."""
    entries = list(package.get("dependencies", []))
    for extra in extras:
        entries += package.get("optional-dependencies", {}).get(extra, [])
    return [(entry["name"], frozenset(entry.get("extra", []))) for entry in entries]


def forbidden_chains(lock: dict) -> list[list[str]]:
    """Each forbidden package reached from the root's default dependencies, with one chain to it.

    Markers are ignored on purpose: a dependency on any platform counts. Dev
    groups and the root's own extras are not followed.
    """
    packages: dict[str, list[dict]] = {}
    for package in lock.get("package", []):
        packages.setdefault(package["name"], []).append(package)
    if ROOT not in packages:
        raise ValueError(f"{ROOT} is not in the lockfile")

    seen: set[tuple[str, frozenset[str]]] = set()
    queue: deque[tuple[str, frozenset[str], list[str]]] = deque()
    for name, extras in _edges(packages[ROOT][0], frozenset()):
        queue.append((name, extras, [ROOT, name]))
    found: dict[str, list[str]] = {}
    while queue:
        name, extras, chain = queue.popleft()
        if name in FORBIDDEN:
            found.setdefault(name, chain)
            continue
        if (name, extras) in seen:
            continue
        seen.add((name, extras))
        # A name can be locked more than once (per platform); follow every version.
        for package in packages.get(name, []):
            for child, child_extras in _edges(package, extras):
                queue.append((child, child_extras, [*chain, child]))
    return [found[name] for name in sorted(found)]


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent.parent / "uv.lock"
    with path.open("rb") as source:
        chains = forbidden_chains(tomllib.load(source))
    if not chains:
        print(f"The default install has none of {', '.join(sorted(FORBIDDEN))}.")
        return 0
    for chain in chains:
        print(f"{chain[-1]} is in the default install, pulled in by {chain[-2]}: {' → '.join(chain)}")
    print("Move it to the local-image extra in pyproject.toml, or drop the dependency that needs it (US-94.2).")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
