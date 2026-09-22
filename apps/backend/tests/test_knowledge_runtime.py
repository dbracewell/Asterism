import uuid

from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentProfile, KnowledgeBaseAssignmentSummary
from asterism.domains.chat.schemas import Chat, ChatInfo
from asterism.domains.knowledge.search_tool import _bounded_excerpt


def _agent(knowledge_bases: list[KnowledgeBaseAssignmentSummary]) -> Agent:
    agent_id = uuid.uuid4()
    profile = AgentProfile(
        id=agent_id,
        name="Knowledge agent",
        description="",
        sub_agent=False,
        model_id=uuid.uuid4(),
        system_prompt=None,
        max_steps=2,
        tools=[],
        knowledge_bases=knowledge_bases,
    )
    user = AuthedUser(id="user-a", email="user@example.test", name="User", role="user")
    chat = Chat(
        info=ChatInfo(id=uuid.uuid4(), user_id=user.id, agent_id=agent_id, created_at=0, updated_at=0),
        messages=[],
    )
    return Agent(profile=profile, user=user, session=chat, allowed_tools=[])


def test_knowledge_search_is_automatically_allowed_only_for_assigned_agents():
    unassigned = _agent([])
    assigned = _agent([KnowledgeBaseAssignmentSummary(id=uuid.uuid4(), name="Private")])

    assert "search_knowledge" not in unassigned.allowed_tools
    assert assigned.allowed_tools == ["search_knowledge"]


def test_bounded_excerpt_never_splits_utf8_codepoints():
    assert _bounded_excerpt("hello", 3) == "hel"
    assert _bounded_excerpt("éclair", 1) == ""
    assert _bounded_excerpt("éclair", 2) == "é"
