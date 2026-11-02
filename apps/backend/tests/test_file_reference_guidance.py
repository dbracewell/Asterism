"""US-56.6: the prompt explains file references only when the run can see files."""

import uuid
from types import SimpleNamespace

import pytest
from asterism.domains.chat.prompt_composition import FILE_REFERENCE_GUIDANCE, build_runtime_prompt
from asterism.domains.tools.context import ContextToolScope


def scope(file_ids: frozenset[uuid.UUID]) -> ContextToolScope:
    return ContextToolScope(
        user_id="a",
        chat_id=uuid.uuid4(),
        project_id=None,
        caller_agent_id=uuid.uuid4(),
        model_id=uuid.uuid4(),
        file_ids=file_ids,
        delegation=None,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("ceiling", "expected"),
    [(None, False), (scope(frozenset()), False), (scope(frozenset({uuid.uuid4()})), True)],
)
async def test_guidance_only_with_scoped_files(ceiling, expected):
    prompt = await build_runtime_prompt(
        user_id="a", chat_id=uuid.uuid4(), profile=SimpleNamespace(id=uuid.uuid4()), tools=[], scope=ceiling
    )
    assert (FILE_REFERENCE_GUIDANCE in prompt) is expected
    assert prompt.startswith("Server-authorized tools at turn start: none.")


def test_guidance_names_the_exact_token_grammar_and_no_urls():
    assert "![short description](asterism-file:<file id>)" in FILE_REFERENCE_GUIDANCE
    assert "[label](asterism-file:<file id>)" in FILE_REFERENCE_GUIDANCE
    assert "http" not in FILE_REFERENCE_GUIDANCE
