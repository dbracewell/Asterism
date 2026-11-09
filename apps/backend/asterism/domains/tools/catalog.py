"""Tool policy metadata independent of settings and invocation code.

Policies describe how a tool's availability is decided at runtime:

- USER_CONFIGURABLE: ordinary tools that require explicit agent assignment
  plus an active admin policy (the ``active_tools`` application setting).
- CONTEXT_MANAGED: internal tools whose availability is derived entirely
  server-side from live execution context; they are omitted from user
  capability pickers and cannot be granted by prompt text or approval.
"""

from enum import StrEnum


class ToolPolicy(StrEnum):
    """How a tool's availability is authorized at runtime."""

    USER_CONFIGURABLE = "user_configurable"
    CONTEXT_MANAGED = "context_managed"


#: Loads one of the calling sub-agent's own assigned skills (ADR-0062).
SKILL_TOOL_NAME = "load_skill"

#: Internal tools gated by the admin Tools allowlist (``active_tools``) whose
#: ceiling a delegated child inherits from its parent run (file scope and
#: delegation selections).
SCOPED_TOOL_NAMES = frozenset({"sub_agent", "search_knowledge"})

#: Internal, context-managed tools. Availability is derived server-side from
#: live context and admin policy; user payloads cannot grant them.
#: ``load_skill`` belongs to the calling agent (its assigned skills) and is
#: gated by the Skills policy instead of the Tools allowlist.
INTERNAL_TOOL_NAMES = SCOPED_TOOL_NAMES | {SKILL_TOOL_NAME}


def tool_policy(name: str) -> ToolPolicy:
    """Return the authorization policy for a tool name.

    Args:
        name: Registered tool name.

    Returns:
        CONTEXT_MANAGED for internal tools, USER_CONFIGURABLE otherwise.
    """
    return ToolPolicy.CONTEXT_MANAGED if name in INTERNAL_TOOL_NAMES else ToolPolicy.USER_CONFIGURABLE


def configurable_tools(names: list[str]) -> list[str]:
    """Filter a tool-name list down to user-configurable (non-internal) tools.

    Args:
        names: Tool names, e.g. an agent profile's assigned tools.

    Returns:
        The same names minus any internal context-managed tools. Note that this
        does not verify the names are actually registered.
    """
    return [name for name in names if name not in INTERNAL_TOOL_NAMES]
