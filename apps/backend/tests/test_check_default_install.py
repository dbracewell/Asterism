"""US-94.2: the check that keeps PyTorch out of the default install."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check_default_install.py"
_spec = importlib.util.spec_from_file_location("check_default_install", SCRIPT)
assert _spec is not None and _spec.loader is not None
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)


def lock(*packages: dict) -> dict:
    return {"package": [{"name": "asterism-core", **packages[0]}, *packages[1:]]}


def test_the_real_lockfile_keeps_torch_in_the_extra():
    import tomllib

    with (SCRIPT.parent.parent / "uv.lock").open("rb") as source:
        assert check.forbidden_chains(tomllib.load(source)) == []


def test_a_direct_dependency_is_reported():
    assert check.forbidden_chains(lock({"dependencies": [{"name": "torch"}]})) == [["asterism-core", "torch"]]


def test_a_transitive_dependency_names_the_package_that_pulls_it_in():
    chains = check.forbidden_chains(
        lock(
            {"dependencies": [{"name": "nice"}]},
            {"name": "nice", "dependencies": [{"name": "helper"}]},
            {"name": "helper", "dependencies": [{"name": "diffusers"}]},
        )
    )
    assert chains == [["asterism-core", "nice", "helper", "diffusers"]]


def test_a_requested_extra_of_a_dependency_is_followed_and_others_are_not():
    base = {"name": "lib", "optional-dependencies": {"gpu": [{"name": "torch"}], "docs": [{"name": "torchvision"}]}}
    assert check.forbidden_chains(lock({"dependencies": [{"name": "lib", "extra": ["gpu"]}]}, base)) == [
        ["asterism-core", "lib", "torch"]
    ]
    assert check.forbidden_chains(lock({"dependencies": [{"name": "lib"}]}, base)) == []


def test_the_roots_own_extras_and_dev_groups_are_not_followed():
    root = {
        "dependencies": [{"name": "fine"}],
        "optional-dependencies": {"local-image": [{"name": "torch"}]},
        "dev-dependencies": {"dev": [{"name": "accelerate"}]},
    }
    assert check.forbidden_chains(lock(root, {"name": "fine"})) == []


def test_every_platform_version_of_a_package_is_followed():
    chains = check.forbidden_chains(
        lock(
            {"dependencies": [{"name": "split"}]},
            {"name": "split", "version": "1+linux", "dependencies": []},
            {"name": "split", "version": "1", "dependencies": [{"name": "accelerate"}]},
        )
    )
    assert chains == [["asterism-core", "split", "accelerate"]]


def test_the_command_fails_with_the_chain(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    path = tmp_path / "uv.lock"
    path.write_text(
        '[[package]]\nname = "asterism-core"\ndependencies = [{ name = "lancedb" }]\n\n'
        '[[package]]\nname = "lancedb"\ndependencies = [{ name = "torch" }]\n'
    )
    assert check.main(["check", str(path)]) == 1
    assert "torch is in the default install, pulled in by lancedb: asterism-core → lancedb → torch" in (
        capsys.readouterr().out
    )
