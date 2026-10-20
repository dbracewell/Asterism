import pytest
import pytest_asyncio
from asterism.db.model_registry import Base
from asterism.domains.chat.models import ChatModel, MessageModel
from asterism.domains.chat.schemas import MessageStatus, SearchMatchSource, SearchResultKind
from asterism.domains.chat.search_index import initialize_search_index
from asterism.domains.chat.service import search
from asterism.domains.projects.models import ProjectModel
from asterism.domains.user.models import UserModel
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def search_session(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'search.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await initialize_search_index(connection)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="user-a"), UserModel(id="user-b")])
        await session.commit()
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_chat_search_finds_titles_content_and_projects(search_session):
    project = ProjectModel(user_id="user-a", name="Research")
    search_session.add(project)
    await search_session.flush()
    other_project = ProjectModel(user_id="user-a", name="Papers")
    search_session.add(other_project)
    await search_session.flush()
    title_chat = ChatModel(user_id="user-a", title="Ocean currents")
    content_chat = ChatModel(user_id="user-a", title="Notes")
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
        ),
    )
    await search_session.commit()

    result = await search("user-a", "ocean", session=search_session)

    chats = [item for item in result.results if item.kind is SearchResultKind.CHAT]
    projects = [item for item in result.results if item.kind is SearchResultKind.PROJECT]
    assert {item.id for item in chats} == {title_chat.id, content_chat.id}
    assert projects == []
    assert next(item for item in chats if item.id == title_chat.id).match_source is SearchMatchSource.TITLE
    content_result = next(item for item in chats if item.id == content_chat.id)
    assert content_result.match_source is SearchMatchSource.CONTENT
    assert "ocean" in (content_result.snippet or "").casefold()
    assert content_result.project_id is None
    assert content_result.project_name is None
    project_results = await search("user-a", "Research", session=search_session)
    assert [item.id for item in project_results.results] == [project.id]


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


@pytest.mark.asyncio
async def test_project_description_index_updates_and_never_searches_prompt_or_foreign_data(search_session):
    from sqlalchemy import delete, update

    project = ProjectModel(
        user_id="user-a", name="Course", description="Marine ocean observations", system_prompt="confidentialkeyword"
    )
    foreign = ProjectModel(user_id="user-b", name="Ocean secret")
    search_session.add_all([project, foreign])
    await search_session.commit()
    result = await search("user-a", "ocean", session=search_session)
    assert [row.id for row in result.results] == [project.id]
    assert result.results[0].match_source is SearchMatchSource.PROJECT_DESCRIPTION
    assert "ocean" in result.results[0].snippet
    assert (await search("user-a", "confidentialkeyword", session=search_session)).total == 0
    await search_session.execute(
        update(ProjectModel)
        .where(ProjectModel.id == project.id)
        .values(
            name="Ocean course",
            description="Updated description",
        )
    )
    await search_session.commit()
    result = await search("user-a", "ocean", session=search_session)
    assert result.results[0].match_source is SearchMatchSource.PROJECT_NAME
    assert (await search("user-a", "marine", session=search_session)).total == 0
    await search_session.execute(delete(ProjectModel).where(ProjectModel.id == project.id))
    await search_session.commit()
    assert (await search("user-a", "ocean", session=search_session)).total == 0


@pytest.mark.asyncio
async def test_search_rechecks_adapter_ownership_and_mixed_pagination(search_session, monkeypatch):
    from asterism.domains.chat import search as search_module

    project = ProjectModel(user_id="user-a", name="Ocean project", updated_at=100)
    foreign = ProjectModel(user_id="user-b", name="Ocean private", updated_at=100)
    chat = ChatModel(user_id="user-a", title="Ocean chat", updated_at=100)
    foreign_chat = ChatModel(user_id="user-b", title="Ocean private", updated_at=100)
    search_session.add_all([project, foreign, chat, foreign_chat])
    await search_session.commit()

    class Index:
        async def find_chat_ids(self, user_id, terms):
            return [chat.id, foreign_chat.id]

        async def find_project_ids(self, user_id, terms):
            return {project.id, foreign.id}

    monkeypatch.setattr(search_module, "search_index_for", lambda session: Index())
    pages = [await search("user-a", "ocean", page=page, page_size=1, session=search_session) for page in (1, 2, 3)]
    assert [page.total for page in pages] == [2, 2, 2]
    assert [[row.id for row in page.results] for page in pages] == [[chat.id], [project.id], []]
