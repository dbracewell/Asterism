"""US-90.10: 401 means "sign in again"; nothing else may raise it.

The browser treats a 401 as a rejected token: it drops the cached token and
fetches a new one, so a 401 for "not allowed" reads as being signed out. The
rule, in docs/architecture/auth-and-security.md ("Limits and failures"):

- 401: a missing, expired or forged token, a suspended or deleted account, or
  a wrong server credential (the system key, a signed download link);
- 403: signed in, but not allowed (a role, group or policy check);
- 404: another user's resource, or one that doesn't exist.

This test lists every place that raises a 401 and fails on any not named here.
"""

import ast
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent / "asterism"

# (module, function) pairs that check a credential. Add one only for a check
# whose failure means the caller must sign in again or present a valid secret.
ALLOWED = {
    ("core/security.py", "_require_non_empty_claim"),  # token claims
    ("core/security.py", "verify_jwks_token"),  # token signature and expiry
    ("core/security.py", "verify_jwks"),  # token keys
    ("domains/user/lifecycle.py", "assert_active"),  # suspended account
    ("domains/user/service.py", "ensure_user"),  # deleted account
    ("domains/user/router.py", "create_user"),  # no token and no system key
    ("domains/classes/invites.py", "require_system_key"),  # server-to-server key
    ("domains/data_export/service.py", "archive_for_ticket"),  # signed download link
}


def _raises_401(node: ast.AST) -> bool:
    """`UnauthorizedException(...)` or `CodedException(401, ...)`."""
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
        return False
    if node.func.id == "UnauthorizedException":
        return True
    return (
        node.func.id == "CodedException"
        and bool(node.args)
        and isinstance(node.args[0], ast.Constant)
        and node.args[0].value == 401
    )


def _sites() -> set[tuple[str, str]]:
    sites: set[tuple[str, str]] = set()
    for path in sorted(PACKAGE.rglob("*.py")):
        module = path.relative_to(PACKAGE).as_posix()

        def visit(node: ast.AST, function: str, module: str = module) -> None:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                function = node.name
            if isinstance(node, ast.Raise) and node.exc is not None and _raises_401(node.exc):
                sites.add((module, function))
            for child in ast.iter_child_nodes(node):
                visit(child, function)

        visit(ast.parse(path.read_text(encoding="utf-8")), "<module>")
    return sites


def test_only_credential_checks_raise_401():
    unexpected = sorted(_sites() - ALLOWED)
    assert not unexpected, (
        "These raise 401 but aren't credential checks: "
        + ", ".join(f"{module}:{function}" for module, function in unexpected)
        + ". A signed-in caller who isn't allowed gets ForbiddenException (403); "
        "another user's resource gets NotFoundException (404). See "
        "docs/architecture/auth-and-security.md, Limits and failures."
    )


def test_the_allowed_list_has_no_stale_entries():
    assert ALLOWED <= _sites(), f"No longer raise 401: {sorted(ALLOWED - _sites())}"


def test_the_guard_catches_a_role_check(tmp_path, monkeypatch):
    """A new 401 for "not allowed" fails the rule."""
    monkeypatch.setattr(
        "test_unauthorized_rule.PACKAGE",
        _fake_package(tmp_path),
    )
    assert ("domains/demo.py", "require_teacher") in _sites() - ALLOWED


def _fake_package(root: Path) -> Path:
    (root / "domains").mkdir()
    (root / "domains" / "demo.py").write_text(
        "def require_teacher(user):\n    if user.role != 'teacher':\n        raise UnauthorizedException()\n"
    )
    return root
