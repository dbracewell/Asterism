"""Usage ledger, budgets and reads (US-86.3, ADR-0073)."""

import ast
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from asterism.domains.groups.models import ADMIN_GROUP, GroupModel
from asterism.domains.llm.draft import DraftModel
from asterism.domains.llm.metering import MeteredLLMClient, meter_for, metered, with_source
from asterism.domains.llm.schemas import LLMEvent, LLMEventType
from asterism.domains.llm.selection import resolve_usable_model
from asterism.domains.settings.pricing import ModelPricing
from asterism.domains.settings.schemas import LlmWithProvider
from asterism.domains.usage.models import UsageRecordModel
from asterism.domains.usage.schemas import UsageMeter, UsageSource
from asterism.domains.usage.service import (
    UsageLimitExceeded,
    day_bounds,
    month_bounds,
    record_usage,
    require_within_budget,
)
from asterism.domains.user.models import UserModel
from sqlalchemy import select, update
from test_projects_api import auth

pytest_plugins = ["test_projects_api"]

ROOT = Path(__file__).resolve().parents[1] / "asterism"
A = str(uuid.UUID(int=1))
PRICE = ModelPricing(input_per_million=2.0, output_per_million=8.0)


@pytest.fixture
def usage_api(project_api, monkeypatch):
    """The projects test app, with the usage recorder writing to the same database."""
    client, sessions, root = project_api

    @asynccontextmanager
    async def session_context(session=None):
        async with sessions() as new_session:
            yield new_session

    monkeypatch.setattr("asterism.domains.usage.service.get_async_db_session", session_context)
    return client, sessions, root


async def records(sessions) -> list[UsageRecordModel]:
    async with sessions() as session:
        return list(await session.scalars(select(UsageRecordModel).order_by(UsageRecordModel.created_at)))


async def set_budget(sessions, group: str, *, daily=None, monthly=None) -> None:
    async with sessions() as session:
        await session.execute(
            update(GroupModel)
            .where(GroupModel.id == group)
            .values(daily_token_budget=daily, monthly_token_budget=monthly)
        )
        await session.commit()


def model_info(provider_type=None, owner=None) -> LlmWithProvider:
    from asterism.domains.settings.provider_types import ProviderType

    return LlmWithProvider.model_validate(
        {
            "id": uuid.UUID(int=1),
            "name": "Chat A",
            "provider_id": uuid.UUID(int=8),
            "is_active": True,
            "pricing": PRICE.model_dump(),
            "provider": {
                "id": uuid.UUID(int=8),
                "name": "Provider",
                "base_url": "https://provider.example",
                "api_key": "x",
                "provider_type": provider_type or ProviderType.GENERIC_OPENAI,
                "owner_user_id": owner,
            },
        }
    )


def meter(user="a", source=UsageSource.CHAT, *, pricing=PRICE, plan=False) -> UsageMeter:
    return UsageMeter(
        user_id=user, source=source, model_id=uuid.UUID(int=1), model_name="Chat A", pricing=pricing, plan=plan
    )


class FakeClient:
    def __init__(self, *events: LLMEvent) -> None:
        self.events = events

    async def chat(self, messages, tools=None, response_model=None, **kwargs):
        for event in self.events:
            yield event

    async def generate(self, messages, tools=None, response_model=None, **kwargs):
        return self.events[-1]


def complete(input_tokens=100, output_tokens=40) -> LLMEvent:
    return LLMEvent(type=LLMEventType.COMPLETE, content="ok", input_tokens=input_tokens, output_tokens=output_tokens)


# --- Metering -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_each_completed_call_is_recorded_once_with_its_price(usage_api):
    _, sessions, _ = usage_api
    client = metered(FakeClient(LLMEvent(type=LLMEventType.TEXT_DELTA, content="o"), complete()), meter())  # type: ignore[arg-type]
    events = [event async for event in client.chat([])]
    assert [event.type for event in events] == [LLMEventType.TEXT_DELTA, LLMEventType.COMPLETE]
    await client.generate([])
    rows = await records(sessions)
    assert [(row.source, row.input_tokens, row.output_tokens) for row in rows] == [("chat", 100, 40)] * 2
    assert (rows[0].input_price_per_million, rows[0].output_price_per_million) == (2.0, 8.0)


