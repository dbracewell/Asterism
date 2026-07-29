from pydantic import BaseModel, JsonValue


class Setting(BaseModel):
    key: str
    value: JsonValue


class UpdateSettingValue(BaseModel):
    value: JsonValue


class BulkUpdateSettingRequest(BaseModel):
    values: dict[str, JsonValue]
