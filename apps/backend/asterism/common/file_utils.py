from pathlib import Path


def calculate_directory_size(root: Path) -> int:
    """Total bytes of regular files under *root*, ignoring symlinks."""
    if not root.is_dir():
        return 0
    total = 0
    for path in root.rglob("*"):
        if path.is_file() and not path.is_symlink():
            try:
                total += path.stat().st_size
            except OSError:
                pass
    return total