@pytest.mark.asyncio
async def test_plan_calls_count_tokens_without_dollars_and_abandoned_streams_record_nothing(usage_api):
    _, sessions, _ = usage_api
    await metered(FakeClient(complete()), meter(plan=True)).generate([])  # type: ignore[arg-type]
    abandoned = metered(FakeClient(LLMEvent(type=LLMEventType.TEXT_DELTA, content="o"), complete()), meter())  # type: ignore[arg-type]
    async for _ in abandoned.chat([]):
        break
    rows = await records(sessions)
    assert len(rows) == 1 and rows[0].plan and rows[0].input_price_per_million is None


@pytest.mark.asyncio
async def test_retagging_keeps_the_payer_and_never_double_counts(usage_api):
    _, sessions, _ = usage_api
    chat_client = metered(FakeClient(complete()), meter())  # type: ignore[arg-type]
    compaction = with_source(chat_client, UsageSource.COMPACTION)
    assert isinstance(compaction, MeteredLLMClient) and not isinstance(compaction._inner, MeteredLLMClient)
    await compaction.generate([])
    assert [row.source for row in await records(sessions)] == ["compaction"]


@pytest.mark.asyncio
async def test_the_shared_draft_model_is_charged_to_each_caller(usage_api, monkeypatch):
    _, sessions, _ = usage_api
    draft = DraftModel()
    draft._llm_client = FakeClient(complete(10, 5))  # type: ignore[assignment]
    draft._info = model_info()
    await draft.charged_to("a", UsageSource.TITLE).invoke([])
    await draft.charged_to("b", UsageSource.REFLECTION).invoke([])
    await draft.invoke([])  # the bare shared client charges nobody
    assert [(row.user_id, row.source, row.input_tokens) for row in await records(sessions)] == [
        ("a", "title", 10),
        ("b", "reflection", 10),
    ]


def _calls(name: str):
    for path in sorted(ROOT.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Call) and getattr(node.func, "id", getattr(node.func, "attr", None)) == name:
                yield path.relative_to(ROOT).as_posix(), node


def test_every_client_is_built_with_a_payer():
    """Every generation path counts: each client names who pays, and only the shared draft cache opts out."""
    unmetered = []
    for path, call in _calls("create_llm_client"):
        usage = next((keyword.value for keyword in call.keywords if keyword.arg == "usage"), None)
        assert usage is not None, f"{path}:{call.lineno} builds a client without usage="
        if isinstance(usage, ast.Constant) and usage.value is None:
            unmetered.append(path)
    assert unmetered == ["domains/llm/draft.py"]
    for path, call in _calls("resolve_usable_model"):
        assert any(keyword.arg == "source" for keyword in call.keywords), f"{path}:{call.lineno} has no source"


# --- Windows and budgets --------------------------------------------------------------


def test_days_and_months_follow_the_instance_timezone_across_dst():
    new_york = ZoneInfo("America/New_York")
    # 03:30 UTC on 10 March is still 9 March in New York.
    start, end = day_bounds(datetime(2026, 3, 10, 3, 30, tzinfo=UTC), new_york)
    assert datetime.fromtimestamp(start, new_york).isoformat() == "2026-03-09T00:00:00-04:00"
    assert end - start == 24 * 3600
    # 8 March 2026 is the spring-forward day: 23 hours long.
    start, end = day_bounds(datetime(2026, 3, 8, 12, tzinfo=new_york), new_york)
    assert end - start == 23 * 3600
    start, end = month_bounds(datetime(2026, 12, 31, 23, tzinfo=new_york), new_york)
    assert datetime.fromtimestamp(end, new_york).isoformat() == "2027-01-01T00:00:00-05:00"


