"""Boundaries and invariants for the knowledge domain's processing policy.

The processing policy is owned end to end by the knowledge domain. These tests
pin the dependency direction that ownership implies, and the invariant the
reprocess set relies on.
"""

import ast
from pathlib import Path

import pytest
from asterism.domains.files.service import upload_files
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel
from asterism.domains.knowledge.processing import select_reprocess_targets
from sqlalchemy import select
from test_user_files import _upload
from test_user_files import file_session as _file_session

file_session = _file_session

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "asterism"
KNOWLEDGE_ROOT = BACKEND_ROOT / "domains" / "knowledge"
SETTINGS_ROOT = BACKEND_ROOT / "domains" / "settings"


def _imported_modules(path: Path) -> list[str]:
    """Return every module a file imports, including deferred function-local imports.

    Deferred imports count: a cross-domain import that hides inside a function
    still couples the two domains and still creates a cycle when it is
    unwrapped.
    """
    tree = ast.parse(path.read_text())
    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            modules.append(node.module or "")
        elif isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
    return modules


def test_settings_domain_does_not_import_knowledge():
    """The settings domain must not reach into the knowledge domain.

    The captioning-selection rule is knowledge-domain state, so the settings
    domain calls the guard it owns instead of importing the knowledge package.
    """
    for path in sorted(SETTINGS_ROOT.glob("*.py")):
        for module in _imported_modules(path):
            assert not module.startswith("asterism.domains.knowledge"), path


def test_knowledge_policy_modules_do_not_import_files():
    """The policy modules must not reach into the files domain.

    The processing policy owns the artifacts it creates, so it never needs the
    source-file tables. The remaining knowledge modules still read source
    files; EPIC-38 US-38.4 injects that reader instead.
    """
    for name in ("policy.py", "processing.py", "processing_schemas.py", "router.py"):
        path = KNOWLEDGE_ROOT / name
        for module in _imported_modules(path):
            assert not module.startswith("asterism.domains.files"), path


@pytest.mark.asyncio
async def test_every_uploaded_file_owns_a_knowledge_artifact(file_session):
    """The reprocess set is derived from artifacts, so uploads must create one.

    The policy transition derives the files it reprocesses from the knowledge
    domain's own artifact table. That is equivalent to the whole source
    library only while every uploaded file owns an artifact, which the upload
    path guarantees in the same transaction that creates the file.
    """
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("report.txt", b"first"), _upload("photo.png", b"\x89PNG\r\n\x1a\ncontent")],
        session=file_session,
    )

    artifacts = list(await file_session.scalars(select(FileKnowledgeArtifactModel)))
    assert {artifact.file_id for artifact in artifacts} == {file.id for file in uploaded.files}

    targets = await select_reprocess_targets(session=file_session)
    assert {target.file_id for target in targets} == {file.id for file in uploaded.files}
    assert {target.user_id for target in targets} == {"user-a"}
