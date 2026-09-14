def is_none_or_empty(string: str | None) -> bool:
    return not string or string.isspace()
