"""US-109.3: images in table cells in PDF and Word downloads, and formatted
cells that PDF used to refuse.

The writers get ready-made images, so these need no database.
"""

import io
import re
import uuid

import docx
import pdfplumber
import pytest
from asterism.domains.canvas.exports import IMAGE_NOT_INCLUDED, ExportImage, markdown_docx, markdown_pdf
from PIL import Image

SEA = uuid.UUID("10930000-0000-4000-8000-000000000001")
WIDE = uuid.UUID("10930000-0000-4000-8000-000000000002")
GONE = uuid.UUID("10930000-0000-4000-8000-000000000003")
PT_PER_PX = 72 / 96


def picture(width: int, height: int, name: str) -> ExportImage:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "#2a6f97").save(buffer, format="PNG")
    data = buffer.getvalue()
    return ExportImage(png=data, width=width, height=height, name=name, original=data, extension="png")


IMAGES = {SEA: picture(120, 60, "sea.png"), WIDE: picture(3000, 300, "wide.png")}


def image(alt: str, file_id: uuid.UUID = SEA) -> str:
    return f"![{alt}](asterism-file:{file_id})"


TABLE = f"""Before the table.

| Picture | Note |
| --- | --- |
| {image("Small sea")} | small |
| {image("Wide sea", WIDE)} | wide |
| Text and {image("Mixed")} | mixed |
| {image("Gone", GONE)} | gone |
| **Bold** and `code` and [a link](https://example.com) | formatted |

After the table.
"""


def alt_texts(data: bytes) -> list[str]:
    return [match.decode() for match in re.findall(rb"/Alt \(([^)]*)\)", data)]


def test_pdf_draws_a_cell_that_is_one_image_with_its_alt_text_once():
    data = markdown_pdf("Table", TABLE, None, IMAGES)
    page = pdfplumber.open(io.BytesIO(data)).pages[0]
    small, wide = sorted(page.images, key=lambda item: item["top"])
    # Natural size when it fits; the column's width when it doesn't.
    assert small["width"] == pytest.approx(120 * PT_PER_PX, abs=0.5)
    column = page.search("small")[0]["x0"] - small["x0"]
    assert wide["width"] < 3000 * PT_PER_PX and wide["width"] <= column
    assert page.search("Before the table.")[0]["bottom"] < small["top"] < wide["top"]
    assert wide["bottom"] < page.search("After the table.")[0]["top"]
    # fpdf2 lays a table out twice; the alt text is recorded once per picture.
    assert alt_texts(data) == ["Small sea", "Wide sea"]


def test_pdf_writes_other_cells_as_plain_text_with_notes():
    text = pdfplumber.open(io.BytesIO(markdown_pdf("Table", TABLE, None, IMAGES))).pages[0].extract_text()
    assert f"Text and [{IMAGE_NOT_INCLUDED}: Mixed]" in text
    assert f"[{IMAGE_NOT_INCLUDED}: Gone]" in text
    # Formatting in a cell used to stop the PDF being made at all.
    assert "Bold and code and a link" in text
    assert "example.com" not in text


@pytest.mark.parametrize(
    "cell", ["**bold** and text", "plain `code`", "[link](https://example.com) text", "*a* **b** `c`"]
)
def test_pdf_accepts_any_formatting_in_a_cell(cell):
    data = markdown_pdf("Table", f"| A |\n| - |\n| {cell} |\n", None, {})
    assert pdfplumber.open(io.BytesIO(data)).pages[0].extract_text()


def test_a_table_without_pictures_keeps_its_layout():
    plain = "| A | B |\n| - | - |\n| one | two |\n"
    assert b"cellpadding" not in markdown_pdf("Table", plain, None, {})
    words = pdfplumber.open(io.BytesIO(markdown_pdf("Table", plain, None, {}))).pages[0].extract_words()
    assert [word["text"] for word in words] == ["A", "B", "one", "two"]


def test_docx_puts_pictures_in_cells_fitted_to_the_column_with_text_around_them():
    document = docx.Document(io.BytesIO(markdown_docx("Table", TABLE, None, IMAGES)))
    grid = document.tables[0]
    columns = 2
    shapes = {row: grid.cell(row, 0)._element.xpath(".//wp:docPr") for row in range(1, 6)}
    assert [shape.get("descr") for shape in shapes[1]] == ["Small sea"]
    assert [shape.get("descr") for shape in shapes[2]] == ["Wide sea"]
    assert [shape.get("descr") for shape in shapes[3]] == ["Mixed"]
    assert shapes[4] == [] and grid.cell(4, 0).text == f"{IMAGE_NOT_INCLUDED}: Gone"
    assert grid.cell(3, 0).text.startswith("Text and")
    widths = [shape.width.inches for shape in document.inline_shapes]
    assert widths[0] == pytest.approx(120 / 96, abs=0.01)
    assert widths[1] <= 6.5 / columns
    formatted = grid.cell(5, 0).paragraphs[0]
    assert formatted.text == "Bold and code and a link (https://example.com)"
    assert [run.bold for run in formatted.runs if run.text == "Bold"] == [True]
    assert all(run.bold for run in grid.cell(0, 0).paragraphs[0].runs)


def test_a_picture_in_a_table_with_many_columns_keeps_a_positive_width():
    """US-117.3: 44 columns used to give a negative picture width."""
    columns = 50
    header = "| " + " | ".join(f"C{index}" for index in range(columns)) + " |"
    rule = "| " + " | ".join("-" for _ in range(columns)) + " |"
    row = "| " + image("Wide sea", WIDE) + " | " + " | ".join("x" for _ in range(columns - 1)) + " |"
    document = docx.Document(io.BytesIO(markdown_docx("Table", f"{header}\n{rule}\n{row}\n", None, IMAGES)))
    [shape] = document.inline_shapes
    assert shape.width.inches == pytest.approx(0.25, abs=0.01)


def test_zip_names_keep_their_folder_when_made_unique():
    """US-117.3."""
    import zipfile

    from asterism.domains.canvas.exports import ExportedFile, zip_exports

    files = [
        ExportedFile(filename=name, media_type="text/markdown", content=b"x")
        for name in ("notes/a.md", "notes/A.md", "a.md", "notes/a.md")
    ]
    names = zipfile.ZipFile(io.BytesIO(zip_exports(files))).namelist()
    # Names compare without case, so the second "notes/a.md" is the third of its kind.
    assert names == ["notes/a.md", "notes/A (2).md", "a.md", "notes/a (3).md"]
