"""Static import inspection shared by architecture tests, including relative imports."""

import ast
from importlib.util import resolve_name
from pathlib import Path


def module_name(path: Path, root: Path) -> str:
    parts = path.relative_to(root.parent).with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def imported_modules(path: Path, root: Path) -> list[str]:
    """Return import targets at every AST depth, including from-package aliases."""
    name = module_name(path, root)
    package = name if path.name == "__init__.py" else name.rpartition(".")[0]
    modules = []
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            target = node.module or ""
            if node.level:
                target = resolve_name("." * node.level + target, package)
            modules.extend(f"{target}.{alias.name}" for alias in node.names)
    return modules


def within(module: str, boundary: str) -> bool:
    return module == boundary or module.startswith(boundary + ".")
