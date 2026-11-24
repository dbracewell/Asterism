"""Read and record setup progress, stored as the ``setup_progress`` app setting."""

import re

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.service import upsert_app_setting

from .schemas import SetupProgress, SetupStepState, SetupStepUpdate

SETTING_KEY = "setup_progress"
_STEP = re.compile(r"^[a-z][a-z0-9_-]{0,39}$")


async def read_progress(session: AsyncSession) -> SetupProgress:
    row = await session.get(ApplicationSettingsModel, SETTING_KEY)
    if row is None or not isinstance(row.value, dict):
        return SetupProgress()
    try:
        return SetupProgress.model_validate(row.value)
    except ValidationError:
        # Malformed progress only means steps show as not reviewed.
        return SetupProgress()


async def record_step(step_id: str, update: SetupStepUpdate, admin_id: str, session: AsyncSession) -> SetupProgress:
    if not _STEP.match(step_id):
        raise BadDataException("Unknown setup step")
    progress = await read_progress(session)
    steps = dict(progress.steps)
    if update.state is None:
        steps.pop(step_id, None)
    else:
        steps[step_id] = SetupStepState(state=update.state, at=get_unix_timestamp(), by=admin_id)
    progress = SetupProgress(steps=steps)
    await upsert_app_setting(SETTING_KEY, progress.model_dump(mode="json"), session=session)
    return progress
