from .app_settings import ApplicationSettingsModel
from .chat import (
    ChatInfo,
    ChatModel,
    ChatModelList,
    ChatUpdateRequest,
    NewChatRequest,
)
from .folder import (
    FlatFolderModel,
    FolderModel,
    FolderModelList,
    GetFolderRequest,
    NewFolderRequest,
)
from .message import (
    LLMMessage,
    MessageModel,
    MessageModelList,
    NewMessage,
    UpdateMessage,
)
from .settings import BulkUpdateSettingRequest, Setting, UpdateSettingValue
from .user import CreateUserRequest
from .user_settings import UserSettingsModel

ChatModel.model_rebuild()
ChatModelList.model_rebuild()
FlatFolderModel.model_rebuild()
FolderModel.model_rebuild()
FolderModelList.model_rebuild()

__all__ = [
    "ApplicationSettingsModel",
    "UserSettingsModel",
    "LLMMessage",
    "MessageModel",
    "MessageModelList",
    "NewMessage",
    "UpdateMessage",
    "ChatInfo",
    "ChatModel",
    "ChatModelList",
    "ChatUpdateRequest",
    "NewChatRequest",
    "FlatFolderModel",
    "FolderModel",
    "GetFolderRequest",
    "NewFolderRequest",
    "FolderModelList",
    "CreateUserRequest",
    "BulkUpdateSettingRequest",
    "Setting",
    "UpdateSettingValue",
]
