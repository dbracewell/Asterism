"""US-116.1: zip-based sources are bounded before conversion, and a timed-out converter stops."""

import asyncio
import os
import time
import zipfile
from pathlib import Path

import pytest
from asterism.domains.files import conversion
from asterism.domains.files.conversion import ArchiveTooLarge, check_archive, convert_file
from asterism.domains.files.preview import DOCX, document_counts


def _zip(path: Path, members: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return path


def test_member_count_and_uncompressed_size_are_limited(tmp_path, monkeypatch):
    many = _zip(tmp_path / "many.docx", {f"word/m{index}.xml": b"x" for index in range(6)})
    bomb = _zip(tmp_path / "bomb.epub", {"OEBPS/chapter.xhtml": b"\0" * 2_000_000})
    plain = tmp_path / "notes.txt"
    plain.write_text("not a zip")

    monkeypatch.setattr(conversion, "MAX_ARCHIVE_MEMBERS", 5)
    with pytest.raises(ArchiveTooLarge, match="too many members"):
        check_archive(many)
    monkeypatch.setattr(conversion, "MAX_ARCHIVE_UNCOMPRESSED_BYTES", 1_000_000)
    assert bomb.stat().st_size < 100_000
    with pytest.raises(ArchiveTooLarge, match="size limit"):
        check_archive(bomb)
    check_archive(plain)
    # Previews use the same check and show no counts for such a file.
    assert document_counts(many, DOCX) == {}


def _worker(tmp_path: Path, body: str) -> Path:
    script = tmp_path / "worker.py"
    script.write_text(f"import os, sys, time\n{body}\n")
    return script


@pytest.mark.asyncio
async def test_a_timed_out_conversion_kills_the_converter(tmp_path, monkeypatch):
    pid_file = tmp_path / "pid"
    monkeypatch.setattr(
        conversion,
        "_WORKER",
        _worker(tmp_path, f"open({str(pid_file)!r}, 'w').write(str(os.getpid())); time.sleep(60)"),
    )
    with pytest.raises(TimeoutError):
        await convert_file(tmp_path / "any.docx", timeout=2, max_chars=10)
    pid = int(pid_file.read_text())
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        await asyncio.sleep(0.05)
    else:
        pytest.fail("the converter is still running")


@pytest.mark.asyncio
async def test_the_converter_gets_no_secrets_and_its_failures_say_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("SYSTEM_KEY", "must-not-reach-the-converter")
    monkeypatch.setattr(conversion, "_WORKER", _worker(tmp_path, "sys.stdout.write(','.join(sorted(os.environ)))"))
    names = (await convert_file(tmp_path / "any", timeout=10, max_chars=10_000)).split(",")
    assert "SYSTEM_KEY" not in names
    assert set(names) <= set(conversion._WORKER_ENVIRONMENT) | {"__CF_USER_TEXT_ENCODING", "LC_CTYPE"}

    monkeypatch.setattr(conversion, "_WORKER", _worker(tmp_path, "sys.stderr.write('secret text'); sys.exit(3)"))
    with pytest.raises(conversion.ConversionFailed) as raised:
        await convert_file(tmp_path / "any", timeout=10, max_chars=10)
    assert "secret" not in str(raised.value)


@pytest.mark.asyncio
async def test_the_real_converter_returns_at_most_one_character_past_the_limit(tmp_path):
    page = tmp_path / "page.html"
    page.write_text("<p>" + "word " * 500 + "</p>", encoding="utf-8")
    text = await convert_file(page, timeout=60, max_chars=20)
    assert len(text) == 21 and text.startswith("word")
