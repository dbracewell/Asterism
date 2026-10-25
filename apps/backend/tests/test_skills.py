"""US-40.1: document boundaries, private CRUD, assignments, and fail-closed policy."""

import asyncio
import uuid

import pytest
from asterism.core.exceptions import BadDataException, UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.skills.documents import parse_document
from asterism.domains.skills.models import AgentSkillModel, SkillModel
from asterism.domains.user.models import UserModel
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
ASSIGNMENTS = "/settings/user/main-agent/skills"
POLICY = "/settings/app/skills"


def document(name="review-code", description="Review code carefully.", body="# Review\nCheck edge cases."):
    return f"---\nname: {name}\ndescription: {description}\n---\n{body}\n"


@pytest.fixture
def skills_api(project_api, monkeypatch):
    def token(token):
        if token not in ("a", "b", "admin"):
            raise UnauthorizedException()
        return AuthedUser(
            id=token, email=f"{token}@example.test", name=token, role="admin" if token == "admin" else "user"
        )

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", token)
    return project_api


async def create(client, name="review-code", user="a", **kwargs):
    response = await client.post("/skills/", headers=auth(user), json={"content": document(name, **kwargs)})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize(
    "content",
    [
        "",
        "# Missing frontmatter",
        "\n" + document(),
        "---\nname: test\n---\nBody",
        "---\nname: test\ndescription: Test\nBody",
        document("Bad_Name"),
        document("bad--name"),
        document("/bad"),
        document("é"),
        document("a" * 65),
        document(description="''"),
        document(description="123"),
        document(description="true"),
        document(body="  "),
        document(description="x" * 1025),
        document(body="x" * 65536),
        document(body="é" * 33000),
        "---\nname: a\nname: b\ndescription: D\n---\nBody",
        "---\nname: a\ndescription: D\nallowed-tools: [shell]\n---\nBody",
        "---\nname: a\ndescription: D\nscripts: evil.py\n---\nBody",
        "---\nname: &name a\ndescription: *name\n---\nBody",
        "---\nname: a\ndescription: !!str D\n---\nBody",
        "---\nname: a\ndescription: !!python/object/apply:os.system ['whoami']\n---\nBody",
        "---\nname: a\ndescription: {nested: value}\n---\nBody",
        "---\n- name\n- description\n---\nBody",
        "---\n[\n---\nBody",
        "---\nname: a\ndescription: D\n" + "# filler\n" * 1100 + "---\nBody",
        document(body="null\x00byte"),
        document(body="\ud800"),
    ],
)
def test_rejects_invalid_unsafe_or_oversized_documents(content):
    with pytest.raises(BadDataException):
        parse_document(content)


def test_frontmatter_scalars_and_source_contract():
    source = (
        '---\r\nname: "review-code"\r\ndescription: >-\r\n  Review code\r\n  carefully.\r\n---\r\n# Instructions\r\n'
    )
    metadata = parse_document(source)
    assert metadata.name == "review-code"
    assert metadata.description == "Review code carefully."
    assert parse_document(document("a" * 64)).name == "a" * 64


@pytest.mark.asyncio
async def test_private_crud_roundtrip_conflicts_and_cross_user_denial(skills_api):
    client, _, _ = skills_api
    assert (await client.get("/skills/")).status_code == 401
    source = document(body="# Review\nKeep **Markdown** and original whitespace.\n")
    response = await client.post("/skills/", headers=auth(), json={"content": source})
    assert response.status_code == 201, response.text
    skill = response.json()
    assert skill["content"] == source and skill["revision"] == 1
    assert skill["name"] == "review-code" and "user_id" not in skill
    path = f"/skills/{skill['id']}"
    assert (await client.get(path, headers=auth())).json() == skill
    assert (await client.post("/skills/", headers=auth(), json={"content": source})).status_code == 409
    await create(client, user="b")  # Names are unique per owner, not globally.
    for user in ["b", "admin"]:
        assert (await client.get(path, headers=auth(user))).status_code == 404
        assert (
            await client.put(path, headers=auth(user), json={"content": source, "expected_revision": 1})
        ).status_code == 404
        assert (await client.delete(path + "?expected_revision=1", headers=auth(user))).status_code == 404
    edited = await client.put(path, headers=auth(), json={"content": document("new-name"), "expected_revision": 1})
    assert edited.status_code == 200, edited.text
    assert edited.json()["name"] == "new-name" and edited.json()["revision"] == 2
    assert (await client.put(path, headers=auth(), json={"content": source, "expected_revision": 1})).status_code == 409
    assert (await client.delete(path + "?expected_revision=1", headers=auth())).status_code == 409
    assert (await client.get(path, headers=auth())).json() == edited.json()
    assert (await client.delete(path + "?expected_revision=2", headers=auth())).status_code == 204
    assert (await client.get(path, headers=auth())).status_code == 404


