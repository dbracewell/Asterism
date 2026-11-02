"""Capability manifest recorded when an agent starts a run (US-54.2).

A manifest lists what one agent could use in one run and names the grants
that allowed each entry. It is captured from the same server-side resolution
that authorized the run, then stored with the run. Inspection views read it
back as recorded and never recompute it from current settings. A manifest is
a record only: it grants nothing and is never consulted for authorization.
"""

import uuid
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class CapabilityKind(StrEnum):
    TOOL = "tool"
    SKILL = "skill"
    FILE = "file"
    SUB_AGENT = "sub_agent"


class CapabilityGrant(StrEnum):
    """One condition that had to hold for an entry to be available."""

    AGENT_ASSIGNMENT = "agent_assignment"
    """Explicitly assigned to the agent's configuration."""
    ADMIN_POLICY = "admin_policy"
    """Enabled by the admin (active tools, or the skills policy)."""
    MODEL_SUPPORT = "model_support"
    """The run's model supports tool calling."""
    PROJECT_SELECTION = "project_selection"
    """Selected in the chat's project (sub-agents and project files)."""
    CHAT_ATTACHMENT = "chat_attachment"
    """Attached to a message on the chat's active branch."""
    CHAT_SELECTION = "chat_selection"
    """Activated for the chat in the composer."""
    FILE_SCOPE = "file_scope"
    """At least one file was in scope for the run."""


class CapabilityApproval(StrEnum):
    AUTOMATIC = "automatic"
    ASK = "ask"
    """The user is asked before each call."""


class CapabilityEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: CapabilityKind
    id: str = Field(max_length=200)
    # Untrusted owner text (skill, file and sub-agent names); render as text.
    name: str | None = Field(default=None, max_length=1000)
    grants: list[CapabilityGrant] = Field(min_length=1)
    approval: CapabilityApproval | None = None
    revision: int | None = Field(default=None, ge=1)


class CapabilityManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    agent_id: uuid.UUID
    agent_name: str
    is_sub_agent: bool
    configuration_revision: int = Field(ge=1)
    model_supports_tools: bool | None = None
    entries: list[CapabilityEntry] = Field(default_factory=list)
