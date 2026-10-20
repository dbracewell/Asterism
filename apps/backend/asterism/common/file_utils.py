from pathlib import Path


def calculate_directory_size(root: Path) -> int:
    """Recursively total the byte size of regular files under *root*.

    Symlinks are skipped entirely, and files that disappear or become unreadable
    while walking are ignored rather than aborting the walk.

    Args:
        root: Directory to measure. If it does not exist or is not a directory, 0 is returned.

    Returns:
        Total size in bytes of all regular (non-symlink) files under *root*.
    """
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