@pytest.mark.asyncio
async def test_search_filters_before_pagination_and_metadata_is_not_client_writable(skills_api):
    client, _, _ = skills_api
    for i in range(4):
        await create(client, f"review-{i}", description=f"Topic {i}")
    await create(client, "foreign-review", user="b")
    page = (await client.get("/skills/?page_size=2", headers=auth())).json()
    assert page["total"] == 4 and len(page["items"]) == 2
    assert all("content" not in item for item in page["items"])
    second = (await client.get("/skills/?page_size=2&page=2", headers=auth())).json()
    assert len({item["id"] for item in page["items"] + second["items"]}) == 4
    matches = (await client.get("/skills/?query=Topic%203&page_size=1", headers=auth())).json()
    assert matches["total"] == 1 and matches["items"][0]["name"] == "review-3"
    assert (await client.get("/skills/?query=%25", headers=auth())).json()["total"] == 0
    for query in ["page=0", "page_size=0", "page_size=101", "query=" + "a" * 201]:
        assert (await client.get("/skills/?" + query, headers=auth())).status_code == 422
    for extra in [{"user_id": "b"}, {"name": "spoof"}, {"tools": ["sub_agent"]}, {"revision": 4}]:
        assert (await client.post("/skills/", headers=auth(), json={"content": document(), **extra})).status_code == 422
    assert (await client.post("/skills/", headers=auth(), json={"content": document("UPPER")})).status_code == 400


@pytest.mark.asyncio
async def test_concurrent_updates_and_duplicate_creation_are_atomic(skills_api):
    client, _, _ = skills_api
    skill = await create(client)
    writes = await asyncio.gather(
        *[
            client.put(
                f"/skills/{skill['id']}",
                headers=auth(),
                json={"content": document(f"winner-{i}"), "expected_revision": 1},
            )
            for i in range(2)
        ]
    )
    assert sorted(r.status_code for r in writes) == [200, 409]
    creates = await asyncio.gather(
        *[client.post("/skills/", headers=auth(), json={"content": document("duplicate")}) for _ in range(2)]
    )
    assert sorted(r.status_code for r in creates) == [201, 409]


