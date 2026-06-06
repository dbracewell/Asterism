from .auth import admin_router, auth_router, setup_router
from .chat import chat_router
from .file_router import file_router

__all__ = ["admin_router", "auth_router", "chat_router", "file_router", "setup_router"]
