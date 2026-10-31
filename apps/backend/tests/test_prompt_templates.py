"""US-51.1: template document bounds, owner-scoped CRUD, revisions and the read-only catalog."""

import asyncio
import copy
import uuid

import pytest
from asterism.core.exceptions import BadDataException, UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.domains.prompt_templates import catalog
from asterism.domains.prompt_templates.documents import (
    MAX_DOCUMENT_BYTES,
    Placeholder,
    parse_document,
    parse_document_json,
    split_body,
)
from asterism.domains.prompt_templates.models import PromptTemplateModel
from asterism.domains.user.models import UserModel
from sqlalchemy import delete, func, select
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
BASE = "/prompt-templates/"


def document(**overrides):
    value = {
        "name": "Summarize",
        "description": "Summarize a text for an audience.",
        "fields": [
            {"kind": "long_text", "key": "text", "label": "Text", "required": True},
            {
                "kind": "select",
                "key": "audience",
                "label": "Audience",
                "options": ["children", "experts"],
                "default": "experts",
            },
        ],
        "body": "Summarize this for {{audience}}:\n\n{{text}}",
    }
    value.update(overrides)
    return value


def with_field(field, body="{{text}} {{audience}} {{extra}}"):
    base = document()
    return document(fields=[*base["fields"], field], body=body)


@pytest.fixture
def templates_api(project_api, monkeypatch):
    def token(token):
        if token not in ("a", "b", "admin"):
            raise UnauthorizedException()
        return AuthedUser(
            id=token, email=f"{token}@example.test", name=token, role="admin" if token == "admin" else "user"
        )

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", token)
    return project_api


async def create(client, user="a", **overrides):
    response = await client.post(BASE, headers=auth(user), json={"document": document(**overrides)})
    assert response.status_code == 201, response.text
    return response.json()


# --- Document parser -------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        document(fields=[{"kind": "rich_text", "key": "text", "label": "Text"}], body="{{text}}"),
        document(fields=[{"key": "text", "label": "Text"}], body="{{text}}"),
        document(
            fields=[
                {"kind": "short_text", "key": "text", "label": "One"},
                {"kind": "long_text", "key": "text", "label": "Two"},
            ],
            body="{{text}}",
        ),
        document(body="{{text}} {{missing}} {{audience}}"),
        document(body="{{text}}"),  # Unused field.
        document(body="{{ text }} {{audience}}"),
        document(body="{{Text}} {{text}} {{audience}}"),
        document(body="{{text} {{audience}}"),
        document(body="{{text}} {{audience}} {{"),
        document(fields=[], body="Plain"),
        document(name="   "),
        document(description=""),
        document(body="x" * 16_001),
        document(name="x" * 81),
        document(fields=[{"kind": "short_text", "key": "1bad", "label": "Bad"}], body="{{1bad}}"),
        document(fields=[{"kind": "short_text", "key": "a" * 33, "label": "Long"}], body="{{" + "a" * 33 + "}}"),
        document(fields=[{"kind": "short_text", "key": "t", "label": "T", "required": "yes"}], body="{{t}}"),
        document(fields=[{"kind": "short_text", "key": "t", "label": "T", "tools": ["shell"]}], body="{{t}}"),
        document(fields=[{"kind": "select", "key": "t", "label": "T", "options": []}], body="{{t}}"),
        document(fields=[{"kind": "select", "key": "t", "label": "T", "options": ["a", "a"]}], body="{{t}}"),
        document(fields=[{"kind": "select", "key": "t", "label": "T", "options": ["a"], "default": "b"}], body="{{t}}"),
        document(fields=[{"kind": "examples", "key": "t", "label": "T", "default": ["x"] * 11}], body="{{t}}"),
        document(fields=[{"kind": "examples", "key": "t", "label": "T", "default": "x"}], body="{{t}}"),
        document(
            fields=[{"kind": "short_text", "key": f"f{i}", "label": "F"} for i in range(33)],
            body="".join(f"{{{{f{i}}}}}" for i in range(33)),
        ),
        document(body="{{text}} {{audience}} null\x00byte"),
        document(body="{{text}} {{audience}} \ud800"),
        document(allowed_tools=["shell"]),
        "not a mapping",
    ],
)
def test_rejects_invalid_unknown_or_unsafe_documents(value):
    with pytest.raises(BadDataException):
        parse_document(value)


