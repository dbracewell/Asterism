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


def load_decorators(directory: str, target_decorators: tuple[str, ...]) -> None:
    from importlib.machinery import SourceFileLoader

    base_path = Path(directory)
    if not base_path.is_dir():
        return

    for file_path in base_path.iterdir():
        if file_path.name.startswith("__"):
            continue

        if file_path.is_dir():
            load_decorators(str(file_path), target_decorators)
            continue

        if file_path.suffix != ".py":
            continue

        if _has_annotation(file_path, target_decorators):
            loader = SourceFileLoader(file_path.stem, str(file_path))
            loader.load_module()
