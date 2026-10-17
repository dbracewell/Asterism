"""Fresh initialization exposes only the supported project/chat product model."""

from pathlib import Path

import httpx
import pytest
from asterism.db.base import Base
from asterism.domains.chat.search_index import initialize_search_index
from asterism.main import app
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


@pytest.mark.asyncio
async def test_fresh_schema_and_search_have_no_obsolete_collections(tmp_path: Path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'fresh.db'}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
            await initialize_search_index(connection)
            objects = set(
                (await connection.execute(text("SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger')")))
                .scalars()
                .all(),
            )
    finally:
        await engine.dispose()

    assert {
        "projects",
        "project_files",
        "project_sub_agents",
        "chats",
        "chat_files",
        "chat_drafts",
        "chat_draft_files",
        "chat_send_receipts",
        "agent_profiles",
        "user_files",
        "file_extractions",
        "chat_search",
        "project_search",
        "chat_search_chats_ai",
        "project_search_ai",
    } <= objects
    assert not any("folder" in name or "knowledge_base" in name for name in objects)
    assert "knowledge_documents" not in objects


def test_openapi_preserves_supported_context_and_processing_contracts():
    schema = app.openapi()
    paths = schema["paths"]
    assert not any("folder" in path or "knowledge-base" in path for path in paths)
    assert "/agents/" not in paths
    assert "/agents/{agent_id}" not in paths
    assert {
        "/projects/",
        "/projects/{project_id}/files",
        "/projects/{project_id}/sub-agents",
        "/settings/user/main-agent",
        "/agents/sub-agents",
        "/chat/models",
        "/chat/{chat_id}/model",
        "/chat/{chat_id}/files/context",
        "/chat/drafts/{draft_id}/uploads",
        "/files/{filename}/knowledge",
        "/settings/app/providers",
        "/settings/app/captioning",
        "/settings/app/knowledge-processing-profile",
    } <= paths.keys()
    schemas = schema["components"]["schemas"]
    assert not any("Folder" in name or "KnowledgeBase" in name or name == "UserAgents" for name in schemas)
    main = schemas["MainAgentConfiguration"]["properties"]
    assert "model_id" not in main
    assert "default_agent" not in main
    assert "model_id" in schemas["SubAgentDefinition"]["required"]
    assert {"project_id", "selected_model_id", "model_revision"} <= schemas["ChatInfo"]["properties"].keys()
    assert "projects" in schemas["UserFile"]["properties"]
    assert not {"knowledge_base_count", "in_checked_knowledge_base"} & schemas["UserFile"]["properties"].keys()
    file_parameters = {item["name"] for item in paths["/files/"]["get"]["parameters"]}
    assert not {"knowledge_base_id", "check_knowledge_base_id"} & file_parameters
    serialized = str(schemas)
    assert "default_agent_id" not in serialized
    assert "knowledge_base_ids" not in serialized


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/folders/", "/knowledge-bases/", "/files/report.txt/knowledge-bases"])
async def test_removed_routes_are_not_mounted(path: str):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get(path)).status_code == 404
