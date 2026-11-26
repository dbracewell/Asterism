"""US-109.2: chat images and drawn diagrams inside lists and quotes in PDF downloads.

The writer gets ready-made pictures, so these need no database or browser.
"""

import io
import re
import uuid

import pdfplumber
import pytest
from asterism.domains.canvas.diagrams import DrawnDiagram
from asterism.domains.canvas.exports import (
    DIAGRAM_NOT_DRAWN,
    IMAGE_NOT_INCLUDED,
    ExportImage,
    _export_html,
    markdown_pdf,
)
from fpdf import FPDF
from PIL import Image

SEA = uuid.UUID("10900000-0000-4000-8000-000000000001")
GONE = uuid.UUID("10900000-0000-4000-8000-000000000002")
FLOW = "flowchart LR\n  a --> b\n"
BROKEN = "flowchart LR\n  broken -->\n"


def png(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "#2a6f97").save(buffer, format="PNG")
    return buffer.getvalue()


def sea(width: int = 300, height: int = 100) -> ExportImage:
    data = png(width, height)
    return ExportImage(png=data, width=width, height=height, name="sea.png", original=data, extension="png")


DRAWN = DrawnDiagram(png=png(400, 100), width=400, height=100, label="Flow", description="a to b")


def image(alt: str, file_id: uuid.UUID = SEA) -> str:
    return f"![{alt}](asterism-file:{file_id})"


def indented(source: str, spaces: int = 3) -> str:
    return "".join(" " * spaces + line + "\n" for line in source.splitlines())


def pdf(content: str, *, images=None, diagrams=None) -> bytes:
    return markdown_pdf("Pictures", content, diagrams, {SEA: sea()} if images is None else images)


def alt_texts(data: bytes) -> list[str]:
    return [match.decode() for match in re.findall(rb"/Alt \(([^)]*)\)", data)]


def page(data: bytes):
    return pdfplumber.open(io.BytesIO(data)).pages[0]


def top_of(found, text: str) -> float:
    return found.search(text)[0]["top"]


def left_of(found, text: str) -> float:
    return found.search(text)[0]["x0"]


def test_an_image_in_a_loose_list_item_draws_under_its_text_and_lines_up_with_it():
    data = pdf(f"Intro.\n\n1. Step one:\n\n   {image('The sea')}\n\n   After the picture.\n\n2. Step two\n")
    found = page(data)
    (picture,) = found.images
    assert top_of(found, "Step one:") < picture["top"] < picture["bottom"] <= top_of(found, "After the picture.")
    # Indented like the item's text, and the text after it keeps that indent.
    assert picture["x0"] > left_of(found, "Intro.")
    # (Text sits fpdf2's 1 mm cell padding right of the picture's edge.)
    assert left_of(found, "After the picture.") == pytest.approx(picture["x0"], abs=3)
    assert left_of(found, "After the picture.") > left_of(found, "Intro.")
    assert "1. Step one:" in found.extract_text() and "2. Step two" in found.extract_text()
    assert alt_texts(data) == ["The sea"]


def test_a_picture_that_starts_an_item_keeps_the_items_marker():
    found = page(pdf(f"1. First\n2. {image('Leading')} Second starts with a picture.\n"))
    assert len(found.images) == 1
    lines = found.extract_text().splitlines()
    assert lines[1].strip() == "2."
    assert top_of(found, "2.") < found.images[0]["top"] < top_of(found, "Second starts")


def test_nested_items_and_quotes_draw_their_images_further_in():
    content = (
        f"- Outer {image('Outer sea')}\n  - Inner {image('Inner sea')} inline.\n\n"
        f"> A quote {image('Quoted sea')} and more quote.\n"
    )
    data = pdf(content)
    found = page(data)
    outer, inner, quoted = sorted(found.images, key=lambda item: item["top"])
    assert inner["x0"] > outer["x0"] > quoted["x0"] - 1
    assert top_of(found, "A quote") < quoted["top"] < top_of(found, "and more quote.")
    assert alt_texts(data) == ["Outer sea", "Inner sea", "Quoted sea"]


def test_a_wide_image_fits_the_width_left_after_the_indent():
    found = page(pdf(f"- a\n  - b\n    - {image('Wide')}\n", images={SEA: sea(3000, 100)}))
    (picture,) = found.images
    assert picture["x1"] <= found.width - 18 * 72 / 25.4 + 0.5
    assert picture["x0"] > 18 * 72 / 25.4 + 10


def test_a_tall_image_keeps_the_height_limit():
    (picture,) = page(pdf(f"- {image('Tall')}\n", images={SEA: sea(300, 3000)})).images
    assert picture["height"] == pytest.approx(230 * 72 / 25.4, abs=1)


def test_a_diagram_under_a_step_draws_with_its_alt_text():
    content = f"1. Step\n\n   ```mermaid\n{indented(FLOW)}   ```\n\n   After the diagram.\n"
    data = pdf(content, diagrams={FLOW: DRAWN})
    found = page(data)
    (picture,) = found.images
    assert picture["x0"] > 18 * 72 / 25.4 + 5
    assert picture["width"] == pytest.approx(300, abs=1)  # 400 CSS px is 300 pt.
    assert top_of(found, "Step") < picture["top"] < top_of(found, "After the diagram.")
    assert "flowchart" not in found.extract_text()
    assert alt_texts(data) == ["Flow: a to b"]


def test_unloaded_images_undrawn_diagrams_and_mixed_table_cells_keep_their_notes():
    content = (
        f"- {image('Gone', GONE)} and ![Web](https://example.com/x.png)\n"
        f"- Broken:\n\n  ```mermaid\n{indented(BROKEN, 2)}  ```\n\n"
        f"| A | B |\n| - | - |\n| Text and {image('Cell')} | x |\n"
    )
    found = page(pdf(content, diagrams={}))
    text = found.extract_text()
    assert found.images == []
    assert f"{IMAGE_NOT_INCLUDED}: Gone" in text and f"{IMAGE_NOT_INCLUDED}: Web" in text
    assert f"Text and [{IMAGE_NOT_INCLUDED}: Cell]" in text  # A cell is text or one image.
    assert DIAGRAM_NOT_DRAWN in text and "broken -->" in text
    assert "example.com" not in text


def test_without_diagrams_a_nested_fence_stays_code_without_a_note():
    text = page(pdf(f"- Step\n\n  ```mermaid\n{indented(FLOW, 2)}  ```\n")).extract_text()
    assert "flowchart LR" in text and DIAGRAM_NOT_DRAWN not in text


def test_no_other_image_source_ever_loads(tmp_path):
    secret = tmp_path / "secret.png"
    secret.write_bytes(png(10, 10))
    # Written into the Markdown: a path, a URL, a guess at the private source and raw HTML.
    content = f'![a]({secret}) ![b](https://example.com/x.png) ![c](asterism-export-0:0)\n\n<img src="{secret}">\n'
    assert page(pdf(content)).images == []
    # Handed straight to the renderer, an unknown source draws nothing either.
    document = FPDF()
    document.HTML2FPDF_CLASS = _export_html()
    document.add_page()
    document.set_font("helvetica", size=11)
    document.write_html(f'<p>x <img src="{secret}"></p>', pictures={})
    assert pdfplumber.open(io.BytesIO(bytes(document.output()))).pages[0].images == []
