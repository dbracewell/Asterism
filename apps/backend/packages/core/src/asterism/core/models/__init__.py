from sqlalchemy import MetaData
from sqlalchemy.orm import declarative_base

from asterism.core import config

if "sqlite" not in config.DB_CONNECTION:
    metadata_obj = MetaData(schema=config.DB_SCHEMA)
else:
    metadata_obj = MetaData()

Base = declarative_base(metadata=metadata_obj)

# isort: off
from .user import User  # noqa: E402, F401
from .folder import Folder, FlatFolderModel, FolderModel, FolderModelList  # noqa: E402, F401
from .message import Message, LLMMessage, MessageModel, MessageModelList, MessageStatus  # noqa: E402, F401
from .chat import Chat, ChatInfo, ChatModel, ChatModelList  # noqa: E402, F401
from .user_settings import UserSetting  # noqa: E402, F401
from .app_settings import AppSetting  # noqa: E402, F401
from .function import Function, UserFunctions  # noqa: E402, F401
# isort: on

ChatModel.model_rebuild()
ChatModelList.model_rebuild()
FlatFolderModel.model_rebuild()
FolderModel.model_rebuild()
FolderModelList.model_rebuild()

__all__ = [
    "Base",
    "Folder",
    "FolderModel",
    "FolderModelList",
    "FlatFolderModel",
    "Message",
    "MessageModel",
    "MessageStatus",
    "MessageModelList",
    "LLMMessage",
    "Chat",
    "ChatInfo",
    "ChatModel",
    "ChatModelList",
    "UserSetting",
    "AppSetting",
    "User",
    "UserFunctions",
    "Function",
]
