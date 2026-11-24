"""US-100.2: format version 2 carries everything an admin sets (EPIC-100)."""

import json
from types import SimpleNamespace

import pytest
from asterism.domains.groups.models import GroupModel
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings_transfer import documents
from asterism.domains.settings_transfer.documents import (
    ExportedGroup,
    ExportedMemory,
    ExportedOnnxImage,
    ExportedTheme,
    GroupBudget,
    GroupLimit,
    GroupReference,
)
from asterism.domains.settings_transfer.export import collect_settings
from asterism.domains.settings_transfer.themes import THEME_COLOR_KEYS
from sqlalchemy import select
from test_settings_export import api as _api
from test_settings_export import project_api as _project_api
from test_settings_import import IMPORT, PREVIEW, bundle, fast_scrypt, post, request

pytestmark = pytest.mark.asyncio
project_api = _project_api
api = _api
fast_scrypt = fast_scrypt

THEME = {
    "name": "Ocean",
    "type": "dark",
    "colors": dict.fromkeys(THEME_COLOR_KEYS, "#123456"),
    "radius": 0.5,
}


@pytest.fixture
def themes_root(tmp_path, monkeypatch):
    root = SimpleNamespace(storage_root=tmp_path)
    monkeypatch.setattr("asterism.domains.settings_transfer.export.config", root)
    monkeypatch.setattr("asterism.domains.settings_transfer.importer.config", root)
    return tmp_path / "themes"


async def setting(sessions, key):
    async with sessions() as session:
        row = await session.get(ApplicationSettingsModel, key)
        return None if row is None else row.value


def test_the_file_is_version_2_and_version_1_still_opens():
    assert documents.SETTINGS_FORMAT_VERSION == 2
    assert set(documents.SettingsEnvelope.model_fields["format_version"].annotation.__args__) == {1, 2}


def test_theme_color_keys_match_the_theme_editor():
    """The export validates themes with a copy of the editor's schema; keep them in step."""
    import re
    from pathlib import Path

    source = (Path(__file__).parents[2] / "frontend/src/features/theme/schemas.ts").read_text()
    block = source[source.index("themeColorsSchema") : source.index("});", source.index("themeColorsSchema"))]
    keys = re.findall(r'^\s+"?([a-z0-9-]+)"?: hexColor', block, re.M)
    assert tuple(keys) == THEME_COLOR_KEYS


async def test_group_limits_travel_by_name_and_a_missing_group_is_created(api, themes_root):
    client, sessions = api
    limit = GroupLimit(groups=(GroupReference(name="Student", built_in="student"), GroupReference(name="Year 9")))
    imported = await post(client, IMPORT, request(bundle(memory=ExportedMemory(enabled=True, group_limit=limit))))
    assert imported.status_code == 200, imported.text
    async with sessions() as session:
        year9 = await session.scalar(select(GroupModel).where(GroupModel.name == "Year 9"))
    assert year9 is not None
    assert await setting(sessions, "memory") == {"enabled": True, "group_ids": sorted(["student", year9.id])}

    every = await post(client, IMPORT, request(bundle(memory=ExportedMemory(enabled=True, group_limit=GroupLimit()))))
    assert every.status_code == 200
    assert await setting(sessions, "memory") == {"enabled": True, "group_ids": None}


async def test_budgets_time_zone_and_licenses_round_trip(api, themes_root):
    client, sessions = api
    group = ExportedGroup(
        name="Student",
        built_in="student",
        budget=GroupBudget(daily_token_budget=50_000, monthly_token_budget=900_000),
    )
    item = bundle(
        groups=(group,),
        usage_timezone="Europe/London",
        image_generation_onnx=ExportedOnnxImage(accepted_licenses=("not-a-catalog-model",)),
    )
    imported = await post(client, IMPORT, request(item))
    assert imported.status_code == 200, imported.text
    async with sessions() as session:
        student = await session.get(GroupModel, "student")
        assert (student.daily_token_budget, student.monthly_token_budget) == (50_000, 900_000)
        exported = await collect_settings(session)
    assert await setting(sessions, "usage_timezone") == "Europe/London"
    assert exported.usage_timezone == "Europe/London"
    # A license for a model this version doesn't have is skipped.
    assert (await setting(sessions, "image_generation_onnx"))["accepted_licenses"] == []
    [student_group] = [group for group in exported.groups if group.built_in == "student"]
    assert student_group.budget == GroupBudget(daily_token_budget=50_000, monthly_token_budget=900_000)

    bad = await post(client, IMPORT, request(bundle(usage_timezone="Mars/Olympus")))
    assert bad.status_code == 400


async def test_themes_round_trip_and_a_bad_one_refuses_the_import(api, themes_root):
    client, sessions = api
    imported = await post(client, IMPORT, request(bundle(themes=(ExportedTheme(id="ocean", document=THEME),))))
    assert imported.status_code == 200, imported.text
    assert json.loads((themes_root / "ocean.json").read_text())["name"] == "Ocean"
    async with sessions() as session:
        exported = await collect_settings(session)
    assert [theme.id for theme in exported.themes] == ["ocean"]

    invalid = ExportedTheme(id="broken", document={**THEME, "name": "Broken", "colors": {"background": "red"}})
    refused = await post(client, IMPORT, request(bundle(skills_enabled=True, themes=(invalid,))))
    assert refused.status_code == 400
    assert not (themes_root / "broken.json").exists()
    assert await setting(sessions, "skills_enabled") is not True  # nothing else was written

    clash = ExportedTheme(id="other", document={**THEME, "name": "ocean"})
    assert (await post(client, IMPORT, request(bundle(themes=(clash,))))).status_code == 400


async def test_a_version_1_file_changes_and_previews_none_of_the_new_parts(api, themes_root):
    client, sessions = api
    async with sessions() as session:
        session.add(ApplicationSettingsModel(key="memory", value={"enabled": True, "group_ids": ["student"]}))
        session.add(ApplicationSettingsModel(key="usage_timezone", value="Asia/Tokyo"))
        student = await session.get(GroupModel, "student")
        student.daily_token_budget = 1_000
        await session.commit()
    themes_root.mkdir()
    (themes_root / "ocean.json").write_text(json.dumps(THEME))
    # What a version 1 file holds: no group limit, budgets, time zone or themes.
    item = bundle(memory=ExportedMemory(enabled=True), groups=(ExportedGroup(name="Student", built_in="student"),))
    preview = await post(client, PREVIEW, request(item))
    assert preview.status_code == 200, preview.text
    changed = preview.json()["changed_settings"]
    assert not {"Memory policy", "Usage time zone", "Themes"} & set(changed)
    assert (await post(client, IMPORT, request(item))).status_code == 200
    assert await setting(sessions, "memory") == {"enabled": True, "group_ids": ["student"]}
    assert await setting(sessions, "usage_timezone") == "Asia/Tokyo"
    async with sessions() as session:
        assert (await session.get(GroupModel, "student")).daily_token_budget == 1_000
    assert (themes_root / "ocean.json").exists()
