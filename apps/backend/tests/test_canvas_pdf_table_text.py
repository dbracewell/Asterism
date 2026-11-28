"""US-110.1: bold and italics in PDF table cells, and every other mark printed
as written."""

import io

import pdfplumber
import pytest
from asterism.domains.canvas import export_pdf as exports
from asterism.domains.canvas.exports import markdown_pdf


@pytest.fixture(params=["unicode", "core"])
def fonts(request, monkeypatch):
    """Both font paths: the bundled Unicode fonts (when installed) and fpdf2's
    core fonts, which have a real italic."""
    if request.param == "core":
        monkeypatch.setattr(exports, "_font", lambda name: None)
    return request.param


def words(cell: str, heading: str = "H") -> list[tuple[str, str]]:
    data = markdown_pdf("Table", f"| {heading} |\n| - |\n| {cell} |\n")
    page = pdfplumber.open(io.BytesIO(data)).pages[0]
    assert page.annots == []  # Nothing in a cell becomes a link.
    found = page.extract_words(extra_attrs=["fontname"])
    return [(word["text"], word["fontname"]) for word in found]


def body(cell: str, heading: str = "H") -> list[tuple[str, str]]:
    return words(cell, heading)[1:]


def is_bold(font: str) -> bool:
    return "Bold" in font


def bold_is_visible(fonts: str) -> bool:
    """The Unicode path uses its regular file for bold when no bold one is installed."""
    return fonts == "core" or exports._font("sans-bold") is not None


def test_bold_and_italic_runs_keep_their_style(fonts):
    found = body("Plain **strong** and *slanted* and ***both*** end")
    style = {text: font for text, font in found}
    assert [text for text, _ in found] == ["Plain", "strong", "and", "slanted", "and", "both", "end"]
    if not bold_is_visible(fonts):
        return
    assert is_bold(style["strong"]) and is_bold(style["both"])
    assert not any(is_bold(style[text]) for text in ("Plain", "and", "slanted", "end"))
    if fonts == "core":
        assert "Oblique" in style["slanted"] and "BoldOblique" in style["both"]
        assert "Oblique" not in style["strong"]


def test_heading_cells_stay_bold_with_their_own_formatting(fonts):
    found = words("x", heading="**Name** and *kind*")
    assert [text for text, _ in found][:3] == ["Name", "and", "kind"]
    assert bold_is_visible(fonts) is False or all(is_bold(font) for _, font in found[:3])


@pytest.mark.parametrize(
    ("cell", "printed"),
    [
        (r"a \*\*b\*\* c", "a **b** c"),
        ("x -- y ---- z", "x -- y ---- z"),
        (r"`__init__` and \_\_x\_\_", "__init__ and __x__"),
        ("`[x](https://example.com)`", "[x](https://example.com)"),
        (r"C:\\dir\\ and \\*", "C:\\dir\\ and \\*"),
        (r"\- not a bullet", "- not a bullet"),
        ("~~kept~~", "~~kept~~"),
        ("control\x01\x01marks\x05", "controlmarks"),
    ],
)
def test_other_marks_print_as_written(fonts, cell, printed):
    found = body(cell)
    assert " ".join(text for text, _ in found) == printed
    assert not any(is_bold(font) for _, font in found)


def test_code_and_links_print_as_plain_text(fonts):
    found = body("`code` and [a link](https://example.com)")
    assert [text for text, _ in found] == ["code", "and", "a", "link"]
    assert not any(is_bold(font) for _, font in found)
