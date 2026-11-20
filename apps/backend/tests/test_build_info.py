"""The version and commit an install reports (US-91.1)."""

import json
from importlib import metadata
from pathlib import Path

from asterism.core import build_info

ROOT = Path(__file__).resolve().parents[3]


def test_the_version_is_the_root_package_version():
    root_version = json.loads((ROOT / "package.json").read_text())["version"]
    assert build_info.app_version() == metadata.version("asterism-core") == root_version


def test_the_commit_comes_from_the_build_and_is_otherwise_unknown(monkeypatch):
    monkeypatch.delenv("ASTERISM_COMMIT", raising=False)
    assert build_info.app_commit() == "unknown"
    monkeypatch.setenv("ASTERISM_COMMIT", " ")
    assert build_info.app_commit() == "unknown"
    monkeypatch.setenv("ASTERISM_COMMIT", "0123456789abcdef")
    assert build_info.app_commit() == "0123456789abcdef"


def test_an_uninstalled_package_has_an_unknown_version(monkeypatch):
    def missing(name):
        raise metadata.PackageNotFoundError(name)

    monkeypatch.setattr(build_info.metadata, "version", missing)
    assert build_info.app_version() == "unknown"
