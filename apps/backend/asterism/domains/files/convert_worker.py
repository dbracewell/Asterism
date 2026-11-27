"""Convert one file with MarkItDown in a child process (US-116.1).

Run as a script, never imported by the app: ``python -I convert_worker.py
<path> <max chars>``. It imports only MarkItDown, gets no secrets in its
environment, and writes at most ``max chars + 1`` characters of text to
stdout, so the parent can tell the text was cut. The parent kills it when
the conversion takes too long, which frees its memory and threads.
"""

import sys
from pathlib import Path


def convert(path: Path) -> str:
    """The file's text, as MarkItDown converts it."""
    from markitdown import MarkItDown

    return MarkItDown().convert(str(path)).text_content


def main(argv: list[str]) -> int:
    path, max_chars = Path(argv[1]), int(argv[2])
    try:
        text = convert(path)
    except Exception:
        # Converter errors often contain document content: say nothing.
        return 1
    sys.stdout.buffer.write(text[: max_chars + 1].encode("utf-8", "surrogatepass"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
