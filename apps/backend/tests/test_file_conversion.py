"""Text extraction through MarkItDown for the formats whose parsers changed in US-95.3.

PDF text comes from pdfminer.six, which decrypts encrypted PDFs with
cryptography; HTML goes through beautifulsoup4 and markdownify. These run the
real converters, not doubles.
"""

from pathlib import Path

import pytest
from asterism.domains.files.convert_worker import convert
from fpdf import FPDF
from fpdf.enums import EncryptionMethod


def _pdf(path: Path, text: str, encryption: EncryptionMethod | None = None) -> Path:
    document = FPDF()
    document.add_page()
    document.set_font("helvetica", size=14)
    document.cell(text=text)
    if encryption is not None:
        # An owner password with an empty user password: readers open it
        # without asking, but the content streams are still encrypted.
        document.set_encryption(owner_password="owner-secret", encryption_method=encryption)
    document.output(str(path))
    return path


def test_extracts_text_from_a_pdf(tmp_path: Path) -> None:
    path = _pdf(tmp_path / "plain.pdf", "Quarterly revenue grew")

    assert "Quarterly revenue grew" in convert(path)


@pytest.mark.parametrize("method", [EncryptionMethod.AES_128, EncryptionMethod.AES_256])
def test_extracts_text_from_an_aes_encrypted_pdf(tmp_path: Path, method: EncryptionMethod) -> None:
    path = _pdf(tmp_path / f"{method.name.lower()}.pdf", "Encrypted findings", method)
    assert b"Encrypted findings" not in path.read_bytes()

    assert "Encrypted findings" in convert(path)


def test_converts_html_to_markdown(tmp_path: Path) -> None:
    path = tmp_path / "page.html"
    path.write_text(
        "<html><head><title>Notes</title><style>p{color:red}</style></head><body>"
        "<h1>Release notes</h1><p>Read the <a href='https://example.com/guide'>guide</a>.</p>"
        "<ul><li>First</li><li>Second</li></ul>"
        "</body></html>",
        encoding="utf-8",
    )

    markdown = convert(path)

    assert "# Release notes" in markdown
    assert "[guide](https://example.com/guide)" in markdown
    assert "* First" in markdown or "- First" in markdown
    assert "color:red" not in markdown
