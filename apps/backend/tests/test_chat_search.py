import pytest
import pytest_asyncio
from asterism.db.database import set_sqlite_pragma
from asterism.db.model_registry import Base
from asterism.domains.chat.models import ChatModel, MessageModel
from asterism.domains.chat.schemas import MessageStatus, SearchMatchSource, SearchResultKind
from asterism.domains.chat.search_index import initialize_search_index
from asterism.domains.chat.service import search
from asterism.domains.projects.models import ProjectModel
from asterism.domains.user.models import UserModel
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def search_session(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'search.db'}")
    event.listen(engine.sync_engine, "connect", set_sqlite_pragma)
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
        def matching_chats(self, user_id, terms):
            from sqlalchemy import select

            return select(ChatModel.id)

        def matching_projects(self, user_id, terms):
            from sqlalchemy import select

            return select(ProjectModel.id)

    monkeypatch.setattr(search_module, "search_index_for", lambda session: Index())
    pages = [await search("user-a", "ocean", page=page, page_size=1, session=search_session) for page in (1, 2, 3)]
    assert [page.total for page in pages] == [2, 2, 2]
    assert [[row.id for row in page.results] for page in pages] == [[chat.id], [project.id], []]


@pytest.mark.asyncio
@pytest.mark.parametrize("scope", ["all", "general", "project"])
async def test_search_query_and_bind_counts_stay_page_bounded(search_session, scope, record_property):
    import json
    import uuid

    from sqlalchemy import event, insert

    def entity_id(value):
        return uuid.UUID(f"a0000000-0000-4000-8000-{value:012x}")

    project = ProjectModel(user_id="user-a", name="Ocean project", updated_at=350 if scope == "all" else 200)
    search_session.add(project)
    await search_session.commit()
    target_project = project.id if scope == "project" else None
    other_project = None if scope == "project" else project.id
    statements = []

    def record(connection, cursor, statement, parameters, context, executemany):
        statements.append((statement, tuple(parameters)))

    async def seed(start, end):
        await search_session.execute(
            insert(ChatModel),
            [
                {
                    "id": entity_id(offset + i + 1),
                    "user_id": owner,
                    "project_id": membership,
                    "title": title,
                    "updated_at": updated,
                }
                for offset, owner, membership, title, updated in [
                    (0, "user-a", target_project, "Notes", 300 if scope == "all" else 100),
                    (100_000, "user-a", other_project, "Ocean other scope", 250),
                    (200_000, "user-b", None, "Ocean private", 400),
                ]
                for i in range(start, end)
            ],
        )
        await search_session.execute(
            insert(MessageModel),
            [
                {
                    "id": entity_id(300_000 + i + 1),
                    "user_id": "user-a",
                    "chat_id": entity_id(i + 1),
                    "role": "user",
                    "content": f"Ocean evidence {i}",
                    "status": MessageStatus.COMPLETED,
                }
                for i in range(start, end)
            ],
        )
        await search_session.commit()

    evidence = []
    await seed(0, 24)
    bind = search_session.bind.sync_engine
    event.listen(bind, "before_cursor_execute", record)
    try:
        for matches in (24, 1205):
            if matches > 24:
                event.remove(bind, "before_cursor_execute", record)
                await seed(24, matches)
                event.listen(bind, "before_cursor_execute", record)
            statements.clear()
            result = await search(
                "user-a",
                "ocean",
                page_size=7,
                scope=scope,
                project_id=project.id if scope == "project" else None,
                session=search_session,
            )
            expected_ids = [entity_id(i) for i in range(1, 8)]
            if scope == "all":
                expected_ids = [project.id, *expected_ids[:6]]
            assert [item.id for item in result.results] == expected_ids
            assert result.total == (2 * matches + 1 if scope == "all" else matches)
            snippet_statements = [statement for statement, _ in statements if "messages" in statement.lower()]
            evidence.append(
                {
                    "scope": scope,
                    "matches_per_bucket": matches,
                    "page_size": 7,
                    "total": result.total,
                    "queries": len(statements),
                    "max_binds": max(len(parameters) for _, parameters in statements),
                    "snippet_queries": len(snippet_statements),
                }
            )
            assert evidence[-1]["max_binds"] <= 19
            assert len(snippet_statements) == 1
            assert len(statements) <= (6 if scope == "project" else 5)
        assert evidence[0]["queries"] == evidence[1]["queries"]
        assert evidence[0]["max_binds"] == evidence[1]["max_binds"]
        second = await search(
            "user-a",
            "ocean",
            page=2,
            page_size=7,
            scope=scope,
            project_id=project.id if scope == "project" else None,
            session=search_session,
        )
        expected_start = 7 if scope == "all" else 8
        assert [item.id for item in second.results] == [entity_id(i) for i in range(expected_start, expected_start + 7)]
        statements.clear()
        empty = await search(
            "user-a",
            "ocean",
            page=10_000,
            page_size=7,
            scope=scope,
            project_id=project.id if scope == "project" else None,
            session=search_session,
        )
        assert empty.results == [] and empty.total == result.total
        assert not any("messages" in statement.lower() for statement, _ in statements)
    finally:
        event.remove(bind, "before_cursor_execute", record)
    record_property("search_bounds", json.dumps(evidence))


