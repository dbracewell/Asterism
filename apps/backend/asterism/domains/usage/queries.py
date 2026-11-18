"""Ledger aggregation: tokens, images and estimated cost per user and model over a period."""

from sqlalchemy import Select, case, func, select

from .models import UsageRecordModel as Usage

_priced = Usage.input_price_per_million.is_not(None)
TOKENS = Usage.input_tokens + Usage.output_tokens


def select_usage_totals(start: int, end: int) -> Select:
    """One row per (user, model) with usage in ``[start, end)``, ordered for display.

    ``cost`` sums only priced rows; ``priced`` counts them, so a total with no
    priced row reads as unknown rather than free.
    """
    return (
        select(
            Usage.user_id,
            Usage.model_id,
            Usage.model_name,
            func.sum(Usage.input_tokens).label("input_tokens"),
            func.sum(Usage.output_tokens).label("output_tokens"),
            func.sum(Usage.images).label("images"),
            func.sum(
                case(
                    (
                        _priced,
                        (
                            Usage.input_tokens * Usage.input_price_per_million
                            + Usage.output_tokens * Usage.output_price_per_million
                        )
                        / 1_000_000.0,
                    ),
                    else_=0.0,
                )
            ).label("cost"),
            func.sum(case((_priced, 1), else_=0)).label("priced"),
            func.sum(case((_priced, 0), else_=TOKENS)).label("unpriced_tokens"),
        )
        .where(Usage.created_at >= start, Usage.created_at < end)
        .group_by(Usage.user_id, Usage.model_id, Usage.model_name)
        .order_by(Usage.user_id, Usage.model_name, Usage.model_id)
    )
