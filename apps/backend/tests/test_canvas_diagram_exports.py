"""US-105.3 (ADR-0082): drawn diagrams in canvas DOCX and PDF exports.

These cases give the writers ready-made pictures, so they need no browser; the
renderer itself is covered in test_canvas_diagrams.py.
"""

import io

import docx
import pdfplumber
import pytest
from asterism.domains.canvas import downloads
from asterism.domains.canvas.diagrams import DrawnDiagram
from asterism.domains.canvas.exports import DIAGRAM_NOT_DRAWN, export_version, mermaid_sources
from PIL import Image

WATER = "flowchart LR\n  accTitle: Water cycle\n  sea --> cloud --> rain --> sea\n"
DOCUMENT = f"""# Weather

Before the diagram.

```mermaid
{WATER}```

```python
print("code stays code")
```

After the diagram.
"""


def picture(width: int = 300, height: int = 100) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width * 2, height * 2), "#e9edf6").save(buffer, format="PNG")
    return buffer.getvalue()


DRAWN = DrawnDiagram(
    png=picture(),
    width=300,
    height=100,
    label="Water cycle",
    description="Water evaporates, condenses into clouds and falls as rain.",
)
ALT = "Water cycle: Water evaporates, condenses into clouds and falls as rain."


def export(fmt: str, diagrams) -> bytes:
    return export_version(
        kind="document", language="", title="Weather", content=DOCUMENT, export=fmt, diagrams=diagrams
    ).content


def docx_text(data: bytes) -> list[str]:
    return [paragraph.text for paragraph in docx.Document(io.BytesIO(data)).paragraphs]


def pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() or "" for page in pdfplumber.open(io.BytesIO(data)).pages)


def test_mermaid_sources_are_the_distinct_mermaid_fences_in_order():
    content = (
        "```mermaid\nflowchart LR\n  a --> b\n```\n\n"
        "```Mermaid title\nsequenceDiagram\n  a->>b: hi\n```\n\n"
        "```mermaid\nflowchart LR\n  a --> b\n```\n\n"
        "```mermaid\n\n```\n\n"
        "```python\nprint(1)\n```\n\n"
        '- in a list\n\n  ```mermaid\n  pie\n    "a": 1\n  ```\n'
    )
    assert mermaid_sources(content) == [
        "flowchart LR\n  a --> b\n",
        "sequenceDiagram\n  a->>b: hi\n",
        'pie\n  "a": 1\n',
    ]


def test_docx_shows_a_drawn_diagram_as_a_picture_with_alt_text():
    document = docx.Document(io.BytesIO(export("docx", {WATER: DRAWN})))
    shapes = document.inline_shapes
    assert len(shapes) == 1
    properties = shapes[0]._inline.docPr
    assert properties.get("title") == "Water cycle"
    assert properties.get("descr") == ALT
    # 300 CSS px at 96 per inch.
    assert round(shapes[0].width.inches, 3) == 3.125
    text = [paragraph.text for paragraph in document.paragraphs]
    assert "flowchart LR" not in "\n".join(text)
    assert DIAGRAM_NOT_DRAWN not in text
    assert 'print("code stays code")' in text
    assert "Before the diagram." in text and "After the diagram." in text


def test_docx_fits_a_wide_diagram_to_the_page():
    wide = DrawnDiagram(png=picture(2000, 100), width=2000, height=100, label="Wide", description=None)
    document = docx.Document(io.BytesIO(export("docx", {WATER: wide})))
    assert round(document.inline_shapes[0].width.inches, 2) == 6.5
    assert document.inline_shapes[0]._inline.docPr.get("descr") == "Wide"


def test_docx_writes_an_undrawn_diagram_as_code_with_a_note():
    text = docx_text(export("docx", {WATER: None}))
    note = text.index(DIAGRAM_NOT_DRAWN)
    assert text[note + 1] == WATER.rstrip("\n")
    assert docx.Document(io.BytesIO(export("docx", {}))).inline_shapes.__len__() == 0


def test_docx_without_diagrams_keeps_every_fence_as_code_and_adds_no_note():
    text = docx_text(export("docx", None))
    assert DIAGRAM_NOT_DRAWN not in text
    assert WATER.rstrip("\n") in text


def test_pdf_shows_a_drawn_diagram_as_an_image_with_alt_text():
    data = export("pdf", {WATER: DRAWN})
    page = pdfplumber.open(io.BytesIO(data)).pages[0]
    assert len(page.images) == 1
    text = page.extract_text()
    assert "flowchart" not in text and DIAGRAM_NOT_DRAWN not in text
    assert "Before the diagram." in text and "After the diagram." in text
    assert 'print("code stays code")' in text
    # The text comes before the picture, and the picture before the rest.
    image = page.images[0]
    before = page.search("Before the diagram.")[0]
    after = page.search("After the diagram.")[0]
    assert before["bottom"] <= image["top"] and image["bottom"] <= after["top"]
    # 300 CSS px is 79.4 mm, 225 pt.
    assert image["width"] == pytest.approx(225, abs=1)
    assert b"/Alt" in data


def test_pdf_writes_an_undrawn_diagram_as_code_with_a_note():
    text = pdf_text(export("pdf", {WATER: None}))
    assert DIAGRAM_NOT_DRAWN in text and "flowchart LR" in text
    assert pdfplumber.open(io.BytesIO(export("pdf", {WATER: None}))).pages[0].images == []


def test_pdf_without_diagrams_is_unchanged():
    text = pdf_text(export("pdf", None))
    assert "flowchart LR" in text and DIAGRAM_NOT_DRAWN not in text


def test_markdown_and_text_keep_the_source():
    for fmt in ("md", "txt"):
        assert export(fmt, {WATER: DRAWN}).decode() == DOCUMENT


@pytest.mark.asyncio
async def test_an_export_draws_at_most_30_diagrams_within_60_seconds(monkeypatch):
    calls = []

    async def fake(sources, *, deadline_seconds):
        calls.append((list(sources), deadline_seconds))
        return [None] * len(sources)

    monkeypatch.setattr("asterism.domains.canvas.diagrams.draw_diagrams", fake)
    content = "\n\n".join(f"```mermaid\nflowchart LR\n  a{n} --> b\n```" for n in range(35))
    drawn = await downloads.draw_export_diagrams(content)
    ((sources, deadline),) = calls
    assert len(sources) == 30 and deadline == 60
    assert set(drawn) == set(sources)
    # The five over the cap get no entry, so they export as code with the note.
    exported = export_version(kind="document", language="", title="Many", content=content, export="pdf", diagrams=drawn)
    text = pdf_text(exported.content)
    assert text.count(DIAGRAM_NOT_DRAWN) == 35
    assert await downloads.draw_export_diagrams("# No diagrams") == {}
    assert len(calls) == 1
