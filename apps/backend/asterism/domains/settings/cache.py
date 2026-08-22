from contextlib import asynccontextmanager

from cachetools import TTLCache

from asterism.common.concurrency import AsyncAtomic

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
