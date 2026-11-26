"""US-109.1: loose lists keep their numbers, bullets and indent in PDF downloads."""

import io

import pdfplumber
from asterism.domains.canvas.exports import markdown_pdf


def lines(content: str) -> list[tuple[float, str]]:
    """Each line of the first page as (left edge in points, text)."""
    page = pdfplumber.open(io.BytesIO(markdown_pdf("Lists", content))).pages[0]
    return [(round(line["x0"], 1), line["text"].strip()) for line in page.extract_text_lines() if line["text"].strip()]


def x_of(found: list[tuple[float, str]], text: str) -> float:
    return next(x for x, line in found if line.endswith(text))


def texts(found: list[tuple[float, str]]) -> list[str]:
    return [line for _, line in found]


def test_a_loose_ordered_list_keeps_its_numbers_and_item_paragraphs():
    found = lines("1. Step one\n\n   More on one.\n\n2. Step two\n\nAfter.\n")
    assert texts(found) == ["1. Step one", "More on one.", "2. Step two", "After."]
    # The second paragraph hangs under the item's text, not the page margin.
    assert x_of(found, "More on one.") > x_of(found, "After.")


def test_loose_bullets_at_each_level_and_text_after_a_nested_list():
    found = lines("- Alpha\n\n  - Inner one\n\n    Inner more.\n\n  - Inner two\n\n  Back in alpha.\n\n- Beta\n")
    assert texts(found) == ["• Alpha", "• Inner one", "Inner more.", "• Inner two", "Back in alpha.", "• Beta"]
    assert x_of(found, "Inner one") > x_of(found, "Alpha")
    assert x_of(found, "Inner more.") > x_of(found, "Back in alpha.") > x_of(found, "Beta")


def test_tight_lists_quotes_and_headings_are_unchanged():
    content = "# Title\n\n- a\n- b\n\n> 1. q\n>\n> 2. r\n\n3. Three\n4. Four\n"
    assert texts(lines(content)) == ["Title", "• a", "• b", "1. q", "2. r", "3. Three", "4. Four"]


def test_a_paragraph_after_code_in_an_item_keeps_the_item_indent():
    found = lines("1. One\n\n   ```\n   code\n   ```\n\n   After code.\n\nOutside.\n")
    assert texts(found) == ["1. One", "code", "After code.", "Outside."]
    assert x_of(found, "After code.") > x_of(found, "Outside.")
