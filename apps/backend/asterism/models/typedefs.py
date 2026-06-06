import json
from typing import Any, Optional

from pydantic import BaseModel
from sqlalchemy.types import Text, TypeDecorator


class JsonColumn(TypeDecorator):
    """
    A custom SQLAlchemy type that automatically dumps Python objects to
    JSON strings on the way in, and loads them back to Python objects on the way out.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(
        self,
        value: Optional[Any],
        dialect: Any,
    ) -> Optional[str]:
        """Convert the Python object to a JSON string before saving to the DB."""
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
        return json.loads(value)
