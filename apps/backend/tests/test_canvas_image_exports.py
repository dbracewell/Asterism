"""US-107.3 (ADR-0083): chat images in canvas downloads.

The writer cases give ready-made images, so they need no database; the loader
and the routes run against a chat with real files.
"""

import io
import uuid
import zipfile

import docx
import pdfplumber
import pytest
from asterism.domains.canvas import downloads
from asterism.domains.canvas.exports import (
    IMAGE_NOT_INCLUDED,
    ExportImage,
    export_version,
    image_references,
)
from asterism.domains.files.produced import register_produced_file
from PIL import Image
from test_canvas_inline_files import canvas_document
from test_chat_file_scope import upload
from test_inline_file_resolution import accepted_run, token
from test_inline_file_resolution import produced as _produced
from test_projects_api import auth
from test_projects_api import project_api as _project_api

produced = _produced
project_api = _project_api

SEA = uuid.UUID("10000000-0000-4000-8000-000000000001")
ELSEWHERE = uuid.UUID("10000000-0000-4000-8000-000000000002")


def png(width: int = 300, height: int = 100, color: str = "#2a6f97", fmt: str = "PNG") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format=fmt)
    return buffer.getvalue()


def picture(width: int = 300, height: int = 100) -> ExportImage:
    data = png(width, height)
    return ExportImage(png=data, width=width, height=height, name="sea.png", original=data, extension="png")


DOCUMENT = f"""# Weather

Before the picture.

![The sea at dusk]({token(SEA)})

After the picture, with [the notes]({token(ELSEWHERE)}).

![Not loaded]({token(ELSEWHERE)}) and ![A web picture](https://example.com/x.png)

- In a list: ![The sea at dusk]({token(SEA)})

| Picture | Note |
| --- | --- |
| ![In a table]({token(SEA)}) | cell |

```markdown
![Kept as code]({token(SEA)})
```
"""


def export(fmt: str, images) -> bytes:
    return export_version(
        kind="document", language="", title="Weather", content=DOCUMENT, export=fmt, images=images
    ).content


def test_image_references_are_distinct_images_outside_code():
    assert image_references(DOCUMENT) == [SEA, ELSEWHERE]
    assert image_references("```\n![x](" + token(SEA) + ")\n```\n") == []


def test_docx_embeds_loaded_images_with_alt_text_and_notes_the_rest():
    document = docx.Document(io.BytesIO(export("docx", {SEA: picture()})))
    shapes = document.inline_shapes
    # The top-level paragraph, the list item and the table cell (US-109.3).
    assert len(shapes) == 3
    properties = shapes[0]._inline.docPr
    assert properties.get("title") == "sea.png"
    assert properties.get("descr") == "The sea at dusk"
    assert round(shapes[0].width.inches, 3) == 3.125  # 300 CSS px at 96 per inch.
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert f"{IMAGE_NOT_INCLUDED}: Not loaded" in text
    assert f"{IMAGE_NOT_INCLUDED}: A web picture" in text
    assert "asterism-file:" not in text.split("![Kept as code]")[0]
    assert "with the notes." in text
    assert "https://example.com/x.png" not in text
    cell = document.tables[0].cell(1, 0)
    (shape,) = cell._element.xpath(".//wp:docPr")
    assert shape.get("descr") == "In a table"
    assert IMAGE_NOT_INCLUDED not in cell.text


def test_docx_fits_wide_and_tall_images_to_the_page():
    wide = docx.Document(io.BytesIO(export("docx", {SEA: picture(3000, 100)})))
    assert round(wide.inline_shapes[0].width.inches, 2) == 6.5
    tall = docx.Document(io.BytesIO(export("docx", {SEA: picture(300, 3000)})))
    assert round(tall.inline_shapes[0].height.inches, 2) == 8.0


def test_pdf_places_top_level_images_between_the_text():
    data = export("pdf", {SEA: picture()})
    pages = pdfplumber.open(io.BytesIO(data)).pages
    page = pages[0]
    # The top-level paragraph's image, the list item's (US-109.2) and the
    # table cell's (US-109.3).
    assert len(page.images) == 3
    image = min(page.images, key=lambda item: item["top"])
    before = page.search("Before the picture.")[0]
    after = page.search("After the picture")[0]
    assert before["bottom"] <= image["top"] and image["bottom"] <= after["top"]
    assert image["width"] == pytest.approx(225, abs=1)  # 300 CSS px is 225 pt.
    text = "\n".join(p.extract_text() or "" for p in pages)
    assert f"{IMAGE_NOT_INCLUDED}: Not loaded" in text
    assert f"{IMAGE_NOT_INCLUDED}: The sea at dusk" not in text
    assert IMAGE_NOT_INCLUDED + ": In a table" not in text
    assert b"/Alt" in data


def test_pdf_without_images_writes_notes_and_fetches_nothing():
    data = export("pdf", None)
    assert b"asterism-file" not in data
    text = "\n".join(p.extract_text() or "" for p in pdfplumber.open(io.BytesIO(data)).pages)
    assert f"{IMAGE_NOT_INCLUDED}: The sea at dusk" in text
    assert f"{IMAGE_NOT_INCLUDED}: A web picture" in text
    assert pdfplumber.open(io.BytesIO(export("pdf", None))).pages[0].images == []


