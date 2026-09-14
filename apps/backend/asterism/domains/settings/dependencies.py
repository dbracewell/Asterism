from typing import Annotated

from fastapi import Depends

import asterism.domains.settings.service as settings_service
from asterism.db.dependencies import DBSessionDep
from asterism.domains.settings.schemas import ApplicationSettings, UserSettings
from asterism.domains.user.dependencies import AuthedUserDep


async def get_user_settings(
    authed_user: AuthedUserDep,
    session: DBSessionDep,
) -> UserSettings:
    return await settings_service.get_user_settings(
        user_id=authed_user.id,
        session=session,
    )


type UserSettingsDep = Annotated[UserSettings, Depends(get_user_settings)]


async def get_app_settings(
    session: DBSessionDep,
) -> ApplicationSettings:
    return await settings_service.get_app_settings(
        session=session,
    )


type AppSettingsDep = Annotated[ApplicationSettings, Depends(get_app_settings)]
