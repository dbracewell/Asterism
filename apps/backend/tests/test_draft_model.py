import pytest
from asterism.domains.llm.draft import DraftModel
from asterism.domains.llm.schemas import LLMEvent, LLMEventType


@pytest.mark.asyncio
async def test_draft_model_does_not_turn_empty_completion_into_none():
    draft = DraftModel()

    class EmptyCompletionClient:
        async def generate(self, **_kwargs):
            return LLMEvent(type=LLMEventType.COMPLETE)

    draft._llm_client = EmptyCompletionClient()  # type: ignore[assignment]

    assert await draft.invoke(messages=[]) == ""
