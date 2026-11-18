"""Baseline schema (ADR-0069).

Revision ID: 7526419cbbde
Revises: (none)
Create Date: 2026-11-17

Creates the backend schema as it was when versioned migrations were adopted:
every model table and index, the built-in groups, the chat/project FTS5
indexes and their triggers, and the record immutability triggers. SQLite only.
Forward-only: there is no downgrade.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7526419cbbde"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copies of the SQLite objects create_all and init_db installed at the
# baseline: chat/project FTS5 indexes, their change triggers, and the
# immutability triggers. Later changes to them ship as new migrations.
_FTS_TABLES = (
    "CREATE VIRTUAL TABLE chat_search USING fts5(chat_id UNINDEXED, user_id UNINDEXED, title, content)",
    "CREATE VIRTUAL TABLE project_search USING fts5(project_id UNINDEXED, user_id UNINDEXED, name, description)",
)

_TRIGGERS = (
    "CREATE TRIGGER chat_execution_immutable\nBEFORE UPDATE ON chat_executions\nBEGIN SELECT RAISE(ABORT, 'Execution records are immutable'); END",
    "CREATE TRIGGER accepted_about_immutable\nBEFORE UPDATE OF accepted_about ON messages\nWHEN NEW.accepted_about IS NOT OLD.accepted_about\nBEGIN SELECT RAISE(ABORT, 'Accepted About you input is immutable'); END",
    "CREATE TRIGGER accepted_learning_mode_immutable\nBEFORE UPDATE OF accepted_learning_mode ON messages\nWHEN NEW.accepted_learning_mode IS NOT OLD.accepted_learning_mode\nBEGIN SELECT RAISE(ABORT, 'Accepted learning mode input is immutable'); END",
    "CREATE TRIGGER hint_level_immutable\nBEFORE UPDATE OF hint_level ON messages\nWHEN NEW.hint_level IS NOT OLD.hint_level\nBEGIN SELECT RAISE(ABORT, 'Accepted hint level is immutable'); END",
    "CREATE TRIGGER accepted_template_immutable\nBEFORE UPDATE OF accepted_template ON messages\nWHEN NEW.accepted_template IS NOT OLD.accepted_template\nBEGIN SELECT RAISE(ABORT, 'Accepted template provenance is immutable'); END",
    "CREATE TRIGGER accepted_goal_immutable\nBEFORE UPDATE OF accepted_goal ON messages\nWHEN NEW.accepted_goal IS NOT OLD.accepted_goal\nBEGIN SELECT RAISE(ABORT, 'Accepted learning goal is immutable'); END",
    "CREATE TRIGGER accepted_rubric_immutable\nBEFORE UPDATE OF accepted_rubric ON messages\nWHEN NEW.accepted_rubric IS NOT OLD.accepted_rubric\nBEGIN SELECT RAISE(ABORT, 'Accepted rubric input is immutable'); END",
    "CREATE TRIGGER accepted_skills_immutable\nBEFORE UPDATE OF accepted_skills ON messages\nWHEN NEW.accepted_skills IS NOT OLD.accepted_skills\nBEGIN SELECT RAISE(ABORT, 'Accepted skill inputs are immutable'); END",
    "CREATE TRIGGER comparison_column_immutable\nBEFORE UPDATE OF comparison_id, comparison_index, target_model_id, comparison_label ON messages\nWHEN OLD.comparison_id IS NOT NULL AND (\n  NEW.comparison_id IS NOT OLD.comparison_id\n  OR NEW.comparison_index IS NOT OLD.comparison_index\n  OR NEW.target_model_id IS NOT OLD.target_model_id\n  OR NEW.comparison_label IS NOT OLD.comparison_label\n)\nBEGIN SELECT RAISE(ABORT, 'Comparison columns are immutable'); END",
    "CREATE TRIGGER chat_search_chats_ai AFTER INSERT ON chats BEGIN INSERT INTO chat_search(chat_id, user_id, title, content) VALUES (new.id, new.user_id, coalesce(new.title, ''), ''); END",
    "CREATE TRIGGER chat_search_chats_au AFTER UPDATE OF title ON chats BEGIN DELETE FROM chat_search WHERE chat_id = new.id AND (1); INSERT INTO chat_search(chat_id, user_id, title, content) SELECT chats.id, chats.user_id, coalesce(chats.title, ''), coalesce(group_concat(messages.content, ' '), '') FROM chats LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = new.id AND (1) GROUP BY chats.id; END",
    "CREATE TRIGGER chat_search_chats_ad AFTER DELETE ON chats BEGIN DELETE FROM chat_search WHERE chat_id = old.id; END",
    "CREATE TRIGGER chat_search_messages_ai AFTER INSERT ON messages BEGIN DELETE FROM chat_search WHERE chat_id = new.chat_id AND (1); INSERT INTO chat_search(chat_id, user_id, title, content) SELECT chats.id, chats.user_id, coalesce(chats.title, ''), coalesce(group_concat(messages.content, ' '), '') FROM chats LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = new.chat_id AND (1) GROUP BY chats.id; END",
    "CREATE TRIGGER chat_search_messages_au AFTER UPDATE OF content, chat_id ON messages WHEN old.content IS NOT new.content OR old.chat_id IS NOT new.chat_id BEGIN DELETE FROM chat_search WHERE chat_id = new.chat_id AND (1); INSERT INTO chat_search(chat_id, user_id, title, content) SELECT chats.id, chats.user_id, coalesce(chats.title, ''), coalesce(group_concat(messages.content, ' '), '') FROM chats LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = new.chat_id AND (1) GROUP BY chats.id; DELETE FROM chat_search WHERE chat_id = old.chat_id AND (old.chat_id IS NOT new.chat_id); INSERT INTO chat_search(chat_id, user_id, title, content) SELECT chats.id, chats.user_id, coalesce(chats.title, ''), coalesce(group_concat(messages.content, ' '), '') FROM chats LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = old.chat_id AND (old.chat_id IS NOT new.chat_id) GROUP BY chats.id; END",
    "CREATE TRIGGER chat_search_messages_ad AFTER DELETE ON messages WHEN EXISTS (SELECT 1 FROM chats WHERE id = old.chat_id) BEGIN DELETE FROM chat_search WHERE chat_id = old.chat_id AND (1); INSERT INTO chat_search(chat_id, user_id, title, content) SELECT chats.id, chats.user_id, coalesce(chats.title, ''), coalesce(group_concat(messages.content, ' '), '') FROM chats LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = old.chat_id AND (1) GROUP BY chats.id; END",
    "CREATE TRIGGER project_search_ai AFTER INSERT ON projects BEGIN INSERT INTO project_search(project_id, user_id, name, description) VALUES (new.id, new.user_id, new.name, new.description); END",
    "CREATE TRIGGER project_search_au AFTER UPDATE OF name, description ON projects BEGIN DELETE FROM project_search WHERE project_id = new.id; INSERT INTO project_search(project_id, user_id, name, description) VALUES (new.id, new.user_id, new.name, new.description); END",
    "CREATE TRIGGER project_search_ad AFTER DELETE ON projects BEGIN DELETE FROM project_search WHERE project_id = old.id; END",
)


def upgrade() -> None:
    if op.get_context().dialect.name != "sqlite":
        raise RuntimeError("The baseline schema supports SQLite only")
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "chatgpt_host",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("host_id", sa.Text(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_chatgpt_host_singleton"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table("deleted_users", sa.Column("id", sa.String(), nullable=False), sa.PrimaryKeyConstraint("id"))
    op.create_table(
        "groups",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("built_in", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("model_access", sa.JSON(), nullable=True),
        sa.Column("tool_access", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("length(trim(name)) BETWEEN 1 AND 80", name="ck_groups_name"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Expression index: autogenerate does not detect these; the parity test does.
    op.create_index("uq_groups_name_lower", "groups", [sa.text("lower(name)")], unique=True)
    op.create_table(
        "users",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("created_at", sa.Integer(), server_default=sa.text("(unixepoch())"), nullable=False),
        sa.Column("group_id", sa.String(length=32), server_default="student", nullable=False),
        sa.Column("about_md", sa.Text(), server_default="", nullable=False),
        sa.Column("about_revision", sa.Integer(), server_default="1", nullable=False),
        sa.CheckConstraint("about_revision >= 1", name="user_about_revision_positive"),
        sa.CheckConstraint("email IS NULL OR length(trim(email)) BETWEEN 1 AND 320", name="user_email_bounds"),
        sa.CheckConstraint("instr(about_md, char(0)) = 0", name="user_about_no_nul"),
        sa.CheckConstraint(
            "length(about_md) <= 16000 AND length(CAST(about_md AS BLOB)) <= 64000", name="user_about_bounds"
        ),
        sa.CheckConstraint("name IS NULL OR length(trim(name)) BETWEEN 1 AND 255", name="user_name_bounds"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_users_group_id"), ["group_id"], unique=False)

    op.create_table(
        "chatgpt_authorizations",
        sa.Column("state_digest", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("client_id", sa.Text(), nullable=True),
        sa.Column("code_verifier", sa.Text(), nullable=False),
        sa.Column("nonce", sa.Text(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("state_digest"),
    )
    with op.batch_alter_table("chatgpt_authorizations", schema=None) as batch_op:
        batch_op.create_index("idx_chatgpt_authorizations_user", ["user_id"], unique=False)

    op.create_table(
        "chatgpt_connections",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "connected",
                "plan_usage_disabled",
                "reauthorization_required",
                "disconnected",
                name="chatgpt_connection_status",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("client_id", sa.Text(), nullable=False),
        sa.Column("host_id", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("id_token", sa.Text(), nullable=False),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.Integer(), nullable=True),
        sa.Column("scopes", sa.Text(), nullable=False),
        sa.Column("token_revision", sa.Integer(), nullable=False),
        sa.Column("usage_paused_at", sa.Integer(), nullable=True),
        sa.Column("notice_dismissed_at", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "(status IN ('connected', 'plan_usage_disabled')) = (access_token IS NOT NULL)",
            name="ck_chatgpt_connections_status_tokens",
        ),
        sa.CheckConstraint(
            "(access_token IS NULL) = (refresh_token IS NULL) AND (access_token IS NULL) = (expires_at IS NULL)",
            name="ck_chatgpt_connections_token_set",
        ),
        sa.CheckConstraint("token_revision >= 1", name="ck_chatgpt_connections_token_revision"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "classes",
        sa.Column("educator_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("join_code", sa.String(length=16), nullable=False),
        sa.Column("join_enabled", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("allowed_modes", sa.JSON(), nullable=True),
        sa.Column("answer_reveal", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_classes_name"),
        sa.ForeignKeyConstraint(["educator_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("educator_id", "name", name="uq_classes_educator_name"),
        sa.UniqueConstraint("join_code", name="uq_classes_join_code"),
    )
    with op.batch_alter_table("classes", schema=None) as batch_op:
        batch_op.create_index("idx_classes_educator", ["educator_id", "name"], unique=False)

    op.create_table(
        "educator_requests",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "pack_imports",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("pack_id", sa.Text(), nullable=False),
        sa.Column("pack_version", sa.Text(), nullable=False),
        sa.Column("pack_name", sa.Text(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("pack_imports", schema=None) as batch_op:
        batch_op.create_index("idx_pack_imports_owner_pack", ["user_id", "pack_id"], unique=False)

    op.create_table(
        "projects",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("system_prompt", sa.Text(), server_default="", nullable=False),
        sa.Column("accent", sa.String(length=16), nullable=True),
        sa.Column("context_revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("goal", sa.Text(), server_default="", nullable=False),
        sa.Column("goal_target_date", sa.Date(), nullable=True),
        sa.Column("areas", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "accent IS NULL OR accent IN ('red', 'orange', 'amber', 'green', 'teal', 'sky', 'violet', 'pink')",
            name="ck_projects_accent",
        ),
        sa.CheckConstraint("context_revision >= 1", name="ck_projects_context_revision"),
        sa.CheckConstraint("length(goal) <= 1000", name="ck_projects_goal_length"),
        sa.CheckConstraint("length(trim(name)) > 0 AND length(name) <= 255", name="ck_projects_name"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_projects_id_user"),
        sa.UniqueConstraint("user_id", "name", name="uq_projects_user_name"),
    )
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.create_index("idx_projects_user_updated", ["user_id", "updated_at"], unique=False)

    op.create_table(
        "prompt_templates",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("prompt", "rubric", name="templatekind", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("document", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("length(document) BETWEEN 1 AND 65536", name="ck_prompt_templates_document_length"),
        sa.CheckConstraint(
            "length(trim(description)) BETWEEN 1 AND 500", name="ck_prompt_templates_description_length"
        ),
        sa.CheckConstraint("length(trim(name)) BETWEEN 1 AND 80", name="ck_prompt_templates_name_length"),
        sa.CheckConstraint("revision >= 1", name="ck_prompt_templates_revision"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("prompt_templates", schema=None) as batch_op:
        batch_op.create_index(
            "idx_prompt_templates_owner_kind_updated", ["user_id", "kind", "updated_at", "id"], unique=False
        )

    op.create_table(
        "providers",
        sa.Column(
            "provider_type",
            sa.Enum(
                "openai", "generic_openai", "chatgpt", name="provider_type", native_enum=False, create_constraint=True
            ),
            server_default="generic_openai",
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("owner_user_id", sa.String(), nullable=True),
        sa.Column("base_url", sa.Text(), nullable=False),
        sa.Column("api_key", sa.Text(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "(provider_type = 'chatgpt') = (owner_user_id IS NOT NULL)", name="ck_providers_chatgpt_owned"
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_user_id", name="uq_providers_owner"),
    )
    with op.batch_alter_table("providers", schema=None) as batch_op:
        batch_op.create_index(
            "uq_providers_global_name", ["name"], unique=True, sqlite_where=sa.text("owner_user_id IS NULL")
        )

    op.create_table(
        "skills",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("length(content) BETWEEN 1 AND 65536", name="ck_skills_content_length"),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 64", name="ck_skills_name_length"),
        sa.CheckConstraint("length(trim(description)) BETWEEN 1 AND 1024", name="ck_skills_description_length"),
        sa.CheckConstraint("revision >= 1", name="ck_skills_revision"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_skills_id_owner"),
        sa.UniqueConstraint("user_id", "name", name="uq_skills_owner_name"),
    )
    with op.batch_alter_table("skills", schema=None) as batch_op:
        batch_op.create_index("idx_skills_owner_updated", ["user_id", "updated_at", "id"], unique=False)

    op.create_table(
        "user_files",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("storage_key", sa.String(length=1024), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("image", "text", "document", "other", name="filekind", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "content_status",
            sa.Enum(
                "pending",
                "ready",
                "unsupported",
                "failed",
                name="filecontentstatus",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("content_error", sa.String(length=512), nullable=True),
        sa.Column("content_cache", sa.Text(), nullable=True),
        sa.Column("thumbnail", sa.Text(), nullable=True),
        sa.Column(
            "origin",
            sa.Enum("upload", "agent", name="fileorigin", native_enum=False, create_constraint=True),
            server_default="upload",
            nullable=False,
        ),
        sa.Column("produced_chat_id", sa.Uuid(), nullable=True),
        sa.Column("produced_execution_id", sa.Uuid(), nullable=True),
        sa.Column("produced_agent_id", sa.Uuid(), nullable=True),
        sa.Column("produced_tool", sa.String(length=128), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "(origin = 'upload' AND produced_chat_id IS NULL AND produced_execution_id IS NULL AND produced_agent_id IS NULL AND produced_tool IS NULL) OR (origin = 'agent' AND produced_chat_id IS NOT NULL AND produced_execution_id IS NOT NULL AND produced_agent_id IS NOT NULL AND produced_tool IS NOT NULL)",
            name="ck_user_files_origin_provenance",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_user_files_id_user"),
        sa.UniqueConstraint("storage_key"),
        sa.UniqueConstraint("user_id", "filename", name="uq_user_files_user_filename"),
    )
    with op.batch_alter_table("user_files", schema=None) as batch_op:
        batch_op.create_index("idx_user_files_produced_execution", ["user_id", "produced_execution_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_user_files_user_id"), ["user_id"], unique=False)

    op.create_table(
        "user_settings",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "key"),
    )
    op.create_table(
        "class_invites",
        sa.Column("class_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("revoked_at", sa.Integer(), nullable=True),
        sa.Column("redeemed_at", sa.Integer(), nullable=True),
        sa.Column("redeemed_by", sa.String(), nullable=True),
        sa.Column("redeemed_name", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "(redeemed_at IS NULL) = (redeemed_name IS NULL)", name="ck_class_invites_redeemed_together"
        ),
        sa.CheckConstraint("length(trim(label)) > 0", name="ck_class_invites_label"),
        sa.ForeignKeyConstraint(["class_id"], ["classes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["redeemed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_class_invites_token_hash"),
    )
    with op.batch_alter_table("class_invites", schema=None) as batch_op:
        batch_op.create_index("idx_class_invites_class", ["class_id", "created_at"], unique=False)

    op.create_table(
        "class_members",
        sa.Column("class_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("removed_at", sa.Integer(), nullable=True),
        sa.Column("insights_consent", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["class_id"], ["classes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("class_id", "user_id"),
    )
    with op.batch_alter_table("class_members", schema=None) as batch_op:
        batch_op.create_index("idx_class_members_user", ["user_id", "class_id"], unique=False)

    op.create_table(
        "course_versions",
        sa.Column("class_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
        sa.Column("manifest", sa.Text(), nullable=False),
        sa.Column("models", sa.Text(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["class_id"], ["classes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("class_id", "number", name="uq_course_versions_class_number"),
    )
    op.create_table(
        "file_knowledge_artifacts",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("processing_profile_generation", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "running",
                "ready",
                "failed",
                "canceled",
                name="knowledgeextractionstatus",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("searchable", sa.Boolean(), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_reason", sa.String(length=512), nullable=True),
        sa.Column("started_at", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.Integer(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["file_id"], ["user_files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_id", "generation", name="uq_file_knowledge_artifacts_file_generation"),
    )
    with op.batch_alter_table("file_knowledge_artifacts", schema=None) as batch_op:
        batch_op.create_index(
            "idx_file_knowledge_artifacts_user_file_status",
            ["user_id", "file_id", "status", "updated_at"],
            unique=False,
        )
        batch_op.create_index(batch_op.f("ix_file_knowledge_artifacts_file_id"), ["file_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_file_knowledge_artifacts_user_id"), ["user_id"], unique=False)
        batch_op.create_index(
            "uq_file_knowledge_artifacts_one_current",
            ["file_id"],
            unique=True,
            sqlite_where=sa.text("is_current = 1"),
            postgresql_where=sa.text("is_current = 1"),
        )

    op.create_table(
        "models",
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("context_window", sa.Integer(), nullable=True),
        sa.Column(
            "supports_vision",
            sa.Boolean(create_constraint=True, name="ck_models_supports_vision_boolean"),
            nullable=True,
        ),
        sa.Column(
            "supports_tools", sa.Boolean(create_constraint=True, name="ck_models_supports_tools_boolean"), nullable=True
        ),
        sa.Column(
            "tools_source",
            sa.Enum(
                "catalog",
                "provider",
                "manual",
                "unknown",
                name="tools_source",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="unknown",
            nullable=False,
        ),
        sa.Column(
            "context_window_source",
            sa.Enum(
                "catalog",
                "provider",
                "manual",
                "unknown",
                name="context_window_source",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="unknown",
            nullable=False,
        ),
        sa.Column(
            "vision_source",
            sa.Enum(
                "catalog",
                "provider",
                "manual",
                "unknown",
                name="vision_source",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="unknown",
            nullable=False,
        ),
        sa.Column("input_price_per_million", sa.Float(), nullable=True),
        sa.Column("output_price_per_million", sa.Float(), nullable=True),
        sa.Column("provider_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "(input_price_per_million IS NULL) = (output_price_per_million IS NULL)", name="ck_models_pricing_pair"
        ),
        sa.CheckConstraint("context_window IS NULL OR context_window > 0", name="ck_models_context_window_positive"),
        sa.CheckConstraint(
            "input_price_per_million IS NULL OR input_price_per_million >= 0", name="ck_models_input_price_nonnegative"
        ),
        sa.CheckConstraint(
            "output_price_per_million IS NULL OR output_price_per_million >= 0",
            name="ck_models_output_price_nonnegative",
        ),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("models", schema=None) as batch_op:
        batch_op.create_index("ix_models_provider_name_id", ["provider_id", "name", "id"], unique=False)

    op.create_table(
        "pack_import_items",
        sa.Column("import_id", sa.Uuid(), nullable=False),
        sa.Column(
            "item_type",
            sa.Enum(
                "sub_agent",
                "skill",
                "template",
                "rubric",
                "project",
                name="packitemtype",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("item_key", sa.Text(), nullable=True),
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["import_id"], ["pack_imports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("pack_import_items", schema=None) as batch_op:
        batch_op.create_index("idx_pack_import_items_import", ["import_id"], unique=False)

    op.create_table(
        "project_files",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["file_id", "user_id"],
            ["user_files.id", "user_files.user_id"],
            name="fk_project_files_file_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            name="fk_project_files_project_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "file_id"),
    )
    with op.batch_alter_table("project_files", schema=None) as batch_op:
        batch_op.create_index("idx_project_files_file_owner", ["file_id", "user_id"], unique=False)

    op.create_table(
        "study_decks",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("length(description) <= 2000", name="ck_study_decks_description"),
        sa.CheckConstraint("length(trim(name)) > 0 AND length(name) <= 120", name="ck_study_decks_name"),
        sa.ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            name="fk_study_decks_project_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_study_decks_id_user"),
    )
    with op.batch_alter_table("study_decks", schema=None) as batch_op:
        batch_op.create_index("idx_study_decks_project", ["user_id", "project_id", "updated_at", "id"], unique=False)

    op.create_table(
        "study_notes",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("citations", sa.Text(), server_default="[]", nullable=False),
        sa.Column("model_id", sa.Uuid(), nullable=True),
        sa.Column("model_name", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("kind IN ('summary', 'study_guide')", name="ck_study_notes_kind"),
        sa.CheckConstraint("length(trim(body)) > 0 AND length(body) <= 100000", name="ck_study_notes_body"),
        sa.CheckConstraint("length(trim(title)) > 0 AND length(title) <= 120", name="ck_study_notes_title"),
        sa.ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            name="fk_study_notes_project_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("study_notes", schema=None) as batch_op:
        batch_op.create_index("idx_study_notes_project", ["user_id", "project_id", "updated_at", "id"], unique=False)

    op.create_table(
        "study_quizzes",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("origin", sa.String(length=16), server_default="generated", nullable=False),
        sa.Column("model_id", sa.Uuid(), nullable=True),
        sa.Column("model_name", sa.Text(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "(origin = 'generated' AND model_name IS NOT NULL) OR origin = 'practice'", name="ck_study_quizzes_origin"
        ),
        sa.CheckConstraint("length(trim(title)) > 0 AND length(title) <= 120", name="ck_study_quizzes_title"),
        sa.ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            name="fk_study_quizzes_project_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_study_quizzes_id_user"),
    )
    with op.batch_alter_table("study_quizzes", schema=None) as batch_op:
        batch_op.create_index("idx_study_quizzes_project", ["user_id", "project_id", "created_at", "id"], unique=False)

    op.create_table(
        "agent_profiles",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("model_id", sa.Uuid(), nullable=True),
        sa.Column("sub_agent", sa.Boolean(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("config_revision", sa.Integer(), nullable=False),
        sa.Column("general_sub_agents_revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("max_steps", sa.Integer(), nullable=False),
        sa.Column("chat_parameters", sa.JSON(), nullable=False),
        sa.Column("tools", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "(sub_agent = false AND model_id IS NULL) OR (sub_agent = true AND model_id IS NOT NULL)",
            name="agent_role_model",
        ),
        sa.CheckConstraint("config_revision >= 1", name="agent_config_revision_positive"),
        sa.CheckConstraint("max_steps >= 1 AND max_steps <= 100", name="agent_loop_limit"),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", "sub_agent", name="uq_agent_profile_id_owner_role"),
    )
    with op.batch_alter_table("agent_profiles", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_agent_profiles_model_id"), ["model_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_agent_profiles_user_id"), ["user_id"], unique=False)
        batch_op.create_index(
            "one_main_agent_per_user",
            ["user_id"],
            unique=True,
            sqlite_where=sa.text("sub_agent = false"),
            postgresql_where=sa.text("sub_agent = false"),
        )

    op.create_table(
        "course_copies",
        sa.Column("class_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("version_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["class_id"], ["classes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["course_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("class_id", "user_id"),
    )
    op.create_table(
        "course_files",
        sa.Column("version_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["version_id"], ["course_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("version_id", "name", name="uq_course_files_version_name"),
    )
    op.create_table(
        "file_knowledge_extractions",
        sa.Column("artifact_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "text_extraction",
                "embedding",
                "captioning",
                name="knowledgeextractionkind",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "running",
                "ready",
                "failed",
                "canceled",
                name="knowledgeextractionstatus",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=512), nullable=True),
        sa.Column("model", sa.String(length=512), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_reason", sa.String(length=512), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.Integer(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["artifact_id"], ["file_knowledge_artifacts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("artifact_id", "kind", name="uq_file_knowledge_extractions_artifact_kind"),
    )
    with op.batch_alter_table("file_knowledge_extractions", schema=None) as batch_op:
        batch_op.create_index("idx_file_knowledge_extractions_artifact_status", ["artifact_id", "status"], unique=False)
        batch_op.create_index(batch_op.f("ix_file_knowledge_extractions_artifact_id"), ["artifact_id"], unique=False)

    op.create_table(
        "study_cards",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("deck_id", sa.Uuid(), nullable=False),
        sa.Column("front", sa.Text(), nullable=False),
        sa.Column("back", sa.Text(), nullable=False),
        sa.Column("citations", sa.Text(), server_default="[]", nullable=False),
        sa.Column("state", sa.String(length=16), server_default="learning", nullable=False),
        sa.Column("step", sa.Integer(), nullable=True),
        sa.Column("stability", sa.Float(), nullable=True),
        sa.Column("difficulty", sa.Float(), nullable=True),
        sa.Column("due_at", sa.Integer(), nullable=False),
        sa.Column("last_reviewed_at", sa.Integer(), nullable=True),
        sa.Column("reps", sa.Integer(), server_default="0", nullable=False),
        sa.Column("lapses", sa.Integer(), server_default="0", nullable=False),
        sa.Column("source_reflection_id", sa.Uuid(), nullable=True),
        sa.Column("source_unclear_item", sa.Text(), nullable=True),
        sa.Column("flagged_unclear_at", sa.Integer(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("state IN ('learning', 'review', 'relearning')", name="ck_study_cards_state"),
        sa.CheckConstraint("difficulty IS NULL OR difficulty BETWEEN 1 AND 10", name="ck_study_cards_difficulty"),
        sa.CheckConstraint("length(trim(back)) > 0 AND length(back) <= 4000", name="ck_study_cards_back"),
        sa.CheckConstraint("length(trim(front)) > 0 AND length(front) <= 4000", name="ck_study_cards_front"),
        sa.CheckConstraint("reps >= 0 AND lapses >= 0", name="ck_study_cards_counts"),
        sa.CheckConstraint(
            "source_unclear_item IS NULL OR source_reflection_id IS NOT NULL", name="ck_study_cards_unclear_source"
        ),
        sa.CheckConstraint("stability IS NULL OR stability > 0", name="ck_study_cards_stability"),
        sa.ForeignKeyConstraint(
            ["deck_id", "user_id"],
            ["study_decks.id", "study_decks.user_id"],
            name="fk_study_cards_deck_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_study_cards_id_user"),
    )
    with op.batch_alter_table("study_cards", schema=None) as batch_op:
        batch_op.create_index("idx_study_cards_deck", ["user_id", "deck_id", "created_at", "id"], unique=False)
        batch_op.create_index("idx_study_cards_due", ["user_id", "deck_id", "due_at", "id"], unique=False)

    op.create_table(
        "study_quiz_attempts",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("quiz_id", sa.Uuid(), nullable=False),
        sa.Column("submitted_at", sa.Integer(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False),
        sa.Column("ungraded_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("grader_model_id", sa.Uuid(), nullable=True),
        sa.Column("grader_model_name", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "question_count > 0 AND ungraded_count BETWEEN 0 AND question_count AND score >= 0 AND score <= question_count",
            name="ck_study_quiz_attempts_counts",
        ),
        sa.ForeignKeyConstraint(
            ["quiz_id", "user_id"],
            ["study_quizzes.id", "study_quizzes.user_id"],
            name="fk_study_quiz_attempts_quiz_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_study_quiz_attempts_id_user"),
    )
    with op.batch_alter_table("study_quiz_attempts", schema=None) as batch_op:
        batch_op.create_index(
            "idx_study_quiz_attempts_quiz", ["user_id", "quiz_id", "submitted_at", "id"], unique=False
        )

    op.create_table(
        "study_quiz_questions",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("quiz_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("options", sa.Text(), server_default="[]", nullable=False),
        sa.Column("correct_option", sa.Integer(), nullable=True),
        sa.Column("rubric", sa.Text(), server_default="", nullable=False),
        sa.Column("explanation", sa.Text(), server_default="", nullable=False),
        sa.Column("citations", sa.Text(), server_default="[]", nullable=False),
        sa.Column("source_question_id", sa.Uuid(), nullable=True),
        sa.Column("source_card_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "(kind = 'multiple_choice' AND correct_option IS NOT NULL AND correct_option >= 0) OR (kind = 'short_answer' AND correct_option IS NULL AND length(trim(rubric)) > 0)",
            name="ck_study_quiz_questions_answer_key",
        ),
        sa.CheckConstraint("kind IN ('multiple_choice', 'short_answer')", name="ck_study_quiz_questions_kind"),
        sa.CheckConstraint(
            "length(rubric) <= 4000 AND length(explanation) <= 2000", name="ck_study_quiz_questions_key_lengths"
        ),
        sa.CheckConstraint(
            "length(trim(prompt)) > 0 AND length(prompt) <= 4000", name="ck_study_quiz_questions_prompt"
        ),
        sa.CheckConstraint(
            "source_question_id IS NULL OR source_card_id IS NULL", name="ck_study_quiz_questions_single_source"
        ),
        sa.ForeignKeyConstraint(
            ["quiz_id", "user_id"],
            ["study_quizzes.id", "study_quizzes.user_id"],
            name="fk_study_quiz_questions_quiz_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_study_quiz_questions_id_user"),
        sa.UniqueConstraint("quiz_id", "position", name="uq_study_quiz_questions_position"),
    )
    with op.batch_alter_table("study_quiz_questions", schema=None) as batch_op:
        batch_op.create_index("idx_study_quiz_questions_quiz", ["user_id", "quiz_id", "position"], unique=False)

    op.create_table(
        "agent_skills",
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("skill_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("sub_agent", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["agent_id", "user_id", "sub_agent"],
            ["agent_profiles.id", "agent_profiles.user_id", "agent_profiles.sub_agent"],
            name="fk_agent_skills_agent_owner_role",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["skill_id", "user_id"],
            ["skills.id", "skills.user_id"],
            name="fk_agent_skills_skill_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("agent_id", "skill_id"),
    )
    with op.batch_alter_table("agent_skills", schema=None) as batch_op:
        batch_op.create_index("idx_agent_skills_skill_owner", ["skill_id", "user_id"], unique=False)

    op.create_table(
        "chats",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("skill_revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "learning_mode",
            sa.Enum(
                "standard",
                "tutor",
                "explain_back",
                "review",
                "spot_the_error",
                "draft_feedback",
                "research",
                name="learningmodeid",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("learning_mode_revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "learning_mode_locked",
            sa.Boolean(create_constraint=True, name="ck_chats_learning_mode_locked_boolean"),
            server_default="0",
            nullable=False,
        ),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("agent_id", sa.Uuid(), nullable=True),
        sa.Column("selected_model_id", sa.Uuid(), nullable=True),
        sa.Column("selected_model_snapshot", sa.JSON(), nullable=True),
        sa.Column("model_revision", sa.Integer(), nullable=False),
        sa.Column("active_root_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("allowed_tools", sa.JSON(), nullable=False),
        sa.Column("purpose", sa.String(length=20), server_default="conversation", nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "NOT learning_mode_locked OR learning_mode != 'standard'", name="chat_standard_mode_unlocked"
        ),
        sa.CheckConstraint("purpose IN ('conversation', 'skill_draft')", name="chat_purpose_known"),
        sa.CheckConstraint("learning_mode_revision >= 1", name="chat_learning_mode_revision_positive"),
        sa.CheckConstraint("model_revision >= 1", name="chat_model_revision_positive"),
        sa.CheckConstraint("skill_revision >= 0", name="chat_skill_revision_nonnegative"),
        sa.ForeignKeyConstraint(["agent_id"], ["agent_profiles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["project_id", "user_id"], ["projects.id", "projects.user_id"], name="fk_chats_project_owner"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_chats_id_user"),
    )
    with op.batch_alter_table("chats", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_chats_agent_id"), ["agent_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_chats_project_id"), ["project_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_chats_user_id"), ["user_id"], unique=False)

    op.create_table(
        "course_copy_items",
        sa.Column("class_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column(
            "item_type",
            sa.Enum("sub_agent", "file", name="courseitemtype", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("item_key", sa.String(length=255), nullable=False),
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(
            ["class_id", "user_id"],
            ["course_copies.class_id", "course_copies.user_id"],
            name="fk_course_copy_items_copy",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("class_id", "user_id", "item_type", "item_key"),
    )
    with op.batch_alter_table("course_copy_items", schema=None) as batch_op:
        batch_op.create_index("idx_course_copy_items_record", ["record_id"], unique=False)

    op.create_table(
        "general_sub_agents",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("sub_agent", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("position >= 0", name="ck_general_sub_agent_position"),
        sa.CheckConstraint("sub_agent = true", name="ck_general_sub_agent_role"),
        sa.ForeignKeyConstraint(
            ["agent_id", "user_id", "sub_agent"],
            ["agent_profiles.id", "agent_profiles.user_id", "agent_profiles.sub_agent"],
            name="fk_general_sub_agents_agent_owner_role",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "agent_id"),
        sa.UniqueConstraint("user_id", "position", name="uq_general_sub_agents_position"),
    )
    op.create_table(
        "project_sub_agents",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("sub_agent", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("sub_agent = true", name="ck_project_sub_agent_role"),
        sa.ForeignKeyConstraint(
            ["agent_id", "user_id", "sub_agent"],
            ["agent_profiles.id", "agent_profiles.user_id", "agent_profiles.sub_agent"],
            name="fk_project_sub_agents_agent_owner_role",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            name="fk_project_sub_agents_project_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "agent_id"),
    )
    with op.batch_alter_table("project_sub_agents", schema=None) as batch_op:
        batch_op.create_index("idx_project_sub_agents_agent_owner", ["agent_id", "user_id"], unique=False)

    op.create_table(
        "study_quiz_answers",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("choice", sa.Integer(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("verdict", sa.String(length=16), nullable=False),
        sa.Column("grader", sa.String(length=16), nullable=False),
        sa.Column("feedback", sa.Text(), server_default="", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("grader IN ('exact', 'model', 'none')", name="ck_study_quiz_answers_grader"),
        sa.CheckConstraint(
            "verdict IN ('correct', 'partial', 'incorrect', 'ungraded')", name="ck_study_quiz_answers_verdict"
        ),
        sa.CheckConstraint(
            "(text IS NULL OR length(text) <= 2000) AND length(feedback) <= 2000", name="ck_study_quiz_answers_lengths"
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id", "user_id"],
            ["study_quiz_attempts.id", "study_quiz_attempts.user_id"],
            name="fk_study_quiz_answers_attempt_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["question_id", "user_id"],
            ["study_quiz_questions.id", "study_quiz_questions.user_id"],
            name="fk_study_quiz_answers_question_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attempt_id", "question_id", name="uq_study_quiz_answers_question"),
    )
    with op.batch_alter_table("study_quiz_answers", schema=None) as batch_op:
        batch_op.create_index("idx_study_quiz_answers_attempt", ["user_id", "attempt_id"], unique=False)

    op.create_table(
        "study_review_logs",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("card_id", sa.Uuid(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("reviewed_at", sa.Integer(), nullable=False),
        sa.Column("previous_state", sa.String(length=16), nullable=False),
        sa.Column("previous_due_at", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("due_at", sa.Integer(), nullable=False),
        sa.Column("stability", sa.Float(), nullable=False),
        sa.Column("difficulty", sa.Float(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("rating BETWEEN 1 AND 4", name="ck_study_review_logs_rating"),
        sa.ForeignKeyConstraint(
            ["card_id", "user_id"],
            ["study_cards.id", "study_cards.user_id"],
            name="fk_study_review_logs_card_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("study_review_logs", schema=None) as batch_op:
        batch_op.create_index("idx_study_review_logs_card", ["user_id", "card_id", "reviewed_at"], unique=False)

    op.create_table(
        "canvas_items",
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("language", sa.String(length=32), server_default="", nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("(kind = 'code') = (language != '')", name="ck_canvas_items_language"),
        sa.CheckConstraint("kind IN ('document', 'code', 'html')", name="ck_canvas_items_kind"),
        sa.ForeignKeyConstraint(
            ["chat_id", "user_id"], ["chats.id", "chats.user_id"], name="fk_canvas_items_chat", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("canvas_items", schema=None) as batch_op:
        batch_op.create_index("idx_canvas_items_chat", ["chat_id", "user_id"], unique=False)

    op.create_table(
        "chat_drafts",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=True),
        sa.Column("model_id", sa.Uuid(), nullable=True),
        sa.Column("selected_file_ids", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["chat_id", "user_id"], ["chats.id", "chats.user_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_chat_drafts_owner"),
    )
    with op.batch_alter_table("chat_drafts", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_chat_drafts_expires_at"), ["expires_at"], unique=False)

    op.create_table(
        "chat_files",
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["chat_id", "user_id"], ["chats.id", "chats.user_id"], name="fk_chat_files_chat_owner", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["file_id", "user_id"],
            ["user_files.id", "user_files.user_id"],
            name="fk_chat_files_file_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("chat_id", "file_id"),
    )
    with op.batch_alter_table("chat_files", schema=None) as batch_op:
        batch_op.create_index("idx_chat_files_file_owner", ["file_id", "user_id"], unique=False)

    op.create_table(
        "image_generations",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("negative_prompt", sa.Text(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("revision", sa.String(length=100), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("steps", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("images", sa.JSON(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "status IN ('completed', 'failed', 'refused', 'cancelled')", name="ck_image_generations_status"
        ),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("image_generations", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_image_generations_chat_id"), ["chat_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_image_generations_created_at"), ["created_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_image_generations_user_id"), ["user_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("chat_id", sa.UUID(), nullable=False),
        sa.Column("model_id", sa.Uuid(), nullable=True),
        sa.Column("execution_id", sa.Uuid(), nullable=True),
        sa.Column("pending_execution_id", sa.Uuid(), nullable=True),
        sa.Column("accepted_skills", sa.JSON(), nullable=False),
        sa.Column("accepted_about", sa.JSON(), nullable=True),
        sa.Column("accepted_learning_mode", sa.JSON(), nullable=True),
        sa.Column(
            "hint_level",
            sa.Enum(
                "none",
                "nudge",
                "hint",
                "worked_example",
                "answer",
                name="hintlevel",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="none",
            nullable=False,
        ),
        sa.Column("accepted_template", sa.JSON(), nullable=True),
        sa.Column("accepted_rubric", sa.JSON(), nullable=True),
        sa.Column("accepted_goal", sa.JSON(), nullable=True),
        sa.Column(
            "image_request",
            sa.Boolean(create_constraint=True, name="ck_messages_image_request_boolean"),
            server_default="0",
            nullable=False,
        ),
        sa.Column("comparison_id", sa.Uuid(), nullable=True),
        sa.Column("comparison_index", sa.Integer(), nullable=True),
        sa.Column("target_model_id", sa.Uuid(), nullable=True),
        sa.Column("comparison_label", sa.String(length=40), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "completed",
                "cancelled",
                "failed",
                name="messagestatus",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("parent_message_id", sa.Uuid(), nullable=True),
        sa.Column("active_child_id", sa.Uuid(), nullable=True),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("thinking", sa.Text(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("tool_calls", sa.JSON(), nullable=True),
        sa.Column("tool_call_results", sa.JSON(), nullable=True),
        sa.Column("delegations", sa.JSON(), nullable=True),
        sa.Column("context", sa.JSON(), nullable=True),
        sa.Column("files", sa.JSON(), nullable=False),
        sa.Column("inline_files", sa.JSON(), nullable=False),
        sa.Column("exercise_record", sa.JSON(), nullable=True),
        sa.Column("draft_comments", sa.JSON(), nullable=True),
        sa.Column("disagreements", sa.JSON(), nullable=True),
        sa.Column("verification", sa.JSON(), nullable=True),
        sa.Column("citations", sa.JSON(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("total_tokens", sa.Integer(), nullable=False),
        sa.Column("generation_duration_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "(comparison_id IS NULL AND comparison_index IS NULL AND target_model_id IS NULL AND comparison_label IS NULL) OR (comparison_id IS NOT NULL AND role = 'user' AND target_model_id IS NOT NULL AND comparison_index BETWEEN 0 AND 2)",
            name="message_comparison_column_shape",
        ),
        sa.ForeignKeyConstraint(
            ["active_child_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            name="fk_messages_active_child_scope",
        ),
        sa.ForeignKeyConstraint(["active_child_id"], ["messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["chat_id", "user_id"], ["chats.id", "chats.user_id"], name="fk_messages_chat_owner", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], name="message_fk_session_id", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["execution_id", "chat_id", "user_id"],
            ["chat_executions.id", "chat_executions.chat_id", "chat_executions.user_id"],
            name="fk_message_execution_owner",
            initially="DEFERRED",
            deferrable=True,
            use_alter=True,
        ),
        sa.ForeignKeyConstraint(
            ["execution_id"],
            ["chat_executions.id"],
            name="fk_message_execution",
            initially="DEFERRED",
            deferrable=True,
            use_alter=True,
        ),
        sa.ForeignKeyConstraint(
            ["parent_message_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            name="fk_messages_parent_scope",
        ),
        sa.ForeignKeyConstraint(["parent_message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["pending_execution_id", "chat_id", "user_id"],
            ["chat_executions.id", "chat_executions.chat_id", "chat_executions.user_id"],
            name="fk_message_pending_execution_owner",
            initially="DEFERRED",
            deferrable=True,
            use_alter=True,
        ),
        sa.ForeignKeyConstraint(
            ["pending_execution_id"],
            ["chat_executions.id"],
            name="fk_message_pending_execution",
            initially="DEFERRED",
            deferrable=True,
            use_alter=True,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("comparison_id", "comparison_index", name="uq_messages_comparison_column"),
        sa.UniqueConstraint("id", "chat_id", "user_id", name="uq_messages_id_chat_user"),
    )
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_messages_chat_id"), ["chat_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_messages_comparison_id"), ["comparison_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_messages_execution_id"), ["execution_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_messages_pending_execution_id"), ["pending_execution_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_messages_user_id"), ["user_id"], unique=False)

    op.create_table(
        "reflections",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("chat_id", sa.Uuid(), nullable=True),
        sa.Column("learned", sa.Text(), server_default="", nullable=False),
        sa.Column("unclear", sa.Text(), server_default="", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("length(learned) <= 2000 AND length(unclear) <= 2000", name="ck_reflections_length"),
        sa.CheckConstraint("length(trim(learned)) > 0 OR length(trim(unclear)) > 0", name="ck_reflections_nonempty"),
        sa.CheckConstraint("revision >= 1", name="ck_reflections_revision"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("reflections", schema=None) as batch_op:
        batch_op.create_index("idx_reflections_owner_scope", ["user_id", "project_id", "created_at"], unique=False)

    op.create_table(
        "chat_compactions",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("through_message_id", sa.Uuid(), nullable=False),
        sa.Column("previous_compaction_id", sa.Uuid(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("replaced_messages", sa.Integer(), nullable=False),
        sa.Column("model_id", sa.Uuid(), nullable=True),
        sa.Column("model_name", sa.String(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("estimated_tokens_before", sa.Integer(), nullable=False),
        sa.Column(
            "trigger",
            sa.Enum("automatic", "manual", name="compactiontrigger", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("input_tokens >= 0 AND output_tokens >= 0", name="ck_compaction_usage_nonnegative"),
        sa.CheckConstraint("replaced_messages >= 1", name="ck_compaction_replaced_positive"),
        sa.ForeignKeyConstraint(
            ["chat_id", "user_id"], ["chats.id", "chats.user_id"], name="fk_compaction_chat_owner", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["previous_compaction_id"], ["chat_compactions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["through_message_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            name="fk_compaction_anchor_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("chat_id", "through_message_id", name="uq_compaction_chat_anchor"),
    )
    with op.batch_alter_table("chat_compactions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_chat_compactions_chat_id"), ["chat_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_chat_compactions_through_message_id"), ["through_message_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_chat_compactions_user_id"), ["user_id"], unique=False)

    op.create_table(
        "chat_draft_files",
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["draft_id", "user_id"], ["chat_drafts.id", "chat_drafts.user_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["file_id", "user_id"], ["user_files.id", "user_files.user_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("draft_id", "file_id"),
    )
    op.create_table(
        "chat_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("request_message_id", sa.Uuid(), nullable=False),
        sa.Column("execution", sa.JSON(), nullable=False),
        sa.Column("prompt", sa.JSON(), nullable=False),
        sa.Column("instruction_overrides", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["chat_id", "user_id"], ["chats.id", "chats.user_id"], name="fk_execution_chat_owner"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["request_message_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            name="fk_execution_request_owner",
        ),
        sa.ForeignKeyConstraint(["request_message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "chat_id", "user_id", name="uq_execution_id_chat_user"),
    )
    with op.batch_alter_table("chat_executions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_chat_executions_chat_id"), ["chat_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_chat_executions_request_message_id"), ["request_message_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_chat_executions_user_id"), ["user_id"], unique=False)

    op.create_table(
        "chat_send_receipts",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["chat_id", "user_id"], ["chats.id", "chats.user_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["message_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "request_id"),
    )
    op.create_table(
        "sub_agent_traces",
        sa.Column("context_provenance", sa.JSON(), nullable=True),
        sa.Column("prompt_provenance", sa.JSON(), nullable=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("parent_message_id", sa.Uuid(), nullable=True),
        sa.Column("sub_agent_id", sa.Uuid(), nullable=False),
        sa.Column("sub_agent_name", sa.Text(), nullable=False),
        sa.Column("task_digest", sa.Text(), nullable=False),
        sa.Column("caller_context_digest", sa.Text(), nullable=True),
        sa.Column("message_roles", sa.JSON(), nullable=False),
        sa.Column("result_digest", sa.Text(), nullable=True),
        sa.Column("step_count", sa.Integer(), nullable=False),
        sa.Column("total_tokens", sa.Integer(), nullable=False),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False),
        sa.Column("delegation_scope", sa.String(length=16), nullable=True),
        sa.Column("depth", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["parent_message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sub_agent_id"], ["agent_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("sub_agent_traces", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_sub_agent_traces_parent_message_id"), ["parent_message_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_sub_agent_traces_sub_agent_id"), ["sub_agent_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_sub_agent_traces_user_id"), ["user_id"], unique=False)

    op.create_table(
        "canvas_versions",
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("author", sa.String(length=8), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("execution_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("(author = 'agent') = (execution_id IS NOT NULL)", name="ck_canvas_versions_execution"),
        sa.CheckConstraint("author IN ('agent', 'user')", name="ck_canvas_versions_author"),
        sa.CheckConstraint("length(trim(title)) BETWEEN 1 AND 200", name="ck_canvas_versions_title"),
        sa.CheckConstraint("number >= 1", name="ck_canvas_versions_number"),
        sa.ForeignKeyConstraint(["execution_id"], ["chat_executions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["canvas_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("item_id", "number"),
    )
    with op.batch_alter_table("canvas_versions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_canvas_versions_execution_id"), ["execution_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_canvas_versions_message_id"), ["message_id"], unique=False)

    op.execute(
        "INSERT INTO groups (id, name, built_in, created_at, updated_at) VALUES "
        "('admin', 'Admin', 1, unixepoch(), unixepoch()), "
        "('educator', 'Educator', 1, unixepoch(), unixepoch()), "
        "('student', 'Student', 1, unixepoch(), unixepoch())"
    )
    for statement in (*_FTS_TABLES, *_TRIGGERS):
        op.execute(statement)
