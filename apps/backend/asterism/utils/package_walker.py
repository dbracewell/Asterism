import importlib.util
import sys
from pathlib import Path


def _has_annotation(
    file_path: Path,
    target_decorators: tuple[str, ...],
) -> bool:
    import ast

    """Scan AST of a file to check if a specific decorator exists."""
    try:
        tree = ast.parse(file_path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute):
                func_value = node.value
                if isinstance(func_value, ast.Name):
                    name = f"{func_value.id}.{node.attr}"
                    if name in target_decorators:
                        return True
    except Exception:
        pass
    return False


def _resolve_package_prefix(base_path: Path) -> str:
    """Resolve dotted package prefix for ``base_path`` when inside a package tree."""
    parts: list[str] = []
    cur = base_path

    while (cur / "__init__.py").exists():
        parts.append(cur.name)
        cur = cur.parent

    return ".".join(reversed(parts))


def load_decorators(directory: str, target_decorators: tuple[str, ...]) -> None:
    base_path = Path(directory)
    if not base_path.is_dir():
        return

    package_prefix = _resolve_package_prefix(base_path)

    for file_path in base_path.rglob("*.py"):
        if file_path.name.startswith("__"):
            continue

        if not _has_annotation(file_path, target_decorators):
            continue

        rel = file_path.relative_to(base_path).with_suffix("")
        rel_module = ".".join(rel.parts)
        full_name = f"{package_prefix}.{rel_module}" if package_prefix else rel_module

        spec = importlib.util.spec_from_file_location(full_name, str(file_path))
        if spec is None or spec.loader is None:
            print(f"Failed to create module spec for {file_path}")
            continue

        module = importlib.util.module_from_spec(spec)
        module.__package__ = full_name.rpartition(".")[0]
        sys.modules[full_name] = module
        spec.loader.exec_module(module)
