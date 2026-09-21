import pytest
from asterism.domains.llm.schemas import (
    ImageUrlContent,
    ImageUrlContentPart,
    LLMMessage,
    TextContentPart,
    text_content,
)


def test_text_only_api_message_is_unchanged():
    message = LLMMessage.user("hello")
    assert message.to_api_message() == {"role": "user", "content": "hello"}
    assert text_content(message) == "hello"


def test_user_message_serializes_text_and_image_parts():
    message = LLMMessage(
        role="user",
        content=[
            TextContentPart(text="describe this"),
            ImageUrlContentPart(image_url=ImageUrlContent(url="data:image/png;base64,AA==")),
        ],
    )

    assert message.to_api_message() == {
        "role": "user",
        "content": [
            {"type": "text", "text": "describe this"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
        ],
    }
    assert text_content(message) == "describe this"


def test_structured_content_is_rejected_for_non_user_messages():
    message = LLMMessage(
        role="assistant",
        content=[TextContentPart(text="not allowed")],
    )

    with pytest.raises(RuntimeError, match="Only user messages"):
        message.to_api_message()
