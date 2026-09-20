from typing import cast, override

from cachetools import TTLCache


class SlidingTTLCache[K, V](TTLCache[K, V]):
    @override
    def __getitem__(self, key: K, cache_getitem=TTLCache.__getitem__) -> V:  # pyright: ignore[reportUnknownMemberType, reportUnknownParameterType, reportMissingParameterType]
        value: V = cast(V, cache_getitem(self, key))
        self.__setitem__(key, value)
        return value
