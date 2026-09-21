
import pytest
import pytest_asyncio
from asterism.db.base import Base
from asterism.db.schema_migrations import run_schema_migrations
from asterism.domains.chat.models import ChatModel, MessageModel
from asterism.domains.chat.schemas import MessageStatus, SearchMatchSource, SearchResultKind
from asterism.domains.chat.service import search
from asterism.domains.folders.models import FolderModel
from asterism.domains.folders.service import list_folder_chats
from asterism.domains.user.models import UserModel
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def search_session(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'search.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await run_schema_migrations(connection)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="user-a"), UserModel(id="user-b")])
        await session.commit()
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_search_finds_titles_content_and_containing_folders(search_session):
    folder = FolderModel(user_id="user-a", title="Research")
    search_session.add(folder)
    await search_session.flush()
    child = FolderModel(user_id="user-a", title="Papers", parent_id=folder.id)
    search_session.add(child)
    await search_session.flush()
    title_chat = ChatModel(user_id="user-a", title="Ocean currents", folder_id=folder.id)
    content_chat = ChatModel(user_id="user-a", title="Notes", folder_id=child.id)
    other_user_chat = ChatModel(user_id="user-b", title="Ocean secret")
    search_session.add_all([title_chat, content_chat, other_user_chat])
    await search_session.flush()
    search_session.add(
        MessageModel(
            user_id="user-a",
            chat_id=content_chat.id,
            role="user",
            content="Explain the ocean circulation patterns",
            status=MessageStatus.COMPLETED,
        )
    )
    await search_session.commit()

    result = await search("user-a", "ocean", session=search_session)

    chats = [item for item in result.results if item.kind is SearchResultKind.CHAT]
    folders = [item for item in result.results if item.kind is SearchResultKind.FOLDER]
    assert {item.id for item in chats} == {title_chat.id, content_chat.id}
    assert {item.id for item in folders} == {folder.id, child.id}
    assert next(item for item in chats if item.id == title_chat.id).match_source is SearchMatchSource.TITLE
    content_result = next(item for item in chats if item.id == content_chat.id)
    assert content_result.match_source is SearchMatchSource.CONTENT
    assert "ocean" in (content_result.snippet or "").casefold()
    assert content_result.path == ["Research", "Papers"]


@pytest.mark.asyncio
async def test_folder_chat_list_is_paginated_and_user_scoped(search_session):
    folder = FolderModel(user_id="user-a", title="Work")
    other_folder = FolderModel(user_id="user-b", title="Private")
    search_session.add_all([folder, other_folder])
    await search_session.flush()
    search_session.add_all(
        [
            ChatModel(user_id="user-a", title="One", folder_id=folder.id),
            ChatModel(user_id="user-a", title="Two", folder_id=folder.id),
            ChatModel(user_id="user-b", title="Hidden", folder_id=other_folder.id),
        ]
    )
    await search_session.commit()

    result = await list_folder_chats("user-a", folder.id, 1, 1, search_session)

    assert result.total == 2
    assert len(result.chats) == 1


@pytest.mark.asyncio
async def test_search_paginates_and_requires_all_keywords(search_session):
    chats = [
        ChatModel(user_id="user-a", title="Blue ocean one"),
        ChatModel(user_id="user-a", title="Blue ocean two"),
        ChatModel(user_id="user-a", title="Blue sky"),
    ]
    search_session.add_all(chats)
    await search_session.commit()

    result = await search("user-a", "blue ocean", page=2, page_size=1, session=search_session)

    assert result.total == 2
    assert result.page == 2
    assert len(result.results) == 1
    assert result.results[0].kind is SearchResultKind.CHAT
