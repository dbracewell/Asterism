from pydantic import BaseModel


class CodedException(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


class UnauthorizedException(CodedException):
    def __init__(self, message: str = "Unauthorized"):
        super().__init__(401, message)


class NotFoundException(CodedException):
    def __init__(self, message: str = "Resource not found"):
        super().__init__(404, message)


class ErrorDetail(BaseModel):
    detail: str
    code: int