@pytest.mark.asyncio
async def test_page_snippets_keep_any_term_chronology_title_precedence_and_owner_filter(search_session):
    import uuid

    from asterism.domains.chat.queries import select_owned_message_snippets
    from sqlalchemy import event

    title = ChatModel(user_id="user-a", title="Blue ocean title", updated_at=300)
    content = ChatModel(user_id="user-a", title="Notes", updated_at=200)
    foreign = ChatModel(user_id="user-b", title="Private notes")
    search_session.add_all([title, content, foreign])
    await search_session.flush()
    search_session.add_all(
        [
            MessageModel(
                id=uuid.UUID(f"b0000000-0000-4000-8000-{i:012x}"),
                user_id=owner,
                chat_id=chat.id,
                role="user",
                content=text,
                status=MessageStatus.COMPLETED,
                created_at=created,
            )
            for i, owner, chat, text, created in [
                (1, "user-a", content, "An earlier unrelated message", 1),
                (3, "user-a", content, "Ocean later-ID message", 2),
                (2, "user-a", content, "Blue first-ID message", 2),
                (4, "user-a", content, "Blue ocean later-time message", 3),
                (5, "user-a", title, "Ocean content must not replace the title", 1),
                (6, "user-b", foreign, "Blue ocean private content", 0),
            ]
        ]
    )
    await search_session.commit()
    statements = []

    def record(connection, cursor, statement, parameters, context, executemany):
        statements.append((statement, tuple(parameters)))

    bind = search_session.bind.sync_engine
    event.listen(bind, "before_cursor_execute", record)
    try:
        first = await search("user-a", "blue ocean", page_size=1, session=search_session)
        assert first.total == 2
        assert first.results[0].id == title.id
        assert first.results[0].match_source is SearchMatchSource.TITLE
        assert first.results[0].snippet == title.title
        assert not any("messages" in statement.lower() for statement, _ in statements)
        statements.clear()
        second = await search("user-a", "blue ocean", page=2, page_size=1, session=search_session)
        assert second.results[0].id == content.id
        assert second.results[0].snippet == "Blue first-ID message"
        snippet_queries = [(sql, params) for sql, params in statements if "messages" in sql.lower()]
        assert len(snippet_queries) == 1
        assert content.id.hex in snippet_queries[0][1]
        assert title.id.hex not in snippet_queries[0][1] and foreign.id.hex not in snippet_queries[0][1]
    finally:
        event.remove(bind, "before_cursor_execute", record)
    # The owning query itself keeps the owner ceiling even with untrusted IDs.
    rows = await search_session.execute(
        select_owned_message_snippets(
            user_id="user-a",
            chat_ids=[content.id, foreign.id],
            terms=["blue", "ocean"],
        )
    )
    assert list(rows.tuples()) == [(content.id, "Blue first-ID message")]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "title"),
    [
        ("ocean OR blue", "Ocean or blue"),
        ('"ocean" -blue*', "Blue ocean"),
        ('ocean ) NOT ("blue', "Ocean not blue"),
        ("ocean; DROP TABLE chats", "Ocean drop table chats"),
        (
            "one two three four five six seven eight nine ten ignored",
            "one two three four five six seven eight nine ten",
        ),
    ],
)
async def test_search_uses_literal_and_terms_not_fts_operators(search_session, query, title):
    target = ChatModel(user_id="user-a", title=title)
    search_session.add_all(
        [target, ChatModel(user_id="user-a", title="Ocean"), ChatModel(user_id="user-b", title=title)]
    )
    await search_session.commit()
    result = await search("user-a", query, session=search_session)
    assert [item.id for item in result.results] == [target.id]


@pytest.mark.asyncio
async def test_underscore_snippet_matching_is_literal(search_session):
    chat = ChatModel(user_id="user-a", title="Notes")
    search_session.add(chat)
    await search_session.flush()
    search_session.add_all(
        [
            MessageModel(
                user_id="user-a",
                chat_id=chat.id,
                role="user",
                content=content,
                created_at=created,
                status=MessageStatus.COMPLETED,
            )
            for created, content in [(1, "deepXsea wildcard decoy"), (2, "deep_sea evidence")]
        ]
    )
    await search_session.commit()
    result = await search("user-a", "deep_sea", session=search_session)
    assert result.total == 1 and result.results[0].snippet == "deep_sea evidence"


@pytest.mark.asyncio
async def test_search_scope_requires_owned_project_even_for_empty_terms(search_session):
    import uuid

    from asterism.core.exceptions import BadDataException, NotFoundException

    foreign = ProjectModel(user_id="user-b", name="Ocean private")
    search_session.add(foreign)
    await search_session.commit()
    for project_id in (foreign.id, uuid.uuid4()):
        for query in ("ocean", "***"):
            with pytest.raises(NotFoundException):
                await search("user-a", query, scope="project", project_id=project_id, session=search_session)
    for options in (
        {"scope": "project"},
        {"scope": "general", "project_id": foreign.id},
        {"page": 0},
        {"page_size": 101},
    ):
        with pytest.raises(BadDataException):
            await search("user-a", "ocean", session=search_session, **options)
    assert (await search("user-a", '"%*()-"', session=search_session)).total == 0


@pytest.mark.asyncio
async def test_real_index_mixed_ties_have_repeatable_nonoverlapping_pages(search_session):
    import uuid

    chats = [
        ChatModel(id=uuid.UUID(f"c0000000-0000-4000-8000-{i:012x}"), user_id="user-a", title="Ocean", updated_at=100)
        for i in (3, 1, 2)
    ]
    projects = [
        ProjectModel(
            id=uuid.UUID(f"d0000000-0000-4000-8000-{i:012x}"), user_id="user-a", name=f"Ocean {i}", updated_at=100
        )
        for i in (3, 1, 2)
    ]
    search_session.add_all([*chats, *projects])
    await search_session.commit()
    expected = sorted(chat.id for chat in chats) + sorted(project.id for project in projects)
    for _ in range(2):
        pages = [
            await search("user-a", "ocean", page=page, page_size=2, session=search_session) for page in (1, 2, 3, 4)
        ]
        assert all(page.total == 6 for page in pages)
        assert [item.id for page in pages for item in page.results] == expected
        assert pages[-1].results == []
