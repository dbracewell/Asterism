import json
from typing import Any, Optional

from pydantic import BaseModel
from sqlalchemy.types import Text, TypeDecorator


class JsonColumn(TypeDecorator):
    impl = Text
    cache_ok = True

    def __init__(self, model_type: type[BaseModel] | None = None, **kwargs):
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
        return json.dumps(value)

    def process_result_value(
        self,
        value: Optional[str],
        dialect: Any,
    ) -> Optional[Any]:
        if value is None:
            return None
        if self._model_type:
            return self._model_type.model_validate_json(value)
        return json.loads(value)
