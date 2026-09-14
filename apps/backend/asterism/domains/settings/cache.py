from contextlib import asynccontextmanager

from cachetools import TTLCache

from asterism.common.concurrency import AsyncAtomic
from asterism.common.log import DEFAULT_LOGGER
from asterism.core.events import Event, EventType, event_bus
from asterism.core.schemas import NoArgs

from .schemas import ApplicationSettings, UserSettings


class SettingsCache:
    def __init__(self) -> None:
        self._user_cache: TTLCache[str, UserSettings] = TTLCache[str, UserSettings](
            maxsize=100, ttl=3600
        )
        self._app_cache = AsyncAtomic[ApplicationSettings | None](None)

    def get_user_settings(self, user_id: str) -> UserSettings | None:
        return self._user_cache.get(user_id, None)

    def set_user_settings(self, user_id: str, settings: UserSettings) -> None:
        self._user_cache[user_id] = settings

    def clear_user_settings(self) -> None:
        self._user_cache.clear()

    def remove_user_setting(self, user_id: str) -> None:
        if user_id in self._user_cache:
            del self._user_cache[user_id]

    @asynccontextmanager
    async def app_settings(self):
        async with self._app_cache as (get, set):
            yield get, set


settings_cache = SettingsCache()


@event_bus.on(EventType.USER_SETTING_UPDATED)
async def on_user_setting_event(event: Event[NoArgs]) -> None:
    DEFAULT_LOGGER.debug(
        f"Received USER_SETTING_UPDATED event for user_id={event.user_id}"
    )
    if event.user_id:
        settings_cache.remove_user_setting(user_id=event.user_id)
    else:
        settings_cache.clear_user_settings()
