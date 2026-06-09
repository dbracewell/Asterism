from sqlalchemy import MetaData
from sqlalchemy.orm import declarative_base

from asterism.config import config

if "sqlite" not in config.DB_CONNECTION:
    metadata_obj = MetaData(schema=config.DB_SCHEMA)
else:
    metadata_obj = MetaData()

Base = declarative_base(metadata=metadata_obj)


from .chat_session import ChatSession  # noqa: E402, F401
from .folder import Folder  # noqa: E402, F401
from .message import Message  # noqa: E402, F401
from .role import Role  # noqa: E402, F401
from .user import User  # noqa: E402, F401
from .user_role import UserRole  # noqa: E402, F401
