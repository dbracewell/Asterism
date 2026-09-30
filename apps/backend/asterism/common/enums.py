import enum


def enum_values(enum_type: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_type]
