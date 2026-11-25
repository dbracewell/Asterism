"""US-103.3 (ADR-0081): the main agent learns to draw diagrams as mermaid."""

import uuid
from types import SimpleNamespace

import pytest
from asterism.domains.chat.prompt_composition import (
    CANVAS_GUIDANCE,
    DIAGRAM_GUIDANCE,
    IMAGE_GUIDANCE,
    build_runtime_prompt,
)


async def runtime(*, sub_agent: bool, tools: list[str] | None = None) -> str:
    return await build_runtime_prompt(
        user_id="a",
        chat_id=uuid.uuid4(),
        profile=SimpleNamespace(id=uuid.uuid4(), sub_agent=sub_agent),
        tools=tools or [],
        scope=None,
    )


@pytest.mark.asyncio
async def test_the_main_agent_is_told_about_diagrams_without_any_tool():
    prompt = await runtime(sub_agent=False)
    assert DIAGRAM_GUIDANCE in prompt
    assert prompt.startswith("Server-authorized tools at turn start: none.")


@pytest.mark.asyncio
async def test_sub_agents_are_not():
    assert DIAGRAM_GUIDANCE not in await runtime(sub_agent=True)


@pytest.mark.asyncio
async def test_diagrams_come_before_the_image_tool_guidance():
    prompt = await runtime(sub_agent=False, tools=["generate_image"])
    assert prompt.index(DIAGRAM_GUIDANCE) < prompt.index(IMAGE_GUIDANCE)


def test_diagram_guidance_names_the_fence_accessibility_lines_and_refused_lines():
    for text in ("```mermaid", "accTitle:", "accDescr:", "double quotes", "in words"):
        assert text in DIAGRAM_GUIDANCE
    for refused in ("click", "style", "%%{init}%%"):
        assert refused in DIAGRAM_GUIDANCE
    assert "http" not in DIAGRAM_GUIDANCE


def test_image_guidance_sends_labelled_diagrams_to_mermaid():
    assert "generate_image" in IMAGE_GUIDANCE
    assert "mermaid diagram instead" in IMAGE_GUIDANCE
    for kind in ("flowchart", "mind map", "timeline"):
        assert kind in IMAGE_GUIDANCE


def test_canvas_guidance_mentions_diagrams():
    assert "mermaid diagrams" in CANVAS_GUIDANCE
