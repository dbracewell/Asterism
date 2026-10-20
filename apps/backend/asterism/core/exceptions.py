"""Application exception types.

``AsterismException`` is the base for all domain errors; ``CodedException`` adds
an HTTP status code so API layers can translate exceptions into responses directly.
"""


class AsterismException(Exception):
    """Base class for all Asterism domain exceptions."""


class CodedException(AsterismException):
    """An exception carrying an HTTP status *code* for direct API translation.

    Args:
        code: The HTTP status code to associate with this error (e.g., 404).
        message: Human-readable error detail.
    """

    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


class BadDataException(CodedException):
    """HTTP 400: the request payload or data is invalid."""

    def __init__(self, message: str = "Bad Data"):
        super().__init__(400, message)


class UnauthorizedException(CodedException):
    """HTTP 401: the request lacks valid authentication credentials."""

    def __init__(self, message: str = "Unauthorized"):
        super().__init__(401, message)


class NotFoundException(CodedException):
    """HTTP 404: the requested resource does not exist (or is not visible to the caller)."""

    def __init__(self, message: str = "Resource not found"):
        super().__init__(404, message)


class ConflictException(CodedException):
    """HTTP 409: the request conflicts with the current state of the resource."""

    def __init__(self, message: str = "Conflict"):
        super().__init__(409, message)