@pytest.mark.asyncio
async def test_budgets_refuse_at_the_boundary_and_reset_with_the_window(usage_api):
    _, sessions, _ = usage_api
    await set_budget(sessions, "student", daily=1000, monthly=5000)
    now = datetime(2026, 11, 18, 12, tzinfo=UTC)
    async with sessions() as session:
        session.add(
            UsageRecordModel(
                user_id="a", source="chat", input_tokens=600, output_tokens=399, created_at=int(now.timestamp()) - 60
            )
        )
        await session.commit()
        await require_within_budget("a", session, now)  # 999 of 1000: allowed
        session.add(
            UsageRecordModel(
                user_id="a", source="chat", input_tokens=0, output_tokens=1, created_at=int(now.timestamp()) - 30
            )
        )
        await session.commit()
        with pytest.raises(UsageLimitExceeded, match="daily budget of 1,000 tokens") as refused:
            await require_within_budget("a", session, now)
        assert refused.value.resets_at == int(datetime(2026, 11, 19, tzinfo=UTC).timestamp())
        # Tomorrow the day is fresh, but the month still counts.
        await require_within_budget("a", session, datetime(2026, 11, 19, 0, 0, 1, tzinfo=UTC))
        await set_budget(sessions, "student", monthly=1000)
        with pytest.raises(UsageLimitExceeded, match="monthly") as monthly:
            await require_within_budget("a", session, datetime(2026, 11, 19, tzinfo=UTC))
        assert monthly.value.resets_at == int(datetime(2026, 12, 1, tzinfo=UTC).timestamp())
        await require_within_budget("a", session, datetime(2026, 12, 1, tzinfo=UTC))


@pytest.mark.asyncio
async def test_admins_are_exempt_and_other_users_are_unaffected(usage_api):
    _, sessions, _ = usage_api
    await set_budget(sessions, "student", daily=1)
    async with sessions() as session:
        session.add_all(
            [UsageRecordModel(user_id=user, source="chat", input_tokens=5, output_tokens=5) for user in ("a", "b")]
        )
        await session.execute(update(UserModel).where(UserModel.id == "a").values(group_id=ADMIN_GROUP))
        await session.commit()
        await require_within_budget("a", session)
        with pytest.raises(UsageLimitExceeded):
            await require_within_budget("b", session)


@pytest.mark.asyncio
async def test_one_refusal_shape_for_sends_and_one_off_passes(usage_api):
    client, sessions, _ = usage_api
    await set_budget(sessions, "student", daily=10)
    await record_usage(meter("a"), input_tokens=8, output_tokens=2)

    response = await client.post(
        "/chat/", headers=auth(), json={"request_id": str(uuid.uuid4()), "user_prompt": "Hi", "model_id": A}
    )
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["reason"] == "usage_limit" and "daily budget of 10 tokens" in body["detail"]
    assert body["resets_at"] > int(datetime.now(UTC).timestamp())

    async with sessions() as session:
        with pytest.raises(UsageLimitExceeded):
            await resolve_usable_model(
                user_id="a", model_id=uuid.UUID(int=1), session=session, source=UsageSource.STUDY
            )
        # Background work and finishing admitted work are counted, never refused.
        for source, admit in ((UsageSource.COMPACTION, True), (UsageSource.STUDY, False)):
            model = await resolve_usable_model(
                user_id="a", model_id=uuid.UUID(int=1), session=session, source=source, admit=admit
            )
            assert isinstance(model.client, MeteredLLMClient) and model.client.meter.source == source
    # User b is in the same group with no usage yet.
    response = await client.post(
        "/chat/", headers=auth("b"), json={"request_id": str(uuid.uuid4()), "user_prompt": "Hi", "model_id": A}
    )
    assert response.status_code == 200, response.text