def test_rejects_oversized_documents_before_and_after_decoding():
    fields = [{"kind": "long_text", "key": f"f{i}", "label": "F", "default": "é" * 4_000} for i in range(10)]
    big = document(fields=fields, body="".join(f"{{{{f{i}}}}}" for i in range(10)))
    with pytest.raises(BadDataException, match="exceeds"):
        parse_document(big)
    with pytest.raises(BadDataException, match="exceeds"):
        parse_document_json("x" * (MAX_DOCUMENT_BYTES + 1))
    with pytest.raises(BadDataException):
        parse_document_json("{not json")


def test_placeholder_grammar_escapes_and_repeats():
    body = "A {{text}} \\{{literal}} }} {{text}} \\ {{audience}}"
    assert split_body(body) == [
        "A ",
        Placeholder("text"),
        " {{literal}} }} ",
        Placeholder("text"),
        " \\ ",
        Placeholder("audience"),
    ]
    parsed = parse_document(document(body=body))
    assert parsed.body == body  # Source is stored verbatim; escapes are interpreted only when assembling.


def test_every_field_kind_parses_with_defaults():
    parsed = parse_document(
        with_field({"kind": "examples", "key": "extra", "label": "Examples", "default": ["a", "b"]})
    )
    assert [field.kind for field in parsed.fields] == ["long_text", "select", "examples"]
    assert parsed.fields[2].default == ("a", "b")
    assert (
        parse_document(with_field({"kind": "short_text", "key": "extra", "label": "S", "help": "h"})).fields[2].help
        == "h"
    )


# --- Catalog ---------------------------------------------------------------


def test_catalog_is_bundled_validated_and_immutable():
    assert list(catalog.FRAMEWORKS) == ["rtf", "co-star", "craft", "few-shot", "step-by-step"]
    for framework in catalog.FRAMEWORKS.values():
        assert parse_document(framework.document.model_dump()) == framework.document
        assert framework.revision >= 1
    with pytest.raises(TypeError):
        catalog.FRAMEWORKS["mine"] = catalog.FRAMEWORKS["rtf"]  # type: ignore[index]
    with pytest.raises(Exception):
        catalog.FRAMEWORKS["rtf"].document.name = "Changed"  # type: ignore[misc]
    with pytest.raises(Exception):
        catalog.FRAMEWORKS["rtf"].revision = 9  # type: ignore[misc]


@pytest.mark.asyncio
async def test_every_caller_lists_frameworks_and_none_can_write_them(templates_api):
    client, _, _ = templates_api
    assert (await client.get(BASE + "frameworks")).status_code == 401
    for user in ["a", "b", "admin"]:
        listing = await client.get(BASE + "frameworks", headers=auth(user))
        assert listing.status_code == 200, listing.text
        body = listing.json()
        assert body["version"] == catalog.CATALOG_VERSION
        assert [item["id"] for item in body["items"]] == list(catalog.FRAMEWORKS)
    one = (await client.get(BASE + "frameworks/co-star", headers=auth())).json()
    assert one["name"] == "CO-STAR" and one["revision"] == 1
    assert {field["key"] for field in one["document"]["fields"]} == {
        "context",
        "objective",
        "style",
        "tone",
        "audience",
        "response",
    }
    assert (await client.get(BASE + "frameworks/missing", headers=auth())).status_code == 404
    for method in ["put", "patch", "delete", "post"]:
        kwargs = {} if method == "delete" else {"json": {"document": document(), "expected_revision": 1}}
        response = await getattr(client, method)(BASE + "frameworks/rtf", headers=auth("admin"), **kwargs)
        assert response.status_code == 405, (method, response.status_code)
    assert (await client.post(BASE + "frameworks", headers=auth("admin"), json={})).status_code == 405
    # A framework duplicated into a template is an independent owned copy.
    copied = await client.post(BASE, headers=auth(), json={"document": one["document"]})
    assert copied.status_code == 201 and copied.json()["name"] == "CO-STAR"
    edited = copy.deepcopy(one["document"]) | {"name": "My CO-STAR"}
    path = BASE + copied.json()["id"]
    assert (
        await client.put(path, headers=auth(), json={"document": edited, "expected_revision": 1})
    ).status_code == 200
    assert (await client.get(BASE + "frameworks/co-star", headers=auth())).json() == one


# --- Owner-scoped CRUD -----------------------------------------------------


