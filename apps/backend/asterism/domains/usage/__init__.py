"""Model usage: one ledger of every model call and image, budgets, and reads (US-86.3, ADR-0073).

Every LLM client is built with a :class:`~asterism.domains.usage.schemas.UsageMeter`
(or an explicit ``None`` for calls no user pays for), so each completed call
writes one ``usage_records`` row with the price at that moment. Budgets are
per user, per day and per month, set on the user's group; days and months
follow the instance usage timezone.
"""
