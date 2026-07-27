from .chat import (
    ChatUpdateRequest,
    NewChatRequest,
)
from .folder import GetFolderRequest, NewFolderRequest
from .message import NewMessage, UpdateMessage

__all__ = [
    "ChatUpdateRequest",
    "NewChatRequest",
    "NewMessage",
    "UpdateMessage",
    "GetFolderRequest",
    "NewFolderRequest",
]
