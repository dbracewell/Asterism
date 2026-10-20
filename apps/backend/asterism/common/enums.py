"""Helpers for working with :mod:`enum` types."""

import enum


def enum_values(enum_type: type[enum.Enum]) -> list[str]:
    """Return the values of every member in an enum, in definition order.

    Args:
        enum_type: The enum class to inspect (not an instance).

    Returns:
        A list of the enum members' string values.
    """
    return [member.value for member in enum_type]
