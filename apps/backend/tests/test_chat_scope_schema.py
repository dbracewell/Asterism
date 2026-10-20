import uuid

import pytest
import pytest_asyncio
from asterism.db.database import set_sqlite_pragma
from asterism.db.model_registry import Base
from asterism.domains.chat.models import ChatFileModel, ChatModel, MessageModel
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.projects.models import ProjectModel
from asterism.domains.user.models import UserModel
from sqlalchemy import delete, event, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def schema_session(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'scopes.db'}")
    event.listen(engine.sync_engine, "connect", set_sqlite_pragma)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="a"), UserModel(id="b")])
        await session.commit()
        yield session
    await engine.dispose()


async def seed(session):
    projects = [ProjectModel(user_id=user, name=user) for user in ("a", "b")]
    files = [
        UserFileModel(
            user_id=user,
            filename="source.txt",
            original_name="source.txt",
            storage_key=str(uuid.uuid4()),
            size=1,
            mime_type="text/plain",
            kind=FileKind.TEXT,
            sha256="a" * 64,
        )
        for user in ("a", "b")
    ]
    session.add_all([*projects, *files])
    await session.flush()
    chats = [
        ChatModel(user_id="a", project_id=projects[0].id),
        ChatModel(user_id="b", project_id=projects[1].id),
        ChatModel(user_id="a"),
    ]
    session.add_all(chats)
    await session.flush()
    messages = [MessageModel(user_id=chat.user_id, chat_id=chat.id, role="user", content="root") for chat in chats]
    session.add_all(messages)
    await session.commit()
    return projects, files, chats, messages


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        "project_owner",
        "file_owner",
        "chat_owner",
        "membership_owner",
        "message_owner",
        "parent_other_chat",
        "parent_foreign",
        "active_child_other_chat",
        "active_child_foreign",
    ],
)
async def test_db_rejects_foreign_owners_and_cross_chat_message_edges(schema_session, case):
    projects, files, chats, messages = await seed(schema_session)
    statements = {
        "project_owner": update(ChatModel).where(ChatModel.id == chats[0].id).values(project_id=projects[1].id),
        "file_owner": ChatFileModel(chat_id=chats[0].id, file_id=files[1].id, user_id="a"),
        "chat_owner": ChatFileModel(chat_id=chats[1].id, file_id=files[0].id, user_id="a"),
        "membership_owner": ChatFileModel(chat_id=chats[0].id, file_id=files[0].id, user_id="b"),
        "message_owner": MessageModel(chat_id=chats[0].id, user_id="b", role="user", content="foreign"),
        "parent_other_chat": update(MessageModel)
        .where(MessageModel.id == messages[0].id)
        .values(parent_message_id=messages[2].id),
        "parent_foreign": update(MessageModel)
        .where(MessageModel.id == messages[0].id)
        .values(parent_message_id=messages[1].id),
        "active_child_other_chat": update(MessageModel)
        .where(MessageModel.id == messages[0].id)
        .values(active_child_id=messages[2].id),
        "active_child_foreign": update(MessageModel)
        .where(MessageModel.id == messages[0].id)
        .values(active_child_id=messages[1].id),
    }
    with pytest.raises(IntegrityError):
        statement = statements[case]
        if isinstance(statement, (ChatFileModel, MessageModel)):
            schema_session.add(statement)
        else:
            await schema_session.execute(statement)
        await schema_session.commit()
    await schema_session.rollback()


@pytest.mark.asyncio
async def test_memberships_are_unique_and_parent_owner_changes_are_rejected(schema_session):
    _, files, chats, _ = await seed(schema_session)
    chat_id, file_id = chats[0].id, files[0].id
    schema_session.add(ChatFileModel(chat_id=chat_id, file_id=file_id, user_id="a"))
    await schema_session.commit()
    schema_session.add(ChatFileModel(chat_id=chat_id, file_id=file_id, user_id="a"))
    with pytest.raises(IntegrityError):
        await schema_session.commit()
    await schema_session.rollback()
    for statement in (
        update(ChatModel).where(ChatModel.id == chat_id).values(user_id="b"),
        update(UserFileModel).where(UserFileModel.id == file_id).values(user_id="b"),
    ):
        with pytest.raises(IntegrityError):
            await schema_session.execute(statement)
            await schema_session.commit()
        await schema_session.rollback()


@pytest.mark.asyncio
async def test_project_detachment_and_chat_source_cascades_preserve_other_domains(schema_session):
    projects, files, chats, messages = await seed(schema_session)
    project_id, file_id, chat_id, message_id = projects[0].id, files[0].id, chats[0].id, messages[0].id
    schema_session.add(ChatFileModel(chat_id=chat_id, file_id=file_id, user_id="a"))
    await schema_session.commit()
    await schema_session.execute(delete(ProjectModel).where(ProjectModel.id == project_id))
    await schema_session.commit()
    await schema_session.refresh(chats[0])
    assert chats[0].project_id is None
    assert await schema_session.get(MessageModel, message_id) is not None
    assert len(list(await schema_session.scalars(select(ChatFileModel)))) == 1
    await schema_session.execute(delete(ChatModel).where(ChatModel.id == chat_id))
    await schema_session.commit()
    assert await schema_session.get(UserFileModel, file_id) is not None
    assert list(await schema_session.scalars(select(ChatFileModel))) == []
    assert await schema_session.scalar(select(MessageModel.id).where(MessageModel.id == message_id)) is None


def test_fresh_chat_schema_uses_project_identity():
    assert "folder_id" not in ChatModel.__table__.columns
    assert ChatModel.__table__.columns.project_id.nullable
    assert ChatFileModel.__table__.primary_key.columns.keys() == ["chat_id", "file_id"]
