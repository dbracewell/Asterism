"""US-54.1: per-step usage recording and price metadata snapshots."""

import uuid

import pytest
import pytest_asyncio
from asterism.db.model_registry import Base
from asterism.domains.agent.schemas import AgentEvent, AgentEventType, SubAgentEventEnvelope
from asterism.domains.chat.delegations import DelegationCollector
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.schemas import UsageStep
from asterism.domains.settings.models import LLMModel
from asterism.domains.settings.pricing import ModelPricing
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.schemas import Llm, Provider, ProviderModelUpdate
from asterism.domains.settings.service import bulk_upsert_providers, get_app_settings, update_provider_model
from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from test_chat_models import A, new_chat
from test_chat_models import project_api as _project_api
from test_projects_api import auth

project_api = _project_api
PRICE = ModelPricing(input_per_million=2.5, output_per_million=10)


def test_pricing_rejects_negative_infinite_and_half_prices():
    with pytest.raises(ValidationError):
        ModelPricing(input_per_million=-1, output_per_million=1)
    with pytest.raises(ValidationError):
        ModelPricing(input_per_million=float("inf"), output_per_million=1)
    with pytest.raises(ValidationError):
        ProviderModelUpdate.model_validate({"is_active": True, "pricing": {"input_per_million": 1}})
    assert ProviderModelUpdate(is_active=True).pricing is None


@pytest_asyncio.fixture
async def sessions(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'pricing.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def _provider(model: Llm) -> Provider:
    return Provider(
        id=model.provider_id,
        provider_type=ProviderType.GENERIC_OPENAI,
        name="Local",
        base_url="http://localhost:8080/v1/",
        api_key="secret",
        models=[model],
    )


@pytest.mark.asyncio
async def test_admin_sets_and_clears_pricing_and_bulk_saves_keep_it(sessions):
    model = Llm(id=uuid.uuid4(), name="m", provider_id=uuid.uuid4(), is_active=True)
    async with sessions() as session:
        await bulk_upsert_providers([_provider(model)], session)
        await session.commit()

    saved = await update_provider_model(
        model.provider_id, model.id, ProviderModelUpdate(is_active=True, pricing=PRICE), sessions()
    )
    assert saved.pricing == PRICE

    # A provider save carrying no prices (the providers form) keeps them.
    async with sessions() as session:
        await bulk_upsert_providers([_provider(model)], session)
        await session.commit()
        stored = (await get_app_settings(session)).llm_providers[0].models[0]
    assert stored.pricing == PRICE

    cleared = await update_provider_model(model.provider_id, model.id, ProviderModelUpdate(is_active=True), sessions())
    assert cleared.pricing is None


@pytest.mark.asyncio
async def test_database_rejects_half_pricing(sessions):
    model = Llm(id=uuid.uuid4(), name="m", provider_id=uuid.uuid4(), is_active=True)
    async with sessions() as session:
        await bulk_upsert_providers([_provider(model)], session)
        await session.commit()
    async with sessions() as session:
        with pytest.raises(IntegrityError):
            await session.execute(update(LLMModel).values(input_price_per_million=1.0))
            await session.flush()


@pytest.mark.asyncio
async def test_execution_snapshots_price_at_acceptance(project_api):
    client, sessions, _ = project_api
    async with sessions() as session:
        await session.execute(
            update(LLMModel)
            .where(LLMModel.id == uuid.UUID(A))
            .values(input_price_per_million=2.5, output_price_per_million=10.0)
        )
        await session.commit()
    choices = (await client.get("/chat/models", headers=auth())).json()
    assert next(choice for choice in choices if choice["id"] == A)["pricing"] == {
        "input_per_million": 2.5,
        "output_per_million": 10.0,
    }

    chat = await new_chat(client)
    chat_id, parent = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as session:
        execution = await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, session=session)
        await session.commit()
    assert execution.model.pricing == PRICE

    # A later price change does not rewrite the recorded run.
    async with sessions() as session:
        await session.execute(
            update(LLMModel)
            .where(LLMModel.id == uuid.UUID(A))
            .values(input_price_per_million=None, output_price_per_million=None)
        )
        await session.commit()
        again = await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, session=session)
    assert again.id == execution.id
    assert again.model.pricing == PRICE


def _envelope(event: AgentEvent, **extra) -> SubAgentEventEnvelope:
    return SubAgentEventEnvelope(
        execution_id=uuid.UUID(int=1),
        sub_agent_id=uuid.UUID(int=7),
        sub_agent_name="Researcher",
        depth=1,
        event=event,
        **extra,
    )


def test_collector_records_each_child_step_and_usage_provenance():
    collector = DelegationCollector()
    model_id = uuid.uuid4()
    collector.observe(_envelope(AgentEvent(type=AgentEventType.START)), now_ms=1)
    resolved = {"model_id": model_id, "model_name": "gamma", "provider_type": ProviderType.OPENAI, "pricing": PRICE}
    collector.observe(
        _envelope(
            AgentEvent(
                type=AgentEventType.COMPLETE,
                input_tokens=100,
                output_tokens=20,
                generation_duration_ms=300,
                tool_calls=[],
            ),
            **resolved,
        ),
        now_ms=2,
    )
    # Deltas and tool calls are not model calls of their own.
    collector.observe(_envelope(AgentEvent(type=AgentEventType.DELTA, content="x"), **resolved), now_ms=3)
    collector.observe(
        _envelope(AgentEvent(type=AgentEventType.COMPLETE, input_tokens=150, output_tokens=40), **resolved), now_ms=4
    )
    (record,) = collector.drain()
    assert record.steps == [
        UsageStep(input_tokens=100, output_tokens=20, generation_duration_ms=300),
        UsageStep(input_tokens=150, output_tokens=40),
    ]
    assert (record.model_id, record.provider_type, record.pricing) == (model_id, ProviderType.OPENAI, PRICE)
