from sqlalchemy import MetaData
from sqlalchemy.orm import declarative_base

from asterism import config

if "sqlite" not in config.DB_CONNECTION:
    metadata_obj = MetaData(schema=config.DB_SCHEMA)
else:
    metadata_obj = MetaData()

Base = declarative_base(metadata=metadata_obj)

# isort: off
from .user import User  # noqa: E402, F401
from .message import Message  # noqa: E402, F401
from .folder import Folder  # noqa: E402, F401
from .chat import Chat  # noqa: E402, F401
from .user_settings import UserSetting  # noqa: E402, F401
from .app_settings import AppSetting  # noqa: E402, F401
from .function import Function, UserFunctions  # noqa: E402, F401
# isort: on


__all__ = [
    "Base",
    "Message",
    "Chat",
    "UserSetting",
    "AppSetting",
    "User",
    "UserFunctions",
    "Function",
    "Folder",
]
