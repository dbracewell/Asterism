from cachetools import TTLCache


class SlidingTTLCache[K, V](TTLCache[K, V]):
    def __getitem__(self, key:K, cache_getitem=TTLCache.__getitem__) ->V:
        value = cache_getitem(self, key)
        self.__setitem__(key, value)
        return value
