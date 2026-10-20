"""Database-only project invariants, with the production SQLite FK policy."""

import ast
import uuid
from pathlib import Path

import pytest
from asterism.db.database import set_sqlite_pragma
from asterism.db.model_registry import Base
from asterism.domains.extraction.models import FileExtractionModel
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.projects.models import ProjectFileModel, ProjectModel
from asterism.domains.user.models import UserModel
from sqlalchemy import create_engine, delete, event, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


@pytest.fixture
def project_session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'projects.db'}")
    event.listen(engine, "connect", set_sqlite_pragma)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        session.add_all([UserModel(id="a"), UserModel(id="b")])
        session.commit()
        yield session
    engine.dispose()


def seed(session):
    project = ProjectModel(user_id="a", name="Project")
    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="a",
        filename="source.txt",
        original_name="source.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="a" * 64,
    )
    session.add_all([project, file])
    session.commit()
    return project, file


def test_project_defaults_and_owner_scoped_names(project_session):
    project, _ = seed(project_session)
    assert (project.description, project.system_prompt, project.context_revision) == ("", "", 1)
    assert project.created_at > 0 and project.updated_at > 0
    project_session.add(ProjectModel(user_id="b", name=project.name))
    project_session.commit()
    project_session.add(ProjectModel(user_id="a", name=project.name))
    with pytest.raises(IntegrityError):
        project_session.commit()
    project_session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 256},
        {"name": None},
        {"context_revision": 0},
        {"context_revision": None},
        {"description": None},
        {"system_prompt": None},
        {"user_id": "missing"},
    ],
)
def test_invalid_project_writes_are_rejected(project_session, changes):
    project, _ = seed(project_session)
    with pytest.raises(IntegrityError):
        project_session.execute(update(ProjectModel).where(ProjectModel.id == project.id).values(**changes))
        project_session.commit()
    project_session.rollback()


@pytest.mark.parametrize(
    "owner,foreign_project,foreign_file",
    [
        ("a", False, True),
        ("a", True, False),
        ("b", False, False),
        ("b", True, False),
        ("b", False, True),
    ],
)
def test_memberships_reject_cross_owner_links(project_session, owner, foreign_project, foreign_file):
    project, file = seed(project_session)
    other_project = ProjectModel(user_id="b", name="Other")
    other_file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="b",
        filename="other.txt",
        original_name="other.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="b" * 64,
    )
    project_session.add_all([other_project, other_file])
    project_session.commit()
    project_session.add(
        ProjectFileModel(
            project_id=other_project.id if foreign_project else project.id,
            file_id=other_file.id if foreign_file else file.id,
            user_id=owner,
        )
    )
    with pytest.raises(IntegrityError):
        project_session.commit()
    project_session.rollback()


@pytest.mark.parametrize("missing", ["project", "file", "owner"])
def test_memberships_reject_missing_references(project_session, missing):
    project, file = seed(project_session)
    project_session.add(
        ProjectFileModel(
            project_id=uuid.uuid4() if missing == "project" else project.id,
            file_id=uuid.uuid4() if missing == "file" else file.id,
            user_id=None if missing == "owner" else "a",
        )
    )
    with pytest.raises(IntegrityError):
        project_session.commit()
    project_session.rollback()


def test_duplicate_membership_is_rejected(project_session):
    project, file = seed(project_session)
    project_session.add(ProjectFileModel(project_id=project.id, file_id=file.id, user_id="a"))
    project_session.commit()
    project_session.add(ProjectFileModel(project_id=project.id, file_id=file.id, user_id="a"))
    with pytest.raises(IntegrityError):
        project_session.commit()
    project_session.rollback()


def test_shared_file_and_generations_survive_membership_and_project_deletion(project_session):
    project, file = seed(project_session)
    other = ProjectModel(user_id="a", name="Other")
    project_session.add(other)
    project_session.flush()
    project_session.add_all(
        [
            ProjectFileModel(project_id=project.id, file_id=file.id, user_id="a"),
            ProjectFileModel(project_id=other.id, file_id=file.id, user_id="a"),
            FileExtractionModel(
                user_id="a",
                file_id=file.id,
                generation=1,
                processing_profile_generation=1,
                processing_profile_identity="a" * 64,
            ),
            FileExtractionModel(
                user_id="a",
                file_id=file.id,
                generation=2,
                processing_profile_generation=1,
                processing_profile_identity="a" * 64,
            ),
        ]
    )
    project_session.commit()
    project_session.execute(delete(ProjectFileModel).where(ProjectFileModel.project_id == project.id))
    project_session.commit()
    assert len(project_session.scalars(select(ProjectFileModel)).all()) == 1
    project_session.execute(delete(ProjectModel).where(ProjectModel.id == other.id))
    project_session.commit()
    assert project_session.scalars(select(ProjectFileModel)).all() == []
    assert project_session.get(UserFileModel, file.id) is not None
    assert len(project_session.scalars(select(FileExtractionModel)).all()) == 2


@pytest.mark.parametrize("target", ["file", "user"])
def test_source_and_owner_deletion_cascade_memberships(project_session, target):
    project, file = seed(project_session)
    project_session.add(ProjectFileModel(project_id=project.id, file_id=file.id, user_id="a"))
    project_session.commit()
    statement = (
        delete(UserFileModel).where(UserFileModel.id == file.id)
        if target == "file"
        else delete(UserModel).where(UserModel.id == "a")
    )
    project_session.execute(statement)
    project_session.commit()
    assert project_session.scalars(select(ProjectFileModel)).all() == []
    if target == "file":
        assert project_session.get(ProjectModel, project.id) is not None
    else:
        assert project_session.scalars(select(ProjectModel)).all() == []


def test_extraction_has_no_project_or_chat_model_imports():
    extraction = Path(__file__).parents[1] / "asterism" / "domains" / "extraction"
    forbidden = ("asterism.domains.projects", "asterism.domains.chat", "asterism.db.model_registry")

    def is_forbidden(module):
        return any(module == name or module.startswith(name + ".") for name in forbidden)

    for path in extraction.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.ImportFrom):
                assert not is_forbidden(node.module or ""), path
            elif isinstance(node, ast.Import):
                assert all(not is_forbidden(alias.name) for alias in node.names), path


@pytest.mark.parametrize("target", ["project", "file", "membership"])
def test_owner_updates_cannot_break_existing_memberships(project_session, target):
    project, file = seed(project_session)
    project_session.add(ProjectFileModel(project_id=project.id, file_id=file.id, user_id="a"))
    project_session.commit()
    if target == "project":
        statement = update(ProjectModel).where(ProjectModel.id == project.id)
    elif target == "file":
        statement = update(UserFileModel).where(UserFileModel.id == file.id)
    else:
        statement = update(ProjectFileModel).where(ProjectFileModel.project_id == project.id)
    with pytest.raises(IntegrityError):
        project_session.execute(statement.values(user_id="b"))
        project_session.commit()
    project_session.rollback()
