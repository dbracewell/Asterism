from threading import Lock


class Atomic[T]:
    def __init__(self, initial_value: T) -> None:
        self._value: T = initial_value
        self._lock: Lock = Lock()

    @property
    def value(self) -> T:
        with self._lock:
            return self._value

    @value.setter
    def value(self, value: T) -> None:
        with self._lock:
            self._value = value
