"""Model registry for the declarative :class:`~asterism.db.base_model.Base`.

Importing this module pulls in every domain model so that ``Base.metadata``
contains the complete table set. Anything that calls
``Base.metadata.create_all`` (e.g. ``init_db``) must import from here rather
than from a single domain, otherwise tables for unimported domains would be
silently skipped.

The imports are side-effect only; the ``noqa: F401`` markers are intentional.
"""

from asterism.domains.agent.models import (  # noqa: F401
    AgentProfileModel,
    SubAgentTraceModel,
)
from asterism.domains.chat.draft_models import ChatDraftFileModel, ChatDraftModel, ChatSendReceiptModel  # noqa: F401
from asterism.domains.chat.execution_models import ChatExecutionModel  # noqa: F401
from asterism.domains.chat.models import ChatFileModel, ChatModel, MessageModel  # noqa: F401
from asterism.domains.chatgpt.models import (  # noqa: F401
    ChatGPTAuthorizationModel,
    ChatGPTConnectionModel,
    ChatGPTHostModel,
)
from asterism.domains.files.models import UserFileModel  # noqa: F401
from asterism.domains.knowledge.models import (  # noqa: F401
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
)
from asterism.domains.projects.models import ProjectFileModel, ProjectModel, ProjectSubAgentModel  # noqa: F401
from asterism.domains.settings.models import (  # noqa: F401
    ApplicationSettingsModel,
    LLMModel,
    ProviderModel,
    UserSettingModel,
)
from asterism.domains.skills.models import AgentSkillModel, SkillModel  # noqa: F401
from asterism.domains.user.models import DeletedUserModel, PersonaProfileModel, UserModel  # noqa: F401

from .base_model import Base  # noqa: F401
