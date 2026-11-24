"""US-98.3: propose_deck and propose_quiz (EPIC-98, ADR-0080).

Offered to the main agent only in a project conversation whose Study area is on,
while the admin and class switches allow it and the model supports tools;
checked again when they run; one draft of each kind per run; drafts cite only
files the run can use.
"""

import json
import uuid
from dataclasses import replace

import pytest
from asterism.core.exceptions import BadDataException
from asterism.domains.agent.service import get_agent_profile, get_main_agent_profile
from asterism.domains.chat.models import ChatModel
from asterism.domains.chat.prompt_composition import STUDY_GUIDANCE
from asterism.domains.chat.tool_policy import require_internal_tool, resolve_effective_tools
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.projects.models import ProjectFileModel
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.study.chat_policy import chat_study_available
from asterism.domains.study.models import StudyProposalModel
from asterism.domains.study.proposal_schemas import StudyDeckDraft, StudyQuizDraft
from asterism.domains.tools.builtin.study import propose_deck, propose_quiz
from asterism.domains.tools.catalog import ToolPolicy, configurable_tools
from asterism.domains.tools.registry import tool_registry
from sqlalchemy import select, update
from test_canvas import canvas_api as _canvas_api
from test_canvas import tool_ctx
from test_chat_models import A
from test_class_mode_policy import course as _course
from test_memory_proposals import run_in, tools_on
from test_memory_turns import create_project
from test_project_areas import ALL_ON, patch
from test_project_sub_agents import worker
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
canvas_api = _canvas_api
course = _course
STUDY = {"propose_deck", "propose_quiz"}
DECK = {"title": "Cells", "cards": [{"front": "Powerhouse of the cell?", "back": "Mitochondria"}]}
QUIZ = {
    "title": "Cells quiz",
    "questions": [{"kind": "short_answer", "prompt": "What does ATP do?", "rubric": "Stores and moves energy."}],
}


async def project_run(client, sessions):
    project = await create_project(client, "Biology")
    chat_id, scope = await run_in(client, sessions, project_id=project)
    return project, chat_id, replace(scope, project_id=uuid.UUID(project))


async def offered(chat_id):
    main = await get_main_agent_profile("a")
    names, ceiling = await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=main, model_id=uuid.UUID(A))
    return set(names), ceiling


async def set_policy(sessions, **value):
    async with sessions() as db:
        await db.merge(ApplicationSettingsModel(key="study_chat", value={"enabled": True, "group_ids": None} | value))
        await db.commit()


async def test_offered_only_in_a_project_chat_with_study_on(canvas_api):
    client, sessions = canvas_api
    await tools_on(sessions)
    project, chat_id, _ = await project_run(client, sessions)

    names, ceiling = await offered(chat_id)
    assert STUDY <= names  # on by default
    for name in STUDY:
        await require_internal_tool(name=name, user_id="a", chat_id=chat_id, scope=ceiling)

    # The project's Study area off: neither offered nor allowed to run.
    assert (await patch(client, {"id": project}, areas=ALL_ON | {"study": False})).status_code == 200
    assert not STUDY & (await offered(chat_id))[0]
    with pytest.raises(BadDataException):
        await require_internal_tool(name="propose_deck", user_id="a", chat_id=chat_id, scope=ceiling)
    assert (await patch(client, {"id": project}, areas=ALL_ON)).status_code == 200

    # The admin switch off.
    await set_policy(sessions, enabled=False)
    assert not STUDY & (await offered(chat_id))[0]
    with pytest.raises(BadDataException):
        await require_internal_tool(name="propose_quiz", user_id="a", chat_id=chat_id, scope=ceiling)
    await set_policy(sessions, enabled=True)

    # A model without tools gets none.
    await tools_on(sessions, supports_tools=False)
    assert (await offered(chat_id))[0] == set()
    await tools_on(sessions)

    # Never a sub-agent.
    helper = await get_agent_profile("a", uuid.UUID((await worker(client, "Helper"))["id"]))
    with pytest.raises(BadDataException):
        await require_internal_tool(
            name="propose_deck",
            user_id="a",
            chat_id=chat_id,
            scope=replace(ceiling, caller_agent_id=helper.id, model_id=helper.model_id),
        )

    # Not in a drafting chat.
    async with sessions() as db:
        await db.execute(update(ChatModel).where(ChatModel.id == chat_id).values(purpose="skill_draft"))
        await db.commit()
    assert not STUDY & (await offered(chat_id))[0]

    for name in STUDY:
        assert tool_registry[name].policy == ToolPolicy.CONTEXT_MANAGED
    assert not STUDY & set(configurable_tools(list(STUDY)))
    assert "propose_deck" in STUDY_GUIDANCE


