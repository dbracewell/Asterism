from typing import Any

from asterism.core.cache.lru import LRUCache


class SettingsCache:
    def __init__(self):
        self._cache: LRUCache = LRUCache(capacity=10000)

    def _generate_user_key(self, user_id: str, setting: str) -> str:
        return f"user({user_id})-{setting}"

    def _generate_app_key(self, setting: str) -> str:
        return f"application-{setting}"

    def get_user_setting(self, user_id, setting: str) -> Any | None:
        key = self._generate_user_key(
            user_id,
            setting,
        )
        return self._cache.get(key)

    def set_user_setting(self, user_id, setting: str, value: Any) -> None:
        key = self._generate_user_key(
            user_id,
            setting,
        )
        if value is None:
            self._cache.remove(key)
            return

        self._cache.put(key, value)

    def has_user_setting(self, user_id, setting: str) -> bool:
        key = self._generate_user_key(
            user_id,
            setting,
        )
        return key in self._cache

    def get_application_setting(self, setting: str) -> Any | None:
        key = self._generate_app_key(setting)
        return self._cache.get(key)

    def set_application_setting(self, setting: str, value: Any) -> None:
        key = self._generate_app_key(setting)
        if value is None:
            self._cache.remove(key)
            return
        self._cache.put(key, value)

    def has_application_setting(self, setting: str) -> bool:
        key = self._generate_app_key(setting)
        return key in self._cache


settings_cache = SettingsCache()
