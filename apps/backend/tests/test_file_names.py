"""US-116.2: file names lose control, format and text-direction characters."""

import pytest


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("report\u202efdp.exe.txt", "reportfdp.exe.txt"),
        ("a\u200bb\u2066c\u2069.pdf", "abc.pdf"),
        ("tab\there\x00.md", "tabhere.md"),
        ("bell\x07\x7f\x9b.csv", "bell.csv"),
        ("naïve résumé.docx", "naïve résumé.docx"),
    ],
)
def test_file_names_lose_control_and_direction_characters(raw, clean):
    """US-116.2."""
    from asterism.domains.files.service import sanitize_filename

    assert sanitize_filename(raw) == clean


def test_a_name_of_only_invisible_characters_is_refused():
    from asterism.core.exceptions import BadDataException
    from asterism.domains.files.service import sanitize_filename

    with pytest.raises(BadDataException):
        sanitize_filename("\u202e\u200b\x00")
