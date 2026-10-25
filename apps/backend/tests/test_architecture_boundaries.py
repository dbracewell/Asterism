"""Dependency direction for neutral mechanics and injected runtime consumers."""

from pathlib import Path

import pytest
from import_graph import imported_modules, module_name, within

ROOT = Path(__file__).resolve().parents[1] / "asterism"
# Named assembly/lifecycle edges, not blanket permission to import domain models.
DB_COMPOSITION_ROOTS = {
    "asterism.db.init_db": {
        "asterism.domains.chat.search_index",
        "asterism.domains.settings.models",
        "asterism.domains.tools.catalog",
    },
    "asterism.db.model_registry": {
        "asterism.domains.agent.models",
        "asterism.domains.chat.models",
        "asterism.domains.chat.execution_models",
        "asterism.domains.chat.draft_models",
        "asterism.domains.files.models",
        "asterism.domains.knowledge.models",
        "asterism.domains.projects.models",
        "asterism.domains.settings.models",
        "asterism.domains.skills.models",
        "asterism.domains.user.models",
    },
}
AGENT_CHAT_READERS = {
    "asterism.domains.chat.schemas.Chat",
    "asterism.domains.chat.schemas.MessageExecution",
    "asterism.domains.chat.execution.prepare_execution",
    "asterism.domains.chat.execution.read_execution_prompt",
    "asterism.domains.chat.personas.validate_persona_access",
    "asterism.domains.chat.scope.read_chat_scope_snapshot",
    "asterism.domains.chat.scope.read_project_scope_snapshot",
    "asterism.domains.chat.tool_policy.require_internal_tool",
    "asterism.domains.chat.tool_policy.resolve_effective_tools",
    "asterism.domains.chat.retrieval.create_retrieval_service",
    "asterism.domains.chat.runtime_files.create_runtime_file_reader",
    "asterism.domains.chat.prompt_composition.build_prompt_snapshot",
    "asterism.domains.chat.prompt_composition.build_runtime_prompt",
}


def violations(root):
    failures = []
    for path in sorted(root.rglob("*.py")):
        source = module_name(path, root)
        for target in imported_modules(path, root):
            reason = None
            if within(source, "asterism.common"):
                if within(target, "asterism") and not within(target, "asterism.common"):
                    reason = "common is a leaf layer"
            elif within(source, "asterism.db"):
                if within(target, "asterism.domains"):
                    if not any(within(target, allowed) for allowed in DB_COMPOSITION_ROOTS.get(source, set())):
                        reason = "only named database composition roots may import their declared domain interfaces"
                if source not in DB_COMPOSITION_ROOTS and any(within(target, name) for name in DB_COMPOSITION_ROOTS):
                    reason = "neutral database mechanics cannot import composition roots"
            elif within(source, "asterism.domains.agent"):
                if any(
                    within(target, boundary)
                    for boundary in (
                        "asterism.domains.skills.models",
                        "asterism.domains.skills.queries",
                        "asterism.domains.skills.service",
                        "asterism.domains.skills.assignments",
                        "asterism.domains.skills.policy",
                    )
                ):
                    reason = "Agent consumes injected skill snapshots rather than skill storage or policy"
                if within(target, "asterism.domains.chat"):
                    if source != "asterism.domains.agent.agent" or target not in AGENT_CHAT_READERS:
                        reason = "only the named Agent assembly module may wire published chat readers"
                if within(target, "asterism.domains.files"):
                    reason = "Agent consumes the injected file reader rather than the files domain"
                if within(target, "asterism.domains.projects"):
                    if (
                        source != "asterism.domains.agent.service"
                        or target != "asterism.domains.projects.revocation.revoke_agent_projects"
                    ):
                        reason = "only agent-definition deletion may call project revocation"
                if within(target, "asterism.db.database") and source not in {
                    "asterism.domains.agent.agent",
                    "asterism.domains.agent.service",
                }:
                    reason = "only named Agent assembly and persistence modules may acquire sessions"
                if within(target, "asterism.db.model_registry"):
                    reason = "Agent cannot query through the central model registry"
            elif within(source, "asterism.domains.retrieval"):
                forbidden = (
                    "asterism.db",
                    "sqlalchemy",
                    "asterism.core.config",
                    "asterism.domains.chat",
                    "asterism.domains.projects",
                    "asterism.domains.files",
                    "asterism.domains.knowledge.runtime",
                    "asterism.domains.knowledge.queries",
                    "asterism.domains.knowledge.artifacts",
                )
                if any(within(target, boundary) for boundary in forbidden):
                    reason = "retrieval consumes injected live scope and providers"
                if (
                    within(target, "asterism.domains.knowledge.models")
                    and target != "asterism.domains.knowledge.models.KnowledgeExtractionStatus"
                ):
                    reason = "retrieval may share the status enum, not artifact ORM models"
            if reason:
                failures.append(f"{source} -> {target}: {reason}")
    return failures


