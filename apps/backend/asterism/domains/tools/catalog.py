"""Tool policy metadata independent of settings and invocation code."""

from enum import StrEnum


class ToolPolicy(StrEnum):
    USER_CONFIGURABLE = "user_configurable"
    CONTEXT_MANAGED = "context_managed"


INTERNAL_TOOL_NAMES = frozenset({"sub_agent", "search_knowledge"})
registered_tool_names: set[str] = set()


def tool_policy(name: str) -> ToolPolicy:
    return ToolPolicy.CONTEXT_MANAGED if name in INTERNAL_TOOL_NAMES else ToolPolicy.USER_CONFIGURABLE


def configurable_tools(names: list[str]) -> list[str]:
    return [name for name in names if name not in INTERNAL_TOOL_NAMES]
