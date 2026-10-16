import uuid

from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.chat.schemas import Chat, ChatInfo
from asterism.domains.retrieval.service import _bounded_excerpt


def _agent() -> Agent:
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
    )
    user = AuthedUser(id="user-a", email="user@example.test", name="User", role="user")
    chat = Chat(
        info=ChatInfo(id=uuid.uuid4(), user_id=user.id, agent_id=agent_id, created_at=0, updated_at=0),
        messages=[],
    )
    return Agent(profile=profile, user=user, session=chat, allowed_tools=[])


def test_runtime_agent_has_no_knowledge_assignment_contract():
    agent = _agent()
    assert "knowledge_bases" not in type(agent.profile).model_fields
    assert "search_knowledge" not in agent.allowed_tools


def test_bounded_excerpt_never_splits_utf8_codepoints():
    assert _bounded_excerpt("hello", 3) == "hel"
    assert _bounded_excerpt("éclair", 1) == ""
    assert _bounded_excerpt("éclair", 2) == "é"
