import json
from typing import Any, Optional, Type

from pydantic import BaseModel, TypeAdapter
from sqlalchemy import JSON, Dialect, func
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlalchemy.types import Text, TypeDecorator


class JsonColumn(TypeDecorator):
    impl = Text
    cache_ok = True

    def __init__(
        self, model_type: type[BaseModel] | TypeAdapter | None = None, **kwargs
    ):
        super().__init__(**kwargs)
        self._model_type = model_type

    def process_bind_param(
        self,
        value: Optional[Any],
        dialect: Any,
    ) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, BaseModel):
            return value.model_dump_json()
        if isinstance(self._model_type, TypeAdapter):
            return self._model_type.dump_json(value).decode("utf-8")

        return json.dumps(value)

    def process_result_value(
        self,
        value: Optional[str],
        dialect: Any,
    ) -> Optional[Any]:
        if value is None:
            return None
        if isinstance(self._model_type, BaseModel):
            return self._model_type.model_validate_json(value)
        if isinstance(self._model_type, TypeAdapter):
            return self._model_type.validate_json(value)
        return json.loads(value)


class PydanticSQLiteJSONB(TypeDecorator):
    impl = JSON
    cache_ok = True

    def __init__(
        self,
        model_type: type[BaseModel] | TypeAdapter | None = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._model_type = model_type

    def load_dialect_impl(self, dialect: Dialect):
        return dialect.type_descriptor(JSON())

    def process_bind_param(self, value: Any, dialect: Dialect) -> Any:
        if value is None:
            return None

        if isinstance(value, BaseModel):
            return value.model_dump(mode="json")
        if isinstance(self._model_type, TypeAdapter):
            validated = self._model_type.validate_python(value)
            return self._model_type.dump_python(validated, mode="json")

        return value

    def process_result_value(self, value: Any, dialect: Dialect) -> Any:
        if value is None:
            return None

        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                pass

        if isinstance(self._model_type, type) and issubclass(
            self._model_type, BaseModel
        ):
            return self._model_type.model_validate(value)
        if isinstance(self._model_type, TypeAdapter):
            return self._model_type.validate_python(value)

        return value

    def bind_expression(self, bindvalue):
        return func.jsonb(bindvalue, type_=self)

    def column_expression(self, colexpr):
        return func.json(colexpr, type_=self)


class PydanticPGJSONB(TypeDecorator):
    impl = PG_JSONB
    cache_ok = True

    def __init__(
        self, model_type: type[BaseModel] | TypeAdapter | None = None, **kwargs
    ):
        super().__init__(**kwargs)
        self._model_type = model_type

    def load_dialect_impl(self, dialect: Dialect):
        return dialect.type_descriptor(PG_JSONB())

    def process_bind_param(self, value: Any, dialect: Dialect) -> Any:
        if value is None:
            return None

        if isinstance(value, BaseModel):
            return value.model_dump(mode="json")
        if isinstance(self._model_type, TypeAdapter):
            validated = self._model_type.validate_python(value)
            return self._model_type.dump_python(validated, mode="json")

        return value

    def process_result_value(self, value: Any, dialect: Dialect) -> Any:
        if value is None:
            return None

        if isinstance(value, str):
            value = json.loads(value)

        if isinstance(self._model_type, type) and issubclass(
            self._model_type, BaseModel
        ):
            return self._model_type.model_validate(value)
        if isinstance(self._model_type, TypeAdapter):
            return self._model_type.validate_python(value)

        return value


def JSONB_COLUMN(model_type: Type[BaseModel] | TypeAdapter | None = None):
    return (
        JSON()
        .with_variant(PydanticSQLiteJSONB(model_type), "sqlite")
        .with_variant(PydanticPGJSONB(model_type), "postgresql")
    )
