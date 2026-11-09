"""Typed instruction inputs; no storage or capability authorization lives here."""

import hashlib
import uuid

from pydantic import BaseModel, ConfigDict, Field

MAX_ACTIVE_SKILLS = 8
MAX_SKILL_BYTES = 65_536
MAX_ACTIVE_SKILL_BYTES = 131_072


class SkillIdentity(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: uuid.UUID
    name: str
    revision: int = Field(ge=1)
    digest: str


class SkillSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: uuid.UUID
    name: str
    revision: int = Field(ge=1)
    content: str

    @property
    def identity(self) -> SkillIdentity:
        return SkillIdentity(
            id=self.id, name=self.name, revision=self.revision, digest=hashlib.sha256(self.content.encode()).hexdigest()
        )


class SkillCatalogEntry(BaseModel):
    """A skill a sub-agent may load with load_skill: its listing, not its body (ADR-0062)."""

    model_config = ConfigDict(frozen=True, from_attributes=True)
    id: uuid.UUID
    name: str
    description: str
    revision: int = Field(ge=1)


class AcceptedSkills(BaseModel):
    model_config = ConfigDict(frozen=True)
    revision: int = Field(default=0, ge=0)
    snapshots: tuple[SkillSnapshot, ...] = ()