def test_markdown_and_text_write_descriptions_but_keep_code():
    for fmt in ("md", "txt"):
        text = export(fmt, {}).decode()
        assert f"[{IMAGE_NOT_INCLUDED}: The sea at dusk]" in text
        assert "with the notes." in text
        assert text.count("asterism-file:") == 1  # Only inside the code fence.
        assert f"![Kept as code]({token(SEA)})" in text
        assert "![A web picture](https://example.com/x.png)" in text


def test_without_images_markdown_keeps_the_stored_text():
    # Download my data and other callers that pass no images.
    assert export("md", None).decode() == DOCUMENT


# --- Loading and the routes ------------------------------------------------


pytestmark_db = pytest.mark.asyncio


async def chat_with_images(p):
    chat_id, request_id, execution, scope = await accepted_run(p)
    sea = await register_produced_file(scope, tool="generate_image", name="sea.png", content=png())
    gif = await register_produced_file(scope, tool="generate_image", name="moving.gif", content=png(fmt="GIF"))
    svg = await register_produced_file(
        scope,
        tool="t",
        name="drawing.svg",
        content=b'<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>',
    )
    broken = await register_produced_file(scope, tool="t", name="broken.png", content=png()[:40])
    foreign = await upload(p.client, "foreign.txt", "b")
    _, _, _, other_scope = await accepted_run(p)
    elsewhere = await register_produced_file(other_scope, tool="generate_image", name="other.png", content=png())
    return (
        chat_id,
        request_id,
        execution,
        {
            "sea": sea.file_id,
            "gif": gif.file_id,
            "svg": svg.file_id,
            "broken": broken.file_id,
            "foreign": uuid.UUID(foreign["id"]),
            "elsewhere": elsewhere.file_id,
        },
    )


@pytestmark_db
async def test_only_scoped_raster_images_load(produced):
    p = produced
    chat_id, _, _, ids = await chat_with_images(p)
    content = "\n\n".join(f"![{name}]({token(file_id)})" for name, file_id in ids.items())
    async with p.sessions() as session:
        images = await downloads.load_export_images("a", chat_id, [content], session)
    assert set(images) == {ids["sea"], ids["gif"]}
    assert images[ids["sea"]].name == "sea.png" and (images[ids["sea"]].width, images[ids["sea"]].height) == (300, 100)
    # A GIF is embedded as PNG and kept as itself for the ZIP.
    assert images[ids["gif"]].png[1:4] == b"PNG" and images[ids["gif"]].extension == "gif"
    assert images[ids["gif"]].original[:3] == b"GIF"


@pytestmark_db
async def test_image_limits(produced, monkeypatch):
    p = produced
    chat_id, _, _, ids = await chat_with_images(p)
    content = f"![a]({token(ids['sea'])}) ![b]({token(ids['gif'])})"
    monkeypatch.setattr(downloads, "MAX_EXPORT_IMAGES", 1)
    async with p.sessions() as session:
        assert set(await downloads.load_export_images("a", chat_id, [content], session)) == {ids["sea"]}
    monkeypatch.setattr(downloads, "MAX_EXPORT_IMAGES", 32)
    monkeypatch.setattr(downloads, "MAX_EXPORT_IMAGE_PIXELS", 100)
    async with p.sessions() as session:
        assert await downloads.load_export_images("a", chat_id, [content], session) == {}
    monkeypatch.setattr(downloads, "MAX_EXPORT_IMAGE_PIXELS", 40_000_000)
    monkeypatch.setattr(downloads, "MAX_EXPORT_IMAGE_BYTES", 10)
    async with p.sessions() as session:
        assert await downloads.load_export_images("a", chat_id, [content], session) == {}


@pytestmark_db
async def test_downloads_carry_the_chats_images(produced, monkeypatch):
    p = produced
    chat_id, request_id, execution, ids = await chat_with_images(p)
    content = (
        f"# Sea\n\n![The sea]({token(ids['sea'])})\n\n"
        f"![Someone else's]({token(ids['elsewhere'])}) and [notes]({token(ids['foreign'])})\n"
    )
    item_id = await canvas_document(p, chat_id, request_id, execution, content)
    base = f"/chat/{chat_id}/canvas/{item_id}/versions/1/export?format="

    word = await p.client.get(base + "docx", headers=auth())
    assert word.status_code == 200, word.text
    document = docx.Document(io.BytesIO(word.content))
    assert len(document.inline_shapes) == 1
    assert document.inline_shapes[0]._inline.docPr.get("descr") == "The sea"
    assert f"{IMAGE_NOT_INCLUDED}: Someone else's" in "\n".join(par.text for par in document.paragraphs)

    pdf = await p.client.get(base + "pdf", headers=auth())
    assert len(pdfplumber.open(io.BytesIO(pdf.content)).pages[0].images) == 1

    markdown = (await p.client.get(base + "md", headers=auth())).text
    assert f"[{IMAGE_NOT_INCLUDED}: The sea]" in markdown and "asterism-file:" not in markdown
    assert "and notes" in markdown

    archive = zipfile.ZipFile(
        io.BytesIO((await p.client.get(f"/chat/{chat_id}/canvas/export", headers=auth())).content)
    )
    assert sorted(archive.namelist()) == ["Weather.md", "images/sea.png"]
    zipped = archive.read("Weather.md").decode()
    assert "![The sea](images/sea.png)" in zipped
    assert f"[{IMAGE_NOT_INCLUDED}: Someone else's]" in zipped and "asterism-file:" not in zipped
    assert archive.read("images/sea.png") == png()

    # Another user gets nothing, as before.
    assert (await p.client.get(base + "docx", headers=auth("b"))).status_code == 404
