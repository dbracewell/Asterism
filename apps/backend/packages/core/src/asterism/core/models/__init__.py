from sqlalchemy import MetaData
from sqlalchemy.orm import declarative_base

from asterism.core import config

if "sqlite" not in config.DB_CONNECTION:
    metadata_obj = MetaData(schema=config.DB_SCHEMA)
else:
    metadata_obj = MetaData()

Base = declarative_base(metadata=metadata_obj)

# fmt: off
# isort: off
from .folder import Folder, FolderModel, FolderModelList, FlatFolderModel  # noqa: E402, F401
from .message import Message, MessageModel  # noqa: E402, F401
from .chat_session import ChatSession, ChatSessionModel,ChatSessionInfoList,ChatSessionInfo  # noqa: E402, F401
# fmt: on
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
]