@pytest.mark.asyncio
async def test_assignment_and_admin_policy_intersection_with_cas_and_deletion(skills_api):
    client, _, _ = skills_api
    one = await create(client, "one")
    two = await create(client, "two")
    foreign = await create(client, "foreign", user="b")
    current = (await client.get(ASSIGNMENTS, headers=auth())).json()
    assert current["skill_ids"] == []
    assert (await client.get(POLICY, headers=auth())).status_code == 401
    assert (await client.put(POLICY, headers=auth(), json={"enabled": True})).status_code == 401
    assert (await client.get(POLICY, headers=auth("admin"))).json() == {"enabled": False}
    for ids, code in [([foreign["id"]], 404), ([one["id"], one["id"]], 400), ([str(uuid.uuid4())], 404)]:
        response = await client.put(
            ASSIGNMENTS, headers=auth(), json={"skill_ids": ids, "expected_revision": current["revision"]}
        )
        assert response.status_code == code, response.text
    assigned = await client.put(
        ASSIGNMENTS, headers=auth(), json={"skill_ids": [one["id"]], "expected_revision": current["revision"]}
    )
    assert assigned.status_code == 200, assigned.text
    selection = assigned.json()
    assert selection["revision"] == current["revision"] + 1
    assert (await client.get("/skills/eligible", headers=auth())).json()["items"] == []
    assert (await client.put(POLICY, headers=auth("admin"), json={"enabled": "true"})).status_code == 422
    assert (await client.put(POLICY, headers=auth("admin"), json={"enabled": True})).json() == {"enabled": True}
    eligible = (await client.get("/skills/eligible?page_size=1", headers=auth())).json()
    assert eligible["policy_enabled"] is True and eligible["total"] == 1
    assert [item["id"] for item in eligible["items"]] == [one["id"]]
    assert "content" not in eligible["items"][0]
    assert (await client.get("/skills/eligible?query=two", headers=auth())).json()["total"] == 0
    assert (await client.get("/skills/eligible", headers=auth("b"))).json()["items"] == []
    # A stale replace must not clear an existing assignment.
    assert (
        await client.put(
            ASSIGNMENTS, headers=auth(), json={"skill_ids": [two["id"]], "expected_revision": current["revision"]}
        )
    ).status_code == 409
    assert (await client.get(ASSIGNMENTS, headers=auth())).json() == selection
    # A stale delete must roll back both the delete and any revision bump.
    assert (await client.delete(f"/skills/{one['id']}?expected_revision=2", headers=auth())).status_code == 409
    assert (await client.get(ASSIGNMENTS, headers=auth())).json() == selection
    assert (await client.delete(f"/skills/{one['id']}?expected_revision=1", headers=auth())).status_code == 204
    after = (await client.get(ASSIGNMENTS, headers=auth())).json()
    assert after["skill_ids"] == [] and after["revision"] == selection["revision"] + 1
    assert (await client.get("/skills/eligible", headers=auth())).json()["items"] == []
    assert (await client.put(POLICY, headers=auth("admin"), json={"enabled": False})).json() == {"enabled": False}


@pytest.mark.asyncio
async def test_generic_policy_routes_validate_boolean_and_do_not_bypass_admin(skills_api):
    client, sessions, _ = skills_api
    url = "/settings/app/skills_enabled"
    for value in ["true", 1, {}, []]:
        assert (await client.put(url, headers=auth("admin"), json={"value": value})).status_code == 400
    assert (await client.put(url, headers=auth(), json={"value": True})).status_code == 401
    assert (await client.put(url, headers=auth("admin"), json={"value": True})).status_code == 200
    assert (await client.get(POLICY, headers=auth("admin"))).json()["enabled"] is True
    assert (await client.delete(url, headers=auth("admin"))).status_code == 200
    assert (await client.get(POLICY, headers=auth("admin"))).json()["enabled"] is False
    async with sessions() as db:
        db.add(ApplicationSettingsModel(key="skills_enabled", value="true"))
        await db.commit()
    assert (await client.get(POLICY, headers=auth("admin"))).json()["enabled"] is False


@pytest.mark.asyncio
async def test_fresh_schema_enforces_assignment_owner_role_uniqueness_and_cascades(skills_api):
    client, sessions, _ = skills_api
    a = await create(client)
    b = await create(client, user="b")
    main_a = (await client.get("/settings/user/main-agent", headers=auth())).json()["id"]
    main_b = (await client.get("/settings/user/main-agent", headers=auth("b"))).json()["id"]
    async with sessions() as db:
        worker = AgentProfileModel(
            user_id="a", sub_agent=True, model_id=uuid.UUID(int=1), name="Worker", description=""
        )
        db.add(worker)
        await db.commit()
        worker_id = worker.id
    invalid = [
        {"agent_id": uuid.UUID(main_a), "user_id": "a", "skill_id": uuid.UUID(b["id"])},
        {"agent_id": uuid.UUID(main_b), "user_id": "a", "skill_id": uuid.UUID(a["id"])},
        {"agent_id": worker_id, "user_id": "a", "skill_id": uuid.UUID(a["id"]), "sub_agent": False},
        {"agent_id": worker_id, "user_id": "a", "skill_id": uuid.UUID(a["id"]), "sub_agent": True},
    ]
    for values in invalid:
        async with sessions() as db:
            with pytest.raises(IntegrityError):
                await db.execute(insert(AgentSkillModel).values(**values))
                await db.commit()
            await db.rollback()
    async with sessions() as db:
        db.add(AgentSkillModel(agent_id=uuid.UUID(main_a), user_id="a", skill_id=uuid.UUID(a["id"])))
        await db.commit()
        with pytest.raises(IntegrityError):
            await db.execute(
                insert(SkillModel).values(user_id="a", name=a["name"], description="D", content=document())
            )
            await db.commit()
        await db.rollback()
        with pytest.raises(IntegrityError):
            await db.execute(update(SkillModel).where(SkillModel.id == uuid.UUID(a["id"])).values(revision=0))
            await db.commit()
        await db.rollback()
        await db.execute(delete(UserModel).where(UserModel.id == "a"))
        await db.commit()
        assert await db.scalar(select(func.count()).select_from(AgentSkillModel)) == 0
        assert list(await db.scalars(select(SkillModel.user_id))) == ["b"]


