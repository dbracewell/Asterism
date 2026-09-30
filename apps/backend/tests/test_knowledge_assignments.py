import pytest
import pytest_asyncio
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.db.base import Base
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.service import get_agent_profile
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.knowledge.models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeArtifactStatus,
    KnowledgeBaseFileModel,
    KnowledgeBaseModel,
)
from asterism.domains.knowledge.schemas import KnowledgeBaseAssignmentReplace
from asterism.domains.knowledge.service import (
    get_agent_knowledge_base_assignments,
    replace_agent_knowledge_base_assignments,
)
from asterism.domains.user.models import UserModel
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def assignment_session(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'assignments.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="user-a"), UserModel(id="user-b")])
        await session.commit()
        yield session
    await engine.dispose()


async def _ready_base(session, user_id: str, name: str) -> KnowledgeBaseModel:
    base = KnowledgeBaseModel(user_id=user_id, name=name)
    session.add(base)
    await session.flush()
    file = UserFileModel(
        user_id=user_id,
        filename=f"{name.lower()}.txt",
        original_name="ready.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256=("a" * 64),
    )
    session.add(file)
    await session.flush()
    session.add_all(
        [
            KnowledgeBaseFileModel(knowledge_base_id=base.id, file_id=file.id, position=1),
            FileKnowledgeArtifactModel(
                user_id=user_id,
                file_id=file.id,
                generation=1,
                processing_profile_generation=1,
                processing_profile_identity="a" * 64,
                status=FileKnowledgeArtifactStatus.READY,
                is_current=True,
            ),
        ]
    )
    await session.commit()
    return base


@pytest.mark.asyncio
async def test_assignments_are_owned_ready_ordered_and_replaceable(assignment_session):
    agent = AgentProfileModel(user_id="user-a", name="Agent", description="", sub_agent=False)
    assignment_session.add(agent)
    await assignment_session.commit()
    first = await _ready_base(assignment_session, "user-a", "First")
    second = await _ready_base(assignment_session, "user-a", "Second")
    foreign = await _ready_base(assignment_session, "user-b", "Foreign")
    empty = KnowledgeBaseModel(user_id="user-a", name="Empty")
    assignment_session.add(empty)
    await assignment_session.commit()

    assigned = await replace_agent_knowledge_base_assignments(
        user_id="user-a",
        agent_id=agent.id,
        payload=KnowledgeBaseAssignmentReplace(knowledge_base_ids=[second.id, first.id]),
        session=assignment_session,
    )
    assert assigned.knowledge_base_ids == [second.id, first.id]
    assert (
        await get_agent_knowledge_base_assignments(user_id="user-a", agent_id=agent.id, session=assignment_session)
    ).knowledge_base_ids == [second.id, first.id]
    profile = await get_agent_profile(user_id="user-a", agent_id=agent.id, session=assignment_session)
    assert [(base.id, base.name) for base in profile.knowledge_bases] == [
        (second.id, "Second"),
        (first.id, "First"),
    ]

    cleared = await replace_agent_knowledge_base_assignments(
        user_id="user-a",
        agent_id=agent.id,
        payload=KnowledgeBaseAssignmentReplace(),
        session=assignment_session,
    )
    assert cleared.knowledge_base_ids == []
    with pytest.raises(BadDataException, match="duplicates"):
        await replace_agent_knowledge_base_assignments(
            user_id="user-a",
            agent_id=agent.id,
            payload=KnowledgeBaseAssignmentReplace(knowledge_base_ids=[first.id, first.id]),
            session=assignment_session,
        )
    with pytest.raises(NotFoundException):
        await replace_agent_knowledge_base_assignments(
            user_id="user-a",
            agent_id=agent.id,
            payload=KnowledgeBaseAssignmentReplace(knowledge_base_ids=[foreign.id]),
            session=assignment_session,
        )
    with pytest.raises(BadDataException, match="ready document"):
        await replace_agent_knowledge_base_assignments(
            user_id="user-a",
            agent_id=agent.id,
            payload=KnowledgeBaseAssignmentReplace(knowledge_base_ids=[empty.id]),
            session=assignment_session,
        )
