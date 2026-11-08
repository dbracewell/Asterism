"""US-70.3: settings export and import carry groups and their access lists, never membership."""

import pytest
from asterism.domains.groups.models import GroupModel
from asterism.domains.settings.models import LLMModel
from asterism.domains.settings_transfer import documents
from asterism.domains.settings_transfer.documents import ExportedGroup, ModelReference
from asterism.domains.user.models import UserModel
from sqlalchemy import delete, select, update
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_settings_export import PASSPHRASE
from test_settings_export import api as _api
from test_settings_import import IMPORT, PREVIEW, bundle, post, request, state

pytestmark = pytest.mark.asyncio
project_api = _project_api
api = _api


@pytest.fixture(autouse=True)
def fast_scrypt(monkeypatch):
    monkeypatch.setattr(documents, "_SCRYPT_N", 2**4)


def group(name, **values):
    return ExportedGroup(name=name, **values)


IMPORTED = ModelReference(provider="Imported", model="m1")


async def groups(sessions):
    async with sessions() as session:
        return {row.name: row for row in await session.scalars(select(GroupModel))}


async def test_export_carries_access_lists_but_not_membership(api):
    client, sessions = api
    async with sessions() as session:
        model = await session.scalar(select(LLMModel).order_by(LLMModel.name))
        session.add(GroupModel(name="Night school", model_access=[str(model.id)], tool_access=["web_fetch"]))
        await session.commit()
    exported = (await state(sessions)).groups
    assert [(item.name, item.built_in) for item in exported] == [
        ("Admin", "admin"),
        ("Educator", "educator"),
        ("Student", "student"),
        ("Night school", None),
    ]
    night = exported[-1]
    assert night.tools == ("web_fetch",) and len(night.models) == 1
    assert night.models[0].model == model.name
    assert "member" not in night.model_dump_json()


async def test_import_adds_custom_groups_and_sets_built_in_access_by_key(api):
    client, sessions = api
    async with sessions() as session:
        session.add(UserModel(id="kid"))
        await session.commit()
    item = bundle(
        groups=(
            group("Students", built_in="student", models=(IMPORTED,), tools=()),
            group("Night school", tools=("web_fetch",)),
        )
    )
    preview = await post(client, PREVIEW, request(item))
    assert "Groups" in preview.json()["changed_settings"]
    assert (await post(client, IMPORT, request(item))).status_code == 200

    rows = await groups(sessions)
    # The built-in keeps its own name; only its access comes from the file.
    student = rows["Student"]
    async with sessions() as session:
        imported = await session.scalar(select(LLMModel.id).where(LLMModel.name == "m1"))
    assert (student.model_access, student.tool_access) == ([str(imported)], [])
    assert (rows["Night school"].model_access, rows["Night school"].tool_access) == (None, ["web_fetch"])
    async with sessions() as session:
        assert await session.scalar(select(UserModel.group_id).where(UserModel.id == "kid")) == "student"

    # Importing again updates the same group by name, case-insensitively, and adds no copy.
    again = bundle(groups=(group("NIGHT SCHOOL", tools=None),))
    assert (await post(client, IMPORT, request(again))).status_code == 200
    rows = await groups(sessions)
    assert len(rows) == 4 and rows["Night school"].tool_access is None


@pytest.mark.parametrize(
    "groups_value",
    [
        (group("Night"), group("night")),
        (group("Student"),),  # a custom group can't take a built-in's name
        (group("Night", tools=("sub_agent",)),),
        (group("Night", models=(ModelReference(provider="Imported", model="missing"),)),),
    ],
)
async def test_unsound_groups_are_refused_and_change_nothing(api, groups_value):
    client, sessions = api
    before = await groups(sessions)
    response = await post(client, IMPORT, request(bundle(groups=groups_value)))
    assert response.status_code == 400, response.text
    assert set(await groups(sessions)) == set(before)


async def test_round_trip_restores_group_access(api):
    client, sessions = api
    async with sessions() as session:
        model = await session.scalar(select(LLMModel).order_by(LLMModel.name))
        session.add(GroupModel(name="Night school", model_access=[str(model.id)], tool_access=["web_fetch"]))
        await session.execute(update(GroupModel).where(GroupModel.id == "student").values(tool_access=[]))
        await session.commit()
    original = await state(sessions)
    exported = await client.post("/settings/app/transfer/export", headers=auth(), json={"passphrase": PASSPHRASE})
    async with sessions() as session:
        await session.execute(delete(GroupModel).where(GroupModel.built_in.is_(False)))
        await session.execute(update(GroupModel).values(model_access=None, tool_access=None))
        await session.commit()
    response = await post(client, IMPORT, {"source": exported.text, "passphrase": PASSPHRASE})
    assert response.status_code == 200, response.text
    assert (await state(sessions)).groups == original.groups
