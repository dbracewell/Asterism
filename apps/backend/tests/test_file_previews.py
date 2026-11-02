"""US-56.5: scoped document previews: excerpts and page/slide/sheet counts."""

import io
import uuid
import zipfile

import pypdfium2
import pytest
from asterism.domains.files.preview import MAX_PREVIEW_CHARS, document_counts
from asterism.domains.files.produced import register_produced_file
from test_produced_files import produced as _produced
from test_produced_files import run
from test_projects_api import auth
from test_projects_api import project_api as _project_api

produced = _produced
project_api = _project_api

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def docx(text: str, pages: int | None = 3) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.'
            'wordprocessingml.document.main+xml"/></Types>',
        )
        archive.writestr(
            "_rels/.rels",
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
            'officeDocument" Target="word/document.xml"/></Relationships>',
        )
        archive.writestr(
            "word/document.xml",
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>",
        )
        if pages is not None:
            archive.writestr(
                "docProps/app.xml",
                '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/'
                f'extended-properties"><Pages>{pages}</Pages></Properties>',
            )
    return buffer.getvalue()


def pptx(slides: int) -> bytes:
    from pptx import Presentation

    deck = Presentation()
    for index in range(slides):
        slide = deck.slides.add_slide(deck.slide_layouts[1])
        slide.shapes.title.text = f"Slide title {index + 1}"
    buffer = io.BytesIO()
    deck.save(buffer)
    return buffer.getvalue()


def xlsx(sheets: int) -> bytes:
    from openpyxl import Workbook

    book = Workbook()
    book.active["A1"] = "Revenue"
    for index in range(1, sheets):
        book.create_sheet(f"Extra {index}")["A1"] = index
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def pdf(pages: int) -> bytes:
    document = pypdfium2.PdfDocument.new()
    for _ in range(pages):
        document.new_page(200, 200)
    buffer = io.BytesIO()
    document.save(buffer)
    document.close()
    return buffer.getvalue()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("name", "content", "mime", "counts", "excerpt"),
    [
        ("report.docx", docx("Quarterly findings"), DOCX, {"page_count": 3}, "Quarterly findings"),
        ("deck.pptx", pptx(4), PPTX, {"slide_count": 4}, "Slide title 1"),
        ("book.xlsx", xlsx(2), XLSX, {"sheet_count": 2}, "Revenue"),
        ("paper.pdf", pdf(5), "application/pdf", {"page_count": 5}, None),
        ("notes.md", b"# Notes\n\nSome **text**.", "text/markdown", {}, "# Notes"),
    ],
)
async def test_preview_for_each_supported_type(produced, name, content, mime, counts, excerpt):
    p = produced
    _, scope_ = await run(p)
    file = await register_produced_file(scope_, tool="t", name=name, content=content)
    assert file.mime_type == mime
    response = await p.client.get(f"/chat/{scope_.chat_id}/files/{file.file_id}/preview", headers=auth())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mime_type"] == mime and body["truncated"] is False
    for key in ("page_count", "slide_count", "sheet_count"):
        assert body[key] == counts.get(key)
    if excerpt is None:
        assert not body["excerpt"]
    else:
        assert excerpt in body["excerpt"]


@pytest.mark.asyncio
async def test_long_text_is_truncated_and_images_have_no_excerpt(produced):
    p = produced
    _, scope_ = await run(p)
    long = await register_produced_file(scope_, tool="t", name="long.txt", content=b"x" * (MAX_PREVIEW_CHARS + 10))
    body = (await p.client.get(f"/chat/{scope_.chat_id}/files/{long.file_id}/preview", headers=auth())).json()
    assert len(body["excerpt"]) == MAX_PREVIEW_CHARS and body["truncated"] is True

    from test_produced_files import PNG

    image = await register_produced_file(scope_, tool="t", name="chart.png", content=PNG)
    body = (await p.client.get(f"/chat/{scope_.chat_id}/files/{image.file_id}/preview", headers=auth())).json()
    assert body["kind"] == "image" and body["excerpt"] is None


@pytest.mark.asyncio
async def test_preview_shares_the_scoped_404(produced):
    p = produced
    _, scope_ = await run(p)
    _, other = await run(p)
    file = await register_produced_file(scope_, tool="t", name="secret.txt", content=b"secret")
    responses = [
        await p.client.get(f"/chat/{other.chat_id}/files/{file.file_id}/preview", headers=auth()),
        await p.client.get(f"/chat/{scope_.chat_id}/files/{uuid.uuid4()}/preview", headers=auth()),
        await p.client.get(f"/chat/{scope_.chat_id}/files/{file.file_id}/preview", headers=auth("b")),
    ]
    assert {(r.status_code, r.content) for r in responses[:2]} == {(404, responses[0].content)}
    assert responses[2].status_code == 404
    assert b"secret" not in b"".join(r.content for r in responses)


def test_counts_tolerate_malformed_sources(tmp_path):
    broken = tmp_path / "broken"
    broken.write_bytes(b"not a document")
    for mime in ("application/pdf", DOCX, PPTX, XLSX):
        assert document_counts(broken, mime) == {}
    plain = tmp_path / "plain.docx"
    plain.write_bytes(docx("No properties", pages=None))
    assert document_counts(plain, DOCX) == {}