@pytest.mark.parametrize("nested", ["[" * 1000 + "x" + "]" * 1000, "{a: " * 500 + "x" + "}" * 500])
def test_nested_yaml_is_rejected_before_recursive_composition(nested):
    with pytest.raises(BadDataException):
        parse_document(f"---\nname: test\ndescription: {nested}\n---\nBody")


@pytest.mark.asyncio
async def test_concurrent_assignment_replacement_and_rename_collision_preserve_state(skills_api):
    client, _, _ = skills_api
    one = await create(client, "one")
    two = await create(client, "two")
    current = (await client.get(ASSIGNMENTS, headers=auth())).json()
    results = await asyncio.gather(
        *[
            client.put(
                ASSIGNMENTS, headers=auth(), json={"skill_ids": [skill["id"]], "expected_revision": current["revision"]}
            )
            for skill in [one, two]
        ]
    )
    assert sorted(r.status_code for r in results) == [200, 409]
    winner = next(r.json() for r in results if r.status_code == 200)
    assert (await client.get(ASSIGNMENTS, headers=auth())).json() == winner
    response = await client.put(
        f"/skills/{one['id']}", headers=auth(), json={"content": document("two"), "expected_revision": 1}
    )
    assert response.status_code == 409
    assert (await client.get(f"/skills/{one['id']}", headers=auth())).json() == one
    # Editing unrelated main-agent settings must retain assignments.
    assert (
        await client.put("/settings/user/main-agent", headers=auth(), json={"system_prompt": "Updated"})
    ).status_code == 200
    assert (await client.get(ASSIGNMENTS, headers=auth())).json()["skill_ids"] == winner["skill_ids"]
    revision = (await client.get(ASSIGNMENTS, headers=auth())).json()["revision"]
    assert (
        await client.put(ASSIGNMENTS, headers=auth(), json={"skill_ids": [], "expected_revision": revision})
    ).json()["skill_ids"] == []


@pytest.mark.asyncio
async def test_canonical_source_roundtrips_with_crlf_and_generic_bulk_policy_is_strict(skills_api):
    client, _, _ = skills_api
    source = (
        '---\r\nname: "review-code"\r\ndescription: >-\r\n  Review code\r\n  carefully.\r\n---\r\n# Instructions\r\n'
    )
    response = await client.post("/skills/", headers=auth(), json={"content": source})
    assert response.status_code == 201, response.text
    skill = response.json()
    assert skill["content"] == source and skill["description"] == "Review code carefully."
    assert (await client.get(f"/skills/{skill['id']}", headers=auth())).json()["content"] == source
    assert (
        await client.patch("/settings/app", headers=auth("admin"), json={"values": {"skills_enabled": "true"}})
    ).status_code == 400
    assert (await client.get(POLICY, headers=auth("admin"))).json() == {"enabled": False}
    assert (
        await client.patch("/settings/app", headers=auth("admin"), json={"values": {"skills_enabled": True}})
    ).status_code == 200
    assert (await client.get(POLICY, headers=auth("admin"))).json() == {"enabled": True}


@pytest.mark.asyncio
async def test_revision_inputs_cannot_overflow_storage_integers(skills_api):
    client, _, _ = skills_api
    skill = await create(client)
    oversized = 2**80
    assert (
        await client.put(
            f"/skills/{skill['id']}", headers=auth(), json={"content": document(), "expected_revision": oversized}
        )
    ).status_code == 422
    assert (
        await client.delete(f"/skills/{skill['id']}?expected_revision={oversized}", headers=auth())
    ).status_code == 422
    assert (
        await client.put(ASSIGNMENTS, headers=auth(), json={"skill_ids": [], "expected_revision": oversized})
    ).status_code == 422