# --- Reads ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_my_usage_shows_todays_and_this_months_budget(usage_api):
    client, sessions, _ = usage_api
    await set_budget(sessions, "student", daily=1000)
    await record_usage(meter("a"), input_tokens=100, output_tokens=50)
    await record_usage(meter("a", UsageSource.IMAGE, pricing=None), images=2)
    await record_usage(meter("b"), input_tokens=999)
    body = (await client.get("/usage/me", headers=auth())).json()
    assert body["timezone"] == "UTC" and body["exempt"] is False
    assert body["day"] | {"starts_at": 0, "resets_at": 0} == {
        "used_tokens": 150,
        "budget_tokens": 1000,
        "remaining_tokens": 850,
        "starts_at": 0,
        "resets_at": 0,
    }
    assert body["month"]["budget_tokens"] is None and body["month"]["remaining_tokens"] is None
    [model] = body["month_by_model"]
    assert (model["input_tokens"], model["output_tokens"], model["images"]) == (100, 50, 2)
    assert model["cost_usd"] == pytest.approx((100 * 2 + 50 * 8) / 1_000_000)


@pytest.mark.asyncio
async def test_admin_report_totals_per_user_model_and_group(usage_api, monkeypatch):
    client, sessions, _ = usage_api
    await record_usage(meter("a"), input_tokens=1_000_000, output_tokens=0)
    await record_usage(meter("a", pricing=None), input_tokens=10)  # unpriced model
    await record_usage(meter("b", plan=True), input_tokens=5, output_tokens=5)

    assert (await client.get("/usage/report", headers=auth())).status_code == 403
    monkeypatch.setattr(
        "asterism.core.security.verify_jwks_token",
        lambda token: __import__("asterism.core.schemas", fromlist=["AuthedUser"]).AuthedUser(
            id=token, email=f"{token}@example.test", name=token, role="admin"
        ),
    )
    body = (await client.get("/usage/report", headers=auth("root"))).json()
    users = {row["user_id"]: row for row in body["users"]}
    assert users["a"]["total_tokens"] == 1_000_010 and users["a"]["cost_usd"] == pytest.approx(2.0)
    assert sum(model["unpriced_tokens"] for model in users["a"]["models"]) == 10
    assert users["b"]["cost_usd"] is None, "plan tokens have no dollar cost"
    [student] = [group for group in body["groups"] if group["group_id"] == "student"]
    assert (student["users"], student["total_tokens"]) == (2, 1_000_020)
    assert body["total_tokens"] == 1_000_020 and body["cost_usd"] == pytest.approx(2.0)

    # A period with no usage, and a bad period.
    empty = (await client.get("/usage/report?start=2020-01-01&end=2020-01-31", headers=auth("root"))).json()
    assert empty["users"] == [] and empty["cost_usd"] is None
    assert (await client.get("/usage/report?start=2026-02-01&end=2026-01-01", headers=auth("root"))).status_code == 400

    # The usage timezone and group budgets are admin settings; admins can't get a budget.
    assert (
        await client.put("/usage/settings", headers=auth("root"), json={"timezone": "Mars/Base"})
    ).status_code == 400
    response = await client.put("/usage/settings", headers=auth("root"), json={"timezone": "Europe/London"})
    assert response.json() == {"timezone": "Europe/London"}
    assert (await client.get("/usage/report", headers=auth("root"))).json()["timezone"] == "Europe/London"
    budget = await client.put(
        "/groups/student/budget", headers=auth("root"), json={"daily_token_budget": 5000, "monthly_token_budget": None}
    )
    assert budget.status_code == 200 and budget.json()["daily_token_budget"] == 5000
    refused = await client.put("/groups/admin/budget", headers=auth("root"), json={"daily_token_budget": 1})
    assert refused.status_code == 400
    assert (
        await client.put("/groups/student/budget", headers=auth("root"), json={"daily_token_budget": 0})
    ).status_code == 422


def test_meter_for_drops_prices_on_a_chatgpt_plan():
    from asterism.domains.settings.provider_types import ProviderType

    priced = meter_for("a", UsageSource.CHAT, model_info())
    assert not priced.plan and priced.pricing == PRICE
    plan = meter_for("a", UsageSource.CHAT, model_info(ProviderType.CHATGPT, owner="a"))
    assert plan.plan and plan.pricing is None
