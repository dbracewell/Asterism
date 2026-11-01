"""US-53.1: owner- and project-scoped decks and cards, citations and cascade deletion."""

import uuid

import pytest
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.projects.models import ProjectFileModel, ProjectModel
from asterism.domains.study.models import StudyCardModel, StudyDeckModel
from asterism.domains.user.models import UserModel
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

project_api = _project_api


def decks_path(project_id):
    return f"/projects/{project_id}/study/decks"


async def create_deck(client, project_id, user="a", **fields):
    response = await client.post(decks_path(project_id), headers=auth(user), json={"name": "Biology", **fields})
    assert response.status_code == 201, response.text
    return response.json()


async def create_card(client, project_id, deck_id, user="a", **fields):
    body = {"front": "What is ATP?", "back": "The cell's energy currency.", **fields}
    response = await client.post(f"{decks_path(project_id)}/{deck_id}/cards", headers=auth(user), json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def add_file(sessions, user, project_id=None, name="notes.txt"):
    async with sessions() as session:
        file = UserFileModel(
            user_id=user,
            filename=name,
            original_name=name,
            storage_key=str(uuid.uuid4()),
            size=1,
            mime_type="text/plain",
            kind=FileKind.TEXT,
            sha256="a" * 64,
        )
        session.add(file)
        await session.flush()
        if project_id is not None:
            session.add(ProjectFileModel(project_id=uuid.UUID(project_id), file_id=file.id, user_id=user))
        await session.commit()
        return str(file.id)


async def count(sessions, model):
    async with sessions() as session:
        return await session.scalar(select(func.count()).select_from(model))


@pytest.mark.asyncio
async def test_deck_and_card_lifecycle(project_api):
    client, _, _ = project_api
    project = await create(client)
    deck = await create_deck(client, project["id"], name="  Biology  ", description="Unit 1")
    assert deck["name"] == "Biology"
    assert deck["project_id"] == project["id"]
    assert deck["card_count"] == 0
    deck_path = f"{decks_path(project['id'])}/{deck['id']}"

    card = await create_card(client, project["id"], deck["id"])
    assert card["citations"] == []
    card_path = f"{deck_path}/cards/{card['id']}"
    assert (await client.get(card_path, headers=auth())).json() == card
    assert (await client.get(deck_path, headers=auth())).json()["card_count"] == 1

    updated = await client.patch(card_path, headers=auth(), json={"back": "Adenosine triphosphate"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["front"] == card["front"]
    assert updated.json()["back"] == "Adenosine triphosphate"

    renamed = await client.patch(deck_path, headers=auth(), json={"name": "Cell biology"})
    assert renamed.status_code == 200
    assert renamed.json()["description"] == "Unit 1"
    assert renamed.json()["name"] == "Cell biology"

    second = await create_card(client, project["id"], deck["id"], front="Q2", back="A2")
    listing = (await client.get(f"{deck_path}/cards", headers=auth())).json()
    assert listing["total"] == 2
    assert {item["id"] for item in listing["items"]} == {card["id"], second["id"]}
    decks = (await client.get(decks_path(project["id"]), headers=auth())).json()
    assert decks["total"] == 1
    assert decks["items"][0]["card_count"] == 2

    assert (await client.delete(card_path, headers=auth())).status_code == 204
    assert (await client.get(card_path, headers=auth())).status_code == 404
    assert (await client.delete(deck_path, headers=auth())).status_code == 204
    assert (await client.get(deck_path, headers=auth())).status_code == 404
    assert (await client.get(decks_path(project["id"]), headers=auth())).json()["total"] == 0


@pytest.mark.asyncio
async def test_pagination_is_deterministic(project_api):
    client, _, _ = project_api
    project = await create(client)
    ids = {(await create_deck(client, project["id"], name=f"Deck {i}"))["id"] for i in range(5)}
    seen = []
    for page in (1, 2, 3):
        response = await client.get(decks_path(project["id"]), headers=auth(), params={"page": page, "page_size": 2})
        body = response.json()
        assert body["total"] == 5
        seen.extend(item["id"] for item in body["items"])
    assert len(seen) == 5
    assert set(seen) == ids


@pytest.mark.asyncio
async def test_foreign_and_missing_records_share_one_404(project_api):
    client, _, _ = project_api
    project = await create(client)
    other_project = await create(client, name="Other")
    deck = await create_deck(client, project["id"])
    other_deck = await create_deck(client, other_project["id"])
    card = await create_card(client, project["id"], deck["id"])
    base = decks_path(project["id"])
    missing = str(uuid.uuid4())

    async def not_found(method, path, user="a", **kwargs):
        response = await client.request(method, path, headers=auth(user), **kwargs)
        assert response.status_code == 404, (method, path, response.text)
        return response.json()

    card_body = {"json": {"front": "Q", "back": "A"}}
    deck_body = {"json": {"name": "X"}}
    # User b sees a's project exactly as if it did not exist.
    for path in (base, decks_path(missing)):
        bodies = [
            await not_found("GET", path, user="b"),
            await not_found("POST", path, user="b", **deck_body),
            await not_found("GET", f"{path}/{deck['id']}", user="b"),
            await not_found("PATCH", f"{path}/{deck['id']}", user="b", **deck_body),
            await not_found("DELETE", f"{path}/{deck['id']}", user="b"),
            await not_found("GET", f"{path}/{deck['id']}/cards", user="b"),
            await not_found("POST", f"{path}/{deck['id']}/cards", user="b", **card_body),
            await not_found("GET", f"{path}/{deck['id']}/cards/{card['id']}", user="b"),
            await not_found("PATCH", f"{path}/{deck['id']}/cards/{card['id']}", user="b", **card_body),
            await not_found("DELETE", f"{path}/{deck['id']}/cards/{card['id']}", user="b"),
        ]
        assert all(body == bodies[0] for body in bodies)
    foreign = [await not_found("GET", base, user="b"), await not_found("GET", decks_path(missing), user="b")]
    assert foreign[0] == foreign[1]

    # A deck reached through the wrong project, and a card through the wrong deck, are missing.
    wrong_project = await not_found("GET", f"{decks_path(other_project['id'])}/{deck['id']}")
    assert wrong_project == await not_found("GET", f"{base}/{missing}")
    await not_found("GET", f"{base}/{other_deck['id']}")
    wrong_deck = f"{decks_path(other_project['id'])}/{other_deck['id']}/cards/{card['id']}"
    assert await not_found("GET", wrong_deck) == await not_found("GET", f"{base}/{deck['id']}/cards/{missing}")
    await not_found("PATCH", wrong_deck, **card_body)
    await not_found("DELETE", wrong_deck)

    # Nothing changed for the owner.
    assert (await client.get(f"{base}/{deck['id']}/cards/{card['id']}", headers=auth())).json() == card


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["GET", "POST"])
async def test_routes_require_auth(project_api, method):
    client, _, _ = project_api
    project = await create(client)
    response = await client.request(method, decks_path(project["id"]), json={"name": "X"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_database_pins_decks_and_cards_to_their_owner(project_api):
    client, sessions, _ = project_api
    project = await create(client)
    deck = await create_deck(client, project["id"])
    async with sessions() as session:
        session.add(StudyDeckModel(user_id="b", project_id=uuid.UUID(project["id"]), name="Stolen"))
        with pytest.raises(IntegrityError):
            await session.commit()
    async with sessions() as session:
        session.add(StudyCardModel(user_id="b", deck_id=uuid.UUID(deck["id"]), front="Q", back="A"))
        with pytest.raises(IntegrityError):
            await session.commit()


@pytest.mark.asyncio
async def test_deleting_a_project_or_user_cascades_to_decks_and_cards(project_api):
    client, sessions, _ = project_api
    project = await create(client)
    kept = await create(client, name="Kept")
    deck = await create_deck(client, project["id"])
    await create_card(client, project["id"], deck["id"])
    kept_deck = await create_deck(client, kept["id"])
    await create_card(client, kept["id"], kept_deck["id"])

    response = await client.delete(
        f"/projects/{project['id']}", headers=auth(), params={"expected_context_revision": 1}
    )
    assert response.status_code == 200, response.text
    assert await count(sessions, StudyDeckModel) == 1
    assert await count(sessions, StudyCardModel) == 1
    assert (await client.get(f"{decks_path(kept['id'])}/{kept_deck['id']}", headers=auth())).status_code == 200

    async with sessions() as session:
        await session.execute(delete(ProjectModel).where(ProjectModel.user_id == "a"))
        await session.execute(delete(UserModel).where(UserModel.id == "a"))
        await session.commit()
    assert await count(sessions, StudyDeckModel) == 0
    assert await count(sessions, StudyCardModel) == 0


@pytest.mark.asyncio
async def test_deleting_a_deck_deletes_only_its_cards(project_api):
    client, sessions, _ = project_api
    project = await create(client)
    first, second = await create_deck(client, project["id"]), await create_deck(client, project["id"], name="Two")
    await create_card(client, project["id"], first["id"])
    await create_card(client, project["id"], second["id"])
    assert (await client.delete(f"{decks_path(project['id'])}/{first['id']}", headers=auth())).status_code == 204
    async with sessions() as session:
        remaining = list(await session.scalars(select(StudyCardModel.deck_id)))
    assert remaining == [uuid.UUID(second["id"])]


@pytest.mark.asyncio
async def test_citations_must_be_in_project_scope_and_track_live_membership(project_api):
    client, sessions, _ = project_api
    project = await create(client)
    other = await create(client, name="Other")
    deck = await create_deck(client, project["id"])
    member = await add_file(sessions, "a", project["id"], name="lecture.txt")
    unattached = await add_file(sessions, "a", other["id"], name="elsewhere.txt")
    foreign = await add_file(sessions, "b", name="theirs.txt")
    citation = {"file_id": member, "chunk_id": "chunk-1", "artifact_generation": 2, "excerpt": "ATP stores energy"}

    card = await create_card(client, project["id"], deck["id"], citations=[citation])
    assert card["citations"] == [{**citation, "available": True, "file_name": "lecture.txt"}]

    cards_path = f"{decks_path(project['id'])}/{deck['id']}/cards"
    rejected = []
    for file_id in (unattached, foreign, str(uuid.uuid4())):
        response = await client.post(
            cards_path, headers=auth(), json={"front": "Q", "back": "A", "citations": [{"file_id": file_id}]}
        )
        assert response.status_code == 400, response.text
        rejected.append(response.json())
        patched = await client.patch(
            f"{cards_path}/{card['id']}", headers=auth(), json={"citations": [{"file_id": file_id}]}
        )
        assert patched.status_code == 400
    assert rejected[0] == rejected[1] == rejected[2]

    # Removing the file from the project keeps the citation but marks it unavailable.
    async with sessions() as session:
        await session.execute(delete(ProjectFileModel).where(ProjectFileModel.file_id == uuid.UUID(member)))
        await session.commit()
    stored = (await client.get(f"{cards_path}/{card['id']}", headers=auth())).json()
    assert stored["citations"] == [{**citation, "available": False, "file_name": None}]
    listed = (await client.get(cards_path, headers=auth())).json()["items"][0]
    assert listed["citations"] == stored["citations"]

    cleared = await client.patch(f"{cards_path}/{card['id']}", headers=auth(), json={"citations": []})
    assert cleared.json()["citations"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {"name": "   "},
        {"name": "x" * 121},
        {"name": "Deck", "description": "x" * 2001},
        {"name": "Deck", "project_id": str(uuid.uuid4())},
        {},
    ],
)
async def test_deck_validation(project_api, body):
    client, _, _ = project_api
    project = await create(client)
    response = await client.post(decks_path(project["id"]), headers=auth(), json=body)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("create_body", "patch_body"),
    [
        ({"front": " ", "back": "A"}, {"front": " "}),
        ({"front": "Q", "back": "x" * 4001}, {"back": "x" * 4001}),
        ({"front": "Q", "back": "A", "citations": [{"file_id": str(uuid.uuid4())}] * 9}, {"citations": None}),
        ({"front": "Q", "back": "A", "citations": [{"file_id": "not-a-uuid"}]}, {"front": None}),
        ({"front": "Q", "back": "A", "user_id": "b"}, {"deck_id": str(uuid.uuid4())}),
        (
            {"front": "Q", "back": "A", "citations": [{"file_id": str(uuid.uuid4()), "excerpt": "x" * 1001}]},
            {"citations": [{"file_id": str(uuid.uuid4()), "url": "https://example.test"}]},
        ),
    ],
)
async def test_card_validation(project_api, create_body, patch_body):
    client, _, _ = project_api
    project = await create(client)
    deck = await create_deck(client, project["id"])
    card = await create_card(client, project["id"], deck["id"])
    cards_path = f"{decks_path(project['id'])}/{deck['id']}/cards"
    assert (await client.post(cards_path, headers=auth(), json=create_body)).status_code == 422
    assert (await client.patch(f"{cards_path}/{card['id']}", headers=auth(), json=patch_body)).status_code == 422


@pytest.mark.asyncio
async def test_null_deck_patch_fields_are_rejected(project_api):
    client, _, _ = project_api
    project = await create(client)
    deck = await create_deck(client, project["id"])
    path = f"{decks_path(project['id'])}/{deck['id']}"
    assert (await client.patch(path, headers=auth(), json={"name": None})).status_code == 422
    assert (await client.patch(path, headers=auth(), json={"description": None})).status_code == 422
    assert (await client.patch(path, headers=auth(), json={"description": ""})).json()["description"] == ""
