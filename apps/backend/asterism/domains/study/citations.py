"""Card citations: checked against the live project scope on write and on read."""

import uuid

from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.domains.projects.scope import project_member_files

from .schemas import StudyCitation, StudyCitationInput

_stored = TypeAdapter(list[StudyCitationInput])


def parse_citations(value: str) -> list[StudyCitationInput]:
    return _stored.validate_json(value)


async def serialize_citations(
    *, user_id: str, project_id: uuid.UUID, citations: list[StudyCitationInput], session: AsyncSession
) -> str:
    """Return canonical JSON for citations whose files are all in the project's live scope.

    Foreign, missing and unattached files are rejected with one message so the
    response does not reveal which case applied.
    """
    file_ids = {citation.file_id for citation in citations}
    members = await project_member_files(user_id=user_id, project_id=project_id, file_ids=file_ids, session=session)
    if file_ids - members.keys():
        raise BadDataException("Citations must reference files in this project")
    return _stored.dump_json(citations).decode()


async def resolve_citations(
    *, user_id: str, project_id: uuid.UUID, stored: list[str], session: AsyncSession
) -> list[list[StudyCitation]]:
    """Parse stored citation lists and mark each against current project membership.

    One membership query covers the whole batch of cards.
    """
    parsed = [parse_citations(value) for value in stored]
    file_ids = {citation.file_id for citations in parsed for citation in citations}
    members = await project_member_files(user_id=user_id, project_id=project_id, file_ids=file_ids, session=session)
    return [
        [
            StudyCitation(
                **citation.model_dump(),
                available=citation.file_id in members,
                file_name=members.get(citation.file_id),
            )
            for citation in citations
        ]
        for citations in parsed
    ]