def test_recursive_runtime_and_neutral_query_boundaries():
    assert violations(ROOT) == []


@pytest.mark.parametrize(
    ("path", "source"),
    [
        ("common/nested/utility.py", "def hidden():\n from ...domains.chat.models import ChatModel\n"),
        ("db/nested/queries.py", "from asterism.domains import projects"),
        ("db/queries.py", "from .model_registry import ChatModel"),
        ("db/nested/queries.py", "from ..init_db import initialize_database"),
        ("db/model_registry.py", "from asterism.domains.chat.service import search"),
        ("domains/agent/nested/runtime.py", "from asterism.db.database import get_async_db_session"),
        ("domains/agent/agent.py", "from ..skills.service import require_skill"),
        ("domains/agent/nested/runtime.py", "from ...skills.models import SkillModel"),
        ("domains/agent/nested/runtime.py", "from ...chat.models import ChatModel"),
        ("domains/agent/agent.py", "from ..chat.queries import select_owned_chats"),
        ("domains/agent/agent.py", "from ..chat.scope import ChatModel"),
        ("domains/retrieval/service.py", "from ..knowledge.models import *"),
        ("domains/agent/service.py", "from ..projects.models import ProjectModel"),
        ("domains/agent/agent.py", "from ..files.runtime_access import RuntimeFileReader"),
        ("domains/retrieval/nested/runtime.py", "def hidden():\n from ....core import config\n"),
        ("domains/retrieval/service.py", "from ..knowledge.models import FileKnowledgeArtifactModel"),
        ("domains/retrieval/service.py", "from asterism.db import model_registry"),
    ],
)
def test_forbidden_edges_cannot_hide_in_subpackages_or_deferred_imports(tmp_path, path, source):
    root = tmp_path / "asterism"
    file = root / path
    file.parent.mkdir(parents=True)
    file.write_text(source)
    assert len(violations(root)) == 1


@pytest.mark.parametrize(
    ("path", "source"),
    [
        ("db/init_db.py", "from asterism.domains.chat.search_index import initialize_search_index"),
        ("db/model_registry.py", "from asterism.domains.chat.models import ChatModel"),
        ("domains/agent/agent.py", "from ..chat.runtime_files import create_runtime_file_reader"),
        ("domains/agent/service.py", "from ..projects.revocation import revoke_agent_projects"),
        ("domains/retrieval/service.py", "from ..knowledge.models import KnowledgeExtractionStatus"),
        ("domains/agent/nested/runtime.py", "import asterism.domains.filesystem"),
        ("domains/chat/scope.py", "from ..projects.scope import read_project_context"),
    ],
)
def test_explicit_composition_roots_and_exact_prefix_boundaries(tmp_path, path, source):
    root = tmp_path / "asterism"
    file = root / path
    file.parent.mkdir(parents=True)
    file.write_text(source)
    assert violations(root) == []


def test_from_package_and_relative_imports_resolve_to_the_same_target(tmp_path):
    root = tmp_path / "asterism"
    file = root / "domains" / "agent" / "__init__.py"
    file.parent.mkdir(parents=True)
    file.write_text("from .. import chat\nfrom asterism.domains import chat as chats\n")
    assert imported_modules(file, root) == ["asterism.domains.chat", "asterism.domains.chat"]
