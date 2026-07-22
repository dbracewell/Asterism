from sqlalchemy import MetaData
from sqlalchemy.orm import declarative_base

from asterism.core import config

if "sqlite" not in config.DB_CONNECTION:
    metadata_obj = MetaData(schema=config.DB_SCHEMA)
else:
    metadata_obj = MetaData()

Base = declarative_base(metadata=metadata_obj)

# isort: off
from .folder import Folder, FolderModel, FolderModelList, FlatFolderModel  # noqa: E402, F401
from .message import Message, MessageModel, NewMessage  # noqa: E402, F401
from .chat_session import (  # noqa: E402, F401
    ChatSession,
    ChatSessionModel,
    ChatSessionInfoList,
    ChatSessionInfo,
    ChatSessionUpdate,
    NewChatSessionRequest,
)
from .settings_model import UserSetting, AppSetting  # noqa: E402, F401
# isort: on


ChatSessionModel.model_rebuild()
ChatSessionInfoList.model_rebuild()
FlatFolderModel.model_rebuild()
FolderModel.model_rebuild()
FolderModelList.model_rebuild()

__all__ = [
    "Base",
    "Folder",
    "FolderModel",
    "FolderModelList",
    "Message",
    "MessageModel",
    "ChatSession",
    "ChatSessionModel",
    "ChatSessionInfoList",
    "ChatSessionInfo",
    "UserSetting",
    "AppSetting",
    "ChatSessionUpdate",
    "NewMessage",
    "NewChatSessionRequest",
]
