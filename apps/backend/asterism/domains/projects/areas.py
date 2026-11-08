"""Which optional feature areas a project shows (US-65.2).

Areas are display preferences only. Nothing on the server reads them to grant,
remove or narrow a capability: sub-agent selections, file scope and retrieval
keep their own rules whether or not their area is shown.
"""

from pydantic import BaseModel, ConfigDict, StrictBool


class ProjectAreas(BaseModel):
    """On/off switch for each optional area. Overview, Chats, Files and Settings are always shown."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    study: StrictBool
    reflections: StrictBool
    goal: StrictBool
    sub_agents: StrictBool


ALL_AREAS = ProjectAreas(study=True, reflections=True, goal=True, sub_agents=True)
