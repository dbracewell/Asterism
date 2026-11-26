"""US-110.3: quotes in PDF downloads are indented with a bar at the left."""

import io
import uuid

import pdfplumber
import pytest
from asterism.domains.canvas.exports import ExportImage, markdown_pdf
from PIL import Image

# A word's box reaches a little below the line fpdf2 ends with.
SLACK = 1
QUOTE_STEP = 6 * 72 / 25.4
SEA = uuid.UUID("11030000-0000-4000-8000-000000000001")


def sea() -> ExportImage:
    buffer = io.BytesIO()
    Image.new("RGB", (200, 60), "#2a6f97").save(buffer, format="PNG")
    data = buffer.getvalue()
    return ExportImage(png=data, width=200, height=60, name="sea.png", original=data, extension="png")


def pages(content: str, images=None):
    return pdfplumber.open(io.BytesIO(markdown_pdf("Quotes", content, None, images or {}))).pages


def word(page, text: str) -> dict:
    return page.search(text)[0]


def bars(page) -> list[dict]:
    """The vertical lines on a page: quote bars."""
    return sorted((line for line in page.lines if abs(line["x0"] - line["x1"]) < 0.1), key=lambda line: line["x0"])


def test_a_quote_is_indented_with_a_bar_for_its_full_height():
    page = pages("Before.\n\n> First line of the quote " + "and more words " * 20 + "\n>\n> Last.\n\nAfter.\n")[0]
    first, last = word(page, "First line"), word(page, "Last.")
    assert first["x0"] == pytest.approx(word(page, "Before.")["x0"] + QUOTE_STEP, abs=1.5)
    assert word(page, "After.")["x0"] == pytest.approx(word(page, "Before.")["x0"], abs=0.5)
    (bar,) = bars(page)
    assert word(page, "Before.")["x0"] < bar["x0"] < first["x0"]
    assert bar["top"] <= first["top"] and bar["bottom"] >= last["bottom"] - SLACK
    assert bar["bottom"] < word(page, "After.")["top"]


def test_nested_quotes_indent_further_with_their_own_bar():
    page = pages("> Outer.\n>\n> > Inner.\n>\n> Outer again.\n")[0]
    outer, inner = bars(page)
    assert word(page, "Inner.")["x0"] == pytest.approx(word(page, "Outer.")["x0"] + QUOTE_STEP, abs=1.5)
    assert outer["x0"] < word(page, "Outer.")["x0"] < inner["x0"] < word(page, "Inner.")["x0"]
    assert outer["top"] < inner["top"] and inner["bottom"] < outer["bottom"]
    assert inner["top"] <= word(page, "Inner.")["top"] and inner["bottom"] >= word(page, "Inner.")["bottom"] - SLACK


def test_lists_code_and_pictures_in_a_quote_line_up_with_its_text():
    content = (
        f"> Text.\n>\n> - Item\n>\n> ```\n> quoted code\n> ```\n>\n> ![Sea](asterism-file:{SEA})\n>\n> After picture.\n"
    )
    page = pages(content, {SEA: sea()})[0]
    text = word(page, "Text.")["x0"]
    assert word(page, "Item")["x0"] > text
    assert word(page, "quoted code")["x0"] == pytest.approx(text, abs=1.5)
    (picture,) = page.images
    assert picture["x0"] == pytest.approx(text, abs=3)
    assert word(page, "After picture.")["x0"] == pytest.approx(text, abs=1.5)
    (bar,) = bars(page)
    assert bar["bottom"] >= word(page, "After picture.")["bottom"] - SLACK


def test_a_quote_across_a_page_break_has_a_bar_on_each_page():
    quote = "> " + "Quoted words across pages. " * 60 + "\n\nEnd.\n"
    for filler in range(10, 40):
        found = pages("Filler.\n\n" * filler + quote)
        if len(found) == 2 and found[0].search("Quoted words") and found[1].search("Quoted words"):
            break
    else:
        pytest.fail("no filler length split the quote")
    first, second = found
    (bar_one,) = bars(first)
    (bar_two,) = bars(second)
    assert bar_one["top"] <= first.search("Quoted words")[0]["top"]
    assert bar_one["bottom"] >= first.search("Quoted words")[-1]["bottom"] - SLACK
    assert bar_two["top"] <= second.search("Quoted words")[0]["top"] + 1
    assert bar_two["bottom"] >= second.search("Quoted words")[-1]["bottom"] - SLACK
    assert bar_two["bottom"] < word(second, "End.")["top"]
    assert bar_one["x0"] == pytest.approx(bar_two["x0"])


def test_a_document_without_quotes_draws_no_bars():
    assert bars(pages("# Title\n\n- a\n\n```\ncode\n```\n")[0]) == []
