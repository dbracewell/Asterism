import uuid

import pytest
from asterism.domains.agent.service import get_main_agent_profile
from asterism.domains.chat.schemas import NewChatRequest
from asterism.domains.chat.service import create_chat, get_one
from asterism.domains.settings.service import upsert_user_setting
from pydantic import ValidationError
from test_main_agent_defaults import main_agent_session as _main_agent_session

main_agent_session = _main_agent_session


@pytest.mark.asyncio
async def test_chat_uses_singleton_independent_of_model_selection(main_agent_session):
    session = main_agent_session
    main = await get_main_agent_profile("user-a", session)
    chat = await create_chat("user-a", NewChatRequest(request_id=uuid.uuid4(), user_prompt="Hello"), session)
    assert chat.info.agent_id == main.id
    assert chat.info.context_model is None
    await upsert_user_setting("user-a", "default_model_id", str(session.info["model"].id), session)
    reopened = await get_one(chat.info.id, "user-a", session)
    assert reopened.info.context_model.id == session.info["model"].id
    assert reopened.info.agent_id == main.id
    assert (await get_main_agent_profile("user-a", session)).model_id is None
    with pytest.raises(ValidationError):
        NewChatRequest(request_id=uuid.uuid4(), user_prompt="Old selection", agent_id=main.id)
