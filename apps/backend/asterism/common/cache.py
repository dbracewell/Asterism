from typing import cast, override

from cachetools import TTLCache


class SlidingTTLCache[K, V](TTLCache[K, V]):
    """
    A cache that evicts items after a certain time-to-live (TTL) period, but resets the TTL
    whenever an item is accessed. This means that frequently accessed items will stay in the cache longer, while items
    that are not accessed will be evicted after the TTL expires.
    """

    @override
    def __getitem__(self, key: K, cache_getitem=TTLCache.__getitem__) -> V:  # pyright: ignore[reportUnknownMemberType, reportUnknownParameterType, reportMissingParameterType]
        value: V = cast(V, cache_getitem(self, key))
        self.__setitem__(key, value)
        return value