@pytest.mark.asyncio
async def test_crud_roundtrip_revisions_and_identical_foreign_404(templates_api):
    client, _, _ = templates_api
    assert (await client.get(BASE)).status_code == 401
    template = await create(client)
    assert template["revision"] == 1 and template["name"] == "Summarize"
    assert "user_id" not in template
    assert template["document"]["fields"][0]["kind"] == "long_text"
    path = BASE + template["id"]
    assert (await client.get(path, headers=auth())).json() == template
    missing = BASE + str(uuid.uuid4())
    for user, target in [("b", path), ("admin", path), ("a", missing)]:
        reads = await client.get(target, headers=auth(user))
        writes = await client.put(target, headers=auth(user), json={"document": document(), "expected_revision": 1})
        deletes = await client.delete(target + "?expected_revision=1", headers=auth(user))
        assert [reads.status_code, writes.status_code, deletes.status_code] == [404, 404, 404]
        assert reads.json() == writes.json() == deletes.json() == {"detail": "Prompt template not found", "code": 404}
    edited = await client.put(path, headers=auth(), json={"document": document(name="Brief"), "expected_revision": 1})
    assert edited.status_code == 200, edited.text
    assert edited.json()["name"] == "Brief" and edited.json()["revision"] == 2
    stale = await client.put(path, headers=auth(), json={"document": document(), "expected_revision": 1})
    assert stale.status_code == 409
    assert (await client.delete(path + "?expected_revision=1", headers=auth())).status_code == 409
    assert (await client.get(path, headers=auth())).json() == edited.json()
    assert (await client.delete(path + "?expected_revision=2", headers=auth())).status_code == 204
    assert (await client.get(path, headers=auth())).status_code == 404


@pytest.mark.asyncio
async def test_invalid_payloads_rejected_without_writes(templates_api):
    client, sessions, _ = templates_api
    template = await create(client)
    path = BASE + template["id"]
    semantic = document(body="{{text}} {{audience}} {{ghost}}")
    assert (await client.post(BASE, headers=auth(), json={"document": semantic})).status_code == 400
    assert (
        await client.put(path, headers=auth(), json={"document": semantic, "expected_revision": 1})
    ).status_code == 400
    unknown_kind = document(fields=[{"kind": "code", "key": "text", "label": "T"}], body="{{text}}")
    assert (await client.post(BASE, headers=auth(), json={"document": unknown_kind})).status_code == 422
    for extra in [{"user_id": "b"}, {"name": "spoof"}, {"revision": 4}, {"tools": ["sub_agent"]}]:
        response = await client.post(BASE, headers=auth(), json={"document": document(), **extra})
        assert response.status_code == 422
    for revision in [0, 2**31]:
        response = await client.put(path, headers=auth(), json={"document": document(), "expected_revision": revision})
        assert response.status_code == 422
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(PromptTemplateModel)) == 1
    assert (await client.get(path, headers=auth())).json() == template


@pytest.mark.asyncio
async def test_search_filters_before_pagination_and_lists_omit_documents(templates_api):
    client, _, _ = templates_api
    for i in range(4):
        await create(client, name=f"Template {i}", description=f"Topic {i}")
    await create(client, user="b", name="Foreign Topic 3")
    page = (await client.get(BASE + "?page_size=2", headers=auth())).json()
    assert page["total"] == 4 and len(page["items"]) == 2
    assert all("document" not in item for item in page["items"])
    second = (await client.get(BASE + "?page_size=2&page=2", headers=auth())).json()
    assert len({item["id"] for item in page["items"] + second["items"]}) == 4
    matches = (await client.get(BASE + "?query=Topic%203", headers=auth())).json()
    assert matches["total"] == 1 and matches["items"][0]["name"] == "Template 3"
    assert (await client.get(BASE + "?query=%25", headers=auth())).json()["total"] == 0
    for query in ["page=0", "page_size=0", "page_size=101", "query=" + "a" * 201]:
        assert (await client.get(BASE + "?" + query, headers=auth())).status_code == 422


@pytest.mark.asyncio
async def test_concurrent_updates_have_one_winner(templates_api):
    client, _, _ = templates_api
    template = await create(client)
    writes = await asyncio.gather(
        *[
            client.put(
                BASE + template["id"],
                headers=auth(),
                json={"document": document(name=f"Winner {i}"), "expected_revision": 1},
            )
            for i in range(2)
        ]
    )
    assert sorted(response.status_code for response in writes) == [200, 409]
    final = (await client.get(BASE + template["id"], headers=auth())).json()
    assert final["revision"] == 2


@pytest.mark.asyncio
async def test_user_deletion_cascades_templates(templates_api):
    client, sessions, _ = templates_api
    await create(client, user="b")
    async with sessions() as session:
        await session.execute(delete(UserModel).where(UserModel.id == "b"))
        await session.commit()
        assert await session.scalar(select(func.count()).select_from(PromptTemplateModel)) == 0
