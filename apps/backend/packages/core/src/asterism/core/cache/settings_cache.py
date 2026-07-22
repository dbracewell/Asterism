import time
from typing import Any

from asterism.core.cache.lru import LRUCache


class SettingsCache:
    """
    Cache for settings with TTL expiration and composite key invalidation.

    Keys:
      - Per-setting:  user(<user_id>)-<key>  /  application-<key>
      - Assembled:    user(<user_id>)__full__ / application__full__
    """

    # Default TTL in seconds (5 minutes)
    DEFAULT_TTL = 300

    def __init__(self, default_ttl: int = 300):
        self._cache: LRUCache = LRUCache(capacity=10000)
        self._timestamps: dict[str, float] = {}  # key -> set time
        self._default_ttl = default_ttl

    def _make_key(self, prefix: str, identifier: str, suffix: str = "") -> str:
        parts = [prefix, identifier]
        if suffix:
            parts.append(suffix)
        return "-".join(parts)

    # ------------------------------------------------------------------
    # Per-setting access
    # ------------------------------------------------------------------

    def get_user_setting(self, user_id: str, key: str) -> Any | None:
        cache_key = self._make_key("user", user_id, key)
        return self._get(cache_key)

    def set_user_setting(self, user_id: str, key: str, value: Any) -> None:
        cache_key = self._make_key("user", user_id, key)
        self._set(cache_key, value)

    def has_user_setting(self, user_id: str, key: str) -> bool:
        cache_key = self._make_key("user", user_id, key)
        return self._has(cache_key)

    def get_application_setting(self, key: str) -> Any | None:
        cache_key = self._make_key("application", key)
        return self._get(cache_key)

    def set_application_setting(self, key: str, value: Any) -> None:
        cache_key = self._make_key("application", key)
        self._set(cache_key, value)

    def has_application_setting(self, key: str) -> bool:
        cache_key = self._make_key("application", key)
        return self._has(cache_key)

    # ------------------------------------------------------------------
    # Assembled view access
    # ------------------------------------------------------------------

    def get_user_assembled(self, user_id: str) -> dict | None:
        cache_key = self._make_key("user", user_id, "__full__")
        return self._get(cache_key)

    def set_user_assembled(self, user_id: str, value: dict) -> None:
        cache_key = self._make_key("user", user_id, "__full__")
        self._set(cache_key, value)

    def get_app_assembled(self) -> dict | None:
        cache_key = self._make_key("application", "__full__")
        return self._get(cache_key)

    def set_app_assembled(self, value: dict) -> None:
        cache_key = self._make_key("application", "__full__")
        self._set(cache_key, value)

    # ------------------------------------------------------------------
    # Invalidation
    # ------------------------------------------------------------------

    def invalidate_user_setting(self, user_id: str, key: str) -> None:
        cache_key = self._make_key("user", user_id, key)
        self._remove(cache_key)
        # Also invalidate the assembled view for this user
        full_key = self._make_key("user", user_id, "__full__")
        self._remove(full_key)

    def invalidate_user_all(self, user_id: str) -> None:
        """Invalidate all cached settings for a user."""
        # Remove individual settings
        prefix = self._make_key("user", user_id, "")
        keys_to_remove = [k for k in self._timestamps if k.startswith(prefix)]
        for k in keys_to_remove:
            self._remove(k)

    def invalidate_app_setting(self, key: str) -> None:
        cache_key = self._make_key("application", key)
        self._remove(cache_key)
        full_key = self._make_key("application", "__full__")
        self._remove(full_key)

    def invalidate_app_all(self) -> None:
        """Invalidate all cached application settings."""
        prefix = self._make_key("application", "")
        keys_to_remove = [k for k in self._timestamps if k.startswith(prefix)]
        for k in keys_to_remove:
            self._remove(k)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get(self, cache_key: str) -> Any | None:
        val = self._cache.get(cache_key)
        if val is None:
            return None
        # Check TTL
        ts = self._timestamps.get(cache_key)
        if ts is not None and (time.time() - ts) > self._default_ttl:
            self._remove(cache_key)
            return None
        return val

    def _set(self, cache_key: str, value: Any) -> None:
        self._cache.put(cache_key, value)
        self._timestamps[cache_key] = time.time()

    def _remove(self, cache_key: str) -> None:
        self._cache.remove(cache_key)
        self._timestamps.pop(cache_key, None)

    def _has(self, cache_key: str) -> bool:
        if cache_key not in self._cache:
            return False
        ts = self._timestamps.get(cache_key)
        if ts is not None and (time.time() - ts) > self._default_ttl:
            self._remove(cache_key)
            return False
        return True


settings_cache = SettingsCache()