async def test_not_offered_in_general_chats(canvas_api):
    client, sessions = canvas_api
    await tools_on(sessions)
    chat_id, _ = await run_in(client, sessions)
    assert not STUDY & (await offered(chat_id))[0]


async def test_the_class_switch_turns_them_off_in_the_course_project(course):
    client, sessions = course["client"], course["sessions"]
    async with sessions() as db:
        chat = ChatModel(user_id="a", project_id=uuid.UUID(course["project"]), purpose="conversation")
        db.add(chat)
        await db.commit()
        assert (await chat_study_available("a", chat.id, db))[0] is True
    saved = await client.put(
        f"/classes/{course['class']}/mode-policy",
        headers=auth("teach"),
        json={"allowed_modes": None, "answer_reveal": True, "study_chat_enabled": False},
    )
    assert saved.status_code == 200, saved.text
    async with sessions() as db:
        available, reason = await chat_study_available("a", chat.id, db)
    assert (available, reason) == (False, "Dr Teach has turned off decks and quizzes from chat in this course")


async def test_drafts_one_of_each_kind_per_run_and_says_nothing_of_their_text(canvas_api):
    client, sessions = canvas_api
    await tools_on(sessions)
    _, chat_id, scope = await project_run(client, sessions)

    deck = await propose_deck(tool_ctx(chat_id, scope, StudyDeckDraft.model_validate(DECK)))
    assert deck["status"] == "pending" and deck["kind"] == "deck" and deck["items"] == 1
    assert "Mitochondria" not in json.dumps(deck)
    again = await propose_deck(tool_ctx(chat_id, scope, StudyDeckDraft.model_validate(DECK)))
    assert again == {"error": "You can draft only one deck per turn"}
    quiz = await propose_quiz(tool_ctx(chat_id, scope, StudyQuizDraft.model_validate(QUIZ)))
    assert quiz["kind"] == "quiz"

    async with sessions() as db:
        rows = list(await db.scalars(select(StudyProposalModel).order_by(StudyProposalModel.kind)))
    assert [(row.kind, row.status, row.execution_id) for row in rows] == [
        ("deck", "pending", scope.execution_id),
        ("quiz", "pending", scope.execution_id),
    ]
    assert rows[0].payload["cards"][0]["back"] == "Mitochondria"


async def test_drafts_cite_only_files_the_run_can_use(canvas_api):
    client, sessions = canvas_api
    await tools_on(sessions)
    project, chat_id, scope = await project_run(client, sessions)
    async with sessions() as db:
        file = UserFileModel(
            user_id="a",
            storage_key=str(uuid.uuid4()),
            filename="cells.txt",
            original_name="cells.txt",
            size=1,
            mime_type="text/plain",
            kind=FileKind.TEXT,
            sha256="c" * 64,
        )
        db.add(file)
        await db.flush()
        db.add(ProjectFileModel(project_id=uuid.UUID(project), file_id=file.id, user_id="a"))
        await db.commit()
    cited = DECK | {"cards": [DECK["cards"][0] | {"file_ids": [str(file.id)]}]}

    outside = await propose_deck(tool_ctx(chat_id, scope, StudyDeckDraft.model_validate(cited)))
    assert outside == {"error": "Cite only files this chat can use"}
    inside = await propose_deck(
        tool_ctx(chat_id, replace(scope, allowed_file_ids=frozenset({file.id})), StudyDeckDraft.model_validate(cited))
    )
    assert inside["status"] == "pending"


async def test_refused_outside_a_recorded_main_agent_run(canvas_api):
    client, sessions = canvas_api
    await tools_on(sessions)
    _, chat_id, scope = await project_run(client, sessions)
    draft = StudyDeckDraft.model_validate(DECK)
    for bad in (replace(scope, is_sub_agent=True), replace(scope, project_id=None), replace(scope, execution_id=None)):
        result = await propose_deck(tool_ctx(chat_id, bad, draft))
        assert "unavailable" in result["error"]
