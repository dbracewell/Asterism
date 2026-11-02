"""Optional admin price metadata for a model (US-54.1).

Prices are estimates in US dollars per million tokens. They are snapshotted
into execution records when a run starts, so usage summaries show what a run
cost at the time, not what the current price would make it cost. A model with
no pricing shows tokens only; ChatGPT plan models never carry prices.
"""

from pydantic import BaseModel, ConfigDict, Field

MAX_PRICE_PER_MILLION = 1_000_000.0


class ModelPricing(BaseModel):
    """US dollars per million input and output tokens."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    input_per_million: float = Field(ge=0, le=MAX_PRICE_PER_MILLION, allow_inf_nan=False)
    output_per_million: float = Field(ge=0, le=MAX_PRICE_PER_MILLION, allow_inf_nan=False)


def pricing_from_columns(input_per_million: float | None, output_per_million: float | None) -> ModelPricing | None:
    """Both prices or none: a half-priced model is treated as unpriced."""
    if input_per_million is None or output_per_million is None:
        return None
    return ModelPricing(input_per_million=input_per_million, output_per_million=output_per_million)
