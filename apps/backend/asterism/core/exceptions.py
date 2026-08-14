class AsterismException(Exception):
    pass


class CodedException(AsterismException):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


class BadDataException(AsterismException):
    def __init__(self, message: str = "Bad Data"):
        super().__init__(400, message)


class UnauthorizedException(AsterismException):
    def __init__(self, message: str = "Unauthorized"):
        super().__init__(401, message)


class NotFoundException(AsterismException):
    def __init__(self, message: str = "Resource not found"):
        super().__init__(404, message)
